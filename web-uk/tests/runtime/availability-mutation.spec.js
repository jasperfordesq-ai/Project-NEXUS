// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callUserSettingsApi, login } = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;

function weeklyRows(result) {
  const data = result?.data ?? result;
  return Array.isArray(data?.weekly) ? data.weekly : [];
}

function recurringSchedule(result) {
  return weeklyRows(result)
    .filter(slot => slot?.is_recurring !== false && slot?.is_recurring !== 0)
    .map(slot => ({
      day_of_week: Number(slot.day_of_week),
      start_time: String(slot.start_time || '').slice(0, 5),
      end_time: String(slot.end_time || '').slice(0, 5)
    }))
    .filter(slot => Number.isInteger(slot.day_of_week) && slot.day_of_week >= 0 && slot.day_of_week <= 6 && slot.start_time && slot.end_time)
    .sort((left, right) => (
      left.day_of_week - right.day_of_week
      || left.start_time.localeCompare(right.start_time)
      || left.end_time.localeCompare(right.end_time)
    ));
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

async function fillSchedule(page, schedule) {
  const slotsByDay = new Map();
  for (const slot of schedule) {
    const slots = slotsByDay.get(slot.day_of_week) || [];
    slots.push(slot);
    slotsByDay.set(slot.day_of_week, slots);
  }

  for (const [, slots] of slotsByDay) {
    expect(slots.length).toBeLessThanOrEqual(3);
  }

  const inputs = page.locator('input[type="time"]');
  for (let index = 0; index < await inputs.count(); index += 1) {
    await inputs.nth(index).fill('');
  }

  for (const [day, slots] of slotsByDay) {
    for (let index = 0; index < slots.length; index += 1) {
      await page.locator(`#start-${day}-${index}`).fill(slots[index].start_time);
      await page.locator(`#end-${day}-${index}`).fill(slots[index].end_time);
    }
  }
}

async function submitAvailability(page) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/settings/availability'), { timeout: 300_000 });
  await page.locator('form:has(input[type="time"]) button').click();
  const response = await responsePromise;
  expect(response.status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
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

test('changes and restores the signed member weekly availability through Web UK', async ({ page }) => {
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  const initialSchedule = recurringSchedule(await callUserSettingsApi(token, 'GET', '/availability'));
  const changedSchedule = [{ day_of_week: 2, start_time: '09:17', end_time: '10:43' }];
  let availabilityChanged = false;

  expect(token).toBeTruthy();

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/settings/availability`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Your availability');
    await expect(page.getByText('Set your weekly availability so others can find times that work for both of you.', { exact: false })).toHaveCount(1);

    await fillSchedule(page, changedSchedule);
    availabilityChanged = true;
    await submitAvailability(page);
    await expect(page.getByText('Your availability has been saved.', { exact: true })).toHaveCount(1);
    await expect(page.locator('#start-2-0')).toHaveValue('09:17');
    await expect(page.locator('#end-2-0')).toHaveValue('10:43');
    expect(recurringSchedule(await callUserSettingsApi(token, 'GET', '/availability'))).toEqual(changedSchedule);
    await expectAccessibleReflow(page);

    await fillSchedule(page, initialSchedule);
    await submitAvailability(page);
    expect(recurringSchedule(await callUserSettingsApi(token, 'GET', '/availability'))).toEqual(initialSchedule);
    availabilityChanged = false;
  } finally {
    if (availabilityChanged) {
      await callUserSettingsApi(token, 'PUT', '/availability', { schedule: initialSchedule });
    }
    expect(recurringSchedule(await callUserSettingsApi(token, 'GET', '/availability'))).toEqual(initialSchedule);
  }
});
