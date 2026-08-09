// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const AxeBuilder = require('@axe-core/playwright').default;
const fs = require('fs/promises');
const { resolveOptions } = require('../../scripts/laravel-runtime-smoke');
const { callVolunteeringApi, login } = require('../../src/lib/api');

const smoke = resolveOptions({}, process.env);
const mountPath = `/${encodeURIComponent(smoke.tenant)}/accessible`;
const pdf = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n', 'utf8');

function rowsFrom(result) {
  const data = result && typeof result === 'object' && result.data !== undefined ? result.data : result;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.credentials)) return data.credentials;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

async function submitPost(page, button, pathnameSuffix) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith(pathnameSuffix);
  }, { timeout: 300_000 });
  await button.click();
  const response = await responsePromise;
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

async function expectAccessibleReflow(page) {
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('h1')).toHaveCount(1);
  const duplicateIds = await page.locator('[id]').evaluateAll((elements) => {
    const ids = elements.map(element => element.id).filter(Boolean);
    return [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  });
  expect(duplicateIds).toEqual([]);
  const dimensions = await page.evaluate(() => {
    const viewport = document.documentElement.clientWidth;
    const overflow = [...document.querySelectorAll('body *')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: String(element.className || ''),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth
        };
      })
      .filter((element) => element.left < 0 || element.right > viewport)
      .slice(0, 20);
    return {
      viewport,
      content: document.documentElement.scrollWidth,
      overflow
    };
  });
  if (dimensions.content > dimensions.viewport) {
    console.log(`Credential reflow diagnostics: ${JSON.stringify(dimensions.overflow)}`);
  }
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
}

test('uploads, downloads and deletes a disposable volunteering credential', async ({ page }) => {
  const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const filename = `codex-volunteer-credential-${runId}.pdf`;
  const auth = await login(smoke.email, smoke.password, smoke.tenant);
  const token = auth.access_token;
  let credentialId = null;
  let deleted = false;

  expect(token).toBeTruthy();
  console.log(`Disposable volunteering credential fixture: ${filename}`);

  const findCredential = async () => {
    const result = await callVolunteeringApi(token, 'GET', '/credentials');
    return rowsFrom(result).find((credential) => (
      String(credential?.file_name || credential?.fileName || credential?.original_name || '').includes(filename)
    )) || null;
  };

  try {
    await authenticate(page);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`${mountPath}/volunteering/credentials`, {
      waitUntil: 'domcontentloaded',
      timeout: 300_000
    });
    await page.locator('#credential_type').selectOption('first_aid');
    await page.locator('#expiry_date').fill('2027-12-31');
    await page.locator('#document').setInputFiles({
      name: filename,
      mimeType: 'application/pdf',
      buffer: pdf
    });
    await submitPost(page, page.getByRole('button', { name: 'Upload credential', exact: true }), '/volunteering/credentials');

    const credential = await findCredential();
    expect(credential).toBeTruthy();
    credentialId = Number(credential.id);
    expect(credentialId).toBeGreaterThan(0);
    expect(String(credential.status)).toBe('pending');

    await expect(page.locator('.govuk-notification-banner')).toContainText('Your credential has been uploaded and is awaiting review.');
    const downloadLink = page.getByRole('link', { name: filename, exact: true });
    await expect(downloadLink).toHaveAttribute('href', `${mountPath}/volunteering/credentials/${credentialId}/download`);
    const deleteForm = page.locator(`form[action$="/volunteering/credentials/${credentialId}/delete"]`);
    await expect(deleteForm).toHaveCount(1);
    await expectAccessibleReflow(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 300_000 }),
      downloadLink.click()
    ]);
    expect(download.suggestedFilename()).toBe(filename);
    const downloadedPath = await download.path();
    expect(downloadedPath).toBeTruthy();
    expect((await fs.readFile(downloadedPath)).equals(pdf)).toBe(true);

    await submitPost(page, deleteForm.locator('button'), `/volunteering/credentials/${credentialId}/delete`);
    expect(await findCredential()).toBeNull();
    deleted = true;
  } finally {
    if (!deleted) {
      const existing = credentialId ? { id: credentialId } : await findCredential();
      if (existing?.id) {
        await callVolunteeringApi(token, 'DELETE', `/credentials/${existing.id}`).catch(() => undefined);
      }
    }
  }
});

test('renders the signed Laravel-backed volunteering applications tab', async ({ page }) => {
  await authenticate(page);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`${mountPath}/volunteering?tab=applications`, {
    waitUntil: 'domcontentloaded',
    timeout: 300_000
  });

  await expect(page.getByRole('heading', { level: 2, name: 'Your applications', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Applications', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.locator('#app_status')).toHaveCount(1);
  await expect(page.getByText('You have not applied for any opportunities yet.', { exact: true })).toBeVisible();
  await expectAccessibleReflow(page);

  await page.goto(`${mountPath}/volunteering?tab=recommended`, {
    waitUntil: 'domcontentloaded',
    timeout: 300_000
  });
  await expect(page.getByRole('heading', { level: 2, name: 'Recommended for you', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'For you', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('No recommended shifts right now. Check the opportunities tab.', { exact: true })).toBeVisible();
  await expectAccessibleReflow(page);

  await page.goto(`${mountPath}/volunteering?tab=community_projects`, {
    waitUntil: 'domcontentloaded',
    timeout: 300_000
  });
  await expect(page.getByRole('heading', { level: 2, name: 'Community projects', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Community projects', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('There are no community projects to show yet.', { exact: true })).toBeVisible();
  await expectAccessibleReflow(page);
});
