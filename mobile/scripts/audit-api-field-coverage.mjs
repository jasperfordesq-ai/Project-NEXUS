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
 * endpoint, and reports any field the interface marks required (no `?`) that is absent
 * from the response.
 *
 * 🔴 It reports its own coverage, and that matters more than the findings. An endpoint that
 * answers with an empty collection proves NOTHING about the shape of its items, and one
 * whose path parameters cannot be resolved is not checked at all. Both are counted, listed,
 * and summarised. Treat "0 missing fields" as meaningful only for the `checked` count.
 *
 * 🔴 How path parameters are resolved, and why v1 under-reported so badly. v1 held a fixed
 * table of ids — `id: '100'`, `orderId: '35'` — and `${id}` appears in 168 endpoints across
 * the modules, where its correct value depends entirely on which collection it addresses.
 * `/marketplace/sellers/${id}` got listing 100 and answered 404, so a working endpoint was
 * filed as unfetchable; the marketplace looked 11-of-32 checkable when most of the gap was
 * this. Resolution now tries, in order:
 *
 *   1. an explicit OVERRIDE, for the few endpoints whose id is not the id of the collection
 *      above it (a seller profile is keyed by USER id, not by its own row id);
 *   2. DISCOVERY — GET the collection above the parameter and take a real id out of it.
 *      `/marketplace/listings/${id}` asks `/marketplace/listings`; results are cached;
 *   3. the static table below, which is now only a last resort;
 *   4. nothing — and then the endpoint is reported as unresolved rather than guessed at.
 *
 * Usage:
 *   node scripts/audit-api-field-coverage.mjs                  # every module
 *   node scripts/audit-api-field-coverage.mjs marketplace feed  # named modules
 *   node scripts/audit-api-field-coverage.mjs --verbose         # how each id was resolved
 *
 * Needs docker compose up (Laravel on 127.0.0.1:8090) and the e2e fixture accounts.
 * Read-only: it issues GETs only.
 */

import fs from 'node:fs';
import path from 'node:path';

import coverageHelpers from './audit-api-field-coverage-helpers.cjs';

const { exitCodeForMissingContracts, requiredQueryForGetter } = coverageHelpers;

const API = process.env.API ?? 'http://127.0.0.1:8090/api/v2';
const LOGIN = process.env.LOGIN ?? 'http://127.0.0.1:8090/api/auth/login';
const TENANT = process.env.TENANT ?? 'hour-timebank';
const EMAIL = process.env.EMAIL ?? 'e2e.user.a@project-nexus.local';
const PASSWORD = process.env.PASSWORD ?? 'TestPassword123!';
const API_DIR = path.resolve(import.meta.dirname, '..', 'lib', 'api');

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const only = argv.filter((a) => !a.startsWith('--'));

/**
 * Last-resort ids, used only when discovery cannot answer. Kept small on purpose: every
 * entry here is a value this tool asserts rather than observes.
 */
const PARAMS = {
  userId: '675', otherUserId: '674', memberId: '675', sellerUserId: '674',
  templateId: '1', sessionId: '1', deviceId: '1', credentialId: '1', broadcastId: '1',
};

/**
 * Endpoints whose parameter is NOT the id of the collection above it. Each one is a claim
 * about the API, so each carries its reason.
 */
const OVERRIDES = [
  // A seller profile is addressed by the seller's USER id; /marketplace/sellers is not a
  // listable collection, so discovery has nothing to read.
  [/^\/marketplace\/sellers\/\$\{id\}$/, () => PARAMS.sellerUserId],
  // Same shape: the seller's listings hang off the user id.
  [/^\/marketplace\/sellers\/\$\{[a-zA-Z]+\}\/listings$/, () => PARAMS.sellerUserId],
];

/**
 * Where a KIND of id lives, when the collection above the parameter is not it.
 *
 * `/marketplace/groups/${groupId}/listings` is the shape that needs this: the parameter is
 * a groups id, but the path above it (`/marketplace/groups`) is not a collection at all, so
 * parent discovery finds nothing. Tried only after parent discovery fails, and only for the
 * kinds listed — never a guess at a bare number.
 */
const PARAM_SOURCES = {
  groupId: '/groups',
  eventId: '/events',
  postId: '/feed',
  conversationId: '/messages/conversations',
  opportunityId: '/volunteering/opportunities',
  jobId: '/jobs',
  vacancyId: '/jobs',
  exchangeId: '/exchanges',
  categoryId: '/categories',
};

/** Query parameters an endpoint refuses to work without. */
const REQUIRED_QUERY = [
  /*
    Without a point to search around, "nearby" answers 422. The names are the CLIENT's —
    `latitude`/`longitude`, not lat/lng — because a harness that sends different parameters
    from the app is not testing the app. (v2 of this script sent lat/lng and still got a
    422, which is how the difference was noticed.)
  */
  [/nearby/, { latitude: '53.3498', longitude: '-6.2603', radius: '500', limit: '20' }],
];

/** Getters whose path carries an enum; each is tried and a non-empty answer preferred. */
const ENUMS = {
  mode: ['purchases', 'sales', 'sent', 'received', 'all'],
  status: ['active', 'open', 'all'],
};

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
    /*
      🔴 Does this getter hand the response through, or BUILD its own object from it?

      `getFederationStats` fetches `/federation/status` and maps it into a different shape
      with `?? 0` defaults for every field. Comparing the raw response against the mapped
      type reported three fields "missing" that the client always produces — a false alarm
      of exactly the kind this script's envelope note warns about. A getter that returns
      `api.get(...)` directly is comparable; one that returns an object literal is not.
    */
    const passthrough = /return\s+api\.get</.test(body);
    out.push({ fn, endpoint: ep[1], type: named, passthrough });
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

let token;

async function get(endpoint) {
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

/** Unwrap an envelope down to the first item, or 'EMPTY' for an empty collection. */
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

const discovered = new Map();

/**
 * Find a real id for `${param}` in `endpoint` by reading the collection above it.
 *
 * Prefers a field named after the parameter (`listing_id` for `${listingId}`) and falls
 * back to `id`, because a collection of orders answers with `id` while a collection of
 * pickup slots may name the listing it belongs to.
 */
async function discover(endpoint, param) {
  const marker = '${' + param + '}';
  const at = endpoint.indexOf(marker);
  if (at <= 0) return null;
  let parent = endpoint.slice(0, at).replace(/\/$/, '');
  if (parent.includes('${')) return null; // an unresolved parameter earlier in the path
  if (discovered.has(parent)) return discovered.get(parent);

  /*
    🔴 Some collections only exist under an enum segment. `/marketplace/orders` answers 405
    — the orders a member can see are `/marketplace/orders/sales` and `…/purchases` — so a
    plain parent GET finds nothing and six endpoints were filed as "no id available" when a
    real order (35) was sitting one segment away.
  */
  const candidates = [parent, ...ENUMS.mode.map((mode) => `${parent}/${mode}`)];
  let value = null;
  for (const candidate of candidates) {
    const { code, body } = await get(candidate);
    if (code !== '200') continue;
    const item = firstItem(body);
    if (!item || item === 'EMPTY') continue;
    const snake = param.replace(/([A-Z])/g, (c) => '_' + c.toLowerCase());
    const found = item[snake] ?? item[param] ?? item.id ?? null;
    if (found === null) continue;
    value = String(found);
    break;
  }
  /*
    Last resort before giving up: the canonical collection for this KIND of id. See
    PARAM_SOURCES — `/marketplace/groups/${groupId}/listings` needs it, because the path
    above the parameter is not a collection.
  */
  if (value === null && PARAM_SOURCES[param]) {
    const { code, body } = await get(PARAM_SOURCES[param]);
    if (code === '200') {
      const item = firstItem(body);
      if (item && item !== 'EMPTY' && item.id !== undefined) value = String(item.id);
    }
  }

  discovered.set(parent, value);
  return value;
}

async function resolve(endpoint, getterName) {
  const params = [...endpoint.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1]);
  let url = endpoint;
  const how = [];
  for (const param of params) {
    const override = OVERRIDES.find(([pattern]) => pattern.test(endpoint));
    let value = override ? override[1]() : null;
    if (value) {
      how.push(`${param}=${value} (override)`);
    } else {
      value = await discover(endpoint, param);
      if (value) how.push(`${param}=${value} (discovered)`);
    }
    if (!value && PARAMS[param]) {
      value = PARAMS[param];
      how.push(`${param}=${value} (static)`);
    }
    if (!value) return { unresolved: param, how };
    url = url.replace('${' + param + '}', value);
  }

  const query = REQUIRED_QUERY.find(([pattern]) => pattern.test(endpoint));
  if (query) {
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(query[1]).toString();
  }

  const needsListing = requiredQueryForGetter(getterName, true);
  if (needsListing) {
    const listingId = await discover('/listings/${listingId}', 'listingId');
    const getterQuery = requiredQueryForGetter(getterName, listingId);
    if (!getterQuery) return { unresolved: 'listingId', how };
    url += (url.includes('?') ? '&' : '?') + new URLSearchParams(getterQuery).toString();
    how.push(`target_id=${listingId} (discovered listing)`);
  }
  return { url, how };
}

/** Try each enum value and prefer one that answers with actual items. */
async function fetchBest(getter) {
  const { endpoint } = getter;
  const enumName = Object.keys(ENUMS).find((name) => endpoint.includes('${' + name + '}'));
  if (!enumName) {
    const resolved = await resolve(endpoint, getter.fn);
    if (resolved.unresolved) return { code: `no ${resolved.unresolved}`, how: resolved.how };
    return { ...(await get(resolved.url)), how: resolved.how };
  }

  let fallback = { code: 'param?' };
  for (const value of ENUMS[enumName]) {
    const resolved = await resolve(endpoint.replace('${' + enumName + '}', value), getter.fn);
    if (resolved.unresolved) continue;
    const attempt = { ...(await get(resolved.url)), how: [...resolved.how, `${enumName}=${value}`] };
    if (attempt.code !== '200') continue;
    if (fallback.code !== '200') fallback = attempt;
    const item = firstItem(attempt.body);
    if (item !== 'EMPTY' && item !== null) return attempt;
  }
  return fallback;
}

token = await login();
const modules = fs.readdirSync(API_DIR)
  .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((name) => only.length === 0 || only.includes(name));

const totals = { checked: 0, empty: 0, unfetchable: 0, unresolved: 0, mapped: 0, missing: 0 };
for (const name of modules) {
  const source = fs.readFileSync(path.join(API_DIR, `${name}.ts`), 'utf8');
  const ifaces = interfacesIn(source);
  const getters = gettersIn(source, Object.keys(ifaces));
  if (getters.length === 0) continue;

  const findings = [];
  const empty = [];
  const unfetchable = [];
  const unresolved = [];
  const mapped = [];
  for (const getter of getters) {
    if (!getter.passthrough) {
      // The client reshapes the response, so its declared type is its own promise, not the
      // server's. Listed rather than silently dropped: these are the endpoints where a
      // contract test has to look at the mapping, not at the raw body.
      mapped.push(getter.fn);
      continue;
    }
    const { code, body, how } = await fetchBest(getter);
    if (verbose && how?.length) console.log(`  · ${getter.fn}: ${how.join(', ')}`);
    if (typeof code === 'string' && code.startsWith('no ')) {
      unresolved.push(`${getter.fn}(${code})`);
      continue;
    }
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
  totals.unresolved += unresolved.length;
  totals.mapped += mapped.length;
  totals.missing += findings.length;

  const checked = getters.length - empty.length - unfetchable.length - unresolved.length
    - mapped.length;
  console.log(`\n${name}: ${getters.length} typed getters — checked ${checked}, `
    + `empty ${empty.length}, unfetchable ${unfetchable.length}, unresolved ${unresolved.length}, `
    + `mapped ${mapped.length}`);
  for (const f of findings) {
    console.log(`  MISSING ${f.fn} (${f.type}, ${f.required} required): ${f.absent.join(', ')}`);
  }
  if (empty.length > 0) console.log(`     empty (proves nothing): ${empty.join(', ')}`);
  if (unfetchable.length > 0) console.log(`     unfetchable: ${unfetchable.join(', ')}`);
  if (unresolved.length > 0) console.log(`     no id available: ${unresolved.join(', ')}`);
  if (mapped.length > 0) console.log(`     reshaped in the client, not comparable: ${mapped.join(', ')}`);
}

console.log(`\n=== totals === checked ${totals.checked} | empty ${totals.empty} `
  + `| unfetchable ${totals.unfetchable} | unresolved ${totals.unresolved} `
  + `| mapped ${totals.mapped} | endpoints missing a required field ${totals.missing}`);
console.log('=== "checked" is the only number that proves anything about response shape.');
process.exitCode = exitCodeForMissingContracts(totals.missing);
