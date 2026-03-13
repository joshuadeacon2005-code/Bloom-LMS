import {
  pgTable,
  pgEnum,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  index,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// =============================================================================
// Enums
// =============================================================================

export const userRoleEnum = pgEnum('user_role', [
  'employee',
  'manager',
  'hr_admin',
  'super_admin',
])

export const leaveStatusEnum = pgEnum('leave_status', [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'pending_hr',
])

export const approvalStatusEnum = pgEnum('approval_status', [
  'pending',
  'approved',
  'rejected',
  'delegated',
])

export const notificationTypeEnum = pgEnum('notification_type', [
  'leave_submitted',
  'leave_approved',
  'leave_rejected',
  'leave_cancelled',
  'approval_reminder',
  'team_digest',
  'balance_low',
  'overtime_submitted',
  'overtime_approved',
  'overtime_rejected',
])

export const overtimeStatusEnum = pgEnum('overtime_status', [
  'pending',
  'approved',
  'rejected',
  'converted',
  'cancelled',
  'pending_hr',
])

// =============================================================================
// Reusable column patterns
// =============================================================================

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
}

const softDelete = {
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}

// =============================================================================
// Tables
// =============================================================================

export const regions = pgTable('regions', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 5 }).notNull().unique(),
  timezone: varchar('timezone', { length: 50 }).notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
})

export const departments = pgTable(
  'departments',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
  },
  (table) => [index('departments_region_id_idx').on(table.regionId)]
)

export const users = pgTable(
  'users',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slackUserId: varchar('slack_user_id', { length: 50 }),
    role: userRoleEnum('role').notNull().default('employee'),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    departmentId: integer('department_id').references(() => departments.id),
    managerId: integer('manager_id').references((): AnyPgColumn => users.id),
    isActive: boolean('is_active').notNull().default(true),
    avatarUrl: text('avatar_url'),
    ...timestamps,
    ...softDelete,
  },
  (table) => [
    index('users_email_idx').on(table.email),
    index('users_region_id_idx').on(table.regionId),
    index('users_manager_id_idx').on(table.managerId),
    index('users_department_id_idx').on(table.departmentId),
    index('users_is_active_idx').on(table.isActive),
  ]
)

export const leaveTypes = pgTable(
  'leave_types',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    code: varchar('code', { length: 20 }).notNull(),
    description: text('description'),
    isPaid: boolean('is_paid').notNull().default(true),
    requiresAttachment: boolean('requires_attachment').notNull().default(false),
    maxDaysPerYear: integer('max_days_per_year'),
    // Approval flow: standard | auto_approve | hr_required | multi_level
    approvalFlow: varchar('approval_flow', { length: 30 }).notNull().default('standard'),
    minNoticeDays: integer('min_notice_days').notNull().default(0),
    maxConsecutiveDays: integer('max_consecutive_days'),
    // null = applies to all regions; set to regionId for region-specific types
    regionId: integer('region_id').references(() => regions.id),
    // Whether this leave type is visible/usable (soft-disable without deleting)
    isActive: boolean('is_active').notNull().default(true),
    // Comma-separated region codes that can use this type, e.g. "AU,NZ" or "CN"
    // If NULL, available to all regions (in conjunction with leave policies)
    regionRestriction: varchar('region_restriction', { length: 50 }),
    // 'days' or 'hours' — hour-based types show hours input
    unit: varchar('unit', { length: 10 }).notNull().default('days'),
    // Hex colour for calendar display
    color: varchar('color', { length: 7 }),
    // Whether leave deducts from balance (false for WFH, Business Trip, etc.)
    deductsBalance: boolean('deducts_balance').notNull().default(true),
  },
  (table) => [
    index('leave_types_region_id_idx').on(table.regionId),
    unique('leave_types_code_region_unique').on(table.code, table.regionId),
  ]
)

export const leavePolicies = pgTable(
  'leave_policies',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    leaveTypeId: integer('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    entitlementDays: numeric('entitlement_days', { precision: 5, scale: 1 }).notNull(),
    carryOverMax: numeric('carry_over_max', { precision: 5, scale: 1 }).notNull().default('0'),
    accrualRate: numeric('accrual_rate', { precision: 5, scale: 4 }), // days accrued per month
    probationMonths: integer('probation_months').notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index('leave_policies_leave_type_region_idx').on(table.leaveTypeId, table.regionId),
    unique('leave_policies_type_region_unique').on(table.leaveTypeId, table.regionId),
  ]
)

export const leaveBalances = pgTable(
  'leave_balances',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    leaveTypeId: integer('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    year: integer('year').notNull(),
    entitled: numeric('entitled', { precision: 5, scale: 1 }).notNull().default('0'),
    used: numeric('used', { precision: 5, scale: 1 }).notNull().default('0'),
    pending: numeric('pending', { precision: 5, scale: 1 }).notNull().default('0'),
    carried: numeric('carried', { precision: 5, scale: 1 }).notNull().default('0'),
    adjustments: numeric('adjustments', { precision: 5, scale: 1 }).notNull().default('0'),
    ...timestamps,
  },
  (table) => [
    index('leave_balances_user_id_idx').on(table.userId),
    index('leave_balances_year_idx').on(table.year),
    unique('leave_balances_user_type_year_unique').on(
      table.userId,
      table.leaveTypeId,
      table.year
    ),
  ]
)

export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    leaveTypeId: integer('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    totalDays: numeric('total_days', { precision: 5, scale: 1 }).notNull(),
    halfDayPeriod: varchar('half_day_period', { length: 2 }),
    reason: text('reason'),
    status: leaveStatusEnum('status').notNull().default('pending'),
    attachmentUrl: text('attachment_url'),
    googleEventId: text('google_event_id'),
    approvalStep: integer('approval_step').notNull().default(1),
    currentApproverId: integer('current_approver_id').references((): AnyPgColumn => users.id),
    ...timestamps,
  },
  (table) => [
    index('leave_requests_user_id_idx').on(table.userId),
    index('leave_requests_status_idx').on(table.status),
    index('leave_requests_date_range_idx').on(table.startDate, table.endDate),
  ]
)

export const approvalWorkflows = pgTable(
  'approval_workflows',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    leaveRequestId: integer('leave_request_id')
      .notNull()
      .references(() => leaveRequests.id, { onDelete: 'cascade' }),
    approverId: integer('approver_id')
      .notNull()
      .references(() => users.id),
    level: integer('level').notNull().default(1),
    status: approvalStatusEnum('status').notNull().default('pending'),
    comments: text('comments'),
    actionDate: timestamp('action_date', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('approval_workflows_request_id_idx').on(table.leaveRequestId),
    index('approval_workflows_approver_id_idx').on(table.approverId),
    index('approval_workflows_status_idx').on(table.status),
  ]
)

export const publicHolidays = pgTable(
  'public_holidays',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    name: varchar('name', { length: 200 }).notNull(),
    date: date('date').notNull(),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    isRecurring: boolean('is_recurring').notNull().default(false),
  },
  (table) => [
    index('public_holidays_region_id_idx').on(table.regionId),
    index('public_holidays_date_idx').on(table.date),
    unique('public_holidays_region_date_unique').on(table.regionId, table.date),
  ]
)

export const notifications = pgTable(
  'notifications',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    message: text('message').notNull(),
    isRead: boolean('is_read').notNull().default(false),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('notifications_user_id_idx').on(table.userId),
    index('notifications_is_read_idx').on(table.isRead),
    index('notifications_created_at_idx').on(table.createdAt),
  ]
)

export const auditLog = pgTable(
  'audit_log',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 50 }).notNull(),
    entityId: integer('entity_id').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    changes: jsonb('changes').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_log_entity_idx').on(table.entityType, table.entityId),
    index('audit_log_user_id_idx').on(table.userId),
    index('audit_log_created_at_idx').on(table.createdAt),
  ]
)

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    isRevoked: boolean('is_revoked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_token_hash_idx').on(table.tokenHash),
  ]
)

export const overtimeEntries = pgTable(
  'overtime_entries',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id),
    date: date('date').notNull(),
    hoursWorked: numeric('hours_worked', { precision: 5, scale: 2 }).notNull(),
    daysRequested: numeric('days_requested', { precision: 4, scale: 2 }).notNull().default('1.0'),
    reason: text('reason').notNull(),
    compensationType: varchar('compensation_type', { length: 20 }).notNull().default('time_off'),
    status: overtimeStatusEnum('status').notNull().default('pending'),
    approvedById: integer('approved_by_id').references(() => users.id),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    evidenceUrl: text('evidence_url'),
    approvedDays: numeric('approved_days', { precision: 4, scale: 2 }),
    managerComment: text('manager_comment'),
    compLeaveRequestId: integer('comp_leave_request_id').references(() => leaveRequests.id),
    hrApprovedById: integer('hr_approved_by_id').references(() => users.id),
    hrApprovedAt: timestamp('hr_approved_at', { withTimezone: true }),
    regionId: integer('region_id')
      .notNull()
      .references(() => regions.id),
    ...timestamps,
  },
  (table) => [
    index('overtime_entries_user_id_idx').on(table.userId),
    index('overtime_entries_date_idx').on(table.date),
    index('overtime_entries_status_idx').on(table.status),
    index('overtime_entries_region_id_idx').on(table.regionId),
  ]
)

export const entitlementAuditLog = pgTable(
  'entitlement_audit_log',
  {
    id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
    employeeId: integer('employee_id')
      .notNull()
      .references(() => users.id),
    leaveTypeId: integer('leave_type_id')
      .notNull()
      .references(() => leaveTypes.id),
    fieldChanged: varchar('field_changed', { length: 20 }).notNull(),
    oldValue: numeric('old_value', { precision: 5, scale: 1 }),
    newValue: numeric('new_value', { precision: 5, scale: 1 }),
    reason: text('reason').notNull(),
    changedById: integer('changed_by_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('entitlement_audit_log_employee_idx').on(table.employeeId),
    index('entitlement_audit_log_created_at_idx').on(table.createdAt),
  ]
)

export const compLeaveRules = pgTable('comp_leave_rules', {
  id: integer('id').generatedAlwaysAsIdentity().primaryKey(),
  regionId: integer('region_id')
    .notNull()
    .unique()
    .references(() => regions.id),
  hoursPerDay: numeric('hours_per_day', { precision: 5, scale: 2 }).notNull().default('8'),
  maxAccumulationDays: numeric('max_accumulation_days', { precision: 5, scale: 1 })
    .notNull()
    .default('5'),
  expiryDays: integer('expiry_days'),
  requiresApproval: boolean('requires_approval').notNull().default(true),
  minHoursPerEntry: numeric('min_hours_per_entry', { precision: 5, scale: 2 })
    .notNull()
    .default('1'),
  maxHoursPerEntry: numeric('max_hours_per_entry', { precision: 5, scale: 2 })
    .notNull()
    .default('12'),
  ...timestamps,
})

// =============================================================================
// Relations
// =============================================================================

export const regionsRelations = relations(regions, ({ many, one }) => ({
  departments: many(departments),
  users: many(users),
  leaveTypes: many(leaveTypes),
  leavePolicies: many(leavePolicies),
  publicHolidays: many(publicHolidays),
  compLeaveRules: one(compLeaveRules, {
    fields: [regions.id],
    references: [compLeaveRules.regionId],
  }),
}))

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  region: one(regions, { fields: [departments.regionId], references: [regions.id] }),
  users: many(users),
}))

export const usersRelations = relations(users, ({ one, many }) => ({
  region: one(regions, { fields: [users.regionId], references: [regions.id] }),
  department: one(departments, { fields: [users.departmentId], references: [departments.id] }),
  manager: one(users, {
    fields: [users.managerId],
    references: [users.id],
    relationName: 'managerReports',
  }),
  reports: many(users, { relationName: 'managerReports' }),
  leaveRequests: many(leaveRequests),
  leaveBalances: many(leaveBalances),
  approvals: many(approvalWorkflows),
  notifications: many(notifications),
  refreshTokens: many(refreshTokens),
  overtimeEntries: many(overtimeEntries),
}))

export const leaveTypesRelations = relations(leaveTypes, ({ one, many }) => ({
  region: one(regions, { fields: [leaveTypes.regionId], references: [regions.id] }),
  leavePolicies: many(leavePolicies),
  leaveBalances: many(leaveBalances),
  leaveRequests: many(leaveRequests),
}))

export const leavePoliciesRelations = relations(leavePolicies, ({ one }) => ({
  leaveType: one(leaveTypes, {
    fields: [leavePolicies.leaveTypeId],
    references: [leaveTypes.id],
  }),
  region: one(regions, { fields: [leavePolicies.regionId], references: [regions.id] }),
}))

export const leaveBalancesRelations = relations(leaveBalances, ({ one }) => ({
  user: one(users, { fields: [leaveBalances.userId], references: [users.id] }),
  leaveType: one(leaveTypes, {
    fields: [leaveBalances.leaveTypeId],
    references: [leaveTypes.id],
  }),
}))

export const leaveRequestsRelations = relations(leaveRequests, ({ one, many }) => ({
  user: one(users, { fields: [leaveRequests.userId], references: [users.id] }),
  leaveType: one(leaveTypes, {
    fields: [leaveRequests.leaveTypeId],
    references: [leaveTypes.id],
  }),
  approvals: many(approvalWorkflows),
}))

export const approvalWorkflowsRelations = relations(approvalWorkflows, ({ one }) => ({
  leaveRequest: one(leaveRequests, {
    fields: [approvalWorkflows.leaveRequestId],
    references: [leaveRequests.id],
  }),
  approver: one(users, { fields: [approvalWorkflows.approverId], references: [users.id] }),
}))

export const publicHolidaysRelations = relations(publicHolidays, ({ one }) => ({
  region: one(regions, { fields: [publicHolidays.regionId], references: [regions.id] }),
}))

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}))

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, { fields: [refreshTokens.userId], references: [users.id] }),
}))

export const overtimeEntriesRelations = relations(overtimeEntries, ({ one }) => ({
  user: one(users, { fields: [overtimeEntries.userId], references: [users.id] }),
  approvedBy: one(users, {
    fields: [overtimeEntries.approvedById],
    references: [users.id],
    relationName: 'overtimeApprovals',
  }),
  region: one(regions, { fields: [overtimeEntries.regionId], references: [regions.id] }),
  compLeaveRequest: one(leaveRequests, {
    fields: [overtimeEntries.compLeaveRequestId],
    references: [leaveRequests.id],
  }),
}))

export const compLeaveRulesRelations = relations(compLeaveRules, ({ one }) => ({
  region: one(regions, { fields: [compLeaveRules.regionId], references: [regions.id] }),
}))
