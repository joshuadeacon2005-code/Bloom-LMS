import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Plus,
  Pencil,
  UserX,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  Slack,
  RefreshCw,
  Send,
  Wifi,
  WifiOff,
  History,
  CheckSquare,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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
import { format } from 'date-fns'
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
  usePolicies,
  useUpsertPolicy,
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
  type SlackSyncResult,
  type AdminUser,
  type LeaveType,
  type LeavePolicy,
  type PublicHoliday,
  type ManagerOption,
  type EntitlementRow,
  type AuditLogEntry,
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

// ─── Users Tab ────────────────────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().min(2, 'Name required'),
  email: z.string().email('Valid email required'),
  password: z.string().min(8, 'At least 8 characters').optional().or(z.literal('')),
  role: z.enum(['employee', 'manager', 'hr_admin', 'super_admin']),
  regionId: z.string().min(1, 'Region required'),
  managerId: z.string().optional(),
  isActive: z.boolean().optional(),
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
        }
      : { role: 'employee', isActive: true },
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
            }
          : { role: 'employee', isActive: true }
      )
    }
  }, [open, editing, reset])

  const selectedRole = watch('role')
  // Load ALL managers across all regions (cross-region reporting exists)
  const { data: managers } = useManagers()

  async function onSubmit(data: UserFormData) {
    const payload = {
      name: data.name,
      email: data.email,
      role: data.role,
      regionId: Number(data.regionId),
      managerId: data.managerId && data.managerId !== '__none__' ? Number(data.managerId) : undefined,
      isActive: data.isActive,
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
              {selectedRole !== 'super_admin' && (
                <span className="ml-1 text-xs text-muted-foreground">(required for approval routing)</span>
              )}
            </Label>
            <Controller
              name="managerId"
              control={control}
              render={({ field }) => (
                <Select value={field.value || '__none__'} onValueChange={field.onChange}>
                  <SelectTrigger><SelectValue placeholder="Select manager…" /></SelectTrigger>
                  <SelectContent>
                    {selectedRole === 'super_admin' && (
                      <SelectItem value="__none__">No manager</SelectItem>
                    )}
                    {(managers as ManagerOption[] | undefined)?.map((m) => (
                      <SelectItem key={m.id} value={String(m.id)}>
                        {m.name} — {m.regionName ?? ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
  const isSuperAdmin = me?.role === 'super_admin'

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('__none__')
  const [activeFilter, setActiveFilter] = useState<string>('true')
  const [page, setPage] = useState(1)
  const pageSize = 15

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [deactivating, setDeactivating] = useState<AdminUser | null>(null)
  const [syncResult, setSyncResult] = useState<SlackSyncResult | null>(null)

  const { data: regions } = useRegions()
  const { data, isLoading } = useAdminUsers({
    search: search || undefined,
    role: roleFilter === '__none__' ? undefined : roleFilter,
    isActive: activeFilter === '__none__' ? undefined : activeFilter === 'true',
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
                        {isSuperAdmin && u.isActive && u.id !== me?.id && (
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
  approvalFlow: z.enum(['standard', 'auto_approve', 'hr_required', 'multi_level']),
  minNoticeDays: z.string().optional(),
  maxConsecutiveDays: z.string().optional(),
})
type LeaveTypeFormData = z.infer<typeof leaveTypeSchema>

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
  const createLT = useCreateLeaveType()
  const updateLT = useUpdateLeaveType()

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<LeaveTypeFormData>({
    resolver: zodResolver(leaveTypeSchema),
    defaultValues: editing
      ? {
          name: editing.name,
          code: editing.code,
          description: editing.description ?? '',
          isPaid: editing.isPaid,
          requiresAttachment: editing.requiresAttachment,
          maxDaysPerYear: editing.maxDaysPerYear ? String(editing.maxDaysPerYear) : '',
          regionId: editing.regionId ? String(editing.regionId) : '',
          approvalFlow: editing.approvalFlow ?? 'standard',
          minNoticeDays: editing.minNoticeDays !== undefined ? String(editing.minNoticeDays) : '0',
          maxConsecutiveDays: editing.maxConsecutiveDays ? String(editing.maxConsecutiveDays) : '',
        }
      : { isPaid: true, requiresAttachment: false, approvalFlow: 'standard', minNoticeDays: '0' },
  })

  async function onSubmit(data: LeaveTypeFormData) {
    const payload = {
      name: data.name,
      code: data.code.toUpperCase(),
      description: data.description || null,
      isPaid: data.isPaid,
      requiresAttachment: data.requiresAttachment,
      maxDaysPerYear: data.maxDaysPerYear ? Number(data.maxDaysPerYear) : null,
      regionId: data.regionId && data.regionId !== '__none__' ? Number(data.regionId) : null,
      approvalFlow: data.approvalFlow,
      minNoticeDays: data.minNoticeDays ? Number(data.minNoticeDays) : 0,
      maxConsecutiveDays: data.maxConsecutiveDays ? Number(data.maxConsecutiveDays) : null,
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
      <DialogContent className="max-w-md">
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
              <Label>Region <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Controller
                name="regionId"
                control={control}
                render={({ field }) => (
                  <Select value={field.value || '__none__'} onValueChange={field.onChange}>
                    <SelectTrigger><SelectValue placeholder="All regions" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">All regions</SelectItem>
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Minimum notice days</Label>
              <Input {...register('minNoticeDays')} type="number" min="0" placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>Max consecutive days <span className="text-muted-foreground text-xs">(optional)</span></Label>
              <Input {...register('maxConsecutiveDays')} type="number" min="1" placeholder="Unlimited" />
            </div>
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
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<LeaveType | null>(null)

  const { data: leaveTypes, isLoading } = useAdminLeaveTypes(
    filterRegion && filterRegion !== '__none__' ? Number(filterRegion) : undefined
  )

  const regionName = (id: number | null) =>
    id ? (regions?.find((r) => r.id === id)?.name ?? '—') : 'All regions'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Select value={filterRegion} onValueChange={setFilterRegion}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">All regions</SelectItem>
            {regions?.map((r) => (
              <SelectItem key={r.id} value={String(r.id)}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Approval Flow</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Min Notice</th>
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
                    <td className="px-4 py-3 text-muted-foreground">{regionName(lt.regionId)}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {lt.approvalFlow === 'standard' ? 'Standard' :
                       lt.approvalFlow === 'auto_approve' ? 'Auto-Approve' :
                       lt.approvalFlow === 'hr_required' ? 'HR Required' :
                       lt.approvalFlow === 'multi_level' ? 'Multi-Level' : lt.approvalFlow}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {lt.minNoticeDays ? `${lt.minNoticeDays}d` : '—'}
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
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => { setEditing(lt); setDialogOpen(true) }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
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
    </div>
  )
}

// ─── Policies Tab ─────────────────────────────────────────────────────────────

const policySchema = z.object({
  entitlementDays: z.string().regex(/^\d+(\.\d)?$/, 'e.g. 14 or 14.5'),
  carryOverMax: z.string().regex(/^\d+(\.\d)?$/, 'e.g. 5'),
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
  const { register, handleSubmit, formState: { errors } } = useForm<PolicyFormData>({
    defaultValues: {
      entitlementDays: policy.entitlementDays,
      carryOverMax: policy.carryOverMax,
      probationMonths: String(policy.probationMonths),
      accrualRate: policy.accrualRate ?? '',
    },
  })

  async function onSubmit(data: PolicyFormData) {
    await upsert.mutateAsync({
      id: policy.id,
      data: {
        leaveTypeId: policy.leaveTypeId,
        regionId: policy.regionId,
        entitlementDays: data.entitlementDays,
        carryOverMax: data.carryOverMax,
        probationMonths: Number(data.probationMonths),
        accrualRate: data.accrualRate || null,
      },
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Policy</DialogTitle>
          <p className="text-sm text-muted-foreground pt-1">
            {leaveTypeName} · {regionName}
          </p>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Entitlement days</Label>
              <Input {...register('entitlementDays')} placeholder="14" />
              <FieldError msg={errors.entitlementDays?.message} />
            </div>
            <div className="space-y-1.5">
              <Label>Carry-over max</Label>
              <Input {...register('carryOverMax')} placeholder="0" />
              <FieldError msg={errors.carryOverMax?.message} />
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
  const { data: regions } = useRegions()
  const { data: leaveTypes } = useAdminLeaveTypes()
  const [regionId, setRegionId] = useState<string>('__none__')
  const { data: policies, isLoading } = usePolicies(regionId && regionId !== '__none__' ? Number(regionId) : undefined)
  const [editingPolicy, setEditingPolicy] = useState<LeavePolicy | null>(null)

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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Entitlement</th>
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
                    {[...Array(7)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : policies?.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{ltName(p.leaveTypeId)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rName(p.regionId)}</td>
                    <td className="px-4 py-3">{p.entitlementDays} days</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.carryOverMax} days</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.probationMonths > 0 ? `${p.probationMonths} mo` : 'None'}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.accrualRate ? `${p.accrualRate}/mo` : 'Annual'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingPolicy(p)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
            {!isLoading && (!policies || policies.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
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
    </div>
  )
}

// ─── Holidays Tab ─────────────────────────────────────────────────────────────

const holidaySchema = z.object({
  name: z.string().min(2, 'Name required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  regionId: z.string().min(1, 'Region required'),
  isRecurring: z.boolean(),
})
type HolidayFormData = z.infer<typeof holidaySchema>

function HolidayDialog({
  open,
  onOpenChange,
  regionId,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  regionId: string
}) {
  const { data: regions } = useRegions()
  const createHoliday = useCreateHoliday()

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<HolidayFormData>({
    resolver: zodResolver(holidaySchema),
    defaultValues: { regionId, isRecurring: false },
  })

  async function onSubmit(data: HolidayFormData) {
    await createHoliday.mutateAsync({
      name: data.name,
      date: data.date,
      regionId: Number(data.regionId),
      isRecurring: data.isRecurring,
    })
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
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input {...register('date')} type="date" />
            <FieldError msg={errors.date?.message} />
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

function HolidaysTab() {
  const { user: me } = useAuthStore()
  const isSuperAdmin = me?.role === 'super_admin'
  const { data: regions } = useRegions()
  const [regionId, setRegionId] = useState<string>('__none__')
  const [year, setYear] = useState(currentYear)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<PublicHoliday | null>(null)

  const { data: holidays, isLoading } = useHolidays(
    regionId && regionId !== '__none__' ? Number(regionId) : undefined,
    year
  )
  const deleteHoliday = useDeleteHoliday()

  const YEARS = [currentYear - 1, currentYear, currentYear + 1]
  const rName = (id: number) => regions?.find((r) => r.id === id)?.name ?? '—'

  function formatDate(dateStr: string) {
    const d = new Date(dateStr + 'T00:00:00')
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`
  }

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
        {isSuperAdmin && (
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Date</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Region</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Recurring</th>
              {isSuperAdmin && <th className="px-4 py-3" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading
              ? [...Array(5)].map((_, i) => (
                  <tr key={i}>
                    {[...Array(4)].map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              : holidays?.map((h) => (
                  <tr key={h.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{h.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(h.date)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{rName(h.regionId)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={h.isRecurring ? 'default' : 'secondary'}>
                        {h.isRecurring ? 'Yes' : 'One-time'}
                      </Badge>
                    </td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleting(h)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
            {!isLoading && (!holidays || holidays.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  {regionId ? 'No holidays found for this region and year' : 'Select a region to view holidays'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <HolidayDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        regionId={regionId}
      />

      <AlertDialog open={!!deleting} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This holiday will be permanently removed and may affect leave calculations.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleting) {
                  await deleteHoliday.mutateAsync(deleting.id)
                  setDeleting(null)
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
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (open) {
      setField('entitled')
      setValue(parseFloat(row.entitled).toString())
      setReason('')
    }
  }, [open, row])

  const currentVal = field === 'entitled' ? row.entitled : field === 'carried' ? row.carried : row.adjustments

  const handleSave = async () => {
    const num = parseFloat(value)
    if (isNaN(num) || num < 0) return
    if (!reason.trim()) return
    await update.mutateAsync({
      userId: row.userId,
      leaveTypeId: row.leaveTypeId,
      year: row.year,
      field,
      newValue: num,
      reason: reason.trim(),
    })
    onOpenChange(false)
  }

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

          <div className="space-y-1.5">
            <Label>Reason for change</Label>
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
          <Button
            onClick={handleSave}
            disabled={update.isPending || !reason.trim() || isNaN(parseFloat(value))}
          >
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
                  <td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">
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
                      <td className="px-3 py-2 text-right">{parseFloat(row.entitled).toFixed(1)}</td>
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
