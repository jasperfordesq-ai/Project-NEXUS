// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Region store — the country half of every user-facing date and number.
 *
 * A language code on its own has no region, so Intl falls back to the
 * language's default one; for English that is the United States. The language
 * comes from what the member picked in Settings, the region comes from here.
 *
 * Provider-free on purpose: `dateLocale()` is a plain function called from ~60
 * modules, many outside a component tree, so it cannot read a hook. This
 * mirrors `themeStore`, which exists for the same reason. `TenantProvider`
 * pushes the community's region in once the tenant bootstrap resolves.
 *
 * The region is NOT taken from the device. A member whose phone is set to the
 * United States, or who bought their handset abroad, still reads their own
 * community's dates. (This helper did read the device region between
 * 2026-08-25 and 2026-08-28 — it was the first fix for American dates, and it
 * left exactly that gap.)
 */

/** Platform default. Project NEXUS is Ireland-based; communities may override. */
export const DEFAULT_REGION = 'IE';

let currentRegion: string = DEFAULT_REGION;

/** ISO 3166-1 alpha-2: exactly two letters. Anything else is ignored. */
function isValidRegion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value);
}

/**
 * Set the active formatting region. Invalid, empty and missing values are
 * ignored rather than applied, so a malformed tenant setting or an offline
 * cold start with no tenant cannot push formatting back to a device default.
 */
export function setRegion(region: unknown): void {
  if (isValidRegion(region)) {
    currentRegion = region.toUpperCase();
  }
}

/** The active region, always a valid two-letter code. */
export function getRegion(): string {
  return currentRegion;
}

/** Restore the platform default. Test helper; not used in production paths. */
export function resetRegion(): void {
  currentRegion = DEFAULT_REGION;
}
