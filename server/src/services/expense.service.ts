import { db } from '../db/index'
import { expenses, expenseItems, expenseAuditLog, expenseAttachments, users } from '../db/schema'
import { eq, desc, inArray } from 'drizzle-orm'
import { getSupervisorSlackId, getUserById } from '../slack/db-service'
import { WebClient } from '@slack/web-api'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — xlsx ships its own types but tsconfig path resolution misses them in workspace
import * as XLSX from 'xlsx'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExpenseStatus =
  | 'PENDING_REVIEW'
  | 'AWAITING_APPROVAL'
  | 'APPROVED'
  | 'REJECTED'
  | 'SYNCING'
  | 'SYNCED'
  | 'SYNC_FAILED'

export interface CsvRow {
  employee_email?: string
  employeeEmail?: string
  email?: string
  category?: string
  amount?: string | number
  currency?: string
  date?: string
  expense_date?: string
  description?: string
  [key: string]: unknown
}

const MAX_SYNC_ATTEMPTS = 3

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function logAudit(
  expenseId: number,
  fromStatus: ExpenseStatus | null,
  toStatus: ExpenseStatus,
  actorId: number | null,
  actorName: string | null,
  note?: string
) {
  await db.insert(expenseAuditLog).values({
    expenseId,
    fromStatus: fromStatus ?? undefined,
    toStatus,
    actorId: actorId ?? undefined,
    actorName: actorName ?? undefined,
    note: note ?? undefined,
  })
}

function isMockExternal(): boolean {
  return process.env['MOCK_EXTERNAL'] === 'true'
}

function buildNetSuiteUrl(netsuiteId: string | null | undefined): string | null {
  if (!netsuiteId) return null
  const accountId = process.env['NS_ACCOUNT_ID']
  if (!accountId) return null
  const accountSlug = accountId.replace(/_/g, '-').toLowerCase()
  return `https://${accountSlug}.app.netsuite.com/app/accounting/transactions/exprpt.nl?id=${netsuiteId}`
}

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export function parseCsv(buffer: Buffer): CsvRow[] {
  const workbook = XLSX.read(buffer, { type: 'buffer', raw: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]!]
  if (!sheet) throw new Error('No sheet found in uploaded file')
  return XLSX.utils.sheet_to_json<CsvRow>(sheet, { defval: '' })
}

function extractItem(row: CsvRow, expenseId: number) {
  const email =
    (row.employee_email as string) || (row.employeeEmail as string) || (row.email as string) || ''
  const amount = parseFloat(String(row.amount ?? '0')) || 0
  const currency = (row.currency as string) || 'HKD'
  const expenseDate =
    (row.expense_date as string) || (row.date as string) || undefined
  const category = (row.category as string) || undefined
  const description = (row.description as string) || undefined

  // Store all original keys as raw data for reference
  const rawData: Record<string, string> = {}
  for (const [k, v] of Object.entries(row)) {
    rawData[k] = String(v ?? '')
  }

  return {
    expenseId,
    employeeEmail: email,
    amount: String(amount),
    currency,
    expenseDate: expenseDate || undefined,
    category,
    description,
    rawData,
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export async function uploadExpenses(
  userId: number,
  filename: string,
  buffer: Buffer
): Promise<typeof expenses.$inferSelect> {
  const rows = parseCsv(buffer)
  if (rows.length === 0) throw new Error('CSV file is empty or has no data rows')

  const [expense] = await db
    .insert(expenses)
    .values({ uploadedByUserId: userId, filename, status: 'PENDING_REVIEW' })
    .returning()

  if (!expense) throw new Error('Failed to create expense record')

  const items = rows.map((row) => extractItem(row, expense.id))
  await db.insert(expenseItems).values(items)

  await logAudit(expense.id, null, 'PENDING_REVIEW', userId, null, `Uploaded ${rows.length} rows`)

  return expense
}

// ---------------------------------------------------------------------------
// Manual entry
// ---------------------------------------------------------------------------

export interface ManualExpenseItem {
  employeeEmail: string
  category?: string
  amount: number
  currency?: string
  expenseDate?: string
  description?: string
}

export async function createManualExpense(
  userId: number,
  items: ManualExpenseItem[]
): Promise<typeof expenses.$inferSelect> {
  if (items.length === 0) throw new Error('At least one expense item is required')

  const [expense] = await db
    .insert(expenses)
    .values({ uploadedByUserId: userId, filename: 'Manual entry', status: 'PENDING_REVIEW' })
    .returning()

  if (!expense) throw new Error('Failed to create expense record')

  const dbItems = items.map((item) => ({
    expenseId: expense.id,
    employeeEmail: item.employeeEmail,
    amount: String(item.amount),
    currency: item.currency || 'HKD',
    expenseDate: item.expenseDate || undefined,
    category: item.category || undefined,
    description: item.description || undefined,
    rawData: item as unknown as Record<string, string>,
  }))

  await db.insert(expenseItems).values(dbItems)

  await logAudit(expense.id, null, 'PENDING_REVIEW', userId, null, `Manual entry — ${items.length} item(s)`)

  return expense
}

// ---------------------------------------------------------------------------
// Manager check
// ---------------------------------------------------------------------------

export async function isManagerOf(managerId: number, employeeId?: number): Promise<boolean> {
  if (!employeeId) return false
  const [employee] = await db
    .select({ managerId: users.managerId })
    .from(users)
    .where(eq(users.id, employeeId))
    .limit(1)
  return employee?.managerId === managerId
}

// ---------------------------------------------------------------------------
// List & Get
// ---------------------------------------------------------------------------

export async function listExpenses(
  userId: number,
  role: string,
  statusFilter?: string
) {
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(role)

  const rows = await db.query.expenses.findMany({
    with: {
      uploadedBy: { columns: { id: true, name: true, email: true } },
      items: true,
      attachments: true,
    },
    orderBy: [desc(expenses.createdAt)],
  })

  let filtered = rows
  if (!isHrOrAbove) {
    const directReportIds = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.managerId, userId))
    const reportIds = new Set(directReportIds.map((r) => r.id))
    reportIds.add(userId)
    filtered = rows.filter((e) => reportIds.has(e.uploadedByUserId))
  }
  if (statusFilter) {
    filtered = filtered.filter((e) => e.status === statusFilter)
  }
  return filtered.map((e) => ({ ...e, netsuiteUrl: buildNetSuiteUrl(e.netsuiteId) }))
}

export async function getExpense(id: number) {
  const expense = await db.query.expenses.findFirst({
    where: eq(expenses.id, id),
    with: {
      uploadedBy: { columns: { id: true, name: true, email: true } },
      items: true,
      auditLog: { orderBy: [desc(expenseAuditLog.createdAt)] },
      attachments: true,
    },
  })
  if (!expense) throw new Error('Expense not found')
  return { ...expense, netsuiteUrl: buildNetSuiteUrl(expense.netsuiteId) }
}

// ---------------------------------------------------------------------------
// Slack DM helper
// ---------------------------------------------------------------------------

async function dmManagerAboutExpenses(
  submitterId: number,
  expenseIds: number[],
  appUrl: string
): Promise<void> {
  if (isMockExternal()) {
    console.log(`[expense] MOCK — would DM manager about expenses: ${expenseIds.join(', ')}`)
    return
  }

  const botToken = process.env['SLACK_BOT_TOKEN']
  if (!botToken) {
    console.warn('[expense] SLACK_BOT_TOKEN not set — skipping manager DM')
    return
  }

  const managerSlackId = await getSupervisorSlackId(submitterId)
  if (!managerSlackId) {
    console.warn(`[expense] No manager Slack ID found for user ${submitterId} — skipping DM`)
    return
  }

  const submitter = await getUserById(submitterId)
  const employeeName = submitter?.name ?? `User #${submitterId}`
  const count = expenseIds.length

  // Fetch expense details for total amount
  const expenseRows = await db.query.expenses.findMany({
    where: inArray(expenses.id, expenseIds),
    with: { items: true },
  })
  const totalAmount = expenseRows.reduce((sum, e) =>
    sum + e.items.reduce((s, i) => s + parseFloat(i.amount || '0'), 0), 0
  )
  const currency = expenseRows[0]?.items[0]?.currency ?? 'HKD'

  const reviewUrl = `${appUrl}/expenses`
  const submitText = count === 1
    ? `${employeeName} has submitted 1 expense for your approval`
    : `${employeeName} has submitted ${count} expenses for your approval`

  const client = new WebClient(botToken)
  const dmBlocks: any[] = [
    { type: 'header', text: { type: 'plain_text', text: '💰 Expense Approval Required' } },
    { type: 'divider' },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Submitted by:*\n${employeeName}` },
        { type: 'mrkdwn', text: `*Expenses:*\n${count}` },
        { type: 'mrkdwn', text: `*Total Amount:*\n${currency} ${totalAmount.toFixed(2)}` },
      ],
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `<${reviewUrl}|View and approve in the Bloom LMS →>` },
    },
  ]
  if (expenseIds.length === 1) {
    dmBlocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Approve' },
          style: 'primary',
          action_id: 'expense_approve',
          value: String(expenseIds[0]),
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: '❌ Reject' },
          style: 'danger',
          action_id: 'expense_reject',
          value: String(expenseIds[0]),
        },
      ],
    })
  }
  await client.chat.postMessage({
    channel: managerSlackId,
    text: submitText,
    blocks: dmBlocks,
  }).catch((err: Error) => console.error('[expense] Manager DM failed:', err.message))
}

// ---------------------------------------------------------------------------
// Send for Approval (single)
// ---------------------------------------------------------------------------

export async function sendForApproval(
  expenseId: number,
  userId: number
): Promise<void> {
  const expense = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
    with: { items: true, uploadedBy: { columns: { id: true, name: true } } },
  })
  if (!expense) throw new Error('Expense not found')
  if (expense.status !== 'PENDING_REVIEW') {
    throw new Error(`Cannot send for approval — current status: ${expense.status}`)
  }

  await db
    .update(expenses)
    .set({ status: 'AWAITING_APPROVAL' })
    .where(eq(expenses.id, expenseId))

  await logAudit(expenseId, 'PENDING_REVIEW', 'AWAITING_APPROVAL', userId, null, 'Sent for approval')

  const appUrl = process.env['CLIENT_URL'] ?? 'http://localhost:5173'
  await dmManagerAboutExpenses(userId, [expenseId], appUrl)
}

// ---------------------------------------------------------------------------
// Send Bulk for Approval (all PENDING_REVIEW for this user)
// ---------------------------------------------------------------------------

export async function sendBulkForApproval(userId: number): Promise<number[]> {
  const pending = await db.query.expenses.findMany({
    where: eq(expenses.uploadedByUserId, userId),
  })
  const toSubmit = pending.filter((e) => e.status === 'PENDING_REVIEW')
  if (toSubmit.length === 0) throw new Error('No pending expenses to submit')

  const ids = toSubmit.map((e) => e.id)

  await db
    .update(expenses)
    .set({ status: 'AWAITING_APPROVAL' })
    .where(inArray(expenses.id, ids))

  for (const id of ids) {
    await logAudit(id, 'PENDING_REVIEW', 'AWAITING_APPROVAL', userId, null, 'Bulk sent for approval')
  }

  const appUrl = process.env['CLIENT_URL'] ?? 'http://localhost:5173'
  await dmManagerAboutExpenses(userId, ids, appUrl)

  return ids
}

export async function saveSlackMessage(
  expenseId: number,
  messageTs: string,
  channelId: string
) {
  await db
    .update(expenses)
    .set({ slackMessageTs: messageTs, slackChannelId: channelId })
    .where(eq(expenses.id, expenseId))
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export async function addAttachment(
  expenseId: number,
  url: string,
  originalName: string
): Promise<typeof expenseAttachments.$inferSelect> {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) throw new Error('Expense not found')

  const [attachment] = await db
    .insert(expenseAttachments)
    .values({ expenseId, url, originalName })
    .returning()
  if (!attachment) throw new Error('Failed to save attachment')
  return attachment
}

// ---------------------------------------------------------------------------
// Approve / Reject (called from Slack handler)
// ---------------------------------------------------------------------------

export async function approveExpense(
  expenseId: number,
  actorId: number | null,
  actorName: string
): Promise<void> {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) throw new Error('Expense not found')
  if (expense.status !== 'AWAITING_APPROVAL') {
    throw new Error(`Cannot approve — current status: ${expense.status}`)
  }

  await db.update(expenses).set({ status: 'APPROVED' }).where(eq(expenses.id, expenseId))
  await logAudit(expenseId, 'AWAITING_APPROVAL', 'APPROVED', actorId, actorName, 'Approved via Slack')

  // Immediately kick off sync
  await startSync(expenseId, actorId, actorName)
}

export async function rejectExpense(
  expenseId: number,
  actorId: number | null,
  actorName: string,
  note?: string
): Promise<void> {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) throw new Error('Expense not found')
  if (expense.status !== 'AWAITING_APPROVAL') {
    throw new Error(`Cannot reject — current status: ${expense.status}`)
  }

  await db
    .update(expenses)
    .set({ status: 'REJECTED', rejectionNote: note ?? null })
    .where(eq(expenses.id, expenseId))
  await logAudit(expenseId, 'AWAITING_APPROVAL', 'REJECTED', actorId, actorName, note ?? 'Rejected via Slack')
}

// ---------------------------------------------------------------------------
// Resubmit after rejection
// ---------------------------------------------------------------------------

export async function resubmitExpense(expenseId: number, userId: number): Promise<void> {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) throw new Error('Expense not found')
  if (expense.status !== 'REJECTED') {
    throw new Error(`Cannot resubmit — current status: ${expense.status}`)
  }
  if (expense.uploadedByUserId !== userId) throw new Error('Forbidden')

  await db
    .update(expenses)
    .set({ status: 'PENDING_REVIEW', rejectionNote: null })
    .where(eq(expenses.id, expenseId))
  await logAudit(expenseId, 'REJECTED', 'PENDING_REVIEW', userId, null, 'Resubmitted by user')
}

// ---------------------------------------------------------------------------
// Retry sync
// ---------------------------------------------------------------------------

export async function retrySync(expenseId: number, userId: number): Promise<void> {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) throw new Error('Expense not found')
  if (expense.status !== 'SYNC_FAILED') {
    throw new Error(`Cannot retry — current status: ${expense.status}`)
  }

  await startSync(expenseId, userId, null)
}

// ---------------------------------------------------------------------------
// NetSuite sync (internal)
// ---------------------------------------------------------------------------

async function startSync(
  expenseId: number,
  actorId: number | null,
  actorName: string | null
): Promise<void> {
  const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
  if (!expense) return

  const attempts = expense.syncAttempts + 1
  await db
    .update(expenses)
    .set({ status: 'SYNCING', syncAttempts: attempts, syncError: null })
    .where(eq(expenses.id, expenseId))
  await logAudit(expenseId, expense.status as ExpenseStatus, 'SYNCING', actorId, actorName, `Sync attempt ${attempts}`)

  // Run async — don't await so the caller returns quickly
  syncToNetSuite(expenseId, attempts).catch((err: Error) =>
    console.error(`[expense] Sync error for #${expenseId}:`, err.message)
  )
}

async function syncToNetSuite(expenseId: number, attempt: number): Promise<void> {
  const expense = await db.query.expenses.findFirst({
    where: eq(expenses.id, expenseId),
    with: { items: true, uploadedBy: { columns: { email: true, name: true } } },
  })
  if (!expense) return

  try {
    let netsuiteId: string | null = null

    if (isMockExternal()) {
      console.log(`[expense] MOCK NetSuite sync for expense #${expenseId} (attempt ${attempt})`)
      netsuiteId = `NS-MOCK-${expenseId}-${Date.now()}`
    } else {
      const nsAccountId = process.env['NS_ACCOUNT_ID']
      const nsTokenId = process.env['NS_TOKEN_ID']
      const nsTokenSecret = process.env['NS_TOKEN_SECRET']
      const nsConsumerKey = process.env['NS_CONSUMER_KEY']
      const nsConsumerSecret = process.env['NS_CONSUMER_SECRET']

      console.log(`[expense] ── NetSuite Sync Start ──────────────────────────`)
      console.log(`[expense]   Expense ID:    #${expenseId}`)
      console.log(`[expense]   Attempt:       ${attempt} / ${MAX_SYNC_ATTEMPTS}`)
      console.log(`[expense]   Uploaded by:   ${expense.uploadedBy?.name ?? 'unknown'} (${expense.uploadedBy?.email ?? 'unknown'})`)
      console.log(`[expense]   Filename:      ${expense.filename}`)
      console.log(`[expense]   Items:         ${expense.items?.length ?? 0}`)
      console.log(`[expense]   Account ID:    ${nsAccountId ?? 'NOT SET'}`)
      console.log(`[expense]   Consumer Key:  ${nsConsumerKey ? nsConsumerKey.substring(0, 8) + '...' + nsConsumerKey.slice(-4) : 'NOT SET'}`)
      console.log(`[expense]   Token ID:      ${nsTokenId ? nsTokenId.substring(0, 8) + '...' + nsTokenId.slice(-4) : 'NOT SET'}`)

      if (!nsAccountId || !nsTokenId || !nsTokenSecret || !nsConsumerKey || !nsConsumerSecret) {
        const missing = [
          !nsAccountId && 'NS_ACCOUNT_ID',
          !nsConsumerKey && 'NS_CONSUMER_KEY',
          !nsConsumerSecret && 'NS_CONSUMER_SECRET',
          !nsTokenId && 'NS_TOKEN_ID',
          !nsTokenSecret && 'NS_TOKEN_SECRET',
        ].filter(Boolean).join(', ')
        throw new Error(`NetSuite credentials missing: ${missing}`)
      }

      const accountSlug = nsAccountId.replace(/_/g, '-').toLowerCase()
      const realm = nsAccountId.replace(/-/g, '_').toUpperCase()
      const baseUrl = `https://${accountSlug}.suitetalk.api.netsuite.com/services/rest/record/v1/expenseReport`

      console.log(`[expense]   Realm:         ${realm}`)
      console.log(`[expense]   URL:           ${baseUrl}`)

      const payload = {
        tranDate: expense.createdAt ? new Date(expense.createdAt).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        memo: `Bloom LMS Expense #${expenseId} — ${expense.filename}`,
        expenseReportCurrency: { refName: expense.items?.[0]?.currency ?? 'HKD' },
        expense: {
          items: (expense.items ?? []).map((item: any) => ({
            expenseDate: item.expenseDate ?? new Date().toISOString().slice(0, 10),
            amount: parseFloat(item.amount),
            currency: { refName: item.currency ?? 'HKD' },
            category: item.category ? { refName: item.category } : undefined,
            memo: item.description ?? '',
          })),
        },
      }

      console.log(`[expense]   Payload:       ${JSON.stringify(payload).substring(0, 500)}`)

      const oauthHeader = buildNetSuiteOAuth1Header(
        'POST', baseUrl, nsConsumerKey, nsConsumerSecret, nsTokenId, nsTokenSecret, nsAccountId
      )

      console.log(`[expense]   OAuth header:  ${oauthHeader.substring(0, 120)}...`)
      console.log(`[expense]   Sending POST request...`)

      let response: Response
      const fetchStart = Date.now()
      try {
        response = await fetch(baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': oauthHeader,
            'prefer': 'respond-async',
          },
          body: JSON.stringify(payload),
        })
      } catch (fetchErr: any) {
        const elapsed = Date.now() - fetchStart
        const cause = fetchErr?.cause ? ` | cause: ${fetchErr.cause?.message ?? JSON.stringify(fetchErr.cause)}` : ''
        console.error(`[expense]   Network error after ${elapsed}ms: ${fetchErr.message}${cause}`)
        throw new Error(`Network error reaching NetSuite: ${fetchErr.message}${cause}`)
      }

      const elapsed = Date.now() - fetchStart
      console.log(`[expense]   Response:      ${response.status} ${response.statusText} (${elapsed}ms)`)

      const responseHeaders: Record<string, string> = {}
      response.headers.forEach((v, k) => { responseHeaders[k] = v })
      console.log(`[expense]   Resp headers:  ${JSON.stringify(responseHeaders).substring(0, 500)}`)

      if (!response.ok) {
        const errorBody = await response.text()
        console.error(`[expense]   Error body:    ${errorBody.substring(0, 1000)}`)
        throw new Error(`NetSuite API returned ${response.status}: ${errorBody}`)
      }

      const location = response.headers.get('location')
      if (location) {
        console.log(`[expense]   Location:      ${location}`)
        const idMatch = location.match(/\/(\d+)$/)
        netsuiteId = idMatch ? idMatch[1] : location
      } else {
        const body = await response.json().catch(() => null) as Record<string, any> | null
        console.log(`[expense]   Response body: ${JSON.stringify(body).substring(0, 500)}`)
        netsuiteId = body?.id ? String(body.id) : `NS-${expenseId}-${Date.now()}`
      }

      console.log(`[expense]   NetSuite ID:   ${netsuiteId}`)
      console.log(`[expense] ── NetSuite Sync Success ─────────────────────────`)
    }

    await db
      .update(expenses)
      .set({ status: 'SYNCED', netsuiteId })
      .where(eq(expenses.id, expenseId))
    await logAudit(expenseId, 'SYNCING', 'SYNCED', null, 'System', `NetSuite ID: ${netsuiteId}`)
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`[expense] Sync error for expense #${expenseId} (attempt ${attempt}): ${errMsg}`)

    const current = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
    if (!current) return

    if (attempt >= MAX_SYNC_ATTEMPTS) {
      await db
        .update(expenses)
        .set({ status: 'SYNC_FAILED', syncError: errMsg })
        .where(eq(expenses.id, expenseId))
      await logAudit(expenseId, 'SYNCING', 'SYNC_FAILED', null, 'System', `Failed after ${attempt} attempts: ${errMsg}`)
    } else {
      setTimeout(() => startSync(expenseId, null, null), 5000 * attempt)
    }
  }
}

function buildNetSuiteOAuth1Header(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  tokenId: string,
  tokenSecret: string,
  accountId: string
): string {
  const nonce = crypto.randomBytes(16).toString('hex')
  const timestamp = Math.floor(Date.now() / 1000).toString()

  const params: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_token: tokenId,
    oauth_nonce: nonce,
    oauth_timestamp: timestamp,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_version: '1.0',
  }

  const sortedKeys = Object.keys(params).sort()
  const paramString = sortedKeys.map(k => `${encodeRFC3986(k)}=${encodeRFC3986(params[k]!)}`).join('&')
  const baseString = `${method.toUpperCase()}&${encodeRFC3986(url)}&${encodeRFC3986(paramString)}`
  const signingKey = `${encodeRFC3986(consumerSecret)}&${encodeRFC3986(tokenSecret)}`

  const signature = crypto
    .createHmac('sha256', signingKey)
    .update(baseString)
    .digest('base64')

  params['oauth_signature'] = signature
  params['realm'] = accountId.replace(/-/g, '_').toUpperCase()

  const headerParts = ['realm', 'oauth_consumer_key', 'oauth_token', 'oauth_nonce', 'oauth_timestamp', 'oauth_signature_method', 'oauth_version', 'oauth_signature']
  const headerString = headerParts.map(k => `${k}="${encodeRFC3986(params[k]!)}"`).join(', ')

  return `OAuth ${headerString}`
}

function encodeRFC3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
