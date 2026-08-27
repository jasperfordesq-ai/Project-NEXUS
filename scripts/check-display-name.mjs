// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-display-name.mjs — fail when new code builds a user's display name by
 * concatenating `first_name` and `last_name`.
 *
 * WHY THIS EXISTS
 * ---------------
 * An account created through the general sign-up (or switched later in profile
 * settings) can be an ORGANISATION: `users.profile_type = 'organisation'` with
 * the trading name in `users.organization_name`. `first_name`/`last_name` then
 * hold the CONTACT PERSON, who must never be shown as the account's identity.
 *
 * On 2026-08-27 an audit found the personal name leaking into every React
 * surface through hundreds of hand-rolled concatenations plus three broken
 * write paths, the worst being that `users.name` — a real stored column read by
 * more than a hundred call sites — was written as first+last on insert, left
 * EMPTY by self-registration, and never recomputed when a member switched their
 * profile to an organisation. The logic now lives in one place per side:
 * `App\Support\UserDisplayName` (PHP) and `resolveUserDisplayName()` in
 * `react-frontend/src/lib/helpers.ts`.
 *
 * This gate stops the concatenations coming back. It is a SHRINK-ONLY ratchet in
 * BOTH directions: the remaining known sites are counted, and the count may only
 * fall. Fixing one means lowering BASELINE in the same commit, so a fix cannot
 * land without tightening the ratchet behind it.
 *
 * WHAT IS AND IS NOT A VIOLATION
 * ------------------------------
 * A violation is building a NAME from the two parts. Searching by them is fine
 * (`WHERE CONCAT(first_name, ' ', last_name) LIKE ?` legitimately matches a
 * person), as is reading either part alone — an email greeting addressed to a
 * contact person by first name is correct, not a bug. That is why the SQL rule
 * only fires on a CONCAT that is given a SELECT alias.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * Known-remaining concatenation sites. Shrink-only, in both directions.
 *
 * The 2026-08-27 sweep left the working tree at ZERO. The ceiling is 4 only
 * because two files could not be committed with that sweep:
 *
 *   app/Services/FeedService.php        (2)
 *   app/Services/GamificationService.php (2)
 *
 * Both were simultaneously being edited by other, unrelated in-progress work
 * (removing gamification cards from the feed), and staging them would have
 * committed that work too. Their display-name fixes are already applied in the
 * working tree.
 *
 * 🔴 So the NEXT commit that touches either file must LOWER THIS TO 0. The
 * gate fails when the count drops below the ceiling precisely so that cannot be
 * forgotten — that failure is the reminder working, not a bug. Do not raise
 * this number for any other reason: if a genuinely person-specific surface ever
 * needs the parts joined by hand, say which site and why, here.
 */
const BASELINE = Number(process.env.DISPLAY_NAME_BASELINE ?? '0');

/** Directories never scanned. */
const SKIP_DIRS = new Set([
  'node_modules',
  'vendor',
  '.git',
  'dist',
  'build',
  'coverage',
  '__snapshots__',
  '.heroui-docs',
  'storage',
]);

/** Trees that are scanned, and which extensions matter in each. */
const TARGETS = [
  { dir: 'app', exts: ['.php'] },
  { dir: join('react-frontend', 'src'), exts: ['.ts', '.tsx'] },
];

/** Files exempt because they ARE the implementation, or a perf-audit fixture. */
const EXEMPT_FILES = new Set(
  [
    join('app', 'Support', 'UserDisplayName.php'),
    join('react-frontend', 'src', 'lib', 'helpers.ts'),
    // Holds frozen copies of production SQL purely to assert the columns exist.
    join('app', 'Console', 'Commands', 'AuditHotPathPerformance.php'),
  ].map((p) => p.split(sep).join('/')),
);

const PATTERNS = [
  {
    id: 'php-concat',
    description: 'PHP string concatenation of first_name and last_name',
    exts: ['.php'],
    build: () => /first_name[^;\n]{0,40}?\)?\s*\.\s*' '\s*\.\s*[^;\n]{0,40}?last_name/g,
  },
  {
    id: 'sql-concat-alias',
    description: 'CONCAT(first_name, last_name) given a SELECT alias',
    exts: ['.php'],
    build: () => /CONCAT\([^)]*first_name[^)]*\)\s*(?:as|AS)\s+[A-Za-z_][A-Za-z0-9_]*/g,
  },
  {
    id: 'ts-template-concat',
    description: 'TS template literal joining first_name and last_name',
    exts: ['.ts', '.tsx'],
    build: () => /\$\{[^}]*first_name[^}]*\}\s*\$\{[^}]*last_name[^}]*\}/g,
  },
  {
    id: 'ts-array-join',
    description: 'TS array of name parts piped through filter/join/map',
    exts: ['.ts', '.tsx'],
    build: () => /\[[^\]]*first_name[^\]]*last_name[^\]]*\]\s*\.\s*(?:filter|join|map)/g,
  },
  {
    id: 'american-spelling',
    description: "profile_type compared against 'organization' (never matches)",
    exts: ['.php', '.ts', '.tsx'],
    build: () => /profile_type[^;\n]{0,24}(?:===|==|=)\s*'organization'/g,
  },
];

function walk(dir, exts, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(full, exts, out);
    } else if (exts.some((e) => entry.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];

for (const target of TARGETS) {
  for (const file of walk(join(ROOT, target.dir), target.exts, [])) {
    const rel = relative(ROOT, file).split(sep).join('/');
    if (EXEMPT_FILES.has(rel)) continue;
    // Tests deliberately construct both correct and incorrect names.
    if (/\.test\.|\/tests?\//i.test(rel)) continue;
    if (rel.endsWith('resources.d.ts')) continue;

    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (!source.includes('first_name') && !source.includes('organization')) continue;

    const lines = source.split('\n');
    for (const pattern of PATTERNS) {
      if (!pattern.exts.some((e) => rel.endsWith(e))) continue;
      const re = pattern.build();
      let match;
      while ((match = re.exec(source)) !== null) {
        const line = source.slice(0, match.index).split('\n').length;
        const text = lines[line - 1] ?? '';
        // A comment describing the old idiom is documentation, not a violation —
        // this file and UserObserver both quote it deliberately.
        if (/^\s*(\*|\/\/|#)/.test(text)) continue;
        findings.push({
          file: rel,
          line,
          id: pattern.id,
          text: text.trim().slice(0, 140),
        });
      }
    }
  }
}

const byPattern = {};
for (const f of findings) {
  byPattern[f.id] = (byPattern[f.id] ?? 0) + 1;
}

console.log('Display-name concatenation gate');
console.log('='.repeat(64));
for (const pattern of PATTERNS) {
  console.log(`  ${pattern.id.padEnd(22)} ${String(byPattern[pattern.id] ?? 0).padStart(4)}   ${pattern.description}`);
}
console.log(`  ${'TOTAL'.padEnd(22)} ${String(findings.length).padStart(4)}   (ceiling ${BASELINE})`);
console.log('');

if (findings.length > BASELINE) {
  console.error(`FAIL: ${findings.length - BASELINE} display-name concatenation(s) above the ceiling.`);
  console.error('');
  console.error('An organisation account is identified by `organization_name`, never by the');
  console.error('contact person held in first_name/last_name. Use one of:');
  console.error('  PHP    App\\Support\\UserDisplayName::resolve($row)');
  console.error('         App\\Support\\UserDisplayName::sql($alias, $as)   (inside a SELECT)');
  console.error('  React  resolveUserDisplayName(user)   from @/lib/helpers');
  console.error('');
  console.error('All current findings (pre-existing ones included — compare against the ceiling):');
  for (const f of findings.slice(0, 60)) {
    console.error(`  ${f.file}:${f.line}  [${f.id}]  ${f.text}`);
  }
  if (findings.length > 60) {
    console.error(`  … and ${findings.length - 60} more`);
  }
  process.exit(1);
}

if (findings.length < BASELINE) {
  console.error(`FAIL: ${BASELINE - findings.length} concatenation(s) removed — lower the ceiling.`);
  console.error(`Set BASELINE in scripts/check-display-name.mjs to ${findings.length}.`);
  console.error('Shrink-only in both directions: a fix must tighten the ratchet behind it.');
  console.error('');
  console.error('If this is the first commit to touch FeedService.php or');
  console.error('GamificationService.php since 2026-08-27, this is the expected reminder:');
  console.error('their display-name fixes were already in the working tree but could not be');
  console.error('staged with the sweep. Lower the ceiling to 0 in the same commit.');
  process.exit(1);
}

console.log(`PASS: ${findings.length} known concatenation(s), exactly at the ceiling.`);
