import { Router } from 'express'
import { z } from 'zod'
import { and, eq, gte, lte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { upload } from '../middleware/upload'
import * as leaveService from '../services/leave.service'
import { uploadAttachment } from '../services/cloudinary.service'
import { db } from '../db/index'
import { publicHolidays } from '../db/schema'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

const createLeaveSchema = z
  .object({
    leaveTypeId: z.number().int().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    reason: z.string().max(1000).optional(),
    attachmentUrl: z.string().url().optional(),
  })
  .refine((d) => d.startDate <= d.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })

const requestFiltersSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  userId: z.coerce.number().int().positive().optional(),
  leaveTypeId: z.coerce.number().int().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const teamCalendarSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  regionId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
})

// POST /api/leave/upload — upload attachment before submitting request
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'No file provided' })
    }
    const url = await uploadAttachment(req.file.buffer, req.file.originalname)
    const response: ApiResponse<{ url: string }> = { success: true, data: { url } }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/leave/requests
router.get('/requests', validate(requestFiltersSchema, 'query'), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof requestFiltersSchema>
    const result = await leaveService.getLeaveRequests({
      ...query,
      requestingUserId: req.user!.userId,
      requestingRole: req.user!.role,
    })
    const response: ApiResponse<typeof result.requests> = {
      success: true,
      data: result.requests,
      meta: { page: query.page, pageSize: query.pageSize, total: result.total },
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/leave/requests
router.post('/requests', validate(createLeaveSchema), async (req, res, next) => {
  try {
    const request = await leaveService.createLeaveRequest(req.user!.userId, req.body)
    const response: ApiResponse<typeof request> = { success: true, data: request }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/leave/requests/:id
router.get('/requests/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const request = await leaveService.getLeaveRequestById(id, req.user!.userId, req.user!.role)
    const response: ApiResponse<typeof request> = { success: true, data: request }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/leave/requests/:id/cancel
router.patch('/requests/:id/cancel', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const result = await leaveService.cancelLeaveRequest(id, req.user!.userId, req.user!.role)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/leave/types?regionId=1
router.get('/types', async (req, res, next) => {
  try {
    const regionId = req.query.regionId
      ? parseInt(req.query.regionId as string, 10)
      : req.user!.regionId
    const types = await leaveService.getLeaveTypesWithPolicies(regionId)
    const response: ApiResponse<typeof types> = { success: true, data: types }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/leave/calendar/team
router.get('/calendar/team', validate(teamCalendarSchema, 'query'), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof teamCalendarSchema>
    const absences = await leaveService.getTeamAbsences({
      startDate: query.startDate,
      endDate: query.endDate,
      regionId: query.regionId,
      departmentId: query.departmentId,
    })
    const response: ApiResponse<typeof absences> = { success: true, data: absences }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/leave/holidays?regionId=1&year=2026
router.get('/holidays', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear()

    const conditions = [
      gte(publicHolidays.date, `${year}-01-01`),
      lte(publicHolidays.date, `${year}-12-31`),
    ]
    if (regionId) conditions.push(eq(publicHolidays.regionId, regionId))

    const rows = await db
      .select()
      .from(publicHolidays)
      .where(and(...conditions))
      .orderBy(publicHolidays.date)

    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
