// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Refresh the committed snapshot of Laravel's real API routes.
 *
 * Why a snapshot and not a live query: the mobile CI job runs on a bare Node
 * runner with no PHP, no database and no application container, so it cannot
 * ask Laravel anything. A committed inventory lets the mobile API ledger verify
 * endpoints anywhere — a runner, a laptop, an aeroplane.
 *
 * Why a snapshot is normally a trap, and why this one is not: a stale snapshot
 * makes a drift checker pass vacuously, which is worse than having no checker,
 * because it reports safety. So the snapshot records a fingerprint of every
 * route-defining source file. When those files change and the snapshot has not
 * been refreshed, the ledger reports UNVERIFIED and exits non-zero. Staleness
 * is loud; it never reads as a pass.
 *
 * Honest limits of the fingerprint: it covers `routes/` and `bootstrap/app.php`.
 * A route whose path is built from a constant defined elsewhere, or registered
 * by a package's service provider, can change without moving the fingerprint.
 * That is a narrower hole than an unfingerprinted snapshot, not no hole.
 *
 * Usage (needs the local app container running):
 *   npm run api:routes
 *   node scripts/refresh-laravel-route-inventory.mjs --container nexus-php-app
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import { ROUTE_INVENTORY_PATH, fingerprintRouteSources } from './lib/route-inventory.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const container = arg('container', 'nexus-php-app');

function readRoutesFromContainer() {
  let raw;
  try {
    raw = execFileSync('docker', ['exec', container, 'php', 'artisan', 'route:list', '--json'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error(`route inventory: could not run "artisan route:list" in container "${container}".`);
    console.error('route inventory: start the local stack (npm run dev:docker) or pass --container <name>.');
    console.error(`route inventory: underlying error — ${err.message.split('\n')[0]}`);
    process.exit(1);
  }

  // artisan can emit warnings before the JSON payload; take the array only.
  const start = raw.indexOf('[');
  if (start === -1) {
    console.error('route inventory: artisan produced no JSON array.');
    process.exit(1);
  }
  return JSON.parse(raw.slice(start));
}

function main() {
  const routes = readRoutesFromContainer();
  if (!Array.isArray(routes) || routes.length === 0) {
    console.error('route inventory: artisan returned no routes — refusing to write an empty inventory.');
    process.exit(1);
  }

  // One entry per METHOD + path. artisan reports `GET|HEAD` as a single row.
  const byPath = new Map();
  let apiRoutes = 0;
  for (const r of routes) {
    const uri = `/${String(r.uri || '').replace(/^\/+/, '')}`;
    if (!uri.startsWith('/api/') && uri !== '/api') continue;
    apiRoutes += 1;
    const methods = String(r.method || '')
      .split('|')
      .map((m) => m.trim().toUpperCase())
      .filter((m) => m && m !== 'HEAD');
    if (!byPath.has(uri)) byPath.set(uri, new Set());
    for (const m of methods) byPath.get(uri).add(m);
  }

  const paths = {};
  for (const key of [...byPath.keys()].sort()) paths[key] = [...byPath.get(key)].sort();

  const fingerprint = fingerprintRouteSources(REPO_ROOT);

  const inventory = {
    generated_by: 'mobile/scripts/refresh-laravel-route-inventory.mjs',
    source: `docker exec ${container} php artisan route:list --json`,
    note:
      'Authoritative list of the API routes Laravel actually registers. openapi.json is ' +
      'a partial, hand-curated contract (862 of these paths at the time of writing) and is ' +
      'therefore NOT a safe source for drift detection.',
    total_registered_routes: routes.length,
    api_route_rows: apiRoutes,
    distinct_api_paths: Object.keys(paths).length,
    route_source_fingerprint: fingerprint,
    paths,
  };

  const out = path.join(MOBILE_ROOT, ROUTE_INVENTORY_PATH);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8');

  console.log(
    `route inventory: wrote ${inventory.distinct_api_paths} distinct API paths ` +
      `(${apiRoutes} route rows) from ${routes.length} registered routes`
  );
  console.log(`route inventory: fingerprint ${fingerprint.digest} over ${fingerprint.files.length} source files`);
  console.log(`route inventory: ${path.relative(REPO_ROOT, out).split(path.sep).join('/')}`);
}

main();
