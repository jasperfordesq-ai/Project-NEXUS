// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The app's start-up routing decision, as a pure function.
 *
 * This logic decides, on every launch and every auth change, whether a member is
 * sent to login, to home, to a deep-linked screen, or left where they are. It is
 * the most consequential branch in the client — get it wrong and members are
 * either locked out of the app or dropped onto Home every time they follow a link
 * — and until now it lived inside a `useEffect` in `app/_layout.tsx`, which is
 * 759 lines wrapped in six providers and could not be tested at all.
 *
 * Extracting it changes no behaviour. What it changes is that the branches can be
 * enumerated and asserted, rather than reasoned about.
 *
 * 🔴 The helpers must NOT live under `app/`. Expo Router treats every file in that
 * directory as a route, so a helper module there becomes a navigable screen.
 */

/** Paths a signed-OUT member is allowed to sit on without being redirected. */
const PUBLIC_AUTH_PREFIXES = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
] as const;

const TENANT_SELECTION_PREFIX = '/select-tenant';

/** `/login` and `/login/anything`, but never `/login-help`. */
function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function isTenantSelectionPath(pathname: string): boolean {
  return matchesPath(pathname, TENANT_SELECTION_PREFIX);
}

/**
 * Tenant selection counts as a public auth path — a signed-out member must be able
 * to reach it — but it is deliberately NOT treated as "somewhere to redirect away
 * from" once signed in, because a signed-in member switching community is standing
 * on it on purpose.
 */
export function isPublicAuthPath(pathname: string): boolean {
  return (
    PUBLIC_AUTH_PREFIXES.some((base) => matchesPath(pathname, base)) ||
    isTenantSelectionPath(pathname)
  );
}

export type AuthRedirect =
  /** Stay put. Either auth is still resolving, or the current route is correct. */
  | { action: 'none'; reason: string }
  /** Follow a queued deep link (push tap, or a URL the app was opened with). */
  | { action: 'deep-link'; url: string }
  /** Replace the current route. */
  | { action: 'replace'; href: string };

export interface AuthRedirectInput {
  isLoading: boolean;
  isAuthenticated: boolean;
  /** False only when this installation has never chosen a community. */
  hasSelectedTenant: boolean;
  pathname: string;
  /** A link captured before auth resolved, if any. */
  pendingDeepLink: string | null;
}

/**
 * Decide where the app should go, given auth state and the current route.
 *
 * Order matters and is load-bearing:
 *
 *  1. While auth is resolving, do nothing. Acting early would bounce a signed-in
 *     member to login for the moment before their token is read from storage.
 *  2. A pending deep link beats everything else. It is checked BEFORE defaulting
 *     to Home specifically to avoid a race: `router.replace('/(tabs)/home')` used
 *     to fire before the deep-link effect could navigate, so a push notification
 *     tap landed on Home instead of the thing it was about.
 *  3. A signed-in member on `/` or on a signed-out screen goes Home.
 *  4. A signed-in member anywhere else STAYS. Expo Router already holds the route,
 *     and replacing here would make every refreshed page look like Home.
 *  5. A signed-out member is sent to login unless already on a public auth screen.
 */
export function decideAuthRedirect(input: AuthRedirectInput): AuthRedirect {
  const { isLoading, isAuthenticated, hasSelectedTenant, pathname, pendingDeepLink } = input;

  if (isLoading) {
    return { action: 'none', reason: 'auth is still resolving' };
  }

  if (isAuthenticated) {
    if (pendingDeepLink) {
      return { action: 'deep-link', url: pendingDeepLink };
    }

    const onSignedOutScreen = isPublicAuthPath(pathname) && !isTenantSelectionPath(pathname);
    if (pathname === '/' || onSignedOutScreen) {
      return { action: 'replace', href: '/(tabs)/home' };
    }

    return { action: 'none', reason: 'signed in on a real route — preserve it' };
  }

  if (!hasSelectedTenant) {
    if (isTenantSelectionPath(pathname)) {
      return { action: 'none', reason: 'fresh install is choosing a community' };
    }
    return { action: 'replace', href: '/(auth)/select-tenant' };
  }

  if (!isPublicAuthPath(pathname)) {
    return { action: 'replace', href: '/(auth)/login' };
  }

  return { action: 'none', reason: 'signed out on a public auth route' };
}
