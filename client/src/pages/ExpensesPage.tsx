import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  Plus,
  Receipt,
  PenLine,
  Trash2,
  Paperclip,
  FileText,
  ListChecks,
  Inbox,
} from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { useAuthStore, isManagerOrAbove } from '@/stores/authStore'
import { AddExpenseSheet } from '@/components/expenses/AddExpenseSheet'
import { ReportDetailSheet } from '@/components/expenses/ReportDetailSheet'
import { ExpenseReportStatusBadge } from '@/components/expenses/ExpenseReportStatusBadge'
import {
  useExpenseLines,
  useExpenseReports,
  useDeleteLine,
  useCreateReport,
  type ExpenseLine,
  type ExpenseReport,
} from '@/hooks/useExpenses'

export default function ExpensesPage() {
  const { user } = useAuthStore()
  const showApprovals = isManagerOrAbove(user?.role)

  const [tab, setTab] = useState<'expenses' | 'reports' | 'approvals'>('expenses')
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [editingLine, setEditingLine] = useState<ExpenseLine | null>(null)
  const [openReportId, setOpenReportId] = useState<number | null>(null)

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            Add expenses as you incur them, then bundle them into a report for approval.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingLine(null)
            setAddSheetOpen(true)
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Add Expense
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="expenses" className="gap-2">
            <Receipt className="h-4 w-4" /> My Expenses
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-2">
            <FileText className="h-4 w-4" /> My Reports
          </TabsTrigger>
          {showApprovals && (
            <TabsTrigger value="approvals" className="gap-2">
              <Inbox className="h-4 w-4" /> Approvals
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="expenses" className="mt-4">
          <MyExpensesTab
            onEdit={(line) => {
              setEditingLine(line)
              setAddSheetOpen(true)
            }}
            onAdd={() => {
              setEditingLine(null)
              setAddSheetOpen(true)
            }}
          />
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <MyReportsTab onOpenReport={(id) => setOpenReportId(id)} />
        </TabsContent>

        {showApprovals && (
          <TabsContent value="approvals" className="mt-4">
            <ApprovalsTab onOpenReport={(id) => setOpenReportId(id)} />
          </TabsContent>
        )}
      </Tabs>

      <AddExpenseSheet
        open={addSheetOpen}
        onOpenChange={setAddSheetOpen}
        editing={editingLine}
      />

      <ReportDetailSheet
        open={openReportId != null}
        onOpenChange={(open) => {
          if (!open) setOpenReportId(null)
        }}
        reportId={openReportId}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: My Expenses
// ─────────────────────────────────────────────────────────────────────────────

function MyExpensesTab({
  onEdit,
  onAdd,
}: {
  onEdit: (line: ExpenseLine) => void
  onAdd: () => void
}) {
  const { data: lines, isLoading } = useExpenseLines('draft')
  const deleteLine = useDeleteLine()
  const createReport = useCreateReport()

  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [reportTitle, setReportTitle] = useState('')

  const allDrafts = lines ?? []

  const toggle = (id: number, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(allDrafts.map((l) => l.id)))
    else setSelected(new Set())
  }

  const selectedTotal = useMemo(() => {
    return allDrafts
      .filter((l) => selected.has(l.id))
      .reduce((s, l) => s + parseFloat(l.amount || '0'), 0)
  }, [allDrafts, selected])

  const selectedCurrency = useMemo(() => {
    const first = allDrafts.find((l) => selected.has(l.id))
    return first?.currency ?? ''
  }, [allDrafts, selected])

  const allSelected = allDrafts.length > 0 && selected.size === allDrafts.length

  async function handleCreateReport() {
    const lineIds = Array.from(selected)
    const report = await createReport.mutateAsync({
      lineIds,
      title: reportTitle.trim() || undefined,
    })
    if (report) {
      setSelected(new Set())
      setReportTitle('')
      setCreateDialogOpen(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    )
  }

  if (allDrafts.length === 0) {
    return (
      <EmptyState
        icon={Receipt}
        title="No expenses yet"
        description="Add an expense as soon as you incur it. You can bundle multiple expenses into a single report when you're ready."
        action={
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add Expense
          </Button>
        }
      />
    )
  }

  return (
    <>
      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <p className="text-sm">
              {selected.size > 0
                ? `${selected.size} selected • ${selectedCurrency} ${selectedTotal.toFixed(2)}`
                : `${allDrafts.length} draft${allDrafts.length === 1 ? '' : 's'}`}
            </p>
            <Button
              size="sm"
              disabled={selected.size === 0}
              onClick={() => setCreateDialogOpen(true)}
            >
              <ListChecks className="h-4 w-4 mr-2" />
              Create Report ({selected.size})
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => toggleAll(!!v)}
                  />
                </TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-12 text-center">Receipt</TableHead>
                <TableHead className="w-24 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allDrafts.map((line) => (
                <TableRow key={line.id} data-state={selected.has(line.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(line.id)}
                      onCheckedChange={(v) => toggle(line.id, !!v)}
                    />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {line.expenseDate ? format(new Date(line.expenseDate), 'PP') : '—'}
                  </TableCell>
                  <TableCell>{line.category ?? '—'}</TableCell>
                  <TableCell className="text-right whitespace-nowrap font-medium">
                    {line.currency} {parseFloat(line.amount || '0').toFixed(2)}
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {line.description ?? '—'}
                  </TableCell>
                  <TableCell className="text-center">
                    {line.receiptUrl ? (
                      <a
                        href={line.receiptUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={line.receiptOriginalName ?? 'Receipt'}
                      >
                        <Paperclip className="h-4 w-4 inline" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => onEdit(line)} title="Edit">
                      <PenLine className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteLine.mutate(line.id)}
                      disabled={deleteLine.isPending}
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create expense report</DialogTitle>
            <DialogDescription>
              Bundle {selected.size} expense{selected.size === 1 ? '' : 's'} ({selectedCurrency}{' '}
              {selectedTotal.toFixed(2)}) into a single report. You can then send it to your manager for
              approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="report-title">Title (optional)</Label>
            <Input
              id="report-title"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="e.g. Client trip — Singapore"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to auto-generate from the expense date range.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateReport} disabled={createReport.isPending}>
              Create Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: My Reports
// ─────────────────────────────────────────────────────────────────────────────

function MyReportsTab({ onOpenReport }: { onOpenReport: (id: number) => void }) {
  const { user } = useAuthStore()
  const { data: reports, isLoading } = useExpenseReports()

  const myReports = (reports ?? []).filter((r) => r.userId === user?.id)

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (myReports.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No reports yet"
        description="Once you've added some expenses, select them on the My Expenses tab and create a report."
      />
    )
  }

  return (
    <div className="space-y-2">
      {myReports.map((report) => (
        <ReportRow key={report.id} report={report} onClick={() => onOpenReport(report.id)} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab: Approvals (manager / HR view)
// ─────────────────────────────────────────────────────────────────────────────

function ApprovalsTab({ onOpenReport }: { onOpenReport: (id: number) => void }) {
  const { user } = useAuthStore()
  const { data: reports, isLoading } = useExpenseReports()

  // "Approvals" tab shows reports awaiting decision that aren't mine.
  const pending = (reports ?? []).filter(
    (r) => r.status === 'AWAITING_APPROVAL' && r.userId !== user?.id
  )

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </div>
    )
  }

  if (pending.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No pending reports"
        description="When team members submit expense reports, they'll show up here for your approval."
      />
    )
  }

  return (
    <div className="space-y-2">
      {pending.map((report) => (
        <ReportRow key={report.id} report={report} onClick={() => onOpenReport(report.id)} showSubmitter />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared row card
// ─────────────────────────────────────────────────────────────────────────────

function ReportRow({
  report,
  onClick,
  showSubmitter,
}: {
  report: ExpenseReport
  onClick: () => void
  showSubmitter?: boolean
}) {
  const total = (report.lines ?? []).reduce((s, l) => s + parseFloat(l.amount || '0'), 0)
  const currency = report.lines?.[0]?.currency ?? 'HKD'
  return (
    <Card className="cursor-pointer hover:bg-muted/30 transition-colors" onClick={onClick}>
      <CardContent className="p-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium truncate">{report.title}</p>
            <ExpenseReportStatusBadge status={report.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {showSubmitter && report.user && `${report.user.name} • `}
            {report.lines?.length ?? 0} line{(report.lines?.length ?? 0) === 1 ? '' : 's'}
            {' • '}
            {currency} {total.toFixed(2)}
            {' • '}
            {format(new Date(report.createdAt), 'PP')}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
