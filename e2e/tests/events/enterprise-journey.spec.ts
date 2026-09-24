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
  type Browser,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CreateEventPage, EventDetailPage } from '../../page-objects/EventsPage';
import { completeTwoFactorIfChallenged } from '../../helpers/two-factor';

const TENANT = process.env.E2E_TENANT || 'hour-timebank';
const FRONTEND_BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const API_BASE_URL = (
  process.env.E2E_API_URL
  || process.env.E2E_BASE_URL
  || 'http://localhost:8090'
).replace(/\/+$/, '');
const EVENTS_CONTRACT_HEADERS = { 'X-Events-Contract': '2' };
const CANCELLATION_REASON = 'E2E enterprise journey cancellation evidence.';

function processAuthoritativeEventOutbox(): void {
  const container = process.env.E2E_EVENT_OUTBOX_CONTAINER?.trim();
  if (!container) return;

  for (let batch = 0; batch < 20; batch += 1) {
    const output = execFileSync('docker', [
      'exec',
      container,
      'php',
      'artisan',
      'events:process-notification-outbox',
      `--tenant=${process.env.E2E_TENANT_ID || '2'}`,
      '--limit=100',
      '--json',
    ], { encoding: 'utf8' });
    const summary = JSON.parse(output.trim().split(/\r?\n/).at(-1) || '{}') as {
      claimed?: number;
      retrying?: number;
      dead_lettered?: number;
    };
    if ((summary.retrying ?? 0) > 0 || (summary.dead_lettered ?? 0) > 0) {
      throw new Error(`Event notification outbox delivery failed: ${JSON.stringify(summary)}`);
    }
    if ((summary.claimed ?? 0) === 0) return;
  }

  throw new Error('Event notification outbox did not drain within 20 batches.');
}

interface ActorSession {
  kind: 'user' | 'admin';
  id: number;
  name: string;
  token: string;
  sessionBinding: string;
  refreshCookie: Awaited<ReturnType<APIRequestContext['storageState']>>['cookies'][number];
  tenantId: number;
}

interface RosterMember {
  id: number;
  name: string;
}

interface JourneyEvent {
  id: number;
  title: string;
}

interface EventsJourneyHarness {
  participant: ActorSession;
  admin: ActorSession;
  rosterMember: RosterMember;
  publicationEvent?: JourneyEvent;
  operationsEvent?: JourneyEvent;
}

interface JsonEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string;
  errors?: unknown;
}

interface EventDetailContract {
  id: number;
  title: string;
  schedule: {
    publication_state: 'draft' | 'pending_review' | 'published' | 'archived';
    operational_state: string;
  };
  permissions: {
    publish: boolean;
    submit_for_review: boolean;
  };
  relationship?: {
    registration: {
      state: string;
      can_register: boolean;
      can_withdraw: boolean;
      can_join_waitlist: boolean;
      can_leave_waitlist: boolean;
    };
    capacity: { confirmed: number; remaining: number | null; is_full: boolean };
  };
}

interface EventRelationship {
  registration: { state: string | null };
  waitlist: { state: string | null; position: number | null };
  attendance: { state: string | null };
  capacity: { confirmed: number; remaining: number | null; is_full: boolean };
  actions: {
    registrable: boolean;
    confirm: boolean;
    withdraw: boolean;
    join_waitlist: boolean;
    leave_waitlist: boolean;
  };
}

interface BulkPeopleResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{
    success: boolean;
    mutation?: { state?: string; version?: number };
    error?: { code?: string; message?: string };
  }>;
}

let apiContext: APIRequestContext | undefined;
let harness: EventsJourneyHarness | undefined;
let lastAdminTotpCompletion = 0;

test.describe.configure({ mode: 'serial', timeout: 90_000 });

function apiUrl(pathname: string): string {
  return `${API_BASE_URL}/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function actorHeaders(token?: string, eventsContract = false): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Tenant-Slug': TENANT,
    ...(eventsContract ? EVENTS_CONTRACT_HEADERS : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function responseBody(response: APIResponse | Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return await response.text();
  }
}

async function requireApiData<T>(
  response: APIResponse,
  expectedStatuses: number[],
  operation: string,
): Promise<T> {
  const body = await responseBody(response) as JsonEnvelope<T>;
  if (!expectedStatuses.includes(response.status()) || body?.data === undefined) {
    throw new Error(`${operation} failed (${response.status()}): ${JSON.stringify(body)}`);
  }
  return body.data;
}

function assertSafeFixtureTarget(): void {
  for (const [label, rawUrl] of [['frontend', FRONTEND_BASE_URL], ['API', API_BASE_URL]] as const) {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    if (hostname === 'project-nexus.ie' || hostname.endsWith('.project-nexus.ie')) {
      throw new Error(`Events E2E refuses to create fixtures on the production ${label} host: ${hostname}`);
    }

    const isLoopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
    if (!isLoopback && process.env.E2E_EVENTS_ALLOW_REMOTE_FIXTURES !== '1') {
      throw new Error(
        `Events E2E fixture target ${hostname} is not local. `
        + 'Set E2E_EVENTS_ALLOW_REMOTE_FIXTURES=1 only for an isolated non-production environment.',
      );
    }
  }
}

async function loginActor(kind: 'user' | 'admin'): Promise<ActorSession> {
  if (!apiContext) throw new Error('Events E2E API context is not initialized.');
  if (kind === 'admin' && lastAdminTotpCompletion > 0) {
    // These serial UI visits use one synthetic admin. A TOTP code cannot be
    // replayed in the same 30-second step; an invalid retry also consumes the
    // real five-attempt MFA limit. Wait for a fresh step before signing in again.
    const waitMs = Math.max(0, 31_000 - (Date.now() - lastAdminTotpCompletion));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const email = process.env[kind === 'admin' ? 'E2E_ADMIN_EMAIL' : 'E2E_USER_EMAIL'];
  const password = process.env[kind === 'admin' ? 'E2E_ADMIN_PASSWORD' : 'E2E_USER_PASSWORD'];
  if (!email || !password) throw new Error(`Events E2E ${kind} credentials are missing.`);
  const origin = new URL(FRONTEND_BASE_URL).origin;
  const doLogin = () => apiContext!.post(`${origin}/api/auth/login`, {
    data: { email, password, tenant_slug: TENANT },
    headers: { 'Content-Type': 'application/json', 'X-Tenant-Slug': TENANT, Origin: origin },
  });
  let response = await doLogin();
  for (let attempt = 0; attempt < 6 && response.status() === 429; attempt++) {
    let retryAfter = 2;
    try {
      const parsed = Number((await response.json())?.retry_after);
      if (Number.isFinite(parsed) && parsed > 0) retryAfter = parsed;
    } catch { /* Use the default backoff for non-JSON responses. */ }
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 10) * 1000 + 500));
    response = await doLogin();
  }
  if (!response.ok()) throw new Error(`Events E2E ${kind} browser login failed (${response.status()}).`);
  const loginData = await completeTwoFactorIfChallenged(await response.json(), {
    request: apiContext, apiBaseUrl: origin, tenantSlug: TENANT, email, origin,
  });
  if (kind === 'admin') lastAdminTotpCompletion = Date.now();
  const token = loginData?.data?.access_token || loginData?.access_token;
  const sessionBinding = loginData?.data?.session_binding || loginData?.session_binding;
  const tenantId = Number(loginData?.data?.user?.tenant_id || loginData?.user?.tenant_id
    || loginData?.data?.tenant_id || loginData?.tenant_id || process.env.E2E_TENANT_ID);
  if (typeof token !== 'string' || typeof sessionBinding !== 'string'
    || !/^[a-f0-9]{64}$/.test(sessionBinding)
    || !Number.isSafeInteger(tenantId) || tenantId <= 0) {
    throw new Error(`Events E2E ${kind} browser login returned an incomplete session.`);
  }
  const cookieName = `__Host-nexus_refresh_${sessionBinding.slice(0, 32)}`;
  const refreshCookie = (await apiContext.storageState()).cookies.find((cookie) =>
    cookie.name === cookieName && cookie.httpOnly);
  if (!refreshCookie) throw new Error(`Events E2E ${kind} browser login did not set an HttpOnly cookie.`);
  return { kind, id: 0, name: kind, token, sessionBinding, refreshCookie, tenantId };
}

async function hydrateActor(actor: ActorSession, label: string): Promise<ActorSession> {
  if (!apiContext) throw new Error('Events E2E API context is not initialized.');
  const response = await apiContext.get(apiUrl('/v2/users/me'), {
    headers: actorHeaders(actor.token),
  });
  const profile = await requireApiData<{
    id?: number;
    tenant_id?: number;
    name?: string;
    first_name?: string;
    last_name?: string;
  }>(response, [200], `read ${label} profile`);
  const id = Number(profile.id);
  const tenantId = Number(profile.tenant_id ?? actor.tenantId);
  const name = profile.name || `${profile.first_name ?? ''} ${profile.last_name ?? ''}`.trim();
  if (!Number.isSafeInteger(id) || id <= 0 || !Number.isSafeInteger(tenantId) || !name) {
    throw new Error(`${label} profile did not contain a complete actor identity.`);
  }
  return { ...actor, id, tenantId, name };
}

async function resolveRosterMember(participant: ActorSession, admin: ActorSession): Promise<RosterMember> {
  if (!apiContext) throw new Error('Events E2E API context is not initialized.');
  for (const query of ['a', 'e', 'o', 'i']) {
    const response = await apiContext.get(apiUrl(`/v2/wallet/user-search?q=${query}&limit=20`), {
      headers: actorHeaders(admin.token),
    });
    const data = await requireApiData<{ users?: Array<{
      id?: number;
      name?: string;
      first_name?: string;
      last_name?: string;
      username?: string;
    }> }>(response, [200], `search roster member with ${query}`);
    const candidate = (data.users ?? []).find((member) => {
      const id = Number(member.id);
      return Number.isSafeInteger(id) && id > 0 && id !== participant.id && id !== admin.id;
    });
    if (candidate) {
      const name = candidate.name
        || `${candidate.first_name ?? ''} ${candidate.last_name ?? ''}`.trim()
        || candidate.username;
      if (name) return { id: Number(candidate.id), name };
    }
  }
  throw new Error('Events E2E needs one active member distinct from the configured member and admin.');
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

async function useActor(page: Page, actor: ActorSession): Promise<void> {
  await bridgeDockerAssetHost(page);
  // Each UI visit gets a fresh family; a prior page has already rotated the
  // previous HttpOnly cookie while restoring its in-memory access token.
  const browserSession = await loginActor(actor.kind);
  await page.context().clearCookies();
  await page.context().addCookies([browserSession.refreshCookie]);
  const generation = randomUUID();
  await page.addInitScript(({ sessionBinding, generation, tenantId }) => {
    localStorage.removeItem('nexus_access_token');
    localStorage.removeItem('nexus_refresh_token');
    localStorage.setItem('nexus_auth_session_generation', generation);
    localStorage.setItem(`nexus_auth_binding:${generation}`, sessionBinding);
    localStorage.setItem('nexus_tenant_id', String(tenantId));
    localStorage.setItem('dev_notice_dismissed', '2.1');
    localStorage.setItem('nexus_cookie_consent', JSON.stringify({
      essential: true,
      analytics: false,
      preferences: true,
      timestamp: new Date().toISOString(),
    }));
  }, {
    sessionBinding: browserSession.sessionBinding,
    generation,
    tenantId: actor.tenantId,
  });
}

function getHarness(): EventsJourneyHarness {
  if (!harness) throw new Error('Events E2E harness is not initialized.');
  return harness;
}

function getOperationsEvent(): JourneyEvent {
  const event = getHarness().operationsEvent;
  if (!event) throw new Error('Events E2E operations fixture has not been created.');
  return event;
}

async function eventDetail(actor: ActorSession, eventId: number): Promise<EventDetailContract> {
  if (!apiContext) throw new Error('Events E2E API context is not initialized.');
  const response = await apiContext.get(apiUrl(`/v2/events/${eventId}`), {
    headers: actorHeaders(actor.token, true),
  });
  return requireApiData<EventDetailContract>(response, [200], `read Event ${eventId}`);
}

async function eventRelationship(actor: ActorSession, eventId: number): Promise<EventRelationship> {
  if (!apiContext) throw new Error('Events E2E API context is not initialized.');
  const response = await apiContext.get(apiUrl(`/v2/events/${eventId}/relationship`), {
    headers: actorHeaders(actor.token, true),
  });
  return requireApiData<EventRelationship>(response, [200], `read Event ${eventId} relationship`);
}

async function bulkRegistration(
  eventId: number,
  actor: ActorSession,
  memberId: number,
  action: 'invite' | 'approve',
  expectedVersion: number,
  marker: string,
): Promise<BulkPeopleResult> {
  if (!apiContext) throw new Error('Events E2E API context is not initialized.');
  const response = await apiContext.post(apiUrl(`/v2/events/${eventId}/people/bulk`), {
    data: {
      operations: [{
        user_id: memberId,
        action,
        expected_version: expectedVersion,
        idempotency_key: `e2e-events-${marker}-${action}`,
      }],
    },
    headers: actorHeaders(actor.token, true),
  });
  const result = await requireApiData<BulkPeopleResult>(
    response,
    [200],
    `${action} roster member ${memberId} for Event ${eventId}`,
  );
  if (result.succeeded !== 1 || !result.results[0]?.success) {
    throw new Error(`${action} roster member failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function isEventResponse(response: Response, method: string, pathname: string): boolean {
  const url = new URL(response.url());
  return response.request().method() === method && url.pathname === `/api${pathname}`;
}

async function navigateWithinTenant(page: Page, pathname: string): Promise<void> {
  const target = `/${TENANT}/${pathname.replace(/^\/+/, '')}`;
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, target);
  await expect(page).toHaveURL(new RegExp(`${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
}

function attendanceWindowSchedule(): { start: Date; end: Date } {
  const start = new Date(Date.now() + 20 * 60_000);
  start.setSeconds(0, 0);
  return { start, end: new Date(start.getTime() + 60 * 60_000) };
}

function uiSchedule(start: Date, end: Date): {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
} {
  const date = (value: Date) => [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
  const time = (value: Date) => [
    String(value.getHours()).padStart(2, '0'),
    String(value.getMinutes()).padStart(2, '0'),
  ].join(':');
  return { startDate: date(start), startTime: time(start), endDate: date(end), endTime: time(end) };
}

async function cleanupHarness(context: APIRequestContext, current: EventsJourneyHarness): Promise<void> {
  const failures: string[] = [];
  for (const event of [current.operationsEvent, current.publicationEvent]) {
    if (!event) continue;
    try {
      const response = await context.post(apiUrl(`/v2/admin/events/${event.id}/archive`), {
        data: { reason: 'E2E enterprise journey teardown' },
        headers: actorHeaders(current.admin.token),
      });
      if (![200, 404].includes(response.status())) {
        throw new Error(`${response.status()}: ${JSON.stringify(await responseBody(response))}`);
      }
    } catch (error) {
      failures.push(`Event ${event.id} archive failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join('\n'));
}

async function openNotificationPage(browser: Browser, actor: ActorSession): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await useActor(page, actor);
  return { page, close: () => context.close() };
}

test.beforeAll(async ({}, testInfo: TestInfo) => {
  testInfo.setTimeout(120_000);
  assertSafeFixtureTarget();
  const context = await playwrightRequest.newContext({ timeout: 30_000 });
  apiContext = context;
  try {
    const participant = await hydrateActor(await loginActor('user'), 'member');
    const admin = await hydrateActor(await loginActor('admin'), 'admin');
    const rosterMember = await resolveRosterMember(participant, admin);
    harness = { participant, admin, rosterMember };
  } catch (error) {
    await context.dispose();
    apiContext = undefined;
    throw error;
  }
});

test.afterAll(async ({}, testInfo: TestInfo) => {
  testInfo.setTimeout(120_000);
  const context = apiContext;
  const current = harness;
  apiContext = undefined;
  harness = undefined;
  if (!context) return;
  try {
    if (current) await cleanupHarness(context, current);
  } finally {
    await context.dispose();
  }
});

test.describe('Events enterprise lifecycle @events @enterprise @journey', () => {
  test('member creates a draft and completes the tenant publication workflow', async ({ page }, testInfo) => {
    const current = getHarness();
    await useActor(page, current.participant);
    const createPage = new CreateEventPage(page);
    await createPage.navigate();
    await createPage.waitForLoad();
    await expect(createPage.pageHeading).toBeVisible();

    const marker = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`;
    const title = `E2E Publication Event ${marker}`;
    const start = new Date(Date.now() + 24 * 60 * 60_000);
    const end = new Date(start.getTime() + 60 * 60_000);
    await createPage.fillForm({
      title,
      description: `Run-scoped publication workflow evidence for ${marker}.`,
      ...uiSchedule(start, end),
      location: 'E2E Community Hall',
      maxAttendees: '10',
    });

    const creationPromise = page.waitForResponse(
      (response) => isEventResponse(response, 'POST', '/v2/events'),
    );
    await createPage.submit();
    const creationResponse = await creationPromise;
    const creationBody = await responseBody(creationResponse) as JsonEnvelope<EventDetailContract>;
    expect(creationResponse.status(), JSON.stringify(creationBody)).toBe(201);
    expect(creationBody.data?.id).toBeGreaterThan(0);
    const eventId = Number(creationBody.data?.id);
    current.publicationEvent = { id: eventId, title };

    const created = await eventDetail(current.participant, eventId);
    expect(created.schedule.publication_state).toBe('draft');
    expect([created.permissions.publish, created.permissions.submit_for_review].filter(Boolean)).toHaveLength(1);

    const detailPage = new EventDetailPage(page);
    // Creation already left us inside the hydrated tenant shell. Preserve that
    // provider state while opening an owner-visible draft (drafts are omitted
    // from the public collection, so there is no card to click).
    await navigateWithinTenant(page, `events/${eventId}`);
    await detailPage.waitForLoad();
    await expect(detailPage.title).toHaveText(title);
    await expect(page.getByText('Draft event', { exact: true }).first()).toBeVisible();

    if (created.permissions.submit_for_review) {
      const submitPromise = page.waitForResponse(
        (response) => isEventResponse(response, 'POST', `/v2/events/${eventId}/submit`),
      );
      await page.getByRole('button', { name: `Submit ${title} for review`, exact: true }).click();
      const submitDialog = page.getByRole('alertdialog');
      await expect(submitDialog.getByRole('heading', { name: 'Submit for review' })).toBeVisible();
      await submitDialog.getByRole('button', { name: 'Submit for review', exact: true }).click();
      const submitResponse = await submitPromise;
      expect(submitResponse.status(), JSON.stringify(await responseBody(submitResponse))).toBe(200);
      await expect(page.getByText('Pending review', { exact: true }).first()).toBeVisible();
      expect((await eventDetail(current.participant, eventId)).schedule.publication_state).toBe('pending_review');

      if (!apiContext) throw new Error('Events E2E API context is not initialized.');
      const approvalResponse = await apiContext.post(apiUrl(`/v2/admin/events/${eventId}/approve`), {
        data: {},
        headers: actorHeaders(current.admin.token),
      });
      await requireApiData(approvalResponse, [200], `approve Event ${eventId}`);
    } else {
      const publishPromise = page.waitForResponse(
        (response) => isEventResponse(response, 'POST', `/v2/events/${eventId}/publish`),
      );
      await page.getByRole('button', { name: `Publish ${title}`, exact: true }).click();
      const publishDialog = page.getByRole('alertdialog');
      await expect(publishDialog.getByRole('heading', { name: 'Publish event' })).toBeVisible();
      await publishDialog.getByRole('button', { name: 'Publish event', exact: true }).click();
      const publishResponse = await publishPromise;
      expect(publishResponse.status(), JSON.stringify(await responseBody(publishResponse))).toBe(200);
    }

    expect((await eventDetail(current.participant, eventId)).schedule.publication_state).toBe('published');
  });

  test('member registration fills a manager-seeded capacity', async ({ page }, testInfo) => {
    const current = getHarness();
    if (!apiContext) throw new Error('Events E2E API context is not initialized.');
    const marker = `${testInfo.project.name}-${testInfo.workerIndex}-${Date.now()}`;
    const title = `E2E Operations Event ${marker}`;
    const schedule = attendanceWindowSchedule();
    const createResponse = await apiContext.post(apiUrl('/v2/events'), {
      data: {
        title,
        description: `Run-scoped registration, People, check-in and notification evidence for ${marker}.`,
        start_time: schedule.start.toISOString(),
        end_time: schedule.end.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        location: 'E2E Operations Hall',
        max_attendees: 2,
      },
      headers: actorHeaders(current.admin.token, true),
    });
    const created = await requireApiData<EventDetailContract>(createResponse, [201], 'create operations Event');
    current.operationsEvent = { id: created.id, title };
    expect(created.schedule.publication_state).toBe('draft');
    expect(created.permissions.publish).toBe(true);

    const publishResponse = await apiContext.post(apiUrl(`/v2/events/${created.id}/publish`), {
      data: {},
      headers: actorHeaders(current.admin.token, true),
    });
    const published = await requireApiData<EventDetailContract>(publishResponse, [200], 'publish operations Event');
    expect(published.schedule.publication_state).toBe('published');

    const invited = await bulkRegistration(
      created.id,
      current.admin,
      current.rosterMember.id,
      'invite',
      0,
      marker,
    );
    expect(invited.results[0]?.mutation?.state).toBe('invited');
    const approved = await bulkRegistration(
      created.id,
      current.admin,
      current.rosterMember.id,
      'approve',
      1,
      marker,
    );
    expect(approved.results[0]?.mutation?.state).toBe('confirmed');

    const availableRelationship = await eventRelationship(current.participant, created.id);
    expect(availableRelationship.registration.state).toBeNull();
    expect(availableRelationship.actions.registrable).toBe(true);
    expect(availableRelationship.actions.confirm).toBe(true);
    expect(availableRelationship.capacity.confirmed).toBe(1);
    expect(availableRelationship.capacity.remaining).toBe(1);
    expect(availableRelationship.capacity.is_full).toBe(false);

    const availableEvent = await eventDetail(current.participant, created.id);
    expect(availableEvent.relationship?.registration.can_register).toBe(true);
    expect(availableEvent.relationship?.capacity.confirmed).toBe(1);
    expect(availableEvent.relationship?.capacity.remaining).toBe(1);

    await useActor(page, current.participant);
    const detailPage = new EventDetailPage(page);
    await detailPage.navigateToEvent(created.id);
    await detailPage.waitForLoad();
    await expect(detailPage.goingButton).toBeVisible();
    const registrationPromise = page.waitForResponse(
      (response) => isEventResponse(response, 'POST', `/v2/events/${created.id}/rsvp`),
    );
    await detailPage.rsvpGoing();
    const registrationResponse = await registrationPromise;
    expect(registrationResponse.status(), JSON.stringify(await responseBody(registrationResponse))).toBe(200);
    // A successful RSVP deliberately re-fetches the detail and roster, which
    // replaces the page with its loading skeleton. Synchronize on that state
    // transition instead of racing a five-second assertion against the reload.
    await detailPage.waitForLoad();
    // Confirmed registrations replace the Going radio with a status chip and
    // retain only actions the member can still take (for example withdrawal).
    await expect(page.getByText("You're Going", { exact: true }).first()).toBeVisible();

    const relationship = await eventRelationship(current.participant, created.id);
    expect(relationship.registration.state).toBe('confirmed');
    expect(relationship.capacity.confirmed).toBe(2);
    expect(relationship.capacity.remaining).toBe(0);
    expect(relationship.capacity.is_full).toBe(true);
  });

  test('member withdraws, then joins the full canonical waitlist', async ({ page }) => {
    const current = getHarness();
    const event = getOperationsEvent();
    await useActor(page, current.participant);
    const detailPage = new EventDetailPage(page);
    await detailPage.navigateToEvent(event.id);
    await detailPage.waitForLoad();
    await expect(page.getByText("You're Going", { exact: true }).first()).toBeVisible();
    await expect(detailPage.notGoingButton).toBeVisible();
    await detailPage.notGoingButton.click();

    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation.getByRole('heading', { name: 'RSVP for this event' })).toBeVisible();
    const withdrawalPromise = page.waitForResponse(
      (response) => isEventResponse(response, 'POST', `/v2/events/${event.id}/rsvp`),
    );
    await confirmation.getByRole('button', { name: 'Not Going', exact: true }).click();
    const withdrawalResponse = await withdrawalPromise;
    expect(withdrawalResponse.status(), JSON.stringify(await responseBody(withdrawalResponse))).toBe(200);
    expect((await eventRelationship(current.participant, event.id)).registration.state).toBe('cancelled');

    if (!apiContext) throw new Error('Events E2E API context is not initialized.');
    const capacityResponse = await apiContext.put(apiUrl(`/v2/events/${event.id}`), {
      data: { max_attendees: 1 },
      headers: actorHeaders(current.admin.token, true),
    });
    const capacityEvent = await requireApiData<EventDetailContract>(capacityResponse, [200], 'lower Event capacity');
    expect(capacityEvent.id).toBe(event.id);

    await page.reload();
    await detailPage.waitForLoad();
    const joinWaitlist = page.getByRole('button', { name: 'Join the waitlist for this event' });
    await expect(joinWaitlist).toBeVisible();
    const waitlistPromise = page.waitForResponse(
      (response) => isEventResponse(response, 'POST', `/v2/events/${event.id}/waitlist`),
    );
    await joinWaitlist.click();
    const waitlistResponse = await waitlistPromise;
    expect([200, 201], JSON.stringify(await responseBody(waitlistResponse))).toContain(waitlistResponse.status());
    await expect(page.getByText(/On Waitlist(?: \(#1\))?/).first()).toBeVisible();

    const relationship = await eventRelationship(current.participant, event.id);
    expect(relationship.registration.state).toBe('cancelled');
    expect(relationship.waitlist.state).toBe('waiting');
    expect(relationship.waitlist.position).toBe(1);
    expect(relationship.capacity.confirmed).toBe(1);
    expect(relationship.capacity.is_full).toBe(true);
  });

  test('manager sees People state and checks in the confirmed roster member', async ({ page }) => {
    const current = getHarness();
    const event = getOperationsEvent();
    await useActor(page, current.admin);
    await page.goto(`${FRONTEND_BASE_URL}/${TENANT}/events/${event.id}/manage/people`);
    await expect(page).toHaveURL(new RegExp(`/${TENANT}/events/${event.id}/manage/people$`));

    const peopleTable = page.getByRole('grid', { name: 'Event people' });
    await expect(peopleTable).toBeVisible({ timeout: 20_000 });
    const confirmedRow = peopleTable.getByRole('row').filter({ hasText: current.rosterMember.name });
    const waitlistedRow = peopleTable.getByRole('row').filter({ hasText: current.participant.name });
    await expect(confirmedRow).toContainText('Confirmed');
    await expect(waitlistedRow).toContainText('Cancelled');
    await expect(waitlistedRow).toContainText('Waiting');
    await expect(waitlistedRow).toContainText('Position 1');

    await page.goto(`${FRONTEND_BASE_URL}/${TENANT}/events/${event.id}/manage/check-in`);
    const checkInTable = page.getByRole('grid', { name: 'Manual check-in roster' });
    await expect(checkInTable).toBeVisible({ timeout: 25_000 });
    const checkInRow = checkInTable.getByRole('row').filter({ hasText: current.rosterMember.name });
    await expect(checkInRow).toContainText('Not checked in');
    const checkInPromise = page.waitForResponse(
      (response) => isEventResponse(
        response,
        'POST',
        `/v2/events/${event.id}/people/${current.rosterMember.id}/attendance`,
      ),
    );
    await checkInRow.getByRole('button', { name: 'Check in', exact: true }).click();
    const checkInResponse = await checkInPromise;
    expect(checkInResponse.status(), JSON.stringify(await responseBody(checkInResponse))).toBe(200);
    await expect(checkInRow).toContainText('Checked in');
  });

  test('event cancellation is visible in the waitlisted member notification center', async ({ page, browser }) => {
    const current = getHarness();
    const event = getOperationsEvent();
    await useActor(page, current.admin);
    const detailPage = new EventDetailPage(page);
    await detailPage.navigateToEvent(event.id);
    await detailPage.waitForLoad();
    await page.getByRole('button', { name: `Cancel ${event.title}`, exact: true }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Cancel Event', exact: true })).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Reason for cancellation' }).fill(CANCELLATION_REASON);
    const cancelPromise = page.waitForResponse(
      (response) => isEventResponse(response, 'POST', `/v2/events/${event.id}/cancel`),
    );
    await dialog.getByRole('button', { name: 'Cancel Event', exact: true }).click();
    const cancelResponse = await cancelPromise;
    expect(cancelResponse.status(), JSON.stringify(await responseBody(cancelResponse))).toBe(200);
    await expect(page.getByText('Event Cancelled', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`Reason: ${CANCELLATION_REASON}`, { exact: true })).toBeVisible();

    processAuthoritativeEventOutbox();

    const notificationBrowser = await openNotificationPage(browser, current.participant);
    try {
      await notificationBrowser.page.goto(`${FRONTEND_BASE_URL}/${TENANT}/notifications`);
      await expect(notificationBrowser.page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
      const cancellationMessage = notificationBrowser.page.locator('p')
        .filter({ hasText: event.title })
        .filter({ hasText: CANCELLATION_REASON })
        .first();
      await expect(cancellationMessage).toBeVisible({ timeout: 20_000 });
    } finally {
      await notificationBrowser.close();
    }

    expect((await eventDetail(current.admin, event.id)).schedule.operational_state).toBe('cancelled');
  });
});
