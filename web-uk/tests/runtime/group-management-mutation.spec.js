// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { createGroup, deleteGroup, getGroupMembers, getProfile, joinGroup, login } = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  return [];
}

function objectFrom(result) {
  return result?.data?.group || result?.data || result;
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function submit(page, suffix, button) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith(suffix), { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

test('certifies disposable join approval and member role management through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const name = `Codex disposable management group ${runId}`;
  const ownerAuth = await login(smoke.email, smoke.password, smoke.tenant);
  const secondEmail = process.env.SMOKE_SECOND_EMAIL || process.env.E2E_SECOND_USER_EMAIL || 'e2e.user.b@project-nexus.local';
  const secondPassword = process.env.SMOKE_SECOND_PASSWORD || process.env.E2E_SECOND_USER_PASSWORD || smoke.password;
  const secondAuth = await login(secondEmail, secondPassword, smoke.tenant);
  const secondProfile = objectFrom(await getProfile(secondAuth.access_token));
  const secondUserId = Number(secondProfile.id || secondProfile.user_id);
  const secondUserName = String(secondProfile.name || `${secondProfile.first_name || ''} ${secondProfile.last_name || ''}`).trim();
  let groupId = null;

  try {
    const created = objectFrom(await createGroup(ownerAuth.access_token, {
      name,
      description: 'Disposable group-management certification fixture.',
      visibility: 'private'
    }));
    groupId = Number(created.id);
    expect(groupId).toBeGreaterThan(0);
    expect(secondUserId).toBeGreaterThan(0);

    await joinGroup(secondAuth.access_token, groupId);
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/groups/${groupId}/manage`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Manage members');

    const requestCard = page.locator('.nexus-alpha-card', { hasText: secondUserName || `#${secondUserId}` });
    await expect(requestCard).toHaveCount(1);
    expect((await submit(page, `/groups/${groupId}/requests/${secondUserId}`, requestCard.locator('button[value="accept"]'))).status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('The join request has been approved.', { exact: true })).toHaveCount(1);

    let memberCard = page.locator('.nexus-alpha-card', { has: page.locator(`form[action$="/groups/${groupId}/members/${secondUserId}"]`) });
    expect((await submit(page, `/groups/${groupId}/members/${secondUserId}`, memberCard.locator('button[value="promote"]'))).status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    let member = rowsFrom(await getGroupMembers(ownerAuth.access_token, groupId, { per_page: 100 }))
      .find(row => Number(row.id || row.user_id) === secondUserId);
    expect(member.role).toBe('admin');

    memberCard = page.locator('.nexus-alpha-card', { has: page.locator(`form[action$="/groups/${groupId}/members/${secondUserId}"]`) });
    expect((await submit(page, `/groups/${groupId}/members/${secondUserId}`, memberCard.locator('button[value="demote"]'))).status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    member = rowsFrom(await getGroupMembers(ownerAuth.access_token, groupId, { per_page: 100 }))
      .find(row => Number(row.id || row.user_id) === secondUserId);
    expect(member.role).toBe('member');

    memberCard = page.locator('.nexus-alpha-card', { has: page.locator(`form[action$="/groups/${groupId}/members/${secondUserId}"]`) });
    expect((await submit(page, `/groups/${groupId}/members/${secondUserId}`, memberCard.locator('button[value="remove"]'))).status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    member = rowsFrom(await getGroupMembers(ownerAuth.access_token, groupId, { per_page: 100 }))
      .find(row => Number(row.id || row.user_id) === secondUserId);
    expect(member).toBeUndefined();

    const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
  } finally {
    if (groupId) await deleteGroup(ownerAuth.access_token, groupId).catch(() => undefined);
  }
});
