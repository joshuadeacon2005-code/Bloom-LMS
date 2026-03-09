/**
 * Google Calendar sync service.
 *
 * Uses the same service account as the Google Sheets integration.
 * The service account must be granted "Make changes to events" access
 * on the shared team calendar (GOOGLE_CALENDAR_ID env var).
 *
 * Events are created when leave is fully approved and deleted when
 * leave is cancelled or rejected.
 */

import { google } from 'googleapis'

let calendarClient: ReturnType<typeof google.calendar> | null = null

async function getCalendarClient() {
  if (calendarClient) return calendarClient

  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not set — cannot sync to Google Calendar')
  }

  let credentials: object
  try {
    credentials = JSON.parse(serviceAccountKey)
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY must be valid JSON')
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  })

  calendarClient = google.calendar({ version: 'v3', auth })
  console.log('[calendar] Google Calendar client initialised with service account')
  return calendarClient
}

function getCalendarId(): string {
  const id = process.env.GOOGLE_CALENDAR_ID
  if (!id) throw new Error('GOOGLE_CALENDAR_ID is not set')
  return id
}

// ── Public API ────────────────────────────────────────────────

/**
 * Create a calendar event for an approved leave request.
 * Returns the Google event ID so it can be stored on the leave request.
 */
export async function createLeaveEvent(params: {
  employeeName: string
  leaveTypeName: string
  startDate: string   // YYYY-MM-DD
  endDate: string     // YYYY-MM-DD
  totalDays: number
  reason?: string | null
}): Promise<string | null> {
  try {
    const cal = await getCalendarClient()
    const calendarId = getCalendarId()

    const summary = `${params.employeeName} — ${params.leaveTypeName}`
    const description = [
      `Duration: ${params.totalDays} day(s)`,
      params.reason ? `Reason: ${params.reason}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    // Google Calendar all-day events: endDate is exclusive, so add one day
    const endDateExclusive = addOneDay(params.endDate)

    const response = await cal.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
        start: { date: params.startDate },
        end: { date: endDateExclusive },
        transparency: 'transparent', // show as "free" so it doesn't block others
        status: 'confirmed',
      },
    })

    const eventId = response.data.id ?? null
    if (eventId) {
      console.log(`[calendar] Created event ${eventId} for ${params.employeeName} (${params.startDate}–${params.endDate})`)
    }
    return eventId
  } catch (err) {
    // Non-fatal — log and continue. Leave is approved regardless of calendar sync.
    console.error('[calendar] Failed to create event:', (err as Error).message)
    return null
  }
}

/**
 * Delete a calendar event when leave is cancelled or rejected.
 */
export async function deleteLeaveEvent(googleEventId: string): Promise<void> {
  try {
    const cal = await getCalendarClient()
    const calendarId = getCalendarId()

    await cal.events.delete({ calendarId, eventId: googleEventId })
    console.log(`[calendar] Deleted event ${googleEventId}`)
  } catch (err: unknown) {
    // 404 means already deleted — not an error
    const status = (err as { code?: number })?.code
    if (status !== 404 && status !== 410) {
      console.error('[calendar] Failed to delete event:', (err as Error).message)
    }
  }
}

/**
 * Update a calendar event (e.g. if dates were adjusted before approval).
 */
export async function updateLeaveEvent(
  googleEventId: string,
  params: {
    employeeName: string
    leaveTypeName: string
    startDate: string
    endDate: string
    totalDays: number
    reason?: string | null
  }
): Promise<void> {
  try {
    const cal = await getCalendarClient()
    const calendarId = getCalendarId()

    const summary = `${params.employeeName} — ${params.leaveTypeName}`
    const description = [
      `Duration: ${params.totalDays} day(s)`,
      params.reason ? `Reason: ${params.reason}` : null,
    ]
      .filter(Boolean)
      .join('\n')

    await cal.events.patch({
      calendarId,
      eventId: googleEventId,
      requestBody: {
        summary,
        description,
        start: { date: params.startDate },
        end: { date: addOneDay(params.endDate) },
      },
    })
    console.log(`[calendar] Updated event ${googleEventId}`)
  } catch (err) {
    console.error('[calendar] Failed to update event:', (err as Error).message)
  }
}

// ── Helpers ───────────────────────────────────────────────────

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
