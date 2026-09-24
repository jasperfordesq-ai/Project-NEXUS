// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Compare the committed mobile route snapshot with Laravel's running routes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fingerprintRouteSources } from './lib/route-inventory.mjs';

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(mobileRoot, '..');
const input = process.argv[2];
if (!input) throw new Error('Expected a route:list --json output file.');
const raw = fs.readFileSync(input, 'utf8');
const start = raw.indexOf('[');
if (start < 0) throw new Error('Laravel returned no JSON route array.');
const routes = JSON.parse(raw.slice(start));
if (!Array.isArray(routes) || routes.length === 0) throw new Error('Laravel returned no routes.');

const byPath = new Map();
for (const route of routes) {
  const uri = `/${String(route.uri || '').replace(/^\/+/, '')}`;
  if (!uri.startsWith('/api/') && uri !== '/api') continue;
  if (!byPath.has(uri)) byPath.set(uri, new Set());
  for (const method of String(route.method || '').split('|')) {
    const normalized = method.trim().toUpperCase();
    if (normalized && normalized !== 'HEAD') byPath.get(uri).add(normalized);
  }
}
const livePaths = {};
for (const uri of [...byPath.keys()].sort()) livePaths[uri] = [...byPath.get(uri)].sort();

const snapshot = JSON.parse(fs.readFileSync(
  path.join(mobileRoot, 'docs/generated/laravel-api-route-inventory.json'), 'utf8',
));
const currentFingerprint = fingerprintRouteSources(repoRoot);
if (snapshot.route_source_fingerprint?.digest !== currentFingerprint.digest) {
  throw new Error('The committed API route snapshot does not describe the current route sources.');
}
const allPaths = new Set([...Object.keys(snapshot.paths || {}), ...Object.keys(livePaths)]);
const drift = [...allPaths].filter((uri) =>
  JSON.stringify(snapshot.paths?.[uri] || []) !== JSON.stringify(livePaths[uri] || []));
if (drift.length > 0) {
  throw new Error(`API route snapshot differs from running Laravel at ${drift.length} path(s): ${drift.slice(0, 12).join(', ')}`);
}
console.log(`Live Laravel API route inventory verified: ${Object.keys(livePaths).length} paths.`);
