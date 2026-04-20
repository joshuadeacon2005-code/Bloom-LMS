import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole, requireSelf } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import * as usersService from '../services/users.service'
import type { ApiResponse } from './types'

const router = Router()

router.use(authenticate)

const getUsersQuerySchema = z.object({
  search: z.string().optional(),
  regionId: z.coerce.number().int().positive().optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  role: z.enum(['employee', 'manager', 'hr_admin', 'super_admin']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
})

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2).max(100),
  role: z.enum(['employee', 'manager', 'hr_admin', 'super_admin']).optional(),
  regionId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  managerId: z.number().int().positive().optional(),
  isOnProbation: z.boolean().optional(),
  probationMonths: z.number().int().positive().nullable().optional(),
  probationEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
})

const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['employee', 'manager', 'hr_admin', 'super_admin']).optional(),
  regionId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
  isOnProbation: z.boolean().optional(),
  probationMonths: z.number().int().positive().nullable().optional(),
  probationEndDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  slackUserId: z.string().max(50).nullable().optional(),
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(),
  resignedDate: z.string().datetime().nullable().optional(),
})

// GET /api/users — HR Admin+
router.get(
  '/',
  requireRole('hr_admin'),
  validate(getUsersQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof getUsersQuerySchema>
      const { users, total } = await usersService.getUsers(query)
      const response: ApiResponse<typeof users> = {
        success: true,
        data: users,
        meta: { page: query.page, pageSize: query.pageSize, total },
      }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/users/managers — for manager select dropdowns
router.get('/managers', async (req, res, next) => {
  try {
    const regionIdRaw = req.query.regionId
    const regionId = regionIdRaw ? parseInt(regionIdRaw as string, 10) : undefined
    const managers = await usersService.getManagers(regionId)
    const response: ApiResponse<typeof managers> = { success: true, data: managers }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// GET /api/users/:id — self or HR Admin+
router.get('/:id', requireSelf('id'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    const user = await usersService.getUserById(id)
    const response: ApiResponse<typeof user> = { success: true, data: user }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

// POST /api/users — HR Admin+
router.post('/', requireRole('hr_admin'), validate(createUserSchema), async (req, res, next) => {
  try {
    const user = await usersService.createUser(req.body)
    const response: ApiResponse<typeof user> = { success: true, data: user }
    res.status(201).json(response)
  } catch (err) {
    next(err)
  }
})

// PATCH /api/users/:id — self (name/avatar only) or HR Admin+
router.patch(
  '/:id',
  requireSelf('id'),
  validate(updateUserSchema),
  async (req, res, next) => {
    try {
      const id = parseInt(req.params.id as string, 10)
      const roleLevel: Record<string, number> = {
        employee: 1,
        manager: 2,
        hr_admin: 3,
        super_admin: 4,
      }
      const isHrOrAbove = (roleLevel[req.user!.role] ?? 0) >= roleLevel.hr_admin!
      const isSelf = id === req.user!.userId

      let data: Record<string, unknown>
      if (!isHrOrAbove) {
        data = { name: req.body.name as string | undefined, avatarUrl: req.body.avatarUrl as string | undefined }
      } else if (isSelf) {
        const { role: _role, ...rest } = req.body as Record<string, unknown>
        data = rest
      } else {
        data = req.body
      }

      const user = await usersService.updateUser(id, data)
      const response: ApiResponse<typeof user> = { success: true, data: user }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// DELETE /api/users/:id — HR Admin or above (soft delete)
router.delete('/:id', requireRole('hr_admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10)
    await usersService.deleteUser(id)
    const response: ApiResponse = { success: true }
    res.json(response)
  } catch (err) {
    next(err)
  }
})

export default router
