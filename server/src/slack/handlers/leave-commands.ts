import type { App, BlockAction } from '@slack/bolt'
import * as dbService from '../db-service'
import * as leaveService from '../../services/leave.service'
import * as overtimeService from '../../services/overtime.service'
import { openLeaveApplyModal } from './leave-apply'

const HELP_TEXT = `*Bloom LMS — Leave Commands*

• \`/leave apply\` — Submit a new leave request
• \`/leave balance\` — View your current leave balances
• \`/leave upcoming\` — See team absences in the next 30 days
• \`/leave status\` — View your recent leave requests
• \`/leave cancel <id>\` — Cancel a pending or approved leave request

*Overtime Compensation:*
• \`/leave overtime\` — Request overtime compensation (adds days to annual leave when approved)
• \`/leave overtime balance\` — View pending/approved overtime requests
• \`/leave overtime status\` — View recent overtime requests`

export function registerLeaveCommandHandlers(app: App) {
  // ── Overtime: approve button ────────────────────────────────
  app.action('overtime_approve', async ({ ack, body, client }) => {
    try {
      await ack()
      const action = (body as BlockAction).actions[0]
      const entryId = parseInt(('value' in action ? action.value : '') || '0')
      const approverDbUser = await dbService.getUserBySlackId(body.user.id)
      if (!approverDbUser) {
        await client.chat.postMessage({ channel: body.user.id, text: 'Your account is not linked to Bloom LMS.' })
        return
      }
      try {
        await overtimeService.approveOvertimeRequest(entryId, approverDbUser.id)
        await client.chat.update({
          channel: (body as BlockAction).container.channel_id || '',
          ts: (body as BlockAction).container.message_ts || '',
          text: 'Overtime compensation approved.',
          blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `✅ You approved overtime compensation request #${entryId}. Days have been added to the employee's annual leave balance.` } }],
        })
      } catch (err: any) {
        await client.chat.postMessage({ channel: body.user.id, text: `Could not approve: ${err.message}` })
      }
    } catch (err) {
      console.error('[leave-commands] overtime_approve error:', err)
    }
  })

  // ── Overtime: reject button → reason modal ──────────────────
  app.action('overtime_reject', async ({ ack, body, client }) => {
    try {
      await ack()
      const action = (body as BlockAction).actions[0]
      const entryId = ('value' in action ? action.value : '') || ''
      await client.views.open({
        trigger_id: (body as any).trigger_id,
        view: {
          type: 'modal',
          callback_id: 'overtime_reject_modal',
          private_metadata: JSON.stringify({
            entryId,
            messageTs: (body as BlockAction).container.message_ts,
            channelId: (body as BlockAction).container.channel_id,
          }),
          title: { type: 'plain_text', text: 'Reject Overtime' },
          submit: { type: 'plain_text', text: 'Reject' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'rejection_reason',
              element: {
                type: 'plain_text_input',
                action_id: 'reason_input',
                multiline: true,
                placeholder: { type: 'plain_text', text: 'Reason for rejection (required)' },
              },
              label: { type: 'plain_text', text: 'Reason' },
            },
          ],
        },
      })
    } catch (err) {
      console.error('[leave-commands] overtime_reject error:', err)
    }
  })

  // ── Overtime: reject modal submission ──────────────────────
  app.view('overtime_reject_modal', async ({ ack, body, view, client }) => {
    await ack()
    try {
      const { entryId, messageTs, channelId } = JSON.parse(view.private_metadata)
      const reason = view.state.values.rejection_reason?.reason_input?.value || 'No reason provided'
      const approverDbUser = await dbService.getUserBySlackId(body.user.id)
      if (!approverDbUser) return
      try {
        await overtimeService.rejectOvertimeRequest(parseInt(entryId), approverDbUser.id, reason)
        if (channelId && messageTs) {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: 'Overtime compensation request declined.',
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `❌ You declined overtime compensation request #${entryId}.\n\n*Reason:* ${reason}` } }],
          })
        }
      } catch (err: any) {
        await client.chat.postMessage({ channel: body.user.id, text: `Could not reject: ${err.message}` })
      }
    } catch (err) {
      console.error('[leave-commands] overtime_reject_modal error:', err)
    }
  })

  // ── Overtime: submit modal submission ─────────────────────────
  app.view('overtime_log_modal', async ({ ack, body, view, client }) => {
    const values = view.state.values
    const date = values.ot_date?.ot_date_pick?.selected_date ?? ''
    const hoursStr = values.ot_hours?.ot_hours_input?.value ?? ''
    const daysStr = values.ot_days?.ot_days_select?.selected_option?.value ?? '1'
    const reason = values.ot_reason?.ot_reason_input?.value ?? ''

    const errors: Record<string, string> = {}
    if (!date) errors['ot_date'] = 'Please select a date.'
    const hours = parseFloat(hoursStr)
    if (!hoursStr || isNaN(hours) || hours <= 0) errors['ot_hours'] = 'Please enter valid hours.'

    if (Object.keys(errors).length > 0) {
      await ack({ response_action: 'errors', errors } as any)
      return
    }
    await ack()

    const slackUserId = body.user.id
    const dbUser = await dbService.getUserBySlackId(slackUserId)
    if (!dbUser) {
      await client.chat.postMessage({ channel: slackUserId, text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.' })
      return
    }

    const daysRequested = parseFloat(daysStr)

    try {
      const entry = await overtimeService.submitOvertimeRequest(dbUser.id, {
        date, hoursWorked: hours, daysRequested, reason
      })
      await client.chat.postMessage({
        channel: slackUserId,
        text: 'Overtime compensation request submitted!',
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: 'Overtime Compensation Submitted' } },
          { type: 'section', text: { type: 'mrkdwn', text: 'Your request has been submitted. Your manager has been notified for approval. When approved, the days will be added to your annual leave balance.' } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*Date:*\n${date}` },
              { type: 'mrkdwn', text: `*Hours Worked:*\n${hours}h` },
              { type: 'mrkdwn', text: `*Days Requested:*\n${daysRequested}d` },
              { type: 'mrkdwn', text: `*Reason:*\n${reason}` },
            ],
          },
        ],
      })

      // Send Slack DM to manager with approve/reject buttons
      if (dbUser.managerId) {
        const managerUser = await dbService.getUserById(dbUser.managerId)
        if (managerUser?.slackUserId) {
          await client.chat.postMessage({
            channel: managerUser.slackUserId,
            text: `Overtime compensation request from ${dbUser.name}`,
            blocks: [
              { type: 'header', text: { type: 'plain_text', text: 'Overtime Compensation Request' } },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*${dbUser.name}* has requested *${daysRequested} day(s)* compensation for *${hours}h overtime* on *${date}*.\n\n_"${reason}"_`,
                },
              },
              {
                type: 'actions',
                elements: [
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '✅ Approve' },
                    style: 'primary',
                    action_id: 'overtime_approve',
                    value: String(entry.id),
                  },
                  {
                    type: 'button',
                    text: { type: 'plain_text', text: '❌ Decline' },
                    style: 'danger',
                    action_id: 'overtime_reject',
                    value: String(entry.id),
                  },
                ],
              },
            ],
          })
        }
      }
    } catch (err: any) {
      await client.chat.postMessage({ channel: slackUserId, text: `Could not submit overtime request: ${err.message}` })
    }
  })


  app.command('/leave', async ({ command, ack, client }) => {
    await ack()

    const [subcommand, ...args] = command.text.trim().split(/\s+/)
    const slackUserId = command.user_id

    try {
      switch (subcommand?.toLowerCase()) {
        case 'apply':
          await handleApply(client, command.trigger_id, slackUserId)
          break

        case 'balance':
          await handleBalance(client, slackUserId)
          break

        case 'upcoming':
          await handleUpcoming(client, slackUserId)
          break

        case 'status':
          await handleStatus(client, slackUserId)
          break

        case 'cancel': {
          const idStr = args[0]
          const id = idStr ? parseInt(idStr, 10) : NaN
          await handleCancel(client, slackUserId, id)
          break
        }

        case 'overtime': {
          const subCmd = args[0]?.toLowerCase()
          if (subCmd === 'balance') {
            await handleOvertimeBalance(client, slackUserId)
          } else if (subCmd === 'status') {
            await handleOvertimeHistory(client, slackUserId)
          } else {
            // No subcommand — open the request modal
            await handleOvertimeLog(client, command.trigger_id, slackUserId)
          }
          break
        }

        default:
          await client.chat.postMessage({
            channel: slackUserId,
            text: HELP_TEXT,
          })
      }
    } catch (error) {
      console.error('[leave-commands] Unhandled error:', error)
      await client.chat.postMessage({
        channel: slackUserId,
        text: 'An unexpected error occurred. Please try again or contact HR.'
      })
    }
  })
}

async function handleApply(client: any, triggerId: string, slackUserId: string) {
  try {
    await openLeaveApplyModal(client, triggerId, slackUserId)
  } catch (err) {
    console.error('[leave-commands] Error opening apply modal:', err)
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Could not open the leave request form. Please try again.'
    })
  }
}

async function handleBalance(client: any, slackUserId: string) {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.'
    })
    return
  }

  const year = new Date().getFullYear()
  const balances = await dbService.getUserBalances(dbUser.id, year)

  if (balances.length === 0) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: `No leave balances found for ${year}. Contact HR if this seems incorrect.`
    })
    return
  }

  const rows = balances
    .map((b) => {
      const name = b.leaveType?.name ?? `Type #${b.leaveTypeId}`
      const isTIL = b.leaveType?.code === 'TIL'
      // TIL: display as hours (days × 8)
      if (isTIL) {
        const availHrs = (b.available * 8).toFixed(0)
        const usedHrs = (b.used * 8).toFixed(0)
        return `• *${name}:* ${availHrs}h available (${usedHrs}h used)`
      }
      return `• *${name}:* ${b.available.toFixed(1)} days available (${b.used.toFixed(1)} used)`
    })
    .join('\n')

  await client.chat.postMessage({
    channel: slackUserId,
    text: `Your ${year} leave balances`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `Your ${year} Leave Balances` } },
      { type: 'section', text: { type: 'mrkdwn', text: rows } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `_Use \`/leave apply\` to submit a new request_` }] },
    ]
  })
}

async function handleUpcoming(client: any, slackUserId: string) {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.'
    })
    return
  }

  const today = new Date()
  const startDate = today.toISOString().slice(0, 10)
  const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const absences = await leaveService.getTeamAbsences({
    startDate,
    endDate,
    regionId: dbUser.regionId,
  })

  if (absences.length === 0) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'No team absences in the next 30 days.'
    })
    return
  }

  const rows = absences
    .map((a) => {
      const name = a.user?.name ?? 'Unknown'
      const ltName = a.leaveType?.name ?? 'Leave'
      const statusLabel = a.status === 'approved' ? '' : ' _(pending)_'
      return `• *${name}* — ${ltName}: ${a.startDate} to ${a.endDate}${statusLabel}`
    })
    .join('\n')

  await client.chat.postMessage({
    channel: slackUserId,
    text: 'Upcoming team absences (next 30 days)',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Upcoming Team Absences (Next 30 Days)' } },
      { type: 'section', text: { type: 'mrkdwn', text: rows } },
    ]
  })
}

async function handleStatus(client: any, slackUserId: string) {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.'
    })
    return
  }

  const { requests } = await leaveService.getLeaveRequests({
    userId: dbUser.id,
    page: 1,
    pageSize: 5,
    requestingUserId: dbUser.id,
    requestingRole: dbUser.role,
  })

  if (requests.length === 0) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'You have no recent leave requests.'
    })
    return
  }

  const statusEmoji: Record<string, string> = {
    pending: 'Pending',
    approved: 'Approved',
    rejected: 'Rejected',
    cancelled: 'Cancelled',
  }

  const rows = requests
    .map((r) => {
      const ltName = r.leaveType?.name ?? 'Leave'
      const status = statusEmoji[r.status] ?? r.status
      return `• *#${r.id}* ${ltName}: ${r.startDate} to ${r.endDate} — ${status}`
    })
    .join('\n')

  await client.chat.postMessage({
    channel: slackUserId,
    text: 'Your recent leave requests',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Your Recent Leave Requests' } },
      { type: 'section', text: { type: 'mrkdwn', text: rows } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `_Use \`/leave cancel <id>\` to cancel a request_` }] },
    ]
  })
}

async function handleOvertimeLog(client: any, triggerId: string, slackUserId: string) {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({ channel: slackUserId, text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.' })
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: 'modal',
      callback_id: 'overtime_log_modal',
      title: { type: 'plain_text', text: 'Overtime Compensation' },
      submit: { type: 'plain_text', text: 'Submit Request' },
      close: { type: 'plain_text', text: 'Cancel' },
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: 'Request compensation for overtime worked. When approved by your manager, the days will be added to your annual leave balance.' },
        },
        {
          type: 'input',
          block_id: 'ot_date',
          element: { type: 'datepicker', action_id: 'ot_date_pick', initial_date: today, placeholder: { type: 'plain_text', text: 'Select date' } },
          label: { type: 'plain_text', text: 'Date Worked' },
        },
        {
          type: 'input',
          block_id: 'ot_hours',
          element: {
            type: 'number_input',
            action_id: 'ot_hours_input',
            is_decimal_allowed: true,
            min_value: '0.5',
            max_value: '24',
            placeholder: { type: 'plain_text', text: 'e.g. 3' },
          },
          label: { type: 'plain_text', text: 'Hours Worked' },
        },
        {
          type: 'input',
          block_id: 'ot_days',
          element: {
            type: 'static_select',
            action_id: 'ot_days_select',
            placeholder: { type: 'plain_text', text: 'Select days to claim' },
            options: [
              { text: { type: 'plain_text', text: '0.5 days (half day)' }, value: '0.5' },
              { text: { type: 'plain_text', text: '1 day (full day)' }, value: '1' },
            ],
            initial_option: { text: { type: 'plain_text', text: '1 day (full day)' }, value: '1' },
          },
          label: { type: 'plain_text', text: 'Compensation Days Requested' },
        },
        {
          type: 'input',
          block_id: 'ot_reason',
          element: {
            type: 'plain_text_input',
            action_id: 'ot_reason_input',
            multiline: true,
            placeholder: { type: 'plain_text', text: 'e.g. Client deadline, event support, project launch' },
          },
          label: { type: 'plain_text', text: 'Reason for Overtime' },
        },
      ],
    },
  })
}

async function handleOvertimeBalance(client: any, slackUserId: string) {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({ channel: slackUserId, text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.' })
    return
  }
  try {
    const balance = await overtimeService.getOvertimeBalance(dbUser.id)
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Your overtime compensation balance',
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: 'Overtime Compensation Balance' } },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*Approved Days:*\n${balance.approvedDays.toFixed(1)}d (added to annual leave)` },
            { type: 'mrkdwn', text: `*Pending Requests:*\n${balance.pendingCount} (${balance.pendingDays.toFixed(1)}d awaiting approval)` },
          ],
        },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '_Use `/leave overtime` to submit a new request_' }] },
      ],
    })
  } catch (err: any) {
    await client.chat.postMessage({ channel: slackUserId, text: `Error fetching balance: ${err.message}` })
  }
}

async function handleOvertimeHistory(client: any, slackUserId: string) {
  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({ channel: slackUserId, text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.' })
    return
  }
  const { data } = await overtimeService.getMyOvertimeRequests(dbUser.id, { page: 1, pageSize: 5 })
  if (data.length === 0) {
    await client.chat.postMessage({ channel: slackUserId, text: 'You have no overtime compensation requests yet. Use `/leave overtime` to submit one.' })
    return
  }
  const statusIcon: Record<string, string> = {
    pending: '⏳',
    approved: '✅',
    rejected: '❌',
    cancelled: '🚫',
  }
  const rows = data
    .map((e) => `${statusIcon[e.status] ?? ''} *${e.date}* — ${e.hoursWorked}h · ${e.daysRequested}d — ${e.reason.slice(0, 40)} _(${e.status})_`)
    .join('\n')
  await client.chat.postMessage({
    channel: slackUserId,
    text: 'Your recent overtime requests',
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Overtime Compensation Status (Last 5)' } },
      { type: 'section', text: { type: 'mrkdwn', text: rows } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: '_Use `/leave overtime` to submit a new request_' }] },
    ],
  })
}


async function handleCancel(client: any, slackUserId: string, requestId: number) {
  if (isNaN(requestId)) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Usage: `/leave cancel <request-id>`\nExample: `/leave cancel 42`'
    })
    return
  }

  const dbUser = await dbService.getUserBySlackId(slackUserId)
  if (!dbUser) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: 'Your Slack account is not linked to Bloom LMS. Please contact HR.'
    })
    return
  }

  try {
    await leaveService.cancelLeaveRequest(requestId, dbUser.id, dbUser.role)
    await client.chat.postMessage({
      channel: slackUserId,
      text: `Leave request #${requestId} has been cancelled successfully.`
    })
  } catch (err: any) {
    await client.chat.postMessage({
      channel: slackUserId,
      text: `Could not cancel request #${requestId}: ${err.message}`
    })
  }
}
