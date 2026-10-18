// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The trail a push tap leaves behind: tap → redirect decision → navigation issued, as
 * Sentry breadcrumbs, plus a detector that names the one failure the owner reported on
 * 2026-10-18 — a tap that ends on Home instead of its screen. Until this existed, that
 * failure was indistinguishable in Sentry from a tap that did nothing.
 *
 * Only `safeLinkSummary` output is recorded (`/messages`, never the id).
 */

import { mapSystemPathToNativeRoute } from '@/app/+native-intent';
import type { AuthRedirect } from '@/lib/navigation/authRedirect';
import type { NavigateToLinkResult } from '@/lib/utils/navigateToLink';
import { reportBreadcrumb, reportMessage, safeLinkSummary } from './report';

export function recordPushTap(tap: { source: 'launch' | 'listener'; type: string; link: string | null }): void {
  reportBreadcrumb('push', 'tap', {
    source: tap.source,
    type: tap.type,
    link: tap.link ? safeLinkSummary(tap.link) : 'none',
  });
}

export function recordRedirectDecision(decision: AuthRedirect, pathname: string): void {
  reportBreadcrumb('push', 'redirect-decision', {
    action: decision.action,
    pathname,
    target: decision.action === 'deep-link'
      ? safeLinkSummary(decision.url)
      : decision.action === 'replace'
        ? decision.href
        : decision.reason,
  });
}

export function recordNavigationIssued(result: NavigateToLinkResult, link: string, pathname: string): void {
  reportBreadcrumb('push', 'navigation-issued', {
    result,
    link: safeLinkSummary(link),
    from: pathname,
  });
}

export interface PushLandingExpectation {
  link: string;
  issuedAt: number;
  from: string;
}

/** How long after a push navigation a landing on Home still counts as that tap's. */
export const PUSH_LANDING_WINDOW_MS = 3_000;

/** Pure, so the rule itself is testable: did the tap for `link` just end on Home? */
export function didPushTapLandOnHome(
  expectation: PushLandingExpectation | null,
  pathname: string,
  now: number,
): boolean {
  if (!expectation) return false;
  if (now - expectation.issuedAt > PUSH_LANDING_WINDOW_MS) return false;
  if (pathname !== '/home') return false;
  return mapSystemPathToNativeRoute(expectation.link) !== '/(tabs)/home';
}

export const pushLanding = {
  current: null as PushLandingExpectation | null,

  /** A push navigation was just issued for `link` while on `from`. */
  expect(link: string, from: string): void {
    this.current = { link, issuedAt: Date.now(), from };
  },

  /** Called on every pathname change. Reports once, then forgets. */
  observe(pathname: string): void {
    const expectation = this.current;
    if (!expectation) return;
    if (didPushTapLandOnHome(expectation, pathname, Date.now())) {
      this.current = null;
      reportMessage(
        '[Push] Tap landed on Home instead of its destination',
        { link: safeLinkSummary(expectation.link), from: expectation.from },
        'push-tap-landed-home',
      );
      return;
    }
    if (pathname !== expectation.from) {
      this.current = null;
    }
  },
};
