import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format, isSameDay } from 'date-fns'
import { CalendarIcon, Upload, Info, Clock } from 'lucide-react'
import type { DateRange } from 'react-day-picker'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useLeaveTypes, useCalculateDays } from '@/hooks/useLeaveTypes'
import { useCreateLeaveRequest } from '@/hooks/useLeaveRequests'
import { useAuthStore } from '@/stores/authStore'

// Half-hour time slots from 07:30 to 19:00
const TIME_SLOTS: string[] = []
for (let h = 7; h <= 19; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  if (h < 19) TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}

const schema = z.object({
  leaveTypeId: z.string().min(1, 'Please select a leave type'),
  dateRange: z
    .object({
      from: z.date({ required_error: 'Start date is required' }),
      to: z.date().optional(),
    })
    .refine((d) => d.from, { message: 'Please select a start date' }),
  halfDay: z.boolean().default(false),
  halfDayPeriod: z.enum(['AM', 'PM']).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  reason: z.string().max(1000).optional(),
})

type FormData = z.infer<typeof schema>

interface RequestLeaveSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RequestLeaveSheet({ open, onOpenChange }: RequestLeaveSheetProps) {
  const { user } = useAuthStore()
  const { data: leaveTypes, isLoading: loadingTypes } = useLeaveTypes(user?.regionId)
  const createRequest = useCreateLeaveRequest()
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
    watch,
    setValue,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '', halfDay: false, halfDayPeriod: 'AM', startTime: '09:00', endTime: '10:00' },
  })

  const selectedTypeId = watch('leaveTypeId')
  const selectedType = leaveTypes?.find((lt) => lt.id.toString() === selectedTypeId)
  const dateRange = watch('dateRange')
  const halfDay = watch('halfDay')
  const startTime = watch('startTime')

  const isOnProbation = user?.isOnProbation ?? false

  const isSingleDay =
    dateRange?.from && (!dateRange.to || isSameDay(dateRange.from, dateRange.to))

  // Determine if this leave type uses hourly booking
  const minUnit = selectedType?.minUnit ?? '1_day'
  const isHourly = minUnit === '1_hour' || minUnit === '2_hours'
  const isHalfDayUnit = minUnit === 'half_day'

  // Build date strings for the API
  const startDateStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : undefined
  const endDateStr = dateRange?.to
    ? format(dateRange.to, 'yyyy-MM-dd')
    : startDateStr

  const halfDayPeriodWatch = watch('halfDayPeriod')
  const endTimeWatch = watch('endTime')

  // Parse hours for hourly display (endTime - startTime per slot)
  const parseHour = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    return h + (m || 0) / 60
  }
  const hoursPerSlot = isHourly && startTime && endTimeWatch
    ? parseHour(endTimeWatch) - parseHour(startTime)
    : 0

  const halfDayPeriodForCalc = (halfDay || isHalfDayUnit) ? halfDayPeriodWatch : undefined

  // Live day count
  const { data: dayCalc, isFetching: calcFetching } = useCalculateDays({
    startDate: startDateStr,
    endDate: endDateStr,
    leaveTypeId: selectedType?.id,
    halfDayPeriod: halfDayPeriodForCalc,
    regionId: user?.regionId,
  })

  const onSubmit = async (data: FormData) => {
    const startDate = format(data.dateRange.from, 'yyyy-MM-dd')
    const endDate = data.dateRange.to
      ? format(data.dateRange.to, 'yyyy-MM-dd')
      : startDate

    const halfDayPeriod =
      (data.halfDay || isHalfDayUnit) ? (data.halfDayPeriod ?? 'AM') : undefined

    await createRequest.mutateAsync({
      leaveTypeId: parseInt(data.leaveTypeId, 10),
      startDate,
      endDate,
      halfDayPeriod: halfDayPeriod ?? null,
      reason: data.reason || undefined,
      ...(isHourly ? { startTime: data.startTime ?? null, endTime: data.endTime ?? null } : {}),
    })

    reset()
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Request Leave</SheetTitle>
          <SheetDescription>
            Submit a new leave request. Weekends and public holidays are automatically
            excluded from the day count.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-5">
          {/* Leave Type */}
          <div className="space-y-1.5">
            <Label>Leave type</Label>
            <Controller
              name="leaveTypeId"
              control={control}
              render={({ field }) => (
                <Select onValueChange={field.onChange} value={field.value}>
                  <SelectTrigger className={cn(errors.leaveTypeId && 'border-destructive')}>
                    <SelectValue
                      placeholder={loadingTypes ? 'Loading...' : 'Select leave type'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {leaveTypes?.map((lt) => (
                      <SelectItem key={lt.id} value={lt.id.toString()}>
                        <span>{lt.name}</span>
                        {!lt.isPaid && (
                          <span className="ml-1 text-xs text-muted-foreground">(Unpaid)</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errors.leaveTypeId && (
              <p className="text-xs text-destructive">{errors.leaveTypeId.message}</p>
            )}
            {selectedType?.policy && (
              <p className="text-xs text-muted-foreground">
                Entitlement: {selectedType.policy.entitlementDays} days/year
              </p>
            )}
          </div>

          {/* Date Range */}
          <div className="space-y-1.5">
            <Label>{isHourly ? 'Date period' : 'Dates'}</Label>
            <Controller
              name="dateRange"
              control={control}
              render={({ field }) => (
                <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !field.value?.from && 'text-muted-foreground',
                        errors.dateRange && 'border-destructive'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {field.value?.from ? (
                        field.value.to && !isSameDay(field.value.from, field.value.to) ? (
                          `${format(field.value.from, 'd MMM yyyy')} – ${format(field.value.to, 'd MMM yyyy')}`
                        ) : (
                          format(field.value.from, 'd MMM yyyy')
                        )
                      ) : (
                        'Select dates'
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="range"
                      selected={field.value as DateRange}
                      onSelect={(range) => {
                        const hasCompleteRange =
                          !!(field.value?.from && field.value?.to &&
                             !isSameDay(field.value.from, field.value.to))
                        if (hasCompleteRange && range?.from) {
                          field.onChange({ from: range.from, to: undefined })
                          setValue('halfDay', false)
                          return
                        }
                        field.onChange(range)
                        setValue('halfDay', false)
                        if (range?.from && range?.to) {
                          setDatePickerOpen(false)
                        }
                      }}
                      disabled={(date) => date < new Date(new Date().setHours(0, 0, 0, 0))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              )}
            />
            {errors.dateRange && (
              <p className="text-xs text-destructive">
                {errors.dateRange.message ?? errors.dateRange.from?.message}
              </p>
            )}
          </div>

          {/* Hourly time slot — shown when minUnit is 1_hour or 2_hours */}
          {isHourly && (
            <div className="rounded-md border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Clock className="h-4 w-4 text-muted-foreground" />
                Daily time slot
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Start time</Label>
                  <Controller
                    name="startTime"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-48">
                          {TIME_SLOTS.map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">End time</Label>
                  <Controller
                    name="endTime"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent className="max-h-48">
                          {TIME_SLOTS.filter((t) => !startTime || t > startTime).map((t) => (
                            <SelectItem key={t} value={t}>{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                This daily time slot applies to each day in the period selected above.
              </p>
            </div>
          )}

          {/* Half-day option — shown when minUnit is half_day, or 1_day with a single day selected */}
          {!isHourly && isSingleDay && (isHalfDayUnit || minUnit === '1_day') && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              {!isHalfDayUnit && (
                <Controller
                  name="halfDay"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        id="half-day-toggle"
                      />
                      <Label htmlFor="half-day-toggle" className="cursor-pointer">
                        Half day only
                      </Label>
                    </div>
                  )}
                />
              )}
              {(halfDay || isHalfDayUnit) && (
                <Controller
                  name="halfDayPeriod"
                  control={control}
                  render={({ field }) => (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => field.onChange('AM')}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          field.value === 'AM'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        AM (morning)
                      </button>
                      <button
                        type="button"
                        onClick={() => field.onChange('PM')}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          field.value === 'PM'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        PM (afternoon)
                      </button>
                    </div>
                  )}
                />
              )}
            </div>
          )}

          {/* Half-day on first/last day — shown for multi-day 1_day or half_day unit leaves */}
          {!isHourly && !isSingleDay && (minUnit === '1_day' || minUnit === 'half_day') && startDateStr && endDateStr && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <Controller
                name="halfDay"
                control={control}
                render={({ field }) => (
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      id="multi-half-day-toggle"
                    />
                    <Label htmlFor="multi-half-day-toggle" className="cursor-pointer">
                      Half day on first or last day?
                    </Label>
                  </div>
                )}
              />
              {halfDay && (
                <Controller
                  name="halfDayPeriod"
                  control={control}
                  render={({ field }) => (
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => field.onChange('PM')}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          field.value === 'PM'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        First day (half day)
                      </button>
                      <button
                        type="button"
                        onClick={() => field.onChange('AM')}
                        className={`flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                          field.value === 'AM'
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-input bg-background text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        Last day (half day)
                      </button>
                    </div>
                  )}
                />
              )}
            </div>
          )}

          {/* Live day count */}
          {startDateStr && endDateStr && selectedType && (
            <div className="rounded-md border bg-blue-50 border-blue-200 px-3 py-2.5 text-sm">
              {calcFetching ? (
                <div className="flex items-center gap-2">
                  <Skeleton className="h-4 w-4 rounded-full" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ) : dayCalc ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-medium text-blue-800">
                    <CalendarIcon className="h-3.5 w-3.5" />
                    {isHourly
                      ? (() => {
                          const totalHours = hoursPerSlot > 0
                            ? Math.round(dayCalc.totalDays * hoursPerSlot * 2) / 2
                            : hoursPerSlot
                          return totalHours > 0
                            ? `${totalHours} hour${totalHours !== 1 ? 's' : ''}${dayCalc.totalDays > 1 ? ` (${dayCalc.totalDays} days × ${hoursPerSlot} hr${hoursPerSlot !== 1 ? 's' : ''}/day)` : ''}`
                            : `${dayCalc.totalDays} working day${dayCalc.totalDays !== 1 ? 's' : ''} — select a time slot above`
                        })()
                      : dayCalc.totalDays === 0.5
                        ? '0.5 days (half day)'
                        : `${dayCalc.totalDays} ${selectedType.dayCalculation === 'calendar_days' ? 'calendar' : 'working'} day${dayCalc.totalDays !== 1 ? 's' : ''}`}
                  </div>
                  {dayCalc.excludedDates.length > 0 && (
                    <p className="text-xs text-blue-700">
                      Excludes: {dayCalc.excludedDates.slice(0, 4).join(', ')}
                      {dayCalc.excludedDates.length > 4 && ` +${dayCalc.excludedDates.length - 4} more`}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <Label>
              Reason{' '}
              <span className="text-muted-foreground text-xs">(optional)</span>
            </Label>
            <Controller
              name="reason"
              control={control}
              render={({ field }) => (
                <Textarea
                  {...field}
                  placeholder="Briefly describe the reason for your leave..."
                  rows={3}
                  className="resize-none"
                />
              )}
            />
          </div>

          {/* Probation notice */}
          {isOnProbation && (
            <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                You are currently in your probation period. Your manager will be informed.
              </span>
            </div>
          )}

          {/* Attachment note */}
          {selectedType?.requiresAttachment && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                A supporting document (e.g. medical certificate) is required for this leave
                type. You can attach it after submission.
              </span>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={createRequest.isPending}
            >
              {createRequest.isPending ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  )
}
