import React, { useRef, useState } from 'react'
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
  Plus,
  Trash2,
  PenLine,
  Paperclip,
  SendHorizonal,
  Check,
  X,
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
  SheetDescription,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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

interface ExpenseAttachment {
  id: number
  expenseId: number
  url: string
  originalName: string
  createdAt: string
}

interface Expense {
  id: number
  filename: string
  status: ExpenseStatus
  syncAttempts: number
  netsuiteId: string | null
  netsuiteUrl: string | null
  syncError: string | null
  rejectionNote: string | null
  createdAt: string
  uploadedBy: { id: number; name: string; email: string }
  items: ExpenseItem[]
  auditLog?: AuditEntry[]
  attachments?: ExpenseAttachment[]
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

async function approveExpense(id: number): Promise<Expense> {
  const { data } = await api.post<{ data: Expense }>(`/expenses/${id}/approve`)
  return data.data
}

async function rejectExpense({ id, note }: { id: number; note?: string }): Promise<Expense> {
  const { data } = await api.post<{ data: Expense }>(`/expenses/${id}/reject`, { note })
  return data.data
}

async function createManualExpense(items: ManualItemInput[]): Promise<Expense> {
  const { data } = await api.post<{ data: Expense }>('/expenses/manual', { items })
  return data.data
}

async function fetchExpenseDetail(id: number): Promise<Expense> {
  const { data } = await api.get<{ data: Expense }>(`/expenses/${id}`)
  return data.data
}

async function uploadAttachment(expenseId: number, file: File): Promise<ExpenseAttachment> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ data: ExpenseAttachment }>(
    `/expenses/${expenseId}/attachments`,
    form,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  )
  return data.data
}

async function sendBulkApproval(): Promise<{ submittedIds: number[]; count: number }> {
  const { data } = await api.post<{ data: { submittedIds: number[]; count: number } }>('/expenses/send-bulk-approval')
  return data.data
}

// ---------------------------------------------------------------------------
// Manual Expense Types
// ---------------------------------------------------------------------------

interface ManualItemInput {
  employeeEmail: string
  category: string
  amount: number
  currency: string
  expenseDate: string
  description: string
}

const CURRENCIES = ['HKD', 'SGD', 'MYR', 'IDR', 'CNY', 'AUD', 'NZD', 'GBP', 'USD', 'EUR']

const CATEGORIES = [
  'Travel',
  'Meals & Entertainment',
  'Office Supplies',
  'Transportation',
  'Accommodation',
  'Communication',
  'Training',
  'Software & Subscriptions',
  'Medical',
  'Other',
]

function emptyItem(email: string): ManualItemInput {
  return { employeeEmail: email, category: '', amount: 0, currency: 'HKD', expenseDate: '', description: '' }
}

// ---------------------------------------------------------------------------
// Manual Expense Sheet (side-drawer)
// ---------------------------------------------------------------------------

function ManualExpenseSheet({
  open,
  onOpenChange,
  onCreated,
  userEmail,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  onCreated: () => void
  userEmail: string
}) {
  const [items, setItems] = useState<ManualItemInput[]>([emptyItem(userEmail)])
  const [submitting, setSubmitting] = useState(false)
  // pendingFiles: one optional receipt file per item row
  const [pendingFiles, setPendingFiles] = useState<(File | null)[]>([null])
  const fileRefs = useRef<(HTMLInputElement | null)[]>([])

  function updateItem(idx: number, patch: Partial<ManualItemInput>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  function addRow() {
    setItems((prev) => [...prev, emptyItem(userEmail)])
    setPendingFiles((prev) => [...prev, null])
  }

  function removeRow(idx: number) {
    if (items.length <= 1) return
    setItems((prev) => prev.filter((_, i) => i !== idx))
    setPendingFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  function setFile(idx: number, file: File | null) {
    setPendingFiles((prev) => prev.map((f, i) => (i === idx ? file : f)))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const incomplete = items.filter((it) => (it.employeeEmail || it.amount) && (!it.employeeEmail || !it.amount || it.amount <= 0))
    if (incomplete.length > 0) {
      toast.error('Some items are missing a required email or amount')
      return
    }
    const valid = items.filter((it) => it.employeeEmail && it.amount > 0)
    if (valid.length === 0) {
      toast.error('Please add at least one item with an email and amount')
      return
    }
    setSubmitting(true)
    try {
      const expense = await createManualExpense(valid)
      // Upload any attached receipt files
      const uploads = pendingFiles.map((file, idx) =>
        file && valid[idx] ? uploadAttachment(expense.id, file) : Promise.resolve(null)
      )
      await Promise.all(uploads)
      toast.success('Expense created successfully')
      onCreated()
      setItems([emptyItem(userEmail)])
      setPendingFiles([null])
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create expense')
    } finally {
      setSubmitting(false)
    }
  }

  function handleOpen(v: boolean) {
    if (v) {
      setItems([emptyItem(userEmail)])
      setPendingFiles([null])
    }
    onOpenChange(v)
  }

  const total = items.reduce((acc, it) => acc + (it.amount || 0), 0)

  return (
    <Sheet open={open} onOpenChange={handleOpen}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col">
        <SheetHeader className="pb-2">
          <SheetTitle>Add Expense</SheetTitle>
          <SheetDescription>Enter one or more expense items. You can attach a receipt for each.</SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4 pt-2">
          <div className="flex-1 space-y-3 overflow-y-auto pr-1">
            {items.map((item, idx) => (
              <div key={idx} className="rounded-md border p-3 space-y-3 relative">
                {items.length > 1 && (
                  <div className="absolute top-2 right-2 flex items-center gap-2">
                    <span className="text-xs text-muted-foreground font-medium">Item {idx + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      aria-label="Remove item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Employee email</Label>
                    <Input
                      type="email"
                      value={item.employeeEmail}
                      onChange={(e) => updateItem(idx, { employeeEmail: e.target.value })}
                      placeholder="name@company.com"
                      required
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Category</Label>
                    <Select value={item.category} onValueChange={(v) => updateItem(idx, { category: v })}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Amount</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={item.amount || ''}
                      onChange={(e) => updateItem(idx, { amount: parseFloat(e.target.value) || 0 })}
                      placeholder="0.00"
                      required
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Currency</Label>
                    <Select value={item.currency} onValueChange={(v) => updateItem(idx, { currency: v })}>
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CURRENCIES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Date</Label>
                    <Input
                      type="date"
                      value={item.expenseDate}
                      onChange={(e) => updateItem(idx, { expenseDate: e.target.value })}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Description</Label>
                  <Input
                    value={item.description}
                    onChange={(e) => updateItem(idx, { description: e.target.value })}
                    placeholder="Brief description of the expense"
                    className="h-8 text-sm"
                  />
                </div>

                {/* Receipt attachment */}
                <div className="space-y-1">
                  <Label className="text-xs">Receipt / Attachment (optional)</Label>
                  <div className="flex items-center gap-2">
                    <input
                      ref={(el) => { fileRefs.current[idx] = el }}
                      type="file"
                      accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
                      className="hidden"
                      onChange={(e) => setFile(idx, e.target.files?.[0] ?? null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => fileRefs.current[idx]?.click()}
                    >
                      <Paperclip className="h-3 w-3 mr-1" />
                      {pendingFiles[idx] ? 'Change file' : 'Attach receipt'}
                    </Button>
                    {pendingFiles[idx] && (
                      <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                        {pendingFiles[idx]!.name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Button type="button" variant="outline" size="sm" onClick={addRow} className="w-full">
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add another item
          </Button>

          {total > 0 && (
            <div className="rounded-md bg-muted/50 px-3 py-2 text-sm font-medium flex justify-between">
              <span>Total ({items.length} item{items.length !== 1 ? 's' : ''})</span>
              <span>{items[0]?.currency ?? 'HKD'} {total.toFixed(2)}</span>
            </div>
          )}

          <div className="flex gap-3 pb-2">
            <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={submitting}>
              {submitting ? 'Creating...' : 'Create Expense'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ExpensesPage() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [attachingToId, setAttachingToId] = useState<number | null>(null)

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

  const approveMutation = useMutation({
    mutationFn: approveExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success('Expense approved — syncing to NetSuite')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const rejectMutation = useMutation({
    mutationFn: rejectExpense,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success('Expense rejected')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const bulkSendMutation = useMutation({
    mutationFn: sendBulkApproval,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      toast.success(`${result.count} expense${result.count !== 1 ? 's' : ''} sent for approval`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const attachMutation = useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) => uploadAttachment(id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['expense', attachingToId] })
      toast.success('Attachment uploaded')
      setAttachingToId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadMutation.mutate(file)
    e.target.value = ''
  }

  function handleAttachChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !attachingToId) return
    attachMutation.mutate({ id: attachingToId, file })
    e.target.value = ''
  }

  const pendingCount = expenseList.filter((e) => e.status === 'PENDING_REVIEW').length
  const isHr = isHrOrAbove(user?.role)

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add expenses manually or upload CSVs, send for approval, and track sync status.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleFileChange}
          />
          <input
            ref={attachInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf"
            className="hidden"
            onChange={handleAttachChange}
          />
          {pendingCount > 0 && (
            <Button
              variant="outline"
              onClick={() => bulkSendMutation.mutate()}
              disabled={bulkSendMutation.isPending}
            >
              <SendHorizonal className="mr-2 h-4 w-4" />
              {bulkSendMutation.isPending
                ? 'Sending…'
                : `Send all pending (${pendingCount})`}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => setManualOpen(true)}
          >
            <PenLine className="mr-2 h-4 w-4" />
            Add Expense
          </Button>
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
              <p className="text-sm text-muted-foreground">No expenses yet — add one manually or upload a CSV to get started.</p>
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
                  <React.Fragment key={expense.id}>
                    <TableRow
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
                          {expense.status === 'AWAITING_APPROVAL' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-green-300 text-green-700 hover:bg-green-50"
                                disabled={approveMutation.isPending}
                                onClick={() => approveMutation.mutate(expense.id)}
                              >
                                <Check className="mr-1.5 h-3.5 w-3.5" />
                                Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-red-300 text-red-700 hover:bg-red-50"
                                disabled={rejectMutation.isPending}
                                onClick={() => rejectMutation.mutate({ id: expense.id })}
                              >
                                <X className="mr-1.5 h-3.5 w-3.5" />
                                Reject
                              </Button>
                            </>
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
                            title="Attach receipt"
                            onClick={() => {
                              setAttachingToId(expense.id)
                              setTimeout(() => attachInputRef.current?.click(), 50)
                            }}
                          >
                            <Paperclip className="h-3.5 w-3.5" />
                          </Button>
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
                      <TableRow className="bg-muted/20">
                        <TableCell colSpan={isHr ? 9 : 8} className="py-2 px-6">
                          {expense.rejectionNote && (
                            <p className="text-xs text-destructive mb-2">
                              Rejection note: {expense.rejectionNote}
                            </p>
                          )}
                          {expense.syncError && expense.status === 'SYNC_FAILED' && (
                            <p className="text-xs text-destructive mb-2 break-all">
                              Sync error: {expense.syncError}
                            </p>
                          )}
                          {expense.netsuiteId && (
                            <p className="text-xs text-muted-foreground mb-2">
                              NetSuite ID:{' '}
                              {expense.netsuiteUrl ? (
                                <a
                                  href={expense.netsuiteUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="font-mono underline underline-offset-2 text-primary"
                                >
                                  {expense.netsuiteId}
                                </a>
                              ) : (
                                <span className="font-mono">{expense.netsuiteId}</span>
                              )}
                            </p>
                          )}
                          {expense.attachments && expense.attachments.length > 0 && (
                            <div className="mb-2">
                              <p className="text-xs font-medium text-muted-foreground mb-1">Attachments:</p>
                              <div className="flex flex-wrap gap-2">
                                {expense.attachments.map((a) => (
                                  <a
                                    key={a.id}
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
                                  >
                                    <Paperclip className="h-3 w-3" />
                                    {a.originalName}
                                  </a>
                                ))}
                              </div>
                            </div>
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
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Audit / detail drawer */}
      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Expense #{selectedId}</SheetTitle>
          </SheetHeader>
          {detail ? (
            <div className="mt-4 space-y-5">
              <div className="space-y-1 text-sm">
                <p><span className="text-muted-foreground">File:</span> {detail.filename}</p>
                <p><span className="text-muted-foreground">Status:</span> <StatusBadge status={detail.status} /></p>
                <p><span className="text-muted-foreground">Uploaded by:</span> {detail.uploadedBy.name}</p>
                {detail.netsuiteId && (
                  <p>
                    <span className="text-muted-foreground">NetSuite ID:</span>{' '}
                    {detail.netsuiteUrl ? (
                      <a
                        href={detail.netsuiteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-xs underline underline-offset-2 text-primary"
                      >
                        {detail.netsuiteId}
                      </a>
                    ) : (
                      <span className="font-mono text-xs">{detail.netsuiteId}</span>
                    )}
                  </p>
                )}
                {detail.syncError && detail.status === 'SYNC_FAILED' && (
                  <p className="text-destructive break-all">
                    <span className="text-muted-foreground">Sync error:</span> {detail.syncError}
                  </p>
                )}
                {detail.rejectionNote && (
                  <p className="text-destructive"><span className="text-muted-foreground">Rejection note:</span> {detail.rejectionNote}</p>
                )}
              </div>

              {/* Attachments */}
              {detail.attachments && detail.attachments.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Attachments</h3>
                  <div className="space-y-1">
                    {detail.attachments.map((a) => (
                      <a
                        key={a.id}
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-sm text-primary hover:underline underline-offset-2"
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0" />
                        {a.originalName}
                      </a>
                    ))}
                  </div>
                </div>
              )}

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

      {/* Manual expense sheet */}
      <ManualExpenseSheet
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ['expenses'] })}
        userEmail={user?.email ?? ''}
      />
    </div>
  )
}
