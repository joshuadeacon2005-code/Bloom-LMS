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

    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS min_notice_days integer NOT NULL DEFAULT 0
    `)

    await client.query(`
      ALTER TABLE leave_types
      ADD COLUMN IF NOT EXISTS max_consecutive_days integer
    `)

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
      { code: 'FPSL',         name: 'Full Pay Sick Leave',             description: 'Full pay sick leave (explicit variant used in some regions)',                               isPaid: true,  requiresAttachment: false, approvalFlow: 'standard',     minNoticeDays: 0, regionId: null },
      { code: 'WR',           name: 'Work Remotely',                   description: 'Working remotely from outside hometown — no balance deduction',                             isPaid: true,  requiresAttachment: false, approvalFlow: 'auto_approve', minNoticeDays: 1, regionId: null },
      { code: 'OTC',          name: 'OT Claim',                        description: 'Overtime cash claim — request payment for approved overtime hours',                         isPaid: true,  requiresAttachment: true,  approvalFlow: 'hr_required',  minNoticeDays: 0, regionId: null },
      { code: 'BFL_CN',       name: 'Breastfeeding Leave (CN)',        description: '1 hour per day breastfeeding break (China statutory, up to 12 months)',                    isPaid: true,  requiresAttachment: false, approvalFlow: 'hr_required',  minNoticeDays: 0, regionId: 6    },
      { code: 'RSL_SG',       name: 'Reservist Leave (SG)',            description: 'NS/reservist training leave — Singapore statutory',                                         isPaid: true,  requiresAttachment: true,  approvalFlow: 'hr_required',  minNoticeDays: 0, regionId: 3    },
      { code: 'AL_AU',        name: 'Annual Leave (AU)',               description: 'Annual leave for Australia — Fair Work Act entitlement',                                    isPaid: true,  requiresAttachment: false, approvalFlow: 'standard',     minNoticeDays: 3, regionId: 7    },
      { code: 'FPSL_AU',      name: 'Full Pay Sick Leave (AU)',        description: "Personal/carer's leave — Australia Fair Work Act",                                         isPaid: true,  requiresAttachment: false, approvalFlow: 'standard',     minNoticeDays: 0, regionId: 7    },
      { code: 'LSL_AU',       name: 'Long Service Leave (AU)',         description: 'Long service leave after qualifying period — Australia',                                    isPaid: true,  requiresAttachment: false, approvalFlow: 'multi_level',  minNoticeDays: 14, regionId: 7   },
      { code: 'ML_AU',        name: 'Maternity Leave (AU)',            description: 'Parental leave for primary caregiver — Australia Fair Work Act',                            isPaid: true,  requiresAttachment: true,  approvalFlow: 'hr_required',  minNoticeDays: 0, regionId: 7    },
      { code: 'NPL_AU',       name: 'No Pay Leave (AU)',               description: 'Unpaid leave — Australia',                                                                  isPaid: false, requiresAttachment: false, approvalFlow: 'multi_level',  minNoticeDays: 0, regionId: 7    },
      { code: 'AL_NZ',        name: 'Annual Leave (NZ)',               description: 'Annual leave — New Zealand Holidays Act entitlement',                                       isPaid: true,  requiresAttachment: false, approvalFlow: 'standard',     minNoticeDays: 3, regionId: 8    },
      { code: 'FPSL_NZ',      name: 'Full Pay Sick Leave (NZ)',        description: 'Sick leave — New Zealand Holidays Act',                                                     isPaid: true,  requiresAttachment: false, approvalFlow: 'standard',     minNoticeDays: 0, regionId: 8    },
      { code: 'LSL_NZ',       name: 'Long Service Leave (NZ)',         description: 'Long service leave after qualifying period — New Zealand',                                  isPaid: true,  requiresAttachment: false, approvalFlow: 'multi_level',  minNoticeDays: 14, regionId: 8   },
      { code: 'ML_NZ',        name: 'Maternity Leave (NZ)',            description: 'Parental leave for primary caregiver — New Zealand',                                        isPaid: true,  requiresAttachment: true,  approvalFlow: 'hr_required',  minNoticeDays: 0, regionId: 8    },
      { code: 'NPL_NZ',       name: 'No Pay Leave (NZ)',               description: 'Unpaid leave — New Zealand',                                                                isPaid: false, requiresAttachment: false, approvalFlow: 'multi_level',  minNoticeDays: 0, regionId: 8    },
    ]
    let newTypeCount = 0
    for (const lt of newLeaveTypes) {
      const res = await client.query(
        `INSERT INTO leave_types (name, code, description, is_paid, requires_attachment, approval_flow, min_notice_days, region_id)
         SELECT $1::varchar,$2::varchar,$3::text,$4::boolean,$5::boolean,$6::varchar,$7::int,$8
         WHERE NOT EXISTS (SELECT 1 FROM leave_types WHERE code = $2::varchar)`,
        [lt.name, lt.code, lt.description, lt.isPaid, lt.requiresAttachment, lt.approvalFlow, lt.minNoticeDays, lt.regionId]
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
      { ltCode: 'FPSL',        rCode: 'HK', entitlementDays: 14,  carryOverMax: 0,  probationMonths: 1  },
      { ltCode: 'FPSL',        rCode: 'SG', entitlementDays: 14,  carryOverMax: 0,  probationMonths: 3  },
      { ltCode: 'FPSL',        rCode: 'MY', entitlementDays: 14,  carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'FPSL',        rCode: 'ID', entitlementDays: 12,  carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'FPSL',        rCode: 'CN', entitlementDays: 12,  carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'HK', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'MY', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'ID', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'AU', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'WR',          rCode: 'NZ', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'OTC',         rCode: 'HK', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'OTC',         rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'OTC',         rCode: 'MY', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'OTC',         rCode: 'ID', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'OTC',         rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'BFL_CN',      rCode: 'CN', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'RSL_SG',      rCode: 'SG', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'AL_AU',       rCode: 'AU', entitlementDays: 20,  carryOverMax: 20, probationMonths: 0  },
      { ltCode: 'FPSL_AU',     rCode: 'AU', entitlementDays: 10,  carryOverMax: 10, probationMonths: 0  },
      { ltCode: 'LSL_AU',      rCode: 'AU', entitlementDays: 33,  carryOverMax: 0,  probationMonths: 84 },
      { ltCode: 'ML_AU',       rCode: 'AU', entitlementDays: 365, carryOverMax: 0,  probationMonths: 12 },
      { ltCode: 'NPL_AU',      rCode: 'AU', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
      { ltCode: 'AL_NZ',       rCode: 'NZ', entitlementDays: 20,  carryOverMax: 20, probationMonths: 12 },
      { ltCode: 'FPSL_NZ',     rCode: 'NZ', entitlementDays: 10,  carryOverMax: 20, probationMonths: 0  },
      { ltCode: 'LSL_NZ',      rCode: 'NZ', entitlementDays: 65,  carryOverMax: 0,  probationMonths: 120 },
      { ltCode: 'ML_NZ',       rCode: 'NZ', entitlementDays: 365, carryOverMax: 0,  probationMonths: 6  },
      { ltCode: 'NPL_NZ',      rCode: 'NZ', entitlementDays: 0,   carryOverMax: 0,  probationMonths: 0  },
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
        ON CONFLICT DO NOTHING
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
    const obsoleteCodes = ['BL', 'HOSP', 'PARENTAL_CN', 'PRENATAL_CN', 'TOMED', 'STL', 'SL_CN', 'BFL', 'LSL', 'RSL']
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
      await client.query(`DELETE FROM leave_types WHERE id = ANY($1)`, [safeIds])
      console.log(`[migrate] Removed ${safeIds.length} obsolete leave type(s)`)
    }

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
      { code: 'AL_AUNZ',   name: 'Annual Leave - AU/NZ',                      description: 'Annual leave for Australia & New Zealand',                              isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 3,  regionRestriction: 'AU,NZ', unit: 'days', color: '#2563EB' },
      { code: 'BDL',       name: 'Birthday Leave',                            description: '1 day per year on or around your birthday',                            isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#F59E0B' },
      { code: 'BFL_CN',    name: 'Breast-feeding Leave - CN',                 description: '1 hour per day breastfeeding break (China statutory)',                  isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN',    unit: 'hours', color: '#EC4899' },
      { code: 'BT',        name: 'Business Trip',                             description: 'Approved business travel — no balance deduction',                      isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'standard',     minNotice: 1,  regionRestriction: null,    unit: 'days', color: '#64748B' },
      { code: 'CARE_CN',   name: 'Care Leave - CN',                           description: 'China-specific care leave',                                            isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN',    unit: 'days', color: '#BE185D' },
      { code: 'CCL_SG',    name: 'Childcare Leave - SG',                      description: 'Singapore government-mandated childcare leave',                        isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'SG',    unit: 'days', color: '#06B6D4' },
      { code: 'CL',        name: 'Compassionate Leave',                       description: 'Leave for bereavement or serious family illness',                      isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#6366F1' },
      { code: 'CL_CN',     name: 'Compassionate Leave - CN',                  description: 'China-specific compassionate leave',                                   isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN',    unit: 'days', color: '#4F46E5' },
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
      { code: 'OTC',       name: 'OT Claim',                                  description: 'Overtime compensation claim — credits Comp Leave or cash payment',    isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#F59E0B' },
      { code: 'PARL_CN',   name: 'Parental Leave - CN',                       description: 'China parental leave',                                                 isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'hr_required',  minNotice: 0,  regionRestriction: 'CN',    unit: 'days', color: '#C026D3' },
      { code: 'PL',        name: 'Paternity Leave',                           description: 'Paid paternity leave — requires attachment. Manager then HR.',         isPaid: true,  deducts: true,  reqAttach: true,  approvalFlow: 'hr_required',  minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#8B5CF6' },
      { code: 'PEL_CN',    name: 'Prenatal Examination Leave - CN',           description: 'China prenatal examination leave',                                     isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN',    unit: 'days', color: '#A855F7' },
      { code: 'RSL_SG',    name: 'Reservist Leave - SG',                      description: 'NS/reservist training — statutory, no balance deduction',             isPaid: true,  deducts: false, reqAttach: true,  approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'SG',    unit: 'days', color: '#0D9488' },
      { code: 'SL',        name: 'Sick Leave',                                description: 'Sick leave — requires attachment after 2 consecutive days',           isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#F87171' },
      { code: 'SPL_CN',    name: 'Special Leave - CN',                        description: 'China special leave',                                                  isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'CN',    unit: 'days', color: '#7C3AED' },
      { code: 'TIL',       name: 'Time In Lieu - AU/NZ',                      description: 'Earned via OT claims for AU/NZ staff',                                isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: 'AU,NZ', unit: 'days', color: '#059669' },
      { code: 'TOMED',     name: 'Time-off (1.5 hours for medical treatment only)', description: '1.5 hours per use for medical treatment',                        isPaid: true,  deducts: true,  reqAttach: false, approvalFlow: 'standard',     minNotice: 0,  regionRestriction: null,    unit: 'hours', color: '#FB923C' },
      { code: 'WFH',       name: 'Work From Home',                            description: 'Work from home — auto-approved, no balance deduction',                isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'auto_approve', minNotice: 0,  regionRestriction: null,    unit: 'days', color: '#22D3EE' },
      { code: 'WR',        name: 'Work Remotely (out of hometown)',            description: 'Working remotely from outside hometown — requires approval',          isPaid: true,  deducts: false, reqAttach: false, approvalFlow: 'standard',     minNotice: 1,  regionRestriction: null,    unit: 'days', color: '#34D399' },
    ]

    let upsertCount = 0
    for (const lt of masterLeaveTypes) {
      // Upsert by code: update if exists (for global region_id=NULL types), insert if not
      const existing = await client.query(`SELECT id FROM leave_types WHERE code = $1 AND region_id IS NULL LIMIT 1`, [lt.code])
      if (existing.rowCount && existing.rowCount > 0) {
        await client.query(`
          UPDATE leave_types SET
            name = $2, description = $3, is_paid = $4, deducts_balance = $5,
            requires_attachment = $6, approval_flow = $7, min_notice_days = $8,
            region_restriction = $9, unit = $10, color = $11, is_active = true,
            region_id = NULL
          WHERE code = $1 AND region_id IS NULL
        `, [lt.code, lt.name, lt.description, lt.isPaid, lt.deducts, lt.reqAttach, lt.approvalFlow, lt.minNotice, lt.regionRestriction, lt.unit, lt.color])
      } else {
        await client.query(`
          INSERT INTO leave_types (name, code, description, is_paid, deducts_balance, requires_attachment, approval_flow, min_notice_days, region_restriction, unit, color, is_active, region_id)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true, NULL)
          ON CONFLICT DO NOTHING
        `, [lt.name, lt.code, lt.description, lt.isPaid, lt.deducts, lt.reqAttach, lt.approvalFlow, lt.minNotice, lt.regionRestriction, lt.unit, lt.color])
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

    // Add OTC (OT Claim) policies for AU and NZ
    for (const rCode of ['AU', 'NZ']) {
      await client.query(`
        INSERT INTO leave_policies (leave_type_id, region_id, entitlement_days, carry_over_max, probation_months)
        SELECT lt.id, r.id, 0, 0, 0
        FROM leave_types lt, regions r
        WHERE lt.code = 'OTC' AND r.code = $1 AND lt.region_id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM leave_policies lp
            JOIN leave_types lt2 ON lt2.id = lp.leave_type_id
            JOIN regions r2 ON r2.id = lp.region_id
            WHERE lt2.code = 'OTC' AND r2.code = $1
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

    console.log('[migrate] Migrations complete')
  } catch (err) {
    console.error('[migrate] Migration error:', err)
  } finally {
    await client.end()
  }
}
