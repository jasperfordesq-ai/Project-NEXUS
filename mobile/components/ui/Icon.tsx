// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `Ionicons`, hidden from the accessibility tree by default.
 *
 * 🔴 A screen reader was announcing the raw icon glyph before every label.
 *
 * `@expo/vector-icons` renders an icon as a `<Text>` containing a private-use codepoint.
 * Android therefore puts it in the accessibility tree, and composes a parent control's
 * name from its children — so the Feed's tab control had
 * `content-desc="\uf58d, For You"`, and a screen-reader user hears an unmapped symbol
 * before every single label. Standalone decorative icons appear as their own swipe stops
 * with no meaning at all.
 *
 * Measured with TalkBack running on 2026-08-23: the home feed alone exposed the glyph in
 * the accessible name of every tab and filter chip.
 *
 * Every screen imports `Ionicons` from here instead of from `@expo/vector-icons`, so one
 * import line per file fixes every icon in it. Props spread AFTER the defaults, so an icon
 * that genuinely carries meaning can still opt back in with its own
 * `accessibilityLabel` / `importantForAccessibility`.
 *
 * Guarded by `components/ui/iconAccessibility.test.ts`.
 */

import ExpoIonicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

type IoniconsProps = ComponentProps<typeof ExpoIonicons>;

function DecorativeIonicons(props: IoniconsProps) {
  return <ExpoIonicons accessible={false} importantForAccessibility="no" {...props} />;
}

/**
 * `glyphMap` is re-exported because screens use `keyof typeof Ionicons.glyphMap` as the
 * type of an icon name.
 */
export const Ionicons = Object.assign(DecorativeIonicons, {
  glyphMap: ExpoIonicons.glyphMap,
});
