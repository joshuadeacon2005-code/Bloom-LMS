import { useState } from 'react'
import { Download, TrendingUp, Users, Calendar, BarChart3, ChevronDown, Check } from 'lucide-react'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  useUtilisationReport,
  useDepartmentSummary,
  downloadPayrollXlsx,
  downloadLeaveRequestsXlsx,
  downloadEntitlementsXlsx,
} from '@/hooks/useReports'
import { useRegions, useAdminLeaveTypes, useAdminUsers } from '@/hooks/useAdmin'

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

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (v: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const toggle = (v: string) => {
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v])
  }
  const displayLabel =
    selected.length === 0 ? `All ${label}` : `${selected.length} ${label} selected`

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="w-full justify-between font-normal h-9 text-sm">
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-2" align="start">
        <div className="space-y-1 max-h-60 overflow-y-auto">
          {options.map((opt) => (
            <div
              key={opt.value}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer"
              onClick={() => toggle(opt.value)}
            >
              <Checkbox checked={selected.includes(opt.value)} readOnly />
              <span className="text-sm select-none">{opt.label}</span>
              {selected.includes(opt.value) && <Check className="h-3 w-3 ml-auto text-primary" />}
            </div>
          ))}
        </div>
        {selected.length > 0 && (
          <Button variant="ghost" size="sm" className="w-full mt-1 h-7 text-xs" onClick={() => onChange([])}>
            Clear selection
          </Button>
        )}
      </PopoverContent>
    </Popover>
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
  // Filter state — shared across view and exports
  const [filterRegionId, setFilterRegionId] = useState<string>('__all__')
  const [filterLeaveTypeId, setFilterLeaveTypeId] = useState<string>('__all__')
  // Leave Requests export multi-select filters
  const [lrStatuses, setLrStatuses] = useState<string[]>([])
  const [lrRegionIds, setLrRegionIds] = useState<string[]>([])
  const [lrLeaveTypeIds, setLrLeaveTypeIds] = useState<string[]>([])
  const [lrUserIds, setLrUserIds] = useState<string[]>([])
  // Entitlements export multi-select filters
  const [entRegionIds, setEntRegionIds] = useState<string[]>([])
  const [entLeaveTypeIds, setEntLeaveTypeIds] = useState<string[]>([])
  const [entUserIds, setEntUserIds] = useState<string[]>([])

  const { data: regions } = useRegions()
  const { data: leaveTypesList } = useAdminLeaveTypes()
  const { data: allUsersData } = useAdminUsers({ pageSize: 500, isActive: true })

  const regionIdParam = filterRegionId !== '__all__' ? Number(filterRegionId) : undefined
  const { data: utilData, isLoading: utilLoading } = useUtilisationReport({ year, regionId: regionIdParam })
  const { data: deptData, isLoading: deptLoading } = useDepartmentSummary({ year, regionId: regionIdParam })

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
        statuses: lrStatuses.length > 0 ? lrStatuses : undefined,
        regionIds: lrRegionIds.length > 0 ? lrRegionIds.map(Number) : undefined,
        leaveTypeIds: lrLeaveTypeIds.length > 0 ? lrLeaveTypeIds.map(Number) : undefined,
        userIds: lrUserIds.length > 0 ? lrUserIds.map(Number) : undefined,
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
        regionIds: entRegionIds.length > 0 ? entRegionIds.map(Number) : undefined,
        leaveTypeIds: entLeaveTypeIds.length > 0 ? entLeaveTypeIds.map(Number) : undefined,
        userIds: entUserIds.length > 0 ? entUserIds.map(Number) : undefined,
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
                        {utilData.byType.map((lt) => (
                          <div key={lt.code} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{lt.name}</span>
                              <span className="text-muted-foreground">
                                {lt.used.toFixed(1)} / {lt.entitled.toFixed(1)} days ({lt.utilisationPct}%)
                              </span>
                            </div>
                            <Progress value={lt.utilisationPct} className="h-2" />
                          </div>
                        ))}
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

              {/* Leave requests export */}
              <Card>
                <CardHeader>
                  <CardTitle>Leave Requests Export</CardTitle>
                  <CardDescription>All leave requests across all regions</CardDescription>
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
                      <label className="text-sm font-medium">Status <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="statuses"
                        options={[
                          { value: 'approved', label: 'Approved' },
                          { value: 'pending', label: 'Pending' },
                          { value: 'rejected', label: 'Rejected' },
                          { value: 'cancelled', label: 'Cancelled' },
                        ]}
                        selected={lrStatuses}
                        onChange={setLrStatuses}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Region <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="regions"
                        options={(regions ?? []).map((r) => ({ value: String(r.id), label: r.name }))}
                        selected={lrRegionIds}
                        onChange={setLrRegionIds}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Leave type <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="leave types"
                        options={(leaveTypesList ?? []).map((lt) => ({ value: String(lt.id), label: lt.name }))}
                        selected={lrLeaveTypeIds}
                        onChange={setLrLeaveTypeIds}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Staff <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="staff"
                        options={(allUsersData?.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
                        selected={lrUserIds}
                        onChange={setLrUserIds}
                      />
                    </div>
                  </div>
                  <Button onClick={handleExportLeaveRequests} disabled={exportingLR} className="w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" />
                    {exportingLR ? 'Exporting…' : `Download XLSX — ${year}`}
                  </Button>
                </CardContent>
              </Card>

              {/* Entitlements export */}
              <Card>
                <CardHeader>
                  <CardTitle>Entitlements Export</CardTitle>
                  <CardDescription>Leave balances and entitlements for all employees</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
                      <label className="text-sm font-medium">Region <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="regions"
                        options={(regions ?? []).map((r) => ({ value: String(r.id), label: r.name }))}
                        selected={entRegionIds}
                        onChange={setEntRegionIds}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Leave type <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="leave types"
                        options={(leaveTypesList ?? []).map((lt) => ({ value: String(lt.id), label: lt.name }))}
                        selected={entLeaveTypeIds}
                        onChange={setEntLeaveTypeIds}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Staff <span className="text-muted-foreground text-xs">(multi)</span></label>
                      <MultiSelectDropdown
                        label="staff"
                        options={(allUsersData?.data ?? []).map((u) => ({ value: String(u.id), label: u.name }))}
                        selected={entUserIds}
                        onChange={setEntUserIds}
                      />
                    </div>
                  </div>
                  <Button onClick={handleExportEntitlements} disabled={exportingEnt} className="w-full sm:w-auto">
                    <Download className="mr-2 h-4 w-4" />
                    {exportingEnt ? 'Exporting…' : `Download XLSX — ${year}`}
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
