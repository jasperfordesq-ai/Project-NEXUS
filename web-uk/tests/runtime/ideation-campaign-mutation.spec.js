// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callIdeationApi, login } = require('../../src/lib/api');

const smoke = resolveOptions({
  email: process.env.SMOKE_ADMIN_EMAIL || process.env.E2E_ADMIN_EMAIL || 'e2e.admin@project-nexus.local',
  password: process.env.SMOKE_ADMIN_PASSWORD || process.env.E2E_ADMIN_PASSWORD || 'AdminPassword123!'
}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  return [];
}

function objectFrom(result) {
  const data = result?.data ?? result;
  return data?.data && typeof data.data === 'object' ? data.data : data;
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/login'), { timeout: 300_000 });
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function submit(page, pathnameSuffix, button) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix), { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

async function campaigns(token) {
  return rowsFrom(await callIdeationApi(token, 'GET', '/ideation-campaigns?per_page=100'));
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

test('certifies a disposable Ideation campaign lifecycle through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdTitle = `Codex disposable campaign ${runId}`;
  const updatedTitle = `${createdTitle} updated`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let campaignId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable Ideation campaign fixture: ${createdTitle}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/ideation/campaigns`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Campaigns');
    await expect(page.locator('#create')).toHaveText('Create a campaign');
    await page.locator('#campaign_title').fill(createdTitle);
    await page.locator('#campaign_description').fill('Disposable Laravel campaign created through the Web UK admin workflow.');
    await page.locator('#campaign_cover_image').fill('https://example.test/disposable-campaign.jpg');
    await page.locator('#campaign_start_date').fill('2026-08-01');
    await page.locator('#campaign_end_date').fill('2026-09-30');
    await page.locator('#campaign-status-active').check();

    const createResponse = await submit(page, '/ideation/campaigns', page.locator('form:has(#campaign_title) button[type="submit"]'));
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    campaignId = Number(new URL(page.url()).pathname.match(/\/ideation\/campaigns\/(\d+)$/)?.[1]);
    expect(campaignId).toBeGreaterThan(0);
    await expect(page.locator('h1')).toHaveText(createdTitle);
    await expect(page.getByText('The campaign has been created.', { exact: true })).toHaveCount(1);
    await expect(page.locator('#edit')).toHaveText('Edit campaign');
    await expectAccessibleReflow(page);

    let campaign = objectFrom(await callIdeationApi(token, 'GET', `/ideation-campaigns/${campaignId}`));
    expect(campaign.title).toBe(createdTitle);
    expect(campaign.description).toBe('Disposable Laravel campaign created through the Web UK admin workflow.');
    expect(campaign.status).toBe('active');
    expect(campaign.start_date).toBe('2026-08-01');
    expect(campaign.end_date).toBe('2026-09-30');

    await page.locator('#campaign_title').fill(updatedTitle);
    await page.locator('#campaign_description').fill('Updated disposable campaign description.');
    await page.locator('#edit-campaign-status-completed').check();
    const updateResponse = await submit(page, `/ideation/campaigns/${campaignId}`, page.locator('form:has(#campaign_title) button[type="submit"]'));
    expect(updateResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText(updatedTitle);
    await expect(page.getByText('The campaign has been updated.', { exact: true })).toHaveCount(1);
    campaign = objectFrom(await callIdeationApi(token, 'GET', `/ideation-campaigns/${campaignId}`));
    expect(campaign.title).toBe(updatedTitle);
    expect(campaign.description).toBe('Updated disposable campaign description.');
    expect(campaign.status).toBe('completed');
    await expectAccessibleReflow(page);

    const deleteDetails = page.locator('details', { hasText: 'Delete campaign' });
    await deleteDetails.locator('summary').click();
    await expect(deleteDetails).toContainText('Deleting a campaign unlinks its challenges.');
    const deleteResponse = await submit(page, `/ideation/campaigns/${campaignId}/delete`, deleteDetails.locator('button[type="submit"]'));
    expect(deleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Campaigns');
    await expect(page.getByText('The campaign has been deleted.', { exact: true })).toHaveCount(1);
    expect((await campaigns(token)).some(item => Number(item?.id) === campaignId)).toBe(false);
    deleted = true;
    await expectAccessibleReflow(page);
  } finally {
    if (!deleted && campaignId) {
      await callIdeationApi(token, 'DELETE', `/ideation-campaigns/${campaignId}`);
    }
  }
});
