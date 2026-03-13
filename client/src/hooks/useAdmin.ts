import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Region {
  id: number
  name: string
  code: string
  timezone: string
  currency: string
}

export interface Department {
  id: number
  name: string
  regionId: number
}

export interface AdminUser {
  id: number
  email: string
  name: string
  role: 'employee' | 'manager' | 'hr_admin' | 'super_admin'
  regionId: number
  departmentId: number | null
  managerId: number | null
  managerName: string | null
  isActive: boolean
  isOnProbation: boolean
  joinedDate: string | null
  slackUserId: string | null
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
  approvalFlow: 'standard' | 'auto_approve' | 'hr_required' | 'multi_level'
  minNoticeDays: number
  maxConsecutiveDays: number | null
  dayCalculation: 'working_days' | 'calendar_days'
  staffRestriction: string | null
}

export interface LeavePolicy {
  id: number
  leaveTypeId: number
  regionId: number
  entitlementDays: string
  carryOverMax: string
  accrualRate: string | null
  probationMonths: number
  entitlementUnlimited: boolean
  carryoverUnlimited: boolean
}

export interface PublicHoliday {
  id: number
  name: string
  date: string
  regionId: number
  isRecurring: boolean
}

// ─── Regions ──────────────────────────────────────────────────────────────────

export function useRegions() {
  return useQuery({
    queryKey: ['admin-regions'],
    queryFn: () =>
      api.get<{ data: Region[] }>('/admin/regions').then((r) => r.data.data),
  })
}

// ─── Departments ──────────────────────────────────────────────────────────────

export function useDepartments(regionId?: number) {
  return useQuery({
    queryKey: ['admin-departments', regionId],
    queryFn: () =>
      api
        .get<{ data: Department[] }>('/admin/departments', {
          params: regionId ? { regionId } : {},
        })
        .then((r) => r.data.data),
  })
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface UserFilters {
  search?: string
  regionId?: number
  role?: string
  isActive?: boolean
  page?: number
  pageSize?: number
}

export function useAdminUsers(filters: UserFilters = {}) {
  return useQuery({
    queryKey: ['admin-users', filters],
    queryFn: () =>
      api
        .get<{ data: AdminUser[]; meta: { total: number; page: number; pageSize: number } }>(
          '/users',
          { params: filters }
        )
        .then((r) => r.data),
  })
}

export interface ManagerOption {
  id: number
  name: string
  email: string
  role: string
  regionId: number
  regionName: string | null
}

export function useManagers() {
  return useQuery({
    queryKey: ['managers'],
    queryFn: () =>
      api
        .get<{ data: ManagerOption[] }>('/users/managers')
        .then((r) => r.data.data),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      email: string
      password: string
      name: string
      role?: string
      regionId: number
      departmentId?: number
      managerId?: number
      isOnProbation?: boolean
      joinedDate?: string | null
    }) => api.post<{ data: AdminUser }>('/users', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User created')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to create user')
    },
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: number
      data: Partial<{
        name: string
        email: string
        role: string
        regionId: number
        departmentId: number | null
        managerId: number | null
        isActive: boolean
        isOnProbation: boolean
        joinedDate: string | null
      }>
    }) => api.patch<{ data: AdminUser }>(`/users/${id}`, data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User updated')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to update user')
    },
  })
}

export function useDeactivateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.patch(`/users/${id}`, { isActive: false }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('User deactivated')
    },
    onError: () => toast.error('Failed to deactivate user'),
  })
}

// ─── Leave Types ──────────────────────────────────────────────────────────────

export function useAdminLeaveTypes(regionId?: number) {
  return useQuery({
    queryKey: ['admin-leave-types', regionId],
    queryFn: () =>
      api
        .get<{ data: LeaveType[] }>('/admin/leave-types', {
          params: regionId ? { regionId } : {},
        })
        .then((r) => r.data.data),
  })
}

export function useCreateLeaveType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<LeaveType, 'id'>) =>
      api.post<{ data: LeaveType }>('/admin/leave-types', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] })
      toast.success('Leave type created')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to create leave type')
    },
  })
}

export function useUpdateLeaveType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Omit<LeaveType, 'id'>> }) =>
      api.patch<{ data: LeaveType }>(`/admin/leave-types/${id}`, data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] })
      toast.success('Leave type updated')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to update leave type')
    },
  })
}

export function useDeleteLeaveType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/leave-types/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-leave-types'] })
      toast.success('Leave type deleted')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to delete leave type')
    },
  })
}

// ─── Policies ─────────────────────────────────────────────────────────────────

export function usePolicies(regionId?: number) {
  return useQuery({
    queryKey: ['admin-policies', regionId],
    queryFn: () =>
      api
        .get<{ data: LeavePolicy[] }>('/admin/policies', {
          params: regionId ? { regionId } : {},
        })
        .then((r) => r.data.data),
  })
}

export function useUpsertPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id?: number
      data: Omit<LeavePolicy, 'id'>
    }) =>
      id
        ? api.patch<{ data: LeavePolicy }>(`/admin/policies/${id}`, data).then((r) => r.data.data)
        : api.post<{ data: LeavePolicy }>('/admin/policies', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-policies'] })
      toast.success('Policy saved')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to save policy')
    },
  })
}

export function useDeletePolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/policies/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-policies'] })
      toast.success('Policy deleted')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to delete policy')
    },
  })
}

// ─── Public Holidays ──────────────────────────────────────────────────────────

export function useHolidays(regionId?: number, year?: number) {
  return useQuery({
    queryKey: ['admin-holidays', regionId, year],
    queryFn: () =>
      api
        .get<{ data: PublicHoliday[] }>('/admin/holidays', {
          params: { ...(regionId ? { regionId } : {}), ...(year ? { year } : {}) },
        })
        .then((r) => r.data.data),
    enabled: !!regionId,
  })
}

export function useCreateHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Omit<PublicHoliday, 'id'>) =>
      api.post<{ data: PublicHoliday }>('/admin/holidays', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-holidays'] })
      toast.success('Holiday added')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to add holiday')
    },
  })
}

export function useDeleteHoliday() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/admin/holidays/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-holidays'] })
      toast.success('Holiday deleted')
    },
    onError: () => toast.error('Failed to delete holiday'),
  })
}

// ─── Slack ────────────────────────────────────────────────────────────────────

export interface SlackStatus {
  connected: boolean
  botName?: string
  teamName?: string
  botId?: string
  reason?: string
}

export interface SlackSyncResult {
  synced: number
  notFound: string[]
  errors: string[]
}

export function useSlackStatus() {
  return useQuery({
    queryKey: ['slack-status'],
    queryFn: () =>
      api.get<{ data: SlackStatus }>('/admin/slack/status').then((r) => r.data.data),
    staleTime: 60_000,
    retry: false,
  })
}

export function useSlackTestDm() {
  return useMutation({
    mutationFn: (userId: number) =>
      api.post<{ data: { sent: boolean } }>(`/admin/slack/test-dm/${userId}`).then((r) => r.data.data),
    onSuccess: () => {
      toast.success('Test DM sent')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to send test DM')
    },
  })
}

export function useSlackSync() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () =>
      api
        .post<{ data: SlackSyncResult }>('/admin/slack/sync')
        .then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] })
      if (data.synced > 0) {
        toast.success(`${data.synced} user${data.synced === 1 ? '' : 's'} linked to Slack`)
      } else {
        toast.info('No new Slack connections found')
      }
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Slack sync failed')
    },
  })
}

export function useSlackCommandsEnabled() {
  return useQuery({
    queryKey: ['slack-commands-enabled'],
    queryFn: () =>
      api.get<{ data: { enabled: boolean } }>('/admin/slack/commands-enabled').then((r) => r.data.data),
    staleTime: 0,
    retry: false,
  })
}

export function useToggleSlackCommands() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.post<{ data: { enabled: boolean } }>('/admin/slack/commands-enabled', { enabled }).then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['slack-commands-enabled'] })
      toast.success(`Slack commands ${data.enabled ? 'activated' : 'deactivated'}`)
    },
    onError: () => {
      toast.error('Failed to update Slack commands setting')
    },
  })
}

// ─── Entitlements ─────────────────────────────────────────────────────────────

export interface EntitlementRow {
  balanceId: number
  userId: number
  userName: string
  userEmail: string
  leaveTypeId: number
  leaveTypeName: string
  leaveTypeCode: string
  year: number
  entitled: string
  used: string
  pending: string
  carried: string
  adjustments: string
}

export interface AuditLogEntry {
  id: number
  employeeId: number
  employeeName: string
  leaveTypeId: number
  leaveTypeName: string | null
  fieldChanged: string
  oldValue: string | null
  newValue: string | null
  reason: string
  changedById: number
  changedByName: string
  createdAt: string
}

export function useEntitlements(regionId?: number, year?: number) {
  return useQuery({
    queryKey: ['admin-entitlements', regionId, year],
    queryFn: () =>
      api
        .get<{ data: EntitlementRow[] }>('/admin/entitlements', {
          params: { ...(regionId ? { regionId } : {}), ...(year ? { year } : {}) },
        })
        .then((r) => r.data.data),
  })
}

export function useUpdateEntitlement() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      userId: number
      leaveTypeId: number
      year: number
      field: 'entitled' | 'carried' | 'adjustments'
      newValue: number
      reason: string
    }) =>
      api
        .patch<{ data: EntitlementRow }>(`/admin/entitlements/${payload.userId}`, payload)
        .then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-entitlements'] })
      toast.success('Entitlement updated')
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to update entitlement')
    },
  })
}

export function useBulkUpdateEntitlements() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: {
      updates: Array<{
        userId: number
        leaveTypeId: number
        year: number
        field: 'entitled' | 'carried' | 'adjustments'
        newValue: number
      }>
      reason: string
    }) =>
      api
        .post<{ data: { updated: number } }>('/admin/entitlements/bulk', payload)
        .then((r) => r.data.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['admin-entitlements'] })
      toast.success(`${data.updated} entitlement${data.updated === 1 ? '' : 's'} updated`)
    },
    onError: (e: { response?: { data?: { error?: string } } }) => {
      toast.error(e.response?.data?.error ?? 'Failed to bulk update entitlements')
    },
  })
}

export function useEntitlementAudit(employeeId?: number) {
  return useQuery({
    queryKey: ['entitlement-audit', employeeId],
    queryFn: () =>
      api
        .get<{ data: AuditLogEntry[] }>('/admin/entitlements/audit', {
          params: employeeId ? { employeeId } : {},
        })
        .then((r) => r.data.data),
  })
}
