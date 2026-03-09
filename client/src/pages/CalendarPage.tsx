import { useState } from 'react'
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths,
  subMonths,
  isWeekend,
  startOfWeek,
  endOfWeek,
} from 'date-fns'
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { EmptyState } from '@/components/shared/EmptyState'
import { useTeamCalendar } from '@/hooks/useLeaveRequests'
import { useAuthStore } from '@/stores/authStore'

const LEAVE_COLOURS = [
  'bg-blue-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-teal-500',
]

function getLeaveColour(leaveTypeId: number) {
  return LEAVE_COLOURS[leaveTypeId % LEAVE_COLOURS.length]
}

interface Absence {
  id: number
  startDate: string
  endDate: string
  leaveType?: { id: number; name: string }
  user?: { id: number; name: string; avatarUrl?: string | null }
}

function CalendarDayCell({
  date,
  isCurrentMonth,
  absences,
  isToday,
}: {
  date: Date
  isCurrentMonth: boolean
  absences: Absence[]
  isToday: boolean
}) {
  const weekend = isWeekend(date)
  const dateStr = format(date, 'yyyy-MM-dd')
  const dayAbsences = absences.filter(
    (a) => a.startDate <= dateStr && a.endDate >= dateStr,
  )

  return (
    <div
      className={`min-h-[90px] border-b border-r border-border p-1.5 ${
        !isCurrentMonth ? 'bg-muted/30' : weekend ? 'bg-muted/10' : ''
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
            isToday
              ? 'bg-primary text-primary-foreground'
              : !isCurrentMonth
                ? 'text-muted-foreground/50'
                : weekend
                  ? 'text-muted-foreground'
                  : 'text-foreground'
          }`}
        >
          {format(date, 'd')}
        </span>
      </div>

      <div className="space-y-0.5">
        {dayAbsences.slice(0, 3).map((a) => (
          <Tooltip key={a.id}>
            <TooltipTrigger asChild>
              <div
                className={`flex cursor-default items-center gap-1 rounded px-1 py-0.5 ${getLeaveColour(a.leaveType?.id ?? 0)} bg-opacity-15`}
              >
                <div
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${getLeaveColour(a.leaveType?.id ?? 0)}`}
                />
                <span className="truncate text-xs font-medium text-foreground">
                  {a.user?.name.split(' ')[0]}
                </span>
              </div>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              <p className="font-medium">{a.user?.name}</p>
              <p className="text-muted-foreground">{a.leaveType?.name}</p>
              <p className="text-muted-foreground">
                {format(new Date(a.startDate), 'd MMM')} –{' '}
                {format(new Date(a.endDate), 'd MMM yyyy')}
              </p>
            </TooltipContent>
          </Tooltip>
        ))}
        {dayAbsences.length > 3 && (
          <p className="pl-1 text-xs text-muted-foreground">
            +{dayAbsences.length - 3} more
          </p>
        )}
      </div>
    </div>
  )
}

export function CalendarPage() {
  const { user } = useAuthStore()
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const startDate = format(
    startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }),
    'yyyy-MM-dd',
  )
  const endDate = format(
    endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }),
    'yyyy-MM-dd',
  )

  const { data: absences, isLoading } = useTeamCalendar({
    startDate,
    endDate,
    regionId: user?.regionId,
  })

  const today = new Date()
  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
  const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

  // Unique leave types for legend
  const leaveTypes = Array.from(
    new Map(
      (absences ?? [])
        .filter((a) => a.leaveType)
        .map((a) => [a.leaveType!.id, a.leaveType!]),
    ).values(),
  )

  // People on leave this month
  const uniqueAbsentees = Array.from(
    new Map(
      (absences ?? [])
        .filter((a) => a.user)
        .map((a) => [a.user!.id, a.user!]),
    ).values(),
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Team Calendar</h2>
          <p className="text-sm text-muted-foreground">
            View team absences and plan ahead
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          {/* Month navigation */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold">
              {format(currentMonth, 'MMMM yyyy')}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => setCurrentMonth(new Date())}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Legend */}
          {leaveTypes.length > 0 && (
            <div className="flex flex-wrap gap-3 pt-2">
              {leaveTypes.map((lt) => (
                <div key={lt.id} className="flex items-center gap-1.5">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${getLeaveColour(lt.id)}`}
                  />
                  <span className="text-xs text-muted-foreground">{lt.name}</span>
                </div>
              ))}
            </div>
          )}
        </CardHeader>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="grid grid-cols-7">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div
                  key={d}
                  className="border-b border-r border-border p-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="min-h-[90px] border-b border-r border-border p-1.5">
                  <Skeleton className="h-5 w-5 rounded-full" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7">
              {/* Day headers */}
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div
                  key={d}
                  className="border-b border-r border-border p-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {d}
                </div>
              ))}

              {/* Calendar cells */}
              {calendarDays.map((day) => (
                <CalendarDayCell
                  key={day.toISOString()}
                  date={day}
                  isCurrentMonth={isSameMonth(day, currentMonth)}
                  absences={absences ?? []}
                  isToday={isSameDay(day, today)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Who's away this month */}
      {!isLoading && (
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-base font-semibold">
              Away in {format(currentMonth, 'MMMM')}
            </h3>
          </CardHeader>
          <CardContent>
            {uniqueAbsentees.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No absences this month"
                description="No team members are on leave this month."
                className="py-8"
              />
            ) : (
              <div className="flex flex-wrap gap-3">
                {uniqueAbsentees.map((u) => {
                  const userAbsences = (absences ?? []).filter(
                    (a) => a.user?.id === u.id,
                  )
                  return (
                    <Tooltip key={u.id}>
                      <TooltipTrigger asChild>
                        <div className="flex cursor-default flex-col items-center gap-1">
                          <Avatar className="h-9 w-9">
                            <AvatarImage src={u.avatarUrl ?? undefined} />
                            <AvatarFallback
                              className="text-xs"
                              style={{
                                backgroundColor: 'var(--color-primary)',
                                color: 'white',
                              }}
                            >
                              {u.name
                                .split(' ')
                                .map((n) => n[0])
                                .join('')
                                .slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="max-w-[60px] truncate text-center text-xs text-muted-foreground">
                            {u.name.split(' ')[0]}
                          </span>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="text-xs">
                        <p className="font-medium">{u.name}</p>
                        {userAbsences.map((a) => (
                          <p key={a.id} className="text-muted-foreground">
                            {a.leaveType?.name}: {format(new Date(a.startDate), 'd MMM')} –{' '}
                            {format(new Date(a.endDate), 'd MMM')}
                          </p>
                        ))}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
