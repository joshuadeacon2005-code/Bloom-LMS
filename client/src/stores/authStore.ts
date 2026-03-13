import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: number
  email: string
  name: string
  role: 'employee' | 'manager' | 'hr_admin' | 'super_admin'
  regionId: number
  departmentId: number | null
  managerId: number | null
  avatarUrl: string | null
  slackUserId: string | null
  isActive: boolean
  createdAt: string
  regionCode: string | null
}

interface AuthState {
  user: AuthUser | null
  accessToken: string | null
  refreshToken: string | null
  setAuth: (user: AuthUser, accessToken: string, refreshToken: string) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      setAuth: (user, accessToken, refreshToken) =>
        set({ user, accessToken, refreshToken }),
      clearAuth: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    { name: 'bloom-lms-auth' }
  )
)

export const isHrOrAbove = (role?: string) =>
  role === 'hr_admin' || role === 'super_admin'

export const isManagerOrAbove = (role?: string) =>
  role === 'manager' || role === 'hr_admin' || role === 'super_admin'
