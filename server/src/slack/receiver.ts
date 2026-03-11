// CJS import to get ExpressReceiver (not available as ESM named export)
import { createRequire } from 'module'
const _require = createRequire(import.meta.url)
const { ExpressReceiver } = _require('@slack/bolt') as typeof import('@slack/bolt')

import { validateEnv } from '../utils/env'

// Created once at startup so it can be mounted on Express BEFORE the SPA/404
// handlers, then reused in initSlack to register handlers.
let _receiver: InstanceType<typeof ExpressReceiver> | null = null

export function getOrCreateReceiver(): InstanceType<typeof ExpressReceiver> | null {
  const env = validateEnv()
  if (!env.SLACK_SIGNING_SECRET) return null

  if (!_receiver) {
    _receiver = new ExpressReceiver({
      signingSecret: env.SLACK_SIGNING_SECRET,
      endpoints: '/slack/events',
    })
  }
  return _receiver
}
