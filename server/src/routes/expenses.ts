import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import * as expenseService from '../services/expense.service'
import { uploadAttachment } from '../services/cloudinary.service'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

// CSV/XLSX upload (for expense batch import)
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

// Receipt/attachment upload (images and PDFs)
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(jpg|jpeg|png|gif|webp|pdf)$/i)) {
      cb(null, true)
    } else {
      cb(new Error('Only image files (JPG, PNG, GIF, WebP) or PDF are allowed'))
    }
  },
})

const listQuerySchema = z.object({
  status: z.string().optional(),
})

const manualItemSchema = z.object({
  employeeEmail: z.string().email(),
  category: z.string().optional(),
  amount: z.number().positive(),
  currency: z.string().max(3).optional(),
  expenseDate: z.string().optional(),
  description: z.string().optional(),
})

const manualExpenseSchema = z.object({
  items: z.array(manualItemSchema).min(1, 'At least one expense item is required'),
})

// ── POST /api/expenses/manual ─────────────────────────────────────────────
router.post('/manual', async (req, res, next) => {
  try {
    const parsed = manualExpenseSchema.parse(req.body)
    const isHr = ['hr_admin', 'super_admin'].includes(req.user!.role)
    if (!isHr) {
      const userEmail = req.user!.email
      const hasOtherEmails = parsed.items.some((i) => i.employeeEmail !== userEmail)
      if (hasOtherEmails) {
        return res.status(403).json({ success: false, error: 'You can only create expenses for your own email address' })
      }
    }
    const expense = await expenseService.createManualExpense(
      req.user!.userId,
      parsed.items
    )
    const full = await expenseService.getExpense(expense.id)
    const response: ApiResponse<typeof full> = { success: true, data: full }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
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

// ── POST /api/expenses/:id/attachments ────────────────────────────────────
router.post('/:id/attachments', attachmentUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file uploaded' })
    }
    const id = parseInt(req.params['id'] as string)
    const url = await uploadAttachment(req.file.buffer, req.file.originalname)
    const attachment = await expenseService.addAttachment(id, url, req.file.originalname)
    const response: ApiResponse<typeof attachment> = { success: true, data: attachment }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/expenses/:id/send-approval ──────────────────────────────────
router.post('/:id/send-approval', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.sendForApproval(id, req.user!.userId)
    const expense = await expenseService.getExpense(id)
    const response: ApiResponse<typeof expense> = { success: true, data: expense }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ── POST /api/expenses/send-bulk-approval ─────────────────────────────────
router.post('/send-bulk-approval', async (req, res, next) => {
  try {
    const submittedIds = await expenseService.sendBulkForApproval(req.user!.userId)
    const response: ApiResponse<{ submittedIds: number[]; count: number }> = {
      success: true,
      data: { submittedIds, count: submittedIds.length },
    }
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
