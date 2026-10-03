// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression tests for SlugUrlGuard (TenantShell).
 *
 * Pages rendered inside TenantShell's slug-stripped nested <Routes> resolve
 * relative navigations (setSearchParams, navigate('?...')) against the
 * STRIPPED pathname. EventsPage does exactly that on mount to sync its
 * filters into the URL, which rewrote the browser URL from
 * /hour-timebank/events to /events — after SlugUrlGuard's one-shot
 * mount-time check had already run. A slug-less URL then makes
 * detectTenantFromUrl() fall back to the master tenant on the next
 * TenantShell render. The guard must therefore re-assert the slug on every
 * router location change, not just on mount.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BrowserRouter, Routes, Route, useSearchParams, UNSAFE_NavigationContext } from 'react-router-dom';
import { useContext, useEffect, useMemo, type ReactNode } from 'react';
import { SlugUrlGuard, withSlugPreservingNavigator } from './TenantShell';

/** Mimics EventsPage: pushes its (stripped) location into the URL on mount. */
function StripOnMount() {
  const [, setSearchParams] = useSearchParams();
  useEffect(() => {
    setSearchParams(new URLSearchParams('q=workshop'), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only, mirrors EventsPage
  }, []);
  return <div>events page</div>;
}

describe('SlugUrlGuard', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/hour-timebank/events');
  });

  it('restores the slug after a nested-route setSearchParams rewrites the browser URL', async () => {
    render(
      <BrowserRouter>
        <SlugUrlGuard slug="hour-timebank" />
        {/* Same shape as TenantGuard: route matching runs on the stripped path */}
        <Routes location={{ pathname: '/events', search: '' }}>
          <Route path="events" element={<StripOnMount />} />
        </Routes>
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hour-timebank/events');
      expect(window.location.search).toBe('?q=workshop');
    });
  });

  it('leaves an already-correct URL untouched', async () => {
    render(
      <BrowserRouter>
        <SlugUrlGuard slug="hour-timebank" />
        <Routes location={{ pathname: '/events', search: '' }}>
          <Route path="events" element={<div>events page</div>} />
        </Routes>
      </BrowserRouter>
    );

    await waitFor(() => {
      expect(window.location.pathname).toBe('/hour-timebank/events');
    });
  });
});

/** The same wrapping TenantRoutes applies around its slug-stripped Routes. */
function SlugNavigation({ slug, children }: { slug: string; children: ReactNode }) {
  const navigation = useContext(UNSAFE_NavigationContext);
  const value = useMemo(
    () => ({ ...navigation, navigator: withSlugPreservingNavigator(navigation.navigator, slug) }),
    [navigation, slug],
  );
  return <UNSAFE_NavigationContext.Provider value={value}>{children}</UNSAFE_NavigationContext.Provider>;
}

describe('withSlugPreservingNavigator', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/hour-timebank/events');
  });

  it('never lets the address lose the slug when a page updates its query (a tab click)', async () => {
    const written: string[] = [];
    const original = window.history.replaceState.bind(window.history);
    const spy = vi.spyOn(window.history, 'replaceState').mockImplementation((state, unused, url) => {
      // The router also calls replaceState with no URL on start-up (state only).
      if (url != null) written.push(String(url));
      original(state, unused, url);
    });
    try {
      render(
        <BrowserRouter>
          <SlugUrlGuard slug="hour-timebank" />
          <SlugNavigation slug="hour-timebank">
            <Routes location={{ pathname: '/events', search: '' }}>
              <Route path="events" element={<StripOnMount />} />
            </Routes>
          </SlugNavigation>
        </BrowserRouter>
      );

      await waitFor(() => expect(window.location.search).toBe('?q=workshop'));
      expect(window.location.pathname).toBe('/hour-timebank/events');
      expect(written.length).toBeGreaterThan(0);
      // Before the fix the router first wrote /events?q=workshop and the guard
      // repaired it afterwards; now no slug-less address is ever written.
      expect(written.filter((url) => !url.startsWith('/hour-timebank'))).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  });

  function fakeNavigator() {
    const calls: unknown[] = [];
    return {
      calls,
      navigator: {
        createHref: (to: unknown) => JSON.stringify(to),
        go: vi.fn(),
        push: (to: unknown) => { calls.push(to); },
        replace: (to: unknown) => { calls.push(to); },
      },
    };
  }

  it('adds the slug to a slug-less path while the slug is in the browser path (incl. a sub-community on a parent domain)', () => {
    window.history.replaceState(null, '', '/stratford/events');
    const { calls, navigator } = fakeNavigator();
    const wrapped = withSlugPreservingNavigator(navigator as never, 'stratford');
    wrapped.push('/events?q=1');
    wrapped.replace({ pathname: '/', search: '' });
    expect(calls).toEqual([
      { pathname: '/stratford/events', search: '?q=1' },
      { pathname: '/stratford', search: '' },
    ].map((c) => expect.objectContaining(c)));
  });

  it('leaves paths that already carry the slug alone (tenantPath links)', () => {
    const { calls, navigator } = fakeNavigator();
    const wrapped = withSlugPreservingNavigator(navigator as never, 'hour-timebank');
    wrapped.push('/hour-timebank/listings');
    wrapped.push('/Hour-Timebank/listings');
    expect(calls).toEqual(['/hour-timebank/listings', '/Hour-Timebank/listings']);
  });

  it('never adds a path prefix when the slug is not in the browser path (subdomain tenants)', () => {
    window.history.replaceState(null, '', '/events');
    const { calls, navigator } = fakeNavigator();
    const wrapped = withSlugPreservingNavigator(navigator as never, 'hour-timebank');
    wrapped.push('/events?q=1');
    expect(calls).toEqual(['/events?q=1']);
  });
});
