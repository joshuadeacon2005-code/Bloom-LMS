import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '@/lib/api'

// =============================================================================
// Types
// =============================================================================

export type ExpenseLineStatus = 'draft' | 'in_report'

export type ExpenseReportStatus =
  | 'PENDING_REVIEW'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'

export interface ExpenseLine {
  id: number
  userId: number
  reportId: number | null
  status: ExpenseLineStatus
  category: string | null
  amount: string
  currency: string
  expenseDate: string
  description: string | null
  receiptUrl: string | null
  receiptOriginalName: string | null
  createdAt: string
  updatedAt: string
  report?: { id: number; status: ExpenseReportStatus } | null
}

export interface ExpenseReport {
  id: number
  userId: number
  title: string
  status: ExpenseReportStatus
  rejectionNote: string | null
  netsuiteId: string | null
  netsuiteUrl: string | null
  syncAttempts: number
  syncError: string | null
  createdAt: string
  updatedAt: string
  user?: { id: number; name: string; email: string; regionId?: number }
  lines?: ExpenseLine[]
  auditLog?: Array<{
    id: number
    fromStatus: string | null
    toStatus: string
    actorName: string | null
    note: string | null
    createdAt: string
  }>
}

export interface NsLookupItem { id: string; name?: string; symbol?: string }

// =============================================================================
// Lines
// =============================================================================

export function useExpenseLines(status?: ExpenseLineStatus) {
  return useQuery({
    queryKey: ['expense-lines', { status }],
    queryFn: () =>
      api
        .get<{ data: ExpenseLine[] }>('/expenses/lines', { params: status ? { status } : {} })
        .then((r) => r.data.data),
  })
}

export interface CreateLineInput {
  category: string
  amount: number
  currency: string
  expenseDate: string
  description?: string | null
}

export function useCreateLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateLineInput) =>
      api.post<{ data: ExpenseLine }>('/expenses/lines', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-lines'] })
      toast.success('Expense added')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to add expense')
    },
  })
}

export function useUpdateLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<CreateLineInput> }) =>
      api.patch<{ data: ExpenseLine }>(`/expenses/lines/${id}`, data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-lines'] })
      qc.invalidateQueries({ queryKey: ['expense-reports'] })
      toast.success('Expense updated')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to update expense')
    },
  })
}

export function useDeleteLine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.delete(`/expenses/lines/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-lines'] })
      toast.success('Expense deleted')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to delete expense')
    },
  })
}

export function useUploadReceipt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ lineId, file }: { lineId: number; file: File }) => {
      const formData = new FormData()
      formData.append('file', file)
      return api.post<{ data: ExpenseLine }>(`/expenses/lines/${lineId}/receipt`, formData)
        .then((r) => r.data.data)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-lines'] })
      qc.invalidateQueries({ queryKey: ['expense-reports'] })
      toast.success('Receipt attached')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to attach receipt')
    },
  })
}

// =============================================================================
// Reports
// =============================================================================

export function useExpenseReports(status?: string) {
  return useQuery({
    queryKey: ['expense-reports', { status }],
    queryFn: () =>
      api
        .get<{ data: ExpenseReport[] }>('/expenses/reports', { params: status ? { status } : {} })
        .then((r) => r.data.data),
  })
}

export function useExpenseReport(id: number | null) {
  return useQuery({
    queryKey: ['expense-report', id],
    queryFn: () =>
      api.get<{ data: ExpenseReport }>(`/expenses/reports/${id}`).then((r) => r.data.data),
    enabled: id != null,
  })
}

export function useCreateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { lineIds: number[]; title?: string }) =>
      api.post<{ data: ExpenseReport }>('/expenses/reports', data).then((r) => r.data.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense-lines'] })
      qc.invalidateQueries({ queryKey: ['expense-reports'] })
      toast.success('Report created')
    },
    onError: (error: { response?: { data?: { error?: string } } }) => {
      toast.error(error.response?.data?.error ?? 'Failed to create report')
    },
  })
}

function reportAction(action: 'send-approval' | 'approve' | 'reject' | 'resubmit' | 'retry-sync', message: string) {
  return function useAction() {
    const qc = useQueryClient()
    return useMutation({
      mutationFn: ({ id, note }: { id: number; note?: string }) =>
        api
          .post<{ data: ExpenseReport }>(`/expenses/reports/${id}/${action}`, note ? { note } : {})
          .then((r) => r.data.data),
      onSuccess: (_data, vars) => {
        qc.invalidateQueries({ queryKey: ['expense-reports'] })
        qc.invalidateQueries({ queryKey: ['expense-report', vars.id] })
        qc.invalidateQueries({ queryKey: ['expense-lines'] })
        toast.success(message)
      },
      onError: (error: { response?: { data?: { error?: string } } }) => {
        toast.error(error.response?.data?.error ?? `Failed to ${action.replace('-', ' ')}`)
      },
    })
  }
}

export const useSendForApproval = reportAction('send-approval', 'Sent for approval')
export const useApproveReport = reportAction('approve', 'Report approved')
export const useRejectReport = reportAction('reject', 'Report rejected')
export const useResubmitReport = reportAction('resubmit', 'Report resubmitted')
export const useRetrySync = reportAction('retry-sync', 'Sync retry started')

// =============================================================================
// NetSuite dropdown sources
// =============================================================================

export function useNetSuiteCategories() {
  return useQuery({
    queryKey: ['ns-categories'],
    queryFn: () =>
      api.get<{ data: NsLookupItem[] }>('/expenses/netsuite/categories').then((r) => r.data.data),
    staleTime: 30 * 60 * 1000,
  })
}

export function useNetSuiteCurrencies() {
  return useQuery({
    queryKey: ['ns-currencies'],
    queryFn: () =>
      api.get<{ data: NsLookupItem[] }>('/expenses/netsuite/currencies').then((r) => r.data.data),
    staleTime: 30 * 60 * 1000,
  })
}
