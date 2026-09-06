// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import Constants from 'expo-constants';

const PRODUCTION_API_URL = 'https://api.project-nexus.ie';

/**
 * A loopback/emulator host (10.0.2.2 = Android emulator → dev-machine
 * localhost, plus the usual local aliases). Unreachable from a real device.
 */
function isLoopbackHost(url: string | undefined | null): boolean {
  if (!url) return false;
  return /\/\/(?:10\.0\.2\.2|10\.0\.3\.2|127\.0\.0\.1|0\.0\.0\.0|localhost)\b/i.test(url);
}

/**
 * Base URL for the Project NEXUS PHP API.
 *
 * Configured via EXPO_PUBLIC_API_URL in .env.local; falls back to the Expo
 * config value, then the production URL.
 *
 * SELF-HEAL GUARD (regression 2026-06-12): EXPO_PUBLIC_* values are inlined
 * into the JS bundle by Babel, and Metro's transform cache does NOT invalidate
 * when the env var changes. A stale `.env.local` (e.g. http://10.0.2.2:8090
 * for emulator testing) therefore poisoned production builds, baking the
 * loopback URL into the bundle so every request timed out on real devices.
 * A real release build can NEVER legitimately target a loopback host, so when
 * `__DEV__` is false we refuse such a value and fall back to the Expo config
 * value (resolved fresh at build time, NOT subject to the JS transform cache)
 * and finally the production default.
 */
export const API_BASE_URL: string = (() => {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  const configUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;

  if (!__DEV__ && isLoopbackHost(envUrl)) {
    return configUrl && !isLoopbackHost(configUrl) ? configUrl : PRODUCTION_API_URL;
  }

  return envUrl ?? configUrl ?? PRODUCTION_API_URL;
})();

/**
 * Default tenant slug used when no tenant is selected.
 * Configurable via EXPO_PUBLIC_DEFAULT_TENANT.
 */
export const DEFAULT_TENANT: string =
  process.env.EXPO_PUBLIC_DEFAULT_TENANT ??
  (Constants.expoConfig?.extra?.defaultTenant as string | undefined) ??
  'hour-timebank';

/**
 * The app's own version, sent on every API request as `X-Nexus-Mobile-Version`.
 *
 * 🔴 This exists so a future release can be RETIRED. Today the API can tell that a request
 * came from the mobile app (`X-Nexus-Mobile: '1'`) but not which version, so it has no way to
 * refuse a build that must stop being used — and an over-the-air update only reaches devices
 * whose runtime version still matches, so a broken NATIVE build is unreachable by any other
 * means.
 *
 * The reason it is here BEFORE the server half exists: a binary already on someone's phone
 * cannot be taught to send a header it was not built with. Every build that ships without
 * this is permanently un-retirable. The server-side minimum-version refusal and the blocking
 * screen that answers it are tracked as the next step.
 *
 * Falls back to the empty string rather than a guess: an absent header is honest, a wrong
 * version is worse than none.
 */
export const APP_VERSION: string = Constants.expoConfig?.version ?? '';

/** Secure storage keys */
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'nexus_auth_token',
  REFRESH_TOKEN: 'nexus_refresh_token',
  TENANT_SLUG: 'nexus_tenant_slug',
  USER_DATA: 'nexus_user_data',
  THEME_MODE: 'nexus_theme_mode',
  /** Last language explicitly chosen by the user in Settings (restored at boot) */
  LANGUAGE: 'nexus_language',
  /** Last Expo push token registered with the API, retained for reliable opt-out/logout. */
  PUSH_TOKEN: 'nexus_expo_push_token',
} as const;

/** App-wide timing constants */
export const TIMEOUTS = {
  /** GET request timeout — allow slower mobile networks and heavier feed/search endpoints */
  API_GET: 30_000,
  /** POST/PUT/PATCH/DELETE request timeout — more time for data submission */
  API_MUTATION: 15_000,
  /** File upload timeout — large payloads need significantly more time */
  API_UPLOAD: 60_000,
  /**
   * 🔴 Registration only. It makes TWO external calls before it can answer — an MX lookup
   * on the email domain and a Have-I-Been-Pwned breach check — so it routinely takes longer
   * than an ordinary mutation. Measured on a device on 2026-08-22: the account was created
   * (users row 900019) and the app still told the member "Request timed out. Please check
   * your connection." A member who then taps Create account again is told the address is
   * already taken, and concludes the platform is broken — on their very first interaction.
   */
  API_REGISTER: 45_000,
  /**
   * 🔴 Applying for a job only. The endpoint sends TWO emails inside the request — a
   * confirmation to the applicant and an alert to the employer — before it answers.
   * Measured against the local API on 2026-08-23: **9.5 seconds** warm, against a 15s
   * mutation timeout. The application row is written in the first second, so a timeout
   * does not undo it: the member is told their application failed while the employer has
   * it, and applying again is refused as a duplicate. Same shape as API_REGISTER above.
   *
   * The durable fix is to move those two emails off the request; until then this stops the
   * member being lied to. Recorded in the ledger against journey 5.27.
   */
  API_JOB_APPLY: 45_000,
  /**
   * Silent token refresh.
   *
   * 🔴 This request had NO deadline at all. Every other 401 that arrives while it is in
   * flight waits on the same shared promise, so one stalled refresh — the ordinary case on
   * a weak mobile connection, where a socket opens and then nothing comes back — parked
   * every screen and every mutation in the app indefinitely, past the timeout each of them
   * had advertised, with no error and no way to retry.
   *
   * Deliberately shorter than a normal mutation: this runs BEFORE the retry of the member's
   * actual request, so its budget is spent on top of theirs.
   */
  API_TOKEN_REFRESH: 10_000,
  /**
   * @deprecated Use API_GET, API_MUTATION, or API_UPLOAD instead.
   * Kept for backward compatibility with tests.
   */
  API_REQUEST: 15_000,
} as const;

/** API path prefix for all v2 endpoints */
export const API_V2 = '/api/v2';

/** Web app URL for share links and deep linking */
export const APP_URL: string =
  process.env.EXPO_PUBLIC_APP_URL ?? 'https://app.project-nexus.ie';

/**
 * Native URL scheme registered in app.json.
 *
 * Stripe expects the scheme name here (for example `nexus`), while each
 * PaymentSheet `returnURL` remains the complete callback URL produced by
 * Expo Linking (for example `nexus://marketplace-payment-return`). Passing the
 * complete callback as Stripe's `urlScheme` breaks the contract used by 3-D
 * Secure and bank-app redirects on iOS.
 */
export const APP_SCHEME = 'nexus';

/**
 * Whether identity verification can be started from inside the app.
 *
 * 🔴 **OFF, by owner decision on 2026-08-25, for Google Play's payments policy.**
 *
 * Verification costs a fee, and paying it in the app unlocked an "ID verified" badge in the
 * app. Google Play requires *its own* billing for anything bought inside an app and consumed
 * inside it; a badge is exactly that. The penalty for getting it wrong is not a rejection
 * before launch — it is removal after launch, once members are using it. So the flow is
 * hidden for the first release rather than argued about.
 *
 * What this switch does NOT do, deliberately:
 *
 * - It does not hide a verified member's status. Showing a badge someone already earned is
 *   not a sale, and hiding it would lose them something they paid for.
 * - It does not touch the **marketplace**, whose Stripe payments are for second-hand
 *   physical goods with pickup or shipping. Physical goods are explicitly exempt from Play
 *   Billing — that is how every classifieds app works — so hiding those would cost a
 *   working feature for no reason.
 * - It does not link out to the website. An in-app button sending someone to pay elsewhere
 *   is the anti-steering rule, which is a separate violation from the billing one, so that
 *   button is gone rather than relocated.
 *
 * To re-enable: flip this to `true`. Everything below it — the screens, the API calls, the
 * Stripe sheet — is untouched and still tested. Before flipping it, resolve the billing
 * question; see `docs/PLAY_SUBMISSION.md`.
 */
export const IDENTITY_VERIFICATION_AVAILABLE_IN_APP = false;
