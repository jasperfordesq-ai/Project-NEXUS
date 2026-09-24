// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { DEFAULT_TENANT } from './test-utils';
import { completeTwoFactorIfChallenged } from './two-factor';

/** Start a distinct browser session before loading the SPA in each test. */
export async function primeApiAuth(page: Page, kind: 'user' | 'admin'): Promise<void> {
  const email = kind === 'admin' ? process.env.E2E_ADMIN_EMAIL : process.env.E2E_USER_EMAIL;
  const password = kind === 'admin' ? process.env.E2E_ADMIN_PASSWORD : process.env.E2E_USER_PASSWORD;
  if (!email || !password) throw new Error(`Missing E2E ${kind} credentials`);
  const browserOrigin = new URL(process.env.E2E_BASE_URL || 'http://localhost:5173').origin;
  await page.context().clearCookies();
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 1; attempt <= 5; attempt++) {
    const response = await page.request.post(`${browserOrigin}/api/auth/login`, {
      data: { email, password, tenant_slug: DEFAULT_TENANT },
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': DEFAULT_TENANT, Origin: browserOrigin },
    });
    if (response.ok()) {
      const loginData = await completeTwoFactorIfChallenged(await response.json(), {
        request: page.request, apiBaseUrl: browserOrigin, tenantSlug: DEFAULT_TENANT, email, origin: browserOrigin,
      });
      const binding = loginData?.data?.session_binding || loginData?.session_binding;
      const tenantId = loginData?.data?.user?.tenant_id || loginData?.user?.tenant_id
        || loginData?.data?.tenant_id || loginData?.tenant_id;
      if (typeof binding !== 'string' || !/^[a-f0-9]{64}$/.test(binding)) {
        throw new Error(`E2E ${kind} browser login did not return a session binding`);
      }
      if (!Number.isSafeInteger(Number(tenantId)) || Number(tenantId) <= 0) {
        throw new Error(`E2E ${kind} browser login did not return a tenant ID`);
      }
      const cookieName = `__Host-nexus_refresh_${binding.slice(0, 32)}`;
      if (!(await page.context().cookies(browserOrigin)).some((cookie) => cookie.name === cookieName && cookie.httpOnly)) {
        throw new Error(`E2E ${kind} browser login did not set an HttpOnly refresh cookie`);
      }
      const generation = randomUUID();
      await page.addInitScript(({ binding: value, generation: id, tenantId: tenant }) => {
        localStorage.removeItem('nexus_access_token');
        localStorage.removeItem('nexus_refresh_token');
        localStorage.setItem('nexus_auth_session_generation', id);
        localStorage.setItem(`nexus_auth_binding:${id}`, value);
        if (tenant) localStorage.setItem('nexus_tenant_id', String(tenant));
      }, { binding, generation, tenantId });
      return;
    }
    lastStatus = response.status();
    lastBody = await response.text();
    if (lastStatus !== 429 || attempt === 5) break;
    let retryAfter = 2;
    try {
      const parsed = Number(JSON.parse(lastBody)?.retry_after);
      if (Number.isFinite(parsed) && parsed > 0) retryAfter = parsed;
    } catch { /* Use the default backoff for non-JSON responses. */ }
    await page.waitForTimeout(Math.min(retryAfter, 20) * 1000);
  }
  throw new Error(`E2E ${kind} API login failed (${lastStatus}): ${lastBody}`);
}
