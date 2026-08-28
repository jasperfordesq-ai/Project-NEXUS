// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Region store — the country half of every user-facing date/number format.
 *
 * A language code on its own carries no region, and Intl then falls back to the
 * language's default one. For English that is the United States, which is why
 * 17 August 2026 rendered as `8/17/2026` for an Irish community. The language
 * comes from the member's own choice (i18next); the region comes from here.
 *
 * Deliberately a module-level store rather than React context: the formatting
 * entry point `getFormattingLocale()` in `@/lib/helpers` is a plain function
 * called from ~330 modules, many outside a component tree, so it cannot read a
 * hook. `TenantContext` pushes the resolved region in once the tenant loads.
 *
 * The region NEVER comes from the browser or OS — a member on a US-configured
 * laptop reading an Irish community's site still gets Irish dates.
 */

/** Platform default. Project NEXUS is Ireland-based; communities may override. */
export const DEFAULT_REGION = 'IE';

let currentRegion: string = DEFAULT_REGION;

/** ISO 3166-1 alpha-2: exactly two letters. Anything else is ignored. */
function isValidRegion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z]{2}$/.test(value);
}

/**
 * Set the active formatting region. Invalid or empty values are ignored so a
 * malformed tenant setting can never push formatting back to a browser default.
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
