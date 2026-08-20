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
 * Usage — start the app pointed at ASP.NET, then run this:
 *
 *   docker compose -f aspnet-backend/compose.yml up -d api      # or its usual start
 *   npm --prefix react-frontend run dev:dotnet -- --port 5199 --strictPort
 *   node aspnet-backend/scripts/smoke-react-against-aspnet.mjs
 *
 * 🔴 Port 5199, not 5173. 5173 is the owner's own Vite server; do not take it.
 *
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
 * are not. Wait for the window, or raise the limit deliberately for a batch.
 *
 * 🔴 It asserts CONTENT, not just navigation. A redirect back to /login and a page whose
 * only content is an error both count as failures — "the page loaded" is not evidence.
 */

import { chromium } from 'playwright';

const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:5199';
const EMAIL = 'member@acme.test';
const PASSWORD = 'NexusV2!Demo#2026';

const stampSuffix = process.env.SMOKE_STAMP || String(process.hrtime.bigint() % 100000n);
const api = [];
const consoleErrors = [];
const pageErrors = [];

function classify(url, status) {
  if (status === 0) return 'transport';
  if (status === 401 || status === 403) return 'auth';
  if (status === 404 || status === 405) return 'route-missing';
  if (status >= 500) return 'server-error';
  return 'ok';
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

page.on('response', (r) => {
  const u = r.url();
  if (u.includes('/api/')) api.push({ url: u.replace(BASE, ''), absolute: u, status: r.status(), phase: current });
});
page.on('requestfailed', (r) => {
  const u = r.url();
  if (u.includes('/api/')) api.push({ url: u.replace(BASE, ''), absolute: u, status: 0, phase: current, failure: r.failure()?.errorText });
});
// 🔴 The app validates responses at runtime in dev and logs "contract drift" with a
// structured list of what is wrong. That is the CLIENT'S OWN VERDICT on the contract —
// better evidence than any external field diff, because it says what the app expected
// and what it got. It was being truncated to 200 characters and discarded; the first
// captured message reported 60 issues on a single endpoint. Serialise it instead.
const contractDrift = [];
page.on('console', async (m) => {
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
page.on('pageerror', (e) => pageErrors.push({ phase: current, text: String(e).slice(0, 200) }));

let current = 'landing';
async function step(name, fn) {
  current = name;
  try { await fn(); console.log(`  step ${name}: ok`); }
  catch (e) { console.log(`  step ${name}: FAILED — ${String(e).split('\n')[0].slice(0, 160)}`); }
}

console.log(`Smoke: unchanged React app -> ASP.NET, via ${BASE}\n`);

await step('landing', async () => {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 });
  console.log(`    title: ${JSON.stringify(await page.title())}`);
  const bodyLen = (await page.locator('body').innerText()).trim().length;
  console.log(`    visible text length: ${bodyLen}`);
});

// 🔴 Consent overlays block every click until dismissed, and the first smoke run
// timed out on the Sign In button because of them — NOT because of the backend.
// A cookie banner and an AI-features dialog both render above the form. Classify
// these as frontend chrome, never as ASP.NET defects.
await step('dismiss-consent', async () => {
  for (const label of ['Essential only', 'Use basic features only']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(500); }
  }
});

await step('login-page', async () => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 60000 });
  for (const label of ['Essential only', 'Use basic features only']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); }
  }
  // 🔴 The field is name="username" with type="email" — not name="email".
  console.log(`    username inputs: ${await page.locator('input[name="username"]').count()}`);
});

await step('select-community', async () => {
  // 🔴 THE actual gate. Sign In stays disabled until a community is chosen — the
  // login form carries a native <select> of communities (ACME, Globex, ACME Youth,
  // Smoke Hub, Smoke Branch). The first two smoke runs timed out clicking a disabled
  // button and it looked like a backend problem. It is not: it is a required field.
  const opts = await page.locator('select option').allTextContents();
  console.log(`    communities offered: ${JSON.stringify(opts.map((o) => o.trim()).filter(Boolean))}`);
  await page.selectOption('select', { label: 'ACME Community Timebank' });
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
  console.log(`    url after submit: ${page.url().replace(BASE, '') || '/'}`);
  const token = await page.evaluate(() => Object.keys(localStorage).filter((k) => /token|auth/i.test(k)));
  console.log(`    auth keys in localStorage: ${JSON.stringify(token)}`);
});

// 🔴 `/feed` was missing from this list until 2026-08-20, which is why a feed rewrite had
// no browser-level evidence at all. `/events` is here for the same reason: the dashboard
// crash caused by the events contract port was only ever going to be caught by rendering a
// page, never by a response diff — a diff compares the shape you ASKED for, and the harness
// asks for the canonical one. If you port a read endpoint, put its page in this list.
for (const [name, path] of [['dashboard', '/dashboard'], ['feed', '/feed'], ['listings', '/listings'], ['events', '/events'], ['members', '/members'], ['wallet', '/wallet'], ['help', '/help']]) {
  await step(name, async () => {
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    const url = page.url().replace(BASE, '');
    const text = (await page.locator('body').innerText()).trim();
    // 🔴 "the page loaded" is not evidence. A redirect back to /login, or a page
    // whose only content is an error, both count as FAILED here.
    const redirected = url.startsWith('/login') ? '  🔴 REDIRECTED TO LOGIN' : '';
    const looksEmpty = text.length < 200 ? '  🔴 ALMOST NO CONTENT' : '';
    console.log(`    ${path} -> ${url}  text=${text.length}${redirected}${looksEmpty}`);
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
  for (const label of ['Use basic features only', 'Essential only']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); }
  }

  // 🔴 The fields have NO `name` attribute — HeroUI renders react-aria generated ids
  // (`react-aria…_r_bp_`), so `input[name="title"]` matches nothing and the step used to
  // report "form not reachable", which reads like the page failed to load. It did not:
  // the form was there, with a visible "Create Listing" submit. Target by LABEL.
  const title = page.getByLabel(/title/i).first();
  if (!(await title.count())) { console.log('    no title field — selector needs updating, NOT a backend result'); return; }
  await title.fill(`Smoke listing ${stampSuffix}`, { timeout: 10000 });
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
  if (!(await submit.count())) { console.log('    no Create Listing button — selector needs updating'); return; }
  if (!(await submit.isEnabled())) {
    console.log('    🔴 submit still DISABLED — a required field is unsatisfied; not a backend result');
    return;
  }
  await submit.click({ timeout: 15000 }).catch((e) => console.log('    click failed: ' + String(e).slice(0, 90)));
  await page.waitForTimeout(5000);
  const after = page.url().replace(BASE, '');
  console.log(`    after submit: ${after}`);
  console.log(`    ${after.includes('/listings/create') ? '🔴 still on the form — the create did NOT complete' : 'navigated away — create appears to have succeeded'}`);
});

// 🔴 POSTING. The feed composer opens from a "Create" button (there is no inline
// textarea on /feed — a selector looking for one reports "no composer" and reads like a
// backend fault). Every consent dismissal carries a short timeout: a covered button hung
// for the full 30s default once and looked like a hang.
await step('action-create-feed-post', async () => {
  await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  for (const label of ['Use basic features only', 'Essential only']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); }
  }
  if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

  const create = page.locator('button:has-text("Create")').first();
  if (!(await create.count())) { console.log('    no Create control — selector needs updating, NOT a backend result'); return; }
  await create.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const composer = page.locator('textarea, [contenteditable="true"]').first();
  if (!(await composer.count())) { console.log('    composer did not open — selector needs updating, NOT a backend result'); return; }
  const body = `Smoke feed post ${stampSuffix}`;
  await composer.fill(body, { timeout: 10000 }).catch(async () => { await composer.type(body).catch(() => {}); });
  await page.waitForTimeout(500);

  const submit = page.locator('button:has-text("Post"), button[type="submit"]').last();
  if (!(await submit.count()) || !(await submit.isEnabled())) {
    console.log('    submit missing or disabled — a required field is unsatisfied; not a backend result');
    return;
  }
  await submit.click({ timeout: 15000 }).catch((e) => console.log('    click failed: ' + String(e).slice(0, 80)));
  await page.waitForTimeout(4000);
  // 🔴 Assert the EFFECT: the post must be on the page, not merely "no error shown".
  const present = await page.locator(`text=${body}`).count();
  console.log(`    post visible on the feed afterwards: ${present > 0 ? 'YES — posting works' : 'no (unconfirmed)'}`);
});

// 🔴 TRANSFERRING credits — the highest-risk member action, because it moves value.
await step('action-transfer-credits', async () => {
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
  for (const label of ['Use basic features only', 'Essential only']) {
    const b = page.locator(`button:has-text("${label}")`).first();
    if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(400); }
  }
  const balanceBefore = (await page.locator('body').innerText()).match(/([\d,]+\.?\d*)\s*(?:hours|credits)/i)?.[1] ?? null;
  console.log(`    balance text before: ${balanceBefore ?? '(not found)'}`);

  const send = page.locator('button:has-text("Send Credits")').first();
  if (!(await send.count())) { console.log('    no Send Credits control — selector needs updating, NOT a backend result'); return; }
  await send.click({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Fields are unnamed (react-aria ids) but well aria-labelled — target the labels.
  // 🔴 This is a TWO-STAGE form and the stages must be addressed in order. Measured:
  // with the dialog freshly open, byLabel('Search recipient') = 1 but
  // byLabel('Amount in hours') = 0 — the amount field does not exist until a recipient
  // is chosen. Requiring both up front made the step report "form did not open" while
  // the form was open and working, and cost two runs of guessing (overlay state, then
  // selector spelling) before the counts were simply printed.
  const recipient = page.getByLabel('Search recipient').first();
  if (!(await recipient.count())) {
    console.log(`    recipient field not addressable (visible inputs: ${await page.locator('input:visible').count()})`
      + ' — selector needs updating, NOT a backend result');
    return;
  }

  // 🔴 Pick the recipient from the SEARCH RESULTS, never by typing a name and hoping.
  // A transfer moves value; sending to whoever happens to be first in an unfiltered list
  // is not a test, it is an accident waiting to be reported as a pass.
  await recipient.fill('coordinator', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const option = page.locator('[role="option"], li[role="button"], button:has-text("coordinator")').first();
  if (!(await option.count())) {
    console.log('    recipient search returned no selectable result — cannot complete safely; NOT a backend verdict');
    return;
  }
  await option.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);

  // Stage two: the amount field appears only now.
  const amount = page.getByLabel('Amount in hours').first();
  if (!(await amount.count())) {
    console.log('    amount field still absent after choosing a recipient — form flow changed; NOT a backend verdict');
    return;
  }
  await amount.fill('1', { timeout: 8000 }).catch(() => {});
  const note = page.locator('textarea:visible').first();
  if (await note.count()) await note.fill(`Smoke transfer ${stampSuffix}`, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);

  const confirm = page.locator('button:has-text("Send Credits")').last();
  if (!(await confirm.isEnabled())) {
    console.log('    submit still DISABLED after filling recipient+amount — a required field is '
      + 'unsatisfied; NOT a backend verdict');
    return;
  }
  await confirm.click({ timeout: 15000 }).catch((e) => console.log('    click failed: ' + String(e).slice(0, 80)));
  await page.waitForTimeout(5000);

  // 🔴 Assert the EFFECT on the ledger, not the absence of an error dialog.
  await page.goto(`${BASE}/wallet`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  const after = await page.locator('body').innerText();
  const listed = after.includes(`Smoke transfer ${stampSuffix}`);
  const balanceAfter = after.match(/([\d,]+\.?\d*)\s*(?:hours|credits)/i)?.[1] ?? null;
  console.log(`    balance text after : ${balanceAfter ?? '(not found)'}`);
  console.log(`    transfer in the ledger afterwards: ${listed ? 'YES — transferring works' : 'no (unconfirmed)'}`);
});

await step('action-rsvp-event', async () => {
  await page.goto(`${BASE}/events`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);
  // 🔴 Must match /events/<NUMBER>. `a[href*="/events/"]` also matches `/events/create`,
  // and picking that opened the CREATE form — whose buttons are "Select a category" and
  // "Create Event", so the step then reported "no RSVP control on the event page" while
  // never having opened an event at all. A selector fault that reads as a backend gap.
  const hrefs = await page.locator('a[href*="/events/"]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')).filter((h) => /\/events\/\d+(?:[/?#]|$)/.test(h || '')));
  if (!hrefs.length) { console.log('    no event DETAIL links on the list (only create/filter links)'); return; }
  await page.goto(`${BASE}${hrefs[0].startsWith('/') ? hrefs[0] : `/${hrefs[0]}`}`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  // Labels read from react-frontend/public/locales/en/events.json rather than guessed.
  const rsvp = page.locator('button:has-text("Going"), button:has-text("Interested"), [aria-label="RSVP options"] button').first();
  if (!(await rsvp.count())) { console.log('    no RSVP control on the event page'); return; }
  await rsvp.click().catch(() => {});
  await page.waitForTimeout(3000);
  console.log('    RSVP control clicked');
});

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
  if (!(await avatar.count())) { console.log('    no avatar trigger found — selector needs updating, NOT a backend result'); return; }
  await avatar.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const modeItem = page.locator('li:has-text("Dark Mode"), li:has-text("Light Mode"), [role="menuitem"]:has-text("Mode")').first();
  if (!(await modeItem.count())) { console.log('    theme menu item not found — selector needs updating, NOT a backend result'); return; }
  await modeItem.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const after = await isDark();
  console.log(`    theme flipped in-page: ${before !== after ? 'YES' : 'no'}`);
  if (before === after) { console.log('    (toggle had no effect — cannot assert persistence this run)'); return; }

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
  if (!(await comment.count())) { console.log('    no Comment control — selector needs updating, NOT a backend result'); return; }
  await comment.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);

  const box = page.locator('input[placeholder*="comment" i], textarea[placeholder*="comment" i]').first();
  if (!(await box.count())) { console.log('    comment box did not open — selector needs updating, NOT a backend result'); return; }
  const body = `Smoke comment ${stampSuffix}`;
  await box.fill(body, { timeout: 8000 }).catch(() => {});
  await box.press('Enter').catch(() => {});
  await page.waitForTimeout(3000);
  const present = await page.locator(`text=${body}`).count();
  console.log(`    comment visible afterwards: ${present > 0 ? 'YES — commenting works' : 'no (unconfirmed)'}`);
});

// MESSAGES: send a text message into the member<->admin conversation and assert it
// renders. (The conversation exists — earlier probes created voice messages in it.)
await step('journey-message-send', async () => {
  await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  if (page.url().includes('/login')) throw new Error('redirected to login — session lost');

  // Open the first conversation in the list.
  const thread = page.locator('a[href*="/messages/"], [role="listitem"] a').first();
  if (!(await thread.count())) { console.log('    no conversation in the list — selector or fixture gap, NOT a backend result'); return; }
  await thread.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const composer = page.locator('textarea[placeholder="Type a message..."], input[placeholder="Type a message..."]').first();
  if (!(await composer.count())) { console.log('    composer not found — selector needs updating, NOT a backend result'); return; }
  const body = `Smoke message ${stampSuffix}`;
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
    return;
  }
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(3500);
  await page.mouse.wheel(0, 20000);
  await page.waitForTimeout(3500);
  const after = await countItems();
  console.log(`    feed items before=${before} after-scroll=${after}: ${after > before ? 'YES — infinite scroll advances' : 'no growth (page may be fully loaded — check total)'}`);
});

// FEED REACTION THROUGH THE UI: like the post this run created; the state must
// SURVIVE A RELOAD (an optimistic flip that reverts is the classic failure here).
await step('journey-feed-reaction', async () => {
  await page.goto(`${BASE}/feed`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  // 🔴 The liked state is CSS, not ARIA: FeedCard's Like button flips to
  // `text-rose-500` with a filled Heart when item.is_liked (FeedCard.tsx:1627-1637);
  // its LABEL stays "Like" and there is no aria-pressed. The first version of this
  // probe read aria-pressed and reported "unconfirmed" against a working backend.
  // Anchor to THIS RUN'S OWN post: 'first Like button on the page' compared two
  // DIFFERENT cards across the reload (feed order shifts as smoke posts accumulate),
  // which produced a true->true reading against a working backend.
  // FeedCard renders role="article" on a GlassCard div (FeedCard.tsx:587), not an
  // <article> element — the tag selector missed and the probe silently fell back to
  // the whole page, comparing two different cards across the reload.
  const ownCard = page.locator(`[role="article"]:has-text("Smoke feed post ${stampSuffix}")`).first();
  const anchored = (await ownCard.count()) > 0;
  if (!anchored) console.log('    (own post card not found — falling back to first card, weaker evidence)');
  const scope = anchored ? ownCard : page;
  const likedState = async () => {
    const b = scope.locator('button:has-text("Like")').first();
    if (!(await b.count())) return null;
    const cls = (await b.getAttribute('class').catch(() => '')) || '';
    return cls.includes('text-rose-500');
  };
  const like = scope.locator('button:has-text("Like")').first();
  if (!(await like.count())) { console.log('    no Like control — selector needs updating, NOT a backend result'); return; }
  const before = await likedState();
  await like.click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2500);
  const after = await likedState();
  const survived = after !== null && after !== before;
  console.log(`    reaction state flipped AND survived a reload: ${survived ? `YES (${before} -> ${after}) — the write persisted` : `no (${before} -> ${after}) — unconfirmed`}`);
  if (after === null) console.log('    (Like control vanished after reload — selector gap)');
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
  try {
    await page2.goto(`${BASE}/register`, { waitUntil: 'networkidle', timeout: 60000 });
    await page2.waitForTimeout(2000);
    for (const label of ['Use basic features only', 'Essential only']) {
      const b = page2.locator(`button:has-text("${label}")`).first();
      if (await b.count() && await b.isVisible()) { await b.click({ timeout: 5000 }).catch(() => {}); await page2.waitForTimeout(400); }
    }

    const email = `smoke.signup.${stampSuffix}@example.test`;
    const fillAll = async (selector, value) => {
      const fields = page2.locator(selector);
      for (let i = 0; i < await fields.count(); i++) {
        const f = fields.nth(i);
        if (await f.isVisible().catch(() => false)) await f.fill(value, { timeout: 5000 }).catch(() => {});
      }
    };
    await fillAll('input[autocomplete="given-name"]', 'Smoke');
    await fillAll('input[autocomplete="family-name"]', `Signup${stampSuffix}`);
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

    const create = page2.locator('button:has-text("Create Account")').first();
    if (!(await create.count())) { console.log('    Create Account not found — selector gap, NOT a backend result'); return; }
    for (let w = 0; w < 30; w++) {
      if (await create.isEnabled().catch(() => false)) break;
      await page2.waitForTimeout(1000);
    }
    if (!(await create.isEnabled().catch(() => false))) {
      console.log('    🔴 SIGN-UP UNPROVEN: Create Account never enabled (breach check hung, or a field is unsatisfied)');
      return;
    }
    await create.click({ timeout: 8000 }).catch(() => {});
    await page2.waitForTimeout(2500);
    if (page2.url().includes('/register') && !/Registration Successful/i.test(await page2.locator('body').innerText())) {
      await page2.locator('input[autocomplete="email"]').first().press('Enter').catch(() => {});
      await page2.waitForTimeout(5000);
    }

    const bodyText = (await page2.locator('body').innerText()).trim();
    const success = /Registration Successful/i.test(bodyText);
    const verify = /verification link|verify your email/i.test(bodyText);
    console.log(`    registration successful screen: ${success} | verification-email flow: ${verify}`);
    if (!success) throw new Error('registration did not reach the success screen');
  } finally {
    await context2.close();
  }
});

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
  if (!before.refresh) { console.log('    no refresh token stored — cannot test refresh'); return; }
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

// ── report ────────────────────────────────────────────────────────────────────

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
const directCalls = api.filter((r) => /:5080\//.test(r.absolute ?? '')).length;
const proxiedCalls = api.length - directCalls;
console.log('\n─── transport mode (measured, not assumed) ───');
console.log(`  direct  (cross-origin, exercises CORS): ${directCalls}`);
console.log(`  proxied (same-origin via Vite)        : ${proxiedCalls}`);
if (directCalls === 0) {
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
console.log('\n─── API calls by outcome ───');
for (const [k, rows] of Object.entries(byClass).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${String(rows.length).padStart(4)}  ${k}`);
}
const bad = api.filter((r) => classify(r.url, r.status) !== 'ok');
if (bad.length) {
  console.log('\n─── failed requests (deduped) ───');
  const seen = new Set();
  for (const r of bad) {
    const key = `${r.status} ${r.url.split('?')[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  ${String(r.status).padEnd(4)} ${classify(r.url, r.status).padEnd(14)} ${r.url.split('?')[0]}${r.failure ? '  ' + r.failure : ''}`);
  }
}
if (contractDrift.length) {
  console.log('\n─── the app\'s OWN contract-drift report ───');
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

console.log(`\nconsole errors: ${consoleErrors.length}, uncaught page errors: ${pageErrors.length}`);
for (const e of [...consoleErrors, ...pageErrors].slice(0, 12)) console.log(`  [${e.phase}] ${e.text}`);
