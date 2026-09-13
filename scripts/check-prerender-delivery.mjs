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
 * Usage:
 *   node scripts/check-prerender-delivery.mjs                 # hosts from config
 *   node scripts/check-prerender-delivery.mjs https://a.tld   # explicit origins
 *   NEXUS_DELIVERY_PATHS=/,/about node scripts/...            # override paths
 *
 * Exit codes:  0 = every probed page is real   1 = at least one is blank
 *              2 = could not complete the check (never reported as a pass)
 */

const BOT_UA =
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

// A shell is ~1,950 bytes. A real prerendered page is 40–150 KB. 10,000 is far
// enough from both that neither a fat shell nor a genuinely short page trips it.
const MIN_BYTES = Number(process.env.NEXUS_DELIVERY_MIN_BYTES || 10000);
const TIMEOUT_MS = Number(process.env.NEXUS_DELIVERY_TIMEOUT_MS || 25000);
const PATHS = (process.env.NEXUS_DELIVERY_PATHS || '/,/about').split(',');

function originsFromArgs() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (args.length) return args.map((a) => (a.startsWith('http') ? a : `https://${a}`));
  const env = process.env.NEXUS_DELIVERY_ORIGINS;
  if (env) return env.split(',').map((s) => s.trim()).filter(Boolean)
    .map((a) => (a.startsWith('http') ? a : `https://${a}`));
  return null;
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
    const hasDescription = /<meta[^>]+name=["']description["'][^>]+content=["'][^"']{10,}/i.test(body);
    const emptyRoot = /<div id="root"><\/div>/i.test(body);

    const real = res.ok && bytes >= MIN_BYTES && hasH1 && hasDescription && !emptyRoot;
    return { url, status: res.status, bytes, hasH1, hasDescription, emptyRoot, real, error: null };
  } catch (err) {
    return { url, status: 0, bytes: 0, hasH1: false, hasDescription: false,
             emptyRoot: false, real: false, error: String(err && err.message || err) };
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

  console.log(`check-prerender-delivery: probing ${origins.length} origin(s) as Googlebot`);
  console.log(`  paths: ${PATHS.join(', ')}   minimum real-page size: ${MIN_BYTES} bytes\n`);

  let failures = 0;
  let probed = 0;
  let unavailable = 0;

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
        console.log(`  ok ${origin}${path} — ${r.bytes} bytes, h1 + description present`);
      } else {
        failures += 1;
        const why = [
          !r.status || r.status >= 400 ? `http ${r.status}` : null,
          r.bytes < MIN_BYTES ? `only ${r.bytes} bytes` : null,
          r.emptyRoot ? 'empty <div id="root"> (SPA shell)' : null,
          !r.hasH1 ? 'no <h1>' : null,
          !r.hasDescription ? 'no meta description' : null,
        ].filter(Boolean).join(', ');
        console.log(`  FAIL ${origin}${path} — ${why}`);
      }
    }
  }

  console.log('');
  if (unavailable === probed) {
    console.error(`check-prerender-delivery: UNAVAILABLE — all ${probed} probe(s) failed to complete.`);
    console.error('  Not reporting this as a pass. Exit 2.');
    process.exit(2);
  }
  if (failures > 0) {
    console.error(`check-prerender-delivery: FAIL — ${failures} of ${probed} probed page(s) reached a crawler as an empty shell.`);
    console.error('  Crawlers are being served pages with no content. Search engines will index nothing.');
    console.error('  First thing to check: does the serving marker exist?');
    console.error('    docker exec <react-container> test -f /usr/share/nginx/html/prerendered/.tenant-identity-v1');
    console.error('  If absent, prerendering is switched off platform-wide. Remedy:');
    console.error('    sudo bash scripts/prerender-tenants.sh --force');
    console.error('  (only a full authoritative rebuild writes that marker; targeted refreshes never do)');
    process.exit(1);
  }
  console.log(`check-prerender-delivery: OK — ${probed - unavailable} page(s) served real content to a crawler.`);
  if (unavailable) console.log(`  (${unavailable} probe(s) could not complete and were not counted as passes)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('check-prerender-delivery: unexpected failure:', err);
  process.exit(2);
});
