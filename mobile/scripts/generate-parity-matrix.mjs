// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Mobile parity matrix — machine-checked, not prose.
 *
 * `docs/HEROUI_NATIVE_PARITY_AUDIT.md` describes parity at the level of product
 * areas ("Events: broad core parity"). That is genuinely useful for judgement,
 * and it is also unfalsifiable: a whole new React member route can land and
 * every row of it stays true. Web UK learned this the expensive way — Laravel
 * shipped 18 accessible routes during a pause and the deficit went from 1 route
 * to 19 with nothing reporting it for over a week.
 *
 * So this compares the two route inventories directly and forces a DECISION on
 * every React member route:
 *
 *   native        — a mobile screen covers it
 *   out-of-scope  — deliberately not on a phone, with a stated reason
 *   gap           — member-facing, wanted, not built yet
 *   needs-review  — carried over from the first pass; nobody has judged it yet
 *   (undeclared)  — not in the map at all; this FAILS `--check`
 *
 * The last one is the whole mechanism. A NEW React route cannot quietly become
 * invisible mobile debt, because the check goes red until someone writes down
 * what they intend. "Out of scope" is a perfectly good answer — an unrecorded
 * one is not.
 *
 * `needs-review` exists so the gate could be switched on honestly rather than
 * being switched on "later". Classifying 254 routes in one sitting would have
 * meant guessing at a good few, and a confidently wrong `out-of-scope` is worse
 * than an admitted unknown — it closes the question. So the first pass declared
 * what it could prove and labelled the rest. The count is capped in the map
 * (`needs_review_budget`) and the cap is shrink-only: it may be lowered as
 * routes get judged, never raised. Same discipline as the React quarantine
 * budget. It is a queue, not an exemption.
 *
 * Declarations live in `parity-map.json`. The generator never edits it: a
 * generator that silently declares its own scope would defeat the point.
 *
 * Usage:
 *   node scripts/generate-parity-matrix.mjs           # write the matrix
 *   node scripts/generate-parity-matrix.mjs --check   # exit 1 on undeclared routes
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');
const REACT_ROUTES_DIR = path.join(REPO_ROOT, 'react-frontend', 'src', 'routes');
const MOBILE_APP_DIR = path.join(MOBILE_ROOT, 'app');
const MAP_FILE = path.join(MOBILE_ROOT, 'parity-map.json');
const OUT_DIR = path.join(MOBILE_ROOT, 'docs', 'generated');

const CHECK = process.argv.slice(2).includes('--check');

/**
 * React member routes come from the route registry files. Admin, broker,
 * super-admin and caring workspaces mount as `<area>/*` wildcards; those single
 * entries stand for whole applications and are classified once, in parity-map.json.
 */
function readReactRoutes() {
  if (!fs.existsSync(REACT_ROUTES_DIR)) {
    console.error(`parity: ${path.relative(REPO_ROOT, REACT_ROUTES_DIR)} not found.`);
    process.exit(1);
  }
  const routes = new Map();
  for (const file of fs.readdirSync(REACT_ROUTES_DIR).sort()) {
    if (!file.endsWith('.tsx') || file.includes('.test.')) continue;
    const src = fs.readFileSync(path.join(REACT_ROUTES_DIR, file), 'utf8');
    const re = /path="([^"]*)"/g;
    for (let m; (m = re.exec(src)); ) {
      const p = m[1];
      if (p === '' || p === '*') continue;
      if (!routes.has(p)) routes.set(p, new Set());
      routes.get(p).add(file);
    }
  }
  return routes;
}

/**
 * Mobile routes come from Expo Router's file system. A group directory in
 * parentheses — `(tabs)`, `(modals)` — is a layout, not a URL segment.
 */
function readMobileRoutes() {
  const routes = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name)) continue;
      if (/\.test\.tsx?$/.test(entry.name)) continue;
      const base = entry.name.replace(/\.tsx?$/, '');
      // `_layout` is a layout; `+native-intent` is a deep-link resolver.
      if (base === '_layout' || base.startsWith('+')) continue;
      const rel = path.relative(MOBILE_APP_DIR, full).split(path.sep).join('/');
      routes.push({
        file: `app/${rel}`,
        route: rel.replace(/\.tsx?$/, '').replace(/\([^)]*\)\//g, ''),
        group: (rel.match(/\(([^)]*)\)/) || [null, 'root'])[1],
      });
    }
  };
  walk(MOBILE_APP_DIR);
  return routes;
}

function loadMap() {
  if (!fs.existsSync(MAP_FILE)) {
    console.error('parity: parity-map.json is missing. It is the declaration of intent and cannot be generated.');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
}

function main() {
  const reactRoutes = readReactRoutes();
  const mobileRoutes = readMobileRoutes();
  const declarations = loadMap();

  const mobileRouteNames = new Set(mobileRoutes.map((r) => r.route));

  const rows = [];
  const undeclared = [];
  const brokenTargets = [];

  for (const [route, files] of [...reactRoutes.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const decl = declarations.routes?.[route];
    if (!decl) {
      undeclared.push({ route, declared_in: [...files].sort() });
      rows.push({ route, status: 'undeclared', mobile: null, reason: null, sources: [...files].sort() });
      continue;
    }

    const status = decl.status;
    const mobile = decl.mobile ?? null;

    // A declaration pointing at a screen that no longer exists is worse than no
    // declaration: it asserts parity that has been deleted.
    if (status === 'native') {
      const targets = Array.isArray(mobile) ? mobile : mobile ? [mobile] : [];
      if (targets.length === 0) {
        brokenTargets.push({ route, problem: 'declared native with no mobile route named' });
      }
      for (const t of targets) {
        if (!mobileRouteNames.has(t)) brokenTargets.push({ route, problem: `names mobile route "${t}", which does not exist` });
      }
    }

    rows.push({ route, status, mobile, reason: decl.reason ?? null, sources: [...files].sort() });
  }

  const claimed = new Set();
  for (const r of rows) {
    if (r.status !== 'native') continue;
    for (const t of Array.isArray(r.mobile) ? r.mobile : r.mobile ? [r.mobile] : []) claimed.add(t);
  }
  const mobileOnly = mobileRoutes.filter((r) => !claimed.has(r.route)).map((r) => r.route);

  const counts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  const report = {
    generated_by: 'mobile/scripts/generate-parity-matrix.mjs',
    summary: {
      react_member_routes: reactRoutes.size,
      mobile_routes: mobileRoutes.length,
      native: counts.native || 0,
      out_of_scope: counts['out-of-scope'] || 0,
      gap: counts.gap || 0,
      needs_review: counts['needs-review'] || 0,
      needs_review_budget: declarations.needs_review_budget ?? null,
      undeclared: counts.undeclared || 0,
      mobile_routes_not_claimed_by_any_react_route: mobileOnly.length,
      broken_declarations: brokenTargets.length,
    },
    undeclared,
    broken_declarations: brokenTargets,
    gaps: rows.filter((r) => r.status === 'gap'),
    needs_review: rows.filter((r) => r.status === 'needs-review'),
    mobile_only: mobileOnly,
    rows,
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'mobile-parity-matrix.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'mobile-parity-matrix.md'), renderMarkdown(report), 'utf8');

  const s = report.summary;
  console.log(
    `parity: ${s.react_member_routes} React routes vs ${s.mobile_routes} mobile routes — ` +
      `native ${s.native}, out-of-scope ${s.out_of_scope}, gap ${s.gap}, ` +
      `needs-review ${s.needs_review}/${s.needs_review_budget ?? '?'}, undeclared ${s.undeclared}`
  );

  if (!CHECK) return;

  let failed = false;

  // Shrink-only: the queue of unjudged routes may empty but never grow. Without
  // this, `needs-review` degrades into the place new routes get parked.
  if (typeof s.needs_review_budget === 'number' && s.needs_review > s.needs_review_budget) {
    console.error(
      `parity: needs-review count ${s.needs_review} exceeds the budget of ${s.needs_review_budget}.`
    );
    console.error('parity: classify a route as native, gap or out-of-scope — do NOT raise the budget.');
    failed = true;
  }
  for (const u of report.undeclared) {
    console.error(`parity: UNDECLARED React route "${u.route}" (${u.declared_in.join(', ')}) — classify it in parity-map.json`);
    failed = true;
  }
  for (const b of report.broken_declarations) {
    console.error(`parity: BROKEN DECLARATION "${b.route}" ${b.problem}`);
    failed = true;
  }
  if (failed) {
    console.error('');
    console.error('parity: every React member route needs a recorded decision — native, gap, or out-of-scope with a reason.');
    console.error('parity: "out-of-scope" is a fine answer. Silence is not.');
    process.exit(1);
  }
  console.log('parity: OK — every React member route has a recorded decision and every native claim resolves.');
}

/**
 * `scripts/check-docs-hygiene.mjs` requires an exact `Last reviewed: YYYY-MM-DD`
 * line within the first 10 lines of every scoped Markdown file, and re-flags it
 * after 180 days. For a generated report the generation date IS the review date,
 * and that expiry is a feature: it forces a regeneration rather than letting a
 * stale matrix sit in the repository looking authoritative.
 *
 * Note the consequence: regenerating on a new day changes this line even when
 * nothing else moved. That is deliberate — the file is an artefact, and when it
 * was last rebuilt is part of what it reports.
 */
function reviewedMarker() {
  const now = new Date();
  const iso = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return `Last reviewed: ${iso}`;
}

function renderMarkdown(r) {
  const s = r.summary;
  const L = [];
  L.push('<!--');
  L.push('Copyright © 2024–2026 Jasper Ford');
  L.push('SPDX-License-Identifier: AGPL-3.0-or-later');
  L.push('-->');
  L.push('');
  L.push('# Mobile Route Parity Matrix');
  L.push('');
  L.push(reviewedMarker());
  L.push('');
  L.push('> GENERATED FILE — do not edit by hand.');
  L.push('> Regenerate with `npm run parity:matrix` from `mobile/`.');
  L.push('> Declarations live in `mobile/parity-map.json`; this file only reports them.');
  L.push('');
  L.push('Route-level companion to [HEROUI_NATIVE_PARITY_AUDIT.md](../HEROUI_NATIVE_PARITY_AUDIT.md).');
  L.push('That document records product judgement per area; this one is falsifiable — it fails');
  L.push('when a React member route exists that nobody has classified for mobile.');
  L.push('');
  L.push('| Measure | Count |');
  L.push('| --- | --- |');
  L.push(`| React member routes | ${s.react_member_routes} |`);
  L.push(`| Mobile routes (Expo Router screens) | ${s.mobile_routes} |`);
  L.push(`| Covered natively | ${s.native} |`);
  L.push(`| Deliberately out of scope | ${s.out_of_scope} |`);
  L.push(`| **Known gaps** | **${s.gap}** |`);
  L.push(`| Awaiting review (shrink-only, budget ${s.needs_review_budget ?? '—'}) | ${s.needs_review} |`);
  L.push(`| **Undeclared (blocks \`--check\`)** | **${s.undeclared}** |`);
  L.push(`| Mobile routes not claimed by a React route | ${s.mobile_routes_not_claimed_by_any_react_route} |`);
  L.push(`| Broken declarations | ${s.broken_declarations} |`);
  L.push('');

  if (r.undeclared.length) {
    L.push('## Undeclared — needs a decision');
    L.push('');
    L.push('| React route | Declared in |');
    L.push('| --- | --- |');
    for (const u of r.undeclared) L.push(`| \`${u.route}\` | ${u.declared_in.join(', ')} |`);
    L.push('');
  }

  if (r.broken_declarations.length) {
    L.push('## Broken declarations');
    L.push('');
    for (const b of r.broken_declarations) L.push(`- \`${b.route}\` — ${b.problem}`);
    L.push('');
  }

  if (r.needs_review.length) {
    L.push('## Awaiting review');
    L.push('');
    L.push('Declared in the first pass but not yet judged. Shrink-only: this list may empty,');
    L.push('never grow. Each entry needs to become `native`, `gap` or `out-of-scope`.');
    L.push('');
    L.push('| React route | Note |');
    L.push('| --- | --- |');
    for (const n of r.needs_review) L.push(`| \`${n.route}\` | ${n.reason || '—'} |`);
    L.push('');
  }

  if (r.gaps.length) {
    L.push('## Known gaps (member-facing, wanted, not built)');
    L.push('');
    L.push('| React route | Note |');
    L.push('| --- | --- |');
    for (const g of r.gaps) L.push(`| \`${g.route}\` | ${g.reason || '—'} |`);
    L.push('');
  }

  L.push('## Full matrix');
  L.push('');
  L.push('| React route | Status | Mobile screen | Reason |');
  L.push('| --- | --- | --- | --- |');
  for (const row of r.rows) {
    const mobile = Array.isArray(row.mobile) ? row.mobile.map((m) => `\`${m}\``).join(', ') : row.mobile ? `\`${row.mobile}\`` : '—';
    L.push(`| \`${row.route}\` | ${row.status} | ${mobile} | ${row.reason || '—'} |`);
  }
  L.push('');

  if (r.mobile_only.length) {
    L.push('## Mobile routes not claimed by any React route');
    L.push('');
    L.push('Usually a mobile screen that splits one React page, or a native-only surface.');
    L.push('A surprise here can also mean a `native` declaration names the wrong screen.');
    L.push('');
    for (const m of r.mobile_only) L.push(`- \`${m}\``);
    L.push('');
  }

  // Trim trailing blanks: each section builder ends with a spacer, which leaves
  // a double blank line at EOF and trips markdownlint MD012 in CI.
  return `${L.join('\n').replace(/\n+$/, '')}\n`;
}

main();
