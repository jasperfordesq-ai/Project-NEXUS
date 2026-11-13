// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Whether the community has its welcome steps switched on.
 *
 * The community's admin chooses on Admin → Welcome steps; the choice reaches
 * this site in the tenant bootstrap as `settings.onboarding_enabled`, the same
 * way the inactivity timeout does (src/lib/session-timeout.js). "Off" means
 * nobody is sent to the steps or invited to them. A missing setting means on:
 * the behaviour before the setting existed.
 *
 * @param {object|null|undefined} tenant the routed tenant (req.accessibleRouting.tenant)
 * @returns {boolean}
 */
function welcomeStepsSwitchedOn(tenant) {
  const settings = tenant && typeof tenant.settings === 'object' && tenant.settings ? tenant.settings : {};
  return settings.onboarding_enabled !== false;
}

module.exports = { welcomeStepsSwitchedOn };
