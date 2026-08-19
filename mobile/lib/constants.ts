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
