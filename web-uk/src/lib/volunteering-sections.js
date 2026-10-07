// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Which volunteering sections a community has switched on, and the volunteer's
 * ways into them from the volunteering page (gap B9, 7 Oct 2026).
 *
 * The rule is the website's `isTabEnabled` (react-frontend VolunteeringPage.tsx):
 * a section is shown unless the community's `volunteering.tab_<key>` setting is
 * false, and two sections also need a feature switch (`recommended` needs
 * `volunteering.enable_matching`, `expenses` needs `volunteering.expenses_enabled`).
 * The settings arrive with the tenant bootstrap as `volunteering_config`; a setting
 * that is absent counts as on, exactly as on the website.
 *
 * Before this, the page listed seven tools and ignored the settings, and three
 * working pages (urgent shift requests, wellbeing, safeguarding) had no way in.
 * The old document-upload page `/volunteering/credentials` is deliberately NOT
 * listed: since 5 Oct 2026 the website's "credentials" section is the
 * qualifications register, which takes no uploads (owner decision).
 */

const FEATURE_GATES = {
  recommended: ['volunteering.enable_matching'],
  expenses: ['volunteering.expenses_enabled']
};

const TOOLS = [
  { section: 'hours', href: '/volunteering/hours', labelKey: 'volunteering.log_hours_title' },
  { section: 'alerts', href: '/volunteering/emergency-alerts', labelKey: 'govuk_alpha_volunteering.emergency.title' },
  { section: 'wellbeing', href: '/volunteering/wellbeing', labelKey: 'govuk_alpha_volunteering.wellbeing.title' },
  { section: 'safeguarding', href: '/volunteering/training', labelKey: 'govuk_alpha_volunteering.safeguarding.title' },
  { section: 'accessibility', href: '/volunteering/accessibility', labelKey: 'volunteering.accessibility_link' },
  { section: 'certificates', href: '/volunteering/certificates', labelKey: 'vol_depth.certificates_link' },
  { section: 'waitlist', href: '/volunteering/waitlist', labelKey: 'vol_depth.waitlist_link' },
  { section: 'swaps', href: '/volunteering/swaps', labelKey: 'vol_depth.swaps_link' },
  { section: 'expenses', href: '/volunteering/expenses', labelKey: 'govuk_alpha_volunteering.expenses.nav_link' },
  { section: 'donations', href: '/volunteering/donations', labelKey: 'govuk_alpha_volunteering.donations.nav_link' }
];

function volunteeringConfigFrom(tenant) {
  const config = tenant && typeof tenant === 'object' ? tenant.volunteering_config : null;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : {};
}

function isOff(value) {
  return value === false || value === 0 || value === '0' || value === 'false';
}

function sectionEnabled(config, section) {
  const key = `volunteering.tab_${String(section).replace(/-/g, '_')}`;
  if (isOff(config[key])) return false;
  return (FEATURE_GATES[section] || []).every((gate) => !isOff(config[gate]));
}

function volunteeringSections(tenant) {
  const config = volunteeringConfigFrom(tenant);
  return {
    enabled: (section) => sectionEnabled(config, section),
    tools: TOOLS.filter((tool) => sectionEnabled(config, tool.section))
  };
}

module.exports = { volunteeringSections, sectionEnabled };
