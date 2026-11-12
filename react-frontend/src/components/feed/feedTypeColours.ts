// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One colour per kind of feed post (AWID feedback, Nov 2026: "clear
 * categories"). The label on a feed card and the dot on its filter chip use
 * the same colour, so the filter row reads as a key to the feed, and each
 * colour matches the stripe across the top of that kind of card (FeedCard's
 * `accentGradient`).
 *
 * Offers and requests keep the community's own colour; every other kind has a
 * fixed hue so it means the same thing in every community.
 *
 * Labels are a pale tint with deep text in light mode (the -800 shade on the
 * -100 tint, 6:1 or better) and a dark tint with light text in dark mode (-300
 * on -500/15). Indigo and purple utilities are reserved for the brand (see
 * scripts/check-design-tokens.mjs), so neither appears here.
 *
 * Full class names are written out so Tailwind can find them.
 */

export interface FeedTypeColour {
  /** Classes for the small label on a feed card. */
  label: string;
  /** Background class for a filter chip's colour dot. */
  dot: string;
  /**
   * A picture tile filled with the kind's colour and a white picture, for the
   * VIVID colour strength (warmth phase 5) — see `kindTile`. The lightest
   * shade of the kind's own hue that carries white at 4.5:1 (measured in
   * feedTypeColours.test.ts; emerald/amber/teal/… need -700, rose/pink/blue/
   * violet/fuchsia -600). Left out where the kind wears the community colour.
   */
  solid?: string;
}

const COLOURS: Record<string, FeedTypeColour> = {
  listing: { label: 'bg-accent-soft text-accent-soft-foreground', dot: 'bg-accent' },
  event: {
    label: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    solid: 'bg-emerald-700 text-white',
  },
  poll: {
    label: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
    solid: 'bg-amber-700 text-white',
  },
  goal: {
    label: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
    dot: 'bg-pink-500',
    solid: 'bg-pink-600 text-white',
  },
  review: {
    label: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    dot: 'bg-yellow-500',
    solid: 'bg-yellow-700 text-white',
  },
  job: {
    label: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
    dot: 'bg-cyan-500',
    solid: 'bg-cyan-700 text-white',
  },
  challenge: {
    label: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
    solid: 'bg-violet-600 text-white',
  },
  volunteer: {
    label: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    dot: 'bg-green-500',
    solid: 'bg-green-700 text-white',
  },
  volunteer_hours: {
    label: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    dot: 'bg-green-500',
    solid: 'bg-green-700 text-white',
  },
  blog: {
    label: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
    dot: 'bg-sky-500',
    solid: 'bg-sky-700 text-white',
  },
  discussion: {
    label: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
    solid: 'bg-fuchsia-600 text-white',
  },
  resource: {
    label: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
    dot: 'bg-teal-500',
    solid: 'bg-teal-700 text-white',
  },
  course: {
    label: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
    solid: 'bg-violet-600 text-white',
  },
  podcast_show: {
    label: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
    solid: 'bg-fuchsia-600 text-white',
  },
  podcast_episode: {
    label: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
    solid: 'bg-violet-600 text-white',
  },
  // Kinds shown outside the feed (warmth plan W1, 10 Nov 2026): the sidebar,
  // notifications, Explore and federation pages read their colours from here,
  // so an event, a group or a member is the same colour everywhere.
  group: {
    label: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
    dot: 'bg-orange-500',
    solid: 'bg-orange-700 text-white',
  },
  member: {
    label: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
    dot: 'bg-rose-500',
    solid: 'bg-rose-600 text-white',
  },
  message: {
    label: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    dot: 'bg-blue-500',
    solid: 'bg-blue-600 text-white',
  },
  hours: {
    label: 'bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300',
    dot: 'bg-lime-500',
    solid: 'bg-lime-700 text-white',
  },
  exchange: {
    label: 'bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300',
    dot: 'bg-lime-500',
    solid: 'bg-lime-700 text-white',
  },
  // Volunteering organisations share volunteering's green.
  organisation: {
    label: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    dot: 'bg-green-500',
    solid: 'bg-green-700 text-white',
  },
  // Recognition shares reviews' yellow.
  achievement: {
    label: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    dot: 'bg-yellow-500',
    solid: 'bg-yellow-700 text-white',
  },
};

const NEUTRAL: FeedTypeColour = {
  label: 'bg-[var(--surface-elevated)] text-theme-secondary',
  dot: 'bg-[var(--border-default)]',
};

/** The colour for one kind of feed post (`FeedItem.type`). */
export function feedTypeColour(type: string): FeedTypeColour {
  return COLOURS[type] ?? NEUTRAL;
}

/** The colour for one kind of thing anywhere on the site — the same list as the feed's. */
export const kindColour = feedTypeColour;

/** The community's button shade with a white picture: 4.5:1 by construction (ThemeContext). */
const ACCENT_SOLID = 'bg-accent-strong text-white';

/**
 * Classes for a kind's picture tile (a form section's, a dashboard
 * shortcut's): the pale label colours, or — in a community that chose the
 * VIVID colour strength (`useSiteVivid()`) — the tile filled with the kind's
 * colour and the picture white. A kind with no fill of its own that carries
 * white (offers and requests, which wear the community colour, or an unknown
 * kind) uses the community's button shade instead.
 */
export function kindTile(kind: string, isVivid: boolean): string {
  const colour = feedTypeColour(kind);
  if (!isVivid) return colour.label;
  return colour.solid ?? ACCENT_SOLID;
}

/** Which kind of post each feed filter shows (FeedPage's filter keys). */
export const FEED_FILTER_KINDS: Record<string, string> = {
  listings: 'listing',
  events: 'event',
  polls: 'poll',
  goals: 'goal',
  jobs: 'job',
  challenges: 'challenge',
  volunteering: 'volunteer',
  blogs: 'blog',
  discussions: 'discussion',
};

/** The dot for a filter chip, or null for filters that are not one kind (All, Following, Saved, Posts). */
export function feedFilterDot(filter: string): string | null {
  const kind = FEED_FILTER_KINDS[filter];
  return kind ? feedTypeColour(kind).dot : null;
}
