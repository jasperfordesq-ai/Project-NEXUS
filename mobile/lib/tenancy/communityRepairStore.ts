// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// ---------------------------------------------------------------------------
// COMMUNITY REPAIR STATE
//
// One flag, shared between the thing that repairs a wrong community and the thing that
// apologises for one.
//
// 🔴 Why this exists. Two separate pieces of the app react to the same broken state:
// `AuthContext` puts it right (lib/tenancy/signInTenant.ts), and the API client's
// `TENANT_MISMATCH` handler tells the member and opens the community picker
// (lib/navigation/tenantMismatch.ts). At launch they race — the repair reads the cached
// profile while the first screens are already firing requests that get refused — and
// without this flag a member would be shown "you are signed in to a different community,
// choose yours below" at the very moment the app was silently choosing it for them. A
// warning that contradicts what the app is doing is worse than either behaviour alone.
//
// 🔴 Deliberately NOT React state and NOT a context. Both readers are outside any provider
// they share: one is a callback registered with the API client, the other a provider that
// renders standalone in tests. Same reasoning as `sessionNoticeStore` and `themeStore`.
//
// 🔴 A repair that FAILS clears the flag rather than latching. The apology is then correct
// again, and the next refusal opens the picker — which is exactly the outcome we want when
// the app could not fix it by itself.
// ---------------------------------------------------------------------------

let repairsInFlight = 0;

export const communityRepairStore = {
  /**
   * True while the app is actively moving itself to the right community.
   *
   * Counted rather than boolean: the launch check and a sign-in can in principle overlap,
   * and a plain flag would let whichever finished first declare the other finished too.
   */
  isRepairing(): boolean {
    return repairsInFlight > 0;
  },

  /**
   * Mark a repair as started. Returns the function that marks it finished — take that
   * rather than calling `end()`, so a repair can never accidentally close somebody else's.
   * Call the returned function in a `finally`: a repair that throws must not leave the
   * apology suppressed for the rest of the session.
   */
  begin(): () => void {
    repairsInFlight += 1;
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      repairsInFlight = Math.max(0, repairsInFlight - 1);
    };
  },

  /** Test-only reset so suites don't leak a stuck repair into one another. */
  __resetForTests(): void {
    repairsInFlight = 0;
  },
};
