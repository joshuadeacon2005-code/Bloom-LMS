import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import * as expenseService from '../services/expense.service'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/csv', 'application/vnd.ms-excel', 'application/octet-stream',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
      cb(null, true)
    } else {
      cb(new Error('Only CSV/XLSX files are allowed'))
    }
  },
})

const listQuerySchema = z.object({
  status: z.string().optional(),
})

// ── POST /api/expenses/upload ──────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' })
    }
    const expense = await expenseService.uploadExpenses(
      req.user!.userId,
      req.file.originalname,
      req.file.buffer
    )
    const response: ApiResponse<typeof expense> = { success: true, data: expense }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/expenses ──────────────────────────────────────────────────────
router.get('/', validate(listQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { status } = req.query as z.infer<typeof listQuerySchema>
    const list = await expenseService.listExpenses(req.user!.userId, req.user!.role, status)
    const response: ApiResponse<typeof list> = { success: true, data: list }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ── GET /api/expenses/:id ──────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const expense = await expenseService.getExpense(id)
    const response: ApiResponse<typeof expense> = { success: true, data: expense }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/expenses/:id/send-approval ──────────────────────────────────
router.post('/:id/send-approval', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const result = await expenseService.sendForApproval(id, req.user!.userId)

    // If Slack is configured, post the approval message here so we have access
    // to the Slack web client via the bot token from env.
    if (!result.slackMessageTs && process.env['MOCK_EXTERNAL'] !== 'true') {
      const { postExpenseApprovalMessage } = await import('../slack/handlers/expense-approve')
      const expense = await expenseService.getExpense(id)
      const slackResult = await postExpenseApprovalMessage(expense).catch((e: Error) => {
        console.warn('[expense] Slack post failed:', e.message)
        return null
      })
      if (slackResult) {
        await expenseService.saveSlackMessage(id, slackResult.ts, slackResult.channel)
      }
    }

    const expense = await expenseService.getExpense(id)
    const response: ApiResponse<typeof expense> = { success: true, data: expense }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/expenses/:id/retry-sync ─────────────────────────────────────
router.post('/:id/retry-sync', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.retrySync(id, req.user!.userId)
    const expense = await expenseService.getExpense(id)
    const response: ApiResponse<typeof expense> = { success: true, data: expense }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/expenses/:id/resubmit ───────────────────────────────────────
router.post('/:id/resubmit', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.resubmitExpense(id, req.user!.userId)
    const expense = await expenseService.getExpense(id)
    const response: ApiResponse<typeof expense> = { success: true, data: expense }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
