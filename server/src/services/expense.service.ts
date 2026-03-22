import { db } from '../db/index'
import { expenses, expenseItems, expenseAuditLog } from '../db/schema'
import { eq, desc } from 'drizzle-orm'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — xlsx ships its own types but tsconfig path resolution misses them in workspace
import * as XLSX from 'xlsx'

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
// List & Get
// ---------------------------------------------------------------------------

export async function listExpenses(
  userId: number,
  role: string,
  statusFilter?: string
) {
  const isHrOrAbove = ['hr_admin', 'super_admin'].includes(role)

  const rows = await db.query.expenses.findMany({
    with: { uploadedBy: { columns: { id: true, name: true, email: true } }, items: true },
    orderBy: [desc(expenses.createdAt)],
  })

  let filtered = rows
  // Employees only see their own
  if (!isHrOrAbove) {
    filtered = rows.filter((e) => e.uploadedByUserId === userId)
  }
  if (statusFilter) {
    filtered = filtered.filter((e) => e.status === statusFilter)
  }
  return filtered
}

export async function getExpense(id: number) {
  const expense = await db.query.expenses.findFirst({
    where: eq(expenses.id, id),
    with: {
      uploadedBy: { columns: { id: true, name: true, email: true } },
      items: true,
      auditLog: { orderBy: [desc(expenseAuditLog.createdAt)] },
    },
  })
  if (!expense) throw new Error('Expense not found')
  return expense
}

// ---------------------------------------------------------------------------
// Send for Approval
// ---------------------------------------------------------------------------

export async function sendForApproval(
  expenseId: number,
  userId: number
): Promise<{ slackMessageTs: string | null; channelId: string | null }> {
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

  if (isMockExternal()) {
    console.log(`[expense] MOCK — would post Slack approval message for expense #${expenseId}`)
    return { slackMessageTs: null, channelId: null }
  }

  // Real Slack posting is done in the route (needs the Slack client from bolt context)
  // Return sentinel so the route can post and then call saveSlackMessage
  return { slackMessageTs: null, channelId: null }
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
    .set({ status: 'SYNCING', syncAttempts: attempts })
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
    let success = false
    let netsuiteId: string | null = null

    if (isMockExternal()) {
      // In mock mode, always succeed
      console.log(`[expense] MOCK NetSuite sync for expense #${expenseId} (attempt ${attempt})`)
      success = true
      netsuiteId = `NS-MOCK-${expenseId}-${Date.now()}`
    } else {
      // TODO: Replace with real NetSuite API call.
      // Employees matched by email: expense.items[n].employeeEmail → NetSuite employee record
      // Example stub — always succeeds for now
      console.log(`[expense] NetSuite sync for expense #${expenseId} (attempt ${attempt})`)
      success = true
      netsuiteId = `NS-${expenseId}-${Date.now()}`
    }

    if (success) {
      await db
        .update(expenses)
        .set({ status: 'SYNCED', netsuiteId })
        .where(eq(expenses.id, expenseId))
      await logAudit(expenseId, 'SYNCING', 'SYNCED', null, 'System', `NetSuite ID: ${netsuiteId}`)
    }
  } catch (err) {
    const expense = await db.query.expenses.findFirst({ where: eq(expenses.id, expenseId) })
    if (!expense) return

    if (attempt >= MAX_SYNC_ATTEMPTS) {
      await db
        .update(expenses)
        .set({ status: 'SYNC_FAILED' })
        .where(eq(expenses.id, expenseId))
      await logAudit(expenseId, 'SYNCING', 'SYNC_FAILED', null, 'System', `Failed after ${attempt} attempts`)
    } else {
      // Retry via startSync (will increment attempts)
      setTimeout(() => startSync(expenseId, null, null), 5000 * attempt)
    }
  }
}
