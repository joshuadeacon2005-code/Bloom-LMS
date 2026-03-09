import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

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
  available: number
  leaveType?: { id: number; name: string; code: string; isPaid: boolean }
}

export function useBalances(year?: number) {
  const y = year ?? new Date().getFullYear()
  return useQuery({
    queryKey: ['balances', y],
    queryFn: () =>
      api.get<{ data: LeaveBalance[] }>('/balances', { params: { year: y } }).then((r) => r.data.data),
  })
}

export function useUserBalances(userId: number, year?: number) {
  const y = year ?? new Date().getFullYear()
  return useQuery({
    queryKey: ['balances', userId, y],
    queryFn: () =>
      api.get<{ data: LeaveBalance[] }>(`/balances/${userId}`, { params: { year: y } }).then((r) => r.data.data),
    enabled: !!userId,
  })
}
