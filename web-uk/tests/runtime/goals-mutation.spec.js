// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callGoalApi, getGoals, login } = require('../../src/lib/api');

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

async function findByTitle(token, title) {
  const result = await getGoals(token, { per_page: 100 });
  return rowsFrom(result).find(goal => goal?.title === title) || null;
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

test('certifies a disposable goal, check-in, and reminder lifecycle through Web UK', async ({ page }) => {
  test.setTimeout(1_200_000);
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdTitle = `Codex disposable goal ${runId}`;
  const updatedTitle = `${createdTitle} updated`;
  const checkinNote = `Disposable goal check-in ${runId}`;
  const socialComment = `Disposable goal comment ${runId}`;
  const socialReply = `Disposable goal reply ${runId}`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let goalId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable goal fixture: ${createdTitle}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/goals`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.locator('#title').fill(createdTitle);
    await page.locator('#target_value').fill('10');
    await page.locator('#description').fill('Disposable Laravel goal mutation fixture created by the Web UK runtime gate.');
    const createResponse = await submit(page, '/goals', page.locator('form:has(#title) button'));
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    const created = await findByTitle(token, createdTitle);
    expect(created).toBeTruthy();
    goalId = Number(created.id);
    expect(goalId).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: createdTitle, exact: true })).toBeVisible();
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/goals/${goalId}/edit`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.locator('#title').fill(updatedTitle);
    await page.locator('#checkin_frequency').selectOption('weekly');
    const editResponse = await submit(page, `/goals/${goalId}/edit`, page.locator('form:has(#title) button[type="submit"]'));
    expect(editResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText(updatedTitle);
    expect(await findByTitle(token, createdTitle)).toBeNull();
    expect(await findByTitle(token, updatedTitle)).toBeTruthy();

    await page.goto(`${mountPath}/goals/${goalId}/checkin`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.locator('#progress_percent').fill('40');
    await page.locator('#mood-good').check();
    await page.locator('#note').fill(checkinNote);
    const checkinResponse = await submit(page, `/goals/${goalId}/checkin`, page.locator('form:has(#progress_percent) button[type="submit"]'));
    expect(checkinResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText(checkinNote, { exact: true })).toBeVisible();
    await expect(page.getByText('Progress: 40%', { exact: true })).toBeVisible();
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/goals/${goalId}/reminder`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await page.locator('#frequency-weekly').check();
    const reminderResponse = await submit(page, `/goals/${goalId}/reminder`, page.locator('form:has(#frequency-weekly) button[type="submit"]'));
    expect(reminderResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('Reminder active', { exact: true })).toBeVisible();
    await expectAccessibleReflow(page);

    const removeResponse = await submit(page, `/goals/${goalId}/reminder/delete`, page.locator('form[action$="/reminder/delete"] button[type="submit"]'));
    expect(removeResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText('No reminder set', { exact: true })).toBeVisible();

    await page.goto(`${mountPath}/goals/${goalId}/social`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    const likeButton = page.locator('form[action$="/like"] button');
    const likeResponse = await submit(page, `/goals/${goalId}/like`, likeButton);
    expect(likeResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.locator('form[action$="/like"] button')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#body').fill(socialComment);
    const commentResponse = await submit(page, `/goals/${goalId}/comments`, page.locator('form:has(#body) button[type="submit"]'));
    expect(commentResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    const commentRow = page.locator('li.nexus-alpha-comment', { hasText: socialComment });
    await expect(commentRow).toHaveCount(1);
    const commentDeleteForm = commentRow.locator('form[action$="/delete"]');
    const commentDeleteAction = await commentDeleteForm.getAttribute('action');
    expect(commentDeleteAction).toBeTruthy();
    const commentId = Number(commentDeleteAction.match(/\/comments\/(\d+)\/delete$/)?.[1]);
    expect(commentId).toBeGreaterThan(0);

    const replyDetails = commentRow.locator('details', { has: page.locator(`textarea#reply-${commentId}`) });
    await replyDetails.locator('summary').click();
    await replyDetails.locator(`#reply-${commentId}`).fill(socialReply);
    const replyResponse = await submit(page, `/goals/${goalId}/comments`, replyDetails.locator('form button'));
    expect(replyResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    const replyRow = page.getByText(socialReply, { exact: true })
      .locator('xpath=ancestor::li[contains(@class,"nexus-alpha-comment")][1]');
    await expect(replyRow).toHaveCount(1);
    const replyDeleteForm = replyRow.locator('form[action$="/delete"]');
    const replyDeleteAction = await replyDeleteForm.getAttribute('action');
    const replyId = Number(replyDeleteAction?.match(/\/comments\/(\d+)\/delete$/)?.[1]);
    expect(replyId).toBeGreaterThan(0);
    await replyDeleteForm.locator('xpath=ancestor::details').locator('summary').click();
    const replyDeleteResponse = await submit(page, `/goals/${goalId}/comments/${replyId}/delete`, replyDeleteForm.locator('button'));
    expect(replyDeleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText(socialReply, { exact: true })).toHaveCount(0);

    const refreshedCommentRow = page.locator('li.nexus-alpha-comment', { hasText: socialComment });
    const refreshedDeleteForm = refreshedCommentRow.locator(`form[action$="/comments/${commentId}/delete"]`);
    await refreshedDeleteForm.locator('xpath=ancestor::details').locator('summary').click();
    const commentDeleteResponse = await submit(page, `/goals/${goalId}/comments/${commentId}/delete`, refreshedDeleteForm.locator('button'));
    expect(commentDeleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    await expect(page.getByText(socialComment, { exact: true })).toHaveCount(0);
    await expectAccessibleReflow(page);

    await page.goto(`${mountPath}/goals/${goalId}/edit`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    const deleteResponse = await submit(page, `/goals/${goalId}/delete`, page.locator('form[action$="/delete"] button[type="submit"]'));
    expect(deleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await findByTitle(token, updatedTitle)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted && goalId) {
      await callGoalApi(token, 'DELETE', `/${goalId}`);
    }
  }
});
