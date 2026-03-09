import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import * as approvalService from '../services/approval.service'
import type { ApiResponse } from './types'

const router = Router()
router.use(authenticate)

const approvalActionSchema = z.object({
  comments: z.string().max(500).optional(),
})

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// GET /api/approvals/pending — manager+
router.get(
  '/pending',
  requireRole('manager'),
  validate(paginationSchema, 'query'),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof paginationSchema>
      const result = await approvalService.getPendingApprovals(
        req.user!.userId,
        query.page,
        query.pageSize
      )
      const response: ApiResponse<typeof result.approvals> = {
        success: true,
        data: result.approvals,
        meta: { page: query.page, pageSize: query.pageSize, total: result.total },
      }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/approvals/history — manager+
router.get(
  '/history',
  requireRole('manager'),
  validate(paginationSchema, 'query'),
  async (req, res, next) => {
    try {
      const query = req.query as unknown as z.infer<typeof paginationSchema>
      const result = await approvalService.getApprovalHistory(
        req.user!.userId,
        query.page,
        query.pageSize
      )
      const response: ApiResponse<typeof result.history> = {
        success: true,
        data: result.history,
        meta: { page: query.page, pageSize: query.pageSize },
      }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/approvals/:requestId/approve — manager+
router.post(
  '/:requestId/approve',
  requireRole('manager'),
  validate(approvalActionSchema),
  async (req, res, next) => {
    try {
      const requestId = parseInt(req.params.requestId as string, 10)
      const result = await approvalService.approveRequest(
        requestId,
        req.user!.userId,
        req.body.comments
      )
      const response: ApiResponse<typeof result> = { success: true, data: result }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/approvals/:requestId/reject — manager+
router.post(
  '/:requestId/reject',
  requireRole('manager'),
  validate(approvalActionSchema),
  async (req, res, next) => {
    try {
      const requestId = parseInt(req.params.requestId as string, 10)
      const result = await approvalService.rejectRequest(
        requestId,
        req.user!.userId,
        req.body.comments
      )
      const response: ApiResponse<typeof result> = { success: true, data: result }
      res.json(response)
    } catch (err) {
      next(err)
    }
  }
)

export default router
