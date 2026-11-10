// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { colourForSeed } from '@/lib/categoryColours';

interface ImagePlaceholderProps {
  /** Lucide icon to display in center */
  icon?: LucideIcon;
  /** Height variant */
  size?: 'sm' | 'md' | 'lg';
  /** Additional CSS classes on the outer container */
  className?: string;
  /**
   * Something stable about the item (its id), so each item keeps its own
   * colour and neighbours differ. Without one, the site colour's own family.
   */
  seed?: string | number;
  /** A colour name to use instead (a theme's colour). */
  colour?: string;
}

/**
 * Placeholder for cards/pages without an uploaded image: a soft cover in a
 * colour from the site palette (`ThemedCover`), so it follows the community
 * colour in light and dark mode. Until Nov 2026 this was the fixed brand
 * gradient (indigo → purple → cyan) whatever the community's colour.
 */
export function ImagePlaceholder({
  icon: Icon = ShoppingBag,
  size = 'md',
  className = '',
  seed,
  colour,
}: ImagePlaceholderProps) {
  const palette = useSitePalette();
  const chosen = colour ?? (seed !== undefined ? colourForSeed(seed, palette) : palette[0]!);
  const heightClass = {
    sm: 'h-36',
    md: 'h-48 sm:h-56',
    lg: 'h-56 sm:h-72',
  }[size];

  return (
    <div className={`relative ${heightClass} w-full overflow-hidden ${className}`} aria-hidden="true">
      {/* Even the small placeholder is 9rem tall, so it keeps the medium icon. */}
      <ThemedCover colour={chosen} icon={Icon} size={size === 'lg' ? 'lg' : 'md'} seed={seed} />
    </div>
  );
}
