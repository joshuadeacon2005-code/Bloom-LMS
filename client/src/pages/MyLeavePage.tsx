import { useState } from 'react'
import { format } from 'date-fns'
import { Plus, FileText, X, Paperclip } from 'lucide-react'
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
import { LeaveStatusBadge } from '@/components/leave/LeaveStatusBadge'
import { RequestLeaveSheet } from '@/components/leave/RequestLeaveSheet'
import { EmptyState } from '@/components/shared/EmptyState'
import { useBalances } from '@/hooks/useBalances'
import { useLeaveRequests, useCancelLeaveRequest, type LeaveRequest } from '@/hooks/useLeaveRequests'

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'cancelled'

export function MyLeavePage() {
  const [requestSheetOpen, setRequestSheetOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])

  const { data: balances, isLoading: loadingBalances } = useBalances()
  const { data: requests, isLoading: loadingRequests } = useLeaveRequests(
    statusFilter !== 'all' ? { status: statusFilter, pageSize: 50 } : { pageSize: 50 }
  )
  const cancelRequest = useCancelLeaveRequest()

  const columns: ColumnDef<LeaveRequest>[] = [
    {
      accessorKey: 'leaveType.name',
      header: 'Type',
      cell: ({ row }) => (
        <span className="font-medium">{row.original.leaveType?.name}</span>
      ),
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
            onClick={() => setCancelId(row.original.id)}
          >
            <X className="mr-1 h-3 w-3" />
            Cancel
          </Button>
        ) : null,
    },
  ]

  const table = useReactTable({
    data: requests?.data ?? [],
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

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
                      <p className="text-sm font-semibold text-foreground">
                        {b.leaveType?.name}
                      </p>
                      <p className="text-2xl font-bold mt-1">
                        {b.available}
                        <span className="text-sm font-normal text-muted-foreground ml-1">
                          / {b.entitled}d
                        </span>
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

      {/* History table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Leave History</CardTitle>
          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as StatusFilter)}
          >
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
          ) : !table.getRowModel().rows.length ? (
            <EmptyState
              icon={FileText}
              title="No leave requests"
              description="You haven't submitted any leave requests yet."
              className="py-12"
            />
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
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
                {table.getRowModel().rows.map((row) => (
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

      {/* Request form */}
      <RequestLeaveSheet open={requestSheetOpen} onOpenChange={setRequestSheetOpen} />

      {/* Cancel confirmation */}
      <AlertDialog open={cancelId !== null} onOpenChange={() => setCancelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel leave request?</AlertDialogTitle>
            <AlertDialogDescription>
              This will cancel your pending leave request and release any held balance. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (cancelId) cancelRequest.mutate(cancelId)
                setCancelId(null)
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
