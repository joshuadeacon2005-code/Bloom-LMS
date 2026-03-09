import express, { type Request, type Response, type NextFunction } from 'express'
import cors from 'cors'
import path from 'path'
import { validateEnv } from './utils/env'
import { AppError } from './utils/errors'
import apiRouter from './routes/index'
import { initSlack } from './slack/index'
import { initJobs } from './jobs/index'
import type { ApiResponse } from './routes/types'

const env = validateEnv()

const app = express()

// Allow all origins for Slack webhook endpoint (server-to-server, no CORS restrictions needed)
app.use('/slack/events', cors())

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (origin === env.CLIENT_URL) return callback(null, true)
      if (origin.endsWith('.replit.dev') || origin.endsWith('.repl.co')) return callback(null, true)
      callback(new Error(`CORS: origin ${origin} not allowed`))
    },
    credentials: true,
  })
)

app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Routes
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

// Serve React static files in production (must come after all /api routes)
if (env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../../client/dist')
  app.use(express.static(clientDist))
  // SPA fallback
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

async function main() {
  // Initialize Slack bot (registers routes in production HTTP mode)
  await initSlack(app)

  // Start scheduled jobs
  initJobs(env.SLACK_BOT_TOKEN)

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
    const message = env.NODE_ENV === 'development' && err instanceof Error ? err.message : 'Internal server error'
    res.status(500).json({ success: false, error: message } satisfies ApiResponse)
  })

  app.listen(env.PORT, () => {
    console.log(`[server] Bloom & Grow LMS running on port ${env.PORT}`)
    console.log(`[server] Environment: ${env.NODE_ENV}`)
    console.log(`[server] Client URL: ${env.CLIENT_URL}`)
  })
}

main().catch((err) => {
  console.error('[server] Startup error:', err)
  process.exit(1)
})

export default app
