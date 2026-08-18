// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared helpers for the committed Laravel API route inventory.
 *
 * The fingerprint is the whole point. A snapshot of someone else's routes goes
 * stale silently, and a stale drift-checker reports safety it cannot see — the
 * exact failure mode that let mobile's `.strict()` agenda schema sit broken for
 * weeks in 2026-08. Hashing the route-defining sources means the inventory can
 * say "I no longer describe this tree", and the ledger can refuse to claim a
 * pass instead of quietly asserting one.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ROUTE_INVENTORY_PATH = path.join('docs', 'generated', 'laravel-api-route-inventory.json');

/**
 * Files that decide which API routes exist. `routes/` holds the definitions;
 * `bootstrap/app.php` decides which of those files are loaded and under what
 * prefix, so a change there can move every path in the tree.
 */
function routeSourceFiles(repoRoot) {
  const files = [];
  const routesDir = path.join(repoRoot, 'routes');
  if (fs.existsSync(routesDir)) {
    for (const entry of fs.readdirSync(routesDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.php')) continue;
      files.push(path.join('routes', entry.name));
    }
  }
  const bootstrap = path.join('bootstrap', 'app.php');
  if (fs.existsSync(path.join(repoRoot, bootstrap))) files.push(bootstrap);
  return files;
}

/**
 * A digest over the content of every route-defining file, plus the per-file
 * digests so a mismatch report can name which file moved rather than only
 * saying "something changed".
 *
 * Line endings are normalised to LF before hashing, and that is load-bearing
 * rather than tidiness. The Windows dev checkout stores these files with CRLF
 * while the CI runner checks them out with LF, so hashing raw bytes produced a
 * digest that could only ever match on the machine that wrote it: the snapshot
 * validated locally and reported "the route inventory is stale" on every single
 * CI run, which is a checker that reports danger it cannot see — the mirror of
 * the failure this fingerprint exists to prevent.
 */
export function fingerprintRouteSources(repoRoot) {
  const files = routeSourceFiles(repoRoot);
  const perFile = files.map((rel) => {
    const text = fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
    return { file: rel.split(path.sep).join('/'), sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex') };
  });
  const combined = crypto
    .createHash('sha256')
    .update(perFile.map((f) => `${f.file}:${f.sha256}`).join('\n'))
    .digest('hex');
  return { digest: combined, files: perFile };
}

/**
 * Load the committed inventory and report whether it still describes this tree.
 * Returns `{ ok, reason, inventory, changedFiles }` — never throws for the
 * ordinary cases (absent file, stale fingerprint) so callers can decide between
 * "fail" and "report unverified".
 */
export function loadRouteInventory(repoRoot, mobileRoot) {
  const file = path.join(mobileRoot, ROUTE_INVENTORY_PATH);
  if (!fs.existsSync(file)) {
    return { ok: false, reason: 'absent', inventory: null, changedFiles: [] };
  }

  let inventory;
  try {
    inventory = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { ok: false, reason: `unreadable: ${err.message}`, inventory: null, changedFiles: [] };
  }

  const current = fingerprintRouteSources(repoRoot);
  const recorded = inventory.route_source_fingerprint;
  if (!recorded || !recorded.digest) {
    return { ok: false, reason: 'no fingerprint recorded', inventory, changedFiles: [] };
  }
  if (recorded.digest === current.digest) {
    return { ok: true, reason: 'fresh', inventory, changedFiles: [] };
  }

  const recordedByFile = new Map((recorded.files || []).map((f) => [f.file, f.sha256]));
  const currentByFile = new Map(current.files.map((f) => [f.file, f.sha256]));
  const changedFiles = [];
  for (const [f, sha] of currentByFile) {
    if (!recordedByFile.has(f)) changedFiles.push(`${f} (added)`);
    else if (recordedByFile.get(f) !== sha) changedFiles.push(`${f} (modified)`);
  }
  for (const f of recordedByFile.keys()) if (!currentByFile.has(f)) changedFiles.push(`${f} (removed)`);

  return { ok: false, reason: 'stale', inventory, changedFiles };
}

/** Compare path shapes, not parameter names: `/x/{id}` and `/x/{param}` match. */
export function shape(p) {
  return p.replace(/\{[^}]*\}/g, '{}');
}

/** Index an inventory's paths by shape, unioning methods across name variants. */
export function indexByShape(paths) {
  const byShape = new Map();
  for (const [p, methods] of Object.entries(paths || {})) {
    const key = shape(p);
    if (!byShape.has(key)) byShape.set(key, { paths: new Set(), methods: new Set() });
    const entry = byShape.get(key);
    entry.paths.add(p);
    for (const m of methods) entry.methods.add(String(m).toUpperCase());
  }
  return byShape;
}

/**
 * Second-chance match for a consumer path whose exact shape is absent.
 *
 * A client parameter is not always a server parameter. `getMarketplaceOffers`
 * takes `mode: 'sent' | 'received'` and interpolates it, so the consumer path
 * reads `/marketplace/my-offers/{}` while Laravel registers the two literal
 * routes `/marketplace/my-offers/sent` and `/marketplace/my-offers/received`.
 * Shape equality alone calls that drift; it plainly is not.
 *
 * So a `{}` segment in the CONSUMER path may also match a literal server
 * segment. The reverse is deliberately not allowed: a literal client segment
 * must never satisfy a server parameter, because that would let a typo'd
 * `/events/attendees` quietly match `/events/{id}`.
 *
 * Returns the union of methods across every server path that matches, plus the
 * matching paths, or null when nothing does.
 */
export function matchWithParamWildcards(byShape, consumerShape) {
  const consumerSegs = consumerShape.split('/');
  const methods = new Set();
  const matched = [];

  for (const [serverShape, entry] of byShape) {
    const serverSegs = serverShape.split('/');
    if (serverSegs.length !== consumerSegs.length) continue;

    let ok = true;
    let wildcardUsed = false;
    for (let i = 0; i < serverSegs.length; i += 1) {
      const c = consumerSegs[i];
      const s = serverSegs[i];
      if (c === s) continue;
      if (c === '{}' && s !== '{}') {
        wildcardUsed = true;
        continue;
      }
      ok = false;
      break;
    }

    if (!ok || !wildcardUsed) continue;
    matched.push(...entry.paths);
    for (const m of entry.methods) methods.add(m);
  }

  if (matched.length === 0) return null;
  return { paths: matched.sort(), methods };
}
