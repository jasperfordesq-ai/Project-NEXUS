// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'fs';
import path from 'path';

import { ROUTE_REQUIREMENTS, UNGATED_ROUTES } from '@/lib/navigation/routeRequirements';

/**
 * 🔴 Every screen is either gated by its community switch or recorded as deliberately
 * ungated. This is what stops the 2026-09-07 finding from recurring: the React app gated
 * ~150 routes and the native app gated five, because nothing ever asked each new screen
 * which switch it belonged to.
 */

const appDir = __dirname;
const SCREEN_DIRS = ['(modals)', '(tabs)'];

function screenFiles(): { route: string; file: string; source: string }[] {
  return SCREEN_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(appDir, dir))
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx') && name !== '_layout.tsx')
      .map((name) => {
        const file = path.join(appDir, dir, name);
        return { route: name.replace(/\.tsx$/, ''), file, source: fs.readFileSync(file, 'utf8') };
      }),
  );
}

function reexportTarget(source: string): string | null {
  const match = source.match(/^export \{ default \} from '(?:@\/app\/|\.\.?\/)(?:\(tabs\)\/)?([A-Za-z0-9_-]+)';/m);
  return match ? match[1] : null;
}

describe('route gating inventory', () => {
  const screens = screenFiles();

  it('finds the screens it is meant to police', () => {
    expect(screens.length).toBeGreaterThan(150);
  });

  it('records a decision for every screen: a requirement, or a reason it has none', () => {
    const undecided = screens
      .filter(({ route }) => !ROUTE_REQUIREMENTS[route] && !UNGATED_ROUTES[route])
      .map(({ route }) => route);

    expect(undecided).toEqual([]);
  });

  it('never lists a screen as both gated and ungated', () => {
    const both = Object.keys(UNGATED_ROUTES).filter((route) => ROUTE_REQUIREMENTS[route]);
    expect(both).toEqual([]);
  });

  it('only names screens that exist', () => {
    const names = new Set(screens.map(({ route }) => route));
    const stale = [...Object.keys(ROUTE_REQUIREMENTS), ...Object.keys(UNGATED_ROUTES)].filter((route) => !names.has(route));
    expect(stale).toEqual([]);
  });

  it('wraps every gated screen in withRouteGate with its own route name', () => {
    const byRoute = new Map(screens.map((screen) => [screen.route, screen]));
    const unwrapped: string[] = [];

    for (const { route, source } of screens) {
      if (!ROUTE_REQUIREMENTS[route]) continue;
      const alias = reexportTarget(source);
      if (alias) {
        // An alias inherits its target's gate; the target must be gated at least as
        // strictly. Same requirement is the only acceptable answer.
        const target = byRoute.get(alias);
        expect(target).toBeDefined();
        expect(ROUTE_REQUIREMENTS[alias]).toEqual(ROUTE_REQUIREMENTS[route]);
        continue;
      }
      if (!source.includes(`withRouteGate(`) || !source.includes(`'${route}')`)) {
        unwrapped.push(route);
      }
    }

    expect(unwrapped).toEqual([]);
  });

  it('gives every ungated screen a written reason', () => {
    for (const [route, reason] of Object.entries(UNGATED_ROUTES)) {
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(10);
      expect(route).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('only requires switches the platform actually has', () => {
    // Mirrors TenantFeatureConfig::FEATURE_DEFAULTS / MODULE_DEFAULTS in the API. If a key
    // is added there, add it here too; an unknown key here would refuse a screen for every
    // community, because the API never sends the key.
    const knownFeatures = new Set([
      'events', 'groups', 'gamification', 'goals', 'blog', 'resources', 'caring_community',
      'volunteering', 'exchange_workflow', 'organisations', 'federation', 'connections', 'reviews',
      'polls', 'job_vacancies', 'ideation_challenges', 'direct_messaging', 'group_exchanges', 'search',
      'ai_chat', 'marketplace', 'merchant_coupons', 'message_translation', 'member_premium', 'ai_agents',
      'partner_api', 'fadp_compliance', 'local_advertising', 'regional_analytics', 'newsletter',
      'two_factor_authentication', 'biometric_login', 'identity_verification', 'maps', 'courses',
      'podcasts', 'partner_venues', 'public_events', 'event_attendance_credits', 'explore',
    ]);
    const knownModules = new Set(['listings', 'wallet', 'messages', 'dashboard', 'feed', 'notifications', 'profile', 'settings']);

    const unknown: string[] = [];
    for (const [route, requirement] of Object.entries(ROUTE_REQUIREMENTS)) {
      for (const f of requirement.features ?? []) if (!knownFeatures.has(f)) unknown.push(`${route}: feature ${f}`);
      for (const m of requirement.modules ?? []) if (!knownModules.has(m)) unknown.push(`${route}: module ${m}`);
      expect((requirement.features?.length ?? 0) + (requirement.modules?.length ?? 0)).toBeGreaterThan(0);
    }
    expect(unknown).toEqual([]);
  });
});
