// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The accent colours a member can pick for themselves, in one place (warmth
 * plan Phase 4 D3). Settings → Appearance and the theme picker in the top bar
 * used to keep two copies of this list.
 *
 * `swatchClass` is written out in full so Tailwind generates it.
 */
export interface AccentPreset {
  name: string;
  hex: string;
  swatchClass: string;
}

/**
 * The stored accent that means "the member has not picked a colour of their
 * own" — the first preset. ThemeContext recognises it (`baseAccent`) and shows
 * the community's colour instead, when the community has one.
 */
export const STANDARD_ACCENT_HEX = '#6366f1';

/**
 * How a swatch is painted. Every preset shows its own colour, except the first
 * in a community that has its own colour: picking that one hands the site back
 * to the community's colour, so it is painted in that colour and
 * `followsCommunity` is true (label it as the community's colour, not "indigo").
 * Without this the picker ticked an indigo swatch on a site that was plainly
 * the community's pink.
 */
export function swatchFor(
  preset: AccentPreset,
  communityAccent: string | null | undefined,
): { colour: string; followsCommunity: boolean } {
  if (communityAccent && preset.hex === STANDARD_ACCENT_HEX) {
    return { colour: communityAccent, followsCommunity: true };
  }
  return { colour: preset.hex, followsCommunity: false };
}

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { name: 'indigo', hex: STANDARD_ACCENT_HEX, swatchClass: 'bg-[#6366f1] ring-[#6366f1]' },
  { name: 'purple', hex: '#a855f7', swatchClass: 'bg-[#a855f7] ring-[#a855f7]' },
  { name: 'blue', hex: '#3b82f6', swatchClass: 'bg-[#3b82f6] ring-[#3b82f6]' },
  { name: 'teal', hex: '#14b8a6', swatchClass: 'bg-[#14b8a6] ring-[#14b8a6]' },
  { name: 'green', hex: '#22c55e', swatchClass: 'bg-[#22c55e] ring-[#22c55e]' },
  { name: 'amber', hex: '#f59e0b', swatchClass: 'bg-[#f59e0b] ring-[#f59e0b]' },
  { name: 'orange', hex: '#f97316', swatchClass: 'bg-[#f97316] ring-[#f97316]' },
  { name: 'rose', hex: '#f43f5e', swatchClass: 'bg-[#f43f5e] ring-[#f43f5e]' },
  { name: 'pink', hex: '#ec4899', swatchClass: 'bg-[#ec4899] ring-[#ec4899]' },
  { name: 'cyan', hex: '#06b6d4', swatchClass: 'bg-[#06b6d4] ring-[#06b6d4]' },
];
