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
  isActive: boolean
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
}

export interface LeavePolicy {
  id: number
  leaveTypeId: number
  regionId: number
  entitlementDays: string
  carryOverMax: string
  accrualRate: string | null
  probationMonths: number
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

export function useManagers(regionId?: number) {
  return useQuery({
    queryKey: ['managers', regionId],
    queryFn: () =>
      api
        .get<{ data: AdminUser[] }>('/users/managers', {
          params: regionId ? { regionId } : {},
        })
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
