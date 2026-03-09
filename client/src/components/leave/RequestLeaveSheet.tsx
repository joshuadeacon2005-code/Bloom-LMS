import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { format } from 'date-fns'
import { CalendarIcon, Upload } from 'lucide-react'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { useLeaveTypes } from '@/hooks/useLeaveTypes'
import { useCreateLeaveRequest } from '@/hooks/useLeaveRequests'
import { useAuthStore } from '@/stores/authStore'

const schema = z.object({
  leaveTypeId: z.string().min(1, 'Please select a leave type'),
  dateRange: z
    .object({
      from: z.date({ required_error: 'Start date is required' }),
      to: z.date().optional(),
    })
    .refine((d) => d.from, { message: 'Please select a start date' }),
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
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { reason: '' },
  })

  const selectedTypeId = watch('leaveTypeId')
  const selectedType = leaveTypes?.find((lt) => lt.id.toString() === selectedTypeId)

  const onSubmit = async (data: FormData) => {
    const startDate = format(data.dateRange.from, 'yyyy-MM-dd')
    const endDate = data.dateRange.to
      ? format(data.dateRange.to, 'yyyy-MM-dd')
      : startDate

    await createRequest.mutateAsync({
      leaveTypeId: parseInt(data.leaveTypeId, 10),
      startDate,
      endDate,
      reason: data.reason || undefined,
    })

    reset()
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
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
            <Label>Dates</Label>
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
                        field.value.to ? (
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
                        field.onChange(range)
                        if (range?.from && range?.to) setDatePickerOpen(false)
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
