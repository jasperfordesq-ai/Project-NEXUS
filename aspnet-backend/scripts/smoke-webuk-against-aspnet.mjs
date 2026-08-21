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
  // 🔴 ONE CLIENT PER ARM, and it is a real cookie jar, not a single header string.
  // Form submission needs the session cookie AND the nexus.csrf cookie to keep
  // travelling together across a GET-then-POST pair, and a POST's Set-Cookie has to
  // land back in the jar. csrf-csrf is configured here with getSessionIdentifier
  // defaulting to () => "" (server.js:536-546), so the token is NOT bound to the
  // session and `generateToken` REUSES a still-valid cookie rather than rotating it
  // (csrf-csrf/lib/cjs/index.cjs:27-58, overwrite=false). That is why one token
  // scraped from any rendered page keeps working for every later POST on the same jar.
  function makeArm(port, label) {
    const jar = new Map();
    const storeCookies = (res) => {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
      }
    };
    const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    const arm = {
      label,
      port,
      cookieHeader,
      async get(pathname) {
        const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
          redirect: 'manual',
          headers: { Cookie: cookieHeader() },
        });
        storeCookies(res);
        const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
        return { status: res.status, location: res.headers.get('location'), body };
      },
      async post(pathname, fields) {
        const res = await fetch(`http://127.0.0.1:${port}${pathname}`, {
          method: 'POST',
          redirect: 'manual',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: cookieHeader(),
          },
          body: new URLSearchParams(fields).toString(),
        });
        storeCookies(res);
        const body = res.status >= 300 && res.status < 400 ? '' : await res.text();
        return { status: res.status, location: res.headers.get('location'), body };
      },
    };
    return arm;
  }

  // 🔴 SUBMIT THE FORM THE PAGE ACTUALLY RENDERED, not a hand-written payload.
  // web-uk is HTML-first with progressive enhancement, so every write is a real POST
  // of a real <form>. This reads that form back out of the rendered page — hidden
  // inputs (including _csrf), checked radios and checkboxes, prefilled text inputs,
  // the selected <option> — and returns exactly the name/value pairs a browser would
  // send. A journey then overrides only the fields it is testing. Writing payloads by
  // hand instead is how an instrument ends up proving that an endpoint accepts an
  // invented body that no page can produce: /listings/new alone needs type,
  // service_type and category_id whose valid values are tenant-configured and differ
  // between the two fixtures (category 17 on ASP.NET, 642 on the Laravel control).
  function parseForm(html, actionSuffix) {
    const formRe = /<form\b[^>]*>[\s\S]*?<\/form>/gi;
    let chosen = null;
    for (const m of html.matchAll(formRe)) {
      const openTag = m[0].slice(0, m[0].indexOf('>') + 1);
      const action = (openTag.match(/action="([^"]*)"/i) || [])[1] || '';
      const method = ((openTag.match(/method="([^"]*)"/i) || [])[1] || 'get').toLowerCase();
      if (method !== 'post') continue;
      if (action === actionSuffix || action.endsWith(actionSuffix)) { chosen = m[0]; break; }
    }
    if (!chosen) return null;

    const fields = {};
    for (const inp of chosen.matchAll(/<input\b[^>]*>/gi)) {
      const tag = inp[0];
      const name = (tag.match(/name="([^"]*)"/i) || [])[1];
      if (!name) continue;
      const type = ((tag.match(/type="([^"]*)"/i) || [])[1] || 'text').toLowerCase();
      const value = (tag.match(/value="([^"]*)"/i) || [])[1] ?? '';
      if (type === 'radio' || type === 'checkbox') {
        if (/\schecked\b/i.test(tag)) fields[name] = value;
      } else if (type === 'file' || type === 'submit' || type === 'button') {
        continue;
      } else if (value !== '' || fields[name] === undefined) {
        fields[name] = value;
      }
    }
    for (const sel of chosen.matchAll(/<select\b[^>]*>[\s\S]*?<\/select>/gi)) {
      const name = (sel[0].match(/name="([^"]*)"/i) || [])[1];
      if (!name) continue;
      const options = [...sel[0].matchAll(/<option\b([^>]*)>/gi)].map((o) => ({
        value: (o[1].match(/value="([^"]*)"/i) || [])[1] ?? '',
        selected: /\sselected\b/i.test(o[1]),
      }));
      const selected = options.find((o) => o.selected && o.value !== '')
        || options.find((o) => o.value !== '');
      if (selected) fields[name] = selected.value;
    }
    for (const ta of chosen.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) {
      const name = (ta[1].match(/name="([^"]*)"/i) || [])[1];
      if (name) fields[name] = ta[2].trim();
    }
    return fields;
  }

  // 🔴 A BALANCE READER MUST BE ABLE TO READ A NEGATIVE. On 2026-08-21 the React
  // instrument's reader could not capture a minus sign and reported correct credits as
  // wrong. web-uk renders the balance through Intl.NumberFormat (wallet.js:45-53), so
  // the sign can be ASCII '-', U+2212 MINUS SIGN or U+2013 EN DASH depending on
  // locale, and thousands separators appear above 999.
  function readBalance(html) {
    const m = html.match(/<dt>[^<]*<\/dt><dd>([^<]+)<\/dd>/);
    if (!m) return null;
    const text = m[1].trim();
    const num = text.match(/([-\u2212\u2013\u2010\u2011]?)\s*([0-9][0-9.,\u00a0\u202f ]*)/);
    if (!num) return null;
    const sign = num[1] ? -1 : 1;
    const digits = num[2].replace(/[^0-9.]/g, '');
    const value = Number(digits);
    return Number.isFinite(value) ? sign * value : null;
  }

  // Scripted double-CSRF login: GET /login for the session + nexus.csrf cookies and
  // the `_csrf` hidden value (login.njk:54), then a form POST. Each side signs in with
  // its OWN fixture's member — the fixtures hold different users by design.
  // 🔴 web-uk's login page renders FOUR submit buttons; that defeated four browser
  // probes once. An HTTP form POST has no buttons to choose — that is why this tier
  // is scripted at the HTTP layer rather than through a headless browser.
  async function signIn(arm, email, password) {
    const loginPage = await arm.get('/login');
    const csrf = (loginPage.body.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    if (!csrf) return { ok: false, why: 'no _csrf field on the login page' };

    // 🔴 tenant_slug is REQUIRED: tenantSlugForRequest (auth.js:187-194) reads the
    // routed tenant or this form field — the ACCESSIBLE_TENANT_SLUG env is api.js's
    // fallback, not the login handler's. Omitting it re-renders the form 200 with
    // "Enter your email, password and tenant", which reads like a credential failure
    // and is not. (And the login GET sets nexus.csrf TWICE — the page token pairs
    // with the LAST cookie; the Map jar keeps the last by construction.)
    const post = await arm.post('/login', { _csrf: csrf, tenant_slug: TENANT_SLUG, email, password });
    const location = post.location || '';
    if (post.status !== 302 || location.includes('/login')) {
      const errBody = post.body || '';
      const errMatch = errBody.match(/govuk-error-message[^>]*>([\s\S]{0,120}?)</) || errBody.match(/error[^>]*>([^<]{5,100})</i);
      return { ok: false, why: `login answered ${post.status} -> ${location || '(no redirect)'}${errMatch ? ' | form error: ' + errMatch[1].trim() : ''}` };
    }
    return { ok: true, cookie: arm.cookieHeader(), arm };
  }

  const CREDS = {
    aspnet: { email: 'member@acme.test', password: 'NexusV2!Demo#2026' },
    laravel: { email: 'e2e.user.a@project-nexus.local', password: 'TestPassword123!' },
  };
  const SIGNED_IN_PAGES = ['/dashboard', '/listings', '/events', '/feed', '/groups', '/volunteering', '/explore', '/kb'];

  const sessionA = await signIn(makeArm(PORT_ASPNET, 'aspnet'), CREDS.aspnet.email, CREDS.aspnet.password);
  const sessionB = await signIn(makeArm(PORT_CONTROL, 'laravel-control'), CREDS.laravel.email, CREDS.laravel.password);
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

  // ── WRITE JOURNEY tier (ledger rows 4.22-4.30) ────────────────────────────────
  // 🔴 WHY THIS TIER EXISTS AND WHAT IT IS ALLOWED TO CLAIM. Until 2026-08-21 this
  // instrument submitted NOTHING: it compared page pairs, so all nine web-uk write
  // journeys sat OPEN for one reason. Page-pair matching is evidence about SERVING,
  // never about DOING — "10/10 pages identical" has already once coexisted with a
  // backend nobody could sign in to. Each journey below therefore asserts the EFFECT
  // and nothing weaker: the post appears in the feed, the listing has an id that
  // renders, the RSVP radio comes back checked, the message is in the thread, the
  // balance MOVED by the amount sent, the application is on the applications tab, the
  // group shows a Leave form, the review is in "given", the theme survives a reload.
  // A 302 to a success URL is NOT an outcome — the redirect target is chosen by
  // web-uk's own route handler from a caught error, so "?status=...-sent" can be a
  // lie the moment the backend returns a success-shaped no-op.
  //
  // Both arms run every journey in the SAME execution, which is ADR-0004 condition 3.
  // The two fixtures deliberately differ, so a journey may have to reach its starting
  // state differently on each arm (the Laravel member is already RSVP'd to its only
  // event and already in its only group; the ASP.NET member is in neither). Where that
  // happens the journey UNDOES first and then does — recorded per row, because
  // "leave then join" is a genuine drive of join and "assume already joined" is not.
  const marker = `smoke-${Date.now().toString(36)}`;
  const RECIPIENT_QUERY = 'coordinator';

  // 🔴 SHRINK-ONLY, and it does NOT excuse a red run. A fixture gap yields verdict
  // FIXTURE_GAP and does not fail the process; a diagnosed ASP.NET defect yields
  // ASPNET_DEFECT and DOES fail it, because the product is broken and the ledger row
  // is BROKEN. Never move a row here to make the run green.
  const KNOWN_JOURNEY_DEFECTS = [
    {
      row: '4.28',
      reason:
        'ASP.NET defect, diagnosed 2026-08-21 with the Laravel control run for comparison. '
        + 'GET /api/v2/groups/{id} answers an UNWRAPPED body — {"group":{...},"my_membership":{...}} '
        + '— where Laravel answers {"data":{...group fields FLAT..., owner_id, my_role, my_status, '
        + 'viewer_membership},"meta":{...}} (measured: ASP.NET group 10 vs Laravel group 950032). '
        + 'web-uk resolves the group as dataFrom(result)?.group || dataFrom(result) '
        + '(web-uk/src/routes/groups.js:1059), so with no data envelope it unwraps into the nested '
        + '"group" object and my_membership — a SIBLING of it — is left behind. '
        + 'isActiveGroupMember (groups.js:529-538) then reads no membership at all, the page offers '
        + 'JOIN to a member who is already the OWNER, and the join answers 400 "You are already a '
        + 'member of this group". A member who does join cannot see that they joined, so the '
        + 'journey is broken for every group, not just an owned one. Fix in '
        + 'GroupsController.cs:293-306: wrap in data, flatten the group, and carry owner_id / '
        + 'my_role / my_status / viewer_membership.',
    },
    {
      row: '4.29',
      reason:
        'ASP.NET defect, diagnosed 2026-08-21, TWO faults on one path. (1) POST /api/reviews is a '
        + 'do-nothing stub that returns {data:{id,created:true}} and writes nothing: '
        + 'MiscParityController.cs:1678-1680. (2) GET /api/reviews/pending returns the counterparty '
        + 'as other_user{id,first_name,last_name} with NO receiver_id, while web-uk reads '
        + 'receiver_id || receiverId || receiver.id (web-uk/src/routes/reviews.js:183) and Laravel '
        + 'emits receiver_id/receiver_name/exchange_title/transaction_id '
        + '(app/Services/ReviewService.php:293-300). So the rendered form posts receiver_id=0. '
        + 'ASP.NET also derives pending reviews from Exchanges where Laravel derives them from '
        + 'completed transactions: ReviewTrustController.cs:37-95.',
    },
  ];

  // 🔴 SHRINK-ONLY, and a DIFFERENT kind of entry: these are gaps in the parity
  // FIXTURES, not faults in either engine, each measured at the API rather than
  // guessed from a redirect. A row here cannot be CERTIFIED (ADR-0004 condition 3
  // needs the control to pass in the same run) but it does not fail the process,
  // because failing on a fixture gap every run is what trains people to ignore an
  // instrument. Remove an entry when the fixture is fixed — never to silence a red.
  const KNOWN_FIXTURE_GAPS = [
    {
      row: '4.27',
      arm: 'laravel',
      reason:
        'LARAVEL CONTROL FIXTURE GAP, measured 2026-08-21 at the API, not inferred: '
        + 'POST /api/v2/volunteering/opportunities/950021/apply answers 422 '
        + '{"code":"VALIDATION_ERROR","message":"You cannot apply to your own opportunity"}. '
        + 'parity-fixture.sql gives vol_opportunities 950021 created_by = the same member the '
        + 'control arm signs in as, and it is the ONLY opportunity in the fixture, so the '
        + 'control can never apply to anything. Fix in the fixture (an opportunity owned by '
        + 'another member), not in either backend. web-uk maps every 4xx to the same '
        + '"apply-failed" redirect, which is why this had to be measured at the API.',
    },
    {
      row: '4.28',
      arm: 'laravel',
      reason:
        'LARAVEL CONTROL FIXTURE GAP, measured 2026-08-21: the fixture has exactly one group '
        + '(950032) and the control member is its OWNER (owner_id 900014), so there is nothing '
        + 'to join; POST /api/v2/groups/950032/join answers 200 with action "already_member" even '
        + 'after a Leave, because an owner cannot leave their own group. Fix in the fixture (a '
        + 'second group the member does not belong to).',
    },
  ];

  const JOURNEYS = [
    {
      row: '4.22',
      name: 'post to the feed',
      async run(arm) {
        const page = await arm.get('/feed');
        const form = parseForm(page.body, '/feed/posts');
        if (!form) return { verdict: 'NO_FORM', detail: 'no /feed/posts form on /feed' };
        const submitted = await arm.post('/feed/posts', { ...form, content: `feed post ${marker}` });
        const after = await arm.get('/feed');
        const present = after.body.includes(marker);
        return {
          verdict: present ? 'OK' : 'NO_EFFECT',
          effect: 'the post body appears in the feed on a fresh GET /feed',
          detail: `redirect ${submitted.status} -> ${submitted.location || '(none)'}; marker in feed: ${present}`,
        };
      },
    },
    {
      row: '4.23',
      name: 'create a listing',
      async run(arm) {
        const page = await arm.get('/listings/new');
        const form = parseForm(page.body, '/listings/new');
        if (!form) return { verdict: 'NO_FORM', detail: 'no /listings/new form' };
        const title = `Smoke listing ${marker}`;
        const submitted = await arm.post('/listings/new', {
          ...form,
          title,
          description: `Created by the web-uk parity smoke run ${marker}. Safe to delete.`,
          hours_estimate: form.hours_estimate || '1',
        });
        // Success is a redirect to /listings/{id}?status=listing-created — the id is
        // the only proof the row exists, and web-uk itself flashes an error when
        // the backend answers success without one (listings.js:1368-1373).
        const id = (String(submitted.location || '').match(/\/listings\/(\d+)/) || [])[1];
        if (!id) {
          const formError = (submitted.body || '').match(/govuk-error-summary__body[\s\S]{0,300}?<\/div>/);
          return {
            verdict: 'NO_EFFECT',
            effect: 'a listing id is returned and the listing renders',
            detail: `redirect ${submitted.status} -> ${submitted.location || '(re-rendered form)'}${formError ? ' | ' + formError[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200) : ''}`,
          };
        }
        const detail = await arm.get(`/listings/${id}`);
        const present = detail.status === 200 && detail.body.includes(marker);
        return {
          verdict: present ? 'OK' : 'NO_EFFECT',
          effect: 'the created listing renders its own title on GET /listings/{id}',
          detail: `listing ${id}; detail page ${detail.status}; title present: ${present}`,
        };
      },
    },
    {
      row: '4.24',
      name: 'RSVP to an event',
      async run(arm) {
        const list = await arm.get('/events');
        const ids = [...new Set([...list.body.matchAll(/\/events\/(\d+)(?:\?|"|#)/g)].map((m) => m[1]))];
        if (!ids.length) return { verdict: 'FIXTURE_GAP', detail: 'no events listed for this member' };

        // Find an event whose RSVP form offers "going". The Laravel fixture seeds the
        // member as already going to its only event, so the page renders ONLY the
        // withdraw form — undo first, then RSVP, which drives the journey for real.
        let target = null;
        for (const id of ids.slice(0, 8)) {
          const page = await arm.get(`/events/${id}`);
          if (/id="status-going"/.test(page.body)) { target = { id, page }; break; }
        }
        if (!target) {
          for (const id of ids.slice(0, 8)) {
            const page = await arm.get(`/events/${id}`);
            const withdraw = parseForm(page.body, `/events/${id}/rsvp`);
            if (withdraw && withdraw.status === 'not_going') {
              await arm.post(`/events/${id}/rsvp`, withdraw);
              const reopened = await arm.get(`/events/${id}`);
              if (/id="status-going"/.test(reopened.body)) { target = { id, page: reopened, undone: true }; break; }
            }
          }
        }
        if (!target) return { verdict: 'FIXTURE_GAP', detail: `no event offers a "going" RSVP option (checked ${ids.slice(0, 8).join(', ')})` };

        const form = parseForm(target.page.body, `/events/${target.id}/rsvp`) || {};
        const submitted = await arm.post(`/events/${target.id}/rsvp`, { ...form, status: 'going' });
        const after = await arm.get(`/events/${target.id}`);
        // Two independent renders of myRsvp.status === 'going': the radio comes back
        // checked (detail.njk:365) and the attendee check-in link block appears
        // (detail.njk:85-90).
        const radioChecked = /id="status-going"[^>]*\schecked/.test(after.body);
        const attendeeBlock = after.body.includes(`/events/${target.id}/check-in/credential`);
        return {
          verdict: (radioChecked || attendeeBlock) ? 'OK' : 'NO_EFFECT',
          effect: 'the event page renders the member as going after a reload',
          detail: `event ${target.id}${target.undone ? ' (existing RSVP withdrawn first)' : ''}; redirect ${submitted.status} -> ${submitted.location || '(none)'}; radio checked: ${radioChecked}; attendee block: ${attendeeBlock}`,
        };
      },
    },
    {
      row: '4.25',
      name: 'send a message',
      async run(arm) {
        // The recipient is found the way the member finds one: the wallet's own
        // recipient search. Both fixtures now hold a member matching "coordinator"
        // (parity-fixture.sql adds 950010 Maya Coordinator for exactly this reason),
        // so the two arms message a comparable counterparty rather than user id 1.
        const search = await arm.get(`/wallet?recipient_q=${encodeURIComponent(RECIPIENT_QUERY)}`);
        const peer = (search.body.match(/name="recipient_id" value="(\d+)"/) || [])[1];
        if (!peer) return { verdict: 'FIXTURE_GAP', detail: `no member matches "${RECIPIENT_QUERY}"` };
        const thread = await arm.get(`/messages/${peer}`);
        const form = parseForm(thread.body, `/messages/${peer}`);
        if (!form) return { verdict: 'NO_FORM', detail: `no compose form on /messages/${peer} (canSend false)` };
        const submitted = await arm.post(`/messages/${peer}`, { ...form, body: `message ${marker}` });
        const after = await arm.get(`/messages/${peer}`);
        const present = after.body.includes(marker);
        return {
          verdict: present ? 'OK' : 'NO_EFFECT',
          effect: 'the message body appears in the thread on a fresh GET',
          detail: `peer ${peer}; redirect ${submitted.status} -> ${submitted.location || '(none)'}; marker in thread: ${present}`,
        };
      },
    },
    {
      row: '4.26',
      name: 'transfer credits',
      async run(arm) {
        const before = await arm.get('/wallet');
        const balanceBefore = readBalance(before.body);
        if (balanceBefore === null) return { verdict: 'NO_FORM', detail: 'could not read the balance from /wallet' };
        const search = await arm.get(`/wallet?recipient_q=${encodeURIComponent(RECIPIENT_QUERY)}`);
        const form = parseForm(search.body, '/wallet/transfer');
        if (!form) return { verdict: 'FIXTURE_GAP', detail: `no transfer form: nobody matches "${RECIPIENT_QUERY}"` };
        const amount = 0.25;
        const submitted = await arm.post('/wallet/transfer', {
          ...form,
          amount: String(amount),
          note: `transfer ${marker}`,
          confirm: '1',
        });
        const after = await arm.get('/wallet');
        const balanceAfter = readBalance(after.body);
        const moved = balanceAfter !== null && Math.abs((balanceBefore - amount) - balanceAfter) < 0.005;
        const noteVisible = after.body.includes(marker);
        return {
          verdict: (moved && noteVisible) ? 'OK' : 'NO_EFFECT',
          effect: 'the sender balance falls by exactly the amount sent AND the transfer is in the history',
          detail: `recipient ${form.recipient_id}; redirect ${submitted.status} -> ${submitted.location || '(none)'}; balance ${balanceBefore} -> ${balanceAfter} (expected ${balanceBefore - amount}); note in history: ${noteVisible}`,
        };
      },
    },
    {
      row: '4.27',
      name: 'apply for a volunteering opportunity',
      // 🔴 THIS JOURNEY HAS TO UNDO ITSELF OR IT PASSES ONCE AND LIES AFTERWARDS.
      // Measured on the 2026-08-21 first run: the ASP.NET arm applied successfully, and
      // the SECOND run was refused as a duplicate — correct product behaviour that an
      // instrument counting "an application exists" would have reported as another
      // pass. So withdraw every pending application for the opportunity first, prove
      // the pending count really fell, then apply and prove it rose again. That asserts
      // the effect in BOTH directions and leaves the fixture where it started.
      async run(arm) {
        const list = await arm.get('/volunteering');
        const oppId = (list.body.match(/\/volunteering\/opportunities\/(\d+)/) || [])[1];
        if (!oppId) return { verdict: 'FIXTURE_GAP', detail: 'no volunteering opportunity listed' };
        // A pending application is exactly the one that renders a Withdraw form
        // (volunteering.njk:163-167); a withdrawn one stays listed without one.
        const pendingIds = (html) => [...new Set([...html.matchAll(/\/volunteering\/applications\/(\d+)\/withdraw/g)].map((m) => m[1]))];
        let apps = await arm.get('/volunteering?tab=applications');
        const preexisting = pendingIds(apps.body);
        for (const appId of preexisting) {
          const wf = parseForm(apps.body, `/volunteering/applications/${appId}/withdraw`);
          if (wf) await arm.post(`/volunteering/applications/${appId}/withdraw`, wf);
          apps = await arm.get('/volunteering?tab=applications');
        }
        const cleared = pendingIds(apps.body).length;
        if (preexisting.length > 0 && cleared !== 0) {
          return {
            verdict: 'NO_EFFECT',
            effect: 'a withdrawn application stops being pending',
            detail: `could not clear ${preexisting.length} pre-existing pending application(s); ${cleared} still pending`,
          };
        }
        const page = await arm.get(`/volunteering/opportunities/${oppId}`);
        const form = parseForm(page.body, `/volunteering/opportunities/${oppId}/apply`);
        if (!form) return { verdict: 'NO_FORM', detail: 'no apply form on the opportunity page' };
        const submitted = await arm.post(`/volunteering/opportunities/${oppId}/apply`, { ...form, message: `application ${marker}` });
        const appsAfter = await arm.get('/volunteering?tab=applications');
        const nowPending = pendingIds(appsAfter.body);
        const linksOpportunity = appsAfter.body.includes(`/volunteering/opportunities/${oppId}"`);
        return {
          verdict: (nowPending.length > 0 && linksOpportunity) ? 'OK' : 'NO_EFFECT',
          effect: 'a pending application for that opportunity appears on the applications tab (after clearing any earlier one)',
          detail: `opportunity ${oppId}; withdrew ${preexisting.length} pre-existing; redirect ${submitted.status} -> ${submitted.location || '(none)'}; pending after: ${nowPending.length}; links the opportunity: ${linksOpportunity}`,
        };
      },
    },
    {
      row: '4.28',
      name: 'join a group',
      async run(arm) {
        const list = await arm.get('/groups');
        const ids = [...new Set([...list.body.matchAll(/\/groups\/(\d+)(?:\?|"|#)/g)].map((m) => m[1]))];
        if (!ids.length) return { verdict: 'FIXTURE_GAP', detail: 'no groups listed' };
        let target = null;
        for (const id of ids.slice(0, 10)) {
          const page = await arm.get(`/groups/${id}`);
          if (parseForm(page.body, `/groups/${id}/join`)) { target = { id, page }; break; }
        }
        if (!target) {
          // The Laravel fixture seeds the member into its only group, so there is
          // nothing to join until the membership is given up. Leave, then join.
          for (const id of ids.slice(0, 10)) {
            const page = await arm.get(`/groups/${id}`);
            const leave = parseForm(page.body, `/groups/${id}/leave`);
            if (leave) {
              await arm.post(`/groups/${id}/leave`, leave);
              const reopened = await arm.get(`/groups/${id}`);
              if (parseForm(reopened.body, `/groups/${id}/join`)) { target = { id, page: reopened, left: true }; break; }
            }
          }
        }
        if (!target) return { verdict: 'FIXTURE_GAP', detail: `no group offers Join (checked ${ids.slice(0, 10).join(', ')})` };
        const form = parseForm(target.page.body, `/groups/${target.id}/join`);
        const submitted = await arm.post(`/groups/${target.id}/join`, form);
        const after = await arm.get(`/groups/${target.id}`);
        // Membership is what the page offers next: a member sees Leave, a
        // non-member sees Join (groups.js:1584-1614 and the detail template).
        const isMember = Boolean(parseForm(after.body, `/groups/${target.id}/leave`));
        const stillJoin = Boolean(parseForm(after.body, `/groups/${target.id}/join`));
        return {
          verdict: (isMember && !stillJoin) ? 'OK' : 'NO_EFFECT',
          effect: 'the group page offers Leave instead of Join after a reload',
          detail: `group ${target.id}${target.left ? ' (left first)' : ''}; redirect ${submitted.status} -> ${submitted.location || '(none)'}; leave form: ${isMember}; join form still there: ${stillJoin}`,
        };
      },
    },
    {
      row: '4.29',
      name: 'leave a review',
      async run(arm) {
        const page = await arm.get('/reviews');
        const form = parseForm(page.body, '/reviews');
        if (!form) return { verdict: 'FIXTURE_GAP', detail: 'no pending review to write (nothing completed and unreviewed)' };
        // 🔴 The form the page rendered is the evidence. web-uk fills receiver_id from
        // the pending row (reviews.js:183); an empty one means the backend did not
        // send a field the client reads, and the POST would carry receiver_id=0.
        if (!form.receiver_id || form.receiver_id === '0') {
          return {
            verdict: 'NO_FORM',
            detail: 'the rendered pending-review form has an EMPTY receiver_id — the backend omitted receiver_id/receiverId/receiver.id',
          };
        }
        const submitted = await arm.post('/reviews', { ...form, rating: '5', comment: `review ${marker}` });
        const after = await arm.get('/reviews');
        const present = after.body.includes(marker);
        return {
          verdict: present ? 'OK' : 'NO_EFFECT',
          effect: 'the review comment appears in the member\u2019s given reviews',
          detail: `receiver ${form.receiver_id}, transaction ${form.transaction_id}; redirect ${submitted.status} -> ${submitted.location || '(none)'}; comment present: ${present}`,
        };
      },
    },
    {
      row: '4.30',
      name: 'change a setting and have it persist',
      async run(arm) {
        const page = await arm.get('/settings/appearance');
        const form = parseForm(page.body, '/settings/appearance');
        if (!form) return { verdict: 'NO_FORM', detail: 'no /settings/appearance form' };
        const options = [...new Set([...page.body.matchAll(/name="theme" type="radio" value="([a-z]+)"/g)].map((m) => m[1]))];
        const current = form.theme || '';
        const target = options.find((o) => o !== current);
        if (!target) return { verdict: 'NO_FORM', detail: `only one theme option rendered (${options.join(', ') || 'none'})` };
        const submitted = await arm.post('/settings/appearance', { ...form, theme: target });
        const after = await arm.get('/settings/appearance');
        const persisted = new RegExp(`value="${target}"[^>]*\\schecked`).test(after.body);
        // Put it back, so a repeat run is not measuring a value this run left behind.
        if (persisted && current) {
          const restore = parseForm(after.body, '/settings/appearance') || form;
          await arm.post('/settings/appearance', { ...restore, theme: current });
        }
        return {
          verdict: persisted ? 'OK' : 'NO_EFFECT',
          effect: 'the chosen theme comes back selected on a fresh GET (read through the backend, not the session)',
          detail: `${current || '(unset)'} -> ${target}; redirect ${submitted.status} -> ${submitted.location || '(none)'}; persisted: ${persisted}`,
        };
      },
    },
  ];

  const journeyResults = [];
  if (sessionA.ok && sessionB.ok) {
    log('\n─── write journeys (ledger rows 4.22-4.30), both arms in this run ───');
    for (const journey of JOURNEYS) {
      let a; let b;
      try { a = await journey.run(sessionA.arm); } catch (err) { a = { verdict: 'THREW', detail: String(err && err.message || err) }; }
      try { b = await journey.run(sessionB.arm); } catch (err) { b = { verdict: 'THREW', detail: String(err && err.message || err) }; }
      const known = KNOWN_JOURNEY_DEFECTS.find((k) => k.row === journey.row);
      const gaps = KNOWN_FIXTURE_GAPS.filter((k) => k.row === journey.row);
      // A diagnosed fixture gap on one arm explains THAT arm only. Apply it before
      // judging, so the row is not scored against a control that cannot run — and
      // never the other way round: an ASP.NET fault must not be hidden behind a
      // control fixture gap. The first version of this ordering put FIXTURE_GAP
      // first and reported row 4.28 as a fixture gap while ASP.NET was broken.
      if (gaps.some((g) => g.arm === 'aspnet') && a.verdict !== 'OK') a.verdict = 'FIXTURE_GAP';
      if (gaps.some((g) => g.arm === 'laravel') && b.verdict !== 'OK') b.verdict = 'FIXTURE_GAP';
      let verdict;
      if (a.verdict === 'OK' && b.verdict === 'OK') verdict = 'BOTH_OK';
      else if (a.verdict !== 'OK' && a.verdict !== 'FIXTURE_GAP') {
        verdict = b.verdict === 'OK' ? 'ASPNET_FAILS' : (b.verdict === 'FIXTURE_GAP' ? 'ASPNET_FAILS_CONTROL_BLOCKED' : 'BOTH_FAIL');
      } else if (a.verdict === 'OK' && b.verdict === 'FIXTURE_GAP') verdict = 'CONTROL_FIXTURE_GAP';
      else if (a.verdict === 'FIXTURE_GAP') verdict = 'FIXTURE_GAP';
      else verdict = 'LARAVEL_FAILS';
      const row = {
        page: `journey ${journey.row} ${journey.name}`,
        row: journey.row,
        verdict,
        effect: a.effect || b.effect || null,
        aspnet: a,
        laravel: b,
        ...(known ? { known: true, reason: known.reason } : {}),
        ...(gaps.length ? { fixture_gaps: gaps } : {}),
      };
      journeyResults.push(row);
      const nonFailing = ['BOTH_OK', 'FIXTURE_GAP', 'CONTROL_FIXTURE_GAP'];
      const mark = verdict === 'BOTH_OK' ? '✓' : (nonFailing.includes(verdict) ? '~' : '✗');
      log(`${mark} ${verdict.padEnd(28)} ${journey.row} ${journey.name}`);
      log(`      aspnet:  ${a.verdict} — ${a.detail || ''}`);
      log(`      laravel: ${b.verdict} — ${b.detail || ''}`);
      for (const g of gaps) log(`      KNOWN FIXTURE GAP (${g.arm}): ${g.reason}`);
      if (known) log(`      KNOWN DEFECT: ${known.reason}`);
    }
  } else {
    log('\n🔴 write journeys NOT MEASURED this run — a failed login on either side blocks them.');
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
    + 'data volumes.');

  const NON_FAILING_VERDICTS = ['BOTH_OK', 'FIXTURE_GAP', 'CONTROL_FIXTURE_GAP'];
  const journeysBothOk = journeyResults.filter((r) => r.verdict === 'BOTH_OK').length;
  const journeyAspnetOnly = journeyResults.filter((r) => r.verdict === 'CONTROL_FIXTURE_GAP').length;
  const journeyFixtureGaps = journeyResults.filter((r) => r.verdict === 'FIXTURE_GAP').length;
  const journeyFailures = journeyResults.filter((r) => !NON_FAILING_VERDICTS.includes(r.verdict));
  log(`write journeys driven through the unchanged client's own forms: ${journeysBothOk}/${journeyResults.length} passed on BOTH arms`
    + (journeyAspnetOnly ? `, ${journeyAspnetOnly} passed on ASP.NET with the control blocked by a diagnosed fixture gap` : '')
    + (journeyFixtureGaps ? `, ${journeyFixtureGaps} unmeasurable on both` : '')
    + (journeyFailures.length ? `, ${journeyFailures.length} FAILING` : ''));
  for (const f of journeyFailures) {
    log(`  ✗ ${f.row} ${f.verdict}${f.known ? ' (diagnosed — still a defect, still red)' : ''}`);
  }

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
      journeys: journeyResults,
      journeys_both_ok: journeysBothOk,
      journeys_total: journeyResults.length,
    };
    fs.mkdirSync(path.dirname(path.resolve(JSON_OUT)), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(artifact, null, 2));
    log(`Wrote ${JSON_OUT}`);
  }

  // KNOWN page differences do not fail the run — they are diagnosed FIXTURE asymmetry
  // and shrink-only. A NEW page difference always does. 🔴 A failing write journey
  // ALWAYS fails the run, diagnosed or not: unlike a fixture gap, it means the product
  // is broken for a real member, and the ledger row is BROKEN rather than excused.
  process.exit((unexplained === 0 && journeyFailures.length === 0) ? 0 : 1);
}

main().catch((err) => {
  log(`🔴 UNMEASURABLE: ${err.stack || err}`);
  process.exit(2);
});
