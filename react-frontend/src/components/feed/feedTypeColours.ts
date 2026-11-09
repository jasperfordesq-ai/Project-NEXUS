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
}

const COLOURS: Record<string, FeedTypeColour> = {
  listing: { label: 'bg-accent-soft text-accent-soft-foreground', dot: 'bg-accent' },
  event: {
    label: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    dot: 'bg-emerald-500',
  },
  poll: {
    label: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  goal: {
    label: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
    dot: 'bg-pink-500',
  },
  review: {
    label: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    dot: 'bg-yellow-500',
  },
  job: {
    label: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
    dot: 'bg-cyan-500',
  },
  challenge: {
    label: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  volunteer: {
    label: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    dot: 'bg-green-500',
  },
  volunteer_hours: {
    label: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    dot: 'bg-green-500',
  },
  blog: {
    label: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
    dot: 'bg-sky-500',
  },
  discussion: {
    label: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
  },
  resource: {
    label: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
    dot: 'bg-teal-500',
  },
  course: {
    label: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
  },
  podcast_show: {
    label: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    dot: 'bg-fuchsia-500',
  },
  podcast_episode: {
    label: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    dot: 'bg-violet-500',
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
