// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo } from 'react';
import { useSiteAccent } from '@/contexts/SiteAccentContext';
import { mixHex } from '@/lib/colorContrast';

/** The standard colour, as painted on the light theme (ThemeContext). */
export const STANDARD_CONFETTI_ACCENT = '#5b5ede';

/**
 * Confetti in a community's colours: its own colour, a lighter shade of it,
 * and three warm companions (gold, green, pink) so a burst never reads as one
 * flat colour.
 *
 * One recipe for every celebration. Before 12 Nov 2026 a completed exchange,
 * a milestone and the welcome finish each carried a copy of it, and a new
 * badge and a finished goal still threw a fixed indigo and purple.
 */
export function confettiColoursFor(accent: string | null | undefined): string[] {
  const base = accent || STANDARD_CONFETTI_ACCENT;
  return [base, mixHex(base, '#ffffff', 0.45), '#f59e0b', '#22c55e', '#ec4899'];
}

/** Confetti colours for the colour the site is showing now. Never throws. */
export function useConfettiColours(): string[] {
  const accent = useSiteAccent();
  return useMemo(() => confettiColoursFor(accent), [accent]);
}
