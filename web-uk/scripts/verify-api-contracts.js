#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Verify the API contracts web-uk depends on against a RUNNING Laravel.
 *
 * Why this exists: `frontend-api-consumer-ledger.json` records 696 contracts, but it is
 * produced by reading source code. Its `responseShape` is the generic "JSON/text response
 * via ApiError-aware request" and its `statusCodes` are usually empty — so it proves the
 * call exists in the frontend and that Laravel declares a matching route. It cannot say
 * what the endpoint actually returns, whether it refuses an anonymous caller, or whether
 * it answers at all. Every "contract verified" claim rested on that.
 *
 * This script converts declarations into evidence. For every parameterless GET contract
 * in the ledger it records, against the disposable environment:
 *
 *   - the status for an ANONYMOUS caller
 *   - the status for an AUTHENTICATED member
 *   - the top-level response keys actually returned
 *
 * and then applies three invariants that need no per-endpoint knowledge:
 *
 *   1. An endpoint must not answer 5xx to a well-formed request. A 500 is a defect
 *      regardless of what the endpoint is for.
 *   2. An endpoint that serves a signed-in member must NOT serve an anonymous caller.
 *      An anonymous 200 where a member gets 200 is a potential data exposure.
 *   3. A 200 must carry a recognisable response envelope, so the frontend's unwrapping
 *      cannot silently read `undefined`.
 *
 * 🔴 Runs against the DISPOSABLE environment only, and refuses otherwise: it makes
 * unauthenticated requests to every member endpoint, which must never be aimed at a
 * database holding real members.
 *
 * Usage:
 *   bash ../scripts/webuk-e2e-env.sh up     # from the repo root
 *   npm run api:verify                      # from web-uk/
 */

const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildNoTokenIndex, noTokenFinding } = require('./ledger-token-crosscheck');

const API = process.env.WEBUK_CONTRACT_API_URL || 'http://127.0.0.1:8091';
const TENANT = process.env.WEBUK_CONTRACT_TENANT || 'e2e-community';
const DB_NAME = 'nexus_webuk_e2e';
const DB_CONTAINER = 'nexus-php-db';
const LEDGER = path.join(__dirname, '..', 'docs', 'generated', 'frontend-api-consumer-ledger.json');
const OUT_JSON = path.join(__dirname, '..', 'docs', 'generated', 'api-contract-verification.json');
const OUT_MD = path.join(__dirname, '..', 'docs', 'generated', 'api-contract-verification.md');

const MEMBER = {
  email: process.env.WEBUK_CONTRACT_EMAIL || 'e2e.user.a@project-nexus.local',
  password: process.env.WEBUK_CONTRACT_PASSWORD || 'TestPassword123!',
};

// Endpoints that are PUBLIC by design: an anonymous 200 is correct, not an exposure.
// Every entry is a deliberate decision, not a way of silencing a finding.
const PUBLIC_BY_DESIGN = [
  /\/auth\//,
  /\/tenant\/bootstrap/,
  /\/registration-info/,
  /\/legal/,
  /\/health/,
  /\/categories/,
  /\/skills\/categories/,
  /\/public\//,
  // Aggregate counts only — members, hours exchanged, listings, skills, communities.
  // Checked, not assumed: the anonymous response carries no personal data, and the
  // public home page renders these figures for signed-out visitors.
  /\/platform\/stats/,
  // Laravel declares this one public explicitly — `routes/api.php` carries
  // `->withoutMiddleware('auth:sanctum')` on it, because a member has to be able to
  // read what the paid tiers cost BEFORE deciding to become one. Verified against
  // the live route, not assumed from the name; the anonymous body is the tier
  // price list and nothing member-specific.
  /\/member-premium\/tiers$/,
];

// Endpoints that legitimately return something other than JSON: a CSV statement, an
// iCalendar feed. A non-JSON 200 from these is the contract, not a defect.
const NON_JSON_BY_DESIGN = [
  /\.ics$/,
  /\/wallet\/statement/,
  /export(\.csv)?$/,
];

function isPublicByDesign(p) {
  return PUBLIC_BY_DESIGN.some((re) => re.test(p));
}

function isNonJsonByDesign(p) {
  return NON_JSON_BY_DESIGN.some((re) => re.test(p));
}

// 🔴 The guard below must RUN everywhere this script runs — it is the thing standing
// between a contract sweep and a database of real members. On a developer's machine
// the database is a container, so `docker exec` reaches it. On a CI runner it is a
// service container with a client on the PATH and no such name, and the original
// invocation could only fail there. Rather than let CI skip the guard, CI supplies
// the client command and the SAME two queries run through it. The escape hatch
// changes HOW the database is reached, never WHETHER it is checked: there is
// deliberately no flag that turns this off.
function databaseQueryCommand() {
  const override = (process.env.WEBUK_CONTRACT_MYSQL_CMD || '').trim();
  if (override) {
    const parts = override.split(/\s+/);
    return { file: parts[0], args: parts.slice(1) };
  }
  return {
    file: 'docker',
    args: ['exec', DB_CONTAINER, 'mysql', '--skip-ssl', '-h', '127.0.0.1',
      '-unexus', '-pnexus_secret', DB_NAME],
  };
}

function assertDisposableDatabase() {
  const cmd = databaseQueryCommand();
  const query = (sql) => execFileSync(cmd.file, [...cmd.args, '-N', '-e', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

  const total = Number(query('SELECT COUNT(*) FROM users;'));
  const real = Number(query(
    "SELECT COUNT(*) FROM users WHERE email NOT LIKE '%@project-nexus.local' AND email NOT LIKE '%@example.%';"
  ));
  if (!total) throw new Error(`${DB_NAME} has no users — bring the environment up first.`);
  if (real > 0) {
    throw new Error(`🔴 REFUSING: ${real} of ${total} accounts are not synthetic.`);
  }
  console.log(`guard ok: ${total} synthetic accounts, 0 real`);
}

async function signIn() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Tenant-Slug': TENANT },
    body: JSON.stringify(MEMBER),
  });
  const body = await res.json().catch(() => ({}));
  const token = body.access_token;
  if (!token) throw new Error(`Could not sign in as ${MEMBER.email} (HTTP ${res.status}).`);
  return token;
}

async function call(url, token) {
  const headers = { 'X-Tenant-Slug': TENANT, accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let keys = null;
    try {
      const parsed = JSON.parse(text);
      keys = parsed && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 8) : null;
    } catch { /* not JSON — recorded as such by keys staying null */ }
    return { status: res.status, keys, isJson: keys !== null };
  } catch (error) {
    return { status: 0, keys: null, isJson: false, error: error.message };
  }
}

async function main() {
  assertDisposableDatabase();
  const ledger = JSON.parse(await fs.readFile(LEDGER, 'utf8'));
  const usable = ledger.rows.filter((r) => r.method === 'GET' && !/[:{]|\$/.test(r.path));
  const paths = [...new Set(usable.map((r) => r.path))].sort();

  // 🔴 The defect this exists for, stated plainly, because the ledger cannot see it.
  // `/organisations` was broken for every member for as long as the page existed:
  // `getVolunteerOrganisations` sent no bearer token to an endpoint that 401s
  // anonymously. The ledger scored that page as fully covered, because it records
  // that a test names the helper — not that the request would have worked. The
  // ledger's own classifier already reads each helper's source and labels it
  // `guest`, `optional` or `required`; this sweep already learns, from the live API,
  // whether an anonymous call is refused. Crossing the two turns an invisible defect
  // into a failing check: a helper that sends no token, calling an endpoint that
  // demands one, is broken for every member no matter how many tests name it.
  const sendsNoToken = buildNoTokenIndex(usable);

  console.log(`verifying ${paths.length} parameterless GET contracts against ${API}\n`);
  const token = await signIn();

  const results = [];
  for (const p of paths) {
    const url = `${API}${p}`;
    const anon = await call(url, null);
    const auth = await call(url, token);

    const findings = [];
    if (auth.status >= 500) findings.push(`server error for a signed-in member (${auth.status})`);
    if (anon.status >= 500) findings.push(`server error for an anonymous caller (${anon.status})`);
    if (auth.status === 200 && anon.status === 200 && !isPublicByDesign(p)) {
      findings.push('served to an anonymous caller as well as a member');
    }
    const noToken = noTokenFinding(p, anon.status, sendsNoToken);
    if (noToken) findings.push(noToken);
    if (auth.status === 200 && !auth.isJson && !isNonJsonByDesign(p)) {
      findings.push('200 response is not JSON');
    }
    if (auth.status === 200 && auth.isJson
      && !(auth.keys || []).some((k) => ['data', 'success', 'errors', 'meta', 'results'].includes(k))) {
      findings.push(`200 response has no recognisable envelope (keys: ${(auth.keys || []).join(', ') || 'none'})`);
    }

    // 🔴 A 403 to a signed-in member is NOT a fault — it is a module the community has not
    // switched on. Recorded as its own category so this artefact cannot be read as "every
    // endpoint is reachable": on the fixture community, roughly a fifth are gated off.
    const moduleGated = auth.status === 403;

    results.push({
      path: p,
      anonymousStatus: anon.status,
      memberStatus: auth.status,
      responseKeys: auth.keys,
      moduleGated,
      findings,
    });
    const mark = findings.length ? '🔴' : 'ok';
    console.log(`  ${mark} ${String(auth.status).padEnd(3)} anon=${String(anon.status).padEnd(3)} ${p}${findings.length ? `  — ${findings[0]}` : ''}`);
  }

  const withFindings = results.filter((r) => r.findings.length);
  const payload = {
    // No timestamp: this file is committed, and a timestamp would produce a diff on every
    // run even when nothing about the API had changed.
    source: 'disposable journey environment (synthetic accounts only)',
    tenant: TENANT,
    contractsVerified: results.length,
    contractsWithFindings: withFindings.length,
    contractsModuleGatedForThisCommunity: results.filter((r) => r.moduleGated).length,
    results,
  };
  await fs.writeFile(OUT_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  const md = [
    '# API contract verification',
    '',
    'Generated by `npm run api:verify` against the disposable journey environment.',
    'Do not hand-edit.',
    '',
    '🔴 This artefact is deliberately NOT in `check-generated-artefacts-current.js`.',
    'That gate runs in CI, and CI has no running Laravel to verify against — wiring this in',
    'would either fail every build or have to be made to pass vacuously. Refresh it by hand',
    'after API changes that affect these endpoints.',
    '',
    'The consumer ledger records that a call exists and that Laravel declares a route for',
    'it. This file records what the endpoint **actually did**: the status for an anonymous',
    'caller, the status for a signed-in member, and the response keys returned.',
    '',
    `- Contracts verified: **${results.length}**`,
    `- Contracts with findings: **${withFindings.length}**`,
    `- Answered **403** because the fixture community has that module switched off: **${results.filter((r) => r.moduleGated).length}**`,
    '',
    '🔴 A 403 is not a fault. It means the module is off for this community, so this file',
    'is evidence about the endpoints it could actually reach — not about all of them.',
    '',
    '## Findings',
    '',
    withFindings.length
      ? ['| Endpoint | Member | Anonymous | Finding |', '| --- | --- | --- | --- |',
        ...withFindings.map((r) => `| \`${r.path}\` | ${r.memberStatus} | ${r.anonymousStatus} | ${r.findings.join('; ')} |`)].join('\n')
      : 'None.',
    '',
    '## All verified contracts',
    '',
    '| Endpoint | Member | Anonymous | Response keys |',
    '| --- | --- | --- | --- |',
    ...results.map((r) => `| \`${r.path}\` | ${r.memberStatus} | ${r.anonymousStatus} | ${(r.responseKeys || []).join(', ') || '—'} |`),
    '',
  ].join('\n');
  await fs.writeFile(OUT_MD, md, 'utf8');

  console.log(`\n${results.length} contracts verified, ${withFindings.length} with findings`);
  if (withFindings.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 2;
});
