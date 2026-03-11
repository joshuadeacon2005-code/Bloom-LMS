import { WebClient } from '@slack/web-api'
import { validateEnv } from '../utils/env'

let _client: WebClient | null = null

export function getSlackWebClient(): WebClient | null {
  const env = validateEnv()
  if (!env.SLACK_BOT_TOKEN) return null
  if (!_client) _client = new WebClient(env.SLACK_BOT_TOKEN)
  return _client
}
