import { eq, and, isNull, type SQL } from 'drizzle-orm'
import { db } from '../db/index'
import { users, regions, leaveTypes } from '../db/schema'
import {
  getBalancesForUser,
  addAdjustment,
  type BalanceWithAvailable,
} from '../services/balance.service'
import { getLeaveTypes } from '../services/leave.service'

// Re-export types for consumers
export type { BalanceWithAvailable }
export type LeaveType = Awaited<ReturnType<typeof getLeaveTypes>>[number]

export interface DbUser {
  id: number
  email: string
  name: string
  role: string
  regionId: number
  managerId: number | null
  slackUserId: string | null
  region: { code: string }
}

async function selectUser(primaryCondition: SQL<unknown>) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      regionId: users.regionId,
      managerId: users.managerId,
      slackUserId: users.slackUserId,
      regionCode: regions.code,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .where(and(primaryCondition, isNull(users.deletedAt), eq(users.isActive, true)))
    .limit(1)

  if (!row) return null
  return { ...row, region: { code: row.regionCode ?? '' } } as DbUser
}

export async function getUserBySlackId(slackUserId: string): Promise<DbUser | null> {
  return selectUser(eq(users.slackUserId, slackUserId))
}

export async function getUserById(userId: number): Promise<DbUser | null> {
  return selectUser(eq(users.id, userId))
}

export async function getUserByEmail(email: string): Promise<DbUser | null> {
  return selectUser(eq(users.email, email))
}

export async function getSupervisorSlackId(userId: number): Promise<string | null> {
  const [row] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!row?.managerId) return null

  const [mgr] = await db
    .select({ slackUserId: users.slackUserId })
    .from(users)
    .where(eq(users.id, row.managerId))
    .limit(1)

  return mgr?.slackUserId ?? null
}

export async function getSupervisorEmail(userId: number): Promise<string | null> {
  const [row] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!row?.managerId) return null

  const [mgr] = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, row.managerId))
    .limit(1)

  return mgr?.email ?? null
}

export async function getUserBalances(userId: number, year: number): Promise<BalanceWithAvailable[]> {
  return getBalancesForUser(userId, year)
}

export async function getLeaveTypesForUser(regionId: number): Promise<LeaveType[]> {
  return getLeaveTypes(regionId)
}

async function findLeaveTypeId(code: string): Promise<number | null> {
  const [lt] = await db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.code, code), isNull(leaveTypes.regionId)))
    .limit(1)

  return lt?.id ?? null
}

export async function addCompLeaveAdjustment(
  userId: number,
  regionId: number,
  days: number
): Promise<boolean> {
  try {
    const ltId = await findLeaveTypeId('COMP_LEAVE')
    if (!ltId) {
      console.error('[db-service] COMP_LEAVE leave type not found')
      return false
    }
    const year = new Date().getFullYear()
    await addAdjustment(userId, ltId, year, regionId, days)
    return true
  } catch (err) {
    console.error('[db-service] addCompLeaveAdjustment error:', err)
    return false
  }
}

export async function getAllActiveEmployees() {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      slackUserId: users.slackUserId,
      regionCode: regions.code,
      managerId: users.managerId,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .where(and(isNull(users.deletedAt), eq(users.isActive, true)))

  // Fetch manager names in a second pass (simple approach)
  const managerIds = [...new Set(rows.map((r) => r.managerId).filter(Boolean))] as number[]
  const managerMap: Record<number, string> = {}
  if (managerIds.length > 0) {
    const managers = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(and(isNull(users.deletedAt)))
    for (const m of managers) managerMap[m.id] = m.name
  }

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    regionCode: r.regionCode ?? '',
    role: r.role,
    managerName: r.managerId ? managerMap[r.managerId] : undefined,
    slackUserId: r.slackUserId,
    isActive: true,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString().slice(0, 10) : '',
  }))
}

export async function addTILAdjustment(
  userId: number,
  regionId: number,
  hours: number
): Promise<boolean> {
  try {
    const ltId = await findLeaveTypeId('TIL')
    if (!ltId) {
      console.error('[db-service] TIL leave type not found')
      return false
    }
    const year = new Date().getFullYear()
    // Store hours / 8 as fractional days
    const days = parseFloat((hours / 8).toFixed(4))
    await addAdjustment(userId, ltId, year, regionId, days)
    return true
  } catch (err) {
    console.error('[db-service] addTILAdjustment error:', err)
    return false
  }
}

