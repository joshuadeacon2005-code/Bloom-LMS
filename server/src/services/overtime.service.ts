import { eq, and, desc, count, inArray, lte, gte, ne, isNull } from 'drizzle-orm'
import { db } from '../db/index'
import {
  overtimeEntries,
  leaveTypes,
  users,
  publicHolidays,
} from '../db/schema'
import { addAdjustment } from './balance.service'
import { createNotification } from './notification.service'
import { ValidationError, NotFoundError, ForbiddenError } from '../utils/errors'
import { parseDecimal, parseDate, formatDate } from '../utils/workingDays'

// ============================================================
// Types
// ============================================================

export interface OvertimeBalance {
  pendingDays: number
  approvedDays: number
  pendingCount: number
}

// ============================================================
// Helpers
// ============================================================

async function getAnnualLeaveTypeId(_regionId: number): Promise<number | null> {
  // AL is a global leave type (regionId IS NULL) per the seed
  const [lt] = await db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(and(eq(leaveTypes.code, 'AL'), isNull(leaveTypes.regionId)))
    .limit(1)
  return lt?.id ?? null
}

async function isPublicHoliday(regionId: number, dateStr: string): Promise<boolean> {
  const [row] = await db
    .select({ id: publicHolidays.id })
    .from(publicHolidays)
    .where(and(eq(publicHolidays.regionId, regionId), eq(publicHolidays.date, dateStr)))
    .limit(1)
  return !!row
}

// ============================================================
// Submit Overtime Request
// ============================================================

export async function submitOvertimeRequest(
  userId: number,
  data: { date: string; hoursWorked: number; daysRequested: number; reason: string }
) {
  const [user] = await db
    .select({ id: users.id, regionId: users.regionId, managerId: users.managerId, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1)

  if (!user) throw new ValidationError('User not found or inactive')

  // Validate date — not in future
  const today = formatDate(new Date())
  if (data.date > today) throw new ValidationError('Overtime date cannot be in the future')

  // Validate not weekend
  const d = parseDate(data.date)
  const dow = d.getUTCDay()
  if (dow === 0 || dow === 6) throw new ValidationError('Overtime cannot be logged on weekends')

  // Validate not public holiday
  const isHoliday = await isPublicHoliday(user.regionId, data.date)
  if (isHoliday) throw new ValidationError('Overtime cannot be logged on public holidays')

  // Validate hours
  if (data.hoursWorked <= 0 || data.hoursWorked > 24) {
    throw new ValidationError('Hours worked must be between 0 and 24')
  }

  // Validate days requested
  if (![0.5, 1.0].includes(data.daysRequested)) {
    throw new ValidationError('Days requested must be 0.5 or 1')
  }

  // Duplicate check: same user + same date (not cancelled/rejected)
  const [existing] = await db
    .select({ id: overtimeEntries.id })
    .from(overtimeEntries)
    .where(
      and(
        eq(overtimeEntries.userId, userId),
        eq(overtimeEntries.date, data.date),
        ne(overtimeEntries.status, 'rejected'),
        ne(overtimeEntries.status, 'cancelled')
      )
    )
    .limit(1)
  if (existing) {
    throw new ValidationError('You already have an overtime request for this date')
  }

  const [entry] = await db
    .insert(overtimeEntries)
    .values({
      userId,
      date: data.date,
      hoursWorked: data.hoursWorked.toFixed(2),
      daysRequested: data.daysRequested.toFixed(2),
      reason: data.reason,
      status: 'pending',
      regionId: user.regionId,
    })
    .returning()

  if (!entry) throw new ValidationError('Failed to create overtime request')

  // Notify manager
  if (user.managerId) {
    await createNotification({
      userId: user.managerId,
      type: 'overtime_submitted',
      title: 'Overtime Compensation Request',
      message: `${user.name} has requested ${data.daysRequested} day(s) compensation for ${data.hoursWorked}h overtime on ${data.date}: "${data.reason}"`,
      metadata: { overtimeEntryId: entry.id, submitterId: userId },
    })
  }

  return entry
}

// ============================================================
// Approve Overtime — credits annual leave balance
// ============================================================

export async function approveOvertimeRequest(entryId: number, approverId: number) {
  const [entry] = await db
    .select({
      id: overtimeEntries.id,
      userId: overtimeEntries.userId,
      hoursWorked: overtimeEntries.hoursWorked,
      daysRequested: overtimeEntries.daysRequested,
      regionId: overtimeEntries.regionId,
      status: overtimeEntries.status,
      date: overtimeEntries.date,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.id, entryId))
    .limit(1)

  if (!entry) throw new NotFoundError('Overtime request')
  if (entry.status !== 'pending') {
    throw new ValidationError(`This request is already ${entry.status}`)
  }

  await assertCanManageOvertime(approverId, entry.userId)

  await db
    .update(overtimeEntries)
    .set({ status: 'approved', approvedById: approverId, approvedAt: new Date() })
    .where(eq(overtimeEntries.id, entryId))

  // Credit approved days to annual leave balance
  const days = parseDecimal(entry.daysRequested)
  const annualLeaveTypeId = await getAnnualLeaveTypeId(entry.regionId)
  if (annualLeaveTypeId) {
    const year = new Date().getFullYear()
    await addAdjustment(entry.userId, annualLeaveTypeId, year, entry.regionId, days)
  }

  const [approver] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, approverId))
    .limit(1)

  await createNotification({
    userId: entry.userId,
    type: 'overtime_approved',
    title: 'Overtime Compensation Approved',
    message: `Your overtime compensation for ${entry.date} has been approved by ${approver?.name ?? 'your manager'}. ${days} day(s) added to your annual leave balance.`,
    metadata: { overtimeEntryId: entryId },
  })

  return { id: entryId, status: 'approved' }
}

// ============================================================
// Reject Overtime
// ============================================================

export async function rejectOvertimeRequest(entryId: number, approverId: number, reason: string) {
  const [entry] = await db
    .select({
      id: overtimeEntries.id,
      userId: overtimeEntries.userId,
      hoursWorked: overtimeEntries.hoursWorked,
      status: overtimeEntries.status,
      date: overtimeEntries.date,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.id, entryId))
    .limit(1)

  if (!entry) throw new NotFoundError('Overtime request')
  if (entry.status !== 'pending') {
    throw new ValidationError(`This request is already ${entry.status}`)
  }

  await assertCanManageOvertime(approverId, entry.userId)

  await db
    .update(overtimeEntries)
    .set({
      status: 'rejected',
      approvedById: approverId,
      approvedAt: new Date(),
      rejectionReason: reason,
    })
    .where(eq(overtimeEntries.id, entryId))

  const [approver] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, approverId))
    .limit(1)

  await createNotification({
    userId: entry.userId,
    type: 'overtime_rejected',
    title: 'Overtime Compensation Rejected',
    message: `Your overtime compensation request for ${entry.date} was rejected by ${approver?.name ?? 'your manager'}. Reason: ${reason}`,
    metadata: { overtimeEntryId: entryId },
  })

  return { id: entryId, status: 'rejected' }
}

// ============================================================
// Cancel Overtime (employee cancels own pending request)
// ============================================================

export async function cancelOvertimeRequest(entryId: number, userId: number) {
  const [entry] = await db
    .select({
      id: overtimeEntries.id,
      userId: overtimeEntries.userId,
      status: overtimeEntries.status,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.id, entryId))
    .limit(1)

  if (!entry) throw new NotFoundError('Overtime request')
  if (entry.userId !== userId) throw new ForbiddenError()
  if (entry.status !== 'pending') {
    throw new ValidationError('Only pending requests can be cancelled')
  }

  await db
    .update(overtimeEntries)
    .set({ status: 'cancelled' })
    .where(eq(overtimeEntries.id, entryId))

  return { id: entryId, status: 'cancelled' }
}

// ============================================================
// Get My Overtime Requests
// ============================================================

export async function getMyOvertimeRequests(
  userId: number,
  filters: {
    status?: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'converted'
    startDate?: string
    endDate?: string
    page: number
    pageSize: number
  }
) {
  const { status, startDate, endDate, page, pageSize } = filters

  const conditions = [eq(overtimeEntries.userId, userId)]
  if (status) conditions.push(eq(overtimeEntries.status, status))
  if (startDate) conditions.push(gte(overtimeEntries.date, startDate))
  if (endDate) conditions.push(lte(overtimeEntries.date, endDate))

  const where = and(...conditions)
  const offset = (page - 1) * pageSize

  const [{ total }] = await db
    .select({ total: count() })
    .from(overtimeEntries)
    .where(where)

  const rows = await db
    .select({
      id: overtimeEntries.id,
      date: overtimeEntries.date,
      hoursWorked: overtimeEntries.hoursWorked,
      daysRequested: overtimeEntries.daysRequested,
      reason: overtimeEntries.reason,
      status: overtimeEntries.status,
      rejectionReason: overtimeEntries.rejectionReason,
      createdAt: overtimeEntries.createdAt,
      approvedAt: overtimeEntries.approvedAt,
      approvedBy: {
        id: users.id,
        name: users.name,
      },
    })
    .from(overtimeEntries)
    .leftJoin(users, eq(overtimeEntries.approvedById, users.id))
    .where(where)
    .orderBy(desc(overtimeEntries.date))
    .limit(pageSize)
    .offset(offset)

  return {
    data: rows.map((r) => ({
      ...r,
      hoursWorked: parseDecimal(r.hoursWorked),
      daysRequested: parseDecimal(r.daysRequested),
    })),
    total: total ?? 0,
  }
}

// ============================================================
// Get Pending Requests for Manager
// ============================================================

export async function getPendingOvertimeRequests(managerId: number, requestingRole: string) {
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(requestingRole)

  let userIds: number[] | null = null
  if (!isHrOrAbove) {
    const reports = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.managerId, managerId), eq(users.isActive, true), isNull(users.deletedAt)))
    userIds = reports.map((r) => r.id)
    if (userIds.length === 0) return []
  }

  const conditions = [eq(overtimeEntries.status, 'pending')]
  if (userIds) conditions.push(inArray(overtimeEntries.userId, userIds))

  return db
    .select({
      id: overtimeEntries.id,
      date: overtimeEntries.date,
      hoursWorked: overtimeEntries.hoursWorked,
      daysRequested: overtimeEntries.daysRequested,
      reason: overtimeEntries.reason,
      status: overtimeEntries.status,
      createdAt: overtimeEntries.createdAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(overtimeEntries)
    .leftJoin(users, eq(overtimeEntries.userId, users.id))
    .where(and(...conditions))
    .orderBy(overtimeEntries.date)
    .then((rows) =>
      rows.map((r) => ({
        ...r,
        hoursWorked: parseDecimal(r.hoursWorked),
        daysRequested: parseDecimal(r.daysRequested),
      }))
    )
}

// ============================================================
// Get Overtime Balance Summary
// ============================================================

export async function getOvertimeBalance(userId: number): Promise<OvertimeBalance> {
  const rows = await db
    .select({
      status: overtimeEntries.status,
      daysRequested: overtimeEntries.daysRequested,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.userId, userId))

  let pendingDays = 0
  let approvedDays = 0
  let pendingCount = 0

  for (const r of rows) {
    const d = parseDecimal(r.daysRequested)
    if (r.status === 'pending') { pendingDays += d; pendingCount++ }
    else if (r.status === 'approved') approvedDays += d
  }

  return { pendingDays, approvedDays, pendingCount }
}

// ============================================================
// Internal helpers
// ============================================================

async function assertCanManageOvertime(approverId: number, employeeUserId: number) {
  const [approver] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, approverId))
    .limit(1)

  if (!approver) throw new NotFoundError('Approver')

  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(approver.role)
  if (isHrOrAbove) return

  const [employee] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, employeeUserId))
    .limit(1)

  if (employee?.managerId !== approverId) {
    throw new ForbiddenError()
  }
}
