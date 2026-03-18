import cron from 'node-cron'
import { WebClient } from '@slack/web-api'
import { eq, and, gte, lte, inArray, isNull, or } from 'drizzle-orm'
import { db } from '../db'
import {
  users,
  leaveRequests,
  approvalWorkflows,
  leaveTypes,
  leavePolicies,
  leaveBalances,
  regions,
} from '../db/schema'
import { createNotification } from '../services/notification.service'
import { parseDecimal, getTodayString } from '../utils/workingDays'
import { validateEnv } from '../utils/env'

// Region timezone → UTC offset (hours, standard time — good enough for scheduling windows)
const REGION_TIMEZONES: Record<string, string> = {
  HK: 'Asia/Hong_Kong',
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  ID: 'Asia/Jakarta',
  CN: 'Asia/Shanghai',
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  UK: 'Europe/London',
}

function isNineAmIn(timezone: string): boolean {
  const now = new Date()
  const hour = parseInt(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(
      now
    ),
    10
  )
  return hour === 9
}

function isMondayIn(timezone: string): boolean {
  const now = new Date()
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone }).format(now)
  return day === 'Monday'
}

function nextWeekRangeIn(timezone: string): { start: string; end: string } {
  const now = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date()))
  const day = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - day + (day === 0 ? -6 : 1) + 7)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  return {
    start: monday.toISOString().slice(0, 10),
    end: friday.toISOString().slice(0, 10),
  }
}

// ─── Job 1: Daily approval reminders ─────────────────────────────────────────

async function sendApprovalReminders(slack: WebClient | null) {
  const env = validateEnv()
  const allRegions = await db.select().from(regions)

  for (const region of allRegions) {
    const tz = REGION_TIMEZONES[region.code]
    if (!tz || !isNineAmIn(tz)) continue

    // Find managers in this region with pending approval workflows
    const pendingWorkflows = await db
      .select({
        approverId: approvalWorkflows.approverId,
        requestId: leaveRequests.id,
        employeeName: users.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        leaveTypeName: leaveTypes.name,
      })
      .from(approvalWorkflows)
      .innerJoin(leaveRequests, eq(approvalWorkflows.leaveRequestId, leaveRequests.id))
      .innerJoin(users, eq(leaveRequests.userId, users.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(
        and(
          eq(approvalWorkflows.status, 'pending'),
          eq(leaveRequests.status, 'pending'),
          eq(users.regionId, region.id)
        )
      )

    if (pendingWorkflows.length === 0) continue

    // Group by approver
    const byApprover = new Map<number, typeof pendingWorkflows>()
    for (const row of pendingWorkflows) {
      if (!byApprover.has(row.approverId)) byApprover.set(row.approverId, [])
      byApprover.get(row.approverId)!.push(row)
    }

    for (const [approverId, requests] of byApprover) {
      const count = requests.length
      const message =
        count === 1
          ? `${requests[0]!.employeeName} has a pending ${requests[0]!.leaveTypeName} request (${requests[0]!.startDate} – ${requests[0]!.endDate}) awaiting your approval.`
          : `You have ${count} pending leave requests awaiting your approval.`

      // In-app notification
      await createNotification({
        userId: approverId,
        type: 'approval_reminder',
        title: `${count} leave request${count > 1 ? 's' : ''} pending your approval`,
        message,
        metadata: { count, regionCode: region.code },
      })

      // Slack DM if bot is available and user has a Slack ID
      if (slack && env.SLACK_BOT_TOKEN) {
        const [approver] = await db
          .select({ slackUserId: users.slackUserId, name: users.name })
          .from(users)
          .where(eq(users.id, approverId))
          .limit(1)

        if (approver?.slackUserId) {
          const lines = requests.map(
            (r) => `• *${r.employeeName}* — ${r.leaveTypeName} (${r.startDate} → ${r.endDate})`
          )
          await slack.chat
            .postMessage({
              channel: approver.slackUserId,
              text: `⏰ *Leave Approval Reminder*\n\nYou have ${count} pending request${count > 1 ? 's' : ''}:\n${lines.join('\n')}\n\nPlease review and action these in the Bloom LMS.`,
            })
            .catch((e) => console.error(`[jobs] Slack DM failed for user ${approverId}:`, e))
        }
      }
    }

    console.log(
      `[jobs] Approval reminders sent for region ${region.code} — ${pendingWorkflows.length} pending across ${byApprover.size} approvers`
    )
  }
}

// ─── Job 2: Weekly team absence digest ───────────────────────────────────────

async function sendWeeklyDigest(slack: WebClient | null) {
  if (!slack) return

  const env = validateEnv()
  if (!env.SLACK_BOT_TOKEN) return

  const allRegions = await db.select().from(regions)

  for (const region of allRegions) {
    const tz = REGION_TIMEZONES[region.code]
    if (!tz || !isMondayIn(tz) || !isNineAmIn(tz)) continue

    const { start, end } = nextWeekRangeIn(tz)

    const absences = await db
      .select({
        employeeName: users.name,
        leaveTypeName: leaveTypes.name,
        startDate: leaveRequests.startDate,
        endDate: leaveRequests.endDate,
        totalDays: leaveRequests.totalDays,
      })
      .from(leaveRequests)
      .innerJoin(users, eq(leaveRequests.userId, users.id))
      .innerJoin(leaveTypes, eq(leaveRequests.leaveTypeId, leaveTypes.id))
      .where(
        and(
          eq(leaveRequests.status, 'approved'),
          eq(users.regionId, region.id),
          lte(leaveRequests.startDate, end),
          gte(leaveRequests.endDate, start)
        )
      )

    // Find a Slack channel for this region — try #general-{code} or fall back to general channel
    // The bot posts to a channel named after the region (e.g. #bloom-hk, #bloom-sg)
    // This requires the channel to exist and the bot to be a member
    const channelName = `bloom-${region.code.toLowerCase()}`

    let text: string
    if (absences.length === 0) {
      text = `📅 *Weekly Team Digest — ${region.name}* (${start} to ${end})\n\nEveryone is in this week! 🎉`
    } else {
      const lines = absences.map(
        (a) =>
          `• *${a.employeeName}* — ${a.leaveTypeName}, ${a.startDate}${a.startDate !== a.endDate ? ` to ${a.endDate}` : ''} (${parseDecimal(a.totalDays)} day${parseDecimal(a.totalDays) !== 1 ? 's' : ''})`
      )
      text = `📅 *Weekly Team Digest — ${region.name}* (${start} to ${end})\n\n*Team members on leave:*\n${lines.join('\n')}`
    }

    await slack.chat
      .postMessage({ channel: channelName, text })
      .catch((e) =>
        console.error(`[jobs] Weekly digest failed for region ${region.code} (#${channelName}):`, e.message)
      )

    console.log(`[jobs] Weekly digest sent for region ${region.code}`)
  }
}

// ─── Job 3: Monthly leave accrual ────────────────────────────────────────────

async function runMonthlyAccrual() {
  const year = new Date().getFullYear()

  // Find all active leave policies with an accrual rate
  const accrualPolicies = await db
    .select({
      leaveTypeId: leavePolicies.leaveTypeId,
      regionId: leavePolicies.regionId,
      accrualRate: leavePolicies.accrualRate,
      entitlementDays: leavePolicies.entitlementDays,
    })
    .from(leavePolicies)

  const withRate = accrualPolicies.filter((p) => p.accrualRate !== null)
  if (withRate.length === 0) return

  let accrued = 0

  for (const policy of withRate) {
    const rate = parseDecimal(policy.accrualRate!)
    const maxEntitlement = parseDecimal(policy.entitlementDays)

    // Get all active users in this region with this balance
    const activeUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.regionId, policy.regionId), eq(users.isActive, true)))

    const userIds = activeUsers.map((u) => u.id)
    if (userIds.length === 0) continue

    const balancesToAccrue = await db
      .select({ id: leaveBalances.id, entitled: leaveBalances.entitled })
      .from(leaveBalances)
      .where(
        and(
          inArray(leaveBalances.userId, userIds),
          eq(leaveBalances.leaveTypeId, policy.leaveTypeId),
          eq(leaveBalances.year, year)
        )
      )

    for (const balance of balancesToAccrue) {
      const current = parseDecimal(balance.entitled)
      if (current >= maxEntitlement) continue // already at cap

      const newEntitled = Math.min(maxEntitlement, current + rate)
      await db
        .update(leaveBalances)
        .set({ entitled: newEntitled.toFixed(1) })
        .where(eq(leaveBalances.id, balance.id))

      accrued++
    }
  }

  console.log(`[jobs] Monthly accrual complete — ${accrued} balances updated`)
}

// ─── Job 4: Probation end check ──────────────────────────────────────────────

async function checkProbationEnded(slack: WebClient | null) {
  const today = getTodayString()

  const expiredProbations = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      slackUserId: users.slackUserId,
      probationEndDate: users.probationEndDate,
      regionId: users.regionId,
    })
    .from(users)
    .where(
      and(
        eq(users.isOnProbation, true),
        lte(users.probationEndDate, today),
        eq(users.isActive, true),
        isNull(users.deletedAt)
      )
    )

  if (expiredProbations.length === 0) return

  for (const employee of expiredProbations) {
    // 1. Clear probation status
    await db
      .update(users)
      .set({ isOnProbation: false })
      .where(eq(users.id, employee.id))

    // 2. Notify employee via Slack
    if (slack && employee.slackUserId) {
      await slack.chat.postMessage({
        channel: employee.slackUserId,
        text: `Congratulations ${employee.name}! Your probation period has ended as of ${employee.probationEndDate}. Welcome to the permanent team!`,
      }).catch((e) => console.error(`[jobs] Slack DM failed for probation end (user ${employee.id}):`, e))
    }

    // 3. In-app notification for employee
    await createNotification({
      userId: employee.id,
      type: 'leave_approved',
      title: 'Probation period ended',
      message: `Your probation period has ended as of ${employee.probationEndDate}. Congratulations!`,
      metadata: { probationEndDate: employee.probationEndDate },
    })

    // 4. Notify HR admins in the employee's region
    const hrAdmins = await db
      .select({ id: users.id, slackUserId: users.slackUserId })
      .from(users)
      .where(
        and(
          eq(users.regionId, employee.regionId),
          or(eq(users.role, 'hr_admin'), eq(users.role, 'super_admin')),
          eq(users.isActive, true),
          isNull(users.deletedAt)
        )
      )

    for (const hr of hrAdmins) {
      await createNotification({
        userId: hr.id,
        type: 'leave_approved',
        title: 'Probation ended: ' + employee.name,
        message: `${employee.name}'s probation period has ended on ${employee.probationEndDate}. Status has been automatically updated.`,
        metadata: { employeeId: employee.id, probationEndDate: employee.probationEndDate },
      })

      if (slack && hr.slackUserId) {
        await slack.chat.postMessage({
          channel: hr.slackUserId,
          text: `${employee.name}'s probation period ended on ${employee.probationEndDate}. Status has been automatically updated in the LMS.`,
        }).catch(() => {})
      }
    }

    console.log(`[jobs] Probation ended for ${employee.name} (ID: ${employee.id})`)
  }
}

// ─── Job 5: Probation ending soon reminder ────────────────────────────────────

async function checkProbationEndingSoon(slack: WebClient | null) {
  const today = new Date()
  const in7Days = new Date(today)
  in7Days.setDate(today.getDate() + 7)
  const in7DaysStr = in7Days.toISOString().split('T')[0]!
  const todayStr = getTodayString()

  const expiringSoon = await db
    .select({
      id: users.id,
      name: users.name,
      probationEndDate: users.probationEndDate,
      regionId: users.regionId,
    })
    .from(users)
    .where(
      and(
        eq(users.isOnProbation, true),
        gte(users.probationEndDate, todayStr),
        lte(users.probationEndDate, in7DaysStr),
        eq(users.isActive, true),
        isNull(users.deletedAt)
      )
    )

  for (const employee of expiringSoon) {
    const hrAdmins = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.regionId, employee.regionId),
          or(eq(users.role, 'hr_admin'), eq(users.role, 'super_admin')),
          eq(users.isActive, true),
          isNull(users.deletedAt)
        )
      )

    for (const hr of hrAdmins) {
      await createNotification({
        userId: hr.id,
        type: 'approval_reminder',
        title: `Probation ending soon: ${employee.name}`,
        message: `${employee.name}'s probation period ends on ${employee.probationEndDate} (within 7 days). Please review.`,
        metadata: { employeeId: employee.id, probationEndDate: employee.probationEndDate },
      })
    }
  }

  if (expiringSoon.length > 0) {
    console.log(`[jobs] Probation ending soon reminders sent for ${expiringSoon.length} employee(s)`)
  }

  void slack // slack param reserved for future Slack DM support
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

export function initJobs(slackToken?: string) {
  const slack = slackToken ? new WebClient(slackToken) : null

  // Run every hour on the hour — checks which regions are at 9am
  cron.schedule('0 * * * *', async () => {
    try {
      await sendApprovalReminders(slack)
    } catch (e) {
      console.error('[jobs] Approval reminders error:', e)
    }

    try {
      await sendWeeklyDigest(slack)
    } catch (e) {
      console.error('[jobs] Weekly digest error:', e)
    }
  })

  // Run on the 1st of every month at 01:00 UTC
  cron.schedule('0 1 1 * *', async () => {
    try {
      await runMonthlyAccrual()
    } catch (e) {
      console.error('[jobs] Monthly accrual error:', e)
    }
  })

  // Run daily at 00:05 UTC for probation checks
  cron.schedule('5 0 * * *', async () => {
    try {
      await checkProbationEnded(slack)
      await checkProbationEndingSoon(slack)
    } catch (e) {
      console.error('[jobs] Probation check error:', e)
    }
  })

  console.log('[jobs] Cron jobs scheduled — hourly reminders/digest, monthly accrual, daily probation check')
}
