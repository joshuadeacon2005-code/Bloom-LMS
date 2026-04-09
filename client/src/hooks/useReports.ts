import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'

export interface UtilisationByType {
  name: string
  code: string
  entitled: number
  used: number
  pending: number
  remaining: number
  utilisationPct: number
}

export interface UtilisationByMonth {
  month: number
  leaveType: string
  totalDays: number
  count: number
}

export interface UtilisationSummary {
  totalEmployees: number
  totalDaysUsed: number
  totalDaysEntitled: number
  overallUtilisationPct: number
  year: number
}

export interface UtilisationData {
  byType: UtilisationByType[]
  byMonth: UtilisationByMonth[]
  summary: UtilisationSummary
}

export interface DepartmentSummary {
  departmentId: number
  departmentName: string
  employeeCount: number
  totalDaysUsed: number
  totalDaysEntitled: number
  utilisationPct: number
  byType: Array<{ name: string; used: number; entitled: number }>
}

export interface ReportFilters {
  year?: number
  regionId?: number
  departmentId?: number
}

export function useUtilisationReport(filters: ReportFilters = {}) {
  return useQuery({
    queryKey: ['reports-utilisation', filters],
    queryFn: () =>
      api
        .get<{ success: boolean; data: UtilisationData }>('/reports/utilisation', {
          params: filters,
        })
        .then((r) => r.data.data),
  })
}

export function useDepartmentSummary(filters: Pick<ReportFilters, 'year' | 'regionId'> = {}) {
  return useQuery({
    queryKey: ['reports-dept-summary', filters],
    queryFn: () =>
      api
        .get<{ success: boolean; data: DepartmentSummary[] }>('/reports/department-summary', {
          params: filters,
        })
        .then((r) => r.data.data),
  })
}

function getAuthToken(): string | null {
  const stored = localStorage.getItem('bloom-lms-auth')
  return stored
    ? (JSON.parse(stored) as { state?: { accessToken?: string } }).state?.accessToken ?? null
    : null
}

async function downloadFile(url: string, filename: string) {
  const token = getAuthToken()
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) throw new Error('Export failed')
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(objectUrl)
}

export async function downloadLeaveRequestsXlsx(params: {
  year: number
  regionId?: number
  leaveTypeId?: number
  userId?: number
  status?: string
}) {
  const query = new URLSearchParams()
  query.set('year', String(params.year))
  query.set('format', 'xlsx')
  if (params.regionId) query.set('regionId', String(params.regionId))
  if (params.leaveTypeId) query.set('leaveTypeId', String(params.leaveTypeId))
  if (params.userId) query.set('userId', String(params.userId))
  if (params.status) query.set('status', params.status)

  const regionSuffix = params.regionId ? `_region${params.regionId}` : '_all_regions'
  const staffSuffix = params.userId ? `_staff${params.userId}` : ''
  await downloadFile(
    `/api/reports/export/leave-requests?${query.toString()}`,
    `leave_requests_${params.year}${regionSuffix}${staffSuffix}.xlsx`
  )
}

export async function downloadEntitlementsXlsx(params: {
  year: number
  regionId?: number
  userId?: number
}) {
  const query = new URLSearchParams()
  query.set('year', String(params.year))
  query.set('format', 'xlsx')
  if (params.regionId) query.set('regionId', String(params.regionId))
  if (params.userId) query.set('userId', String(params.userId))

  const regionSuffix = params.regionId ? `_region${params.regionId}` : '_all_regions'
  const staffSuffix = params.userId ? `_staff${params.userId}` : ''
  await downloadFile(
    `/api/reports/export/entitlements?${query.toString()}`,
    `entitlements_${params.year}${regionSuffix}${staffSuffix}.xlsx`
  )
}

export async function downloadPayrollXlsx(params: {
  year: number
  month?: number
  regionId?: number
}) {
  const query = new URLSearchParams()
  query.set('year', String(params.year))
  query.set('format', 'xlsx')
  if (params.month) query.set('month', String(params.month))
  if (params.regionId) query.set('regionId', String(params.regionId))

  const filename = params.month
    ? `payroll-${params.year}-${String(params.month).padStart(2, '0')}.xlsx`
    : `payroll-${params.year}.xlsx`
  await downloadFile(`/api/reports/export/payroll?${query.toString()}`, filename)
}

// Keep CSV helpers for backward compatibility
export async function downloadLeaveRequestsCsv(params: {
  year: number
  regionId?: number
  leaveTypeId?: number
  status?: string
}) {
  const query = new URLSearchParams()
  query.set('year', String(params.year))
  if (params.regionId) query.set('regionId', String(params.regionId))
  if (params.leaveTypeId) query.set('leaveTypeId', String(params.leaveTypeId))
  if (params.status) query.set('status', params.status)

  const regionSuffix = params.regionId ? `_region${params.regionId}` : '_all_regions'
  await downloadFile(
    `/api/reports/export/leave-requests?${query.toString()}`,
    `leave_requests_${params.year}${regionSuffix}.csv`
  )
}

export async function downloadEntitlementsCsv(params: {
  year: number
  regionId?: number
}) {
  const query = new URLSearchParams()
  query.set('year', String(params.year))
  if (params.regionId) query.set('regionId', String(params.regionId))

  const regionSuffix = params.regionId ? `_region${params.regionId}` : '_all_regions'
  await downloadFile(
    `/api/reports/export/entitlements?${query.toString()}`,
    `entitlements_${params.year}${regionSuffix}.csv`
  )
}

export async function downloadPayrollCsv(params: {
  year: number
  month?: number
  regionId?: number
}) {
  const query = new URLSearchParams()
  query.set('year', String(params.year))
  if (params.month) query.set('month', String(params.month))
  if (params.regionId) query.set('regionId', String(params.regionId))

  const filename = params.month
    ? `payroll-${params.year}-${String(params.month).padStart(2, '0')}.csv`
    : `payroll-${params.year}.csv`
  await downloadFile(`/api/reports/export/payroll?${query.toString()}`, filename)
}
