// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Where a Help Centre guide's links go on THIS site.
 *
 * The guides are written for the React app, so every "Go to this page" link
 * (a registry `link`) and every `[text](/path)` link inside an article body names
 * a React path. Many of those pages exist here under the same path; some exist
 * under a different one (React `/listings/create` is `/listings/new` here); some —
 * the Broker Panel, the admin panel, a few member pages — do not exist here at all.
 *
 * This table is the ONE place that decision is made:
 *   string  the accessible page to link to (no tenant prefix — urlFor adds it);
 *   null    no accessible page: the link is left out, and for a broker or admin
 *           guide the article says the task is done on the main website instead
 *           of sending the reader to a missing page.
 *
 * tests/help-guides.test.js fails when a guide links to a path missing from this
 * table (so a new React link forces a decision), and when any string target here
 * is not a real web-uk GET route.
 */
const HELP_LINK_TARGETS = Object.freeze({
  // Same path on both sites.
  '/accessibility': '/accessibility',
  '/achievements': '/achievements',
  '/blog': '/blog',
  '/chat': '/chat',
  '/connections': '/connections',
  '/contact': '/contact',
  '/cookies': '/cookies',
  '/courses': '/courses',
  '/courses/instructor': '/courses/instructor',
  '/dashboard': '/dashboard',
  '/events': '/events',
  '/exchanges': '/exchanges',
  '/explore': '/explore',
  '/faq': '/faq',
  '/federation': '/federation',
  '/federation/connections': '/federation/connections',
  '/federation/listings': '/federation/listings',
  '/federation/members': '/federation/members',
  '/federation/messages': '/federation/messages',
  '/federation/onboarding': '/federation/onboarding',
  '/federation/partners': '/federation/partners',
  '/federation/settings': '/federation/settings',
  '/feed': '/feed',
  '/goals': '/goals',
  '/group-exchanges': '/group-exchanges',
  '/groups': '/groups',
  '/help': '/help',
  '/ideation': '/ideation',
  '/jobs': '/jobs',
  '/jobs/alerts': '/jobs/alerts',
  '/jobs/create': '/jobs/create',
  '/kb': '/kb',
  '/leaderboard': '/leaderboard',
  '/legal': '/legal',
  '/listings': '/listings',
  '/login': '/login',
  '/marketplace': '/marketplace',
  '/marketplace/free': '/marketplace/free',
  '/marketplace/orders': '/marketplace/orders',
  '/marketplace/reports': '/marketplace/reports',
  '/marketplace/search': '/marketplace/search',
  '/matches': '/matches',
  '/members': '/members',
  '/messages': '/messages',
  '/nexus-score': '/nexus-score',
  '/notifications': '/notifications',
  '/organisations': '/organisations',
  '/organisations/register': '/organisations/register',
  '/podcasts': '/podcasts',
  '/podcasts/studio': '/podcasts/studio',
  '/polls': '/polls',
  '/premium': '/premium',
  '/premium/manage': '/premium/manage',
  '/privacy': '/privacy',
  '/profile': '/profile',
  '/register': '/register',
  '/resources': '/resources',
  '/reviews': '/reviews',
  '/saved': '/saved',
  '/search': '/search',
  '/skills': '/skills',
  '/terms': '/terms',
  '/venues': '/venues',
  '/venues/pass': '/venues/pass',
  '/volunteering': '/volunteering',
  '/volunteering/my-organisations': '/volunteering/my-organisations',
  '/wallet': '/wallet',

  // Same page, different path here.
  '/acceptable-use': '/legal/acceptable-use',
  '/caring-community': '/caring',
  '/caring-community/caregiver': '/caring/caregiver',
  '/caring-community/caregiver/link': '/caring/caregiver/link',
  '/community-guidelines': '/legal/community-guidelines',
  '/courses/my-learning': '/courses/mine',
  '/events/create': '/events/new',
  '/group-exchanges/create': '/group-exchanges/new',
  '/groups/create': '/groups/new',
  '/jobs/my-applications': '/jobs/applications',
  '/listings/create': '/listings/new',
  '/marketplace/my-listings': '/marketplace/mine',
  '/marketplace/my-offers': '/marketplace/offers',
  '/marketplace/orders/sales': '/marketplace/sales',
  '/marketplace/sell': '/marketplace/create',
  '/password/forgot': '/login/forgot-password',
  '/settings': '/profile/settings',
  '/settings/blocked': '/profile/blocked',
  '/settings/data-export': '/settings/data-rights',
  '/timebanking-guide': '/guide',
  '/volunteering/create': '/volunteering/opportunities/create',

  // Member pages this site does not have.
  '/caring-community/hour-gift': null,
  '/caring-community/hour-transfer': null,
  '/caring-community/markt': null,
  '/caring-community/my-data-export': null,
  '/caring-community/my-relationships': null,
  '/caring-community/my-trust-tier': null,
  '/caring-community/offer-favour': null,
  '/caring-community/request-help': null,
  '/caring-community/safeguarding/my-reports': null,
  '/caring-community/safeguarding/report': null,
  '/install-app': null,
  '/matches/preferences': null,
  '/verify-identity-optional': null,

  // The Broker Panel, the admin panel and partner management are on the main
  // website only.
  '/admin': null,
  '/admin/activity-log': null,
  '/admin/ai/module-docs': null,
  '/admin/blog': null,
  '/admin/categories': null,
  '/admin/community-analytics': null,
  '/admin/crm': null,
  '/admin/enterprise/gdpr': null,
  '/admin/enterprise/gdpr/audit': null,
  '/admin/enterprise/gdpr/consent-types': null,
  '/admin/enterprise/gdpr/consents': null,
  '/admin/enterprise/gdpr/requests': null,
  '/admin/events': null,
  '/admin/events/settings': null,
  '/admin/groups': null,
  '/admin/help/faqs': null,
  '/admin/impact-report': null,
  '/admin/legal-documents': null,
  '/admin/listings': null,
  '/admin/module-configuration': null,
  '/admin/newsletters': null,
  '/admin/newsletters/subscribers': null,
  '/admin/onboarding-settings': null,
  '/admin/pages': null,
  '/admin/reports/inactive-members': null,
  '/admin/reports/members': null,
  '/admin/resources': null,
  '/admin/retention': null,
  '/admin/settings': null,
  '/admin/settings/registration-policy': null,
  '/admin/support-reports': null,
  '/admin/timebanking': null,
  '/admin/timebanking/community-fund': null,
  '/admin/timebanking/starting-balances': null,
  '/admin/translation-config': null,
  '/admin/users': null,
  '/admin/users/create': null,
  '/admin/volunteering/wellbeing': null,
  '/broker': null,
  '/broker/archives': null,
  '/broker/configuration': null,
  '/broker/exchanges': null,
  '/broker/insurance': null,
  '/broker/match-approvals': null,
  '/broker/members': null,
  '/broker/messages': null,
  '/broker/moderation/comments': null,
  '/broker/moderation/feed': null,
  '/broker/moderation/queue': null,
  '/broker/moderation/reports': null,
  '/broker/moderation/reviews': null,
  '/broker/monitoring': null,
  '/broker/onboarding': null,
  '/broker/risk-tags': null,
  '/broker/safeguarding': null,
  '/broker/safeguarding-options': null,
  '/broker/safeguarding/support-needs': null,
  '/broker/safeguarding/volunteering': null,
  '/broker/vetting': null,
  '/partner-timebanks/partnerships': null
});

/**
 * The accessible path for a React path, or null when this site has no such page
 * (including any path the table does not know — never guess a destination).
 */
function accessibleHelpLink(reactPath) {
  if (typeof reactPath !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(HELP_LINK_TARGETS, reactPath)
    ? HELP_LINK_TARGETS[reactPath]
    : null;
}

module.exports = { HELP_LINK_TARGETS, accessibleHelpLink };
