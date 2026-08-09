// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const {
  deleteResource,
  getResources,
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
    timeout: 300_000
  });
}

async function authenticate(page) {
  await page.goto(`${mountPath}/login`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
  await page.locator('input[name="email"]').fill(smoke.email);
  await page.locator('input[name="password"]').fill(smoke.password);
  const response = await submitPost(
    page,
    page.locator('form:has(input[name="password"]) button[type="submit"]'),
    '/login'
  );
  expect(response.status()).toBe(302);
}

async function uploadDisposableResource(page, { title, description, filename, contents }) {
  await page.goto(`${mountPath}/resources/upload`, {
    waitUntil: 'domcontentloaded',
    timeout: 300_000
  });
  await page.locator('#title').fill(title);
  await page.locator('#description').fill(description);
  await page.locator('#file').setInputFiles({
    name: filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(contents)
  });

  const uploadResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith('/resources/upload');
  }, { timeout: 300_000 });
  await page.getByRole('button', { name: 'Upload resource', exact: true }).click();
  const uploadResponse = await uploadResponsePromise;
  expect(uploadResponse.status()).toBe(302);
  await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
}

async function findByTitle(token, title) {
  const result = await getResources(token, { search: title, per_page: 50 });
  return rowsFrom(result).find((resource) => resource?.title === title) || null;
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

test('uploads, enforces the non-admin reorder guard, downloads, and deletes a disposable resource through Web UK', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const title = `Codex disposable resource ${runId}`;
  const contents = `Disposable Laravel resource fixture ${runId}\n`;
  const comment = `Disposable resource comment ${runId}`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let resourceId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable resource fixture: ${title}`);

  try {
    await authenticate(page);
    await page.goto(`${mountPath}/resources/upload`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#description').fill('Preserve this validation description');
    const validationResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'POST' && url.pathname.endsWith('/resources/upload');
    }, { timeout: 300_000 });
    await page.getByRole('button', { name: 'Upload resource', exact: true }).click();
    const validationResponse = await validationResponsePromise;
    expect(validationResponse.status()).toBe(302);
    await page.waitForLoadState('domcontentloaded', { timeout: 300_000 });
    const errorSummary = page.locator('.govuk-error-summary');
    await expect(errorSummary.getByRole('link', { name: 'Enter a title for the resource', exact: true })).toHaveAttribute('href', '#title');
    await expect(errorSummary.getByRole('link', { name: 'Choose a file to upload', exact: true })).toHaveAttribute('href', '#file');
    await expect(page.locator('#title')).toHaveAttribute('aria-describedby', 'title-hint title-error');
    await expect(page.locator('#file')).toHaveAttribute('aria-describedby', 'file-hint file-error');
    await expect(page.locator('#description')).toHaveValue('Preserve this validation description');

    await uploadDisposableResource(page, {
      title,
      description: 'Disposable upload, download, and delete smoke fixture.',
      filename: `codex-resource-${runId}.txt`,
      contents
    });

    const created = await findByTitle(token, title);
    expect(created).toBeTruthy();
    resourceId = Number(created.id);
    expect(resourceId).toBeGreaterThan(0);

    await page.goto(`${mountPath}/resources/library?q=${encodeURIComponent(title)}&reorder=1`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expect(page.locator('form[action$="/resources/reorder"]')).toHaveCount(0);
    const csrfTokens = await page.locator('form[action$="/logout"] input[name="_csrf"]').evaluateAll((elements) => (
      [...new Set(elements.map((element) => element.value).filter(Boolean))]
    ));
    expect(csrfTokens).toHaveLength(1);
    const [csrfToken] = csrfTokens;
    const forbiddenReorder = await page.request.post(new URL(`${mountPath}/resources/reorder`, page.url()).toString(), {
      form: {
        _csrf: csrfToken,
        resource_id: String(resourceId),
        direction: 'down',
        q: title,
        reorder: '1'
      },
      maxRedirects: 0,
      timeout: 300_000
    });
    expect(forbiddenReorder.status()).toBe(403);
    const unchanged = await findByTitle(token, title);
    expect(Number(unchanged?.sort_order)).toBe(Number(created.sort_order));

    await page.goto(`${mountPath}/resources/library?q=${encodeURIComponent(title)}`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    const card = page.locator(`#resource-${resourceId}`);
    await expect(card.getByRole('heading', { name: title, exact: true })).toBeVisible();

    const downloadHref = await card.getByRole('link', { name: `Download ${title}`, exact: true }).getAttribute('href');
    expect(downloadHref).toBeTruthy();
    const downloadResponse = await page.request.get(new URL(downloadHref, page.url()).toString(), {
      timeout: 300_000
    });
    expect(downloadResponse.status()).toBe(200);
    expect(downloadResponse.headers()['content-disposition']).toContain('attachment');
    expect((await downloadResponse.body()).toString('utf8')).toBe(contents);

    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${mountPath}/resources/${resourceId}/comments`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    const celebrateForm = page.locator('form:has(input[name="emoji"][value="celebrate"])');
    await expect(celebrateForm.locator('button')).toContainText('🎉');
    await expect(celebrateForm.locator('button')).toContainText('Celebrate');
    const reactionResponse = await submitPost(page, celebrateForm.locator('button'), `/resources/${resourceId}/react`);
    expect(reactionResponse.status()).toBe(302);
    await page.goto(`${mountPath}/resources/${resourceId}/comments`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('form:has(input[name="emoji"][value="celebrate"]) button')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#body').fill(comment);
    const commentResponse = await submitPost(page, page.locator('form:has(#body) button[type="submit"]'), `/resources/${resourceId}/comments/add`);
    expect(commentResponse.status()).toBe(302);
    await page.goto(`${mountPath}/resources/${resourceId}/comments`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    const commentRow = page.locator('li.nexus-alpha-comment', { hasText: comment });
    await expect(commentRow).toHaveCount(1);
    await expectAccessibleReflow(page);

    const commentDeleteButton = commentRow.locator('form[action$="/delete"] button');
    const commentDeleteAction = await commentRow.locator('form[action$="/delete"]').getAttribute('action');
    expect(commentDeleteAction).toBeTruthy();
    const commentId = Number(commentDeleteAction.match(/\/comments\/(\d+)\/delete$/)?.[1]);
    expect(commentId).toBeGreaterThan(0);
    const commentDeleteResponse = await submitPost(page, commentDeleteButton, `/resources/${resourceId}/comments/${commentId}/delete`);
    expect(commentDeleteResponse.status()).toBe(302);
    await page.goto(`${mountPath}/resources/${resourceId}/comments`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.getByText(comment, { exact: true })).toHaveCount(0);

    const reactionRemoveResponse = await submitPost(
      page,
      page.locator('form:has(input[name="emoji"][value="celebrate"]) button'),
      `/resources/${resourceId}/react`
    );
    expect(reactionRemoveResponse.status()).toBe(302);
    await page.goto(`${mountPath}/resources/${resourceId}/comments`, { waitUntil: 'domcontentloaded', timeout: 300_000 });
    await expect(page.locator('form:has(input[name="emoji"][value="celebrate"]) button')).toHaveAttribute('aria-pressed', 'false');

    await page.goto(`${mountPath}/resources/${resourceId}/delete`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await expect(page.locator('h1')).toContainText('Delete resource');
    const deleteResponse = await submitPost(
      page,
      page.getByRole('button', { name: 'Delete resource', exact: true }),
      `/resources/${resourceId}/delete`
    );
    expect(deleteResponse.status()).toBe(302);

    expect(await findByTitle(token, title)).toBeNull();
    deleted = true;
  } finally {
    if (!deleted) {
      const existing = await findByTitle(token, title);
      if (existing) await deleteResource(token, existing.id);
    }
  }
});
