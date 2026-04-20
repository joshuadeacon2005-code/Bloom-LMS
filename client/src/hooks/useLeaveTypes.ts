import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

export interface DayCalculationResult {
  totalDays: number
  breakdown: {
    calendarDays: number
    weekendDays: number
    publicHolidays: number
    workingDays: number
  }
  excludedDates: string[]
}

export interface LeaveTypeWithPolicy {
  id: number
  name: string
  code: string
  description: string | null
  isPaid: boolean
  requiresAttachment: boolean
  maxDaysPerYear: number | null
  regionId: number | null
  unit: 'days' | 'hours'
  deductsBalance: boolean
  minUnit: '1_day' | 'half_day' | '2_hours' | '1_hour'
  dayCalculation: 'working_days' | 'calendar_days'
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

export function useCalculateDays(params: {
  startDate: string | undefined
  endDate: string | undefined
  leaveTypeId: number | undefined
  halfDayPeriod?: 'AM' | 'PM' | undefined
  regionId?: number
}) {
  const { startDate, endDate, leaveTypeId, halfDayPeriod, regionId } = params
  const enabled = !!startDate && !!endDate && !!leaveTypeId
  return useQuery({
    queryKey: ['calculate-days', startDate, endDate, leaveTypeId, halfDayPeriod, regionId],
    queryFn: () =>
      api
        .get<{ data: DayCalculationResult }>('/leave/calculate-days', {
          params: {
            startDate,
            endDate,
            leaveTypeId,
            ...(halfDayPeriod ? { halfDayPeriod } : {}),
            ...(regionId ? { regionId } : {}),
          },
        })
        .then((r) => r.data.data),
    enabled,
    staleTime: 30_000,
  })
}
