import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { db } from '../db'
import { generateXlsx } from '../utils/xlsx'
import {
  leaveRequests,
  leaveBalances,
  users,
  leaveTypes,
  departments,
  regions,
} from '../db/schema'
import { and, eq, gte, lte, inArray, sql } from 'drizzle-orm'

const router = Router()
router.use(authenticate)
router.use(requireRole('hr_admin'))

const utilisationQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  regionId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
})

const payrollQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  month: z.coerce.number().int().min(1).max(12).optional(),
  regionId: z.coerce.number().int().positive().optional(),
  format: z.enum(['csv', 'xlsx']).default('csv'),
})

// GET /api/reports/utilisation
router.get('/utilisation', validate(utilisationQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { year, regionId, departmentId, userId } = req.query as unknown as z.infer<
      typeof utilisationQuerySchema
    >

    // Filter users
    let userIds: number[]
    if (userId) {
      userIds = [userId]
    } else {
      const userFilters = [eq(users.isActive, true)]
      if (regionId) userFilters.push(eq(users.regionId, regionId))
      if (departmentId) userFilters.push(eq(users.departmentId, departmentId))
      const filteredUsers = await db.select({ id: users.id }).from(users).where(and(...userFilters))
      userIds = filteredUsers.map((u) => u.id)
    }

    if (userIds.length === 0) {
      return res.json({ success: true, data: { byType: [], byMonth: [], summary: {} } })
    }

    // Leave balances grouped by type for the year
    const balancesByType = await db
      .select({
        leaveTypeName: leaveTypes.name,
        leaveTypeCode: leaveTypes.code,
        totalEntitled: sql<number>`sum(${leaveBalances.entitled} + ${leaveBalances.carried})`,
        totalUsed: sql<number>`sum(${leaveBalances.used})`,
        totalPending: sql<number>`sum(${leaveBalances.pending})`,
      })
      .from(leaveBalances)
      .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(inArray(leaveBalances.userId, userIds), eq(leaveBalances.year, year)))
      .groupBy(leaveTypes.id, leaveTypes.name, leaveTypes.code)
      .orderBy(leaveTypes.name)

    // Approved leave requests grouped by month
    const startDate = `${year}-01-01`
    const endDate = `${year}-12-31`

    const requestsByMonth = await db
      .select({
        month: sql<number>`extract(month from ${leaveRequests.startDate}::date)`,
        leaveTypeName: leaveTypes.name,
        totalDays: sql<number>`sum(${leaveRequests.totalDays})`,
        count: sql<number>`count(*)`,
      })
      .from(leaveRequests)
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(
        and(
          inArray(leaveRequests.userId, userIds),
          eq(leaveRequests.status, 'approved'),
          gte(leaveRequests.startDate, startDate),
          lte(leaveRequests.startDate, endDate)
        )
      )
      .groupBy(
        sql`extract(month from ${leaveRequests.startDate}::date)`,
        leaveTypes.name
      )
      .orderBy(sql`extract(month from ${leaveRequests.startDate}::date)`)

    // Summary
    const totalEmployees = userIds.length
    const totalUsed = balancesByType.reduce((sum, r) => sum + Number(r.totalUsed), 0)
    const totalEntitled = balancesByType.reduce((sum, r) => sum + Number(r.totalEntitled), 0)

    res.json({
      success: true,
      data: {
        byType: balancesByType.map((r) => ({
          name: r.leaveTypeName,
          code: r.leaveTypeCode,
          entitled: Number(r.totalEntitled),
          used: Number(r.totalUsed),
          pending: Number(r.totalPending),
          remaining: Number(r.totalEntitled) - Number(r.totalUsed) - Number(r.totalPending),
          utilisationPct:
            Number(r.totalEntitled) > 0
              ? Math.round((Number(r.totalUsed) / Number(r.totalEntitled)) * 100)
              : 0,
        })),
        byMonth: requestsByMonth.map((r) => ({
          month: Number(r.month),
          leaveType: r.leaveTypeName,
          totalDays: Number(r.totalDays),
          count: Number(r.count),
        })),
        summary: {
          totalEmployees,
          totalDaysUsed: totalUsed,
          totalDaysEntitled: totalEntitled,
          overallUtilisationPct:
            totalEntitled > 0 ? Math.round((totalUsed / totalEntitled) * 100) : 0,
          year,
        },
      },
    })
  } catch (err) {
    next(err)
  }
})

// GET /api/reports/department-summary
router.get(
  '/department-summary',
  validate(utilisationQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { year, regionId } = req.query as unknown as z.infer<typeof utilisationQuerySchema>

      const deptFilters = []
      if (regionId) deptFilters.push(eq(departments.regionId, regionId))

      const deptList = await db
        .select({ id: departments.id, name: departments.name })
        .from(departments)
        .where(deptFilters.length ? and(...deptFilters) : undefined)

      const results = await Promise.all(
        deptList.map(async (dept) => {
          const deptUsers = await db
            .select({ id: users.id })
            .from(users)
            .where(
              and(eq(users.departmentId, dept.id), eq(users.isActive, true))
            )

          const userIds = deptUsers.map((u) => u.id)
          if (userIds.length === 0) {
            return {
              departmentId: dept.id,
              departmentName: dept.name,
              employeeCount: 0,
              totalDaysUsed: 0,
              totalDaysEntitled: 0,
              utilisationPct: 0,
              byType: [],
            }
          }

          const balances = await db
            .select({
              leaveTypeName: leaveTypes.name,
              totalUsed: sql<number>`sum(${leaveBalances.used})`,
              totalEntitled: sql<number>`sum(${leaveBalances.entitled} + ${leaveBalances.carried})`,
            })
            .from(leaveBalances)
            .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
            .where(and(inArray(leaveBalances.userId, userIds), eq(leaveBalances.year, year)))
            .groupBy(leaveTypes.name)

          const totalUsed = balances.reduce((s, b) => s + Number(b.totalUsed), 0)
          const totalEntitled = balances.reduce((s, b) => s + Number(b.totalEntitled), 0)

          return {
            departmentId: dept.id,
            departmentName: dept.name,
            employeeCount: userIds.length,
            totalDaysUsed: totalUsed,
            totalDaysEntitled: totalEntitled,
            utilisationPct:
              totalEntitled > 0 ? Math.round((totalUsed / totalEntitled) * 100) : 0,
            byType: balances.map((b) => ({
              name: b.leaveTypeName,
              used: Number(b.totalUsed),
              entitled: Number(b.totalEntitled),
            })),
          }
        })
      )

      res.json({ success: true, data: results.filter((d) => d.employeeCount > 0) })
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/reports/export/payroll
router.get(
  '/export/payroll',
  validate(payrollQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const { year, month, regionId, format } = req.query as unknown as z.infer<typeof payrollQuerySchema>

      const userFilters = [eq(users.isActive, true)]
      if (regionId) userFilters.push(eq(users.regionId, regionId))

      const filteredUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(...userFilters))

      const userIds = filteredUsers.map((u) => u.id)

      const baseName = month
        ? `payroll-${year}-${String(month).padStart(2, '0')}`
        : `payroll-${year}`

      if (userIds.length === 0) {
        if (format === 'xlsx') {
          const buf = generateXlsx([], 'Payroll')
          res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
          res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`)
          return res.send(buf)
        }
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`)
        return res.send('Employee,Email,Department,Region,Leave Type,Start Date,End Date,Days\n')
      }

      const startDate = month
        ? `${year}-${String(month).padStart(2, '0')}-01`
        : `${year}-01-01`
      const endDate = month
        ? `${year}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
        : `${year}-12-31`

      const rows = await db
        .select({
          employeeName: users.name,
          employeeEmail: users.email,
          departmentName: departments.name,
          regionCode: regions.code,
          leaveTypeName: leaveTypes.name,
          startDate: leaveRequests.startDate,
          endDate: leaveRequests.endDate,
          totalDays: leaveRequests.totalDays,
        })
        .from(leaveRequests)
        .innerJoin(users, eq(leaveRequests.userId, users.id))
        .leftJoin(departments, eq(users.departmentId, departments.id))
        .innerJoin(regions, eq(users.regionId, regions.id))
        .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
        .where(
          and(
            inArray(leaveRequests.userId, userIds),
            eq(leaveRequests.status, 'approved'),
            gte(leaveRequests.startDate, startDate),
            lte(leaveRequests.endDate, endDate)
          )
        )
        .orderBy(users.name, leaveRequests.startDate)

      if (format === 'xlsx') {
        const xlsxData = rows.map((r) => ({
          Employee: r.employeeName,
          Email: r.employeeEmail,
          Department: r.departmentName ?? '',
          Region: r.regionCode,
          'Leave Type': r.leaveTypeName,
          'Start Date': r.startDate,
          'End Date': r.endDate,
          Days: Number(r.totalDays),
        }))
        const buf = generateXlsx(xlsxData, 'Payroll')
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`)
        return res.send(buf)
      }

      const header = 'Employee,Email,Department,Region,Leave Type,Start Date,End Date,Days\n'
      const csvRows = rows
        .map((r) =>
          [
            `"${r.employeeName}"`,
            `"${r.employeeEmail}"`,
            `"${r.departmentName ?? ''}"`,
            `"${r.regionCode}"`,
            `"${r.leaveTypeName}"`,
            r.startDate,
            r.endDate,
            r.totalDays,
          ].join(',')
        )
        .join('\n')

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`)
      res.send(header + csvRows)
    } catch (err) {
      next(err)
    }
  }
)

// GET /api/reports/export/leave-requests
const leaveRequestExportSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  regionId: z.coerce.number().int().positive().optional(),
  leaveTypeId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  status: z.enum(['all', 'pending', 'approved', 'rejected', 'cancelled']).default('all'),
  format: z.enum(['csv', 'xlsx']).default('csv'),
})

router.get('/export/leave-requests', validate(leaveRequestExportSchema, 'query'), async (req, res, next) => {
  try {
    const { year, regionId, leaveTypeId, userId, status, format } = req.query as unknown as z.infer<typeof leaveRequestExportSchema>

    const startDate = `${year}-01-01`
    const endDate = `${year}-12-31`

    const conditions = [
      gte(leaveRequests.startDate, startDate),
      lte(leaveRequests.startDate, endDate),
    ]
    if (status !== 'all') conditions.push(eq(leaveRequests.status, status as 'pending' | 'approved' | 'rejected' | 'cancelled'))
    if (regionId) conditions.push(eq(users.regionId, regionId))
    if (leaveTypeId) conditions.push(eq(leaveRequests.leaveTypeId, leaveTypeId))
    if (userId) conditions.push(eq(leaveRequests.userId, userId))

    const rows = await db
      .select({
        employeeName: users.name,
        regionCode: regions.code,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
        status: leaveRequests.status,
        reason: leaveRequests.reason,
      })
      .from(leaveRequests)
      .innerJoin(users, eq(leaveRequests.userId, users.id))
      .innerJoin(regions, eq(users.regionId, regions.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(and(...conditions))
      .orderBy(users.name, leaveRequests.startDate)

    const regionSuffix = regionId ? `_region${regionId}` : '_all_regions'
    const staffSuffix = userId ? `_staff${userId}` : ''
    const baseName = `leave_requests_${year}${regionSuffix}${staffSuffix}`

    if (format === 'xlsx') {
      const xlsxData = rows.map((r) => ({
        Employee: r.employeeName,
        Region: r.regionCode,
        'Leave Type': r.leaveTypeName,
        'Start Date': r.startDate,
        'End Date': r.endDate,
        Days: Number(r.totalDays),
        Status: r.status,
        Reason: r.reason ?? '',
      }))
      const buf = generateXlsx(xlsxData, 'Leave Requests')
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`)
      return res.send(buf)
    }

    const csvHeader = 'Employee,Region,Leave Type,Start Date,End Date,Days,Status,Reason\n'
    const csvRows = rows.map((r) =>
      [
        `"${r.employeeName}"`,
        `"${r.regionCode}"`,
        `"${r.leaveTypeName}"`,
        r.startDate,
        r.endDate,
        r.totalDays,
        r.status,
        `"${(r.reason ?? '').replace(/"/g, '""')}"`,
      ].join(',')
    ).join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`)
    res.send(csvHeader + csvRows)
  } catch (err) {
    next(err)
  }
})

// GET /api/reports/export/entitlements
const entitlementExportSchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  regionId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  format: z.enum(['csv', 'xlsx']).default('csv'),
})

router.get('/export/entitlements', validate(entitlementExportSchema, 'query'), async (req, res, next) => {
  try {
    const { year, regionId, userId, format } = req.query as unknown as z.infer<typeof entitlementExportSchema>

    const conditions = [eq(leaveBalances.year, year), eq(users.isActive, true)]
    if (regionId) conditions.push(eq(users.regionId, regionId))
    if (userId) conditions.push(eq(leaveBalances.userId, userId))

    const rows = await db
      .select({
        employeeName: users.name,
        regionCode: regions.code,
        leaveTypeName: leaveTypes.name,
        entitled: leaveBalances.entitled,
        used: leaveBalances.used,
        adjustments: leaveBalances.adjustments,
        carried: leaveBalances.carried,
        pending: leaveBalances.pending,
      })
      .from(leaveBalances)
      .innerJoin(users, eq(leaveBalances.userId, users.id))
      .innerJoin(regions, eq(users.regionId, regions.id))
      .innerJoin(leaveTypes, eq(leaveBalances.leaveTypeId, leaveTypes.id))
      .where(and(...conditions))
      .orderBy(users.name, leaveTypes.name)

    const regionSuffix = regionId ? `_region${regionId}` : '_all_regions'
    const staffSuffix = userId ? `_staff${userId}` : ''
    const baseName = `entitlements_${year}${regionSuffix}${staffSuffix}`

    if (format === 'xlsx') {
      const xlsxData = rows.map((r) => {
        const entitled = parseFloat(r.entitled)
        const used = parseFloat(r.used)
        const adj = parseFloat(r.adjustments)
        const carried = parseFloat(r.carried)
        const pending = parseFloat(r.pending)
        const remaining = parseFloat((entitled + carried + adj - used - pending).toFixed(1))
        return {
          Employee: r.employeeName,
          Region: r.regionCode,
          'Leave Type': r.leaveTypeName,
          Entitlement: parseFloat(entitled.toFixed(1)),
          Used: parseFloat(used.toFixed(1)),
          Adjustment: parseFloat(adj.toFixed(1)),
          'Carried Over': parseFloat(carried.toFixed(1)),
          Pending: parseFloat(pending.toFixed(1)),
          Remaining: remaining,
        }
      })
      const buf = generateXlsx(xlsxData, 'Entitlements')
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`)
      return res.send(buf)
    }

    const csvHeader = 'Employee,Region,Leave Type,Entitlement,Used,Adjustment,Carried Over,Pending,Remaining\n'
    const csvRows = rows.map((r) => {
      const entitled = parseFloat(r.entitled)
      const used = parseFloat(r.used)
      const adj = parseFloat(r.adjustments)
      const carried = parseFloat(r.carried)
      const pending = parseFloat(r.pending)
      const remaining = (entitled + carried + adj - used - pending).toFixed(1)
      return [
        `"${r.employeeName}"`,
        `"${r.regionCode}"`,
        `"${r.leaveTypeName}"`,
        entitled.toFixed(1),
        used.toFixed(1),
        adj.toFixed(1),
        carried.toFixed(1),
        pending.toFixed(1),
        remaining,
      ].join(',')
    }).join('\n')

    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`)
    res.send(csvHeader + csvRows)
  } catch (err) {
    next(err)
  }
})

export default router
