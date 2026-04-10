import { useState, useMemo } from 'react'
import { Download, TrendingUp, Users, Calendar, BarChart3, Search, ChevronUp, Table2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  LineChart,
  Line,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useUtilisationReport,
  useDepartmentSummary,
  useLeaveRequestsPreview,
  useEntitlementsPreview,
  downloadPayrollXlsx,
  downloadLeaveRequestsXlsx,
  downloadEntitlementsXlsx,
} from '@/hooks/useReports'
import { useRegions, useAdminLeaveTypes, useAdminUsers } from '@/hooks/useAdmin'
import { cn } from '@/lib/utils'

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const CHART_COLORS = [
  '#EE6331', '#1E2D3D', '#3B82F6', '#10B981', '#F59E0B',
  '#8B5CF6', '#EC4899', '#14B8A6',
]

const currentYear = new Date().getFullYear()
const YEARS = [currentYear - 1, currentYear, currentYear + 1]
const EXPORT_MONTHS = [
  { value: '__all__', label: 'Full year' },
  ...MONTHS.map((m, i) => ({ value: String(i + 1), label: m })),
]

function SummaryCard({
  icon: Icon,
  title,
  value,
  sub,
}: {
  icon: React.ElementType
  title: string
  value: string | number
  sub?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  )
}

export function ReportsPage() {
  const [year, setYear] = useState(currentYear)
  const [exportMonth, setExportMonth] = useState('__all__')
  const [exporting, setExporting] = useState(false)
  const [exportingLR, setExportingLR] = useState(false)
  const [exportingEnt, setExportingEnt] = useState(false)
  const [lrStatus, setLrStatus] = useState('all')
  const [filterRegionId, setFilterRegionId] = useState<string>('__all__')
  const [exportRegionId, setExportRegionId] = useState<string>('__all__')
  const [exportLeaveTypeId, setExportLeaveTypeId] = useState<string>('__all__')
  const [exportUserId, setExportUserId] = useState<string>('__all__')
  const [exportEntRegionId, setExportEntRegionId] = useState<string>('__all__')
  const [exportEntLeaveTypeId, setExportEntLeaveTypeId] = useState<string>('__all__')
  const [exportEntUserId, setExportEntUserId] = useState<string>('__all__')
  const [lrStaffSearch, setLrStaffSearch] = useState('')
  const [entStaffSearch, setEntStaffSearch] = useState('')
  const [showLrPreview, setShowLrPreview] = useState(false)
  const [showEntPreview, setShowEntPreview] = useState(false)

  const { data: regions } = useRegions()
  const { data: leaveTypesList } = useAdminLeaveTypes()
  const { data: allUsersData } = useAdminUsers({ pageSize: 500, isActive: true })

  const regionIdParam = filterRegionId !== '__all__' ? Number(filterRegionId) : undefined
  const { data: utilData, isLoading: utilLoading } = useUtilisationReport({ year, regionId: regionIdParam })
  const { data: deptData, isLoading: deptLoading } = useDepartmentSummary({ year, regionId: regionIdParam })

  const allUsers = allUsersData?.data ?? []

  const lrFilteredUsers = useMemo(() => {
    if (!lrStaffSearch.trim()) return allUsers
    const q = lrStaffSearch.toLowerCase()
    return allUsers.filter((u) => u.name.toLowerCase().includes(q))
  }, [allUsers, lrStaffSearch])

  const entFilteredUsers = useMemo(() => {
    if (!entStaffSearch.trim()) return allUsers
    const q = entStaffSearch.toLowerCase()
    return allUsers.filter((u) => u.name.toLowerCase().includes(q))
  }, [allUsers, entStaffSearch])

  const lrPreviewParams = {
    year,
    regionId: exportRegionId !== '__all__' ? Number(exportRegionId) : undefined,
    leaveTypeId: exportLeaveTypeId !== '__all__' ? Number(exportLeaveTypeId) : undefined,
    userId: exportUserId !== '__all__' ? Number(exportUserId) : undefined,
    status: lrStatus,
    enabled: showLrPreview,
  }
  const { data: lrPreviewData, isLoading: lrPreviewLoading } = useLeaveRequestsPreview(lrPreviewParams)

  const entPreviewParams = {
    year,
    regionId: exportEntRegionId !== '__all__' ? Number(exportEntRegionId) : undefined,
    leaveTypeId: exportEntLeaveTypeId !== '__all__' ? Number(exportEntLeaveTypeId) : undefined,
    userId: exportEntUserId !== '__all__' ? Number(exportEntUserId) : undefined,
    enabled: showEntPreview,
  }
  const { data: entPreviewData, isLoading: entPreviewLoading } = useEntitlementsPreview(entPreviewParams)

  // Build monthly trend data — pivot by month
  const monthlyData = MONTHS.map((name, idx) => {
    const monthNum = idx + 1
    const row: Record<string, number | string> = { month: name }
    utilData?.byMonth
      .filter((m) => m.month === monthNum)
      .forEach((m) => {
        row[m.leaveType] = (Number(row[m.leaveType] ?? 0) + m.totalDays)
      })
    return row
  })

  // Unique leave type names for the month chart
  const leaveTypeNames = Array.from(
    new Set(utilData?.byMonth.map((m) => m.leaveType) ?? [])
  )

  async function handleExport() {
    setExporting(true)
    try {
      await downloadPayrollXlsx({
        year,
        month: exportMonth && exportMonth !== '__all__' ? Number(exportMonth) : undefined,
      })
      toast.success('Export downloaded')
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleExportLeaveRequests() {
    setExportingLR(true)
    try {
      await downloadLeaveRequestsXlsx({
        year,
        status: lrStatus,
        regionId: exportRegionId !== '__all__' ? Number(exportRegionId) : undefined,
        leaveTypeId: exportLeaveTypeId !== '__all__' ? Number(exportLeaveTypeId) : undefined,
        userId: exportUserId !== '__all__' ? Number(exportUserId) : undefined,
      })
      toast.success('Export downloaded')
    } catch {
      toast.error('Export failed')
    } finally {
      setExportingLR(false)
    }
  }

  async function handleExportEntitlements() {
    setExportingEnt(true)
    try {
      await downloadEntitlementsXlsx({
        year,
        regionId: exportEntRegionId !== '__all__' ? Number(exportEntRegionId) : undefined,
        leaveTypeId: exportEntLeaveTypeId !== '__all__' ? Number(exportEntLeaveTypeId) : undefined,
        userId: exportEntUserId !== '__all__' ? Number(exportEntUserId) : undefined,
      })
      toast.success('Export downloaded')
    } catch {
      toast.error('Export failed')
    } finally {
      setExportingEnt(false)
    }
  }

  const isLoading = utilLoading || deptLoading

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Reports</h2>
          <p className="text-sm text-muted-foreground">
            HR analytics, utilisation trends, and payroll exports
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterRegionId} onValueChange={setFilterRegionId}>
            <SelectTrigger className="w-40"><SelectValue placeholder="All regions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All regions</SelectItem>
              {regions?.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : (
        <>
          {/* Summary cards */}
          {utilData?.summary && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <SummaryCard
                icon={Users}
                title="Employees"
                value={utilData.summary.totalEmployees}
                sub={`in ${year}`}
              />
              <SummaryCard
                icon={Calendar}
                title="Days Used"
                value={utilData.summary.totalDaysUsed.toFixed(1)}
                sub="across all leave types"
              />
              <SummaryCard
                icon={TrendingUp}
                title="Utilisation"
                value={`${utilData.summary.overallUtilisationPct}%`}
                sub="of entitled days"
              />
              <SummaryCard
                icon={BarChart3}
                title="Days Entitled"
                value={utilData.summary.totalDaysEntitled.toFixed(1)}
                sub="total entitlement"
              />
            </div>
          )}

          <Tabs defaultValue="utilisation">
            <TabsList>
              <TabsTrigger value="utilisation">Leave Utilisation</TabsTrigger>
              <TabsTrigger value="trends">Monthly Trends</TabsTrigger>
              <TabsTrigger value="departments">By Department</TabsTrigger>
              <TabsTrigger value="export">Exports</TabsTrigger>
            </TabsList>

            {/* Utilisation by leave type */}
            <TabsContent value="utilisation" className="space-y-4">
              {utilData?.byType && utilData.byType.length > 0 ? (
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Leave Utilisation by Type</CardTitle>
                      <CardDescription>
                        Used vs. entitled days across all employees for {year}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={utilData.byType} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="entitled" name="Entitled" fill="#1E2D3D" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="used" name="Used" fill="#EE6331" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="pending" name="Pending" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  {/* Table breakdown */}
                  <Card>
                    <CardHeader>
                      <CardTitle>Breakdown</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {utilData.byType.map((lt) => {
                          const unitStr = lt.unit === 'hours' ? 'hours' : 'days'
                          const isNonDeducting = lt.deductsBalance === false
                          return (
                            <div key={lt.code} className="space-y-1">
                              <div className="flex items-center justify-between text-sm">
                                <span className="font-medium">{lt.name}</span>
                                <span className="text-muted-foreground">
                                  {isNonDeducting
                                    ? <span title="Non-deducting leave type">∞</span>
                                    : <>{lt.used.toFixed(1)} / {lt.entitled.toFixed(1)} {unitStr} ({lt.utilisationPct}%)</>
                                  }
                                </span>
                              </div>
                              <Progress value={isNonDeducting ? 100 : lt.utilisationPct} className="h-2" />
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    No leave data for {year}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Monthly trends */}
            <TabsContent value="trends">
              <Card>
                <CardHeader>
                  <CardTitle>Monthly Leave Days Taken</CardTitle>
                  <CardDescription>Approved leave days per month in {year}</CardDescription>
                </CardHeader>
                <CardContent>
                  {leaveTypeNames.length > 0 ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={monthlyData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip />
                        <Legend />
                        {leaveTypeNames.map((name, i) => (
                          <Line
                            key={name}
                            type="monotone"
                            dataKey={name}
                            stroke={CHART_COLORS[i % CHART_COLORS.length]}
                            strokeWidth={2}
                            dot={false}
                          />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="py-16 text-center text-muted-foreground">
                      No approved leave data for {year}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Department summary */}
            <TabsContent value="departments">
              {deptData && deptData.length > 0 ? (
                <div className="space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle>Department Overview</CardTitle>
                      <CardDescription>Leave utilisation by department in {year}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ResponsiveContainer width="100%" height={280}>
                        <BarChart
                          data={deptData}
                          layout="vertical"
                          margin={{ top: 5, right: 20, bottom: 5, left: 80 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                          <XAxis type="number" tick={{ fontSize: 12 }} />
                          <YAxis
                            type="category"
                            dataKey="departmentName"
                            tick={{ fontSize: 12 }}
                            width={80}
                          />
                          <Tooltip />
                          <Legend />
                          <Bar dataKey="totalDaysUsed" name="Days Used" fill="#EE6331" radius={[0, 4, 4, 0]} />
                          <Bar dataKey="totalDaysEntitled" name="Days Entitled" fill="#1E2D3D" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {deptData.map((dept) => (
                      <Card key={dept.departmentId}>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{dept.departmentName}</CardTitle>
                          <CardDescription>{dept.employeeCount} employees</CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">Utilisation</span>
                            <span className="font-medium">{dept.utilisationPct}%</span>
                          </div>
                          <Progress value={dept.utilisationPct} className="h-1.5" />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{dept.totalDaysUsed.toFixed(1)} used</span>
                            <span>{dept.totalDaysEntitled.toFixed(1)} entitled</span>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              ) : (
                <Card>
                  <CardContent className="py-16 text-center text-muted-foreground">
                    No department data for {year}
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Exports */}
            <TabsContent value="export" className="space-y-4">
              {/* Payroll export */}
              <Card>
                <CardHeader>
                  <CardTitle>Payroll Export</CardTitle>
                  <CardDescription>Approved leave records for payroll processing</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Year</label>
                      <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {YEARS.map((y) => (
                            <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Month (optional)</label>
                      <Select value={exportMonth} onValueChange={setExportMonth}>
                        <SelectTrigger><SelectValue placeholder="Full year" /></SelectTrigger>
                        <SelectContent>
                          {EXPORT_MONTHS.map((m) => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <Button onClick={handleExport} disabled={exporting} className="w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" />
                    {exporting ? 'Exporting…' : `Download XLSX — ${year}${exportMonth && exportMonth !== '__all__' ? ` ${MONTHS[Number(exportMonth) - 1]}` : ''}`}
                  </Button>
                </CardContent>
              </Card>

              {/* Leave requests export with inline preview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Table2 className="h-5 w-5" />
                    Leave Requests
                  </CardTitle>
                  <CardDescription>Filter, preview, and export leave requests</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Status</label>
                      <Select value={lrStatus} onValueChange={(v) => { setLrStatus(v); setShowLrPreview(false) }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All statuses</SelectItem>
                          <SelectItem value="approved">Approved</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="rejected">Rejected</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Region</label>
                      <Select value={exportRegionId} onValueChange={(v) => { setExportRegionId(v); setShowLrPreview(false) }}>
                        <SelectTrigger><SelectValue placeholder="All regions" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All regions</SelectItem>
                          {regions?.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Leave type</label>
                      <Select value={exportLeaveTypeId} onValueChange={(v) => { setExportLeaveTypeId(v); setShowLrPreview(false) }}>
                        <SelectTrigger><SelectValue placeholder="All leave types" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All leave types</SelectItem>
                          {leaveTypesList?.map((lt) => (
                            <SelectItem key={lt.id} value={String(lt.id)}>{lt.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2 lg:col-span-3">
                      <label className="text-sm font-medium">Staff member</label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by name..."
                          value={lrStaffSearch}
                          onChange={(e) => { setLrStaffSearch(e.target.value); if (exportUserId !== '__all__') setExportUserId('__all__') }}
                          className="pl-9"
                        />
                      </div>
                      {lrStaffSearch.trim() && lrFilteredUsers.length > 0 && exportUserId === '__all__' && (
                        <div className="rounded-md border bg-popover max-h-40 overflow-y-auto">
                          {lrFilteredUsers.slice(0, 10).map((u) => (
                            <button
                              key={u.id}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center justify-between"
                              onClick={() => { setExportUserId(String(u.id)); setLrStaffSearch(u.name); setShowLrPreview(false) }}
                            >
                              <span>{u.name}</span>
                              <span className="text-xs text-muted-foreground">{u.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {exportUserId !== '__all__' && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="gap-1">
                            {allUsers.find((u) => u.id === Number(exportUserId))?.name ?? 'Selected'}
                            <button onClick={() => { setExportUserId('__all__'); setLrStaffSearch(''); setShowLrPreview(false) }} className="ml-1 hover:text-destructive">&times;</button>
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => setShowLrPreview(true)}
                      disabled={lrPreviewLoading}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {lrPreviewLoading ? 'Loading…' : 'Preview Data'}
                    </Button>
                    <Button onClick={handleExportLeaveRequests} disabled={exportingLR}>
                      <Download className="mr-2 h-4 w-4" />
                      {exportingLR ? 'Exporting…' : 'Download XLSX'}
                    </Button>
                  </div>

                  {showLrPreview && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          {lrPreviewData ? `${lrPreviewData.length} records` : 'Loading…'}
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => setShowLrPreview(false)}>
                          <ChevronUp className="h-4 w-4 mr-1" /> Hide
                        </Button>
                      </div>
                      {lrPreviewLoading ? (
                        <div className="space-y-2">
                          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                        </div>
                      ) : lrPreviewData && lrPreviewData.length > 0 ? (
                        <div className="rounded-md border overflow-x-auto max-h-96 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background">
                              <tr className="border-b bg-muted/40">
                                <th className="px-3 py-2 text-left font-medium">Employee</th>
                                <th className="px-3 py-2 text-left font-medium">Region</th>
                                <th className="px-3 py-2 text-left font-medium">Leave Type</th>
                                <th className="px-3 py-2 text-left font-medium">Start</th>
                                <th className="px-3 py-2 text-left font-medium">End</th>
                                <th className="px-3 py-2 text-right font-medium">Days</th>
                                <th className="px-3 py-2 text-center font-medium">Status</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lrPreviewData.map((row, i) => (
                                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                                  <td className="px-3 py-1.5 whitespace-nowrap">{row.employeeName}</td>
                                  <td className="px-3 py-1.5">{row.regionCode}</td>
                                  <td className="px-3 py-1.5">{row.leaveTypeName}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap">{row.startDate}</td>
                                  <td className="px-3 py-1.5 whitespace-nowrap">{row.endDate}</td>
                                  <td className="px-3 py-1.5 text-right">{row.totalDays}</td>
                                  <td className="px-3 py-1.5 text-center">
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        'text-xs',
                                        row.status === 'approved' && 'border-green-300 text-green-700',
                                        row.status === 'pending' && 'border-amber-300 text-amber-700',
                                        row.status === 'rejected' && 'border-red-300 text-red-700',
                                        row.status === 'cancelled' && 'border-gray-300 text-gray-500',
                                      )}
                                    >
                                      {row.status}
                                    </Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">No records found for the selected filters.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Entitlements export with inline preview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Table2 className="h-5 w-5" />
                    Entitlements
                  </CardTitle>
                  <CardDescription>Leave balances and entitlements for all employees</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Region</label>
                      <Select value={exportEntRegionId} onValueChange={(v) => { setExportEntRegionId(v); setShowEntPreview(false) }}>
                        <SelectTrigger><SelectValue placeholder="All regions" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All regions</SelectItem>
                          {regions?.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Leave type</label>
                      <Select value={exportEntLeaveTypeId} onValueChange={(v) => { setExportEntLeaveTypeId(v); setShowEntPreview(false) }}>
                        <SelectTrigger><SelectValue placeholder="All leave types" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__all__">All leave types</SelectItem>
                          {leaveTypesList?.map((lt) => (
                            <SelectItem key={lt.id} value={String(lt.id)}>{lt.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 sm:col-span-2 lg:col-span-1">
                      <label className="text-sm font-medium">Staff member</label>
                      <div className="relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search by name..."
                          value={entStaffSearch}
                          onChange={(e) => { setEntStaffSearch(e.target.value); if (exportEntUserId !== '__all__') setExportEntUserId('__all__') }}
                          className="pl-9"
                        />
                      </div>
                      {entStaffSearch.trim() && entFilteredUsers.length > 0 && exportEntUserId === '__all__' && (
                        <div className="rounded-md border bg-popover max-h-40 overflow-y-auto">
                          {entFilteredUsers.slice(0, 10).map((u) => (
                            <button
                              key={u.id}
                              className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent flex items-center justify-between"
                              onClick={() => { setExportEntUserId(String(u.id)); setEntStaffSearch(u.name); setShowEntPreview(false) }}
                            >
                              <span>{u.name}</span>
                              <span className="text-xs text-muted-foreground">{u.email}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {exportEntUserId !== '__all__' && (
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="gap-1">
                            {allUsers.find((u) => u.id === Number(exportEntUserId))?.name ?? 'Selected'}
                            <button onClick={() => { setExportEntUserId('__all__'); setEntStaffSearch(''); setShowEntPreview(false) }} className="ml-1 hover:text-destructive">&times;</button>
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      onClick={() => setShowEntPreview(true)}
                      disabled={entPreviewLoading}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {entPreviewLoading ? 'Loading…' : 'Preview Data'}
                    </Button>
                    <Button onClick={handleExportEntitlements} disabled={exportingEnt}>
                      <Download className="mr-2 h-4 w-4" />
                      {exportingEnt ? 'Exporting…' : 'Download XLSX'}
                    </Button>
                  </div>

                  {showEntPreview && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                          {entPreviewData ? `${entPreviewData.length} records` : 'Loading…'}
                        </p>
                        <Button size="sm" variant="ghost" onClick={() => setShowEntPreview(false)}>
                          <ChevronUp className="h-4 w-4 mr-1" /> Hide
                        </Button>
                      </div>
                      {entPreviewLoading ? (
                        <div className="space-y-2">
                          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                        </div>
                      ) : entPreviewData && entPreviewData.length > 0 ? (
                        <div className="rounded-md border overflow-x-auto max-h-96 overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-background">
                              <tr className="border-b bg-muted/40">
                                <th className="px-3 py-2 text-left font-medium">Employee</th>
                                <th className="px-3 py-2 text-left font-medium">Region</th>
                                <th className="px-3 py-2 text-left font-medium">Leave Type</th>
                                <th className="px-3 py-2 text-right font-medium">Entitled</th>
                                <th className="px-3 py-2 text-right font-medium">Used</th>
                                <th className="px-3 py-2 text-right font-medium">Adj.</th>
                                <th className="px-3 py-2 text-right font-medium">Carried</th>
                                <th className="px-3 py-2 text-right font-medium">Pending</th>
                                <th className="px-3 py-2 text-right font-medium">Remaining</th>
                              </tr>
                            </thead>
                            <tbody>
                              {entPreviewData.map((row, i) => (
                                <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                                  <td className="px-3 py-1.5 whitespace-nowrap">{row.employeeName}</td>
                                  <td className="px-3 py-1.5">{row.regionCode}</td>
                                  <td className="px-3 py-1.5">{row.leaveTypeName}</td>
                                  <td className="px-3 py-1.5 text-right">{row.entitled}</td>
                                  <td className="px-3 py-1.5 text-right">{row.used}</td>
                                  <td className="px-3 py-1.5 text-right">{row.adjustments}</td>
                                  <td className="px-3 py-1.5 text-right">{row.carried}</td>
                                  <td className="px-3 py-1.5 text-right">{row.pending}</td>
                                  <td className="px-3 py-1.5 text-right font-semibold">
                                    <span className={row.remaining < 0 ? 'text-red-600' : ''}>
                                      {row.remaining}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-8">No records found for the selected filters.</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
