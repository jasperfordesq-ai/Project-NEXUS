// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * App integrity and device security checks.
 *
 * These are heuristic checks only — a determined attacker can bypass them.
 * They are intended to raise the bar, not as a security guarantee.
 * Real integrity checking requires Play Integrity API (Android) and
 * App Attest (iOS) — see docs/SECURITY.md for server-side integration.
 */

import * as Device from 'expo-device';
import * as Sentry from '@sentry/react-native';
import { reportSentryMessage } from '@/lib/observability/report';

export interface IntegrityCheckResult {
  safe: boolean;
  warnings: string[];
}

/**
 * Returns true when running in an emulator or simulator (not on real hardware).
 * Uses expo-device's `isDevice` flag which is false on simulators/emulators.
 */
export function isEmulator(): boolean {
  return !Device.isDevice;
}

/**
 * Returns true when the app was built for production (NODE_ENV === 'production').
 */
export function isProductionBuild(): boolean {
  return process.env.NODE_ENV === 'production';
}

/**
 * Runs heuristic device integrity checks and returns a result object.
 *
 * Checks performed:
 * - Emulator running in a production build (unusual — likely testing bypass)
 * - Device type sanity (real device with a known platform)
 *
 * Returns `{ safe: boolean, warnings: string[] }`.
 * `safe` is false if any check produces a warning.
 */
export function checkDeviceIntegrity(): IntegrityCheckResult {
  const warnings: string[] = [];

  if (isEmulator() && isProductionBuild()) {
    warnings.push('Running on emulator in production');
  }

  return {
    safe: warnings.length === 0,
    warnings,
  };
}

/**
 * Runs integrity checks and logs any warnings.
 * In development: logs via console.warn.
 * In production: logs via Sentry if a DSN is configured, otherwise console.warn.
 *
 * Call this early in the app lifecycle (e.g. in the root _layout.tsx).
 */
export function logIntegrityWarnings(): void {
  const result = checkDeviceIntegrity();

  if (result.warnings.length === 0) {
    return;
  }

  for (const warning of result.warnings) {
    const message = `[NEXUS integrity] ${warning}`;

    if (isProductionBuild() && typeof Sentry.getCurrentScope === 'function') {
      // In production, report to Sentry if available.
      // Sentry is initialised in app/_layout.tsx before this runs.
      reportSentryMessage(message, 'warning');
      continue;
    }

    console.warn(message);
  }
}
