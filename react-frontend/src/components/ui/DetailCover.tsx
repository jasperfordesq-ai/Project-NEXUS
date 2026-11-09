// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { colourForSeed } from '@/lib/categoryColours';

interface DetailCoverProps {
  /** From `coverSeed` (lib/coverSeeds.ts), so the page matches the item's card. */
  seed: string;
  /** What the item is (a course, a podcast…). */
  icon: LucideIcon;
  /** The item's own picture; when set it is shown instead of the cover. */
  imageUrl?: string | null;
  /** Describes the picture. Leave empty when the page's title already says it. */
  imageAlt?: string;
  /** Height and corners. */
  className?: string;
  'data-testid'?: string;
}

/**
 * The band at the top of an item's page: its picture, or — when it has none —
 * a cover in the item's own colour from the community palette, the same
 * colour as its card (AWID feedback, Nov 2026: "attractive visuals"; item
 * pages opened with plain text). The cover is decoration, so screen readers
 * skip it.
 */
export function DetailCover({
  seed,
  icon,
  imageUrl,
  imageAlt = '',
  className = 'h-28 rounded-2xl sm:h-40',
  'data-testid': testId,
}: DetailCoverProps) {
  const palette = useSitePalette();
  return (
    <div className={`group relative w-full overflow-hidden ${className}`}>
      {imageUrl ? (
        <img src={imageUrl} alt={imageAlt} className="h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <ThemedCover data-testid={testId} colour={colourForSeed(seed, palette)} icon={icon} />
      )}
    </div>
  );
}

export default DetailCover;
