import { eq, and, desc, count, inArray, lte, gte, ne, isNull } from 'drizzle-orm'
import { db } from '../db/index'
import {
  overtimeEntries,
  leaveTypes,
  users,
  regions,
  compLeaveRules,
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

async function getUserRegionCode(userId: number): Promise<string> {
  const [u] = await db
    .select({ code: regions.code })
    .from(users)
    .leftJoin(regions, eq(users.regionId, regions.id))
    .where(eq(users.id, userId))
    .limit(1)
  return u?.code ?? ''
}

async function isPublicHoliday(regionId: number, dateStr: string): Promise<boolean> {
  const [row] = await db
    .select({ id: publicHolidays.id })
    .from(publicHolidays)
    .where(and(eq(publicHolidays.regionId, regionId), eq(publicHolidays.date, dateStr)))
    .limit(1)
  return !!row
}

// Local HR reps by region code. Stable across environments (matched by email).
const LOCAL_HR_EMAILS: Record<string, string> = {
  ID: 'rina.juwita@bloomandgrowgroup.com',
  CN: 'michelle.su@bloomandgrow.com.cn',
}
const DEFAULT_HR_EMAIL = 'elaine@bloomandgrowgroup.com'

async function getLocalHrUserId(regionId: number): Promise<number | null> {
  const [region] = await db
    .select({ code: regions.code })
    .from(regions)
    .where(eq(regions.id, regionId))
    .limit(1)
  const email = (region?.code && LOCAL_HR_EMAILS[region.code]) ? LOCAL_HR_EMAILS[region.code] : DEFAULT_HR_EMAIL
  const [hrUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return hrUser?.id ?? null
}

async function getHrResponsibleRegionIds(userId: number): Promise<number[] | null> {
  const [user] = await db
    .select({ email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user) return []
  if (user.role === 'super_admin') return null

  let responsibleCodes: string[]
  if (user.email === 'rina.juwita@bloomandgrowgroup.com') {
    responsibleCodes = ['ID']
  } else if (user.email === 'michelle.su@bloomandgrow.com.cn') {
    responsibleCodes = ['CN']
  } else if (user.email === 'elaine@bloomandgrowgroup.com') {
    responsibleCodes = ['HK', 'SG', 'MY', 'AU', 'NZ']
  } else {
    return []
  }

  const regionRows = await db
    .select({ id: regions.id })
    .from(regions)
    .where(inArray(regions.code, responsibleCodes))
  return regionRows.map((r) => r.id)
}

// ============================================================
// Submit Overtime Request
// ============================================================

export async function submitOvertimeRequest(
  userId: number,
  data: { date: string; hoursWorked: number; daysRequested: number; reason: string; compensationType?: string; evidenceUrl?: string }
) {
  const [user] = await db
    .select({ id: users.id, regionId: users.regionId, managerId: users.managerId, name: users.name })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.isActive, true), isNull(users.deletedAt)))
    .limit(1)

  if (!user) throw new ValidationError('User not found or inactive')

  // Validate date — not in future
  const today = formatDate(new Date())
  if (data.date > today) throw new ValidationError('The worked date cannot be in the future')

  // Validate hours
  if (data.hoursWorked <= 0 || data.hoursWorked > 24) {
    throw new ValidationError('Hours worked must be between 0 and 24')
  }

  // Validate days requested
  if (data.daysRequested <= 0 || data.daysRequested > 5) {
    throw new ValidationError('Days requested must be between 0.5 and 5')
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
      compensationType: data.compensationType === 'cash' ? 'cash' : 'time_off',
      evidenceUrl: data.evidenceUrl ?? null,
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
// Approve Overtime — credits COMP_LEAVE (non-AU/NZ) or TIL (AU/NZ)
// ============================================================

export async function approveOvertimeRequest(
  entryId: number,
  approverId: number,
  approvedDays?: number,
  comment?: string
) {
  const [entry] = await db
    .select({
      id: overtimeEntries.id,
      userId: overtimeEntries.userId,
      hoursWorked: overtimeEntries.hoursWorked,
      daysRequested: overtimeEntries.daysRequested,
      regionId: overtimeEntries.regionId,
      status: overtimeEntries.status,
      date: overtimeEntries.date,
      compensationType: overtimeEntries.compensationType,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.id, entryId))
    .limit(1)

  if (!entry) throw new NotFoundError('Overtime request')
  if (entry.status !== 'pending') {
    throw new ValidationError(`This request is already ${entry.status}`)
  }

  await assertCanManageOvertime(approverId, entry.userId)

  const regionCode = await getUserRegionCode(entry.userId)
  const isAUNZ = ['AU', 'NZ'].includes(regionCode)

  // Get hours per day for TIL conversion
  let hoursPerDay = 8
  if (isAUNZ) {
    const [rule] = await db
      .select({ hoursPerDay: compLeaveRules.hoursPerDay })
      .from(compLeaveRules)
      .where(eq(compLeaveRules.regionId, entry.regionId))
      .limit(1)
    hoursPerDay = parseFloat(rule?.hoursPerDay ?? '8')
  }

  const requestedDays = parseDecimal(entry.daysRequested)
  const hoursWorked = parseDecimal(entry.hoursWorked)
  let daysToCredit: number

  if (approvedDays !== undefined) {
    daysToCredit = approvedDays
  } else if (isAUNZ) {
    // TIL: convert hours to days, rounding to nearest 0.5
    daysToCredit = Math.round((hoursWorked / hoursPerDay) * 2) / 2
  } else {
    daysToCredit = requestedDays
  }

  // Look up the correct leave type to credit
  const leaveTypeCode = isAUNZ ? 'TIL' : 'COMP_LEAVE'
  const [lt] = await db
    .select({ id: leaveTypes.id })
    .from(leaveTypes)
    .where(eq(leaveTypes.code, leaveTypeCode))
    .limit(1)
  const compLeaveTypeId = lt?.id ?? null

  const isCash = entry.compensationType === 'cash'

  const [approver] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, approverId))
    .limit(1)

  const [employee] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, entry.userId))
    .limit(1)

  const localHrId = await getLocalHrUserId(entry.regionId)

  if (isCash) {
    // Step 1 of 2: supervisor approval — move to pending_hr, notify HR
    await db
      .update(overtimeEntries)
      .set({
        status: 'pending_hr',
        approvedById: approverId,
        approvedAt: new Date(),
        managerComment: comment ?? null,
      })
      .where(eq(overtimeEntries.id, entryId))

    // Notify local HR for final approval
    if (localHrId) {
      await createNotification({
        userId: localHrId,
        type: 'overtime_submitted',
        title: 'Cash Overtime — HR Approval Required',
        message: `${employee?.name ?? 'An employee'}'s cash overtime request for ${entry.date} (${entry.hoursWorked}h) has been approved by ${approver?.name ?? 'their supervisor'} and requires your final approval.`,
        metadata: { overtimeEntryId: entryId },
      })
    }

    // Notify employee that supervisor approved, waiting for HR
    await createNotification({
      userId: entry.userId,
      type: 'overtime_approved',
      title: 'Overtime — Supervisor Approved',
      message: `Your cash overtime request for ${entry.date} has been approved by ${approver?.name ?? 'your supervisor'}. It is now pending final HR approval.`,
      metadata: { overtimeEntryId: entryId },
    })

    return { id: entryId, status: 'pending_hr' }
  }

  // Time-off / TIL: credit balance and fully approve
  if (compLeaveTypeId) {
    const year = new Date().getFullYear()
    await addAdjustment(entry.userId, compLeaveTypeId, year, entry.regionId, daysToCredit)
  }

  await db
    .update(overtimeEntries)
    .set({
      status: 'approved',
      approvedById: approverId,
      approvedAt: new Date(),
      approvedDays: daysToCredit.toFixed(2),
      managerComment: comment ?? null,
    })
    .where(eq(overtimeEntries.id, entryId))

  const leaveLabel = isAUNZ ? 'Time In Lieu' : 'Compensatory Leave'

  // Notify employee
  await createNotification({
    userId: entry.userId,
    type: 'overtime_approved',
    title: 'Overtime Approved',
    message: `Your ${isAUNZ ? 'Time In Lieu' : 'comp leave'} request for ${entry.date} has been approved by ${approver?.name ?? 'your manager'}. ${daysToCredit} day(s) added to your ${leaveLabel} balance.`,
    metadata: { overtimeEntryId: entryId },
  })

  // Notify local HR for records
  if (localHrId) {
    await createNotification({
      userId: localHrId,
      type: 'overtime_approved',
      title: 'Overtime Approved — For Records',
      message: `${employee?.name ?? 'An employee'}'s ${leaveLabel} request for ${entry.date} was approved by ${approver?.name ?? 'their supervisor'}. ${daysToCredit}d added to balance.`,
      metadata: { overtimeEntryId: entryId },
    })
  }

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
// HR Final Approve (cash requests only, after supervisor approval)
// ============================================================

export async function hrApproveOvertimeRequest(entryId: number, hrUserId: number) {
  const [entry] = await db
    .select({
      id: overtimeEntries.id,
      userId: overtimeEntries.userId,
      status: overtimeEntries.status,
      compensationType: overtimeEntries.compensationType,
      date: overtimeEntries.date,
      hoursWorked: overtimeEntries.hoursWorked,
      regionId: overtimeEntries.regionId,
      approvedById: overtimeEntries.approvedById,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.id, entryId))
    .limit(1)

  if (!entry) throw new NotFoundError('Overtime request')
  if (entry.status !== 'pending_hr') {
    throw new ValidationError('This request is not awaiting HR approval')
  }
  if (entry.compensationType !== 'cash') {
    throw new ValidationError('Only cash requests require HR approval')
  }

  const responsibleRegionIds = await getHrResponsibleRegionIds(hrUserId)
  if (responsibleRegionIds !== null && !responsibleRegionIds.includes(entry.regionId)) {
    throw new ForbiddenError()
  }

  await db
    .update(overtimeEntries)
    .set({
      status: 'approved',
      hrApprovedById: hrUserId,
      hrApprovedAt: new Date(),
    })
    .where(eq(overtimeEntries.id, entryId))

  const [hrUser] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, hrUserId))
    .limit(1)

  await createNotification({
    userId: entry.userId,
    type: 'overtime_approved',
    title: 'Overtime Approved — Cash Payment',
    message: `Your cash overtime request for ${entry.date} has received final HR approval from ${hrUser?.name ?? 'HR'}. It will be processed in the next payroll.`,
    metadata: { overtimeEntryId: entryId },
  })

  return { id: entryId, status: 'approved' }
}

// ============================================================
// HR Reject (cash requests at pending_hr stage)
// ============================================================

export async function hrRejectOvertimeRequest(entryId: number, hrUserId: number, reason: string) {
  const [entry] = await db
    .select({
      id: overtimeEntries.id,
      userId: overtimeEntries.userId,
      status: overtimeEntries.status,
      compensationType: overtimeEntries.compensationType,
      date: overtimeEntries.date,
      regionId: overtimeEntries.regionId,
      approvedById: overtimeEntries.approvedById,
    })
    .from(overtimeEntries)
    .where(eq(overtimeEntries.id, entryId))
    .limit(1)

  if (!entry) throw new NotFoundError('Overtime request')
  if (entry.status !== 'pending_hr') {
    throw new ValidationError('This request is not awaiting HR approval')
  }

  const responsibleRegionIds = await getHrResponsibleRegionIds(hrUserId)
  if (responsibleRegionIds !== null && !responsibleRegionIds.includes(entry.regionId)) {
    throw new ForbiddenError()
  }

  const [hrUser] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, hrUserId))
    .limit(1)

  await db
    .update(overtimeEntries)
    .set({
      status: 'rejected',
      hrApprovedById: hrUserId,
      hrApprovedAt: new Date(),
      rejectionReason: reason,
    })
    .where(eq(overtimeEntries.id, entryId))

  // Notify employee
  await createNotification({
    userId: entry.userId,
    type: 'overtime_rejected',
    title: 'Cash Overtime Rejected by HR',
    message: `Your cash overtime request for ${entry.date} was rejected at the HR approval stage by ${hrUser?.name ?? 'HR'}. Reason: ${reason}`,
    metadata: { overtimeEntryId: entryId },
  })

  // Notify original supervisor too
  if (entry.approvedById) {
    const [employee] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, entry.userId))
      .limit(1)
    await createNotification({
      userId: entry.approvedById,
      type: 'overtime_rejected',
      title: 'Cash Overtime Rejected by HR',
      message: `${employee?.name ?? 'An employee'}'s cash overtime request for ${entry.date} was rejected at the HR stage by ${hrUser?.name ?? 'HR'}.`,
      metadata: { overtimeEntryId: entryId },
    })
  }

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
      compensationType: overtimeEntries.compensationType,
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

  const entrySelectFields = {
    id: overtimeEntries.id,
    date: overtimeEntries.date,
    hoursWorked: overtimeEntries.hoursWorked,
    daysRequested: overtimeEntries.daysRequested,
    reason: overtimeEntries.reason,
    compensationType: overtimeEntries.compensationType,
    status: overtimeEntries.status,
    createdAt: overtimeEntries.createdAt,
    regionId: overtimeEntries.regionId,
    user: {
      id: users.id,
      name: users.name,
      email: users.email,
    },
  }

  async function queryEntries(statusFilter: 'pending' | 'pending_hr', userIdsFilter?: number[], regionIdsFilter?: number[]) {
    const conditions = [eq(overtimeEntries.status, statusFilter)]
    if (userIdsFilter && userIdsFilter.length > 0) conditions.push(inArray(overtimeEntries.userId, userIdsFilter))
    if (regionIdsFilter && regionIdsFilter.length > 0) conditions.push(inArray(overtimeEntries.regionId, regionIdsFilter))
    return db
      .select(entrySelectFields)
      .from(overtimeEntries)
      .leftJoin(users, eq(overtimeEntries.userId, users.id))
      .where(and(...conditions))
      .orderBy(overtimeEntries.date)
  }

  // ── Supervisor queue: pending entries ──
  let supervisorRaw: Awaited<ReturnType<typeof queryEntries>> = []
  if (!isHrOrAbove) {
    const reports = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.managerId, managerId), eq(users.isActive, true), isNull(users.deletedAt)))
    const userIds = reports.map((r) => r.id)
    if (userIds.length > 0) {
      supervisorRaw = await queryEntries('pending', userIds)
    }
  } else {
    supervisorRaw = await queryEntries('pending')
  }

  // ── HR queue: pending_hr cash entries for this HR's region responsibility ──
  let hrRaw: Awaited<ReturnType<typeof queryEntries>> = []
  if (isHrOrAbove) {
    const responsibleRegionIds = await getHrResponsibleRegionIds(managerId)
    if (responsibleRegionIds === null) {
      hrRaw = await queryEntries('pending_hr')
    } else if (responsibleRegionIds.length > 0) {
      hrRaw = await queryEntries('pending_hr', undefined, responsibleRegionIds)
    }
  }

  const mapRow = (r: Awaited<ReturnType<typeof queryEntries>>[number], requiresHrApproval: boolean) => ({
    ...r,
    hoursWorked: parseDecimal(String(r.hoursWorked)),
    daysRequested: parseDecimal(String(r.daysRequested)),
    requiresHrApproval,
  })

  return [
    ...supervisorRaw.map((r) => mapRow(r, false)),
    ...hrRaw.map((r) => mapRow(r, true)),
  ]
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
