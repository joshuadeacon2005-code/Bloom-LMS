import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { cn } from '@/lib/utils'
import {
  Plus,
  Pencil,
  UserX,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Check,
  Slack,
  RefreshCw,
  Send,
  Wifi,
  WifiOff,
  History,
  CheckSquare,
  Paperclip,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { format, addMonths, parse } from 'date-fns'
import { useAuthStore } from '@/stores/authStore'
import {
  useRegions,
  useAdminUsers,
  useManagers,
  useCreateUser,
  useUpdateUser,
  useDeactivateUser,
  useAdminLeaveTypes,
  useCreateLeaveType,
  useUpdateLeaveType,
  useDeleteLeaveType,
  usePolicies,
  useUpsertPolicy,
  useDeletePolicy,
  useHolidays,
  useCreateHoliday,
  useDeleteHoliday,
  useSlackStatus,
  useSlackTestDm,
  useSlackSync,
  useSlackCommandsEnabled,
  useToggleSlackCommands,
  useEntitlements,
  useUpdateEntitlement,
  useBulkUpdateEntitlements,
  useEntitlementAudit,
  usePolicyTiers,
  useCreateTier,
  useUpdateTier,
  useDeleteTier,
  useEmployeeLeaveHistory,
  type SlackSyncResult,
  type AdminUser,
  type LeaveType,
  type LeavePolicy,
  type CreateHolidayInput,
  type ManagerOption,
  type EntitlementRow,
  type AuditLogEntry,
  type PolicyTier,
  type EmployeeLeaveRequest,
} from '@/hooks/useAdmin'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr_admin: 'HR Admin',
  super_admin: 'Super Admin',
}

const ROLE_COLOURS: Record<string, string> = {
  employee: 'bg-muted text-muted-foreground',
  manager: 'bg-blue-100 text-blue-800',
  hr_admin: 'bg-purple-100 text-purple-800',
  super_admin: 'bg-primary/10 text-primary',
}

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const currentYear = new Date().getFullYear()

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null
  return <p className="text-xs text-destructive mt-1">{msg}</p>
}

// ─── ManagerCombobox ──────────────────────────────────────────────────────────

function ManagerCombobox({
  value,
  onChange,
  managers,
  role,
}: {
  value: string
  onChange: (v: string) => void
  managers: ManagerOption[]
  role: string
}) {
  const [open, setOpen] = useState(false)
  const selected = managers.find((m) => String(m.id) === value && value !== '__none__')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate">
            {selected
              ? `${selected.name}${selected.regionName ? ` — ${selected.regionName}` : ''}`
              : 'Select manager…'}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[380px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search managers…" />
          <CommandList>
            <CommandEmpty>No managers found</CommandEmpty>
            <CommandGroup>
              {(role === 'super_admin' || role === 'hr_admin') && (
                <CommandItem
                  value="__none__ no manager"
                  onSelect={() => {
                    onChange('__none__')
                    setOpen(false)
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', (value === '__none__' || !value) ? 'opacity-100' : 'opacity-0')} />
                  No manager
                </CommandItem>
              )}
              {managers.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`${m.name} ${m.regionName ?? ''} ${m.email}`}
                  onSelect={() => {
                    onChange(String(m.id))
                    setOpen(false)
                  }}
                >
                  <Check className={cn('mr-2 h-4 w-4', value === String(m.id) ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1 truncate">{m.name}</span>
                  {m.regionName && (
                    <span className="ml-2 text-xs text-muted-foreground shrink-0">{m.regionName}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// ─── EmployeeHistorySheet ─────────────────────────────────────────────────────

const STATUS_COLOURS_HISTORY: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  cancelled: 'bg-muted text-muted-foreground',
  pending_hr: 'bg-blue-100 text-blue-800',
}

function EmployeeHistorySheet({
  user,
  onClose,
}: {
  user: AdminUser | null
  onClose: () => void
}) {
  const { data: history, isLoading } = useEmployeeLeaveHistory(user?.id)

  return (
    <Sheet open={!!user} onOpenChange={(v) => { if (!v) onClose() }}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{user?.name} — Leave History</SheetTitle>
          <SheetDescription>{user?.email}</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-2">
          {isLoading ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : !history || history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No leave requests found for this employee.
            </p>
          ) : (
            history.map((req: EmployeeLeaveRequest) => {
              const days = parseFloat(req.totalDays)
              const halfDayLabel = req.halfDayPeriod ? ` (${req.halfDayPeriod === 'AM' ? 'morning' : 'afternoon'})` : ''
              const dayLabel = days === 0.5 ? `0.5 days${halfDayLabel}` : `${days} day${days !== 1 ? 's' : ''}${halfDayLabel}`
              const dateLabel =
                req.startDate === req.endDate
                  ? req.startDate
                  : `${req.startDate} → ${req.endDate}`
              const statusColour = STATUS_COLOURS_HISTORY[req.status] ?? 'bg-muted text-muted-foreground'
              return (
                <div key={req.id} className="rounded-lg border px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm truncate">
                      {req.leaveTypeName ?? req.leaveTypeCode ?? '—'}
                    </span>
                    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColour}`}>
                      {req.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {dateLabel} · {dayLabel}
                  </p>
                  {req.reason && (
                    <p className="text-xs text-muted-foreground italic line-clamp-2">{req.reason}</p>
                  )}
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-muted-foreground/60">
                      Submitted {format(new Date(req.createdAt), 'd MMM yyyy')}
                    </p>
                    {req.attachmentUrl && (
                      <a
                        href={req.attachmentUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                      >
                        <Paperclip className="h-3 w-3" />
                        Attachment
                      </a>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().min(2, 'Name required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'At least 8 characters').optional().or(z.literal('')),
  role: z.enum(['employee', 'manager', 'hr_admin', 'super_admin']),
  regionId: z.string().min(1, 'Region required'),
  managerId: z.string().optional(),
  isActive: z.boolean().optional(),
  isOnProbation: z.boolean().optional(),
  probationMonths: z.number().nullable().optional(),
  joinedDate: z.string().optional(),
})
type UserFormData = z.infer<typeof createUserSchema>

function UserDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: AdminUser | null
}) {
  const { data: regions } = useRegions()
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()

  const {
    register,
    control,
    handleSubmit,
    watch,
    reset,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(createUserSchema),
    defaultValues: editing
      ? {
          name: editing.name,
          email: editing.email,
          role: editing.role,
          regionId: String(editing.regionId),
          managerId: editing.managerId ? String(editing.managerId) : '',
          isActive: editing.isActive,
          isOnProbation: editing.isOnProbation,
          probationMonths: null,
          joinedDate: editing.joinedDate ?? '',
        }
      : { role: 'employee', isActive: true, isOnProbation: false, probationMonths: null, joinedDate: '' },
  })

  useEffect(() => {
    if (open) {
      reset(
        editing
          ? {
              name: editing.name,
              email: editing.email,
              role: editing.role,
              regionId: String(editing.regionId),
              managerId: editing.managerId ? String(editing.managerId) : '',
              isActive: editing.isActive,
              isOnProbation: editing.isOnProbation,
              probationMonths: null,
              joinedDate: editing.joinedDate ?? '',
            }
          : { role: 'employee', isActive: true, isOnProbation: false, probationMonths: null, joinedDate: '' }
      )
    }
  }, [open, editing, reset])

  const selectedRole = watch('role')
  // Load ALL managers across all regions (cross-region reporting exists)
  const { data: managers } = useManagers()

  const isOnProbationWatch = watch('isOnProbation')
  const probationMonthsWatch = watch('probationMonths')
  const joinedDateWatch = watch('joinedDate')

  // Compute auto-calculated probation end date
  const computedProbationEndDate = (() => {
    if (!isOnProbationWatch || !probationMonthsWatch || !joinedDateWatch) return null
    try {
      const joined = parse(joinedDateWatch, 'yyyy-MM-dd', new Date())
      const end = addMonths(joined, probationMonthsWatch)
      return format(end, 'yyyy-MM-dd')
    } catch {
      return null
    }
  })()

  async function onSubmit(data: UserFormData) {
    const probationEndDate = (() => {
      if (!data.isOnProbation || !data.probationMonths || !data.joinedDate) return null
      try {
        const joined = parse(data.joinedDate, 'yyyy-MM-dd', new Date())
        return format(addMonths(joined, data.probationMonths), 'yyyy-MM-dd')
      } catch {
        return null
      }
    })()

    const payload = {
      name: data.name,
      email: data.email,
      role: data.role,
      regionId: Number(data.regionId),
      managerId: data.managerId && data.managerId !== '__none__' ? Number(data.managerId) : undefined,
      isActive: data.isActive,
      isOnProbation: data.isOnProbation ?? false,
      probationMonths: data.probationMonths ?? null,
      probationEndDate,
      joinedDate: data.joinedDate || null,
    }

    if (editing) {
      await updateUser.mutateAsync({ id: editing.id, data: payload })
    } else {
      await createUser.mutateAsync({ ...payload, password: data.password ?? '' })
    }
    reset()
    onOpenChange(false)
  }

  const isPending = createUser.isPending || updateUser.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit User' : 'New User'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input {...register('name')} placeholder="Jane Smith" />
              <FieldError msg={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input {...register('email')} type="email" placeholder="jane@company.com" />
              <FieldError msg={errors.email?.message} />
            </div>
          </div>

          {!editing && (
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input {...register('password')} type="password" placeholder="Min 8 characters" />
              <FieldError msg={errors.password?.message} />
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Controller
                name="role"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(ROLE_LABELS).map(([v, l]) => (
                        <SelectItem key={v} value={v}>{l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Region</Label>
              <Controller
                name="regionId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                    <SelectContent>
                      {regions?.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError msg={errors.regionId?.message} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Manager
              {selectedRole !== 'super_admin' && selectedRole !== 'hr_admin' && (
                <span className="ml-1 text-xs text-muted-foreground">(required for approval routing)</span>
              )}
            </Label>
            <Controller
              name="managerId"
              control={control}
              render={({ field }) => (
                <ManagerCombobox
                  value={field.value || ''}
                  onChange={field.onChange}
                  managers={(managers as ManagerOption[] | undefined) ?? []}
                  role={selectedRole}
                />
              )}
            />
          </div>

          {editing && (
            <div className="flex items-center gap-3">
              <Controller
                name="isActive"
                control={control}
                render={({ field }) => (
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                )}
              />
              <Label>Active account</Label>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Controller
              name="isOnProbation"
              control={control}
              render={({ field }) => (
                <Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
              )}
            />
            <Label>On probation</Label>
          </div>

          {isOnProbationWatch && (
            <div className="space-y-1.5">
              <Label>Probation length <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Controller
                name="probationMonths"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value != null ? String(field.value) : ''}
                    onValueChange={(v) => field.onChange(v ? Number(v) : null)}
                  >
                    <SelectTrigger><SelectValue placeholder="Select length…" /></SelectTrigger>
                    <SelectContent>
                      {[1,2,3,4,5,6,9,12].map((m) => (
                        <SelectItem key={m} value={String(m)}>{m} month{m > 1 ? 's' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {computedProbationEndDate && (
                <p className="text-xs text-muted-foreground">
                  Probation ends: <span className="font-medium">{computedProbationEndDate}</span>
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Joined date <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input {...register('joinedDate')} type="date" />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create User'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UsersTab() {
  const { user: me } = useAuthStore()
  const isHrOrAbove = me?.role === 'hr_admin' || me?.role === 'super_admin'

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('__none__')
  const [activeFilter, setActiveFilter] = useState<string>('true')
  const [regionFilter, setRegionFilter] = useState<string>('__none__')
  const [page, setPage] = useState(1)
  const pageSize = 15

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null)
  const [syncResult, setSyncResult] = useState<SlackSyncResult | null>(null)
  const [historyUser, setHistoryUser] = useState<AdminUser | null>(null)

  const { data: regions } = useRegions()
  const { data, isLoading } = useAdminUsers({
    search: search || undefined,
    role: roleFilter === '__none__' ? undefined : roleFilter,
    isActive: activeFilter === '__none__' ? undefined : activeFilter === 'true',
    regionId: regionFilter !== '__none__' ? Number(regionFilter) : undefined,
    page,
    pageSize,
  })
  const deactivate = useDeactivateUser()
  const slackSync = useSlackSync()
  const slackTestDm = useSlackTestDm()
  const { data: slackStatus, isLoading: slackStatusLoading } = useSlackStatus()
  const { data: slackCommandsData } = useSlackCommandsEnabled()
  const toggleSlackCommands = useToggleSlackCommands()

  const users = data?.data ?? []
  const total = data?.meta?.total ?? 0
  const totalPages = Math.ceil(total / pageSize)

  function openCreate() {
    setEditing(null)
    setDialogOpen(true)
  }
  function openEdit(u: AdminUser) {
    setEditing(u)
    setDialogOpen(true)
  }

  const regionName = (id: number) => regions?.find((r) => r.id === id)?.code ?? '—'

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              className="pl-8"
            />
          </div>
          <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1) }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">All roles</SelectItem>
              {Object.entries(ROLE_LABELS).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={activeFilter} onValueChange={(v) => { setActiveFilter(v); setPage(1) }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="true">Active</SelectItem>
              <SelectItem value="false">Inactive</SelectItem>
              <SelectItem value="__none__">All</SelectItem>
            </SelectContent>
          </Select>
          <Select value={regionFilter} onValueChange={(v) => { setRegionFilter(v); setPage(1) }}>
            <SelectTrigger className="w-36"><SelectValue placeholder="All regions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">All regions</SelectItem>
              {regions?.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          {/* Slack bot status pill */}
          {!slackStatusLoading && (
            slackStatus?.connected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 border border-green-200">
                <Wifi className="h-3 w-3" />
                {slackStatus.teamName ?? 'Slack'} connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 border border-red-200">
                <WifiOff className="h-3 w-3" />
                Slack offline
              </span>
            )
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={slackSync.isPending}
            onClick={() => slackSync.mutate(undefined, { onSuccess: (d) => setSyncResult(d) })}
          >
            <RefreshCw className={`mr-1.5 h-4 w-4 ${slackSync.isPending ? 'animate-spin' : ''}`} />
            <Slack className="mr-1.5 h-4 w-4" />
            Sync Slack IDs
          </Button>
          <Button onClick={openCreate} size="sm">
            <Plus className="mr-1.5 h-4 w-4" /> New User
          </Button>
        </div>
      </div>

      {/* Slack sync result */}
      {syncResult && (
        <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-medium">Slack sync complete</span>
            <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setSyncResult(null)}>Dismiss</button>
          </div>
          <p className="text-muted-foreground">
            {syncResult.synced} linked
            {syncResult.notFound.length > 0 && ` · ${syncResult.notFound.length} not found in Slack`}
            {syncResult.errors.length > 0 && ` · ${syncResult.errors.length} error(s)`}
          </p>
          {syncResult.notFound.length > 0 && (
            <p className="text-xs text-muted-foreground">Not found: {syncResult.notFound.join(', ')}</p>
          )}
        </div>
      )}

      {/* Slack commands toggle */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Slack className="h-4 w-4" />
              Slack commands
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {slackCommandsData?.enabled
                ? 'Users can submit and manage leave via Slack.'
                : 'Commands show a "work in progress" message to all users.'}
            </p>
          </div>
          <Switch
            checked={slackCommandsData?.enabled ?? false}
            onCheckedChange={(val) => toggleSlackCommands.mutate(val)}
            disabled={toggleSlackCommands.isPending}
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Role</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Manager</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slack</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading
              ? [...Array(6)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              : users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_COLOURS[u.role]}`}>
                        {ROLE_LABELS[u.role]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{regionName(u.regionId)}</td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">{u.managerName ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge variant={u.isActive ? 'default' : 'secondary'}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {u.slackUserId ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 rounded-full px-2 py-0.5">
                          <Slack className="h-3 w-3" /> Linked
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not linked</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-muted-foreground"
                          title="View leave history"
                          onClick={() => setHistoryUser(u)}
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        {u.slackUserId && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground"
                            title="Send test DM"
                            disabled={slackTestDm.isPending}
                            onClick={() => slackTestDm.mutate(u.id)}
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(u)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isHrOrAbove && u.isActive && u.id !== me?.id && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeactivating(u)}
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            {!isLoading && users.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total} users total</span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2">Page {page} of {totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <UserDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      <EmployeeHistorySheet user={historyUser} onClose={() => setHistoryUser(null)} />

      <AlertDialog open={!!deactivating} onOpenChange={(v) => !v && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate {deactivating?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent them from logging in. Their data will be preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deactivating) {
                  await deactivate.mutateAsync(deactivating.id)
                  setDeactivating(null)
                }
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Leave Types Tab ──────────────────────────────────────────────────────────

const leaveTypeSchema = z.object({
  name: z.string().min(2, 'Name required'),
  code: z.string().min(2, 'Code required').max(20),
  description: z.string().optional(),
  isPaid: z.boolean(),
  requiresAttachment: z.boolean(),
  maxDaysPerYear: z.string().optional(),
  regionId: z.string().optional(),
  regionRestriction: z.array(z.string()).optional(),
  approvalFlow: z.enum(['standard', 'auto_approve', 'hr_required', 'multi_level']),
  maxConsecutiveDays: z.string().optional(),
  dayCalculation: z.enum(['working_days', 'calendar_days']).default('working_days'),
  staffRestriction: z.array(z.string()).optional(),
  minUnit: z.enum(['1_day', 'half_day', '2_hours', '1_hour']).default('1_day'),
  unit: z.enum(['days', 'hours']).default('days'),
})
type LeaveTypeFormData = z.infer<typeof leaveTypeSchema>

// ─── Region Multi-Select ──────────────────────────────────────────────────────

const ALL_REGIONS = [
  { code: 'HK', label: 'Hong Kong' },
  { code: 'SG', label: 'Singapore' },
  { code: 'MY', label: 'Malaysia' },
  { code: 'ID', label: 'Indonesia' },
  { code: 'CN-GZ', label: 'China - Guangzhou' },
  { code: 'CN-SH', label: 'China - Shanghai' },
  { code: 'AU', label: 'Australia' },
  { code: 'NZ', label: 'New Zealand' },
  { code: 'UK', label: 'United Kingdom' },
]

function RegionMultiSelect({
  value,
  onChange,
}: {
  value: string[]
  onChange: (v: string[]) => void
}) {
  const allSelected = value.length === ALL_REGIONS.length

  function toggleAll() {
    onChange(allSelected ? [] : ALL_REGIONS.map((r) => r.code))
  }

  function toggle(code: string) {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code))
    } else {
      onChange([...value, code])
    }
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Checkbox
          id="region-all"
          checked={allSelected}
          onCheckedChange={toggleAll}
        />
        <label htmlFor="region-all" className="text-sm font-medium cursor-pointer select-none">
          Select All
        </label>
      </div>
      <div className="grid grid-cols-2 gap-1.5 pt-1 border-t">
        {ALL_REGIONS.map((r) => (
          <div key={r.code} className="flex items-center gap-2">
            <Checkbox
              id={`region-${r.code}`}
              checked={value.includes(r.code)}
              onCheckedChange={() => toggle(r.code)}
            />
            <label htmlFor={`region-${r.code}`} className="text-xs cursor-pointer select-none">
              {r.label}
            </label>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Staff Multi-Select ───────────────────────────────────────────────────────

function StaffMultiSelect({
  value,
  onChange,
  allUsers,
}: {
  value: string[]
  onChange: (v: string[]) => void
  allUsers: Array<{ id: number; name: string; regionCode?: string }>
}) {
  const [search, setSearch] = useState('')

  const filtered = allUsers.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase())
  )

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  function remove(id: string) {
    onChange(value.filter((v) => v !== id))
  }

  const selectedUsers = value
    .map((id) => allUsers.find((u) => String(u.id) === id))
    .filter(Boolean) as Array<{ id: number; name: string; regionCode?: string }>

  return (
    <div className="space-y-2">
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedUsers.map((u) => (
            <span
              key={u.id}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              {u.name}
              <button
                type="button"
                className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5"
                onClick={() => remove(String(u.id))}
                aria-label={`Remove ${u.name}`}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-destructive"
            onClick={() => onChange([])}
          >
            Clear all
          </button>
        </div>
      )}
      <div className="rounded-md border">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto p-1 space-y-0.5">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-2">No employees found</p>
          )}
          {filtered.map((u) => (
            <div
              key={u.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 cursor-pointer"
              onClick={() => toggle(String(u.id))}
            >
              <Checkbox
                checked={value.includes(String(u.id))}
                onCheckedChange={() => toggle(String(u.id))}
                id={`staff-${u.id}`}
              />
              <label htmlFor={`staff-${u.id}`} className="text-xs cursor-pointer select-none flex-1">
                {u.name}
                {u.regionCode && (
                  <span className="ml-1.5 text-muted-foreground">— {u.regionCode}</span>
                )}
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function LeaveTypeDialog({
  open,
  onOpenChange,
  editing,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  editing: LeaveType | null
}) {
  const { data: regions } = useRegions()
  const { data: adminUsersData } = useAdminUsers({ pageSize: 500, isActive: true })
  const createLT = useCreateLeaveType()
  const updateLT = useUpdateLeaveType()

  // Build user list enriched with region code for display
  const allUsers = (adminUsersData?.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    regionCode: regions?.find((r) => r.id === u.regionId)?.code,
  }))

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<LeaveTypeFormData>({
    resolver: zodResolver(leaveTypeSchema),
    defaultValues: { isPaid: true, requiresAttachment: false, approvalFlow: 'standard', dayCalculation: 'working_days', regionRestriction: [], staffRestriction: [], minUnit: '1_day', unit: 'days', regionId: '' },
  })

  useEffect(() => {
    if (open && editing) {
      reset({
        name: editing.name,
        code: editing.code,
        description: editing.description ?? '',
        isPaid: editing.isPaid,
        requiresAttachment: editing.requiresAttachment,
        maxDaysPerYear: editing.maxDaysPerYear ? String(editing.maxDaysPerYear) : '',
        regionId: editing.regionId ? String(editing.regionId) : '',
        regionRestriction: editing.regionRestriction ? editing.regionRestriction.split(',').map((s) => s.trim()).filter(Boolean) : [],
        approvalFlow: editing.approvalFlow ?? 'standard',
        maxConsecutiveDays: editing.maxConsecutiveDays ? String(editing.maxConsecutiveDays) : '',
        dayCalculation: editing.dayCalculation ?? 'working_days',
        staffRestriction: editing.staffRestriction ? editing.staffRestriction.split(',').map((s) => s.trim()).filter(Boolean) : [],
        minUnit: (editing as LeaveType & { minUnit?: LeaveTypeFormData['minUnit'] }).minUnit ?? '1_day',
        unit: editing.unit ?? 'days',
      })
    } else if (open && !editing) {
      reset({ isPaid: true, requiresAttachment: false, approvalFlow: 'standard', dayCalculation: 'working_days', regionRestriction: [], staffRestriction: [], minUnit: '1_day', unit: 'days', regionId: '' })
    }
  }, [open, editing, reset])

  async function onSubmit(data: LeaveTypeFormData) {
    const selectedRegions = data.regionRestriction ?? []
    const regionRestrictionValue =
      selectedRegions.length === 0 || selectedRegions.length === ALL_REGIONS.length
        ? null
        : selectedRegions.join(',')

    const selectedStaff = data.staffRestriction ?? []
    const staffRestrictionValue = selectedStaff.length === 0 ? null : selectedStaff.join(',')

    const payload = {
      name: data.name,
      code: data.code.toUpperCase(),
      description: data.description || null,
      isPaid: data.isPaid,
      requiresAttachment: data.requiresAttachment,
      maxDaysPerYear: data.maxDaysPerYear ? Number(data.maxDaysPerYear) : null,
      regionId: data.regionId && data.regionId !== '__none__' ? Number(data.regionId) : null,
      regionRestriction: regionRestrictionValue,
      approvalFlow: data.approvalFlow,
      maxConsecutiveDays: data.maxConsecutiveDays ? Number(data.maxConsecutiveDays) : null,
      dayCalculation: data.dayCalculation,
      staffRestriction: staffRestrictionValue,
      minUnit: data.minUnit,
      unit: data.unit,
    }
    if (editing) {
      await updateLT.mutateAsync({ id: editing.id, data: payload })
    } else {
      await createLT.mutateAsync(payload)
    }
    reset()
    onOpenChange(false)
  }

  const isPending = createLT.isPending || updateLT.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit Leave Type' : 'New Leave Type'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input {...register('name')} placeholder="Annual Leave" />
              <FieldError msg={errors.name?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>Code</Label>
              <Input {...register('code')} placeholder="AL" className="uppercase" />
              <FieldError msg={errors.code?.message} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input {...register('description')} placeholder="Brief description" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Max days/year <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('maxDaysPerYear')} type="number" min="1" placeholder="Unlimited" />
            </div>
            <div className="space-y-1.5">
              <Label>Legacy region <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Controller
                name="regionId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value || '__none__'} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No region (all regions)</SelectItem>
                      {regions?.map((r) => (
                        <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Region restriction{' '}
              <span className="text-muted-foreground text-xs">(leave all unchecked = all regions)</span>
            </Label>
            <Controller
              name="regionRestriction"
              control={control}
              render={({ field }) => (
                <RegionMultiSelect value={field.value ?? []} onChange={field.onChange} />
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Approval Flow</Label>
            <Controller
              name="approvalFlow"
              control={control}
              render={({ field }) => (
                <Select value={field.value || 'standard'} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select flow" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard (Manager approval)</SelectItem>
                    <SelectItem value="auto_approve">Auto-Approve (no action needed)</SelectItem>
                    <SelectItem value="hr_required">HR Required (Manager then HR)</SelectItem>
                    <SelectItem value="multi_level">Multi-Level</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Max consecutive days <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input {...register('maxConsecutiveDays')} type="number" min="1" placeholder="Unlimited" />
          </div>

          <div className="space-y-1.5">
            <Label>Day Calculation</Label>
            <Controller
              name="dayCalculation"
              control={control}
              render={({ field }) => (
                <Select value={field.value || 'working_days'} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="working_days">Working days (excludes weekends & holidays)</SelectItem>
                    <SelectItem value="calendar_days">Calendar days (includes weekends)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Unit of time</Label>
              <Controller
                name="unit"
                control={control}
                render={({ field }) => (
                  <Select value={field.value || 'days'} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="days">Days</SelectItem>
                      <SelectItem value="hours">Hours</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Minimum booking unit</Label>
              <Controller
                name="minUnit"
                control={control}
                render={({ field }) => (
                  <Select value={field.value || '1_day'} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1_day">Full day (1 day)</SelectItem>
                      <SelectItem value="half_day">Half day</SelectItem>
                      <SelectItem value="2_hours">2 hours</SelectItem>
                      <SelectItem value="1_hour">1 hour</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>
              Staff restriction{' '}
              <span className="text-muted-foreground text-xs">(optional — blank = all staff)</span>
            </Label>
            <Controller
              name="staffRestriction"
              control={control}
              render={({ field }) => (
                <StaffMultiSelect
                  value={field.value ?? []}
                  onChange={field.onChange}
                  allUsers={allUsers}
                />
              )}
            />
          </div>

          <div className="flex gap-6">
            <Controller
              name="isPaid"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  <Label>Paid leave</Label>
                </div>
              )}
            />
            <Controller
              name="requiresAttachment"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-2">
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                  <Label>Requires attachment</Label>
                </div>
              )}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LeaveTypesTab() {
  const { user: me } = useAuthStore()
  const isHrAdmin = me?.role === 'hr_admin' || me?.role === 'super_admin'
  const { data: regions } = useRegions()
  const [filterRegion, setFilterRegion] = useState<string>('__none__')
  const [searchLT, setSearchLT] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveType | null>(null)
  const [deletingLT, setDeletingLT] = useState<LeaveType | null>(null)
  const deleteLeaveType = useDeleteLeaveType()

  const { data: rawLeaveTypes, isLoading } = useAdminLeaveTypes(
    filterRegion && filterRegion !== '__none__' ? Number(filterRegion) : undefined
  )

  const leaveTypes = rawLeaveTypes?.filter((lt) =>
    !searchLT || lt.name.toLowerCase().includes(searchLT.toLowerCase()) || lt.code.toLowerCase().includes(searchLT.toLowerCase())
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-2">
          <div className="relative flex-1 max-w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search leave types…"
              value={searchLT}
              onChange={(e) => setSearchLT(e.target.value)}
              className="pl-8"
            />
          </div>
          <Select value={filterRegion} onValueChange={setFilterRegion}>
            <SelectTrigger className="w-44"><SelectValue placeholder="All regions" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">All regions</SelectItem>
              {regions?.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isHrAdmin && (
          <Button size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>
            <Plus className="mr-1.5 h-4 w-4" /> New Leave Type
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Code</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Unit</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Approval Flow</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Max Days</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Paid</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Attachment</th>
              {isHrAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading
              ? [...Array(4)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : leaveTypes?.map((lt) => (
                  <tr key={lt.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{lt.name}</td>
                    <td className="px-4 py-3">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{lt.code}</code>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs capitalize">{lt.unit ?? 'days'}</td>
                    <td className="px-4 py-3">
                      {lt.regionRestriction ? (
                        <div className="flex flex-wrap gap-1">
                          {lt.regionRestriction.split(',').map((code) => (
                            <Badge key={code} variant="outline" className="text-xs px-1.5 py-0">
                              {code.trim()}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge variant="secondary" className="text-xs">All Regions</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {lt.approvalFlow === 'standard' ? 'Standard' :
                       lt.approvalFlow === 'auto_approve' ? 'Auto-Approve' :
                       lt.approvalFlow === 'hr_required' ? 'HR Required' :
                       lt.approvalFlow === 'multi_level' ? 'Multi-Level' : lt.approvalFlow}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {lt.maxConsecutiveDays ? `${lt.maxConsecutiveDays}d` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={lt.isPaid ? 'default' : 'secondary'}>
                        {lt.isPaid ? 'Paid' : 'Unpaid'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {lt.requiresAttachment ? 'Required' : 'No'}
                    </td>
                    {isHrAdmin && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => { setEditing(lt); setDialogOpen(true) }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          {isHrAdmin && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive hover:text-destructive"
                              onClick={() => setDeletingLT(lt)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
            {!isLoading && (!leaveTypes || leaveTypes.length === 0) && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-muted-foreground">
                  No leave types found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <LeaveTypeDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />

      <AlertDialog open={!!deletingLT} onOpenChange={(v) => !v && setDeletingLT(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deletingLT?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              If this leave type has existing leave requests, it will be deactivated instead of deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deletingLT) {
                  await deleteLeaveType.mutateAsync(deletingLT.id)
                  setDeletingLT(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Policies Tab ─────────────────────────────────────────────────────────────

const policySchema = z.object({
  entitlementDays: z.string().regex(/^\d+(\.\d)?$/, 'e.g. 14 or 14.5'),
  entitlementUnlimited: z.boolean().default(false),
  carryOverMax: z.string().regex(/^\d+(\.\d)?$/, 'e.g. 5'),
  carryoverUnlimited: z.boolean().default(false),
  probationMonths: z.string(),
  accrualRate: z.string().optional(),
})
type PolicyFormData = z.infer<typeof policySchema>

function PolicyDialog({
  open,
  onOpenChange,
  policy,
  leaveTypeName,
  regionName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  policy: LeavePolicy
  leaveTypeName: string
  regionName: string
}) {
  const upsert = useUpsertPolicy()
  const { register, control, handleSubmit, watch, formState: { errors } } = useForm<PolicyFormData>({
    defaultValues: {
      entitlementDays: policy.entitlementDays,
      entitlementUnlimited: policy.entitlementUnlimited ?? false,
      carryOverMax: policy.carryOverMax,
      carryoverUnlimited: policy.carryoverUnlimited ?? false,
      probationMonths: String(policy.probationMonths),
      accrualRate: policy.accrualRate ?? '',
    },
  })

  const isEntitlementUnlimited = watch('entitlementUnlimited')
  const isCarryoverUnlimited = watch('carryoverUnlimited')

  // Tier management state
  const { data: tiers = [], isLoading: tiersLoading } = usePolicyTiers(open ? policy.id : undefined)
  const createTier = useCreateTier()
  const updateTier = useUpdateTier()
  const deleteTier = useDeleteTier()
  const { data: adminUsersData } = useAdminUsers({ pageSize: 500, isActive: true })
  const { data: tierRegions } = useRegions()
  const allUsersForTiers = (adminUsersData?.data ?? []).map((u) => ({
    id: u.id,
    name: u.name,
    regionCode: tierRegions?.find((r) => r.id === u.regionId)?.code,
  }))

  const [tierFormOpen, setTierFormOpen] = useState<'add' | number | null>(null)
  const [tierDays, setTierDays] = useState('')
  const [tierLabel, setTierLabel] = useState('')
  const [tierUserIds, setTierUserIds] = useState<string[]>([])

  function openAddTier() {
    setTierDays('')
    setTierLabel('')
    setTierUserIds([])
    setTierFormOpen('add')
  }

  function openEditTier(tier: PolicyTier) {
    setTierDays(tier.entitlementDays)
    setTierLabel(tier.label ?? '')
    setTierUserIds(tier.users.map((u) => String(u.id)))
    setTierFormOpen(tier.id)
  }

  async function saveTier() {
    const days = parseFloat(tierDays)
    if (isNaN(days) || days < 0) return
    const userIds = tierUserIds.map(Number)
    if (tierFormOpen === 'add') {
      await createTier.mutateAsync({ policyId: policy.id, data: { entitlementDays: days, label: tierLabel || null, userIds } })
    } else if (typeof tierFormOpen === 'number') {
      await updateTier.mutateAsync({ policyId: policy.id, tierId: tierFormOpen, data: { entitlementDays: days, label: tierLabel || null, userIds } })
    }
    setTierFormOpen(null)
  }

  async function onSubmit(data: PolicyFormData) {
    await upsert.mutateAsync({
      id: policy.id,
      data: {
        leaveTypeId: policy.leaveTypeId,
        regionId: policy.regionId,
        entitlementDays: data.entitlementUnlimited ? '0' : data.entitlementDays,
        entitlementUnlimited: data.entitlementUnlimited,
        carryOverMax: data.carryoverUnlimited ? '0' : data.carryOverMax,
        carryoverUnlimited: data.carryoverUnlimited,
        probationMonths: Number(data.probationMonths),
        accrualRate: data.accrualRate || null,
      },
    })
    onOpenChange(false)
  }

  const tierSaving = createTier.isPending || updateTier.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Policy</DialogTitle>
          <p className="text-sm text-muted-foreground pt-1">
            {leaveTypeName} · {regionName}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Entitlement days</Label>
                <Controller
                  name="entitlementUnlimited"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center gap-1.5">
                      <Switch checked={field.value} onCheckedChange={field.onChange} className="h-4 w-7" />
                      <span className="text-xs text-muted-foreground">Unlimited</span>
                    </div>
                  )}
                />
              </div>
              {isEntitlementUnlimited
                ? <p className="text-sm text-muted-foreground italic">Unlimited</p>
                : <><Input {...register('entitlementDays')} placeholder="14" /><FieldError msg={errors.entitlementDays?.message} /></>
              }
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Carry-over max</Label>
                <Controller
                  name="carryoverUnlimited"
                  control={control}
                  render={({ field }) => (
                    <div className="flex items-center gap-1.5">
                      <Switch checked={field.value} onCheckedChange={field.onChange} className="h-4 w-7" />
                      <span className="text-xs text-muted-foreground">Unlimited</span>
                    </div>
                  )}
                />
              </div>
              {isCarryoverUnlimited
                ? <p className="text-sm text-muted-foreground italic">Unlimited</p>
                : <><Input {...register('carryOverMax')} placeholder="0" /><FieldError msg={errors.carryOverMax?.message} /></>
              }
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Probation months</Label>
              <Input {...register('probationMonths')} type="number" min="0" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Accrual rate <span className="text-muted-foreground text-xs">(days/month)</span></Label>
              <Input {...register('accrualRate')} placeholder="e.g. 1.1667" />
            </div>
          </div>

          {/* Staff Entitlement Tiers */}
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Custom Entitlement Tiers</p>
                <p className="text-xs text-muted-foreground">
                  Regional default: {policy.entitlementUnlimited ? 'Unlimited' : `${policy.entitlementDays} days`} — create tiers below to give specific staff more or fewer days
                </p>
              </div>
            </div>

            {tiersLoading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="space-y-1.5">
                {tiers.map((tier) => (
                  <div key={tier.id} className="flex items-start justify-between rounded-md border bg-muted/30 px-3 py-2">
                    <div className="space-y-0.5">
                      <span className="text-sm font-medium">{tier.entitlementDays} days</span>
                      {tier.label && <span className="ml-2 text-xs text-muted-foreground">{tier.label}</span>}
                      {tier.users.length > 0 ? (
                        <div className="flex flex-wrap gap-1 pt-0.5">
                          {tier.users.map((u) => (
                            <span key={u.id} className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                              {u.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground italic">No staff assigned</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1 ml-2">
                      <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEditTier(tier)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        disabled={deleteTier.isPending}
                        onClick={() => deleteTier.mutate({ policyId: policy.id, tierId: tier.id })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}

                {/* Inline tier form */}
                {tierFormOpen !== null && (
                  <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {tierFormOpen === 'add' ? 'New tier' : 'Edit tier'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Days</Label>
                        <Input
                          type="number"
                          step="0.5"
                          min="0"
                          placeholder="e.g. 15"
                          value={tierDays}
                          onChange={(e) => setTierDays(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Label <span className="text-muted-foreground">(optional)</span></Label>
                        <Input
                          placeholder="e.g. Senior Staff"
                          value={tierLabel}
                          onChange={(e) => setTierLabel(e.target.value)}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Assign staff</Label>
                      <StaffMultiSelect
                        value={tierUserIds}
                        onChange={setTierUserIds}
                        allUsers={allUsersForTiers}
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        size="sm"
                        disabled={tierSaving || !tierDays || isNaN(parseFloat(tierDays))}
                        onClick={saveTier}
                      >
                        {tierSaving ? 'Saving…' : 'Save'}
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setTierFormOpen(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {tierFormOpen === null && (
                  <Button type="button" size="sm" variant="outline" className="w-full" onClick={openAddTier}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Tier
                  </Button>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? 'Saving…' : 'Save Policy'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PoliciesTab() {
  const { user: me } = useAuthStore()
  const isHrAdmin = me?.role === 'hr_admin' || me?.role === 'super_admin'
  const { data: regions } = useRegions()
  const { data: leaveTypes } = useAdminLeaveTypes()
  const [regionId, setRegionId] = useState<string>('__none__')
  const { data: policies, isLoading } = usePolicies(regionId && regionId !== '__none__' ? Number(regionId) : undefined)
  const [editingPolicy, setEditingPolicy] = useState<LeavePolicy | null>(null)
  const [deletingPolicy, setDeletingPolicy] = useState<LeavePolicy | null>(null)
  const deletePolicy = useDeletePolicy()

  const ltName = (id: number) => leaveTypes?.find((lt) => lt.id === id)?.name ?? String(id)
  const rName = (id: number) => regions?.find((r) => r.id === id)?.name ?? String(id)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={regionId} onValueChange={setRegionId}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">All regions</SelectItem>
            {regions?.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{policies?.length ?? 0} policies</span>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Leave Type</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Default Entitlement</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Custom Tiers</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Carry-over max</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Probation</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Accrual</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading
              ? [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(8)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : policies?.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{ltName(p.leaveTypeId)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rName(p.regionId)}</td>
                    <td className="px-4 py-3">{p.entitlementUnlimited ? 'Unlimited' : `${p.entitlementDays} days`}</td>
                    <td className="px-4 py-3">
                      {p.tierCount > 0 ? (
                        <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                          {p.tierCount} tier{p.tierCount !== 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.carryoverUnlimited ? 'Unlimited' : `${p.carryOverMax} days`}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.probationMonths > 0 ? `${p.probationMonths} mo` : 'None'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.accrualRate ? `${p.accrualRate}/mo` : 'Annual'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditingPolicy(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        {isHrAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => setDeletingPolicy(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            {!isLoading && (!policies || policies.length === 0) && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  No policies found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editingPolicy && (
        <PolicyDialog
          open={!!editingPolicy}
          onOpenChange={(v) => !v && setEditingPolicy(null)}
          policy={editingPolicy}
          leaveTypeName={ltName(editingPolicy.leaveTypeId)}
          regionName={rName(editingPolicy.regionId)}
        />
      )}

      <AlertDialog open={!!deletingPolicy} onOpenChange={(v) => !v && setDeletingPolicy(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this policy?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingPolicy && `${ltName(deletingPolicy.leaveTypeId)} · ${rName(deletingPolicy.regionId)}`}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deletingPolicy) {
                  await deletePolicy.mutateAsync(deletingPolicy.id)
                  setDeletingPolicy(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Holidays Tab ─────────────────────────────────────────────────────────────

const holidaySchema = z.object({
  name: z.string().min(2, 'Name required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  endDate: z.string().optional(),
  regionId: z.string().min(1, 'Region required'),
  isRecurring: z.boolean(),
  halfDay: z.enum(['AM', 'PM', 'full']).default('full'),
})
type HolidayFormData = z.infer<typeof holidaySchema>

function HolidayDialog({
  open,
  onOpenChange,
  defaultRegionId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultRegionId?: string
}) {
  const { data: regions } = useRegions()
  const createHoliday = useCreateHoliday()

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<HolidayFormData>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { regionId: defaultRegionId ?? '', isRecurring: false },
  })

  useEffect(() => {
    if (open) reset({ regionId: defaultRegionId ?? '', isRecurring: false, name: '', date: '', endDate: '', halfDay: 'full' })
  }, [open, defaultRegionId, reset])

  async function onSubmit(data: HolidayFormData) {
    const payload: CreateHolidayInput = {
      name: data.name,
      date: data.date,
      endDate: data.endDate && data.endDate > data.date ? data.endDate : null,
      regionId: data.regionId === 'CN' ? 'CN' : Number(data.regionId),
      isRecurring: data.isRecurring,
      halfDay: data.halfDay === 'AM' || data.halfDay === 'PM' ? data.halfDay as 'AM' | 'PM' : null,
    }
    await createHoliday.mutateAsync(payload)
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Public Holiday</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input {...register('name')} placeholder="Christmas Day" />
            <FieldError msg={errors.name?.message} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input {...register('date')} type="date" />
              <FieldError msg={errors.date?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>End date <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('endDate')} type="date" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Region</Label>
            <Controller
              name="regionId"
              control={control}
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select region" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CN">China (all — GZ &amp; SH)</SelectItem>
                    {regions?.filter((r) => !r.code.startsWith('CN')).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                    ))}
                    {regions?.filter((r) => r.code.startsWith('CN')).map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            <FieldError msg={errors.regionId?.message} />
          </div>
          <div className="space-y-1.5">
            <Label>Half day <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Controller
              name="halfDay"
              control={control}
              render={({ field }) => (
                <Select value={field.value ?? 'full'} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Full day" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full">Full day</SelectItem>
                    <SelectItem value="AM">AM only (morning off)</SelectItem>
                    <SelectItem value="PM">PM only (afternoon off)</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <Controller
            name="isRecurring"
            control={control}
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                <Label>Recurring annually</Label>
              </div>
            )}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={createHoliday.isPending}>
              {createHoliday.isPending ? 'Adding…' : 'Add Holiday'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface GroupedHoliday {
  key: string
  name: string
  date: string
  regionLabel: string
  isRecurring: boolean
  ids: number[]
}

function HolidaysTab() {
  const { user: me } = useAuthStore()
  const isHrAdmin = me?.role === 'hr_admin' || me?.role === 'super_admin'
  const { data: regions } = useRegions()
  const [regionId, setRegionId] = useState<string>('__none__')
  const [year, setYear] = useState(currentYear)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState<GroupedHoliday | null>(null)

  const { data: holidays, isLoading } = useHolidays(
    regionId && regionId !== '__none__' ? Number(regionId) : undefined,
    year
  )
  const deleteHoliday = useDeleteHoliday()

  const YEARS = [currentYear - 1, currentYear, currentYear + 1]

  const rCode = (id: number) => regions?.find((r) => r.id === id)?.code ?? ''
  const rName = (id: number) => regions?.find((r) => r.id === id)?.name ?? '—'

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00')
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
  }

  // Group CN-GZ and CN-SH holidays with the same name+date into a single "China" row
  const groupedHolidays: GroupedHoliday[] = (() => {
    if (!holidays) return []
    const map = new Map<string, GroupedHoliday>()
    for (const h of holidays) {
      const code = rCode(h.regionId)
      const isCN = code === 'CN-GZ' || code === 'CN-SH'
      const groupKey = isCN ? `CN|${h.name}|${h.date}` : `${h.id}`
      if (map.has(groupKey)) {
        map.get(groupKey)!.ids.push(h.id)
      } else {
        map.set(groupKey, {
          key: groupKey,
          name: h.name,
          date: h.date,
          regionLabel: isCN ? 'China' : rName(h.regionId),
          isRecurring: h.isRecurring,
          ids: [h.id],
        })
      }
    }
    return Array.from(map.values())
  })()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Select value={regionId} onValueChange={setRegionId}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Select region" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">All regions</SelectItem>
              {regions?.map((r) => (
                <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {YEARS.map((y) => (
                <SelectItem key={y} value={String(y)}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isHrAdmin && (
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Holiday
          </Button>
        )}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Holiday</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Recurring</th>
              {isHrAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading
              ? [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(5)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : groupedHolidays.map((h) => (
                  <tr key={h.key} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{h.name}</td>
                    <td className="px-4 py-3"><Badge variant="outline" className="text-xs">Public Holiday</Badge></td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(h.date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{h.regionLabel}</td>
                    <td className="px-4 py-3">
                      <Badge variant={h.isRecurring ? 'default' : 'secondary'}>
                        {h.isRecurring ? 'Yes' : 'One-time'}
                      </Badge>
                    </td>
                    {isHrAdmin && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeletingGroup(h)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
            {!isLoading && groupedHolidays.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  {regionId !== '__none__' ? 'No holidays found for this region and year' : 'Select a region to view holidays'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <HolidayDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultRegionId={regionId !== '__none__' ? regionId : undefined}
      />

      <AlertDialog open={!!deletingGroup} onOpenChange={(v) => !v && setDeletingGroup(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deletingGroup?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This holiday will be permanently removed from {deletingGroup?.regionLabel} and may affect leave calculations.
              {deletingGroup && deletingGroup.ids.length > 1 && ' This will delete the holiday for all China regions.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deletingGroup) {
                  for (const id of deletingGroup.ids) {
                    await deleteHoliday.mutateAsync(id)
                  }
                  setDeletingGroup(null)
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Entitlements Tab ─────────────────────────────────────────────────────────

function EditEntitlementDialog({
  row,
  open,
  onOpenChange,
}: {
  row: EntitlementRow
  open: boolean
  onOpenChange: (v: boolean) => void
}) {
  const update = useUpdateEntitlement()
  const [field, setField] = useState<'entitled' | 'carried' | 'adjustments'>('entitled')
  const [value, setValue] = useState('')
  // For adjustments: delta input
  const [delta, setDelta] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) {
      setField('entitled')
      setValue(parseFloat(row.entitled).toString())
      setDelta('')
      setReason('')
    }
  }, [open, row])

  const currentVal = field === 'entitled' ? row.entitled : field === 'carried' ? row.carried : row.adjustments

  // For adjustments field: compute original (entitled + carried + existing adjustments) and new total
  const originalEntitlement = parseFloat(row.entitled) + parseFloat(row.carried) + parseFloat(row.adjustments)
  const deltaNum = parseFloat(delta)
  const newTotal = isNaN(deltaNum) ? originalEntitlement : originalEntitlement + deltaNum

  const handleSave = async () => {
    if (!reason.trim()) return

    if (field === 'adjustments') {
      if (isNaN(deltaNum)) return
      await update.mutateAsync({
        userId: row.userId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        field,
        delta: deltaNum,
        reason: reason.trim(),
      })
    } else {
      const num = parseFloat(value)
      if (isNaN(num) || num < 0) return
      await update.mutateAsync({
        userId: row.userId,
        leaveTypeId: row.leaveTypeId,
        year: row.year,
        field,
        newValue: num,
        reason: reason.trim(),
      })
    }
    onOpenChange(false)
  }

  const isAdjustments = field === 'adjustments'
  const canSave = !update.isPending && !!reason.trim() && (
    isAdjustments ? !isNaN(deltaNum) : !isNaN(parseFloat(value)) && parseFloat(value) >= 0
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Entitlement</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="font-medium">{row.userName}</span>
            <span className="mx-1 text-muted-foreground">·</span>
            <span>{row.leaveTypeName}</span>
            <span className="mx-1 text-muted-foreground">·</span>
            <span>{row.year}</span>
          </div>

          <div className="space-y-1.5">
            <Label>Field to edit</Label>
            <Select value={field} onValueChange={(v) => {
              const f = v as typeof field
              setField(f)
              setValue(parseFloat(f === 'entitled' ? row.entitled : f === 'carried' ? row.carried : row.adjustments).toString())
              setDelta('')
            }}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="entitled">Entitled Days</SelectItem>
                <SelectItem value="carried">Carried Over</SelectItem>
                <SelectItem value="adjustments">Adjustments</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Current: {parseFloat(currentVal).toFixed(1)} days</p>
          </div>

          {isAdjustments ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Original Entitlement</span>
                <span className="font-medium">{originalEntitlement.toFixed(1)} days</span>
              </div>
              <div className="space-y-1.5">
                <Label>Adjustment (+ or −)</Label>
                <Input
                  type="number"
                  step="0.5"
                  placeholder="e.g. +2 or -1"
                  value={delta}
                  onChange={(e) => setDelta(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Use a negative number to reduce entitlement</p>
              </div>
              <div className="flex justify-between text-sm border-t pt-2">
                <span className="text-muted-foreground">New Total</span>
                <span className={`font-semibold ${newTotal < 0 ? 'text-red-600' : 'text-foreground'}`}>
                  {isNaN(deltaNum) ? '—' : `${newTotal.toFixed(1)} days`}
                </span>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>New value (days)</Label>
              <Input
                type="number"
                step="0.5"
                min="0"
                max="365"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Reason for change <span className="text-destructive">*</span></Label>
            <Textarea
              rows={2}
              placeholder="e.g. Annual entitlement correction"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {update.isPending ? 'Saving...' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BulkEditDialog({
  rows,
  open,
  onOpenChange,
  onClear,
}: {
  rows: EntitlementRow[]
  open: boolean
  onOpenChange: (v: boolean) => void
  onClear: () => void
}) {
  const bulk = useBulkUpdateEntitlements()
  const [field, setField] = useState<'entitled' | 'carried' | 'adjustments'>('entitled')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) {
      setField('entitled')
      setValue('')
      setReason('')
    }
  }, [open])

  const handleSave = async () => {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return
    if (!reason.trim()) return
    await bulk.mutateAsync({
      updates: rows.map((r) => ({
        userId: r.userId,
        leaveTypeId: r.leaveTypeId,
        year: r.year,
        field,
        newValue: num,
      })),
      reason: reason.trim(),
    })
    onClear()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Update Entitlements</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Updating <span className="font-medium text-foreground">{rows.length}</span> entitlement{rows.length !== 1 ? 's' : ''}.
          </p>
          <div className="space-y-1.5">
            <Label>Field to update</Label>
            <Select value={field} onValueChange={(v) => setField(v as typeof field)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="entitled">Entitled Days</SelectItem>
                <SelectItem value="carried">Carried Over</SelectItem>
                <SelectItem value="adjustments">Adjustments</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>New value (days)</Label>
            <Input
              type="number"
              step="0.5"
              min="0"
              max="365"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="e.g. 14"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason for change</Label>
            <Textarea
              rows={2}
              placeholder="e.g. Annual entitlement reset"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={bulk.isPending || !reason.trim() || isNaN(parseFloat(value))}
          >
            {bulk.isPending ? 'Updating...' : `Update ${rows.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EntitlementsTab() {
  const { data: regions } = useRegions()
  const [regionId, setRegionId] = useState<number | undefined>()
  const [year, setYear] = useState(new Date().getFullYear())
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editRow, setEditRow] = useState<EntitlementRow | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [showAudit, setShowAudit] = useState(false)

  const { data: rows = [], isLoading } = useEntitlements(regionId, year)
  const { data: auditLog = [] } = useEntitlementAudit()

  const filtered = rows.filter(
    (r) =>
      !search ||
      r.userName.toLowerCase().includes(search.toLowerCase()) ||
      r.leaveTypeName.toLowerCase().includes(search.toLowerCase())
  )

  const rowKey = (r: EntitlementRow) => `${r.userId}-${r.leaveTypeId}`

  const toggleSelect = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(rowKey)))
  }

  const selectedRows = filtered.filter((r) => selected.has(rowKey(r)))

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select
          value={regionId?.toString() ?? 'all'}
          onValueChange={(v) => setRegionId(v === 'all' ? undefined : parseInt(v))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All Regions" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Regions</SelectItem>
            {regions?.map((r) => (
              <SelectItem key={r.id} value={r.id.toString()}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={year.toString()} onValueChange={(v) => setYear(parseInt(v))}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search employee or leave type..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {selected.size > 0 && (
          <Button size="sm" onClick={() => setBulkOpen(true)}>
            <CheckSquare className="mr-1.5 h-4 w-4" />
            Bulk Edit ({selected.size})
          </Button>
        )}

        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowAudit((v) => !v)}
        >
          <History className="mr-1.5 h-4 w-4" />
          {showAudit ? 'Hide' : 'Show'} Audit Log
        </Button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </div>
      ) : (
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-10 px-3 py-2 text-left">
                  <Checkbox
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onCheckedChange={toggleSelectAll}
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium">Employee</th>
                <th className="px-3 py-2 text-left font-medium">Leave Type</th>
                <th className="px-3 py-2 text-right font-medium">Region Default</th>
                <th className="px-3 py-2 text-right font-medium">Entitled</th>
                <th className="px-3 py-2 text-right font-medium">Used</th>
                <th className="px-3 py-2 text-right font-medium">Pending</th>
                <th className="px-3 py-2 text-right font-medium">Carried</th>
                <th className="px-3 py-2 text-right font-medium">Adj.</th>
                <th className="px-3 py-2 text-right font-medium">Balance</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-muted-foreground">
                    No entitlements found
                  </td>
                </tr>
              ) : (
                filtered.map((row) => {
                  const key = rowKey(row)
                  const balance = (
                    parseFloat(row.entitled) +
                    parseFloat(row.carried) +
                    parseFloat(row.adjustments) -
                    parseFloat(row.used) -
                    parseFloat(row.pending)
                  ).toFixed(1)
                  return (
                    <tr key={key} className={`border-b last:border-0 hover:bg-muted/20 ${selected.has(key) ? 'bg-primary/5' : ''}`}>
                      <td className="px-3 py-2">
                        <Checkbox
                          checked={selected.has(key)}
                          onCheckedChange={() => toggleSelect(key)}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-medium">{row.userName}</div>
                        <div className="text-xs text-muted-foreground">{row.userEmail}</div>
                      </td>
                      <td className="px-3 py-2">{row.leaveTypeName}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">
                        {row.policyDefault === 'unlimited' ? '∞' : row.policyDefault ? parseFloat(row.policyDefault).toFixed(1) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {(() => {
                          const entitled = parseFloat(row.entitled)
                          const def = row.policyDefault === 'unlimited' ? null : row.policyDefault ? parseFloat(row.policyDefault) : null
                          const isCustom = def !== null && Math.abs(entitled - def) >= 0.1
                          return (
                            <span className={isCustom ? (entitled > (def ?? 0) ? 'text-green-600 font-medium' : 'text-orange-600 font-medium') : ''}>
                              {entitled.toFixed(1)}
                              {isCustom && (
                                <span className="ml-1 text-xs">
                                  ({entitled > (def ?? 0) ? '+' : ''}{(entitled - (def ?? 0)).toFixed(1)})
                                </span>
                              )}
                            </span>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{parseFloat(row.used).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{parseFloat(row.pending).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{parseFloat(row.carried).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right text-muted-foreground">{parseFloat(row.adjustments).toFixed(1)}</td>
                      <td className="px-3 py-2 text-right font-semibold">
                        <span className={parseFloat(balance) < 0 ? 'text-red-600' : ''}>
                          {balance}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setEditRow(row)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Log */}
      {showAudit && (
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">Audit Log</h3>
          {auditLog.length === 0 ? (
            <p className="text-sm text-muted-foreground">No audit entries yet.</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-3 py-2 text-left font-medium">Date</th>
                    <th className="px-3 py-2 text-left font-medium">Employee</th>
                    <th className="px-3 py-2 text-left font-medium">Leave Type</th>
                    <th className="px-3 py-2 text-left font-medium">Field</th>
                    <th className="px-3 py-2 text-right font-medium">Old</th>
                    <th className="px-3 py-2 text-right font-medium">New</th>
                    <th className="px-3 py-2 text-left font-medium">Reason</th>
                    <th className="px-3 py-2 text-left font-medium">By</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.map((entry: AuditLogEntry) => (
                    <tr key={entry.id} className="border-b last:border-0">
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                        {format(new Date(entry.createdAt), 'd MMM yyyy HH:mm')}
                      </td>
                      <td className="px-3 py-2">{entry.employeeName}</td>
                      <td className="px-3 py-2">{entry.leaveTypeName ?? '—'}</td>
                      <td className="px-3 py-2 capitalize">{entry.fieldChanged}</td>
                      <td className="px-3 py-2 text-right">{entry.oldValue ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-medium">{entry.newValue ?? '—'}</td>
                      <td className="px-3 py-2 text-muted-foreground max-w-xs truncate">{entry.reason}</td>
                      <td className="px-3 py-2 text-muted-foreground">{entry.changedByName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Dialogs */}
      {editRow && (
        <EditEntitlementDialog
          row={editRow}
          open={!!editRow}
          onOpenChange={(v) => !v && setEditRow(null)}
        />
      )}
      <BulkEditDialog
        rows={selectedRows}
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        onClear={() => setSelected(new Set())}
      />
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold">Admin</h2>
        <p className="text-sm text-muted-foreground">
          User management, leave policies, and public holidays
        </p>
      </div>

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="leave-types">Leave Types</TabsTrigger>
          <TabsTrigger value="policies">Policies</TabsTrigger>
          <TabsTrigger value="holidays">Public Holidays</TabsTrigger>
          <TabsTrigger value="entitlements">Entitlements</TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-4"><UsersTab /></TabsContent>
        <TabsContent value="leave-types" className="mt-4"><LeaveTypesTab /></TabsContent>
        <TabsContent value="policies" className="mt-4"><PoliciesTab /></TabsContent>
        <TabsContent value="holidays" className="mt-4"><HolidaysTab /></TabsContent>
        <TabsContent value="entitlements" className="mt-4"><EntitlementsTab /></TabsContent>
      </Tabs>
    </div>
  )
}
