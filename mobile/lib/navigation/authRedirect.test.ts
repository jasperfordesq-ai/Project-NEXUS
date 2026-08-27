// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The start-up routing decision. Every branch here is a way to lock a member out
 * of the app or dump them on Home when they followed a link somewhere else, and
 * until this was extracted from `app/_layout.tsx` none of them had a test.
 */

import { decideAuthRedirect, isPublicAuthPath, isTenantSelectionPath } from './authRedirect';

const LOADING = {
  isLoading: true,
  isAuthenticated: false,
  hasSelectedTenant: false,
  pathname: '/',
  pendingDeepLink: null,
};

describe('while authentication is still resolving', () => {
  it('does nothing at all', () => {
    // Acting early bounces a signed-in member to login for the moment before their
    // token is read out of secure storage — a visible flash of the login screen on
    // every cold start.
    expect(decideAuthRedirect(LOADING)).toEqual({
      action: 'none',
      reason: 'auth is still resolving',
    });
  });

  it('does nothing even when a deep link is already queued', () => {
    expect(
      decideAuthRedirect({ ...LOADING, pendingDeepLink: 'nexus://members/7' }).action
    ).toBe('none');
  });
});

describe('signed in', () => {
  const signedIn = {
    isLoading: false,
    isAuthenticated: true,
    hasSelectedTenant: true,
    pendingDeepLink: null,
  };

  it('follows a queued deep link INSTEAD of going home', () => {
    // 🔴 The ordering is the whole point. The deep link used to be checked after the
    // redirect to Home, so `router.replace('/(tabs)/home')` won the race and a push
    // notification tap landed on Home rather than the thing it was about.
    expect(decideAuthRedirect({ ...signedIn, pathname: '/', pendingDeepLink: 'nexus://messages/3' })).toEqual({
      action: 'deep-link',
      url: 'nexus://messages/3',
    });
  });

  it('prefers the deep link even when sitting on a real route', () => {
    expect(
      decideAuthRedirect({ ...signedIn, pathname: '/members', pendingDeepLink: 'nexus://wallet' })
    ).toEqual({ action: 'deep-link', url: 'nexus://wallet' });
  });

  it('goes home from the root path', () => {
    expect(decideAuthRedirect({ ...signedIn, pathname: '/' })).toEqual({
      action: 'replace',
      href: '/(tabs)/home',
    });
  });

  it('goes home when a valid stored session exists even if tenant selection metadata is missing', () => {
    expect(decideAuthRedirect({ ...signedIn, hasSelectedTenant: false, pathname: '/' })).toEqual({
      action: 'replace',
      href: '/(tabs)/home',
    });
  });

  it.each(['/login', '/register', '/forgot-password', '/reset-password', '/verify-email'])(
    'goes home from the signed-out screen %s',
    (pathname) => {
      // A member who has just signed in must not be left looking at the login form.
      expect(decideAuthRedirect({ ...signedIn, pathname })).toEqual({
        action: 'replace',
        href: '/(tabs)/home',
      });
    }
  );

  it('STAYS on tenant selection, which a signed-in member reaches deliberately', () => {
    // Tenant selection is a public auth path so a signed-out member can reach it,
    // but a signed-in member standing on it is switching community on purpose.
    // Redirecting them home would make the community switcher impossible to use.
    expect(decideAuthRedirect({ ...signedIn, pathname: '/select-tenant' })).toEqual({
      action: 'none',
      reason: 'signed in on a real route — preserve it',
    });
  });

  it.each(['/members', '/messages', '/wallet', '/events/42', '/groups/9/discussions'])(
    'STAYS on the already-open route %s',
    (pathname) => {
      // Expo Router already holds the current path. Replacing here would make every
      // refreshed authenticated page look like Home.
      expect(decideAuthRedirect({ ...signedIn, pathname }).action).toBe('none');
    }
  );
});

describe('signed out', () => {
  const signedOut = {
    isLoading: false,
    isAuthenticated: false,
    hasSelectedTenant: true,
    pendingDeepLink: null,
  };

  it.each(['/members', '/wallet', '/', '/messages/3', '/legal-acceptance'])(
    'sends %s to login',
    (pathname) => {
      expect(decideAuthRedirect({ ...signedOut, pathname })).toEqual({
        action: 'replace',
        href: '/(auth)/login',
      });
    }
  );

  it.each([
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/verify-email',
    '/select-tenant',
  ])('leaves the public auth screen %s alone', (pathname) => {
    // Redirecting here would be a loop: login -> login -> login.
    expect(decideAuthRedirect({ ...signedOut, pathname })).toEqual({
      action: 'none',
      reason: 'signed out on a public auth route',
    });
  });

  it('ignores a queued deep link rather than opening a members-only screen', () => {
    // A push tap that arrives while signed out must not bypass the login gate.
    expect(
      decideAuthRedirect({ ...signedOut, pathname: '/members', pendingDeepLink: 'nexus://wallet' })
    ).toEqual({ action: 'replace', href: '/(auth)/login' });
  });
});

describe('first installation with no selected community', () => {
  const freshInstall = {
    isLoading: false,
    isAuthenticated: false,
    hasSelectedTenant: false,
    pendingDeepLink: null,
  };

  it.each(['/', '/login', '/register', '/members'])(
    'sends %s to the community picker before tenant-specific authentication',
    (pathname) => {
      expect(decideAuthRedirect({ ...freshInstall, pathname })).toEqual({
        action: 'replace',
        href: '/(auth)/select-tenant',
      });
    },
  );

  it('leaves the community picker in place', () => {
    expect(decideAuthRedirect({ ...freshInstall, pathname: '/select-tenant' })).toEqual({
      action: 'none',
      reason: 'fresh install is choosing a community',
    });
  });
});

describe('path classification', () => {
  it('matches a public path and its sub-paths', () => {
    expect(isPublicAuthPath('/login')).toBe(true);
    expect(isPublicAuthPath('/login/help')).toBe(true);
    expect(isPublicAuthPath('/reset-password/token-abc')).toBe(true);
  });

  it('does NOT match a different route that merely starts with the same letters', () => {
    // The guard is `=== base || startsWith(base + '/')`, not a bare `startsWith`.
    // A bare prefix test would treat `/login-help` or `/registered-members` as
    // public and leave them reachable while signed out.
    expect(isPublicAuthPath('/login-help')).toBe(false);
    expect(isPublicAuthPath('/registered-members')).toBe(false);
    expect(isPublicAuthPath('/verify-email-change')).toBe(false);
  });

  it('treats tenant selection as public but identifies it separately', () => {
    expect(isPublicAuthPath('/select-tenant')).toBe(true);
    expect(isTenantSelectionPath('/select-tenant')).toBe(true);
    expect(isTenantSelectionPath('/select-tenant/hour-timebank')).toBe(true);
    expect(isTenantSelectionPath('/login')).toBe(false);
  });

  it('treats an ordinary member route as private', () => {
    expect(isPublicAuthPath('/members')).toBe(false);
    expect(isPublicAuthPath('/')).toBe(false);
  });
});
