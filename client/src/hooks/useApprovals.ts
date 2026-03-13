import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '@/lib/api'

export interface PendingApproval {
  workflowId: number
  level: number
  requestId: number
  startDate: string
  endDate: string
  totalDays: number
  reason: string | null
  attachmentUrl: string | null
  submittedAt: string
  employee: { id: number; name: string; email: string; avatarUrl: string | null; createdAt: string | null }
  leaveType: { id: number; name: string; code: string; isPaid: boolean }
}

export function usePendingApprovals(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['approvals', 'pending', page],
    queryFn: () =>
      api
        .get<{
          data: PendingApproval[]
          meta: { total: number; page: number; pageSize: number }
        }>('/approvals/pending', { params: { page, pageSize } })
        .then((r) => r.data),
  })
}

export function useApprovalHistory(page = 1, pageSize = 20) {
  return useQuery({
    queryKey: ['approvals', 'history', page],
    queryFn: () =>
      api
        .get<{ data: unknown[] }>('/approvals/history', { params: { page, pageSize } })
        .then((r) => r.data),
  })
}

export function useApproveRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ requestId, comments }: { requestId: number; comments?: string }) =>
      api.post(`/approvals/${requestId}/approve`, { comments }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      toast.success('Leave request approved')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to approve request')
    },
  })
}

export function useRejectRequest() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ requestId, comments }: { requestId: number; comments?: string }) =>
      api.post(`/approvals/${requestId}/reject`, { comments }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals'] })
      queryClient.invalidateQueries({ queryKey: ['leave-requests'] })
      queryClient.invalidateQueries({ queryKey: ['balances'] })
      toast.success('Leave request declined')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to reject request')
    },
  })
}
