// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  ROUTE_REQUIREMENTS,
  isRouteAllowed,
  requirementForRoute,
  routeNameFromHref,
} from './routeRequirements';
import { isNativeHrefDisabled, setNavigationTenantCapabilities } from './tenantCapabilityStore';

const ALL_ON = () => {
  const features: Record<string, boolean> = {};
  const modules: Record<string, boolean> = {};
  for (const requirement of Object.values(ROUTE_REQUIREMENTS)) {
    for (const f of requirement.features ?? []) features[f] = true;
    for (const m of requirement.modules ?? []) modules[m] = true;
  }
  return { features, modules };
};

describe('routeNameFromHref', () => {
  it.each([
    ['/(modals)/event-detail?id=3', 'event-detail'],
    ['(modals)/wallet', 'wallet'],
    ['/(tabs)/events', 'events'],
    ['/(auth)/login', 'login'],
    ['/events/3', null],
    ['/', null],
  ])('%s → %s', (href, expected) => {
    expect(routeNameFromHref(href)).toBe(expected);
  });
});

describe('isRouteAllowed', () => {
  it('allows everything while the community configuration is unknown', () => {
    expect(isRouteAllowed(null, 'wallet')).toBe(true);
    expect(isRouteAllowed(undefined, 'marketplace')).toBe(true);
  });

  it('allows a screen with no requirement whatever the configuration says', () => {
    expect(requirementForRoute('support')).toBeNull();
    expect(isRouteAllowed({ features: {}, modules: {} }, 'support')).toBe(true);
  });

  it('refuses a screen whose feature is off, and one whose feature is missing', () => {
    expect(isRouteAllowed({ features: { events: false }, modules: {} }, 'event-detail')).toBe(false);
    expect(isRouteAllowed({ features: {}, modules: {} }, 'event-detail')).toBe(false);
    expect(isRouteAllowed({ features: { events: true }, modules: {} }, 'event-detail')).toBe(true);
  });

  it('refuses a module screen whose module is off', () => {
    expect(isRouteAllowed({ features: {}, modules: { wallet: false } }, 'wallet')).toBe(false);
    expect(isRouteAllowed({ features: {}, modules: { wallet: true } }, 'wallet')).toBe(true);
  });

  it('needs every listed switch, not just one', () => {
    const onlyWorkflow = { features: { exchange_workflow: true }, modules: { listings: false } };
    const onlyListings = { features: { exchange_workflow: false }, modules: { listings: true } };
    const both = { features: { exchange_workflow: true }, modules: { listings: true } };
    expect(isRouteAllowed(onlyWorkflow, 'exchange-requests')).toBe(false);
    expect(isRouteAllowed(onlyListings, 'exchange-requests')).toBe(false);
    expect(isRouteAllowed(both, 'exchange-requests')).toBe(true);
  });
});

/**
 * 🔴 The deep-link store and the screen gate must agree. If a tap on a notification is let
 * through to a screen that then refuses, the member sees a locked screen instead of the
 * notifications list the store would have sent them to.
 */
describe('deep-link store agrees with the screen gate for every gated route', () => {
  afterEach(() => setNavigationTenantCapabilities(null));

  it.each(Object.keys(ROUTE_REQUIREMENTS))('%s', (route) => {
    const requirement = ROUTE_REQUIREMENTS[route];
    const href = `/(modals)/${route}?id=1`;

    setNavigationTenantCapabilities(ALL_ON());
    expect(isNativeHrefDisabled(href)).toBe(false);

    for (const feature of requirement.features ?? []) {
      const snapshot = ALL_ON();
      snapshot.features[feature] = false;
      setNavigationTenantCapabilities(snapshot);
      expect(isNativeHrefDisabled(href)).toBe(true);
    }
    for (const module of requirement.modules ?? []) {
      const snapshot = ALL_ON();
      snapshot.modules[module] = false;
      setNavigationTenantCapabilities(snapshot);
      expect(isNativeHrefDisabled(href)).toBe(true);
    }
  });
});
