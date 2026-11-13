// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The home page's "What you can do" cards. Moved here from server.js on
 * 13 Nov 2026 so the labels can be tested without booting the whole app.
 *
 * 🔴 `authRequired` is what a signed-out VISITOR is told, so it must match what
 * the page does to them. Until 13 Nov 2026 Feed, Listings, Members, Events and
 * Volunteering lacked it and were tagged "Available" to visitors: Members,
 * Events and Volunteering redirect to sign-in (requireAuth in server.js), Feed
 * renders a sign-in banner, and the listings API answers a visitor 401. A card
 * for a page a visitor cannot use now reads "Sign in" and links to sign-in,
 * like Dashboard, Messages, Exchanges, Time wallet and My Profile always did.
 */
const HOME_MODULES = [
  { key: 'dashboard', titleKey: 'dashboard.title', descriptionKey: 'dashboard.description', href: '/dashboard', authRequired: true },
  { key: 'feed', titleKey: 'feed.title', descriptionKey: 'feed.description', href: '/feed', authRequired: true, moduleKey: 'feed', defaultEnabled: true },
  { key: 'listings', titleKey: 'listings.title', descriptionKey: 'listings.description', href: '/listings', authRequired: true, moduleKey: 'listings', defaultEnabled: false },
  { key: 'members', titleKey: 'members.title', descriptionKey: 'members.description', href: '/members', authRequired: true, featureKey: 'connections' },
  { key: 'events', titleKey: 'events.title', descriptionKey: 'events.description', href: '/events', authRequired: true, featureKey: 'events' },
  { key: 'volunteering', titleKey: 'volunteering.title', descriptionKey: 'volunteering.description', href: '/volunteering', authRequired: true, featureKey: 'volunteering' },
  { key: 'messages', titleKey: 'messages.title', descriptionKey: 'messages.description', href: '/messages', authRequired: true, featureKey: 'direct_messaging' },
  { key: 'exchanges', titleKey: 'exchanges.title', descriptionKey: 'exchanges.description', href: '/exchanges', authRequired: true, moduleKey: 'listings', featureKey: 'exchange_workflow', defaultEnabled: false },
  { key: 'wallet', titleKey: 'wallet.title', descriptionKey: 'wallet.description', href: '/wallet', authRequired: true, moduleKey: 'wallet' },
  { key: 'profile', titleKey: 'nav.profile', descriptionKey: 'profile_settings.description', href: '/profile', authRequired: true }
];

function featureEnabled(tenant, key, fallback = true) {
  const features = tenant.features && typeof tenant.features === 'object' ? tenant.features : {};
  const modules = tenant.modules && typeof tenant.modules === 'object' ? tenant.modules : {};
  if (Object.prototype.hasOwnProperty.call(features, key)) return Boolean(features[key]);
  if (Object.prototype.hasOwnProperty.call(modules, key)) return Boolean(modules[key]);
  return fallback;
}

function buildHomeModules(tenant, isAuthenticated, t) {
  return HOME_MODULES.map((module) => {
    const fallback = module.defaultEnabled !== undefined ? module.defaultEnabled : true;
    const moduleEnabled = module.moduleKey
      ? featureEnabled(tenant, module.moduleKey, fallback)
      : true;
    const featureOn = module.featureKey
      ? featureEnabled(tenant, module.featureKey, fallback)
      : true;
    const tenantEnabled = moduleEnabled && featureOn;
    const needsSignIn = tenantEnabled && module.authRequired && !isAuthenticated;
    const available = tenantEnabled && (!module.authRequired || isAuthenticated);

    return {
      ...module,
      title: t(module.titleKey),
      description: t(module.descriptionKey),
      href: needsSignIn ? '/login?status=auth-required' : module.href,
      available,
      needsSignIn,
      linked: available || needsSignIn
    };
  });
}

module.exports = {
  HOME_MODULES,
  buildHomeModules,
  featureEnabled
};
