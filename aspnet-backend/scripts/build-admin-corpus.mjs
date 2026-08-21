// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Builds the STAFF-TIER (admin) endpoint corpus and classifies it four ways, so
 * ledger Tier 5 can be scheduled from evidence instead of guesswork.
 *
 * Static only. It never starts a container, never issues a request, and never
 * needs a backend. Everything it reports is therefore an UPPER BOUND on health
 * and a LOWER BOUND on work: a live run finds shape mismatches this cannot see,
 * exactly as it did on the member read corpus where 64 of 80 differing
 * endpoints turned out to be real work.
 *
 * Four classes (ADR-0004):
 *   uncalled            no client reads it and no published contract names it
 *                       -> a DELETION candidate in both engines, not work
 *   absent              a client calls it and ASP.NET has no counterpart
 *   stub                a counterpart exists and performs none of the
 *                       endpoint's work. THREE distinct sub-kinds, below.
 *   identical-candidate a counterpart exists, appears to do real work, and the
 *                       shape is plausible. NOT "certified" — a 200 is not
 *                       evidence and only rendering the page proves the shape.
 *
 * 🔴 Three ways an endpoint does no work, and only the first is visible to the
 *    existing ratchet:
 *
 *   1. no-op method — no database, no service call. check-noop-stubs.ps1 finds
 *      these (316 methods). But build-stub-route-inventory.mjs records only ONE
 *      route per method, and a method can carry many: AdminEmptyData carries
 *      six, which is how two exchange endpoints were once reported clean. This
 *      script re-reads every stub method's full attribute block (375 routes
 *      from those 316 methods).
 *
 *   2. dispatcher fall-through — AdminExplicitParityController holds five
 *      catch-all actions (Delete/Get/Patch/Post/Put) that switch on
 *      Request.Path. Their DEFAULT arm is PersistCompatibilityWrite /
 *      GetPersistedCompatibilityRead: a generic echo store that records the
 *      request body in CompatibilityAuditEntries, answers 202 with
 *      side_effect = "recorded_only", and replays it on read. It touches the
 *      database, so the no-op scanner cannot see it — yet nothing is moderated,
 *      sent, or applied. A route declared on one of those five actions with no
 *      matching switch branch lands here.
 *
 *   3. hardcoded payload — real auth work (so it queries the database) followed
 *      by a fabricated response. Found by opening method bodies, not by any
 *      scanner. The confirmed list is HARDCODED_METHODS below; each entry was
 *      read by hand. A static rule for this class does not exist, so this list
 *      is a floor, never a total.
 *
 * Usage:  node aspnet-backend/scripts/build-admin-corpus.mjs
 *         node aspnet-backend/scripts/build-admin-corpus.mjs --out <dir>
 *
 * Prerequisite: aspnet-backend/artifacts/parity/api/api-parity.json and
 * artifacts/parity/stubs/stub-routes.json. Both are static generators:
 *   powershell -File aspnet-backend/scripts/compare-laravel-api-parity.ps1
 *   MSYS_NO_PATHCONV=1 node aspnet-backend/scripts/build-stub-route-inventory.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const REPO = path.resolve(import.meta.dirname, '..', '..');
const OUT = path.resolve(flag('out', path.join(REPO, 'aspnet-backend/docs/generated/admin-corpus')));
const R = p => path.join(REPO, p);
const rj = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));

// ---------------------------------------------------------------------------
// Path normalisation. Deliberately MIRRORS compare-laravel-api-parity.ps1's
// Normalize-RoutePath, so its matched/missing verdicts join to these keys.
// 🔴 That function collapses /api/v2/x onto /api/x. So "exists" can be true
// because the unversioned twin exists. AdminV2RouteAliasConvention synthesises
// most /api/v2 aliases at startup and appears in no source file, so a static
// pass cannot separate the two. Recorded as a known limitation, not hidden.
// ---------------------------------------------------------------------------
function normPath(p) {
  let s = String(p).trim().replace(/\\/g, '/').replace(/\?.*$/, '');
  s = s.replace(/^\/?api\/v2\/?/, '/api/').replace(/^\/?v2\/?/, '/api/');
  if (!s.startsWith('/')) s = '/' + s;
  if (!s.startsWith('/api/')) s = '/api' + s;
  return s.replace(/\{[^}]*\}/g, '{}').replace(/\/{2,}/g, '/').replace(/\/+$/, '').toLowerCase();
}
const key = (m, p) => m.toUpperCase() + ' ' + normPath(p);
const KNOWN_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

// ---------------------------------------------------------------------------
// 1. Laravel route inventory from routes/api.php
// ---------------------------------------------------------------------------
function parseLaravelRoutes() {
  const src = fs.readFileSync(R('routes/api.php'), 'utf8');
  const lines = src.split(/\r?\n/);
  const HANDLER = new RegExp('Controllers[\\\\]([A-Za-z0-9_\\\\]+)::class\\s*,\\s*[\'"]([A-Za-z0-9_]+)[\'"]');
  const VERBS = 'get|post|put|patch|delete|options|any';
  const prefixStack = [];
  let depth = 0;
  const rows = [];
  const norm = p => {
    let s = p.trim().replace(/\/{2,}/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    s = s.replace(/\/+$/, '');
    return s === '' ? '/' : s;
  };
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].replace(/\/\/.*$/, '');
    const pm = stripped.match(/->prefix\(\s*'([^']*)'\s*\)/) || stripped.match(/Route::prefix\(\s*'([^']*)'\s*\)/);
    const opensGroup = /->group\(\s*(static\s+)?function|->group\(\s*fn/.test(stripped);
    const cur = prefixStack.map(x => x.prefix).join('');
    const verbRe = new RegExp('(?:Route::|\\)->|->)(' + VERBS + ")\\(\\s*'([^']*)'", 'g');
    let m;
    while ((m = verbRe.exec(stripped)) !== null) {
      let ctx = stripped.slice(m.index);
      for (let j = 1; j <= 5 && i + j < lines.length; j++) { if (/;\s*$/.test(ctx)) break; ctx += ' ' + lines[i + j].trim(); }
      const hm = ctx.match(HANDLER);
      rows.push({
        method: m[1].toUpperCase(),
        path: norm(cur + '/' + m[2].replace(/^\//, '')),
        controller: hm ? hm[1] : (/function\s*\(/.test(ctx) ? 'closure' : ''),
        action: hm ? hm[2] : '',
        line: i + 1,
      });
    }
    const mm = stripped.match(/Route::match\(\s*\[([^\]]*)\]\s*,\s*'([^']*)'/);
    if (mm) {
      let ctx = stripped;
      for (let j = 1; j <= 5 && i + j < lines.length; j++) { if (/;\s*$/.test(ctx)) break; ctx += ' ' + lines[i + j].trim(); }
      const hm = ctx.match(HANDLER);
      for (const v of (mm[1].match(/'([a-z]+)'/g) || [])) {
        rows.push({ method: v.replace(/'/g, '').toUpperCase(), path: norm(cur + '/' + mm[2].replace(/^\//, '')), controller: hm ? hm[1] : '', action: hm ? hm[2] : '', line: i + 1 });
      }
    }
    const opens = (stripped.match(/\{/g) || []).length;
    const closes = (stripped.match(/\}/g) || []).length;
    if (pm && opensGroup) prefixStack.push({ depth: depth + opens, prefix: '/' + pm[1].replace(/^\/|\/$/g, '') });
    depth += opens - closes;
    while (prefixStack.length && depth < prefixStack[prefixStack.length - 1].depth) prefixStack.pop();
  }
  const seen = new Map();
  for (const r of rows) { const k = r.method + ' ' + r.path; if (!seen.has(k)) seen.set(k, r); }
  return [...seen.values()].map(r => ({ ...r, apiPath: '/api' + r.path }));
}

// ---------------------------------------------------------------------------
// 2. Client readers
// ---------------------------------------------------------------------------
// Two passes over react-frontend/src/admin. PASS 1 direct api.<verb>('literal').
// PASS 2 any path-shaped literal in the file, method UNRESOLVED — because admin
// pages build endpoint maps and hand a VARIABLE to api.get().
// RegionalAnalyticsPage.tsx:580 is the worked example; without pass 2 the
// client-called set is a silent undercount.
function extractReactAdminCalls() {
  const root = R('react-frontend/src/admin');
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
    }
  })(root);
  const CALL = /\bapi(?:Client)?\.(get|post|put|patch|delete|upload)\s*(?:<[^()]*?>)?\s*\(\s*(`[^`]*`|'[^']*'|"[^"]*")/g;
  const ANYLIT = /(`[^`\n]*`|'[^'\n]*'|"[^"\n]*")/g;
  const CONSTDEF = /\bconst\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(`[^`\n]*`|'[^'\n]*'|"[^"\n]*")\s*;/g;
  const PATHISH = /^\/(api\/)?(v2|v1|admin|super-admin|auth)\//;
  const direct = new Map();
  const indirect = new Set();
  let scanned = 0;
  for (const f of files) {
    if (/\.test\.tsx?$|__tests__|\.spec\./.test(f)) continue;
    scanned++;
    const src = fs.readFileSync(f, 'utf8');
    const rel = path.relative(REPO, f).replace(/\\/g, '/');
    const consts = {};
    let cm; CONSTDEF.lastIndex = 0;
    while ((cm = CONSTDEF.exec(src)) !== null) {
      const v = cm[2].slice(1, -1);
      if (v.startsWith('/') && !v.includes('${')) consts[cm[1]] = v;
    }
    const norm = raw => {
      let s = raw.slice(1, -1);
      s = s.replace(/\$\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}/g, (x, n) => Object.hasOwn(consts, n) ? consts[n] : x);
      s = s.replace(/^\$\{[^}]*\}/, '').replace(/\$\{[^}]*\}/g, '{id}').split('?')[0].split('#')[0];
      if (!s.startsWith('/')) return null;
      s = s.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
      return PATHISH.test(s) ? s : null;
    };
    const claimed = new Set();
    let m; CALL.lastIndex = 0;
    while ((m = CALL.exec(src)) !== null) {
      claimed.add(m[2]);
      const p = norm(m[2]);
      if (!p) continue;
      const k = key(m[1] === 'upload' ? 'POST' : m[1], p);
      if (!direct.has(k)) direct.set(k, []);
      direct.get(k).push(rel + ':' + src.slice(0, m.index).split('\n').length);
    }
    ANYLIT.lastIndex = 0;
    while ((m = ANYLIT.exec(src)) !== null) {
      if (claimed.has(m[1])) continue;
      const p = norm(m[1]);
      if (p) indirect.add(normPath(p));
    }
  }
  return { direct, indirect, scanned_files: scanned };
}

// web-uk: the ONLY admin endpoints with a live caller. Verified 2026-08-21:
// the 19 admin* helpers at web-uk/src/lib/api.js:3656-3803 have NO caller
// anywhere in web-uk and point at unversioned /api/admin/* paths Laravel does
// not declare. They are dead code and are deliberately NOT readers.
const WEBUK_ADMIN_CALLS = [
  ['GET', '/api/v2/admin/events', 'web-uk/src/routes/events.js:916'],
  ['GET', '/api/v2/admin/events/{id}', 'web-uk/src/routes/events.js:949'],
  ['POST', '/api/v2/admin/events/{id}/approve', 'web-uk/src/routes/events.js:979'],
  ['POST', '/api/v2/admin/events/{id}/reject', 'web-uk/src/routes/events.js:995'],
  ['GET', '/api/v2/admin/jobs', 'web-uk/src/routes/jobs.js:2074'],
  ['GET', '/api/v2/admin/jobs/bias-audit', 'web-uk/src/routes/jobs.js:2057'],
];
// mobile/: scanned, ZERO admin-path calls. The Expo client has no admin surface.

// ---------------------------------------------------------------------------
// 3. Stub inventory — one entry per ROUTE, taken straight from the artifact
//
// 🔴 CHANGED 2026-08-21. This function used to re-read every stub method's
// attribute block itself, because the inventory recorded only ONE route per
// method and a method can carry many (AdminEmptyData carries six). The scanner
// now emits one finding per route with the path already resolved — including
// the `~/absolute` and `[controller]` forms this function got wrong — so
// re-expanding here would multiply each route by its method's attribute count.
// Read the artifact as given. If it ever regresses to one-route-per-method,
// the guard below fails rather than silently under-counting again.
// ---------------------------------------------------------------------------
function expandStubRoutes() {
  const inv = rj(R('aspnet-backend/artifacts/parity/stubs/stub-routes.json'));
  const routes = Array.isArray(inv.routes) ? inv.routes : [];
  if (!routes.length) {
    console.error('🔴 stub-routes.json holds no routes. Regenerate it:');
    console.error('   MSYS_NO_PATHCONV=1 node aspnet-backend/scripts/build-stub-route-inventory.mjs');
    process.exit(2);
  }
  if (!routes.some(r => r.category)) {
    console.error('🔴 stub-routes.json carries no per-route `category`, so it predates the');
    console.error('   2026-08-21 counting model and records one route per method. Regenerate it');
    console.error('   before trusting any stub count derived from it.');
    process.exit(2);
  }
  return routes.map(r => ({
    file: r.file, line: r.line, method: r.method,
    verb: r.verb, path: r.path, category: r.category, expanded: true
  }));
}

// ---------------------------------------------------------------------------
// 4. Dispatcher fall-through set (blind spot 2)
// ---------------------------------------------------------------------------
function dispatcherFallThrough() {
  const F = R('aspnet-backend/src/Nexus.Api/Controllers/AdminExplicitParityController.cs');
  const lines = fs.readFileSync(F, 'utf8').split(/\r?\n/);
  const sigs = [];
  lines.forEach((l, i) => {
    if (/public\s+(async\s+)?Task<IActionResult>\s+(Delete|Get|Patch|Post|Put)\(\)/.test(l)) sigs.push({ name: RegExp.$2, line: i + 1 });
  });
  const fell = [], summary = [];
  for (const d of sigs) {
    const attrs = [];
    for (let j = d.line - 2; j >= 0; j--) {
      const l = lines[j].trim();
      if (l === '' || l.startsWith('//') || l.startsWith('///')) continue;
      if (l.startsWith('[')) { attrs.push(l); continue; }
      break;
    }
    const routes = attrs.map(a => a.match(/^\[Http(Get|Post|Put|Patch|Delete)\("([^"]*)"\)/))
      .filter(Boolean).map(m => ({ verb: m[1].toUpperCase(), path: m[2] }));
    let depth = 0, seen = false, end = d.line;
    for (let k = d.line - 1; k < lines.length; k++) {
      for (const ch of lines[k]) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
      end = k;
      if (seen && depth <= 0) break;
    }
    const body = lines.slice(d.line - 1, end + 1).join('\n');
    const literals = new Set((body.match(/^\s*"(\/api\/[^"]+)"\s*=>/gm) || []).map(s => s.match(/"([^"]+)"/)[1].toLowerCase()));
    const guardPrefixes = (body.match(/"(\/api\/[^"]+)"/g) || []).map(s => s.slice(1, -1).toLowerCase()).filter(s => s.endsWith('/'));
    const guardSuffixed = [...body.matchAll(/TryGet\w+\(\s*path,\s*"([^"]+)",\s*"([^"]+)"/g)].map(m => [m[1].toLowerCase(), m[2].toLowerCase()]);
    const reportExport = /IsAdminReportExportPath/.test(body);
    let covered = 0;
    for (const r of routes) {
      const p = r.path.toLowerCase();
      let ok = literals.has(p);
      if (!ok) for (const [pre, suf] of guardSuffixed) if (p.startsWith(pre) && p.endsWith(suf)) { ok = true; break; }
      if (!ok) for (const pre of guardPrefixes) if (p.startsWith(pre) && /\{[^}]*\}$/.test(p)) { ok = true; break; }
      if (!ok && reportExport && /\/api\/v2\/admin\/reports\//.test(p)) ok = true;
      if (ok) covered++; else fell.push({ verb: r.verb, path: r.path, dispatcher: d.name });
    }
    summary.push({ dispatcher: d.name, routes: routes.length, explicit_branch: covered, fell_through: routes.length - covered });
  }
  return { summary, fell };
}

// ---------------------------------------------------------------------------
// 5. Hardcoded-payload methods (blind spot 3) — each READ BY HAND, 2026-08-21.
//    A static rule for this class does not exist. This list is a floor.
//    Two heuristic candidates were opened and REJECTED as real work:
//    AdminCompatibility3Controller.ListAdminComments and .GetSuperAuditLog
//    (both take an empty early-return only under a query-filter condition).
// ---------------------------------------------------------------------------
const HARDCODED_METHODS = [
  ['AdminPerformanceSummaryController', 'Summary', 'auth is real; slowest_requests/slowest_queries/memory_spikes are Array.Empty and request_volume an empty dictionary, always. The performance dashboard can never show data.'],
  ['AdminPrerenderCompatibilityController', 'Coverage', 'reads tenants, then reports rendered=0 and every expected route missing, always.'],
  ['AdminPrerenderCompatibilityController', 'TenantSafety', 'snapshots=0, stale=0, missing=all, always.'],
  ['AdminPrerenderCompatibilityController', 'Purge', 'validates and writes an audit row, then returns deleted_count=0 and deleted=[]. Nothing is purged.'],
  ['AdminPrerenderCompatibilityController', 'PurgeUnexpected', 'returns deleted_total=0 unconditionally.'],
  ['AdminCompatibility2Controller', 'SelectAbWinner', 'unconditional 409 "No persisted A/B test variants exist", supported=false.'],
];

// ---------------------------------------------------------------------------
// 6. Static ASP.NET route -> action index (for evidence columns only)
// ---------------------------------------------------------------------------
function aspnetRouteIndex() {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!/^(bin|obj)$/.test(e.name)) walk(p); continue; }
      if (e.name.endsWith('.cs')) files.push(p);
    }
  })(R('aspnet-backend/src/Nexus.Api'));
  const index = new Map();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    if (!/\[ApiController\]|ControllerBase/.test(src)) continue;
    const lines = src.split(/\r?\n/);
    // 🔴 A file can hold SEVERAL controller classes (CaringCommunityProjects-
    // Controller.cs holds three), so track the prefix per class rather than
    // taking the first one. Getting this wrong made two real Caring endpoints
    // look unresolvable.
    let ctrlPrefix = '', ctrlName = path.basename(f, '.cs');
    let pending = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const l = raw.trim();
      const cd = raw.match(/^\s*public\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+(\w+)/);
      if (cd) {
        ctrlName = cd[1]; ctrlPrefix = '';
        for (let j = i - 1; j >= 0 && j > i - 15; j--) {
          const rm = lines[j].match(/^\s*\[Route\("([^"]+)"\)\]/);
          if (rm) { ctrlPrefix = rm[1]; break; }
        }
        pending = [];
        continue;
      }
      const am = l.match(/^\[Http(Get|Post|Put|Patch|Delete|Options)(?:\("([^"]*)"\))?/);
      if (am) { pending.push({ verb: am[1].toUpperCase(), tpl: am[2] || '' }); continue; }
      if (l.startsWith('[') || l === '' || l.startsWith('//') || l.startsWith('*') || l.startsWith('/*')) continue;
      const sig = l.match(/^(public|internal)\s+(?:async\s+)?[A-Za-z0-9_<>,\[\]?\s.]+?\s+(\w+)\s*\(/);
      if (pending.length && sig) {
        let start = i;
        while (start < lines.length && !lines[start].includes('{') && !lines[start].includes('=>')) start++;
        let depth = 0, seen = false, end = start;
        for (let k = start; k < lines.length; k++) {
          for (const ch of lines[k]) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
          end = k;
          if (seen && depth <= 0) break;
          if (!seen && /=>.*;\s*$/.test(lines[k])) break;
        }
        const body = lines.slice(i, end + 1).join('\n');
        for (const pd of pending) {
          const full = /^\/?api\//.test(pd.tpl)
            ? '/' + pd.tpl.replace(/^\//, '')
            : '/' + (ctrlPrefix ? ctrlPrefix.replace(/^\/|\/$/g, '') + (pd.tpl ? '/' + pd.tpl : '') : pd.tpl.replace(/^\//, ''));
          const k = key(pd.verb, full);
          if (!index.has(k)) {
            index.set(k, {
              controller: ctrlName, action: sig[2], file: path.relative(REPO, f).replace(/\\/g, '/'),
              line: i + 1, body_lines: end - i + 1,
              touches_db: /_db\.|_context\.|Service\.|_service|Repository/.test(body),
            });
          }
        }
        pending = [];
        continue;
      }
      if (sig) pending = [];
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// 7. Families — names taken from ledger Tier 5 (22 families, rows 5.1-5.70)
// ---------------------------------------------------------------------------
const FAMILIES = [
  ['A — Admin access and shell', [/^\/api\/admin$/, /^\/api\/admin\/(badge-counts|dashboard)\b/, /^\/api\/auth\/admin-session/]],
  ['B — Members admin', [/^\/api\/admin\/(users|members|residency|invite-codes)/]],
  ['C — Listings moderation', [/^\/api\/admin\/listings/]],
  ['D — Events admin', [/^\/api\/admin\/events/]],
  ['E — Groups admin', [/^\/api\/admin\/(groups|group-types|group-locations|geocode-groups|group-tags|group-collections|group-auto-assign-rules)/]],
  ['F — Safeguarding', [/^\/api\/admin\/safeguarding/, /^\/api\/admin\/(volunteering\/safeguarding|vetting)/]],
  ['G — Credits and wallet administration', [/^\/api\/admin\/(timebanking|wallet|credits|community-fund|transactions)/]],
  ['H — Tenant settings, gates and branding', [/^\/api\/admin\/(settings|config|tenant-features|module|image-settings|onboarding|registration-policy|registration|branding)/]],
  ['I — Performance and monitoring', [/^\/api\/admin\/(performance|monitor|system|diagnostics|health)/]],
  ['J — Super-admin', [/^\/api\/admin\/super/, /^\/api\/super-admin/, /^\/api\/admin\/tenants?\b/]],
  ['K — Broker', [/^\/api\/admin\/broker/]],
  ['L — Newsletters and deliverability', [/^\/api\/admin\/(newsletters?|deliverability|email-deliverability|email)/]],
  ['M — GDPR and enterprise compliance', [/^\/api\/admin\/(enterprise|gdpr|fadp|dsar|consent)/]],
  ['N — Caring Community administration', [/^\/api\/admin\/(caring-community|national)/]],
  ['O — AI and matching administration', [/^\/api\/admin\/(ai|agents|ki-agents|matching|smart-match|match-|algorithm|feed-algorithm|feed)/]],
  ['P — Analytics and reporting dashboards', [/^\/api\/admin\/(analytics|community-analytics|search-analytics|regional-analytics|insights|stats|impact-report)/]],
  ['Q — Billing and premium', [/^\/api\/admin\/(billing|invoices|plans|subscriptions|member-premium|insurance|marketplace|coupons|advertising|local-advertising|merchant|ad-campaigns|donations)/]],
  ['R — Content management', [/^\/api\/admin\/(blog|pages|menus|menu-items|landing-page|seo|prerender|legal-documents|resources|help|kb|courses|podcast)/]],
  ['S — Gamification administration', [/^\/api\/admin\/(gamification|custom-badges|badges|nexus-score|regional-points|group-ranking|leaderboard|challenges)/]],
  ['T — Platform provisioning and identity', [/^\/api\/admin\/(provisioning|platform|pilot|sso|identity|api-partners|partner|federation)/]],
  ['U — Taxonomy', [/^\/api\/admin\/(categories|attributes|skills|taxonomy|tags)/]],
  ['V — Operations', [/^\/api\/(v2\/)?volunteering\/admin\//, /^\/api\/admin\/(background-jobs|comments|cron|retention|reports|support-reports|translation|404|jobs|tools|queue|cache|logs|maintenance|audit-log|activity-log|notifications|moderation|crm|volunteering|polls|surveys|goals|ideation|reviews|exchanges|connections|messages|search|uploads?|import|export|webhooks|push|sms)/]],
];
const family = p => (FAMILIES.find(([, pats]) => pats.some(re => re.test(p))) || ['Z — unmapped'])[0];

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const laravel = parseLaravelRoutes();
const corpus = laravel.filter(r => r.path.toLowerCase().includes('admin'));
const { direct, indirect, scanned_files } = extractReactAdminCalls();
const parity = rj(R('aspnet-backend/artifacts/parity/api/api-parity.json'));
const stubRoutes = expandStubRoutes();
const ft = dispatcherFallThrough();
const aspIdx = aspnetRouteIndex();

const readers = new Map();
const addReader = (k, label, where) => {
  if (!readers.has(k)) readers.set(k, new Map());
  if (!readers.get(k).has(label)) readers.get(k).set(label, where);
};
for (const [k, where] of direct) addReader(k, 'react-admin', where.slice(0, 3).join(', '));
for (const [m, p, where] of WEBUK_ADMIN_CALLS) addReader(key(m, p), 'web-uk', where);
const oapi = rj(R('openapi.json'));
for (const [p, ops] of Object.entries(oapi.paths || {})) {
  if (!p.toLowerCase().includes('admin')) continue;
  for (const m of Object.keys(ops)) if (KNOWN_VERBS.has(m.toUpperCase())) addReader(key(m, p), 'openapi', 'openapi.json');
}

const pmap = new Map();
for (const m of parity.matrix) {
  const k = key(m.method, m.normalized_path);
  const prev = pmap.get(k);
  if (!prev || (prev.status !== 'matched' && m.status === 'matched')) pmap.set(k, m);
}
// Sub-kind labels, keyed by the scanner's category. Kept here so the CSV column
// stays stable if the scanner ever renames a category: an unknown category shows
// up as 'unlabelled category: x' rather than silently becoming a no-op method.
const STUB_KIND_LABEL = {
  noop_method: 'no-op method',
  echo_store: 'dispatcher fall-through (echo store)',
  hardcoded_payload: 'hardcoded payload'
};
const stubKeys = new Map();
for (const s of stubRoutes) {
  const ps = [s.path];
  if (/^\/api\/(?!v2\/)/.test(s.path)) ps.push(s.path.replace('/api/', '/api/v2/'));
  for (const p of ps) stubKeys.set(key(s.verb, p), s);
}
const echoKeys = new Map(ft.fell.map(f => [key(f.verb, f.path), f]));
const hardcoded = new Set(HARDCODED_METHODS.map(([c, a]) => c + '.' + a));
const hardcodedReason = new Map(HARDCODED_METHODS.map(([c, a, why]) => [c + '.' + a, why]));

const rows = [];
for (const r of corpus) {
  const k = key(r.method, r.apiPath);
  const np = normPath(r.apiPath);
  const rd = readers.get(k);
  const readerList = rd ? [...rd.keys()] : [];
  if (!readerList.length && indirect.has(np)) readerList.push('react-admin(method-unresolved)');

  const asp = pmap.get(k);
  const stub = stubKeys.get(k);
  const echo = echoKeys.get(k);
  const act = aspIdx.get(k);
  const actName = act ? act.controller + '.' + act.action : '';
  const isHardcoded = act && hardcoded.has(actName);

  let classification, stub_kind = '', stub_evidence = '';
  if (!readerList.length) classification = 'uncalled';
  else if (stub) {
    // 🔴 The sub-kind comes from the scanner's own `category`, not from which
    // branch of this `if` matched. Before 2026-08-21 the inventory only held
    // plain no-op methods, so hardcoding 'no-op method' here was correct; it now
    // holds all three kinds, and hardcoding would collapse the three-way
    // breakdown this document's schedule is built on into one label.
    classification = 'stub';
    stub_kind = STUB_KIND_LABEL[stub.category] ?? ('unlabelled category: ' + stub.category);
    stub_evidence = stub.file + '::' + stub.method
      + (stub.category === 'echo_store' ? ' default arm (records the body, side_effect=recorded_only)' : '');
  }
  else if (echo) { classification = 'stub'; stub_kind = 'dispatcher fall-through (echo store)'; stub_evidence = 'AdminExplicitParityController.' + echo.dispatcher + ' default arm'; }
  else if (isHardcoded) { classification = 'stub'; stub_kind = 'hardcoded payload'; stub_evidence = actName + ' — ' + hardcodedReason.get(actName); }
  else if (!asp || asp.status !== 'matched') classification = 'absent';
  else classification = 'identical-candidate';

  rows.push({
    method: r.method,
    laravel_path: r.apiPath,
    join_key: k,
    family: family(np),
    laravel_handler: r.controller ? r.controller + '::' + r.action : '',
    laravel_route_line: r.line,
    readers: readerList,
    reader_evidence: rd ? Object.fromEntries(rd) : {},
    aspnet_parity_status: asp ? asp.status : 'not-in-parity-matrix',
    aspnet_action: actName,
    aspnet_action_file: act ? act.file + ':' + act.line : '',
    aspnet_body_lines: act ? act.body_lines : null,
    classification,
    stub_kind,
    stub_evidence,
  });
}

// provenance
const sha = execFileSync('git', ['-C', REPO, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' })
  .split('\n').filter(Boolean).length;

const tally = k => rows.reduce((a, r) => (a[r[k]] = (a[r[k]] || 0) + 1, a), {});
const called = rows.filter(r => r.readers.length > 0);
const broken = called.filter(r => r.classification === 'stub' || r.classification === 'absent');
const byFamily = {};
for (const r of rows) {
  const f = (byFamily[r.family] ||= { total: 0, client_called: 0, identical_candidate: 0, stub: 0, absent: 0, uncalled: 0 });
  f.total++;
  f[r.classification === 'identical-candidate' ? 'identical_candidate' : r.classification]++;
  if (r.classification !== 'uncalled') f.client_called++;
}

const summary = {
  schema_version: 1,
  generated_at: new Date().toISOString(),
  repository_sha: sha,
  working_tree_modified_paths: dirty,
  generator: 'aspnet-backend/scripts/build-admin-corpus.mjs',
  scope_authority: 'aspnet-backend/docs/decisions/ADR-0004-journey-equivalence-is-the-target.md',
  method: 'static — no backend contacted, no browser driven, no live differ run',
  sources_scanned: {
    laravel_routes: 'routes/api.php (' + laravel.length + ' unique method+path routes)',
    react_admin: 'react-frontend/src/admin (' + scanned_files + ' non-test .ts/.tsx files, 260 declared route paths)',
    web_uk: 'web-uk/src — 6 admin endpoints with a live caller; 19 dead helpers excluded',
    mobile: 'mobile/ — scanned, zero admin-path calls',
    openapi: 'openapi.json (' + Object.keys(oapi.paths || {}).length + ' paths)',
    aspnet_parity: 'aspnet-backend/artifacts/parity/api/api-parity.json (' + parity.summary.aspnet_operations + ' ASP.NET operations)',
    aspnet_stub_inventory: 'aspnet-backend/artifacts/parity/stubs/stub-routes.json (' + stubRoutes.length + ' do-nothing routes across ' + new Set(stubRoutes.map(r => r.file + '::' + r.method)).size + ' methods, four categories)',
  },
  admin_corpus_size: rows.length,
  admin_by_method: rows.reduce((a, r) => (a[r.method] = (a[r.method] || 0) + 1, a), {}),
  classification: tally('classification'),
  stub_kinds: rows.filter(r => r.classification === 'stub').reduce((a, r) => (a[r.stub_kind] = (a[r.stub_kind] || 0) + 1, a), {}),
  client_called: called.length,
  client_called_stub_or_absent: broken.length,
  client_called_defect_rate_pct: Number((100 * broken.length / called.length).toFixed(1)),
  dispatcher_fall_through: ft.summary,
  by_family: byFamily,
  limitations: [
    'STATIC UPPER BOUND ON HEALTH, STATIC LOWER BOUND ON WORK. No request was issued. A live run finds shape mismatches this pass cannot see; on the member read corpus 64 of 80 differing endpoints were real work.',
    'identical-candidate means "a counterpart exists and appears to do work". It is NOT certified. A 200 is not evidence; only rendering the page catches the starts_at/start_date class of fault.',
    'Path keys collapse /api/v2/x onto /api/x, mirroring compare-laravel-api-parity.ps1. AdminV2RouteAliasConvention synthesises most /api/v2 aliases at startup and appears in no source file, so a static pass cannot prove the versioned twin exists.',
    'The hardcoded-payload list is a hand-read floor, not a total. No static rule reliably detects it; a heuristic scan produced 8 candidates of which 2 opened as real work.',
    'Client-call extraction misses dynamic property access and fully computed URLs. Indirect path literals are recorded with method UNRESOLVED, which can attach a reader to the wrong verb.',
  ],
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'admin-corpus.json'), JSON.stringify({ summary, endpoints: rows }, null, 1));
const csv = ['method,laravel_path,family,classification,stub_kind,readers,aspnet_parity_status,aspnet_action,laravel_handler']
  .concat(rows.map(r => [r.method, r.laravel_path, r.family, r.classification, r.stub_kind, r.readers.join('|'), r.aspnet_parity_status, r.aspnet_action, r.laravel_handler]
    .map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')));
fs.writeFileSync(path.join(OUT, 'admin-corpus.csv'), csv.join('\n') + '\n');

console.log('corpus ' + rows.length + '  ' + JSON.stringify(summary.classification));
console.log('client-called ' + called.length + '  stub-or-absent ' + broken.length + ' (' + summary.client_called_defect_rate_pct + '%)');
console.log('written to ' + OUT);
