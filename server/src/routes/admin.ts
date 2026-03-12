import { Router } from 'express'
import { z } from 'zod'
import { eq, and, isNull } from 'drizzle-orm'
import { isSlackCommandsEnabled, setSlackCommandsEnabled } from '../slack/settings'
import { db } from '../db/index'
import {
  regions,
  departments,
  leaveTypes,
  leavePolicies,
  publicHolidays,
  users,
} from '../db/schema'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { NotFoundError } from '../utils/errors'
import { getSlackWebClient } from '../slack/client'
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
  approvalFlow: z.enum(['standard', 'auto_approve', 'hr_required', 'multi_level']).default('standard'),
  minNoticeDays: z.number().int().min(0).default(0),
  maxConsecutiveDays: z.number().int().positive().nullable().optional(),
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

router.post('/leave-types', validate(createLeaveTypeSchema), async (req, res, next) => {
  try {
    const [lt] = await db.insert(leaveTypes).values(req.body).returning()
    const response: ApiResponse<typeof lt> = { success: true, data: lt }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.patch('/leave-types/:id', validate(createLeaveTypeSchema.partial()), async (req, res, next) => {
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
// Slack: bot connection status
// ============================================================

router.get('/slack/status', requireRole('hr_admin'), async (_req, res, next) => {
  try {
    const slack = getSlackWebClient()
    if (!slack) {
      res.json({ success: true, data: { connected: false, reason: 'not_configured' } })
      return
    }
    const result = await slack.auth.test()
    res.json({
      success: true,
      data: {
        connected: true,
        botName: result.bot_id ? result.user : result.user,
        teamName: result.team,
        botId: result.bot_id,
      },
    })
  } catch (err: any) {
    res.json({
      success: true,
      data: { connected: false, reason: err?.data?.error ?? 'auth_failed' },
    })
  }
})

// ============================================================
// Slack: send test DM to a user
// ============================================================

router.post('/slack/test-dm/:userId', requireRole('hr_admin'), async (req, res, next) => {
  try {
    const slack = getSlackWebClient()
    if (!slack) {
      res.status(503).json({ success: false, error: 'Slack is not configured on this server' })
      return
    }

    const userId = parseInt(req.params.userId, 10)
    const [user] = await db
      .select({ id: users.id, name: users.name, slackUserId: users.slackUserId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' })
      return
    }
    if (!user.slackUserId) {
      res.status(400).json({ success: false, error: 'User has no Slack ID linked' })
      return
    }

    await slack.chat.postMessage({
      channel: user.slackUserId,
      text: `👋 Hi ${user.name}! This is a test message from the Bloom & Grow Leave Management System. Your Slack connection is working correctly.`,
    })

    res.json({ success: true, data: { sent: true } })
  } catch (err: any) {
    next(err)
  }
})

// ============================================================
// Slack: sync user IDs by email
// ============================================================

router.post('/slack/sync', requireRole('hr_admin'), async (_req, res, next) => {
  try {
    const slack = getSlackWebClient()
    if (!slack) {
      res.status(503).json({ success: false, error: 'Slack is not configured on this server' })
      return
    }

    // Fetch all active users that don't yet have a Slack ID
    const unlinked = await db
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(and(isNull(users.slackUserId), isNull(users.deletedAt), eq(users.isActive, true)))

    let synced = 0
    const notFound: string[] = []
    const errors: string[] = []

    for (const user of unlinked) {
      try {
        const result = await slack.users.lookupByEmail({ email: user.email })
        const slackId = result.user?.id
        if (!slackId) {
          notFound.push(user.email)
          continue
        }
        await db.update(users).set({ slackUserId: slackId }).where(eq(users.id, user.id))
        synced++
      } catch (err: any) {
        // users_not_found is Slack's error when email doesn't match anyone
        if (err?.data?.error === 'users_not_found') {
          notFound.push(user.email)
        } else {
          errors.push(`${user.email}: ${err?.message ?? 'unknown error'}`)
        }
      }
    }

    const response: ApiResponse<{ synced: number; notFound: string[]; errors: string[] }> = {
      success: true,
      data: { synced, notFound, errors },
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Slack: commands enabled toggle
// ============================================================

router.get('/slack/commands-enabled', requireRole('hr_admin'), (_req, res) => {
  res.json({ success: true, data: { enabled: isSlackCommandsEnabled() } })
})

router.post('/slack/commands-enabled', requireRole('super_admin'), (req, res) => {
  const enabled = Boolean(req.body.enabled)
  setSlackCommandsEnabled(enabled)
  console.log(`[admin] Slack commands ${enabled ? 'enabled' : 'disabled'} by admin`)
  res.json({ success: true, data: { enabled } })
})

export default router
