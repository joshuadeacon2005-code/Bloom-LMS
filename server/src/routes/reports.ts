import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/auth'
import { requireRole } from '../middleware/rbac'
import { validate } from '../middleware/validate'
import { db } from '../db'
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
})

const payrollQuerySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).default(new Date().getFullYear()),
  month: z.coerce.number().int().min(1).max(12).optional(),
  regionId: z.coerce.number().int().positive().optional(),
})

// GET /api/reports/utilisation
router.get('/utilisation', validate(utilisationQuerySchema, 'query'), async (req, res, next) => {
  try {
    const { year, regionId, departmentId } = req.query as unknown as z.infer<
      typeof utilisationQuerySchema
    >

    // Filter users
    const userFilters = [eq(users.isActive, true)]
    if (regionId) userFilters.push(eq(users.regionId, regionId))
    if (departmentId) userFilters.push(eq(users.departmentId, departmentId))

    const filteredUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(...userFilters))

    const userIds = filteredUsers.map((u) => u.id)

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
      const { year, month, regionId } = req.query as unknown as z.infer<typeof payrollQuerySchema>

      const userFilters = [eq(users.isActive, true)]
      if (regionId) userFilters.push(eq(users.regionId, regionId))

      const filteredUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(and(...userFilters))

      const userIds = filteredUsers.map((u) => u.id)
      if (userIds.length === 0) {
        res.setHeader('Content-Type', 'text/csv')
        res.setHeader('Content-Disposition', 'attachment; filename="payroll.csv"')
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

      const filename = month
        ? `payroll-${year}-${String(month).padStart(2, '0')}.csv`
        : `payroll-${year}.csv`

      res.setHeader('Content-Type', 'text/csv')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      res.send(header + csvRows)
    } catch (err) {
      next(err)
    }
  }
)

export default router
