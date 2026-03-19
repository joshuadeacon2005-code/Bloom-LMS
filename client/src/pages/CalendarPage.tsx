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
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { useTeamCalendar, usePublicHolidays } from '@/hooks/useLeaveRequests'
import { useRegions } from '@/hooks/useAdmin'
import { useAuthStore } from '@/stores/authStore'
import type { PublicHoliday } from '@/hooks/useLeaveRequests'

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

function getDayPeriod(a: { halfDayPeriod?: string | null; startDate: string; endDate: string }, dateStr: string): string | null {
  if (!a.halfDayPeriod) return null
  if (a.startDate === a.endDate) return a.halfDayPeriod
  if (a.halfDayPeriod === 'PM' && dateStr === a.startDate) return 'PM'
  if (a.halfDayPeriod === 'AM' && dateStr === a.endDate) return 'AM'
  return null
}

interface Absence {
  id: number
  startDate: string
  endDate: string
  halfDayPeriod?: string | null
  leaveType?: { id: number; name: string; color?: string | null }
  user?: { id: number; name: string; avatarUrl?: string | null }
}

function CalendarDayCell({
  date,
  isCurrentMonth,
  absences,
  isToday,
  holidays,
}: {
  date: Date
  isCurrentMonth: boolean
  absences: Absence[]
  isToday: boolean
  holidays: PublicHoliday[]
}) {
  const [overflowOpen, setOverflowOpen] = useState(false)
  const weekend = isWeekend(date)
  const dateStr = format(date, 'yyyy-MM-dd')
  const dayAbsences = absences.filter(
    (a) => a.startDate <= dateStr && a.endDate >= dateStr,
  )
  const dayHolidays = holidays.filter((h) => h.date === dateStr)
  const isHoliday = dayHolidays.length > 0

  return (
    <>
      <div
        className={`min-h-[90px] border-b border-r border-border p-1.5 ${
          !isCurrentMonth
            ? 'bg-muted/30'
            : isHoliday
              ? 'bg-red-50/60 dark:bg-red-950/20'
              : weekend
                ? 'bg-muted/10'
                : ''
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
          {/* Public holiday banners */}
          {dayHolidays.map((h) => (
            <Tooltip key={h.id}>
              <TooltipTrigger asChild>
                <div className="truncate rounded bg-red-200/80 px-1 py-0.5 text-xs font-medium text-red-900 dark:bg-red-800/60 dark:text-red-100">
                  {h.name}{h.halfDay ? ` (${h.halfDay} off)` : ''}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{h.name}</p>
                <p className="text-muted-foreground">
                  {h.halfDay ? `${h.halfDay === 'AM' ? 'Morning' : 'Afternoon'} off` : 'Public Holiday'}
                </p>
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Team absences */}
          {dayAbsences.slice(0, 3).map((a) => {
            const dbColor = a.leaveType?.color
            const bgClass = dbColor ? '' : getLeaveColour(a.leaveType?.id ?? 0)
            const period = getDayPeriod(a, dateStr)
            return (
              <Tooltip key={a.id}>
                <TooltipTrigger asChild>
                  <div
                    className={`flex cursor-default items-center gap-1 rounded px-1 py-0.5 ${bgClass} bg-opacity-15`}
                    style={dbColor ? { backgroundColor: dbColor + '26' } : undefined}
                  >
                    <div
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${dbColor ? '' : bgClass}`}
                      style={dbColor ? { backgroundColor: dbColor } : undefined}
                    />
                    <span className="truncate text-xs font-medium text-foreground">
                      {a.user?.name.split(' ')[0]}
                      {period ? ` (${period})` : ''}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">{a.user?.name}</p>
                  <p className="text-muted-foreground">
                    {a.leaveType?.name}{period ? ` (${period})` : ''}
                  </p>
                  <p className="text-muted-foreground">
                    {format(new Date(a.startDate), 'd MMM')} –{' '}
                    {format(new Date(a.endDate), 'd MMM yyyy')}
                  </p>
                </TooltipContent>
              </Tooltip>
            )
          })}
          {dayAbsences.length > 3 && (
            <button
              onClick={() => setOverflowOpen(true)}
              className="pl-1 text-xs text-primary hover:underline focus:outline-none"
            >
              +{dayAbsences.length - 3} more
            </button>
          )}
        </div>
      </div>

      <Dialog open={overflowOpen} onOpenChange={setOverflowOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{format(date, 'EEEE, d MMMM yyyy')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 pt-1">
            {dayAbsences.map((a) => {
              const dlgPeriod = getDayPeriod(a, dateStr)
              return (
              <div key={a.id} className="flex items-start gap-3">
                <div
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${a.leaveType?.color ? '' : getLeaveColour(a.leaveType?.id ?? 0)}`}
                  style={a.leaveType?.color ? { backgroundColor: a.leaveType.color } : undefined}
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight">
                    {a.user?.name}
                    {dlgPeriod ? (
                      <span className="ml-1 text-xs font-normal text-muted-foreground">({dlgPeriod})</span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{a.leaveType?.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {format(new Date(a.startDate), 'd MMM')} – {format(new Date(a.endDate), 'd MMM yyyy')}
                  </p>
                </div>
              </div>
            )})}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

const CALENDAR_REGION_KEY = 'bloomCalendarRegionId'

export function CalendarPage() {
  const { user } = useAuthStore()
  const [currentMonth, setCurrentMonth] = useState(new Date())

  const isHROrAdmin = user?.role === 'hr_admin' || user?.role === 'super_admin'

  const [selectedRegionId, setSelectedRegionId] = useState<number>(() => {
    const stored = localStorage.getItem(CALENDAR_REGION_KEY)
    return stored ? parseInt(stored, 10) : (user?.regionId ?? 0)
  })

  const { data: regions } = useRegions()

  const startDate = format(
    startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 }),
    'yyyy-MM-dd',
  )
  const endDate = format(
    endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 }),
    'yyyy-MM-dd',
  )

  const effectiveRegionId = isHROrAdmin ? selectedRegionId : user?.regionId

  const { data: absences, isLoading } = useTeamCalendar({
    startDate,
    endDate,
    regionId: effectiveRegionId,
  })

  const { data: holidays = [] } = usePublicHolidays({
    regionId: effectiveRegionId,
    year: currentMonth.getFullYear(),
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

  // Holidays this month (for "upcoming" section)
  const monthStr = format(currentMonth, 'yyyy-MM')
  const monthHolidays = holidays.filter((h) => h.date.startsWith(monthStr))

  function handleRegionChange(value: string) {
    const id = parseInt(value, 10)
    setSelectedRegionId(id)
    localStorage.setItem(CALENDAR_REGION_KEY, value)
  }

  const selectedRegion = regions?.find((r) => r.id === selectedRegionId)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Team Calendar</h2>
          <p className="text-sm text-muted-foreground">
            {selectedRegion
              ? `${selectedRegion.name} — team absences and public holidays`
              : 'View team absences and plan ahead'}
          </p>
        </div>

        {isHROrAdmin && regions && regions.length > 0 && (
          <Select value={String(selectedRegionId)} onValueChange={handleRegionChange}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Select region" />
            </SelectTrigger>
            <SelectContent>
              {regions.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
          <div className="flex flex-wrap gap-3 pt-2">
            {monthHolidays.length > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="h-2.5 w-2.5 rounded-sm bg-red-500" />
                <span className="text-xs text-muted-foreground">Public holiday</span>
              </div>
            )}
            {leaveTypes.map((lt) => (
              <div key={lt.id} className="flex items-center gap-1.5">
                <div
                  className={`h-2.5 w-2.5 rounded-full ${lt.color ? '' : getLeaveColour(lt.id)}`}
                  style={lt.color ? { backgroundColor: lt.color } : undefined}
                />
                <span className="text-xs text-muted-foreground">{lt.name}</span>
              </div>
            ))}
          </div>
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
                  holidays={holidays}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Public Holidays this month */}
      {!isLoading && monthHolidays.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <h3 className="text-base font-semibold">
              Public Holidays in {format(currentMonth, 'MMMM')}
            </h3>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {monthHolidays.map((h) => (
                <div key={h.id} className="flex items-center gap-3">
                  <div className="min-w-[48px] text-sm font-medium text-red-700 dark:text-red-400">
                    {format(new Date(h.date), 'd MMM')}
                  </div>
                  <span className="text-sm">
                    {h.name}
                    {h.halfDay ? <span className="ml-1 text-xs text-muted-foreground">({h.halfDay} off)</span> : ''}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

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
                            {a.leaveType?.name}{a.halfDayPeriod ? ` (${a.halfDayPeriod})` : ''}: {format(new Date(a.startDate), 'd MMM')} –{' '}
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
