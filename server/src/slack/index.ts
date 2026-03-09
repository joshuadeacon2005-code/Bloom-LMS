import { App } from '@slack/bolt'
import type { Application } from 'express'
import { validateEnv } from '../utils/env'
import { initializeSheet, syncEmployeeDirectory } from './google-sheets'
import { getAllActiveEmployees } from './db-service'
import { registerCompLeaveHandlers } from './handlers/comp-leave'
import { registerCompApproveHandlers } from './handlers/comp-approve'
import { registerCompHrHandlers } from './handlers/comp-hr'
import { registerLeaveApplyHandlers } from './handlers/leave-apply'
import { registerLeaveCommandHandlers } from './handlers/leave-commands'

export async function initSlack(_expressApp: Application): Promise<void> {
  const env = validateEnv()

  if (!env.SLACK_BOT_TOKEN || !env.SLACK_SIGNING_SECRET) {
    console.log('[slack] Slack credentials not configured — bot skipped')
    return
  }

  if (!env.SLACK_APP_TOKEN) {
    console.log('[slack] SLACK_APP_TOKEN not set — Socket Mode skipped')
    return
  }

  const boltApp = new App({
    token: env.SLACK_BOT_TOKEN,
    signingSecret: env.SLACK_SIGNING_SECRET,
    socketMode: true,
    appToken: env.SLACK_APP_TOKEN,
  })

  try {
    await boltApp.start()
    console.log('[slack] Socket Mode connected')
  } catch (e) {
    console.error('[slack] Failed to start Slack bot:', e)
    return
  }

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
