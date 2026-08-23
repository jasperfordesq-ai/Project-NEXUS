#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Does the API actually send the fields our client declares REQUIRED?
 *
 * 🔴 Why this exists. 37 of the app's 46 API modules — 416 endpoints — validate nothing.
 * A field the client reads and the server does not send simply arrives as `undefined`, so
 * the screen renders blanks or crashes on a property of undefined. That is exactly how the
 * Matches screen crashed for every member on 2026-08-23: the server sends `module` and
 * `listing_id`, the screen read `source_type` and `source_id`. Nothing failed loudly.
 *
 * So this asks the live API and compares. It reads each client module's exported
 * `interface`s, finds the getters whose return type names one of them, fetches the real
 * endpoint, and reports any field the interface marks required (no `?`) that is absent from
 * the response.
 *
 * 🔴 It reports its own coverage, and that matters more than the findings. An endpoint that
 * answers with an empty collection proves NOTHING about the shape of its items, and one
 * whose path parameters cannot be resolved is not checked at all. Both are counted and
 * listed. Treat "0 missing fields" as meaningful only for the `checked` count.
 *
 * Usage:
 *   node scripts/audit-api-field-coverage.mjs                  # every module
 *   node scripts/audit-api-field-coverage.mjs marketplace feed # named modules
 *
 * Needs docker compose up (Laravel on 127.0.0.1:8090) and the e2e fixture accounts.
 * Read-only: it issues GETs only.
 */

import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API ?? 'http://127.0.0.1:8090/api/v2';
const LOGIN = process.env.LOGIN ?? 'http://127.0.0.1:8090/api/auth/login';
const TENANT = process.env.TENANT ?? 'hour-timebank';
const EMAIL = process.env.EMAIL ?? 'e2e.user.a@project-nexus.local';
const PASSWORD = process.env.PASSWORD ?? 'TestPassword123!';
const API_DIR = path.resolve(import.meta.dirname, '..', 'lib', 'api');

/**
 * Path parameters resolved from the local fixture. A miss here costs coverage, not
 * correctness — an unresolved parameter is reported as unchecked rather than guessed.
 */
const PARAMS = {
  id: '100', listingId: '100', orderId: '35', groupId: '974', sellerUserId: '674',
  eventId: '164', userId: '675', otherUserId: '674', memberId: '675', postId: '1',
  templateId: '1', sessionId: '1', deviceId: '1', itemId: '1', credentialId: '1',
  broadcastId: '1', opportunityId: '128', shiftId: '66', jobId: '31', vacancyId: '31',
  exchangeId: '61', conversationId: '1', categoryId: '605', collectionId: '1',
};

/** Getters whose path carries an enum; each is tried and a non-empty answer preferred. */
const ENUMS = { mode: ['purchases', 'sales', 'sent', 'received', 'all'] };

function interfacesIn(source) {
  const out = {};
  const re = /export interface (\w+)\s*(?:extends\s+[\w<>, ]+\s*)?\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const fields = {};
    const fre = /^ {2}(\w+)(\?)?\s*:/gm;
    let f;
    while ((f = fre.exec(m[2])) !== null) fields[f[1]] = f[2] === undefined;
    out[m[1]] = fields;
  }
  return out;
}

function gettersIn(source, interfaceNames) {
  const out = [];
  const re = /export (?:async )?function (get\w+)\([^)]*\)\s*:\s*Promise<([\s\S]*?)>\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const fn = m[1];
    const ret = m[2];
    const body = m[3];
    const ep = /`\$\{API_V2\}([^`]+)`/.exec(body);
    if (!ep) continue;
    const named = interfaceNames.find((name) => new RegExp(`\\b${name}\\b`).test(ret));
    if (!named) continue;
    out.push({ fn, endpoint: ep[1], type: named });
  }
  return out;
}

async function login() {
  const res = await fetch(LOGIN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': TENANT },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!body.access_token) throw new Error(`login failed: ${res.status}`);
  return body.access_token;
}

function resolve(endpoint) {
  return endpoint.replace(/\$\{(\w+)\}/g, (whole, name) => PARAMS[name] ?? whole);
}

function firstItem(payload) {
  let d = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload;
  if (d && !Array.isArray(d) && typeof d === 'object') {
    for (const key of ['items', 'listings', 'orders', 'offers', 'results']) {
      if (Array.isArray(d[key])) { d = d[key]; break; }
    }
  }
  if (Array.isArray(d)) return d.length > 0 ? d[0] : 'EMPTY';
  return d && typeof d === 'object' ? d : null;
}

async function get(endpoint, token) {
  const res = await fetch(API + endpoint, {
    headers: { 'X-Tenant-Slug': TENANT, Authorization: `Bearer ${token}` },
  });
  if (res.status !== 200) return { code: String(res.status) };
  try {
    return { code: '200', body: await res.json() };
  } catch {
    return { code: 'nonjson' };
  }
}

async function fetchBest(endpoint, token) {
  const enumName = Object.keys(ENUMS).find((name) => endpoint.includes(`\${${name}}`));
  if (!enumName) return get(resolve(endpoint), token);

  let fallback = { code: 'param?' };
  for (const value of ENUMS[enumName]) {
    const attempt = await get(resolve(endpoint.replace(`\${${enumName}}`, value)), token);
    if (attempt.code !== '200') continue;
    if (fallback.code !== '200') fallback = attempt;
    const item = firstItem(attempt.body);
    if (item !== 'EMPTY' && item !== null) return attempt;
  }
  return fallback;
}

const only = process.argv.slice(2);
const token = await login();
const modules = fs.readdirSync(API_DIR)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((name) => only.length === 0 || only.includes(name));

const totals = { checked: 0, empty: 0, unfetchable: 0, missing: 0 };
for (const name of modules) {
  const source = fs.readFileSync(path.join(API_DIR, `${name}.ts`), 'utf8');
  const ifaces = interfacesIn(source);
  const getters = gettersIn(source, Object.keys(ifaces));
  if (getters.length === 0) continue;

  const findings = [];
  const empty = [];
  const unfetchable = [];
  for (const getter of getters) {
    const { code, body } = await fetchBest(getter.endpoint, token);
    if (code !== '200') { unfetchable.push(`${getter.fn}(${code})`); continue; }
    const fields = ifaces[getter.type] ?? {};
    /*
      🔴 An ENVELOPE type must be compared with the whole response, not with an item inside
      it. The first run of this script reported 29 endpoints "missing" `data` and `meta`,
      and 25 of those were this mistake: the return type was the envelope
      (`{ data, meta }`) while the comparison had already unwrapped `data` to reach an item.
      A tool that cries wolf is worse than no tool, so envelopes are detected explicitly.
    */
    const isEnvelope = 'data' in fields;
    const item = isEnvelope ? body : firstItem(body);
    if (item === 'EMPTY' || item === null || typeof item !== 'object') {
      empty.push(getter.fn); continue;
    }
    const required = Object.entries(fields)
      .filter((entry) => entry[1]).map((entry) => entry[0]);
    const absent = required.filter((field) => !(field in item));
    totals.checked += 1;
    if (absent.length > 0) findings.push({ ...getter, absent, required: required.length });
  }
  totals.empty += empty.length;
  totals.unfetchable += unfetchable.length;
  totals.missing += findings.length;

  const checked = getters.length - empty.length - unfetchable.length;
  console.log(`\n${name}: ${getters.length} typed getters — checked ${checked}, `
    + `empty ${empty.length}, unfetchable ${unfetchable.length}`);
  for (const f of findings) {
    console.log(`  MISSING ${f.fn} (${f.type}, ${f.required} required): ${f.absent.join(', ')}`);
  }
  if (empty.length > 0) console.log(`     empty (proves nothing): ${empty.join(', ')}`);
  if (unfetchable.length > 0) console.log(`     unfetchable: ${unfetchable.join(', ')}`);
}

console.log(`\n=== totals === checked ${totals.checked} | empty ${totals.empty} `
  + `| unfetchable ${totals.unfetchable} | endpoints missing a required field ${totals.missing}`);
