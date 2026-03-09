import type { App, BlockAction } from '@slack/bolt'
import { getRequestById, updateRequestStatus, upsertEmployeeBalancesInSheet, logBalanceAdjustment } from '../google-sheets'
import * as dbService from '../db-service'
import { formatCompType, lookupSlackUserByEmail } from './utils'

export function registerCompHrHandlers(app: App) {
  // HR approves Cash request (final)
  app.action('hr_approve_cash', async ({ ack, body, client }) => {
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

      // Atomic status update — only proceed if still "Supervisor Approved"
      const updated = await updateRequestStatus(requestId, 'Approved', 'Supervisor Approved')
      if (!updated) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'This request has already been processed and cannot be approved again.'
        })
        return
      }

      const cashDays = request.leaveDays ?? 0

      // Update HR's message
      await client.chat.update({
        channel: action.container.channel_id || '',
        ts: action.container.message_ts || '',
        text: 'Cash Request Approved',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Cash Request Approved*\n\nYou approved the cash compensation request from ${request.staffName} for ${cashDays} days. Please arrange in the next payroll.`
          }
        }]
      })

      // Notify employee
      const empUser = await lookupSlackUserByEmail(client, request.staffEmail)
      if (empUser?.id) {
        await client.chat.postMessage({
          channel: empUser.id,
          text: 'Your cash compensation request has been approved!',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Request Approved*\n\nYour cash compensation request has been approved by HR. The payment will be arranged in the next payroll for ${cashDays} days.`
              }
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                { type: 'mrkdwn', text: `*Days:*\n${cashDays}` },
              ]
            }
          ]
        })
      }
    } catch (error) {
      console.error('[comp-hr] Error handling HR cash approval:', error)
    }
  })

  // HR rejects Cash request
  app.action('hr_reject_cash', async ({ ack, body, client }) => {
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

      const updated = await updateRequestStatus(requestId, 'Rejected', 'Supervisor Approved')
      if (!updated) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'This request has already been processed and cannot be rejected again.'
        })
        return
      }

      await client.chat.update({
        channel: action.container.channel_id || '',
        ts: action.container.message_ts || '',
        text: 'Cash Request Rejected',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Cash Request Rejected*\n\nYou rejected the cash compensation request from ${request.staffName}.`
          }
        }]
      })

      const empUser = await lookupSlackUserByEmail(client, request.staffEmail)
      if (empUser?.id) {
        await client.chat.postMessage({
          channel: empUser.id,
          text: 'Your cash compensation request has been declined by HR.',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Your cash compensation request has been declined by HR. Please contact HR for more information.'
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
      console.error('[comp-hr] Error handling HR cash rejection:', error)
    }
  })

  // HR approves Time In Lieu (backup path — supervisor approval is normally final)
  app.action('hr_approve_timeinlieu', async ({ ack, body, client }) => {
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

      const updated = await updateRequestStatus(requestId, 'Approved', 'Supervisor Approved')
      if (!updated) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'This request has already been processed.'
        })
        return
      }

      const hoursToCredit = request.timeInLieuHours ?? 0
      const dbEmployee = await dbService.getUserByEmail(request.staffEmail)
      let credited = false
      if (dbEmployee) {
        credited = await dbService.addTILAdjustment(dbEmployee.id, dbEmployee.regionId, hoursToCredit)
        if (credited) {
          const year = new Date().getFullYear()
          const balances = await dbService.getUserBalances(dbEmployee.id, year)
          upsertEmployeeBalancesInSheet(dbEmployee.name, dbEmployee.email, dbEmployee.region.code, balances)
            .catch((e) => console.error('[comp-hr] Sheet balance upsert error (TIL HR):', e))
          logBalanceAdjustment({
            employeeName: dbEmployee.name,
            email: dbEmployee.email,
            regionCode: dbEmployee.region.code,
            leaveTypeName: 'Time In Lieu',
            adjustmentType: 'TIL Credit',
            days: parseFloat((hoursToCredit / 8).toFixed(4)),
            hours: hoursToCredit,
            referenceId: request.requestId,
          }).catch((e) => console.error('[comp-hr] Balance adjustment log error (TIL HR):', e))
        }
      }

      await client.chat.update({
        channel: action.container.channel_id || '',
        ts: action.container.message_ts || '',
        text: 'Time In Lieu Request Approved',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Time In Lieu Request Approved*\n\nYou approved the TIL request from ${request.staffName} for ${hoursToCredit} hours${credited ? ' and the hours have been added to their leave balance' : ' (Note: DB update failed — please add hours manually)'}.`
          }
        }]
      })

      const empUser = await lookupSlackUserByEmail(client, request.staffEmail)
      if (empUser?.id) {
        await client.chat.postMessage({
          channel: empUser.id,
          text: 'Your Time In Lieu request has been approved!',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Request Approved*\n\nYour Time In Lieu request has been approved by HR. ${credited ? `${hoursToCredit} hours have been added to your leave balance.` : 'Your hours will be added shortly.'}\n\n*Note:* Time In Lieu can carry over but cannot be cashed out.`
              }
            },
            {
              type: 'section',
              fields: [
                { type: 'mrkdwn', text: `*Request ID:*\n${request.requestId}` },
                { type: 'mrkdwn', text: `*Hours Approved:*\n${hoursToCredit} hours (${(hoursToCredit / 8).toFixed(2)} days)` },
              ]
            }
          ]
        })
      }
    } catch (error) {
      console.error('[comp-hr] Error handling HR TIL approval:', error)
    }
  })

  // HR rejects Time In Lieu (backup path)
  app.action('hr_reject_timeinlieu', async ({ ack, body, client }) => {
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

      const updated = await updateRequestStatus(requestId, 'Rejected', 'Supervisor Approved')
      if (!updated) {
        await client.chat.postMessage({
          channel: body.user.id,
          text: 'This request has already been processed and cannot be rejected again.'
        })
        return
      }

      await client.chat.update({
        channel: action.container.channel_id || '',
        ts: action.container.message_ts || '',
        text: 'Time In Lieu Request Rejected',
        blocks: [{
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Time In Lieu Request Rejected*\n\nYou rejected the TIL request from ${request.staffName}.`
          }
        }]
      })

      const empUser = await lookupSlackUserByEmail(client, request.staffEmail)
      if (empUser?.id) {
        await client.chat.postMessage({
          channel: empUser.id,
          text: 'Your Time In Lieu request has been declined by HR.',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Your Time In Lieu request has been declined by HR. Please contact HR for more information.'
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
      console.error('[comp-hr] Error handling HR TIL rejection:', error)
    }
  })
}
