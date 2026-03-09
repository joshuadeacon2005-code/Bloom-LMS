import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import * as balanceService from '../services/balance.service'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

const adjustmentSchema = z.object({
  userId: z.number().int().positive(),
  leaveTypeId: z.number().int().positive(),
  year: z.number().int().min(2020).max(2100),
  days: z.number().refine((d) => d !== 0, { message: 'Adjustment cannot be zero' }),
  reason: z.string().max(500).optional(),
})

const rolloverSchema = z.object({
  fromYear: z.number().int().min(2020).max(2100),
})

// GET /api/balances — current user's balances
router.get('/', async (req, res, next) => {
  try {
    const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10)
    const balances = await balanceService.getBalancesForUser(req.user!.userId, year)
    const response: ApiResponse<typeof balances> = { success: true, data: balances }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/balances/:userId — HR admin view any user
router.get('/:userId', requireRole('hr_admin'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.userId as string, 10)
    const year = parseInt((req.query.year as string) || String(new Date().getFullYear()), 10)
    const balances = await balanceService.getBalancesForUser(userId, year)
    const response: ApiResponse<typeof balances> = { success: true, data: balances }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/balances/adjust — HR admin manual adjustment
router.post(
  '/adjust',
  requireRole('hr_admin'),
  validate(adjustmentSchema),
  async (req, res, next) => {
    try {
      const { userId, leaveTypeId, year, days } = req.body as z.infer<typeof adjustmentSchema>
      // Need regionId — fetch from user
      const { db } = await import('../db/index')
      const { users } = await import('../db/schema')
      const { eq } = await import('drizzle-orm')
      const [user] = await db
        .select({ regionId: users.regionId })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      const balance = await balanceService.addAdjustment(userId, leaveTypeId, year, user.regionId, days)
      const response: ApiResponse<typeof balance> = { success: true, data: balance }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/balances/rollover — HR admin trigger year-end rollover
router.post(
  '/rollover',
  requireRole('hr_admin'),
  validate(rolloverSchema),
  async (req, res, next) => {
    try {
      const { fromYear } = req.body as z.infer<typeof rolloverSchema>
      const result = await balanceService.rolloverYear(fromYear)
      const response: ApiResponse<typeof result> = { success: true, data: result }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

export default router
