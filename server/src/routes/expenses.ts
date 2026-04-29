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

// Receipt uploads (per line) — images and PDFs.
const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
    if (ok.includes(file.mimetype) || file.originalname.match(/\.(jpg|jpeg|png|gif|webp|pdf)$/i)) {
      cb(null, true)
    } else {
      cb(new Error('Receipts must be JPG, PNG, GIF, WebP, or PDF'))
    }
  },
})

// =============================================================================
// LINES — /api/expenses/lines
// =============================================================================

const lineCreateSchema = z.object({
  category: z.string().min(1, 'Category is required'),
  amount: z.number().positive(),
  currency: z.string().length(3),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  description: z.string().optional().nullable(),
})

const lineUpdateSchema = lineCreateSchema.partial()

const linesListSchema = z.object({
  status: z.enum(['draft', 'in_report']).optional(),
})

// GET /api/expenses/lines — my lines, optionally filtered
router.get('/lines', validate(linesListSchema, 'query'), async (req, res, next) => {
  try {
    const { status } = req.query as z.infer<typeof linesListSchema>
    const lines = await expenseService.listMyLines(req.user!.userId, status)
    const response: ApiResponse<typeof lines> = { success: true, data: lines }
    res.json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/lines — create a new draft line
router.post('/lines', async (req, res, next) => {
  try {
    const parsed = lineCreateSchema.parse(req.body)
    const line = await expenseService.createLine(req.user!.userId, parsed)
    const response: ApiResponse<typeof line> = { success: true, data: line }
    res.status(201).json(response)
  } catch (err) { next(err) }
})

// PATCH /api/expenses/lines/:id — edit a line (only allowed before sync)
router.patch('/lines/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const parsed = lineUpdateSchema.parse(req.body)
    const line = await expenseService.updateLine(req.user!.userId, id, parsed)
    const response: ApiResponse<typeof line> = { success: true, data: line }
    res.json(response)
  } catch (err) { next(err) }
})

// DELETE /api/expenses/lines/:id — delete a draft line
router.delete('/lines/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.deleteLine(req.user!.userId, id)
    res.json({ success: true })
  } catch (err) { next(err) }
})

// POST /api/expenses/lines/:id/receipt — attach a receipt
router.post('/lines/:id/receipt', receiptUpload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' })
    const id = parseInt(req.params['id'] as string)
    const url = await uploadAttachment(req.file.buffer, req.file.originalname)
    const line = await expenseService.attachReceipt(req.user!.userId, id, url, req.file.originalname)
    const response: ApiResponse<typeof line> = { success: true, data: line }
    res.status(201).json(response)
  } catch (err) { next(err) }
})

// =============================================================================
// REPORTS — /api/expenses/reports
// =============================================================================

const reportCreateSchema = z.object({
  lineIds: z.array(z.number().int().positive()).min(1, 'Select at least one line'),
  title: z.string().max(255).optional(),
})

const reportListSchema = z.object({
  status: z.string().optional(),
})

// GET /api/expenses/reports — list (mine + ones I can approve)
router.get('/reports', validate(reportListSchema, 'query'), async (req, res, next) => {
  try {
    const { status } = req.query as z.infer<typeof reportListSchema>
    const reports = await expenseService.listReports(req.user!.userId, req.user!.role, status)
    const response: ApiResponse<typeof reports> = { success: true, data: reports }
    res.json(response)
  } catch (err) { next(err) }
})

// GET /api/expenses/reports/:id
router.get('/reports/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const report = await expenseService.getReport(id)
    const response: ApiResponse<typeof report> = { success: true, data: report }
    res.json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/reports — create from selected line IDs
router.post('/reports', async (req, res, next) => {
  try {
    const parsed = reportCreateSchema.parse(req.body)
    const report = await expenseService.createReport(req.user!.userId, parsed.lineIds, parsed.title)
    const full = await expenseService.getReport(report.id)
    const response: ApiResponse<typeof full> = { success: true, data: full }
    res.status(201).json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/reports/:id/send-approval
router.post('/reports/:id/send-approval', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.sendForApproval(id, req.user!.userId)
    const report = await expenseService.getReport(id)
    const response: ApiResponse<typeof report> = { success: true, data: report }
    res.json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/reports/:id/approve
router.post('/reports/:id/approve', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const isHr = ['hr_admin', 'super_admin'].includes(req.user!.role)
    const report = await expenseService.getReport(id)
    const isMgr = await expenseService.isManagerOf(req.user!.userId, report.user?.id ?? null)
    if (!isHr && !isMgr) {
      return res.status(403).json({ success: false, error: 'Only managers or HR can approve expense reports' })
    }
    await expenseService.approveReport(id, req.user!.userId, req.user!.email ?? 'Unknown')
    const updated = await expenseService.getReport(id)
    const response: ApiResponse<typeof updated> = { success: true, data: updated }
    res.json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/reports/:id/reject
router.post('/reports/:id/reject', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const isHr = ['hr_admin', 'super_admin'].includes(req.user!.role)
    const report = await expenseService.getReport(id)
    const isMgr = await expenseService.isManagerOf(req.user!.userId, report.user?.id ?? null)
    if (!isHr && !isMgr) {
      return res.status(403).json({ success: false, error: 'Only managers or HR can reject expense reports' })
    }
    const note = (req.body?.note as string | undefined) ?? undefined
    await expenseService.rejectReport(id, req.user!.userId, req.user!.email ?? 'Unknown', note)
    const updated = await expenseService.getReport(id)
    const response: ApiResponse<typeof updated> = { success: true, data: updated }
    res.json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/reports/:id/resubmit
router.post('/reports/:id/resubmit', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.resubmitReport(id, req.user!.userId)
    const report = await expenseService.getReport(id)
    const response: ApiResponse<typeof report> = { success: true, data: report }
    res.json(response)
  } catch (err) { next(err) }
})

// POST /api/expenses/reports/:id/retry-sync
router.post('/reports/:id/retry-sync', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    await expenseService.retrySync(id, req.user!.userId)
    const report = await expenseService.getReport(id)
    const response: ApiResponse<typeof report> = { success: true, data: report }
    res.json(response)
  } catch (err) { next(err) }
})

// =============================================================================
// NetSuite passthrough — used by the form dropdowns
// =============================================================================

router.get('/netsuite/categories', async (_req, res, next) => {
  try {
    const cats = await expenseService.listNetSuiteCategories()
    const response: ApiResponse<typeof cats> = { success: true, data: cats }
    res.json(response)
  } catch (err) { next(err) }
})

router.get('/netsuite/currencies', async (_req, res, next) => {
  try {
    const cur = await expenseService.listNetSuiteCurrencies()
    const response: ApiResponse<typeof cur> = { success: true, data: cur }
    res.json(response)
  } catch (err) { next(err) }
})

export default router
