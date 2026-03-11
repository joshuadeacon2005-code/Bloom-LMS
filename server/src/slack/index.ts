import { App, ExpressReceiver } from '@slack/bolt'
import type { Application } from 'express'
import { validateEnv } from '../utils/env'
import { initializeSheet, syncEmployeeDirectory } from './google-sheets'
import { getAllActiveEmployees } from './db-service'
import { registerCompLeaveHandlers } from './handlers/comp-leave'
import { registerCompApproveHandlers } from './handlers/comp-approve'
import { registerCompHrHandlers } from './handlers/comp-hr'
import { registerLeaveApplyHandlers } from './handlers/leave-apply'
import { registerLeaveCommandHandlers } from './handlers/leave-commands'

export async function initSlack(expressApp: Application): Promise<void> {
  const env = validateEnv()

  if (!env.SLACK_BOT_TOKEN || !env.SLACK_SIGNING_SECRET) {
    console.log('[slack] Slack credentials not configured — bot skipped')
    return
  }

  // HTTP mode — Slack sends events to POST /slack/events
  const receiver = new ExpressReceiver({
    signingSecret: env.SLACK_SIGNING_SECRET,
    endpoints: '/slack/events',
  })

  // Mount Bolt's receiver router onto the existing Express app
  expressApp.use(receiver.router)

  const boltApp = new App({
    token: env.SLACK_BOT_TOKEN,
    receiver,
  })

  // In HTTP mode we don't call boltApp.start() — Express handles incoming requests
  console.log('[slack] HTTP mode — listening at POST /slack/events')

  await initializeSheet().catch(console.error)

  getAllActiveEmployees()
    .then((employees) => syncEmployeeDirectory(employees))
    .catch((e) => console.error('[slack] Employee directory sync error:', e))

  registerCompLeaveHandlers(boltApp)
  registerCompApproveHandlers(boltApp)
  registerCompHrHandlers(boltApp)
  registerLeaveApplyHandlers(boltApp)
  registerLeaveCommandHandlers(boltApp)

  console.log('[slack] CompLeaveBot ready — all handlers registered')
}
