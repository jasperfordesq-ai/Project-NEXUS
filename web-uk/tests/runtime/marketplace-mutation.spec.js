// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callMarketplaceApi, login } = require('../../src/lib/api');

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

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function localDateTime(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

async function submitPost(page, button, pathnameSuffix) {
  const requestPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith(pathnameSuffix);
  }, { timeout: 300_000 });
  await button.click();
  const response = await requestPromise;
  expect(response.status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
  return response;
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  await submitPost(
    page,
    page.locator('form:has(input[name="password"]) button[type="submit"]'),
    '/login'
  );
}

async function findByTitle(token, title) {
  const result = await callMarketplaceApi(token, 'GET', `/listings?q=${encodeURIComponent(title)}&limit=100`);
  return rowsFrom(result).find((listing) => listing?.title === title) || null;
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

test('creates, edits, and deletes a disposable marketplace listing', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const title = `Codex disposable marketplace listing ${runId}`;
  const updatedTitle = `${title} updated`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let listingId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable marketplace fixture: ${title}`);

  try {
    await authenticate(page);
    await page.goto(`${mountPath}/marketplace/create`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#title').fill(title);
    await page.locator('#tagline').fill('Disposable marketplace lifecycle fixture.');
    await page.locator('#description').fill('A disposable listing used to certify create, edit, and delete behavior.');
    await page.locator('#price_type-free').check();
    await page.locator('#condition').selectOption('good');
    await page.locator('#delivery_method').check();
    await page.locator('#location').fill('Disposable fixture');
    await page.locator('#quantity').fill('1');
    await submitPost(page, page.getByRole('button', { name: 'Publish listing', exact: true }), '/marketplace/create');
    let created = await findByTitle(token, title);
    expect(created).toBeTruthy();
    listingId = Number(created.id);
    expect(listingId).toBeGreaterThan(0);

    await page.goto(`${mountPath}/marketplace/${listingId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expect(page.locator('h1')).toContainText(title);

    await page.goto(`${mountPath}/marketplace/${listingId}/edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#title').fill(updatedTitle);
    await submitPost(page, page.getByRole('button', { name: 'Save changes', exact: true }), `/marketplace/${listingId}/update`);
    created = dataFrom(await callMarketplaceApi(token, 'GET', `/listings/${listingId}`));
    expect(created?.title).toBe(updatedTitle);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${mountPath}/marketplace/${listingId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expect(page.locator('h1')).toContainText(updatedTitle);
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/marketplace/mine?tab=active`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    const deleteForm = page.locator(`form[action$="/marketplace/${listingId}/delete"]`);
    await expect(deleteForm).toHaveCount(1);
    await submitPost(page, deleteForm.locator('button'), `/marketplace/${listingId}/delete`);

    expect(await findByTitle(token, updatedTitle)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted) {
      const existing = listingId
        ? dataFrom(await callMarketplaceApi(token, 'GET', `/listings/${listingId}`).catch(() => null))
        : await findByTitle(token, updatedTitle) || await findByTitle(token, title);
      if (existing?.id) {
        await callMarketplaceApi(token, 'DELETE', `/listings/${existing.id}`);
      }
    }
  }
});

test('creates, edits, and deletes a disposable seller pickup slot', async ({ page }) => {
  const start = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  start.setSeconds(0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const updatedEnd = new Date(start.getTime() + 60 * 60 * 1000);
  const startInput = localDateTime(start);
  const endInput = localDateTime(end);
  const updatedEndInput = localDateTime(updatedEnd);
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let slotId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable pickup slot fixture: ${startInput}`);

  const findSlot = async () => {
    const result = await callMarketplaceApi(token, 'GET', '/seller/pickup-slots');
    return rowsFrom(result).find((slot) => String(slot?.slot_start || slot?.slotStart).startsWith(startInput)) || null;
  };

  try {
    await authenticate(page);
    await page.goto(`${mountPath}/marketplace/slots`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#slot_start').fill(startInput);
    await page.locator('#slot_end').fill(endInput);
    await page.locator('#capacity').fill('2');
    await page.locator('#is_recurring').uncheck();
    await page.locator('#is_active').check();
    await submitPost(page, page.getByRole('button', { name: 'Add slot', exact: true }), '/marketplace/slots');

    let slot = await findSlot();
    expect(slot).toBeTruthy();
    slotId = Number(slot.id);
    expect(slotId).toBeGreaterThan(0);
    expect(Number(slot.capacity)).toBe(2);

    await page.goto(`${mountPath}/marketplace/slots/${slotId}/edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#slot_end').fill(updatedEndInput);
    await page.locator('#capacity').fill('3');
    await page.locator('#is_recurring').check();
    await page.locator('#is_active').uncheck();
    await submitPost(page, page.getByRole('button', { name: 'Save changes', exact: true }), `/marketplace/slots/${slotId}/update`);

    slot = await findSlot();
    expect(slot).toBeTruthy();
    expect(Number(slot.capacity)).toBe(3);
    expect([true, 1, '1'].includes(slot.is_recurring ?? slot.isRecurring)).toBe(true);
    expect([false, 0, '0'].includes(slot.is_active ?? slot.isActive)).toBe(true);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${mountPath}/marketplace/slots/${slotId}/edit`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expect(page.locator('#slot_end')).toHaveValue(updatedEndInput);
    await expect(page.locator('#capacity')).toHaveValue('3');
    await expect(page.locator('#is_recurring')).toBeChecked();
    await expect(page.locator('#is_active')).not.toBeChecked();
    await expectAccessibleReflow(page);

    await submitPost(
      page,
      page.locator(`form[action$="/marketplace/slots/${slotId}/delete"] button`),
      `/marketplace/slots/${slotId}/delete`
    );
    expect(await findSlot()).toBeNull();
    deleted = true;
  } finally {
    if (!deleted) {
      const existing = slotId ? { id: slotId } : await findSlot();
      if (existing?.id) {
        await callMarketplaceApi(token, 'DELETE', `/seller/pickup-slots/${existing.id}`).catch(() => undefined);
      }
    }
  }
});
