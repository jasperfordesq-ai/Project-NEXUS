// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { test, expect } = require('@playwright/test');
const { getTenantBootstrap } = require('../../src/lib/api');

const tenant = 'timebanking-org';
const mountPath = `/${tenant}/accessible`;

test('honours a real tenant disabled-module bootstrap at route level', async ({ request }) => {
  const bootstrap = (await getTenantBootstrap({ slug: tenant }))?.data || {};

  expect(bootstrap.name).toBe('timebanking.org');
  expect(bootstrap.features?.resources ?? bootstrap.modules?.resources).toBe(true);
  for (const feature of ['marketplace', 'courses', 'podcasts']) {
    expect(bootstrap.features?.[feature] ?? bootstrap.modules?.[feature]).toBe(false);
  }
  expect(bootstrap.features?.member_premium).toBe(false);
  expect(bootstrap.features?.merchant_coupons).toBe(false);
  expect(bootstrap.features?.maps).toBe(false);
  expect(bootstrap.features?.groups).toBe(true);
  expect(bootstrap.features?.job_vacancies).toBe(true);

  const home = await request.get(mountPath, { maxRedirects: 0, timeout: 180_000 });
  expect(home.status()).toBe(200);
  const homeHtml = await home.text();
  expect(homeHtml).toContain('timebanking.org');
  for (const path of ['/marketplace', '/courses', '/podcasts', '/premium', '/coupons']) {
    expect(homeHtml).not.toContain(`href="${mountPath}${path}"`);
  }

  for (const path of [
    '/marketplace', '/courses', '/podcasts', '/premium', '/coupons', '/events/6/map'
  ]) {
    const response = await request.get(`${mountPath}${path}`, {
      maxRedirects: 0,
      timeout: 180_000
    });
    expect(response.status(), `${path} must fail closed for the disabled tenant`).toBe(403);
  }

  const resources = await request.get(`${mountPath}/resources`, {
    maxRedirects: 0,
    timeout: 180_000
  });
  expect(resources.status()).toBe(302);
  expect(resources.headers().location).toBe(`${mountPath}/login?status=auth-required`);

  for (const path of ['/groups', '/jobs']) {
    const response = await request.get(`${mountPath}${path}`, {
      maxRedirects: 0,
      timeout: 180_000
    });
    expect(response.status(), `${path} must remain available for the enabled tenant`).toBe(302);
    expect(response.headers().location).toBe(`${mountPath}/login?status=auth-required`);
  }
});
