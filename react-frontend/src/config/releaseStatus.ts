// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform release status configuration.
 *
 * The platform reached General Availability (v1.5) on 2026-05-13. Individual
 * newer modules may still ship with their own maturity label (alpha / beta /
 * preview) via per-module chips — this constant tracks the platform as a whole.
 */
export const RELEASE_STATUS = {
  stageKey: 'ga' as const,
  stageLabel: 'Generally Available (v1.6.0)',
  stageSummary: 'Live and supported.',
  readMorePath: '/features',
} as const;

export type ReleaseStageKey = typeof RELEASE_STATUS.stageKey;
