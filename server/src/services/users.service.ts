import { eq, and, ilike, or, isNull, sql, count, asc } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db/index'
import { users, regions, departments, leavePolicies, leaveBalances, leaveTypes } from '../db/schema'
import { hashPassword } from '../utils/password'
import { NotFoundError, ConflictError, AppError } from '../utils/errors'

const safeUserFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  slackUserId: users.slackUserId,
  role: users.role,
  regionId: users.regionId,
  departmentId: users.departmentId,
  managerId: users.managerId,
  isActive: users.isActive,
  isOnProbation: users.isOnProbation,
  probationMonths: users.probationMonths,
  probationEndDate: users.probationEndDate,
  joinedDate: users.joinedDate,
  avatarUrl: users.avatarUrl,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
}

export async function getUsers(filters: {
  search?: string
  regionId?: number
  isActive?: boolean
  role?: string
  page: number
  pageSize: number
}) {
  const { search, regionId, isActive, role, page, pageSize } = filters
  const offset = (page - 1) * pageSize

  const conditions = [isNull(users.deletedAt)]
  if (search) conditions.push(or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))!)
  if (regionId !== undefined) conditions.push(eq(users.regionId, regionId))
  if (isActive !== undefined) conditions.push(eq(users.isActive, isActive))
  if (role) conditions.push(eq(users.role, role as 'employee' | 'manager' | 'hr_admin' | 'super_admin'))

  const where = and(...conditions)

  const [{ total }] = await db
    .select({ total: count() })
    .from(users)
    .where(where)

  const managersAlias = alias(users, 'manager')

  const rows = await db
    .select({ ...safeUserFields, managerName: managersAlias.name })
    .from(users)
    .leftJoin(managersAlias, eq(users.managerId, managersAlias.id))
    .where(where)
    .orderBy(users.name)
    .limit(pageSize)
    .offset(offset)

  return { users: rows, total: total ?? 0 }
}

export async function getUserById(id: number) {
  const [user] = await db
    .select({
      ...safeUserFields,
      region: {
        id: regions.id,
        name: regions.name,
        code: regions.code,
        timezone: regions.timezone,
        currency: regions.currency,
      },
      department: {
        id: departments.id,
        name: departments.name,
      },
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .leftJoin(departments, eq(users.departmentId, departments.id))
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .limit(1)

  if (!user) throw new NotFoundError('User')
  return user
}

export async function createUser(data: {
  email: string
  password: string
  name: string
  role?: 'employee' | 'manager' | 'hr_admin' | 'super_admin'
  regionId: number
  departmentId?: number
  managerId?: number
  isOnProbation?: boolean
  probationMonths?: number | null
  probationEndDate?: string | null
  joinedDate?: string | null
}) {
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, data.email.toLowerCase()))
    .limit(1)

  if (existing) throw new ConflictError('An account with this email already exists')

  const passwordHash = await hashPassword(data.password)
  const [user] = await db
    .insert(users)
    .values({
      email: data.email.toLowerCase(),
      passwordHash,
      name: data.name,
      role: data.role ?? 'employee',
      regionId: data.regionId,
      departmentId: data.departmentId,
      managerId: data.managerId,
      isOnProbation: data.isOnProbation ?? false,
      probationMonths: data.probationMonths ?? null,
      probationEndDate: data.probationEndDate ?? null,
      joinedDate: data.joinedDate ?? null,
    })
    .returning(safeUserFields)

  if (!user) throw new AppError(500, 'Failed to create user')

  // Auto-generate leave balances for the current year
  await autoGenerateLeaveBalances(user.id, data.regionId).catch((err) => {
    console.error('[users.service] Failed to auto-generate leave balances:', err)
    // Non-fatal — HR can add manually if needed
  })

  return user
}

export async function updateUser(
  id: number,
  data: {
    name?: string
    email?: string
    role?: 'employee' | 'manager' | 'hr_admin' | 'super_admin'
    regionId?: number
    departmentId?: number | null
    managerId?: number | null
    isActive?: boolean
    isOnProbation?: boolean
    probationMonths?: number | null
    probationEndDate?: string | null
    joinedDate?: string | null
    slackUserId?: string | null
    avatarUrl?: string | null
  }
) {
  if (data.email) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.email, data.email.toLowerCase()), isNull(users.deletedAt)))
      .limit(1)

    if (existing && existing.id !== id) {
      throw new ConflictError('Email is already in use')
    }
    data.email = data.email.toLowerCase()
  }

  const [user] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning(safeUserFields)

  if (!user) throw new NotFoundError('User')
  return user
}

export async function deleteUser(id: number) {
  const [user] = await db
    .update(users)
    .set({ deletedAt: new Date(), isActive: false })
    .where(and(eq(users.id, id), isNull(users.deletedAt)))
    .returning({ id: users.id })

  if (!user) throw new NotFoundError('User')
}

export async function getUsersForSelect(regionId?: number) {
  const conditions = [isNull(users.deletedAt), eq(users.isActive, true)]
  if (regionId !== undefined) conditions.push(eq(users.regionId, regionId))

  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      regionId: users.regionId,
    })
    .from(users)
    .where(and(...conditions))
    .orderBy(users.name)
}

export async function getManagers(_regionId?: number) {
  // Always return ALL active managers/HR/super_admin across all regions.
  // regionId param is intentionally ignored — cross-region reporting exists.
  const conditions = [
    isNull(users.deletedAt),
    eq(users.isActive, true),
    sql`${users.role} IN ('manager', 'hr_admin', 'super_admin')`,
  ]

  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      regionId: users.regionId,
      regionName: regions.name,
    })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .where(and(...conditions))
    .orderBy(asc(users.name))
}

export async function autoGenerateLeaveBalances(userId: number, regionId: number): Promise<void> {
  const year = new Date().getFullYear()

  // Get all leave policies for this region
  const policies = await db
    .select({
      leaveTypeId: leavePolicies.leaveTypeId,
      entitlementDays: leavePolicies.entitlementDays,
    })
    .from(leavePolicies)
    .innerJoin(leaveTypes, eq(leavePolicies.leaveTypeId, leaveTypes.id))
    .where(and(eq(leavePolicies.regionId, regionId), eq(leaveTypes.isActive, true)))

  for (const policy of policies) {
    await db
      .insert(leaveBalances)
      .values({
        userId,
        leaveTypeId: policy.leaveTypeId,
        year,
        entitled: policy.entitlementDays,
        used: '0.0',
        pending: '0.0',
        carried: '0.0',
        adjustments: '0.0',
      })
      .onConflictDoNothing()
  }
}
