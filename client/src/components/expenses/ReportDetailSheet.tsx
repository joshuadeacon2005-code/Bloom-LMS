import { useState } from 'react'
import { format } from 'date-fns'
import {
  Send,
  Check,
  X,
  RefreshCw,
  RotateCcw,
  ExternalLink,
  Paperclip,
  Loader2,
  AlertTriangle,
  History,
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ExpenseReportStatusBadge } from './ExpenseReportStatusBadge'
import {
  useExpenseReport,
  useSendForApproval,
  useApproveReport,
  useRejectReport,
  useResubmitReport,
  useRetrySync,
} from '@/hooks/useExpenses'
import { useAuthStore } from '@/stores/authStore'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportId: number | null
}

export function ReportDetailSheet({ open, onOpenChange, reportId }: Props) {
  const { user } = useAuthStore()
  const { data: report, isLoading } = useExpenseReport(reportId)

  const sendForApproval = useSendForApproval()
  const approveReport = useApproveReport()
  const rejectReport = useRejectReport()
  const resubmitReport = useResubmitReport()
  const retrySync = useRetrySync()

  const [showAudit, setShowAudit] = useState(false)
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  if (!reportId) return null

  const isOwner = user?.id === report?.user?.id
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(user?.role ?? '')

  const total = (report?.lines ?? []).reduce((s, l) => s + parseFloat(l.amount || '0'), 0)
  const reportCurrency = report?.lines?.[0]?.currency ?? 'HKD'

  const closeAndReset = () => {
    setRejectDialogOpen(false)
    setRejectNote('')
    onOpenChange(false)
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <SheetTitle className="truncate">{report?.title ?? 'Loading…'}</SheetTitle>
                <SheetDescription>
                  {report?.user && `Submitted by ${report.user.name}`}
                  {report?.createdAt && ` • ${format(new Date(report.createdAt), 'PP')}`}
                </SheetDescription>
              </div>
              {report && <ExpenseReportStatusBadge status={report.status} />}
            </div>
          </SheetHeader>

          <div className="space-y-5 py-4 px-4">
            {isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading report…
              </div>
            )}

            {report && (
              <>
                {/* Summary */}
                <Card>
                  <CardContent className="p-4 grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-muted-foreground">Lines</p>
                      <p className="text-xl font-semibold">{report.lines?.length ?? 0}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Total</p>
                      <p className="text-xl font-semibold">
                        {reportCurrency} {total.toFixed(2)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Sync attempts</p>
                      <p className="text-xl font-semibold">{report.syncAttempts}</p>
                    </div>
                  </CardContent>
                </Card>

                {/* Sync error */}
                {report.status === 'SYNC_FAILED' && report.syncError && (
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="p-3 flex gap-2 text-sm">
                      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-medium text-red-900">NetSuite sync failed</p>
                        <p className="text-red-800 break-words">{report.syncError}</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Rejection note */}
                {report.status === 'REJECTED' && report.rejectionNote && (
                  <Card className="border-amber-200 bg-amber-50">
                    <CardContent className="p-3 text-sm">
                      <p className="font-medium text-amber-900">Rejection reason</p>
                      <p className="text-amber-800">{report.rejectionNote}</p>
                    </CardContent>
                  </Card>
                )}

                {/* NetSuite link */}
                {report.status === 'SYNCED' && report.netsuiteUrl && (
                  <a
                    href={report.netsuiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    View in NetSuite (id {report.netsuiteId})
                  </a>
                )}

                {/* Lines */}
                <div>
                  <h3 className="font-medium mb-2">Lines</h3>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead className="w-12 text-center">Receipt</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(report.lines ?? []).map((line) => (
                          <TableRow key={line.id}>
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
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Audit log toggle */}
                <div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAudit((v) => !v)}
                    className="text-muted-foreground"
                  >
                    <History className="h-4 w-4 mr-2" />
                    {showAudit ? 'Hide' : 'Show'} history
                  </Button>
                  {showAudit && (
                    <div className="mt-2 space-y-1.5 text-sm">
                      {(report.auditLog ?? []).map((entry) => (
                        <div key={entry.id} className="border-l-2 border-muted pl-3 py-1">
                          <p className="font-medium">
                            {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                            {entry.toStatus}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {format(new Date(entry.createdAt), 'PPp')}
                            {entry.actorName && ` • ${entry.actorName}`}
                          </p>
                          {entry.note && <p className="text-xs">{entry.note}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                  {report.status === 'PENDING_REVIEW' && isOwner && (
                    <Button
                      onClick={() => sendForApproval.mutate({ id: report.id })}
                      disabled={sendForApproval.isPending}
                    >
                      <Send className="h-4 w-4 mr-2" />
                      Send for Approval
                    </Button>
                  )}

                  {report.status === 'AWAITING_APPROVAL' && (isHrOrAbove || !isOwner) && (
                    <>
                      <Button
                        onClick={() => approveReport.mutate({ id: report.id })}
                        disabled={approveReport.isPending}
                      >
                        <Check className="h-4 w-4 mr-2" />
                        Approve
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => setRejectDialogOpen(true)}
                        disabled={rejectReport.isPending}
                      >
                        <X className="h-4 w-4 mr-2" />
                        Reject
                      </Button>
                    </>
                  )}

                  {report.status === 'REJECTED' && isOwner && (
                    <Button
                      onClick={() => resubmitReport.mutate({ id: report.id })}
                      disabled={resubmitReport.isPending}
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      Resubmit
                    </Button>
                  )}

                  {report.status === 'SYNC_FAILED' && (isOwner || isHrOrAbove) && (
                    <Button
                      onClick={() => retrySync.mutate({ id: report.id })}
                      disabled={retrySync.isPending}
                    >
                      <RefreshCw className="h-4 w-4 mr-2" />
                      Retry Sync
                    </Button>
                  )}

                  <Button variant="outline" onClick={closeAndReset}>
                    Close
                  </Button>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Reject confirmation */}
      <Dialog open={rejectDialogOpen} onOpenChange={setRejectDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject expense report?</DialogTitle>
            <DialogDescription>
              The submitter can edit lines and resubmit, or delete the report and start over.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="reject-note">Reason (shown to submitter)</Label>
            <Textarea
              id="reject-note"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="e.g. Missing receipt for the dinner expense"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!report) return
                await rejectReport.mutateAsync({ id: report.id, note: rejectNote.trim() || undefined })
                setRejectDialogOpen(false)
                setRejectNote('')
              }}
              disabled={rejectReport.isPending}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
