// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { flagEnabled } = require('./accessible-shell');

const ACCOUNT_LINKS = Object.freeze([
  {
    href: '/wallet',
    titleKey: 'account.wallet_title',
    descriptionKey: 'account.wallet_description',
    title: 'Wallet',
    description: 'View your time-credit balance and history, and send credits to other members.',
    enabled: (tenant) => flagEnabled(tenant, 'wallet', 'modules', true)
  },
  {
    href: '/messages',
    titleKey: 'account.messages_title',
    descriptionKey: 'account.messages_description',
    title: 'Messages',
    description: 'Read and send direct messages with members of this community.',
    badge: true,
    enabled: (tenant) => flagEnabled(tenant, 'direct_messaging', 'features', true)
  },
  {
    href: '/connections',
    titleKey: 'account.connections_title',
    descriptionKey: 'account.connections_description',
    title: 'Connections',
    description: 'Accept or decline connection requests and manage your network.',
    enabled: (tenant) => flagEnabled(tenant, 'connections', 'features', true)
  },
  {
    href: '/notifications',
    titleKey: 'notifications.title',
    descriptionKey: 'notifications.description',
    title: 'Notifications',
    description: 'Read service notifications and community updates.',
    enabled: (tenant) => flagEnabled(tenant, 'notifications', 'modules', true)
  },
  {
    href: '/reviews',
    titleKey: 'reviews_page.title',
    descriptionKey: 'reviews_page.description',
    title: 'Reviews',
    description: 'View the reviews you have received and written.',
    enabled: (tenant) => flagEnabled(tenant, 'reviews', 'features', true)
  },
  {
    href: '/activity',
    titleKey: 'activity.title',
    descriptionKey: 'activity.description',
    title: 'My activity',
    description: 'Review your recent community activity.',
    enabled: () => true
  },
  {
    href: '/saved',
    titleKey: 'saved.title',
    descriptionKey: 'saved.description',
    title: 'Saved items',
    description: 'Return to items you have saved.',
    enabled: () => true
  },
  {
    href: '/jobs',
    titleKey: 'jobs_t2.account_title',
    descriptionKey: 'jobs_t2.account_description',
    title: 'Opportunities',
    description: 'Find and manage work and volunteering opportunities.',
    enabled: (tenant) => flagEnabled(tenant, 'job_vacancies', 'features', true)
  },
  {
    href: '/matches',
    titleKey: 'matches.title',
    descriptionKey: 'matches.description',
    title: 'Your matches',
    description: 'Review suggested exchanges with other members.',
    enabled: (tenant) => flagEnabled(tenant, 'listings', 'modules', true)
  },
  {
    href: '/group-exchanges',
    titleKey: 'group_exchanges.title',
    descriptionKey: 'group_exchanges.description',
    title: 'Group exchanges',
    description: 'Manage exchanges involving your groups.',
    enabled: (tenant) => flagEnabled(tenant, 'group_exchanges', 'features', true)
  },
  {
    href: '/achievements',
    titleKey: 'achievements.title',
    descriptionKey: 'achievements.description',
    title: 'Achievements',
    description: 'See your level, XP and earned badges.',
    enabled: (tenant) => flagEnabled(tenant, 'gamification', 'features', true)
  },
  {
    href: '/leaderboard',
    titleKey: 'leaderboard.title',
    descriptionKey: 'leaderboard.description',
    title: 'Leaderboard',
    description: 'See community participation rankings.',
    enabled: (tenant) => flagEnabled(tenant, 'gamification', 'features', true)
  },
  {
    href: '/nexus-score',
    titleKey: 'nexus_score.title',
    descriptionKey: 'nexus_score.description',
    title: 'NEXUS score',
    description: 'Review your community participation score.',
    enabled: (tenant) => flagEnabled(tenant, 'gamification', 'features', true)
  },
  {
    href: '/profile',
    titleKey: 'account.profile_title',
    descriptionKey: 'account.profile_description',
    title: 'My profile',
    description: 'View and edit how you appear to other members.',
    enabled: () => true
  },
  {
    href: '/profile/settings',
    titleKey: 'account.settings_title',
    descriptionKey: 'account.settings_description',
    title: 'Account settings',
    description: 'Email, password, two-factor sign in, language, notifications and privacy.',
    enabled: () => true
  },
  {
    href: '/settings/linked-accounts',
    titleKey: 'govuk_alpha_settings.nav.linked_accounts',
    descriptionKey: 'govuk_alpha_settings.linked.description',
    title: 'Linked accounts',
    description: 'Manage linked family, guardian and carer accounts.',
    enabled: () => true
  },
  {
    href: '/settings/appearance',
    titleKey: 'govuk_alpha_settings.nav.appearance',
    descriptionKey: 'govuk_alpha_settings.appearance.description',
    title: 'Appearance',
    description: 'Choose how this service looks on your device.',
    enabled: () => true
  }
]);

function translated(t, key, fallback) {
  if (typeof t !== 'function') return fallback;
  const value = t(key);
  return typeof value === 'string' && value !== '' && value !== key ? value : fallback;
}

function buildAccountLinks({ tenant = {}, unreadMessageCount = 0, directMessagingEnabled, t } = {}) {
  return ACCOUNT_LINKS
    .filter((item) => (
      item.href === '/messages' && typeof directMessagingEnabled === 'boolean'
        ? directMessagingEnabled
        : item.enabled(tenant)
    ))
    .map((item) => ({
      href: item.href,
      title: translated(t, item.titleKey, item.title),
      description: translated(t, item.descriptionKey, item.description),
      ...(item.badge ? { badge: Number(unreadMessageCount) || 0 } : {})
    }));
}

module.exports = {
  ACCOUNT_LINKS,
  buildAccountLinks
};
