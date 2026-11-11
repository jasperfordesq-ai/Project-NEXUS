// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Ready-made looks a community admin can choose (warmth plan Phase 4 D1).
 *
 * A look is three things that go together: the community colour (one of the
 * suggested colours, each readable on white at 4.5:1), a companion colour for
 * gradients and glows, and how round the corners are. The server stores only
 * the look's name (configuration.community_look) and checks it against the
 * same list (app/Support/CommunityLook.php) — keep the two in step.
 *
 * Corners set HeroUI's own `--radius` and the site's radius scale (see
 * CORNER_TOKENS), so fields, buttons, boxes and cards all follow.
 */
export type CornerStyle = 'soft' | 'round' | 'square';

export interface CommunityLook {
  id: string;
  /** The community colour that comes with it (#rrggbb). */
  colour: string;
  /** Companion colour name (a `companionPaint` name). */
  companion: string;
  corners: CornerStyle;
}

export const COMMUNITY_LOOKS: readonly CommunityLook[] = [
  { id: 'harbour', colour: '#1d4ed8', companion: 'teal', corners: 'soft' },
  { id: 'meadow', colour: '#15803d', companion: 'amber', corners: 'round' },
  { id: 'hearth', colour: '#b3441e', companion: 'amber', corners: 'round' },
  { id: 'heather', colour: '#6d28d9', companion: 'pink', corners: 'soft' },
  { id: 'berry', colour: '#a3195b', companion: 'orange', corners: 'round' },
  { id: 'slate', colour: '#334155', companion: 'sky', corners: 'square' },
];

/**
 * The corner settings each style writes onto the page; null leaves the
 * site's own values. `--radius` is HeroUI's base (fields, menus); the
 * `--radius-*` values are the site's own scale behind Tailwind's
 * rounded-sm/md/lg/xl (buttons and most boxes) and `--radius-card` the cards.
 * "Soft" is the site as it already is.
 */
export const CORNER_TOKENS: Record<CornerStyle, Record<string, string> | null> = {
  soft: null,
  round: {
    '--radius': '0.875rem',
    '--radius-sm': '12px',
    '--radius-md': '16px',
    '--radius-lg': '20px',
    '--radius-xl': '28px',
    '--radius-card': '24px',
  },
  square: {
    '--radius': '0.25rem',
    '--radius-sm': '4px',
    '--radius-md': '6px',
    '--radius-lg': '8px',
    '--radius-xl': '12px',
    '--radius-card': '10px',
  },
};

/** Every property a corner style may set, so switching back clears them all. */
export const CORNER_TOKEN_NAMES = ['--radius', '--radius-sm', '--radius-md', '--radius-lg', '--radius-xl', '--radius-card'] as const;

/** The look with this name, or null. Only our own names are accepted. */
export function findCommunityLook(id: unknown): CommunityLook | null {
  if (typeof id !== 'string') return null;
  const key = id.trim().toLowerCase();
  return COMMUNITY_LOOKS.find((look) => look.id === key) ?? null;
}
