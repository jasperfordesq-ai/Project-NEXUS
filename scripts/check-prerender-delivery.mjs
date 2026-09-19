#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Prerender DELIVERY check — does a search engine actually receive a real page?
 *
 * Every other prerender check in this repo measures snapshot PRODUCTION: is the
 * cache writable, is the queue moving, did renders fail, what is the coverage.
 * All of them were green from 2026-07-11 to 2026-09-13 while every crawler on
 * earth received a 1,950-byte empty SPA shell, because the thing that was broken
 * sat between "snapshot exists" and "snapshot is served".
 *
 * This check is deliberately outside-in and cause-agnostic. It asks the only
 * question that matters — "if I were Googlebot, would I get words?" — over real
 * HTTP, through whatever CDN, proxy and container stack is in front. It does not
 * know or care WHY a page is blank. That is the point: it would have caught the
 * missing newline, the absent marker, the stuck lock and the superseded rebuild
 * equally, on day one.
 *
 * 🔴 It also asks a second question, added 2026-09-19: "is the page a crawler
 * receives the CURRENT one?" Real content is not the same as current content.
 * On 2026-09-17 this check passed all sixteen pages while app.project-nexus.ie
 * had been serving a snapshot frozen at one commit through three deploys — it
 * was a genuine 58 KB page with an h1 and a description, so every signal above
 * was satisfied. A freeze is invisible to a check that only asks whether words
 * arrived. See the freshness section below for how staleness is judged.
 *
 * Usage:
 *   node scripts/check-prerender-delivery.mjs                 # hosts from config
 *   node scripts/check-prerender-delivery.mjs https://a.tld   # explicit origins
 *   NEXUS_DELIVERY_PATHS=/,/about node scripts/...            # override paths
 *   NEXUS_DELIVERY_EXPECT_COMMIT=<sha> node scripts/...       # commit being deployed
 *
 * Exit codes:  0 = every probed page is real and current
 *              1 = at least one is blank, stale, or missing an SEO tag
 *              2 = could not complete the check (never reported as a pass)
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// A shell is ~1,950 bytes. A real prerendered page is 40–150 KB. 10,000 is far
// enough from both that neither a fat shell nor a genuinely short page trips it.
const MIN_BYTES = Number(process.env.NEXUS_DELIVERY_MIN_BYTES || 10000);
const TIMEOUT_MS = Number(process.env.NEXUS_DELIVERY_TIMEOUT_MS || 25000);
const PATHS = (process.env.NEXUS_DELIVERY_PATHS || '/,/about').split(',');

// How far behind the deployed build a snapshot may be before it counts as
// frozen rather than merely not-yet-re-rendered. This is a real distinction,
// not hedging: the prerender pipeline is deliberately incremental, so a page
// that nothing has invalidated is SUPPOSED to keep its existing snapshot
// across a deploy. Failing on "not the newest commit" would fire on every
// deploy for every unchanged page, and a check that cries wolf is a check
// people stop reading — which is precisely how the two-month blank-shell
// outage above survived. Age is the signal that separates the two cases: the
// refresh loops cycle every tenant in wall-clock minutes, so a snapshot built
// from a commit that is a day old has not been refreshed by anything.
const MAX_SNAPSHOT_AGE_HOURS = Number(process.env.NEXUS_DELIVERY_MAX_SNAPSHOT_AGE_HOURS || 24);

// A git object name and nothing else. This value is read out of a remote page,
// so it is untrusted input and must never reach a subprocess unvalidated.
const SHA_RE = /^[0-9a-f]{7,40}$/i;

const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO_DIR,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();
  } catch {
    return null;
  }
}

/** The commit this check should expect to see in a fresh snapshot. */
function expectedCommit() {
  const fromEnv = (process.env.NEXUS_DELIVERY_EXPECT_COMMIT || '').trim();
  if (fromEnv) return SHA_RE.test(fromEnv) ? fromEnv.toLowerCase() : null;
  const head = git(['rev-parse', 'HEAD']);
  return head && SHA_RE.test(head) ? head.toLowerCase() : null;
}

/**
 * Commit ids reach us in two lengths: the footer carries the 12-character
 * short sha Vite injects, while a deploy knows the full 40. Compare on the
 * shorter of the two so neither form is wrongly reported as a mismatch.
 */
function sameCommit(a, b) {
  if (!a || !b) return false;
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const n = Math.min(x.length, y.length);
  return n >= 7 && x.slice(0, n) === y.slice(0, n);
}

/**
 * Age of a commit in hours, or null when this repository cannot resolve it
 * (a shallow clone, a commit never fetched, or git unavailable). Unknown is
 * reported as unknown and never silently treated as fresh.
 */
function commitAgeHours(sha) {
  if (!SHA_RE.test(sha)) return null;
  const ts = git(['log', '-1', '--format=%ct', sha, '--']);
  const seconds = Number(ts);
  if (!ts || !Number.isFinite(seconds) || seconds <= 0) return null;
  return (Date.now() / 1000 - seconds) / 3600;
}

/**
 * The build the snapshot was rendered from. The React footer emits this as a
 * hidden data attribute on every page, so it is baked into the snapshot HTML
 * at render time — which makes it an accurate record of WHEN that snapshot was
 * produced, not of what the live site is running.
 */
function buildCommitOf(body) {
  const m = body.match(/data-build-commit\s*=\s*(["'])([0-9a-fA-F]{7,40})\1/);
  return m ? m[2].toLowerCase() : null;
}

function originsFromArgs() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) return args.map((a) => (a.startsWith('http') ? a : `https://${a}`));
  const env = process.env.NEXUS_DELIVERY_ORIGINS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean)
    .map((a) => (a.startsWith('http') ? a : `https://${a}`));
  return null;
}

/**
 * Does the document carry a usable <meta name="description">?
 *
 * 🔴 Deliberately NOT a single regex over the whole tag. The first version used
 *   content=["'][^"']{10,}
 * which stops at the first quote character of EITHER kind — so a description
 * beginning "You've reached..." matched only three characters and was reported
 * as missing. That false negative sent a real, correct page to the top of a
 * FAIL list. An apostrophe must never break a safety check.
 *
 * This finds each description meta tag, then reads its content attribute with
 * the opening quote captured and back-referenced, so quotes of the other kind
 * inside the value are just text. Attribute order does not matter either.
 */
function hasMetaDescription(body) {
  const tags = body.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    if (!/\bname\s*=\s*(["'])\s*description\s*\1/i.test(tag)) continue;
    const content = tag.match(/\bcontent\s*=\s*(["'])([\s\S]*?)\1/i);
    if (content && content[2].trim().length >= 10) return true;
  }
  return false;
}

/**
 * Decide whether a real page is CURRENT, and say why in words.
 *
 * Three outcomes, and the middle one is the reason this is a function rather
 * than an equality test:
 *
 *   match    — the snapshot carries the commit being deployed. Fresh.
 *   behind   — it carries an older commit. Normal and expected: the pipeline
 *              re-renders a page when its content changes or its TTL expires,
 *              not because a build happened. Only reported.
 *   stale    — it carries a commit older than MAX_SNAPSHOT_AGE_HOURS. The
 *              refresh loops visit every tenant in minutes, so nothing has
 *              re-rendered this page for a day. That is a freeze.
 *
 * When the expected commit or the snapshot's commit age cannot be resolved,
 * this reports "unknown" and does not fail. An unresolvable comparison is not
 * evidence of a fault, and inventing one here would be the false alarm this
 * whole file exists to avoid.
 */
function judgeFreshness(built, expected, ageCache) {
  if (!built) {
    return { stale: false, built: null, note: ' (no build marker)' };
  }
  if (expected && sameCommit(built, expected)) {
    return { stale: false, built, note: ' — current build' };
  }

  if (!ageCache.has(built)) ageCache.set(built, commitAgeHours(built));
  const ageHours = ageCache.get(built);

  if (ageHours === null) {
    return {
      stale: false,
      built,
      note: ` (built from ${built.slice(0, 12)}; age unknown in this checkout)`,
    };
  }
  const rounded = Math.round(ageHours * 10) / 10;
  if (ageHours > MAX_SNAPSHOT_AGE_HOURS) {
    return {
      stale: true,
      built,
      ageHours: rounded,
      ageNote: `that commit is ${rounded}h old (limit ${MAX_SNAPSHOT_AGE_HOURS}h)`,
    };
  }
  return { stale: false, built, note: ` (built from ${built.slice(0, 12)}, ${rounded}h old)` };
}

async function probe(origin, path) {
  const url = `${origin}${path}${path.includes('?') ? '&' : '?'}nexus_delivery_check=${Date.now()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BOT_UA, Accept: 'text/html' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const body = await res.text();
    const bytes = Buffer.byteLength(body, 'utf-8');

    // Signals a crawler actually uses. An empty SPA shell has none of them.
    const hasH1 = /<h1[\s>]/i.test(body);
    const emptyRoot = /<div id="root"><\/div>/i.test(body);
    const hasDescription = hasMetaDescription(body);

    // Two distinct failures, not one. A blank shell means prerendering is not
    // being served at all — a platform-wide fault. A real page missing a tag is
    // one page's SEO defect. Reporting them identically sends whoever reads this
    // hunting the wrong thing; the first version of this script did exactly that.
    const isShell = !res.ok || bytes < MIN_BYTES || emptyRoot;
    const real = !isShell && hasH1 && hasDescription;
    const buildCommit = isShell ? null : buildCommitOf(body);
    return { url, status: res.status, bytes, hasH1, hasDescription, emptyRoot, isShell, real,
             buildCommit, error: null };
  } catch (err) {
    return { url, status: 0, bytes: 0, hasH1: false, hasDescription: false,
             emptyRoot: false, real: false, buildCommit: null,
             error: String(err && err.message || err) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const origins = originsFromArgs();
  if (!origins || !origins.length) {
    console.error('check-prerender-delivery: no origins given.');
    console.error('  Pass them as arguments, or set NEXUS_DELIVERY_ORIGINS=host1,host2');
    console.error('  UNAVAILABLE is not a pass — exiting 2.');
    process.exit(2);
  }

  const expected = expectedCommit();

  console.log(`check-prerender-delivery: probing ${origins.length} origin(s) as Googlebot`);
  console.log(`  paths: ${PATHS.join(', ')}   minimum real-page size: ${MIN_BYTES} bytes`);
  console.log(expected
    ? `  expected build: ${expected.slice(0, 12)}   stale after: ${MAX_SNAPSHOT_AGE_HOURS}h\n`
    : `  expected build: UNKNOWN — freshness will be reported but cannot be judged\n`);

  let shells = 0;      // served the empty SPA shell — platform-wide fault
  let seoGaps = 0;     // real page, but missing a tag a crawler uses
  let stale = 0;       // real, current-looking page built from an old commit
  let probed = 0;
  let unavailable = 0;
  const staleDetail = [];
  const ageCache = new Map();

  for (const origin of origins) {
    for (const path of PATHS) {
      const r = await probe(origin, path);
      probed += 1;
      if (r.error) {
        unavailable += 1;
        console.log(`  ?  ${origin}${path} — UNAVAILABLE (${r.error})`);
        continue;
      }
      if (r.real) {
        // Freshness is judged only on a page that is otherwise fine. A blank
        // page is already the louder fault and does not need a second label.
        const freshness = judgeFreshness(r.buildCommit, expected, ageCache);
        if (freshness.stale) {
          stale += 1;
          staleDetail.push({ page: `${origin}${path}`, ...freshness });
          console.log(`  STALE ${origin}${path} — real page (${r.bytes} bytes) but built from ${freshness.built}, ${freshness.ageNote}`);
        } else {
          console.log(`  ok ${origin}${path} — ${r.bytes} bytes, h1 + description present${freshness.note}`);
        }
      } else if (r.isShell) {
        shells += 1;
        const why = [
          !r.status || r.status >= 400 ? `http ${r.status}` : null,
          r.bytes < MIN_BYTES ? `only ${r.bytes} bytes` : null,
          r.emptyRoot ? 'empty <div id="root">' : null,
        ].filter(Boolean).join(', ');
        console.log(`  BLANK ${origin}${path} — ${why}`);
      } else {
        seoGaps += 1;
        const why = [
          !r.hasH1 ? 'no <h1>' : null,
          !r.hasDescription ? 'no meta description' : null,
        ].filter(Boolean).join(', ');
        console.log(`  SEO  ${origin}${path} — real page (${r.bytes} bytes) but ${why}`);
      }
    }
  }

  console.log('');
  if (unavailable === probed) {
    console.error(`check-prerender-delivery: UNAVAILABLE — all ${probed} probe(s) failed to complete.`);
    console.error('  Not reporting this as a pass. Exit 2.');
    process.exit(2);
  }
  if (shells > 0) {
    console.error(`check-prerender-delivery: FAIL — ${shells} of ${probed} probed page(s) reached a crawler as an empty shell.`);
    console.error('  Crawlers are being served pages with no content. Search engines will index nothing.');
    console.error('  This is a PLATFORM-WIDE serving fault, not a per-page problem.');
    console.error('  First thing to check: does the serving marker exist?');
    console.error('    docker exec <react-container> test -f /usr/share/nginx/html/prerendered/.tenant-identity-v1');
    console.error('  If absent, prerendering is switched off platform-wide. Remedy:');
    console.error('    sudo bash scripts/prerender-tenants.sh --force');
    console.error('  (only a full authoritative rebuild writes that marker; targeted refreshes never do)');
    if (seoGaps > 0) console.error(`  Separately, ${seoGaps} real page(s) are missing an SEO tag — see the SEO lines above.`);
    if (stale > 0) console.error(`  Separately, ${stale} real page(s) are frozen at an old build — see the STALE lines above.`);
    process.exit(1);
  }
  if (stale > 0) {
    const hosts = [...new Set(staleDetail.map((s) => new URL(s.page.startsWith('http') ? s.page : `https://${s.page}`).host))];
    console.error(`check-prerender-delivery: FAIL — ${stale} of ${probed} probed page(s) are real but FROZEN at an old build.`);
    console.error('  Crawlers are receiving content, so nothing looks broken — but it is not the current content,');
    console.error('  and nothing has re-rendered these pages for over a day. Search engines are indexing a stale site.');
    console.error(`  Affected host(s): ${hosts.join(', ')}`);
    console.error('  This is a REFRESH fault, not a serving fault. Do not go looking for the serving marker.');
    console.error('  Most likely cause: those tenants are being skipped by both freshness sweeps because a');
    console.error('  prerender job of theirs is stuck queued — which also suppresses the sweep that would clear it.');
    console.error('  Check, in this order:');
    console.error('    sudo docker exec <php-app> php artisan prerender:detect-drift --dry-run   # look for active_job_stuck');
    console.error('    sudo docker exec <php-app> php artisan prerender:auto-recache --dry-run   # same');
    console.error('  A stuck job names its tenant in stuck_tenant_blocks. To force one host now:');
    console.error('    sudo bash scripts/prerender-tenants.sh --tenant <slug>');
    if (seoGaps > 0) console.error(`  Separately, ${seoGaps} real page(s) are missing an SEO tag — see the SEO lines above.`);
    process.exit(1);
  }
  if (seoGaps > 0) {
    console.error(`check-prerender-delivery: FAIL — ${seoGaps} of ${probed} probed page(s) are real but missing an SEO tag.`);
    console.error('  Prerendering IS working — crawlers are receiving content. Do not go looking for the marker.');
    console.error('  These are per-page defects: the page renders, but a tag a crawler uses is absent.');
    console.error('  Fix the page component that omits it, then re-render just those routes:');
    console.error('    sudo bash scripts/prerender-tenants.sh --routes <comma,separated,routes>');
    process.exit(1);
  }
  console.log(`check-prerender-delivery: OK — ${probed - unavailable} page(s) served real content to a crawler.`);
  if (!expected) {
    console.log('  Freshness was NOT checked: no expected commit was available, so a frozen snapshot');
    console.log('  would have passed here. Set NEXUS_DELIVERY_EXPECT_COMMIT, or run inside the repo.');
  }
  if (unavailable) console.log(`  (${unavailable} probe(s) could not complete and were not counted as passes)`);
  process.exit(0);
}

// Exported so the freshness decision can be tested without a network or a
// particular git history: judgeFreshness takes the age cache as an argument,
// so a test seeds it and drives every branch directly.
export { judgeFreshness, sameCommit, buildCommitOf, expectedCommit };

// Only probe when run as a command. Importing this file for its helpers must
// not fire sixteen HTTP requests and call process.exit().
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((err) => {
    console.error('check-prerender-delivery: unexpected failure:', err);
    process.exit(2);
  });
}
