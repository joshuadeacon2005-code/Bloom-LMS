import { Bell, Search } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useAuthStore } from '@/stores/authStore'
import { useLogout } from '@/hooks/useAuth'
import { useNotifications, useMarkAllRead } from '@/hooks/useNotifications'
import { formatDistanceToNow } from 'date-fns'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  const { user } = useAuthStore()
  const logout = useLogout()
  const navigate = useNavigate()
  const { data: notifData } = useNotifications()
  const markAllRead = useMarkAllRead()

  const unreadCount = notifData?.unreadCount ?? 0
  const notifications = notifData?.notifications ?? []

  const initials = user?.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card px-6">
      <h1 className="text-lg font-semibold text-foreground">{title}</h1>

      <div className="flex items-center gap-2">
        {/* Search hint */}
        <Button
          variant="outline"
          size="sm"
          className="hidden gap-2 text-muted-foreground md:flex"
          onClick={() => {}} // Cmd+K search — Phase 6
        >
          <Search className="h-3.5 w-3.5" />
          <span className="text-xs">Search</span>
          <kbd className="pointer-events-none rounded border border-border bg-muted px-1.5 text-[10px] font-mono">
            ⌘K
          </kbd>
        </Button>

        {/* Notifications */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-sm font-semibold">Notifications</span>
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto p-0 text-xs text-primary"
                  onClick={() => markAllRead.mutate()}
                >
                  Mark all read
                </Button>
              )}
            </div>
            <DropdownMenuSeparator />
            <ScrollArea className="h-72">
              {notifications.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No notifications
                </p>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`px-3 py-2.5 ${!n.isRead ? 'bg-accent/30' : ''}`}
                  >
                    <p className="text-xs font-medium text-foreground">{n.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                ))
              )}
            </ScrollArea>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.avatarUrl ?? undefined} />
                <AvatarFallback
                  className="text-xs"
                  style={{ backgroundColor: 'var(--color-primary)', color: 'white' }}
                >
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium">{user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>Settings</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => logout.mutate()}
            >
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}
