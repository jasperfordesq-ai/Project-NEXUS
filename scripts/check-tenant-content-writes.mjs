// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-tenant-content-writes — BLOCKING guard (owner requirement, 2026-10-22:
 * "people make custom changes to their landing pages or any other page" and
 * a deploy must never overwrite them).
 *
 * Deploys run pending migrations automatically (bluegreen-deploy.sh), so a
 * migration that writes community content silently replaces what a community
 * chose, on every server that has not run it yet.
 * `migrations/2026_05_13_normalize_hour_timebank_branding.sql` did exactly
 * that to hour-timebank's name, meta title, title suffix and footer.
 *
 * This script fails when a migration file (database/migrations/*.php,
 * migrations/*.sql) OVERWRITES or REMOVES community-written content:
 *   - tenants columns a community edits (SEO tab, General, Contact, Social —
 *     COLUMNS) and its branding inside tenants.configuration (CONFIG_KEYS);
 *   - tenant_settings keys: landing_page.config, every seo_* key, footer_text;
 *   - existing rows of the content tables (CONTENT_TABLES): custom pages,
 *     menus, legal documents, help and knowledge base, blog, newsletter
 *     templates.
 * Adding or altering COLUMNS (schema) is fine, and so is adding NEW rows
 * (INSERT, INSERT IGNORE, insertOrIgnore). Changing or deleting what a
 * community wrote is not.
 *
 * A migration that genuinely must do it (a one-off the community asked for,
 * or a platform-wide content fix) carries a line containing
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

// Community-written fields on the tenants row: SEO tab, General settings,
// Contact, Social.
const COLUMNS = [
  'meta_title', 'meta_description', 'h1_headline', 'hero_intro',
  'og_image_url', 'robots_directive', 'seo_organization_type',
  'name', 'tagline', 'description',
  'contact_email', 'contact_phone', 'address',
  'social_facebook', 'social_twitter', 'social_instagram', 'social_linkedin', 'social_youtube',
];
// Community-written branding kept inside tenants.configuration JSON.
const CONFIG_KEYS = ['footer_text', 'logo_url', 'logo_dark_url', 'favicon_url', 'primary_color'];
// Tables whose rows a community writes itself. A migration may ADD rows; it
// may not change or remove the ones that exist.
const CONTENT_TABLES = [
  'pages', 'page_blocks', 'page_versions', 'menus', 'menu_items',
  'legal_documents', 'legal_document_versions',
  'help_articles', 'help_faqs', 'knowledge_base_articles',
  'blog_posts', 'posts', 'newsletter_templates',
];
// An overwrite or removal, as opposed to adding a new row.
const OVERWRITE = /\bUPDATE\b|ON\s+DUPLICATE\s+KEY\s+UPDATE|\bREPLACE\s+INTO\b|\bDELETE\b|\bTRUNCATE\b|->\s*(update|updateOrInsert|upsert|delete|truncate)\s*\(/i;
const APPROVAL = /tenant-content-overwrite:\s*approved\b/i;

function stripComments(src, ext) {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  s = ext === '.sql' ? s.replace(/^\s*--.*$/gm, ' ') : s.replace(/^\s*(\/\/|#).*$/gm, ' ');
  return s;
}

/** Each statement-ish chunk that writes, as text. */
function writeChunks(code) {
  const chunks = [];
  for (const m of code.matchAll(/\b(UPDATE|INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO|DELETE\s+FROM|TRUNCATE(?:\s+TABLE)?)\b[\s\S]*?(;|$)/gi)) {
    chunks.push(m[0]);
  }
  for (const m of code.matchAll(/DB::table\(\s*['"](\w+)['"]\s*\)[\s\S]*?->\s*(update|insert|insertOrIgnore|updateOrInsert|upsert|delete|truncate)\s*\([\s\S]*?\)\s*;/g)) {
    chunks.push(m[0]);
  }
  return chunks;
}

/** The table a write chunk targets. */
function targetTable(chunk) {
  const m = chunk.match(/DB::table\(\s*['"](\w+)['"]/)
    || chunk.match(/\b(?:UPDATE|INTO|FROM|TRUNCATE(?:\s+TABLE)?)\s+`?(\w+)`?/i);
  return m ? m[1].toLowerCase() : null;
}

function assigns(chunk, col) {
  // SQL "col =" / "`col` =" (not "=="), or PHP "'col' =>"
  return new RegExp('(`?\\b' + col + '\\b`?\\s*=(?!=))|([\'"]' + col + '[\'"]\\s*=>)', 'i').test(chunk);
}

function offends(code) {
  for (const chunk of writeChunks(code)) {
    const table = targetTable(chunk);
    if (!table || !OVERWRITE.test(chunk)) continue;
    if (table === 'tenants') {
      for (const col of COLUMNS) {
        if (assigns(chunk, col)) return `overwrites tenants.${col}`;
      }
      for (const key of CONFIG_KEYS) {
        if (new RegExp('\\$\\.' + key + '\\b').test(chunk)) return `overwrites tenants.configuration ${key}`;
      }
    }
    if (table === 'tenant_settings') {
      if (/['"]landing_page\.config['"]/.test(chunk)) return 'overwrites tenant_settings landing_page.config';
      const seo = chunk.match(/['"](seo_[a-z_]+)['"]/);
      if (seo) return `overwrites tenant_settings ${seo[1]}`;
      if (/['"](?:general\.)?footer_text['"]/.test(chunk)) return 'overwrites tenant_settings footer_text';
    }
    if (CONTENT_TABLES.includes(table)) return `changes or removes existing ${table} rows`;
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
if (process.argv.includes('--list')) {
  for (const [f, why] of Object.entries(found)) console.log(`${f} — ${why}`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [];
const fresh = Object.keys(found).filter((f) => !baseline.includes(f));
const stale = baseline.filter((f) => !(f in found));

if (fresh.length === 0 && stale.length === 0) {
  console.log(`check-tenant-content-writes: OK — no new migration overwrites content a community wrote (${baseline.length} older file(s) on the baseline; they have already run).`);
  process.exit(0);
}

if (fresh.length) {
  console.error('check-tenant-content-writes: FAILED — these migrations would overwrite or remove content a community');
  console.error('wrote (landing page, SEO, custom pages, menus, legal documents, help, blog, branding), on every');
  console.error('server that has not run them yet:');
  for (const f of fresh) console.error(`  ✗ ${f} — ${found[f]}`);
  console.error('');
  console.error('Do not overwrite community content from a migration. If the change is genuinely wanted, add a');
  console.error('line to the file:  tenant-content-overwrite: approved — <who asked, and why>');
}
if (stale.length) {
  console.error('check-tenant-content-writes: these baseline entries no longer offend — remove them from');
  console.error('.github/tenant-content-writes-baseline.json (the list only shrinks):');
  for (const f of stale) console.error(`  - ${f}`);
}
process.exit(1);
