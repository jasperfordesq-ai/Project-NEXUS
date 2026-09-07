// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * The bottom safe-area inset measured at the ROOT of the app.
 *
 * Inside Android `presentation: 'modal'` screens, useSafeAreaInsets()
 * reports bottom: 0, so bottom sheets and form footers rendered in modal
 * routes sat underneath the system navigation bar. The root layout keeps
 * the real inset here; consumers take max(hookValue, root value).
 */
let rootBottomInset = 0;

/**
 * Record the bottom inset measured at the ROOT of the app.
 *
 * 🔴 Only `RootInsetRecorder` in `app/_layout.tsx` may call this, and it passes the live
 * root value on every render — so the latest reading is the truth and simply replaces the
 * last one. It used to be a ratchet that could only grow (audit 2026-09-06, F08). That
 * survived a real decrease: switching Android from 3-button to gesture navigation removes
 * the 48dp bar, but every modal went on reserving space for it until the process
 * restarted. The modal-reports-zero case this module exists for is handled where it
 * belongs — in `useBottomInset`, which floors the screen's own value with this one.
 */
export function setRootBottomInset(value: number): void {
  if (Number.isFinite(value) && value >= 0) {
    rootBottomInset = value;
  }
}

export function getRootBottomInset(): number {
  return rootBottomInset;
}

/**
 * The bottom inset a pinned control must clear, on ANY screen.
 *
 * 🔴 Use this — not `useSafeAreaInsets().bottom` — for anything that sits at the
 * bottom of a modal screen: action bars, composers, floating overlays, and the
 * `paddingBottom` a ScrollView reserves for them. On Android with 3-button
 * navigation the system bar is ~48dp tall and, since edge-to-edge, drawn OVER the
 * app; inside a `presentation: 'modal'` route the hook reports 0 for it. Owner's
 * report of 2026-09-05: the member-profile action bar ("Connect / Send credits /
 * Send Message") sat under the back / home / recents buttons. Ten screens had the
 * same fault; the eleven that used FormActionFooter did not, because it already
 * floored the hook value with the root-recorded inset. That floor now lives here.
 *
 * Also note `position: 'absolute'` children ignore a SafeAreaView's padding, so a
 * bar pinned with `bottom: 0` needs this even on screens where the hook is right.
 */
export function useBottomInset(): number {
  const insets = useSafeAreaInsets();
  return Math.max(0, insets.bottom, getRootBottomInset());
}
