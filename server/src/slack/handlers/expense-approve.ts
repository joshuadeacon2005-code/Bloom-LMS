import type { App, BlockAction } from '@slack/bolt'
import * as expenseService from '../../services/expense.service'
import * as dbService from '../db-service'

// ---------------------------------------------------------------------------
// Register Slack button handlers for expense report approval / rejection
// (DMs sent by expense.service.ts use action_id values 'expense_report_approve'
// and 'expense_report_reject').
// ---------------------------------------------------------------------------

export function registerExpenseApproveHandlers(app: App) {
  app.action('expense_report_approve', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = (body as BlockAction).actions[0]
      const reportId = parseInt(('value' in action ? action.value : '') || '0')

      const slackUser = await dbService.getUserBySlackId(body.user.id)
      if (!slackUser) {
        await client.chat.postMessage({ channel: body.user.id, text: 'You are not linked to an LMS account — cannot approve.' })
        return
      }
      const actorId = slackUser.id
      const actorName = slackUser.name ?? ('username' in body.user ? body.user.username : body.user.id)

      const report = await expenseService.getReport(reportId)
      const isHr = ['hr_admin', 'super_admin'].includes(slackUser.role ?? '')
      const isMgr = await expenseService.isManagerOf(actorId, report.user?.id ?? null)
      if (!isHr && !isMgr) {
        await client.chat.postMessage({ channel: body.user.id, text: 'You do not have permission to approve this report.' })
        return
      }

      await expenseService.approveReport(reportId, actorId, actorName)

      // Update the original DM to reflect approval
      const messageTs = (body as BlockAction).container?.message_ts
      const channelId = (body as BlockAction).container?.channel_id
      if (messageTs && channelId) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Expense Report #${reportId} approved by ${actorName} — syncing to NetSuite`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Expense Report #${reportId} approved* by ${actorName}.\nSyncing to NetSuite now.`,
              },
            },
          ],
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[expense] approve error:', message)
      await client.chat.postMessage({
        channel: body.user.id,
        text: `Error approving expense report: ${message}`,
      })
    }
  })

  app.action('expense_report_reject', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = (body as BlockAction).actions[0]
      const reportId = parseInt(('value' in action ? action.value : '') || '0')

      const slackUser = await dbService.getUserBySlackId(body.user.id)
      if (!slackUser) {
        await client.chat.postMessage({ channel: body.user.id, text: 'You are not linked to an LMS account — cannot reject.' })
        return
      }
      const actorId = slackUser.id
      const actorName = slackUser.name ?? ('username' in body.user ? body.user.username : body.user.id)

      const report = await expenseService.getReport(reportId)
      const isHr = ['hr_admin', 'super_admin'].includes(slackUser.role ?? '')
      const isMgr = await expenseService.isManagerOf(actorId, report.user?.id ?? null)
      if (!isHr && !isMgr) {
        await client.chat.postMessage({ channel: body.user.id, text: 'You do not have permission to reject this report.' })
        return
      }

      await expenseService.rejectReport(reportId, actorId, actorName)

      const messageTs = (body as BlockAction).container?.message_ts
      const channelId = (body as BlockAction).container?.channel_id
      if (messageTs && channelId) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Expense Report #${reportId} rejected by ${actorName}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Expense Report #${reportId} rejected* by ${actorName}.`,
              },
            },
          ],
        })
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('[expense] reject error:', message)
      await client.chat.postMessage({
        channel: body.user.id,
        text: `Error rejecting expense report: ${message}`,
      })
    }
  })
}
