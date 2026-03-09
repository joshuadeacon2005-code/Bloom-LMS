import type { App, BlockAction } from '@slack/bolt'
import { getRequestById, updateRequestValues, updateRequestStatus, upsertEmployeeBalancesInSheet, logBalanceAdjustment } from '../google-sheets'
import * as dbService from '../db-service'
import {
  formatCompType,
  getRegionDisplayName,
  getHrRecipientsForSubsidiary,
  lookupSlackUserByEmail,
  HR_CONTACT_EMAILS,
  HR_CONTACT_NAMES,
  HR_NOTIFICATION_EMAIL,
  HR_NOTIFICATION_NAME,
} from './utils'

export function registerCompApproveHandlers(app: App) {
  // Supervisor approve button → open confirmation modal
  app.action('approve_request', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = body as BlockAction
      const buttonAction = action.actions[0]
      const requestId = ('value' in buttonAction ? buttonAction.value : '') || ''

      const request = await getRequestById(requestId)
      if (!request) {
        await client.chat.postMessage({ channel: body.user.id, text: 'Error: Request not found' })
        return
      }

      const isTIL = request.compensationType === 'TimeInLieu'
      const initialQty = isTIL
        ? String(Math.round(request.timeInLieuHours ?? 1))
        : String(request.leaveDays ?? 0)

      await client.views.open({
        trigger_id: (action as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'supervisor_confirm_approval',
          private_metadata: JSON.stringify({
            requestId,
            messageTs: action.container.message_ts,
            channelId: action.container.channel_id,
          }),
          title: { type: 'plain_text', text: 'Confirm Approval' },
          submit: { type: 'plain_text', text: 'Approve' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Confirm approval for ${request.staffName}'s compensation request*` }
            },
            { type: 'divider' },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Employee:*\n${request.staffName}` },
                { type: 'mrkdwn', text: `*Type:*\n${formatCompType(request.compensationType)}` },
                { type: 'mrkdwn', text: `*Date Worked:*\n${request.dateOfWork}` },
                { type: 'mrkdwn', text: `*Reason:*\n${request.reason}` },
              ]
            },
            { type: 'divider' },
            ...(isTIL
              ? [{
                  type: 'input' as const,
                  block_id: 'approved_hours',
                  element: {
                    type: 'number_input' as const,
                    action_id: 'hours_value',
                    is_decimal_allowed: false,
                    initial_value: initialQty,
                    min_value: '1',
                    max_value: '20'
                  },
                  label: { type: 'plain_text' as const, text: 'Hours (you can modify if needed)' }
                }]
              : [{
                  type: 'input' as const,
                  block_id: 'approved_days',
                  element: {
                    type: 'number_input' as const,
                    action_id: 'days_value',
                    is_decimal_allowed: true,
                    initial_value: initialQty,
                    min_value: '0.5',
                    max_value: '5'
                  },
                  label: { type: 'plain_text' as const, text: 'Days (you can modify if needed)' }
                }]
            ),
            {
              type: 'input' as const,
              block_id: 'approval_notes',
              optional: true,
              element: {
                type: 'plain_text_input' as const,
                action_id: 'notes_input',
                multiline: true,
                placeholder: { type: 'plain_text' as const, text: 'Add a note if you adjusted the hours/days (optional)' }
              },
              label: { type: 'plain_text' as const, text: 'Notes (optional)' }
            }
          ]
        }
      })
    } catch (error) {
      console.error('[comp-approve] Error opening approval modal:', error)
    }
  })

  // Supervisor rejection button → open reason modal
  app.action('reject_request', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = body as BlockAction
      const buttonAction = action.actions[0]
      const requestId = ('value' in buttonAction ? buttonAction.value : '') || ''

      const request = await getRequestById(requestId)
      if (!request) {
        await client.chat.postMessage({ channel: body.user.id, text: 'Error: Request not found' })
        return
      }

      await client.views.open({
        trigger_id: (action as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'supervisor_confirm_rejection',
          private_metadata: JSON.stringify({
            requestId,
            messageTs: action.container.message_ts,
            channelId: action.container.channel_id,
          }),
          title: { type: 'plain_text', text: 'Decline Request' },
          submit: { type: 'plain_text', text: 'Decline' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: `*Decline ${request.staffName}'s compensation request?*` }
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Employee:*\n${request.staffName}` },
                { type: 'mrkdwn', text: `*Type:*\n${formatCompType(request.compensationType)}` },
                { type: 'mrkdwn', text: `*Date Worked:*\n${request.dateOfWork}` },
                {
                  type: 'mrkdwn',
                  text: `*Amount:*\n${request.compensationType === 'TimeInLieu' ? `${request.timeInLieuHours ?? 0} hours` : `${request.leaveDays ?? 0} days`}`
                },
              ]
            },
            { type: 'divider' },
            {
              type: 'input',
              block_id: 'rejection_reason',
              element: {
                type: 'plain_text_input',
                action_id: 'reason_input',
                multiline: true,
                placeholder: { type: 'plain_text', text: 'Please provide a reason for declining this request' }
              },
              label: { type: 'plain_text', text: 'Reason for Declining (required)' }
            }
          ]
        }
      })
    } catch (error) {
      console.error('[comp-approve] Error opening rejection modal:', error)
    }
  })

  // Supervisor approval confirmation modal submission
  app.view('supervisor_confirm_approval', async ({ ack, body, view, client }) => {
    try {
      await ack()

      const metadata = JSON.parse(view.private_metadata)
      const { requestId, messageTs, channelId } = metadata

      const request = await getRequestById(requestId)
      if (!request) {
        console.error('[comp-approve] Request not found:', requestId)
        return
      }

      const values = view.state.values
      const isTIL = request.compensationType === 'TimeInLieu'
      const approvedHours = isTIL ? parseFloat(values.approved_hours.hours_value.value || '0') : 0
      const approvedDays = !isTIL ? parseFloat(values.approved_days.days_value.value || '0') : 0
      const approvalNotes = values.approval_notes?.notes_input?.value || ''

      const quantityDisplay = isTIL ? `${approvedHours} hours` : `${approvedDays} days`
      console.log(`[comp-approve] Supervisor approved ${requestId} with ${quantityDisplay}`)

      // Update Google Sheets
      if (isTIL) {
        await updateRequestValues(requestId, { timeInLieuHours: approvedHours, status: 'Approved' })
      } else if (request.compensationType === 'Cash') {
        await updateRequestValues(requestId, { leaveDays: approvedDays, status: 'Supervisor Approved' })
      } else {
        // Leave type — also final at supervisor stage
        await updateRequestValues(requestId, { leaveDays: approvedDays, status: 'Approved' })
      }

      // Update supervisor's original message
      if (channelId && messageTs) {
        try {
          const statusLabel = request.compensationType === 'Cash' ? 'Pending HR Approval' : 'Approved (Final)'
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Request Approved',
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: 'Request Approved' } },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `You approved the compensation request from *${request.staffName}* for ${quantityDisplay}.${approvalNotes ? `\n\n*Your Notes:* ${approvalNotes}` : ''}`
                }
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                  { type: 'mrkdwn', text: `*Type:*\n${formatCompType(request.compensationType)}` },
                  { type: 'mrkdwn', text: `*Date Worked:*\n${request.dateOfWork}` },
                  { type: 'mrkdwn', text: `*Status:*\n${statusLabel}` },
                ]
              }
            ]
          })
        } catch (err) {
          console.error('[comp-approve] Error updating supervisor message:', err)
        }
      }

      // Handle by compensation type
      if (request.compensationType === 'Cash') {
        // Route to HR for final approval
        const hrEmail = HR_CONTACT_EMAILS[request.subsidiary] ?? HR_NOTIFICATION_EMAIL
        const hrName = HR_CONTACT_NAMES[request.subsidiary] ?? HR_NOTIFICATION_NAME
        try {
          const hrSlackUser = await client.users.lookupByEmail({ email: hrEmail })
          if (hrSlackUser.user?.id) {
            await client.chat.postMessage({
              channel: hrSlackUser.user.id,
              text: 'Cash Compensation Request - Action Required',
              blocks: [
                { type: 'header', text: { type: 'plain_text', text: 'Cash Compensation Request - Action Required' } },
                { type: 'divider' },
                {
                  type: 'section',
                  text: { type: 'mrkdwn', text: 'A cash compensation request has been approved by the supervisor and requires your approval to process payment.' }
                },
                {
                  type: 'section',
                  fields: [
                    { type: 'mrkdwn', text: `*Employee:*\n${request.staffName}` },
                    { type: 'mrkdwn', text: `*Email:*\n${request.staffEmail}` },
                    { type: 'mrkdwn', text: `*Subsidiary:*\n${getRegionDisplayName(request.subsidiary)}` },
                    { type: 'mrkdwn', text: `*Days:*\n${approvedDays} days` },
                    { type: 'mrkdwn', text: `*Date Worked:*\n${request.dateOfWork}` },
                    { type: 'mrkdwn', text: `*Supervisor:*\n${request.supervisorEmail}` },
                  ]
                },
                { type: 'section', text: { type: 'mrkdwn', text: `*Reason for Overtime:*\n> ${request.reason}` } },
                { type: 'divider' },
                {
                  type: 'actions',
                  block_id: 'hr_approval_actions',
                  elements: [
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'Approve' },
                      style: 'primary',
                      action_id: 'hr_approve_cash',
                      value: requestId,
                    },
                    {
                      type: 'button',
                      text: { type: 'plain_text', text: 'Reject and contact the staff' },
                      style: 'danger',
                      action_id: 'hr_reject_cash',
                      value: requestId,
                    },
                  ]
                }
              ]
            })
            console.log(`[comp-approve] Cash request forwarded to ${hrName} for final approval`)
          }
        } catch (err) {
          console.error('[comp-approve] Error forwarding to HR:', err)
        }
      } else if (isTIL) {
        // TIL: supervisor approval is final — credit DB balance
        const dbEmployee = await dbService.getUserByEmail(request.staffEmail)
        let credited = false
        if (dbEmployee) {
          credited = await dbService.addTILAdjustment(dbEmployee.id, dbEmployee.regionId, approvedHours)
          console.log(`[comp-approve] TIL DB credit for ${request.staffEmail}: ${approvedHours} hours — ${credited ? 'OK' : 'FAILED'}`)
          if (credited) {
            const year = new Date().getFullYear()
            const balances = await dbService.getUserBalances(dbEmployee.id, year)
            upsertEmployeeBalancesInSheet(dbEmployee.name, dbEmployee.email, dbEmployee.region.code, balances)
              .catch((e) => console.error('[comp-approve] Sheet balance upsert error (TIL):', e))
            logBalanceAdjustment({
              employeeName: dbEmployee.name,
              email: dbEmployee.email,
              regionCode: dbEmployee.region.code,
              leaveTypeName: 'Time In Lieu',
              adjustmentType: 'TIL Credit',
              days: parseFloat((approvedHours / 8).toFixed(4)),
              hours: approvedHours,
              referenceId: request.requestId,
            }).catch((e) => console.error('[comp-approve] Balance adjustment log error (TIL):', e))
          }
        } else {
          console.warn(`[comp-approve] Employee not found in DB for TIL credit: ${request.staffEmail}`)
        }

        // Notify employee
        const empSlackUser = await lookupSlackUserByEmail(client, request.staffEmail)
        if (empSlackUser?.id) {
          await client.chat.postMessage({
            channel: empSlackUser.id,
            text: 'Your Time In Lieu request has been approved!',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Request Approved*\n\nYour Time In Lieu request has been approved by your supervisor. ${credited ? `${approvedHours} hours have been added to your leave balance.` : 'Your hours will be added to your leave balance shortly.'}`
                }
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                  { type: 'mrkdwn', text: `*Hours Approved:*\n${approvedHours} hours` },
                ]
              }
            ]
          })
        }

        // Notify HR for record-keeping
        const hrRecipients = getHrRecipientsForSubsidiary(request.subsidiary)
        const tilBlocks = [
          { type: 'header', text: { type: 'plain_text', text: 'Time In Lieu Request Approved' } },
          { type: 'divider' },
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `A Time In Lieu request has been approved and ${credited ? 'hours added to the employee\'s balance' : 'please add hours manually'}. For your records.`
            }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Employee:*\n${request.staffName}` },
              { type: 'mrkdwn', text: `*Email:*\n${request.staffEmail}` },
              { type: 'mrkdwn', text: `*Subsidiary:*\n${getRegionDisplayName(request.subsidiary)}` },
              { type: 'mrkdwn', text: `*Hours Added:*\n${approvedHours} hours` },
              { type: 'mrkdwn', text: `*Date Worked:*\n${request.dateOfWork}` },
              { type: 'mrkdwn', text: `*Supervisor:*\n${request.supervisorEmail}` },
            ]
          },
          { type: 'section', text: { type: 'mrkdwn', text: `*Reason for Overtime:*\n> ${request.reason}` } },
        ]
        for (const recipient of hrRecipients) {
          const hrUser = await lookupSlackUserByEmail(client, recipient.email)
          if (hrUser?.id) {
            await client.chat.postMessage({
              channel: hrUser.id,
              text: 'Time In Lieu Request Approved',
              blocks: tilBlocks,
            }).catch((err) => console.error(`[comp-approve] Error notifying HR ${recipient.name}:`, err))
          }
        }
      } else {
        // Leave type: final at supervisor — credit COMP_LEAVE balance
        const dbEmployee = await dbService.getUserByEmail(request.staffEmail)
        let credited = false
        if (dbEmployee) {
          credited = await dbService.addCompLeaveAdjustment(dbEmployee.id, dbEmployee.regionId, approvedDays)
          console.log(`[comp-approve] COMP_LEAVE DB credit for ${request.staffEmail}: ${approvedDays} days — ${credited ? 'OK' : 'FAILED'}`)
          if (credited) {
            const year = new Date().getFullYear()
            const balances = await dbService.getUserBalances(dbEmployee.id, year)
            upsertEmployeeBalancesInSheet(dbEmployee.name, dbEmployee.email, dbEmployee.region.code, balances)
              .catch((e) => console.error('[comp-approve] Sheet balance upsert error (COMP_LEAVE):', e))
            logBalanceAdjustment({
              employeeName: dbEmployee.name,
              email: dbEmployee.email,
              regionCode: dbEmployee.region.code,
              leaveTypeName: 'Compensatory Leave',
              adjustmentType: 'Comp Credit',
              days: approvedDays,
              referenceId: request.requestId,
            }).catch((e) => console.error('[comp-approve] Balance adjustment log error (COMP_LEAVE):', e))
          }
        } else {
          console.warn(`[comp-approve] Employee not found in DB for COMP_LEAVE credit: ${request.staffEmail}`)
        }

        // Notify employee
        const empSlackUser = await lookupSlackUserByEmail(client, request.staffEmail)
        if (empSlackUser?.id) {
          await client.chat.postMessage({
            channel: empSlackUser.id,
            text: 'Your compensation leave request has been approved!',
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Request Approved*\n\nYour compensation leave request has been approved and ${credited ? `${approvedDays} days have been added to your Compensatory Leave balance.` : 'your days will be added to your leave balance shortly.'}`
                }
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                  { type: 'mrkdwn', text: `*Days Added:*\n${approvedDays}` },
                ]
              }
            ]
          })
        }

        // Notify HR for record-keeping
        const hrRecipients = getHrRecipientsForSubsidiary(request.subsidiary)
        const leaveBlocks = [
          { type: 'header', text: { type: 'plain_text', text: 'Leave Request Approved' } },
          { type: 'divider' },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: `A compensation leave request has been approved and the Compensatory Leave balance has been updated. For your records.` }
          },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Employee:*\n${request.staffName}` },
              { type: 'mrkdwn', text: `*Email:*\n${request.staffEmail}` },
              { type: 'mrkdwn', text: `*Subsidiary:*\n${request.subsidiary}` },
              { type: 'mrkdwn', text: `*Days Added:*\n${approvedDays} days` },
              { type: 'mrkdwn', text: `*Date Worked:*\n${request.dateOfWork}` },
              { type: 'mrkdwn', text: `*Supervisor:*\n${request.supervisorEmail}` },
            ]
          },
          { type: 'section', text: { type: 'mrkdwn', text: `*Reason for Overtime:*\n> ${request.reason}` } },
        ]
        for (const recipient of hrRecipients) {
          const hrUser = await lookupSlackUserByEmail(client, recipient.email)
          if (hrUser?.id) {
            await client.chat.postMessage({
              channel: hrUser.id,
              text: 'Leave Request Approved - For Your Records',
              blocks: leaveBlocks,
            }).catch((err) => console.error(`[comp-approve] Error notifying HR ${recipient.name}:`, err))
          }
        }
      }
    } catch (error) {
      console.error('[comp-approve] Error handling supervisor approval confirmation:', error)
    }
  })

  // Supervisor rejection modal submission
  app.view('supervisor_confirm_rejection', async ({ ack, body, view, client }) => {
    try {
      await ack()

      const metadata = JSON.parse(view.private_metadata)
      const { requestId, messageTs, channelId } = metadata

      const values = view.state.values
      const rejectionReason = values.rejection_reason?.reason_input?.value || 'No reason provided'

      const request = await getRequestById(requestId)
      if (!request) {
        console.error('[comp-approve] Request not found:', requestId)
        return
      }

      console.log(`[comp-approve] Supervisor declined ${requestId}. Reason: ${rejectionReason}`)
      await updateRequestValues(requestId, { status: 'Rejected' })

      // Update supervisor's message
      if (channelId && messageTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Request Declined',
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: 'Request Declined' } },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `You declined the compensation request from *${request.staffName}*.\n\n*Reason:* ${rejectionReason}`
                }
              },
              {
                type: 'section',
                fields: [
                  { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                  { type: 'mrkdwn', text: `*Type:*\n${formatCompType(request.compensationType)}` },
                ]
              }
            ]
          })
        } catch (err) {
          console.error('[comp-approve] Error updating supervisor message after rejection:', err)
        }
      }

      // Notify employee
      const empSlackUser = await lookupSlackUserByEmail(client, request.staffEmail)
      if (empSlackUser?.id) {
        await client.chat.postMessage({
          channel: empSlackUser.id,
          text: 'Your compensation request has been declined.',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Request Declined*\n\nYour ${formatCompType(request.compensationType)} request has been declined by your supervisor.\n\n*Reason:* ${rejectionReason}\n\nYou can submit a revised request using \`/comp-leave\` if needed.`
              }
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                { type: 'mrkdwn', text: `*Type:*\n${formatCompType(request.compensationType)}` },
              ]
            }
          ]
        })
      }
    } catch (error) {
      console.error('[comp-approve] Error handling supervisor rejection:', error)
    }
  })
}
