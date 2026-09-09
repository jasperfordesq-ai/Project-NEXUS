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
 * 🔴 This is now the FALLBACK, not the first answer. The app repairs itself where it can —
 * at sign-in, and once per launch — by reading the community its own session belongs to and
 * moving there silently (lib/tenancy/signInTenant.ts). What reaches here is what that could
 * not fix: a member whose community is not in the public list, one whose cached profile is
 * too old to prove they are not a platform super admin, or a repair that failed. For those
 * the honest move is unchanged: say so, and open the community picker.
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
  /**
   * Is the app already putting this right by itself? `communityRepairStore.isRepairing`.
   *
   * 🔴 Without this the two race at launch. The repair reads the cached profile while the
   * first screens are already firing requests that get refused, so the member would be
   * told "choose your community below" at the exact moment the app was choosing it for
   * them. A warning that contradicts what the app is doing is worse than either alone.
   */
  isRepairInProgress: () => boolean;
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

      /*
        Deliberately does NOT consume the once-only guard. A repair can fail — the community
        list may be unreachable, or the community itself may not load — and when it does the
        next refusal must still be able to apologise and open the picker.

        🔴 The window closes when the repair finishes, not later, so a refusal that lands
        after that still opens the picker. That is today's behaviour and no worse. It is
        also rare in practice rather than by luck: the refusals in flight at launch come
        back in a single round-trip, while the repair spends two — the community list and
        then the new community's configuration — so they land inside the window.
      */
      if (deps.isRepairInProgress()) return;

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
