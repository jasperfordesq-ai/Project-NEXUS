// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';

const TENANT = process.env.E2E_TENANT || 'hour-timebank';
const FRONTEND_BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const API_BASE_URL = (process.env.E2E_API_URL || 'http://localhost:8090').replace(/\/+$/, '');

interface ActorSession {
  token: string;
  refreshToken: string;
  tenantId: number;
  userId: number;
  name: string;
}

interface AdminGroupsHarness {
  admin: ActorSession;
  member: ActorSession;
  group: { id: number; name: string; description: string; location: string };
  marker: string;
  originalGroupConfig: Record<string, boolean | number | string>;
  cleanupTypeIds: Set<number>;
  cleanupTagIds: Set<number>;
  cleanupRuleIds: Set<number>;
}

interface JsonEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
}

let apiContext: APIRequestContext | undefined;
let harness: AdminGroupsHarness | undefined;
let browserFailures: string[] = [];

test.describe.configure({ mode: 'serial', timeout: 120_000 });

function apiUrl(pathname: string): string {
  return `${API_BASE_URL}/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function adminUrl(pathname: string): string {
  return `/${TENANT}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function headers(token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Slug': TENANT,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function bridgeDockerAssetHost(page: Page): Promise<void> {
  const api = new URL(API_BASE_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(api.hostname)) return;
  const frontend = new URL(FRONTEND_BASE_URL);

  await page.route(
    (url) => url.origin === frontend.origin && url.pathname.startsWith('/api/'),
    async (route) => {
      const target = new URL(route.request().url());
      target.protocol = api.protocol;
      target.host = api.host;
      await route.continue({ url: target.toString() });
    },
  );

  await page.route(/^http:\/\/host\.docker\.internal(?::\d+)?\//, async (route) => {
    const target = new URL(route.request().url());
    target.protocol = api.protocol;
    target.host = api.host;
    await route.continue({ url: target.toString() });
  });
}

function credential(name: 'E2E_ADMIN_EMAIL' | 'E2E_ADMIN_PASSWORD' | 'E2E_USER_EMAIL' | 'E2E_USER_PASSWORD'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for deterministic Groups admin E2E.`);
  return value;
}

function assertSafeFixtureTarget(): void {
  for (const [label, rawUrl] of [['frontend', FRONTEND_BASE_URL], ['API', API_BASE_URL]] as const) {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    if (hostname === 'project-nexus.ie' || hostname.endsWith('.project-nexus.ie')) {
      throw new Error(`Groups admin E2E refuses production ${label} host ${hostname}.`);
    }
    const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!loopback && process.env.E2E_GROUPS_ALLOW_REMOTE_FIXTURES !== '1') {
      throw new Error(
        `Groups admin E2E fixture target ${hostname} is not local. ` +
        'Set E2E_GROUPS_ALLOW_REMOTE_FIXTURES=1 only for an isolated non-production environment.',
      );
    }
  }
}

async function responseBody(response: APIResponse | Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

async function loginActor(email: string, password: string): Promise<ActorSession> {
  if (!apiContext) throw new Error('Groups admin API context is unavailable.');
  const response = await apiContext.post(apiUrl('/auth/login'), {
    data: {
      email,
      password,
      tenant_slug: TENANT,
    },
    headers: headers(),
  });
  const body = await responseBody(response) as JsonEnvelope<{
    access_token?: string;
    refresh_token?: string;
    tenant_id?: number;
    user?: { id?: number; name?: string; first_name?: string; last_name?: string; email?: string; tenant_id?: number; tenant?: { id?: number } };
  }> & {
    access_token?: string;
    refresh_token?: string;
    tenant_id?: number;
    user?: { id?: number; name?: string; first_name?: string; last_name?: string; email?: string; tenant_id?: number; tenant?: { id?: number } };
  };
  if (!response.ok()) {
    throw new Error(`Groups admin login failed (${response.status()}): ${JSON.stringify(body)}`);
  }
  const token = body.data?.access_token ?? body.access_token;
  const refreshToken = body.data?.refresh_token ?? body.refresh_token;
  const user = body.data?.user ?? body.user;
  const tenantId = Number(body.data?.tenant_id ?? body.tenant_id ?? user?.tenant_id ?? user?.tenant?.id);
  const userId = Number(user?.id);
  const name = user?.name || `${user?.first_name ?? ''} ${user?.last_name ?? ''}`.trim() || user?.email || '';
  if (!token || !refreshToken || !Number.isSafeInteger(tenantId) || !Number.isSafeInteger(userId) || userId < 1 || !name) {
    throw new Error('Groups admin login returned an incomplete session.');
  }
  return { token, refreshToken, tenantId, userId, name };
}

async function seedPagedAuditHistory(admin: ActorSession, groupId: number): Promise<void> {
  if (!apiContext) throw new Error('Groups admin API context is unavailable.');
  const groupResponse = await apiContext.get(apiUrl(`/v2/admin/groups/${groupId}`), {
    headers: headers(admin.token),
  });
  const groupBody = await responseBody(groupResponse) as JsonEnvelope<{ status?: string }>;
  let status = groupBody.data?.status;
  if (!groupResponse.ok()) {
    throw new Error(`Groups audit fixture status load failed (${groupResponse.status()}): ${JSON.stringify(groupBody)}`);
  }
  if (status === 'pending_review') {
    const activation = await apiContext.put(apiUrl(`/v2/admin/groups/${groupId}/status`), {
      data: { status: 'active' },
      headers: headers(admin.token),
    });
    if (!activation.ok()) {
      throw new Error(`Groups audit fixture activation failed (${activation.status()}): ${JSON.stringify(await responseBody(activation))}`);
    }
    status = 'active';
  }
  if (status !== 'active') {
    throw new Error(`Groups audit fixture expected active status, received ${JSON.stringify(status)}.`);
  }

  for (let index = 0; index < 26; index += 1) {
    const target = index % 2 === 0 ? 'dormant' : 'active';
    const response = await apiContext.put(apiUrl(`/v2/admin/groups/${groupId}/status`), {
      data: { status: target },
      headers: headers(admin.token),
    });
    if (!response.ok()) {
      throw new Error(
        `Groups audit fixture transition ${index + 1} to ${target} failed ` +
        `(${response.status()}): ${JSON.stringify(await responseBody(response))}`,
      );
    }
  }
}

async function createAdminFixture(admin: ActorSession, member: ActorSession, marker: string): Promise<AdminGroupsHarness> {
  if (!apiContext) throw new Error('Groups admin API context is unavailable.');
  const groupName = `E2E Admin Groups ${marker}`;
  const description = `Run-scoped Groups admin fixture ${marker}`;
  const location = 'London, United Kingdom';
  const groupResponse = await apiContext.post(apiUrl('/v2/groups'), {
    data: { name: groupName, description, visibility: 'public', location },
    headers: headers(admin.token),
  });
  const groupBody = await responseBody(groupResponse) as JsonEnvelope<{ id?: number }>;
  const groupId = Number(groupBody.data?.id);
  if (groupResponse.status() !== 201 || !Number.isSafeInteger(groupId) || groupId <= 0) {
    throw new Error(`Groups admin fixture creation failed (${groupResponse.status()}): ${JSON.stringify(groupBody)}`);
  }

  try {
    const locationResponse = await apiContext.put(apiUrl(`/v2/admin/groups/${groupId}`), {
      data: { location },
      headers: headers(admin.token),
    });
    if (!locationResponse.ok()) {
      throw new Error(`Groups location fixture update failed (${locationResponse.status()}): ${JSON.stringify(await responseBody(locationResponse))}`);
    }

    await seedPagedAuditHistory(admin, groupId);

    const joinResponse = await apiContext.post(apiUrl(`/v2/groups/${groupId}/join`), {
      data: {},
      headers: headers(member.token),
    });
    if (![200, 409].includes(joinResponse.status())) {
      throw new Error(`Groups member fixture join failed (${joinResponse.status()}): ${JSON.stringify(await responseBody(joinResponse))}`);
    }

    const membersResponse = await apiContext.get(apiUrl(`/v2/admin/groups/${groupId}/members?limit=50`), {
      headers: headers(admin.token),
    });
    const membersBody = await responseBody(membersResponse) as JsonEnvelope<Array<{ user_id?: number }>>;
    if (!membersResponse.ok() || !membersBody.data?.some((candidate) => Number(candidate.user_id) === member.userId)) {
      throw new Error(`Groups member fixture was not active: ${JSON.stringify(membersBody)}`);
    }

    const configResponse = await apiContext.get(apiUrl('/v2/admin/config/groups'), {
      headers: headers(admin.token),
    });
    const configBody = await responseBody(configResponse) as JsonEnvelope<{
      config?: Record<string, boolean | number | string>;
    }>;
    const originalGroupConfig = configBody.data?.config;
    if (!configResponse.ok() || !originalGroupConfig) {
      throw new Error(`Groups config fixture load failed (${configResponse.status()}): ${JSON.stringify(configBody)}`);
    }

    return {
      admin,
      member,
      group: { id: groupId, name: groupName, description, location },
      marker,
      originalGroupConfig,
      cleanupTypeIds: new Set(),
      cleanupTagIds: new Set(),
      cleanupRuleIds: new Set(),
    };
  } catch (error) {
    await apiContext.delete(apiUrl(`/v2/admin/groups/${groupId}`), { headers: headers(admin.token) });
    throw error;
  }
}

async function cleanupAdminFixture(current: AdminGroupsHarness): Promise<void> {
  if (!apiContext) throw new Error('Groups admin API context is unavailable.');
  const failures: string[] = [];

  const configRestore = await apiContext.put(apiUrl('/v2/admin/config/groups/bulk'), {
    data: { settings: current.originalGroupConfig },
    headers: headers(current.admin.token),
  });
  if (!configRestore.ok()) {
    failures.push(`group config restore ${configRestore.status()}: ${JSON.stringify(await responseBody(configRestore))}`);
  }

  for (const ruleId of current.cleanupRuleIds) {
    const response = await apiContext.delete(apiUrl(`/v2/admin/group-auto-assign-rules/${ruleId}`), {
      headers: headers(current.admin.token),
    });
    if (![200, 204, 404].includes(response.status())) {
      failures.push(`rule ${ruleId} DELETE ${response.status()}: ${JSON.stringify(await responseBody(response))}`);
    }
  }
  for (const tagId of current.cleanupTagIds) {
    const response = await apiContext.delete(apiUrl(`/v2/admin/group-tags/${tagId}`), {
      headers: headers(current.admin.token),
    });
    if (![200, 204, 404].includes(response.status())) {
      failures.push(`tag ${tagId} DELETE ${response.status()}: ${JSON.stringify(await responseBody(response))}`);
    }
  }
  for (const typeId of current.cleanupTypeIds) {
    const response = await apiContext.delete(apiUrl(`/v2/admin/groups/types/${typeId}`), {
      headers: headers(current.admin.token),
    });
    if (![200, 204, 404].includes(response.status())) {
      failures.push(`type ${typeId} DELETE ${response.status()}: ${JSON.stringify(await responseBody(response))}`);
    }
  }

  const groupDelete = await apiContext.delete(apiUrl(`/v2/admin/groups/${current.group.id}`), {
    headers: headers(current.admin.token),
  });
  if (![200, 204, 404].includes(groupDelete.status())) {
    failures.push(`group DELETE ${groupDelete.status()}: ${JSON.stringify(await responseBody(groupDelete))}`);
  }
  const groupVerify = await apiContext.get(apiUrl(`/v2/admin/groups/${current.group.id}`), {
    headers: headers(current.admin.token),
  });
  if (groupVerify.status() !== 404) failures.push(`group cleanup verification returned ${groupVerify.status()}`);

  if (failures.length > 0) throw new Error(`Groups admin cleanup failed:\n${failures.join('\n')}`);
}

function getHarness(): AdminGroupsHarness {
  if (!harness) throw new Error('Groups admin E2E harness is not initialized.');
  return harness;
}

function collectAdminFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
      failures.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    if (
      error.message === 'ResizeObserver loop completed with undelivered notifications.'
      || error.message === 'ResizeObserver loop limit exceeded'
    ) return;
    failures.push(`pageerror: ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText ?? 'unknown failure';
    if (
      reason === 'net::ERR_ABORTED'
      || reason === 'NS_BINDING_ABORTED'
      || reason === 'Load request cancelled'
    ) return;
    failures.push(`requestfailed: ${request.method()} ${request.url()} -> ${reason}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    const relevant = url.pathname.includes('/api/v2/admin/groups')
      || url.pathname.includes('/api/v2/admin/group-')
      || url.pathname.includes('/api/v2/admin/config/groups')
      || url.pathname.includes('/api/v2/groups/');
    const artificialReloadHeartbeat = url.pathname.endsWith('/api/v2/presence/heartbeat');
    if ((relevant && response.status() >= 400) || (response.status() === 429 && !artificialReloadHeartbeat)) {
      failures.push(`${response.request().method()} ${url.pathname}${url.search} -> ${response.status()}`);
    }
  });
  return failures;
}

async function gotoHeading(page: Page, pathname: string, heading: string | RegExp): Promise<void> {
  await page.goto(adminUrl(pathname), { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible({ timeout: 45_000 });
}

test.beforeAll(async ({ browserName: _browserName }, testInfo: TestInfo) => {
  testInfo.setTimeout(300_000);
  assertSafeFixtureTarget();
  apiContext = await playwrightRequest.newContext();
  const [admin, member] = await Promise.all([
    loginActor(credential('E2E_ADMIN_EMAIL'), credential('E2E_ADMIN_PASSWORD')),
    loginActor(credential('E2E_USER_EMAIL'), credential('E2E_USER_PASSWORD')),
  ]);
  harness = await createAdminFixture(
    admin,
    member,
    `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`,
  );
});

test.beforeEach(async ({ page }) => {
  const { admin } = getHarness();
  browserFailures = collectAdminFailures(page);
  await bridgeDockerAssetHost(page);
  await page.addInitScript(({ token, refreshToken, tenantId }) => {
    localStorage.setItem('nexus_access_token', token);
    localStorage.setItem('nexus_refresh_token', refreshToken);
    localStorage.setItem('nexus_tenant_id', String(tenantId));
    localStorage.setItem('dev_notice_dismissed', '2.1');
  }, { token: admin.token, refreshToken: admin.refreshToken, tenantId: admin.tenantId });
});

test.afterEach(() => {
  expect(browserFailures, 'Groups admin pages must not emit console, page, or Groups API failures').toEqual([]);
});

test.afterAll(async ({ browserName: _browserName }, testInfo: TestInfo) => {
  testInfo.setTimeout(300_000);
  const context = apiContext;
  const current = harness;
  if (!context) return;
  try {
    if (current) await cleanupAdminFixture(current);
  } finally {
    harness = undefined;
    apiContext = undefined;
    await context.dispose();
  }
});

test('maps every Groups admin route and linked geocode alias', async ({ page }) => {
  const surfaces: Array<[string, string | RegExp]> = [
    ['/admin/groups', 'Group List'],
    ['/admin/groups/analytics', 'Group Analytics'],
    ['/admin/groups/approvals', 'Group Approvals'],
    ['/admin/groups/moderation', 'Group Moderation'],
    ['/admin/groups/types', 'Group Types'],
    ['/admin/groups/recommendations', 'Group Recommendations'],
    ['/admin/groups/ranking', 'Group Ranking'],
    ['/admin/groups/organization', 'Group Organization'],
    // Legacy aliases redirect to the gated Groups list (F-533) instead of
    // rendering the ungated "not migrated" geocode stub.
    ['/admin/group-locations', 'Group List'],
    ['/admin/geocode-groups', 'Group List'],
  ];

  for (const [pathname, heading] of surfaces) {
    await gotoHeading(page, pathname, heading);
    await expect(page.locator('main')).toBeVisible();
  }
});

test('uses every canonical status tab as an exact API filter', async ({ page }) => {
  const initialResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/groups') && !url.searchParams.has('status');
  });
  await gotoHeading(page, '/admin/groups', 'Group List');
  expect((await initialResponse).status()).toBeLessThan(400);

  const statuses = [
    ['Pending review', 'pending_review'],
    ['Active', 'active'],
    ['Dormant', 'dormant'],
    ['Archived', 'archived'],
    ['Rejected', 'rejected'],
  ] as const;
  for (const [label, status] of statuses) {
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith('/api/v2/admin/groups') && url.searchParams.get('status') === status;
    });
    await page.getByRole('tab', { name: label, exact: true }).click();
    expect((await responsePromise).status()).toBeLessThan(400);
    await expect(page.getByRole('tab', { name: label, exact: true })).toHaveAttribute('aria-selected', 'true');
  }

  const allResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/groups') && !url.searchParams.has('status');
  });
  await page.getByRole('tab', { name: 'All', exact: true }).click();
  expect((await allResponse).status()).toBeLessThan(400);
});

test('performs and restores the legal active-to-dormant lifecycle transition', async ({ page }) => {
  const { group } = getHarness();
  let deletes = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (request.method() === 'DELETE' && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}`)) deletes += 1;
  });

  await gotoHeading(page, '/admin/groups', 'Group List');
  const search = page.getByRole('searchbox', { name: 'Search groups...' });
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/groups') && url.searchParams.get('search') === group.name;
  });
  await search.fill(group.name);
  expect((await searchResponse).status()).toBeLessThan(400);
  const row = page.getByRole('row').filter({ hasText: group.name });
  await expect(row).toBeVisible();

  const dormantResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'PUT'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/status`);
  });
  await row.getByRole('button', { name: `Actions for ${group.name}` }).click();
  await page.getByRole('menuitem', { name: 'Set as dormant', exact: true }).click();
  expect((await dormantResponse).status()).toBeLessThan(400);
  await expect(row.getByText('Dormant', { exact: true })).toBeVisible();

  const activeResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'PUT'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/status`);
  });
  await row.getByRole('button', { name: `Actions for ${group.name}` }).click();
  await page.getByRole('menuitem', { name: 'Reactivate', exact: true }).click();
  expect((await activeResponse).status()).toBeLessThan(400);
  await expect(row.getByText('Active', { exact: true })).toBeVisible();

  await row.getByRole('button', { name: `Actions for ${group.name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'View Group' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit Group' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Audit Log' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: /clone/i })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();

  const deleteDialog = page.getByRole('alertdialog', { name: 'Delete Group' });
  await expect(deleteDialog).toBeVisible();
  const confirmation = deleteDialog.getByRole('textbox', { name: 'Group name' });
  await confirmation.fill(group.name.toLowerCase());
  await expect(deleteDialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
  await deleteDialog.getByText('Cancel', { exact: true }).click();
  await expect(deleteDialog).toHaveCount(0);

  const rowCheckbox = row.getByRole('checkbox', { name: `Select row ${group.id}` });
  await rowCheckbox.check({ force: true });
  await expect(rowCheckbox).toBeChecked();
  await expect(page.getByText('1 selected', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const bulkDialog = page.getByRole('alertdialog', { name: 'Delete selected groups' });
  await expect(bulkDialog).toBeVisible();
  await bulkDialog.getByText('Cancel', { exact: true }).click();
  await expect(bulkDialog).toHaveCount(0);
  expect(deletes).toBe(0);
});

test('creates, edits, and deletes a group type without a misleading Policies surface', async ({ page }) => {
  const current = getHarness();
  const typeName = `E2E UI Type ${current.marker}`;
  const editedName = `${typeName} Edited`;
  await gotoHeading(page, '/admin/groups/types', 'Group Types');
  await page.getByRole('button', { name: 'Create Type', exact: true }).click();
  const createDialog = page.getByRole('dialog', { name: 'Create Group Type' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByRole('textbox', { name: 'Name', exact: true }).fill(typeName);
  const createResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith('/api/v2/admin/groups/types');
  });
  await createDialog.getByRole('button', { name: 'Create', exact: true }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBeLessThan(400);
  const createBody = await responseBody(createResponse) as JsonEnvelope<{ id?: number }> & { id?: number };
  const typeId = Number(createBody.data?.id ?? createBody.id);
  expect(typeId).toBeGreaterThan(0);
  current.cleanupTypeIds.add(typeId);

  let typeRow = page.getByRole('row').filter({ hasText: typeName });
  await expect(typeRow).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /policies/i })).toHaveCount(0);
  await expect(typeRow.getByRole('button', { name: /policies/i })).toHaveCount(0);

  await typeRow.getByRole('button', { name: 'Edit Group Type', exact: true }).click();
  const editDialog = page.getByRole('dialog', { name: 'Edit Group Type' });
  await editDialog.getByRole('textbox', { name: 'Name', exact: true }).fill(editedName);
  const editResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'PUT'
      && url.pathname.endsWith(`/api/v2/admin/groups/types/${typeId}`);
  });
  await editDialog.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await editResponsePromise).status()).toBeLessThan(400);
  typeRow = page.getByRole('row').filter({ hasText: editedName });
  await expect(typeRow).toBeVisible();

  await typeRow.getByRole('button', { name: 'Delete Group Type', exact: true }).click();
  const deleteDialog = page.getByRole('dialog', { name: 'Confirm' });
  const deleteResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'DELETE'
      && url.pathname.endsWith(`/api/v2/admin/groups/types/${typeId}`);
  });
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await deleteResponsePromise).status()).toBeLessThan(400);
  current.cleanupTypeIds.delete(typeId);
  await expect(page.getByRole('row').filter({ hasText: editedName })).toHaveCount(0);
});

test('writes and restores canonical tenant-wide Groups configuration', async ({ page }) => {
  const current = getHarness();
  if (!apiContext) throw new Error('Groups admin API context is unavailable.');
  const originalValue = current.originalGroupConfig.content_filter_enabled;
  expect(typeof originalValue).toBe('boolean');
  const toggledValue = !originalValue;

  try {
    await gotoHeading(page, '/admin/module-configuration', 'Module Configuration');
    await page.getByRole('textbox', { name: 'Search modules', exact: true }).fill('Groups');
    await expect(page.getByRole('heading', { level: 3, name: 'Groups', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Configure', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Community groups and discussions', { exact: true })).toBeVisible();
    const contentFilter = dialog.getByRole('switch', { name: 'Content Filter', exact: true });
    await expect(contentFilter).toBeChecked({ checked: originalValue });
    await contentFilter.evaluate((element) => {
      const scrollBody = element.closest('.modal__body');
      if (!(scrollBody instanceof HTMLElement)) {
        throw new Error('Groups configuration modal is missing its scroll body.');
      }
      const bodyRect = scrollBody.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      scrollBody.scrollTop += elementRect.top - bodyRect.top - (scrollBody.clientHeight / 2);
    });
    const contentFilterControl = contentFilter.locator('xpath=ancestor::label[1]');
    await expect(contentFilterControl).toBeInViewport();
    await contentFilterControl.click();
    await expect(contentFilter).toBeChecked({ checked: toggledValue });

    const saveResponsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'PUT'
        && url.pathname.endsWith('/api/v2/admin/config/groups/bulk');
    });
    await dialog.getByRole('button', { name: 'Save Changes', exact: true }).click();
    expect((await saveResponsePromise).status()).toBeLessThan(400);
    await expect(dialog).toHaveCount(0);

    const verifyResponse = await apiContext.get(apiUrl('/v2/admin/config/groups'), {
      headers: headers(current.admin.token),
    });
    const verifyBody = await responseBody(verifyResponse) as JsonEnvelope<{
      config?: Record<string, boolean | number | string>;
    }>;
    expect(verifyResponse.ok()).toBe(true);
    expect(verifyBody.data?.config?.content_filter_enabled).toBe(toggledValue);
  } finally {
    const restoreResponse = await apiContext.put(apiUrl('/v2/admin/config/groups/bulk'), {
      data: { settings: current.originalGroupConfig },
      headers: headers(current.admin.token),
    });
    expect(restoreResponse.ok(), JSON.stringify(await responseBody(restoreResponse))).toBe(true);
    const restoredResponse = await apiContext.get(apiUrl('/v2/admin/config/groups'), {
      headers: headers(current.admin.token),
    });
    const restoredBody = await responseBody(restoredResponse) as JsonEnvelope<{
      config?: Record<string, boolean | number | string>;
    }>;
    expect(restoredBody.data?.config?.content_filter_enabled).toBe(originalValue);
  }
});

test('creates and deletes a tag, then creates, toggles, and deletes a same-tenant auto-assignment rule', async ({ page }) => {
  const current = getHarness();
  const tagName = `E2E Tag ${current.marker}`;
  const ruleValue = `e2e-location-${current.marker}`;
  await gotoHeading(page, '/admin/groups/organization', 'Group Organization');

  await page.getByRole('tab', { name: 'Tags', exact: true }).click();
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  const tagDialog = page.getByRole('dialog', { name: 'Create tag' });
  await tagDialog.getByRole('textbox', { name: /^Tag name/ }).fill(tagName);
  const tagCreatePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST' && url.pathname.endsWith('/api/v2/admin/group-tags');
  });
  await tagDialog.getByRole('button', { name: 'Create', exact: true }).click();
  const tagCreateResponse = await tagCreatePromise;
  expect(tagCreateResponse.status()).toBe(201);
  const tagBody = await responseBody(tagCreateResponse) as JsonEnvelope<{ id?: number }> & { id?: number };
  const tagId = Number(tagBody.data?.id ?? tagBody.id);
  expect(tagId).toBeGreaterThan(0);
  current.cleanupTagIds.add(tagId);
  const tagRow = page.getByRole('row').filter({ hasText: tagName });
  await expect(tagRow).toBeVisible();
  await tagRow.getByRole('button', { name: 'Delete tag', exact: true }).click();
  const tagDeleteDialog = page.getByRole('dialog', { name: 'Confirm' });
  const tagDeletePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'DELETE'
      && url.pathname.endsWith(`/api/v2/admin/group-tags/${tagId}`);
  });
  await tagDeleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await tagDeletePromise).status()).toBeLessThan(400);
  current.cleanupTagIds.delete(tagId);
  await expect(page.getByRole('row').filter({ hasText: tagName })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Auto-assign rules', exact: true }).click();
  await page.getByRole('button', { name: 'Create rule', exact: true }).click();
  const ruleDialog = page.getByRole('dialog', { name: 'Create rule' });
  await ruleDialog.getByRole('button', { name: 'Select a group Group*', exact: true }).click();
  await page.getByRole('option', { name: current.group.name, exact: true }).click();
  await ruleDialog.getByRole('textbox', { name: /^Rule value/ }).fill(ruleValue);
  const ruleCreatePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST'
      && url.pathname.endsWith('/api/v2/admin/group-auto-assign-rules');
  });
  await ruleDialog.getByRole('button', { name: 'Create', exact: true }).click();
  const ruleCreateResponse = await ruleCreatePromise;
  expect(ruleCreateResponse.status()).toBe(201);
  const ruleBody = await responseBody(ruleCreateResponse) as JsonEnvelope<{ id?: number }> & { id?: number };
  const ruleId = Number(ruleBody.data?.id ?? ruleBody.id);
  expect(ruleId).toBeGreaterThan(0);
  current.cleanupRuleIds.add(ruleId);

  const ruleRow = page.getByRole('row').filter({ hasText: ruleValue });
  await expect(ruleRow).toBeVisible();
  const ruleToggle = ruleRow.getByRole('switch', {
    name: `Toggle auto-assignment rule for ${current.group.name}`,
  });
  await expect(ruleToggle).toBeChecked();
  const ruleTogglePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'PUT'
      && url.pathname.endsWith(`/api/v2/admin/group-auto-assign-rules/${ruleId}`);
  });
  await ruleToggle.locator('xpath=ancestor::label[1]').click();
  expect((await ruleTogglePromise).status()).toBeLessThan(400);
  await expect(ruleToggle).not.toBeChecked();
  await expect(ruleRow.getByText('Inactive', { exact: true })).toBeVisible();

  await ruleRow.getByRole('button', { name: 'Delete rule', exact: true }).click();
  const ruleDeleteDialog = page.getByRole('dialog', { name: 'Confirm' });
  const ruleDeletePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'DELETE'
      && url.pathname.endsWith(`/api/v2/admin/group-auto-assign-rules/${ruleId}`);
  });
  await ruleDeleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  expect((await ruleDeletePromise).status()).toBeLessThan(400);
  current.cleanupRuleIds.delete(ruleId);
  await expect(page.getByRole('row').filter({ hasText: ruleValue })).toHaveCount(0);
});

test('filters and pages the audit log, geocodes the fixture, and preserves the canonical edit route', async ({ page }) => {
  const { group } = getHarness();
  await gotoHeading(page, `/admin/groups/${group.id}/detail`, group.name);
  await expect(page.getByText(group.description, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /make owner/i })).toHaveCount(0);

  await page.getByRole('tab', { name: 'Audit Log', exact: true }).click();
  const auditFilter = page.getByRole('button', { name: /Audit Filter/ });
  await expect(auditFilter).toBeVisible();
  const filterResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/audit-log`)
      && url.searchParams.get('action') === 'group_status_changed'
      && !url.searchParams.has('page');
  });
  await auditFilter.click();
  await page.getByRole('option', { name: 'Group status changed', exact: true }).click();
  expect((await filterResponsePromise).status()).toBeLessThan(400);
  await expect(page.getByText('group_status_changed', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Group status changed', { exact: true }).first()).toBeVisible();

  const pageTwoPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'GET'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/audit-log`)
      && url.searchParams.get('action') === 'group_status_changed'
      && url.searchParams.get('page') === '2';
  });
  await page.getByRole('button', { name: 'Load More', exact: true }).click();
  expect((await pageTwoPromise).status()).toBeLessThan(400);

  await page.getByRole('tab', { name: 'Location', exact: true }).click();
  await expect(page.getByText(group.location, { exact: true })).toBeVisible();
  const geocodeResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/geocode`);
  });
  await page.getByRole('button', { name: 'Geocode Location', exact: true }).click();
  expect((await geocodeResponsePromise).status()).toBeLessThan(400);
  await expect(page.getByRole('heading', { level: 1, name: group.name })).toBeVisible();

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${TENANT}/groups/edit/${group.id}$`));
  await expect(page.getByRole('heading', { level: 1, name: 'Edit Group' })).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${TENANT}/groups/${group.id}(?:\\?tab=feed)?$`));
});

test('promotes, demotes, and kicks a member while keeping the owner protected', async ({ page }) => {
  const { admin, member, group } = getHarness();
  await gotoHeading(page, `/admin/groups/${group.id}/detail`, group.name);
  await page.getByRole('tab', { name: 'Members', exact: true }).click();

  const ownerRow = page.getByRole('row').filter({ hasText: admin.name });
  const memberRow = page.getByRole('row').filter({ hasText: member.name });
  await expect(ownerRow).toBeVisible();
  await expect(memberRow).toBeVisible();
  await expect(ownerRow.getByRole('button', { name: 'Promote', exact: true })).toHaveCount(0);
  await expect(ownerRow.getByRole('button', { name: 'Demote', exact: true })).toHaveCount(0);
  await expect(ownerRow.getByRole('button', { name: 'Kick', exact: true })).toHaveCount(0);

  const promoteResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/members/${member.userId}/promote`);
  });
  await memberRow.getByRole('button', { name: 'Promote', exact: true }).click();
  expect((await promoteResponsePromise).status()).toBeLessThan(400);
  await expect(memberRow.getByText('Administrator', { exact: true })).toBeVisible();

  const demoteResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'POST'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/members/${member.userId}/demote`);
  });
  await memberRow.getByRole('button', { name: 'Demote', exact: true }).click();
  expect((await demoteResponsePromise).status()).toBeLessThan(400);
  await expect(memberRow.getByText('Member', { exact: true })).toBeVisible();

  await memberRow.getByRole('button', { name: 'Kick', exact: true }).click();
  const kickDialog = page.getByRole('dialog', { name: 'Confirm' });
  await expect(kickDialog.getByText('Remove Member', { exact: true })).toBeVisible();
  const kickResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === 'DELETE'
      && url.pathname.endsWith(`/api/v2/admin/groups/${group.id}/members/${member.userId}`);
  });
  await kickDialog.getByRole('button', { name: 'Kick', exact: true }).click();
  expect((await kickResponsePromise).status()).toBeLessThan(400);
  await expect(page.getByRole('row').filter({ hasText: member.name })).toHaveCount(0);
  await expect(ownerRow).toBeVisible();
});

test('supports keyboard status navigation and browser Back/Forward', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await gotoHeading(page, '/admin/groups', 'Group List');
  const allTab = page.getByRole('tab', { name: 'All', exact: true });
  const pendingTab = page.getByRole('tab', { name: 'Pending review', exact: true });
  await allTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(pendingTab).toBeFocused();
  await expect(pendingTab).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'Analytics', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/${TENANT}/admin/groups/analytics$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/${TENANT}/admin/groups$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/${TENANT}/admin/groups/analytics$`));
});

test('covers viewport, theme, RTL, reduced-motion, and forced-colors modes', async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const { admin, group } = getHarness();
  if (!apiContext) throw new Error('Groups admin API context is unavailable.');
  const profileResponse = await apiContext.get(apiUrl('/v2/users/me'), {
    headers: headers(admin.token),
  });
  const profileBody = await responseBody(profileResponse) as JsonEnvelope<{ preferred_language?: string }>;
  expect(profileResponse.ok()).toBe(true);
  const originalLanguage = profileBody.data?.preferred_language ?? 'en';
  await gotoHeading(page, '/admin/groups', 'Group List');

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    const widths = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(widths.page, `admin Groups must not overflow at ${viewport.width}px`).toBeLessThanOrEqual(widths.viewport + 1);
    await expect(page.getByRole('heading', { level: 1, name: 'Group List' })).toBeVisible();

    if (viewport.width === 320) {
      const drawer = page.locator('[role="dialog"][aria-label="Admin navigation"]');
      await expect(drawer).toHaveAttribute('inert', '');
      await page.getByRole('button', { name: 'Toggle sidebar', exact: true }).click();
      await expect(drawer).not.toHaveAttribute('inert', '');
      await expect(drawer.getByRole('navigation', { name: 'Admin navigation' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveAttribute('inert', '');
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  const searchResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith('/api/v2/admin/groups') && url.searchParams.get('search') === group.name;
  });
  await page.getByRole('searchbox', { name: 'Search groups...' }).fill(group.name);
  expect((await searchResponse).status()).toBeLessThan(400);
  const mobileRow = page.getByRole('row').filter({ hasText: group.name });
  await expect(mobileRow).toBeVisible();
  await mobileRow.getByRole('button', { name: `Actions for ${group.name}` }).click();
  await expect(page.getByRole('menuitem', { name: 'Audit Log', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((nextTheme) => localStorage.setItem('nexus_theme', nextTheme), theme);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByRole('heading', { level: 1, name: 'Group List' })).toBeVisible({ timeout: 45_000 });
  }

  try {
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoHeading(page, '/groups', 'Groups');
    const languageResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return response.request().method() === 'PUT'
        && url.pathname.endsWith('/api/v2/users/me/language');
    });
    await page.getByRole('button', { name: /^Language:/ }).click();
    await page.getByText('AR', { exact: true }).click();
    expect((await languageResponse).status()).toBeLessThan(400);
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await page.goto(adminUrl('/admin/groups'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 45_000 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);

    let forcedAccepted = true;
    try {
      await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: 'active' });
    } catch (error) {
      forcedAccepted = false;
      testInfo.annotations.push({
        type: 'forced-colors-limit',
        description: `Admin browser runtime rejected forced colors: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
    const forcedActive = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
    if (forcedAccepted && !forcedActive) {
      testInfo.annotations.push({
        type: 'forced-colors-limit',
        description: 'Admin browser accepted forced-colors emulation without exposing the active media query.',
      });
    } else if (forcedAccepted) {
      expect(forcedActive).toBe(true);
    }
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 45_000 });
  } finally {
    const restoreResponse = await apiContext.put(apiUrl('/v2/users/me/language'), {
      data: { language: originalLanguage },
      headers: headers(admin.token),
    });
    expect(restoreResponse.ok(), JSON.stringify(await responseBody(restoreResponse))).toBe(true);
  }
});
