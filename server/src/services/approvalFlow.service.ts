import { eq, and, or, isNull } from 'drizzle-orm'
import { db } from '../db/index'
import { leaveTypes, users, leaveRequests } from '../db/schema'
import { createNotification } from './notification.service'

export type ApprovalFlow = 'standard' | 'auto_approve' | 'hr_required' | 'multi_level'

/**
 * Get the approval flow for a leave type.
 */
export async function getApprovalFlow(leaveTypeId: number): Promise<ApprovalFlow> {
  const [lt] = await db
    .select({ approvalFlow: leaveTypes.approvalFlow })
    .from(leaveTypes)
    .where(eq(leaveTypes.id, leaveTypeId))
    .limit(1)
  return (lt?.approvalFlow ?? 'standard') as ApprovalFlow
}

/**
 * Get an HR admin for a region.
 */
export async function getHrAdminForRegion(regionId: number): Promise<number | null> {
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
  return hr?.id ?? null
}

/**
 * Get a human-readable status label for display.
 */
export function getStatusLabel(status: string, approvalStep?: number, approvalFlow?: string): string {
  if (status === 'pending_hr') return 'Pending (HR)'
  if (status === 'pending') {
    if (approvalFlow === 'hr_required' && approvalStep === 1) return 'Pending (Manager)'
    return 'Pending (Manager)'
  }
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'cancelled') return 'Cancelled'
  return status
}

/**
 * Get a submission confirmation message describing the flow.
 */
export function getFlowConfirmationMessage(approvalFlow: ApprovalFlow): string {
  switch (approvalFlow) {
    case 'auto_approve':
      return 'Auto-approved — your manager has been notified.'
    case 'hr_required':
      return 'Sent to your manager for approval (HR sign-off also required).'
    case 'multi_level':
      return 'Sent for multi-level approval (manager → HR).'
    default:
      return 'Sent to your manager for approval.'
  }
}

/**
 * Process auto-approve flow — immediately approves, notifies manager as info-only.
 */
export async function processAutoApprove(
  requestId: number,
  managerId: number | null,
  employeeName: string,
  leaveTypeName: string,
  startDate: string,
  endDate: string
): Promise<void> {
  // Immediately set status to approved
  await db
    .update(leaveRequests)
    .set({ status: 'approved', approvalStep: 1 })
    .where(eq(leaveRequests.id, requestId))

  // Notify manager as info-only (no buttons needed)
  if (managerId) {
    await createNotification({
      userId: managerId,
      type: 'leave_submitted',
      title: `FYI: ${leaveTypeName} Auto-Approved`,
      message: `${employeeName} has submitted a ${leaveTypeName} request from ${startDate} to ${endDate}. This was auto-approved — no action required.`,
      metadata: { leaveRequestId: requestId, autoApproved: true },
    })
  }
}

/**
 * Initialize HR-required flow — step 1 goes to manager.
 */
export async function initHrRequiredFlow(
  requestId: number,
  managerId: number,
  employeeName: string,
  leaveTypeName: string,
  startDate: string,
  endDate: string
): Promise<void> {
  await db
    .update(leaveRequests)
    .set({ status: 'pending', approvalStep: 1, currentApproverId: managerId })
    .where(eq(leaveRequests.id, requestId))

  await createNotification({
    userId: managerId,
    type: 'leave_submitted',
    title: 'New Leave Request Pending Approval (Step 1 of 2)',
    message: `${employeeName} has submitted a ${leaveTypeName} request from ${startDate} to ${endDate}. This requires your approval first, then HR sign-off.`,
    metadata: { leaveRequestId: requestId, requiresHr: true },
  })
}

/**
 * Progress HR-required flow from manager approval to HR step.
 * Call this when manager approves an hr_required request.
 */
export async function progressToHrStep(
  requestId: number,
  regionId: number,
  employeeName: string,
  leaveTypeName: string,
  startDate: string,
  endDate: string
): Promise<{ hrAdminId: number | null }> {
  const hrAdminId = await getHrAdminForRegion(regionId)

  await db
    .update(leaveRequests)
    .set({
      status: 'pending_hr' as any,
      approvalStep: 2,
      currentApproverId: hrAdminId ?? null,
    })
    .where(eq(leaveRequests.id, requestId))

  if (hrAdminId) {
    await createNotification({
      userId: hrAdminId,
      type: 'leave_submitted',
      title: 'Leave Request Awaiting HR Approval (Step 2 of 2)',
      message: `${employeeName}'s ${leaveTypeName} request from ${startDate} to ${endDate} has been approved by their manager and now requires your HR sign-off.`,
      metadata: { leaveRequestId: requestId, requiresHr: true, hrStep: true },
    })
  }

  return { hrAdminId }
}
