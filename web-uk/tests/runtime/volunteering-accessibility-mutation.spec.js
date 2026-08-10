// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callVolunteeringApi, login } = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function rowsFrom(result) {
  const data = result && typeof result === 'object' && result.data !== undefined ? result.data : result;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.needs)) return data.needs;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function normalizedNeeds(result) {
  return rowsFrom(result).map((row) => ({
    need_type: String(row?.need_type || row?.needType || ''),
    description: row?.description ? String(row.description) : null,
    accommodations_required: (row?.accommodations_required ?? row?.accommodationsRequired)
      ? String(row.accommodations_required ?? row.accommodationsRequired)
      : null,
    emergency_contact_name: (row?.emergency_contact_name ?? row?.emergencyContactName)
      ? String(row.emergency_contact_name ?? row.emergencyContactName)
      : null,
    emergency_contact_phone: (row?.emergency_contact_phone ?? row?.emergencyContactPhone)
      ? String(row.emergency_contact_phone ?? row.emergencyContactPhone)
      : null
  })).filter((row) => row.need_type).sort((left, right) => left.need_type.localeCompare(right.need_type));
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/login')
  ), { timeout: 300_000 });
  await page.locator('form:has(input[name="password"]) button[type="submit"]').click({ noWaitAfter: true });
  expect((await responsePromise).status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function expectAccessibleReflow(page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map((element) => element.id).filter(Boolean);
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

test('changes and restores signed volunteering accessibility needs through Web UK', async ({ page }) => {
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  const initialNeeds = normalizedNeeds(await callVolunteeringApi(token, 'GET', '/accessibility-needs'));
  const marker = `Accessibility lifecycle proof ${Date.now()}`;
  const changedNeeds = ['hearing', 'mobility'].map((needType) => ({
    need_type: needType,
    description: marker,
    accommodations_required: 'Quiet step-free test space',
    emergency_contact_name: 'Lifecycle Test Contact',
    emergency_contact_phone: '0000000000'
  }));
  let changed = false;

  expect(token).toBeTruthy();

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/volunteering/accessibility`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Your accessibility needs');

    const checkboxes = page.locator('input[name="need_types[]"]');
    for (let index = 0; index < await checkboxes.count(); index += 1) {
      await checkboxes.nth(index).uncheck();
    }
    await page.locator('#need-hearing').check();
    await page.locator('#need-mobility').check();
    await page.locator('#description').fill(marker);
    await page.locator('#accommodations_required').fill('Quiet step-free test space');
    await page.locator('#emergency_contact_name').fill('Lifecycle Test Contact');
    await page.locator('#emergency_contact_phone').fill('0000000000');

    const responsePromise = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith('/volunteering/accessibility')
    ), { timeout: 300_000 });
    changed = true;
    await page.locator('form:has(#description) button').click();
    expect((await responsePromise).status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    await expect(page.getByText('Your accessibility needs have been saved.', { exact: true })).toHaveCount(1);
    await expect(page.locator('#need-hearing')).toBeChecked();
    await expect(page.locator('#need-mobility')).toBeChecked();
    await expect(page.locator('#description')).toHaveValue(marker);
    expect(normalizedNeeds(await callVolunteeringApi(token, 'GET', '/accessibility-needs'))).toEqual(changedNeeds);
    await expectAccessibleReflow(page);
  } finally {
    if (changed) {
      await callVolunteeringApi(token, 'PUT', '/accessibility-needs', { needs: initialNeeds });
    }
    expect(normalizedNeeds(await callVolunteeringApi(token, 'GET', '/accessibility-needs'))).toEqual(initialNeeds);
  }
});
