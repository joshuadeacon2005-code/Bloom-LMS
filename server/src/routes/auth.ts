import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { authenticate } from '../middleware/auth'
import * as authService from '../services/auth.service'
import type { ApiResponse } from './types'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2).max(100),
  regionId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  managerId: z.number().int().positive().optional(),
})

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
})

const logoutSchema = z.object({
  refreshToken: z.string().min(1),
})

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const result = await authService.login(req.body.email, req.body.password)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/register
router.post('/register', validate(registerSchema), async (req, res, next) => {
  try {
    const result = await authService.register(req.body)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/refresh
router.post('/refresh', validate(refreshSchema), async (req, res, next) => {
  try {
    const result = await authService.refresh(req.body.refreshToken)
    const response: ApiResponse<typeof result> = { success: true, data: result }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/logout
router.post('/logout', validate(logoutSchema), async (req, res, next) => {
  try {
    await authService.logout(req.body.refreshToken)
    const response: ApiResponse = { success: true }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/auth/change-password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
})

router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  async (req, res, next) => {
    try {
      await authService.changePassword(
        req.user!.userId,
        req.body.currentPassword,
        req.body.newPassword
      )
      const response: ApiResponse = { success: true }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user!.userId)
    const response: ApiResponse<typeof user> = { success: true, data: user }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
