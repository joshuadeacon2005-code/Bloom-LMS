import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const { App } = _require('@slack/bolt') as typeof import('@slack/bolt')

import type { Application } from 'express'
import { validateEnv } from '../utils/env'
import { getOrCreateReceiver } from './receiver'
import { initializeSheet, syncEmployeeDirectory } from './google-sheets'
import { getAllActiveEmployees } from './db-service'
import { registerCompLeaveHandlers } from './handlers/comp-leave'
import { registerCompApproveHandlers } from './handlers/comp-approve'
import { registerCompHrHandlers } from './handlers/comp-hr'
import { registerLeaveApplyHandlers } from './handlers/leave-apply'
import { registerLeaveCommandHandlers } from './handlers/leave-commands'
import { registerExpenseApproveHandlers } from './handlers/expense-approve'

export async function initSlack(_expressApp: Application): Promise<void> {
  const env = validateEnv()

  if (!env.SLACK_BOT_TOKEN || !env.SLACK_SIGNING_SECRET) {
    console.log('[slack] Slack credentials not configured — bot skipped')
    return
  }

  const receiver = getOrCreateReceiver()
  if (!receiver) {
    console.log('[slack] Could not create Slack receiver — bot skipped')
    return
  }

  const boltApp = new App({
    token: env.SLACK_BOT_TOKEN,
    receiver,
  })

  // HTTP mode — no boltApp.start() needed; Express handles incoming requests
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
  registerExpenseApproveHandlers(boltApp)

  console.log('[slack] CompLeaveBot ready — all handlers registered')
}
