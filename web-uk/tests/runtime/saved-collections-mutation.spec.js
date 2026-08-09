// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const {
  getBookmarks,
  getListings,
  getSavedCollectionItems,
  login,
  saveSavedItem,
  toggleBookmark
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

function bookmarkPair(row) {
  const rawType = String(row?.bookmarkable_type ?? row?.bookmarkableType ?? '').split('\\').pop().toLowerCase();
  const id = Number(row?.bookmarkable_id ?? row?.bookmarkableId);
  return `${rawType}:${id}`;
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

async function openCollections(page, status = '') {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const target = `${mountPath}/me/collections${query}`;
  await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 180_000
  });
  if (new URL(page.url()).pathname.endsWith('/login')) {
    await authenticate(page);
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  }
}

async function collectionPathByName(page, names) {
  for (const name of names) {
    const link = page.getByRole('link', { name, exact: true }).first();
    if (await link.count()) return link.getAttribute('href');
  }
  return '';
}

async function submitPost(page, button, pathnameSuffix) {
  const submission = await button.evaluate((element) => {
    const form = element.form;
    if (!form) throw new Error('Mutation button is not associated with a form.');
    return {
      action: form.action,
      fields: Object.fromEntries([...new FormData(form).entries()].filter(([, value]) => typeof value === 'string'))
    };
  });
  if (!new URL(submission.action).pathname.endsWith(pathnameSuffix)) {
    throw new Error(`Expected form action ending ${pathnameSuffix}, got ${submission.action}`);
  }
  return page.request.post(submission.action, {
    form: submission.fields,
    maxRedirects: 0,
    timeout: 180_000
  });
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const loginResponse = await submitPost(
    page,
    page.locator('form:has(input[name="password"]) button[type="submit"]'),
    '/login'
  );
  expect(loginResponse.status()).toBe(302);
}

async function cleanupNamedCollections(page, names) {
  for (const name of names) {
    await openCollections(page);
    const path = await collectionPathByName(page, [name]);
    if (!path) continue;
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    await page.locator('details.govuk-details').evaluate((details) => { details.open = true; });
    const response = await submitPost(
      page,
      page.locator('form[action$="/delete"] button[type="submit"]'),
      '/delete'
    );
    expect(response.status()).toBe(302);
  }
}

test('creates, updates, and deletes a disposable saved collection', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdName = `Codex disposable collection ${runId}`;
  const updatedName = `${createdName} updated`;
  let collectionPath = '';
  let deleted = false;

  console.log(`Disposable collection fixture: ${createdName}`);

  await page.setViewportSize({ width: 320, height: 640 });
  await authenticate(page);
  const recoveryNames = JSON.parse(process.env.WEB_UK_SAVED_COLLECTION_RECOVERY_NAMES || '[]');
  await cleanupNamedCollections(page, recoveryNames);

  try {
    await openCollections(page);
    let createResponse;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await page.locator('#collection-name').fill(createdName);
      await page.locator('#collection-description').fill('Disposable Laravel mutation smoke fixture.');
      createResponse = await submitPost(
        page,
        page.getByRole('button', { name: 'Create collection', exact: true }),
        '/me/collections'
      );
      if (createResponse.status() === 302) break;

      await openCollections(page);
      collectionPath = await collectionPathByName(page, [createdName, updatedName]);
      if (collectionPath) break;
      if (attempt === 2) expect(createResponse.status()).toBe(302);
    }

    await openCollections(page, 'collection-created');

    await expect(page.locator('.govuk-notification-banner')).toContainText('Collection created.');
    collectionPath = collectionPath || await collectionPathByName(page, [createdName]);
    expect(collectionPath).toMatch(/\/me\/collections\/\d+$/);
    await expectAccessibleReflow(page);

    await page.goto(collectionPath, { waitUntil: 'domcontentloaded' });
    await page.locator('details.govuk-details').evaluate((details) => { details.open = true; });
    await page.locator('#edit-collection-name').fill(updatedName);
    await page.locator('#edit-collection-description').fill('Updated disposable Laravel mutation smoke fixture.');
    const updateResponse = await submitPost(
      page,
      page.locator('form[action$="/update"] button[type="submit"]'),
      '/update'
    );
    expect(updateResponse.status()).toBe(302);
    await page.goto(`${collectionPath}?status=collection-updated`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000
    });

    await expect(page.locator('h1')).toContainText(updatedName);
    await expect(page.locator('.govuk-notification-banner')).toContainText('Collection updated.');
    await expectAccessibleReflow(page);

    const auth = await login(smoke.email, smoke.password, smoke.tenant);
    const token = auth.access_token;
    expect(token).toBeTruthy();
    const collectionId = Number(collectionPath.split('/').pop());
    expect(collectionId).toBeGreaterThan(0);

    const listing = rowsFrom(await getListings(token, { limit: 100 }))
      .find((row) => Number.isInteger(Number(row?.id)) && Number(row.id) > 0);
    expect(listing).toBeTruthy();
    const listingId = Number(listing.id);
    await saveSavedItem(token, {
      collection_id: collectionId,
      item_type: 'listing',
      item_id: listingId,
      note: 'Disposable Laravel collection-item mutation smoke fixture.'
    });

    await page.goto(collectionPath, { waitUntil: 'domcontentloaded', timeout: 180_000 });
    const collectionItems = rowsFrom(await getSavedCollectionItems(token, collectionId, {
      page: 1,
      per_page: 20
    }));
    const savedItem = collectionItems.find((row) => (
      String(row?.item_type ?? row?.itemType) === 'listing'
      && Number(row?.item_id ?? row?.itemId) === listingId
    ));
    expect(savedItem).toBeTruthy();
    const savedItemId = Number(savedItem.id);

    const removeForm = page.locator(`form[action$="/items/${savedItemId}/remove"]`);
    await expect(removeForm).toHaveCount(1);
    await expect(removeForm).toContainText('Remove');
    const removeResponse = await submitPost(
      page,
      removeForm.locator('button[type="submit"], button:not([type])'),
      `/items/${savedItemId}/remove`
    );
    expect(removeResponse.status()).toBe(302);

    await page.goto(`${collectionPath}?status=item-removed`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000
    });
    await expect(page.locator('.govuk-notification-banner')).toContainText('Item removed from the collection.');
    await expect(removeForm).toHaveCount(0);
    const remainingItems = rowsFrom(await getSavedCollectionItems(token, collectionId, {
      page: 1,
      per_page: 20
    }));
    expect(remainingItems.some((row) => Number(row?.id) === savedItemId)).toBe(false);
    await expectAccessibleReflow(page);

    await page.locator('details.govuk-details').evaluate((details) => { details.open = true; });
    const deleteResponse = await submitPost(
      page,
      page.locator('form[action$="/delete"] button[type="submit"]'),
      '/delete'
    );
    expect(deleteResponse.status()).toBe(302);

    await openCollections(page, 'collection-deleted');

    await expect(page.locator('.govuk-notification-banner')).toContainText('Collection deleted.');
    await expect(page.getByRole('link', { name: updatedName, exact: true })).toHaveCount(0);
    await expectAccessibleReflow(page);
    deleted = true;
  } finally {
    if (!deleted) {
      await openCollections(page);
      collectionPath = collectionPath || await collectionPathByName(page, [updatedName, createdName]);
    }
    if (collectionPath && !deleted) {
      const response = await page.goto(collectionPath, {
        waitUntil: 'domcontentloaded',
        timeout: 180_000
      });
      if (response && response.status() < 400) {
        const deleteButton = page.locator('form[action$="/delete"] button[type="submit"]');
        if (await deleteButton.count()) {
          await page.locator('details.govuk-details').evaluate((details) => { details.open = true; });
          const cleanupResponse = await submitPost(page, deleteButton, '/delete');
          expect(cleanupResponse.status()).toBe(302);
        }
      }
    }
  }
});

test('creates and removes a disposable flat bookmark through Web UK', async ({ page }) => {
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  expect(token).toBeTruthy();

  const [listingResult, initialBookmarkResult] = await Promise.all([
    getListings(token, { limit: 100 }),
    getBookmarks(token, { type: 'listing', page: 1, per_page: 100 })
  ]);
  const savedPairs = new Set(rowsFrom(initialBookmarkResult).map(bookmarkPair));
  const listing = rowsFrom(listingResult).find((row) => {
    const id = Number(row?.id);
    return Number.isInteger(id) && id > 0 && !savedPairs.has(`listing:${id}`);
  });
  expect(listing).toBeTruthy();

  const listingId = Number(listing.id);
  let bookmarkAdded = false;

  try {
    await toggleBookmark(token, 'listing', listingId);
    bookmarkAdded = true;

    await authenticate(page);
    await page.goto(`${mountPath}/saved?type=listing`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });

    const removeForm = page.locator(
      `form[action$="/saved/destroy"]:has(input[name="type"][value="listing"]):has(input[name="id"][value="${listingId}"])`
    );
    await expect(removeForm).toHaveCount(1);

    const removeResponse = await submitPost(
      page,
      removeForm.locator('button[type="submit"], button:not([type])'),
      '/saved/destroy'
    );
    expect(removeResponse.status()).toBe(302);

    await page.goto(`${mountPath}/saved?type=listing&status=bookmark-removed`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expect(removeForm).toHaveCount(0);

    const finalPairs = new Set(rowsFrom(await getBookmarks(token, {
      type: 'listing',
      page: 1,
      per_page: 100
    })).map(bookmarkPair));
    expect(finalPairs.has(`listing:${listingId}`)).toBe(false);
    bookmarkAdded = false;
  } finally {
    if (bookmarkAdded) {
      const currentPairs = new Set(rowsFrom(await getBookmarks(token, {
        type: 'listing',
        page: 1,
        per_page: 100
      })).map(bookmarkPair));
      if (currentPairs.has(`listing:${listingId}`)) {
        await toggleBookmark(token, 'listing', listingId);
      }
    }
  }
});
