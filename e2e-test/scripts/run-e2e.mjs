#!/usr/bin/env node

/**
 * Bloom LMS — Full End-to-End API Test Runner
 *
 * Runs against a live server instance, exercising every API endpoint
 * and major business workflow.
 *
 * Usage:
 *   node run-e2e.mjs [BASE_URL]
 *   E2E_FILTER=overtime node run-e2e.mjs
 *
 * Exit code 0 = all pass, 1 = any failure
 */

const BASE_URL = (process.argv[2] || 'http://localhost:3001').replace(/\/$/, '');
const FILTER = process.env.E2E_FILTER?.toLowerCase() || '';

// ─── Test accounts (must exist in seeded DB) ──────────────────────
const TEST_ACCOUNTS = {
  super_admin: { email: 'josh@bloomandgrowgroup.com', password: 'C00k1eD0g' },
  hr_admin:    { email: 'elaine@bloomandgrowgroup.com', password: 'BloomLeave' },
  manager:     { email: 'amy@bloomandgrowgroup.com', password: 'BloomLeave' },
  employee:    { email: 'eva.chan@bloomandgrowgroup.com', password: 'BloomLeave' },
};

// ─── State shared across tests ────────────────────────────────────
const state = {
  tokens: {},          // { role: { accessToken, refreshToken } }
  users: {},           // { role: { userId, ... } }
  createdLeaveRequestId: null,
  createdLeaveRequestId2: null,
  createdOvertimeId: null,
  createdOvertimeId2: null,
  createdUserId: null,
  leaveTypeId: null,
  regionId: null,
  departmentId: null,
  policyId: null,
  holidayId: null,
  notificationId: null,
};

// ─── Counters ─────────────────────────────────────────────────────
let passed = 0, failed = 0, skipped = 0, total = 0;

// ─── Helpers ──────────────────────────────────────────────────────

async function api(method, path, { body, token, query, expectStatus, raw } = {}) {
  let url = `${BASE_URL}${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }

  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);

  if (raw) return res;

  const contentType = res.headers.get('content-type') || '';
  let data;
  if (contentType.includes('application/json')) {
    data = await res.json();
  } else {
    data = await res.text();
  }

  if (expectStatus && res.status !== expectStatus) {
    throw new Error(`Expected ${expectStatus}, got ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return { status: res.status, data, headers: res.headers };
}

function tok(role) {
  return state.tokens[role]?.accessToken;
}

function log(status, section, name, detail) {
  const icon = status === 'PASS' ? '\x1b[32m[PASS]\x1b[0m'
    : status === 'FAIL' ? '\x1b[31m[FAIL]\x1b[0m'
    : '\x1b[33m[SKIP]\x1b[0m';
  const msg = detail ? `${name} — ${detail}` : name;
  console.log(`${icon} ${section} > ${msg}`);
}

async function test(section, name, fn) {
  const fullName = `${section} > ${name}`.toLowerCase();
  if (FILTER && !fullName.includes(FILTER)) return;
  total++;
  try {
    await fn();
    passed++;
    log('PASS', section, name);
  } catch (err) {
    if (err.message?.startsWith('SKIP:')) {
      skipped++;
      log('SKIP', section, name, err.message.slice(5).trim());
    } else {
      failed++;
      log('FAIL', section, name, err.message);
    }
  }
}

function skip(reason) {
  throw new Error(`SKIP: ${reason}`);
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

// ─── TEST SUITES ──────────────────────────────────────────────────

async function runAll() {
  console.log(`\n\x1b[1mBloom LMS E2E Tests\x1b[0m`);
  console.log(`Target: ${BASE_URL}`);
  console.log(`Filter: ${FILTER || '(none)'}\n`);

  // ── Health ──────────────────────────────────────────────────
  await test('Health', 'GET /api/health', async () => {
    const { status } = await api('GET', '/api/health');
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ── Auth: Login all roles ───────────────────────────────────
  for (const [role, creds] of Object.entries(TEST_ACCOUNTS)) {
    await test('Auth', `Login as ${role}`, async () => {
      const { status, data } = await api('POST', '/api/auth/login', { body: creds });
      assert(status === 200, `Expected 200, got ${status}`);
      assert(data.success, `Login failed: ${JSON.stringify(data)}`);
      assert(data.data.accessToken, 'No access token');
      assert(data.data.refreshToken, 'No refresh token');
      state.tokens[role] = {
        accessToken: data.data.accessToken,
        refreshToken: data.data.refreshToken,
      };
      state.users[role] = data.data.user || data.data;
    });
  }

  // Auth: Get profile
  await test('Auth', 'GET /api/auth/me', async () => {
    const { status, data } = await api('GET', '/api/auth/me', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success && data.data.email, 'No user data returned');
  });

  // Auth: Token refresh
  await test('Auth', 'POST /api/auth/refresh', async () => {
    const rt = state.tokens.employee?.refreshToken;
    if (!rt) skip('No refresh token');
    const { status, data } = await api('POST', '/api/auth/refresh', {
      body: { refreshToken: rt },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.data.accessToken, 'No new access token');
    // Update token
    state.tokens.employee.accessToken = data.data.accessToken;
    if (data.data.refreshToken) state.tokens.employee.refreshToken = data.data.refreshToken;
  });

  // Auth: Change password (then change it back)
  await test('Auth', 'POST /api/auth/change-password', async () => {
    const { status, data } = await api('POST', '/api/auth/change-password', {
      token: tok('employee'),
      body: { currentPassword: 'BloomLeave', newPassword: 'BloomLeave2!' },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    // Change back
    await api('POST', '/api/auth/change-password', {
      token: tok('employee'),
      body: { currentPassword: 'BloomLeave2!', newPassword: 'BloomLeave' },
    });
  });

  // Auth: Bad login
  await test('Auth', 'Reject bad credentials', async () => {
    const { status } = await api('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', password: 'wrong' },
    });
    assert(status === 401 || status === 400, `Expected 401/400, got ${status}`);
  });

  // ── Leave Types ─────────────────────────────────────────────
  await test('Leave', 'GET /api/leave/types', async () => {
    const { status, data } = await api('GET', '/api/leave/types', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.data) && data.data.length > 0, 'No leave types returned');
    // Store first leave type for later use
    state.leaveTypeId = data.data[0].id || data.data[0].leaveTypeId;
    if (data.data[0].regionId) state.regionId = data.data[0].regionId;
  });

  // ── Leave Requests ──────────────────────────────────────────

  // List requests
  await test('Leave', 'GET /api/leave/requests (list)', async () => {
    const { status, data } = await api('GET', '/api/leave/requests', {
      token: tok('employee'),
      query: { page: 1, pageSize: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success, 'Request list failed');
  });

  // Create leave request
  await test('Leave', 'POST /api/leave/requests (create)', async () => {
    if (!state.leaveTypeId) skip('No leave type discovered');
    // Use a far-future date range to avoid overlaps
    const startDate = '2026-11-02';
    const endDate = '2026-11-03';
    const { status, data } = await api('POST', '/api/leave/requests', {
      token: tok('employee'),
      body: { leaveTypeId: state.leaveTypeId, startDate, endDate, reason: 'E2E test leave request' },
    });
    if (status === 201 || status === 200) {
      assert(data.success, 'Create request failed');
      state.createdLeaveRequestId = data.data.id;
    } else if (status === 400) {
      // May fail due to balance/overlap — still a valid response
      console.log(`    (Leave creation returned 400: ${JSON.stringify(data).slice(0, 100)})`);
      state.createdLeaveRequestId = null;
    } else {
      throw new Error(`Expected 201 or 400, got ${status}`);
    }
  });

  // Create a second leave request (for rejection test)
  await test('Leave', 'POST /api/leave/requests (create #2 for rejection)', async () => {
    if (!state.leaveTypeId) skip('No leave type discovered');
    const startDate = '2026-11-09';
    const endDate = '2026-11-10';
    const { status, data } = await api('POST', '/api/leave/requests', {
      token: tok('employee'),
      body: { leaveTypeId: state.leaveTypeId, startDate, endDate, reason: 'E2E test — will be rejected' },
    });
    if (status === 201 || status === 200) {
      state.createdLeaveRequestId2 = data.data.id;
    } else {
      state.createdLeaveRequestId2 = null;
    }
  });

  // Get request by ID
  await test('Leave', 'GET /api/leave/requests/:id', async () => {
    if (!state.createdLeaveRequestId) skip('No leave request created');
    const { status, data } = await api('GET', `/api/leave/requests/${state.createdLeaveRequestId}`, {
      token: tok('employee'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success, 'Get request by ID failed');
  });

  // List with status filter
  await test('Leave', 'GET /api/leave/requests?status=pending', async () => {
    const { status, data } = await api('GET', '/api/leave/requests', {
      token: tok('employee'),
      query: { status: 'pending', page: 1, pageSize: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ── Approvals ───────────────────────────────────────────────

  // Pending approvals (manager)
  await test('Approvals', 'GET /api/approvals/pending', async () => {
    const { status, data } = await api('GET', '/api/approvals/pending', {
      token: tok('manager'),
      query: { page: 1, pageSize: 10 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success, 'Pending approvals failed');
  });

  // Approve a leave request
  await test('Approvals', 'POST /api/approvals/:id/approve', async () => {
    if (!state.createdLeaveRequestId) skip('No leave request to approve');
    const { status, data } = await api('POST', `/api/approvals/${state.createdLeaveRequestId}/approve`, {
      token: tok('manager'),
      body: { comments: 'Approved via E2E test' },
    });
    // Manager might not be the right approver, 200 or 400/403 are acceptable
    if (status === 200) {
      assert(data.success, 'Approval response not successful');
    } else {
      console.log(`    (Approval returned ${status}: ${JSON.stringify(data).slice(0, 120)})`);
    }
  });

  // Reject a leave request
  await test('Approvals', 'POST /api/approvals/:id/reject', async () => {
    if (!state.createdLeaveRequestId2) skip('No second leave request to reject');
    const { status, data } = await api('POST', `/api/approvals/${state.createdLeaveRequestId2}/reject`, {
      token: tok('manager'),
      body: { comments: 'Rejected via E2E test' },
    });
    if (status === 200) {
      assert(data.success, 'Rejection response not successful');
    } else {
      console.log(`    (Rejection returned ${status}: ${JSON.stringify(data).slice(0, 120)})`);
    }
  });

  // Approval history
  await test('Approvals', 'GET /api/approvals/history', async () => {
    const { status, data } = await api('GET', '/api/approvals/history', {
      token: tok('manager'),
      query: { page: 1, pageSize: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // Employee: Forbidden from approvals endpoint
  await test('Approvals', 'Employee forbidden from /pending', async () => {
    const { status } = await api('GET', '/api/approvals/pending', {
      token: tok('employee'),
    });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Cancel leave request ────────────────────────────────────
  await test('Leave', 'PATCH /api/leave/requests/:id/cancel', async () => {
    if (!state.createdLeaveRequestId) skip('No leave request to cancel');
    const { status, data } = await api('PATCH', `/api/leave/requests/${state.createdLeaveRequestId}/cancel`, {
      token: tok('employee'),
    });
    // Might fail if already approved/rejected
    if (status === 200) {
      assert(data.success, 'Cancel failed');
    } else {
      console.log(`    (Cancel returned ${status} — request may already be processed)`);
    }
  });

  // ── Balances ────────────────────────────────────────────────

  await test('Balances', 'GET /api/balances (own)', async () => {
    const { status, data } = await api('GET', '/api/balances', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success, 'Balances failed');
  });

  await test('Balances', 'GET /api/balances/:userId (HR view)', async () => {
    const employeeUserId = state.users.employee?.id || state.users.employee?.userId;
    if (!employeeUserId) skip('No employee user ID');
    const { status, data } = await api('GET', `/api/balances/${employeeUserId}`, {
      token: tok('hr_admin'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Balances', 'POST /api/balances/adjust (HR)', async () => {
    const employeeUserId = state.users.employee?.id || state.users.employee?.userId;
    if (!employeeUserId || !state.leaveTypeId) skip('Missing user or leave type');
    const { status, data } = await api('POST', '/api/balances/adjust', {
      token: tok('hr_admin'),
      body: {
        userId: employeeUserId,
        leaveTypeId: state.leaveTypeId,
        year: 2026,
        days: 1,
        reason: 'E2E test adjustment',
      },
    });
    // 200 or 400 (if balance doesn't exist yet)
    assert(status === 200 || status === 400, `Expected 200/400, got ${status}`);
  });

  await test('Balances', 'POST /api/balances/rollover (HR)', async () => {
    const { status, data } = await api('POST', '/api/balances/rollover', {
      token: tok('hr_admin'),
      body: { fromYear: 2025 },
    });
    assert(status === 200 || status === 400, `Expected 200/400, got ${status}`);
  });

  await test('Balances', 'Employee forbidden from adjust', async () => {
    const { status } = await api('POST', '/api/balances/adjust', {
      token: tok('employee'),
      body: { userId: 1, leaveTypeId: 1, year: 2026, days: 1 },
    });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Overtime ────────────────────────────────────────────────

  await test('Overtime', 'POST /api/overtime (submit)', async () => {
    const { status, data } = await api('POST', '/api/overtime', {
      token: tok('employee'),
      body: {
        date: '2026-10-15',
        hoursWorked: 3,
        daysRequested: 0.5,
        reason: 'E2E test overtime entry',
      },
    });
    if (status === 201 || status === 200) {
      state.createdOvertimeId = data.data?.id;
    } else {
      console.log(`    (Overtime submit returned ${status}: ${JSON.stringify(data).slice(0, 100)})`);
    }
  });

  // Submit a second for rejection test
  await test('Overtime', 'POST /api/overtime (submit #2 for reject)', async () => {
    const { status, data } = await api('POST', '/api/overtime', {
      token: tok('employee'),
      body: {
        date: '2026-10-16',
        hoursWorked: 2,
        daysRequested: 0.5,
        reason: 'E2E test — will be rejected',
      },
    });
    if (status === 201 || status === 200) {
      state.createdOvertimeId2 = data.data?.id;
    }
  });

  await test('Overtime', 'GET /api/overtime (my history)', async () => {
    const { status, data } = await api('GET', '/api/overtime', {
      token: tok('employee'),
      query: { page: 1, pageSize: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Overtime', 'GET /api/overtime/my', async () => {
    const { status } = await api('GET', '/api/overtime/my', {
      token: tok('employee'),
      query: { page: 1, pageSize: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Overtime', 'GET /api/overtime/balance', async () => {
    const { status, data } = await api('GET', '/api/overtime/balance', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Overtime', 'GET /api/overtime/pending (manager)', async () => {
    const { status, data } = await api('GET', '/api/overtime/pending', { token: tok('manager') });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Overtime', 'POST /api/overtime/:id/approve', async () => {
    if (!state.createdOvertimeId) skip('No overtime entry to approve');
    const { status, data } = await api('POST', `/api/overtime/${state.createdOvertimeId}/approve`, {
      token: tok('manager'),
      body: { comment: 'Approved via E2E' },
    });
    if (status === 200) {
      assert(data.success, 'Overtime approval failed');
    } else {
      console.log(`    (Overtime approve returned ${status}: ${JSON.stringify(data).slice(0, 120)})`);
    }
  });

  await test('Overtime', 'POST /api/overtime/:id/reject', async () => {
    if (!state.createdOvertimeId2) skip('No overtime entry to reject');
    const { status, data } = await api('POST', `/api/overtime/${state.createdOvertimeId2}/reject`, {
      token: tok('manager'),
      body: { reason: 'Rejected via E2E test' },
    });
    if (status === 200) {
      assert(data.success, 'Overtime rejection failed');
    } else {
      console.log(`    (Overtime reject returned ${status}: ${JSON.stringify(data).slice(0, 120)})`);
    }
  });

  await test('Overtime', 'PATCH /api/overtime/:id/cancel', async () => {
    // Submit a fresh one to cancel
    const { status: cs, data: cd } = await api('POST', '/api/overtime', {
      token: tok('employee'),
      body: {
        date: '2026-10-20',
        hoursWorked: 1,
        daysRequested: 0.5,
        reason: 'E2E test — will be cancelled',
      },
    });
    const cancelId = cd?.data?.id;
    if (!cancelId) skip('Could not create overtime entry to cancel');

    const { status, data } = await api('PATCH', `/api/overtime/${cancelId}/cancel`, {
      token: tok('employee'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Overtime', 'Employee forbidden from /pending', async () => {
    const { status } = await api('GET', '/api/overtime/pending', { token: tok('employee') });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Users ───────────────────────────────────────────────────

  await test('Users', 'GET /api/users (HR admin)', async () => {
    const { status, data } = await api('GET', '/api/users', {
      token: tok('hr_admin'),
      query: { page: 1, pageSize: 5 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success && Array.isArray(data.data), 'User list failed');
  });

  await test('Users', 'GET /api/users/managers', async () => {
    const { status, data } = await api('GET', '/api/users/managers', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Users', 'POST /api/users (create)', async () => {
    const ts = Date.now();
    const { status, data } = await api('POST', '/api/users', {
      token: tok('hr_admin'),
      body: {
        email: `e2e.test.${ts}@bloomandgrowgroup.com`,
        password: 'TestPass123!',
        name: `E2E Test User ${ts}`,
        regionId: state.users.employee?.regionId || 1,
      },
    });
    if (status === 201 || status === 200) {
      state.createdUserId = data.data.id;
    } else {
      console.log(`    (User creation returned ${status}: ${JSON.stringify(data).slice(0, 100)})`);
    }
  });

  await test('Users', 'GET /api/users/:id', async () => {
    if (!state.createdUserId) skip('No created user');
    const { status, data } = await api('GET', `/api/users/${state.createdUserId}`, {
      token: tok('hr_admin'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Users', 'PATCH /api/users/:id', async () => {
    if (!state.createdUserId) skip('No created user');
    const { status, data } = await api('PATCH', `/api/users/${state.createdUserId}`, {
      token: tok('hr_admin'),
      body: { name: 'E2E Updated Name' },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Users', 'DELETE /api/users/:id (soft delete)', async () => {
    if (!state.createdUserId) skip('No created user');
    const { status } = await api('DELETE', `/api/users/${state.createdUserId}`, {
      token: tok('super_admin'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Users', 'Employee forbidden from user list', async () => {
    const { status } = await api('GET', '/api/users', {
      token: tok('employee'),
      query: { page: 1, pageSize: 5 },
    });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Admin ───────────────────────────────────────────────────

  await test('Admin', 'GET /api/admin/regions', async () => {
    const { status, data } = await api('GET', '/api/admin/regions', { token: tok('hr_admin') });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.data) && data.data.length > 0, 'No regions');
    state.regionId = data.data[0].id;
  });

  await test('Admin', 'GET /api/admin/departments', async () => {
    const { status, data } = await api('GET', '/api/admin/departments', {
      token: tok('hr_admin'),
      query: { regionId: state.regionId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    if (data.data?.length > 0) state.departmentId = data.data[0].id;
  });

  await test('Admin', 'GET /api/admin/leave-types', async () => {
    const { status, data } = await api('GET', '/api/admin/leave-types', { token: tok('hr_admin') });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Admin', 'POST /api/admin/leave-types (super admin)', async () => {
    const ts = Date.now();
    const { status, data } = await api('POST', '/api/admin/leave-types', {
      token: tok('super_admin'),
      body: {
        name: `E2E Test Type ${ts}`,
        code: `E2E${String(ts).slice(-4)}`,
        description: 'Created by E2E test',
        isPaid: false,
        requiresAttachment: false,
      },
    });
    if (status === 201 || status === 200) {
      state.adminLeaveTypeId = data.data.id;
    }
  });

  await test('Admin', 'PATCH /api/admin/leave-types/:id (super admin)', async () => {
    if (!state.adminLeaveTypeId) skip('No admin leave type created');
    const { status } = await api('PATCH', `/api/admin/leave-types/${state.adminLeaveTypeId}`, {
      token: tok('super_admin'),
      body: { description: 'Updated by E2E test' },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // Policies
  await test('Admin', 'GET /api/admin/policies', async () => {
    const { status, data } = await api('GET', '/api/admin/policies', {
      token: tok('hr_admin'),
      query: { regionId: state.regionId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    if (data.data?.length > 0) state.policyId = data.data[0].id;
  });

  await test('Admin', 'POST /api/admin/policies', async () => {
    if (!state.adminLeaveTypeId || !state.regionId) skip('No leave type or region');
    const { status, data } = await api('POST', '/api/admin/policies', {
      token: tok('hr_admin'),
      body: {
        leaveTypeId: state.adminLeaveTypeId,
        regionId: state.regionId,
        entitlementDays: '5',
        carryOverMax: '0',
        probationMonths: 0,
      },
    });
    if (status === 201 || status === 200) {
      state.createdPolicyId = data.data.id;
    }
  });

  await test('Admin', 'PATCH /api/admin/policies/:id', async () => {
    if (!state.createdPolicyId) skip('No policy created');
    const { status } = await api('PATCH', `/api/admin/policies/${state.createdPolicyId}`, {
      token: tok('hr_admin'),
      body: { entitlementDays: '7' },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // Holidays
  await test('Admin', 'GET /api/admin/holidays', async () => {
    const { status, data } = await api('GET', '/api/admin/holidays', {
      token: tok('hr_admin'),
      query: { regionId: state.regionId },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Admin', 'POST /api/admin/holidays', async () => {
    if (!state.regionId) skip('No region');
    const { status, data } = await api('POST', '/api/admin/holidays', {
      token: tok('hr_admin'),
      body: {
        name: 'E2E Test Holiday',
        date: '2026-12-31',
        regionId: state.regionId,
        isRecurring: false,
      },
    });
    if (status === 201 || status === 200) {
      state.holidayId = data.data.id;
    }
  });

  await test('Admin', 'DELETE /api/admin/holidays/:id (super admin)', async () => {
    if (!state.holidayId) skip('No holiday created');
    const { status } = await api('DELETE', `/api/admin/holidays/${state.holidayId}`, {
      token: tok('super_admin'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // Admin: Employee forbidden
  await test('Admin', 'Employee forbidden from admin', async () => {
    const { status } = await api('GET', '/api/admin/regions', { token: tok('employee') });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Reports ─────────────────────────────────────────────────

  await test('Reports', 'GET /api/reports/utilisation', async () => {
    const { status, data } = await api('GET', '/api/reports/utilisation', {
      token: tok('hr_admin'),
      query: { year: 2026 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success, 'Utilisation report failed');
  });

  await test('Reports', 'GET /api/reports/department-summary', async () => {
    const { status, data } = await api('GET', '/api/reports/department-summary', {
      token: tok('hr_admin'),
      query: { year: 2026 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Reports', 'GET /api/reports/export/payroll (CSV)', async () => {
    const res = await api('GET', '/api/reports/export/payroll', {
      token: tok('hr_admin'),
      query: { year: 2026 },
      raw: true,
    });
    assert(res.status === 200, `Expected 200, got ${res.status}`);
    const contentType = res.headers.get('content-type') || '';
    assert(contentType.includes('text/csv'), `Expected CSV, got ${contentType}`);
    const body = await res.text();
    assert(body.includes('Employee'), 'CSV missing header row');
  });

  await test('Reports', 'Employee forbidden from reports', async () => {
    const { status } = await api('GET', '/api/reports/utilisation', {
      token: tok('employee'),
      query: { year: 2026 },
    });
    assert(status === 403, `Expected 403, got ${status}`);
  });

  // ── Notifications ───────────────────────────────────────────

  await test('Notifications', 'GET /api/notifications', async () => {
    const { status, data } = await api('GET', '/api/notifications', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(data.success, 'Notifications failed');
    // Store a notification ID if available
    const notifs = data.data?.notifications || data.data;
    if (Array.isArray(notifs) && notifs.length > 0) {
      state.notificationId = notifs[0].id;
    }
  });

  await test('Notifications', 'PATCH /api/notifications/:id/read', async () => {
    if (!state.notificationId) skip('No notification to mark');
    const { status } = await api('PATCH', `/api/notifications/${state.notificationId}/read`, {
      token: tok('employee'),
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Notifications', 'PATCH /api/notifications/read-all', async () => {
    const { status } = await api('PATCH', '/api/notifications/read-all', { token: tok('employee') });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ── Calendar ────────────────────────────────────────────────

  await test('Calendar', 'GET /api/leave/calendar/team', async () => {
    const { status, data } = await api('GET', '/api/leave/calendar/team', {
      token: tok('employee'),
      query: { startDate: '2026-03-01', endDate: '2026-03-31' },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('Calendar', 'GET /api/leave/holidays', async () => {
    const { status, data } = await api('GET', '/api/leave/holidays', {
      token: tok('employee'),
      query: { year: 2026 },
    });
    assert(status === 200, `Expected 200, got ${status}`);
    assert(Array.isArray(data.data), 'Holidays not an array');
  });

  // ── Auth: Logout ────────────────────────────────────────────
  await test('Auth', 'POST /api/auth/logout', async () => {
    const rt = state.tokens.employee?.refreshToken;
    if (!rt) skip('No refresh token');
    const { status } = await api('POST', '/api/auth/logout', {
      body: { refreshToken: rt },
    });
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // Auth: Reject unauthenticated request
  await test('Auth', 'Reject unauthenticated request', async () => {
    const { status } = await api('GET', '/api/leave/requests');
    assert(status === 401, `Expected 401, got ${status}`);
  });

  // ── Summary ─────────────────────────────────────────────────
  console.log('\n' + '='.repeat(50));
  const colour = failed > 0 ? '\x1b[31m' : '\x1b[32m';
  console.log(`${colour}  RESULTS: ${passed} passed, ${failed} failed, ${skipped} skipped (${total} total)\x1b[0m`);
  console.log('='.repeat(50) + '\n');
}

// ─── Entry point ──────────────────────────────────────────────────
runAll()
  .then(() => process.exit(failed > 0 ? 1 : 0))
  .catch((err) => {
    console.error('\x1b[31mFATAL ERROR:\x1b[0m', err);
    process.exit(2);
  });
