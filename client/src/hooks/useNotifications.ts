import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'

export interface AppNotification {
  id: number
  userId: number
  type: string
  title: string
  message: string
  isRead: boolean
  metadata: Record<string, unknown> | null
  createdAt: string
}

export function useNotifications(page = 1) {
  return useQuery({
    queryKey: ['notifications', page],
    queryFn: () =>
      api
        .get<{ data: { notifications: AppNotification[]; unreadCount: number } }>(
          '/notifications',
          { params: { page } }
        )
        .then((r) => r.data.data),
    refetchInterval: 30_000, // poll every 30s
  })
}

export function useMarkRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: number) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export function useMarkAllRead() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => api.patch('/notifications/read-all'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
