import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { User, Bell, Slack, Shield, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuthStore } from '@/stores/authStore'
import api from '@/lib/api'

const profileSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  avatarUrl: z.string().url('Must be a valid URL').optional().or(z.literal('')),
})
type ProfileFormData = z.infer<typeof profileSchema>

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password required'),
    newPassword: z.string().min(8, 'At least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
type PasswordFormData = z.infer<typeof passwordSchema>

const ROLE_LABELS: Record<string, string> = {
  employee: 'Employee',
  manager: 'Manager',
  hr_admin: 'HR Admin',
  super_admin: 'Super Admin',
}

function initials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function SettingsPage() {
  const { user, setAuth, accessToken, refreshToken } = useAuthStore()
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)
  const [notifPrefs, setNotifPrefs] = useState({
    leaveApproved: true,
    leaveRejected: true,
    pendingReminder: true,
    teamDigest: true,
  })

  const {
    register: regProfile,
    handleSubmit: handleProfile,
    formState: { errors: profileErrors, isDirty: profileDirty },
  } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: user?.name ?? '',
      avatarUrl: user?.avatarUrl ?? '',
    },
  })

  const {
    register: regPw,
    handleSubmit: handlePassword,
    reset: resetPw,
    formState: { errors: pwErrors },
  } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
  })

  async function onSaveProfile(data: ProfileFormData) {
    if (!user) return
    setSavingProfile(true)
    try {
      const res = await api.patch<{ data: typeof user }>(`/users/${user.id}`, {
        name: data.name,
        avatarUrl: data.avatarUrl || null,
      })
      // Update the auth store with new user data
      setAuth(res.data.data, accessToken!, refreshToken!)
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to update profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function onChangePassword(data: PasswordFormData) {
    setSavingPassword(true)
    try {
      await api.post('/auth/change-password', {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      })
      toast.success('Password changed successfully')
      resetPw()
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } }
      toast.error(err.response?.data?.error ?? 'Failed to change password')
    } finally {
      setSavingPassword(false)
    }
  }

  if (!user) return null

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground">
          Manage your profile, password, and notification preferences
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Profile</CardTitle>
          </div>
          <CardDescription>Update your display name and avatar</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-6">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user.avatarUrl ?? undefined} />
              <AvatarFallback className="text-lg">{initials(user.name)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{user.name}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary mt-1">
                {ROLE_LABELS[user.role] ?? user.role}
              </span>
            </div>
          </div>

          <form onSubmit={handleProfile(onSaveProfile)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Display name</Label>
              <Input {...regProfile('name')} />
              {profileErrors.name && (
                <p className="text-xs text-destructive">{profileErrors.name.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>
                Avatar URL{' '}
                <span className="text-muted-foreground text-xs">(optional)</span>
              </Label>
              <Input {...regProfile('avatarUrl')} placeholder="https://example.com/avatar.jpg" />
              {profileErrors.avatarUrl && (
                <p className="text-xs text-destructive">{profileErrors.avatarUrl.message}</p>
              )}
            </div>
            <Button type="submit" disabled={savingProfile || !profileDirty} size="sm">
              {savingProfile ? 'Saving…' : 'Save Profile'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Password */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Password</CardTitle>
          </div>
          <CardDescription>Change your account password</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePassword(onChangePassword)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input {...regPw('currentPassword')} type="password" autoComplete="current-password" />
              {pwErrors.currentPassword && (
                <p className="text-xs text-destructive">{pwErrors.currentPassword.message}</p>
              )}
            </div>
            <Separator />
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input {...regPw('newPassword')} type="password" autoComplete="new-password" />
              {pwErrors.newPassword && (
                <p className="text-xs text-destructive">{pwErrors.newPassword.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input {...regPw('confirmPassword')} type="password" autoComplete="new-password" />
              {pwErrors.confirmPassword && (
                <p className="text-xs text-destructive">{pwErrors.confirmPassword.message}</p>
              )}
            </div>
            <Button type="submit" disabled={savingPassword} size="sm">
              {savingPassword ? 'Changing…' : 'Change Password'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Notification preferences */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Notifications</CardTitle>
          </div>
          <CardDescription>Choose which in-app notifications you receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            {
              key: 'leaveApproved' as const,
              label: 'Leave approved',
              description: 'When your leave request is approved',
            },
            {
              key: 'leaveRejected' as const,
              label: 'Leave not approved',
              description: 'When your leave request is declined',
            },
            {
              key: 'pendingReminder' as const,
              label: 'Approval reminders',
              description: 'Daily reminders for leave requests pending your approval',
            },
            {
              key: 'teamDigest' as const,
              label: 'Weekly team digest',
              description: 'Monday summary of upcoming team absences',
            },
          ].map((item, idx, arr) => (
            <div key={item.key}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <Switch
                  checked={notifPrefs[item.key]}
                  onCheckedChange={(v) => {
                    setNotifPrefs((p) => ({ ...p, [item.key]: v }))
                    toast.success(`Preference saved`)
                  }}
                />
              </div>
              {idx < arr.length - 1 && <Separator className="mt-4" />}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Slack connection */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Slack className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Slack Integration</CardTitle>
          </div>
          <CardDescription>
            Your Slack account is used to send you leave notifications and approvals
          </CardDescription>
        </CardHeader>
        <CardContent>
          {user.slackUserId ? (
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <span>Connected — Slack user ID: <code className="rounded bg-muted px-1 py-0.5 text-xs">{user.slackUserId}</code></span>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Not connected. Ask your HR admin to link your Slack account in the Admin panel.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
