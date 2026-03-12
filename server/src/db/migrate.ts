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

    console.log('[migrate] Migrations complete')
  } catch (err) {
    console.error('[migrate] Migration error:', err)
  } finally {
    await client.end()
  }
}
