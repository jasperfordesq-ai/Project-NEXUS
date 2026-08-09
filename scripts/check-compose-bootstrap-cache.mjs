#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guard: Laravel's bootstrap/cache must never be shared between containers.
 *
 * Why this exists
 * ---------------
 * `artisan optimize` (run at startup by the queue and scheduler containers)
 * rebuilds the route cache by DELETING bootstrap/cache/routes-v7.php and then
 * writing it again. Laravel's RouteServiceProvider checks routesAreCached()
 * and then require()s the file from a later boot callback. If a second
 * container shares that directory, its artisan can pass the existence check
 * microseconds before the first container's `optimize` unlinks the file, and
 * then fatal on the require.
 *
 * In production this produced multi-minute bursts of ~600 fatals at ~3/second
 * (Sentry NEXUS-PHP-10, 5,492 events between 2026-05-16 and 2026-08-07) as
 * Horizon respawned workers that died at boot. It was fixed in
 * compose.bluegreen.yml (3799007da) by dropping the mount entirely.
 *
 * 🔴 Correction (2026-08-09): compose.prod.yml also shared the volume and was
 * fixed in 80ec9f08b, but that was NOT the cause of the bursts that continued
 * through July and August — that stack had not run in production since 2026-05,
 * and the 2026-08-07 burst came from a blue-green container. The real trigger
 * was the queue container crash-looping when Redis was unreachable at startup
 * (fixed in 6bf303b99). compose.prod.yml was deleted on 2026-08-09. This guard
 * is still worth keeping: a shared bootstrap/cache is a genuine bug, and it
 * covers the dev and CI compose files that remain.
 *
 * The rule this enforces is therefore: no volume mounted at a container's
 * bootstrap/cache may be mounted into more than one service in the same
 * compose file. Per-service volumes are fine; one shared volume is not.
 *
 * Reporting-only for compose files that mount nothing there at all — using the
 * image-baked cache (as compose.bluegreen.yml does) is the ideal, not a fault.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_TARGET_RE = /:\/[^:]*\/bootstrap\/cache\/?(?::[a-z,]+)?$/;

/**
 * Deliberately a line parser, not a YAML library: this runs in the Migration
 * Safety Gate job, which sets up Node but never installs node_modules, so the
 * check must have zero dependencies. The compose files are uniformly indented
 * (two spaces per level), which is all this needs.
 */
function checkFile(file) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);

  // source -> [service names] for anything mounted at bootstrap/cache
  const bySource = new Map();

  let inServices = false;
  let service = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line || /^\s*#/.test(line)) continue;

    // Top-level key: enter/leave the services: block.
    if (/^[a-zA-Z0-9_-]+:/.test(line)) {
      inServices = line.startsWith('services:');
      service = null;
      continue;
    }
    if (!inServices) continue;

    // Service name at exactly one level of indent.
    const svcMatch = line.match(/^ {2}([a-zA-Z0-9_.-]+):\s*$/);
    if (svcMatch) {
      service = svcMatch[1];
      continue;
    }
    if (!service) continue;

    // A list entry anywhere inside the service; only volume-ish ones match.
    const item = line.match(/^\s+-\s+(\S.*)$/);
    if (!item) continue;

    const entry = item[1].trim();
    if (!CACHE_TARGET_RE.test(entry)) continue;

    const source = entry.split(':')[0];
    if (!bySource.has(source)) bySource.set(source, []);
    bySource.get(source).push(service);
  }

  const shared = [...bySource.entries()].filter(([, svcs]) => svcs.length > 1);

  if (shared.length === 0) {
    const mounted = [...bySource.entries()];
    const detail = mounted.length
      ? `${mounted.length} per-service mount(s): ${mounted.map(([s, v]) => `${s} -> ${v[0]}`).join(', ')}`
      : 'no bootstrap/cache mount (uses the image-baked cache)';
    console.log(`  OK    ${file} — ${detail}`);
    return [];
  }

  return shared.map(
    ([source, svcs]) =>
      `${file}: volume "${source}" is mounted at bootstrap/cache in ${svcs.length} services (${svcs.join(', ')})`,
  );
}

const composeFiles = readdirSync(ROOT)
  .filter((f) => /^compose.*\.ya?ml$/.test(f))
  .sort();

console.log('Checking bootstrap/cache is never shared between containers...\n');

const failures = composeFiles.flatMap(checkFile);

if (failures.length > 0) {
  console.error('\nFAILURE: bootstrap/cache is shared between containers.\n');
  for (const f of failures) console.error(`::error::${f}`);
  console.error(
    '\nGive each service its own volume (nexus-php-bootstrap-cache-<service>),',
  );
  console.error(
    'or drop the mount entirely if the compose file bind-mounts no source and',
  );
  console.error('can use the image-baked cache, as compose.bluegreen.yml does.');
  process.exit(1);
}

console.log(`\nOK: ${composeFiles.length} compose file(s) checked, none share bootstrap/cache.`);
