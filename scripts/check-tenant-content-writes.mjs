// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-tenant-content-writes — BLOCKING guard (owner requirement, 2026-10-22).
 *
 * Every community writes its own landing page (landing page builder) and SEO
 * settings (/admin/seo, super-admin tenant form). A deploy must never
 * overwrite that. Deploys run pending migrations automatically
 * (bluegreen-deploy.sh), so a migration that writes these values silently
 * replaces what a community chose — `migrations/2026_05_13_normalize_hour_
 * timebank_branding.sql` did exactly that to hour-timebank's meta title and
 * title suffix.
 *
 * This script fails when a migration file (database/migrations/*.php,
 * migrations/*.sql) WRITES community-owned landing or SEO content:
 *   - tenants columns: meta_title, meta_description, h1_headline, hero_intro,
 *     og_image_url, robots_directive, seo_organization_type;
 *   - tenant_settings keys: landing_page.config and every seo_* key.
 * Adding or altering those COLUMNS (schema) is fine; assigning values is not.
 *
 * A migration that genuinely must write them (for example, a one-off the
 * community asked for) carries a line containing
 *     tenant-content-overwrite: approved — <who asked, and why>
 * which makes the decision visible in review.
 *
 * Files that already did this before the guard existed are listed in
 * .github/tenant-content-writes-baseline.json. They have run once and will
 * not run again (applied migrations are recorded). The list is shrink-only in
 * both directions: a new offender fails, and so does a listed file that no
 * longer offends (remove it from the list).
 *
 *   node scripts/check-tenant-content-writes.mjs
 *   node scripts/check-tenant-content-writes.mjs --write-baseline   # only to shrink it
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const BASELINE = join(ROOT, '.github', 'tenant-content-writes-baseline.json');
const DIRS = [
  { dir: 'database/migrations', ext: '.php' },
  { dir: 'migrations', ext: '.sql' },
];
const COLUMNS = [
  'meta_title', 'meta_description', 'h1_headline', 'hero_intro',
  'og_image_url', 'robots_directive', 'seo_organization_type',
];
const APPROVAL = /tenant-content-overwrite:\s*approved\b/i;

function stripComments(src, ext) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = ext === '.sql' ? s.replace(/^\s*--.*$/gm, ' ') : s.replace(/^\s*(\/\/|#).*$/gm, ' ');
  return s;
}

/** Each statement-ish chunk that writes, as text. */
function writeChunks(code) {
  const chunks = [];
  // SQL: UPDATE … SET … / INSERT INTO … (up to the terminating semicolon).
  for (const m of code.matchAll(/\b(UPDATE|INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO)\b[\s\S]*?(;|$)/gi)) chunks.push(m[0]);
  // Laravel query builder: DB::table('x') … ->update/insert/updateOrInsert/upsert( … )
  for (const m of code.matchAll(/DB::table\(\s*['"](\w+)['"]\s*\)[\s\S]*?->\s*(update|insert|insertOrIgnore|updateOrInsert|upsert)\s*\([\s\S]*?\)\s*;/g)) chunks.push(m[0]);
  return chunks;
}

function offends(code) {
  for (const chunk of writeChunks(code)) {
    const touchesTenants = /\btenants\b/i.test(chunk) && !/\btenant_settings\b/i.test(chunk.split(/\bWHERE\b/i)[0] ?? chunk);
    if (touchesTenants) {
      for (const col of COLUMNS) {
        // SQL "col =" / "`col` =" or PHP "'col' =>"
        const assign = new RegExp(`(\`?\\b${col}\\b\`?\\s*=(?!=))|(['"]${col}['"]\\s*=>)`, 'i');
        if (assign.test(chunk)) return `writes tenants.${col}`;
      }
    }
    if (/\btenant_settings\b/i.test(chunk)) {
      if (/['"]landing_page\.config['"]/.test(chunk)) return 'writes tenant_settings landing_page.config';
      const seo = chunk.match(/['"](seo_[a-z_]+)['"]/);
      if (seo) return `writes tenant_settings ${seo[1]}`;
    }
  }
  return null;
}

function scan() {
  const found = {};
  for (const { dir, ext } of DIRS) {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) continue;
    for (const name of readdirSync(abs).sort()) {
      if (!name.endsWith(ext)) continue;
      const path = join(abs, name);
      const src = readFileSync(path, 'utf8');
      if (APPROVAL.test(src)) continue;
      const why = offends(stripComments(src, ext));
      if (why) found[relative(ROOT, path).replace(/\\/g, '/')] = why;
    }
  }
  return found;
}

const found = scan();

if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, JSON.stringify(Object.keys(found).sort(), null, 2) + '\n');
  console.log(`check-tenant-content-writes: baseline written with ${Object.keys(found).length} file(s).`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [];
const fresh = Object.keys(found).filter((f) => !baseline.includes(f));
const stale = baseline.filter((f) => !(f in found));

if (fresh.length === 0 && stale.length === 0) {
  console.log(`check-tenant-content-writes: OK — no new migration writes a community's landing page or SEO settings (${baseline.length} older file(s) on the baseline; they have already run).`);
  process.exit(0);
}

if (fresh.length) {
  console.error('check-tenant-content-writes: FAILED — these migrations would overwrite what a community wrote');
  console.error('in its landing page builder or SEO settings, on every deploy target that has not run them yet:');
  for (const f of fresh) console.error(`  ✗ ${f} — ${found[f]}`);
  console.error('');
  console.error('Do not write community-owned content from a migration. If a community genuinely asked for');
  console.error('this change, add a line to the file:  tenant-content-overwrite: approved — <who, why>');
}
if (stale.length) {
  console.error('check-tenant-content-writes: these baseline entries no longer offend — remove them from');
  console.error('.github/tenant-content-writes-baseline.json (the list only shrinks):');
  for (const f of stale) console.error(`  - ${f}`);
}
process.exit(1);
