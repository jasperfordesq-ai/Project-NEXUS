// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A badge drawn as a medallion (warmth plan Phase 4 A4).
 *
 * Every badge used to be the same amber circle. Now:
 * - its colour comes from its kind (`type` / category), from the community's
 *   own palette, so badges of one kind match and different kinds differ;
 * - rarer badges get a ring — a soft one for rare, the companion colour for
 *   epic, and a community-to-companion gradient rim for legendary;
 * - a locked badge is shown in grey.
 * The emoji (or the medal icon when a badge has none) sits in the middle.
 */

import Medal from 'lucide-react/icons/medal';
import { categoryColour, colourForSeed } from '@/lib/categoryColours';
import { useSitePalette } from '@/contexts/SiteAccentContext';

export type BadgeRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

interface BadgeMedallionProps {
  icon?: string | null;
  /** Kind of badge (its type or category): decides the colour. */
  kind?: string | null;
  rarity?: string | null;
  earned?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}

const SIZES = {
  md: { box: 'size-14', emoji: 'text-2xl', icon: 'size-7' },
  lg: { box: 'size-24', emoji: 'text-5xl', icon: 'size-12' },
} as const;

export function BadgeMedallion({ icon, kind, rarity, earned = true, size = 'md', className = '' }: BadgeMedallionProps) {
  const palette = useSitePalette();
  const colour = categoryColour(colourForSeed(`badge-${kind ?? 'general'}`, palette));
  const s = SIZES[size];

  const face = (
    <span
      className={`flex ${s.box} items-center justify-center rounded-full shadow-inner ${
        earned ? colour.cover : 'bg-theme-elevated text-theme-subtle grayscale'
      }`}
    >
      {icon ? (
        <span className={`${s.emoji} leading-none`} aria-hidden="true">{icon}</span>
      ) : (
        <Medal className={s.icon} aria-hidden="true" />
      )}
    </span>
  );

  if (!earned || !rarity || rarity === 'common' || rarity === 'uncommon') {
    return <span className={`inline-flex rounded-full ${className}`}>{face}</span>;
  }

  if (rarity === 'legendary') {
    return (
      <span
        className={`inline-flex rounded-full bg-linear-to-br from-accent to-companion p-[3px] shadow-md ${className}`}
        data-rarity="legendary"
      >
        {face}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex rounded-full p-[2px] ${rarity === 'epic' ? 'bg-companion/70' : 'bg-accent/40'} ${className}`}
      data-rarity={rarity}
    >
      {face}
    </span>
  );
}

export default BadgeMedallion;
