// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Paired Laravel / ASP.NET arms for the Caring caregiver-consent journey.
 *
 * 🔴 WHAT THIS IS FOR, IN THE WORDS OF THE STANDARD IT SERVES.
 *
 * ADR-0004 makes a journey CERTIFIED only with all five of:
 *   1. the unchanged client driving it through its own UI against ASP.NET, by
 *      configuration change only;
 *   2. an assertion on the EFFECT, not just the render;
 *   3. the same journey passing against Laravel IN THE SAME RUN, so a fixture
 *      difference cannot be mistaken for a backend fault;
 *   4. a committed automated test, so it cannot silently regress;
 *   5. no do-nothing endpoint on the path it exercises.
 *
 * This module exists for (3): both arms in one execution. Condition (1) is met
 * because the React app is switched with `VITE_BACKEND_TARGET`, and not one line
 * of `react-frontend/` is branched on the backend. Condition (2) is met by
 * reading rows back out of each backend's OWN database — MariaDB for Laravel,
 * PostgreSQL for ASP.NET — in a separate process from the API that wrote them.
 *
 * 🔴 WHAT EQUIVALENCE MEANS HERE, AND WHAT IT DOES NOT.
 *
 * ADR-0004 targets journey equivalence at CONSUMED boundaries, not field-for-
 * field response matching. A field is in scope only if a client reads it, acts
 * on it, or its difference changes an outcome. Where ASP.NET returns a SUPERSET
 * of what a client reads, that is not a gap. Where it returns less, or a
 * different value, it is a defect however obscure the field looks.
 *
 * So `CONSUMED_FIELDS` below is derived from the React components themselves,
 * not from either backend's response — deriving it from a response would make
 * the check circular and it would pass by construction.
 *
 * 🔴 BOTH ARMS ARE DISPOSABLE. The Laravel arm is :8091 (`nexus_webuk_e2e`,
 * synthetic accounts) — never :8090, whose `nexus` database is a
 * production-derived snapshot of real members. The ASP.NET arm is the dev stack
 * on :5080. Neither is a production system; the live ASP.NET containers
 * (`nexus-backend-*`) are not touched by anything here.
 */

import { execFileSync } from 'node:child_process';
import { expect, type Browser, type Page } from '@playwright/test';

export type ArmKey = 'laravel' | 'aspnet';
export type ParityActorKey = 'caregiver' | 'recipient' | 'staff';

export interface ParityActor {
  email: string;
  password: string;
  userId?: number;
  token?: string;
  /** When the current token was issued — see `tokenFor` for why this matters. */
  tokenIssuedAt?: number;
  displayName?: string;
}

export interface CaringArm {
  key: ArmKey;
  label: string;
  /** Vite dev server, switched by configuration only. */
  baseUrl: string;
  /** The backend origin behind it. */
  apiUrl: string;
  tenantSlug: string;
  tenantId: number;
  /** Header the backend uses to resolve a tenant for unauthenticated calls. */
  tenantHeader: Record<string, string>;
  actors: Record<ParityActorKey, ParityActor>;
}

/**
 * 🔴 Derived from the React components, NOT from a backend response.
 *
 *  - `CaregiverDashboardPage.tsx` — the `CaregiverLink` and
 *    `IncomingCaregiverLink` interfaces;
 *  - `CaregiverLinkReviewPanel.tsx` — the `ReviewLink` type.
 *
 * If a component starts reading a new field, add it here. Anything the backend
 * sends that is NOT listed is out of scope and must not be reported as a
 * difference.
 */
export const CONSUMED_FIELDS = {
  myLinks: [
    'id', 'cared_for_id', 'relationship_type', 'is_primary', 'start_date',
    'notes', 'cared_for_name', 'cared_for_avatar_url',
    'status', 'recipient_confirmed_at', 'rejection_reason'
  ],
  incomingLinks: [
    'id', 'caregiver_id', 'caregiver_name', 'caregiver_avatar_url',
    'relationship_type', 'status', 'recipient_confirmed_at'
  ],
  reviewQueue: [
    'id', 'caregiver_id', 'caregiver_name', 'cared_for_id', 'cared_for_name',
    'relationship_type', 'status', 'recipient_confirmed_at', 'created_at'
  ]
} as const;

export const LARAVEL_ARM: CaringArm = {
  key: 'laravel',
  label: 'Laravel control',
  baseUrl: process.env.CARING_PARITY_LARAVEL_BASE || 'http://127.0.0.1:5174',
  apiUrl: process.env.CARING_PARITY_LARAVEL_API || 'http://127.0.0.1:8091',
  tenantSlug: 'e2e-community',
  tenantId: 103,
  tenantHeader: { 'X-Tenant-Slug': 'e2e-community' },
  actors: {
    caregiver: { email: 'e2e.user.a@project-nexus.local', password: 'TestPassword123!' },
    recipient: { email: 'e2e.user.b@project-nexus.local', password: 'TestPassword123!' },
    staff: { email: 'e2e.admin@project-nexus.local', password: 'AdminPassword123!' }
  }
};

export const ASPNET_ARM: CaringArm = {
  key: 'aspnet',
  label: 'ASP.NET candidate',
  baseUrl: process.env.CARING_PARITY_ASPNET_BASE || 'http://127.0.0.1:5175',
  apiUrl: process.env.CARING_PARITY_ASPNET_API || 'http://127.0.0.1:5080',
  tenantSlug: 'acme',
  tenantId: 1,
  tenantHeader: { 'X-Tenant-ID': '1' },
  // 🔴 The two fixtures hold DIFFERENT accounts by design — that is the point of
  // a control arm. Comparing outcomes across different fixtures is what proves a
  // difference is a BACKEND difference and not a seed difference.
  actors: {
    caregiver: { email: 'member@acme.test', password: 'NexusV2!Demo#2026' },
    recipient: { email: 'coordinator@acme.test', password: 'NexusV2!Demo#2026' },
    staff: { email: 'admin@acme.test', password: 'NexusV2!Demo#2026' }
  }
};

export const ARMS: CaringArm[] = [LARAVEL_ARM, ASPNET_ARM];

export interface ApiResult<T = any> {
  status: number;
  json: T | null;
  text: string;
}

export function unwrap<T = any>(json: any): T {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

/**
 * A list from a response, whatever shape it arrives in.
 *
 * 🔴 Never assume an array. `/v2/users/search` answers `{ items: [...] }` and a
 * component that assumed an array rendered a permanent empty state because
 * `.length` on that object is `undefined`. The same assumption here threw
 * "unwrap is not iterable" on the first ASP.NET call. Both engines are free to
 * paginate; the caller only ever wants the rows.
 */
export function asRows(json: any): any[] {
  const data = unwrap<any>(json);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.links)) return data.links;
  if (Array.isArray(data?.data)) return data.data;
  return [];
}

export async function armApi<T = any>(
  arm: CaringArm,
  method: string,
  pathname: string,
  opts: { token?: string; body?: unknown } = {}
): Promise<ApiResult<T>> {
  const res = await fetch(`${arm.apiUrl}/api${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...arm.tenantHeader,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {})
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

/**
 * A token that is still valid at the moment of the call.
 *
 * 🔴 THE ASP.NET DEV STACK ISSUES TOKENS THAT LIVE FIVE SECONDS.
 *
 * `aspnet-backend/compose.yml` sets `Jwt__TestAccessTokenExpirySeconds=5` with
 * `Jwt__TestClockSkewSeconds=0` — deliberate certification controls for testing
 * expiry and refresh, and production ignores them. The consequence for any
 * harness is severe and easy to misread: sign in during `beforeAll`, and by the
 * first assertion every ASP.NET call answers
 * `{"code":"auth_required"}`. That looks exactly like a missing endpoint or a
 * broken authorisation rule, and it is neither.
 *
 * So a token is re-minted whenever the current one is close to expiry. Laravel's
 * tokens are long-lived and take the cheap path.
 */
const TOKEN_MAX_AGE_MS = 3000;

async function loginActor(arm: CaringArm, actor: ParityActor): Promise<void> {
  const body: Record<string, unknown> = { email: actor.email, password: actor.password };
  if (arm.key === 'laravel') body.tenant_slug = arm.tenantSlug;
  else body.tenant_id = arm.tenantId;

  const res = await armApi<any>(arm, 'POST', '/auth/login', { body });
  const token = res.json?.access_token ?? res.json?.data?.access_token;
  const user = res.json?.user ?? res.json?.data?.user;
  if (!token || !user?.id) {
    fail(arm, `Could not sign in ${actor.email}.`, `${res.status}: ${res.text.slice(0, 300)}`);
  }
  actor.token = token;
  actor.tokenIssuedAt = Date.now();
  actor.userId = Number(user.id);
  actor.displayName =
    [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || String(user.email);
}

export async function tokenFor(arm: CaringArm, actor: ParityActor): Promise<string> {
  const age = Date.now() - (actor.tokenIssuedAt ?? 0);
  if (!actor.token || age > TOKEN_MAX_AGE_MS) {
    await loginActor(arm, actor);
  }
  return actor.token!;
}

/**
 * Call as an actor, with a guaranteed-fresh token and one retry on 401.
 *
 * The retry is not papering over an auth defect: a genuine authorisation refusal
 * is a 403, and a second 401 after a fresh token is still reported as a 401.
 */
export async function armApiAs<T = any>(
  arm: CaringArm,
  actor: ParityActor,
  method: string,
  pathname: string,
  body?: unknown
): Promise<ApiResult<T>> {
  let token = await tokenFor(arm, actor);
  let res = await armApi<T>(arm, method, pathname, { token, body });
  if (res.status === 401) {
    await loginActor(arm, actor);
    token = actor.token!;
    res = await armApi<T>(arm, method, pathname, { token, body });
  }
  return res;
}

function fail(arm: CaringArm, reason: string, detail?: string): never {
  throw new Error(
    `\n🔴 [${arm.label}] caregiver parity arm unavailable.\n\n${reason}\n`
      + (detail ? `\nDetail: ${detail}\n` : '')
      + `\nBoth arms must be up for a paired run:\n`
      + `  Laravel : bash scripts/caring-e2e-provision.sh    (API :8091)\n`
      + `            cd react-frontend && VITE_API_URL=http://127.0.0.1:8091 \\\n`
      + `              npx vite --port 5174 --strictPort --host 127.0.0.1\n`
      + `  ASP.NET : cd aspnet-backend && docker compose up -d api   (API :5080)\n`
      + `            cd react-frontend && VITE_BACKEND_TARGET=dotnet \\\n`
      + `              VITE_API_URL=http://127.0.0.1:5080 npx vite --port 5175 \\\n`
      + `              --strictPort --host 127.0.0.1 --mode dotnet\n`
  );
}

/** Authenticate all three actors on one arm and record their ids. */
export async function signInArm(arm: CaringArm): Promise<CaringArm> {
  for (const key of Object.keys(arm.actors) as ParityActorKey[]) {
    const actor = arm.actors[key];
    await loginActor(arm, actor);
    // Clear the legal gate where one exists; a no-op otherwise.
    await armApi(arm, 'POST', '/v2/legal/acceptance/accept-all', { token: actor.token, body: {} })
      .catch(() => null);
  }

  const ids = (Object.keys(arm.actors) as ParityActorKey[]).map((k) => arm.actors[k].userId);
  if (new Set(ids).size !== ids.length) {
    fail(arm, `The three actors are not distinct accounts: ${JSON.stringify(ids)}`);
  }
  return arm;
}

/** Both arms must answer before a paired run means anything. */
export async function assertBothArmsReachable(): Promise<void> {
  for (const arm of ARMS) {
    for (const [label, url] of [['frontend', `${arm.baseUrl}/`], ['backend', arm.apiUrl]] as const) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (res.status >= 500) fail(arm, `${label} at ${url} answered ${res.status}.`);
      } catch {
        fail(arm, `${label} at ${url} did not answer.`);
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Effect assertions — each arm's OWN database, in a separate process
// ---------------------------------------------------------------------------

/**
 * 🔴 Reading the row back is what makes this an EFFECT assertion rather than a
 * render assertion. A 200 is not evidence: Laravel's services routinely swallow
 * `Throwable` and return a falsy default, so a write against a missing column
 * comes back as a plausible response. The API answer cannot be its own proof.
 */
export function readLinkRow(arm: CaringArm, linkId: number): Record<string, string> | null {
  if (arm.key === 'laravel') {
    const sql =
      `SELECT id, tenant_id, caregiver_id, cared_for_id, status,`
      + ` IFNULL(recipient_confirmed_at,'') recipient_confirmed_at,`
      + ` IFNULL(recipient_confirmed_by,'') recipient_confirmed_by,`
      + ` IFNULL(consent_verified_by,'') consent_verified_by,`
      + ` IFNULL(consent_evidence,'') consent_evidence,`
      + ` IFNULL(approved_by,'') approved_by,`
      + ` IFNULL(rejected_by,'') rejected_by,`
      + ` IFNULL(rejection_reason,'') rejection_reason`
      + ` FROM caring_caregiver_links WHERE id = ${Number(linkId)}`;
    const rows = mysqlQuery(sql);
    return rows[0] ?? null;
  }

  // 🔴 PostgreSQL, and the columns are PascalCase — EF's default. They are
  // aliased to the Laravel spellings so the two arms can be compared without the
  // comparison itself having to know which engine it is looking at.
  const sql =
    `SELECT "Id" AS id, "TenantId" AS tenant_id, "CaregiverId" AS caregiver_id,`
    + ` "CaredForId" AS cared_for_id, "Status" AS status,`
    + ` COALESCE("RecipientConfirmedAt"::text,'') AS recipient_confirmed_at,`
    + ` COALESCE("RecipientConfirmedBy"::text,'') AS recipient_confirmed_by,`
    + ` COALESCE("ConsentVerifiedBy"::text,'') AS consent_verified_by,`
    + ` COALESCE("ConsentEvidence",'') AS consent_evidence,`
    + ` COALESCE("ApprovedBy"::text,'') AS approved_by,`
    + ` COALESCE("RejectedBy"::text,'') AS rejected_by,`
    + ` COALESCE("RejectionReason",'') AS rejection_reason`
    + ` FROM caring_caregiver_links WHERE "Id" = ${Number(linkId)}`;
  const rows = psqlQuery(sql);
  return rows[0] ?? null;
}

/** Notification rows delivered to one member on one arm. */
export function readNotificationTypes(arm: CaringArm, userId: number, sinceMinutes = 60): string[] {
  if (arm.key === 'laravel') {
    return mysqlQuery(
      `SELECT type FROM notifications WHERE user_id = ${Number(userId)}`
        + ` AND created_at > DATE_SUB(NOW(), INTERVAL ${Number(sinceMinutes)} MINUTE) ORDER BY id`
    ).map((row) => row.type);
  }
  return psqlQuery(
    `SELECT "Type" AS type FROM notifications WHERE "UserId" = ${Number(userId)}`
      + ` AND "CreatedAt" > NOW() - INTERVAL '${Number(sinceMinutes)} minutes' ORDER BY "Id"`
  ).map((row) => row.type);
}

const DISPOSABLE_MYSQL_DB = 'nexus_webuk_e2e';

function mysqlQuery(sql: string): Array<Record<string, string>> {
  if (/\b(nexus_test|`?nexus`?\.)\b/.test(sql)) {
    throw new Error(`Refusing a query naming a non-disposable database:\n${sql}`);
  }
  const raw = execFileSync(
    'docker',
    ['exec', '-i', 'nexus-php-db', 'mysql', '--skip-ssl', '-h', '127.0.0.1', '-unexus',
      '-pnexus_secret', DISPOSABLE_MYSQL_DB, '-e', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return tabular(raw);
}

function psqlQuery(sql: string): Array<Record<string, string>> {
  const raw = execFileSync(
    'docker',
    ['exec', '-i', 'nexus-aspnet-dev-db', 'psql', '-U', 'postgres', '-d', 'nexus_dev',
      '-A', '-F', '\t', '--pset', 'footer=off', '-c', sql],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  );
  return tabular(raw);
}

function tabular(raw: string): Array<Record<string, string>> {
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split('\t').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// Browser
// ---------------------------------------------------------------------------

/** Storage state for one actor on one arm. Keys mirror react-frontend/src/lib/api.ts. */
export function armStorageState(arm: CaringArm, actor: ParityActor) {
  if (!actor.token) throw new Error(`Refusing to build an empty storage state for ${actor.email}.`);
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(arm.baseUrl).origin,
        localStorage: [
          { name: 'nexus_access_token', value: actor.token },
          { name: 'nexus_tenant_id', value: String(arm.tenantId) },
          {
            name: 'nexus_cookie_consent',
            value: JSON.stringify({
              essential: true, analytics: false, preferences: true,
              timestamp: new Date().toISOString()
            })
          }
        ]
      }
    ]
  };
}

export async function armPage(browser: Browser, arm: CaringArm, actor: ParityActor) {
  // Mint immediately before the context is built — a five-second ASP.NET token
  // baked into storage state is expired before the first navigation completes.
  await tokenFor(arm, actor);
  const context = await browser.newContext({
    baseURL: arm.baseUrl,
    storageState: armStorageState(arm, actor),
    viewport: { width: 1440, height: 950 }
  });
  return { context, page: await context.newPage() };
}

export function armPath(arm: CaringArm, pathname: string): string {
  return `/${arm.tenantSlug}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/** Prove the browser is on the intended page and not a login redirect. */
export async function assertArmLandedOn(
  page: Page,
  arm: CaringArm,
  expected: RegExp,
  label: string
): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  const pathname = new URL(page.url()).pathname;
  expect(
    pathname,
    `[${arm.label}] expected ${label}, but the browser was redirected to LOGIN (${pathname})`
  ).not.toMatch(/\/login\b/);
  expect(pathname, `[${arm.label}] expected ${label} matching ${expected}, got ${pathname}`).toMatch(
    expected
  );
}

/**
 * Answer the Caring first-visit modal if it appears.
 *
 * Waits rather than sampling once: it resolves after the route settles, so an
 * immediate check reports "no modal" and the modal then covers the next click.
 */
export async function answerCaringOnboarding(page: Page): Promise<boolean> {
  const showAll = page.getByText('Show me everything', { exact: false }).first();
  try {
    await showAll.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return false;
  }
  await showAll.click();
  await expect(page.locator('[data-slot="modal-backdrop"]').first()).toBeHidden({ timeout: 15000 });
  return true;
}

/** Fields present on a row, restricted to those a client actually reads. */
export function consumedShape(row: Record<string, unknown> | undefined, consumed: readonly string[]) {
  const present = new Set(Object.keys(row ?? {}));
  return {
    missing: consumed.filter((field) => !present.has(field)),
    present: consumed.filter((field) => present.has(field))
  };
}
