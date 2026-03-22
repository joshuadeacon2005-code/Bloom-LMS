import type { App, BlockAction } from '@slack/bolt'
import { WebClient } from '@slack/web-api'
import * as expenseService from '../../services/expense.service'
import * as dbService from '../db-service'

const EXPENSE_CHANNEL = process.env['SLACK_EXPENSE_CHANNEL'] || '#expense-approvals'

// ---------------------------------------------------------------------------
// Build the Slack approval message blocks for an expense
// ---------------------------------------------------------------------------

function buildApprovalBlocks(expense: {
  id: number
  filename: string
  status: string
  uploadedBy: { name: string; email: string }
  items: { amount: string; currency: string; employeeEmail: string }[]
}) {
  const totalAmount = expense.items.reduce((sum, i) => sum + parseFloat(i.amount || '0'), 0)
  const currency = expense.items[0]?.currency ?? 'HKD'
  const uniqueEmployees = [...new Set(expense.items.map((i) => i.employeeEmail))].join(', ')

  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: '💰 Expense Approval Request' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Submitted by:*\n${expense.uploadedBy.name}` },
        { type: 'mrkdwn', text: `*File:*\n${expense.filename}` },
        { type: 'mrkdwn', text: `*Total Amount:*\n${currency} ${totalAmount.toFixed(2)}` },
        { type: 'mrkdwn', text: `*Rows:*\n${expense.items.length}` },
        { type: 'mrkdwn', text: `*Employees:*\n${uniqueEmployees || '—'}` },
        { type: 'mrkdwn', text: `*Expense #:*\n${expense.id}` },
      ],
    },
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve' },
          style: 'primary',
          action_id: 'expense_approve',
          value: String(expense.id),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject' },
          style: 'danger',
          action_id: 'expense_reject',
          value: String(expense.id),
        },
      ],
    },
  ]
}

// ---------------------------------------------------------------------------
// Post approval message to the expense channel (called from the route)
// ---------------------------------------------------------------------------

export async function postExpenseApprovalMessage(expense: Parameters<typeof buildApprovalBlocks>[0]) {
  const botToken = process.env['SLACK_BOT_TOKEN']
  if (!botToken) throw new Error('SLACK_BOT_TOKEN not configured')

  const client = new WebClient(botToken)
  const result = await client.chat.postMessage({
    channel: EXPENSE_CHANNEL,
    text: `New expense submitted by ${expense.uploadedBy.name} — Expense #${expense.id}`,
    blocks: buildApprovalBlocks(expense),
  })

  return { ts: result.ts as string, channel: result.channel as string }
}

// ---------------------------------------------------------------------------
// Register Slack button handlers
// ---------------------------------------------------------------------------

export function registerExpenseApproveHandlers(app: App) {
  // Approve button
  app.action('expense_approve', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = (body as BlockAction).actions[0]
      const expenseId = parseInt(('value' in action ? action.value : '') || '0')

      const slackUser = await dbService.getUserBySlackId(body.user.id)
      const actorId = slackUser?.id ?? null
      const actorName = slackUser?.name ?? ('username' in body.user ? body.user.username : body.user.id)

      await expenseService.approveExpense(expenseId, actorId, actorName)

      // Update original Slack message to reflect approval
      const messageTs = (body as BlockAction).container?.message_ts
      const channelId = (body as BlockAction).container?.channel_id
      if (messageTs && channelId) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `✅ Expense #${expenseId} approved by ${actorName} — syncing to NetSuite`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Expense #${expenseId} approved* by ${actorName}.\nSyncing to NetSuite now…`,
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
        text: `Error approving expense: ${message}`,
      })
    }
  })

  // Reject button
  app.action('expense_reject', async ({ ack, body, client }) => {
    try {
      await ack()

      const action = (body as BlockAction).actions[0]
      const expenseId = parseInt(('value' in action ? action.value : '') || '0')

      const slackUser = await dbService.getUserBySlackId(body.user.id)
      const actorId = slackUser?.id ?? null
      const actorName = slackUser?.name ?? ('username' in body.user ? body.user.username : body.user.id)

      await expenseService.rejectExpense(expenseId, actorId, actorName)

      const messageTs = (body as BlockAction).container?.message_ts
      const channelId = (body as BlockAction).container?.channel_id
      if (messageTs && channelId) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `❌ Expense #${expenseId} rejected by ${actorName}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *Expense #${expenseId} rejected* by ${actorName}.`,
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
        text: `Error rejecting expense: ${message}`,
      })
    }
  })
}
