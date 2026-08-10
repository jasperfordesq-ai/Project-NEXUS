// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const {
  login,
  callReviewApi,
  getComments,
  getReactionSummary,
  deleteComment,
  toggleReaction
} = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;
const reviewId = 18;

function rowsFromComments(result) {
  const data = result?.data ?? result;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.comments)) return data.comments;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

function findComment(comments, content) {
  for (const comment of comments) {
    if (comment?.content === content || comment?.body === content) return comment;
    const nested = findComment(comment?.replies || comment?.children || [], content);
    if (nested) return nested;
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
  if (await rejectCookies.isVisible()) {
    const consentResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/cookie-consent'), { timeout: 300_000 });
    await rejectCookies.click({ noWaitAfter: true });
    expect((await consentResponse).status()).toBe(302);
  }
}

async function submit(page, pathnameSuffix, button) {
  const responsePromise = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith(pathnameSuffix), { timeout: 300_000 });
  await button.click();
  return responsePromise;
}

async function commentsFor(token) {
  return rowsFromComments(await getComments(token, { target_type: 'review', target_id: reviewId }));
}

async function userReactionFor(token) {
  const result = await getReactionSummary(token, 'review', reviewId);
  const data = result?.data ?? result;
  return data?.user_reaction ?? data?.userReaction ?? null;
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

test('certifies a reversible review discussion lifecycle through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const createdContent = `Codex disposable review comment ${runId}`;
  const updatedContent = `${createdContent} updated`;
  const replyContent = `Codex disposable review reply ${runId}`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  const reviewResult = await callReviewApi(token, 'GET', `/${reviewId}`);
  const review = reviewResult?.data ?? reviewResult;
  let commentId = null;
  let commentDeleted = false;
  let reviewReactionAdded = false;

  expect(token).toBeTruthy();
  expect(Number(review.id)).toBe(reviewId);
  expect(await userReactionFor(token)).toBeNull();
  console.log(`Disposable review comment fixture: ${createdContent}`);

  try {
    await page.setViewportSize({ width: 320, height: 640 });
    await authenticate(page);
    await page.goto(`${mountPath}/reviews/${reviewId}/comments`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('h1')).toHaveText('Comments on this review');
    await page.locator('#body').fill(createdContent);
    const createResponse = await submit(page, `/reviews/${reviewId}/comments`, page.locator('form:has(#body) button'));
    expect(createResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });

    const created = findComment(await commentsFor(token), createdContent);
    expect(created).toBeTruthy();
    commentId = Number(created.id);
    expect(commentId).toBeGreaterThan(0);
    let commentNode = page.locator(`#comment-${commentId}`);
    await expect(commentNode).toContainText(createdContent);
    await expect(commentNode.locator('form[action$="/update"]')).toHaveCount(1);
    await expect(commentNode.locator('form[action$="/delete"]')).toHaveCount(1);
    await expectAccessibleReflow(page);

    const commentReactionForm = commentNode.locator('form[action$="/react"]', { has: page.locator('input[name="emoji"][value="celebrate"]') });
    const commentReactionResponse = await submit(page, `/blog/comments/${commentId}/react`, commentReactionForm.locator('button'));
    expect(commentReactionResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    commentNode = page.locator(`#comment-${commentId}`);
    await expect(commentNode.locator('form[action$="/react"] input[value="celebrate"] + button')).toHaveAttribute('aria-pressed', 'true');

    let ownerActions = commentNode.locator(':scope > .nexus-alpha-comment-actions');
    const editDetails = ownerActions.locator(':scope > details').nth(1);
    await editDetails.locator('summary').click();
    await editDetails.locator(`#edit-comment-${commentId}`).fill(updatedContent);
    const editResponse = await submit(page, `/blog/comments/${commentId}/update`, editDetails.locator('form button'));
    expect(editResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(findComment(await commentsFor(token), updatedContent)).toBeTruthy();

    commentNode = page.locator(`#comment-${commentId}`);
    ownerActions = commentNode.locator(':scope > .nexus-alpha-comment-actions');
    const replyDetails = ownerActions.locator(':scope > details').nth(0);
    await replyDetails.locator('summary').click();
    await replyDetails.locator(`#reply-${commentId}`).fill(replyContent);
    const replyResponse = await submit(page, `/reviews/${reviewId}/comments`, replyDetails.locator('form button'));
    expect(replyResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(findComment(await commentsFor(token), replyContent)).toBeTruthy();

    const reviewReactionForm = page.locator('#review-reactions form', { has: page.locator('input[name="emoji"][value="celebrate"]') });
    const addReviewReactionResponse = await submit(page, `/reviews/${reviewId}/react`, reviewReactionForm.locator('button'));
    expect(addReviewReactionResponse.status()).toBe(302);
    reviewReactionAdded = true;
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await userReactionFor(token)).toBe('celebrate');

    const removeReviewReactionForm = page.locator('#review-reactions form', { has: page.locator('input[name="emoji"][value="celebrate"]') });
    const removeReviewReactionResponse = await submit(page, `/reviews/${reviewId}/react`, removeReviewReactionForm.locator('button'));
    expect(removeReviewReactionResponse.status()).toBe(302);
    reviewReactionAdded = false;
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(await userReactionFor(token)).toBeNull();

    commentNode = page.locator(`#comment-${commentId}`);
    ownerActions = commentNode.locator(':scope > .nexus-alpha-comment-actions');
    const deleteDetails = ownerActions.locator(':scope > details').nth(2);
    await deleteDetails.locator('summary').click();
    await expect(deleteDetails).toContainText('Deleting a comment also removes its replies. This cannot be undone.');
    const deleteResponse = await submit(page, `/blog/comments/${commentId}/delete`, deleteDetails.locator('form button'));
    expect(deleteResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    expect(findComment(await commentsFor(token), updatedContent)).toBeNull();
    expect(findComment(await commentsFor(token), replyContent)).toBeNull();
    commentDeleted = true;
  } finally {
    if (!commentDeleted && commentId) await deleteComment(token, commentId);
    if (reviewReactionAdded) {
      await toggleReaction(token, { target_type: 'review', target_id: reviewId, reaction_type: 'celebrate' });
    }
  }
});
