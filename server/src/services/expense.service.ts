import { db } from '../db/index'
import {
  expenseLines,
  expenseReports,
  expenseReportAuditLog,
  users,
  regions,
} from '../db/schema'
import { eq, and, desc, inArray } from 'drizzle-orm'
import { WebClient } from '@slack/web-api'
import { getSupervisorSlackId, getUserById } from '../slack/db-service'
import * as netsuite from './netsuite.client'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpenseReportStatus =
  | 'PENDING_REVIEW'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'

export interface CreateLineInput {
  category: string
  amount: number
  currency: string
  expenseDate: string  // YYYY-MM-DD
  description?: string | null
}

export interface UpdateLineInput extends Partial<CreateLineInput> {}

const MAX_SYNC_ATTEMPTS = 3

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMockExternal(): boolean {
  return process.env['MOCK_EXTERNAL'] === 'true'
}

async function logReportAudit(
  reportId: number,
  fromStatus: ExpenseReportStatus | null,
  toStatus: ExpenseReportStatus,
  actorId: number | null,
  actorName: string | null,
  note?: string
) {
  await db.insert(expenseReportAuditLog).values({
    reportId,
    fromStatus: fromStatus ?? undefined,
    toStatus,
    actorId: actorId ?? undefined,
    actorName: actorName ?? undefined,
    note: note ?? undefined,
  })
}

// ---------------------------------------------------------------------------
// LINES — users add these as they incur expenses
// ---------------------------------------------------------------------------

export async function createLine(
  userId: number,
  input: CreateLineInput
): Promise<typeof expenseLines.$inferSelect> {
  if (!input.amount || input.amount <= 0) throw new Error('Amount must be greater than zero')
  if (!input.category) throw new Error('Category is required')
  if (!input.expenseDate) throw new Error('Expense date is required')

  const [line] = await db.insert(expenseLines).values({
    userId,
    status: 'draft',
    category: input.category,
    amount: String(input.amount),
    currency: (input.currency || 'HKD').toUpperCase(),
    expenseDate: input.expenseDate,
    description: input.description ?? undefined,
  }).returning()
  if (!line) throw new Error('Failed to create line')
  return line
}

export async function updateLine(
  userId: number,
  lineId: number,
  input: UpdateLineInput
): Promise<typeof expenseLines.$inferSelect> {
  const line = await db.query.expenseLines.findFirst({
    where: eq(expenseLines.id, lineId),
    with: { report: true },
  })
  if (!line) throw new Error('Line not found')
  if (line.userId !== userId) throw new Error('Forbidden')
  if (line.status === 'in_report' && line.report) {
    const blocked: ExpenseReportStatus[] = ['AWAITING_APPROVAL', 'APPROVED', 'SYNCING', 'SYNCED']
    if (blocked.includes(line.report.status as ExpenseReportStatus)) {
      throw new Error(`Cannot edit a line attached to a ${line.report.status} report`)
    }
  }

  const updates: Partial<typeof expenseLines.$inferInsert> = {}
  if (input.category !== undefined) updates.category = input.category
  if (input.amount !== undefined) updates.amount = String(input.amount)
  if (input.currency !== undefined) updates.currency = input.currency.toUpperCase()
  if (input.expenseDate !== undefined) updates.expenseDate = input.expenseDate
  if (input.description !== undefined) updates.description = input.description ?? undefined

  const [updated] = await db
    .update(expenseLines)
    .set(updates)
    .where(eq(expenseLines.id, lineId))
    .returning()
  if (!updated) throw new Error('Failed to update line')
  return updated
}

export async function deleteLine(userId: number, lineId: number): Promise<void> {
  const line = await db.query.expenseLines.findFirst({ where: eq(expenseLines.id, lineId) })
  if (!line) throw new Error('Line not found')
  if (line.userId !== userId) throw new Error('Forbidden')
  if (line.status !== 'draft') {
    throw new Error('Only draft lines can be deleted. Reject the report first if you need to remove an attached line.')
  }
  await db.delete(expenseLines).where(eq(expenseLines.id, lineId))
}

export async function attachReceipt(
  userId: number,
  lineId: number,
  url: string,
  originalName: string
): Promise<typeof expenseLines.$inferSelect> {
  const line = await db.query.expenseLines.findFirst({
    where: eq(expenseLines.id, lineId),
    with: { report: true },
  })
  if (!line) throw new Error('Line not found')
  if (line.userId !== userId) throw new Error('Forbidden')
  if (line.report && ['AWAITING_APPROVAL', 'APPROVED', 'SYNCING', 'SYNCED'].includes(line.report.status)) {
    throw new Error(`Cannot attach receipt to a line in a ${line.report.status} report`)
  }
  const [updated] = await db
    .update(expenseLines)
    .set({ receiptUrl: url, receiptOriginalName: originalName })
    .where(eq(expenseLines.id, lineId))
    .returning()
  if (!updated) throw new Error('Failed to save receipt')
  return updated
}

export async function listMyLines(userId: number, statusFilter?: 'draft' | 'in_report') {
  const where = statusFilter
    ? and(eq(expenseLines.userId, userId), eq(expenseLines.status, statusFilter))
    : eq(expenseLines.userId, userId)
  return db.query.expenseLines.findMany({
    where,
    orderBy: [desc(expenseLines.expenseDate), desc(expenseLines.createdAt)],
    with: { report: true },
  })
}

// ---------------------------------------------------------------------------
// REPORTS — bundle selected lines, approve, sync to NS
// ---------------------------------------------------------------------------

export async function isManagerOf(managerId: number, employeeId?: number | null): Promise<boolean> {
  if (!employeeId) return false
  const [employee] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, employeeId))
    .limit(1)
  return employee?.managerId === managerId
}

function defaultReportTitle(dates: string[]): string {
  if (dates.length === 0) return `Expense Report — ${new Date().toISOString().slice(0, 10)}`
  const sorted = [...dates].sort()
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  return first === last
    ? `Expense Report — ${first}`
    : `Expense Report — ${first} to ${last}`
}

export async function createReport(
  userId: number,
  lineIds: number[],
  title?: string
): Promise<typeof expenseReports.$inferSelect> {
  if (lineIds.length === 0) throw new Error('Select at least one expense line')

  // Validate lines: must all belong to the user, all draft, all not yet in a report.
  const lines = await db.query.expenseLines.findMany({
    where: inArray(expenseLines.id, lineIds),
  })
  if (lines.length !== lineIds.length) throw new Error('One or more selected lines not found')
  for (const line of lines) {
    if (line.userId !== userId) throw new Error('You can only include your own expense lines in a report')
    if (line.status !== 'draft' || line.reportId) {
      throw new Error(`Line #${line.id} is already attached to a report`)
    }
  }

  const dates = lines.map((l) => l.expenseDate).filter(Boolean) as string[]
  const finalTitle = title?.trim() || defaultReportTitle(dates)

  const [report] = await db.insert(expenseReports).values({
    userId,
    title: finalTitle,
    status: 'PENDING_REVIEW',
  }).returning()
  if (!report) throw new Error('Failed to create report')

  await db
    .update(expenseLines)
    .set({ reportId: report.id, status: 'in_report' })
    .where(inArray(expenseLines.id, lineIds))

  await logReportAudit(report.id, null, 'PENDING_REVIEW', userId, null, `Created from ${lineIds.length} line(s)`)
  return report
}

function buildNetSuiteUrl(netsuiteId: string | null | undefined, storedUrl: string | null | undefined): string | null {
  if (storedUrl) return storedUrl
  if (!netsuiteId) return null
  const accountId = process.env['NS_ACCOUNT_ID']
  if (!accountId) return null
  const slug = accountId.replace(/_/g, '-').toLowerCase()
  return `https://${slug}.app.netsuite.com/app/accounting/transactions/exprpt.nl?id=${netsuiteId}`
}

export async function getReport(id: number) {
  const report = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, id),
    with: {
      user: { columns: { id: true, name: true, email: true, regionId: true } },
      lines: true,
      auditLog: { orderBy: [desc(expenseReportAuditLog.createdAt)] },
    },
  })
  if (!report) throw new Error('Report not found')
  return { ...report, netsuiteUrl: buildNetSuiteUrl(report.netsuiteId, report.netsuiteUrl) }
}

export async function listReports(userId: number, role: string, statusFilter?: string) {
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(role)
  const all = await db.query.expenseReports.findMany({
    with: {
      user: { columns: { id: true, name: true, email: true } },
      lines: true,
    },
    orderBy: [desc(expenseReports.createdAt)],
  })
  let filtered = all
  if (!isHrOrAbove) {
    const reports = await db.select({ id: users.id }).from(users).where(eq(users.managerId, userId))
    const visible = new Set(reports.map((r) => r.id))
    visible.add(userId)
    filtered = all.filter((r) => visible.has(r.userId))
  }
  if (statusFilter) filtered = filtered.filter((r) => r.status === statusFilter)
  return filtered.map((r) => ({ ...r, netsuiteUrl: buildNetSuiteUrl(r.netsuiteId, r.netsuiteUrl) }))
}

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

async function notifyHr(
  reportId: number,
  outcome: 'synced' | 'failed',
  detail: string
): Promise<void> {
  if (isMockExternal()) {
    console.log(`[expense] MOCK — would HR-notify report #${reportId} (${outcome}): ${detail}`)
    return
  }
  const channel = process.env['EXPENSE_HR_SLACK_CHANNEL']
  if (!channel) return // notification is opt-in
  const botToken = process.env['SLACK_BOT_TOKEN']
  if (!botToken) {
    console.warn('[expense] SLACK_BOT_TOKEN not set — skipping HR notification')
    return
  }

  const report = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, reportId),
    with: { user: { columns: { name: true, email: true } }, lines: true },
  })
  if (!report) return

  const total = report.lines.reduce((s, l) => s + parseFloat(l.amount || '0'), 0)
  const currency = report.lines[0]?.currency ?? 'HKD'
  const submitter = report.user?.name ?? report.user?.email ?? `User #${report.userId}`

  // Slack's KnownBlock union is strict; cast through any to keep this readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] =
    outcome === 'synced'
      ? [
          { type: 'header', text: { type: 'plain_text', text: 'Expense Report synced to NetSuite' } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*From:*\n${submitter}` },
              { type: 'mrkdwn', text: `*Title:*\n${report.title}` },
              { type: 'mrkdwn', text: `*Lines:*\n${report.lines.length}` },
              { type: 'mrkdwn', text: `*Total:*\n${currency} ${total.toFixed(2)}` },
            ],
          },
          { type: 'section', text: { type: 'mrkdwn', text: `<${detail}|View in NetSuite →>` } },
        ]
      : [
          { type: 'header', text: { type: 'plain_text', text: 'Expense Report sync FAILED' } },
          {
            type: 'section',
            fields: [
              { type: 'mrkdwn', text: `*From:*\n${submitter}` },
              { type: 'mrkdwn', text: `*Title:*\n${report.title}` },
              { type: 'mrkdwn', text: `*Total:*\n${currency} ${total.toFixed(2)}` },
            ],
          },
          { type: 'section', text: { type: 'mrkdwn', text: `*Error:*\n\`${detail.substring(0, 500)}\`` } },
        ]

  const client = new WebClient(botToken)
  await client.chat.postMessage({
    channel,
    text: outcome === 'synced'
      ? `Expense report from ${submitter} synced to NetSuite`
      : `Expense report from ${submitter} failed to sync`,
    blocks,
  }).catch((err: Error) => console.error('[expense] HR notify failed:', err.message))
}

async function dmManagerAboutReport(
  reportId: number,
  submitterId: number,
  appUrl: string
): Promise<void> {
  if (isMockExternal()) {
    console.log(`[expense] MOCK — would DM manager about report #${reportId}`)
    return
  }
  const botToken = process.env['SLACK_BOT_TOKEN']
  if (!botToken) {
    console.warn('[expense] SLACK_BOT_TOKEN not set — skipping manager DM')
    return
  }
  const managerSlackId = await getSupervisorSlackId(submitterId)
  if (!managerSlackId) {
    console.warn(`[expense] No manager Slack ID for user ${submitterId} — skipping DM`)
    return
  }

  const submitter = await getUserById(submitterId)
  const employeeName = submitter?.name ?? `User #${submitterId}`
  const report = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, reportId),
    with: { lines: true },
  })
  if (!report) return

  const total = report.lines.reduce((s, l) => s + parseFloat(l.amount || '0'), 0)
  const currency = report.lines[0]?.currency ?? 'HKD'
  const reviewUrl = `${appUrl}/expenses`

  const client = new WebClient(botToken)
  await client.chat.postMessage({
    channel: managerSlackId,
    text: `${employeeName} has submitted an expense report for your approval`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: 'Expense Report — approval needed' } },
      { type: 'divider' },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*From:*\n${employeeName}` },
          { type: 'mrkdwn', text: `*Title:*\n${report.title}` },
          { type: 'mrkdwn', text: `*Lines:*\n${report.lines.length}` },
          { type: 'mrkdwn', text: `*Total:*\n${currency} ${total.toFixed(2)}` },
        ],
      },
      { type: 'section', text: { type: 'mrkdwn', text: `<${reviewUrl}|Review and approve in the LMS →>` } },
      {
        type: 'actions',
        elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Approve' }, style: 'primary', action_id: 'expense_report_approve', value: String(reportId) },
          { type: 'button', text: { type: 'plain_text', text: 'Reject' }, style: 'danger', action_id: 'expense_report_reject', value: String(reportId) },
        ],
      },
    ],
  }).catch((err: Error) => console.error('[expense] DM failed:', err.message))
}

export async function sendForApproval(reportId: number, userId: number): Promise<void> {
  const report = await db.query.expenseReports.findFirst({ where: eq(expenseReports.id, reportId) })
  if (!report) throw new Error('Report not found')
  if (report.userId !== userId) throw new Error('Forbidden')
  if (report.status !== 'PENDING_REVIEW') {
    throw new Error(`Cannot send for approval — current status: ${report.status}`)
  }

  await db.update(expenseReports).set({ status: 'AWAITING_APPROVAL' }).where(eq(expenseReports.id, reportId))
  await logReportAudit(reportId, 'PENDING_REVIEW', 'AWAITING_APPROVAL', userId, null, 'Sent for approval')

  const appUrl = process.env['CLIENT_URL'] ?? 'http://localhost:5173'
  await dmManagerAboutReport(reportId, userId, appUrl)
}

export async function approveReport(
  reportId: number,
  actorId: number | null,
  actorName: string
): Promise<void> {
  const report = await db.query.expenseReports.findFirst({ where: eq(expenseReports.id, reportId) })
  if (!report) throw new Error('Report not found')
  if (report.status !== 'AWAITING_APPROVAL') {
    throw new Error(`Cannot approve — current status: ${report.status}`)
  }
  await db.update(expenseReports).set({ status: 'APPROVED' }).where(eq(expenseReports.id, reportId))
  await logReportAudit(reportId, 'AWAITING_APPROVAL', 'APPROVED', actorId, actorName, 'Approved')
  await startSync(reportId, actorId, actorName)
}

export async function rejectReport(
  reportId: number,
  actorId: number | null,
  actorName: string,
  note?: string
): Promise<void> {
  const report = await db.query.expenseReports.findFirst({ where: eq(expenseReports.id, reportId) })
  if (!report) throw new Error('Report not found')
  if (report.status !== 'AWAITING_APPROVAL') {
    throw new Error(`Cannot reject — current status: ${report.status}`)
  }
  await db.update(expenseReports)
    .set({ status: 'REJECTED', rejectionNote: note ?? null })
    .where(eq(expenseReports.id, reportId))
  await logReportAudit(reportId, 'AWAITING_APPROVAL', 'REJECTED', actorId, actorName, note ?? 'Rejected')
}

export async function resubmitReport(reportId: number, userId: number): Promise<void> {
  const report = await db.query.expenseReports.findFirst({ where: eq(expenseReports.id, reportId) })
  if (!report) throw new Error('Report not found')
  if (report.userId !== userId) throw new Error('Forbidden')
  if (report.status !== 'REJECTED') {
    throw new Error(`Cannot resubmit — current status: ${report.status}`)
  }
  await db.update(expenseReports)
    .set({ status: 'PENDING_REVIEW', rejectionNote: null })
    .where(eq(expenseReports.id, reportId))
  await logReportAudit(reportId, 'REJECTED', 'PENDING_REVIEW', userId, null, 'Resubmitted')
}

export async function retrySync(reportId: number, userId: number): Promise<void> {
  const report = await db.query.expenseReports.findFirst({ where: eq(expenseReports.id, reportId) })
  if (!report) throw new Error('Report not found')
  if (report.status !== 'SYNC_FAILED') {
    throw new Error(`Cannot retry — current status: ${report.status}`)
  }
  await startSync(reportId, userId, null)
}

export async function saveSlackMessage(
  reportId: number,
  messageTs: string,
  channelId: string
): Promise<void> {
  await db.update(expenseReports)
    .set({ slackMessageTs: messageTs, slackChannelId: channelId })
    .where(eq(expenseReports.id, reportId))
}

// ---------------------------------------------------------------------------
// NetSuite sync (internal)
// ---------------------------------------------------------------------------

async function startSync(
  reportId: number,
  actorId: number | null,
  actorName: string | null
): Promise<void> {
  const report = await db.query.expenseReports.findFirst({ where: eq(expenseReports.id, reportId) })
  if (!report) return

  if (process.env['EXPENSE_SYNC_DISABLED'] === 'true') {
    console.log(`[expense] Sync disabled by EXPENSE_SYNC_DISABLED — report #${reportId} stays APPROVED`)
    await logReportAudit(reportId, report.status as ExpenseReportStatus, report.status as ExpenseReportStatus, actorId, actorName, 'NetSuite sync skipped — EXPENSE_SYNC_DISABLED is set')
    return
  }

  const attempt = report.syncAttempts + 1
  await db.update(expenseReports)
    .set({ status: 'SYNCING', syncAttempts: attempt, syncError: null })
    .where(eq(expenseReports.id, reportId))
  await logReportAudit(reportId, report.status as ExpenseReportStatus, 'SYNCING', actorId, actorName, `Sync attempt ${attempt}`)

  // Run async — caller returns immediately
  syncToNetSuite(reportId, attempt).catch((err: Error) =>
    console.error(`[expense] Sync error for report #${reportId}:`, err.message)
  )
}

async function syncToNetSuite(reportId: number, attempt: number): Promise<void> {
  const report = await db.query.expenseReports.findFirst({
    where: eq(expenseReports.id, reportId),
    with: {
      user: { columns: { email: true, name: true, regionId: true } },
      lines: true,
    },
  })
  if (!report) return

  try {
    let netsuiteId: string
    let netsuiteUrl = ''

    if (isMockExternal()) {
      netsuiteId = `NS-MOCK-${reportId}-${Date.now()}`
      console.log(`[expense] MOCK NetSuite sync for report #${reportId} (attempt ${attempt}) → ${netsuiteId}`)
    } else {
      if (!report.user?.email) throw new Error('Submitter has no email — cannot match NetSuite employee')
      if (!report.user.regionId) throw new Error('Submitter has no region — cannot determine NetSuite subsidiary')

      const [region] = await db.select({ name: regions.name })
        .from(regions)
        .where(eq(regions.id, report.user.regionId))
        .limit(1)
      if (!region?.name) throw new Error(`Region #${report.user.regionId} not found`)

      const dates = report.lines.map((l) => l.expenseDate).filter(Boolean) as string[]
      const reportDate = dates.length ? dates.sort().slice(-1)[0]! : new Date().toISOString().slice(0, 10)

      const nsInput = {
        employeeEmail: report.user.email,
        subsidiaryName: region.name,
        reportDate,
        memo: report.title,
        externalId: `lms-report-${reportId}`,
        lines: report.lines.map((l) => ({
          expenseDate: l.expenseDate ?? reportDate,
          amount: parseFloat(l.amount),
          currencyCode: l.currency || 'HKD',
          category: l.category || '',
          description: l.description ?? undefined,
        })),
      }

      // Dry-run: build + log the payload (which exercises every lookup), then
      // revert status to APPROVED so the report can be re-tested without
      // having to manually reset the row.
      if (process.env['EXPENSE_DRY_RUN'] === 'true') {
        const { payload } = await netsuite.buildExpenseReportPayload(nsInput)
        console.log(`[expense] DRY RUN — report #${reportId} payload that would be POSTed:`)
        console.log(JSON.stringify(payload, null, 2))
        await db.update(expenseReports)
          .set({ status: 'APPROVED', syncAttempts: 0, syncError: null })
          .where(eq(expenseReports.id, reportId))
        await logReportAudit(reportId, 'SYNCING', 'APPROVED', null, 'System', 'DRY RUN — payload built and logged, no POST. Status reverted to APPROVED.')
        return
      }

      const result = await netsuite.createExpenseReport(nsInput)
      netsuiteId = result.netsuiteId
      netsuiteUrl = result.url
    }

    await db.update(expenseReports)
      .set({ status: 'SYNCED', netsuiteId, netsuiteUrl: netsuiteUrl || null })
      .where(eq(expenseReports.id, reportId))
    await logReportAudit(reportId, 'SYNCING', 'SYNCED', null, 'System', `NetSuite ID: ${netsuiteId}`)
    // Notification must not bubble — a failed Slack post would mark a live
    // NetSuite record as SYNC_FAILED and trigger a duplicate retry POST.
    await notifyHr(reportId, 'synced', netsuiteUrl || `NetSuite ID: ${netsuiteId}`)
      .catch((e: Error) => console.error('[expense] HR notify failed:', e.message))
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[expense] Sync failed for report #${reportId} (attempt ${attempt}): ${errMsg}`)
    if (attempt >= MAX_SYNC_ATTEMPTS) {
      await db.update(expenseReports)
        .set({ status: 'SYNC_FAILED', syncError: errMsg })
        .where(eq(expenseReports.id, reportId))
      await logReportAudit(reportId, 'SYNCING', 'SYNC_FAILED', null, 'System', `Failed after ${attempt} attempts: ${errMsg}`)
      await notifyHr(reportId, 'failed', errMsg)
        .catch((e: Error) => console.error('[expense] HR notify failed:', e.message))
    } else {
      // Schedule retry — note: lost on server restart, that's ok for v1
      setTimeout(() => {
        void (async () => {
          await db.update(expenseReports)
            .set({ status: 'SYNCING', syncAttempts: attempt + 1, syncError: null })
            .where(eq(expenseReports.id, reportId))
          syncToNetSuite(reportId, attempt + 1).catch((e: Error) =>
            console.error(`[expense] Retry sync error for #${reportId}:`, e.message))
        })()
      }, 5000 * attempt)
    }
  }
}

// ---------------------------------------------------------------------------
// NetSuite passthrough for form dropdowns
// ---------------------------------------------------------------------------

export async function listNetSuiteCategories(): Promise<{ id: string; name?: string }[]> {
  if (isMockExternal()) {
    return [
      { id: '1', name: 'Travel - Flights' },
      { id: '2', name: 'Travel - Accommodation' },
      { id: '3', name: 'Meals & Entertainment' },
      { id: '4', name: 'Office Supplies' },
    ]
  }
  return netsuite.listExpenseCategories()
}

export async function listNetSuiteCurrencies(): Promise<{ id: string; name?: string; symbol?: string }[]> {
  if (isMockExternal()) {
    return [
      { id: '1', name: 'Hong Kong Dollar', symbol: 'HKD' },
      { id: '2', name: 'Singapore Dollar', symbol: 'SGD' },
      { id: '3', name: 'US Dollar', symbol: 'USD' },
    ]
  }
  return netsuite.listCurrencies()
}
