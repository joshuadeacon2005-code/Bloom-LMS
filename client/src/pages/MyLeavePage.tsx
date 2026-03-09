import { useState } from 'react'
import { format } from 'date-fns'
import { Plus, FileText, X, Paperclip, Clock } from 'lucide-react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { LeaveStatusBadge } from '@/components/leave/LeaveStatusBadge'
import { RequestLeaveSheet } from '@/components/leave/RequestLeaveSheet'
import { EmptyState } from '@/components/shared/EmptyState'
import { useBalances } from '@/hooks/useBalances'
import { useLeaveRequests, useCancelLeaveRequest, type LeaveRequest } from '@/hooks/useLeaveRequests'
import {
  useOvertimeBalance,
  useOvertimeHistory,
  useSubmitOvertime,
  useCancelOvertime,
  type OvertimeEntry,
} from '@/hooks/useOvertime'

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'
type OTStatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'

const OT_STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Pending', variant: 'secondary' },
  approved: { label: 'Approved', variant: 'default' },
  rejected: { label: 'Rejected', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
}

export function MyLeavePage() {
  const [requestSheetOpen, setRequestSheetOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [otStatusFilter, setOTStatusFilter] = useState<OTStatusFilter>('all')
  const [cancelLeaveId, setCancelLeaveId] = useState<number | null>(null)
  const [cancelOTId, setCancelOTId] = useState<number | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const [otSorting, setOTSorting] = useState<SortingState>([])
  const [submitOTOpen, setSubmitOTOpen] = useState(false)

  // Leave data
  const { data: balances, isLoading: loadingBalances } = useBalances()
  const { data: requests, isLoading: loadingRequests } = useLeaveRequests(
    statusFilter !== 'all' ? { status: statusFilter, pageSize: 50 } : { pageSize: 50 }
  )
  const cancelLeave = useCancelLeaveRequest()

  // Overtime data
  const { data: otBalance } = useOvertimeBalance()
  const { data: otHistory, isLoading: loadingOT } = useOvertimeHistory(
    otStatusFilter !== 'all' ? { status: otStatusFilter, pageSize: 50 } : { pageSize: 50 }
  )
  const submitOvertime = useSubmitOvertime()
  const cancelOvertime = useCancelOvertime()

  // Overtime form state
  const [otForm, setOTForm] = useState({ date: '', hoursWorked: '', daysRequested: '1', reason: '' })

  // Leave history columns
  const leaveColumns: ColumnDef<LeaveRequest>[] = [
    {
      accessorKey: 'leaveType.name',
      header: 'Type',
      cell: ({ row }) => <span className="font-medium">{row.original.leaveType?.name}</span>,
    },
    {
      accessorKey: 'startDate',
      header: 'Start',
      cell: ({ getValue }) => format(new Date(getValue() as string), 'd MMM yyyy'),
    },
    {
      accessorKey: 'endDate',
      header: 'End',
      cell: ({ getValue }) => format(new Date(getValue() as string), 'd MMM yyyy'),
    },
    {
      accessorKey: 'totalDays',
      header: 'Days',
      cell: ({ getValue }) => `${getValue()}d`,
    },
    {
      accessorKey: 'reason',
      header: 'Reason',
      cell: ({ getValue }) => {
        const v = getValue() as string | null
        return v ? (
          <span className="text-sm text-muted-foreground line-clamp-1 max-w-[200px]">{v}</span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        )
      },
    },
    {
      accessorKey: 'attachmentUrl',
      header: '',
      cell: ({ getValue }) =>
        getValue() ? (
          <a href={getValue() as string} target="_blank" rel="noreferrer">
            <Paperclip className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </a>
        ) : null,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => <LeaveStatusBadge status={getValue() as LeaveRequest['status']} />,
    },
    {
      id: 'actions',
      cell: ({ row }) =>
        row.original.status === 'pending' ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => setCancelLeaveId(row.original.id)}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        ) : null,
    },
  ]

  // Overtime history columns
  const otColumns: ColumnDef<OvertimeEntry>[] = [
    {
      accessorKey: 'date',
      header: 'Date Worked',
      cell: ({ getValue }) => format(new Date(getValue() as string), 'd MMM yyyy'),
    },
    {
      accessorKey: 'hoursWorked',
      header: 'Hours',
      cell: ({ getValue }) => `${getValue()}h`,
    },
    {
      accessorKey: 'daysRequested',
      header: 'Days Requested',
      cell: ({ getValue }) => `${getValue()}d`,
    },
    {
      accessorKey: 'reason',
      header: 'Reason',
      cell: ({ getValue }) => (
        <span className="line-clamp-1 max-w-[200px] text-sm text-muted-foreground">
          {getValue() as string}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ getValue }) => {
        const s = getValue() as string
        const cfg = OT_STATUS_BADGE[s] ?? { label: s, variant: 'outline' as const }
        return <Badge variant={cfg.variant}>{cfg.label}</Badge>
      },
    },
    {
      accessorKey: 'rejectionReason',
      header: 'Note',
      cell: ({ row }) =>
        row.original.rejectionReason ? (
          <span className="text-xs text-destructive">{row.original.rejectionReason}</span>
        ) : row.original.approvedBy ? (
          <span className="text-xs text-muted-foreground">by {row.original.approvedBy.name}</span>
        ) : null,
    },
    {
      id: 'actions',
      cell: ({ row }) =>
        row.original.status === 'pending' ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-destructive hover:text-destructive"
            onClick={() => setCancelOTId(row.original.id)}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        ) : null,
    },
  ]

  const leaveTable = useReactTable({
    data: requests?.data ?? [],
    columns: leaveColumns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const otTable = useReactTable({
    data: otHistory?.data ?? [],
    columns: otColumns,
    state: { sorting: otSorting },
    onSortingChange: setOTSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  function handleSubmitOT() {
    const hours = parseFloat(otForm.hoursWorked)
    const days = parseFloat(otForm.daysRequested)
    if (!otForm.date || isNaN(hours) || isNaN(days) || !otForm.reason.trim()) return
    submitOvertime.mutate(
      { date: otForm.date, hoursWorked: hours, daysRequested: days, reason: otForm.reason },
      {
        onSuccess: () => {
          setSubmitOTOpen(false)
          setOTForm({ date: '', hoursWorked: '', daysRequested: '1', reason: '' })
        },
      }
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">My Leave</h2>
          <p className="text-sm text-muted-foreground">
            View your balances and manage leave requests
          </p>
        </div>
        <Button onClick={() => setRequestSheetOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" />
          Request Leave
        </Button>
      </div>

      <Tabs defaultValue="leave">
        <TabsList>
          <TabsTrigger value="leave">Leave</TabsTrigger>
          <TabsTrigger value="overtime">
            Overtime Compensation
            {otBalance && otBalance.pendingCount > 0 && (
              <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 px-1 text-xs">
                {otBalance.pendingCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ── LEAVE TAB ── */}
        <TabsContent value="leave" className="space-y-6 pt-4">
          {/* Balances */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Leave Balances — {new Date().getFullYear()}</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingBalances ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
                </div>
              ) : !balances?.length ? (
                <p className="text-sm text-muted-foreground">No leave balances found.</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {balances.map((b) => (
                    <div key={b.id} className="rounded-lg border border-border p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{b.leaveType?.name}</p>
                          <p className="text-2xl font-bold mt-1">
                            {b.available}
                            <span className="text-sm font-normal text-muted-foreground ml-1">/ {b.entitled}d</span>
                          </p>
                        </div>
                        {!b.leaveType?.isPaid && (
                          <Badge variant="outline" className="text-xs">Unpaid</Badge>
                        )}
                      </div>
                      <Progress
                        value={b.entitled > 0 ? (b.available / b.entitled) * 100 : 0}
                        className="mt-3 h-1.5"
                      />
                      <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                        {b.used > 0 && <span>{b.used}d used</span>}
                        {b.pending > 0 && <span>{b.pending}d pending</span>}
                        {b.carried > 0 && <span>{b.carried}d carried</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Leave History */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Leave History</CardTitle>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Not Approved</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              {loadingRequests ? (
                <div className="space-y-2 p-6">
                  {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : !leaveTable.getRowModel().rows.length ? (
                <EmptyState icon={FileText} title="No leave requests" description="You haven't submitted any leave requests yet." className="py-12" />
              ) : (
                <Table>
                  <TableHeader>
                    {leaveTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((h) => (
                          <TableHead key={h.id} className="text-xs">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {leaveTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-2.5 text-sm">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── OVERTIME TAB ── */}
        <TabsContent value="overtime" className="space-y-6 pt-4">
          {/* Balance Summary */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Overtime Compensation</CardTitle>
              <Button onClick={() => setSubmitOTOpen(true)}>
                <Clock className="mr-1.5 h-4 w-4" />
                Request Compensation
              </Button>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border border-border bg-primary/5 p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Approved Days</p>
                  <p className="text-3xl font-bold text-primary">
                    {otBalance?.approvedDays.toFixed(1) ?? '—'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">added to annual leave</p>
                </div>
                <div className="rounded-lg border border-border p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Pending</p>
                  <p className="text-2xl font-bold">{otBalance?.pendingDays.toFixed(1) ?? '—'}d</p>
                  <p className="text-xs text-muted-foreground mt-1">awaiting approval</p>
                </div>
                <div className="rounded-lg border border-border p-4 text-center">
                  <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Requests</p>
                  <p className="text-2xl font-bold">{otBalance?.pendingCount ?? '—'}</p>
                  <p className="text-xs text-muted-foreground mt-1">pending review</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                When a manager approves your overtime compensation request, the days are automatically added to your annual leave balance.
              </p>
            </CardContent>
          </Card>

          {/* Overtime History */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Request History</CardTitle>
              <Select value={otStatusFilter} onValueChange={(v) => setOTStatusFilter(v as OTStatusFilter)}>
                <SelectTrigger className="w-36 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent className="p-0">
              {loadingOT ? (
                <div className="space-y-2 p-6">
                  {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : !otTable.getRowModel().rows.length ? (
                <EmptyState icon={Clock} title="No overtime requests" description="Submit an overtime compensation request to get started." className="py-12" />
              ) : (
                <Table>
                  <TableHeader>
                    {otTable.getHeaderGroups().map((hg) => (
                      <TableRow key={hg.id}>
                        {hg.headers.map((h) => (
                          <TableHead key={h.id} className="text-xs">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                          </TableHead>
                        ))}
                      </TableRow>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {otTable.getRowModel().rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className="py-2.5 text-sm">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ── */}
      <RequestLeaveSheet open={requestSheetOpen} onOpenChange={setRequestSheetOpen} />

      {/* Submit Overtime Request Dialog */}
      <Dialog open={submitOTOpen} onOpenChange={setSubmitOTOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Overtime Compensation</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Date Worked</Label>
              <Input
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={otForm.date}
                onChange={(e) => setOTForm({ ...otForm, date: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Hours Worked</Label>
                <Input
                  type="number"
                  step="0.5"
                  min="0.5"
                  max="24"
                  placeholder="e.g. 3"
                  value={otForm.hoursWorked}
                  onChange={(e) => setOTForm({ ...otForm, hoursWorked: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Days Requested</Label>
                <Select value={otForm.daysRequested} onValueChange={(v) => setOTForm({ ...otForm, daysRequested: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5 (half day)</SelectItem>
                    <SelectItem value="1">1 (full day)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Reason for Overtime</Label>
              <Textarea
                placeholder="e.g. Client deadline, event support, project launch"
                rows={3}
                value={otForm.reason}
                onChange={(e) => setOTForm({ ...otForm, reason: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSubmitOTOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSubmitOT}
              disabled={submitOvertime.isPending || !otForm.date || !otForm.hoursWorked || !otForm.reason}
            >
              {submitOvertime.isPending ? 'Submitting…' : 'Submit Request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel leave request confirmation */}
      <AlertDialog open={cancelLeaveId !== null} onOpenChange={() => setCancelLeaveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel leave request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel your pending leave request and release any held balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (cancelLeaveId) cancelLeave.mutate(cancelLeaveId)
                setCancelLeaveId(null)
              }}
            >
              Cancel request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Cancel overtime request confirmation */}
      <AlertDialog open={cancelOTId !== null} onOpenChange={() => setCancelOTId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel overtime request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel your pending overtime compensation request.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (cancelOTId) cancelOvertime.mutate(cancelOTId)
                setCancelOTId(null)
              }}
            >
              Cancel request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
