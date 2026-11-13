// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's choice on Admin → Welcome steps, as the tenant bootstrap
 * carries it (`settings.onboarding_enabled`, `settings.onboarding_mandatory`).
 *
 * Three states, and only three:
 *  - switched off: nobody is sent to the welcome steps or invited to them;
 *  - offered: members use the site straight away and their dashboard invites
 *    them to finish;
 *  - must finish: members are taken to the steps before anything else.
 *
 * A missing setting means "on" — the behaviour before the setting existed, and
 * the safe reading while the bootstrap is still loading.
 */

type TenantSettings = Record<string, unknown> | null | undefined;

/** False only when the community has switched the welcome steps off. */
export function welcomeStepsSwitchedOn(settings: TenantSettings): boolean {
  return settings?.onboarding_enabled !== false;
}

/** True when members must finish the welcome steps before using the site. */
export function welcomeStepsMustBeFinished(settings: TenantSettings): boolean {
  return welcomeStepsSwitchedOn(settings) && settings?.onboarding_mandatory !== false;
}
