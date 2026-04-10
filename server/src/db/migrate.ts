import pg from 'pg'

export async function runMigrations(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL
  if (!dbUrl) {
    console.error('[migrate] DATABASE_URL not set, skipping')
    return
  }

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  try {
    console.log('[migrate] Running schema migrations...')

    await client.query(`ALTER TYPE leave_status ADD VALUE IF NOT EXISTS 'pending_hr'`)

    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS approval_flow varchar(30) NOT NULL DEFAULT 'standard'
    `)

    // min_notice_days was removed from the system (Phase 6 drop, see below).
    // Use DROP instead of ADD so restarts after Phase 6 don't re-create it.
    await client.query(`ALTER TABLE leave_types DROP COLUMN IF EXISTS min_notice_days`)

    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS max_consecutive_days integer
    `)

    // approval_step and current_approver_id — required for multi-level approval flow.
    // These were added to schema.ts but never added to the production migration.
    await client.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS approval_step integer NOT NULL DEFAULT 1
    `)
    await client.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS current_approver_id integer REFERENCES users(id)
    `)

    // approval_status enum and approval_workflows table — used by the approval chain.
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'delegated');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_workflows (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        leave_request_id integer NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
        approver_id integer NOT NULL REFERENCES users(id),
        level integer NOT NULL DEFAULT 1,
        status approval_status NOT NULL DEFAULT 'pending',
        comments text,
        action_date timestamptz,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS approval_workflows_request_id_idx ON approval_workflows(leave_request_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS approval_workflows_approver_id_idx ON approval_workflows(approver_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS approval_workflows_status_idx ON approval_workflows(status)`)

    await client.query(`
      DO $$ BEGIN
        CREATE TYPE overtime_status AS ENUM ('pending','approved','rejected','cancelled');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS overtime_entries (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id integer NOT NULL REFERENCES users(id),
        date date NOT NULL,
        hours_worked numeric(5,2) NOT NULL,
        days_requested numeric(4,2) NOT NULL DEFAULT 1.0,
        reason text NOT NULL,
        status overtime_status NOT NULL DEFAULT 'pending',
        approved_by_id integer REFERENCES users(id),
        approved_at timestamptz,
        rejection_reason text,
        evidence_url text,
        approved_days numeric(4,2),
        manager_comment text,
        comp_leave_request_id integer REFERENCES leave_requests(id),
        region_id integer NOT NULL REFERENCES regions(id),
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS comp_leave_rules (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        region_id integer NOT NULL UNIQUE REFERENCES regions(id),
        hours_per_day numeric(5,2) NOT NULL DEFAULT 8,
        max_accumulation_days numeric(5,1) NOT NULL DEFAULT 5,
        expiry_days integer,
        requires_approval boolean NOT NULL DEFAULT true,
        min_hours_per_entry numeric(5,2) NOT NULL DEFAULT 1,
        max_hours_per_entry numeric(5,2) NOT NULL DEFAULT 12,
        created_at timestamptz DEFAULT now(),
        updated_at timestamptz DEFAULT now()
      )
    `)

    await client.query(`CREATE INDEX IF NOT EXISTS overtime_entries_user_id_idx ON overtime_entries(user_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS overtime_entries_date_idx ON overtime_entries(date)`)
    await client.query(`CREATE INDEX IF NOT EXISTS overtime_entries_status_idx ON overtime_entries(status)`)
    await client.query(`CREATE INDEX IF NOT EXISTS overtime_entries_region_id_idx ON overtime_entries(region_id)`)

    // Add new leave types introduced in March 2026 seed update (safe — skips if code already exists)
    const newLeaveTypes = [
      { code: 'NPL',          name: 'No Pay Leave',                    description: 'Unpaid leave approved by HR',                                                               isPaid: false, requiresAttachment: false, approvalFlow: 'multi_level',  minNoticeDays: 0, regionId: null },
      { code: 'WFH',          name: 'Work From Home',                  description: 'Work from home day — no balance deduction',                                                 isPaid: true,  requiresAttachment: false, approvalFlow: 'auto_approve', minNoticeDays: 0, regionId: null },
      { code: 'BT',           name: 'Business Trip',                   description: 'Approved business travel — no leave balance deduction',                                     isPaid: true,  requiresAttachment: false, approvalFlow: 'auto_approve', minNoticeDays: 1, regionId: null },
      // FPSL removed — replaced by SL (Full Paid Sick Leave) + SL_CN (Sick Leave) in Phase 11
      { code: 'WR',           name: 'Work Remotely',                   description: 'Working remotely from outside hometown — no balance deduction',                             isPaid: true,  requiresAttachment: false, approvalFlow: 'auto_approve', minNoticeDays: 1, regionId: null },
      { code: 'BFL_CN',       name: 'Breastfeeding Leave (CN)',        description: '1 hour per day breastfeeding break (China statutory, up to 12 months)',                    isPaid: true,  requiresAttachment: false, approvalFlow: 'hr_required',  minNoticeDays: 0, regionCode: 'CN'  },
      { code: 'RSL_SG',       name: 'Reservist Leave (SG)',            description: 'NS/reservist training leave — Singapore statutory',                                         isPaid: true,  requiresAttachment: true,  approvalFlow: 'hr_required',  minNoticeDays: 0, regionCode: 'SG'  },
      
    ]
    let newTypeCount = 0
    for (const lt of newLeaveTypes) {
      const regionId = 'regionCode' in lt && lt.regionCode
        ? (await client.query(`SELECT id FROM regions WHERE code = $1 LIMIT 1`, [lt.regionCode])).rows[0]?.id ?? null
        : (lt as any).regionId ?? null
      const res = await client.query(
        `INSERT INTO leave_types (name, code, description, is_paid, requires_attachment, approval_flow, region_id)
         SELECT $1::varchar,$2::varchar,$3::text,$4::boolean,$5::boolean,$6::varchar,$7
         WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE code = $2::varchar)`,
        [lt.name, lt.code, lt.description, lt.isPaid, lt.requiresAttachment, lt.approvalFlow, regionId]
      )
      if (res.rowCount) newTypeCount++
    }
    if (newTypeCount > 0) console.log(`[migrate] Added ${newTypeCount} new leave types`)

    // Add leave policies for the new types — look up region IDs by code to be DB-agnostic
    const newPolicies: Array<{ ltCode: string; rCode: string; entitlementDays: number; carryOverMax: number; probationMonths: number }> = [
      { ltCode: 'NPL',         rCode: 'HK', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'NPL',         rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'NPL',         rCode: 'MY', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'NPL',         rCode: 'ID', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'NPL',         rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'HK', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'MY', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'ID', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'AU', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BT',          rCode: 'NZ', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      // FPSL policies removed — replaced by SL + SL_CN in Phase 11
      { ltCode: 'WR',          rCode: 'HK', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'MY', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'ID', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'AU', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'NZ', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BFL_CN',      rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'RSL_SG',      rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
    ]
    let newPolicyCount = 0
    for (const p of newPolicies) {
      const res = await client.query(
        `INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
         SELECT lt.id, r.id, $3::numeric, $4::numeric, $5::int
         FROM leave_types lt
         JOIN regions r ON r.code = $2::varchar
         WHERE lt.code = $1::varchar
           AND NOT EXISTS (
             SELECT 1 FROM leave_policies lp2
             JOIN leave_types lt2 ON lt2.id = lp2.leave_type_id
             JOIN regions r2 ON r2.id = lp2.region_id
             WHERE lt2.code = $1::varchar AND r2.code = $2::varchar
           )
         LIMIT 1`,
        [p.ltCode, p.rCode, p.entitlementDays, p.carryOverMax, p.probationMonths]
      )
      if (res.rowCount) newPolicyCount++
    }
    if (newPolicyCount > 0) console.log(`[migrate] Added ${newPolicyCount} new leave policies`)

    // One-time data fix: reset all non-Josh accounts from Welcome2026! hash to BloomLeave hash
    const OLD_HASH = '$2a$10$AG1n.L8fwtbiJujEpKyunOn817/TSTyP6vp9Os.mfGYsSzI5bkBL6'
    const NEW_HASH = '$2a$10$n7QA/1MdmOB5AvXoe9wbieoxNNvdbbzUPJGA3YkwFKA/UWU7VHERi'
    const resetResult = await client.query(
      `UPDATE users SET password_hash = $1 WHERE password_hash = $2 AND email != 'josh@bloomandgrowgroup.com'`,
      [NEW_HASH, OLD_HASH]
    )
    if (resetResult.rowCount && resetResult.rowCount > 0) {
      console.log(`[migrate] Reset ${resetResult.rowCount} account passwords to BloomLeave`)
    }

    // Add compensation_type to overtime_entries
    await client.query(`
      ALTER TABLE overtime_entries
      ADD COLUMN IF NOT EXISTS compensation_type varchar(20) NOT NULL DEFAULT 'time_off'
    `)

    // Add pending_hr and converted values to overtime_status enum
    await client.query(`ALTER TYPE overtime_status ADD VALUE IF NOT EXISTS 'pending_hr'`)
    await client.query(`ALTER TYPE overtime_status ADD VALUE IF NOT EXISTS 'converted'`)

    // Add HR approval columns to overtime_entries
    await client.query(`
      ALTER TABLE overtime_entries
      ADD COLUMN IF NOT EXISTS hr_approved_by_id integer REFERENCES users(id)
    `)
    await client.query(`
      ALTER TABLE overtime_entries
      ADD COLUMN IF NOT EXISTS hr_approved_at timestamptz
    `)

    // Deduplicate leave types: the seed ran multiple times creating duplicate codes.
    // Keep the MAX id per code (requests live on highest IDs); delete the rest.
    const dupResult = await client.query(`
      WITH keeper AS (
        SELECT MAX(id) AS id FROM leave_types GROUP BY code HAVING COUNT(*) > 1
      ),
      to_delete AS (
        SELECT lt.id FROM leave_types lt
        WHERE lt.code IN (
          SELECT code FROM leave_types GROUP BY code HAVING COUNT(*) > 1
        )
        AND lt.id NOT IN (SELECT id FROM keeper)
      )
      SELECT COUNT(*) AS cnt FROM to_delete
    `)
    const dupCount = parseInt(dupResult.rows[0]?.cnt ?? '0', 10)
    if (dupCount > 0) {
      // Step 1: Reassign leave_requests from dup IDs → canonical (MAX) ID per code
      await client.query(`
        UPDATE leave_requests lr
        SET leave_type_id = canonical.max_id
        FROM (
          SELECT code, MAX(id) AS max_id FROM leave_types GROUP BY code HAVING COUNT(*) > 1
        ) canonical
        JOIN leave_types lt ON lt.code = canonical.code AND lt.id != canonical.max_id
        WHERE lr.leave_type_id = lt.id
      `)

      // Step 2: Reassign leave_balances from dup IDs → canonical ID per code
      await client.query(`
        UPDATE leave_balances lb
        SET leave_type_id = canonical.max_id
        FROM (
          SELECT code, MAX(id) AS max_id FROM leave_types GROUP BY code HAVING COUNT(*) > 1
        ) canonical
        JOIN leave_types lt ON lt.code = canonical.code AND lt.id != canonical.max_id
        WHERE lb.leave_type_id = lt.id
      `)

      // Step 3: Delete orphan policies and balances still on dup IDs
      const dupIdSubquery = `(
        SELECT lt.id FROM leave_types lt
        WHERE lt.code IN (
          SELECT code FROM leave_types GROUP BY code HAVING COUNT(*) > 1
        )
        AND lt.id NOT IN (
          SELECT MAX(id) FROM leave_types GROUP BY code
        )
      )`
      await client.query(`DELETE FROM leave_policies WHERE leave_type_id IN ${dupIdSubquery}`)
      await client.query(`DELETE FROM leave_balances WHERE leave_type_id IN ${dupIdSubquery}`)

      // Step 4: Delete the duplicate leave_type rows
      await client.query(`
        DELETE FROM leave_types
        WHERE code IN (
          SELECT code FROM leave_types GROUP BY code HAVING COUNT(*) > 1
        )
        AND id NOT IN (
          SELECT MAX(id) FROM leave_types GROUP BY code
        )
      `)
      console.log(`[migrate] Removed ${dupCount} duplicate leave type rows`)
    }

    // Second-pass: targeted cleanup of any remaining global-code duplicates.
    // The general dedup above groups by code only, so it may keep a regional row
    // (region_id != NULL) as the MAX-id winner while leaving extra global
    // (region_id IS NULL) rows with the same code untouched.
    // This pass works exclusively within global rows.
    const globalDupResult = await client.query(`
      SELECT code FROM leave_types WHERE region_id IS NULL GROUP BY code HAVING COUNT(*) > 1
    `)
    if (globalDupResult.rowCount && globalDupResult.rowCount > 0) {
      const dupCodes = globalDupResult.rows.map((r: { code: string }) => r.code)
      console.log(`[migrate] Found global leave type duplicates for codes: ${dupCodes.join(', ')}`)

      // Reassign leave_requests from duplicate global IDs → the kept (MAX id) global row
      await client.query(`
        UPDATE leave_requests
        SET leave_type_id = keeper.max_id
        FROM (
          SELECT lt.id AS old_id, k.max_id
          FROM leave_types lt
          JOIN (
            SELECT code, MAX(id) AS max_id
            FROM leave_types
            WHERE region_id IS NULL AND code = ANY($1)
            GROUP BY code
          ) k ON k.code = lt.code AND lt.id != k.max_id
          WHERE lt.region_id IS NULL
        ) keeper
        WHERE leave_requests.leave_type_id = keeper.old_id
      `, [dupCodes])

      // Reassign leave_balances similarly (ON CONFLICT DO NOTHING to avoid user-type-year unique clashes)
      await client.query(`
        UPDATE leave_balances
        SET leave_type_id = keeper.max_id
        FROM (
          SELECT lt.id AS old_id, k.max_id
          FROM leave_types lt
          JOIN (
            SELECT code, MAX(id) AS max_id
            FROM leave_types
            WHERE region_id IS NULL AND code = ANY($1)
            GROUP BY code
          ) k ON k.code = lt.code AND lt.id != k.max_id
          WHERE lt.region_id IS NULL
        ) keeper
        WHERE leave_balances.leave_type_id = keeper.old_id
        ON CONFLICT DO NOTHING
      `, [dupCodes])

      // Delete policies and remaining balances on the duplicate rows
      await client.query(`
        DELETE FROM leave_policies
        WHERE leave_type_id IN (
          SELECT lt.id FROM leave_types lt
          JOIN (SELECT code, MAX(id) AS max_id FROM leave_types WHERE region_id IS NULL AND code = ANY($1) GROUP BY code) k
            ON k.code = lt.code AND lt.id != k.max_id
          WHERE lt.region_id IS NULL
        )
      `, [dupCodes])
      await client.query(`
        DELETE FROM leave_balances
        WHERE leave_type_id IN (
          SELECT lt.id FROM leave_types lt
          JOIN (SELECT code, MAX(id) AS max_id FROM leave_types WHERE region_id IS NULL AND code = ANY($1) GROUP BY code) k
            ON k.code = lt.code AND lt.id != k.max_id
          WHERE lt.region_id IS NULL
        )
      `, [dupCodes])

      // Finally delete the duplicate global leave_type rows
      await client.query(`
        DELETE FROM leave_types
        WHERE region_id IS NULL
          AND code = ANY($1)
          AND id NOT IN (
            SELECT MAX(id) FROM leave_types WHERE region_id IS NULL AND code = ANY($1) GROUP BY code
          )
      `, [dupCodes])

      console.log(`[migrate] Cleaned up global leave type duplicates for: ${dupCodes.join(', ')}`)
    }

    // Prevent future global leave type duplicates: unique index on code WHERE region_id IS NULL
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS leave_types_global_code_unique
      ON leave_types (code) WHERE region_id IS NULL
    `)

    // Fix missing manager assignments from Calamari approval flows
    const managerFixes: { email: string; managerEmail: string }[] = [
      { email: 'nenden.alifa@bloomandgrowgroup.com',   managerEmail: 'erica.lye@bloomandgrowgroup.com' }, // ID- Erica Lye
      { email: 'meydira.shahnaz@bloomandgrowgroup.com', managerEmail: 'amy@bloomandgrowgroup.com' },       // ID- Amy (Amy Lam)
    ]
    let managerFixCount = 0
    for (const fix of managerFixes) {
      const res = await client.query(
        `UPDATE users u
         SET manager_id = m.id
         FROM users m
         WHERE u.email = $1
           AND m.email = $2
           AND u.manager_id IS NULL`,
        [fix.email, fix.managerEmail]
      )
      if (res.rowCount) managerFixCount++
    }
    if (managerFixCount > 0) console.log(`[migrate] Fixed manager assignments for ${managerFixCount} users`)

    // Add google_event_id column to leave_requests (added to schema in c2b9930 without migration)
    await client.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS google_event_id text
    `)

    // Add half_day_period column to leave_requests
    await client.query(`
      ALTER TABLE leave_requests
      ADD COLUMN IF NOT EXISTS half_day_period varchar(2)
    `)

    // Add is_on_probation column to users (manual toggle — no automatic date-based logic)
    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_on_probation boolean NOT NULL DEFAULT false
    `)

    // CN approval flow: set hr_required + requires_attachment for Group 1 leave types
    await client.query(`
      UPDATE leave_types
      SET approval_flow = 'hr_required', requires_attachment = true
      WHERE code IN (
        'BFL_CN', 'PARL_CN', 'CARE_CN', 'CL_CN',
        'PEL_CN', 'SPL_CN', 'PL', 'MRL', 'ML'
      )
    `)

    // CN approval flow: No Pay Leave → standard (was multi_level)
    await client.query(`
      UPDATE leave_types
      SET approval_flow = 'standard'
      WHERE code = 'NPL'
    `)

    // Remove leave types that are no longer in the approved list.
    // Only fully delete rows that have no associated leave_requests (safe).
    // For types that DO have requests, only remove their policies so they
    // disappear from the dropdown but historical data is preserved.
    const obsoleteCodes = ['BL', 'HOSP', 'PARENTAL_CN', 'PRENATAL_CN', 'TOMED', 'STL', 'SL_CN', 'BFL', 'LSL', 'RSL', 'OTC']
    // Remove policies first (applies to all obsolete types)
    await client.query(`
      DELETE FROM leave_policies WHERE leave_type_id IN (
        SELECT id FROM leave_types WHERE code = ANY($1)
      )
    `, [obsoleteCodes])
    // Delete leave_balances and the type row only when there are no requests referencing them
    const obsoleteResult = await client.query(`
      WITH safe_to_delete AS (
        SELECT lt.id FROM leave_types lt
        WHERE lt.code = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM leave_requests lr WHERE lr.leave_type_id = lt.id)
      )
      SELECT id FROM safe_to_delete
    `, [obsoleteCodes])
    if (obsoleteResult.rowCount && obsoleteResult.rowCount > 0) {
      const safeIds = obsoleteResult.rows.map((r: { id: number }) => r.id)
      await client.query(`DELETE FROM leave_balances WHERE leave_type_id = ANY($1)`, [safeIds])
      try {
        await client.query(`DELETE FROM leave_types WHERE id = ANY($1)`, [safeIds])
        console.log(`[migrate] Removed ${safeIds.length} obsolete leave type(s)`)
      } catch (delErr) {
        // If a FK constraint prevents deletion (e.g. leave_requests reference), deactivate instead
        console.log(`[migrate] Could not delete some obsolete types (FK constraint), deactivating: ${delErr instanceof Error ? delErr.message : String(delErr)}`)
        await client.query(`UPDATE leave_types SET is_active = false WHERE id = ANY($1)`, [safeIds])
      }
    }
    // Also deactivate any obsolete types that couldn't be deleted earlier (have leave requests)
    await client.query(`
      UPDATE leave_types SET is_active = false
      WHERE code = ANY($1) AND is_active = true
    `, [obsoleteCodes])

    // ── Phase 2 migrations (Elaine feedback, March 2026) ────────────────────────

    // Add is_active column to leave_types
    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true
    `)

    // Add region_restriction column (comma-separated region codes, e.g. "AU,NZ")
    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS region_restriction varchar(50)
    `)

    // Add unit column ('days' or 'hours')
    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS unit varchar(10) NOT NULL DEFAULT 'days'
    `)

    // Add color column for calendar display
    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS color varchar(7)
    `)

    // Add deducts_balance column
    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS deducts_balance boolean NOT NULL DEFAULT true
    `)

    // Create entitlement_audit_log table
    await client.query(`
      CREATE TABLE IF NOT EXISTS entitlement_audit_log (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        employee_id integer NOT NULL REFERENCES users(id),
        leave_type_id integer NOT NULL REFERENCES leave_types(id),
        field_changed varchar(20) NOT NULL,
        old_value numeric(5,1),
        new_value numeric(5,1),
        reason text NOT NULL,
        changed_by_id integer NOT NULL REFERENCES users(id),
        created_at timestamptz DEFAULT now() NOT NULL
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS entitlement_audit_log_employee_idx ON entitlement_audit_log(employee_id)`)
    await client.query(`CREATE INDEX IF NOT EXISTS entitlement_audit_log_created_at_idx ON entitlement_audit_log(created_at)`)

    // ── Sync master leave type list (33 types) ───────────────────────────────────
    // Ensure all types from the master list exist with correct settings.
    // Uses code as unique key; updates name/settings if already present.
    const masterLeaveTypes = [
      { code: 'AL',        name: 'Annual Leave',                              description: 'Paid annual leave entitlement',                                         isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#3B82F6' },
      { code: 'BDL',       name: 'Birthday Leave',                            description: '1 day per year on or around your birthday',                            isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#F59E0B' },
      { code: 'BFL_CN',    name: 'Breast-feeding Leave - CN',                 description: '1 hour per day breastfeeding break (China statutory)',                  isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN,CN-GZ,CN-SH', unit: 'hours', color: '#EC4899' },
      { code: 'BT',        name: 'Business Trip',                             description: 'Approved business travel — no balance deduction',                      isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'standard',     minNotice: 1,  regionRestriction: null,    unit: 'days', color: '#64748B' },
      { code: 'CARE_CN',   name: 'Care Leave - CN',                           description: 'China-specific care leave',                                            isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN,CN-GZ,CN-SH', unit: 'days', color: '#BE185D' },
      { code: 'CCL_SG',    name: 'Childcare Leave - SG',                      description: 'Singapore government-mandated childcare leave',                        isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'SG',    unit: 'days', color: '#06B6D4' },
      { code: 'CL',        name: 'Compassionate Leave',                       description: 'Leave for bereavement or serious family illness',                      isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#6366F1' },
      { code: 'CL_CN',     name: 'Compassionate Leave - CN',                  description: 'China-specific compassionate leave',                                   isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN,CN-GZ,CN-SH', unit: 'days', color: '#4F46E5' },
      { code: 'COMP_LEAVE',name: 'Compensatory Leave',                        description: 'Leave earned via approved OT claims (non-AU/NZ)',                      isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#10B981' },
      { code: 'FAM_ID',    name: 'Family Leave - ID',                         description: 'Indonesia family leave',                                               isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'ID',    unit: 'days', color: '#F97316' },
      { code: 'FPSL',      name: 'Full Pay Sick Leave',                       description: 'Full pay sick leave — requires attachment after 2 consecutive days',   isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#EF4444' },
      { code: 'FPSL_AUNZ', name: 'Full Pay Sick Leave - AU/NZ',               description: 'Personal/carer\'s leave for Australia & New Zealand',                  isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'AU,NZ', unit: 'days', color: '#DC2626' },
      { code: 'HOSP_SGMY', name: 'Hospitalisation Leave - SG & MY',           description: 'Hospitalisation leave — requires attachment',                          isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'SG,MY', unit: 'days', color: '#B91C1C' },
      { code: 'JDL',       name: 'Jury Duty Leave',                           description: 'Statutory jury duty leave — no balance deduction',                    isPaid: true,  deducts: false, reqAttach: true,  approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#78716C' },
      { code: 'LSL_AUNZ',  name: 'Long Service Leave - AU/NZ',                description: 'Long service leave after qualifying period',                           isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 14, regionRestriction: 'AU,NZ', unit: 'days', color: '#0EA5E9' },
      { code: 'MRL',       name: 'Marriage Leave',                            description: 'Leave for the employee\'s own wedding',                                isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#D946EF' },
      { code: 'ML',        name: 'Maternity Leave',                           description: 'Paid maternity leave — requires attachment. Manager then HR.',         isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'hr_required',  minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#EC4899' },
      { code: 'ML_AUNZ',   name: 'Maternity Leave - AU&NZ',                   description: 'Parental leave for primary caregiver — AU/NZ statutory',              isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'hr_required',  minNotice: 0,  regionRestriction: 'AU,NZ', unit: 'days', color: '#DB2777' },
      { code: 'NPL',       name: 'No Pay Leave',                              description: 'Unpaid leave — multi-level approval',                                  isPaid: false, deducts: true,  reqAttach: false, approvalFlow: 'multi_level',  minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#6B7280' },
      { code: 'NPL_AUNZ',  name: 'No Pay Leave - AU/NZ',                      description: 'Unpaid leave for Australia & New Zealand',                            isPaid: false, deducts: true,  reqAttach: false, approvalFlow: 'multi_level',  minNotice: 0,  regionRestriction: 'AU,NZ', unit: 'days', color: '#4B5563' },
      { code: 'NPSL',      name: 'No Pay Sick Leave',                         description: 'Unpaid sick leave',                                                    isPaid: false, deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#9CA3AF' },
      { code: 'PARL_CN',   name: 'Parental Leave - CN',                       description: 'China parental leave',                                                 isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'hr_required',  minNotice: 0,  regionRestriction: 'CN,CN-GZ,CN-SH', unit: 'days', color: '#C026D3' },
      { code: 'PL',        name: 'Paternity Leave',                           description: 'Paid paternity leave — requires attachment. Manager then HR.',         isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'hr_required',  minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#8B5CF6' },
      { code: 'PEL_CN',    name: 'Prenatal Examination Leave - CN',           description: 'China prenatal examination leave',                                     isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN,CN-GZ,CN-SH', unit: 'days', color: '#A855F7' },
      { code: 'RSL_SG',    name: 'Reservist Leave - SG',                      description: 'NS/reservist training — statutory, no balance deduction',             isPaid: true,  deducts: false, reqAttach: true,  approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'SG',    unit: 'days', color: '#0D9488' },
      { code: 'SL',        name: 'Full Pay Sick Leave',                       description: 'Full pay sick leave — requires attachment after 2 consecutive days', isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#F87171' },
      { code: 'SPL_CN',    name: 'Special Leave - CN',                        description: 'China special leave',                                                  isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN,CN-GZ,CN-SH', unit: 'days', color: '#7C3AED' },
      { code: 'TIL',       name: 'Time In Lieu - AU/NZ',                      description: 'Earned via OT claims for AU/NZ staff',                                isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'AU,NZ', unit: 'hours', color: '#059669' },
      { code: 'TOMED',     name: 'Time-off (1.5 hours for medical treatment only)', description: '1.5 hours per use for medical treatment',                        isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'hours', color: '#FB923C' },
      { code: 'WFH',       name: 'Work From Home',                            description: 'Work from home — auto-approved, no balance deduction',                isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'auto_approve', minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#22D3EE' },
      { code: 'WR',        name: 'Work Remotely (out of hometown)',            description: 'Working remotely from outside hometown — requires approval',          isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'standard',     minNotice: 1,  regionRestriction: null,    unit: 'days', color: '#34D399' },
    ]

    let upsertCount = 0
    for (const lt of masterLeaveTypes) {
      const minUnit = lt.unit === 'hours' ? '1_hour' : '1_day'
      const existing = await client.query(`SELECT id FROM leave_types WHERE code = $1 AND region_id IS NULL LIMIT 1`, [lt.code])
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query(`
          UPDATE leave_types SET
            name = $2, description = $3, is_paid = $4, deducts_balance = $5,
            requires_attachment = $6, approval_flow = $7,
            region_restriction = $8, unit = $9, color = $10, is_active = true,
            region_id = NULL, min_unit = $11
          WHERE code = $1 AND region_id IS NULL
        `, [lt.code, lt.name, lt.description, lt.isPaid, lt.deducts, lt.reqAttach, lt.approvalFlow, lt.regionRestriction, lt.unit, lt.color, minUnit])
      } else {
        await client.query(`
          INSERT INTO leave_types (name, code, description, is_paid, deducts_balance, requires_attachment, approval_flow, region_restriction, unit, color, is_active, region_id, min_unit)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, NULL, $11)
          ON CONFLICT DO NOTHING
        `, [lt.name, lt.code, lt.description, lt.isPaid, lt.deducts, lt.reqAttach, lt.approvalFlow, lt.regionRestriction, lt.unit, lt.color, minUnit])
        upsertCount++
      }
    }
    if (upsertCount > 0) console.log(`[migrate] Inserted ${upsertCount} new master leave types`)

    // Deactivate old/legacy types not in master list
    const masterCodes = masterLeaveTypes.map(lt => lt.code)
    const deactivateResult = await client.query(`
      UPDATE leave_types SET is_active = false
      WHERE code NOT IN (${masterCodes.map((_, i) => `$${i+1}`).join(',')})
        AND region_id IS NULL
    `, masterCodes)
    if (deactivateResult.rowCount && deactivateResult.rowCount > 0) {
      console.log(`[migrate] Deactivated ${deactivateResult.rowCount} legacy leave types`)
    }

    // Add WFH policies for all regions (needed for dropdown filtering)
    const wfhRegions = ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']
    for (const rCode of wfhRegions) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'WFH' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'WFH' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add COMP_LEAVE policies for AU and NZ (for cross-region employees)
    for (const rCode of ['AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 5, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'COMP_LEAVE' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'COMP_LEAVE' AND r2.code = $1
          )
      `, [rCode])
    }

    // Ensure TIL (Time In Lieu - AU/NZ) policies exist
    for (const rCode of ['AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 20, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'TIL' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'TIL' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add NPSL (No Pay Sick Leave) policies for all regions
    const npslRegions = ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']
    for (const rCode of npslRegions) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'NPSL' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'NPSL' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add Birthday Leave policies for all regions
    for (const rCode of ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 1, 0, 6
        FROM leave_types lt, regions r
        WHERE lt.code = 'BDL' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'BDL' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add Marriage Leave policies
    for (const rCode of ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 3, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'MRL' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'MRL' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add JDL (Jury Duty) policies for all regions
    for (const rCode of ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'JDL' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'JDL' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add WR (Work Remotely) policies for all regions if missing
    for (const rCode of ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'WR' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'WR' AND r2.code = $1
          )
      `, [rCode])
    }

    // Add BT (Business Trip) policies for all regions if missing
    for (const rCode of ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'BT' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'BT' AND r2.code = $1
          )
      `, [rCode])
    }

    // Rename legacy code to standard codes where needed
    // AL (Annual Leave) → keep; TIL old code mapping
    await client.query(`UPDATE leave_types SET code = 'TIL' WHERE code = 'COMP_TIL' AND region_id IS NULL`)

    // Make department_id nullable (if somehow it's still NOT NULL)
    await client.query(`
      ALTER TABLE users ALTER COLUMN department_id DROP NOT NULL
    `).catch(() => null) // ignore if already nullable

    // ── Phase 3 migrations ────────────────────────────────────────────────────

    // Fix 1: joined_date on users
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS joined_date DATE`)

    // Fix 5: daily time slot columns on leave_requests (for breastfeeding leave CN)
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS daily_start_time TIME`)
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS daily_end_time TIME`)

    // Fix 9: unlimited entitlement/carryover flags on leave_policies
    await client.query(`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS entitlement_unlimited BOOLEAN NOT NULL DEFAULT FALSE`)
    await client.query(`ALTER TABLE leave_policies ADD COLUMN IF NOT EXISTS carryover_unlimited BOOLEAN NOT NULL DEFAULT FALSE`)

    // Fix 10: staff_restriction on leave_types
    await client.query(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS staff_restriction TEXT`)

    // Fix 11: day_calculation on leave_types
    await client.query(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS day_calculation VARCHAR(20) NOT NULL DEFAULT 'working_days'`)

    // Fix 11: set calendar_days for maternity/paternity/parental types
    await client.query(`
      UPDATE leave_types SET day_calculation = 'calendar_days'
      WHERE code IN ('ML', 'ML_AUNZ', 'PL', 'PARL_CN')
    `)

    // Fix 3: min_notice_days removal — column is dropped in Phase 6 below; nothing to do here

    // Fix 4: Deactivate duplicate Birthday Leave — keep oldest active one, deactivate the rest
    await client.query(`
      UPDATE leave_types SET is_active = false
      WHERE name = 'Birthday Leave'
        AND id NOT IN (
          SELECT MIN(id) FROM leave_types WHERE name = 'Birthday Leave' AND is_active = true
        )
        AND is_active = true
    `)

    // Fix 6: Correct region_restriction assignments
    await client.query(`UPDATE leave_types SET region_restriction = 'CN' WHERE code IN ('BFL_CN', 'CARE_CN', 'CL_CN', 'PARL_CN', 'PEL_CN', 'SPL_CN')`)
    await client.query(`UPDATE leave_types SET region_restriction = 'SG' WHERE code = 'CCL_SG'`)
    await client.query(`UPDATE leave_types SET region_restriction = 'SG' WHERE code = 'RSL_SG'`)
    await client.query(`UPDATE leave_types SET region_restriction = 'SG,MY' WHERE code = 'HOSP_SGMY'`)
    await client.query(`UPDATE leave_types SET region_restriction = 'ID' WHERE code = 'FAM_ID'`)
    await client.query(`UPDATE leave_types SET region_restriction = 'AU,NZ' WHERE code IN ('FPSL_AUNZ', 'LSL_AUNZ', 'ML_AUNZ', 'NPL_AUNZ')`)
    // Ensure TIL is always restricted to AU,NZ — never globally available
    await client.query(`
      UPDATE leave_types SET region_restriction = 'AU,NZ'
      WHERE code = 'TIL' AND (region_restriction IS NULL OR region_restriction != 'AU,NZ')
    `)

    // Fix 8: Deactivate "Unpaid Leave" if it still exists (replaced by No Pay Leave)
    await client.query(`UPDATE leave_types SET is_active = false WHERE name = 'Unpaid Leave' AND is_active = true`)

    // ── Phase 4: CN sub-regions — Guangzhou & Shanghai ───────────────────────
    // Add is_active column to regions (idempotent)
    await client.query(`
      ALTER TABLE regions ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true
    `)

    // Insert the two sub-regions (idempotent — regions table has unique index on code)
    await client.query(`
      INSERT INTO regions (name, code, timezone, currency) VALUES
        ('China - Guangzhou', 'CN-GZ', 'Asia/Shanghai', 'CNY'),
        ('China - Shanghai',  'CN-SH', 'Asia/Shanghai', 'CNY')
      ON CONFLICT (code) DO NOTHING
    `)

    // Move any remaining users still assigned to the base CN region → CN-GZ
    await client.query(`
      UPDATE users
      SET region_id = (SELECT id FROM regions WHERE code = 'CN-GZ')
      WHERE region_id = (SELECT id FROM regions WHERE code = 'CN')
        AND deleted_at IS NULL
    `)

    // Retire base CN region so it no longer appears in dropdowns
    await client.query(`
      UPDATE regions SET is_active = false WHERE code = 'CN'
    `)

    // Copy departments from CN to each sub-region (skip if already present)
    for (const rCode of ['CN-GZ', 'CN-SH']) {
      await client.query(`
        INSERT INTO departments (name, region_id)
        SELECT d.name, r.id
        FROM departments d
        JOIN regions cn ON cn.code = 'CN' AND cn.id = d.region_id
        JOIN regions r ON r.code = $1
        WHERE NOT EXISTS (
          SELECT 1 FROM departments d2
          WHERE d2.name = d.name AND d2.region_id = r.id
        )
      `, [rCode])
    }

    // Copy ALL leave policies from CN to each sub-region (HR can adjust per-city after)
    for (const rCode of ['CN-GZ', 'CN-SH']) {
      await client.query(`
        INSERT INTO leave_policies
          (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months,
           entitlement_unlimited, carryover_unlimited)
        SELECT lp.leave_type_id, r.id, lp.entitlement_days, lp.carry_over_max, lp.probation_months,
               lp.entitlement_unlimited, lp.carryover_unlimited
        FROM leave_policies lp
        JOIN regions cn ON cn.code = 'CN' AND cn.id = lp.region_id
        JOIN regions r ON r.code = $1
        WHERE NOT EXISTS (
          SELECT 1 FROM leave_policies lp2
          WHERE lp2.leave_type_id = lp.leave_type_id AND lp2.region_id = r.id
        )
      `, [rCode])
    }

    // Copy public holidays from CN to each sub-region
    for (const rCode of ['CN-GZ', 'CN-SH']) {
      await client.query(`
        INSERT INTO public_holidays (name, date, region_id, is_recurring)
        SELECT ph.name, ph.date, r.id, ph.is_recurring
        FROM public_holidays ph
        JOIN regions cn ON cn.code = 'CN' AND cn.id = ph.region_id
        JOIN regions r ON r.code = $1
        WHERE NOT EXISTS (
          SELECT 1 FROM public_holidays ph2
          WHERE ph2.date = ph.date AND ph2.region_id = r.id
        )
      `, [rCode])
    }

    // Copy comp_leave_rules from CN (if any) to each sub-region
    for (const rCode of ['CN-GZ', 'CN-SH']) {
      await client.query(`
        INSERT INTO comp_leave_rules
          (region_id, hours_per_day, max_accumulation_days, expiry_days,
           requires_approval, min_hours_per_entry, max_hours_per_entry)
        SELECT r.id, clr.hours_per_day, clr.max_accumulation_days, clr.expiry_days,
               clr.requires_approval, clr.min_hours_per_entry, clr.max_hours_per_entry
        FROM comp_leave_rules clr
        JOIN regions cn ON cn.code = 'CN' AND cn.id = clr.region_id
        JOIN regions r ON r.code = $1
        WHERE NOT EXISTS (
          SELECT 1 FROM comp_leave_rules clr2
          WHERE clr2.region_id = r.id
        )
      `, [rCode])
    }

    // Expand regionRestriction for CN-specific leave types to cover both sub-regions.
    // Must run AFTER the fix 6 block above which sets restriction to 'CN'.
    await client.query(`
      UPDATE leave_types
      SET region_restriction = 'CN,CN-GZ,CN-SH'
      WHERE code IN ('BFL_CN', 'CARE_CN', 'CL_CN', 'PARL_CN', 'PEL_CN', 'SPL_CN')
    `)

    // ── Phase 5: New features from commit 1ac7036 ────────────────────────────
    // min_unit column on leave_types (minimum booking unit: 1_day/half_day/2_hours/1_hour)
    await client.query(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS min_unit VARCHAR(10) NOT NULL DEFAULT '1_day'`)

    // start_time / end_time on leave_requests (for hourly/sub-day bookings)
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_time TIME`)
    await client.query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_time TIME`)

    // Entitlement tiers — per-policy tiered entitlements for named staff
    await client.query(`
      CREATE TABLE IF NOT EXISTS policy_entitlement_tiers (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        leave_policy_id INTEGER NOT NULL REFERENCES leave_policies(id) ON DELETE CASCADE,
        entitlement_days NUMERIC(5,1) NOT NULL,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await client.query(`
      CREATE TABLE IF NOT EXISTS policy_tier_assignments (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        tier_id INTEGER NOT NULL REFERENCES policy_entitlement_tiers(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tier_id, user_id)
      )
    `)

    // Unique constraint on public_holidays (region_id, date) — idempotent check before adding
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'public_holidays_region_date_unique'
            AND conrelid = 'public_holidays'::regclass
        ) THEN
          ALTER TABLE public_holidays ADD CONSTRAINT public_holidays_region_date_unique UNIQUE (region_id, date);
        END IF;
      END $$;
    `)

    // ── Phase 6: Leave type cleanup & HK holiday substitutes (March 2026 feedback) ──

    const cclReassign = await client.query(`
      SELECT lt_old.id AS old_id, lt_new.id AS new_id
      FROM leave_types lt_old, leave_types lt_new
      WHERE lt_old.code = 'CCL' AND lt_new.code = 'CCL_SG'
    `)
    if (cclReassign.rows.length > 0) {
      const { old_id, new_id } = cclReassign.rows[0]
      const reassigned = await client.query(
        `UPDATE leave_requests SET leave_type_id = $1 WHERE leave_type_id = $2`,
        [new_id, old_id]
      )
      if (reassigned.rowCount && reassigned.rowCount > 0) {
        console.log(`[migrate] Reassigned ${reassigned.rowCount} CCL leave request(s) to CCL_SG`)
      }
      await client.query(`DELETE FROM leave_balances WHERE leave_type_id = $1`, [old_id])
    }

    const phase6DeleteCodes = [
      'CCL',       // Child Care Leave (global) — replaced by region-specific CCL_SG
      'AL_AU',     // Annual Leave (AU) — replaced by global AL
      'AL_NZ',     // Annual Leave (NZ) — replaced by global AL
      'AL_AUNZ',   // Annual Leave AU/NZ combined — replaced by global AL
      'FPSL_AU',   // Full Pay Sick Leave (AU) — replaced by FPSL_AUNZ
      'FPSL_NZ',   // Full Pay Sick Leave (NZ) — replaced by FPSL_AUNZ
      'LSL_AU',    // Long Service Leave (AU) — replaced by LSL_AUNZ
      'LSL_NZ',    // Long Service Leave (NZ) — replaced by LSL_AUNZ
      'ML_AU',     // Maternity Leave (AU) — replaced by ML_AUNZ
      'ML_NZ',     // Maternity Leave (NZ) — replaced by ML_AUNZ
      'NPL_AU',    // No Pay Leave (AU) — replaced by NPL_AUNZ
      'NPL_NZ',    // No Pay Leave (NZ) — replaced by NPL_AUNZ
      'OTC',       // OT Claim — replaced by overtime_entries workflow
    ]
    const legacyCheck = await client.query(`SELECT id FROM leave_types WHERE code = ANY($1) LIMIT 1`, [phase6DeleteCodes])
    if (legacyCheck.rows.length > 0) {
      await client.query(`DELETE FROM leave_balances WHERE leave_type_id IN (SELECT id FROM leave_types WHERE code = ANY($1))`, [phase6DeleteCodes])
      await client.query(`DELETE FROM leave_policies WHERE leave_type_id IN (SELECT id FROM leave_types WHERE code = ANY($1))`, [phase6DeleteCodes])
      await client.query(`
        DELETE FROM approval_workflows WHERE leave_request_id IN (
          SELECT lr.id FROM leave_requests lr
          JOIN leave_types lt ON lr.leave_type_id = lt.id
          WHERE lt.code = ANY($1)
        )
      `, [phase6DeleteCodes])
      await client.query(`DELETE FROM leave_requests WHERE leave_type_id IN (SELECT id FROM leave_types WHERE code = ANY($1))`, [phase6DeleteCodes])
      const delResult = await client.query(`DELETE FROM leave_types WHERE code = ANY($1)`, [phase6DeleteCodes])
      if (delResult.rowCount && delResult.rowCount > 0) {
        console.log(`[migrate] Permanently deleted ${delResult.rowCount} legacy leave type(s)`)
      }
    }

    // Drop min_notice_days column — notice periods are not used in Bloom & Grow LMS
    await client.query(`ALTER TABLE leave_types DROP COLUMN IF EXISTS min_notice_days`)

    // Add missing HK 2026 substitute/additional public holidays.
    // In HK, when a statutory holiday falls on a Sunday or coincides with another holiday,
    // a substitute holiday is granted on the next available weekday.
    //
    // Calculations (2026):
    //   Jan 31 (Lunar NY Day 3) = Saturday  → substitute: Feb 2 (Monday)
    //   Apr 5  (Ching Ming)     = Easter Sunday, Apr 6 = Easter Monday → substitute: Apr 7 (Tue)
    //   May 24 (Buddha's B-day) = Sunday    → substitute: May 25 (Monday)
    //   Sep 26 (After Mid-Autumn) = Saturday → substitute: Sep 28 (Monday)
    //   Oct 11 (Chung Yeung)    = Sunday    → substitute: Oct 12 (Monday)
    //   Dec 26 (Boxing Day)     = Saturday  → substitute: Dec 28 (Monday)
    const hkSubstitutes = [
      { name: 'Lunar New Year (Substitute)',               date: '2026-02-02' },
      { name: 'Ching Ming Festival (Substitute)',          date: '2026-04-07' },
      { name: "The Day Following Buddha's Birthday (Sub)", date: '2026-05-25' },
      { name: 'Day After Mid-Autumn Festival (Sub)',       date: '2026-09-28' },
      { name: 'Chung Yeung Festival (Substitute)',         date: '2026-10-12' },
      { name: 'Boxing Day (Substitute)',                   date: '2026-12-28' },
    ]
    let hkHolCount = 0
    for (const h of hkSubstitutes) {
      const res = await client.query(`
        INSERT INTO public_holidays (name, date, region_id, is_recurring)
        SELECT $1, $2::date, r.id, false
        FROM regions r
        WHERE r.code = 'HK'
        ON CONFLICT ON CONSTRAINT public_holidays_region_date_unique DO NOTHING
      `, [h.name, h.date])
      if (res.rowCount) hkHolCount++
    }
    if (hkHolCount > 0) console.log(`[migrate] Added ${hkHolCount} HK substitute holiday(s)`)

    // ── Fix Slack IDs for users whose LMS email differs from Slack email ───────
    const slackFixes = [
      { lmsEmail: 'victoria@bloomandgrowasia.com',  slackId: 'U03SPQZ7TEV' },
      { lmsEmail: 'ania@bloomandgrow.com.au',       slackId: 'U045A0C4L9J' },
      { lmsEmail: 'connie@bloomandgrowgroup.com',   slackId: 'U0AKDSUA9HR' },
    ]
    let slackFixCount = 0
    for (const fix of slackFixes) {
      const res = await client.query(
        `UPDATE users SET slack_user_id = $1 WHERE email = $2 AND (slack_user_id IS NULL OR slack_user_id != $1)`,
        [fix.slackId, fix.lmsEmail]
      )
      if (res.rowCount && res.rowCount > 0) slackFixCount++
    }
    if (slackFixCount > 0) console.log(`[migrate] Linked ${slackFixCount} Slack user(s) by manual ID`)

    // ── Ensure Connie Li (AU) has AL & SL entitlements matching Tammy Bolton ───
    const connieRow = await client.query(`SELECT id FROM users WHERE email = 'connie@bloomandgrowgroup.com' LIMIT 1`)
    const tammyRow = await client.query(`SELECT id FROM users WHERE email = 'tammy@bloomandgrowgroup.com' LIMIT 1`)
    if (connieRow.rowCount && connieRow.rowCount > 0 && tammyRow.rowCount && tammyRow.rowCount > 0) {
      const connieId = connieRow.rows[0].id
      const tammyId = tammyRow.rows[0].id
      const alType = await client.query(`SELECT id FROM leave_types WHERE code = 'AL' AND is_active = true ORDER BY id ASC LIMIT 1`)
      const slType = await client.query(`SELECT id FROM leave_types WHERE code = 'SL' AND is_active = true ORDER BY id ASC LIMIT 1`)
      const typesToCopy = [
        ...(alType.rowCount ? [alType.rows[0].id] : []),
        ...(slType.rowCount ? [slType.rows[0].id] : []),
      ]
      if (typesToCopy.length === 0) console.log('[migrate] WARNING: No AL/SL leave types found for Connie entitlements')
      let entitlementCount = 0
      for (const ltId of typesToCopy) {
        const tammyBal = await client.query(
          `SELECT entitled, carried, adjustments FROM leave_balances WHERE user_id = $1 AND leave_type_id = $2 AND year = 2026 LIMIT 1`,
          [tammyId, ltId]
        )
        if (tammyBal.rowCount && tammyBal.rowCount > 0) {
          const { entitled, carried, adjustments } = tammyBal.rows[0]
          const res = await client.query(`
            INSERT INTO leave_balances (user_id, leave_type_id, year, entitled, used, pending, carried, adjustments)
            VALUES ($1, $2, 2026, $3, '0.0', '0.0', $4, $5)
            ON CONFLICT ON CONSTRAINT leave_balances_user_type_year_unique
            DO UPDATE SET entitled = EXCLUDED.entitled, carried = EXCLUDED.carried, adjustments = EXCLUDED.adjustments
          `, [connieId, ltId, entitled, carried, adjustments])
          if (res.rowCount && res.rowCount > 0) entitlementCount++
        }
      }
      if (entitlementCount > 0) console.log(`[migrate] Set ${entitlementCount} entitlement(s) for Connie Li matching Tammy`)
    } else {
      if (!connieRow.rowCount || connieRow.rowCount === 0) console.log('[migrate] Connie Li not found in database (skipping entitlements)')
      if (!tammyRow.rowCount || tammyRow.rowCount === 0) console.log('[migrate] Tammy Bolton not found in database (skipping Connie entitlements)')
    }

    // ── Phase 7: Correct HK 2026 public holidays (from official gazette) ────
    // The existing HK holidays had incorrect dates (2025 calendar).
    // Delete all 2026 HK holidays and re-insert the correct ones.
    const hkRegionRow = await client.query(`SELECT id FROM regions WHERE code = 'HK' LIMIT 1`)
    if (hkRegionRow.rowCount && hkRegionRow.rowCount > 0) {
      const hkRegionId = hkRegionRow.rows[0].id

      const correctHK2026 = [
        { date: '2026-01-01', name: 'The first day of January' },
        { date: '2026-02-17', name: "Lunar New Year's Day" },
        { date: '2026-02-18', name: 'The second day of Lunar New Year' },
        { date: '2026-02-19', name: 'The third day of Lunar New Year' },
        { date: '2026-04-03', name: 'Good Friday' },
        { date: '2026-04-04', name: 'The day following Good Friday' },
        { date: '2026-04-06', name: 'The day following Ching Ming Festival' },
        { date: '2026-04-07', name: 'The day following Easter Monday' },
        { date: '2026-05-01', name: 'Labour Day' },
        { date: '2026-05-25', name: 'The day following the Birthday of the Buddha' },
        { date: '2026-06-19', name: 'Tuen Ng Festival' },
        { date: '2026-07-01', name: 'Hong Kong SAR Establishment Day' },
        { date: '2026-09-26', name: 'The day following the Chinese Mid-Autumn Festival' },
        { date: '2026-10-01', name: 'National Day' },
        { date: '2026-10-19', name: 'The day following Chung Yeung Festival' },
        { date: '2026-12-25', name: 'Christmas Day' },
        { date: '2026-12-26', name: 'The first weekday after Christmas Day' },
      ]

      // Delete all existing 2026 HK holidays
      const delResult = await client.query(
        `DELETE FROM public_holidays WHERE region_id = $1 AND date >= '2026-01-01' AND date <= '2026-12-31'`,
        [hkRegionId]
      )
      if (delResult.rowCount && delResult.rowCount > 0) {
        console.log(`[migrate] Removed ${delResult.rowCount} old HK 2026 holiday(s)`)
      }

      // Insert correct 2026 holidays
      let hk2026Count = 0
      for (const h of correctHK2026) {
        const res = await client.query(
          `INSERT INTO public_holidays (name, date, region_id, is_recurring)
           VALUES ($1, $2::date, $3, false)
           ON CONFLICT ON CONSTRAINT public_holidays_region_date_unique DO UPDATE SET name = $1`,
          [h.name, h.date, hkRegionId]
        )
        if (res.rowCount) hk2026Count++
      }
      console.log(`[migrate] Inserted ${hk2026Count} correct HK 2026 public holiday(s)`)
    }

    // ── Phase 8: Seed data fixes for production (UK region, holidays, leave type fixes) ────

    // 8a. Add UK region if not present
    await client.query(`
      INSERT INTO regions (name, code, timezone, currency)
      VALUES ('United Kingdom', 'UK', 'Europe/London', 'GBP')
      ON CONFLICT (code) DO NOTHING
    `)

    // 8b. Add schema columns (safe to re-run)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_months integer`)
    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS probation_end_date date`)
    await client.query(`ALTER TABLE public_holidays ADD COLUMN IF NOT EXISTS half_day varchar(2)`)

    // 8c. Time-off restricted to HK and UK only
    const timeoffRes = await client.query(
      `UPDATE leave_types SET region_restriction = 'HK,UK' WHERE (name LIKE '%Time-off%' OR code = 'TOMED') AND (region_restriction IS NULL OR region_restriction != 'HK,UK')`
    )
    if (timeoffRes.rowCount && timeoffRes.rowCount > 0) console.log(`[migrate] Updated Time-off region restriction`)

    // 8d. Deactivate 'Unpaid Leave'
    await client.query(`UPDATE leave_types SET is_active = false WHERE name = 'Unpaid Leave' AND is_active = true`)

    // 8e. Require attachments for Sick/Compassionate/Maternity leave types
    const attachRes = await client.query(
      `UPDATE leave_types SET requires_attachment = true WHERE (name ILIKE '%Sick Leave%' OR name ILIKE '%Compassionate Leave%' OR name ILIKE '%Maternity Leave%') AND requires_attachment = false`
    )
    if (attachRes.rowCount && attachRes.rowCount > 0) console.log(`[migrate] Updated ${attachRes.rowCount} leave type attachment requirement(s)`)

    // 8f. Indonesia 2026 public holidays
    const idRegionRow = await client.query(`SELECT id FROM regions WHERE code = 'ID' LIMIT 1`)
    if (idRegionRow.rowCount && idRegionRow.rowCount > 0) {
      const idRegionId = idRegionRow.rows[0].id
      const idHolidays = [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-01-16', name: "Isra and Mi'raj of the Prophet Muhammad (PBUH)" },
        { date: '2026-02-16', name: 'Chinese New Year (Joint Leave)' },
        { date: '2026-02-17', name: 'Chinese New Year' },
        { date: '2026-03-18', name: 'Day of Silence / Nyepi (Joint Leave)' },
        { date: '2026-03-19', name: 'Day of Silence / Nyepi (Saka New Year)' },
        { date: '2026-03-20', name: 'Eid al-Fitr 1447H (Joint Leave)' },
        { date: '2026-03-21', name: 'Eid al-Fitr 1447H' },
        { date: '2026-03-22', name: 'Eid al-Fitr 1447H' },
        { date: '2026-03-23', name: 'Eid al-Fitr 1447H (Joint Leave)' },
        { date: '2026-03-24', name: 'Eid al-Fitr 1447H (Joint Leave)' },
        { date: '2026-04-03', name: 'Good Friday' },
        { date: '2026-05-01', name: 'Labour Day' },
        { date: '2026-05-14', name: 'Ascension of Jesus Christ (Joint Leave)' },
        { date: '2026-05-15', name: 'Ascension of Jesus Christ' },
        { date: '2026-05-23', name: 'Vesak Day' },
        { date: '2026-06-01', name: 'Pancasila Day' },
        { date: '2026-07-27', name: 'Islamic New Year 1448H' },
        { date: '2026-08-17', name: 'Independence Day' },
        { date: '2026-10-05', name: "Prophet Muhammad's Birthday" },
        { date: '2026-12-24', name: 'Christmas Eve (Joint Leave)' },
        { date: '2026-12-25', name: 'Christmas Day' },
      ]
      let idCount = 0
      for (const h of idHolidays) {
        const res = await client.query(
          `INSERT INTO public_holidays (name, date, region_id, is_recurring)
           VALUES ($1, $2::date, $3, false)
           ON CONFLICT ON CONSTRAINT public_holidays_region_date_unique DO UPDATE SET name = $1`,
          [h.name, h.date, idRegionId]
        )
        if (res.rowCount) idCount++
      }
      if (idCount > 0) console.log(`[migrate] Inserted/updated ${idCount} Indonesia 2026 holiday(s)`)
    }

    // 8g. UK 2026 public holidays
    const ukRegionRow = await client.query(`SELECT id FROM regions WHERE code = 'UK' LIMIT 1`)
    if (ukRegionRow.rowCount && ukRegionRow.rowCount > 0) {
      const ukRegionId = ukRegionRow.rows[0].id
      const ukHolidays = [
        { date: '2026-01-01', name: "New Year's Day" },
        { date: '2026-04-03', name: 'Good Friday' },
        { date: '2026-04-06', name: 'Easter Monday' },
        { date: '2026-05-04', name: 'Early May Bank Holiday' },
        { date: '2026-05-25', name: 'Spring Bank Holiday' },
        { date: '2026-08-31', name: 'Summer Bank Holiday' },
        { date: '2026-12-25', name: 'Christmas Day' },
        { date: '2026-12-26', name: 'Boxing Day' },
        { date: '2026-12-28', name: 'Boxing Day (Substitute)' },
      ]
      let ukCount = 0
      for (const h of ukHolidays) {
        const res = await client.query(
          `INSERT INTO public_holidays (name, date, region_id, is_recurring)
           VALUES ($1, $2::date, $3, false)
           ON CONFLICT ON CONSTRAINT public_holidays_region_date_unique DO UPDATE SET name = $1`,
          [h.name, h.date, ukRegionId]
        )
        if (res.rowCount) ukCount++
      }
      if (ukCount > 0) console.log(`[migrate] Inserted/updated ${ukCount} UK 2026 holiday(s)`)
    }

    // ── Phase 9: Elaine Round 2 fixes ────

    // 9a. Activate Time-off (TOMED) leave type — was incorrectly deactivated
    await client.query(`
      UPDATE leave_types SET is_active = true
      WHERE code IN ('TOMED') AND is_active = false
    `)
    // Deactivate the duplicate TIMEOFF code (keep only TOMED as the canonical one)
    await client.query(`
      UPDATE leave_types SET is_active = false
      WHERE code = 'TIMEOFF' AND is_active = true
    `)

    // 9b. Set Time-off min_unit to '1_hour' and description
    await client.query(`
      UPDATE leave_types
      SET min_unit = '1_hour',
          description = '1.5 hours per use for medical treatment'
      WHERE code = 'TOMED'
    `)

    // 9c. Upsert HK and UK leave policies for TOMED (1.5 hours/year for HK, 4.5 for UK)
    const tomedPolicies: [string, number][] = [['HK', 1.5], ['UK', 4.5]]
    for (const [rCode, hours] of tomedPolicies) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, $2, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'TOMED' AND r.code = $1
        ON CONFLICT (leave_type_id, region_id) DO UPDATE SET entitlement_days = $2
      `, [rCode, hours])
    }
    console.log('[migrate] Activated TOMED leave type with HK (1.5 hrs) / UK (4.5 hrs) policies')

    // 9d. Add WFH policy for UK region (was missing — prevents UK staff from submitting WFH)
    await client.query(`
      INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
      SELECT lt.id, r.id, 0, 0, 0
      FROM leave_types lt, regions r
      WHERE lt.code = 'WFH' AND r.code = 'UK'
      ON CONFLICT (leave_type_id, region_id) DO NOTHING
    `)

    // 9e. Move Victoria Thomas to UK region
    await client.query(`
      UPDATE users SET region_id = (SELECT id FROM regions WHERE code = 'UK' LIMIT 1)
      WHERE email = 'victoria@bloomandgrowasia.com'
        AND region_id != (SELECT id FROM regions WHERE code = 'UK' LIMIT 1)
    `)
    console.log('[migrate] Phase 9 complete')

    // ── Phase 10: Expense tables ──────────────────────────────────────────────
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE expense_status AS ENUM (
          'PENDING_REVIEW','AWAITING_APPROVAL','APPROVED','REJECTED','SYNCING','SYNCED','SYNC_FAILED'
        );
      EXCEPTION WHEN duplicate_object THEN null;
      END $$
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS expenses (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        uploaded_by_user_id integer NOT NULL REFERENCES users(id),
        filename varchar(255),
        status expense_status NOT NULL DEFAULT 'PENDING_REVIEW',
        slack_message_ts varchar(50),
        slack_channel_id varchar(50),
        sync_attempts integer NOT NULL DEFAULT 0,
        netsuite_id varchar(100),
        rejection_note text,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL
      )
    `)

    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_items (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        expense_id integer NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        employee_email varchar(255) NOT NULL,
        category varchar(100),
        amount numeric(12,2) NOT NULL,
        currency varchar(10) NOT NULL DEFAULT 'HKD',
        expense_date date NOT NULL,
        description text,
        raw_data jsonb,
        created_at timestamptz DEFAULT now() NOT NULL
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS expense_items_expense_id_idx ON expense_items(expense_id)`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_audit_log (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        expense_id integer NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        from_status expense_status,
        to_status expense_status NOT NULL,
        actor_id integer REFERENCES users(id),
        actor_name varchar(255),
        note text,
        created_at timestamptz DEFAULT now() NOT NULL
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS expense_audit_log_expense_id_idx ON expense_audit_log(expense_id)`)

    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_attachments (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        expense_id integer NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
        url text NOT NULL,
        original_name varchar(255) NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      )
    `)
    await client.query(`CREATE INDEX IF NOT EXISTS expense_attachments_expense_id_idx ON expense_attachments(expense_id)`)
    console.log('[migrate] Phase 10 (expense tables) complete')

    // ── Phase 11: Sick leave dedup — SL for AU/NZ/HK/SG/MY/ID/UK, SL_CN for GZ/SH/CN ──
    // Rename SL to "Full Paid Sick Leave"
    await client.query(`UPDATE leave_types SET name = 'Full Paid Sick Leave' WHERE code = 'SL'`)

    // Ensure SL_CN exists: either repurpose FPSL or create it
    const slCnCheck = await client.query(`SELECT id FROM leave_types WHERE code = 'SL_CN'`)
    if (slCnCheck.rowCount === 0) {
      const fpslCheck = await client.query(`SELECT id FROM leave_types WHERE code = 'FPSL' AND region_id IS NULL`)
      if (fpslCheck.rowCount && fpslCheck.rowCount > 0) {
        await client.query(`UPDATE leave_types SET name = 'Sick Leave', code = 'SL_CN' WHERE code = 'FPSL' AND region_id IS NULL`)
      } else {
        await client.query(`
          INSERT INTO leave_types (name, code, description, is_paid, requires_attachment, approval_flow)
          VALUES ('Sick Leave', 'SL_CN', 'Sick leave for China regions', true, false, 'standard')
        `)
      }
    } else {
      await client.query(`UPDATE leave_types SET name = 'Sick Leave' WHERE code = 'SL_CN'`)
    }

    // Move any China leave requests from SL to SL_CN
    await client.query(`
      UPDATE leave_requests lr
      SET leave_type_id = (SELECT id FROM leave_types WHERE code = 'SL_CN' LIMIT 1)
      FROM users u
      JOIN regions r ON r.id = u.region_id
      WHERE lr.user_id = u.id
        AND lr.leave_type_id = (SELECT id FROM leave_types WHERE code = 'SL' LIMIT 1)
        AND r.code IN ('CN','CN-GZ','CN-SH')
    `)

    // Remove SL policies for China regions (they use SL_CN)
    await client.query(`
      DELETE FROM leave_policies
      WHERE leave_type_id = (SELECT id FROM leave_types WHERE code = 'SL' LIMIT 1)
        AND region_id IN (SELECT id FROM regions WHERE code IN ('CN','CN-GZ','CN-SH'))
    `)

    // Remove SL_CN policies for non-China regions
    await client.query(`
      DELETE FROM leave_policies
      WHERE leave_type_id = (SELECT id FROM leave_types WHERE code = 'SL_CN' LIMIT 1)
        AND region_id NOT IN (SELECT id FROM regions WHERE code IN ('CN','CN-GZ','CN-SH'))
    `)

    // Ensure SL_CN has policies for CN, CN-GZ, CN-SH
    for (const rCode of ['CN', 'CN-GZ', 'CN-SH']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 12, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'SL_CN' AND r.code = $1
        ON CONFLICT (leave_type_id, region_id) DO NOTHING
      `, [rCode])
    }

    // Ensure SL has a UK policy
    await client.query(`
      INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
      SELECT lt.id, r.id, 14, 0, 0
      FROM leave_types lt, regions r
      WHERE lt.code = 'SL' AND r.code = 'UK'
      ON CONFLICT (leave_type_id, region_id) DO NOTHING
    `)

    // Activate SL_CN
    await client.query(`UPDATE leave_types SET is_active = true WHERE code = 'SL_CN'`)

    // Remove duplicate types: FPSL, FPSL_AU, FPSL_NZ, FPSL_AUNZ (0 requests, redundant)
    for (const code of ['FPSL', 'FPSL_AU', 'FPSL_NZ', 'FPSL_AUNZ']) {
      const hasRequests = await client.query(
        `SELECT 1 FROM leave_requests lr JOIN leave_types lt ON lr.leave_type_id = lt.id WHERE lt.code = $1 LIMIT 1`, [code]
      )
      if (hasRequests.rows.length > 0) continue
      await client.query(`DELETE FROM leave_balances WHERE leave_type_id IN (SELECT id FROM leave_types WHERE code = $1)`, [code])
      await client.query(`DELETE FROM leave_policies WHERE leave_type_id IN (SELECT id FROM leave_types WHERE code = $1)`, [code])
      await client.query(`DELETE FROM leave_types WHERE code = $1`, [code])
    }
    console.log('[migrate] Phase 11 (sick leave dedup) complete')

    // ── Phase 12: Missing policies, gender fields, gender restrictions ──────
    const allRegionCodes = ['HK', 'SG', 'MY', 'ID', 'CN', 'AU', 'NZ', 'CN-GZ', 'CN-SH', 'UK']
    const universalLeaveTypeCodes = ['WFH', 'WR', 'NPL', 'BT']
    for (const ltCode of universalLeaveTypeCodes) {
      for (const rCode of allRegionCodes) {
        await client.query(`
          INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
          SELECT lt.id, r.id, 0, 0, 0
          FROM leave_types lt, regions r
          WHERE lt.code = $1 AND r.code = $2
          ON CONFLICT (leave_type_id, region_id) DO NOTHING
        `, [ltCode, rCode])
      }
    }
    console.log('[migrate] Phase 12a: Added missing WFH/WR/NPL/BT policies for all regions')

    await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS gender varchar(10)`)
    console.log('[migrate] Phase 12b: Added gender column to users')

    await client.query(`ALTER TABLE leave_types ADD COLUMN IF NOT EXISTS gender_restriction varchar(10)`)
    await client.query(`UPDATE leave_types SET gender_restriction = 'female' WHERE code IN ('ML', 'ML_AUNZ') AND gender_restriction IS NULL`)
    await client.query(`UPDATE leave_types SET gender_restriction = 'male' WHERE code = 'PL' AND gender_restriction IS NULL`)
    console.log('[migrate] Phase 12c: Added gender_restriction to leave_types (ML=female, PL=male)')

    // ── Phase 12d: Set representative genders on seeded users ──────
    const maleEmails = [
      'yazid.ahmad@bloomandgrowgroup.com', 'richard.alejandro@bloomandgrowgroup.com',
      'scott.ang@bloomandgrowgroup.com', 'josh@bloomandgrowgroup.com',
      'benjamin.inglis@bloomandgrowgroup.com', 'jorge.inso@bloomandgrowgroup.com',
      'jason.fu@bloomandgrowgroup.com', 'jerald@babycentral.com.hk',
      'lawrence.choi@bloomandgrowgroup.com', 'jeremy.low@bloomandgrowgroup.com',
      'james@bloomandgrowgroup.com', 'teddy.romulo@bloomandgrowgroup.com',
      'anmol.rooprai@bloomandgrowgroup.com', 'sharwind@baby-central.com.sg',
      'mike.tsang@bloomandgrowgroup.com', 'brian@bloomandgrowgroup.com',
      'winson.zheng@bloomandgrow.com.cn', 'yakub.prastawa@bloomandgrowgroup.com',
      'deden.ridwan@bloomandgrowgroup.com', 'naveen@bloomandgrowgroup.com',
      'bud@babycentral.com.hk'
    ]
    const femaleEmails = [
      'nenden.alifa@bloomandgrowgroup.com', 'maya.amelia@bloomandgrowgroup.com',
      'syazwany.anny@bloomandgrowgroup.com', 'atiqah.ecom@bloomandgrowgroup.com',
      'chloe@bloomandgrowgroup.com', 'jessicab@bloomandgrowgroup.com',
      'tammy@bloomandgrowgroup.com', 'eva.chan@bloomandgrowgroup.com',
      'louise@bloomandgrowgroup.com', 'cherry.chen@bloomandgrowgroup.com',
      'essena.chen@bloomandgrow.com.cn', 'withney@bloomandgrow.com.cn',
      'zoe@bloomandgrowgroup.com', 'sydney@bloomandgrowgroup.com',
      'stephanie.choo@bloomandgrowgroup.com', 'helen.christie@bloomandgrowgroup.com',
      'elaine@bloomandgrowgroup.com', 'kim@bloomandgrowgroup.com',
      'riana.destiana@bloomandgrowgroup.com', 'alex@bloomandgrowgroup.com',
      'leyden@bloomandgrowgroup.com', 'brigitta.ellen@bloomandgrowgroup.com',
      'lily@bloomandgrow.com.cn', 'hollie@bloomandgrowgroup.com',
      'bobo.gan@bloomandgrow.com.cn', 'june@bloomandgrowgroup.com',
      'anggraini.hapsari@bloomandgrowgroup.com', 'cici.huang@bloomandgrow.com.cn',
      'ellen@bloomandgrowgroup.com', 'carole@bloomandgrowgroup.com',
      'sophie.jiao@bloomandgrow.com.cn', 'rina.juwita@bloomandgrowgroup.com',
      'idy@bloomandgrowgroup.com', 'janice.kong@bloomandgrowgroup.com',
      'kate.kuang@bloomandgrow.com.cn', 'amy@bloomandgrowgroup.com',
      'winnie.lee@bloomandgrowgroup.com', 'megan.li@bloomandgrow.com.cn',
      'sissi.li@bloomandgrow.com.cn', 'vicky.li@bloomandgrowgroup.com',
      'mei.liew@bloomandgrowgroup.com', 'arati@babycentral.com.hk',
      'lina@bloomandgrowgroup.com', 'wynn.liu@bloomandgrow.com.cn',
      'gloria.lo@bloomandgrowgroup.com', 'tannling@bloomandgrowgroup.com',
      'tannting@bloomandgrowgroup.com', 'laura@bloomandgrow.com.cn',
      'erica.lye@bloomandgrowgroup.com', 'asyiqin.nasser@bloomandgrowgroup.com',
      'atika.putri@bloomandgrowgroup.com', 'jamie@bloomandgrowgroup.com',
      'ania@bloomandgrow.com.au', 'wiwik.setyawati@bloomandgrowgroup.com',
      'meydira.shahnaz@bloomandgrowgroup.com', 'stephanie.shim@bloomandgrowgroup.com',
      'michelle.su@bloomandgrow.com.cn', 'maisarah.sulaiman@bloomandgrowgroup.com',
      'winki@bloomandgrowgroup.com', 'melissa@baby-central.com.sg',
      'martha.tang@bloomandgrowgroup.com', 'siti.tarmidi@bloomandgrowgroup.com',
      'victoria@bloomandgrowasia.com', 'rachel.too@bloomandgrowgroup.com',
      'lutfia.usman@bloomandgrowgroup.com', 'angela.valentine@bloomandgrowgroup.com',
      'michelle@bloomandgrowgroup.com', 'amy.xu@bloomandgrow.com.cn',
      'helen.yan@bloomandgrow.com.cn', 'crystal@bloomandgrow.com.cn',
      'enid.yap@bloomandgrowgroup.com', 'ashley.zhang@bloomandgrow.com.cn'
    ]
    for (const email of maleEmails) {
      await client.query(`UPDATE users SET gender = 'male' WHERE LOWER(email) = LOWER($1) AND gender IS NULL`, [email])
    }
    for (const email of femaleEmails) {
      await client.query(`UPDATE users SET gender = 'female' WHERE LOWER(email) = LOWER($1) AND gender IS NULL`, [email])
    }
    console.log('[migrate] Phase 12d: Set genders on seeded users')

    // Phase 12e: Update display names for cross-region staff
    await client.query(`UPDATE users SET name = 'Victoria Thomas (UK)' WHERE LOWER(email) = 'victoria@bloomandgrowasia.com' AND name = 'Victoria Thomas'`)
    await client.query(`UPDATE users SET name = 'Hollie Gale (NZ)' WHERE LOWER(email) = 'hollie@bloomandgrowgroup.com' AND name = 'Hollie Gale'`)
    console.log('[migrate] Phase 12e: Updated cross-region staff display names')

    console.log('[migrate] Migrations complete')
  } catch (err) {
    console.error('[migrate] Migration error:', err)
  } finally {
    await client.end()
  }
}
