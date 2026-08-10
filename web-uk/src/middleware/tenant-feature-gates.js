// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { flagEnabled } = require('../lib/accessible-shell');

const FEATURE_ROUTE_GATES = [
  { pattern: /^\/events\/[^/]+\/map\/?$/, featureKey: 'maps' },
  { pattern: /^\/organisations\/[^/]+\/jobs\/?$/, featureKey: 'job_vacancies' },
  { pattern: /^\/messages\/groups(?:\/|$)/, featureKey: 'connections' },
  { prefix: '/dashboard', moduleKey: 'dashboard' },
  { prefix: '/feed', moduleKey: 'feed' },
  { prefix: '/listings', moduleKey: 'listings' },
  { prefix: '/exchanges', moduleKey: 'listings' },
  { prefix: '/matches', moduleKey: 'listings' },
  { prefix: '/events', featureKey: 'events' },
  { prefix: '/volunteering', featureKey: 'volunteering' },
  { prefix: '/organisations', featureKey: 'volunteering' },
  { prefix: '/members', featureKey: 'connections' },
  { prefix: '/connections', featureKey: 'connections' },
  { prefix: '/messages', moduleKey: 'messages' },
  { prefix: '/wallet', moduleKey: 'wallet' },
  { prefix: '/notifications', moduleKey: 'notifications' },
  { prefix: '/achievements', featureKey: 'gamification' },
  { prefix: '/leaderboard', featureKey: 'gamification' },
  { prefix: '/nexus-score', featureKey: 'gamification' },
  { prefix: '/blog', featureKey: 'blog' },
  { prefix: '/chat', featureKey: 'ai_chat' },
  { prefix: '/federation', featureKey: 'federation' },
  { prefix: '/goals', featureKey: 'goals' },
  { prefix: '/groups', featureKey: 'groups' },
  { prefix: '/group-exchanges', featureKey: 'group_exchanges' },
  { prefix: '/ideation', featureKey: 'ideation_challenges' },
  { prefix: '/jobs', featureKey: 'job_vacancies' },
  { prefix: '/marketplace/coupons', featureKey: 'merchant_coupons' },
  { prefix: '/marketplace', featureKey: 'marketplace' },
  { prefix: '/polls', featureKey: 'polls' },
  { prefix: '/courses', featureKey: 'courses' },
  { prefix: '/podcasts', featureKey: 'podcasts' },
  { prefix: '/coupons', featureKey: 'merchant_coupons' },
  { prefix: '/premium', featureKey: 'member_premium' },
  { prefix: '/resources', featureKey: 'resources' },
  { prefix: '/reviews', featureKey: 'reviews' },
  { prefix: '/search', featureKey: 'search' }
];

function pathMatchesPrefix(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function pathMatchesGate(pathname, gate) {
  if (gate.pattern) {
    return gate.pattern.test(pathname);
  }

  return pathMatchesPrefix(pathname, gate.prefix);
}

function routeGatesForPath(pathname = '') {
  return FEATURE_ROUTE_GATES.filter((gate) => pathMatchesGate(pathname, gate));
}

function tenantFeatureGate(req, res, next) {
  const tenant = req.accessibleRouting?.tenant;
  if (!tenant || typeof tenant !== 'object') {
    return next();
  }

  const gates = routeGatesForPath(req.path || '/');
  if (!gates.length) {
    return next();
  }

  for (const gate of gates) {
    if (gate.moduleKey && !flagEnabled(tenant, gate.moduleKey, 'modules', true)) {
      return res.status(403).render('errors/403', {
        title: 'Forbidden',
        message: 'This feature is not enabled for this community.'
      });
    }

    if (gate.featureKey && !flagEnabled(tenant, gate.featureKey, 'features', true)) {
      if (gate.featureKey === 'events' && (req.path || '/') === '/events' && req.method === 'GET') {
        res.locals.eventsDisabled = true;
        return next();
      }
      if (gate.featureKey === 'volunteering' && (req.path || '/') === '/volunteering') {
        res.locals.volunteeringDisabled = true;
        return next();
      }
      return res.status(403).render('errors/403', {
        title: 'Forbidden',
        message: 'This feature is not enabled for this community.'
      });
    }

    if (!gate.moduleKey && !gate.featureKey) {
      return next();
    }
  }

  return next();
}

module.exports = {
  FEATURE_ROUTE_GATES,
  routeGatesForPath,
  tenantFeatureGate
};
