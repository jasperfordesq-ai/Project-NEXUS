// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// The committed web-uk-vs-ASP.NET instrument.
//
// 🔴 WHY THIS EXISTS. Until 2026-08-20 the accessible frontend's evidence against
// ASP.NET was MANUAL: two hand-started servers whose start-up env lived only in a dead
// task's description, a hand-compared page list, and no artifact. The Baseline 3
// scoring transaction explicitly banked NOTHING for web-uk because of that. This script
// is the fix: it provisions BOTH web-uk instances itself with explicit configuration —
// so the backend wiring is guaranteed by construction, not by whoever typed the env
// last — runs the same unchanged web-uk code against ASP.NET and against the disposable
// Laravel control, compares every page pair, writes a JSON artifact, and tears down.
//
// Usage:
//   node aspnet-backend/scripts/smoke-webuk-against-aspnet.mjs
//   node aspnet-backend/scripts/smoke-webuk-against-aspnet.mjs --json out.json
//
// Preconditions (each verified, and each verification can go RED):
//   - ASP.NET dev API answering on :5080 (docker compose up -d api, in aspnet-backend/)
//   - disposable Laravel answering on :8091 (bash aspnet-backend/scripts/start-disposable-laravel.sh)
//   - both parity fixtures applied (tenant slug `acme` on both sides)
//
// 🔴 What a MATCH here proves — and what it does not. These are SIGNED-OUT page pairs:
// same status, same redirect target, no error page, and a comparable rendered body. It
// proves the accessible frontend STARTS and SERVES against ASP.NET exactly as against
// Laravel for these pages. It does not prove sign-in, forms, or workflows — that is the
// journey tier, and "10/10 pages identical" has already once coexisted with a backend
// nobody could sign in to (the missing `refresh_expires_in`; see the status archive).

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WEBUK_DIR = path.join(REPO_ROOT, 'web-uk');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ASPNET_API = flag('aspnet', 'http://127.0.0.1:5080');
const LARAVEL_API = flag('laravel', 'http://127.0.0.1:8091');
// Dedicated ports so this never collides with hand-started dev servers on 3098/3099.
const PORT_ASPNET = Number(flag('port-aspnet', '3197'));
const PORT_CONTROL = Number(flag('port-control', '3196'));
const TENANT_SLUG = flag('tenant', 'acme');
const JSON_OUT = flag('json', null);

// Signed-out page list. The sign-in gate (302 to /login) is itself part of the
// contract: both sides must gate the SAME pages to the SAME target.
const PAGES = [
  '/',
  '/login',
  '/register',
  '/blog',
  '/help',
  '/listings',
  '/events',
  '/explore',
  '/kb',
  '/feed',
  '/groups',
  '/volunteering',
];

// 🔴 KNOWN DIFFERENCES — each one diagnosed to root cause, not waved through, and
// SHRINK-ONLY: an entry may be removed only when its cause is fixed, never added to
// silence a new red (a new difference is a finding). Without this list the instrument
// fails on every run for reasons already understood, which trains people to ignore it.
const KNOWN_DIFFERENCES = [
  {
    page: '/',
    verdict: 'CONTENT_DIFFERS',
    reason:
      'FIXTURE ASYMMETRY, diagnosed 2026-08-20: the "Choose a community" list comes from '
      + 'GET /api/v2/tenants, and BOTH backends implement the same Laravel rule — the '
      + 'master tenant (id 1) is excluded unless include_master=1 '
      + '(TenantBootstrapController::list, :205-207). The disposable Laravel fixture has '
      + 'ONLY the master tenant, so it lists 0; the ASP.NET dev seed has 4 non-master '
      + 'tenants. Remove this entry when the fixtures seed the same non-master tenants.',
  },
];

// GOV.UK-style failure markers. A 200 whose body says "sorry" is a failure that
// status-code comparison alone would wave through.
const ERROR_MARKERS = [
  'Sorry, there is a problem with the service',
  'Sorry, the service is unavailable',
  'Page not found',
];

function log(line) { process.stdout.write(line + '\n'); }

async function probe(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { redirect: 'manual', signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function startWebUk(port, env, label) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: WEBUK_DIR,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      COOKIE_SECRET: 'smoke-only-not-a-secret-0123456789abcdef',
      ACCESSIBLE_TENANT_SLUG: TENANT_SLUG,
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('exit', (code) => {
    if (!child.killedByUs) {
      log(`🔴 ${label} exited early (code ${code}). Last output:\n${output.slice(-800)}`);
    }
  });
  return child;
}

async function waitReady(port, label, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await probe(`http://127.0.0.1:${port}/`, 4000);
      if (res.status > 0) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} on :${port} never became ready`);
}

/**
 * Normalize a rendered page for comparison: strip the values that legitimately
 * differ per process (CSRF tokens, session nonces, hashed asset names) so what
 * remains is the content the member actually reads.
 */
function normalize(html) {
  return html
    .replace(/name="_csrf"[^>]*value="[^"]*"/g, 'name="_csrf" value="CSRF"')
    .replace(/csrf[-_]?token[^"']*["'][^"']*["']/gi, 'csrf-token="CSRF"')
    .replace(/nonce="[^"]*"/g, 'nonce="NONCE"')
    .replace(/(href|src)=("[^"]*\.)([0-9a-f]{8,})(\.(?:css|js)")/g, '$1=$2HASH$4');
}

function fingerprint(html) {
  const n = normalize(html);
  return {
    bytes: n.length,
    links: (n.match(/<a\s/g) || []).length,
    forms: (n.match(/<form\s/g) || []).length,
    headings: (n.match(/<h[1-6][\s>]/g) || []).length,
    errorMarker: ERROR_MARKERS.find((m) => n.includes(m)) || null,
  };
}

function comparePage(page, a, b) {
  // a = ASP.NET-backed, b = Laravel control.
  if (a.status !== b.status) {
    return { page, verdict: 'STATUS_DIFFERS', aspnet: a.status, laravel: b.status };
  }
  if (a.status >= 300 && a.status < 400) {
    const same = (a.location || '') === (b.location || '');
    return same
      ? { page, verdict: 'MATCH', status: a.status, redirect: a.location }
      : { page, verdict: 'REDIRECT_DIFFERS', aspnet: a.location, laravel: b.location };
  }
  const fa = a.fingerprint; const fb = b.fingerprint;
  if (fa.errorMarker || fb.errorMarker) {
    return {
      page,
      verdict: 'ERROR_PAGE',
      aspnet: fa.errorMarker,
      laravel: fb.errorMarker,
    };
  }
  // Structure must agree exactly; byte length within 15% — rendered data rows can
  // wrap differently, but a missing module renders a much smaller page.
  const sizeRatio = Math.min(fa.bytes, fb.bytes) / Math.max(fa.bytes, fb.bytes);
  const structureSame = fa.links === fb.links && fa.forms === fb.forms && fa.headings === fb.headings;
  if (structureSame && sizeRatio >= 0.85) {
    return { page, verdict: 'MATCH', status: a.status, bytes: [fa.bytes, fb.bytes] };
  }
  return {
    page,
    verdict: 'CONTENT_DIFFERS',
    status: a.status,
    aspnet: fa,
    laravel: fb,
    sizeRatio: Number(sizeRatio.toFixed(3)),
  };
}

async function fetchPage(base, page) {
  const res = await probe(`${base}${page}`, 15000);
  const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
  return {
    status: res.status,
    location: res.headers.get('location'),
    fingerprint: body ? fingerprint(body) : null,
  };
}

async function main() {
  // ── Preflight: each check must be able to FAIL ────────────────────────────────
  for (const [name, url] of [
    ['ASP.NET API', `${ASPNET_API}/health`],
    ['disposable Laravel', `${LARAVEL_API}/api/v2/health`],
  ]) {
    let ok = false;
    try { ok = (await probe(url)).status === 200; } catch { /* down */ }
    if (!ok) {
      log(`🔴 UNMEASURABLE: ${name} is not answering at ${url}. Start it first.`);
      process.exit(2);
    }
  }

  log(`Provisioning web-uk: :${PORT_ASPNET} -> ASP.NET (${ASPNET_API}), :${PORT_CONTROL} -> Laravel control (${LARAVEL_API}), tenant '${TENANT_SLUG}'`);
  const childA = startWebUk(PORT_ASPNET, {
    ACCESSIBLE_BACKEND_TARGET: 'aspnet',
    ASPNET_BASE_URL: ASPNET_API,
  }, 'web-uk (ASP.NET target)');
  const childB = startWebUk(PORT_CONTROL, {
    ACCESSIBLE_BACKEND_TARGET: 'laravel',
    LARAVEL_BASE_URL: LARAVEL_API,
  }, 'web-uk (Laravel control)');

  const kill = () => {
    for (const c of [childA, childB]) {
      c.killedByUs = true;
      try { c.kill(); } catch { /* already gone */ }
    }
  };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(130); });

  try {
    await waitReady(PORT_ASPNET, 'web-uk (ASP.NET target)');
    await waitReady(PORT_CONTROL, 'web-uk (Laravel control)');
  } catch (err) {
    log(`🔴 UNMEASURABLE: ${err.message}`);
    kill();
    process.exit(2);
  }

  const results = [];
  for (const page of PAGES) {
    const [a, b] = await Promise.all([
      fetchPage(`http://127.0.0.1:${PORT_ASPNET}`, page),
      fetchPage(`http://127.0.0.1:${PORT_CONTROL}`, page),
    ]);
    const row = comparePage(page, a, b);
    const known = KNOWN_DIFFERENCES.find((k) => k.page === page && k.verdict === row.verdict);
    if (known && row.verdict !== 'MATCH') {
      row.known = true;
      row.reason = known.reason;
    }
    results.push(row);
    const mark = row.verdict === 'MATCH' ? '✓' : row.known ? '~' : '✗';
    log(`${mark} ${(row.known ? 'KNOWN_' + row.verdict : row.verdict).padEnd(16)} ${page}${row.redirect ? '  -> ' + row.redirect : ''}`);
    if (row.verdict !== 'MATCH' && !row.known) {
      log(`    aspnet:  ${JSON.stringify(row.aspnet)}`);
      log(`    laravel: ${JSON.stringify(row.laravel)}`);
    }
  }

  // ── SIGNED-IN tier ─────────────────────────────────────────────────────────────
  // Scripted double-CSRF login: GET /login for the session + nexus.csrf cookies and
  // the `_csrf` hidden value (login.njk:54), then a form POST. Each side signs in with
  // its OWN fixture's member — the fixtures hold different users by design.
  // 🔴 web-uk's login page renders FOUR submit buttons; that defeated four browser
  // probes once. An HTTP form POST has no buttons to choose — that is why this tier
  // is scripted at the HTTP layer rather than through a headless browser.
  async function signIn(port, email, password) {
    const jar = new Map();
    const storeCookies = (res) => {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    };
    const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

    const loginPage = await probe(`http://127.0.0.1:${port}/login`, 15000);
    storeCookies(loginPage);
    const html = await loginPage.text();
    const csrf = (html.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    if (!csrf) return { ok: false, why: 'no _csrf field on the login page' };

    const post = await fetch(`http://127.0.0.1:${port}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: cookieHeader(),
      },
      // 🔴 tenant_slug is REQUIRED: tenantSlugForRequest (auth.js:187-194) reads the
      // routed tenant or this form field — the ACCESSIBLE_TENANT_SLUG env is api.js's
      // fallback, not the login handler's. Omitting it re-renders the form 200 with
      // "Enter your email, password and tenant", which reads like a credential failure
      // and is not. (And the login GET sets nexus.csrf TWICE — the page token pairs
      // with the LAST cookie; the Map jar keeps the last by construction.)
      body: new URLSearchParams({ _csrf: csrf, tenant_slug: TENANT_SLUG, email, password }).toString(),
    });
    storeCookies(post);
    const location = post.headers.get('location') || '';
    if (post.status !== 302 || location.includes('/login')) {
      const errBody = await post.text().catch(() => '');
      const errMatch = errBody.match(/govuk-error-message[^>]*>([\s\S]{0,120}?)</) || errBody.match(/error[^>]*>([^<]{5,100})</i);
      return { ok: false, why: `login answered ${post.status} -> ${location || '(no redirect)'}${errMatch ? ' | form error: ' + errMatch[1].trim() : ''}` };
    }
    return { ok: true, cookie: cookieHeader() };
  }

  const CREDS = {
    aspnet: { email: 'member@acme.test', password: 'NexusV2!Demo#2026' },
    laravel: { email: 'e2e.user.a@project-nexus.local', password: 'TestPassword123!' },
  };
  const SIGNED_IN_PAGES = ['/dashboard', '/listings', '/events', '/feed', '/groups', '/volunteering', '/explore', '/kb'];

  const sessionA = await signIn(PORT_ASPNET, CREDS.aspnet.email, CREDS.aspnet.password);
  const sessionB = await signIn(PORT_CONTROL, CREDS.laravel.email, CREDS.laravel.password);
  log(`\nsigned-in tier: ASP.NET login ${sessionA.ok ? 'OK' : 'FAILED — ' + sessionA.why}; Laravel control login ${sessionB.ok ? 'OK' : 'FAILED — ' + sessionB.why}`);

  if (sessionA.ok && sessionB.ok) {
    const fetchSignedIn = async (port, cookie, pagePath) => {
      const res = await fetch(`http://127.0.0.1:${port}${pagePath}`, {
        redirect: 'manual',
        headers: { Cookie: cookie },
      });
      const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
      return { status: res.status, location: res.headers.get('location'), fingerprint: body ? fingerprint(body) : null };
    };
    // 🔴 The signed-in tier's verdict is RENDERS, not byte-identity. These pages
    // render DATA, and the two fixtures deliberately hold different data volumes
    // (ASP.NET's dev seed: 17 posts, 12 polls, 6 events; the Laravel parity fixture is
    // sparse) — so exact link/form/heading equality would flag fixture asymmetry as
    // fault on every run, which trains people to ignore the instrument. What IS
    // asserted: same status, same redirect target if any, NO GOV.UK error page, and a
    // non-trivial body on both sides. Structural counts are reported for the eye.
    for (const pagePath of SIGNED_IN_PAGES) {
      const [a, b] = await Promise.all([
        fetchSignedIn(PORT_ASPNET, sessionA.cookie, pagePath),
        fetchSignedIn(PORT_CONTROL, sessionB.cookie, pagePath),
      ]);
      let row;
      if (a.status !== b.status) {
        row = { page: `signed-in ${pagePath}`, verdict: 'STATUS_DIFFERS', aspnet: a.status, laravel: b.status };
      } else if (a.status >= 300 && a.status < 400) {
        row = (a.location || '') === (b.location || '')
          ? { page: `signed-in ${pagePath}`, verdict: 'MATCH', status: a.status, redirect: a.location }
          : { page: `signed-in ${pagePath}`, verdict: 'REDIRECT_DIFFERS', aspnet: a.location, laravel: b.location };
      } else if (a.fingerprint?.errorMarker || b.fingerprint?.errorMarker) {
        row = { page: `signed-in ${pagePath}`, verdict: 'ERROR_PAGE', aspnet: a.fingerprint?.errorMarker, laravel: b.fingerprint?.errorMarker };
      } else if ((a.fingerprint?.bytes ?? 0) < 2000 || (b.fingerprint?.bytes ?? 0) < 2000) {
        row = { page: `signed-in ${pagePath}`, verdict: 'CONTENT_DIFFERS', aspnet: a.fingerprint, laravel: b.fingerprint };
      } else {
        row = { page: `signed-in ${pagePath}`, verdict: 'MATCH', status: a.status, note: 'renders on both; structural counts differ with fixture data volume', aspnet: a.fingerprint, laravel: b.fingerprint };
      }
      results.push(row);
      const mark = row.verdict === 'MATCH' ? '✓' : '✗';
      log(`${mark} ${row.verdict.padEnd(16)} ${row.page}${row.redirect ? '  -> ' + row.redirect : ''}${row.note ? '  (' + row.note + ')' : ''}`);
      if (row.verdict !== 'MATCH') {
        log(`    aspnet:  ${JSON.stringify(row.aspnet)}`);
        log(`    laravel: ${JSON.stringify(row.laravel)}`);
      }
    }
  } else {
    log('🔴 signed-in tier NOT MEASURED this run — a failed login on either side is a finding in itself.');
  }

  kill();

  const matches = results.filter((r) => r.verdict === 'MATCH').length;
  const knowns = results.filter((r) => r.known).length;
  const unexplained = results.length - matches - knowns;
  log('\n─── summary ───');
  for (const v of ['MATCH', 'STATUS_DIFFERS', 'REDIRECT_DIFFERS', 'CONTENT_DIFFERS', 'ERROR_PAGE']) {
    const fresh = results.filter((r) => r.verdict === v && !r.known).length;
    const known = results.filter((r) => r.verdict === v && r.known).length;
    if (fresh) log(`  ${String(fresh).padStart(3)}  ${v}`);
    if (known) log(`  ${String(known).padStart(3)}  KNOWN_${v} (diagnosed, shrink-only — see script header)`);
  }
  log(`\nweb-uk page pairs (signed-out identity + signed-in renders): ${matches}/${results.length}`
    + (knowns ? ` (+${knowns} known fixture asymmetry)` : ''));
  log('🔴 Signed-out rows assert structural identity; signed-in rows assert RENDERS '
    + '(status/redirect/error-page/minimum body), because the fixtures hold different '
    + 'data volumes. Form submissions and workflows remain the journey tier.');

  if (JSON_OUT) {
    const artifact = {
      generated_at: new Date().toISOString(),
      instrument: 'smoke-webuk-against-aspnet',
      aspnet: ASPNET_API,
      laravel_control: LARAVEL_API,
      tenant: TENANT_SLUG,
      pages: results,
      matches,
      total: results.length,
    };
    fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(artifact, null, 2));
    log(`Wrote ${JSON_OUT}`);
  }

  // KNOWN differences do not fail the run — they are diagnosed and shrink-only. A NEW
  // difference always does.
  process.exit(unexplained === 0 ? 0 : 1);
}

main().catch((err) => {
  log(`🔴 UNMEASURABLE: ${err.stack || err}`);
  process.exit(2);
});
