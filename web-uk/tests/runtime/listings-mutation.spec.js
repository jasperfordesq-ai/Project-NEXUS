// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const {
  deleteListing,
  getListing,
  getListings,
  login
} = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function rowsFrom(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.data)) return result.data.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith('/login');
  }, { timeout: 300_000 });
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function findByTitle(token, title) {
  const result = await getListings(token, { search: title, per_page: 100 });
  return rowsFrom(result).find((listing) => listing?.title === title) || null;
}

async function submitListingForm(page, pathnameSuffix, button) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith(pathnameSuffix);
  }, { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

async function expectAccessibleReflow(page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map(element => element.id).filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  expect(duplicateIds).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

test('creates, updates, uploads an image for, and deletes a disposable listing', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdTitle = `Codex disposable listing ${runId}`;
  const updatedTitle = `${createdTitle} updated`;
  const comment = `Disposable listing comment ${runId}`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let listingId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable listing fixture: ${createdTitle}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/listings/new`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });

    await page.locator('input[name="type"][value="offer"]').check();
    await page.locator('#title').fill(createdTitle);
    await page.locator('#description').fill('Disposable Laravel listing mutation fixture created by the Web UK runtime gate.');
    const category = page.locator('#category_id option[value]:not([value=""])').first();
    const categoryValue = await category.getAttribute('value');
    expect(categoryValue).toBeTruthy();
    await page.locator('#category_id').selectOption(categoryValue);
    if (await page.locator('input[name="service_type"][value="physical_only"]').count()) {
      await page.locator('input[name="service_type"][value="physical_only"]').check();
    }
    await page.locator('#image').setInputFiles({
      name: `codex-listing-${runId}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    });

    const createResponse = await submitListingForm(
      page,
      '/listings/new',
      page.locator('form:has(#title) button[type="submit"]')
    );
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    const created = await findByTitle(token, createdTitle);
    expect(created).toBeTruthy();
    listingId = Number(created.id);
    expect(listingId).toBeGreaterThan(0);
    const createdDetail = await getListing(token, listingId);
    const createdRow = createdDetail?.data?.listing || createdDetail?.data || createdDetail?.listing || createdDetail;
    expect(createdRow.image_url ?? createdRow.imageUrl).toBeTruthy();
    expect(new URL(page.url()).pathname).toBe(`${mountPath}/listings/${listingId}`);
    await expect(page.locator('h1')).toContainText(createdTitle);
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/listings/${listingId}/edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    const currentImageSrc = await page.locator(`img[alt="${createdTitle}"]`).getAttribute('src');
    expect(currentImageSrc).toBeTruthy();
    expect(new URL(currentImageSrc).origin).toBe(new URL(smoke.laravelBaseUrl).origin);
    expect((await page.request.get(currentImageSrc, { timeout: 300_000 })).status()).toBe(200);
    await expectAccessibleReflow(page);
    await page.locator('#title').fill(updatedTitle);
    const updateResponse = await submitListingForm(
      page,
      `/listings/${listingId}/edit`,
      page.locator('form:has(#title) button[type="submit"]')
    );
    expect(updateResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('h1')).toContainText(updatedTitle);
    expect(await findByTitle(token, createdTitle)).toBeNull();
    expect(await findByTitle(token, updatedTitle)).toBeTruthy();

    await page.goto(`${mountPath}/listings/${listingId}/comments`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#body').fill(comment);
    const commentResponse = await submitListingForm(
      page,
      `/listings/${listingId}/comments`,
      page.locator('form:has(#body) button[type="submit"]')
    );
    expect(commentResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText(comment, { exact: true })).toBeVisible();
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/listings/${listingId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expectAccessibleReflow(page);

    const deleteDetails = page.locator(`details:has(form[action$="/listings/${listingId}/delete"])`);
    await deleteDetails.locator('summary').click();
    const deleteButton = deleteDetails.locator('button[type="submit"]');
    await expect(deleteButton).toBeVisible();

    const deleteResponse = await submitListingForm(
      page,
      `/listings/${listingId}/delete`,
      deleteButton
    );
    expect(deleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await findByTitle(token, updatedTitle)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted) {
      const existing = await findByTitle(token, updatedTitle) || await findByTitle(token, createdTitle);
      if (existing) await deleteListing(token, existing.id);
    }
  }
});
