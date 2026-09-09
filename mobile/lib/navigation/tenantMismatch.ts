// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { isTenantSelectionPath } from '@/lib/navigation/authRedirect';

/**
 * What the app does when the server refuses a request with `TENANT_MISMATCH`.
 *
 * 🔴 The state: the bearer token was issued by one community and the request asked about
 * another, so `App\Core\TenantContext` answers **403 to everything** until one of the two
 * changes. Seen in the wild on 2026-09-09, release 1.4.0+7 — one member's unread count,
 * notification count and push-device registration were all refused inside a single second.
 * They were signed in, receiving no notifications, and being told nothing at all.
 *
 * 🔴 Retrying cannot clear it, and the app cannot quietly correct itself either: an account
 * belongs to ONE community, and the refusal does not say which one issued the token. The
 * only honest move is to say so and open the community picker.
 *
 * The picker genuinely works from this state, and that is not an accident — two earlier
 * pieces of work made it so. `GET /v2/tenants` is sent anonymously so the list still loads
 * when everything token-scoped is refused, and `decideAuthRedirect` exempts the
 * tenant-selection path from the signed-in bounce to home. This module is the missing third
 * piece: nothing was telling the member to go there.
 *
 * 🔴 It lives here, taking its dependencies as arguments, so the behaviour can be tested.
 * The root layout has no behavioural test — rendering it needs the whole provider tree —
 * and a guard that fires "once" is exactly the kind of thing that quietly stops working.
 * Same reasoning as `decideAuthRedirect`, which is a pure function for the same reason.
 */

export interface TenantMismatchDeps {
  /** Show the member what happened. `sessionNoticeStore.publish` in the app. */
  publish: (notice: { title: string; description: string; variant: 'warning' }) => void;
  /** Take them to the picker. `router.replace` in the app. */
  navigate: (href: string) => void;
  /** Translator, already bound to a namespace list that includes `common`. */
  t: (key: string) => string;
}

export interface TenantMismatchHandler {
  /** Call on every `TENANT_MISMATCH` refusal. Acts at most once until the member leaves. */
  onMismatch: () => void;
  /** Call whenever the route changes, so a later mismatch is acted on again. */
  onPathChange: (pathname: string) => void;
}

export const TENANT_PICKER_HREF = '/(auth)/select-tenant';

export function createTenantMismatchHandler(deps: TenantMismatchDeps): TenantMismatchHandler {
  let handled = false;

  return {
    onMismatch() {
      /*
        🔴 The guard is load-bearing, not tidiness. In this state EVERY request in flight
        fails the same way, so without it one app launch stacks a dozen copies of the
        picker on the navigation stack — the observed event had three refusals inside one
        second, and a busy launch has many more.
      */
      if (handled) return;
      handled = true;
      deps.publish({
        title: deps.t('common:errors.wrongCommunityTitle'),
        description: deps.t('common:errors.wrongCommunityBody'),
        variant: 'warning',
      });
      deps.navigate(TENANT_PICKER_HREF);
    },

    onPathChange(pathname: string) {
      // Re-arm only once they have actually left the picker. Clearing it while they are
      // still on it would let a refusal still in flight push a second copy.
      if (!isTenantSelectionPath(pathname)) {
        handled = false;
      }
    },
  };
}
