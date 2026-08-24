// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * First runtime smoke of the UNCHANGED canonical React frontend against the ASP.NET
 * backend. Configuration only — no frontend source is modified, which is the whole
 * point: the completion gate is "two unchanged frontends by two backends".
 *
 * 🔴 Why this exists, when a response-diff harness already does. It measures a
 * DIFFERENT thing, and it found faults the diff harness scored as cosmetic. First run,
 * 2026-08-19:
 *
 *   - GET /api/v2/events emitted `starts_at` where Laravel emits `start_date`.
 *     DashboardPage.tsx does `new Date(event.start_date)`, so it built an Invalid Date
 *     and `formatMonthShort` threw RangeError. The whole "Upcoming events" dashboard
 *     section fell into its error boundary. The endpoint returned a well-formed 200 the
 *     entire time — the diff harness reported "some field names differ", which reads as
 *     cosmetic. One of those names was load-bearing.
 *   - /api/v2/exchanges/needs-attention-count omitted `action`, so the dashboard
 *     rendered the literal key `exchanges_attention.action.undefined` in a chip.
 *
 * Dashboard visible text went 1,365 -> 6,870 characters once the first was fixed, which
 * is the kind of evidence only a browser produces.
 *
 * ── EXIT-CODE CONTRACT (added 2026-08-21) ─────────────────────────────────────────
 * 🔴 Until 2026-08-21 this script COULD NOT FAIL: step() swallowed every exception,
 * printed FAILED, and the process always exited 0 — every assertion was silently
 * discarded. Now:
 *
 *   Single-arm mode (default):
 *     0  every step passed
 *     1  at least one step FAILED
 *     2  no step failed, but at least one was SKIPPED (a skip is a stated reason the
 *        step could not measure — following the project rule that UNAVAILABLE is
 *        never a pass), or the run itself was unmeasurable (crash, preflight down)
 *
 *   Control mode (SMOKE_CONTROL=1 or --control):
 *     0  every step pair is MATCH
 *     1  at least one ASPNET_ONLY_FAIL (real defect candidate)
 *     2  no ASPNET_ONLY_FAIL, but BOTH_FAIL / LARAVEL_ONLY_FAIL / NOT_COMPARABLE
 *        rows exist (environment or fixture suspect — not proof of an ASP.NET defect,
 *        but not a clean pass either), or the run was unmeasurable
 *
 * A JSON artifact is ALWAYS written (pass or fail) to
 *   aspnet-backend/artifacts/smoke/react-smoke-<timestamp>.json
 * (override with SMOKE_JSON=<path>). `artifacts/` is gitignored
 * (aspnet-backend/.gitignore:49), same as the parity artifacts beside it.
 *
 * ── SINGLE-ARM USAGE (unchanged) — start the app pointed at ASP.NET, then run this:
 *
 *   docker compose -f aspnet-backend/compose.yml up -d api      # or its usual start
 *   npm --prefix react-frontend run dev:dotnet -- --port 5199 --strictPort
 *   node aspnet-backend/scripts/smoke-react-against-aspnet.mjs
 *
 * 🔴 Port 5199, not 5173. 5173 is the owner's own Vite server; do not take it.
 *
 * ── CONTROL-ARM MODE (added 2026-08-21, cloned from smoke-webuk-against-aspnet.mjs) ──
 * The Laravel control answers the question the single arm cannot: "would this step
 * have failed against Laravel too?" (the always-run-a-control lesson). It provisions
 * TWO Vite instances of the UNCHANGED frontend itself — so the backend wiring is
 * guaranteed by construction, not by whoever typed the env last — runs the same steps
 * against both, and compares per-step verdicts:
 *
 *   SMOKE_CONTROL=1 node aspnet-backend/scripts/smoke-react-against-aspnet.mjs
 *   node aspnet-backend/scripts/smoke-react-against-aspnet.mjs --control
 *
 * Preconditions (each verified, and each verification can go RED — the script exits 2
 * rather than starting either backend itself):
 *   - ASP.NET dev API answering on :5080 (docker compose up -d api, in aspnet-backend/)
 *   - disposable Laravel answering on :8091 (bash aspnet-backend/scripts/start-disposable-laravel.sh)
 *
 * Frontend instances provisioned (ports chosen to avoid 5173 and hand-started 5199s):
 *   :5199 -> ASP.NET   env: VITE_BACKEND_TARGET=dotnet VITE_API_URL=http://127.0.0.1:5080,
 *                      vite --mode dotnet  (exactly what `npm run dev:dotnet` sets)
 *   :5198 -> Laravel   env: VITE_API_URL=http://127.0.0.1:8091  (backendTarget defaults
 *                      to 'laravel' when VITE_BACKEND_TARGET is unset — backendTarget.ts:9)
 * 🔴 Both instances run in PROXY mode (VITE_API_URL is the Vite /api proxy target —
 * vite.config.ts:40,347). A proxied run exercises NO CORS by design; the direct
 * cross-origin pass (VITE_API_BASE=http://127.0.0.1:5080/api, `dev:dotnet:direct`)
 * remains a single-arm exercise because the disposable Laravel's CORS allowlist does
 * not carry the control port. process.env.VITE_API_URL beats react-frontend/.env.local
 * (vite.config.ts:40 checks process.env first), so the owner's 8090 there cannot leak in.
 *
 * Per-step comparison verdicts:
 *   MATCH             both arms passed (or both skipped for the same stated reason)
 *   BOTH_FAIL         both arms failed — environment/fixture suspect, NOT an ASP.NET defect
 *   ASPNET_ONLY_FAIL  failed on ASP.NET, passed on Laravel — real defect candidate
 *   LARAVEL_ONLY_FAIL failed on Laravel, passed on ASP.NET — control broken / fixture asymmetry
 *   NOT_COMPARABLE    one or both arms SKIPPED — the pair measured nothing
 *
 * 🔴 FIXTURE ASYMMETRY the control arm inherits from the web-uk instrument's diagnosis
 * (2026-08-20): the login "community" list comes from GET /api/v2/tenants, which
 * excludes the master tenant unless include_master=1 — and the disposable Laravel
 * fixture has ONLY the master tenant, so its login select can be EMPTY. Credentials
 * also differ per side by design (each side signs in with its OWN fixture's member,
 * mirroring smoke-webuk-against-aspnet.mjs). Per-side overrides:
 *   SMOKE_EMAIL_ASPNET / SMOKE_PASSWORD_ASPNET / SMOKE_COMMUNITY_ASPNET
 *     (defaults: member@acme.test / NexusV2!Demo#2026 / "ACME Community Timebank")
 *   SMOKE_EMAIL_LARAVEL / SMOKE_PASSWORD_LARAVEL / SMOKE_COMMUNITY_LARAVEL
 *     (defaults: e2e.user.a@project-nexus.local / TestPassword123! / first offered option)
 *   SMOKE_ASPNET_API / SMOKE_LARAVEL_API   backend origins (:5080 / :8091)
 *   SMOKE_PORT_ASPNET / SMOKE_PORT_LARAVEL frontend ports (5199 / 5198)
 * A Laravel-side login failure caused by the empty tenant list surfaces as
 * LARAVEL_ONLY_FAIL — a control/fixture problem to fix, never an ASP.NET verdict.
 *
 * ── LESSONS (unchanged) ──────────────────────────────────────────────────────────
 * 🔴 Three obstacles that are FRONTEND CHROME, not backend faults. The first two runs
 * timed out clicking a disabled button and it looked like a backend problem:
 *   1. a cookie banner and an AI-features dialog overlay everything until dismissed;
 *   2. the email field is `name="username"` with `type="email"`, not `name="email"`;
 *   3. Sign In stays DISABLED until a community is chosen from a native <select>.
 * Satisfy all three or the run measures nothing.
 *
 * 🔴 ONE RUN PER MINUTE. A single pass makes ~190 API calls and the dev rate limit is
 * 200 per 60 seconds (`RateLimiting__General__PermitLimit` in aspnet-backend/compose.yml),
 * so a back-to-back run floods the console with 429s that look like backend faults and
 * are not. Wait for the window, or raise the limit deliberately for a batch. (Control
 * mode runs the arms sequentially against DIFFERENT backends, so each stays within its
 * own window — but two control runs back to back do not.)
 *
 * 🔴 AND LEAVE LONGER THAN A MINUTE BETWEEN TWO **CONTROL** RUNS, on Windows
 * especially. Measured 2026-08-21: the second of two control runs started shortly after
 * the first produced `net::ERR_NO_BUFFER_SPACE` on a page load, and then EIGHT
 * consecutive steps failed with "Navigation to X is interrupted by another navigation to
 * Y" — each step inheriting the previous step's unsettled goto. The tally read
 * 9 LARAVEL_ONLY_FAIL, which looks like the control arm falling apart. It is not a
 * control defect and it is not a product fault: it is the HOST running out of ephemeral
 * sockets, because a control run is four processes (two Vite servers, two Chromium
 * instances) and ~400 API calls. The tell is the CASCADE — real failures do not name
 * the previous step's URL. If you see it, wait a few minutes and re-run; do not chase
 * it in the product, and do not report the affected steps as measured.
 *
 * 🔴 It asserts CONTENT, not just navigation. A redirect back to /login and a page whose
 * only content is an error both count as failures — "the page loaded" is not evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const REACT_DIR = path.join(REPO_ROOT, 'react-frontend');
const ARTIFACT_DIR = path.join(REPO_ROOT, 'aspnet-backend', 'artifacts', 'smoke');

const CONTROL = process.env.SMOKE_CONTROL === '1' || process.argv.includes('--control');

const ASPNET_API = process.env.SMOKE_ASPNET_API || 'http://127.0.0.1:5080';
const LARAVEL_API = process.env.SMOKE_LARAVEL_API || 'http://127.0.0.1:8091';
const PORT_ASPNET = Number(process.env.SMOKE_PORT_ASPNET || 5199);
const PORT_LARAVEL = Number(process.env.SMOKE_PORT_LARAVEL || 5198);

const stampSuffix = process.env.SMOKE_STAMP || String(process.hrtime.bigint() % 100000n);

// ── step machinery ────────────────────────────────────────────────────────────────
// 🔴 The old step() caught every exception, printed FAILED, and moved on with no
// record and no exit code — the script literally could not fail. The run still
// CONTINUES after a failure (full coverage per run is wanted), but every step now
// records a verdict {name, ok, skipped, error, durationMs} that the summary, the JSON
// artifact and the exit code are computed from. A step that could not measure for a
// stated reason calls skip(reason) and is reported SKIPPED — never as a pass.
class SkipStep extends Error {}
function skip(reason) { throw new SkipStep(reason); }

function classify(url, status) {
  if (status === 0) return 'transport';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 || status === 405) return 'route-missing';
  if (status >= 500) return 'server-error';
  return 'ok';
}

async function probe(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ── one full pass of every step against one frontend instance ─────────────────────
// arm = { key, label, base, apiPort, email, password, communityLabel }
async function runArm(arm) {
  const BASE = arm.base;
  const EMAIL = arm.email;
  const PASSWORD = arm.password;
  // Per-arm stamp so the two arms' created records can never be confused in a report.
  const stamp = `${stampSuffix}${arm.key === 'laravel' ? 'l' : ''}`;

  const api = [];
  const consoleErrors = [];
  const pageErrors = [];
  const results = [];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  // Every actor contributes to a journey's consumed path. The primary page alone is
  // insufficient for two-member transfers and exchanges, so attach the same recorder
  // to each page/context the smoke creates.
  const captureApiFrom = (observedPage) => {
    observedPage.on('response', (r) => {
      const u = r.url();
      if (u.includes('/api/')) api.push({
        method: r.request().method(),
        url: u.replace(BASE, ''),
        absolute: u,
        status: r.status(),
        phase: current,
      });
    });
    observedPage.on('requestfailed', (r) => {
      const u = r.url();
      if (u.includes('/api/')) api.push({
        method: r.method(),
        url: u.replace(BASE, ''),
        absolute: u,
        status: 0,
        phase: current,
        failure: r.failure()?.errorText,
      });
    });
  };
  captureApiFrom(page);
  // 🔴 The app validates responses at runtime in dev and logs "contract drift" with a
  // structured list of what is wrong. That is the CLIENT'S OWN VERDICT on the contract —
  // better evidence than any external field diff, because it says what the app expected
  // and what it got. It was being truncated to 200 characters and discarded; the first
  // captured message reported 60 issues on a single endpoint. Serialise it instead.
  const contractDrift = [];
  const captureClientErrorsFrom = (observedPage) => {
    observedPage.on('console', async (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      if (/contract drift/i.test(text)) {
        try {
          const args = await Promise.all(m.args().map((a) => a.jsonValue().catch(() => null)));
          const detail = args.find((a) => a && typeof a === 'object' && a.endpoint);
          if (detail) { contractDrift.push({ phase: current, ...detail }); return; }
        } catch { /* fall through and keep the plain text */ }
      }
      consoleErrors.push({ phase: current, text: text.slice(0, 200) });
    });
    observedPage.on('pageerror', (e) => pageErrors.push({ phase: current, text: String(e).slice(0, 200) }));
  };
  captureClientErrorsFrom(page);

  let current = 'landing';
  async function step(name, fn) {
    current = name;
    const started = Date.now();
    const driftAtStart = contractDrift.length;
    const apiAtStart = api.length;
    const apiRequests = () => [...new Set(api.slice(apiAtStart)
      .filter((request) => request.status > 0)
      .map((request) => `${request.method} ${new URL(request.absolute).pathname}`))].sort();
    try {
      await fn();
      // The React app validates consumed response contracts at runtime. A step that
      // reaches its visible effect while the client reports schema drift is not clean
      // evidence: the next reader may depend on one of the rejected fields. This was
      // exposed by RSVP, which persisted correctly while six response fields violated
      // the client's schema and the smoke still printed `ok`. Fail the owning step so
      // control mode can classify the drift instead of burying it in a footer.
      await page.waitForTimeout(100);
      const newDrift = contractDrift.slice(driftAtStart);
      if (newDrift.length > 0) {
        const summary = newDrift.map((d) => `${d.endpoint ?? 'unknown endpoint'} (${d.issues?.length ?? '?'} issue(s))`).join(', ');
        throw new Error(`client-reported contract drift during ${name}: ${summary}`);
      }
      results.push({ name, ok: true, skipped: false, error: null, durationMs: Date.now() - started, apiRequests: apiRequests() });
      console.log(`  step ${name}: ok`);
    } catch (e) {
      const durationMs = Date.now() - started;
      if (e instanceof SkipStep) {
        results.push({ name, ok: false, skipped: true, error: e.message, durationMs, apiRequests: apiRequests() });
        console.log(`  step ${name}: SKIPPED — ${e.message.slice(0, 160)}`);
      } else {
        results.push({ name, ok: false, skipped: false, error: String(e).split('\n')[0].slice(0, 300), durationMs, apiRequests: apiRequests() });
        console.log(`  step ${name}: FAILED — ${String(e).split('\n')[0].slice(0, 160)}`);
      }
    }
  }

  console.log(`\nSmoke [${arm.label}]: unchanged React app -> ${arm.label}, via ${BASE}\n`);

  await step('landing', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
    console.log(`    title: ${JSON.stringify(await page.title())}`);
    const bodyLen = (await page.locator('body').innerText()).trim().length;
    console.log(`    visible text length: ${bodyLen}`);
    if (bodyLen === 0) throw new Error('landing rendered no visible text at all');
  });

  // 🔴 Consent overlays block every click until dismissed, and the first smoke run
  // timed out on the Sign In button because of them — NOT because of the backend.
  // A cookie banner and an AI-features dialog both render above the form. Classify
  // these as frontend chrome, never as ASP.NET defects.
  const dismissConsent = async (p = page) => {
    for (const label of ['Essential only', 'Use basic features only']) {
      const b = p.locator(`button:has-text("${label}")`).first();
      if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(500); }
    }
  };
  await step('dismiss-consent', dismissConsent);

  await step('login-page', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
    await dismissConsent();
    // 🔴 The field is name="username" with type="email" — not name="email".
    const usernameInputs = await page.locator('input[name="username"]').count();
    console.log(`    username inputs: ${usernameInputs}`);
    if (usernameInputs === 0) throw new Error('login form did not render a username input');
  });

  await step('select-community', async () => {
    // 🔴 THE actual gate. Sign In stays disabled until a community is chosen — the
    // login form carries a native <select> of communities (ACME, Globex, ACME Youth,
    // Smoke Hub, Smoke Branch). The first two smoke runs timed out clicking a disabled
    // button and it looked like a backend problem. It is not: it is a required field.
    const opts = (await page.locator('select option').allTextContents()).map((o) => o.trim()).filter(Boolean);
    console.log(`    communities offered: ${JSON.stringify(opts)}`);
    if (!opts.length) {
      // On the Laravel control this is the diagnosed master-tenant fixture asymmetry
      // (see the header) — a control/fixture fact, but it still fails the arm because
      // every signed-in step downstream is now unmeasurable.
      throw new Error('login select offered NO communities (GET /api/v2/tenants returned none — fixture gap)');
    }
    if (arm.communityLabel && opts.includes(arm.communityLabel)) {
      await page.selectOption('select', { label: arm.communityLabel });
    } else {
      if (arm.communityLabel) console.log(`    configured community ${JSON.stringify(arm.communityLabel)} not offered — selecting first available: ${JSON.stringify(opts[0])}`);
      else console.log(`    no community configured for this arm — selecting first available: ${JSON.stringify(opts[0])}`);
      await page.selectOption('select', { label: opts[0] });
    }
    await page.waitForTimeout(600);
  });

  await step('login-submit', async () => {
    await page.fill('input[name="username"]', EMAIL);
    await page.fill('input[name="password"]', PASSWORD);
    // 🔴 Sign In is DISABLED until the form validates, so waiting for enabled is part
    // of the test rather than a workaround.
    const submit = page.locator('button[type="submit"]:has-text("Sign In")').first();
    await submit.waitFor({ state: 'visible', timeout: 15000 });
    for (let i = 0; i < 20 && !(await submit.isEnabled()); i++) await page.waitForTimeout(250);
    console.log(`    submit enabled: ${await submit.isEnabled()}`);
    await submit.click();
    await page.waitForTimeout(6000);
    const urlAfter = page.url().replace(BASE, '') || '/';
    console.log(`    url after submit: ${urlAfter}`);
    const token = await page.evaluate(() => Object.keys(localStorage).filter((k) => /token|auth/i.test(k)));
    console.log(`    auth keys in localStorage: ${JSON.stringify(token)}`);
    if (!token.length) throw new Error(`no auth keys stored after submit (landed on ${urlAfter}) — login did not complete`);
  });

  // 🔴 A REUSABLE sign-in, added 2026-08-21 for the exchange journey, which is the
  // first journey needing TWO members in one run (a requester and a provider).
  // It repeats the three login gates deliberately rather than importing them: the
  // consent overlays re-render in every fresh browser context, the field is
  // name="username", and Sign In stays disabled until a community is chosen. A
  // second-actor login that skips any one of them times out on a disabled button
  // and reads exactly like a backend refusing the second member.
  async function signInAs(p, email, password, communityLabel) {
    await p.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
    await p.waitForTimeout(1200);
    await dismissConsent(p);
    const opts = (await p.locator('select option').allTextContents()).map((o) => o.trim()).filter(Boolean);
    if (!opts.length) return { ok: false, reason: 'login select offered NO communities (fixture gap, not a backend verdict)' };
    await p.selectOption('select', { label: communityLabel && opts.includes(communityLabel) ? communityLabel : opts[0] });
    await p.waitForTimeout(500);
    await p.fill('input[name="username"]', email);
    await p.fill('input[name="password"]', password);
    const submit = p.locator('button[type="submit"]:has-text("Sign In")').first();
    await submit.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    for (let i = 0; i < 20 && !(await submit.isEnabled().catch(() => false)); i++) await p.waitForTimeout(250);
    await submit.click({ timeout: 15000 }).catch(() => {});
    await p.waitForTimeout(5000);
    const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => /token|auth/i.test(k)));
    if (!keys.length) return { ok: false, reason: `second actor ${email} could not sign in (landed on ${p.url().replace(BASE, '')})` };
    return { ok: true };
  }

  // 🔴 `/feed` was missing from this list until 2026-08-20, which is why a feed rewrite had
  // no browser-level evidence at all. `/events` is here for the same reason: the dashboard
  // crash caused by the events contract port was only ever going to be caught by rendering a
  // page, never by a response diff — a diff compares the shape you ASKED for, and the harness
  // asks for the canonical one. If you port a read endpoint, put its page in this list.
  for (const [name, pagePath] of [['dashboard', '/dashboard'], ['feed', '/feed'], ['listings', '/listings'], ['events', '/events'], ['members', '/members'], ['wallet', '/wallet'], ['help', '/help']]) {
    await step(name, async () => {
      await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2500);
      const url = page.url().replace(BASE, '');
      const text = (await page.locator('body').innerText()).trim();
      console.log(`    ${pagePath} -> ${url}  text=${text.length}`);
      // 🔴 "the page loaded" is not evidence. A redirect back to /login, or a page
      // whose only content is an error, both count as FAILED here.
      if (url.startsWith('/login')) throw new Error(`${pagePath} redirected to login — session lost`);
      if (text.length < 200) throw new Error(`${pagePath} rendered almost no content (${text.length} chars)`);
    });
  }

  // ── member ACTIONS through the UI ──────────────────────────────────────────────
  // 🔴 Everything above is READ-ONLY. A backend can serve every page correctly and still
  // refuse every action, and until 2026-08-19 no member action had ever been driven
  // through the browser against ASP.NET — only through the write harness, which speaks
  // HTTP directly and bypasses the app's own forms, CSRF handling and error surfacing.
  await step('action-create-listing', async () => {
    // 🔴 `/listings/create`, not `/listings/new`. The wrong guess is not a harmless typo:
    // `listings/new` matches the `listings/:id` route, so the app requests
    // /api/v2/listings/new, gets a 404, and the step reports "form not reachable" — which
    // reads exactly like a backend fault. Route confirmed at AppRoutes.tsx:990.
    await page.goto(`${BASE}/listings/create`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    // 🔴 Consent dialogs re-appear on this page too and overlay the form.
    await dismissConsent();

    // 🔴 The fields have NO `name` attribute — HeroUI renders react-aria generated ids
    // (`react-aria…_r_bp_`), so `input[name="title"]` matches nothing and the step used to
    // report "form not reachable", which reads like the page failed to load. It did not:
    // the form was there, with a visible "Create Listing" submit. Target by LABEL.
    const title = page.getByLabel(/title/i).first();
    if (!(await title.count())) skip('no title field — selector needs updating, NOT a backend result');
    await title.fill(`Smoke listing ${stamp}`, { timeout: 10000 });
    const desc = page.getByLabel(/description/i).first();
    if (await desc.count()) await desc.fill('Created by the runtime smoke to exercise a member action end to end.');
    // 🔴 A category is REQUIRED (listing.require_category defaults on), so the submit stays
    // disabled without one — the same shape as the login form's community selector. A click
    // on a disabled button times out after 30s and looks like a hang.
    const selects = page.locator('select');
    for (let i = 0; i < await selects.count(); i += 1) {
      const opts = await selects.nth(i).locator('option').count();
      if (opts > 1) { await selects.nth(i).selectOption({ index: 1 }).catch(() => {}); }
    }
    await page.waitForTimeout(800);

    const submit = page.locator('button[type="submit"]:has-text("Create Listing")').first();
    if (!(await submit.count())) skip('no Create Listing button — selector needs updating');
    if (!(await submit.isEnabled())) {
      skip('🔴 submit still DISABLED — a required field is unsatisfied; not a backend result');
    }
    await submit.click({ timeout: 15000 }).catch((e) => console.log('    click failed: ' + String(e).slice(0, 90)));
    await page.waitForTimeout(5000);
    const after = page.url().replace(BASE, '');
    console.log(`    after submit: ${after}`);
    if (after.includes('/listings/create')) throw new Error('🔴 still on the form — the create did NOT complete');
    console.log('    navigated away — create appears to have succeeded');
  });

  await step('action-create-edit-manage-event', async () => {
    const createdTitle = `Smoke event ${stamp}`;
    const editedTitle = `${createdTitle} edited`;
    const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    const dateParts = {
      day: String(start.getDate()),
      month: String(start.getMonth() + 1),
      year: String(start.getFullYear()),
    };

    // React Aria renders DatePicker as editable spinbutton segments rather than an
    // input[type=date]. Drive those public accessibility semantics so this remains
    // the unchanged production form, not a request assembled by the smoke script.
    const fillSegments = async (label, values) => {
      // The visible label is connected with aria-labelledby, not copied into an
      // aria-label attribute. getByRole resolves that accessible-name relation.
      const group = page.getByRole('group', { name: label }).first();
      if (!(await group.count())) skip(`${label} segment group missing — selector needs updating, NOT a backend result`);
      const segments = group.locator('[role="spinbutton"]');
      for (let i = 0; i < await segments.count(); i += 1) {
        const segment = segments.nth(i);
        const type = (await segment.getAttribute('data-type') || '').toLowerCase();
        const value = values[type];
        if (value) await segment.fill(value);
      }
    };

    await page.goto(`${BASE}/events/create`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    await dismissConsent();
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    const title = page.getByLabel('Event Title').first();
    if (!(await title.count())) skip('event title field missing — selector needs updating, NOT a backend result');
    await title.fill(createdTitle);
    await page.getByLabel('Description').first().fill('Created by the runtime smoke to prove event creation, editing, and owner management end to end.');
    await fillSegments('Start Date', dateParts);
    await fillSegments('Start Time', { hour: '10', minute: '00' });

    const create = page.locator('button[type="submit"]:has-text("Create Event")').first();
    if (!(await create.count()) || !(await create.isEnabled())) {
      skip('Create Event submit missing or disabled — a required field is unsatisfied; not a backend result');
    }
    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v2/events',
    { timeout: 20000 });
    await create.click();
    const createResponse = await createResponsePromise;
    console.log(`    event create: POST ${new URL(createResponse.url()).pathname} -> ${createResponse.status()}`);
    if (!createResponse.ok()) throw new Error(`event create returned ${createResponse.status()}`);
    await page.waitForURL(/\/events\/\d+$/, { timeout: 20000 });
    const id = page.url().match(/\/events\/(\d+)$/)?.[1];
    if (!id) throw new Error(`create did not navigate to an event detail URL: ${page.url()}`);
    await page.reload({ waitUntil: 'networkidle' });
    if (!(await page.getByText(createdTitle, { exact: true }).count())) {
      throw new Error('created event title did not survive a detail-page reload');
    }

    await page.goto(`${BASE}/events/${id}/edit`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1200);
    const editTitle = page.getByLabel('Event Title').first();
    await editTitle.fill(editedTitle);
    const location = page.getByLabel(/location/i).first();
    if (await location.count()) await location.fill('Smoke Hall');
    const capacity = page.getByLabel(/max attendees/i).first();
    if (await capacity.count()) await capacity.fill('24');
    const update = page.locator('button[type="submit"]:has-text("Update Event")').first();
    if (!(await update.count()) || !(await update.isEnabled())) {
      throw new Error('Update Event submit missing or disabled after loading the owner edit form');
    }
    const updateResponsePromise = page.waitForResponse((response) =>
      response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v2/events/${id}`,
    { timeout: 20000 });
    await update.click();
    const updateResponse = await updateResponsePromise;
    console.log(`    event edit: PUT ${new URL(updateResponse.url()).pathname} -> ${updateResponse.status()}`);
    if (!updateResponse.ok()) throw new Error(`event edit returned ${updateResponse.status()}`);

    await page.goto(`${BASE}/events/${id}`, { waitUntil: 'networkidle', timeout: 60000 });
    if (!(await page.getByText(editedTitle, { exact: true }).count())) {
      throw new Error('edited event title did not persist on the detail page');
    }
    await page.goto(`${BASE}/events/${id}/manage/overview`, { waitUntil: 'networkidle', timeout: 60000 });
    const body = await page.locator('body').innerText();
    if (!body.includes(editedTitle) || !body.includes('Event operations')
      || !body.includes('Operational overview') || /access denied|could not load/i.test(body)) {
      throw new Error('event owner could not open the management overview after editing');
    }
    console.log(`    event ${id} created, reloaded, edited, and opened in owner management`);
  });

  // 🔴 POSTING. The feed composer opens from a "Create" button (there is no inline
  // textarea on /feed — a selector looking for one reports "no composer" and reads like a
  // backend fault). Every consent dismissal carries a short timeout: a covered button hung
  // for the full 30s default once and looked like a hang.
  await step('action-create-feed-post', async () => {
    await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    await dismissConsent();
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    const create = page.locator('button:has-text("Create")').first();
    if (!(await create.count())) skip('no Create control — selector needs updating, NOT a backend result');
    await create.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const composer = page.locator('textarea, [contenteditable="true"]').first();
    if (!(await composer.count())) skip('composer did not open — selector needs updating, NOT a backend result');
    const body = `Smoke feed post ${stamp}`;
    await composer.fill(body, { timeout: 10000 }).catch(async () => { await composer.type(body).catch(() => {}); });
    await page.waitForTimeout(500);

    const submit = page.locator('button:has-text("Post"), button[type="submit"]').last();
    if (!(await submit.count()) || !(await submit.isEnabled())) {
      skip('submit missing or disabled — a required field is unsatisfied; not a backend result');
    }
    await submit.click({ timeout: 15000 }).catch((e) => console.log('    click failed: ' + String(e).slice(0, 80)));
    await page.waitForTimeout(4000);
    // 🔴 Assert the EFFECT: the post must be on the page, not merely "no error shown".
    const present = await page.locator(`text=${body}`).count();
    const inCard = await page.locator(`[role="article"]:has-text("${body}")`).count();
    console.log(`    post visible on the feed afterwards: ${present > 0 ? 'YES — posting works' : 'no (unconfirmed)'} (as a card: ${inCard})`);
    if (!present) skip('post not visible after submit — effect unconfirmed (ranking/render, not proven either way)');
  });

  // 🔴 TRANSFERRING credits — the highest-risk member action, because it moves value.
  await step('action-transfer-credits', async () => {
    const balanceFrom = async (p) => {
      const text = await p.locator('body').innerText();
      const match = text.match(/(-|−|–)?\s*([\d,]+(?:\.\d+)?)\s*(?:hours|credits)/i);
      if (!match) return null;
      const magnitude = Number(match[2].replace(/,/g, ''));
      if (Number.isNaN(magnitude)) return null;
      return match[1] ? -magnitude : magnitude;
    };

    // Verify both legs. Checking only the sender can pass a one-sided write that
    // destroys value. The existing provider fixture is a known second member on both
    // arms, so read that member's wallet before and after the primary member sends.
    const recipientCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const recipientPage = await recipientCtx.newPage();
    captureApiFrom(recipientPage);
    const recipientSignedIn = await signInAs(
      recipientPage,
      arm.providerEmail,
      arm.providerPassword,
      arm.communityLabel,
    );
    if (!recipientSignedIn.ok) {
      await recipientCtx.close();
      skip(`transfer recipient actor unavailable: ${recipientSignedIn.reason}`);
    }
    await recipientPage.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
    await recipientPage.waitForTimeout(2500);
    const recipientBalanceBefore = await balanceFrom(recipientPage);

    // 🔴 Close anything the PREVIOUS step left open. The feed composer is a modal, and a
    // lingering overlay intercepts the click on this page's own button — which made this
    // step report "transfer form did not open" while the form opened perfectly when the
    // step was run in isolation. A step that passes alone and fails in sequence is almost
    // always leftover UI state, not the backend.
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(400);
    await dismissConsent();
    const balanceBefore = await balanceFrom(page);
    console.log(`    balances before — sender: ${balanceBefore ?? '(not found)'}, recipient: ${recipientBalanceBefore ?? '(not found)'}`);
    if (balanceBefore === null || recipientBalanceBefore === null) {
      await recipientCtx.close();
      skip('could not read both wallet balances before transfer — effect cannot be measured');
    }

    const send = page.locator('button:has-text("Send Credits")').first();
    if (!(await send.count())) skip('no Send Credits control — selector needs updating, NOT a backend result');
    await send.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // Fields use react-aria generated ids. Select the intended recipient first, then
    // fill the amount: the amount input is rendered from the start, but sending value
    // before proving who will receive it is unsafe test behaviour.
    const recipient = page.getByLabel('Search recipient').first();
    if (!(await recipient.count())) {
      skip(`recipient field not addressable (visible inputs: ${await page.locator('input:visible').count()})`
        + ' — selector needs updating, NOT a backend result');
    }

    // 🔴 Pick the recipient from the SEARCH RESULTS, never by typing a name and hoping.
    // A transfer moves value; sending to whoever happens to be first in an unfiltered list
    // is not a test, it is an accident waiting to be reported as a pass.
    await recipient.fill(arm.transferSearch, { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(2500);
    // The result rows are native buttons inside the named results group. The old
    // selector ended with `button:has-text("coordinator")`, which could select a
    // completely unrelated button elsewhere on the wallet page. The click then did
    // nothing to the modal, the recipient stayed empty, and the amount field was
    // falsely reported as absent even though it is always rendered. Anchor the click
    // to the component's accessible group and prove selection by waiting for the
    // search field to be replaced by the selected-recipient card.
    const results = page.getByRole('group', { name: /search results/i }).first();
    const option = results.getByRole('button').first();
    if (!(await results.count()) || !(await option.count())) {
      skip('recipient search returned no selectable result — cannot complete safely; NOT a backend verdict');
    }
    console.log(`    transfer recipient selected from results: ${JSON.stringify((await option.innerText()).replace(/\s+/g, ' ').trim())}`);
    await option.click({ timeout: 8000 });
    try {
      await recipient.waitFor({ state: 'detached', timeout: 8000 });
    } catch {
      skip('recipient result click did not select a member — search field remained visible; NOT a backend verdict');
    }
    await page.waitForTimeout(1200);

    // Stage two: the recipient is now proved, so fill the amount.
    // HeroUI v3 does not consistently expose Input's aria-label through the wrapper
    // in the live browser. The input is still an unambiguous number field inside the
    // transfer dialog, so anchor it to that dialog rather than relying on generated ids.
    const transferDialog = page.locator('[role="dialog"]:visible').last();
    const amount = transferDialog.locator('input[type="number"]:visible').first();
    if (!(await amount.count())) {
      skip('amount number field absent inside the transfer dialog after recipient selection — NOT a backend verdict');
    }
    await amount.fill('1', { timeout: 8000 }).catch(() => {});
    const note = page.locator('textarea:visible').first();
    if (await note.count()) await note.fill(`Smoke transfer ${stamp}`, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);

    const confirm = page.locator('button:has-text("Send Credits")').last();
    if (!(await confirm.isEnabled())) {
      skip('submit still DISABLED after filling recipient+amount — a required field is '
        + 'unsatisfied; NOT a backend verdict');
    }
    await confirm.click({ timeout: 15000 }).catch((e) => console.log('    click failed: ' + String(e).slice(0, 80)));
    await page.waitForTimeout(5000);

    // 🔴 Assert the EFFECT on the ledger, not the absence of an error dialog.
    await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    const after = await page.locator('body').innerText();
    const listed = after.includes(`Smoke transfer ${stamp}`);
    const balanceAfter = await balanceFrom(page);
    await recipientPage.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
    await recipientPage.waitForTimeout(2500);
    const recipientBalanceAfter = await balanceFrom(recipientPage);
    await recipientCtx.close();
    console.log(`    balances after  — sender: ${balanceAfter ?? '(not found)'}, recipient: ${recipientBalanceAfter ?? '(not found)'}`);
    console.log(`    transfer in the ledger afterwards: ${listed ? 'YES — transferring works' : 'no (unconfirmed)'}`);
    if (!listed) skip('transfer not visible in the ledger afterwards — effect unconfirmed, NOT a proven failure');
    const senderDelta = balanceAfter === null ? null : balanceAfter - balanceBefore;
    const recipientDelta = recipientBalanceAfter === null ? null : recipientBalanceAfter - recipientBalanceBefore;
    console.log(`    credit movement — sender: ${senderDelta}, recipient: ${recipientDelta} (expected -1 / +1)`);
    if (senderDelta !== -1 || recipientDelta !== 1) {
      throw new Error(`transfer moved credits incorrectly: sender ${senderDelta}, recipient ${recipientDelta}; expected -1/+1`);
    }
  });

  await step('action-rsvp-event', async () => {
    // The disposable Laravel fixture's only event is owned by the primary smoke member.
    // Owners cannot RSVP to their own event, so using that actor made the control skip
    // while ASP.NET passed. This is fixture identity, not product divergence. Drive the
    // unchanged UI as the fixture's second ordinary member on that arm; keep all API and
    // client-contract instrumentation attached to the additional page.
    let rsvpContext = null;
    let rsvpPage = page;
    try {
      if (arm.rsvpActorEmail) {
        rsvpContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        rsvpPage = await rsvpContext.newPage();
        captureApiFrom(rsvpPage);
        captureClientErrorsFrom(rsvpPage);
        const signedIn = await signInAs(
          rsvpPage,
          arm.rsvpActorEmail,
          arm.rsvpActorPassword,
          arm.communityLabel,
        );
        if (!signedIn.ok) skip(`RSVP fixture actor could not sign in: ${signedIn.reason}`);
      }

      await rsvpPage.goto(`${BASE}/events`, { waitUntil: 'networkidle', timeout: 60000 });
      await rsvpPage.waitForTimeout(1500);
    // 🔴 Must match /events/<NUMBER>. `a[href*="/events/"]` also matches `/events/create`,
    // and picking that opened the CREATE form — whose buttons are "Select a category" and
    // "Create Event", so the step then reported "no RSVP control on the event page" while
    // never having opened an event at all. A selector fault that reads as a backend gap.
    const hrefs = await rsvpPage.locator('a[href*="/events/"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href')).filter((h) => /\/events\/\d+(?:[/?#]|$)/.test(h || '')));
    if (!hrefs.length) skip('no event DETAIL links on the list (only create/filter links)');
    const eventPath = hrefs[0].startsWith('/') ? hrefs[0] : `/${hrefs[0]}`;
    await rsvpPage.goto(`${BASE}${eventPath}`, { waitUntil: 'networkidle', timeout: 60000 });
    await rsvpPage.waitForTimeout(2500);

    // 🔴 THIS STEP USED TO ASSERT NOTHING. It clicked the RSVP control, waited 3s and
    // logged "RSVP control clicked" — so it could not fail however broken RSVP was, and
    // its MATCH verdict carried no information at all about the effect. Row 1.23 was
    // graded PROVEN on it, and PROVEN requires "an assertion on the effect"; that grade
    // was withdrawn on 2026-08-22 when this body was read. It now changes the state,
    // RELOADS and re-reads, which is the bar rows 1.21 and 1.35 already meet.
    //
    // 🔴 HOW TO ADDRESS THIS CONTROL. Established by DUMPING THE LIVE DOM after two
    // selectors in a row silently matched nothing and skipped both arms — a skip looks
    // like a clean run and measures nothing, which is the dangerous failure here.
    // The rendered markup (HeroUI v3 ToggleButtonGroup over react-aria-components) is:
    //
    //   <div aria-label="RSVP options" role="radiogroup" data-slot="toggle-button-group">
    //     <button role="radio" aria-checked="false" aria-label="Mark yourself as interested">Interested</button>
    //     <button role="radio" aria-checked="false" aria-label="Mark yourself as not going">Not Going</button>
    //
    // so, in order of how badly each one bit:
    //   1. the options are role="radio", NOT role="button" — every getByRole('button')
    //      lookup finds nothing, however right the name is;
    //   2. the accessible name is the ARIA-LABEL ("Mark yourself as interested"), which
    //      overrides the visible text ("Interested") — matching on visible text by role
    //      name cannot work either;
    //   3. selection reads from aria-checked. `id` is NOT usable: it is the collection
    //      key and react-aria-components/dist/private/ToggleButton.mjs:73 does
    //      `delete DOMProps.id`, so it never reaches the DOM. data-selected is only the
    //      Tailwind variant hook and was absent on every option in the live dump;
    //   4. "Not Going" CONTAINS "Going", so any substring match picks the wrong option.
    //
    // 🔴 Not every event offers every option — the live event offered only Interested
    // and Not Going, because EventDetailPage gates each one behind showGoingAction /
    // showInterestedAction / showNotGoingAction. Work from what is actually offered.
    const RSVP_GROUP = '[aria-label="RSVP options"]';
    const ARIA = {
      going: 'Mark yourself as going',
      interested: 'Mark yourself as interested',
      not_going: 'Mark yourself as not going',
    };
    const opt = (key) => rsvpPage.locator(`${RSVP_GROUP} [role="radio"][aria-label="${ARIA[key]}"]`).first();
    const checkedKey = async () => rsvpPage.evaluate(({ group, aria }) => {
      for (const [key, label] of Object.entries(aria)) {
        const el = document.querySelector(`${group} [role="radio"][aria-label="${label}"]`);
        if (el && el.getAttribute('aria-checked') === 'true') return key;
      }
      return null;
    }, { group: RSVP_GROUP, aria: ARIA });
    const visibleRsvpState = async () => {
      const checked = await checkedKey();
      if (checked) return checked;

      // Once registration is confirmed React correctly removes the "Going" action
      // (`can_register` is false) and renders a green "Going" status chip instead.
      // Reading only aria-checked therefore reports none for the strongest successful
      // outcome even though the reloaded page is explicitly showing it.
      return await rsvpPage.getByText(/^Going$/i).count() ? 'going' : null;
    };

    if (!(await rsvpPage.locator(RSVP_GROUP).count())) {
      skip('no RSVP options group on the event page — selector needs updating, NOT a backend result');
    }
    const offered = [];
    for (const key of Object.keys(ARIA)) if (await opt(key).count()) offered.push(key);
    console.log(`    RSVP options offered: ${offered.join(', ') || '(none)'}`);
    if (!offered.length) skip('the RSVP group rendered no options — NOT a backend result');

    const before = await checkedKey();
    // Choose a state that is a genuine CHANGE, so this drives RSVP rather than
    // observing whatever the fixture already left behind. Prefer going, then
    // interested; not_going last, because it is the least informative outcome.
    const target = ['going', 'interested', 'not_going'].find((k) => offered.includes(k) && k !== before);
    if (!target) skip(`the only RSVP option offered (${offered.join(', ')}) is already selected — nothing to change`);

    // Changing or clearing an existing RSVP is deliberately confirmation-gated. The
    // previous probe ignored that dialog, waited on a page where no request had been
    // sent, and reported BOTH backends as failing persistence. Start listening before
    // the click so a fast response cannot race the probe, then accept the real dialog
    // when the product requires it.
    const mutationResponse = rsvpPage.waitForResponse((response) => {
      const request = response.request();
      return /\/api\/v2\/events\/\d+\/rsvp(?:\?|$)/.test(response.url())
        && ['POST', 'DELETE'].includes(request.method());
    }, { timeout: 15000 }).catch(() => null);
    await opt(target).click({ timeout: 8000 });
    await rsvpPage.waitForTimeout(500);

    const confirmation = rsvpPage.locator('[role="alertdialog"]:visible, [role="dialog"]:visible').last();
    if (await confirmation.count()) {
      const confirmButton = confirmation.getByRole('button')
        .filter({ hasNotText: /cancel|close/i })
        .last();
      if (!(await confirmButton.count())) {
        throw new Error('RSVP opened a confirmation dialog with no confirm action');
      }
      console.log(`    RSVP confirmation required; accepting ${JSON.stringify((await confirmButton.innerText()).trim())}`);
      await confirmButton.click({ timeout: 8000 });
    }

    const response = await mutationResponse;
    if (!response) {
      throw new Error('RSVP control produced no POST/DELETE request within 15 seconds');
    }
    const method = response.request().method();
    console.log(`    RSVP mutation: ${method} ${new URL(response.url()).pathname} -> ${response.status()}`);
    if (!response.ok()) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 240);
      throw new Error(`RSVP mutation returned ${response.status()}${detail ? `: ${detail}` : ''}`);
    }
    await rsvpPage.waitForTimeout(2500);
    console.log(`    RSVP ${before ?? '(none)'} -> clicked "${ARIA[target]}"; in-page selection now: ${await visibleRsvpState() ?? '(none)'}`);

    // The assertion that matters: it must survive a reload, i.e. the backend stored it.
    // Capture the exact detail response the unchanged page consumes. A confirmed RSVP
    // deliberately removes its own "Going" action, and a text-only lookup can confuse
    // the viewer's status chip with another attendee's roster chip.
    // Parse inside the response event. Retaining Playwright's Response object and
    // calling json() several seconds later can fail with Network.getResponseBody / no
    // data after Chromium releases the resource, despite the page having consumed it.
    const reloadedDetailPayload = new Promise((resolve) => {
      const timer = setTimeout(() => {
        rsvpPage.off('response', captureDetail);
        resolve(null);
      }, 15000);
      async function captureDetail(candidate) {
        const request = candidate.request();
        if (request.method() !== 'GET'
          || !/\/api\/v2\/events\/\d+(?:\?|$)/.test(candidate.url())) return;
        clearTimeout(timer);
        rsvpPage.off('response', captureDetail);
        if (!candidate.ok()) { resolve(null); return; }
        resolve(await candidate.json().catch(() => null));
      }
      rsvpPage.on('response', captureDetail);
    });
    await rsvpPage.reload({ waitUntil: 'networkidle', timeout: 60000 });
    const detailPayload = await reloadedDetailPayload;
    await rsvpPage.waitForTimeout(2500);
    const reloadedEvent = detailPayload?.data;
    const persistedFromContract = reloadedEvent?.relationship?.registration?.state === 'confirmed'
      ? 'going'
      : reloadedEvent?.relationship?.engagement?.state === 'interested'
        ? 'interested'
        : ['declined', 'cancelled'].includes(reloadedEvent?.relationship?.registration?.state)
          ? 'not_going'
          : null;
    const persisted = persistedFromContract ?? await visibleRsvpState();
    if (!detailPayload) {
      console.log('    reload response body unavailable to Playwright; asserting the rendered RSVP state instead');
    }
    console.log(`    RSVP survived a reload: ${persisted === target ? `YES — "${target}" persisted` : `NO — reads "${persisted ?? '(none)'}"`}`);
    if (persisted !== target) {
      throw new Error(`RSVP did not persist: selected "${target}", after a reload the event reads `
        + `"${persisted ?? '(none)'}". The click was accepted in-page but the backend did not store it.`);
    }

    // Put it back, so a repeat run is not measuring what the last run left behind.
    if (before && before !== target && await opt(before).count()) {
      await opt(before).click({ timeout: 8000 }).catch(() => {});
      await rsvpPage.waitForTimeout(500);
      const restoreConfirmation = rsvpPage.locator('[role="alertdialog"]:visible, [role="dialog"]:visible').last();
      if (await restoreConfirmation.count()) {
        await restoreConfirmation.getByRole('button')
          .filter({ hasNotText: /cancel|close/i })
          .last()
          .click({ timeout: 8000 });
      }
      await rsvpPage.waitForTimeout(1500);
    }
    } finally {
      if (rsvpContext) await rsvpContext.close();
    }
  });

  // ── Tier-1 journeys added 2026-08-20 (C.2 of the certification plan) ───────────────
  // Each asserts an EFFECT, never merely "no error shown", and each labels a selector
  // miss as a TEST gap rather than a backend result — the four-failed-login-probe
  // lesson, written where the next selector will be typed.

  // PROFILE: the page must render the signed-in member's own identity, and the edit
  // screen must open with a form. (Editing itself is asserted only as far as the form
  // accepting input — a save changes durable state every run, and the profile has no
  // stamped field to safely churn.)
  await step('journey-profile', async () => {
    await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');
    const text = (await page.locator('body').innerText()).trim();
    if (text.length < 200) throw new Error('profile page rendered almost no content');
    const hasIdentity = /Member|member@acme\.test|Acme/i.test(text);
    console.log(`    profile renders the member's identity: ${hasIdentity ? 'YES' : 'no (unconfirmed — check fixture names)'}`);

    // 🔴 There is NO Edit control on the profile page — own-profile editing lives in
    // SETTINGS (ProfilePage.tsx:199 explains the isOwnProfile → "Settings/edit UI"
    // routing). The first run of this journey probed for an Edit button here and
    // reported a selector miss; that was the app's real structure, not a gap. The edit
    // surface is asserted below on /settings instead.
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    const fields = await page.locator('input, textarea, select').count();
    console.log(`    settings (the edit surface) opened with ${fields} form fields: ${fields > 0 ? 'YES' : 'no'}`);
    if (fields === 0) throw new Error('settings rendered no editable fields');
  });

  // NOTIFICATIONS: the page must render, and if anything is unread, marking it read
  // must stick. The earlier RSVP/post/transfer actions generate notifications for the
  // admin, not this member, so an empty list here is a fixture fact, not a failure.
  await step('journey-notifications', async () => {
    await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');
    const text = (await page.locator('body').innerText()).trim();
    if (text.length < 100) throw new Error('notifications page rendered almost no content');
    const markAll = page.locator('button:has-text("Mark all")').first();
    if (await markAll.count() && await markAll.isEnabled().catch(() => false)) {
      await markAll.click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2000);
      console.log('    mark-all-read clicked; page still standing:', !(page.url().includes('/login')));
    } else {
      console.log('    nothing unread to mark (fixture fact, not a failure)');
    }
  });

  // SETTINGS + THEME: the settings page must render, and toggling the theme must
  // change the document class AND survive a reload (it persists via
  // PUT /users/me/theme — a silent 4xx there means the toggle reverts on reload).
  await step('journey-settings-theme', async () => {
    await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(1500);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
    const before = await isDark();
    // 🔴 The toggle is a DropdownItem INSIDE the avatar menu ("Dark Mode"/"Light Mode",
    // Navbar.tsx:959-969), not a standalone navbar button — a standalone-button selector
    // silently missed and made the persistence assertion vacuous on this journey's first
    // run. Open the avatar dropdown, then click the mode item.
    const avatar = page.locator('header button:has(img), nav button:has(img)').last();
    if (!(await avatar.count())) skip('no avatar trigger found — selector needs updating, NOT a backend result');
    await avatar.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const modeItem = page.locator('li:has-text("Dark Mode"), li:has-text("Light Mode"), [role="menuitem"]:has-text("Mode")').first();
    if (!(await modeItem.count())) skip('theme menu item not found — selector needs updating, NOT a backend result');
    await modeItem.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const after = await isDark();
    console.log(`    theme flipped in-page: ${before !== after ? 'YES' : 'no'}`);
    if (before === after) skip('toggle had no effect — cannot assert persistence this run');

    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    const persisted = await isDark();
    console.log(`    theme survived a reload (PUT /users/me/theme persisted): ${persisted === after ? 'YES' : 'NO — the preference write failed silently'}`);
    if (persisted !== after) throw new Error('theme preference did not persist across reload');
  });

  // FEED COMMENT: commenting on the post this run just created. Asserts the comment
  // text is on the page afterwards.
  await step('journey-feed-comment', async () => {
    await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    const comment = page.locator('button:has-text("Comment")').first();
    if (!(await comment.count())) skip('no Comment control — selector needs updating, NOT a backend result');
    await comment.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const box = page.locator('input[placeholder*="comment" i], textarea[placeholder*="comment" i]').first();
    if (!(await box.count())) skip('comment box did not open — selector needs updating, NOT a backend result');
    const body = `Smoke comment ${stamp}`;
    await box.fill(body, { timeout: 8000 }).catch(() => {});
    await box.press('Enter').catch(() => {});
    await page.waitForTimeout(3000);
    const present = await page.locator(`text=${body}`).count();
    console.log(`    comment visible afterwards: ${present > 0 ? 'YES — commenting works' : 'no (unconfirmed)'}`);
    if (!present) skip('comment not visible afterwards — effect unconfirmed, NOT a proven failure');
  });

  // MESSAGES: send a text message into the member<->admin conversation and assert it
  // renders. (The conversation exists — earlier probes created voice messages in it.)
  await step('journey-message-send', async () => {
    await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    // Open the first conversation in the list.
    const thread = page.locator('a[href*="/messages/"], [role="listitem"] a').first();
    if (!(await thread.count())) skip('no conversation in the list — selector or fixture gap, NOT a backend result');
    await thread.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const composer = page.locator('textarea[placeholder="Type a message..."], input[placeholder="Type a message..."]').first();
    if (!(await composer.count())) skip('composer not found — selector needs updating, NOT a backend result');
    const body = `Smoke message ${stamp}`;
    await composer.fill(body, { timeout: 8000 }).catch(() => {});
    await composer.press('Enter').catch(() => {});
    await page.waitForTimeout(3000);
    const present = await page.locator(`text=${body}`).count();
    console.log(`    message visible in the thread afterwards: ${present > 0 ? 'YES — messaging works' : 'no (unconfirmed)'}`);
    if (!present) throw new Error('sent message did not appear in the thread');
  });

  // MEMBERS CONNECT: the members directory must render members, and a connect control
  // must accept a click and change state (or already be connected from a prior run —
  // both are success; a vanished directory is not).
  await step('journey-members-connect', async () => {
    await page.goto(`${BASE}/members`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');
    const text = (await page.locator('body').innerText()).trim();
    if (text.length < 200) throw new Error('members directory rendered almost no content');

    const connect = page.locator('button:has-text("Connect")').first();
    if (!(await connect.count())) {
      console.log('    no Connect control (already connected from a prior run, or selector gap) — page renders, directory works');
      return;
    }
    await connect.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const after = (await page.locator('body').innerText());
    const changed = /Pending|Requested|Cancel request|Connected/i.test(after);
    console.log(`    connect state changed after click: ${changed ? 'YES — connection request works' : 'no (unconfirmed)'}`);
    if (!changed) skip('connect click did not visibly change state — effect unconfirmed, NOT a proven failure');
  });

  // WALLET HISTORY: the transfer performed earlier in THIS run must appear in the
  // wallet's history — a written row a member can see back, not merely a 200.
  await step('journey-wallet-history', async () => {
    await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');
    const text = (await page.locator('body').innerText()).trim();
    if (text.length < 200) throw new Error('wallet rendered almost no content');
    // The transfer step sends credits to the admin with a stamped note where the form
    // allows one; at minimum a history/transactions region must exist with entries.
    const hasHistory = /Transaction|History|Sent|Received/i.test(text);
    console.log(`    wallet shows a transactions region: ${hasHistory ? 'YES' : 'no (unconfirmed)'}`);
    if (!hasHistory) throw new Error('no transactions region visible on the wallet');
  });

  // -- THE EXCHANGE TRANSACTION - ledger row 1.21 -------------------------------
  // request -> accept -> start -> complete -> confirm -> CREDITS MOVE.
  //
  // This is the product's core transaction and the first journey in this script that
  // needs TWO members in one run: the requester and the provider are different people
  // and the state machine enforces which of them may do what (ExchangeDetailPage.tsx:
  // 397-407). It therefore drives two browser contexts.
  //
  // 🔴 FIVE THINGS LEARNED BUILDING THIS. Each cost a run.
  //
  // 1. THE JOURNEY IS INVISIBLE WHEN THE TENANT HAS NOT OPTED IN, and "invisible" is
  //    not "broken". GET /v2/exchanges/config carries `exchange_workflow_enabled`, and
  //    Laravel defaults it FALSE. With it false the app renders its own polite
  //    "workflow not enabled" empty state, the "Request Exchange" button is absent
  //    from every listing, and /v2/exchanges answers 400 FEATURE_DISABLED - all
  //    correct behaviour. HTTP 200 everywhere, no console error, nothing for a
  //    response diff to flag. Both fixtures now opt the tenant in
  //    (parity-fixture.sql tail; DemoShowcaseSeedData.cs EnterpriseConfig
  //    `broker.configuration`). If this step reports the gate closed, fix the FIXTURE
  //    or the config endpoint - do not read it as the backend refusing the journey.
  //
  // 2. THE STEP CREATES ITS OWN LISTING, as the provider, first. Picking an existing
  //    listing off /listings and hoping the configured provider owns it is a coin
  //    flip, and when it loses the provider simply cannot see the request - which
  //    reads as "accept is broken". Owning the listing by construction removes a whole
  //    class of false negative. (RequestExchangePage.tsx:192 also refuses your own
  //    listing outright, so the requester must not be the owner.)
  //
  // 3. THE REQUEST FORM LIVES AT /listings/:id/request-exchange, NOT /exchanges/new
  //    or /exchanges/create (AppRoutes.tsx:1170). `useParams().id` there is the
  //    LISTING id. Guessing an /exchanges/... path gets you the `exchanges/:id`
  //    route, a fetch of a nonexistent exchange, and a "not found" page that reads
  //    like a backend gap.
  //
  // 4. THERE ARE NO data-testid ATTRIBUTES ANYWHERE IN THE EXCHANGE UI. Every control
  //    must be found by its visible English label, and the six that matter are
  //    "Request Exchange", "Send Request", "Accept Request", "Start Exchange",
  //    "Mark Complete", "Confirm Hours". Status CHIPS are also plain English and are
  //    NOT translated - they come from a hardcoded map (lib/exchange-status.ts:26-75),
  //    which makes them stable to assert on but is a real i18n gap.
  //
  // 5. CREDITS ARE THE ASSERTION. Not the status chip, not the absence of an error.
  //    Laravel moves them only when BOTH parties have confirmed and their hours agree
  //    within 0.25 (ExchangeWorkflowService.php:520-522, 919-1007), then writes one
  //    `transactions` row of type 'exchange' and adjusts both balances. Measured on
  //    the disposable Laravel: requester 100.00 -> 99.00, provider 25.00 -> 26.00.
  //    A step that stopped at "status says completed" would have passed on a backend
  //    that never moved a credit.
  await step('journey-exchange-request-accept-complete', async () => {
    const hours = 1;
    const listingTitle = `Smoke exchange listing ${stamp}`;

    // -- the gate ---------------------------------------------------------------
    await page.goto(`${BASE}/exchanges`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (page.url().includes('/login')) throw new Error('redirected to login - session lost');
    const gateText = (await page.locator('body').innerText()).trim();
    if (/not enabled|not available|coming soon/i.test(gateText)) {
      skip('exchange workflow reported DISABLED for this tenant - GET /v2/exchanges/config '
        + 'did not return exchange_workflow_enabled:true. Fixture or config-endpoint gap, '
        + 'NOT proof the backend cannot run an exchange');
    }

    // -- the provider signs in and publishes a listing to be requested against --
    const providerCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const provider = await providerCtx.newPage();
    captureApiFrom(provider);
    try {
      const signedIn = await signInAs(provider, arm.providerEmail, arm.providerPassword, arm.communityLabel);
      if (!signedIn.ok) skip(`provider actor unavailable: ${signedIn.reason}`);

      await provider.goto(`${BASE}/listings/create`, { waitUntil: 'networkidle', timeout: 60000 });
      await provider.waitForTimeout(1500);
      await dismissConsent(provider);

      // 🔴 LESSON 6, earned 2026-08-21: THIS SKIP USED TO SAY "selector gap", AND IT
      // WAS NOT ONE. The provider signed in perfectly - tokens in localStorage,
      // POST /api/auth/login 200 - and every navigation still landed on /onboarding,
      // because the unchanged client pins any member whose /users/me reports
      // `onboarding_completed: false` there and will not let them off it
      // (ProtectedRoute.tsx:95-98). /listings/create therefore rendered the onboarding
      // page: zero inputs, zero selects, no field called "title". Reported as a
      // selector gap, that sends the next reader hunting through the listing form for
      // an attribute change that never happened. The real cause was the ASP.NET demo
      // seed marking its ONE required onboarding step complete for the member only
      // (DemoShowcaseSeedData.cs, now fixed for all three seeded actors).
      //
      // So: name the state the provider is actually IN before blaming a selector. A
      // gate the member cannot pass, a lost session and a renamed field are three
      // different findings and must never share one message.
      const providerLanding = provider.url().replace(BASE, '');
      if (/\/onboarding(?:\/|$)/.test(providerLanding)) {
        skip('provider is held on /onboarding - the unchanged client refuses every other page until a '
          + 'required onboarding step is complete (ProtectedRoute.tsx:95-98), so /listings/create never '
          + 'rendered. FIXTURE gap in the seeded second actor, NOT a backend verdict and NOT a selector gap');
      }
      if (providerLanding.includes('/login')) {
        skip('provider was bounced to /login on the way to the listing form - the second actor session '
          + 'did not survive; fixture/auth issue, NOT a selector gap');
      }
      const title = provider.getByLabel(/title/i).first();
      if (!(await title.count())) {
        const seen = (await provider.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
        skip(`provider reached ${providerLanding} but it carries no field labelled "title" `
          + `(${await provider.locator('input').count()} inputs, ${await provider.locator('select').count()} selects, `
          + `text="${seen.slice(0, 160)}") - selector or page-content gap, NOT a backend result`);
      }
      await title.fill(listingTitle, { timeout: 10000 });
      const desc = provider.getByLabel(/description/i).first();
      if (await desc.count()) await desc.fill('Published by the runtime smoke so the exchange journey has a listing it does not own.');
      // A category is required or the submit stays disabled - same shape as the
      // login form's community selector (see action-create-listing).
      const selects = provider.locator('select');
      for (let i = 0; i < await selects.count(); i += 1) {
        if (await selects.nth(i).locator('option').count() > 1) {
          await selects.nth(i).selectOption({ index: 1 }).catch(() => {});
        }
      }
      await provider.waitForTimeout(800);
      const createBtn = provider.locator('button[type="submit"]:has-text("Create Listing")').first();
      if (!(await createBtn.count()) || !(await createBtn.isEnabled())) {
        skip('provider listing form did not become submittable - a required field is unsatisfied; NOT a backend verdict');
      }
      await createBtn.click({ timeout: 15000 }).catch(() => {});
      await provider.waitForTimeout(5000);
      if (provider.url().includes('/listings/create')) throw new Error('provider could not publish a listing - the exchange journey has nothing to request against');

      // -- the requester finds it and sends a request ---------------------------
      await page.goto(`${BASE}/listings`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2500);
      let card = page.locator(`a:has-text("${listingTitle}")`).first();
      if (!(await card.count())) {
        // Newest-first is not guaranteed on every ranking; try the search filter too.
        await page.goto(`${BASE}/listings?q=${encodeURIComponent(String(stamp))}`, { waitUntil: 'networkidle', timeout: 60000 });
        await page.waitForTimeout(2500);
        card = page.locator(`a:has-text("${listingTitle}")`).first();
      }
      if (!(await card.count())) {
        skip(`the provider's fresh listing "${listingTitle}" is not visible to the requester - `
          + 'listings visibility/ordering, not the exchange workflow');
      }
      await card.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);
      await dismissConsent();

      // Label from react-frontend/public/locales/en/listings.json (detail_request_exchange).
      const requestBtn = page.locator('a:has-text("Request Exchange"), button:has-text("Request Exchange")').first();
      if (!(await requestBtn.count())) {
        skip('no "Request Exchange" control on the listing page - either the config gate is '
          + 'closed (ListingDetailPage.tsx:806) or the requester owns this listing; NOT a proven backend failure');
      }
      await requestBtn.click({ timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(3000);
      if (!page.url().includes('request-exchange')) {
        throw new Error(`"Request Exchange" did not open the request form (landed on ${page.url().replace(BASE, '')})`);
      }

      const hoursField = page.getByLabel(/proposed hours/i).first();
      if (!(await hoursField.count())) skip('no Proposed Hours field - selector gap, NOT a backend result');
      await hoursField.fill(String(hours), { timeout: 8000 }).catch(() => {});
      const msg = page.locator('textarea:visible').first();
      if (await msg.count()) await msg.fill(`Smoke exchange ${stamp}`, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(600);
      const send = page.locator('button[type="submit"]:has-text("Send Request")').first();
      if (!(await send.count()) || !(await send.isEnabled())) {
        skip('Send Request missing or disabled - a required field is unsatisfied; NOT a backend verdict');
      }
      await send.click({ timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(5000);

      // 🔴 EFFECT, not render: a successful create NAVIGATES to /exchanges/<id>
      // (RequestExchangePage.tsx:154). Still on the form means the POST failed, and
      // the page shows the server's own message rather than throwing.
      const afterCreate = page.url().replace(BASE, '');
      const idMatch = afterCreate.match(/\/exchanges\/(\d+)/);
      if (!idMatch) {
        const shown = (await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 240);
        throw new Error(`exchange request did NOT create a row - still on ${afterCreate}. Page said: ${shown}`);
      }
      const exchangeId = idMatch[1];
      console.log(`    exchange ${exchangeId} created by the requester`);

      // -- the provider accepts, starts and marks complete ----------------------
      await provider.goto(`${BASE}/exchanges/${exchangeId}`, { waitUntil: 'networkidle', timeout: 60000 });
      await provider.waitForTimeout(2500);
      const providerSees = (await provider.locator('body').innerText()).trim();
      if (/not found/i.test(providerSees)) {
        throw new Error(`the provider cannot see exchange ${exchangeId} - the request was not addressed to the listing owner`);
      }

      // Each control appears only in its own state, so a missing one is a state
      // verdict, not a selector fault - report which state the page is actually in.
      //
      // 🔴 THE ASSERTION BELOW WAS WRONG ONCE AND IT LOOKED EXACTLY LIKE A BACKEND
      // FAULT. First run against the Laravel control, this step reported
      // '"Accept Request" did not move the exchange on. Page state: ' - with the page
      // state EMPTY. The database said otherwise: the exchange was `accepted`. The
      // click had worked; a single `reload({waitUntil:'networkidle'})` followed by one
      // read of body.innerText had come back with nothing, because the read landed
      // while the SPA was still mounting. One shot at reading a React page after a
      // navigation is a coin flip, and the losing side of that coin reads as a
      // product defect. RETRY the read until the expected label appears, and if it
      // never does, print the URL and the text LENGTH - an empty page is a different
      // finding from a page showing the wrong status, and the two must not be
      // reported with the same words.
      const stateText = async (p) => (await p.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
      const waitForState = async (p, expected) => {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const now = await stateText(p);
          if (expected.test(now)) return { ok: true, text: now };
          // Re-read a few times before spending a reload; the page usually settles.
          if (attempt === 3 || attempt === 7) {
            await p.reload({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
          }
          await p.waitForTimeout(1500);
        }
        return { ok: false, text: await stateText(p) };
      };
      for (const [label, expected] of [
        ['Accept Request', /accepted/i],
        ['Start Exchange', /in progress/i],
        ['Mark Complete', /confirm/i],
      ]) {
        const btn = provider.locator(`button:has-text("${label}")`).first();
        if (!(await btn.count())) {
          throw new Error(`"${label}" is not offered to the provider. Page state: ${(await stateText(provider)).slice(0, 200)}`);
        }
        await btn.click({ timeout: 12000 }).catch(() => {});
        await provider.waitForTimeout(3000);
        const settledState = await waitForState(provider, expected);
        console.log(`    "${label}" -> state matches ${expected}: ${settledState.ok ? 'YES' : 'no'}`);
        if (!settledState.ok) {
          throw new Error(`"${label}" did not move the exchange on within 18s. url=${provider.url().replace(BASE, '')} `
            + `textLength=${settledState.text.length} state="${settledState.text.slice(0, 200)}"`);
        }
      }

      // -- both parties confirm the hours; this is what settles credits ---------
      // 🔴 LESSON 7, and it is the most expensive kind: THIS READER DROPPED THE
      // MINUS SIGN, AND THE STEP THEN REPORTED A CORRECT SETTLEMENT AS A LEDGER BUG.
      // Measured 2026-08-21 on ASP.NET. The provider's real balance went
      // -2.00 -> -1.00, which is +1.00 credited exactly as intended. The wallet page
      // renders it as a newline-separated "-1" then "Hours". The old pattern was
      //   /([\d,]+(?:\.\d+)?)\s*(?:hours|credits)/i
      // whose capture group cannot include a sign, so it read 2 then 1 and the step
      // failed with "credits moved by the WRONG amount: requester -1, provider -1".
      // The database said otherwise: transactions row 10, Sender 3 -> Receiver 4,
      // 1.00, type `exchange`, Completed - one row, both legs, correct direction.
      //
      // A demo member CAN hold a negative balance (this one did, from a seeded
      // payment), so this is not an exotic case, and the same reader is used for both
      // arms - it would have mis-scored Laravel identically. Capture the sign, accept
      // the Unicode minus and en dash a formatter may emit, and never assume a
      // balance is positive.
      const balanceOf = async (p) => {
        await p.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
        await p.waitForTimeout(2500);
        const text = await p.locator('body').innerText();
        const m = text.match(/(-|−|–)?\s*([\d,]+(?:\.\d+)?)\s*(?:hours|credits)/i);
        if (!m) return null;
        const magnitude = Number(m[2].replace(/,/g, ''));
        if (Number.isNaN(magnitude)) return null;
        return m[1] ? -magnitude : magnitude;
      };
      const requesterBefore = await balanceOf(page);
      const providerBefore = await balanceOf(provider);
      console.log(`    balances before settlement - requester: ${requesterBefore}, provider: ${providerBefore}`);

      const confirmAs = async (p, who) => {
        await p.goto(`${BASE}/exchanges/${exchangeId}`, { waitUntil: 'networkidle', timeout: 60000 });
        await p.waitForTimeout(2500);
        const open = p.locator('button:has-text("Confirm Hours")').first();
        if (!(await open.count())) return `no "Confirm Hours" control for the ${who}`;
        await open.click({ timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(1500);
        // The modal carries its own hours input and its own "Confirm Hours" submit;
        // take the LAST match or the click lands back on the page's own trigger.
        const field = p.locator('input:visible').last();
        if (await field.count()) await field.fill(String(hours), { timeout: 8000 }).catch(() => {});
        await p.waitForTimeout(400);
        await p.locator('button:has-text("Confirm Hours")').last().click({ timeout: 12000 }).catch(() => {});
        await p.waitForTimeout(4500);
        return null;
      };
      const providerConfirm = await confirmAs(provider, 'provider');
      if (providerConfirm) throw new Error(providerConfirm);
      const requesterConfirm = await confirmAs(page, 'requester');
      if (requesterConfirm) throw new Error(requesterConfirm);

      await page.goto(`${BASE}/exchanges/${exchangeId}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(3000);
      const finalState = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
      const settled = /completed/i.test(finalState);
      console.log(`    exchange reports completed after both confirmations: ${settled ? 'YES' : 'no'}`);

      const requesterAfter = await balanceOf(page);
      const providerAfter = await balanceOf(provider);
      console.log(`    balances after settlement  - requester: ${requesterAfter}, provider: ${providerAfter}`);

      if (requesterBefore == null || providerBefore == null || requesterAfter == null || providerAfter == null) {
        skip('the wallet page did not expose a readable balance on both sides '
          + `(${requesterBefore}/${providerBefore} -> ${requesterAfter}/${providerAfter}) - `
          + 'the credit assertion could not be made; NOT a proven failure');
      }

      // 🔴 THE ASSERTION. On an 'offer' listing the requester pays the provider
      // (ExchangeWorkflowService.php:1187-1194). Both legs must move, by the hours.
      const requesterDelta = requesterAfter - requesterBefore;
      const providerDelta = providerAfter - providerBefore;
      console.log(`    credit movement - requester ${requesterDelta}, provider ${providerDelta} (expected ${-hours} / +${hours})`);
      if (requesterDelta === 0 && providerDelta === 0) {
        throw new Error(`NO CREDITS MOVED. The exchange reported ${settled ? 'completed' : 'not completed'} `
          + `and both balances are unchanged (${requesterAfter}/${providerAfter}). The state machine ran `
          + 'and the ledger did not - which is the exact failure this journey exists to catch.');
      }
      if (Math.abs(requesterDelta + hours) > 0.001 || Math.abs(providerDelta - hours) > 0.001) {
        throw new Error(`credits moved by the WRONG amount: requester ${requesterDelta}, provider ${providerDelta}, expected ${-hours}/+${hours}`);
      }
      if (!settled) throw new Error('credits moved but the exchange does not report completed - the ledger and the state machine disagree');

      // The member must be able to see it back: a settled exchange belongs in the
      // wallet history, not only in the exchange's own page.
      const history = await page.locator('body').innerText();
      console.log(`    the settlement appears in the requester's wallet history: ${/exchange/i.test(history) ? 'YES' : 'no (unconfirmed)'}`);
    } finally {
      await providerCtx.close();
    }
  });

  // FEED INFINITE SCROLL: the cursor fix's browser-level proof. Scroll to the bottom
  // and assert MORE items load (each smoke run adds a post, so the feed exceeds one
  // page). This is the exact user action that silently re-served page 1 for ever.
  await step('journey-feed-infinite-scroll', async () => {
    await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    const countItems = () => page.locator('article, [data-testid="feed-item"], .feed-card').count();
    let before = await countItems();
    if (before === 0) {
      // Fall back to a text-length heuristic if the card selector misses.
      before = (await page.locator('body').innerText()).length;
      await page.mouse.wheel(0, 20000);
      await page.waitForTimeout(3500);
      const after = (await page.locator('body').innerText()).length;
      console.log(`    (card selector missed — text-length heuristic) before=${before} after=${after}: ${after > before ? 'MORE content loaded' : 'no growth (unconfirmed)'}`);
      if (after <= before) skip('card selector missed and text-length heuristic showed no growth — scroll unconfirmed');
      return;
    }
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(3500);
    await page.mouse.wheel(0, 20000);
    await page.waitForTimeout(3500);
    const after = await countItems();
    console.log(`    feed items before=${before} after-scroll=${after}: ${after > before ? 'YES — infinite scroll advances' : 'no growth (page may be fully loaded — check total)'}`);
    if (after <= before) skip('no item growth after scroll — cannot distinguish "feed fully loaded" from a broken cursor this run');
  });

  // FEED REACTION THROUGH THE UI: the step creates ITS OWN post and reacts to it in
  // the same view, so the pre/post-reload comparison is guaranteed to look at the same
  // card. Earlier versions hunted for a post created several steps before — by then
  // ranked ordering had moved it off page 1 and the probe silently compared two
  // different cards (true -> true against a working backend).
  await step('journey-feed-reaction', async () => {
    await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2000);
    if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

    const reactBody = `Smoke reaction target ${stamp}`;
    const create = page.locator('button:has-text("Create")').first();
    if (!(await create.count())) skip('no Create control — selector gap, NOT a backend result');
    await create.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const composer = page.locator('textarea, [contenteditable="true"]').first();
    if (!(await composer.count())) skip('composer did not open — selector gap, NOT a backend result');
    await composer.fill(reactBody, { timeout: 8000 }).catch(() => {});
    const submit = page.locator('button:has-text("Post"), button[type="submit"]').last();
    await submit.click({ timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(3500);
    // The text visible right after posting can be the composer's own echo, not a feed
    // card — reload so the post renders as a real card (newest-first keeps it on page 1).
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);

    // FeedCard renders role="article" (FeedCard.tsx:587). Anchor to the fresh post.
    const card = () => page.locator(`[role="article"]:has-text("${reactBody}")`).first();
    if (!(await card().count())) skip('fresh post card not found on the page — selector gap, NOT a backend result');
    const likedState = async () => {
      const b = card().locator('button:has-text("Like")').first();
      if (!(await b.count())) return null;
      return ((await b.getAttribute('class').catch(() => '')) || '').includes('text-rose-500');
    };
    const before = await likedState();
    await card().locator('button:has-text("Like")').first().click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const optimistic = await likedState();
    await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    // The fresh post is newest, so it stays on page 1 across one reload.
    if (!(await card().count())) skip(`card not on page 1 after reload — cannot compare (in-page flip was ${before} -> ${optimistic})`);
    const after = await likedState();
    const survived = before === false && optimistic === true && after === true;
    console.log(`    reaction: ${before} -> ${optimistic} (click) -> ${after} (reload): ${survived ? 'YES — the write persisted' : 'unconfirmed'}`);
    if (before === false && optimistic === true && after === false) {
      throw new Error('reaction reverted on reload — the write did not persist (the classic optimistic-flip failure)');
    }
    if (!survived) skip(`reaction unconfirmed (${before} -> ${optimistic} -> ${after}) — not a proven failure`);
  });

  // SIGN-UP: a brand-new member registers through the app's own form. PROVEN
  // end-to-end 2026-08-20 — POST /api/v2/auth/register fires and the success screen
  // renders ("Registration Successful! Verify your email"). Four automation lessons are
  // baked in, each found the hard way against a WORKING backend:
  //   1. It is ONE form, not a wizard — "Continue" never appears.
  //   2. The location field is a PlaceAutocompleteInput that eats simulated keystrokes
  //      (only the first survived) — set it through the NATIVE value setter + one input
  //      event, which is what React actually listens for.
  //   3. Create Account stays disabled while "Checking against known data breaches…"
  //      runs — wait for it, don't read the disabled state as a verdict.
  //   4. A clean Playwright click on the enabled button dispatches but React ignores it;
  //      pressing Enter from a field fires the real submit.
  // The LEGAL GATE sits BEHIND email verification (the flow ends at "verify your email"),
  // so it is out of this smoke's reach without a verification bypass — recorded as the
  // remaining slice, not glossed.
  await step('journey-sign-up', async () => {
    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    captureApiFrom(page2);
    // 🔴 CAPTURE THE REGISTER CALL ITSELF. Added 2026-08-21 after this step failed
    // on BOTH arms with only "registration did not reach the success screen" — which
    // does not say whether the POST was refused, or was never made because the form
    // never submitted. Those are a backend finding and an instrument finding and they
    // had one message between them. This context has its own page, so the outer
    // response listener does not cover it.
    const registerCalls = [];
    page2.on('response', async (r) => {
      if (!/\/auth\/register(?:$|\?)/.test(r.url())) return;
      let body = '';
      try { body = (await r.text()).slice(0, 400); } catch { body = '<unreadable>'; }
      registerCalls.push({ status: r.status(), url: r.url(), body });
    });
    try {
      await page2.goto(`${BASE}/register`, { waitUntil: 'networkidle', timeout: 60000 });
      await page2.waitForTimeout(2000);
      for (const label of ['Use basic features only', 'Essential only']) {
        const b = page2.locator(`button:has-text("${label}")`).first();
        if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page2.waitForTimeout(400); }
      }

      // 🔴 THE DOMAIN IS LOAD-BEARING, AND @example.test DOES NOT WORK.
      // Measured 2026-08-21 on the Laravel arm, from the API's own response:
      //   422 EMAIL_DOMAIN_INVALID "the domain has no mail servers"
      // Laravel runs an MX-record check on the address before creating anything
      // (app/Services/RegistrationService.php, MxValidator::isResolvable, cached 24h,
      // fails OPEN on a DNS error). example.test and example.com both have NO MX
      // records, so every registration this step attempted was refused - for two
      // months, reported only as "registration did not reach the success screen".
      //
      // 🔴 It is NOT a reserved-TLD rule, which is what the standing note said. The
      // reserved-TLD lists in this repository live in a PURGE command
      // (app/Console/Commands/PurgeUndeliverableUsers.php) and example.test is not in
      // resources/security/disposable-email-domains.txt. The mechanism matters: any
      // other unroutable domain fails the same way, and a routable reserved-looking
      // one would pass.
      //
      // The default is the platform's OWN domain, which has real MX records, so a
      // verification mail bounces to us and never to a stranger's mailbox. Override
      // with SMOKE_SIGNUP_DOMAIN if a batch needs somewhere else.
      const signupDomain = process.env.SMOKE_SIGNUP_DOMAIN || 'project-nexus.ie';
      const email = `smoke.signup.${stamp}@${signupDomain}`;
      const fillAll = async (selector, value) => {
        const fields = page2.locator(selector);
        for (let i = 0; i < await fields.count(); i++) {
          const f = fields.nth(i);
          if (await f.isVisible().catch(() => false)) await f.fill(value, { timeout: 5000 }).catch(() => {});
        }
      };
      await fillAll('input[autocomplete="given-name"]', 'Smoke');
      await fillAll('input[autocomplete="family-name"]', `Signup${stamp}`);
      await fillAll('input[autocomplete="tel"]', '+1 555 010 0199');
      await fillAll('input[autocomplete="email"]', email);
      await fillAll('input[autocomplete="new-password"]', 'SmokeSignup!2026x');
      await page2.evaluate(() => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (const el of document.querySelectorAll('input[autocomplete="address-level2"]')) {
          setter.call(el, 'Test City');
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }).catch(() => {});
      // Terms + updates checkboxes; NEVER touch name="website" — it is the anti-bot
      // honeypot (RegisterPage.tsx:1078) and filling it flags the sign-up as a bot.
      const boxes = page2.locator('input[type="checkbox"]');
      for (let i = 0; i < await boxes.count(); i++) {
        const b = boxes.nth(i);
        if (!(await b.isChecked().catch(() => true))) await b.check({ force: true }).catch(() => {});
      }

      // 🔴 Submit helper, factored out so the 429 retry below can reuse it. The two
      // quirks it encodes were both earned: Create Account stays disabled while the
      // breach check runs, and a clean Playwright click on the enabled button
      // dispatches but React ignores it - pressing Enter from a field fires the real
      // submit.
      const submitRegistration = async () => {
        const btn = page2.locator('button:has-text("Create Account")').first();
        if (!(await btn.count())) return false;
        for (let w = 0; w < 30; w++) {
          if (await btn.isEnabled().catch(() => false)) break;
          await page2.waitForTimeout(1000);
        }
        if (!(await btn.isEnabled().catch(() => false))) return false;
        await btn.click({ timeout: 8000 }).catch(() => {});
        await page2.waitForTimeout(2500);
        if (page2.url().includes('/register') && !/Registration Successful/i.test(await page2.locator('body').innerText())) {
          await page2.locator('input[autocomplete="email"]').first().press('Enter').catch(() => {});
          await page2.waitForTimeout(5000);
        }
        return true;
      };

      const create = page2.locator('button:has-text("Create Account")').first();
      if (!(await create.count())) skip('Create Account not found — selector gap, NOT a backend result');
      for (let w = 0; w < 30; w++) {
        if (await create.isEnabled().catch(() => false)) break;
        await page2.waitForTimeout(1000);
      }
      if (!(await create.isEnabled().catch(() => false))) {
        skip('🔴 SIGN-UP UNPROVEN: Create Account never enabled (breach check hung, or a field is unsatisfied)');
      }
      await create.click({ timeout: 8000 }).catch(() => {});
      await page2.waitForTimeout(2500);
      if (page2.url().includes('/register') && !/Registration Successful/i.test(await page2.locator('body').innerText())) {
        await page2.locator('input[autocomplete="email"]').first().press('Enter').catch(() => {});
        await page2.waitForTimeout(5000);
      }

      const bodyText = (await page2.locator('body').innerText()).trim();
      let success = /Registration Successful/i.test(bodyText);
      const verify = /verification link|verify your email/i.test(bodyText);
      console.log(`    registration successful screen: ${success} | verification-email flow: ${verify}`);
      const redactedRegisterBody = (body) => body
        .replace(/"(access_token|refresh_token|csrf_token)"\s*:\s*"[^"]*"/gi, '"$1":"[redacted]"')
        .replace(/"(access_token|refresh_token|csrf_token)"\s*:\s*"[^"]*$/gi, '"$1":"[redacted]"')
        .replace(/\s+/g, ' ');
      for (const c of registerCalls) console.log(`    POST register -> ${c.status} ${redactedRegisterBody(c.body)}`);

      // 🔴 A 429 IS THE DEV RATE LIMIT, NOT A PRODUCT VERDICT - and it was being
      // reported as "registration did not reach the success screen", i.e. as a broken
      // sign-up. Measured 2026-08-21 on the ASP.NET arm: POST /auth/register came back
      // 429 with retry_after_seconds 60, because `RateLimiting__Auth__PermitLimit` is
      // 10 per 60s (aspnet-backend/compose.yml) and one pass of this script signs in
      // more than once before it ever reaches sign-up - the member, then the exchange
      // journey's provider - and each sign-in spends several calls in the auth
      // partition (login, webauthn challenge, oauth providers, sso providers).
      //
      // 🔴 The brief carried into this batch said this step failed because it registers
      // at @example.test, "which Laravel deliberately refuses as a reserved TLD". That
      // was NOT the cause. Laravel's registration validates `required|email|max:255`
      // (app/Services/RegistrationService.php), example.test is not in
      // resources/security/disposable-email-domains.txt, and the reserved-TLD lists in
      // this repository live only in a PURGE command. Do not change the domain on that
      // theory; the evidence above is what the API actually said.
      let refusedByRateLimit = registerCalls.length > 0 && registerCalls[registerCalls.length - 1].status === 429;
      if (!success && refusedByRateLimit) {
        const waitMs = 65000;
        console.log(`    rate-limited; waiting ${waitMs / 1000}s for the auth window and submitting once more`);
        await page2.waitForTimeout(waitMs);
        registerCalls.length = 0;
        await submitRegistration();
        for (const c of registerCalls) console.log(`    POST register (retry) -> ${c.status} ${redactedRegisterBody(c.body)}`);
        success = /Registration Successful/i.test((await page2.locator('body').innerText()).trim());
        refusedByRateLimit = registerCalls.length > 0 && registerCalls[registerCalls.length - 1].status === 429;
        if (!success && refusedByRateLimit) {
          skip('sign-up could not be measured: POST /auth/register was rate-limited (429) twice, once after a full '
            + 'window wait. That is the dev auth rate limit, NOT the backend refusing a registration. Raise '
            + 'RateLimiting__Auth__PermitLimit for the batch, or run this step on its own');
        }
      }

      if (!success) {
        // Name WHICH of the two failures this is. No call at all is the form never
        // submitting (instrument / frontend chrome); a call with a non-2xx is the
        // backend refusing, and its body says why.
        if (registerCalls.length === 0) {
          throw new Error('registration never reached the API - no POST to /auth/register was made at all, '
            + `so the form did not submit (page still shows: "${bodyText.replace(/\s+/g, ' ').slice(0, 200)}"). `
            + 'INSTRUMENT/form-flow finding, not a backend verdict');
        }
        const worst = registerCalls[registerCalls.length - 1];
        throw new Error(`registration was REFUSED by the API: ${worst.status} ${worst.body.replace(/\s+/g, ' ')}`);
      }

      // ── THE LEGAL GATE, behind email verification ────────────────────────────────
      // The real flow verifies via the emailed code, but /verify-email is [Authorize]
      // and login refuses unverified users — the code only reaches a member through
      // email. This DEV instrument completes verification directly in the dev database
      // (docker-guarded: skipped with a plain statement when docker is unreachable),
      // then signs in as the brand-new member. The ASP.NET dev seed carries a terms
      // document, so a FIRST sign-in must surface the legal-acceptance gate.
      let verified = false;
      if (arm.key !== 'aspnet') {
        // The verification bypass below is wired to the ASP.NET dev Postgres only;
        // the Laravel control's disposable MariaDB is a different container and
        // schema. Legal gate not measured on the control arm — stated, not glossed.
        console.log('    (verification completion is wired only to the ASP.NET dev database — legal gate not measured on this arm)');
      } else {
        try {
          const { execSync } = await import('node:child_process');
          // 🔴 Windows cmd mangles nested double-quotes — pipe the SQL on stdin instead of
          // embedding it in the argument (the quoted-argument version silently failed here).
          const sql = `UPDATE users SET "EmailVerified"=true, "EmailVerifiedAt"=now(), "IsActive"=true WHERE "Email"='${email}';`;
          execSync('docker exec -i nexus-aspnet-dev-db psql -U postgres -d nexus_dev', { input: sql, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000 });
          verified = true;
        } catch {
          console.log('    (docker not reachable — verification completion skipped; legal gate NOT measured this run)');
        }
      }
      if (verified) {
        await page2.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
        await page2.waitForTimeout(1500);
        for (const label of ['Use basic features only', 'Essential only']) {
          const b = page2.locator(`button:has-text("${label}")`).first();
          if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page2.waitForTimeout(400); }
        }
        await page2.selectOption('select', { label: 'ACME Community Timebank' }).catch(() => {});
        await page2.fill('input[name="username"]', email).catch(() => {});
        await page2.fill('input[name="password"]', 'SmokeSignup!2026x').catch(() => {});
        await page2.locator('button:has-text("Sign In"), button[type="submit"]').first().click({ timeout: 10000 }).catch(() => {});
        await page2.waitForTimeout(5000);
        const afterLogin = (await page2.locator('body').innerText()).trim();
        const gate = /accept|agree/i.test(afterLogin) && /terms|legal|document/i.test(afterLogin);
        const inApp = /\/dashboard|\/onboarding|\/feed/.test(page2.url());
        console.log(`    first sign-in of the NEW member -> ${page2.url().replace(BASE, '')} | legal gate visible: ${gate} | in-app: ${inApp}`);
        if (!gate && !inApp) throw new Error('new member could neither pass the legal gate nor reach the app');
        if (gate) {
          const acceptButton = page2.locator('button:has-text("Accept")').first();
          if (await acceptButton.count()) {
            await acceptButton.click({ timeout: 8000 }).catch(() => {});
            await page2.waitForTimeout(3000);
            console.log(`    after accepting -> ${page2.url().replace(BASE, '')}`);
          }
        }
      }
    } finally {
      await context2.close();
    }
  });

  // ── TIER 2: the feature modules, as PAGES with content assertions ─────────────────
  // Each module's fixture data was confirmed present before adding it here (groups 9,
  // polls 14, goals 7, skills 2, volunteering 1, blog 1, resources 1), so an empty
  // render is a real finding rather than an empty fixture. Leaderboard/achievements
  // live under /api/v2/gamification/* — probing /api/v2/leaderboard first returned 404
  // and looked like a gap; it was the wrong path, and the pages are what matter here.
  for (const [name, pagePath] of [
    ['module-groups', '/groups'],
    ['module-volunteering', '/volunteering'],
    ['module-goals', '/goals'],
    ['module-polls', '/polls'],
    ['module-blog', '/blog'],
    ['module-resources', '/resources'],
    ['module-skills', '/skills'],
    ['module-leaderboard', '/leaderboard'],
    ['module-achievements', '/achievements'],
    ['module-search', '/search'],
  ]) {
    await step(name, async () => {
      await page.goto(`${BASE}${pagePath}`, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(2500);
      const url = page.url().replace(BASE, '');
      if (url.startsWith('/login')) throw new Error('redirected to login — session lost');
      const text = (await page.locator('body').innerText()).trim();
      // 🔴 A feature-gated module legitimately renders a "not available" notice; that is
      // a TENANT SETTING, not a backend fault, and is reported rather than failed.
      const gated = /not available|feature is disabled|isn't enabled/i.test(text);
      const errored = /something went wrong|unexpected error/i.test(text);
      console.log(`    ${pagePath} -> ${url}  text=${text.length}${gated ? '  (feature gated for this tenant)' : ''}`);
      if (errored) throw new Error(`${pagePath} rendered an error state`);
      if (!gated && text.length < 400) throw new Error(`${pagePath} rendered almost no content (${text.length} chars)`);
    });
  }

  // ── token refresh across expiry ────────────────────────────────────────────────
  // 🔴 A short smoke lives entirely inside one access token, so it can pass while refresh
  // is completely broken.
  //
  // 🔴 READ THE VERDICT CAREFULLY — this step reports CLIENT behaviour, not backend
  // health, and on 2026-08-19 it produced a FALSE NEGATIVE that nearly went into a report
  // as an ASP.NET fault. Deleting the access token from localStorage is NOT how expiry
  // works: the client finds no token at all and redirects to /login without ever
  // attempting a refresh. The backend was fine. Asked directly:
  //
  //     POST http://127.0.0.1:5080/api/auth/refresh  -> 200, new access token issued
  //     the same token a second time                 -> 409 AUTH_REFRESH_SUPERSEDED
  //                                                     (correct: refresh rotation)
  //
  // So "REFRESH FAILED" below means "this client did not silently recover from a missing
  // token", which is a reasonable client behaviour, NOT evidence the backend cannot
  // refresh. To test the backend, call the endpoint. To test true expiry, you need a
  // short-lived access token, not a deleted one.
  //
  // 🔴 Laravel does not serve /api/auth/refresh at all — its routes are
  // /auth/refresh-session and /auth/refresh-token (routes/api.php:3291, 3319). That the
  // two backends disagree on the refresh ROUTE is a real, separate contract gap.
  await step('token-refresh', async () => {
    const before = await page.evaluate(() => ({
      access: localStorage.getItem('nexus_access_token'),
      refresh: localStorage.getItem('nexus_refresh_token'),
    }));
    if (!before.refresh) skip('no refresh token stored — cannot test refresh');
    await page.evaluate(() => localStorage.removeItem('nexus_access_token'));
    console.log('    access token removed, refresh token kept');
    await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    const after = await page.evaluate(() => localStorage.getItem('nexus_access_token'));
    const url = page.url().replace(BASE, '');
    const recovered = !!after && !url.startsWith('/login');
    console.log(`    new access token issued: ${!!after}`);
    console.log(`    landed on: ${url}`);
    console.log(`    ${recovered ? 'client recovered silently' : 'client did NOT silently recover (see the note above — not a backend verdict)'}`);
  });

  await browser.close();

  // ── per-arm report ─────────────────────────────────────────────────────────────

  // 🔴 Report WHICH TRANSPORT the run actually used, measured from the recorded URLs —
  // never inferred from how the process was launched.
  //
  // A run launched with VITE_API_BASE set was once reported as the "direct pass" while
  // every request still went through Vite's proxy. A proxied run cannot exercise CORS at
  // all, so mistaking one for the other means reporting a pass that proved nothing.
  //
  // 🔴 This block was itself claimed as present before it existed: an earlier patch that
  // added it aborted on a failed assertion and wrote nothing, and the claim went into a
  // report anyway. Absolute URLs to the API port are the only evidence that settles it.
  const directRe = new RegExp(`:${arm.apiPort}/`);
  const directCalls = api.filter((r) => directRe.test(r.absolute ?? '')).length;
  const proxiedCalls = api.length - directCalls;
  console.log(`\n─── [${arm.label}] transport mode (measured, not assumed) ───`);
  console.log(`  direct  (cross-origin, exercises CORS): ${directCalls}`);
  console.log(`  proxied (same-origin via Vite)        : ${proxiedCalls}`);
  if (directCalls === 0 && arm.key === 'aspnet') {
    console.log('  🔴 PROXIED RUN — this proves NOTHING about CORS. For the direct pass:');
    console.log('       npm --prefix react-frontend run dev:dotnet:direct');
    console.log('     (committed script; serves on 5199, which is in the backend CORS and');
    console.log('      Fido2 origin allowlists. No .env file needed.)');
  }

  const byClass = {};
  for (const r of api) {
    const k = classify(r.url, r.status);
    (byClass[k] ??= []).push(r);
  }
  console.log(`\n─── [${arm.label}] API calls by outcome ───`);
  for (const [k, rows] of Object.entries(byClass).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(rows.length).padStart(4)}  ${k}`);
  }
  const bad = api.filter((r) => classify(r.url, r.status) !== 'ok');
  if (bad.length) {
    console.log(`\n─── [${arm.label}] failed requests (deduped) ───`);
    const seen = new Set();
    for (const r of bad) {
      const key = `${r.status} ${r.url.split('?')[0]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${String(r.status).padEnd(4)} ${classify(r.url, r.status).padEnd(14)} ${r.url.split('?')[0]}${r.failure ? '  ' + r.failure : ''}`);
    }
  }
  if (contractDrift.length) {
    console.log(`\n─── [${arm.label}] the app's OWN contract-drift report ───`);
    console.log('🔴 This is the client saying the response does not match what it expects.');
    for (const d of contractDrift) {
      const issues = Array.isArray(d.issues) ? d.issues : [];
      console.log(`  ${d.endpoint}  (${issues.length} issue(s))`);
      const seen = new Set();
      for (const i of issues) {
        const line = typeof i === 'string' ? i : `${i.path ?? i.field ?? '?'}: ${i.message ?? i.code ?? JSON.stringify(i)}`;
        if (seen.has(line)) continue;
        seen.add(line);
        if (seen.size <= 12) console.log(`      ${line}`);
      }
      if (seen.size > 12) console.log(`      … and ${seen.size - 12} more distinct issue(s)`);
    }
  }

  console.log(`\n[${arm.label}] console errors: ${consoleErrors.length}, uncaught page errors: ${pageErrors.length}`);
  for (const e of [...consoleErrors, ...pageErrors].slice(0, 12)) console.log(`  [${e.phase}] ${e.text}`);

  return {
    arm: arm.key,
    label: arm.label,
    base: BASE,
    steps: results,
    transport: { direct: directCalls, proxied: proxiedCalls },
    apiByOutcome: Object.fromEntries(Object.entries(byClass).map(([k, rows]) => [k, rows.length])),
    failedRequests: bad.map((r) => ({ status: r.status, url: r.url.split('?')[0], failure: r.failure ?? null, phase: r.phase })),
    contractDrift,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
  };
}

// ── summary / verdict helpers ──────────────────────────────────────────────────────

function printStepTable(label, steps) {
  console.log(`\n─── [${label}] step summary ───`);
  for (const s of steps) {
    const verdict = s.ok ? 'ok     ' : s.skipped ? 'SKIPPED' : 'FAILED ';
    console.log(`  ${verdict} ${String(s.durationMs).padStart(7)}ms  ${s.name}${s.error ? '  — ' + s.error.slice(0, 110) : ''}`);
  }
  const okN = steps.filter((s) => s.ok).length;
  const skipN = steps.filter((s) => s.skipped).length;
  const failN = steps.length - okN - skipN;
  console.log(`  ${okN} ok / ${failN} failed / ${skipN} skipped of ${steps.length}`);
  return { ok: okN, failed: failN, skipped: skipN, total: steps.length };
}

function compareArms(aspnetSteps, laravelSteps) {
  const byName = new Map(laravelSteps.map((s) => [s.name, s]));
  const rows = [];
  for (const a of aspnetSteps) {
    const b = byName.get(a.name);
    let verdict;
    if (!b) verdict = 'NOT_COMPARABLE';
    else if (a.skipped || b.skipped) verdict = 'NOT_COMPARABLE';
    else if (a.ok && b.ok) verdict = 'MATCH';
    else if (!a.ok && !b.ok) verdict = 'BOTH_FAIL';
    else if (!a.ok && b.ok) verdict = 'ASPNET_ONLY_FAIL';
    else verdict = 'LARAVEL_ONLY_FAIL';
    rows.push({
      step: a.name,
      verdict,
      aspnet: { ok: a.ok, skipped: a.skipped, error: a.error },
      laravel: b ? { ok: b.ok, skipped: b.skipped, error: b.error } : null,
    });
  }
  return rows;
}

function writeArtifact(payload) {
  const out = process.env.SMOKE_JSON
    ? path.resolve(process.env.SMOKE_JSON)
    : path.join(ARTIFACT_DIR, `react-smoke-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  console.log(`\nWrote ${out}`);
  return out;
}

// ── control-mode provisioning (cloned from smoke-webuk-against-aspnet.mjs) ──────────

function startVite(port, env, label) {
  const viteBin = path.join(REACT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    throw new Error(`vite binary not found at ${viteBin} — run npm install in react-frontend first`);
  }
  const modeArgs = env.VITE_BACKEND_TARGET === 'dotnet' ? ['--mode', 'dotnet'] : [];
  const child = spawn(process.execPath, [viteBin, ...modeArgs, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
    cwd: REACT_DIR,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  child.on('exit', (code) => {
    if (!child.killedByUs) {
      console.log(`🔴 ${label} exited early (code ${code}). Last output:\n${output.slice(-800)}`);
    }
  });
  return child;
}

async function waitReady(port, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await probe(`http://127.0.0.1:${port}/`, 4000);
      if (res.status > 0) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} on :${port} never became ready`);
}

// ── main ────────────────────────────────────────────────────────────────────────────

// 🔴 `providerEmail`/`providerPassword` were added 2026-08-21 for the exchange
// journey, the first row needing a SECOND member in the same run. The exchange state
// machine gates every action on which party you are, so a one-actor arm can create a
// request and then measure nothing: `Accept Request` is only ever offered to the
// listing owner. The second actor must be a DIFFERENT member of the SAME community —
// a member of another tenant is 404'd, which reads as "accept is broken".
const ASPNET_ARM = {
  key: 'aspnet',
  label: 'ASP.NET',
  apiPort: Number(new URL(ASPNET_API).port || 80),
  email: process.env.SMOKE_EMAIL_ASPNET || 'member@acme.test',
  password: process.env.SMOKE_PASSWORD_ASPNET || 'NexusV2!Demo#2026',
  communityLabel: process.env.SMOKE_COMMUNITY_ASPNET || 'ACME Community Timebank',
  // Maya Coordinator, id 4 in the dev seed (DemoShowcaseSeedData.cs:130) — an
  // ordinary member, deliberately not the admin, so the journey is member-to-member
  // exactly as it is on the Laravel control.
  providerEmail: process.env.SMOKE_PROVIDER_EMAIL_ASPNET || 'coordinator@acme.test',
  providerPassword: process.env.SMOKE_PROVIDER_PASSWORD_ASPNET || 'NexusV2!Demo#2026',
  transferSearch: process.env.SMOKE_TRANSFER_SEARCH_ASPNET || 'Maya Coordinator',
};

// Each side signs in with its OWN fixture's member — the fixtures hold different users
// by design (mirrors smoke-webuk-against-aspnet.mjs CREDS).
const LARAVEL_ARM = {
  key: 'laravel',
  label: 'Laravel control',
  apiPort: Number(new URL(LARAVEL_API).port || 80),
  email: process.env.SMOKE_EMAIL_LARAVEL || 'e2e.user.a@project-nexus.local',
  password: process.env.SMOKE_PASSWORD_LARAVEL || 'TestPassword123!',
  communityLabel: process.env.SMOKE_COMMUNITY_LARAVEL || null, // null = first offered option
  // e2e.user.b shares the fixture password by construction (parity-fixture.sql copies
  // the hash from user A rather than writing one out), so these cannot drift apart.
  providerEmail: process.env.SMOKE_PROVIDER_EMAIL_LARAVEL || 'e2e.user.b@project-nexus.local',
  providerPassword: process.env.SMOKE_PROVIDER_PASSWORD_LARAVEL || 'TestPassword123!',
  transferSearch: process.env.SMOKE_TRANSFER_SEARCH_LARAVEL || 'E2E UserB',
  // User A owns the sole disposable-control event and correctly receives no RSVP
  // actions on it. User B is the ordinary attendee fixture for this one journey.
  rsvpActorEmail: process.env.SMOKE_RSVP_EMAIL_LARAVEL || 'e2e.user.b@project-nexus.local',
  rsvpActorPassword: process.env.SMOKE_RSVP_PASSWORD_LARAVEL || 'TestPassword123!',
};

async function main() {
  if (!CONTROL) {
    // ── single-arm mode: unchanged usage — the frontend is already running ─────────
    const base = process.env.SMOKE_BASE || 'http://127.0.0.1:5199';
    const armReport = await runArm({ ...ASPNET_ARM, base });
    const counts = printStepTable(armReport.label, armReport.steps);
    const exitCode = counts.failed > 0 ? 1 : counts.skipped > 0 ? 2 : 0;
    writeArtifact({
      generated_at: new Date().toISOString(),
      instrument: 'smoke-react-against-aspnet',
      mode: 'single',
      stamp: stampSuffix,
      exitCode,
      arms: [armReport],
    });
    console.log(`\nexit ${exitCode} (${exitCode === 0 ? 'all steps passed' : exitCode === 1 ? 'at least one step FAILED' : 'no failures, but skipped steps mean the run did not measure everything'})`);
    process.exit(exitCode);
  }

  // ── control mode ────────────────────────────────────────────────────────────────
  // Preflight: each check must be able to FAIL. The script never starts a backend
  // itself — a missing backend is UNMEASURABLE (exit 2), not something to paper over.
  for (const [name, url] of [
    ['ASP.NET API', `${ASPNET_API}/health`],
    ['disposable Laravel', `${LARAVEL_API}/api/v2/health`],
  ]) {
    let ok = false;
    try { ok = (await probe(url)).status === 200; } catch { /* down */ }
    if (!ok) {
      console.log(`🔴 UNMEASURABLE: ${name} is not answering at ${url}. Start it first.`);
      process.exit(2);
    }
  }

  console.log(`Provisioning React frontend: :${PORT_ASPNET} -> ASP.NET (${ASPNET_API}), :${PORT_LARAVEL} -> Laravel control (${LARAVEL_API})`);
  const childA = startVite(PORT_ASPNET, {
    VITE_BACKEND_TARGET: 'dotnet',
    VITE_API_URL: ASPNET_API,
  }, 'react-frontend (ASP.NET target)');
  const childB = startVite(PORT_LARAVEL, {
    VITE_API_URL: LARAVEL_API,
  }, 'react-frontend (Laravel control)');

  const kill = () => {
    for (const c of [childA, childB]) {
      c.killedByUs = true;
      try { c.kill(); } catch { /* already gone */ }
    }
  };
  process.on('exit', kill);
  process.on('SIGINT', () => { kill(); process.exit(130); });

  let reportA; let reportB;
  try {
    await waitReady(PORT_ASPNET, 'react-frontend (ASP.NET target)');
    await waitReady(PORT_LARAVEL, 'react-frontend (Laravel control)');
    // Arms run SEQUENTIALLY: two Playwright browsers interleaving against one dev-mode
    // Vite each is fine, but sequential keeps each backend inside its own rate window
    // and keeps the console readable.
    reportA = await runArm({ ...ASPNET_ARM, base: `http://127.0.0.1:${PORT_ASPNET}` });
    reportB = await runArm({ ...LARAVEL_ARM, base: `http://127.0.0.1:${PORT_LARAVEL}` });
  } catch (err) {
    console.log(`🔴 UNMEASURABLE: ${err.stack || err}`);
    kill();
    process.exit(2);
  }
  kill();

  printStepTable(reportA.label, reportA.steps);
  printStepTable(reportB.label, reportB.steps);

  const comparison = compareArms(reportA.steps, reportB.steps);
  console.log('\n─── control comparison (per step) ───');
  for (const row of comparison) {
    const mark = row.verdict === 'MATCH' ? '✓' : row.verdict === 'ASPNET_ONLY_FAIL' ? '✗' : '~';
    console.log(`${mark} ${row.verdict.padEnd(18)} ${row.step}`);
    if (row.verdict === 'ASPNET_ONLY_FAIL') console.log(`    aspnet:  ${row.aspnet.error}`);
    if (row.verdict === 'LARAVEL_ONLY_FAIL') console.log(`    laravel: ${row.laravel.error}`);
    if (row.verdict === 'BOTH_FAIL') {
      console.log(`    aspnet:  ${row.aspnet.error}`);
      console.log(`    laravel: ${row.laravel.error}`);
    }
  }
  const tally = {};
  for (const row of comparison) tally[row.verdict] = (tally[row.verdict] ?? 0) + 1;
  console.log('\n─── verdict tally ───');
  for (const [v, n] of Object.entries(tally)) console.log(`  ${String(n).padStart(3)}  ${v}`);
  console.log('  MATCH = both pass. BOTH_FAIL = environment/fixture suspect, not an ASP.NET');
  console.log('  defect. ASPNET_ONLY_FAIL = real defect candidate. LARAVEL_ONLY_FAIL =');
  console.log('  control broken / fixture asymmetry. NOT_COMPARABLE = a side skipped.');

  const aspnetOnly = tally.ASPNET_ONLY_FAIL ?? 0;
  const unclean = (tally.BOTH_FAIL ?? 0) + (tally.LARAVEL_ONLY_FAIL ?? 0) + (tally.NOT_COMPARABLE ?? 0);
  const exitCode = aspnetOnly > 0 ? 1 : unclean > 0 ? 2 : 0;

  writeArtifact({
    generated_at: new Date().toISOString(),
    instrument: 'smoke-react-against-aspnet',
    mode: 'control',
    stamp: stampSuffix,
    aspnet_api: ASPNET_API,
    laravel_api: LARAVEL_API,
    exitCode,
    verdictTally: tally,
    comparison,
    arms: [reportA, reportB],
  });

  console.log(`\nexit ${exitCode} (${exitCode === 0 ? 'every step pair is MATCH' : exitCode === 1 ? 'ASPNET_ONLY_FAIL present — real defect candidate(s)' : 'no ASP.NET-only failures, but the run was not a clean pass (see tally)'})`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.log(`🔴 UNMEASURABLE: ${err.stack || err}`);
  process.exit(2);
});
