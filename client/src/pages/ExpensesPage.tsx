import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  Upload,
  Send,
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ChevronUp,
  Receipt,
  FileSpreadsheet,
} from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore, isHrOrAbove } from '@/stores/authStore'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ExpenseStatus =
  | 'PENDING_REVIEW'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'

interface ExpenseItem {
  id: number
  employeeEmail: string
  category: string | null
  amount: string
  currency: string
  expenseDate: string | null
  description: string | null
}

interface AuditEntry {
  id: number
  fromStatus: ExpenseStatus | null
  toStatus: ExpenseStatus
  actorName: string | null
  note: string | null
  createdAt: string
}

interface Expense {
  id: number
  filename: string
  status: ExpenseStatus
  syncAttempts: number
  netsuiteId: string | null
  rejectionNote: string | null
  createdAt: string
  uploadedBy: { id: number; name: string; email: string }
  items: ExpenseItem[]
  auditLog?: AuditEntry[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<ExpenseStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' | null; className: string }> = {
  PENDING_REVIEW:    { label: 'Pending Review',    variant: 'outline',     className: 'border-yellow-400 text-yellow-700 bg-yellow-50' },
  AWAITING_APPROVAL: { label: 'Awaiting Approval', variant: 'secondary',   className: 'bg-blue-100 text-blue-700' },
  APPROVED:          { label: 'Approved',           variant: 'default',     className: 'bg-green-100 text-green-700' },
  REJECTED:          { label: 'Rejected',           variant: 'destructive', className: '' },
  SYNCING:           { label: 'Syncing…',           variant: 'secondary',   className: 'bg-purple-100 text-purple-700 animate-pulse' },
  SYNCED:            { label: 'Synced',             variant: 'default',     className: 'bg-green-600 text-white' },
  SYNC_FAILED:       { label: 'Sync Failed',        variant: 'destructive', className: '' },
}

function StatusBadge({ status }: { status: ExpenseStatus }) {
  const cfg = STATUS_BADGE[status] ?? { label: status, variant: 'outline', className: '' }
  return (
    <Badge variant={cfg.variant ?? 'outline'} className={cfg.className}>
      {cfg.label}
    </Badge>
  )
}

function totalAmount(items: ExpenseItem[]) {
  const sum = items.reduce((acc, i) => acc + parseFloat(i.amount || '0'), 0)
  const currency = items[0]?.currency ?? 'HKD'
  return `${currency} ${sum.toFixed(2)}`
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function fetchExpenses(): Promise<Expense[]> {
  const { data } = await api.get<{ data: Expense[] }>('/expenses')
  return data.data
}

async function uploadCsv(file: File): Promise<Expense> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ data: Expense }>('/expenses/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data.data
}

async function sendForApproval(id: number): Promise<Expense> {
  const { data } = await api.post<{ data: Expense }>(`/expenses/${id}/send-approval`)
  return data.data
}

async function retrySync(id: number): Promise<Expense> {
  const { data } = await api.post<{ data: Expense }>(`/expenses/${id}/retry-sync`)
  return data.data
}

async function resubmit(id: number): Promise<Expense> {
  const { data } = await api.post<{ data: Expense }>(`/expenses/${id}/resubmit`)
  return data.data
}

async function fetchExpenseDetail(id: number): Promise<Expense> {
  const { data } = await api.get<{ data: Expense }>(`/expenses/${id}`)
  return data.data
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ExpensesPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data: expenseList = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: fetchExpenses,
    refetchInterval: (data) => {
      // Poll every 3s while any expense is SYNCING
      const syncing = (data.state.data ?? []).some((e) => e.status === 'SYNCING')
      return syncing ? 3000 : false
    },
  })

  const { data: detail } = useQuery({
    queryKey: ['expense', selectedId],
    queryFn: () => fetchExpenseDetail(selectedId!),
    enabled: selectedId !== null,
  })

  const uploadMutation = useMutation({
    mutationFn: uploadCsv,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success('Expenses uploaded successfully')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendMutation = useMutation({
    mutationFn: sendForApproval,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success('Sent for approval via Slack')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const retryMutation = useMutation({
    mutationFn: retrySync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success('Sync retry started')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const resubmitMutation = useMutation({
    mutationFn: resubmit,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success('Expense resubmitted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    e.target.value = ''
  }

  const isHr = isHrOrAbove(user?.role)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Upload expense CSVs, send for approval, and track NetSuite sync status.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadMutation.isPending}
          >
            <Upload className="mr-2 h-4 w-4" />
            {uploadMutation.isPending ? 'Uploading…' : 'Upload CSV'}
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        {(['PENDING_REVIEW', 'AWAITING_APPROVAL', 'SYNCED', 'SYNC_FAILED'] as ExpenseStatus[]).map((s) => (
          <Card key={s}>
            <CardHeader className="pb-1 pt-4 px-4">
              <CardTitle className="text-xs font-medium text-muted-foreground">
                {STATUS_BADGE[s].label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <span className="text-2xl font-bold">
                {expenseList.filter((e) => e.status === s).length}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
          ) : expenseList.length === 0 ? (
            <div className="py-16 text-center">
              <FileSpreadsheet className="mx-auto h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No expenses yet — upload a CSV to get started.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>#</TableHead>
                  <TableHead>File</TableHead>
                  {isHr && <TableHead>Uploaded by</TableHead>}
                  <TableHead>Rows</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenseList.map((expense) => (
                  <>
                    <TableRow
                      key={expense.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedId(expandedId === expense.id ? null : expense.id)}
                    >
                      <TableCell>
                        {expandedId === expense.id ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        #{expense.id}
                      </TableCell>
                      <TableCell className="max-w-[180px] truncate font-medium text-sm">
                        {expense.filename}
                      </TableCell>
                      {isHr && (
                        <TableCell className="text-sm">{expense.uploadedBy.name}</TableCell>
                      )}
                      <TableCell className="text-sm">{expense.items.length}</TableCell>
                      <TableCell className="text-sm font-medium">{totalAmount(expense.items)}</TableCell>
                      <TableCell>
                        <StatusBadge status={expense.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(expense.createdAt), 'dd MMM yyyy')}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1.5">
                          {expense.status === 'PENDING_REVIEW' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={sendMutation.isPending}
                              onClick={() => sendMutation.mutate(expense.id)}
                            >
                              <Send className="mr-1.5 h-3.5 w-3.5" />
                              Send for Approval
                            </Button>
                          )}
                          {expense.status === 'SYNC_FAILED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={retryMutation.isPending}
                              onClick={() => retryMutation.mutate(expense.id)}
                            >
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                              Retry Sync
                            </Button>
                          )}
                          {expense.status === 'REJECTED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resubmitMutation.isPending}
                              onClick={() => resubmitMutation.mutate(expense.id)}
                            >
                              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                              Resubmit
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedId(expense.id)}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {/* Expanded items sub-table */}
                    {expandedId === expense.id && (
                      <TableRow key={`${expense.id}-items`} className="bg-muted/20">
                        <TableCell colSpan={isHr ? 9 : 8} className="py-2 px-6">
                          {expense.rejectionNote && (
                            <p className="text-xs text-destructive mb-2">
                              Rejection note: {expense.rejectionNote}
                            </p>
                          )}
                          {expense.netsuiteId && (
                            <p className="text-xs text-muted-foreground mb-2">
                              NetSuite ID: {expense.netsuiteId}
                            </p>
                          )}
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-muted-foreground">
                                <th className="text-left pb-1 pr-4">Employee</th>
                                <th className="text-left pb-1 pr-4">Category</th>
                                <th className="text-left pb-1 pr-4">Date</th>
                                <th className="text-left pb-1 pr-4">Amount</th>
                                <th className="text-left pb-1">Description</th>
                              </tr>
                            </thead>
                            <tbody>
                              {expense.items.map((item) => (
                                <tr key={item.id} className="border-t border-border/40">
                                  <td className="py-1 pr-4">{item.employeeEmail}</td>
                                  <td className="py-1 pr-4">{item.category ?? '—'}</td>
                                  <td className="py-1 pr-4">{item.expenseDate ?? '—'}</td>
                                  <td className="py-1 pr-4 font-medium">
                                    {item.currency} {parseFloat(item.amount).toFixed(2)}
                                  </td>
                                  <td className="py-1 text-muted-foreground">{item.description ?? '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Audit log drawer */}
      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-[420px] sm:w-[500px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Expense #{selectedId} — Audit Log</SheetTitle>
          </SheetHeader>
          {detail ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">File:</span> {detail.filename}</p>
                <p><span className="text-muted-foreground">Status:</span> <StatusBadge status={detail.status} /></p>
                <p><span className="text-muted-foreground">Uploaded by:</span> {detail.uploadedBy.name}</p>
                {detail.netsuiteId && (
                  <p><span className="text-muted-foreground">NetSuite ID:</span> {detail.netsuiteId}</p>
                )}
                {detail.rejectionNote && (
                  <p><span className="text-muted-foreground">Rejection note:</span> {detail.rejectionNote}</p>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-2">History</h3>
                <ol className="relative border-l border-border space-y-4 pl-4">
                  {(detail.auditLog ?? []).map((entry) => (
                    <li key={entry.id} className="text-xs">
                      <div className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-primary/60" />
                      <p className="font-medium">
                        {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                        {entry.toStatus}
                      </p>
                      {entry.note && <p className="text-muted-foreground">{entry.note}</p>}
                      <p className="text-muted-foreground mt-0.5">
                        {entry.actorName ?? 'System'} ·{' '}
                        {format(new Date(entry.createdAt), 'dd MMM yyyy HH:mm')}
                      </p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
