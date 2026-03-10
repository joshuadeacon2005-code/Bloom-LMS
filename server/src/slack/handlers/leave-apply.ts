import type { App, BlockAction } from '@slack/bolt'
import { eq, and } from 'drizzle-orm'
import { db } from '../../db/index'
import { approvalWorkflows, users, leaveRequests, leaveTypes, regions } from '../../db/schema'
import * as dbService from '../db-service'
import * as leaveService from '../../services/leave.service'
import * as approvalService from '../../services/approval.service'
import { isAUNZRegion } from './utils'
import {
  addLeaveRequestToSheet,
  updateLeaveRequestInSheet,
  upsertEmployeeBalancesInSheet,
  logApprovalAction,
  logBalanceAdjustment,
} from '../google-sheets'

async function getLeaveApplyBlocks(regionId: number, regionCode: string): Promise<any[]> {
  const allTypes = await dbService.getLeaveTypesForUser(regionId)

  // Filter region-appropriate comp types
  const isAUNZ = isAUNZRegion(regionCode)
  const filteredTypes = allTypes.filter((lt) => {
    if (lt.code === 'COMP_LEAVE' && isAUNZ) return false
    if (lt.code === 'TIL' && !isAUNZ) return false
    return true
  })

  const options = filteredTypes.map((lt) => ({
    text: { type: 'plain_text' as const, text: lt.name },
    value: String(lt.id),
  }))

  return [
    {
      type: 'input',
      block_id: 'leave_type',
      element: {
        type: 'static_select',
        action_id: 'leave_type_select',
        placeholder: { type: 'plain_text', text: 'Select leave type' },
        options,
      },
      label: { type: 'plain_text', text: 'Leave Type' },
    },
    {
      type: 'input',
      block_id: 'start_date',
      element: {
        type: 'datepicker',
        action_id: 'start_date_pick',
        placeholder: { type: 'plain_text', text: 'Select start date' },
      },
      label: { type: 'plain_text', text: 'Start Date' },
    },
    {
      type: 'input',
      block_id: 'end_date',
      element: {
        type: 'datepicker',
        action_id: 'end_date_pick',
        placeholder: { type: 'plain_text', text: 'Select end date' },
      },
      label: { type: 'plain_text', text: 'End Date' },
    },
    {
      type: 'input',
      block_id: 'leave_reason',
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'reason_input',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'Optional: reason for leave' },
      },
      label: { type: 'plain_text', text: 'Reason (optional)' },
    },
  ]
}

export function registerLeaveApplyHandlers(app: App) {
  // leave_apply_modal view submission
  app.view('leave_apply_modal', async ({ ack, body, view, client }) => {
    // Validation and quick ack
    const values = view.state.values
    const leaveTypeId = parseInt(values.leave_type?.leave_type_select?.selected_option?.value ?? '0')
    const startDate = values.start_date?.start_date_pick?.selected_date ?? ''
    const endDate = values.end_date?.end_date_pick?.selected_date ?? ''
    const reason = values.leave_reason?.reason_input?.value ?? ''

    const errors: Record<string, string> = {}
    if (!leaveTypeId) errors['leave_type'] = 'Please select a leave type.'
    if (!startDate) errors['start_date'] = 'Please select a start date.'
    if (!endDate) errors['end_date'] = 'Please select an end date.'
    if (startDate && endDate && startDate > endDate) errors['end_date'] = 'End date must be on or after start date.'

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors } as any)
      return
    }

    await ack()

    try {
      const slackUserId = body.user.id
      const dbUser = await dbService.getUserBySlackId(slackUserId)

      if (!dbUser) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: 'Your Slack account is not linked to a Bloom LMS user. Please contact HR to set up your account.'
        })
        return
      }

      // Create leave request (this builds the approval chain automatically)
      let request: Awaited<ReturnType<typeof leaveService.createLeaveRequest>>
      try {
        request = await leaveService.createLeaveRequest(dbUser.id, {
          leaveTypeId,
          startDate,
          endDate,
          reason: reason || undefined,
        })
      } catch (err: any) {
        await client.chat.postMessage({
          channel: slackUserId,
          text: `Could not submit your leave request: ${err.message}`
        })
        return
      }

      // Log to Google Sheets
      addLeaveRequestToSheet({
        requestId: request.id,
        employeeName: dbUser.name,
        email: dbUser.email,
        regionCode: dbUser.region.code,
        leaveTypeName: (await db.select({ name: leaveTypes.name }).from(leaveTypes).where(eq(leaveTypes.id, leaveTypeId)).limit(1))[0]?.name ?? 'Leave',
        startDate,
        endDate,
        workingDays: request.totalDays,
        reason: reason || '',
        status: 'Pending',
        submittedDate: new Date().toISOString().slice(0, 10),
      }).catch((e) => console.error('[leave-apply] Sheet log error:', e))

      // Get the first pending approval workflow to notify the approver
      const [firstWorkflow] = await db
        .select({
          id: approvalWorkflows.id,
          approverId: approvalWorkflows.approverId,
          approverSlackId: users.slackUserId,
          approverName: users.name,
        })
        .from(approvalWorkflows)
        .leftJoin(users, eq(approvalWorkflows.approverId, users.id))
        .where(
          and(
            eq(approvalWorkflows.leaveRequestId, request.id),
            eq(approvalWorkflows.status, 'pending')
          )
        )
        .orderBy(approvalWorkflows.level)
        .limit(1)

      // Get leave type name for messages
      const [lt] = await db
        .select({ name: leaveTypes.name })
        .from(leaveTypes)
        .where(eq(leaveTypes.id, leaveTypeId))
        .limit(1)
      const ltName = lt?.name ?? 'Leave'

      const buttonValue = JSON.stringify({ requestId: request.id, workflowId: firstWorkflow?.id })

      // DM to approver
      if (firstWorkflow?.approverSlackId) {
        await client.chat.postMessage({
          channel: firstWorkflow.approverSlackId,
          text: `New leave request from ${dbUser.name}`,
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'New Leave Request Pending Approval' } },
            { type: 'divider' },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Employee:*\n${dbUser.name}` },
                { type: 'mrkdwn', text: `*Leave Type:*\n${ltName}` },
                { type: 'mrkdwn', text: `*Start Date:*\n${startDate}` },
                { type: 'mrkdwn', text: `*End Date:*\n${endDate}` },
                { type: 'mrkdwn', text: `*Working Days:*\n${request.totalDays}` },
                ...(reason ? [{ type: 'mrkdwn' as const, text: `*Reason:*\n${reason}` }] : []),
              ]
            },
            { type: 'divider' },
            {
              type: 'actions',
              block_id: 'leave_approval_actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Approve' },
                  style: 'primary',
                  action_id: 'approve_leave',
                  value: buttonValue,
                },
                {
                  type: 'button',
                  text: { type: 'plain_text', text: 'Reject' },
                  style: 'danger',
                  action_id: 'reject_leave',
                  value: buttonValue,
                },
              ]
            }
          ]
        }).catch((err) => console.error('[leave-apply] Error DM-ing approver:', err))
      }

      // Confirm to employee
      await client.chat.postMessage({
        channel: slackUserId,
        text: 'Your leave request has been submitted!',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Leave Request Submitted' } },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `Your ${ltName} request has been submitted and ${firstWorkflow?.approverName ? `*${firstWorkflow.approverName}* has been notified` : 'is pending assignment to an approver'}.`
            }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Request ID:*\n${request.id}` },
              { type: 'mrkdwn', text: `*Status:*\nPending Approval` },
              { type: 'mrkdwn', text: `*Leave Type:*\n${ltName}` },
              { type: 'mrkdwn', text: `*Dates:*\n${startDate} \u2013 ${endDate}` },
              { type: 'mrkdwn', text: `*Working Days:*\n${request.totalDays}` },
            ]
          }
        ]
      })
    } catch (error) {
      console.error('[leave-apply] Error handling leave_apply_modal submission:', error)
    }
  })

  // Approve leave button
  app.action('approve_leave', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = body as BlockAction
      const buttonAction = action.actions[0]
      const rawValue = ('value' in buttonAction ? buttonAction.value : '') || '{}'
      const { requestId } = JSON.parse(rawValue) as { requestId: number }

      // Get DB user of the approver
      const approverDbUser = await dbService.getUserBySlackId(body.user.id)
      if (!approverDbUser) {
        await client.chat.postMessage({ channel: body.user.id, text: 'Your account is not linked to Bloom LMS.' })
        return
      }

      let result: any
      try {
        result = await approvalService.approveRequest(requestId, approverDbUser.id)
      } catch (err: any) {
        await client.chat.postMessage({ channel: body.user.id, text: `Could not approve: ${err.message}` })
        return
      }

      // Update approver's message
      await client.chat.update({
        channel: action.container.channel_id || '',
        ts: action.container.message_ts || '',
        text: 'Leave Request Approved',
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `You approved this leave request (Request #${requestId}).${result.status === 'awaiting_next_approval' ? ' It now awaits higher-level approval.' : ''}` }
        }]
      }).catch((e) => console.error('[leave-apply] Error updating approver message:', e))

      // Fetch request details for sheet logging
      const [reqDetails] = await db
        .select({
          userId: leaveRequests.userId,
          leaveTypeId: leaveRequests.leaveTypeId,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          totalDays: leaveRequests.totalDays,
        })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, requestId))
        .limit(1)

      const [ltDetails] = reqDetails
        ? await db.select({ name: leaveTypes.name }).from(leaveTypes).where(eq(leaveTypes.id, reqDetails.leaveTypeId)).limit(1)
        : []

      const [empDetails] = reqDetails
        ? await db
            .select({ slackUserId: users.slackUserId, name: users.name, email: users.email, regionId: users.regionId })
            .from(users)
            .where(eq(users.id, reqDetails.userId))
            .limit(1)
        : []

      const [empRegion] = empDetails
        ? await db.select({ code: regions.code }).from(regions).where(eq(regions.id, empDetails.regionId)).limit(1)
        : []

      const today = new Date().toISOString().slice(0, 10)
      const actionLabel = result.status === 'approved' ? 'Approved' : 'Pending (Next Level)'

      // Update Leave Requests sheet status
      updateLeaveRequestInSheet(requestId, actionLabel, approverDbUser.name, today)
        .catch((e) => console.error('[leave-apply] Sheet update error on approve:', e))

      // Log to Approval Log
      if (reqDetails && ltDetails && empDetails) {
        logApprovalAction({
          requestId,
          employeeName: empDetails.name,
          email: empDetails.email,
          regionCode: empRegion?.code ?? '',
          leaveTypeName: ltDetails.name,
          startDate: reqDetails.startDate,
          endDate: reqDetails.endDate,
          workingDays: Number(reqDetails.totalDays),
          action: actionLabel as any,
          approverName: approverDbUser.name,
        }).catch((e) => console.error('[leave-apply] Approval log error:', e))
      }

      // Notify employee if fully approved
      if (result.status === 'approved' && empDetails) {
        // Log leave used in Balance Adjustments
        if (ltDetails && empRegion) {
          logBalanceAdjustment({
            employeeName: empDetails.name,
            email: empDetails.email,
            regionCode: empRegion.code,
            leaveTypeName: ltDetails.name,
            adjustmentType: 'Leave Used',
            days: Number(reqDetails?.totalDays ?? 0),
            referenceId: requestId,
          }).catch((e) => console.error('[leave-apply] Balance adjustment log error:', e))
        }

        // Refresh balances in sheet
        const year = new Date().getFullYear()
        const balances = await dbService.getUserBalances(reqDetails!.userId, year)
        upsertEmployeeBalancesInSheet(empDetails.name, empDetails.email, empRegion?.code ?? '', balances)
          .catch((e) => console.error('[leave-apply] Sheet balance upsert error on approve:', e))

        if (empDetails.slackUserId) {
          await client.chat.postMessage({
            channel: empDetails.slackUserId,
            text: 'Your leave request has been approved!',
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `*Leave Request Approved*\n\nYour leave request #${requestId} has been fully approved. Enjoy your leave!` }
            }]
          }).catch((e) => console.error('[leave-apply] Error notifying employee of approval:', e))
        }
      }
    } catch (error) {
      console.error('[leave-apply] Error handling approve_leave action:', error)
    }
  })

  // Reject leave button → open reason modal
  app.action('reject_leave', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = body as BlockAction
      const buttonAction = action.actions[0]
      const rawValue = ('value' in buttonAction ? buttonAction.value : '') || '{}'
      const { requestId } = JSON.parse(rawValue) as { requestId: number }

      await client.views.open({
        trigger_id: (action as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'leave_reject_modal',
          private_metadata: JSON.stringify({
            requestId,
            messageTs: action.container.message_ts,
            channelId: action.container.channel_id,
          }),
          title: { type: 'plain_text', text: 'Reject Leave Request' },
          submit: { type: 'plain_text', text: 'Reject' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `Reject leave request #${requestId}?` }
            },
            {
              type: 'input',
              block_id: 'rejection_reason',
              element: {
                type: 'plain_text_input',
                action_id: 'reason_input',
                multiline: true,
                placeholder: { type: 'plain_text', text: 'Reason for rejection (required)' }
              },
              label: { type: 'plain_text', text: 'Reason' }
            }
          ]
        }
      })
    } catch (error) {
      console.error('[leave-apply] Error opening reject_leave modal:', error)
    }
  })

  // Rejection modal submission
  app.view('leave_reject_modal', async ({ ack, body, view, client }) => {
    await ack()

    try {
      const metadata = JSON.parse(view.private_metadata)
      const { requestId, messageTs, channelId } = metadata
      const reason = view.state.values.rejection_reason?.reason_input?.value || 'No reason provided'

      const approverDbUser = await dbService.getUserBySlackId(body.user.id)
      if (!approverDbUser) return

      try {
        await approvalService.rejectRequest(requestId, approverDbUser.id, reason)
      } catch (err: any) {
        await client.chat.postMessage({ channel: body.user.id, text: `Could not reject: ${err.message}` })
        return
      }

      // Update Leave Requests sheet + log to Approval Log
      const today = new Date().toISOString().slice(0, 10)
      updateLeaveRequestInSheet(requestId, 'Rejected', approverDbUser.name, today)
        .catch((e) => console.error('[leave-apply] Sheet update error on reject:', e))

      const [rejReq] = await db
        .select({ userId: leaveRequests.userId, leaveTypeId: leaveRequests.leaveTypeId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate, totalDays: leaveRequests.totalDays })
        .from(leaveRequests).where(eq(leaveRequests.id, requestId)).limit(1)
      if (rejReq) {
        const [rejLt] = await db.select({ name: leaveTypes.name }).from(leaveTypes).where(eq(leaveTypes.id, rejReq.leaveTypeId)).limit(1)
        const [rejEmp] = await db.select({ name: users.name, email: users.email, regionId: users.regionId }).from(users).where(eq(users.id, rejReq.userId)).limit(1)
        const [rejRegion] = rejEmp ? await db.select({ code: regions.code }).from(regions).where(eq(regions.id, rejEmp.regionId)).limit(1) : []
        if (rejLt && rejEmp) {
          logApprovalAction({
            requestId,
            employeeName: rejEmp.name,
            email: rejEmp.email,
            regionCode: rejRegion?.code ?? '',
            leaveTypeName: rejLt.name,
            startDate: rejReq.startDate,
            endDate: rejReq.endDate,
            workingDays: Number(rejReq.totalDays),
            action: 'Rejected',
            approverName: approverDbUser.name,
            comments: reason,
          }).catch((e) => console.error('[leave-apply] Approval log error on reject:', e))
        }
      }

      // Update approver's message
      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Leave Request Rejected',
          blocks: [{
            type: 'section',
            text: { type: 'mrkdwn', text: `You rejected leave request #${requestId}.\n\n*Reason:* ${reason}` }
          }]
        }).catch((e) => console.error('[leave-apply] Error updating approver message after rejection:', e))
      }

      // Notify employee
      const [req] = await db
        .select({ userId: leaveRequests.userId })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, requestId))
        .limit(1)

      if (req) {
        const [emp] = await db
          .select({ slackUserId: users.slackUserId })
          .from(users)
          .where(eq(users.id, req.userId))
          .limit(1)

        if (emp?.slackUserId) {
          await client.chat.postMessage({
            channel: emp.slackUserId,
            text: 'Your leave request was not approved.',
            blocks: [{
              type: 'section',
              text: { type: 'mrkdwn', text: `*Leave Request Not Approved*\n\nYour leave request #${requestId} has been rejected.\n\n*Reason:* ${reason}` }
            }]
          }).catch((e) => console.error('[leave-apply] Error notifying employee of rejection:', e))
        }
      }
    } catch (error) {
      console.error('[leave-apply] Error handling leave_reject_modal submission:', error)
    }
  })

}

/**
 * Open the leave apply modal for a given user.
 * Called from the /leave apply command.
 */
export async function openLeaveApplyModal(
  client: any,
  triggerId: string,
  slackUserId: string
): Promise<void> {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Your Slack account is not linked to a Bloom LMS user. Please contact HR.'
    })
    return
  }

  const blocks = await getLeaveApplyBlocks(dbUser.regionId, dbUser.region.code)

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'leave_apply_modal',
      title: { type: 'plain_text', text: 'Apply for Leave' },
      submit: { type: 'plain_text', text: 'Submit' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks,
    }
  })
}
