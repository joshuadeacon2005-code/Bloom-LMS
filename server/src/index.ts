import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import { validateEnv } from './utils/env'
import { AppError } from './utils/errors'
import apiRouter from './routes/index'
import { getOrCreateReceiver } from './slack/receiver'
import { initSlack } from './slack/index'
import { initJobs } from './jobs/index'
import { seedEmployees } from './db/seed-employees'
import { seedEntitlements } from './db/seed-entitlements'
import { seedRequests } from './db/seed-requests'
import { seedAdminUser } from './db/seed-admin'
import { seedBaseData } from './db/seed-base'
import { runMigrations } from './db/migrate'
import type { ApiResponse } from './routes/types'

const env = validateEnv()

const app = express()

// Allow all origins for Slack webhook endpoint (server-to-server)
app.use('/slack/events', cors())

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (origin === env.CLIENT_URL) return callback(null, true)
      if (origin.endsWith('.replit.dev') || origin.endsWith('.repl.co') || origin.endsWith('.replit.app')) return callback(null, true)
      if (origin === 'https://bloomleave.com' || origin === 'https://www.bloomleave.com') return callback(null, true)
      callback(null, false)
    },
    credentials: true,
  })
)

// Skip body parsing for /slack/events — Bolt handles its own raw body for signature verification
app.use((req, res, next) => {
  if (req.path === '/slack/events') return next()
  express.json()(req, res, next)
})
app.use((req, res, next) => {
  if (req.path === '/slack/events') return next()
  express.urlencoded({ extended: true })(req, res, next)
})

// API routes
app.use('/api', apiRouter)

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    },
  } satisfies ApiResponse)
})

// Mount the Slack receiver BEFORE the 404 handler so that
// Slack's URL verification challenge POST reaches Bolt and returns the challenge.
const slackReceiver = getOrCreateReceiver()
if (slackReceiver) {
  app.use(slackReceiver.router)
  console.log('[server] Slack receiver mounted at /slack/events')
}

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' } satisfies ApiResponse)
})

// Global error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) {
    const response: ApiResponse = { success: false, error: err.message }
    return res.status(err.statusCode).json(response)
  }

  console.error('[UnhandledError]', err)
  const message = err instanceof Error ? err.message : 'Internal server error'
  res.status(500).json({ success: false, error: message } satisfies ApiResponse)
})

app.listen(env.PORT, '0.0.0.0', () => {
  console.log(`[server] Bloom & Grow LMS running on port ${env.PORT}`)
  console.log(`[server] Environment: ${env.NODE_ENV}`)
  console.log(`[server] Client URL: ${env.CLIENT_URL}`)

  async function bootstrap() {
    await runMigrations()
    await seedBaseData()
    await seedEmployees()
    await seedAdminUser()
    await seedEntitlements()
    await seedRequests()
    if (env.NODE_ENV === 'production') {
      await initSlack(app)
      initJobs(env.SLACK_BOT_TOKEN)
    } else {
      console.log('[server] Skipping Slack and cron jobs in development')
    }
    console.log('[server] Bootstrap complete')
  }

  bootstrap().catch((err) => {
    console.error('[server] Bootstrap error:', err)
  })
})

export default app
