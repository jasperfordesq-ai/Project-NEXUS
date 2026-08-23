// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A HeroUI Native `Chip` that only claims to be a control when it is one.
 *
 * 🔴 Every status chip in the app was announced to a screen reader as a button.
 *
 * `heroui-native`'s Chip renders a `Pressable` unconditionally
 * (`node_modules/heroui-native/src/components/chip/chip.tsx`), whether or not an
 * `onPress` was given. React Native reports a Pressable as clickable and focusable, so a
 * chip carrying pure information — "1 conversation", "0 unread", "3 results", "No pending
 * credits", a category, a date — reaches the accessibility tree as an actionable control
 * that does nothing when activated.
 *
 * Measured with TalkBack on 2026-08-23: of the interactive nodes on the home feed, wallet,
 * listings and messages screens, thirteen were chips with no action.
 *
 * This wrapper leaves an interactive chip exactly as it was, and gives a decorative one
 * `focusable={false}`, which is what actually works here — measured on a device, not
 * assumed:
 *
 *   • `accessible={false}` + `importantForAccessibility="no"` changed NOTHING. The node
 *     kept its `content-desc`, `clickable=true` and `focusable=true`.
 *   • `focusable={false}` alone flips the node to `clickable=false`, so it is no longer
 *     offered as something to activate, while keeping its `content-desc` so the text is
 *     still read out as information.
 *
 * 🔴 The first attempt was the obvious one and it silently did nothing. A `testID` probe
 * proved the props were reaching the view, which is the only reason the failure was
 * noticed rather than shipped as a fix.
 *
 * Guarded by `components/ui/statusChipAccessibility.test.tsx`.
 */

import { Chip as HeroChip } from 'heroui-native';
import type { ComponentProps } from 'react';

type ChipProps = ComponentProps<typeof HeroChip>;

/**
 * 🔴 WCAG 2.2 AA (2.5.8 Target Size Minimum) asks for 24x24. Measured on a device on
 * 2026-08-23 at 420dpi, `size="sm"` chips render **20dp tall** — so the Feed's five
 * filter chips (All / Following / Saved / Posts / Exchanges), which are real controls,
 * failed the minimum on the app's first screen. Applied only to interactive chips: a
 * decorative one is not a target and does not need the height.
 */
const MIN_TARGET_DP = 24;

function AccessibleChip(props: ChipProps) {
  const isInteractive = Boolean(props.onPress ?? props.onLongPress);
  if (isInteractive) {
    return (
      <HeroChip
        {...props}
        style={[{ minHeight: MIN_TARGET_DP }, props.style as never] as never}
      />
    );
  }
  return <HeroChip focusable={false} {...props} />;
}

export const Chip = Object.assign(AccessibleChip, {
  Label: HeroChip.Label,
});
