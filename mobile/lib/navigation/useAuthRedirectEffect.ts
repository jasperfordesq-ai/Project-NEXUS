// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef } from 'react';
import {
  decideAuthRedirect,
  isSignedOutOnlyLink,
  isTenantSelectionPath,
  type AuthRedirectInput,
} from './authRedirect';
import { pendingRecoveryLinkStore } from './pendingRecoveryLinkStore';
import type { NavigateToLinkResult } from '@/lib/utils/navigateToLink';

export interface AuthRedirectEffectInput extends Omit<AuthRedirectInput, 'navigationIssuedForPathname'> {
  setPendingDeepLink: (link: string | null) => void;
  /** Follows a queued link; reports whether an in-app screen was actually opened. */
  navigate: (link: string) => NavigateToLinkResult;
  /** `router.replace` in the app. */
  replace: (href: string) => void;
  /** Runs once a deep link is followed after auth resolved (paid-campaign analytics). */
  onDeepLinkFollowed?: () => void;
}

/**
 * The root navigator's redirect, extracted from `app/_layout.tsx` so a sequence of
 * renders can be tested. `decideAuthRedirect` is the pure decision; this hook owns the
 * one piece of state the decision needs and the layout cannot supply: the pathname a
 * navigation was last issued from.
 *
 * 🔴 `usePathname()` lags one render behind React Navigation (expo-router updates it from
 * a post-commit `onStateChange`). The render after a deep-link push therefore still
 * reports the old pathname, and acting on it replaced the conversation a push tap had
 * just opened with Home. The ref below is cleared the moment the pathname actually
 * changes, so it can never suppress a redirect the member genuinely needs.
 */
export function useAuthRedirectEffect(input: AuthRedirectEffectInput): void {
  const {
    isLoading,
    isAuthenticated,
    onboardingCompleted,
    hasSelectedTenant,
    pathname,
    pendingDeepLink,
  } = input;

  const navigationIssuedForPathnameRef = useRef<string | null>(null);
  // Callbacks are read through a ref so an unstable callback identity cannot re-run the
  // effect — that re-run is exactly the stale render this hook exists to survive.
  const callbacksRef = useRef(input);
  callbacksRef.current = input;

  useEffect(() => {
    if (
      navigationIssuedForPathnameRef.current !== null
      && navigationIssuedForPathnameRef.current !== pathname
    ) {
      navigationIssuedForPathnameRef.current = null;
    }

    const decision = decideAuthRedirect({
      isLoading,
      isAuthenticated,
      onboardingCompleted,
      hasSelectedTenant,
      pathname,
      pendingDeepLink,
      navigationIssuedForPathname: navigationIssuedForPathnameRef.current,
    });
    const { setPendingDeepLink, navigate, replace, onDeepLinkFollowed } = callbacksRef.current;

    // Recovery links are deliberately ignored for an authenticated member. Clear the
    // first-run handoff too, otherwise it could be replayed much later if that member
    // signs out and opens the community picker.
    if (isAuthenticated && pendingDeepLink && isSignedOutOnlyLink(pendingDeepLink)) {
      pendingRecoveryLinkStore.clear();
      setPendingDeepLink(null);
      return;
    }

    // The picker finishes fresh-install setup and then consumes this link itself.
    // Leaving the root navigator idle here avoids a second navigation racing the
    // tenant write and clearing the handoff before the picker can use it.
    if (
      decision.action === 'deep-link'
      && isTenantSelectionPath(pathname)
      && isSignedOutOnlyLink(decision.url)
    ) {
      return;
    }

    if (decision.action === 'deep-link') {
      // Cleared before navigating so a re-render cannot follow the same link twice.
      setPendingDeepLink(null);
      onDeepLinkFollowed?.();
      const result = navigate(decision.url);
      if (result === 'navigated') {
        navigationIssuedForPathnameRef.current = pathname;
      }
      // 'external' / 'ignored': the app has no screen to show for the link, so the
      // next render falls through to Home exactly as before.
      return;
    }

    if (decision.action === 'replace') {
      navigationIssuedForPathnameRef.current = pathname;
      replace(decision.href);
    }
  }, [isLoading, isAuthenticated, onboardingCompleted, hasSelectedTenant, pathname, pendingDeepLink]);
}
