import type { App } from '@slack/bolt'
import * as dbService from '../db-service'
import * as leaveService from '../../services/leave.service'
import { openLeaveApplyModal } from './leave-apply'

const HELP_TEXT = `*Bloom LMS — Leave Commands*

• \`/leave apply\` — Submit a new leave request
• \`/leave balance\` — View your current leave balances
• \`/leave upcoming\` — See team absences in the next 30 days
• \`/leave status\` — View your recent leave requests
• \`/leave cancel <id>\` — Cancel a pending or approved leave request`

export function registerLeaveCommandHandlers(app: App) {
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
