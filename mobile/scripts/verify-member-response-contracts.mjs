// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Verify high-value client-consumed response fields against the live disposable Laravel fixture. */

import contractHelpers from './member-response-contracts.cjs';

const { validateConnectionStatus, validateListingSearch, validateMemberSearch } = contractHelpers;
const base = process.env.API_URL ?? 'http://127.0.0.1:8090';
const tenant = process.env.TENANT_SLUG ?? 'hour-timebank';
const password = process.env.E2E_TEST_PASSWORD ?? 'TestPassword123!';
const actors = {
  primary: ['e2e.user.a@project-nexus.local', password],
  secondary: ['e2e.user.b@project-nexus.local', password],
  admin: ['e2e.admin@project-nexus.local', process.env.E2E_ADMIN_PASSWORD ?? 'AdminPassword123!'],
};

async function request(path, { token, method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenant,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function login(label) {
  const [email, actorPassword] = actors[label];
  const payload = await request('/api/auth/login', { method: 'POST', body: { email, password: actorPassword } });
  const token = payload?.access_token ?? payload?.data?.access_token;
  const id = Number(payload?.user?.id ?? payload?.data?.user?.id);
  if (!token || !Number.isFinite(id)) throw new Error(`${label} login omitted access_token or user.id`);
  console.log(`response-contracts: ok   ${label} authenticated as user ${id}`);
  return { token, id };
}

const primary = await login('primary');
const secondary = await login('secondary');
const admin = await login('admin');

const checks = [
  ['primary listing search', primary.token, '/api/v2/listings?search=Bicycle%20Repair&per_page=20', validateListingSearch],
  ['primary member search', primary.token, '/api/v2/users?q=E2E%20UserB&offset=0', validateMemberSearch],
  ['primary connection mapping', primary.token, `/api/v2/connections/status/${secondary.id}`, validateConnectionStatus],
  ['secondary reverse connection mapping', secondary.token, `/api/v2/connections/status/${primary.id}`, validateConnectionStatus],
  ['admin member-directory contract', admin.token, '/api/v2/users?q=E2E%20UserA&offset=0', validateMemberSearch],
];

for (const [label, token, path, validate] of checks) {
  validate(await request(path, { token }));
  console.log(`response-contracts: ok   ${label}`);
}

console.log(`response-contracts: OK — ${checks.length} live fixture/role contracts accepted`);
