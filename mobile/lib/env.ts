// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Environment variable validation, called once at app startup.
 *
 * 🔴 This docblock used to end "In production, sends warnings to Sentry if configured."
 * That trailing clause was doing a lot of work: nothing configured Sentry in any of the
 * six build profiles, so in production these warnings went to console (suppressed) and
 * to Sentry (disabled) — i.e. nowhere. The missing-DSN warning in particular could only
 * ever be seen by someone already running a development build, which is the one audience
 * that does not need telling.
 *
 * Now: console in development, and — for the missing-DSN case specifically — a report
 * through `lib/observability/report.ts`, which reaches our own server and therefore does
 * not depend on the very thing it is reporting as absent.
 */

import { reportSentryDisabledIfNeeded } from '@/lib/observability/report';

const PRODUCTION_API_URL = 'https://api.project-nexus.ie';
const isDev = process.env.NODE_ENV === 'development';

/**
 * Validate all expected environment variables at app startup.
 * Logs warnings for missing or misconfigured values.
 */
export function validateEnv(): void {
  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  const defaultTenant = process.env.EXPO_PUBLIC_DEFAULT_TENANT;
  const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  const allowProductionApiInDev = process.env.EXPO_PUBLIC_ALLOW_PRODUCTION_API_IN_DEV === 'true';

  // --- EXPO_PUBLIC_API_URL ---
  if (!apiUrl) {
    warn('EXPO_PUBLIC_API_URL is not set. API calls will fail.');
  } else {
    // Warn if the production URL is being used in a development build
    if (isDev && apiUrl === PRODUCTION_API_URL && !allowProductionApiInDev) {
      warn(
        `EXPO_PUBLIC_API_URL points to production (${PRODUCTION_API_URL}) in a development build. ` +
          'Set EXPO_PUBLIC_ALLOW_PRODUCTION_API_IN_DEV=true when this is intentional.'
      );
    }

    // Warn about trailing slash — a common misconfiguration that causes double-slash URLs
    if (apiUrl.endsWith('/')) {
      warn(
        `EXPO_PUBLIC_API_URL has a trailing slash ("${apiUrl}"). ` +
          'Remove it to avoid double-slash URLs in API requests.'
      );
    }
  }

  // --- EXPO_PUBLIC_DEFAULT_TENANT ---
  if (!defaultTenant || defaultTenant.trim() === '') {
    warn(
      'EXPO_PUBLIC_DEFAULT_TENANT is not set. ' +
        'The app will not know which tenant to load on first launch.'
    );
  }

  // --- EXPO_PUBLIC_SENTRY_DSN ---
  if (!sentryDsn) {
    note(
      'EXPO_PUBLIC_SENTRY_DSN is not set. Crash reporting (Sentry) is disabled. ' +
        'Set this in .env.local for production builds.'
    );

    // 🔴 The `note()` above is silent unless __DEV__, which is how "crash reporting is
    // off in every build profile" went unnoticed: the only warning about the missing
    // warnings was itself suppressed in exactly the builds that ship. This reports it
    // through the server sink, which works precisely because it does not need Sentry.
    // Once per session, deduplicated.
    reportSentryDisabledIfNeeded();
  }
}

/** Log a warning — visible in development, silent in production. */
function warn(message: string): void {
  if (isDev) {
    console.warn(`[env] WARNING: ${message}`);
  }
}

/** Log an informational note — always visible in development. */
function note(message: string): void {
  if (isDev) {
    console.log(`[env] NOTE: ${message}`);
  }
}
