import { useState } from 'react'
import { format, addDays } from 'date-fns'
import { CalendarDays, Clock, CheckCircle, Plus, ArrowRight, Timer } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { LeaveStatusBadge } from '@/components/leave/LeaveStatusBadge'
import { RequestLeaveSheet } from '@/components/leave/RequestLeaveSheet'
import { EmptyState } from '@/components/shared/EmptyState'
import { useAuthStore } from '@/stores/authStore'
import { useBalances } from '@/hooks/useBalances'
import { useLeaveRequests } from '@/hooks/useLeaveRequests'
import { useTeamCalendar } from '@/hooks/useLeaveRequests'
import { useOvertimeBalance } from '@/hooks/useOvertime'

export function DashboardPage() {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [requestSheetOpen, setRequestSheetOpen] = useState(false)

  const { data: balances, isLoading: loadingBalances } = useBalances()
  const { data: myRequests, isLoading: loadingRequests } = useLeaveRequests({
    pageSize: 5,
  })

  const today = format(new Date(), 'yyyy-MM-dd')
  const nextWeek = format(addDays(new Date(), 7), 'yyyy-MM-dd')

  const { data: teamAbsences, isLoading: loadingTeam } = useTeamCalendar({
    startDate: today,
    endDate: nextWeek,
    regionId: user?.regionId,
  })

  const { data: otBalance } = useOvertimeBalance()

  const pendingCount = myRequests?.data.filter((r) => r.status === 'pending').length ?? 0
  const paidBalances = balances?.filter((b) => b.leaveType?.isPaid && b.available > 0) ?? []

  return (
    <div className="space-y-6">
      {/* Welcome + quick actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            Good morning, {user?.name.split(' ')[0]} 👋
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {format(new Date(), 'EEEE, d MMMM yyyy')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setRequestSheetOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" />
            Request Leave
          </Button>
          <Button variant="outline" onClick={() => navigate('/calendar')}>
            <CalendarDays className="mr-1.5 h-4 w-4" />
            Calendar
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Pending requests */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Pending Requests
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingRequests ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <>
                <div className="text-3xl font-bold text-foreground">{pendingCount}</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {pendingCount === 1 ? 'request' : 'requests'} awaiting approval
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Team away today */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Team Away Today
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loadingTeam ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <>
                <div className="text-3xl font-bold text-foreground">
                  {teamAbsences?.filter((a) => a.startDate <= today && a.endDate >= today).length ?? 0}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">colleagues on leave</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Top leave balance */}
        {loadingBalances ? (
          <Card>
            <CardContent className="pt-6">
              <Skeleton className="h-16 w-full" />
            </CardContent>
          </Card>
        ) : paidBalances[0] ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {paidBalances[0].leaveType?.name}
              </CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {paidBalances[0].available}
                <span className="ml-1 text-base font-normal text-muted-foreground">
                  / {paidBalances[0].entitled}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">days remaining</p>
              <Progress
                value={(paidBalances[0].available / paidBalances[0].entitled) * 100}
                className="mt-3 h-1.5"
              />
            </CardContent>
          </Card>
        ) : null}

        {/* Pending overtime compensation */}
        {otBalance && otBalance.pendingCount > 0 && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Overtime Pending
              </CardTitle>
              <Timer className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">{otBalance.pendingCount}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {otBalance.pendingDays}d awaiting approval
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Leave balances */}
      {!loadingBalances && balances && balances.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Leave Balances — {new Date().getFullYear()}</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              onClick={() => navigate('/my-leave')}
            >
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {balances.slice(0, 4).map((b) => (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-foreground">{b.leaveType?.name}</span>
                    <span className="text-muted-foreground">
                      {b.available} / {b.entitled} days
                    </span>
                  </div>
                  <Progress
                    value={b.entitled > 0 ? (b.available / b.entitled) * 100 : 0}
                    className="h-2"
                  />
                  {b.used > 0 && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {b.used} used · {b.pending > 0 ? `${b.pending} pending · ` : ''}
                      {b.carried > 0 ? `${b.carried} carried over` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent requests + team away */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent requests */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Recent Requests</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              className="text-primary"
              onClick={() => navigate('/my-leave')}
            >
              View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            {loadingRequests ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !myRequests?.data.length ? (
              <EmptyState
                title="No leave requests yet"
                description="Your submitted leave requests will appear here."
              />
            ) : (
              <div className="space-y-3">
                {myRequests.data.map((r) => (
                  <div key={r.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{r.leaveType?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(r.startDate), 'd MMM')} –{' '}
                        {format(new Date(r.endDate), 'd MMM yyyy')} · {r.totalDays}d
                      </p>
                    </div>
                    <LeaveStatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Team away next 7 days */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team Away — Next 7 Days</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingTeam ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !teamAbsences?.length ? (
              <EmptyState
                title="No team absences"
                description="No colleagues are on leave in the next 7 days."
              />
            ) : (
              <div className="space-y-2.5">
                {teamAbsences.slice(0, 6).map((a) => (
                  <div key={a.id} className="flex items-center gap-2.5">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={a.user?.avatarUrl ?? undefined} />
                      <AvatarFallback className="text-xs" style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}>
                        {a.user?.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{a.user?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(a.startDate), 'd MMM')} –{' '}
                        {format(new Date(a.endDate), 'd MMM')} · {a.leaveType?.name}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <RequestLeaveSheet open={requestSheetOpen} onOpenChange={setRequestSheetOpen} />
    </div>
  )
}
