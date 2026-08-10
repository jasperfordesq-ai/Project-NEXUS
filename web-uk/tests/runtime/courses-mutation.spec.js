// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callCourseApi, login } = require('../../src/lib/api');

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

function objectFrom(result) {
  const data = result?.data ?? result;
  return data?.course && typeof data.course === 'object' ? data.course : data;
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
  if (await rejectCookies.isVisible()) {
    await rejectCookies.click();
  }
}

async function submit(page, pathnameSuffix, button) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix), { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

async function findByTitle(token, title) {
  const result = await callCourseApi(token, 'GET', '/mine');
  return rowsFrom(result).find(course => course?.title === title) || null;
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

test('certifies a disposable course authoring lifecycle through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdTitle = `Codex disposable course ${runId}`;
  const updatedTitle = `${createdTitle} updated`;
  const sectionTitle = `Disposable section ${runId}`;
  const renamedSectionTitle = `${sectionTitle} renamed`;
  const lessonTitle = `Disposable lesson ${runId}`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let courseId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable course fixture: ${createdTitle}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/courses/instructor/new`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Create a course');
    await expect(page.locator('.govuk-caption-l')).toContainText('Hour Timebank');
    await page.locator('#title').fill(createdTitle);
    await page.locator('#summary').fill('Disposable Laravel course mutation fixture.');
    await page.locator('#description').fill('Created by the Web UK runtime gate and removed before the gate exits.');
    await page.locator('input[name="level"][value="beginner"]').check();
    await page.locator('input[name="visibility"][value="members"]').check();
    await page.locator('input[name="enrollment_type"][value="self_paced"]').check();
    await page.locator('#credit_cost').fill('0');
    const createResponse = await submit(page, '/courses/instructor/new', page.locator('form:has(#title) button'));
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    const created = await findByTitle(token, createdTitle);
    expect(created).toBeTruthy();
    courseId = Number(created.id);
    expect(courseId).toBeGreaterThan(0);
    await expect(page.locator('h1')).toHaveText('Edit your course');
    await expect(page.locator('#title')).toHaveValue(createdTitle);
    await expectAccessibleReflow(page);

    await page.locator('#title').fill(updatedTitle);
    await page.locator('#summary').fill('Updated disposable Laravel course fixture.');
    await page.locator('input[name="level"][value="intermediate"]').check();
    await page.locator('input[name="visibility"][value="public"]').check();
    await page.locator('input[name="enrollment_type"][value="cohort"]').check();
    await page.locator('#credit_cost').fill('3');
    const editResponse = await submit(page, `/courses/instructor/${courseId}/update`, page.locator('form:has(#title) button'));
    expect(editResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    const updated = objectFrom(await callCourseApi(token, 'GET', `/${courseId}`));
    expect(updated.title).toBe(updatedTitle);
    expect(updated.level).toBe('intermediate');
    expect(updated.visibility).toBe('public');
    expect(updated.enrollment_type ?? updated.enrollmentType).toBe('cohort');
    expect(Number(updated.credit_cost ?? updated.creditCost)).toBe(3);
    await expectAccessibleReflow(page);

    await page.locator('#section_title').fill(sectionTitle);
    const sectionResponse = await submit(page, `/courses/instructor/${courseId}/sections`, page.locator('form:has(#section_title) button'));
    expect(sectionResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    let sectionCard = page.locator('.nexus-alpha-card', { hasText: sectionTitle });
    await expect(sectionCard).toHaveCount(1);
    const sectionAction = await sectionCard.locator('form[action$="/update"]').getAttribute('action');
    const sectionId = Number(sectionAction.match(/\/sections\/(\d+)\/update$/)?.[1]);
    expect(sectionId).toBeGreaterThan(0);

    await sectionCard.locator('details summary').click();
    await sectionCard.locator(`#rename-section-${sectionId}`).fill(renamedSectionTitle);
    const renameResponse = await submit(page, `/courses/instructor/${courseId}/sections/${sectionId}/update`, sectionCard.locator('form[action$="/update"] button'));
    expect(renameResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    sectionCard = page.locator('.nexus-alpha-card', { hasText: renamedSectionTitle });
    await expect(sectionCard).toHaveCount(1);

    await page.locator('#lesson_title').fill(lessonTitle);
    await page.locator('#section_id').selectOption(String(sectionId));
    await page.locator('#content_type').selectOption('text');
    await page.locator('#body').fill('Disposable lesson content.');
    const lessonResponse = await submit(page, `/courses/instructor/${courseId}/lessons`, page.locator('form:has(#lesson_title) button'));
    expect(lessonResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    sectionCard = page.locator('.nexus-alpha-card', { hasText: renamedSectionTitle });
    await expect(sectionCard).toContainText(lessonTitle);

    const lessonDelete = sectionCard.locator('form[action*="/lessons/"][action$="/delete"]');
    const lessonDeleteAction = await lessonDelete.getAttribute('action');
    const lessonDeleteResponse = await submit(page, new URL(lessonDeleteAction, 'http://localhost').pathname, lessonDelete.locator('button'));
    expect(lessonDeleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('.nexus-alpha-card', { hasText: renamedSectionTitle })).not.toContainText(lessonTitle);

    sectionCard = page.locator('.nexus-alpha-card', { hasText: renamedSectionTitle });
    await sectionCard.locator('details summary').click();
    const sectionDeleteResponse = await submit(page, `/courses/instructor/${courseId}/sections/${sectionId}/delete`, sectionCard.locator('form[action$="/delete"] button'));
    expect(sectionDeleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('.nexus-alpha-card', { hasText: renamedSectionTitle })).toHaveCount(0);

    const courseDeleteResponse = await submit(page, `/courses/instructor/${courseId}/delete`, page.locator(`form[action$="/courses/instructor/${courseId}/delete"] button`));
    expect(courseDeleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await findByTitle(token, updatedTitle)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted && courseId) await callCourseApi(token, 'DELETE', `/${courseId}`);
  }
});
