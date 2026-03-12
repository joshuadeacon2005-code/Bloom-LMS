import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  CalendarDays,
  CheckSquare,
  BarChart3,
  Settings,
  Users,
  ChevronLeft,
  ChevronRight,
  LogOut,
  Palmtree,
  BookOpen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore, isManagerOrAbove, isHrOrAbove } from '@/stores/authStore'
import { useUIStore } from '@/stores/uiStore'
import { useLogout } from '@/hooks/useAuth'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const LOGO_URL =
  'https://bloomandgrowgroup.com/wp-content/uploads/2025/07/BloomGrow_Logo_2025-1110x740.png'

interface NavItem {
  label: string
  to: string
  icon: React.ElementType
  requireRole?: 'manager' | 'hr_admin'
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'My Leave', to: '/my-leave', icon: Palmtree },
  { label: 'Approvals', to: '/approvals', icon: CheckSquare, requireRole: 'manager' },
  { label: 'Team Calendar', to: '/calendar', icon: CalendarDays },
  { label: 'Reports', to: '/reports', icon: BarChart3, requireRole: 'hr_admin' },
  { label: 'Admin', to: '/admin', icon: Users, requireRole: 'hr_admin' },
  { label: 'User Guide', to: '/guide', icon: BookOpen },
  { label: 'Settings', to: '/settings', icon: Settings },
]

export function Sidebar() {
  const { user } = useAuthStore()
  const { sidebarCollapsed, toggleSidebar } = useUIStore()
  const logout = useLogout()
  const navigate = useNavigate()

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (!item.requireRole) return true
    if (item.requireRole === 'manager') return isManagerOrAbove(user?.role)
    if (item.requireRole === 'hr_admin') return isHrOrAbove(user?.role)
    return true
  })

  const initials = user?.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <aside
      className={cn(
        'relative flex h-screen flex-col transition-all duration-300',
        sidebarCollapsed ? 'w-16' : 'w-60'
      )}
      style={{ backgroundColor: 'var(--color-secondary)' }}
    >
      {/* Logo */}
      <div
        className={cn(
          'flex h-16 items-center border-b px-3',
          sidebarCollapsed ? 'justify-center' : 'gap-2'
        )}
        style={{ borderColor: 'rgba(255,255,255,0.1)' }}
      >
        {sidebarCollapsed ? (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <span className="text-sm font-bold text-white">B</span>
          </div>
        ) : (
          <img
            src={LOGO_URL}
            alt="Bloom & Grow"
            className="h-20 w-auto max-w-[280px] object-contain brightness-0 invert"
            onError={(e) => {
              const img = e.target as HTMLImageElement
              img.style.display = 'none'
              const fallback = img.nextElementSibling as HTMLElement | null
              if (fallback) fallback.style.display = 'flex'
            }}
          />
        )}
        {!sidebarCollapsed && (
          <span
            className="hidden text-sm font-semibold text-white"
            style={{ display: 'none' }}
          >
            Bloom &amp; Grow
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          {visibleItems.map((item) => (
            <li key={item.to}>
              {sidebarCollapsed ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        cn(
                          'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
                          isActive
                            ? 'text-white'
                            : 'text-white/60 hover:bg-white/10 hover:text-white'
                        )
                      }
                      style={({ isActive }) =>
                        isActive ? { backgroundColor: 'var(--color-primary)' } : {}
                      }
                    >
                      <item.icon className="h-4 w-4" />
                    </NavLink>
                  </TooltipTrigger>
                  <TooltipContent side="right">{item.label}</TooltipContent>
                </Tooltip>
              ) : (
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'text-white'
                        : 'text-white/60 hover:bg-white/10 hover:text-white'
                    )
                  }
                  style={({ isActive }) =>
                    isActive ? { backgroundColor: 'var(--color-primary)' } : {}
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </NavLink>
              )}
            </li>
          ))}
        </ul>
      </nav>

      {/* User section */}
      <div
        className="border-t p-2"
        style={{ borderColor: 'rgba(255,255,255,0.1)' }}
      >
        {sidebarCollapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => navigate('/settings')}
                className="flex h-9 w-9 items-center justify-center rounded-md hover:bg-white/10"
              >
                <Avatar className="h-7 w-7">
                  <AvatarImage src={user?.avatarUrl ?? undefined} />
                  <AvatarFallback
                    className="text-xs text-white"
                    style={{ backgroundColor: 'var(--color-primary)' }}
                  >
                    {initials}
                  </AvatarFallback>
                </Avatar>
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{user?.name}</TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
            <Avatar className="h-7 w-7 shrink-0">
              <AvatarImage src={user?.avatarUrl ?? undefined} />
              <AvatarFallback
                className="text-xs text-white"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-white">{user?.name}</p>
              <p className="truncate text-xs capitalize text-white/50">
                {user?.role.replace('_', ' ')}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-white/50 hover:bg-white/10 hover:text-white"
              onClick={() => logout.mutate()}
            >
              <LogOut className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-[4.5rem] flex h-6 w-6 items-center justify-center rounded-full border shadow-sm"
        style={{
          backgroundColor: 'var(--color-secondary)',
          borderColor: 'rgba(255,255,255,0.15)',
        }}
      >
        {sidebarCollapsed ? (
          <ChevronRight className="h-3 w-3 text-white/60" />
        ) : (
          <ChevronLeft className="h-3 w-3 text-white/60" />
        )}
      </button>
    </aside>
  )
}
