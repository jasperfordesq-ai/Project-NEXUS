// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import inventory from '@/config/native-push-producer-inventory.json';
import review from '@/config/native-push-dynamic-route-review.json';
import { mapSystemPathToNativeRoute } from '@/app/+native-intent';
import { getNotificationLink } from '@/lib/notifications';

type Producer = (typeof inventory.producers)[number];
type StaticRouteExpectation = { notification_link: string; native_href: string };

/**
 * Human-reviewed exact destinations for every statically sampleable producer route.
 * The producer inventory pins the individual call sites and types; this table pins
 * what a tap must resolve to, so a wrong-but-valid screen is a contract failure.
 */
const STATIC_ROUTE_EXPECTATIONS: Record<string, StaticRouteExpectation> = {
  '/achievements': { notification_link: '/achievements', native_href: '/(modals)/achievements' },
  '/admin/federation': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/admin/identity-verifications': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/admin/jobs/moderation': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/admin/marketplace/reports/1': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/admin/reports': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/broker/matches/requests/1': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/caring-community/caregiver': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/caring-community/projects/1': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/connections': { notification_link: '/connections', native_href: '/(modals)/connections' },
  '/dashboard': { notification_link: '/dashboard', native_href: '/(tabs)/home' },
  '/deliverables/1': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/federation/connections': { notification_link: '/federation/connections', native_href: '/(modals)/federation-connections' },
  '/federation/messages': { notification_link: '/federation/messages', native_href: '/(modals)/federation-messages' },
  '/feed': { notification_link: '/feed', native_href: '/(tabs)/home' },
  '/goals/1': { notification_link: '/goals/1', native_href: '/(modals)/goal-detail?id=1' },
  '/groups/1': { notification_link: '/groups/1', native_href: '/(modals)/group-detail?id=1' },
  '/jobs/1': { notification_link: '/jobs/1', native_href: '/(modals)/job-detail?id=1' },
  '/jobs/1#applications': { notification_link: '/jobs/1#applications', native_href: '/(modals)/job-pipeline?id=1' },
  '/jobs/1/kanban': { notification_link: '/jobs/1/kanban', native_href: '/(modals)/job-pipeline?id=1' },
  '/listings/1': { notification_link: '/listings/1', native_href: '/(modals)/exchange-detail?id=1' },
  '/marketplace/orders/sales?order_id=1': { notification_link: '/marketplace/orders/sales?order_id=1', native_href: '/(modals)/marketplace-orders?mode=sales&order_id=1' },
  '/marketplace/seller/dashboard': { notification_link: '/marketplace/seller/dashboard', native_href: '/(modals)/marketplace-tools' },
  '/matches': { notification_link: '/matches', native_href: '/(modals)/matches' },
  '/matches?highlight=listing-1': { notification_link: '/matches?highlight=listing-1', native_href: '/(modals)/matches?highlight=listing-1' },
  '/matches?type=mutual&highlight=listing-1': { notification_link: '/matches?type=mutual&highlight=listing-1', native_href: '/(modals)/matches?type=mutual&highlight=listing-1' },
  '/messages': { notification_link: '/messages', native_href: '/(tabs)/messages' },
  '/notifications': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/polls/1': { notification_link: '/polls/1', native_href: '/(modals)/feed-item-detail?type=poll&id=1' },
  '/premium/manage': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/reviews': { notification_link: '/reviews', native_href: '/(modals)/reviews' },
  '/settings/security': { notification_link: '/settings/security', native_href: '/(modals)/settings' },
  '/settings/verification': { notification_link: '/settings/verification', native_href: '/(modals)/verify-identity' },
  '/volunteering': { notification_link: '/volunteering', native_href: '/(modals)/volunteering' },
  '/volunteering/opportunities/1': { notification_link: '/volunteering/opportunities/1', native_href: '/(modals)/volunteering-detail?id=1' },
  '/volunteering?tab=hours': { notification_link: '/volunteering?tab=hours', native_href: '/(modals)/volunteering?tab=hours' },
  '/volunteering?tab=waitlist': { notification_link: '/volunteering?tab=waitlist', native_href: '/(modals)/volunteering?tab=waitlist' },
  '/wallet': { notification_link: '/wallet', native_href: '/(modals)/wallet' },
};

const STATIC_TYPE_OVERRIDES: Record<string, StaticRouteExpectation> = {
  '/feed\u0000story_reaction': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
  '/feed\u0000story_reply': { notification_link: '/notifications', native_href: '/(modals)/notifications' },
};

function literalSample(expression: string | null): string | null {
  if (expression === null) return null;
  if (expression === 'null') return '/notifications';
  if (expression.startsWith('/') || expression.startsWith('https://') || expression.startsWith('nexus:')) {
    return expression.replace(/\{[^}]+\}/g, '1');
  }
  if (/^['"]\//.test(expression)) {
    const pieces = [...expression.matchAll(/['"]([^'"]*)['"]/g)].map((match) => match[1]);
    if (pieces.length === 0) return null;
    const hasTrailingRuntimeValue = !/['"]\s*$/.test(expression);
    const combined = `${pieces.join('1')}${hasTrailingRuntimeValue ? '1' : ''}`
      .replace(/\{[^}]+\}/g, '1');
    return combined.startsWith('/') ? combined : null;
  }
  return null;
}

function expectNative(input: string, nativeHref: string): void {
  expect(getNotificationLink({ schema_version: '1', type: 'audit', link: input })).toBe(input);
  expect(mapSystemPathToNativeRoute(input)).toBe(nativeHref);
}

function literalType(expression: string | null): string {
  return expression && /^[a-z0-9_:-]{1,80}$/i.test(expression) ? expression : 'audit';
}

describe('complete backend push producer route contract', () => {
  it('classifies every producer whose destination cannot be sampled statically', () => {
    const unresolvedFiles = new Set(
      (inventory.producers as Producer[])
        .filter((producer) => literalSample(producer.link_expression) === null)
        .map((producer) => producer.file),
    );
    const reviewedFiles = new Set(Object.keys(review.reviews));

    expect([...unresolvedFiles].filter((file) => !reviewedFiles.has(file))).toEqual([]);
    expect([...reviewedFiles].filter((file) => !unresolvedFiles.has(file))).toEqual([]);
  });

  it('maps every statically sampleable producer destination to its exact reviewed native href', () => {
    const sampledInputs = new Set<string>();
    for (const producer of inventory.producers as Producer[]) {
      const input = literalSample(producer.link_expression);
      if (input === null) continue;
      sampledInputs.add(input);
      const type = literalType(producer.type_expression);
      const expectation = STATIC_TYPE_OVERRIDES[`${input}\u0000${type}`]
        ?? STATIC_ROUTE_EXPECTATIONS[input];
      expect(expectation).toBeDefined();
      const notificationLink = getNotificationLink({ schema_version: '1', type, link: input });
      expect({
        notification_link: notificationLink,
        native_href: mapSystemPathToNativeRoute(notificationLink),
      }).toEqual(expectation);
    }
    expect([...sampledInputs].sort()).toEqual(Object.keys(STATIC_ROUTE_EXPECTATIONS).sort());
  });

  it('proves each reviewed dynamic destination family', () => {
    for (const [file, entry] of Object.entries(review.reviews)) {
      if ('infrastructure' in entry && entry.infrastructure) continue;
      for (const route of entry.routes) {
        if (route.expected === 'native') {
          expect('native_href' in route).toBe(true);
          if (!('native_href' in route) || typeof route.native_href !== 'string') {
            throw new Error(`Missing exact native href for ${file}: ${route.input}`);
          }
          expectNative(route.input, route.native_href);
        } else if (route.expected === 'fallback' || route.expected === 'suppressed') {
          const routeType = 'type' in route && typeof route.type === 'string' ? route.type : 'audit';
          expect(getNotificationLink({ schema_version: '1', type: routeType, link: route.input })).toBe('/notifications');
        } else if (route.expected === 'paid_external') {
          expect(getNotificationLink({ campaign_type: 'paid_push', cta_url: route.input })).toBe(route.input);
        } else if (route.expected === 'paid_internal') {
          expect(getNotificationLink({ campaign_type: 'paid_push', cta_url: route.input })).toBe(route.input);
          expect(mapSystemPathToNativeRoute(route.input)).not.toBeNull();
        } else {
          throw new Error(`Unknown push route classification for ${file}: ${route.expected}`);
        }
      }
    }
  });
});
