// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import { kindTile } from '@/components/feed/feedTypeColours';
import { useSiteVivid } from '@/contexts/SiteAccentContext';

interface FormSectionHeadingProps {
  /** The section's picture. */
  icon: LucideIcon;
  /**
   * Which kind colour the icon tile takes (`kindColour()`): the same colours
   * the feed, the bell and the search box use, so a long form reads as a few
   * clearly separate steps instead of one grey column (warmth plan B6).
   */
  kind: string;
  title: string;
  hint?: string;
  /** Smaller type and tile, for forms shown inside a sheet. */
  compact?: boolean;
  /** Heading level; forms on their own page use h2 under the page's h1. */
  as?: 'h2' | 'h3';
}

/**
 * A form section's heading with a small coloured icon tile beside it.
 *
 * The tile uses the kind's label classes (deep text on a pale tint, 6:1 or
 * better in both themes), so the icon is readable in high contrast too. In a
 * community that chose the VIVID colour strength the tile is filled with the
 * kind's colour and the icon is white (`kindTile`: only a fill that carries
 * white at 4.5:1, else the community's button shade). The icon is
 * decoration: the heading text carries the meaning.
 */
export function FormSectionHeading({
  icon: Icon,
  kind,
  title,
  hint,
  compact = false,
  as: Heading = 'h2',
}: FormSectionHeadingProps) {
  const isVivid = useSiteVivid();
  return (
    <div className="flex items-start gap-3">
      <span
        aria-hidden="true"
        data-testid="form-section-icon"
        className={`flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-8 w-8' : 'h-10 w-10'} ${kindTile(kind, isVivid)}`}
      >
        <Icon className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
      <div className="min-w-0">
        <Heading className={`${compact ? 'text-base' : 'text-lg'} font-semibold text-theme-primary`}>{title}</Heading>
        {hint && <p className="mt-1 text-sm text-theme-muted">{hint}</p>}
      </div>
    </div>
  );
}

export default FormSectionHeading;
