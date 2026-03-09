import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import { useAuthStore } from '@/stores/authStore'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/my-leave': 'My Leave',
  '/approvals': 'Approvals',
  '/calendar': 'Team Calendar',
  '/reports': 'Reports',
  '/admin': 'Admin',
  '/settings': 'Settings',
}

export function AppLayout() {
  const { user } = useAuthStore()
  const location = useLocation()

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  const title = PAGE_TITLES[location.pathname] ?? 'Bloom & Grow LMS'

  return (
    <TooltipProvider>
      <div className="relative flex h-screen overflow-hidden bg-background">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header title={title} />
          <main className="flex-1 overflow-y-auto p-6">
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
      </div>
    </TooltipProvider>
  )
}
