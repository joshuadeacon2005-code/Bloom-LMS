/**
 * Date utilities for leave calculations.
 * All dates are treated as UTC to avoid timezone drift across regions.
 */

export function parseDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day!))
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]!
}

export function getTodayString(): string {
  return formatDate(new Date())
}

/**
 * Count working days between two dates (inclusive), excluding weekends and provided holidays.
 */
export function calculateWorkingDays(
  startDate: string,
  endDate: string,
  holidays: Set<string>
): number {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (start > end) return 0

  let count = 0
  const current = new Date(start)

  while (current <= end) {
    const dayOfWeek = current.getUTCDay() // 0=Sun, 6=Sat
    const dateStr = formatDate(current)
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidays.has(dateStr)) {
      count++
    }
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return count
}

/**
 * Return all calendar dates in [startDate, endDate] as YYYY-MM-DD strings.
 */
export function getDateRange(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  const current = new Date(start)

  while (current <= end) {
    dates.push(formatDate(current))
    current.setUTCDate(current.getUTCDate() + 1)
  }

  return dates
}

/**
 * How many full months between two dates (floor).
 */
export function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth())
}

/**
 * Parse a Drizzle numeric column (returned as string) to a float.
 */
export function parseDecimal(value: string | null | undefined): number {
  return parseFloat(value ?? '0') || 0
}
