// =============================================================================
// Shared TypeScript Types — used by both client and server
// =============================================================================

// ---- Enums / Literals -------------------------------------------------------

export type UserRole = 'employee' | 'manager' | 'hr_admin' | 'super_admin'

export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'delegated'

export type RegionCode = 'HK' | 'SG' | 'MY' | 'ID' | 'CN' | 'AU' | 'NZ'

export type NotificationType =
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'approval_reminder'
  | 'team_digest'
  | 'balance_low'

// ---- API Response Shape -----------------------------------------------------

export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    page?: number
    pageSize?: number
    total?: number
  }
}

// ---- Core Domain Types ------------------------------------------------------

export interface Region {
  id: number
  name: string
  code: RegionCode
  timezone: string
  currency: string
}

export interface Department {
  id: number
  name: string
  regionId: number
}

export interface User {
  id: number
  email: string
  name: string
  slackUserId: string | null
  role: UserRole
  regionId: number
  departmentId: number | null
  managerId: number | null
  isActive: boolean
  avatarUrl: string | null
  createdAt: string
}

export interface LeaveType {
  id: number
  name: string
  code: string
  description: string | null
  isPaid: boolean
  requiresAttachment: boolean
  maxDaysPerYear: number | null
  regionId: number | null
}

export interface LeavePolicy {
  id: number
  leaveTypeId: number
  regionId: number
  entitlementDays: number
  carryOverMax: number
  accrualRate: number | null
  probationMonths: number
}

export interface LeaveBalance {
  id: number
  userId: number
  leaveTypeId: number
  year: number
  entitled: number
  used: number
  pending: number
  carried: number
  adjustments: number
  available: number // computed: entitled + carried + adjustments - used - pending
}

export interface LeaveRequest {
  id: number
  userId: number
  leaveTypeId: number
  startDate: string
  endDate: string
  totalDays: number
  reason: string | null
  status: LeaveStatus
  attachmentUrl: string | null
  createdAt: string
  updatedAt: string
  // Joined fields
  user?: Pick<User, 'id' | 'name' | 'email' | 'avatarUrl'>
  leaveType?: Pick<LeaveType, 'id' | 'name' | 'code'>
}

export interface ApprovalWorkflow {
  id: number
  leaveRequestId: number
  approverId: number
  level: number
  status: ApprovalStatus
  comments: string | null
  actionDate: string | null
  approver?: Pick<User, 'id' | 'name' | 'email'>
}

export interface PublicHoliday {
  id: number
  name: string
  date: string
  regionId: number
  isRecurring: boolean
}

export interface Notification {
  id: number
  userId: number
  type: NotificationType
  title: string
  message: string
  isRead: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
}

// ---- Auth Types -------------------------------------------------------------

export interface AuthTokenPayload {
  userId: number
  email: string
  role: UserRole
  regionId: number
}

export interface LoginRequest {
  email: string
  password: string
}

export interface AuthResponse {
  user: Omit<User, 'createdAt'>
  accessToken: string
  refreshToken: string
}
