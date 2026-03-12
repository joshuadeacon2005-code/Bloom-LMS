import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '@/lib/api'

// ── Types ────────────────────────────────────────────────────

export interface OvertimeEntry {
  id: number
  date: string
  hoursWorked: number
  daysRequested: number
  reason: string
  compensationType: 'time_off' | 'cash'
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'converted' | 'pending_hr'
  rejectionReason?: string | null
  createdAt: string
  approvedAt?: string | null
  approvedBy?: { id: number; name: string } | null
}

export interface OvertimeBalance {
  pendingDays: number
  approvedDays: number
  pendingCount: number
}

export interface PendingOvertimeEntry extends OvertimeEntry {
  user: { id: number; name: string; email: string }
  regionId: number
  requiresHrApproval: boolean
}

// ── Query Keys ───────────────────────────────────────────────

export const overtimeKeys = {
  all: ['overtime'] as const,
  history: (filters?: object) => [...overtimeKeys.all, 'history', filters] as const,
  balance: () => [...overtimeKeys.all, 'balance'] as const,
  pending: () => [...overtimeKeys.all, 'pending'] as const,
}

// ── Hooks ────────────────────────────────────────────────────

export function useOvertimeBalance() {
  return useQuery({
    queryKey: overtimeKeys.balance(),
    queryFn: () =>
      api
        .get<{ data: OvertimeBalance }>('/overtime/balance')
        .then((r) => r.data.data),
  })
}

export function useOvertimeHistory(filters?: {
  status?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}) {
  return useQuery({
    queryKey: overtimeKeys.history(filters),
    queryFn: () =>
      api
        .get<{ data: OvertimeEntry[]; meta: { total: number; page: number; pageSize: number } }>(
          '/overtime',
          { params: filters }
        )
        .then((r) => r.data),
  })
}

export function usePendingOvertime() {
  return useQuery({
    queryKey: overtimeKeys.pending(),
    queryFn: () =>
      api
        .get<{ data: PendingOvertimeEntry[] }>('/overtime/pending')
        .then((r) => r.data.data),
  })
}

export function useSubmitOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: {
      date: string
      hoursWorked: number
      daysRequested: number
      reason: string
      compensationType: 'time_off' | 'cash'
    }) => api.post<{ data: OvertimeEntry }>('/overtime', data).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overtimeKeys.all })
      toast.success('Overtime compensation request submitted.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to submit overtime request'
      toast.error(msg)
    },
  })
}

export function useApproveOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post(`/overtime/${id}/approve`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overtimeKeys.all })
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      toast.success('Overtime request approved.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to approve'
      toast.error(msg)
    },
  })
}

export function useRejectOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post(`/overtime/${id}/reject`, { reason }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overtimeKeys.all })
      toast.success('Overtime request rejected.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to reject'
      toast.error(msg)
    },
  })
}

export function useHrApproveOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.post(`/overtime/${id}/hr-approve`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overtimeKeys.all })
      toast.success('Cash overtime request approved. HR will process for payroll.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to approve'
      toast.error(msg)
    },
  })
}

export function useHrRejectOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      api.post(`/overtime/${id}/hr-reject`, { reason }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overtimeKeys.all })
      toast.success('Overtime request rejected.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to reject'
      toast.error(msg)
    },
  })
}

export function useCancelOvertime() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) =>
      api.patch(`/overtime/${id}/cancel`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: overtimeKeys.all })
      toast.success('Overtime request cancelled.')
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'Failed to cancel'
      toast.error(msg)
    },
  })
}
