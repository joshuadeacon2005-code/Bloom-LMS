import { eq, and, sql } from 'drizzle-orm'
import { db } from '../db/index'
import { leaveBalances, leavePolicies, leaveTypes, users, policyEntitlementTiers, policyTierAssignments } from '../db/schema'
import { parseDecimal } from '../utils/workingDays'
import { AppError } from '../utils/errors'

// ============================================================
// Types
// ============================================================

export interface BalanceWithAvailable {
  id: number
  userId: number
  leaveTypeId: number
  year: number
  entitled: number
  used: number
  pending: number
  carried: number
  adjustments: number
  available: number
  leaveType?: {
    id: number
    name: string
    code: string
    isPaid: boolean
    deductsBalance: boolean
  }
}

// ============================================================
// Helpers
// ============================================================

function toBalance(row: {
  id: number
  userId: number
  leaveTypeId: number
  year: number
  entitled: string
  used: string
  pending: string
  carried: string
  adjustments: string
  leaveType?: { id: number; name: string; code: string; isPaid: boolean; deductsBalance: boolean } | null
}): BalanceWithAvailable {
  const entitled = parseDecimal(row.entitled)
  const used = parseDecimal(row.used)
  const pending = parseDecimal(row.pending)
  const carried = parseDecimal(row.carried)
  const adjustments = parseDecimal(row.adjustments)
  return {
    id: row.id,
    userId: row.userId,
    leaveTypeId: row.leaveTypeId,
    year: row.year,
    entitled,
    used,
    pending,
    carried,
    adjustments,
    available: Math.max(0, entitled + carried + adjustments - used - pending),
    leaveType: row.leaveType ?? undefined,
  }
}

// ============================================================
// Public API
// ============================================================

export async function getBalancesForUser(
  userId: number,
  year: number
): Promise<BalanceWithAvailable[]> {
  const rows = await db
    .select({
      id: leaveBalances.id,
      userId: leaveBalances.userId,
      leaveTypeId: leaveBalances.leaveTypeId,
      year: leaveBalances.year,
      entitled: leaveBalances.entitled,
      used: leaveBalances.used,
      pending: leaveBalances.pending,
      carried: leaveBalances.carried,
      adjustments: leaveBalances.adjustments,
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
        isPaid: leaveTypes.isPaid,
        deductsBalance: leaveTypes.deductsBalance,
      },
    })
    .from(leaveBalances)
    .leftJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
    .where(and(eq(leaveBalances.userId, userId), eq(leaveBalances.year, year)))
    .orderBy(leaveTypes.name)

  return rows.map(toBalance)
}

export async function getBalance(
  userId: number,
  leaveTypeId: number,
  year: number
): Promise<BalanceWithAvailable | null> {
  const [row] = await db
    .select({
      id: leaveBalances.id,
      userId: leaveBalances.userId,
      leaveTypeId: leaveBalances.leaveTypeId,
      year: leaveBalances.year,
      entitled: leaveBalances.entitled,
      used: leaveBalances.used,
      pending: leaveBalances.pending,
      carried: leaveBalances.carried,
      adjustments: leaveBalances.adjustments,
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
        isPaid: leaveTypes.isPaid,
        deductsBalance: leaveTypes.deductsBalance,
      },
    })
    .from(leaveBalances)
    .leftJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
    .where(
      and(
        eq(leaveBalances.userId, userId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year)
      )
    )
    .limit(1)

  return row ? toBalance(row) : null
}

/**
 * Find an existing balance or create one from the leave policy.
 * Handles probation checks and pro-rata entitlement for new starters.
 */
export async function getOrCreateBalance(
  userId: number,
  leaveTypeId: number,
  year: number,
  regionId: number
): Promise<BalanceWithAvailable> {
  const existing = await getBalance(userId, leaveTypeId, year)
  if (existing) return existing

  // Fetch policy
  const [policy] = await db
    .select()
    .from(leavePolicies)
    .where(
      and(eq(leavePolicies.leaveTypeId, leaveTypeId), eq(leavePolicies.regionId, regionId))
    )
    .limit(1)

  if (!policy) {
    const [lt] = await db
      .select({ name: leaveTypes.name })
      .from(leaveTypes)
      .where(eq(leaveTypes.id, leaveTypeId))
      .limit(1)
    throw new AppError(
      422,
      `No leave policy for "${lt?.name ?? 'this leave type'}" in your region`
    )
  }

  // Note: probation is no longer blocking — it's handled as a warning in the approval notification.

  // Check if user has a tier assignment for this policy (tier entitlement overrides policy default)
  const [tierAssignment] = await db
    .select({ entitlementDays: policyEntitlementTiers.entitlementDays })
    .from(policyTierAssignments)
    .innerJoin(policyEntitlementTiers, eq(policyTierAssignments.tierId, policyEntitlementTiers.id))
    .where(and(eq(policyTierAssignments.userId, userId), eq(policyEntitlementTiers.leavePolicyId, policy.id)))
    .limit(1)

  // Pro-rata entitlement for the current year
  let entitlement = tierAssignment
    ? parseDecimal(tierAssignment.entitlementDays)
    : parseDecimal(policy.entitlementDays)
  if (policy.accrualRate !== null) {
    // If the user joined mid-year, pro-rate based on remaining months in the year
    const [user] = await db
      .select({ createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (user) {
      const joinDate = new Date(user.createdAt)
      const yearStart = new Date(Date.UTC(year, 0, 1))
      if (joinDate > yearStart) {
        const monthsRemaining = 12 - joinDate.getUTCMonth()
        const accrualRate = parseDecimal(policy.accrualRate)
        entitlement = Math.round(monthsRemaining * accrualRate * 2) / 2 // round to nearest 0.5
      }
    }
  }

  const [created] = await db
    .insert(leaveBalances)
    .values({
      userId,
      leaveTypeId,
      year,
      entitled: entitlement.toFixed(1),
      used: '0.0',
      pending: '0.0',
      carried: '0.0',
      adjustments: '0.0',
    })
    .returning({
      id: leaveBalances.id,
      userId: leaveBalances.userId,
      leaveTypeId: leaveBalances.leaveTypeId,
      year: leaveBalances.year,
      entitled: leaveBalances.entitled,
      used: leaveBalances.used,
      pending: leaveBalances.pending,
      carried: leaveBalances.carried,
      adjustments: leaveBalances.adjustments,
    })

  if (!created) throw new AppError(500, 'Failed to initialise leave balance')

  return toBalance({ ...created, leaveType: null })
}

/** Increase the pending counter when a request is submitted. */
export async function addPending(
  userId: number,
  leaveTypeId: number,
  year: number,
  days: number
) {
  await db
    .update(leaveBalances)
    .set({
      pending: sql`${leaveBalances.pending} + ${days.toFixed(1)}::numeric`,
    })
    .where(
      and(
        eq(leaveBalances.userId, userId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year)
      )
    )
}

/** Release pending when a request is rejected or cancelled. */
export async function releasePending(
  userId: number,
  leaveTypeId: number,
  year: number,
  days: number
) {
  await db
    .update(leaveBalances)
    .set({
      pending: sql`GREATEST(0, ${leaveBalances.pending} - ${days.toFixed(1)}::numeric)`,
    })
    .where(
      and(
        eq(leaveBalances.userId, userId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year)
      )
    )
}

/** Move days from pending → used when a request is approved. */
export async function movePendingToUsed(
  userId: number,
  leaveTypeId: number,
  year: number,
  days: number
) {
  await db
    .update(leaveBalances)
    .set({
      pending: sql`GREATEST(0, ${leaveBalances.pending} - ${days.toFixed(1)}::numeric)`,
      used: sql`${leaveBalances.used} + ${days.toFixed(1)}::numeric`,
    })
    .where(
      and(
        eq(leaveBalances.userId, userId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year)
      )
    )
}

/** HR manual adjustment entry. */
export async function addAdjustment(
  userId: number,
  leaveTypeId: number,
  year: number,
  regionId: number,
  days: number
): Promise<BalanceWithAvailable> {
  // Ensure balance exists
  await getOrCreateBalance(userId, leaveTypeId, year, regionId)

  await db
    .update(leaveBalances)
    .set({
      adjustments: sql`${leaveBalances.adjustments} + ${days.toFixed(1)}::numeric`,
    })
    .where(
      and(
        eq(leaveBalances.userId, userId),
        eq(leaveBalances.leaveTypeId, leaveTypeId),
        eq(leaveBalances.year, year)
      )
    )

  const updated = await getBalance(userId, leaveTypeId, year)
  if (!updated) throw new AppError(500, 'Failed to retrieve updated balance')
  return updated
}

/**
 * Year-end rollover: carry forward unused balance (capped by policy carryOverMax).
 * Creates next-year records for all active users.
 */
export async function rolloverYear(fromYear: number): Promise<{ processed: number }> {
  const toYear = fromYear + 1
  const allBalances = await db
    .select({
      userId: leaveBalances.userId,
      leaveTypeId: leaveBalances.leaveTypeId,
      entitled: leaveBalances.entitled,
      used: leaveBalances.used,
      pending: leaveBalances.pending,
      carried: leaveBalances.carried,
      adjustments: leaveBalances.adjustments,
    })
    .from(leaveBalances)
    .where(eq(leaveBalances.year, fromYear))

  let processed = 0

  for (const balance of allBalances) {
    const entitled = parseDecimal(balance.entitled)
    const used = parseDecimal(balance.used)
    const pending = parseDecimal(balance.pending)
    const carried = parseDecimal(balance.carried)
    const adjustments = parseDecimal(balance.adjustments)
    const unused = Math.max(0, entitled + carried + adjustments - used - pending)

    // Get policy to find carryOverMax
    const [policy] = await db
      .select({ carryOverMax: leavePolicies.carryOverMax, entitlementDays: leavePolicies.entitlementDays })
      .from(leavePolicies)
      .where(eq(leavePolicies.leaveTypeId, balance.leaveTypeId))
      .limit(1)

    if (!policy) continue

    const carryOverMax = parseDecimal(policy.carryOverMax)
    const carryForward = Math.min(unused, carryOverMax)
    const newEntitlement = parseDecimal(policy.entitlementDays)

    await db
      .insert(leaveBalances)
      .values({
        userId: balance.userId,
        leaveTypeId: balance.leaveTypeId,
        year: toYear,
        entitled: newEntitlement.toFixed(1),
        used: '0.0',
        pending: '0.0',
        carried: carryForward.toFixed(1),
        adjustments: '0.0',
      })
      .onConflictDoNothing()

    processed++
  }

  return { processed }
}
