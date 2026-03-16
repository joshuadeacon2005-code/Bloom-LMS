import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '@/lib/api'

export interface LeaveRequest {
  id: number
  userId: number
  leaveTypeId: number
  startDate: string
  endDate: string
  totalDays: number
  reason: string | null
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  attachmentUrl: string | null
  halfDayPeriod?: 'AM' | 'PM' | null
  createdAt: string
  updatedAt: string
  user?: { id: number; name: string; email: string; avatarUrl: string | null }
  leaveType?: { id: number; name: string; code: string }
  approvals?: Array<{
    id: number
    level: number
    status: string
    comments: string | null
    actionDate: string | null
    approver?: { id: number; name: string; email: string }
  }>
}

export interface LeaveRequestFilters {
  status?: 'pending' | 'approved' | 'rejected' | 'cancelled'
  userId?: number
  leaveTypeId?: number
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}

interface ListResponse {
  data: LeaveRequest[]
  meta: { page: number; pageSize: number; total: number }
}

export function useLeaveRequests(filters: LeaveRequestFilters = {}) {
  return useQuery({
    queryKey: ['leave-requests', filters],
    queryFn: () =>
      api
        .get<ListResponse>('/leave/requests', { params: filters })
        .then((r) => r.data),
  })
}

export function useLeaveRequest(id: number) {
  return useQuery({
    queryKey: ['leave-request', id],
    queryFn: () =>
      api.get<{ data: LeaveRequest }>(`/leave/requests/${id}`).then((r) => r.data.data),
    enabled: !!id,
  })
}

export function useCreateLeaveRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: {
      leaveTypeId: number
      startDate: string
      endDate: string
      halfDayPeriod?: 'AM' | 'PM' | null
      reason?: string
      attachmentUrl?: string
      startTime?: string | null
      endTime?: string | null
    }) => api.post<{ data: LeaveRequest }>('/leave/requests', data).then((r) => r.data.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      toast.success('Leave request submitted successfully')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to submit leave request')
    },
  })
}

export function useCancelLeaveRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) =>
      api.patch(`/leave/requests/${id}/cancel`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      toast.success('Leave request cancelled')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to cancel request')
    },
  })
}

export function useTeamCalendar(filters: {
  startDate: string
  endDate: string
  regionId?: number
  departmentId?: number
}) {
  return useQuery({
    queryKey: ['team-calendar', filters],
    queryFn: () =>
      api
        .get<{ data: LeaveRequest[] }>('/leave/calendar/team', { params: filters })
        .then((r) => r.data.data),
  })
}

export interface PublicHoliday {
  id: number
  name: string
  date: string
  regionId: number
  isRecurring: boolean
}

export function usePublicHolidays(params: { regionId?: number; year?: number }) {
  return useQuery({
    queryKey: ['public-holidays', params],
    queryFn: () =>
      api
        .get<{ data: PublicHoliday[] }>('/leave/holidays', { params })
        .then((r) => r.data.data),
    enabled: !!params.regionId,
    staleTime: 60 * 60 * 1000, // 1 hour
  })
}
