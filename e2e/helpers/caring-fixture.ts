// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Three-actor fixture for the Caring Community caregiver-consent journey.
 *
 * 🔴 WHY THIS EXISTS, AND WHY IT IS NOT `e2e/global.setup.ts`.
 *
 * The caregiver-consent journey needs three DISTINCT same-tenant actors acting
 * on ONE record in sequence — a member proposing to be a caregiver, the member
 * receiving care, and a staff reviewer. The maintained global setup builds a
 * two-actor fixture (member + admin) against `hour-timebank`, whose local
 * database is a PRODUCTION-DERIVED snapshot of real members. This journey
 * WRITES caregiver relationships, consent evidence and safeguarding decisions,
 * so it must never run there.
 *
 * It therefore targets the disposable stack built by
 * `bash scripts/webuk-e2e-env.sh up` — database `nexus_webuk_e2e`, synthetic
 * members only, Laravel on :8091 — with a Vite pointed at that API. Port 5173
 * belongs to the developer's own Vite and is deliberately NOT used.
 *
 * 🔴 THE PRIOR ATTEMPT FAILED BEFORE AUTHENTICATION AND THAT MUST NOT RECUR.
 *
 * `react-frontend/e2e/global-setup.ts` still logs in at `/t/{tenant}/login`.
 * The maintained route is `/{tenant}/login` — no `/t` segment — so it never
 * authenticated. Changing `/t/` to `/` is NOT the fix on its own: the deeper
 * fault is that nothing downstream asserted WHICH page the browser reached, so
 * an unauthenticated run could still walk through "successfully". Every helper
 * below therefore proves page identity rather than assuming it, and this module
 * THROWS rather than skips when a prerequisite is missing — a silent skip is
 * indistinguishable from a pass in a summary, which is exactly how a broken
 * journey gets reported as working.
 *
 * Structurally opt-in: the journey spec lives in `e2e/journeys/`, outside the
 * root config's `testDir` (`e2e/tests`), so the default suite cannot pick it up
 * and run it against the wrong stack. Run it with `npm run test:e2e:caring`.
 */

import { execFileSync } from 'node:child_process';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

/** Disposable Laravel from `scripts/webuk-e2e-env.sh`. NOT the :8090 dev stack. */
export const CARING_API_URL = process.env.CARING_E2E_API_URL || 'http://127.0.0.1:8091';

/** Vite pointed at CARING_API_URL. NOT 5173 — that port is the developer's own. */
export const CARING_BASE_URL = process.env.CARING_E2E_BASE_URL || 'http://127.0.0.1:5174';

/** Synthetic community seeded by the disposable environment. */
export const CARING_TENANT = process.env.CARING_E2E_TENANT || 'e2e-community';

/** A SECOND synthetic community, used only to prove tenant isolation. */
export const CARING_OTHER_TENANT = process.env.CARING_E2E_OTHER_TENANT || 'e2e-other';

/**
 * The synthetic email domain. Every account in the target database must match
 * this or `@example.*`; anything else means we are pointed at real member data
 * and the run is aborted.
 */
const SYNTHETIC_EMAIL = /@project-nexus\.local$|@example\./;

const SETUP_HINT = [
  'Start the disposable environment first:',
  '',
  '  bash scripts/webuk-e2e-env.sh up',
  '  docker exec nexus-webuk-e2e-app php artisan migrate --force',
  '  (cd react-frontend && VITE_API_URL=http://127.0.0.1:8091 \\',
  '     npx vite --port 5174 --strictPort --host 127.0.0.1)',
  '',
  'The caring_community feature must be enabled on the synthetic community;',
  'see e2e/journeys/caring/README.md for the one-shot provisioning command.',
].join('\n');

export type ActorKey = 'caregiver' | 'recipient' | 'staff' | 'otherStaff' | 'spare';

export interface ActorCredentials {
  email: string;
  password: string;
  tenantSlug: string;
  /** Human label used in failure messages. */
  role: string;
}

/**
 * The three same-tenant actors, plus a fourth in a DIFFERENT community whose
 * only job is to demonstrate that tenant scoping holds. Passwords are the
 * disposable environment's documented synthetic credentials — they are not
 * secrets and grant nothing outside `nexus_webuk_e2e`.
 */
export const CARING_ACTORS: Record<ActorKey, ActorCredentials> = {
  caregiver: {
    email: process.env.CARING_E2E_CAREGIVER_EMAIL || 'e2e.user.a@project-nexus.local',
    password: process.env.CARING_E2E_CAREGIVER_PASSWORD || 'TestPassword123!',
    tenantSlug: CARING_TENANT,
    role: 'ordinary member proposing to be a caregiver',
  },
  recipient: {
    email: process.env.CARING_E2E_RECIPIENT_EMAIL || 'e2e.user.b@project-nexus.local',
    password: process.env.CARING_E2E_RECIPIENT_PASSWORD || 'TestPassword123!',
    tenantSlug: CARING_TENANT,
    role: 'ordinary member receiving care',
  },
  staff: {
    email: process.env.CARING_E2E_STAFF_EMAIL || 'e2e.admin@project-nexus.local',
    password: process.env.CARING_E2E_STAFF_PASSWORD || 'AdminPassword123!',
    tenantSlug: CARING_TENANT,
    role: 'authorised staff reviewer',
  },
  otherStaff: {
    email: process.env.CARING_E2E_OTHER_STAFF_EMAIL || 'e2e.other.admin@project-nexus.local',
    password: process.env.CARING_E2E_OTHER_STAFF_PASSWORD || 'AdminPassword123!',
    tenantSlug: CARING_OTHER_TENANT,
    role: 'staff reviewer in a DIFFERENT community',
  },
  /**
   * 🔴 A FIFTH member, purely as a second care recipient.
   *
   * Several checks need a link that is deliberately NOT the one flowing through
   * the main journey — an unconfirmed link to prove the server refuses to
   * approve it, and a throwaway link to reject. The duplicate guard correctly
   * refuses a second live link for a pair that already has one, so reusing the
   * primary caregiver/recipient pair made those checks fail to set up.
   *
   * The first attempt papered over that with `test.skip(...)` when creation was
   * refused — which is exactly the failure mode this journey is meant to avoid:
   * a skipped safeguarding check reads as a pass in the summary. A distinct
   * recipient lets both checks genuinely run.
   *
   * The broker account is used because it already exists in the fixture with
   * every login gate satisfied. Its `broker` ROLE is irrelevant here — it acts
   * only as a member receiving a caregiver proposal.
   */
  spare: {
    email: process.env.CARING_E2E_SPARE_EMAIL || 'e2e.broker@project-nexus.local',
    password: process.env.CARING_E2E_SPARE_PASSWORD || 'TestPassword123!',
    tenantSlug: CARING_TENANT,
    role: 'a second care recipient, for auxiliary checks',
  },
};

export interface Actor extends ActorCredentials {
  key: ActorKey;
  userId: number;
  tenantId: number;
  displayName: string;
  token: string;
}

export interface ApiResult<T = unknown> {
  status: number;
  ok: boolean;
  json: T | null;
  text: string;
}

/** Laravel wraps most payloads in `{ data: ... }`; unwrap exactly one level. */
export function unwrap<T = any>(json: any): T {
  return json && typeof json === 'object' && 'data' in json ? json.data : json;
}

/** Raw call against the DISPOSABLE API. `tenantSlug` sets X-Tenant-Slug. */
export async function callApi<T = any>(
  method: string,
  pathname: string,
  opts: { token?: string; body?: unknown; tenantSlug?: string } = {},
): Promise<ApiResult<T>> {
  const res = await fetch(`${CARING_API_URL}/api${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Slug': opts.tenantSlug || CARING_TENANT,
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let json: T | null = null;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = null;
  }
  return { status: res.status, ok: res.ok, json, text };
}

/** Convenience: call as a resolved actor. */
export function asActor<T = any>(
  actor: Actor,
  method: string,
  pathname: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  return callApi<T>(method, pathname, { token: actor.token, body, tenantSlug: actor.tenantSlug });
}

function fail(reason: string, detail?: string): never {
  throw new Error(
    `\n🔴 Caring caregiver journey fixture unavailable.\n\n${reason}\n` +
      (detail ? `\nDetail: ${detail}\n` : '') +
      `\n${SETUP_HINT}\n`,
  );
}

async function reachable(url: string, timeoutMs = 5000): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export interface FixtureEnvironment {
  tenantId: number;
  tenantName: string;
  caringEnabled: boolean;
}

/**
 * Prove the environment is present, disposable, and correctly configured.
 *
 * Throws — never returns a degraded result and never skips. A missing fixture
 * must be loud, because the failure this replaces was a journey that appeared
 * to pass while sitting on a login page.
 */
export async function assertCaringFixtureEnvironment(): Promise<FixtureEnvironment> {
  const apiHealth = await reachable(`${CARING_API_URL}/health.php`);
  if (apiHealth !== 200) {
    fail(
      `The disposable Laravel API did not answer on ${CARING_API_URL}.`,
      `GET /health.php returned ${apiHealth || 'no response'}.`,
    );
  }

  const frontend = await reachable(`${CARING_BASE_URL}/`);
  if (frontend !== 200) {
    fail(
      `The frontend under test did not answer on ${CARING_BASE_URL}.`,
      `GET / returned ${frontend || 'no response'}. This journey must NOT be pointed at ` +
        `port 5173, which is the developer's own Vite against the production-derived stack.`,
    );
  }

  // The frontend must proxy to the DISPOSABLE API, not to :8090. Ask it for the
  // tenant bootstrap through its own proxy and check the identity that comes back.
  const bootstrapRes = await fetch(
    `${CARING_BASE_URL}/api/v2/tenant/bootstrap?tenant=${encodeURIComponent(CARING_TENANT)}`,
    { headers: { 'X-Tenant-Slug': CARING_TENANT } },
  );
  const bootstrap = unwrap<any>(await bootstrapRes.json().catch(() => null));
  if (!bootstrap?.id || bootstrap.slug !== CARING_TENANT) {
    fail(
      `${CARING_BASE_URL} is not proxying to the disposable community '${CARING_TENANT}'.`,
      `Bootstrap returned: ${JSON.stringify(bootstrap)?.slice(0, 300)}`,
    );
  }

  const caringEnabled = bootstrap?.features?.caring_community === true;
  if (!caringEnabled) {
    fail(
      `The caring_community feature is DISABLED on '${CARING_TENANT}'.`,
      `It defaults to false (TenantFeatureConfig::FEATURE_DEFAULTS). Enable it on the ` +
        `synthetic community only — never on a production-derived tenant.`,
    );
  }

  return {
    tenantId: Number(bootstrap.id),
    tenantName: String(bootstrap.name ?? ''),
    caringEnabled,
  };
}

/**
 * Authenticate one actor against the REAL Laravel API and return a usable token.
 *
 * Also clears the "Updated legal documents" gate, which renders a full-screen
 * opaque modal that blocks every click for authenticated members. Without it a
 * journey stalls on an invisible obstacle and reads as a broken feature.
 */
export async function authenticateActor(key: ActorKey): Promise<Actor> {
  const creds = CARING_ACTORS[key];

  const login = await callApi<any>('POST', '/auth/login', {
    body: { email: creds.email, password: creds.password, tenant_slug: creds.tenantSlug },
    tenantSlug: creds.tenantSlug,
  });

  const token: string | undefined = login.json?.access_token ?? login.json?.data?.access_token;
  const user: any = login.json?.user ?? login.json?.data?.user;

  if (!token || !user?.id) {
    fail(
      `Could not authenticate the ${creds.role} (${creds.email}).`,
      `POST /api/auth/login returned ${login.status}: ${login.text.slice(0, 300)}`,
    );
  }

  if (!SYNTHETIC_EMAIL.test(String(user.email))) {
    fail(
      `Refusing to run: '${user.email}' is not a synthetic account.`,
      `This journey writes caregiver relationships and consent evidence. It must only ` +
        `ever run against the disposable database.`,
    );
  }

  // Best-effort; a synthetic community usually has no enforceable documents.
  await callApi('POST', '/v2/legal/acceptance/accept-all', {
    token,
    body: {},
    tenantSlug: creds.tenantSlug,
  });

  return {
    ...creds,
    key,
    token,
    userId: Number(user.id),
    tenantId: Number(user.tenant_id),
    displayName:
      [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || String(user.email),
  };
}

/** Authenticate every actor, asserting they are distinct and correctly scoped. */
export async function authenticateCaringActors(): Promise<Record<ActorKey, Actor>> {
  const keys = Object.keys(CARING_ACTORS) as ActorKey[];
  const resolved = {} as Record<ActorKey, Actor>;
  for (const key of keys) {
    resolved[key] = await authenticateActor(key);
  }

  const sameTenant: ActorKey[] = ['caregiver', 'recipient', 'staff', 'spare'];
  const ids = sameTenant.map((k) => resolved[k].userId);
  if (new Set(ids).size !== ids.length) {
    fail(
      'The caregiver, recipient, staff and spare actors are not DISTINCT accounts.',
      `Resolved ids: ${JSON.stringify(ids)}`,
    );
  }

  const tenantIds = new Set(sameTenant.map((k) => resolved[k].tenantId));
  if (tenantIds.size !== 1) {
    fail(
      'The three primary actors are not in the SAME community.',
      `Resolved tenant ids: ${JSON.stringify([...tenantIds])}`,
    );
  }

  if (resolved.otherStaff.tenantId === resolved.staff.tenantId) {
    fail(
      'The cross-tenant actor is in the same community as the staff reviewer, so it ' +
        'cannot demonstrate tenant isolation.',
    );
  }

  if (resolved.staff.userId === resolved.caregiver.userId) {
    fail('The staff reviewer and the proposing caregiver are the same account.');
  }

  return resolved;
}

/**
 * Build Playwright storage state for an actor from a REAL token.
 *
 * 🔴 An empty or partial storage state must never be produced. If the app's
 * token keys are ever renamed, this should break loudly rather than hand back a
 * state that silently signs nobody in — the failure mode this whole module
 * exists to prevent. Keys mirror react-frontend/src/lib/api.ts.
 */
export function storageStateFor(actor: Actor) {
  if (!actor.token) {
    fail(`Refusing to build an empty storage state for ${actor.key}.`);
  }
  const origin = new URL(CARING_BASE_URL).origin;
  return {
    cookies: [],
    origins: [
      {
        origin,
        localStorage: [
          { name: 'nexus_access_token', value: actor.token },
          { name: 'nexus_tenant_id', value: String(actor.tenantId) },
          {
            name: 'nexus_cookie_consent',
            value: JSON.stringify({
              essential: true,
              analytics: false,
              preferences: true,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      },
    ],
  };
}

/** Open a browser context already signed in as `actor`. */
export async function contextForActor(
  browser: Browser,
  actor: Actor,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: CARING_BASE_URL,
    storageState: storageStateFor(actor),
    viewport: { width: 1440, height: 950 },
  });
  const page = await context.newPage();
  return { context, page };
}

/**
 * Answer the Caring Community first-visit onboarding modal, if it is showing.
 *
 * 🔴 Found by walking the journey in a browser, not by reading the code.
 *
 * A member's FIRST visit to the Caring hub raises a "Welcome to your Caring
 * Community" modal offering "I need help" / "I want to help others" / "Show me
 * everything". It renders an OPAQUE full-screen backdrop
 * (`[data-slot="modal-backdrop"]`), so every control on the hub underneath is
 * unclickable until it is answered — Playwright reports this as
 * "<div data-slot='modal-backdrop'> intercepts pointer events" while retrying,
 * which reads like a flaky selector rather than a modal nobody accounted for.
 *
 * It is answered here the way a member would answer it — by choosing an option
 * — rather than by suppressing it with a storage key or an API call, because
 * the choice is persisted server-side and skipping it would mean the journey
 * walked a state no real member is ever in. "Show me everything" is the neutral
 * option: it biases the hub towards neither giving nor receiving care.
 *
 * A no-op when the modal is absent (returning members, or once answered).
 */
export async function answerCaringOnboardingIfShown(page: Page): Promise<boolean> {
  // 🔴 WAIT for it, do not sample once.
  //
  // The modal is raised by a client-side check that resolves shortly AFTER the
  // hub paints. Checking `count()` the instant the route settles returns 0, the
  // helper reports "no modal", and the modal then appears over the control the
  // very next line clicks. That is exactly how this failed the first time: the
  // dismissal logic was correct and ran too early, which looks identical to a
  // dismissal that does not work.
  const showAll = page.getByText('Show me everything', { exact: false }).first();
  try {
    await showAll.waitFor({ state: 'visible', timeout: 6000 });
  } catch {
    return false; // Genuinely absent: returning member, or already answered.
  }

  await showAll.click();

  // The backdrop must actually go, or the next click fails the same way.
  await expect(
    page.locator('[data-slot="modal-backdrop"]').first(),
    'the Caring onboarding modal did not close after choosing an option',
  ).toBeHidden({ timeout: 15000 });
  return true;
}

/** Tenant-prefixed application path, e.g. `/e2e-community/caring-community`. */
export function tenantPath(pathname: string, tenantSlug: string = CARING_TENANT): string {
  return `/${tenantSlug}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

/**
 * Prove the browser is on the page we think it is — NOT a redirected login page.
 *
 * 🔴 `page.goto()` follows redirects silently, and a login page satisfies every
 * generic structural assertion (it has a heading, a `main`, a skip link). An
 * assertion is only evidence once the landing URL has been checked.
 */
export async function assertLandedOn(
  page: Page,
  expected: RegExp,
  label: string,
): Promise<void> {
  await page.waitForLoadState('domcontentloaded');
  const url = new URL(page.url());

  if (/\/login\b/.test(url.pathname)) {
    throw new Error(
      `Expected ${label}, but the browser was redirected to the LOGIN page (${url.pathname}). ` +
        `The session was not established — do not treat anything after this point as evidence.`,
    );
  }

  expect(
    url.pathname,
    `Expected ${label} matching ${expected}, but landed on ${url.pathname}`,
  ).toMatch(expected);
}

/**
 * Assert the signed-in actor is WHO WE INTENDED — not merely that somebody is.
 *
 * 🔴 Two different shells, and only one of them has the structural hook.
 *
 * Member pages render the Navbar, whose avatar trigger carries `[data-user-menu]`.
 * The staff Caring panel (`/{tenant}/caring/*`) renders `CaringPanelHeader`
 * instead, which has NO `data-*` hook at all — only an aria-label built from
 * `t('panel.header.user_menu')`, which is translated and therefore matches
 * nothing in ten of the eleven locales. Asserting `[data-user-menu]` alone
 * reported a correctly signed-in admin as signed out.
 *
 * Both shells do render the account's NAME, which comes from the API rather
 * than a translation catalogue. Preferring that makes this locale-proof and
 * upgrades the assertion from "a session exists" to "the session belongs to
 * this actor" — which is what a three-actor journey actually needs, since a
 * leaked context would otherwise sail past a generic check.
 */
export async function assertSignedInAs(page: Page, actor: Actor): Promise<void> {
  const byName = page.getByText(actor.displayName, { exact: false }).first();
  const byHook = page.locator('[data-user-menu]').first();

  try {
    await byName.waitFor({ state: 'visible', timeout: 15000 });
    return;
  } catch {
    // Fall through to the member-shell hook before declaring failure.
  }

  await expect(
    byHook,
    `Neither the name "${actor.displayName}" nor [data-user-menu] appeared on ${page.url()} — ` +
      `${actor.key} (${actor.email}) is not signed in on this page`,
  ).toBeVisible({ timeout: 5000 });
}

/**
 * Read rows straight out of the DISPOSABLE database.
 *
 * 🔴 Why a database read at all, when the API already answered.
 *
 * The API response is the thing under test; it cannot also be the evidence that
 * the thing under test worked. This codebase wraps method bodies in
 * `catch (\Throwable)` as a matter of course — 2,882 occurrences across 540
 * files in `app/`, 350 of which return a falsy default from the catch — so a
 * write against a column that does not exist becomes a plausible-looking
 * response rather than an error. That exact failure hid a broken
 * `GroupModerationService` for four months while its tests asserted the
 * swallowed value.
 *
 * Reading the row back in a separate process, over a separate connection, is
 * what distinguishes "the endpoint returned 200" from "the record exists".
 *
 * Hard-scoped to `nexus_webuk_e2e`. The credentials are the local Docker
 * development ones already in `compose.yml`; they reach nothing else.
 */
const DISPOSABLE_DB = 'nexus_webuk_e2e';

export function queryDisposableDb(sql: string): Array<Record<string, string>> {
  if (/\b(nexus_test|`?nexus`?\.)\b/.test(sql)) {
    fail(`Refusing to run a query naming a non-disposable database:\n${sql}`);
  }

  let raw: string;
  try {
    raw = execFileSync(
      'docker',
      [
        'exec',
        '-i',
        'nexus-php-db',
        'mysql',
        '--skip-ssl',
        '-h',
        '127.0.0.1',
        '-unexus',
        '-pnexus_secret',
        DISPOSABLE_DB,
        '-e',
        sql,
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error: any) {
    fail(
      `Could not read back from the disposable database.`,
      `${error?.stderr || error?.message || error}`.slice(0, 400),
    );
  }

  // 🔴 An empty result is a legitimate answer (no rows) and must be
  // distinguishable from "the query never ran" — which the catch above already
  // turns into a hard failure, so reaching here with no output means no rows.
  const lines = raw.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split('\t');
  return lines.slice(1).map((line) => {
    const cells = line.split('\t');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? '';
    });
    return row;
  });
}

/** The one caregiver-link row, straight from the database. */
export function readCaregiverLinkRow(linkId: number): Record<string, string> | null {
  const rows = queryDisposableDb(
    `SELECT id, tenant_id, caregiver_id, cared_for_id, status,
            IFNULL(recipient_confirmed_at,'') recipient_confirmed_at,
            IFNULL(recipient_confirmed_by,'') recipient_confirmed_by,
            IFNULL(consent_verified_by,'')   consent_verified_by,
            IFNULL(consent_evidence,'')      consent_evidence,
            IFNULL(approved_by,'')           approved_by,
            IFNULL(approved_at,'')           approved_at,
            IFNULL(rejected_by,'')           rejected_by,
            IFNULL(rejection_reason,'')      rejection_reason
       FROM caring_caregiver_links WHERE id = ${Number(linkId)}`,
  );
  return rows[0] ?? null;
}

/** Notification rows delivered to one member, newest last. */
export function readNotificationsFor(userId: number, sinceMinutes = 60): Array<Record<string, string>> {
  return queryDisposableDb(
    `SELECT id, user_id, type, IFNULL(message,'') message
       FROM notifications
      WHERE user_id = ${Number(userId)}
        AND created_at > DATE_SUB(NOW(), INTERVAL ${Number(sinceMinutes)} MINUTE)
      ORDER BY id`,
  );
}

/**
 * Remove caregiver links created between the journey's actors.
 *
 * Deterministic and narrow: only rows whose caregiver is one of OUR synthetic
 * actors are touched, and only in the disposable database. Returns the ids it
 * removed so a run can report its own cleanup honestly.
 */
export async function cleanupCaregiverLinks(actors: Record<ActorKey, Actor>): Promise<number[]> {
  const removed: number[] = [];
  const mine = await asActor<any>(actors.caregiver, 'GET', '/v2/caring-community/caregiver/links');
  const rows = unwrap<any[]>(mine.json) || [];
  if (!Array.isArray(rows)) return removed;

  for (const row of rows) {
    if (!row?.id) continue;
    const res = await asActor(
      actors.caregiver,
      'DELETE',
      `/v2/caring-community/caregiver/links/${row.id}`,
    );
    if (res.status >= 200 && res.status < 300) removed.push(Number(row.id));
  }
  return removed;
}
