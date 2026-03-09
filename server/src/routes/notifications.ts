import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import * as notificationService from '../services/notification.service'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

// GET /api/notifications
router.get('/', async (req, res, next) => {
  try {
    const page = parseInt((req.query.page as string) || '1', 10)
    const pageSize = parseInt((req.query.pageSize as string) || '20', 10)
    const notifications = await notificationService.getNotificationsForUser(
      req.user!.userId,
      page,
      pageSize
    )
    const unreadCount = await notificationService.getUnreadCount(req.user!.userId)
    const response: ApiResponse<{ notifications: typeof notifications; unreadCount: number }> = {
      success: true,
      data: { notifications, unreadCount },
    }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    await notificationService.markAsRead(id, req.user!.userId)
    const response: ApiResponse = { success: true }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/notifications/read-all
router.patch('/read-all', async (req, res, next) => {
  try {
    await notificationService.markAllAsRead(req.user!.userId)
    const response: ApiResponse = { success: true }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
