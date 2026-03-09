import { Router } from 'express'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index'
import {
  regions,
  departments,
  leaveTypes,
  leavePolicies,
  publicHolidays,
} from '../db/schema'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { NotFoundError } from '../utils/errors'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate, requireRole('hr_admin'))

// ============================================================
// Regions (read-only for admin)
// ============================================================

router.get('/regions', async (_req, res, next) => {
  try {
    const rows = await db.select().from(regions).orderBy(regions.name)
    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Departments
// ============================================================

router.get('/departments', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    const rows = await db
      .select()
      .from(departments)
      .where(regionId ? eq(departments.regionId, regionId) : undefined)
      .orderBy(departments.name)
    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Leave Types
// ============================================================

const createLeaveTypeSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).toUpperCase(),
  description: z.string().max(500).optional(),
  isPaid: z.boolean().default(true),
  requiresAttachment: z.boolean().default(false),
  maxDaysPerYear: z.number().int().positive().optional(),
  regionId: z.number().int().positive().nullable().optional(),
})

router.get('/leave-types', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    const rows = await db
      .select()
      .from(leaveTypes)
      .where(regionId ? eq(leaveTypes.regionId, regionId) : undefined)
      .orderBy(leaveTypes.name)
    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.post('/leave-types', requireRole('super_admin'), validate(createLeaveTypeSchema), async (req, res, next) => {
  try {
    const [lt] = await db.insert(leaveTypes).values(req.body).returning()
    const response: ApiResponse<typeof lt> = { success: true, data: lt }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.patch('/leave-types/:id', requireRole('super_admin'), validate(createLeaveTypeSchema.partial()), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const [lt] = await db
      .update(leaveTypes)
      .set(req.body)
      .where(eq(leaveTypes.id, id))
      .returning()
    if (!lt) throw new NotFoundError('Leave type')
    const response: ApiResponse<typeof lt> = { success: true, data: lt }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Leave Policies
// ============================================================

const createPolicySchema = z.object({
  leaveTypeId: z.number().int().positive(),
  regionId: z.number().int().positive(),
  entitlementDays: z.string().regex(/^\d+(\.\d)?$/),
  carryOverMax: z.string().regex(/^\d+(\.\d)?$/).default('0'),
  accrualRate: z.string().regex(/^\d+(\.\d{1,4})?$/).nullable().optional(),
  probationMonths: z.number().int().min(0).default(0),
})

router.get('/policies', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    const rows = await db
      .select()
      .from(leavePolicies)
      .where(regionId ? eq(leavePolicies.regionId, regionId) : undefined)
    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.post('/policies', validate(createPolicySchema), async (req, res, next) => {
  try {
    const [policy] = await db.insert(leavePolicies).values(req.body).returning()
    const response: ApiResponse<typeof policy> = { success: true, data: policy }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.patch('/policies/:id', validate(createPolicySchema.partial()), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const [policy] = await db
      .update(leavePolicies)
      .set(req.body)
      .where(eq(leavePolicies.id, id))
      .returning()
    if (!policy) throw new NotFoundError('Policy')
    const response: ApiResponse<typeof policy> = { success: true, data: policy }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Public Holidays
// ============================================================

const createHolidaySchema = z.object({
  name: z.string().min(2).max(200),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  regionId: z.number().int().positive(),
  isRecurring: z.boolean().default(false),
})

router.get('/holidays', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined

    const conditions = []
    if (regionId) conditions.push(eq(publicHolidays.regionId, regionId))
    if (year) {
      const { gte, lte } = await import('drizzle-orm')
      conditions.push(gte(publicHolidays.date, `${year}-01-01`))
      conditions.push(lte(publicHolidays.date, `${year}-12-31`))
    }

    const rows = await db
      .select()
      .from(publicHolidays)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(publicHolidays.date)

    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.post('/holidays', validate(createHolidaySchema), async (req, res, next) => {
  try {
    const [holiday] = await db.insert(publicHolidays).values(req.body).returning()
    const response: ApiResponse<typeof holiday> = { success: true, data: holiday }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.delete('/holidays/:id', requireRole('super_admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const [deleted] = await db
      .delete(publicHolidays)
      .where(eq(publicHolidays.id, id))
      .returning({ id: publicHolidays.id })
    if (!deleted) throw new NotFoundError('Holiday')
    const response: ApiResponse = { success: true }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Notifications (user facing — available to all authenticated)
// ============================================================

export default router
