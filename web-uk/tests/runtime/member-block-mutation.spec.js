// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const {
  getMemberConnectionStatus,
  getProfile,
  getUserBlockStatus,
  getUsers,
  login,
  removeMemberConnection,
  unblockMember
} = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function objectFrom(result) {
  return result?.data ?? result ?? {};
}

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  return [];
}

async function safeTarget(viewerToken, viewerId) {
  const candidates = rowsFrom(await getUsers(viewerToken, { limit: 100 }));
  for (const candidate of candidates) {
    const id = Number(candidate?.id);
    if (!Number.isInteger(id) || id <= 0 || id === viewerId) continue;
    const block = objectFrom(await getUserBlockStatus(viewerToken, id));
    if (block.is_blocked || block.is_blocked_by) continue;
    const connection = objectFrom(await getMemberConnectionStatus(viewerToken, id));
    if (!['none', null, undefined].includes(connection.status)) continue;
    return candidate;
  }
  return null;
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/login'), { timeout: 300_000 });
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
  const rejectCookies = page.getByRole('button', { name: 'Reject analytics cookies' });
  if (await rejectCookies.isVisible()) await rejectCookies.click();
}

async function submit(page, pathnameSuffix, button) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix), { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

async function expectAccessibleReflow(page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const duplicateIds = await page.locator('[id]').evaluateAll(elements => {
    const ids = elements.map(element => element.id).filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  expect(duplicateIds).toEqual([]);
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

test('certifies reversible connection and block lifecycles through Web UK', async ({ page }) => {
  const viewerAuth = await login(smoke.email, smoke.password, smoke.tenant);
  const viewerToken = viewerAuth.access_token;
  const viewer = objectFrom(await getProfile(viewerToken));
  const target = await safeTarget(viewerToken, Number(viewer.id));
  if (!target) throw new Error('No visible member has a clean no-connection, no-block state for a reversible fixture.');
  const targetId = Number(target.id);
  const targetName = String(target.name || target.display_name || `${target.first_name || ''} ${target.last_name || ''}`).trim();
  const initialBlock = objectFrom(await getUserBlockStatus(viewerToken, targetId));
  const connection = objectFrom(await getMemberConnectionStatus(viewerToken, targetId));
  let connectionAdded = false;
  let blockAdded = false;

  expect(viewerToken).toBeTruthy();
  expect(targetId).toBeGreaterThan(0);
  expect(targetName).toBeTruthy();
  expect(initialBlock.is_blocked).toBe(false);
  expect(initialBlock.is_blocked_by).toBe(false);
  expect(['none', null, undefined]).toContain(connection.status);
  console.log(`Disposable block target: ${targetName} (${targetId})`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/members/${targetId}`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toContainText(targetName);

    const connectForm = page.locator(`form[action$="/members/${targetId}/connection"]`, { has: page.locator('input[value="connect"]') });
    const connectResponse = await submit(page, `/members/${targetId}/connection`, connectForm.locator('button'));
    expect(connectResponse.status()).toBe(302);
    connectionAdded = true;
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('Your connection request has been sent.', { exact: true })).toHaveCount(1);
    expect(objectFrom(await getMemberConnectionStatus(viewerToken, targetId)).status).toBe('pending_sent');
    await expectAccessibleReflow(page);

    const cancelForm = page.locator(`form[action$="/members/${targetId}/connection"]`, { has: page.locator('input[value="cancel"]') });
    const cancelResponse = await submit(page, `/members/${targetId}/connection`, cancelForm.locator('button'));
    expect(cancelResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('Your connection request has been cancelled.', { exact: true })).toHaveCount(1);
    expect(objectFrom(await getMemberConnectionStatus(viewerToken, targetId)).status).toBe('none');
    connectionAdded = false;
    await expectAccessibleReflow(page);

    const blockDetails = page.locator('details', { hasText: 'Block this member' });
    await blockDetails.locator('summary').click();
    await expect(blockDetails).toContainText('Blocking stops this member from seeing your profile or contacting you.');
    const blockResponse = await submit(page, `/members/${targetId}/block`, blockDetails.locator('form[action$="/block"] button'));
    expect(blockResponse.status()).toBe(302);
    blockAdded = true;
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Blocked members');
    await expect(page.getByText('The member has been blocked.', { exact: true })).toHaveCount(1);
    expect(objectFrom(await getUserBlockStatus(viewerToken, targetId)).is_blocked).toBe(true);
    await expectAccessibleReflow(page);

    const blockedCard = page.locator('.nexus-alpha-card', { hasText: targetName });
    await expect(blockedCard).toHaveCount(1);
    const blockedAvatar = blockedCard.locator('img.nexus-alpha-avatar');
    if (await blockedAvatar.count()) {
      const avatarUrl = await blockedAvatar.getAttribute('src');
      expect(new URL(avatarUrl).origin).toBe(new URL(smoke.laravelBaseUrl).origin);
    }
    await expectAccessibleReflow(page);
    const unblockResponse = await submit(page, `/members/${targetId}/unblock`, blockedCard.locator('form[action$="/unblock"] button'));
    expect(unblockResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('The member has been unblocked.', { exact: true })).toHaveCount(1);
    await expect(page.locator('.nexus-alpha-card', { hasText: targetName })).toHaveCount(0);
    expect(objectFrom(await getUserBlockStatus(viewerToken, targetId)).is_blocked).toBe(false);
    blockAdded = false;
    await expectAccessibleReflow(page);
  } finally {
    if (blockAdded) await unblockMember(viewerToken, targetId);
    if (connectionAdded) {
      const current = objectFrom(await getMemberConnectionStatus(viewerToken, targetId));
      const connectionId = Number(current.id || current.connection_id);
      if (connectionId > 0) {
        await removeMemberConnection(viewerToken, connectionId);
      }
    }
  }
});
