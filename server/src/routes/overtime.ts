import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import * as overtimeService from '../services/overtime.service'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

// ── Schemas ──────────────────────────────────────────────────

const submitSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
  hoursWorked: z.number().positive().max(24),
  daysRequested: z.number().positive().max(5),
  reason: z.string().min(1).max(1000),
  compensationType: z.enum(['time_off', 'cash']).optional().default('time_off'),
  evidenceUrl: z.string().url().optional(),
})

const approveSchema = z.object({
  approvedDays: z.number().positive().max(5).optional(),
  comment: z.string().max(1000).optional(),
})

const rejectSchema = z.object({
  reason: z.string().min(1).max(1000),
})

const historySchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled', 'converted']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// ── Routes ────────────────────────────────────────────────────

// POST /api/overtime
router.post('/', validate(submitSchema), async (req, res, next) => {
  try {
    const entry = await overtimeService.submitOvertimeRequest(req.user!.userId, req.body)
    const response: ApiResponse<typeof entry> = { success: true, data: entry }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/overtime — history for current user
router.get('/', validate(historySchema, 'query'), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof historySchema>
    const result = await overtimeService.getMyOvertimeRequests(req.user!.userId, query)
    const response: ApiResponse<typeof result.data> = {
      success: true,
      data: result.data,
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/overtime/balance
router.get('/balance', async (req, res, next) => {
  try {
    const balance = await overtimeService.getOvertimeBalance(req.user!.userId)
    const response: ApiResponse<typeof balance> = { success: true, data: balance }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/overtime/pending — for manager/HR
router.get('/pending', async (req, res, next) => {
  try {
    const { role, userId } = req.user!
    const isManagerOrAbove = ['manager', 'hr_admin', 'super_admin'].includes(role)
    if (!isManagerOrAbove) {
      return res.status(403).json({ success: false, error: 'Forbidden' })
    }
    const entries = await overtimeService.getPendingOvertimeRequests(userId, role)
    const response: ApiResponse<typeof entries> = { success: true, data: entries }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/overtime/my — alias for GET / (for hook compatibility)
router.get('/my', validate(historySchema, 'query'), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof historySchema>
    const result = await overtimeService.getMyOvertimeRequests(req.user!.userId, query)
    const response: ApiResponse<typeof result.data> = {
      success: true,
      data: result.data,
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/overtime/:id/approve
router.post('/:id/approve', validate(approveSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const { approvedDays, comment } = req.body as z.infer<typeof approveSchema>
    const result = await overtimeService.approveOvertimeRequest(id, req.user!.userId, approvedDays, comment)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/overtime/:id/reject
router.post('/:id/reject', validate(rejectSchema), async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const result = await overtimeService.rejectOvertimeRequest(id, req.user!.userId, req.body.reason)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/overtime/:id/cancel
router.patch('/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params['id'] as string)
    const result = await overtimeService.cancelOvertimeRequest(id, req.user!.userId)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
