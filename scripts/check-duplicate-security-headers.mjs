#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guards against shipping TWO copies of a security header.
 *
 * On 2026-09-10 production served every application response with two
 * `X-Frame-Options`, two `X-Content-Type-Options`, two `Referrer-Policy` and
 * two CONTRADICTING `Permissions-Policy` headers:
 *
 *   Permissions-Policy: camera=(), microphone=(), geolocation=(self), payment=(self)
 *   Permissions-Policy: camera=(self), microphone=(self), ... payment=(), usb=(), ...
 *
 * One came from `Header always set` in the Apache conf baked by
 * Dockerfile.prod / Dockerfile.bluegreen, the other from
 * App\Http\Middleware\SecurityHeaders.
 *
 * Why the earlier fix could not work: `Header always set` writes to Apache's
 * err_headers_out table, while `Header setifempty` (added to httpdocs/.htaccess
 * specifically to stop this) reads headers_out. The two tables cannot see each
 * other, so the guard no-opped and both copies went out. A browser INTERSECTS
 * duplicate Permissions-Policy headers, so the live pair silently denied
 * camera, microphone, payment, usb and browsing-topics — `payment=()` breaks
 * browser payment integrations.
 *
 * Why nobody caught it locally: the dev Dockerfile bakes no such conf, so a
 * local origin genuinely returned one of each. Header changes must be
 * re-checked against the live service.
 *
 * The rule this enforces: for the four headers below there is exactly ONE
 * source per path — the middleware for application responses, and
 * `Header setifempty` in httpdocs/.htaccess for files Apache serves itself.
 * The baked conf may set Strict-Transport-Security and nothing else, because
 * the container is reached over HTTP from the host proxy, so $request->secure()
 * is false and the middleware does not emit HSTS.
 */

import { readFileSync, existsSync } from 'node:fs';

/** Headers the Laravel middleware owns. The baked Apache conf must not set these. */
const MIDDLEWARE_OWNED = [
  'X-Frame-Options',
  'X-Content-Type-Options',
  'Referrer-Policy',
  'Permissions-Policy',
];

/** The only header the baked conf is allowed to set. */
const CONF_ALLOWED = ['Strict-Transport-Security'];

const PROD_DOCKERFILES = ['Dockerfile.prod', 'Dockerfile.bluegreen'];
const MIDDLEWARE = 'app/Http/Middleware/SecurityHeaders.php';
const HTACCESS = 'httpdocs/.htaccess';

const problems = [];
const notes = [];

// ── 1. No production Dockerfile may bake a middleware-owned header ───────────
for (const file of PROD_DOCKERFILES) {
  if (!existsSync(file)) {
    problems.push(`${file}: missing — expected a production Dockerfile here.`);
    continue;
  }
  const text = readFileSync(file, 'utf8');

  // Only look at real directives, not the explanatory comments that record the
  // incident (those legitimately quote the old header names).
  const directives = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .filter((line) => /Header\s+(always\s+)?(set|setifempty|append|add)\s+/i.test(line));

  for (const name of MIDDLEWARE_OWNED) {
    const hit = directives.find((line) =>
      new RegExp(`Header\\s+(always\\s+)?(set|setifempty|append|add)\\s+${name}\\b`, 'i').test(line),
    );
    if (hit) {
      problems.push(
        `${file}: bakes an Apache directive for ${name}, which App\\Http\\Middleware\\SecurityHeaders already sets.\n` +
          `    -> ${hit.trim()}\n` +
          `    This ships a SECOND copy on every application response. Remove it: the middleware owns ${name}.`,
      );
    }
  }

  for (const name of CONF_ALLOWED) {
    const hasIt = directives.some((line) =>
      new RegExp(`Header\\s+always\\s+set\\s+${name}\\b`, 'i').test(line),
    );
    if (!hasIt) {
      problems.push(
        `${file}: no \`Header always set ${name}\`. The container is reached over HTTP from the host ` +
          `proxy, so the middleware does not emit ${name}; removing it from the image drops it from production.`,
      );
    } else {
      notes.push(`${file}: sets ${name} only — correct.`);
    }
  }
}

// ── 2. The middleware must still be the source for those four ────────────────
if (!existsSync(MIDDLEWARE)) {
  problems.push(`${MIDDLEWARE}: missing — the middleware is the single source for these headers.`);
} else {
  const mw = readFileSync(MIDDLEWARE, 'utf8');
  for (const name of MIDDLEWARE_OWNED) {
    if (!mw.includes(`'${name}'`)) {
      problems.push(
        `${MIDDLEWARE}: no longer sets ${name}. Removing the Apache copy assumed the middleware ` +
          `provides it, so production would now send NONE.`,
      );
    }
  }
  if (problems.length === 0) notes.push(`${MIDDLEWARE}: sets all four owned headers.`);
}

// ── 3. .htaccess must stay `setifempty`, never `always set` ──────────────────
if (existsSync(HTACCESS)) {
  const ht = readFileSync(HTACCESS, 'utf8');
  for (const name of MIDDLEWARE_OWNED) {
    const bad = new RegExp(`^\\s*Header\\s+always\\s+set\\s+${name}\\b`, 'im');
    if (bad.test(ht)) {
      problems.push(
        `${HTACCESS}: uses \`Header always set ${name}\`. That writes to err_headers_out and cannot be ` +
          `suppressed by the application's own header, so it duplicates. Use \`Header setifempty\`.`,
      );
    }
  }
  if (/Header\s+setifempty\s+Permissions-Policy/i.test(ht)) {
    notes.push(`${HTACCESS}: uses setifempty for the static-file path — correct.`);
  }
}

// ── Report ───────────────────────────────────────────────────────────────────
console.log('Duplicate security-header guard');
console.log('===============================\n');

if (problems.length > 0) {
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`\nFAILED: ${problems.length} problem(s). See the comment block in ${import.meta.url.split('/').pop()}.`);
  process.exit(1);
}

for (const n of notes) console.log(`  OK  ${n}`);
console.log('\nSUCCESS: exactly one source per security header.');
