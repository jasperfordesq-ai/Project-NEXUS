// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Certificate pinning configuration and validation helpers.
 *
 * Android: Enforced natively via android-network-security-config.xml, which is
 *   injected into the APK by the expo-build-properties plugin configured in app.json.
 *   The OS rejects any TLS connection whose certificate chain does not match the pins
 *   declared in that file — no JS code is needed at runtime on Android.
 *
 * iOS: NOT pinned. ATS enforces HTTPS and ordinary CA validation only, so
 *   "pinning" is true for Android alone. See docs/SECURITY.md, Section 2.
 *
 * This module exports the expected pin configuration so the set of pinned hosts is
 * declared in one place and can be referenced consistently across the codebase
 * (e.g. in network interceptors, test helpers, or audit tooling).
 */

/**
 * Hostnames for which certificate pinning is enforced — on Android only (see above).
 * Mirrors the <domain> entries in android-network-security-config.xml.
 */
export const PINNED_HOSTS: readonly string[] = ['api.project-nexus.ie'];

/**
 * True when the app is running in a production build.
 * Pinning enforcement warnings are only relevant in production.
 */
export const PINNING_ENABLED: boolean = process.env.NODE_ENV === 'production';

/**
 * Returns true if the given URL's hostname is in the pinned-hosts list.
 *
 * @param url - An absolute URL string (e.g. 'https://api.project-nexus.ie/v2/me').
 * @returns true if the host should have certificate pinning applied.
 *
 * @example
 * isPinnedHost('https://api.project-nexus.ie/v2/me'); // true
 * isPinnedHost('https://app.project-nexus.ie');        // false
 * isPinnedHost('https://example.com');                 // false
 */
export function isPinnedHost(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return PINNED_HOSTS.includes(hostname);
  } catch {
    // Malformed URL — cannot be a pinned host.
    return false;
  }
}
