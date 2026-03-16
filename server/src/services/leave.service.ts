import { eq, and, or, lte, gte, desc, count, isNull, ne, sql, inArray } from 'drizzle-orm'
import { db } from '../db/index'
import {
  leaveRequests,
  leaveTypes,
  leavePolicies,
  approvalWorkflows,
  publicHolidays,
  users,
  regions,
} from '../db/schema'
import {
  calculateWorkingDays,
  calculateCalendarDays,
  parseDecimal,
  getTodayString,
  monthsBetween,
} from '../utils/workingDays'
import {
  getOrCreateBalance,
  addPending,
  releasePending,
} from './balance.service'
import { deleteLeaveEvent } from './calendar.service'
import { createNotification } from './notification.service'
import { ValidationError, NotFoundError, ForbiddenError, AppError } from '../utils/errors'
import { processAutoApprove, initHrRequiredFlow } from './approvalFlow.service'

// ============================================================
// Helpers
// ============================================================

async function getHolidaysInRange(
  regionId: number,
  startDate: string,
  endDate: string
): Promise<Set<string>> {
  const rows = await db
    .select({ date: publicHolidays.date })
    .from(publicHolidays)
    .where(
      and(
        eq(publicHolidays.regionId, regionId),
        gte(publicHolidays.date, startDate),
        lte(publicHolidays.date, endDate)
      )
    )
  return new Set(rows.map((r) => r.date))
}

async function checkOverlap(userId: number, startDate: string, endDate: string, excludeId?: number) {
  const conditions = [
    eq(leaveRequests.userId, userId),
    or(eq(leaveRequests.status, 'pending'), eq(leaveRequests.status, 'approved')),
    lte(leaveRequests.startDate, endDate),
    gte(leaveRequests.endDate, startDate),
  ]
  if (excludeId) conditions.push(ne(leaveRequests.id, excludeId))

  const [overlap] = await db
    .select({ id: leaveRequests.id, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
    .from(leaveRequests)
    .where(and(...conditions))
    .limit(1)

  if (overlap) {
    throw new ValidationError(
      `You already have a leave request from ${overlap.startDate} to ${overlap.endDate} that overlaps with the selected dates`
    )
  }
}

/** Get the effective approver for a user (handles delegation when manager is on leave). */
async function getEffectiveApprover(managerId: number, regionId: number): Promise<number> {
  const today = getTodayString()

  const [onLeave] = await db
    .select({ id: leaveRequests.id })
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.userId, managerId),
        eq(leaveRequests.status, 'approved'),
        lte(leaveRequests.startDate, today),
        gte(leaveRequests.endDate, today)
      )
    )
    .limit(1)

  if (!onLeave) return managerId

  // Manager is on leave — try their manager
  const [mgr] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, managerId))
    .limit(1)

  if (mgr?.managerId) {
    return getEffectiveApprover(mgr.managerId, regionId)
  }

  // Fall back to an HR admin in the region
  const hr = await getHrAdminForRegion(regionId)
  return hr ?? managerId
}

// CN-GZ and CN-SH are sibling regions — HR from either city covers both
const CN_CITY_CODES = ['CN-GZ', 'CN-SH'] as const

async function getHrAdminForRegion(regionId: number): Promise<number | null> {
  const [hr] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.regionId, regionId),
        or(eq(users.role, 'hr_admin'), eq(users.role, 'super_admin')),
        eq(users.isActive, true),
        isNull(users.deletedAt)
      )
    )
    .limit(1)

  if (hr) return hr.id

  // If this is a CN city and no local HR exists, fall back to any HR in the other CN city
  const [regionRow] = await db
    .select({ code: regions.code })
    .from(regions)
    .where(eq(regions.id, regionId))
    .limit(1)

  if (regionRow && (CN_CITY_CODES as readonly string[]).includes(regionRow.code)) {
    const cnCityRegionRows = await db
      .select({ id: regions.id })
      .from(regions)
      .where(inArray(regions.code, [...CN_CITY_CODES]))

    const [siblingHr] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.regionId, cnCityRegionRows.map((r) => r.id)),
          or(eq(users.role, 'hr_admin'), eq(users.role, 'super_admin')),
          eq(users.isActive, true),
          isNull(users.deletedAt)
        )
      )
      .limit(1)

    if (siblingHr) return siblingHr.id
  }

  return null
}

async function buildApprovalChain(
  userId: number,
  regionId: number,
  totalDays: number
): Promise<{ approverId: number; level: number }[]> {
  const approvers: { approverId: number; level: number }[] = []

  const [user] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  let level1ApproverId: number | null = null

  if (user?.managerId) {
    level1ApproverId = await getEffectiveApprover(user.managerId, regionId)
    approvers.push({ approverId: level1ApproverId, level: 1 })
  } else {
    // No manager — HR approves at level 1
    const hrId = await getHrAdminForRegion(regionId)
    if (hrId) {
      level1ApproverId = hrId
      approvers.push({ approverId: hrId, level: 1 })
    }
  }

  // Level 2: HR approval for long leaves (> 7 working days)
  if (totalDays > 7) {
    const hrId = await getHrAdminForRegion(regionId)
    if (hrId && hrId !== level1ApproverId) {
      approvers.push({ approverId: hrId, level: 2 })
    }
  }

  return approvers
}

// ============================================================
// Create Leave Request
// ============================================================

export async function createLeaveRequest(
  userId: number,
  data: {
    leaveTypeId: number
    startDate: string
    endDate: string
    halfDayPeriod?: 'AM' | 'PM' | null
    reason?: string
    attachmentUrl?: string
    startTime?: string | null
    endTime?: string | null
  }
) {
  // 1. Get user
  const [user] = await db
    .select({ id: users.id, regionId: users.regionId, isActive: users.isActive, isOnProbation: users.isOnProbation })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user || !user.isActive) throw new AppError(403, 'Your account is not active')

  // 2. Get leave type (must apply to user's region or be global)
  const [leaveType] = await db
    .select()
    .from(leaveTypes)
    .where(
      and(
        eq(leaveTypes.id, data.leaveTypeId),
        or(isNull(leaveTypes.regionId), eq(leaveTypes.regionId, user.regionId))
      )
    )
    .limit(1)

  if (!leaveType) throw new ValidationError('This leave type is not available in your region')

  // Check regionRestriction (comma-separated region codes)
  if (leaveType.regionRestriction) {
    const [userRegion] = await db
      .select({ code: regions.code })
      .from(regions)
      .where(eq(regions.id, user.regionId))
      .limit(1)
    const userCode = userRegion?.code ?? ''
    const allowedCodes = leaveType.regionRestriction.split(',').map((s) => s.trim())
    if (!allowedCodes.includes(userCode)) {
      throw new ValidationError('This leave type is not available in your region')
    }
  }

  // Check staff restriction
  if (leaveType.staffRestriction) {
    const allowedIds = leaveType.staffRestriction.split(',').map((s) => parseInt(s.trim(), 10))
    if (!allowedIds.includes(userId)) {
      throw new ValidationError('This leave type is not available for your account')
    }
  }

  const approvalFlow = (leaveType.approvalFlow ?? 'standard') as string
  const minNoticeDays = leaveType.minNoticeDays ?? 0
  const maxConsecutiveDays = leaveType.maxConsecutiveDays ?? null

  // 3. Ensure startDate <= endDate
  if (data.startDate > data.endDate) {
    throw new ValidationError('End date must be on or after start date')
  }

  // 4. Fetch public holidays in range
  const holidays = await getHolidaysInRange(user.regionId, data.startDate, data.endDate)

  // 5. Calculate days based on leave type's day calculation mode
  const dayCalc = leaveType.dayCalculation ?? 'working_days'
  let totalDays: number
  if (dayCalc === 'calendar_days') {
    totalDays = calculateCalendarDays(data.startDate, data.endDate)
  } else {
    totalDays = calculateWorkingDays(data.startDate, data.endDate, holidays)
    if (data.halfDayPeriod && data.startDate === data.endDate && totalDays === 1) {
      totalDays = 0.5
    }
    if (totalDays === 0) {
      throw new ValidationError(
        'The selected date range contains no working days (weekends and public holidays are excluded)'
      )
    }
  }

  // Notice period validation
  if (minNoticeDays > 0) {
    const today = getTodayString()
    // Add minNoticeDays calendar days to today
    const todayDate = new Date(today)
    todayDate.setDate(todayDate.getDate() + minNoticeDays)
    const earliestStart = todayDate.toISOString().split('T')[0]!
    if (data.startDate < earliestStart) {
      throw new ValidationError(
        `${leaveType.name} requires at least ${minNoticeDays} day${minNoticeDays !== 1 ? 's' : ''} notice`
      )
    }
  }

  // 6. Overlap detection
  await checkOverlap(userId, data.startDate, data.endDate)

  // 7. Attachment requirement
  if (leaveType.requiresAttachment && totalDays > 1 && !data.attachmentUrl) {
    throw new ValidationError(
      `A medical certificate or supporting document is required for ${leaveType.name} requests longer than 1 day`
    )
  }

  // Max consecutive days validation
  if (maxConsecutiveDays !== null && totalDays > maxConsecutiveDays) {
    throw new ValidationError(
      `${leaveType.name} cannot exceed ${maxConsecutiveDays} consecutive day${maxConsecutiveDays !== 1 ? 's' : ''}`
    )
  }

  const currentYear = new Date().getFullYear()

  // Auto-approve flow (e.g. WFH) — skip balance check, immediately approved
  if (approvalFlow === 'auto_approve') {
    const [request] = await db
      .insert(leaveRequests)
      .values({
        userId,
        leaveTypeId: data.leaveTypeId,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: totalDays.toFixed(1),
        halfDayPeriod: data.halfDayPeriod ?? null,
        reason: data.reason,
        status: 'approved',
        attachmentUrl: data.attachmentUrl,
        approvalStep: 1,
        startTime: data.startTime ?? null,
        endTime: data.endTime ?? null,
      })
      .returning()

    if (!request) throw new AppError(500, 'Failed to create leave request')

    const [requester] = await db
      .select({ name: users.name, managerId: users.managerId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    await processAutoApprove(
      request.id,
      requester?.managerId ?? null,
      requester?.name ?? 'Employee',
      leaveType.name,
      data.startDate,
      data.endDate
    )

    return { ...request, totalDays }
  }

  // 8. Balance check (for paid leave only) — warn manager but allow submission
  let overBalanceWarning: string | null = null
  if (leaveType.isPaid) {
    const balance = await getOrCreateBalance(userId, data.leaveTypeId, currentYear, user.regionId)
    if (balance.available < totalDays) {
      overBalanceWarning = `⚠️ Balance warning: ${balance.available} day(s) available, ${totalDays} day(s) requested.`
    }
  } else {
    // Still initialise balance record for tracking purposes
    await getOrCreateBalance(userId, data.leaveTypeId, currentYear, user.regionId).catch(
      () => null // OK if no policy for unpaid leave
    )
  }

  // 8b. Check if employee is manually flagged as on probation (notification only — does NOT block)
  const probationNotice: string | null = user.isOnProbation
    ? `⚠️ PROBATION NOTICE: This employee is currently in their probation period. Please review accordingly.`
    : null

  // 9. Build approval chain first to get level-1 approver
  const approverChain = await buildApprovalChain(userId, user.regionId, totalDays)
  const level1ApproverId = approverChain[0]?.approverId ?? null

  // 10. Create leave request
  const [request] = await db
    .insert(leaveRequests)
    .values({
      userId,
      leaveTypeId: data.leaveTypeId,
      startDate: data.startDate,
      endDate: data.endDate,
      totalDays: totalDays.toFixed(1),
      halfDayPeriod: data.halfDayPeriod ?? null,
      reason: data.reason,
      status: 'pending',
      attachmentUrl: data.attachmentUrl,
      approvalStep: 1,
      currentApproverId: level1ApproverId,
      startTime: data.startTime ?? null,
      endTime: data.endTime ?? null,
    })
    .returning()

  if (!request) throw new AppError(500, 'Failed to create leave request')

  // 11. Update pending balance
  if (leaveType.isPaid) {
    await addPending(userId, data.leaveTypeId, currentYear, totalDays)
  }

  // 12. Insert approval chain
  if (approverChain.length > 0) {
    await db.insert(approvalWorkflows).values(
      approverChain.map((a) => ({
        leaveRequestId: request.id,
        approverId: a.approverId,
        level: a.level,
        status: 'pending' as const,
      }))
    )

    // 13. Notify based on flow type
    const level1 = approverChain[0]!
    const [requester] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)

    if (approvalFlow === 'hr_required') {
      // Special notification for hr_required: mentions two-step process
      await initHrRequiredFlow(
        request.id,
        level1.approverId,
        requester?.name ?? 'Employee',
        leaveType.name,
        data.startDate,
        data.endDate
      )
    } else {
      const notifTitle = overBalanceWarning
        ? '⚠️ New Leave Request — Insufficient Balance'
        : probationNotice
          ? '⚠️ New Leave Request — Probation Employee'
          : 'New Leave Request Pending Approval'
      const notifParts = [
        `${requester?.name ?? 'An employee'} has submitted a ${leaveType.name} request from ${data.startDate} to ${data.endDate} (${totalDays} day${totalDays !== 1 ? 's' : ''}).`,
        ...(probationNotice ? [`\n${probationNotice}`] : []),
        ...(overBalanceWarning ? [`\n${overBalanceWarning}`] : []),
      ]
      await createNotification({
        userId: level1.approverId,
        type: 'leave_submitted',
        title: notifTitle,
        message: notifParts.join(''),
        metadata: { leaveRequestId: request.id, requesterId: userId, overBalance: !!overBalanceWarning, onProbation: !!probationNotice },
      })
    }
  }

  return { ...request, totalDays }
}

// ============================================================
// Get Leave Requests
// ============================================================

export async function getLeaveRequests(filters: {
  userId?: number
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  leaveTypeId?: number
  startDate?: string
  endDate?: string
  page: number
  pageSize: number
  requestingUserId: number
  requestingRole: string
}) {
  const {
    userId,
    status,
    leaveTypeId,
    startDate,
    endDate,
    page,
    pageSize,
    requestingUserId,
    requestingRole,
  } = filters

  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(requestingRole)
  const isManager = requestingRole === 'manager'
  const offset = (page - 1) * pageSize

  const conditions = []

  // Employees can only see their own requests
  if (!isHrOrAbove && !isManager) {
    conditions.push(eq(leaveRequests.userId, requestingUserId))
  } else if (userId) {
    conditions.push(eq(leaveRequests.userId, userId))
  } else if (isManager && !isHrOrAbove) {
    // Managers see their own + their team's requests
    // We join with users to filter by managerId
    conditions.push(
      or(
        eq(leaveRequests.userId, requestingUserId),
        eq(users.managerId, requestingUserId)
      )
    )
  }

  if (status) conditions.push(eq(leaveRequests.status, status))
  if (leaveTypeId) conditions.push(eq(leaveRequests.leaveTypeId, leaveTypeId))
  if (startDate) conditions.push(gte(leaveRequests.startDate, startDate))
  if (endDate) conditions.push(lte(leaveRequests.endDate, endDate))

  const where = conditions.length > 0 ? and(...conditions) : undefined

  const [{ total }] = await db
    .select({ total: count() })
    .from(leaveRequests)
    .leftJoin(users, eq(leaveRequests.userId, users.id))
    .where(where)

  const rows = await db
    .select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      leaveTypeId: leaveRequests.leaveTypeId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      attachmentUrl: leaveRequests.attachmentUrl,
      createdAt: leaveRequests.createdAt,
      updatedAt: leaveRequests.updatedAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
      },
    })
    .from(leaveRequests)
    .leftJoin(users, eq(leaveRequests.userId, users.id))
    .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(where)
    .orderBy(desc(leaveRequests.createdAt))
    .limit(pageSize)
    .offset(offset)

  const mapped = rows.map((r) => ({
    ...r,
    totalDays: parseDecimal(r.totalDays),
  }))

  return { requests: mapped, total: total ?? 0 }
}

export async function getLeaveRequestById(id: number, requestingUserId: number, requestingRole: string) {
  const [row] = await db
    .select({
      id: leaveRequests.id,
      userId: leaveRequests.userId,
      leaveTypeId: leaveRequests.leaveTypeId,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      status: leaveRequests.status,
      attachmentUrl: leaveRequests.attachmentUrl,
      createdAt: leaveRequests.createdAt,
      updatedAt: leaveRequests.updatedAt,
      user: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
        regionId: users.regionId,
        managerId: users.managerId,
      },
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
        isPaid: leaveTypes.isPaid,
      },
    })
    .from(leaveRequests)
    .leftJoin(users, eq(leaveRequests.userId, users.id))
    .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(eq(leaveRequests.id, id))
    .limit(1)

  if (!row) throw new NotFoundError('Leave request')

  // Access check: own request, or manager of requester, or HR+
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(requestingRole)
  const isOwner = row.userId === requestingUserId
  if (!isOwner && !isHrOrAbove) {
    // Check if manager
    if (row.user?.managerId !== requestingUserId) {
      throw new ForbiddenError()
    }
  }

  // Fetch approval chain
  const approvals = await db
    .select({
      id: approvalWorkflows.id,
      level: approvalWorkflows.level,
      status: approvalWorkflows.status,
      comments: approvalWorkflows.comments,
      actionDate: approvalWorkflows.actionDate,
      approver: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
    })
    .from(approvalWorkflows)
    .leftJoin(users, eq(approvalWorkflows.approverId, users.id))
    .where(eq(approvalWorkflows.leaveRequestId, id))
    .orderBy(approvalWorkflows.level)

  return { ...row, totalDays: parseDecimal(row.totalDays), approvals }
}

// ============================================================
// Cancel Leave Request
// ============================================================

export async function cancelLeaveRequest(
  requestId: number,
  requestingUserId: number,
  requestingRole: string
) {
  const [request] = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, requestId))
    .limit(1)

  if (!request) throw new NotFoundError('Leave request')

  const isOwner = request.userId === requestingUserId
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(requestingRole)

  if (!isOwner && !isHrOrAbove) throw new ForbiddenError()

  if (request.status === 'cancelled') {
    throw new ValidationError('This request is already cancelled')
  }
  if (request.status === 'rejected') {
    throw new ValidationError('A rejected request cannot be cancelled')
  }

  // If approved, check that the leave hasn't already started
  if (request.status === 'approved') {
    const today = getTodayString()
    if (request.startDate <= today && !isHrOrAbove) {
      throw new ValidationError(
        'You cannot cancel approved leave that has already started. Please contact HR.'
      )
    }
  }

  // Delete Google Calendar event if one exists (non-fatal)
  if (request.googleEventId) {
    await deleteLeaveEvent(request.googleEventId)
    await db
      .update(leaveRequests)
      .set({ status: 'cancelled', googleEventId: null })
      .where(eq(leaveRequests.id, requestId))
  } else {
    await db
      .update(leaveRequests)
      .set({ status: 'cancelled' })
      .where(eq(leaveRequests.id, requestId))
  }

  // Cancel all pending approvals
  await db
    .update(approvalWorkflows)
    .set({ status: 'rejected', actionDate: new Date() })
    .where(
      and(
        eq(approvalWorkflows.leaveRequestId, requestId),
        eq(approvalWorkflows.status, 'pending')
      )
    )

  // Release pending or used balance
  const currentYear = new Date(request.startDate).getFullYear()
  const days = parseDecimal(request.totalDays)

  const [lt] = await db
    .select({ isPaid: leaveTypes.isPaid })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, request.leaveTypeId))
    .limit(1)

  if (lt?.isPaid) {
    if (request.status === 'pending') {
      await releasePending(request.userId, request.leaveTypeId, currentYear, days)
    } else if (request.status === 'approved') {
      // Move used back
      const { sql } = await import('drizzle-orm')
      const { leaveBalances } = await import('../db/schema')
      await db
        .update(leaveBalances)
        .set({
          used: sql`GREATEST(0, ${leaveBalances.used} - ${days.toFixed(1)}::numeric)`,
        })
        .where(
          and(
            eq(leaveBalances.userId, request.userId),
            eq(leaveBalances.leaveTypeId, request.leaveTypeId),
            eq(leaveBalances.year, currentYear)
          )
        )
    }
  }

  return { id: requestId, status: 'cancelled' }
}

// ============================================================
// Leave Types (for admin + selection)
// ============================================================

export async function getLeaveTypes(regionId?: number) {
  if (regionId === undefined) {
    return db
      .select()
      .from(leaveTypes)
      .where(eq(leaveTypes.isActive, true))
      .orderBy(leaveTypes.name)
  }

  // Get the region code so we can check regionRestriction
  const [region] = await db
    .select({ code: regions.code })
    .from(regions)
    .where(eq(regions.id, regionId))
    .limit(1)

  const regionCode = region?.code ?? ''

  // Show a leave type if:
  //  (a) it is region-specific for this region (legacy regionId field), OR
  //  (b) it is global (region_id IS NULL) AND:
  //      - its regionRestriction is NULL (available to all), OR
  //      - its regionRestriction contains the user's region code
  //      AND a policy exists for this region
  return db
    .select()
    .from(leaveTypes)
    .where(
      and(
        eq(leaveTypes.isActive, true),
        or(
          eq(leaveTypes.regionId, regionId),
          and(
            isNull(leaveTypes.regionId),
            or(
              isNull(leaveTypes.regionRestriction),
              sql`(
                ${leaveTypes.regionRestriction} = ${regionCode}
                OR ${leaveTypes.regionRestriction} LIKE ${regionCode + ',%'}
                OR ${leaveTypes.regionRestriction} LIKE ${'%,' + regionCode + ',%'}
                OR ${leaveTypes.regionRestriction} LIKE ${'%,' + regionCode}
              )`
            ),
            sql`EXISTS (
              SELECT 1 FROM leave_policies lp
              WHERE lp.leave_type_id = ${leaveTypes.id}
              AND lp.region_id = ${regionId}
            )`
          )
        )
      )
    )
    .orderBy(leaveTypes.name)
}

export async function getLeaveTypesWithPolicies(regionId: number) {
  const types = await getLeaveTypes(regionId)

  const policies = await db
    .select()
    .from(leavePolicies)
    .where(eq(leavePolicies.regionId, regionId))

  const policyMap = new Map(policies.map((p) => [p.leaveTypeId, p]))

  return types.map((lt) => ({
    ...lt,
    policy: policyMap.get(lt.id) ?? null,
  }))
}

// ============================================================
// Team Calendar
// ============================================================

export async function getTeamAbsences(filters: {
  startDate: string
  endDate: string
  regionId?: number
  departmentId?: number
}) {
  const { startDate, endDate, regionId, departmentId } = filters

  const conditions = [
    or(eq(leaveRequests.status, 'approved'), eq(leaveRequests.status, 'pending')),
    lte(leaveRequests.startDate, endDate),
    gte(leaveRequests.endDate, startDate),
  ]

  if (regionId) conditions.push(eq(users.regionId, regionId))
  if (departmentId) conditions.push(eq(users.departmentId, departmentId))

  return db
    .select({
      id: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      halfDayPeriod: leaveRequests.halfDayPeriod,
      status: leaveRequests.status,
      user: {
        id: users.id,
        name: users.name,
        avatarUrl: users.avatarUrl,
        regionId: users.regionId,
        departmentId: users.departmentId,
      },
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
      },
    })
    .from(leaveRequests)
    .leftJoin(users, eq(leaveRequests.userId, users.id))
    .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(and(...conditions))
    .orderBy(leaveRequests.startDate)
}
