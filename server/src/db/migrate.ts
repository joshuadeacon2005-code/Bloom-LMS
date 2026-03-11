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

    console.log('[migrate] Migrations complete')
  } catch (err) {
    console.error('[migrate] Migration error:', err)
  } finally {
    await client.end()
  }
}
