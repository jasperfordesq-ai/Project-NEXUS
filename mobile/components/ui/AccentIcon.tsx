// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An Ionicon that sits on the accent fill and matches the label beside it.
 *
 * 🔴 Use this instead of `<Ionicons color="#fff" />` inside a primary button.
 *
 * HeroUI Native resolves a button's label colour from `--accent-foreground`, which
 * `scripts/generate-tenant-themes.mjs` computes per community: white on a dark brand
 * colour, near-black ink on a pale one. An icon cannot read that variable —
 * `lib/theme/nativeVectorIconStyling.test.ts` requires Ionicons to take a native `color`
 * prop — so 72 icons across 37 files simply hardcoded white.
 *
 * That was already broken before any theming work. A community whose brand colour is
 * yellow, mint or pale blue gets an INK label with a white icon beside it, at roughly
 * 1.4:1 against the fill — effectively invisible, on the primary action of every screen.
 * It only came to light while weighing up whether to lighten the accent for dark mode,
 * but it was never caused by that.
 *
 * A wrapper rather than a hook call in each screen: the hook would have to be placed
 * inside the correct component in 37 files, several of which define more than one, and a
 * misplaced hook is a runtime error rather than a compile one. One import per file and no
 * scope decisions is the safer trade.
 *
 * Guarded by `components/accentIconColour.test.ts`.
 */

import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

import { useAccentForeground } from '@/lib/theme/accentForeground';

type AccentIconProps = Omit<ComponentProps<typeof Ionicons>, 'color'>;

export default function AccentIcon(props: AccentIconProps) {
  const accentForeground = useAccentForeground();

  return <Ionicons {...props} color={accentForeground} />;
}
