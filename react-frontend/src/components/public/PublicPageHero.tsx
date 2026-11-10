// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ReactNode } from 'react';
import Sparkles from 'lucide-react/icons/sparkles';
import { Chip } from '@/components/ui';
import { useCommunityAccent } from '@/contexts/ThemeContext';
import { FaceStack, type FaceStackPerson } from '@/components/ui/FaceStack';

interface PublicPageHeroStat {
  label: string;
  value: string;
}

interface PublicPageHeroProps {
  /** The small label above the title; leave it out when the page has nothing to say there. */
  eyebrow?: string;
  title: string;
  description?: string;
  icon: ReactNode;
  accent?: 'emerald' | 'indigo' | 'amber' | 'blue' | 'rose';
  action?: ReactNode;
  stats?: PublicPageHeroStat[];
  /**
   * 'full' opens a browsing page (offers, events, groups). 'compact' opens an
   * everyday tool page (messages, wallet, notifications): the same soft panel,
   * a smaller title, and its picture kept on phones.
   */
  size?: 'full' | 'compact';
  /**
   * A few of the people this page is about, shown as a row of faces under the
   * description (warmth plan P8): the newest members, people going to events,
   * members of groups. Pass only people the page already lists for this
   * viewer — the faces are decoration (hidden from screen readers) because
   * the same people are named on the page below.
   */
  people?: ReadonlyArray<FaceStackPerson>;
  /** An id for the heading, for a skip link or for moving focus to it. */
  headingId?: string;
  /**
   * The heading can receive focus (tabIndex -1, with a visible outline), for
   * pages that move focus to it when a section opens.
   */
  headingFocusable?: boolean;
}

const sizeClasses = {
  full: {
    section: 'px-5 py-6 sm:px-8 sm:py-8',
    layout: 'flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between',
    tile: 'hidden rounded-2xl bg-gradient-to-br p-3 shadow-sm sm:inline-flex',
    title: 'text-3xl font-bold tracking-tight text-theme-primary sm:text-4xl',
    description: 'mt-3 max-w-2xl text-base leading-7 text-theme-secondary',
  },
  // Slimmer on phones (warmth plan W7): an everyday page's opening took up to a
  // third of a phone screen. The small label above the title is left out there
  // (see `eyebrow` below); title, picture, description and buttons stay.
  compact: {
    section: 'px-4 py-4 sm:px-6 sm:py-5',
    layout: 'flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between',
    tile: 'inline-flex shrink-0 rounded-2xl bg-gradient-to-br p-2.5 shadow-sm',
    title: 'text-2xl font-bold tracking-tight text-theme-primary sm:text-3xl',
    description: 'mt-1 max-w-2xl text-sm leading-6 text-theme-secondary sm:text-base',
  },
} as const;

const accentClasses = {
  emerald: {
    icon: 'from-emerald-500/20 to-teal-500/20 text-emerald-500 dark:text-emerald-300',
    chipColor: 'success',
    chipText: 'text-emerald-800! dark:text-emerald-200!',
    panel: 'bg-emerald-500/10 dark:bg-emerald-500/15',
    glow: '[--glow-hue:var(--color-teal-500)] dark:[--glow-hue:var(--color-teal-400)]',
  },
  indigo: {
    icon: 'from-accent/20 to-companion/20 text-accent dark:text-accent',
    chipColor: 'accent',
    chipText: '',
    panel: 'bg-accent-soft',
    glow: '[--glow-hue:var(--companion)]',
  },
  amber: {
    icon: 'from-amber-500/20 to-orange-500/20 text-amber-500 dark:text-amber-300',
    chipColor: 'warning',
    chipText: 'text-amber-800! dark:text-amber-200!',
    panel: 'bg-amber-500/10 dark:bg-amber-500/15',
    glow: '[--glow-hue:var(--color-orange-500)] dark:[--glow-hue:var(--color-orange-400)]',
  },
  blue: {
    icon: 'from-blue-500/20 to-accent-gradient-end/20 text-blue-500 dark:text-blue-300',
    chipColor: 'accent',
    chipText: '',
    panel: 'bg-blue-500/10 dark:bg-blue-500/15',
    glow: '[--glow-hue:var(--color-violet-500)] dark:[--glow-hue:var(--color-violet-400)]',
  },
  rose: {
    icon: 'from-rose-500/20 to-fuchsia-500/20 text-rose-500 dark:text-rose-300',
    chipColor: 'danger',
    chipText: 'text-rose-800! dark:text-rose-200!',
    panel: 'bg-rose-500/10 dark:bg-rose-500/15',
    glow: '[--glow-hue:var(--color-fuchsia-500)] dark:[--glow-hue:var(--color-fuchsia-400)]',
  },
  // Used on every page once a community has chosen its own colour: HeroUI's
  // accent token only, so no fixed sky/cyan clashes with the community colour.
  community: {
    icon: 'from-accent/20 to-companion/20 text-accent dark:text-accent',
    chipColor: 'accent',
    chipText: '',
    panel: 'bg-accent-soft',
    glow: '[--glow-hue:var(--companion)]',
  },
} satisfies Record<string, {
  icon: string;
  chipColor: 'accent' | 'success' | 'warning' | 'danger';
  /**
   * The label's text, deepened where HeroUI's soft status chip falls short on
   * the tinted panel (danger soft was 4.2:1 on the rose panel — axe, 9 Nov 2026).
   */
  chipText: string;
  /** The panel's soft tint (light and dark). Text on it uses the darker secondary token. */
  panel: string;
  /**
   * The hue of the soft blurred glow in the panel's top corner: the colour that
   * goes with the panel's own (the community's companion colour once it has
   * chosen one) — warmth plan P1. `.hero-glow` (styles/glass.css) paints it
   * pale on the light theme and dim on the dark one, so a label that happens
   * to sit over it reads as well as it does on the plain panel.
   */
  glow: string;
}>;

export function PublicPageHero({
  eyebrow,
  title,
  description,
  icon,
  accent = 'indigo',
  action,
  stats,
  people,
  size = 'full',
  headingId,
  headingFocusable = false,
}: PublicPageHeroProps) {
  // Once a community has chosen its own colour, every page header uses it
  // instead of the page's own palette. Without a choice, each page keeps its
  // colour.
  const communityAccent = useCommunityAccent();
  const classes = accentClasses[communityAccent ? 'community' : accent];
  const sized = sizeClasses[size];

  return (
    // A soft panel in the page's colour — the community's once it has chosen
    // one — like the welcome panel on the offers page (AWID: warmer, more
    // inviting). Was a plain header with a thin coloured underline.
    <section
      data-public-page-hero="true"
      data-size={size}
      className={`relative overflow-hidden rounded-3xl ${sized.section} ${classes.panel}`}
    >
      <div
        aria-hidden="true"
        data-hero-glow="true"
        className={`hero-glow pointer-events-none absolute -right-16 -top-24 size-48 rounded-full blur-3xl sm:size-72 ${classes.glow}`}
      />
      <div className={`relative ${sized.layout}`}>
        <div className="min-w-0 max-w-3xl">
          {/* The icon goes in startContent, NOT in children: children are wrapped
              in <Chip.Label>, and Tailwind's reset makes an <svg> display:block,
              which broke the label onto a second line. As startContent it is a
              flex sibling of the label and centres against the text. */}
          {eyebrow && (
            <Chip
              color={classes.chipColor}
              size="sm"
              variant="soft"
              className={`${size === 'compact' ? 'mb-3 max-sm:hidden' : 'mb-4'} py-1 font-medium ${classes.chipText}`}
              startContent={<Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            >
              {eyebrow}
            </Chip>
          )}
          <div className={`flex gap-4 ${size === 'compact' ? 'items-center' : 'items-start'}`}>
            <div className={`${sized.tile} ${classes.icon}`}>
              {icon}
            </div>
            <div className="min-w-0">
              <h1
                id={headingId}
                tabIndex={headingFocusable ? -1 : undefined}
                className={headingFocusable
                  ? `${sized.title} scroll-mt-24 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4`
                  : sized.title}
              >
                {title}
              </h1>
              {description && (
                <p className={sized.description}>
                  {description}
                </p>
              )}
              {people && people.length > 0 && (
                <FaceStack
                  people={people}
                  max={5}
                  size="md"
                  data-testid="hero-face"
                  className={size === 'compact' ? 'mt-2' : 'mt-4'}
                />
              )}
            </div>
          </div>
        </div>
        {(action || stats?.length) && (
          <div className={`flex flex-col gap-3 sm:flex-row sm:items-center ${size === 'compact' ? 'sm:shrink-0' : 'lg:justify-end'}`}>
            {stats?.length ? (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                {stats.map((stat) => (
                  <div
                    key={`${stat.label}-${stat.value}`}
                    className="rounded-xl border border-theme-default bg-theme-elevated px-3 py-2 text-left shadow-sm"
                  >
                    <p className="text-lg font-bold leading-none text-theme-primary">{stat.value}</p>
                    <p className="mt-1 text-xs text-theme-subtle">{stat.label}</p>
                  </div>
                ))}
              </div>
            ) : null}
            {action}
          </div>
        )}
      </div>
    </section>
  );
}

interface PublicPageHeroStripProps {
  /** One short line: what this page is for. */
  text: string;
  icon: ReactNode;
  accent?: PublicPageHeroProps['accent'];
  /** A few of the people the page lists (see `people` on PublicPageHero). */
  people?: ReadonlyArray<FaceStackPerson>;
}

/**
 * The phone-sized opening for a browsing page (warmth plan P9). On a phone
 * those pages hide the full opening — the title lives in the app bar — which
 * left them starting cold on a search box. This is one slim band in the same
 * colour: the page's picture, one line of text, and a few faces. It carries no
 * heading: the page keeps its own (screen-reader) <h1>.
 */
export function PublicPageHeroStrip({ text, icon, accent = 'indigo', people }: PublicPageHeroStripProps) {
  const communityAccent = useCommunityAccent();
  const classes = accentClasses[communityAccent ? 'community' : accent];

  return (
    <div
      data-public-page-hero-strip="true"
      className={`relative flex items-center gap-3 overflow-hidden rounded-2xl px-3 py-2.5 ${classes.panel}`}
    >
      <div
        aria-hidden="true"
        className={`hero-glow pointer-events-none absolute -right-10 -top-16 size-32 rounded-full blur-2xl ${classes.glow}`}
      />
      <div className={`relative inline-flex shrink-0 rounded-xl bg-gradient-to-br p-2 [&_svg]:size-5 ${classes.icon}`}>
        {icon}
      </div>
      <p className="relative min-w-0 flex-1 text-sm leading-5 text-theme-secondary line-clamp-2">{text}</p>
      {people && people.length > 0 && (
        <FaceStack people={people} max={3} size="sm" data-testid="hero-strip-face" className="relative" />
      )}
    </div>
  );
}

export default PublicPageHero;
