// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Real browser -> client -> isolated Laravel -> MariaDB. No API response mocks.
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('../react-frontend/node_modules/@playwright/test');
const root = path.resolve(import.meta.dirname, '..');
const docker = process.env.MFA_DOCKER || 'docker';
const output = path.join(root, '.local-docs-archive/mfa-client-journeys');
mkdirSync(output, { recursive: true });
const fixture = JSON.parse(execFileSync(docker, ['exec', 'nexus-webuk-e2e-app', 'php', 'scripts/mfa-e2e-fixture.php'], { cwd: root, encoding: 'utf8' }));
const children = [];
const checks = [];
function start(file, args, cwd, env) {
  const child = spawn(process.execPath, [file, ...args], { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', b => { logs = (logs + b).slice(-12000); });
  child.stderr.on('data', b => { logs = (logs + b).slice(-12000); });
  child.on('error', e => console.error(e.message));
  children.push(child);
  return () => logs;
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Local server failed to start: ${url}`);
}
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bits = [...secret.trim()].map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
  const key = Buffer.from((bits.match(/.{8}/g) || []).map(b => parseInt(b, 2)));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac('sha1', key).update(counter).digest();
  return String((hash.readUInt32BE(hash.at(-1) & 15) & 0x7fffffff) % 1000000).padStart(6, '0');
}
async function api(url, body, token) {
  const response = await fetch(`http://127.0.0.1:8091/api${url}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Tenant-ID': String(fixture.tenant), 'X-Tenant-Slug': fixture.slug, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}
async function signIn(page, client) {
  const actor = fixture.actors[client];
  const url = client === 'react' ? `http://127.0.0.1:5177/${fixture.slug}/login` : `http://127.0.0.1:5187/${fixture.slug}/accessible/login`;
  await page.goto(url);
  const essential = page.getByRole('button', { name: 'Essential only', exact: true });
  if (await essential.isVisible()) await essential.click();
  await page.locator('input[type="email"]').fill(actor.email);
  await page.locator('input[type="password"]').fill(actor.password);
  await page.locator('form').filter({ has: page.locator('input[type="password"]') }).locator('button[type="submit"]').click();
}
let browser;
let activePage;
const viteLogs = start(path.join(root, 'react-frontend/node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', '5177', '--strictPort'], path.join(root, 'react-frontend'), { VITE_API_URL: 'http://127.0.0.1:8091', VITE_API_BASE: '/api' });
const webLogs = start(path.join(root, 'web-uk/src/server.js'), [], root, { NODE_ENV: 'development', PORT: '5187', LARAVEL_BASE_URL: 'http://127.0.0.1:8091', API_BASE_URL: 'http://127.0.0.1:8091', ACCESSIBLE_BACKEND_TARGET: 'laravel', ACCESSIBLE_TENANT_SLUG: fixture.slug, TENANT_ID: String(fixture.tenant), COOKIE_SECRET: 'mfa-journey-local-cookie-secret-123456789', SESSION_SECRET: 'mfa-journey-local-session-secret-123456789' });
try {
  await Promise.all([ready('http://127.0.0.1:5177'), ready('http://127.0.0.1:5187/health')]);
  const limitedActor = fixture.actors.native;
  const restricted = await api('/auth/login', { email: limitedActor.email, password: limitedActor.password });
  assert.equal(restricted.json.requires_2fa_setup, true);
  for (let i = 0; i < 5; i++) {
    assert.equal((await api('/v2/auth/2fa/setup', { two_factor_token: restricted.json.two_factor_token })).status, 200);
  }
  assert.equal((await api('/v2/auth/2fa/setup', { two_factor_token: restricted.json.two_factor_token })).status, 429);
  checks.push({ client: 'backend', check: 'same account is limited after five setup requests; subsequent website accounts remain independent', passed: true });
  browser = await chromium.launch({ headless: true });
  for (const client of ['accessible', 'react']) {
    const context = await browser.newContext({ javaScriptEnabled: client === 'react', serviceWorkers: 'block' });
    await context.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = await context.newPage();
    activePage = page;
    page.setDefaultTimeout(30000);
    await signIn(page, client);
    await page.waitForURL(/two-factor\/setup/);
    const secretLocator = client === 'react' ? page.locator('code').first() : page.locator('main code').first();
    const secret = (await secretLocator.textContent()).trim();
    assert.match(secret, /^[A-Z2-7]+$/);
    await page.locator('input[autocomplete="one-time-code"]').fill(totp(secret));
    await page.locator('form').filter({ has: page.locator('input[autocomplete="one-time-code"]') }).locator('button').click();
    await page.getByRole('button', { name: /saved.*recovery|saved.*codes/i }).waitFor();
    const codes = client === 'accessible' ? page.locator('main li code') : page.locator('section ul[aria-label] li');
    await codes.first().waitFor();
    const backup = (await codes.allTextContents()).map(c => c.trim());
    assert.equal(backup.length, 10, 'Ten recovery codes must remain visible before acknowledging');
    const consent = page.getByRole('button', { name: 'Essential only', exact: true });
    if (await consent.isVisible()) await consent.click();
    await page.getByRole('button', { name: /saved.*recovery|saved.*codes/i }).click();
    await page.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/two-factor'));
    if (client === 'accessible') assert.match(new URL(page.url()).pathname, /dashboard/);
    checks.push({ client, check: 'real browser enrollment and recovery acknowledgment', passed: true });
    await context.close();
    const login = await api('/auth/login', { email: fixture.actors[client].email, password: fixture.actors[client].password });
    assert.equal(login.json.requires_2fa, true);
    assert.equal(login.json.access_token, undefined);
    const completed = await api('/totp/verify', { two_factor_token: login.json.two_factor_token, code: backup[0], use_backup_code: true });
    assert.equal(completed.status, 200);
    const session = completed.json.data || completed.json;
    const token = session.access_token || session.token;
    assert.ok(token, 'Recovery login must issue an actual credential');
    const profile = await api('/v2/users/me', null, token);
    assert.equal(Number(profile.json.data.id), fixture.actors[client].id);
    const again = await api('/auth/login', { email: fixture.actors[client].email, password: fixture.actors[client].password });
    const replay = await api('/totp/verify', { two_factor_token: again.json.two_factor_token, code: backup[0], use_backup_code: true });
    assert.equal(replay.status, 401);
    checks.push({ client, check: 'real API recovery login, protected identity and rejected code reuse', passed: true });
    const recoveryContext = await browser.newContext({ javaScriptEnabled: client === 'react', serviceWorkers: 'block' });
    await recoveryContext.route('**/*', route => ['127.0.0.1', 'localhost'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const recoveryPage = await recoveryContext.newPage();
    activePage = recoveryPage;
    await signIn(recoveryPage, client);
    const recoveryConsent = recoveryPage.getByRole('button', { name: 'Essential only', exact: true });
    if (await recoveryConsent.isVisible()) await recoveryConsent.click();
    const recoveryCheckbox = recoveryPage.getByRole('checkbox', { name: /backup|recovery/i });
    await recoveryCheckbox.focus();
    await recoveryCheckbox.press('Space');
    assert.equal(await recoveryCheckbox.isChecked(), true);
    await recoveryPage.locator('input[autocomplete="one-time-code"]').fill(backup[1]);
    await recoveryPage.locator('form').filter({ has: recoveryPage.locator('input[autocomplete="one-time-code"]') }).locator('button[type="submit"], button:not([type])').click();
    await recoveryPage.waitForURL(url => !url.pathname.includes('/login') && !url.pathname.includes('/two-factor'));
    assert.match(new URL(recoveryPage.url()).pathname, client === 'react' ? /\/(?:dashboard|feed)$/ : /\/dashboard$/);
    checks.push({ client, check: 'fresh browser password and recovery-code sign-in reached authenticated home', passed: true });
    await recoveryContext.close();
    console.log(`${client}: enrollment, recovery and replay checks passed`);
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) console.error('Page:', activePage.url(), 'Buttons:', await activePage.locator('button').allTextContents());
  checks.push({ passed: false, error: error.message });
  writeFileSync(path.join(output, 'server-diagnostics.log'), viteLogs() + '\n' + webLogs());
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await browser?.close();
  children.forEach(child => child.kill());
  writeFileSync(path.join(output, 'results.json'), JSON.stringify({ recordedAt: new Date().toISOString(), environment: 'nexus_webuk_e2e', checks }, null, 2));
}
