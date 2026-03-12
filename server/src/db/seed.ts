import { eq } from 'drizzle-orm'
import { db } from './index'
import {
  regions,
  departments,
  leaveTypes,
  leavePolicies,
  publicHolidays,
  users,
} from './schema'
import { hashPassword } from '../utils/password'

async function seed() {
  console.log('[seed] Starting seed...')

  // ============================================================
  // Regions
  // ============================================================
  console.log('[seed] Inserting regions...')
  const insertedRegions = await db
    .insert(regions)
    .values([
      { name: 'Hong Kong', code: 'HK', timezone: 'Asia/Hong_Kong', currency: 'HKD' },
      { name: 'Singapore', code: 'SG', timezone: 'Asia/Singapore', currency: 'SGD' },
      { name: 'Malaysia', code: 'MY', timezone: 'Asia/Kuala_Lumpur', currency: 'MYR' },
      { name: 'Indonesia', code: 'ID', timezone: 'Asia/Jakarta', currency: 'IDR' },
      { name: 'China', code: 'CN', timezone: 'Asia/Shanghai', currency: 'CNY' },
      { name: 'Australia', code: 'AU', timezone: 'Australia/Sydney', currency: 'AUD' },
      { name: 'New Zealand', code: 'NZ', timezone: 'Pacific/Auckland', currency: 'NZD' },
    ])
    .onConflictDoNothing()
    .returning()

  let allRegions = insertedRegions
  if (allRegions.length === 0) {
    allRegions = await db.select().from(regions)
  }
  const regionMap = Object.fromEntries(allRegions.map((r) => [r.code, r.id]))
  console.log('[seed] Regions available:', Object.keys(regionMap))

  // ============================================================
  // Departments
  // ============================================================
  console.log('[seed] Inserting departments...')
  const deptData = [
    { name: 'Sales & Distribution', regionCode: 'HK' },
    { name: 'Marketing', regionCode: 'HK' },
    { name: 'Operations', regionCode: 'HK' },
    { name: 'Sales & Distribution', regionCode: 'SG' },
    { name: 'Marketing', regionCode: 'SG' },
    { name: 'Operations', regionCode: 'SG' },
    { name: 'Sales & Distribution', regionCode: 'MY' },
    { name: 'Marketing', regionCode: 'MY' },
    { name: 'Sales & Distribution', regionCode: 'ID' },
    { name: 'Marketing', regionCode: 'ID' },
    { name: 'Sales & Distribution', regionCode: 'CN' },
    { name: 'Marketing', regionCode: 'CN' },
    { name: 'Sales & Distribution', regionCode: 'AU' },
    { name: 'Operations', regionCode: 'AU' },
    { name: 'Sales & Distribution', regionCode: 'NZ' },
    { name: 'Finance', regionCode: 'HK' },
    { name: 'Human Resources', regionCode: 'HK' },
    { name: 'Technology', regionCode: 'HK' },
  ]

  await db
    .insert(departments)
    .values(
      deptData
        .filter((d) => regionMap[d.regionCode] !== undefined)
        .map((d) => ({ name: d.name, regionId: regionMap[d.regionCode]! }))
    )
    .onConflictDoNothing()

  // ============================================================
  // Leave Types (global — regionId = null means applies to all)
  // ============================================================
  console.log('[seed] Inserting leave types...')
  const insertedLeaveTypes = await db
    .insert(leaveTypes)
    .values([
      {
        name: 'Annual Leave',
        code: 'AL',
        description: 'Paid annual leave entitlement',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Sick Leave',
        code: 'SL',
        description: 'Medical leave for illness or injury',
        isPaid: true,
        requiresAttachment: false, // attachment required for 2+ consecutive days — enforced in service
        regionId: null,
      },
      {
        name: 'Maternity Leave',
        code: 'ML',
        description: 'Paid leave for the birth or adoption of a child (primary caregiver)',
        isPaid: true,
        requiresAttachment: true,
        regionId: null,
      },
      {
        name: 'Paternity Leave',
        code: 'PL',
        description: 'Paid leave for the birth or adoption of a child (secondary caregiver)',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Compassionate Leave',
        code: 'CL',
        description: 'Leave for bereavement or serious family illness',
        isPaid: true,
        requiresAttachment: false,
        maxDaysPerYear: 5,
        regionId: null,
      },
      {
        name: 'Marriage Leave',
        code: 'MRL',
        description: 'Leave for the employee\'s own wedding',
        isPaid: true,
        requiresAttachment: false,
        maxDaysPerYear: 3,
        regionId: null,
      },
      {
        name: 'Unpaid Leave',
        code: 'UL',
        description: 'Leave without pay',
        isPaid: false,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Child Care Leave',
        code: 'CCL',
        description: 'Government-mandated child care leave',
        isPaid: true,
        requiresAttachment: false,
        maxDaysPerYear: 6,
        regionId: null,
      },
      {
        name: 'Study / Exam Leave',
        code: 'STL',
        description: 'Leave for approved study or examinations',
        isPaid: true,
        requiresAttachment: true,
        maxDaysPerYear: 5,
        regionId: null,
      },
      {
        name: 'Compensatory Leave',
        code: 'COMP_LEAVE',
        description: 'Leave earned via approved overtime (non-AU/NZ)',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Time In Lieu',
        code: 'TIL',
        description: 'Hourly time-off balance earned via approved overtime (AU/NZ)',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Work From Home',
        code: 'WFH',
        description: 'Work from home day — no balance deduction',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      // ── Global new types ──────────────────────────────────────
      {
        name: 'Birthday Leave',
        code: 'BL',
        description: 'One paid day off on or around the employee\'s birthday',
        isPaid: true,
        requiresAttachment: false,
        maxDaysPerYear: 1,
        regionId: null,
      },
      {
        name: 'Business Trip',
        code: 'BT',
        description: 'Approved business travel — no leave balance deduction',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Hospitalisation Leave',
        code: 'HOSP',
        description: 'Extended sick leave requiring hospitalisation (SG & MY)',
        isPaid: true,
        requiresAttachment: true,
        regionId: null,
      },
      {
        name: 'Jury Duty Leave',
        code: 'JDL',
        description: 'Leave for compulsory jury service',
        isPaid: true,
        requiresAttachment: true,
        regionId: null,
      },
      {
        name: 'No Pay Sick Leave',
        code: 'NPSL',
        description: 'Sick leave taken after paid sick leave entitlement is exhausted',
        isPaid: false,
        requiresAttachment: true,
        regionId: null,
      },
      {
        name: 'Full Pay Sick Leave',
        code: 'FPSL',
        description: 'Full pay sick leave (explicit variant used in some regions)',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      {
        name: 'Work Remotely',
        code: 'WR',
        description: 'Working remotely from outside hometown — no balance deduction',
        isPaid: true,
        requiresAttachment: false,
        regionId: null,
      },
      // ── CN-specific types ─────────────────────────────────────
      {
        name: 'Breastfeeding Leave (CN)',
        code: 'BFL_CN',
        description: '1 hour per day breastfeeding break (China statutory, up to 12 months)',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['CN'] ?? null,
      },
      {
        name: 'Care Leave (CN)',
        code: 'CARE_CN',
        description: 'Paid leave to care for an ill immediate family member (China)',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['CN'] ?? null,
      },
      {
        name: 'Compassionate Leave (CN)',
        code: 'CL_CN',
        description: 'Bereavement leave per China statutory requirements',
        isPaid: true,
        requiresAttachment: false,
        maxDaysPerYear: 3,
        regionId: regionMap['CN'] ?? null,
      },
      {
        name: 'Parental Leave (CN)',
        code: 'PARENTAL_CN',
        description: 'Parental leave as mandated by local Chinese regulations',
        isPaid: true,
        requiresAttachment: true,
        regionId: regionMap['CN'] ?? null,
      },
      {
        name: 'Prenatal Examination Leave (CN)',
        code: 'PRENATAL_CN',
        description: 'Paid leave for prenatal medical examinations (China)',
        isPaid: true,
        requiresAttachment: true,
        regionId: regionMap['CN'] ?? null,
      },
      {
        name: 'Special Leave (CN)',
        code: 'SPL_CN',
        description: 'Special leave as granted under Chinese labour regulations',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['CN'] ?? null,
      },
      {
        name: 'Time-off (Medical)',
        code: 'TOMED',
        description: '1.5-hour paid time-off for medical treatment appointments',
        isPaid: true,
        requiresAttachment: true,
        regionId: regionMap['CN'] ?? null,
      },
      // ── ID-specific types ─────────────────────────────────────
      {
        name: 'Family Leave (ID)',
        code: 'FAM_ID',
        description: 'Leave to attend to important family matters (Indonesia)',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['ID'] ?? null,
      },
      // ── SG-specific types ─────────────────────────────────────
      {
        name: 'Reservist Leave (SG)',
        code: 'RSL_SG',
        description: 'NS/reservist training leave — Singapore statutory',
        isPaid: true,
        requiresAttachment: true,
        regionId: regionMap['SG'] ?? null,
      },
      // ── AU-specific types ─────────────────────────────────────
      {
        name: 'Annual Leave (AU)',
        code: 'AL_AU',
        description: 'Annual leave for Australia — Fair Work Act entitlement',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['AU'] ?? null,
      },
      {
        name: 'Full Pay Sick Leave (AU)',
        code: 'FPSL_AU',
        description: 'Personal/carer\'s leave — Australia Fair Work Act',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['AU'] ?? null,
      },
      {
        name: 'Long Service Leave (AU)',
        code: 'LSL_AU',
        description: 'Long service leave after qualifying period — Australia',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['AU'] ?? null,
      },
      {
        name: 'Maternity Leave (AU)',
        code: 'ML_AU',
        description: 'Parental leave for primary caregiver — Australia Fair Work Act',
        isPaid: true,
        requiresAttachment: true,
        regionId: regionMap['AU'] ?? null,
      },
      {
        name: 'No Pay Leave (AU)',
        code: 'NPL_AU',
        description: 'Unpaid leave — Australia',
        isPaid: false,
        requiresAttachment: false,
        regionId: regionMap['AU'] ?? null,
      },
      // ── NZ-specific types ─────────────────────────────────────
      {
        name: 'Annual Leave (NZ)',
        code: 'AL_NZ',
        description: 'Annual leave — New Zealand Holidays Act entitlement',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['NZ'] ?? null,
      },
      {
        name: 'Full Pay Sick Leave (NZ)',
        code: 'FPSL_NZ',
        description: 'Sick leave — New Zealand Holidays Act',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['NZ'] ?? null,
      },
      {
        name: 'Long Service Leave (NZ)',
        code: 'LSL_NZ',
        description: 'Long service leave after qualifying period — New Zealand',
        isPaid: true,
        requiresAttachment: false,
        regionId: regionMap['NZ'] ?? null,
      },
      {
        name: 'Maternity Leave (NZ)',
        code: 'ML_NZ',
        description: 'Parental leave for primary caregiver — New Zealand',
        isPaid: true,
        requiresAttachment: true,
        regionId: regionMap['NZ'] ?? null,
      },
      {
        name: 'No Pay Leave (NZ)',
        code: 'NPL_NZ',
        description: 'Unpaid leave — New Zealand',
        isPaid: false,
        requiresAttachment: false,
        regionId: regionMap['NZ'] ?? null,
      },
    ])
    .onConflictDoNothing()
    .returning()

  let allLeaveTypes = insertedLeaveTypes
  if (allLeaveTypes.length === 0) {
    allLeaveTypes = await db.select().from(leaveTypes)
  }
  const ltMap = Object.fromEntries(allLeaveTypes.map((lt) => [lt.code, lt.id]))
  console.log('[seed] Leave types available:', Object.keys(ltMap))

  // Set approval flows on leave types
  console.log('[seed] Setting approval flows...')
  const approvalFlowUpdates = [
    { code: 'AL', approvalFlow: 'standard', minNoticeDays: 3 },
    { code: 'SL', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'COMP_LEAVE', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'TIL', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'WFH', approvalFlow: 'auto_approve', minNoticeDays: 0 },
    { code: 'ML', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'PL', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'CL', approvalFlow: 'standard', minNoticeDays: 0, maxConsecutiveDays: 5 },
    { code: 'UL', approvalFlow: 'multi_level', minNoticeDays: 0 },
    { code: 'MRL', approvalFlow: 'standard', minNoticeDays: 3 },
    { code: 'CCL', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'STL', approvalFlow: 'standard', minNoticeDays: 3 },
    // New global types
    { code: 'BL', approvalFlow: 'standard', minNoticeDays: 3, maxConsecutiveDays: 1 },
    { code: 'BT', approvalFlow: 'auto_approve', minNoticeDays: 1 },
    { code: 'HOSP', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'JDL', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'NPSL', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'FPSL', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'WR', approvalFlow: 'auto_approve', minNoticeDays: 1 },
    // CN-specific
    { code: 'BFL_CN', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'CARE_CN', approvalFlow: 'standard', minNoticeDays: 0, maxConsecutiveDays: 3 },
    { code: 'CL_CN', approvalFlow: 'standard', minNoticeDays: 0, maxConsecutiveDays: 3 },
    { code: 'PARENTAL_CN', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'PRENATAL_CN', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'SPL_CN', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'TOMED', approvalFlow: 'auto_approve', minNoticeDays: 0 },
    // ID-specific
    { code: 'FAM_ID', approvalFlow: 'standard', minNoticeDays: 0, maxConsecutiveDays: 2 },
    // SG-specific
    { code: 'RSL_SG', approvalFlow: 'hr_required', minNoticeDays: 0 },
    // AU-specific
    { code: 'AL_AU', approvalFlow: 'standard', minNoticeDays: 3 },
    { code: 'FPSL_AU', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'LSL_AU', approvalFlow: 'multi_level', minNoticeDays: 14 },
    { code: 'ML_AU', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'NPL_AU', approvalFlow: 'multi_level', minNoticeDays: 0 },
    // NZ-specific
    { code: 'AL_NZ', approvalFlow: 'standard', minNoticeDays: 3 },
    { code: 'FPSL_NZ', approvalFlow: 'standard', minNoticeDays: 0 },
    { code: 'LSL_NZ', approvalFlow: 'multi_level', minNoticeDays: 14 },
    { code: 'ML_NZ', approvalFlow: 'hr_required', minNoticeDays: 0 },
    { code: 'NPL_NZ', approvalFlow: 'multi_level', minNoticeDays: 0 },
  ] as { code: string; approvalFlow: string; minNoticeDays: number; maxConsecutiveDays?: number }[]
  for (const update of approvalFlowUpdates) {
    const id = ltMap[update.code]
    if (id) {
      await db.update(leaveTypes).set({
        approvalFlow: update.approvalFlow as any,
        minNoticeDays: update.minNoticeDays ?? 0,
        ...(update.maxConsecutiveDays !== undefined ? { maxConsecutiveDays: update.maxConsecutiveDays } : {}),
      }).where(eq(leaveTypes.id, id))
    }
  }

  // ============================================================
  // Leave Policies per Region
  // ============================================================
  console.log('[seed] Inserting leave policies...')

  type PolicyRow = {
    leaveTypeCode: string
    regionCode: string
    entitlementDays: string
    carryOverMax: string
    probationMonths: number
  }

  const policies: PolicyRow[] = [
    // Annual Leave
    { leaveTypeCode: 'AL', regionCode: 'HK', entitlementDays: '7', carryOverMax: '5', probationMonths: 3 },
    { leaveTypeCode: 'AL', regionCode: 'SG', entitlementDays: '7', carryOverMax: '5', probationMonths: 3 },
    { leaveTypeCode: 'AL', regionCode: 'MY', entitlementDays: '8', carryOverMax: '8', probationMonths: 3 },
    { leaveTypeCode: 'AL', regionCode: 'ID', entitlementDays: '12', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'AL', regionCode: 'CN', entitlementDays: '5', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'AL', regionCode: 'AU', entitlementDays: '20', carryOverMax: '20', probationMonths: 0 },
    { leaveTypeCode: 'AL', regionCode: 'NZ', entitlementDays: '20', carryOverMax: '20', probationMonths: 12 },
    // Sick Leave
    { leaveTypeCode: 'SL', regionCode: 'HK', entitlementDays: '14', carryOverMax: '0', probationMonths: 1 },
    { leaveTypeCode: 'SL', regionCode: 'SG', entitlementDays: '14', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'SL', regionCode: 'MY', entitlementDays: '14', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'SL', regionCode: 'ID', entitlementDays: '12', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'SL', regionCode: 'CN', entitlementDays: '12', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'SL', regionCode: 'AU', entitlementDays: '10', carryOverMax: '10', probationMonths: 0 },
    { leaveTypeCode: 'SL', regionCode: 'NZ', entitlementDays: '10', carryOverMax: '20', probationMonths: 0 },
    // Maternity Leave
    { leaveTypeCode: 'ML', regionCode: 'HK', entitlementDays: '84', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'ML', regionCode: 'SG', entitlementDays: '112', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'ML', regionCode: 'MY', entitlementDays: '60', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'ML', regionCode: 'ID', entitlementDays: '90', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'ML', regionCode: 'CN', entitlementDays: '98', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'ML', regionCode: 'AU', entitlementDays: '365', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'ML', regionCode: 'NZ', entitlementDays: '365', carryOverMax: '0', probationMonths: 6 },
    // Paternity Leave
    { leaveTypeCode: 'PL', regionCode: 'HK', entitlementDays: '5', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'PL', regionCode: 'SG', entitlementDays: '14', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'PL', regionCode: 'MY', entitlementDays: '3', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'PL', regionCode: 'ID', entitlementDays: '2', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'PL', regionCode: 'CN', entitlementDays: '15', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'PL', regionCode: 'AU', entitlementDays: '5', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'PL', regionCode: 'NZ', entitlementDays: '10', carryOverMax: '0', probationMonths: 6 },
    // Compassionate Leave
    { leaveTypeCode: 'CL', regionCode: 'HK', entitlementDays: '5', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL', regionCode: 'SG', entitlementDays: '3', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL', regionCode: 'MY', entitlementDays: '3', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL', regionCode: 'ID', entitlementDays: '2', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL', regionCode: 'CN', entitlementDays: '3', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL', regionCode: 'AU', entitlementDays: '5', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL', regionCode: 'NZ', entitlementDays: '3', carryOverMax: '0', probationMonths: 0 },
    // Child Care Leave
    { leaveTypeCode: 'CCL', regionCode: 'SG', entitlementDays: '6', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'CCL', regionCode: 'MY', entitlementDays: '7', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'CCL', regionCode: 'AU', entitlementDays: '5', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'CCL', regionCode: 'NZ', entitlementDays: '5', carryOverMax: '0', probationMonths: 0 },
    // Compensatory Leave (non-AU/NZ only) — entitlement is 0, balance grows via adjustments
    { leaveTypeCode: 'COMP_LEAVE', regionCode: 'HK', entitlementDays: '0', carryOverMax: '5', probationMonths: 0 },
    { leaveTypeCode: 'COMP_LEAVE', regionCode: 'SG', entitlementDays: '0', carryOverMax: '5', probationMonths: 0 },
    { leaveTypeCode: 'COMP_LEAVE', regionCode: 'MY', entitlementDays: '0', carryOverMax: '5', probationMonths: 0 },
    { leaveTypeCode: 'COMP_LEAVE', regionCode: 'ID', entitlementDays: '0', carryOverMax: '5', probationMonths: 0 },
    { leaveTypeCode: 'COMP_LEAVE', regionCode: 'CN', entitlementDays: '0', carryOverMax: '5', probationMonths: 0 },
    // Time In Lieu (AU/NZ only) — stored as fractional days (hours / 8), carryover = 20 days = 160 hours
    { leaveTypeCode: 'TIL', regionCode: 'AU', entitlementDays: '0', carryOverMax: '20', probationMonths: 0 },
    { leaveTypeCode: 'TIL', regionCode: 'NZ', entitlementDays: '0', carryOverMax: '20', probationMonths: 0 },
    // Birthday Leave (1 day, all regions)
    { leaveTypeCode: 'BL', regionCode: 'HK', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'BL', regionCode: 'SG', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'BL', regionCode: 'MY', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'BL', regionCode: 'ID', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'BL', regionCode: 'CN', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'BL', regionCode: 'AU', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'BL', regionCode: 'NZ', entitlementDays: '1', carryOverMax: '0', probationMonths: 6 },
    // Business Trip (no balance deduction, tracked for records)
    { leaveTypeCode: 'BT', regionCode: 'HK', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'BT', regionCode: 'SG', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'BT', regionCode: 'MY', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'BT', regionCode: 'ID', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'BT', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'BT', regionCode: 'AU', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'BT', regionCode: 'NZ', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // Hospitalisation Leave (SG = 60, MY = 60 total including SL, HK/others = 30)
    { leaveTypeCode: 'HOSP', regionCode: 'HK', entitlementDays: '30', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'HOSP', regionCode: 'SG', entitlementDays: '60', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'HOSP', regionCode: 'MY', entitlementDays: '60', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'HOSP', regionCode: 'ID', entitlementDays: '30', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'HOSP', regionCode: 'CN', entitlementDays: '30', carryOverMax: '0', probationMonths: 0 },
    // Jury Duty Leave (as needed, all regions — tracked as used)
    { leaveTypeCode: 'JDL', regionCode: 'HK', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'JDL', regionCode: 'SG', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'JDL', regionCode: 'AU', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'JDL', regionCode: 'NZ', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // No Pay Sick Leave (0 entitlement — taken after SL exhausted)
    { leaveTypeCode: 'NPSL', regionCode: 'HK', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'NPSL', regionCode: 'SG', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'NPSL', regionCode: 'MY', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'NPSL', regionCode: 'ID', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'NPSL', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // Full Pay Sick Leave (global variant, for regions that explicitly use this code)
    { leaveTypeCode: 'FPSL', regionCode: 'HK', entitlementDays: '14', carryOverMax: '0', probationMonths: 1 },
    { leaveTypeCode: 'FPSL', regionCode: 'SG', entitlementDays: '14', carryOverMax: '0', probationMonths: 3 },
    { leaveTypeCode: 'FPSL', regionCode: 'MY', entitlementDays: '14', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'FPSL', regionCode: 'ID', entitlementDays: '12', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'FPSL', regionCode: 'CN', entitlementDays: '12', carryOverMax: '0', probationMonths: 0 },
    // Work Remotely (no balance deduction, tracked for records)
    { leaveTypeCode: 'WR', regionCode: 'HK', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'WR', regionCode: 'SG', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'WR', regionCode: 'MY', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'WR', regionCode: 'ID', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'WR', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'WR', regionCode: 'AU', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'WR', regionCode: 'NZ', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // CN-specific leave policies
    { leaveTypeCode: 'BFL_CN', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CARE_CN', regionCode: 'CN', entitlementDays: '3', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'CL_CN', regionCode: 'CN', entitlementDays: '3', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'PARENTAL_CN', regionCode: 'CN', entitlementDays: '30', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'PRENATAL_CN', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'SPL_CN', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    { leaveTypeCode: 'TOMED', regionCode: 'CN', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // ID-specific
    { leaveTypeCode: 'FAM_ID', regionCode: 'ID', entitlementDays: '2', carryOverMax: '0', probationMonths: 0 },
    // SG-specific
    { leaveTypeCode: 'RSL_SG', regionCode: 'SG', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // AU-specific leave policies
    { leaveTypeCode: 'AL_AU', regionCode: 'AU', entitlementDays: '20', carryOverMax: '20', probationMonths: 0 },
    { leaveTypeCode: 'FPSL_AU', regionCode: 'AU', entitlementDays: '10', carryOverMax: '10', probationMonths: 0 },
    { leaveTypeCode: 'LSL_AU', regionCode: 'AU', entitlementDays: '33', carryOverMax: '0', probationMonths: 84 },
    { leaveTypeCode: 'ML_AU', regionCode: 'AU', entitlementDays: '365', carryOverMax: '0', probationMonths: 12 },
    { leaveTypeCode: 'NPL_AU', regionCode: 'AU', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
    // NZ-specific leave policies
    { leaveTypeCode: 'AL_NZ', regionCode: 'NZ', entitlementDays: '20', carryOverMax: '20', probationMonths: 12 },
    { leaveTypeCode: 'FPSL_NZ', regionCode: 'NZ', entitlementDays: '10', carryOverMax: '20', probationMonths: 0 },
    { leaveTypeCode: 'LSL_NZ', regionCode: 'NZ', entitlementDays: '65', carryOverMax: '0', probationMonths: 120 },
    { leaveTypeCode: 'ML_NZ', regionCode: 'NZ', entitlementDays: '365', carryOverMax: '0', probationMonths: 6 },
    { leaveTypeCode: 'NPL_NZ', regionCode: 'NZ', entitlementDays: '0', carryOverMax: '0', probationMonths: 0 },
  ]

  const policyRows = policies
    .filter((p) => ltMap[p.leaveTypeCode] !== undefined && regionMap[p.regionCode] !== undefined)
    .map((p) => ({
      leaveTypeId: ltMap[p.leaveTypeCode]!,
      regionId: regionMap[p.regionCode]!,
      entitlementDays: p.entitlementDays,
      carryOverMax: p.carryOverMax,
      probationMonths: p.probationMonths,
    }))

  await db.insert(leavePolicies).values(policyRows).onConflictDoNothing()
  console.log('[seed] Leave policies inserted:', policyRows.length)

  // ============================================================
  // Public Holidays 2026
  // ============================================================
  console.log('[seed] Inserting 2026 public holidays...')

  type HolidayRow = { name: string; date: string; regionCode: string }

  const holidayData: HolidayRow[] = [
    // Hong Kong
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'HK' },
    { name: 'Lunar New Year Day 1', date: '2026-01-29', regionCode: 'HK' },
    { name: 'Lunar New Year Day 2', date: '2026-01-30', regionCode: 'HK' },
    { name: 'Lunar New Year Day 3', date: '2026-01-31', regionCode: 'HK' },
    { name: 'Ching Ming Festival', date: '2026-04-05', regionCode: 'HK' },
    { name: 'Good Friday', date: '2026-04-03', regionCode: 'HK' },
    { name: 'Day After Good Friday', date: '2026-04-04', regionCode: 'HK' },
    { name: 'Easter Monday', date: '2026-04-06', regionCode: 'HK' },
    { name: "Labour Day", date: '2026-05-01', regionCode: 'HK' },
    { name: "Buddha's Birthday", date: '2026-05-24', regionCode: 'HK' },
    { name: 'Dragon Boat Festival', date: '2026-06-19', regionCode: 'HK' },
    { name: 'HK SAR Establishment Day', date: '2026-07-01', regionCode: 'HK' },
    { name: 'Day After Mid-Autumn Festival', date: '2026-09-26', regionCode: 'HK' },
    { name: 'National Day', date: '2026-10-01', regionCode: 'HK' },
    { name: 'Chung Yeung Festival', date: '2026-10-11', regionCode: 'HK' },
    { name: 'Christmas Day', date: '2026-12-25', regionCode: 'HK' },
    { name: 'Boxing Day', date: '2026-12-26', regionCode: 'HK' },

    // Singapore
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'SG' },
    { name: 'Lunar New Year Day 1', date: '2026-01-29', regionCode: 'SG' },
    { name: 'Lunar New Year Day 2', date: '2026-01-30', regionCode: 'SG' },
    { name: 'Good Friday', date: '2026-04-03', regionCode: 'SG' },
    { name: 'Labour Day', date: '2026-05-01', regionCode: 'SG' },
    { name: 'Vesak Day', date: '2026-05-24', regionCode: 'SG' },
    { name: 'Hari Raya Puasa', date: '2026-03-30', regionCode: 'SG' },
    { name: 'Hari Raya Haji', date: '2026-06-07', regionCode: 'SG' },
    { name: 'National Day', date: '2026-08-09', regionCode: 'SG' },
    { name: 'Deepavali', date: '2026-11-08', regionCode: 'SG' },
    { name: 'Christmas Day', date: '2026-12-25', regionCode: 'SG' },

    // Malaysia
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'MY' },
    { name: 'Federal Territory Day', date: '2026-02-01', regionCode: 'MY' },
    { name: 'Thaipusam', date: '2026-02-11', regionCode: 'MY' },
    { name: 'Lunar New Year Day 1', date: '2026-01-29', regionCode: 'MY' },
    { name: 'Lunar New Year Day 2', date: '2026-01-30', regionCode: 'MY' },
    { name: 'Hari Raya Puasa Day 1', date: '2026-03-30', regionCode: 'MY' },
    { name: 'Hari Raya Puasa Day 2', date: '2026-03-31', regionCode: 'MY' },
    { name: 'Labour Day', date: '2026-05-01', regionCode: 'MY' },
    { name: 'Vesak Day', date: '2026-05-24', regionCode: 'MY' },
    { name: "Yang di-Pertuan Agong's Birthday", date: '2026-06-01', regionCode: 'MY' },
    { name: 'Hari Raya Haji', date: '2026-06-07', regionCode: 'MY' },
    { name: 'Muharram', date: '2026-06-27', regionCode: 'MY' },
    { name: 'National Day', date: '2026-08-31', regionCode: 'MY' },
    { name: 'Malaysia Day', date: '2026-09-16', regionCode: 'MY' },
    { name: "Prophet Muhammad's Birthday", date: '2026-09-06', regionCode: 'MY' },
    { name: 'Deepavali', date: '2026-11-08', regionCode: 'MY' },
    { name: 'Christmas Day', date: '2026-12-25', regionCode: 'MY' },

    // Indonesia
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'ID' },
    { name: 'Lunar New Year', date: '2026-01-29', regionCode: 'ID' },
    { name: 'Isra Mi\'raj', date: '2026-02-18', regionCode: 'ID' },
    { name: 'Nyepi (Hindu New Year)', date: '2026-03-20', regionCode: 'ID' },
    { name: 'Good Friday', date: '2026-04-03', regionCode: 'ID' },
    { name: 'Hari Raya Idul Fitri Day 1', date: '2026-03-30', regionCode: 'ID' },
    { name: 'Hari Raya Idul Fitri Day 2', date: '2026-03-31', regionCode: 'ID' },
    { name: 'Labour Day', date: '2026-05-01', regionCode: 'ID' },
    { name: 'Ascension of Jesus Christ', date: '2026-05-14', regionCode: 'ID' },
    { name: 'Vesak Day', date: '2026-05-24', regionCode: 'ID' },
    { name: 'Pancasila Day', date: '2026-06-01', regionCode: 'ID' },
    { name: 'Hari Raya Idul Adha', date: '2026-06-07', regionCode: 'ID' },
    { name: 'Islamic New Year', date: '2026-06-27', regionCode: 'ID' },
    { name: 'Independence Day', date: '2026-08-17', regionCode: 'ID' },
    { name: "Prophet Muhammad's Birthday", date: '2026-09-06', regionCode: 'ID' },
    { name: 'Christmas Day', date: '2026-12-25', regionCode: 'ID' },

    // China
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'CN' },
    { name: 'Spring Festival Day 1', date: '2026-01-29', regionCode: 'CN' },
    { name: 'Spring Festival Day 2', date: '2026-01-30', regionCode: 'CN' },
    { name: 'Spring Festival Day 3', date: '2026-01-31', regionCode: 'CN' },
    { name: 'Spring Festival Day 4', date: '2026-02-01', regionCode: 'CN' },
    { name: 'Spring Festival Day 5', date: '2026-02-02', regionCode: 'CN' },
    { name: 'Qingming Festival', date: '2026-04-05', regionCode: 'CN' },
    { name: 'Labour Day', date: '2026-05-01', regionCode: 'CN' },
    { name: 'Labour Day Holiday', date: '2026-05-02', regionCode: 'CN' },
    { name: 'Labour Day Holiday', date: '2026-05-03', regionCode: 'CN' },
    { name: 'Dragon Boat Festival', date: '2026-06-19', regionCode: 'CN' },
    { name: 'Mid-Autumn Festival', date: '2026-09-26', regionCode: 'CN' },
    { name: 'National Day', date: '2026-10-01', regionCode: 'CN' },
    { name: 'National Day Holiday', date: '2026-10-02', regionCode: 'CN' },
    { name: 'National Day Holiday', date: '2026-10-03', regionCode: 'CN' },
    { name: 'National Day Holiday', date: '2026-10-04', regionCode: 'CN' },
    { name: 'National Day Holiday', date: '2026-10-05', regionCode: 'CN' },
    { name: 'National Day Holiday', date: '2026-10-06', regionCode: 'CN' },
    { name: 'National Day Holiday', date: '2026-10-07', regionCode: 'CN' },

    // Australia (national holidays — state holidays handled separately)
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'AU' },
    { name: 'Australia Day', date: '2026-01-26', regionCode: 'AU' },
    { name: 'Good Friday', date: '2026-04-03', regionCode: 'AU' },
    { name: 'Easter Saturday', date: '2026-04-04', regionCode: 'AU' },
    { name: 'Easter Sunday', date: '2026-04-05', regionCode: 'AU' },
    { name: 'Easter Monday', date: '2026-04-06', regionCode: 'AU' },
    { name: 'ANZAC Day', date: '2026-04-25', regionCode: 'AU' },
    { name: "King's Birthday", date: '2026-06-08', regionCode: 'AU' },
    { name: 'Christmas Day', date: '2026-12-25', regionCode: 'AU' },
    { name: 'Boxing Day', date: '2026-12-26', regionCode: 'AU' },

    // New Zealand
    { name: "New Year's Day", date: '2026-01-01', regionCode: 'NZ' },
    { name: "New Year's Day (observed)", date: '2026-01-02', regionCode: 'NZ' },
    { name: 'Waitangi Day', date: '2026-02-06', regionCode: 'NZ' },
    { name: 'Good Friday', date: '2026-04-03', regionCode: 'NZ' },
    { name: 'Easter Monday', date: '2026-04-06', regionCode: 'NZ' },
    { name: 'ANZAC Day', date: '2026-04-25', regionCode: 'NZ' },
    { name: "King's Birthday", date: '2026-06-01', regionCode: 'NZ' },
    { name: 'Matariki', date: '2026-06-26', regionCode: 'NZ' },
    { name: 'Labour Day', date: '2026-10-26', regionCode: 'NZ' },
    { name: 'Christmas Day', date: '2026-12-25', regionCode: 'NZ' },
    { name: 'Boxing Day', date: '2026-12-26', regionCode: 'NZ' },
  ]

  const holidayRows = holidayData
    .filter((h) => regionMap[h.regionCode] !== undefined)
    .map((h) => ({
      name: h.name,
      date: h.date,
      regionId: regionMap[h.regionCode]!,
      isRecurring: false,
    }))

  await db.insert(publicHolidays).values(holidayRows).onConflictDoNothing()
  console.log('[seed] Public holidays inserted:', holidayRows.length)

  // ============================================================
  // Default Super Admin User
  // ============================================================
  console.log('[seed] Creating default super admin...')
  const hkRegionId = regionMap['HK']
  if (hkRegionId) {
    const adminPassword = await hashPassword('Admin@BloomGrow2026!')
    await db
      .insert(users)
      .values({
        email: 'admin@bloomandgrowgroup.com',
        passwordHash: adminPassword,
        name: 'System Administrator',
        role: 'super_admin',
        regionId: hkRegionId,
        isActive: true,
      })
      .onConflictDoNothing()
    console.log('[seed] Super admin created: admin@bloomandgrowgroup.com')
    console.log('[seed] Default password: Admin@BloomGrow2026! (CHANGE THIS IMMEDIATELY)')
  }

  console.log('[seed] Seed complete!')
  process.exit(0)
}

seed().catch((err) => {
  console.error('[seed] Error:', err)
  process.exit(1)
})
