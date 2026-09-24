// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { isValidElement } from 'react';
import { createRoutesFromElements, type RouteObject } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { FeatureGate } from '@/components/routing/FeatureGate';
import { AppRoutes } from './AppRoutes';
import { PublicAppRoutes } from './PublicAppRoutes';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function findJoinRoute(routes: RouteObject[]): RouteObject | undefined {
  for (const route of routes) {
    if (route.path === 'join/:code') return route;
    const nested = route.children && findJoinRoute(route.children);
    if (nested) return nested;
  }
  return undefined;
}

describe('Caring Community invitation route boundaries', () => {
  it.each([
    ['public registry', PublicAppRoutes],
    ['signed-in registry', AppRoutes],
  ])('%s requires the Caring feature before mounting invite redemption', (_name, registry) => {
    const route = findJoinRoute(createRoutesFromElements(registry()));
    expect(route).toBeDefined();
    expect(isValidElement(route?.element)).toBe(true);
    if (!isValidElement(route?.element)) return;

    expect(route.element.type).toBe(FeatureGate);
    const props = route.element.props as { feature?: string; fallback?: unknown };
    expect(props.feature).toBe('caring_community');
    expect(props.fallback).toBeTruthy();
  });
});
