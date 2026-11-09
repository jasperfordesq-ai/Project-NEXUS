// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { colourForSeed } from '@/lib/categoryColours';

interface CoverTileProps {
  /** From `coverSeed` (lib/coverSeeds.ts): the same seed the item's page uses. */
  seed: string;
  icon: LucideIcon;
  /** The item's logo or picture; shown instead of the cover when set. */
  imageUrl?: string | null;
  /** The item's name, for the logo's description. */
  name: string;
  /** Size and corners, e.g. "h-12 w-12 rounded-2xl". */
  className: string;
  'data-testid'?: string;
}

/**
 * A small square for an item in a list — an organisation, a show — with its
 * logo, or, when it has none, a cover in the item's own colour: the same
 * colour as its page (`DetailCover`) and wherever else it appears. Was the
 * item's initials, coloured by its name, so list and page did not match.
 */
export function CoverTile({ seed, icon, imageUrl, name, className, 'data-testid': testId }: CoverTileProps) {
  const palette = useSitePalette();
  if (imageUrl) {
    return <Avatar name={name} src={imageUrl} className={`shrink-0 ${className}`} />;
  }
  return (
    <div className={`group shrink-0 overflow-hidden ${className}`}>
      <ThemedCover data-testid={testId} size="sm" colour={colourForSeed(seed, palette)} icon={icon} />
    </div>
  );
}

export default CoverTile;
