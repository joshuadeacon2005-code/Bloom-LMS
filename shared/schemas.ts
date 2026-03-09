import { z } from 'zod'

// =============================================================================
// Shared Zod Validation Schemas — used by both client and server
// Additional DB-derived schemas are generated via drizzle-zod in Phase 2
// =============================================================================

// ---- Auth -------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

export const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  regionId: z.number().int().positive(),
  departmentId: z.number().int().positive().optional(),
  managerId: z.number().int().positive().optional(),
})

export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
})

// ---- Leave Requests ---------------------------------------------------------

export const createLeaveRequestSchema = z
  .object({
    leaveTypeId: z.number().int().positive(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
    reason: z.string().max(1000).optional(),
    attachmentUrl: z.string().url().optional(),
  })
  .refine((data) => data.startDate <= data.endDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })

export const updateLeaveRequestSchema = z.object({
  reason: z.string().max(1000).optional(),
  status: z.enum(['cancelled']).optional(),
})

export const leaveRequestFiltersSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  userId: z.number().int().positive().optional(),
  leaveTypeId: z.number().int().positive().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// ---- Approvals --------------------------------------------------------------

export const approvalActionSchema = z.object({
  comments: z.string().max(500).optional(),
})

// ---- Users ------------------------------------------------------------------

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  email: z.string().email().optional(),
  role: z.enum(['employee', 'manager', 'hr_admin', 'super_admin']).optional(),
  regionId: z.number().int().positive().optional(),
  departmentId: z.number().int().positive().nullable().optional(),
  managerId: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
})

// ---- Pagination -------------------------------------------------------------

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

// ---- Type exports -----------------------------------------------------------

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
export type CreateLeaveRequestInput = z.infer<typeof createLeaveRequestSchema>
export type UpdateLeaveRequestInput = z.infer<typeof updateLeaveRequestSchema>
export type LeaveRequestFilters = z.infer<typeof leaveRequestFiltersSchema>
export type ApprovalActionInput = z.infer<typeof approvalActionSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type PaginationInput = z.infer<typeof paginationSchema>
