/**
 * Schema drift check.
 *
 * For every table declared in src/db/schema.ts, compares the columns Drizzle
 * thinks the table has against what actually exists in the connected database
 * (via information_schema.columns). Exits non-zero on any drift so CI can
 * fail. Run AFTER `runMigrations()` so we test the post-migration state, not
 * a stale checkout.
 *
 * Usage:
 *   DATABASE_URL=postgres://… npm run check:schema
 *
 * What it catches: column declared in schema.ts but missing in the DB
 * (the bug that 500-d /api/users with `users.resigned_date does not exist`).
 *
 * What it does NOT catch (deliberately):
 *  • Extra columns in the DB that aren't in schema.ts — those are usually
 *    fine (legacy fields, manual additions). Flagged as warnings only.
 *  • Type mismatches — too many false positives across Drizzle/PG type
 *    representations. Worth adding later if drift bites again.
 */

import pg from 'pg'
import { is } from 'drizzle-orm'
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import * as schema from '../src/db/schema'
import { runMigrations } from '../src/db/migrate'

interface ColumnDriftReport {
  table: string
  missingInDb: string[]
  extraInDb: string[]
}

async function main(): Promise<void> {
  const dbUrl = process.env['DATABASE_URL']
  if (!dbUrl) {
    console.error('[drift] DATABASE_URL is required')
    process.exit(2)
  }

  console.log('[drift] Running migrations against the target database…')
  await runMigrations()

  const client = new pg.Client({ connectionString: dbUrl })
  await client.connect()

  // Enumerate every PgTable exported from schema.ts. The explicit `as` cast
  // is needed because Drizzle's inferred union type for the schema namespace
  // is too narrow for a generic PgTable predicate.
  const tables = Object.values(schema).filter((v) => is(v, PgTable)) as PgTable[]
  console.log(`[drift] Checking ${tables.length} tables…`)

  const reports: ColumnDriftReport[] = []

  for (const table of tables) {
    const cfg = getTableConfig(table)
    const declared = new Set(cfg.columns.map((c) => c.name))

    const result = await client.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1`,
      [cfg.name]
    )

    if (result.rowCount === 0) {
      reports.push({
        table: cfg.name,
        missingInDb: [...declared, '(table missing entirely)'],
        extraInDb: [],
      })
      continue
    }

    const actual = new Set(result.rows.map((r) => r.column_name))

    const missingInDb = [...declared].filter((c) => !actual.has(c))
    const extraInDb = [...actual].filter((c) => !declared.has(c))

    if (missingInDb.length > 0 || extraInDb.length > 0) {
      reports.push({ table: cfg.name, missingInDb, extraInDb })
    }
  }

  await client.end()

  // Print report
  let hasError = false
  for (const r of reports) {
    if (r.missingInDb.length > 0) {
      hasError = true
      console.error(`\n[drift] ❌  ${r.table}`)
      console.error(`        missing in DB: ${r.missingInDb.join(', ')}`)
    }
    if (r.extraInDb.length > 0) {
      console.warn(`\n[drift] ⚠️   ${r.table}`)
      console.warn(`        extra in DB (not in schema.ts): ${r.extraInDb.join(', ')}`)
    }
  }

  if (hasError) {
    console.error('\n[drift] FAIL — schema.ts declares columns the database does not have.')
    console.error('[drift] Add the missing columns to server/src/db/migrate.ts and redeploy.')
    process.exit(1)
  }

  console.log(`\n[drift] PASS — every column declared in schema.ts exists in the DB.`)
}

main().catch((err: unknown) => {
  console.error('[drift] crashed:', err)
  process.exit(2)
})
