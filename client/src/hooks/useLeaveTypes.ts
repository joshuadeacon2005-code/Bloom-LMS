import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

export interface LeaveTypeWithPolicy {
  id: number
  name: string
  code: string
  description: string | null
  isPaid: boolean
  requiresAttachment: boolean
  maxDaysPerYear: number | null
  regionId: number | null
  policy: {
    id: number
    entitlementDays: string
    carryOverMax: string
    probationMonths: number
  } | null
}

export function useLeaveTypes(regionId?: number) {
  return useQuery({
    queryKey: ['leave-types', regionId],
    queryFn: () =>
      api
        .get<{ data: LeaveTypeWithPolicy[] }>('/leave/types', {
          params: regionId ? { regionId } : undefined,
        })
        .then((r) => r.data.data),
  })
}
