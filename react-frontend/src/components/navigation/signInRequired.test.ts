// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAVIGATION_DESTINATIONS } from './navigationRegistry';
import { pathNeedsSignIn } from './signInRequired';

const routesDir = path.resolve(__dirname, '../../routes');
const appSource = readFileSync(path.join(routesDir, 'AppRoutes.tsx'), 'utf8');
const publicSource = readFileSync(path.join(routesDir, 'PublicAppRoutes.tsx'), 'utf8');
const authSource = readFileSync(path.join(routesDir, 'AuthRoutes.tsx'), 'utf8');

interface DeclaredRoute {
  /** The path with every `:param` filled in, so it can be asked about like a real address. */
  path: string;
  /** True when the route file sends a signed-out visitor to the sign-in page. */
  guarded: boolean;
}

/**
 * Reads a route file the way a person would: a route is guarded when it sits
 * inside a `<Route element={<ProtectedRoute />}>` block, or wraps its own page
 * in `<ProtectedRoute>`. Wildcard routes (the panels, the 404) are skipped.
 */
function declaredRoutes(source: string): DeclaredRoute[] {
  const routes: DeclaredRoute[] = [];
  const openGuards: string[] = [];
  const lines = source.split('\n');

  lines.forEach((line, index) => {
    const guardOpen = /^(\s*)<Route element=\{<ProtectedRoute \/>\}>/.exec(line);
    if (guardOpen) {
      openGuards.push(guardOpen[1] ?? '');
      return;
    }
    const close = /^(\s*)<\/Route>/.exec(line);
    if (close && openGuards.length > 0 && close[1] === openGuards[openGuards.length - 1]) {
      openGuards.pop();
      return;
    }
    const route = /<Route path="([^"]+)"/.exec(line);
    if (!route?.[1] || route[1].includes('*')) return;

    // A route that guards itself opens <ProtectedRoute> before the next route starts.
    const rest = lines.slice(index + 1);
    const nextRoute = rest.findIndex(next => next.includes('<Route '));
    const ownLines = [line, ...rest.slice(0, nextRoute === -1 ? 3 : nextRoute)].join('\n');

    routes.push({
      path: route[1].replace(/\/:[A-Za-z]+\?/g, '').replace(/:[A-Za-z]+/g, '1'),
      guarded: openGuards.length > 0 || ownLines.includes('<ProtectedRoute>'),
    });
  });

  return routes;
}

describe('pathNeedsSignIn', () => {
  it('says the member pages a visitor is shown need a sign-in', () => {
    for (const href of ['/listings', '/members', '/events', '/groups', '/volunteering', '/jobs', '/goals', '/polls', '/leaderboard', '/kb']) {
      expect(pathNeedsSignIn(href), href).toBe(true);
    }
  });

  it('says the open pages do not', () => {
    for (const href of ['/', '/about', '/faq', '/blog', '/blog/a-post', '/whats-on', '/whats-on/12', '/help', '/help/members/wallet', '/page/our-story', '/terms', '/terms/versions', '/legal', '/contact', '/login', '/register', '/caring-community']) {
      expect(pathNeedsSignIn(href), href).toBe(false);
    }
  });

  it('treats a page under an open page as locked when only the top page is open', () => {
    expect(pathNeedsSignIn('/caring-community/request-help')).toBe(true);
    expect(pathNeedsSignIn('/clubs')).toBe(false);
    expect(pathNeedsSignIn('/clubs/4/admin/dues')).toBe(true);
    expect(pathNeedsSignIn('/verify-identity')).toBe(false);
    expect(pathNeedsSignIn('/verify-identity/callback')).toBe(true);
  });

  it('does not confuse a page whose name merely starts like an open one', () => {
    expect(pathNeedsSignIn('/partner')).toBe(false);
    expect(pathNeedsSignIn('/partner-timebanks')).toBe(true);
    expect(pathNeedsSignIn('/pagesomething')).toBe(true);
  });

  it('ignores the query, the fragment, a trailing slash and letter case', () => {
    expect(pathNeedsSignIn('/about/?from=menu#team')).toBe(false);
    expect(pathNeedsSignIn('/About')).toBe(false);
    expect(pathNeedsSignIn('/members/?sort=new')).toBe(true);
  });

  it('reads through the community prefix', () => {
    expect(pathNeedsSignIn('/hour-timebank/about', '/hour-timebank/')).toBe(false);
    expect(pathNeedsSignIn('/hour-timebank/members', '/hour-timebank/')).toBe(true);
    expect(pathNeedsSignIn('/hour-timebank', '/hour-timebank/')).toBe(false);
    expect(pathNeedsSignIn('/hour-timebank/', '/hour-timebank/')).toBe(false);
    // A registry address that has not been given its prefix yet.
    expect(pathNeedsSignIn('/members', '/hour-timebank/')).toBe(true);
  });

  it('never locks a link that leaves the site', () => {
    for (const url of ['https://example.org/members', 'http://example.org', '//example.org/members', 'mailto:hello@example.org', 'tel:+15551234567', '#top', '']) {
      expect(pathNeedsSignIn(url), url).toBe(false);
    }
  });
});

describe('pathNeedsSignIn agrees with the route files', () => {
  const appRoutes = declaredRoutes(appSource);

  it('reads a believable number of routes from AppRoutes.tsx', () => {
    // If the route file changes shape and the reader above stops seeing it,
    // fail here rather than pass with nothing checked.
    expect(appRoutes.length).toBeGreaterThan(250);
    expect(appRoutes.filter(route => route.guarded).length).toBeGreaterThan(180);
    expect(appRoutes.filter(route => !route.guarded).length).toBeGreaterThan(40);
    expect(appRoutes.find(route => route.path === 'about')?.guarded).toBe(false);
    expect(appRoutes.find(route => route.path === 'members')?.guarded).toBe(true);
    expect(appRoutes.find(route => route.path === 'advertise/campaigns')?.guarded).toBe(true);
    expect(appRoutes.find(route => route.path === 'clubs')?.guarded).toBe(false);
    expect(appRoutes.find(route => route.path === 'reviews/create')?.guarded).toBe(true);
  });

  it('gives every route in AppRoutes.tsx the answer the route file gives', () => {
    const wrong = appRoutes
      .filter(route => pathNeedsSignIn(`/${route.path}`) !== route.guarded)
      .map(route => `/${route.path} — route file says ${route.guarded ? 'sign-in needed' : 'open'}`);
    expect(wrong).toEqual([]);
  });

  it('treats every public-registry and sign-in route as open', () => {
    const open = [...declaredRoutes(publicSource), ...declaredRoutes(authSource)];
    expect(open.length).toBeGreaterThan(60);
    expect(open.filter(route => pathNeedsSignIn(`/${route.path}`)).map(route => `/${route.path}`)).toEqual([]);
  });

  it('knows which menu destinations a visitor can open', () => {
    const open = NAVIGATION_DESTINATIONS
      .filter(destination => !pathNeedsSignIn(destination.href))
      .map(destination => destination.id);
    expect(open).toEqual([
      'home',
      'whats-on',
      'caring-community',
      'about',
      'features',
      'blog',
      'faq',
      'timebanking-guide',
      'partner-with-us',
      'social-prescribing',
      'our-impact',
      'impact-report',
      'strategic-plan',
      'legal-hub',
      'terms',
      'privacy',
      'cookies',
      'accessibility',
    ]);
  });

  it('never hides from visitors a destination they could open', () => {
    // `auth: 'authenticated'` removes a link from a visitor's menus. That is
    // only right for a page that would send them to sign in.
    const hiddenButOpen = NAVIGATION_DESTINATIONS
      .filter(destination => 'auth' in destination && !pathNeedsSignIn(destination.href))
      .map(destination => destination.id);
    expect(hiddenButOpen).toEqual([]);
  });
});
