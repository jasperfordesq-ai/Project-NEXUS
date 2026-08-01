// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import type { TenantFeatures, TenantModules } from '@/types/api';
import {
  MOBILE_ONLY_NAVIGATION_DESTINATION_IDS,
  NAVIGATION_DESTINATIONS,
  getNavigationItems,
  type DesktopNavigationSection,
  type MobileNavigationSection,
  type NavigationGateContext,
} from './navigationRegistry';

const DESKTOP_SECTIONS: readonly DesktopNavigationSection[] = [
  'primary',
  'timebanking',
  'community-main',
  'community-local',
  'community-explore',
  'engage',
  'progress',
  'tools',
  'federation',
  'about',
  'impact',
];

const MOBILE_SECTIONS: readonly MobileNavigationSection[] = [
  'main',
  'timebanking',
  'community',
  'engage',
  'explore',
  'federation',
  'about',
  'legal',
];

const allEnabledContext = (overrides: Partial<NavigationGateContext> = {}): NavigationGateContext => ({
  isAuthenticated: true,
  tenantSlug: 'hour-timebank',
  hasFeature: () => true,
  hasModule: () => true,
  ...overrides,
});

function desktopItems(context: NavigationGateContext) {
  return DESKTOP_SECTIONS.flatMap(section => getNavigationItems('desktop', section, context));
}

function mobileItems(context: NavigationGateContext) {
  return MOBILE_SECTIONS.flatMap(section => getNavigationItems('mobile', section, context));
}

function ids(items: ReadonlyArray<{ id: string }>) {
  return new Set(items.map(item => item.id));
}

function sorted(values: Iterable<string>) {
  return [...values].sort();
}

describe('navigationRegistry', () => {
  it('defines every destination and per-section placement only once', () => {
    const destinationIds = NAVIGATION_DESTINATIONS.map(destination => destination.id);
    const hrefs = NAVIGATION_DESTINATIONS.map(destination => destination.href);

    expect(new Set(destinationIds).size).toBe(destinationIds.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);

    for (const destination of NAVIGATION_DESTINATIONS) {
      for (const surface of ['desktop', 'mobile'] as const) {
        const sections = (destination.placements[surface] ?? []).map(placement => placement.section);
        expect(new Set(sections).size, `${destination.id} is duplicated in ${surface}/${sections.join(',')}`).toBe(sections.length);
      }
    }
  });

  it('keeps desktop and mobile destination parity with only documented mobile shell links', () => {
    const desktop = ids(desktopItems(allEnabledContext()));
    const mobile = ids(mobileItems(allEnabledContext()));
    const mobileOnly = new Set<string>(MOBILE_ONLY_NAVIGATION_DESTINATION_IDS);

    expect(sorted(desktop)).toEqual(sorted([...mobile].filter(id => !mobileOnly.has(id))));
    expect(sorted([...mobile].filter(id => !desktop.has(id)))).toEqual(sorted(mobileOnly));
  });

  it.each([
    ['caring-community', '/caring-community'],
    ['premium', '/premium'],
    ['federation-partners', '/federation/partners'],
  ] as const)('exposes %s on both surfaces at %s', (destinationId, href) => {
    const context = allEnabledContext();
    const desktop = desktopItems(context).find(item => item.id === destinationId);
    const mobile = mobileItems(context).find(item => item.id === destinationId);

    expect(desktop).toMatchObject({ id: destinationId, href });
    expect(mobile).toMatchObject({ id: destinationId, href });
  });

  it('keeps shell-specific destinations explicit instead of silently drifting', () => {
    expect(MOBILE_ONLY_NAVIGATION_DESTINATION_IDS).toEqual([
      'home',
      'legal-hub',
      'terms',
      'privacy',
      'cookies',
      'accessibility',
    ]);
    expect(NAVIGATION_DESTINATIONS.filter(destination => !destination.placements.mobile)).toHaveLength(0);
  });

  it('applies authenticated-role policy identically on desktop and mobile', () => {
    const anonymous = allEnabledContext({ isAuthenticated: false });
    const member = allEnabledContext({ isAuthenticated: true });
    const protectedIds = NAVIGATION_DESTINATIONS
      .filter(destination => 'auth' in destination && destination.auth === 'authenticated')
      .map(destination => destination.id);

    expect(sorted(protectedIds)).toEqual(sorted([
      'activity',
      'dashboard',
      'federation-events',
      'federation-hub',
      'federation-listings',
      'federation-members',
      'federation-messages',
      'federation-partners',
      'federation-settings',
      'feed',
      'messages',
      'saved',
      'venues',
      'wallet',
    ]));

    for (const surfaceItems of [desktopItems, mobileItems]) {
      const anonymousIds = ids(surfaceItems(anonymous));
      const memberIds = ids(surfaceItems(member));
      protectedIds.forEach(id => {
        expect(anonymousIds.has(id), `${id} leaked to an anonymous user`).toBe(false);
        expect(memberIds.has(id), `${id} was hidden from an authenticated member`).toBe(true);
      });
    }
  });

  it('applies anonOnly and multi-feature policy identically on desktop and mobile', () => {
    const anonymous = allEnabledContext({ isAuthenticated: false });
    const member = allEnabledContext({ isAuthenticated: true });

    for (const surfaceItems of [desktopItems, mobileItems]) {
      // whats-on is the signed-out twin of the member events page: shown to
      // anonymous visitors, never to members.
      expect(ids(surfaceItems(anonymous)).has('whats-on')).toBe(true);
      expect(ids(surfaceItems(member)).has('whats-on')).toBe(false);

      // ALL features listed on a destination must be on — dropping either
      // flag hides it.
      for (const disabled of ['events', 'public_events'] as const) {
        const context = allEnabledContext({
          isAuthenticated: false,
          hasFeature: feature => feature !== disabled,
        });
        expect(
          ids(surfaceItems(context)).has('whats-on'),
          `whats-on visible with ${disabled} off`,
        ).toBe(false);
      }
    }
  });

  it('applies every feature gate identically on desktop and mobile', () => {
    const features = new Set<keyof TenantFeatures>();
    NAVIGATION_DESTINATIONS.forEach(destination => {
      if ('feature' in destination && destination.feature) features.add(destination.feature);
    });

    for (const disabledFeature of features) {
      const context = allEnabledContext({
        hasFeature: feature => feature !== disabledFeature,
      });
      for (const surfaceItems of [desktopItems, mobileItems]) {
        const visible = ids(surfaceItems(context));
        NAVIGATION_DESTINATIONS
          .filter(destination => 'feature' in destination && destination.feature === disabledFeature)
          .forEach(destination => {
            expect(visible.has(destination.id), `${destination.id} ignored ${disabledFeature}`).toBe(false);
          });
      }
    }
  });

  it('applies every module gate identically on desktop and mobile', () => {
    const modules = new Set<keyof TenantModules>();
    NAVIGATION_DESTINATIONS.forEach(destination => {
      if ('module' in destination && destination.module) modules.add(destination.module);
    });

    for (const disabledModule of modules) {
      const context = allEnabledContext({
        hasModule: module => module !== disabledModule,
      });
      for (const surfaceItems of [desktopItems, mobileItems]) {
        const visible = ids(surfaceItems(context));
        NAVIGATION_DESTINATIONS
          .filter(destination => 'module' in destination && destination.module === disabledModule)
          .forEach(destination => {
            expect(visible.has(destination.id), `${destination.id} ignored ${disabledModule}`).toBe(false);
          });
      }
    }
  });

  it('keeps tenant-specific impact destinations in parity', () => {
    const impactIds = ['impact-report', 'our-impact', 'partner-with-us', 'social-prescribing', 'strategic-plan'];
    const ordinaryTenant = allEnabledContext({ tenantSlug: 'another-community' });
    const hourTimebank = allEnabledContext({ tenantSlug: 'hour-timebank' });

    for (const surfaceItems of [desktopItems, mobileItems]) {
      const ordinaryIds = ids(surfaceItems(ordinaryTenant));
      const hourTimebankIds = ids(surfaceItems(hourTimebank));
      impactIds.forEach(id => {
        expect(ordinaryIds.has(id)).toBe(false);
        expect(hourTimebankIds.has(id)).toBe(true);
      });
    }
  });

  it('preserves context-specific federation labels without duplicating route policy', () => {
    const context = allEnabledContext();
    const desktopPartners = getNavigationItems('desktop', 'federation', context)
      .find(item => item.id === 'federation-partners');
    const mobilePartners = getNavigationItems('mobile', 'federation', context)
      .find(item => item.id === 'federation-partners');

    expect(desktopPartners).toMatchObject({
      href: '/federation/partners',
      labelKey: 'nav.partner_communities',
      feature: 'federation',
      auth: 'authenticated',
    });
    expect(mobilePartners).toMatchObject({
      href: '/federation/partners',
      labelKey: 'nav.federation_partners_short',
      feature: 'federation',
      auth: 'authenticated',
    });
  });
});
