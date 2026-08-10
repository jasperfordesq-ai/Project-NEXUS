// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const AxeBuilder = require('@axe-core/playwright').default;
const { test, expect } = require('@playwright/test');

const mountPath = `/${encodeURIComponent(process.env.ACCESSIBILITY_TENANT_SLUG || 'hour-timebank')}/accessible`;

const REFLOW_ROUTES = [
  { name: 'home', path: mountPath },
  { name: 'registration', path: `${mountPath}/register` },
  { name: 'legal hub', path: `${mountPath}/legal` },
  { name: 'listings', path: `${mountPath}/listings` }
];

function blockingViolations(violations) {
  return violations
    .filter(({ impact }) => impact === 'serious' || impact === 'critical')
    .map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.map((node) => node.target)
    }));
}

async function expectNoHorizontalOverflow(page, path) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(dimensions.scrollWidth, `${path} has horizontal overflow`).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  return dimensions;
}

test.describe('default-English resilient presentation gate', () => {
  for (const route of REFLOW_ROUTES) {
    test(`${route.name} reflows at a 320 CSS-pixel viewport`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 320, height: 800 });
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });

      expect(response).not.toBeNull();
      expect(response.status(), `${route.path} returned HTTP ${response.status()}`).toBeLessThan(400);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);

      const dimensions = await expectNoHorizontalOverflow(page, route.path);
      const axeResults = await new AxeBuilder({ page }).analyze();
      const violations = blockingViolations(axeResults.violations);

      await testInfo.attach('default-English-reflow-evidence', {
        body: Buffer.from(JSON.stringify({ path: route.path, dimensions, violations }, null, 2)),
        contentType: 'application/json'
      });
      expect(violations).toEqual([]);
    });
  }

  test('essential public forms remain structured and usable without JavaScript', async ({ browser, baseURL }, testInfo) => {
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 800 }
    });
    const page = await context.newPage();

    try {
      const routes = [
        { path: `${mountPath}/login`, formAction: `${mountPath}/login` },
        { path: `${mountPath}/register`, formAction: `${mountPath}/register` },
        { path: `${mountPath}/contact`, formAction: `${mountPath}/contact` }
      ];
      const evidence = [];

      for (const route of routes) {
        const response = await page.goto(new URL(route.path, baseURL).toString(), { waitUntil: 'domcontentloaded' });
        expect(response).not.toBeNull();
        expect(response.status(), `${route.path} returned HTTP ${response.status()}`).toBeLessThan(400);
        await expect(page.locator('html')).toHaveAttribute('lang', 'en');
        await expect(page.locator('main')).toHaveCount(1);
        await expect(page.locator('h1')).toHaveCount(1);

        const form = page.locator(`form[method="post"][action="${route.formAction}"]`);
        await expect(form).toHaveCount(1);
        await expect(form.locator('input[name="_csrf"]')).toHaveCount(1);
        const dimensions = await expectNoHorizontalOverflow(page, route.path);
        evidence.push({ path: route.path, dimensions });
      }

      await testInfo.attach('no-JavaScript-evidence', {
        body: Buffer.from(JSON.stringify(evidence, null, 2)),
        contentType: 'application/json'
      });
    } finally {
      await context.close();
    }
  });

  test('registration recovers from invalid input without JavaScript or a backend mutation', async ({ browser, baseURL }) => {
    test.setTimeout(90_000);
    const context = await browser.newContext({
      javaScriptEnabled: false,
      viewport: { width: 320, height: 800 }
    });
    const page = await context.newPage();

    try {
      const registerUrl = new URL(`${mountPath}/register`, baseURL).toString();
      const response = await page.goto(registerUrl, { waitUntil: 'domcontentloaded' });
      expect(response).not.toBeNull();
      expect(response.status()).toBeLessThan(400);

      await page.locator('#first_name').fill('Ada');
      await page.locator('input[name="form_started_at"]').evaluate((input) => {
        input.value = String(Date.now() - 6000);
      });

      await Promise.all([
        page.waitForURL(/\/register\?status=register-terms-required$/),
        page.locator('form:has(#first_name) button[type="submit"]').click()
      ]);

      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('.govuk-error-summary')).toHaveCount(1);
      await expect(page.locator('.govuk-error-summary')).toHaveAttribute('tabindex', '-1');
      await expect(page.locator('.govuk-error-summary a[href="#last_name"]')).toHaveCount(1);
      await expect(page.locator('#last_name')).toHaveAttribute('aria-describedby', /last_name-error/);
      await expect(page.locator('#last_name-error')).toHaveCount(1);
      await expect(page.locator('#first_name')).toHaveValue('Ada');
      await expectNoHorizontalOverflow(page, `${mountPath}/register?status=register-terms-required`);
    } finally {
      await context.close();
    }
  });
});
