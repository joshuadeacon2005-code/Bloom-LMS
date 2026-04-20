import { Router } from 'express'
import { z } from 'zod'
import { eq, and, isNull, desc, sql, inArray } from 'drizzle-orm'
import { isSlackCommandsEnabled, setSlackCommandsEnabled } from '../slack/settings'
import { db } from '../db/index'
import {
  regions,
  departments,
  leaveTypes,
  leavePolicies,
  leaveRequests,
  publicHolidays,
  users,
  leaveBalances,
  entitlementAuditLog,
  policyEntitlementTiers,
  policyTierAssignments,
  userAdditionalCalendars,
} from '../db/schema'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { NotFoundError } from '../utils/errors'
import { getSlackWebClient } from '../slack/client'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate, requireRole('hr_admin'))

async function syncPoliciesForLeaveType(leaveTypeId: number, regionRestriction: string | null | undefined) {
  const allRegions = await db.select({ id: regions.id, code: regions.code }).from(regions).where(eq(regions.isActive, true))
  const existingPolicies = await db
    .select({ id: leavePolicies.id, regionId: leavePolicies.regionId })
    .from(leavePolicies)
    .where(eq(leavePolicies.leaveTypeId, leaveTypeId))

  const allowedRegionIds = regionRestriction
    ? allRegions.filter((r) => regionRestriction.split(',').map((c) => c.trim()).filter(Boolean).includes(r.code)).map((r) => r.id)
    : allRegions.map((r) => r.id)

  const policiesToRemove = existingPolicies.filter((p) => !allowedRegionIds.includes(p.regionId))
  if (policiesToRemove.length > 0) {
    const removeIds = policiesToRemove.map((p) => p.id)
    await db.delete(policyTierAssignments).where(
      inArray(
        policyTierAssignments.tierId,
        db.select({ id: policyEntitlementTiers.id }).from(policyEntitlementTiers).where(inArray(policyEntitlementTiers.leavePolicyId, removeIds))
      )
    )
    await db.delete(policyEntitlementTiers).where(inArray(policyEntitlementTiers.leavePolicyId, removeIds))
    await db.delete(leavePolicies).where(inArray(leavePolicies.id, removeIds))
  }

  const existingRegionIds = existingPolicies.map((p) => p.regionId)
  const newRegionIds = allowedRegionIds.filter((rid) => !existingRegionIds.includes(rid))
  if (newRegionIds.length > 0) {
    await db.insert(leavePolicies).values(
      newRegionIds.map((regionId) => ({
        leaveTypeId: leaveTypeId,
        regionId,
        entitlementDays: '0.0',
        entitlementUnlimited: false,
        carryOverMax: '0',
        carryoverUnlimited: false,
        probationMonths: 0,
      }))
    ).onConflictDoNothing()
  }
}

// ============================================================
// Regions
// ============================================================

const createRegionSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(5).toUpperCase(),
  timezone: z.string().min(3).max(50),
  currency: z.string().length(3).toUpperCase(),
})

router.post('/regions', requireRole('super_admin'), validate(createRegionSchema), async (req, res, next) => {
  try {
    const [region] = await db.insert(regions).values(req.body).returning()
    const response: ApiResponse<typeof region> = { success: true, data: region }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.get('/regions', async (_req, res, next) => {
  try {
    const rows = await db.select().from(regions).where(eq(regions.isActive, true)).orderBy(regions.name)
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
  description: z.string().max(500).nullable().optional(),
  isPaid: z.boolean().default(true),
  requiresAttachment: z.boolean().default(false),
  maxDaysPerYear: z.number().int().positive().nullable().optional(),
  regionId: z.number().int().positive().nullable().optional(),
  regionRestriction: z.string().nullable().optional(),
  approvalFlow: z.enum(['standard', 'auto_approve', 'hr_required', 'multi_level']).default('standard'),
  maxConsecutiveDays: z.number().int().positive().nullable().optional(),
  dayCalculation: z.enum(['working_days', 'calendar_days']).default('working_days'),
  staffRestriction: z.string().nullable().optional(),
  minUnit: z.enum(['1_hour', '2_hours', 'half_day', '1_day']).optional().default('1_day'),
  unit: z.enum(['days', 'hours']).optional().default('days'),
  genderRestriction: z.enum(['male', 'female']).nullable().optional(),
})

router.get('/leave-types', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    let rows = await db
      .select()
      .from(leaveTypes)
      .orderBy(leaveTypes.name)

    if (regionId) {
      const [region] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, regionId)).limit(1)
      const regionCode = region?.code
      if (regionCode) {
        rows = rows.filter((lt) => {
          const legacyMatch = lt.regionId === null || lt.regionId === regionId
          if (!lt.regionRestriction) return legacyMatch
          const codes = lt.regionRestriction.split(',').map((c) => c.trim())
          return codes.includes(regionCode)
        })
      }
    }

    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.post('/leave-types', validate(createLeaveTypeSchema), async (req, res, next) => {
  try {
    // Insert the leave type first so it is committed before policies reference it
    const [lt] = await db.insert(leaveTypes).values(req.body).returning()
    if (req.body.regionRestriction) {
      await syncPoliciesForLeaveType(lt.id, req.body.regionRestriction)
    }
    const response: ApiResponse<typeof lt> = { success: true, data: lt }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.patch('/leave-types/:id', validate(createLeaveTypeSchema.partial()), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const result = await db.transaction(async (tx) => {
      const [lt] = await tx
        .update(leaveTypes)
        .set(req.body)
        .where(eq(leaveTypes.id, id))
        .returning()
      if (!lt) throw new NotFoundError('Leave type')

      if ('regionRestriction' in req.body) {
        await syncPoliciesForLeaveType(id, req.body.regionRestriction)
      }

      return lt
    })
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.delete('/leave-types/:id', requireRole('hr_admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    // Check for leave request references
    const [{ count: refCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(leaveRequests)
      .where(eq(leaveRequests.leaveTypeId, id))
    if (refCount > 0) {
      // Soft delete — preserve history
      await db.update(leaveTypes).set({ isActive: false }).where(eq(leaveTypes.id, id))
      res.json({ success: true, data: { deleted: false, deactivated: true, reason: 'Has existing leave requests — deactivated instead' } })
    } else {
      await db.delete(leavePolicies).where(eq(leavePolicies.leaveTypeId, id))
      await db.delete(leaveTypes).where(eq(leaveTypes.id, id))
      res.json({ success: true, data: { deleted: true, deactivated: false } })
    }
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
  entitlementUnlimited: z.boolean().default(false),
  carryOverMax: z.string().regex(/^\d+(\.\d)?$/).default('0'),
  carryoverUnlimited: z.boolean().default(false),
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

    const tierCounts = await db
      .select({
        policyId: policyEntitlementTiers.leavePolicyId,
        count: sql<number>`count(*)::int`,
      })
      .from(policyEntitlementTiers)
      .groupBy(policyEntitlementTiers.leavePolicyId)
    const tierCountMap = new Map(tierCounts.map((t) => [t.policyId, t.count]))

    const allLts = await db.select({ id: leaveTypes.id, unit: leaveTypes.unit }).from(leaveTypes)
    const unitMap = new Map(allLts.map((lt) => [lt.id, lt.unit]))

    let enriched = rows.map((r) => ({
      ...r,
      tierCount: tierCountMap.get(r.id) ?? 0,
      leaveTypeUnit: unitMap.get(r.leaveTypeId) ?? 'days',
    }))

    if (regionId) {
      const [region] = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, regionId)).limit(1)
      const regionCode = region?.code
      if (regionCode) {
        const allLeaveTypes = await db.select({ id: leaveTypes.id, regionRestriction: leaveTypes.regionRestriction }).from(leaveTypes)
        const ltMap = new Map(allLeaveTypes.map((lt) => [lt.id, lt.regionRestriction]))
        enriched = enriched.filter((p) => {
          const restriction = ltMap.get(p.leaveTypeId)
          if (!restriction) return true
          const codes = restriction.split(',').map((c) => c.trim())
          return codes.includes(regionCode)
        })
      }
    }

    const response: ApiResponse<typeof enriched> = { success: true, data: enriched }
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

router.delete('/policies/:id', requireRole('hr_admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    await db.delete(leavePolicies).where(eq(leavePolicies.id, id))
    res.json({ success: true, data: { deleted: true } })
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Policy Entitlement Tiers
// ============================================================

// GET /admin/policies/:id/tiers
router.get('/policies/:id/tiers', async (req, res, next) => {
  try {
    const policyId = parseInt(req.params.id as string, 10)
    const tiers = await db
      .select({
        tierId: policyEntitlementTiers.id,
        entitlementDays: policyEntitlementTiers.entitlementDays,
        label: policyEntitlementTiers.label,
        userId: policyTierAssignments.userId,
        userName: users.name,
        userRegionId: users.regionId,
      })
      .from(policyEntitlementTiers)
      .leftJoin(policyTierAssignments, eq(policyTierAssignments.tierId, policyEntitlementTiers.id))
      .leftJoin(users, eq(users.id, policyTierAssignments.userId))
      .leftJoin(regions, eq(regions.id, users.regionId))
      .where(eq(policyEntitlementTiers.leavePolicyId, policyId))
      .orderBy(policyEntitlementTiers.id)

    // Get region codes for user display
    const allRegions = await db.select({ id: regions.id, code: regions.code }).from(regions)
    const regionCodeMap: Record<number, string> = {}
    allRegions.forEach((r) => { regionCodeMap[r.id] = r.code })

    // Group by tier
    const tierMap = new Map<number, { id: number; entitlementDays: string; label: string | null; users: Array<{ id: number; name: string; regionCode: string }> }>()
    for (const row of tiers) {
      if (!tierMap.has(row.tierId)) {
        tierMap.set(row.tierId, { id: row.tierId, entitlementDays: row.entitlementDays, label: row.label, users: [] })
      }
      if (row.userId && row.userName) {
        tierMap.get(row.tierId)!.users.push({
          id: row.userId,
          name: row.userName,
          regionCode: row.userRegionId ? (regionCodeMap[row.userRegionId] ?? '') : '',
        })
      }
    }

    const response: ApiResponse<typeof Array.prototype> = { success: true, data: Array.from(tierMap.values()) }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

const tierSchema = z.object({
  entitlementDays: z.number().min(0).max(365),
  label: z.string().max(100).nullable().optional(),
  userIds: z.array(z.number().int().positive()).min(1, 'At least one staff member is required'),
})

// POST /admin/policies/:id/tiers
router.post('/policies/:id/tiers', validate(tierSchema), async (req, res, next) => {
  try {
    const policyId = parseInt(req.params.id as string, 10)
    const { entitlementDays, label, userIds } = req.body as z.infer<typeof tierSchema>

    const [tier] = await db
      .insert(policyEntitlementTiers)
      .values({ leavePolicyId: policyId, entitlementDays: entitlementDays.toFixed(1), label: label ?? null })
      .returning()

    if (userIds.length > 0) {
      await db.insert(policyTierAssignments).values(userIds.map((uid) => ({ tierId: tier.id, userId: uid })))
    }

    const response: ApiResponse<typeof tier> = { success: true, data: tier }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// PUT /admin/policies/:id/tiers/:tierId
router.put('/policies/:id/tiers/:tierId', validate(tierSchema), async (req, res, next) => {
  try {
    const tierId = parseInt(req.params.tierId as string, 10)
    const { entitlementDays, label, userIds } = req.body as z.infer<typeof tierSchema>

    const [tier] = await db
      .update(policyEntitlementTiers)
      .set({ entitlementDays: entitlementDays.toFixed(1), label: label ?? null })
      .where(eq(policyEntitlementTiers.id, tierId))
      .returning()

    if (!tier) throw new NotFoundError('Tier')

    // Replace assignments
    await db.delete(policyTierAssignments).where(eq(policyTierAssignments.tierId, tierId))
    if (userIds.length > 0) {
      await db.insert(policyTierAssignments).values(userIds.map((uid) => ({ tierId, userId: uid })))
    }

    const response: ApiResponse<typeof tier> = { success: true, data: tier }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// DELETE /admin/policies/:id/tiers/:tierId
router.delete('/policies/:id/tiers/:tierId', async (req, res, next) => {
  try {
    const tierId = parseInt(req.params.tierId as string, 10)
    await db.delete(policyEntitlementTiers).where(eq(policyEntitlementTiers.id, tierId))
    res.json({ success: true, data: { deleted: true } })
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
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  regionId: z.union([z.number().int().positive(), z.literal('CN')]),
  isRecurring: z.boolean().default(false),
  halfDay: z.enum(['AM', 'PM']).optional().nullable(),
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
    const body = req.body as { name: string; date: string; endDate?: string | null; regionId: number | 'CN'; isRecurring: boolean; halfDay?: string | null }

    const dates: string[] = []
    if (body.endDate && body.endDate > body.date) {
      const cur = new Date(body.date + 'T00:00:00Z')
      const end = new Date(body.endDate + 'T00:00:00Z')
      while (cur <= end) {
        dates.push(cur.toISOString().slice(0, 10))
        cur.setUTCDate(cur.getUTCDate() + 1)
      }
    } else {
      dates.push(body.date)
    }

    const insertForRegions = async (regionIds: { id: number; code: string }[]) => {
      const inserted: typeof publicHolidays.$inferSelect[] = []
      for (const dateStr of dates) {
        for (const region of regionIds) {
          const [existing] = await db
            .select({ id: publicHolidays.id })
            .from(publicHolidays)
            .where(and(eq(publicHolidays.regionId, region.id), eq(publicHolidays.date, dateStr), eq(publicHolidays.name, body.name)))
            .limit(1)
          if (existing) continue
          const [holiday] = await db
            .insert(publicHolidays)
            .values({ name: body.name, date: dateStr, regionId: region.id, isRecurring: body.isRecurring, halfDay: body.halfDay ?? null })
            .returning()
          inserted.push(holiday)
        }
      }
      return inserted
    }

    if (body.regionId === 'CN') {
      const cnRegions = await db
        .select({ id: regions.id, code: regions.code })
        .from(regions)
        .where(sql`${regions.code} IN ('CN-GZ', 'CN-SH')`)

      if (cnRegions.length === 0) {
        res.status(422).json({ success: false, error: 'China regions (CN-GZ, CN-SH) not found in database' })
        return
      }

      const inserted = await insertForRegions(cnRegions)
      if (inserted.length === 0) {
        res.status(409).json({ success: false, error: 'All holidays in this range already exist for China regions' })
        return
      }
      const response: ApiResponse<typeof inserted> = { success: true, data: inserted }
      res.status(201).json(response)
      return
    }

    const regionCode = await db.select({ code: regions.code }).from(regions).where(eq(regions.id, body.regionId as number)).limit(1)
    const inserted = await insertForRegions([{ id: body.regionId as number, code: regionCode[0]?.code ?? '' }])

    if (inserted.length === 0) {
      res.status(409).json({ success: false, error: 'All holidays in this range already exist for this region' })
      return
    }

    const response: ApiResponse<typeof inserted> = { success: true, data: inserted }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

router.delete('/holidays/:id', requireRole('hr_admin'), async (req, res, next) => {
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

router.get('/slack/status', requireRole('hr_admin'), async (_req, res, _next) => {
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

    const userId = parseInt(req.params.userId as string, 10)
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

router.post('/slack/commands-enabled', requireRole('hr_admin'), (req, res) => {
  const enabled = Boolean(req.body.enabled)
  setSlackCommandsEnabled(enabled)
  console.log(`[admin] Slack commands ${enabled ? 'enabled' : 'disabled'} by admin`)
  res.json({ success: true, data: { enabled } })
})

// ============================================================
// Entitlements
// ============================================================

// GET /admin/entitlements?regionId=&year=
router.get('/entitlements', async (req, res, next) => {
  try {
    const regionId = req.query.regionId ? parseInt(req.query.regionId as string, 10) : undefined
    const userId = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined
    const year = req.query.year ? parseInt(req.query.year as string, 10) : new Date().getFullYear()

    const rows = await db
      .select({
        balanceId: leaveBalances.id,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        regionId: users.regionId,
        leaveTypeId: leaveTypes.id,
        leaveTypeName: leaveTypes.name,
        leaveTypeCode: leaveTypes.code,
        leaveTypeUnit: leaveTypes.unit,
        year: leaveBalances.year,
        entitled: leaveBalances.entitled,
        used: leaveBalances.used,
        pending: leaveBalances.pending,
        carried: leaveBalances.carried,
        adjustments: leaveBalances.adjustments,
      })
      .from(leaveBalances)
      .innerJoin(users, eq(leaveBalances.userId, users.id))
      .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(
        and(
          eq(leaveBalances.year, year),
          ...(regionId ? [eq(users.regionId, regionId)] : []),
          ...(userId ? [eq(users.id, userId)] : []),
          isNull(users.deletedAt),
          eq(leaveTypes.isActive, true)
        )
      )
      .orderBy(users.name, leaveTypes.name)

    const policyRows = await db
      .select({
        regionId: leavePolicies.regionId,
        leaveTypeId: leavePolicies.leaveTypeId,
        entitlementDays: leavePolicies.entitlementDays,
        entitlementUnlimited: leavePolicies.entitlementUnlimited,
      })
      .from(leavePolicies)

    const policyMap = new Map<string, { entitlementDays: string; entitlementUnlimited: boolean | null }>()
    for (const p of policyRows) {
      policyMap.set(`${p.regionId}-${p.leaveTypeId}`, { entitlementDays: p.entitlementDays, entitlementUnlimited: p.entitlementUnlimited })
    }

    const enriched = rows.map((r) => {
      const policy = policyMap.get(`${r.regionId}-${r.leaveTypeId}`)
      return {
        ...r,
        policyDefault: policy?.entitlementUnlimited ? 'unlimited' : (policy?.entitlementDays ?? null),
      }
    })

    const response: ApiResponse<typeof enriched> = { success: true, data: enriched }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

const updateEntitlementSchema = z.object({
  leaveTypeId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2030),
  field: z.enum(['entitled', 'carried', 'adjustments']),
  // For adjustments field: can use delta (relative) instead of newValue (absolute)
  newValue: z.number().min(0).max(365).optional(),
  delta: z.number().min(-365).max(365).optional(),
  reason: z.string().min(1).max(500),
}).refine((d) => d.newValue !== undefined || d.delta !== undefined, {
  message: 'Either newValue or delta must be provided',
})

// PATCH /admin/entitlements/:userId
router.patch('/entitlements/:userId', validate(updateEntitlementSchema), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string, 10)
    const { leaveTypeId, year, field, newValue, delta, reason } = req.body as z.infer<typeof updateEntitlementSchema>
    const changedById = req.user!.userId

    const updated = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: leaveBalances.id, entitled: leaveBalances.entitled, carried: leaveBalances.carried, adjustments: leaveBalances.adjustments })
        .from(leaveBalances)
        .where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.leaveTypeId, leaveTypeId), eq(leaveBalances.year, year)))
        .limit(1)

      if (!existing) {
        await tx.insert(leaveBalances).values({
          userId,
          leaveTypeId,
          year,
          entitled: '0.0',
          used: '0.0',
          pending: '0.0',
          carried: '0.0',
          adjustments: '0.0',
        })
      }

      const oldValue = existing ? parseFloat(existing[field as keyof typeof existing] as string) : 0

      let resolvedNewValue: number
      if (field === 'adjustments' && delta !== undefined) {
        resolvedNewValue = oldValue + delta
      } else if (newValue !== undefined) {
        resolvedNewValue = newValue
      } else {
        throw new Error('newValue required for this field')
      }

      await tx
        .update(leaveBalances)
        .set({ [field]: resolvedNewValue.toFixed(1) })
        .where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.leaveTypeId, leaveTypeId), eq(leaveBalances.year, year)))

      await tx.insert(entitlementAuditLog).values({
        employeeId: userId,
        leaveTypeId,
        fieldChanged: field,
        oldValue: oldValue.toFixed(1),
        newValue: resolvedNewValue.toFixed(1),
        reason,
        changedById,
      })

      if (field === 'entitled') {
        const [targetUser] = await tx.select({ regionId: users.regionId, name: users.name }).from(users).where(eq(users.id, userId)).limit(1)
        if (targetUser?.regionId) {
          const [policy] = await tx
            .select({ id: leavePolicies.id, entitlementDays: leavePolicies.entitlementDays, entitlementUnlimited: leavePolicies.entitlementUnlimited })
            .from(leavePolicies)
            .where(and(eq(leavePolicies.regionId, targetUser.regionId), eq(leavePolicies.leaveTypeId, leaveTypeId)))
            .limit(1)

          if (policy) {
            const policyDefault = parseFloat(policy.entitlementDays)

            const existingAssignments = await tx
              .select({ tierId: policyTierAssignments.tierId })
              .from(policyTierAssignments)
              .innerJoin(policyEntitlementTiers, eq(policyEntitlementTiers.id, policyTierAssignments.tierId))
              .where(and(
                eq(policyTierAssignments.userId, userId),
                eq(policyEntitlementTiers.leavePolicyId, policy.id)
              ))

            for (const a of existingAssignments) {
              await tx.delete(policyTierAssignments).where(and(eq(policyTierAssignments.tierId, a.tierId), eq(policyTierAssignments.userId, userId)))
              const [remaining] = await tx.select({ count: sql<number>`count(*)` }).from(policyTierAssignments).where(eq(policyTierAssignments.tierId, a.tierId))
              if (remaining && Number(remaining.count) === 0) {
                await tx.delete(policyEntitlementTiers).where(eq(policyEntitlementTiers.id, a.tierId))
              }
            }

            if (Math.abs(resolvedNewValue - policyDefault) >= 0.01 && !policy.entitlementUnlimited) {
              const [existingTier] = await tx
                .select({ id: policyEntitlementTiers.id })
                .from(policyEntitlementTiers)
                .where(and(
                  eq(policyEntitlementTiers.leavePolicyId, policy.id),
                  eq(policyEntitlementTiers.entitlementDays, resolvedNewValue.toFixed(1))
                ))
                .limit(1)

              if (existingTier) {
                await tx.insert(policyTierAssignments).values({ tierId: existingTier.id, userId })
                  .onConflictDoNothing()
              } else {
                const tierLabel = `Custom — ${targetUser.name}`
                const [newTier] = await tx
                  .insert(policyEntitlementTiers)
                  .values({ leavePolicyId: policy.id, entitlementDays: resolvedNewValue.toFixed(1), label: tierLabel })
                  .returning()
                await tx.insert(policyTierAssignments).values({ tierId: newTier.id, userId })
              }
            }
          }
        }
      }

      const [result] = await tx
        .select()
        .from(leaveBalances)
        .where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.leaveTypeId, leaveTypeId), eq(leaveBalances.year, year)))
        .limit(1)

      return result
    })

    const response: ApiResponse<typeof updated> = { success: true, data: updated }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /admin/entitlements/bulk
const bulkUpdateSchema = z.object({
  updates: z.array(z.object({
    userId: z.number().int().positive(),
    leaveTypeId: z.number().int().positive(),
    year: z.number().int().min(2020).max(2030),
    field: z.enum(['entitled', 'carried', 'adjustments']),
    newValue: z.number().min(0).max(365),
  })).min(1).max(200),
  reason: z.string().min(1).max(500),
})

router.post('/entitlements/bulk', validate(bulkUpdateSchema), async (req, res, next) => {
  try {
    const { updates, reason } = req.body as z.infer<typeof bulkUpdateSchema>
    const changedById = req.user!.userId
    let count = 0

    for (const u of updates) {
      const [existing] = await db
        .select({ id: leaveBalances.id, entitled: leaveBalances.entitled, carried: leaveBalances.carried, adjustments: leaveBalances.adjustments })
        .from(leaveBalances)
        .where(and(eq(leaveBalances.userId, u.userId), eq(leaveBalances.leaveTypeId, u.leaveTypeId), eq(leaveBalances.year, u.year)))
        .limit(1)

      if (!existing) {
        await db.insert(leaveBalances).values({
          userId: u.userId,
          leaveTypeId: u.leaveTypeId,
          year: u.year,
          entitled: '0.0',
          used: '0.0',
          pending: '0.0',
          carried: '0.0',
          adjustments: '0.0',
        })
      }

      const oldValue = existing ? parseFloat(existing[u.field as keyof typeof existing] as string) : 0
      await db
        .update(leaveBalances)
        .set({ [u.field]: u.newValue.toFixed(1) })
        .where(and(eq(leaveBalances.userId, u.userId), eq(leaveBalances.leaveTypeId, u.leaveTypeId), eq(leaveBalances.year, u.year)))

      await db.insert(entitlementAuditLog).values({
        employeeId: u.userId,
        leaveTypeId: u.leaveTypeId,
        fieldChanged: u.field,
        oldValue: oldValue.toFixed(1),
        newValue: u.newValue.toFixed(1),
        reason,
        changedById,
      })
      count++
    }

    const response: ApiResponse<{ updated: number }> = { success: true, data: { updated: count } }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /admin/entitlements/audit?employeeId=&page=&pageSize=
router.get('/entitlements/audit', async (req, res, next) => {
  try {
    const employeeId = req.query.employeeId ? parseInt(req.query.employeeId as string, 10) : undefined
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1
    const pageSize = Math.min(req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : 50, 100)
    const offset = (page - 1) * pageSize

    const rows = await db
      .select({
        id: entitlementAuditLog.id,
        fieldChanged: entitlementAuditLog.fieldChanged,
        oldValue: entitlementAuditLog.oldValue,
        newValue: entitlementAuditLog.newValue,
        reason: entitlementAuditLog.reason,
        createdAt: entitlementAuditLog.createdAt,
        employeeId: entitlementAuditLog.employeeId,
        leaveTypeId: entitlementAuditLog.leaveTypeId,
        leaveTypeName: leaveTypes.name,
        changedById: entitlementAuditLog.changedById,
      })
      .from(entitlementAuditLog)
      .leftJoin(leaveTypes, eq(entitlementAuditLog.leaveTypeId, leaveTypes.id))
      .where(employeeId ? eq(entitlementAuditLog.employeeId, employeeId) : undefined)
      .orderBy(desc(entitlementAuditLog.createdAt))
      .limit(pageSize)
      .offset(offset)

    // Build id→name map from all users (small table)
    const userMap: Record<number, string> = {}
    const nameRows = await db.select({ id: users.id, name: users.name }).from(users)
    nameRows.forEach(u => { userMap[u.id] = u.name })

    const enriched = rows.map(r => ({
      ...r,
      employeeName: userMap[r.employeeId] ?? 'Unknown',
      changedByName: userMap[r.changedById] ?? 'Unknown',
    }))

    const response: ApiResponse<typeof enriched> = { success: true, data: enriched }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /admin/entitlements/revert/:auditLogId
router.post('/entitlements/revert/:auditLogId', async (req, res, next) => {
  try {
    const auditLogId = parseInt(req.params.auditLogId as string, 10)
    const changedById = req.user!.userId

    const [entry] = await db
      .select()
      .from(entitlementAuditLog)
      .where(eq(entitlementAuditLog.id, auditLogId))
      .limit(1)

    if (!entry) {
      res.status(404).json({ success: false, error: 'Audit log entry not found' })
      return
    }

    if (entry.oldValue === null) {
      res.status(400).json({ success: false, error: 'Cannot revert: no previous value recorded' })
      return
    }

    const field = entry.fieldChanged as 'entitled' | 'carried' | 'adjustments'
    const revertToValue = entry.oldValue

    await db
      .update(leaveBalances)
      .set({ [field]: revertToValue })
      .where(and(eq(leaveBalances.userId, entry.employeeId), eq(leaveBalances.leaveTypeId, entry.leaveTypeId), eq(leaveBalances.year, new Date().getFullYear())))

    await db.insert(entitlementAuditLog).values({
      employeeId: entry.employeeId,
      leaveTypeId: entry.leaveTypeId,
      fieldChanged: field,
      oldValue: entry.newValue,
      newValue: revertToValue,
      reason: `Reverted change #${auditLogId}`,
      changedById,
    })

    const response: ApiResponse<{ reverted: true }> = { success: true, data: { reverted: true } }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ============================================================
// Employee leave history (for admin view)
// ============================================================

// DELETE /api/admin/users/:userId/leave-requests/:requestId — HR Admin+
router.delete('/users/:userId/leave-requests/:requestId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string, 10)
    const requestId = parseInt(req.params.requestId as string, 10)

    const [request] = await db
      .select({
        id: leaveRequests.id,
        userId: leaveRequests.userId,
        leaveTypeId: leaveRequests.leaveTypeId,
        status: leaveRequests.status,
        totalDays: leaveRequests.totalDays,
        startDate: leaveRequests.startDate,
        deductsBalance: leaveTypes.deductsBalance,
      })
      .from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(eq(leaveRequests.id, requestId), eq(leaveRequests.userId, userId)))

    if (!request) throw new NotFoundError('Leave request not found')

    const year = parseInt(request.startDate.substring(0, 4), 10)
    const days = parseFloat(String(request.totalDays))

    // Restore balance for leave types that deduct balance
    if (request.deductsBalance && !isNaN(days) && days > 0) {
      const balanceWhere = and(
        eq(leaveBalances.userId, userId),
        eq(leaveBalances.leaveTypeId, request.leaveTypeId),
        eq(leaveBalances.year, year)
      )
      if (request.status === 'pending' || request.status === 'pending_hr') {
        await db.update(leaveBalances)
          .set({ pending: sql`GREATEST(0, ${leaveBalances.pending} - ${days.toFixed(1)}::numeric)` })
          .where(balanceWhere)
      } else if (request.status === 'approved') {
        await db.update(leaveBalances)
          .set({ used: sql`GREATEST(0, ${leaveBalances.used} - ${days.toFixed(1)}::numeric)` })
          .where(balanceWhere)
      }
    }

    // approval_workflows cascades on leave_request_id, so this also removes workflow rows
    await db.delete(leaveRequests).where(eq(leaveRequests.id, requestId))

    const response: ApiResponse = { success: true }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

router.get('/users/:id/leave-requests', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id as string, 10)
    const rows = await db
      .select({
        id: leaveRequests.id,
        leaveTypeName: leaveTypes.name,
        leaveTypeCode: leaveTypes.code,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
        halfDayPeriod: leaveRequests.halfDayPeriod,
        attachmentUrl: leaveRequests.attachmentUrl,
        createdAt: leaveRequests.createdAt,
      })
      .from(leaveRequests)
      .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(eq(leaveRequests.userId, userId))
      .orderBy(desc(leaveRequests.createdAt))

    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// ─── Additional Calendars ─────────────────────────────────────────────────────

router.get('/users/:userId/additional-calendars', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string, 10)
    const rows = await db
      .select({
        id: userAdditionalCalendars.id,
        regionId: userAdditionalCalendars.regionId,
        regionName: regions.name,
        regionCode: regions.code,
      })
      .from(userAdditionalCalendars)
      .leftJoin(regions, eq(userAdditionalCalendars.regionId, regions.id))
      .where(eq(userAdditionalCalendars.userId, userId))

    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

const updateAdditionalCalendarsSchema = z.object({
  regionIds: z.array(z.number().int().positive()).default([]),
})

router.put('/users/:userId/additional-calendars', validate(updateAdditionalCalendarsSchema), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string, 10)
    const { regionIds } = req.body as z.infer<typeof updateAdditionalCalendarsSchema>
    const uniqueIds = [...new Set(regionIds)]

    await db.transaction(async (tx) => {
      await tx.delete(userAdditionalCalendars).where(eq(userAdditionalCalendars.userId, userId))
      if (uniqueIds.length > 0) {
        await tx.insert(userAdditionalCalendars).values(
          uniqueIds.map(regionId => ({ userId, regionId }))
        )
      }
    })

    const rows = await db
      .select({
        id: userAdditionalCalendars.id,
        regionId: userAdditionalCalendars.regionId,
        regionName: regions.name,
        regionCode: regions.code,
      })
      .from(userAdditionalCalendars)
      .leftJoin(regions, eq(userAdditionalCalendars.regionId, regions.id))
      .where(eq(userAdditionalCalendars.userId, userId))

    const response: ApiResponse<typeof rows> = { success: true, data: rows }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
