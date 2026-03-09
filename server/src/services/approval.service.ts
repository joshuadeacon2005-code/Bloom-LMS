import { eq, and, or, desc, count } from 'drizzle-orm'
import { db } from '../db/index'
import { approvalWorkflows, leaveRequests, users, leaveTypes } from '../db/schema'
import { movePendingToUsed, releasePending } from './balance.service'
import { createNotification } from './notification.service'
import { parseDecimal } from '../utils/workingDays'
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors'

// ============================================================
// Approve a leave request
// ============================================================

export async function approveRequest(
  requestId: number,
  approverId: number,
  comments?: string
) {
  // 1. Get the pending workflow step for this approver
  const [workflow] = await db
    .select()
    .from(approvalWorkflows)
    .where(
      and(
        eq(approvalWorkflows.leaveRequestId, requestId),
        eq(approvalWorkflows.approverId, approverId),
        eq(approvalWorkflows.status, 'pending')
      )
    )
    .limit(1)

  if (!workflow) {
    // HR admin can approve any request directly
    const [approver] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, approverId))
      .limit(1)

    if (!approver || !['hr_admin', 'super_admin'].includes(approver.role)) {
      throw new ForbiddenError('You are not an approver for this request')
    }

    // HR can override — find any pending workflow or create one
    return forceApprove(requestId, approverId, comments)
  }

  // 2. Mark this step approved
  await db
    .update(approvalWorkflows)
    .set({ status: 'approved', comments: comments ?? null, actionDate: new Date() })
    .where(eq(approvalWorkflows.id, workflow.id))

  // 3. Check if there are higher-level pending steps
  const [nextPending] = await db
    .select({ id: approvalWorkflows.id })
    .from(approvalWorkflows)
    .where(
      and(
        eq(approvalWorkflows.leaveRequestId, requestId),
        eq(approvalWorkflows.status, 'pending')
      )
    )
    .limit(1)

  if (nextPending) {
    // Notify next approver
    const [nextWorkflow] = await db
      .select({ approverId: approvalWorkflows.approverId })
      .from(approvalWorkflows)
      .where(eq(approvalWorkflows.id, nextPending.id))
      .limit(1)

    if (nextWorkflow) {
      const [request] = await db
        .select({ userId: leaveRequests.userId, startDate: leaveRequests.startDate, endDate: leaveRequests.endDate })
        .from(leaveRequests)
        .where(eq(leaveRequests.id, requestId))
        .limit(1)

      const [requester] = request
        ? await db
            .select({ name: users.name })
            .from(users)
            .where(eq(users.id, request.userId))
            .limit(1)
        : []

      await createNotification({
        userId: nextWorkflow.approverId,
        type: 'leave_submitted',
        title: 'Leave Request Awaiting Your Approval',
        message: `${requester?.name ?? 'An employee'}'s leave request (${request?.startDate} – ${request?.endDate}) requires your approval.`,
        metadata: { leaveRequestId: requestId },
      })
    }
    return { status: 'awaiting_next_approval' }
  }

  // 4. All levels approved — finalise the leave request
  return finaliseApproval(requestId, approverId)
}

async function forceApprove(requestId: number, approverId: number, comments?: string) {
  // Mark any pending workflows as approved
  await db
    .update(approvalWorkflows)
    .set({ status: 'approved', comments: comments ?? 'HR override', actionDate: new Date() })
    .where(
      and(
        eq(approvalWorkflows.leaveRequestId, requestId),
        eq(approvalWorkflows.status, 'pending')
      )
    )

  return finaliseApproval(requestId, approverId)
}

async function finaliseApproval(requestId: number, _approverId: number) {
  const [request] = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, requestId))
    .limit(1)

  if (!request) throw new NotFoundError('Leave request')
  if (request.status !== 'pending') {
    throw new ValidationError(`Cannot approve a request that is already ${request.status}`)
  }

  await db
    .update(leaveRequests)
    .set({ status: 'approved' })
    .where(eq(leaveRequests.id, requestId))

  // Move pending → used in balance
  const [lt] = await db
    .select({ isPaid: leaveTypes.isPaid })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, request.leaveTypeId))
    .limit(1)

  if (lt?.isPaid) {
    const year = new Date(request.startDate).getFullYear()
    const days = parseDecimal(request.totalDays)
    await movePendingToUsed(request.userId, request.leaveTypeId, year, days)
  }

  // Notify employee
  const [lt2] = await db
    .select({ name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, request.leaveTypeId))
    .limit(1)

  await createNotification({
    userId: request.userId,
    type: 'leave_approved',
    title: 'Leave Request Approved',
    message: `Your ${lt2?.name ?? 'leave'} request from ${request.startDate} to ${request.endDate} has been approved.`,
    metadata: { leaveRequestId: requestId },
  })

  return { status: 'approved', requestId }
}

// ============================================================
// Reject a leave request
// ============================================================

export async function rejectRequest(
  requestId: number,
  approverId: number,
  comments?: string
) {
  // Verify approver
  const [workflow] = await db
    .select()
    .from(approvalWorkflows)
    .where(
      and(
        eq(approvalWorkflows.leaveRequestId, requestId),
        eq(approvalWorkflows.approverId, approverId),
        eq(approvalWorkflows.status, 'pending')
      )
    )
    .limit(1)

  // Check if HR admin overriding
  if (!workflow) {
    const [approver] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, approverId))
      .limit(1)

    if (!approver || !['hr_admin', 'super_admin'].includes(approver.role)) {
      throw new ForbiddenError('You are not an approver for this request')
    }
  }

  const [request] = await db
    .select()
    .from(leaveRequests)
    .where(eq(leaveRequests.id, requestId))
    .limit(1)

  if (!request) throw new NotFoundError('Leave request')
  if (request.status !== 'pending') {
    throw new ValidationError(`Cannot reject a request that is already ${request.status}`)
  }

  // Update workflow
  await db
    .update(approvalWorkflows)
    .set({ status: 'rejected', comments: comments ?? null, actionDate: new Date() })
    .where(
      and(
        eq(approvalWorkflows.leaveRequestId, requestId),
        or(eq(approvalWorkflows.approverId, approverId), eq(approvalWorkflows.status, 'pending'))
      )
    )

  // Mark request rejected
  await db
    .update(leaveRequests)
    .set({ status: 'rejected' })
    .where(eq(leaveRequests.id, requestId))

  // Release pending balance
  const [lt] = await db
    .select({ isPaid: leaveTypes.isPaid, name: leaveTypes.name })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, request.leaveTypeId))
    .limit(1)

  if (lt?.isPaid) {
    const year = new Date(request.startDate).getFullYear()
    const days = parseDecimal(request.totalDays)
    await releasePending(request.userId, request.leaveTypeId, year, days)
  }

  // Notify employee
  await createNotification({
    userId: request.userId,
    type: 'leave_rejected',
    title: 'Leave Request Not Approved',
    message: `Your ${lt?.name ?? 'leave'} request from ${request.startDate} to ${request.endDate} was not approved.${comments ? ` Reason: ${comments}` : ''}`,
    metadata: { leaveRequestId: requestId, comments },
  })

  return { status: 'rejected', requestId }
}

// ============================================================
// Get pending approvals for an approver
// ============================================================

export async function getPendingApprovals(
  approverId: number,
  page = 1,
  pageSize = 20
) {
  const offset = (page - 1) * pageSize

  const [approver] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, approverId))
    .limit(1)

  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(approver?.role ?? '')

  // HR sees all pending; managers see only their assigned workflows
  const where = isHrOrAbove
    ? eq(leaveRequests.status, 'pending')
    : and(
        eq(approvalWorkflows.approverId, approverId),
        eq(approvalWorkflows.status, 'pending'),
        eq(leaveRequests.status, 'pending')
      )

  const [{ total }] = await db
    .select({ total: count() })
    .from(approvalWorkflows)
    .leftJoin(leaveRequests, eq(approvalWorkflows.leaveRequestId, leaveRequests.id))
    .where(where)

  const rows = await db
    .select({
      workflowId: approvalWorkflows.id,
      level: approvalWorkflows.level,
      requestId: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      reason: leaveRequests.reason,
      attachmentUrl: leaveRequests.attachmentUrl,
      submittedAt: leaveRequests.createdAt,
      employee: {
        id: users.id,
        name: users.name,
        email: users.email,
        avatarUrl: users.avatarUrl,
      },
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
        isPaid: leaveTypes.isPaid,
      },
    })
    .from(approvalWorkflows)
    .leftJoin(leaveRequests, eq(approvalWorkflows.leaveRequestId, leaveRequests.id))
    .leftJoin(users, eq(leaveRequests.userId, users.id))
    .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(where)
    .orderBy(leaveRequests.createdAt)
    .limit(pageSize)
    .offset(offset)

  return {
    approvals: rows.map((r) => ({ ...r, totalDays: parseDecimal(r.totalDays ?? '0') })),
    total: total ?? 0,
  }
}

export async function getApprovalHistory(
  approverId: number,
  page = 1,
  pageSize = 20
) {
  const offset = (page - 1) * pageSize

  const where = and(
    eq(approvalWorkflows.approverId, approverId),
    or(eq(approvalWorkflows.status, 'approved'), eq(approvalWorkflows.status, 'rejected'))
  )

  const rows = await db
    .select({
      workflowId: approvalWorkflows.id,
      status: approvalWorkflows.status,
      comments: approvalWorkflows.comments,
      actionDate: approvalWorkflows.actionDate,
      requestId: leaveRequests.id,
      startDate: leaveRequests.startDate,
      endDate: leaveRequests.endDate,
      totalDays: leaveRequests.totalDays,
      employee: {
        id: users.id,
        name: users.name,
        email: users.email,
      },
      leaveType: {
        id: leaveTypes.id,
        name: leaveTypes.name,
        code: leaveTypes.code,
      },
    })
    .from(approvalWorkflows)
    .leftJoin(leaveRequests, eq(approvalWorkflows.leaveRequestId, leaveRequests.id))
    .leftJoin(users, eq(leaveRequests.userId, users.id))
    .leftJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
    .where(where)
    .orderBy(desc(approvalWorkflows.actionDate))
    .limit(pageSize)
    .offset(offset)

  return {
    history: rows.map((r) => ({ ...r, totalDays: parseDecimal(r.totalDays ?? '0') })),
  }
}
