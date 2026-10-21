// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The welcome panel's dismissal flag, kept apart from VolunteeringWelcome.tsx so
 * VolunteeringPage can read it without pulling the panel into the public
 * opportunities chunk (the panel itself is lazy-loaded; see check-bundle-budget).
 */

const STORAGE_KEY = 'nexus_vol_welcome_dismissed_v1';

/** Whether this browser has already dismissed the welcome. */
export function isVolunteeringWelcomeDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Remember that this browser dismissed the welcome. */
export function rememberVolunteeringWelcomeDismissed(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Private mode / storage disabled: the panel simply shows again next time.
  }
}
