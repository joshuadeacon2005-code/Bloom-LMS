import { useState } from 'react'
import { format } from 'date-fns'
import { CheckCircle, XCircle, Clock, History, CheckSquare } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { LeaveStatusBadge } from '@/components/leave/LeaveStatusBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import {
  usePendingApprovals,
  useApprovalHistory,
  useApproveRequest,
  useRejectRequest,
  type PendingApproval,
} from '@/hooks/useApprovals'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

// ─── Single card ──────────────────────────────────────────────────────────────

function ApprovalCard({
  approval,
  selected,
  onSelect,
  onApprove,
  onReject,
}: {
  approval: PendingApproval
  selected: boolean
  onSelect: (id: number, checked: boolean) => void
  onApprove: (id: number) => void
  onReject: (id: number) => void
}) {
  return (
    <Card className={`transition-all ${selected ? 'ring-2 ring-primary' : 'hover:shadow-md'}`}>
      <CardContent className="p-5">
        <div className="flex items-start gap-3">
          <Checkbox
            checked={selected}
            onCheckedChange={(v) => onSelect(approval.requestId, !!v)}
            className="mt-1 shrink-0"
          />

          <Avatar className="h-10 w-10 shrink-0">
            <AvatarImage src={approval.employee.avatarUrl ?? undefined} />
            <AvatarFallback style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>
              {approval.employee.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{approval.employee.name}</p>
                <p className="text-xs text-muted-foreground">{approval.employee.email}</p>
              </div>
              <Badge variant="outline" className="shrink-0 text-xs">
                {approval.leaveType.name}
                {!approval.leaveType.isPaid && ' (Unpaid)'}
              </Badge>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <span className="text-xs text-muted-foreground block">From</span>
                <span className="font-medium">{format(new Date(approval.startDate), 'd MMM yyyy')}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">To</span>
                <span className="font-medium">{format(new Date(approval.endDate), 'd MMM yyyy')}</span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Duration</span>
                <span className="font-medium">
                  {approval.totalDays} day{approval.totalDays !== 1 ? 's' : ''}
                </span>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block">Submitted</span>
                <span className="font-medium">{format(new Date(approval.submittedAt), 'd MMM')}</span>
              </div>
            </div>

            {approval.reason && (
              <p className="mt-2 text-sm text-muted-foreground italic line-clamp-2">
                &ldquo;{approval.reason}&rdquo;
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t pt-4">
          <Button
            variant="outline"
            size="sm"
            className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => onReject(approval.requestId)}
          >
            <XCircle className="mr-1.5 h-4 w-4" />
            Decline
          </Button>
          <Button
            size="sm"
            className="bg-green-600 hover:bg-green-700"
            onClick={() => onApprove(approval.requestId)}
          >
            <CheckCircle className="mr-1.5 h-4 w-4" />
            Approve
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─── Bulk action bar ──────────────────────────────────────────────────────────

function BulkBar({
  count,
  total,
  onSelectAll,
  onClearAll,
  onBulkApprove,
  onBulkReject,
  busy,
}: {
  count: number
  total: number
  onSelectAll: () => void
  onClearAll: () => void
  onBulkApprove: () => void
  onBulkReject: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-3">
        <Checkbox
          checked={count === total}
          onCheckedChange={(v) => (v ? onSelectAll() : onClearAll())}
        />
        <span className="text-sm font-medium">
          {count} of {total} selected
        </span>
        {count > 0 && (
          <button
            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            onClick={onClearAll}
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          className="border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={onBulkReject}
          disabled={count === 0 || busy}
        >
          <XCircle className="mr-1.5 h-3.5 w-3.5" />
          Decline {count > 0 ? count : ''}
        </Button>
        <Button
          size="sm"
          className="bg-green-600 hover:bg-green-700"
          onClick={onBulkApprove}
          disabled={count === 0 || busy}
        >
          <CheckSquare className="mr-1.5 h-3.5 w-3.5" />
          Approve {count > 0 ? count : ''}
        </Button>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function ApprovalsPage() {
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [actionId, setActionId] = useState<{ id: number; type: 'approve' | 'reject' } | null>(null)
  const [bulkAction, setBulkAction] = useState<'approve' | 'reject' | null>(null)
  const [comments, setComments] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)

  const qc = useQueryClient()
  const { data: pending, isLoading: loadingPending } = usePendingApprovals()
  const { data: history, isLoading: loadingHistory } = useApprovalHistory()
  const approve = useApproveRequest()
  const reject = useRejectRequest()

  const pendingList = pending?.data ?? []

  // ── Selection helpers ────────────────────────────────────────────────────

  function toggleSelect(id: number, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev)
      checked ? next.add(id) : next.delete(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(pendingList.map((a) => a.requestId)))
  }

  function clearAll() {
    setSelected(new Set())
  }

  // ── Single action ────────────────────────────────────────────────────────

  function handleConfirm() {
    if (!actionId) return
    if (actionId.type === 'approve') {
      approve.mutate({ requestId: actionId.id, comments: comments || undefined })
    } else {
      reject.mutate({ requestId: actionId.id, comments: comments || undefined })
    }
    setSelected((prev) => { const n = new Set(prev); n.delete(actionId.id); return n })
    setActionId(null)
    setComments('')
  }

  // ── Bulk action ──────────────────────────────────────────────────────────

  async function executeBulk(type: 'approve' | 'reject') {
    setBulkBusy(true)
    const ids = Array.from(selected)
    let succeeded = 0
    let failed = 0

    for (const id of ids) {
      try {
        await api.post(`/approvals/${id}/${type}`, {})
        succeeded++
      } catch {
        failed++
      }
    }

    if (failed === 0) {
      toast.success(`${succeeded} request${succeeded > 1 ? 's' : ''} ${type === 'approve' ? 'approved' : 'declined'}`)
    } else {
      toast.warning(`${succeeded} succeeded, ${failed} failed`)
    }

    await qc.invalidateQueries({ queryKey: ['approvals'] })
    await qc.invalidateQueries({ queryKey: ['leave-requests'] })
    await qc.invalidateQueries({ queryKey: ['balances'] })

    clearAll()
    setBulkBusy(false)
    setBulkAction(null)
    setComments('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Approvals</h2>
        <p className="text-sm text-muted-foreground">
          Review and action your team&apos;s leave requests
        </p>
      </div>

      <Tabs defaultValue="pending" onValueChange={() => clearAll()}>
        <TabsList>
          <TabsTrigger value="pending" className="gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            Pending
            {pending && pending.meta.total > 0 && (
              <Badge className="ml-1 h-5 px-1.5 text-xs">{pending.meta.total}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4 space-y-4">
          {loadingPending ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-44 w-full" />)}
            </div>
          ) : !pendingList.length ? (
            <EmptyState
              icon={CheckCircle}
              title="All caught up!"
              description="No pending leave requests require your approval."
              className="py-16"
            />
          ) : (
            <>
              <BulkBar
                count={selected.size}
                total={pendingList.length}
                onSelectAll={selectAll}
                onClearAll={clearAll}
                onBulkApprove={() => setBulkAction('approve')}
                onBulkReject={() => setBulkAction('reject')}
                busy={bulkBusy}
              />
              <div className="space-y-4">
                {pendingList.map((a) => (
                  <ApprovalCard
                    key={a.workflowId}
                    approval={a}
                    selected={selected.has(a.requestId)}
                    onSelect={toggleSelect}
                    onApprove={(id) => setActionId({ id, type: 'approve' })}
                    onReject={(id) => setActionId({ id, type: 'reject' })}
                  />
                ))}
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          {loadingHistory ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : !(history?.data as unknown[])?.length ? (
            <EmptyState
              icon={History}
              title="No approval history"
              description="Requests you approve or decline will appear here."
              className="py-16"
            />
          ) : (
            <div className="space-y-2">
              {(history?.data as Array<{
                workflowId: number
                status: string
                comments: string | null
                actionDate: string | null
                requestId: number
                startDate: string
                endDate: string
                totalDays: number
                employee: { id: number; name: string; email: string }
                leaveType: { id: number; name: string; code: string }
              }>).map((h) => (
                <Card key={h.workflowId}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-sm font-medium">{h.employee.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {h.leaveType.name} · {format(new Date(h.startDate), 'd MMM')} –{' '}
                        {format(new Date(h.endDate), 'd MMM yyyy')} · {h.totalDays}d
                      </p>
                      {h.comments && (
                        <p className="mt-0.5 text-xs text-muted-foreground italic">
                          &ldquo;{h.comments}&rdquo;
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <LeaveStatusBadge
                        status={h.status as 'approved' | 'rejected' | 'pending' | 'cancelled'}
                      />
                      {h.actionDate && (
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(h.actionDate), 'd MMM yyyy')}
                        </p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Single action dialog */}
      <Dialog
        open={actionId !== null}
        onOpenChange={() => { setActionId(null); setComments('') }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {actionId?.type === 'approve' ? 'Approve leave request?' : 'Decline leave request?'}
            </DialogTitle>
            <DialogDescription>
              {actionId?.type === 'approve'
                ? 'The employee will be notified that their leave has been approved.'
                : 'The employee will be notified that their request was not approved.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>
              Comments <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder={
                actionId?.type === 'approve'
                  ? 'Add a note for the employee...'
                  : 'Briefly explain the reason for declining...'
              }
              rows={3}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionId(null)}>
              Cancel
            </Button>
            <Button
              className={actionId?.type === 'reject' ? 'bg-destructive hover:bg-destructive/90' : ''}
              onClick={handleConfirm}
              disabled={approve.isPending || reject.isPending}
            >
              {actionId?.type === 'approve' ? 'Approve' : 'Decline'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk action confirmation dialog */}
      <Dialog
        open={bulkAction !== null}
        onOpenChange={(v) => { if (!v) { setBulkAction(null); setComments('') } }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {bulkAction === 'approve'
                ? `Approve ${selected.size} request${selected.size > 1 ? 's' : ''}?`
                : `Decline ${selected.size} request${selected.size > 1 ? 's' : ''}?`}
            </DialogTitle>
            <DialogDescription>
              {bulkAction === 'approve'
                ? `All ${selected.size} selected employees will be notified their leave is approved.`
                : `All ${selected.size} selected employees will be notified their requests were declined.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label>
              Comments <span className="text-muted-foreground text-xs">(optional — applied to all)</span>
            </Label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Add a note applied to all selected requests..."
              rows={3}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setBulkAction(null); setComments('') }}
              disabled={bulkBusy}
            >
              Cancel
            </Button>
            <Button
              className={bulkAction === 'reject' ? 'bg-destructive hover:bg-destructive/90' : 'bg-green-600 hover:bg-green-700'}
              onClick={() => bulkAction && executeBulk(bulkAction)}
              disabled={bulkBusy}
            >
              {bulkBusy
                ? 'Processing…'
                : bulkAction === 'approve'
                  ? `Approve ${selected.size}`
                  : `Decline ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
