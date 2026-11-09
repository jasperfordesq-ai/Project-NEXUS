// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import { categoryColour } from '@/lib/categoryColours';

interface ThemedCoverProps {
  /** Colour name from `categoryColours` (a theme's colour, or one from the site palette). */
  colour: string;
  /** Icon for what the card is (an offer, a group, a post…). Leave out for a plain cover band. */
  icon?: LucideIcon;
  /** Short text, usually the theme's name, shown in the top corner. */
  label?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  'data-testid'?: string;
}

const ICON_SIZE = { sm: 'h-7 w-7', md: 'h-10 w-10', lg: 'h-16 w-16' } as const;
const TILE_PADDING = { sm: 'p-2.5', md: 'p-4', lg: 'p-5' } as const;

/**
 * What a card or page shows in place of a photo: a soft gradient in a colour
 * that goes with the community colour, a faint dot texture, the theme's name
 * and an icon. Tailwind classes only (see `categoryColours`), with a light and
 * a dark variant for every colour. Decoration only — whatever it says is also
 * in the card's own text — so screen readers skip it.
 *
 * Put it in a sized box; it fills it. Inside an element with `group`, the icon
 * tilts gently when the card is hovered (not with reduced motion).
 */
export function ThemedCover({
  colour,
  icon: Icon,
  label,
  size = 'md',
  className = '',
  'data-testid': testId,
}: ThemedCoverProps) {
  const known = categoryColour(colour);
  const iconClass = `${ICON_SIZE[size]} shrink-0 opacity-80 transition-transform duration-500 motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110`;

  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      data-colour={colour}
      className={`relative isolate flex h-full w-full overflow-hidden ${known.cover} ${className}`}
    >
      {/* A faint dot texture in the cover's own colour. */}
      {/* Kept a whisper (owner, 9 Nov 2026: stronger, it read as "loads of
          white dots"), and fainter on dark, where the dots are light on dark. */}
      <div data-cover-texture className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] bg-[length:22px_22px] opacity-[0.05] dark:opacity-[0.035]" />
      {/* A soft light in the top corner. */}
      <div className="pointer-events-none absolute -end-10 -top-12 h-40 w-40 rounded-full bg-white/60 blur-3xl dark:bg-white/5" />

      {/* One layout for every card, so a grid lines up: the icon always in the
          centre on its frosted square, the label (if any) in the top corner. */}
      {Icon && (
        <div className="relative z-10 flex w-full items-center justify-center">
          <span data-cover-icon className={`rounded-2xl bg-white/55 ring-1 ring-white/60 backdrop-blur-sm dark:bg-white/5 dark:ring-white/10 ${TILE_PADDING[size]}`}>
            <Icon className={iconClass} aria-hidden="true" />
          </span>
        </div>
      )}
      {label && (
        <span className={`absolute start-0 top-0 z-20 m-3 max-w-[calc(100%-4.5rem)] truncate rounded-full bg-white/75 px-2.5 py-1 text-xs font-semibold shadow-sm ring-1 ring-black/5 backdrop-blur-sm dark:bg-black/30 dark:ring-white/10 ${size === 'lg' ? 'sm:m-5' : ''}`}>
          {label}
        </span>
      )}
    </div>
  );
}
