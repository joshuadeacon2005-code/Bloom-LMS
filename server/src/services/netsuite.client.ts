import crypto from 'crypto'

// NetSuite REST + SuiteQL client. Handles TBA OAuth1 signing, looks up internal
// IDs by name/email/code, and creates Expense Reports synchronously so we get
// the real record ID back.
//
// Lookups are cached in-process. The lifetime is short on purpose — categories
// and subsidiaries change rarely, but we don't want to drift if NS admin edits.

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface CacheEntry<T> { value: T; expires: number }
const cache = new Map<string, CacheEntry<unknown>>()

function getCached<T>(key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (Date.now() > entry.expires) {
    cache.delete(key)
    return undefined
  }
  return entry.value as T
}

function setCached<T>(key: string, value: T, ttlMs: number): void {
  cache.set(key, { value, expires: Date.now() + ttlMs })
}

export function clearCache(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Credentials & URL helpers
// ---------------------------------------------------------------------------

interface Credentials {
  accountId: string
  consumerKey: string
  consumerSecret: string
  tokenId: string
  tokenSecret: string
}

function loadCredentials(): Credentials {
  const accountId = process.env['NS_ACCOUNT_ID']
  const consumerKey = process.env['NS_CONSUMER_KEY']
  const consumerSecret = process.env['NS_CONSUMER_SECRET']
  const tokenId = process.env['NS_TOKEN_ID']
  const tokenSecret = process.env['NS_TOKEN_SECRET']
  if (!accountId || !consumerKey || !consumerSecret || !tokenId || !tokenSecret) {
    const missing = [
      !accountId && 'NS_ACCOUNT_ID',
      !consumerKey && 'NS_CONSUMER_KEY',
      !consumerSecret && 'NS_CONSUMER_SECRET',
      !tokenId && 'NS_TOKEN_ID',
      !tokenSecret && 'NS_TOKEN_SECRET',
    ].filter(Boolean).join(', ')
    throw new Error(`NetSuite credentials missing: ${missing}`)
  }
  return { accountId, consumerKey, consumerSecret, tokenId, tokenSecret }
}

function restBaseUrl(creds: Credentials): string {
  const slug = creds.accountId.replace(/_/g, '-').toLowerCase()
  return `https://${slug}.suitetalk.api.netsuite.com/services/rest`
}

function appBaseUrl(creds: Credentials): string {
  const slug = creds.accountId.replace(/_/g, '-').toLowerCase()
  return `https://${slug}.app.netsuite.com`
}

function realm(creds: Credentials): string {
  return creds.accountId.replace(/-/g, '_').toUpperCase()
}

// ---------------------------------------------------------------------------
// OAuth 1.0a signing (per RFC 5849 §3.4.1.3 — query params included in base)
// ---------------------------------------------------------------------------

function rfc3986(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

function buildOAuthHeader(method: string, fullUrl: string, creds: Credentials): string {
  const url = new URL(fullUrl)
  const baseUri = `${url.protocol}//${url.host}${url.pathname}`
  const queryParams: Array<[string, string]> = []
  url.searchParams.forEach((v, k) => queryParams.push([k, v]))

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.tokenId,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_version: '1.0',
  }

  const allEncoded: Array<[string, string]> = [
    ...queryParams,
    ...Object.entries(oauthParams),
  ].map(([k, v]) => [rfc3986(k), rfc3986(v)])

  allEncoded.sort(([k1, v1], [k2, v2]) => {
    if (k1 !== k2) return k1 < k2 ? -1 : 1
    return v1 < v2 ? -1 : v1 > v2 ? 1 : 0
  })
  const paramString = allEncoded.map(([k, v]) => `${k}=${v}`).join('&')
  const baseString = [method.toUpperCase(), rfc3986(baseUri), rfc3986(paramString)].join('&')
  const signingKey = `${rfc3986(creds.consumerSecret)}&${rfc3986(creds.tokenSecret)}`
  const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64')

  const headerParts: Array<[string, string]> = [
    ['realm', realm(creds)],
    ['oauth_consumer_key', oauthParams['oauth_consumer_key']!],
    ['oauth_token', oauthParams['oauth_token']!],
    ['oauth_signature_method', oauthParams['oauth_signature_method']!],
    ['oauth_timestamp', oauthParams['oauth_timestamp']!],
    ['oauth_nonce', oauthParams['oauth_nonce']!],
    ['oauth_version', oauthParams['oauth_version']!],
    ['oauth_signature', signature],
  ]
  return 'OAuth ' + headerParts.map(([k, v]) => `${k}="${rfc3986(v)}"`).join(', ')
}

// ---------------------------------------------------------------------------
// Low-level request helpers
// ---------------------------------------------------------------------------

interface SuiteQlPage<T> {
  links?: unknown
  count?: number
  hasMore?: boolean
  items: T[]
  offset?: number
  totalResults?: number
}

async function suiteql<T = Record<string, unknown>>(query: string): Promise<T[]> {
  const creds = loadCredentials()
  const url = `${restBaseUrl(creds)}/query/v1/suiteql?limit=1000`
  const auth = buildOAuthHeader('POST', url, creds)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Prefer': 'transient',
    },
    body: JSON.stringify({ q: query }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`NetSuite SuiteQL failed (${res.status} ${res.statusText}) for query "${query}" — ${body.substring(0, 500)}`)
  }

  const data = (await res.json()) as SuiteQlPage<T>
  return data.items ?? []
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export interface NsRef { id: string; name?: string; symbol?: string }

const TTL_FAST = 30 * 60 * 1000  // 30 min — categories, currencies, subsidiaries
const TTL_EMP = 60 * 60 * 1000   // 1 hour — per-email employee lookups

export async function getEmployeeByEmail(email: string): Promise<NsRef | null> {
  const key = `emp:${email.toLowerCase()}`
  const hit = getCached<NsRef | null>(key)
  if (hit !== undefined) return hit

  // Escape single quotes for SuiteQL
  const safe = email.replace(/'/g, "''")
  const rows = await suiteql<{ id: string; email: string }>(
    `SELECT id, email FROM employee WHERE LOWER(email) = '${safe.toLowerCase()}' AND isinactive = 'F'`
  )
  const ref = rows[0] ? { id: String(rows[0].id) } : null
  setCached(key, ref, TTL_EMP)
  return ref
}

export async function listSubsidiaries(): Promise<NsRef[]> {
  const key = 'subs:all'
  const hit = getCached<NsRef[]>(key)
  if (hit !== undefined) return hit

  const rows = await suiteql<{ id: string; name: string }>(
    `SELECT id, name FROM subsidiary WHERE isinactive = 'F'`
  )
  const refs = rows.map((r) => ({ id: String(r.id), name: r.name }))
  setCached(key, refs, TTL_FAST)
  return refs
}

export async function getSubsidiaryByName(name: string): Promise<NsRef | null> {
  const all = await listSubsidiaries()
  const lower = name.toLowerCase()
  return all.find((s) => s.name?.toLowerCase() === lower) ?? null
}

export async function listExpenseCategories(): Promise<NsRef[]> {
  const key = 'cats:all'
  const hit = getCached<NsRef[]>(key)
  if (hit !== undefined) return hit

  const rows = await suiteql<{ id: string; name: string }>(
    `SELECT id, name FROM expensecategory WHERE isinactive = 'F' ORDER BY name`
  )
  const refs = rows.map((r) => ({ id: String(r.id), name: r.name }))
  setCached(key, refs, TTL_FAST)
  return refs
}

export async function getExpenseCategoryByName(name: string): Promise<NsRef | null> {
  const all = await listExpenseCategories()
  const lower = name.toLowerCase()
  return all.find((c) => c.name?.toLowerCase() === lower) ?? null
}

export async function listCurrencies(): Promise<NsRef[]> {
  const key = 'cur:all'
  const hit = getCached<NsRef[]>(key)
  if (hit !== undefined) return hit

  const rows = await suiteql<{ id: string; name: string; symbol: string }>(
    `SELECT id, name, symbol FROM currency WHERE isinactive = 'F'`
  )
  const refs = rows.map((r) => ({ id: String(r.id), name: r.name, symbol: r.symbol }))
  setCached(key, refs, TTL_FAST)
  return refs
}

export async function getCurrencyByCode(code: string): Promise<NsRef | null> {
  const all = await listCurrencies()
  const upper = code.toUpperCase()
  return all.find((c) => c.symbol?.toUpperCase() === upper) ?? null
}

// ---------------------------------------------------------------------------
// Create Expense Report
// ---------------------------------------------------------------------------

export interface ExpenseReportLineInput {
  expenseDate: string  // YYYY-MM-DD
  amount: number
  currencyCode: string
  category: string     // category name as known to LMS / NS
  description?: string
}

export interface ExpenseReportInput {
  employeeEmail: string
  subsidiaryName: string
  reportDate: string   // YYYY-MM-DD
  memo: string
  lines: ExpenseReportLineInput[]
  externalId?: string  // optional idempotency key
}

export interface ExpenseReportResult {
  netsuiteId: string
  url: string
}

export interface BuiltPayload {
  payload: Record<string, unknown>
  employeeId: string
  subsidiaryId: string
}

// Resolves all NS internal IDs and returns the request body. Separate from the
// POST so callers can dry-run (build + log) without hitting NS.
export async function buildExpenseReportPayload(input: ExpenseReportInput): Promise<BuiltPayload> {
  if (input.lines.length === 0) throw new Error('At least one line is required')

  const employee = await getEmployeeByEmail(input.employeeEmail)
  if (!employee) {
    throw new Error(`No active NetSuite employee with email "${input.employeeEmail}". Confirm the user's NS employee record uses this email.`)
  }
  const subsidiary = await getSubsidiaryByName(input.subsidiaryName)
  if (!subsidiary) {
    const available = (await listSubsidiaries()).map((s) => s.name).join(', ')
    throw new Error(`No NetSuite subsidiary matching "${input.subsidiaryName}". Available: ${available}`)
  }

  const resolvedItems: Array<Record<string, unknown>> = []
  for (let i = 0; i < input.lines.length; i++) {
    const line = input.lines[i]!
    const cat = await getExpenseCategoryByName(line.category)
    if (!cat) {
      throw new Error(`Line ${i + 1}: NetSuite expense category "${line.category}" not found.`)
    }
    const cur = await getCurrencyByCode(line.currencyCode)
    if (!cur) {
      throw new Error(`Line ${i + 1}: NetSuite currency "${line.currencyCode}" not found.`)
    }
    resolvedItems.push({
      expenseDate: line.expenseDate,
      amount: line.amount,
      category: { id: cat.id },
      currency: { id: cur.id },
      memo: line.description ?? '',
    })
  }

  const headerCurrency = await getCurrencyByCode(input.lines[0]!.currencyCode)
  if (!headerCurrency) {
    throw new Error(`Header currency "${input.lines[0]!.currencyCode}" not found in NetSuite.`)
  }

  const payload: Record<string, unknown> = {
    entity: { id: employee.id },
    subsidiary: { id: subsidiary.id },
    tranDate: input.reportDate,
    memo: input.memo,
    expenseReportCurrency: { id: headerCurrency.id },
    expense: { items: resolvedItems },
  }
  if (input.externalId) payload['externalId'] = input.externalId

  return { payload, employeeId: employee.id, subsidiaryId: subsidiary.id }
}

export async function createExpenseReport(input: ExpenseReportInput): Promise<ExpenseReportResult> {
  const creds = loadCredentials()
  const { payload, employeeId, subsidiaryId } = await buildExpenseReportPayload(input)

  const url = `${restBaseUrl(creds)}/record/v1/expenseReport`
  const auth = buildOAuthHeader('POST', url, creds)

  const lineCount = (payload['expense'] as { items?: unknown[] })?.items?.length ?? 0
  console.log(`[netsuite] POST ${url} — employee=${employeeId} subsidiary=${subsidiaryId} lines=${lineCount}`)

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`NetSuite expenseReport POST failed (${res.status} ${res.statusText}): ${body.substring(0, 1000)}`)
  }

  // NS REST returns 204 No Content + Location header on successful create.
  let netsuiteId: string | null = null
  const location = res.headers.get('location')
  if (location) {
    const m = location.match(/\/(\d+)\/?$/)
    if (m) netsuiteId = m[1]!
  }
  if (!netsuiteId) {
    // Fall back to body if NS configuration returns 201+body instead
    const body = (await res.json().catch(() => null)) as { id?: string | number } | null
    if (body?.id != null) netsuiteId = String(body.id)
  }
  if (!netsuiteId) {
    throw new Error('NetSuite returned success but no record ID could be extracted from the response')
  }

  const recordUrl = `${appBaseUrl(creds)}/app/accounting/transactions/exprpt.nl?id=${netsuiteId}`
  console.log(`[netsuite] Created expenseReport id=${netsuiteId}`)
  return { netsuiteId, url: recordUrl }
}
