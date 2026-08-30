// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Verify high-value client-consumed response fields against the live disposable Laravel fixture. */

import contractHelpers from './member-response-contracts.cjs';

const {
  validateCanonicalEvents,
  validateConnectionStatus,
  validateListingSearch,
  validateMarketplaceSearch,
  validateMatchesPayload,
  validateMemberSearch,
  validateOrganisationCollection,
  validateOrganisationStats,
  validateOwnedOrganisation,
  validateVolunteeringSearch,
} = contractHelpers;
const base = process.env.API_URL ?? 'http://127.0.0.1:8090';
const tenant = process.env.TENANT_SLUG ?? 'hour-timebank';
const password = process.env.E2E_TEST_PASSWORD ?? 'TestPassword123!';
const actors = {
  primary: ['e2e.user.a@project-nexus.local', password],
  secondary: ['e2e.user.b@project-nexus.local', password],
  admin: ['e2e.admin@project-nexus.local', process.env.E2E_ADMIN_PASSWORD ?? 'AdminPassword123!'],
};

async function request(path, { token, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Tenant-Slug': tenant,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
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
  ['primary canonical Events contract', primary.token, '/api/v2/events?when=upcoming&per_page=20', validateCanonicalEvents, { 'X-Events-Contract': '2' }],
  ['primary marketplace fixture contract', primary.token, '/api/v2/marketplace/listings?q=E2E%20Marketplace%20Bicycle%20Helmet&limit=20', validateMarketplaceSearch],
  ['primary volunteering fixture contract', primary.token, '/api/v2/volunteering/opportunities?search=E2E%20Community%20Garden%20Volunteer', validateVolunteeringSearch],
  ['primary Matches mapping source contract', primary.token, '/api/v2/matches/all', validateMatchesPayload],
];

let accepted = 0;
for (const [label, token, path, validate, headers] of checks) {
  validate(await request(path, { token, headers }));
  console.log(`response-contracts: ok   ${label}`);
  accepted += 1;
}

const ownedOrganisations = await request('/api/v2/volunteering/my-organisations?per_page=50', {
  token: secondary.token,
});
validateOwnedOrganisation(ownedOrganisations);
const organisationId = Number(ownedOrganisations.data[0].id);
console.log('response-contracts: ok   secondary owned-organisation discovery');
accepted += 1;

const ownerChecks = [
  ['secondary organisation stats', `/api/v2/volunteering/organisations/${organisationId}/stats`, validateOrganisationStats],
  ['secondary organisation applications', `/api/v2/volunteering/organisations/${organisationId}/applications?per_page=20`, (body) => validateOrganisationCollection(body, 'organisation applications')],
  ['secondary organisation pending hours', `/api/v2/volunteering/organisations/${organisationId}/hours/pending?per_page=20`, (body) => validateOrganisationCollection(body, 'organisation pending hours')],
  ['secondary organisation volunteers', `/api/v2/volunteering/organisations/${organisationId}/volunteers?per_page=20`, (body) => validateOrganisationCollection(body, 'organisation volunteers')],
  ['secondary organisation wallet history', `/api/v2/volunteering/organisations/${organisationId}/wallet/transactions?per_page=20`, (body) => validateOrganisationCollection(body, 'organisation wallet history')],
];

for (const [label, path, validate] of ownerChecks) {
  validate(await request(path, { token: secondary.token }));
  console.log(`response-contracts: ok   ${label}`);
  accepted += 1;
}

console.log(`response-contracts: OK — ${accepted} live fixture/role contracts accepted`);
