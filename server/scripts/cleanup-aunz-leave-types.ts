/**
 * cleanup-aunz-leave-types.ts
 *
 * Checks for linked records then deletes:
 *   - "Maternity Leave AU/NZ"
 *   - "No Pay Leave - AU/NZ"
 *
 * Will NOT touch:
 *   - "Long Service Leave (AU)"
 *   - "Long Service Leave (NZ)"
 *
 * Run from the server directory:
 *   npx tsx scripts/cleanup-aunz-leave-types.ts
 */

import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { eq, inArray, sql } from 'drizzle-orm'
import * as schema from '../src/db/schema.js'

const { leaveTypes, leaveRequests, leaveBalances, leavePolicies } = schema

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const db = drizzle(pool, { schema })

const TARGETS = ['Maternity Leave AU/NZ', 'No Pay Leave - AU/NZ']
const PROTECTED = ['Long Service Leave (AU)', 'Long Service Leave (NZ)']

async function main() {
  console.log('\n========================================')
  console.log(' AU/NZ Leave Type Cleanup Script')
  console.log('========================================\n')

  // ── 1. Confirm protected types are untouched ──────────────────────────────
  const protected_ = await db
    .select({ id: leaveTypes.id, name: leaveTypes.name })
    .from(leaveTypes)
    .where(inArray(leaveTypes.name, PROTECTED))

  console.log('Protected types (will NOT be touched):')
  if (protected_.length === 0) {
    console.log('  ⚠️  None found in DB — they may already be named differently')
  } else {
    protected_.forEach((lt) => console.log(`  ✅  [${lt.id}] ${lt.name}`))
  }
  console.log()

  // ── 2. Find target leave types ────────────────────────────────────────────
  const targets = await db
    .select({ id: leaveTypes.id, name: leaveTypes.name, isActive: leaveTypes.isActive })
    .from(leaveTypes)
    .where(inArray(leaveTypes.name, TARGETS))

  if (targets.length === 0) {
    console.log('✅  Neither target leave type exists in the database. Nothing to do.')
    await pool.end()
    return
  }

  console.log('Target leave types found:')
  targets.forEach((lt) =>
    console.log(`  [${lt.id}] ${lt.name} (active: ${lt.isActive})`)
  )
  console.log()

  const targetIds = targets.map((lt) => lt.id)

  // ── 3. Check linked records ───────────────────────────────────────────────
  const [{ requestCount }] = await db
    .select({ requestCount: sql<number>`count(*)::int` })
    .from(leaveRequests)
    .where(inArray(leaveRequests.leaveTypeId, targetIds))

  const [{ balanceCount }] = await db
    .select({ balanceCount: sql<number>`count(*)::int` })
    .from(leaveBalances)
    .where(inArray(leaveBalances.leaveTypeId, targetIds))

  const [{ policyCount }] = await db
    .select({ policyCount: sql<number>`count(*)::int` })
    .from(leavePolicies)
    .where(inArray(leavePolicies.leaveTypeId, targetIds))

  console.log('Linked record check:')
  console.log(`  Leave requests : ${requestCount}`)
  console.log(`  Leave balances : ${balanceCount}`)
  console.log(`  Policies       : ${policyCount}`)
  console.log()

  const hasLinkedRecords = requestCount > 0 || balanceCount > 0 || policyCount > 0

  if (hasLinkedRecords) {
    console.log('⛔  LINKED RECORDS EXIST — deletion blocked.')
    console.log('    Please review the data above and confirm with your developer')
    console.log('    before proceeding. No changes have been made.\n')
    await pool.end()
    return
  }

  // ── 4. Safe to delete ─────────────────────────────────────────────────────
  console.log('✅  No linked records found. Proceeding with deletion...\n')

  for (const lt of targets) {
    await db.delete(leaveTypes).where(eq(leaveTypes.id, lt.id))
    console.log(`  🗑️   Deleted: [${lt.id}] ${lt.name}`)
  }

  console.log('\n✅  Cleanup complete.')

  // ── 5. Confirm protected types still exist ────────────────────────────────
  const stillProtected = await db
    .select({ id: leaveTypes.id, name: leaveTypes.name })
    .from(leaveTypes)
    .where(inArray(leaveTypes.name, PROTECTED))

  console.log('\nProtected types still present:')
  stillProtected.forEach((lt) => console.log(`  ✅  [${lt.id}] ${lt.name}`))
  console.log()

  await pool.end()
}

main().catch((err) => {
  console.error('Script failed:', err)
  process.exit(1)
})
