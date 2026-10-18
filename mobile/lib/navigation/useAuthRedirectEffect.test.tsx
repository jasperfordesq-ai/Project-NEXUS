// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The root navigator's redirect effect, as a sequence of renders. `app/_layout.tsx`
 * cannot be rendered in a test (module-scope side effects, six providers), so the effect
 * lives in a hook and is driven here exactly as React drives it: one render per state
 * change, including the render after a navigation where `usePathname()` has not caught
 * up yet.
 */

import { renderHook } from '@testing-library/react-native';
import { useAuthRedirectEffect, type AuthRedirectEffectInput } from './useAuthRedirectEffect';

function harness(overrides: Partial<AuthRedirectEffectInput> = {}) {
  const navigate = jest.fn<'navigated' | 'external' | 'ignored', [string]>(() => 'navigated');
  const replace = jest.fn();
  const setPendingDeepLink = jest.fn();
  const base: AuthRedirectEffectInput = {
    isLoading: true,
    isAuthenticated: false,
    onboardingCompleted: true,
    hasSelectedTenant: true,
    pathname: '/',
    pendingDeepLink: null,
    setPendingDeepLink,
    navigate,
    replace,
    ...overrides,
  };
  const hook = renderHook((props: AuthRedirectEffectInput) => useAuthRedirectEffect(props), {
    initialProps: base,
  });
  return {
    navigate,
    replace,
    setPendingDeepLink,
    next: (patch: Partial<AuthRedirectEffectInput>) => {
      Object.assign(base, patch);
      hook.rerender({ ...base });
    },
  };
}

describe('useAuthRedirectEffect', () => {
  it('keeps the screen a push tap opened through the stale-pathname render that follows', () => {
    const h = harness();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();

    // The link arrived before auth resolved; auth now resolves while still on the spinner.
    h.next({ isLoading: false, isAuthenticated: true, pendingDeepLink: '/messages/7' });
    expect(h.navigate).toHaveBeenCalledWith('/messages/7');
    expect(h.setPendingDeepLink).toHaveBeenCalledWith(null);

    // One render later the queue is empty and usePathname() still says '/'.
    h.next({ pendingDeepLink: null, pathname: '/' });
    expect(h.replace).not.toHaveBeenCalled();

    // The pathname catches up: nothing to do.
    h.next({ pathname: '/thread' });
    expect(h.replace).not.toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledTimes(1);

    // Much later the member is back on the spinner for real: the guard has released.
    h.next({ pathname: '/' });
    expect(h.replace).toHaveBeenCalledWith('/(tabs)/home');
  });

  it('still falls through to Home when the link opened nothing', () => {
    const h = harness();
    h.navigate.mockReturnValue('ignored');

    h.next({ isLoading: false, isAuthenticated: true, pendingDeepLink: '/route-nobody-has/1' });
    expect(h.navigate).toHaveBeenCalledTimes(1);

    h.next({ pendingDeepLink: null, pathname: '/' });
    expect(h.replace).toHaveBeenCalledWith('/(tabs)/home');
  });

  it('replaces to Home once on a plain cold start, not again on the stale render', () => {
    const h = harness();

    h.next({ isLoading: false, isAuthenticated: true });
    expect(h.replace).toHaveBeenCalledTimes(1);
    expect(h.replace).toHaveBeenCalledWith('/(tabs)/home');

    // Re-render with everything unchanged except a new object identity (what a provider
    // update does) while usePathname() has not moved off '/' yet.
    h.next({});
    expect(h.replace).toHaveBeenCalledTimes(1);
  });

  it('sends a signed-out member to login and clears nothing it did not queue', () => {
    const h = harness();

    h.next({ isLoading: false, isAuthenticated: false, pathname: '/messages' });
    expect(h.replace).toHaveBeenCalledWith('/(auth)/login');
    expect(h.navigate).not.toHaveBeenCalled();
  });
});

const mockCaptureMessage = jest.fn();
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: jest.fn(),
}));
jest.mock('@/lib/storage', () => ({
  storage: { get: jest.fn().mockResolvedValue(null), set: jest.fn(), remove: jest.fn() },
}));

import { pushLanding } from '@/lib/observability/pushTrail';

describe('useAuthRedirectEffect push trail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pushLanding.current = null;
  });

  it('reports a push tap that ends on Home instead of its screen', () => {
    const h = harness();
    h.next({ isLoading: false, isAuthenticated: true, pendingDeepLink: '/messages/7' });
    expect(pushLanding.current).toEqual(expect.objectContaining({ link: '/messages/7', from: '/' }));

    h.next({ pendingDeepLink: null, pathname: '/' });
    h.next({ pathname: '/home' });

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage.mock.calls[0][0]).toContain('landed on Home');
  });

  it('expects no landing for a link that opened nothing', () => {
    const h = harness();
    h.navigate.mockReturnValue('ignored');
    h.next({ isLoading: false, isAuthenticated: true, pendingDeepLink: '/route-nobody-has/1' });

    expect(pushLanding.current).toBeNull();
  });
});
