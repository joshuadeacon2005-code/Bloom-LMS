import { createInsertSchema, createSelectSchema } from 'drizzle-zod'
import { z } from 'zod'
import {
  users,
  regions,
  departments,
  leaveTypes,
  leavePolicies,
  leaveBalances,
  leaveRequests,
  approvalWorkflows,
  publicHolidays,
  notifications,
} from './schema'

// =============================================================================
// DB-derived Zod schemas (single source of truth from the Drizzle schema)
// =============================================================================

// Users
export const insertUserSchema = createInsertSchema(users, {
  email: (s) => s.email(),
  name: (s) => s.min(2).max(100),
  passwordHash: (s) => s.min(1),
}).omit({ createdAt: true, updatedAt: true, deletedAt: true })

export const selectUserSchema = createSelectSchema(users).omit({ passwordHash: true })

export type InsertUser = z.infer<typeof insertUserSchema>
export type SelectUser = z.infer<typeof selectUserSchema>

// Regions
export const insertRegionSchema = createInsertSchema(regions)
export const selectRegionSchema = createSelectSchema(regions)
export type SelectRegion = z.infer<typeof selectRegionSchema>

// Departments
export const insertDepartmentSchema = createInsertSchema(departments)
export const selectDepartmentSchema = createSelectSchema(departments)
export type SelectDepartment = z.infer<typeof selectDepartmentSchema>

// Leave Types
export const insertLeaveTypeSchema = createInsertSchema(leaveTypes)
export const selectLeaveTypeSchema = createSelectSchema(leaveTypes)
export type SelectLeaveType = z.infer<typeof selectLeaveTypeSchema>

// Leave Policies
export const insertLeavePolicySchema = createInsertSchema(leavePolicies).omit({
  createdAt: true,
  updatedAt: true,
})
export const selectLeavePolicySchema = createSelectSchema(leavePolicies)
export type SelectLeavePolicy = z.infer<typeof selectLeavePolicySchema>

// Leave Balances
export const insertLeaveBalanceSchema = createInsertSchema(leaveBalances).omit({
  createdAt: true,
  updatedAt: true,
})
export const selectLeaveBalanceSchema = createSelectSchema(leaveBalances)
export type SelectLeaveBalance = z.infer<typeof selectLeaveBalanceSchema>

// Leave Requests
export const insertLeaveRequestSchema = createInsertSchema(leaveRequests, {
  startDate: (s) => s.regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: (s) => s.regex(/^\d{4}-\d{2}-\d{2}$/),
}).omit({ createdAt: true, updatedAt: true })

export const selectLeaveRequestSchema = createSelectSchema(leaveRequests)
export type SelectLeaveRequest = z.infer<typeof selectLeaveRequestSchema>

// Approval Workflows
export const insertApprovalWorkflowSchema = createInsertSchema(approvalWorkflows).omit({
  createdAt: true,
  updatedAt: true,
})
export const selectApprovalWorkflowSchema = createSelectSchema(approvalWorkflows)
export type SelectApprovalWorkflow = z.infer<typeof selectApprovalWorkflowSchema>

// Public Holidays
export const insertPublicHolidaySchema = createInsertSchema(publicHolidays)
export const selectPublicHolidaySchema = createSelectSchema(publicHolidays)
export type SelectPublicHoliday = z.infer<typeof selectPublicHolidaySchema>

// Notifications
export const selectNotificationSchema = createSelectSchema(notifications)
export type SelectNotification = z.infer<typeof selectNotificationSchema>
