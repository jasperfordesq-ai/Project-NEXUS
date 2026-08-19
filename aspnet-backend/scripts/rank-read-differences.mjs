// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Rank the response differences by whether the frontend ACTUALLY READS the missing field.
 *
 * 🔴 Why this exists. `compare-live-responses.mjs` reports 63 differing endpoints and 868
 * missing field paths, and treats them all alike. Most do not matter: Laravel hands back
 * whole database rows, so a "difference" is often a column no client has ever read. A few
 * matter enormously — on 2026-08-19 a single missing field name (`start_date` on the
 * events list) crashed an entire dashboard section, and the harness had scored it as one
 * more cosmetic name difference among several.
 *
 * So the useful question is not "how many fields differ" but "which differing fields does
 * a client read". This answers that by indexing every snake_case identifier that appears
 * in the frontend source and testing each missing field's leaf name against it.
 *
 * 🔴 What this is NOT. Appearing in the source is evidence of interest, not proof of use:
 * a name may occur in a type definition, a comment, or a call to the OTHER backend. Treat
 * the output as a PRIORITY ORDER to investigate, never as a defect list. Its opposite
 * claim is the stronger one — a field whose name appears NOWHERE in the frontend is very
 * unlikely to be read by it, and can be deprioritised with reasonable confidence.
 *
 * Usage:
 *   node aspnet-backend/scripts/compare-live-responses.mjs --paths … --json out.json
 *   node aspnet-backend/scripts/rank-read-differences.mjs out.json
 *   node aspnet-backend/scripts/rank-read-differences.mjs out.json --client web-uk
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const jsonPath = args.find((a) => !a.startsWith('--'));
const clientArg = (() => { const i = args.indexOf('--client'); return i >= 0 ? args[i + 1] : 'react'; })();

if (!jsonPath) {
  console.error('usage: node rank-read-differences.mjs <harness-output.json> [--client react|web-uk]');
  process.exit(2);
}

const CLIENTS = {
  react: { root: 'react-frontend/src', exts: ['.ts', '.tsx'] },
  'web-uk': { root: 'web-uk/src', exts: ['.js', '.njk'] },
};
const client = CLIENTS[clientArg];
if (!client) {
  console.error(`unknown client "${clientArg}" — expected one of: ${Object.keys(CLIENTS).join(', ')}`);
  process.exit(2);
}

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const clientRoot = path.join(repoRoot, client.root);
if (!fs.existsSync(clientRoot)) {
  console.error(`client source not found: ${clientRoot}`);
  process.exit(2);
}

/** Every snake_case-ish identifier appearing anywhere in the client source. */
function indexIdentifiers(dir) {
  const found = new Set();
  const stack = [dir];
  let files = 0;
  while (stack.length) {
    for (const entry of fs.readdirSync(stack.pop(), { withFileTypes: true })) {
      const full = path.join(entry.parentPath ?? entry.path, entry.name);
      if (entry.isDirectory()) { stack.push(full); continue; }
      if (!client.exts.includes(path.extname(entry.name))) continue;
      files += 1;
      const text = fs.readFileSync(full, 'utf8');
      // 🔴 Property-ACCESS forms only, not every identifier. Indexing bare tokens
      // matched 746 of 862 missing fields, because generic words like `title`,
      // `status` and `name` occur everywhere in any codebase — the ranking had no
      // discriminating power. These four forms are how a client actually reads a
      // field off a response, plus the interface declarations that say it expects one:
      //   obj.field        ['field'] / ["field"]        { field: … }        field?: T
      for (const m of text.matchAll(/\.([A-Za-z_][A-Za-z0-9_]{2,})/g)) found.add(m[1]);
      for (const m of text.matchAll(/\[\s*['"]([A-Za-z_][A-Za-z0-9_]{2,})['"]\s*\]/g)) found.add(m[1]);
      for (const m of text.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]{2,})\??\s*:/gm)) found.add(m[1]);
    }
  }
  return { found, files };
}

const { found, files } = indexIdentifiers(clientRoot);

/** `data[].sender.avatar` -> `avatar`; the leaf is what a client dereferences. */
const leaf = (p) => p.split('.').pop().replace(/\[\]$/, '');

const report = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
const differing = report.results.filter((r) => r.verdict === 'SHAPE_DIFFERS');

const rows = differing.map((r) => {
  const missing = r.missing_in_aspnet ?? [];
  const read = missing.filter((f) => found.has(leaf(f)));
  return { path: r.path, method: r.method, total: r.missing_count ?? missing.length, read, unread: missing.length - read.length };
}).sort((a, b) => b.read.length - a.read.length || b.total - a.total);

const totalMissing = rows.reduce((s, r) => s + r.total, 0);
const totalRead = rows.reduce((s, r) => s + r.read.length, 0);

console.log(`Client        : ${clientArg} (${files} files, ${found.size} property names indexed)`);
console.log(`Harness output: ${jsonPath}`);
console.log(`Differing endpoints: ${rows.length}`);
console.log(`Missing fields: ${totalMissing} total, ${totalRead} whose name appears in the client source\n`);
console.log('🔴 Ranked by fields the client plausibly READS. A high "reads" count is a');
console.log('   reason to look; a zero is a reason to deprioritise. Neither is a verdict.\n');

for (const r of rows) {
  if (r.read.length === 0) continue;
  console.log(`${String(r.read.length).padStart(3)}/${String(r.total).padEnd(4)} ${r.method} ${r.path}`);
  console.log(`         ${r.read.slice(0, 10).join(', ')}${r.read.length > 10 ? `, … +${r.read.length - 10}` : ''}`);
}

const quiet = rows.filter((r) => r.read.length === 0);
console.log(`\n${quiet.length} differing endpoint(s) have NO missing field whose name the client mentions —`);
console.log('deprioritise these: they are very likely raw database columns nothing reads.');
for (const r of quiet.slice(0, 15)) console.log(`     0/${String(r.total).padEnd(4)} ${r.method} ${r.path}`);
if (quiet.length > 15) console.log(`     … and ${quiet.length - 15} more`);
