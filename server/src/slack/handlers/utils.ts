import type { CompensationRequest } from '../google-sheets'

// HR contact email mapping based on subsidiary
// HK, BBC, SG, MY, AU, NZ: HR is Elaine Chung
// CN: HR is Michelle Su
// ID: HR is Rina Juwita
export const HR_CONTACT_EMAILS: Record<string, string> = {
  CN: 'michelle.su@bloomandgrow.com.cn',
  ID: 'rina.juwita@bloomandgrowgroup.com',
  HK: 'elaine@bloomandgrowgroup.com',
  BBC: 'elaine@bloomandgrowgroup.com',
  SG: 'elaine@bloomandgrowgroup.com',
  MY: 'elaine@bloomandgrowgroup.com',
  AU: 'elaine@bloomandgrowgroup.com',
  NZ: 'elaine@bloomandgrowgroup.com',
}

export const HR_CONTACT_NAMES: Record<string, string> = {
  CN: 'Michelle',
  ID: 'Rina',
  HK: 'Elaine',
  BBC: 'Elaine',
  SG: 'Elaine',
  MY: 'Elaine',
  AU: 'Elaine',
  NZ: 'Elaine',
}

// Additional AU/NZ HR contact - June receives notifications alongside Elaine for AU/NZ
export const AUNZ_HR_EMAIL = 'june@bloomandgrowgroup.com'
export const AUNZ_HR_NAME = 'June'

export const HR_NOTIFICATION_EMAIL = 'elaine@bloomandgrowgroup.com'
export const HR_NOTIFICATION_NAME = 'Elaine'

export function formatCompType(compensationType: string): string {
  if (compensationType === 'TimeInLieu') return 'Time In Lieu'
  return compensationType // Cash, Leave already readable
}

export function getRegionDisplayName(code: string): string {
  const names: Record<string, string> = {
    HK: 'Hong Kong',
    SG: 'Singapore',
    MY: 'Malaysia',
    ID: 'Indonesia',
    CN: 'China',
    AU: 'Australia',
    NZ: 'New Zealand',
  }
  return names[code] ?? code
}

export function isAUNZRegion(code: string): boolean {
  return code === 'AU' || code === 'NZ'
}

export function getHrRecipientsForSubsidiary(subsidiary: string): Array<{ email: string; name: string }> {
  const primary = {
    email: HR_CONTACT_EMAILS[subsidiary] ?? HR_NOTIFICATION_EMAIL,
    name: HR_CONTACT_NAMES[subsidiary] ?? HR_NOTIFICATION_NAME,
  }
  const isAUNZ = isAUNZRegion(subsidiary)
  return isAUNZ
    ? [primary, { email: AUNZ_HR_EMAIL, name: AUNZ_HR_NAME }]
    : [primary]
}

/**
 * Look up a Slack user by email address.
 * Returns the Slack user object or null if not found.
 */
export async function lookupSlackUserByEmail(client: any, email: string) {
  try {
    const result = await client.users.lookupByEmail({ email })
    return result.user ?? null
  } catch {
    return null
  }
}

/**
 * Send a DM to a Slack user by email address.
 * Silently ignores errors (e.g., user not found).
 */
export async function dmUserByEmail(
  client: any,
  email: string,
  text: string,
  blocks?: any[]
): Promise<string | null> {
  try {
    const slackUser = await lookupSlackUserByEmail(client, email)
    if (!slackUser?.id) return null
    const result = await client.chat.postMessage({
      channel: slackUser.id,
      text,
      ...(blocks ? { blocks } : {}),
    })
    return (result as any).ts ?? null
  } catch (err) {
    console.error('[utils] Error sending DM to', email, err)
    return null
  }
}

/**
 * Format the quantity display string for a comp request.
 */
export function formatQuantity(request: CompensationRequest): string {
  if (request.compensationType === 'TimeInLieu') {
    return `${request.timeInLieuHours ?? 0} hours`
  }
  return `${request.leaveDays ?? 0} days`
}
