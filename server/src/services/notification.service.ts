import { eq, desc, and } from 'drizzle-orm'
import { db } from '../db/index'
import { notifications } from '../db/schema'

type NotificationType =
  | 'leave_submitted'
  | 'leave_approved'
  | 'leave_rejected'
  | 'leave_cancelled'
  | 'approval_reminder'
  | 'team_digest'
  | 'balance_low'
  | 'overtime_submitted'
  | 'overtime_approved'
  | 'overtime_rejected'

export async function createNotification(data: {
  userId: number
  type: NotificationType
  title: string
  message: string
  metadata?: Record<string, unknown>
}) {
  await db.insert(notifications).values({
    userId: data.userId,
    type: data.type,
    title: data.title,
    message: data.message,
    metadata: data.metadata ?? null,
  })
}

export async function getNotificationsForUser(
  userId: number,
  page = 1,
  pageSize = 20
) {
  const offset = (page - 1) * pageSize

  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(pageSize)
    .offset(offset)

  return rows
}

export async function markAsRead(notificationId: number, userId: number) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
}

export async function markAllAsRead(userId: number) {
  await db
    .update(notifications)
    .set({ isRead: true })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))
}

export async function getUnreadCount(userId: number): Promise<number> {
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)))

  return rows.length
}
