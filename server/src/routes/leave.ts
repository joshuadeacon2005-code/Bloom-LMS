import { Router } from 'express'
import { z } from 'zod'
import { and, eq, gte, lte } from 'drizzle-orm'
import { authenticate } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { upload } from '../middleware/upload'
import * as leaveService from '../services/leave.service'
import { uploadAttachment } from '../services/cloudinary.service'
import { db } from '../db/index'
import { publicHolidays, leaveTypes } from '../db/schema'
import { calculateWorkingDays, parseDate, formatDate } from '../utils/workingDays'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

const createLeaveSchema = z
  .object({
    leaveTypeId: z.number().int().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'),
    halfDayPeriod: z.enum(['AM', 'PM']).optional().nullable(),
    reason: z.string().max(1000).optional(),
    attachmentUrl: z.string().url().optional(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
    endTime: z.string().regex(/^\d{2}:\d{2}$/).optional().nullable(),
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

// GET /api/leave/calculate-days?startDate=&endDate=&leaveTypeId=&halfDayPeriod=&regionId=
const calculateDaysSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leaveTypeId: z.coerce.number().int().positive(),
  halfDayPeriod: z.enum(['AM', 'PM']).optional(),
  regionId: z.coerce.number().int().positive().optional(),
})

router.get('/calculate-days', validate(calculateDaysSchema, 'query'), async (req, res, next) => {
  try {
    const query = req.query as unknown as z.infer<typeof calculateDaysSchema>
    const { startDate, endDate, leaveTypeId, halfDayPeriod } = query

    // Determine region: from query or from user's own region
    const regionId = query.regionId ?? req.user!.regionId

    // Fetch leave type to get dayCalculation setting
    const [leaveType] = await db
      .select({ dayCalculation: leaveTypes.dayCalculation })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, leaveTypeId))
      .limit(1)

    if (!leaveType) {
      res.status(404).json({ success: false, error: 'Leave type not found' })
      return
    }

    // Fetch public holidays in the range for the user's region
    const holidayRows = await db
      .select({ date: publicHolidays.date })
      .from(publicHolidays)
      .where(
        and(
          eq(publicHolidays.regionId, regionId),
          gte(publicHolidays.date, startDate),
          lte(publicHolidays.date, endDate)
        )
      )
    const holidaySet = new Set(holidayRows.map((h) => h.date))

    // Calendar days (raw)
    const start = parseDate(startDate)
    const end = parseDate(endDate)
    const calendarDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1

    // Count weekend days in range
    let weekendDays = 0
    const cur = new Date(start)
    while (cur <= end) {
      const dow = cur.getUTCDay()
      if (dow === 0 || dow === 6) weekendDays++
      cur.setUTCDate(cur.getUTCDate() + 1)
    }

    const publicHolidayCount = holidaySet.size

    let totalDays: number
    const excludedDates: string[] = []

    if (leaveType.dayCalculation === 'calendar_days') {
      totalDays = calendarDays
    } else {
      // Working days — collect excluded dates for display
      const checkCur = new Date(start)
      while (checkCur <= end) {
        const dow = checkCur.getUTCDay()
        const ds = formatDate(checkCur)
        if (dow === 0 || dow === 6) {
          const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
          excludedDates.push(`${ds} (${dayNames[dow]})`)
        } else if (holidaySet.has(ds)) {
          excludedDates.push(`${ds} (holiday)`)
        }
        checkCur.setUTCDate(checkCur.getUTCDate() + 1)
      }
      totalDays = calculateWorkingDays(startDate, endDate, holidaySet)
    }

    // Half-day overrides
    if (halfDayPeriod && startDate === endDate) {
      // Single-day half-day
      totalDays = 0.5
    } else if (halfDayPeriod && startDate !== endDate && totalDays >= 1) {
      // Multi-day with a half-day on first or last day (1.5-day style)
      totalDays = totalDays - 0.5
    }

    const data = {
      totalDays,
      breakdown: {
        calendarDays,
        weekendDays,
        publicHolidays: publicHolidayCount,
        workingDays: leaveType.dayCalculation === 'calendar_days' ? calendarDays : (calendarDays - weekendDays - publicHolidayCount),
      },
      excludedDates,
    }

    const response: ApiResponse<typeof data> = { success: true, data }
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
