// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { LucideIcon } from 'lucide-react';
import { categoryColour } from '@/lib/categoryColours';
import { useSiteVivid } from '@/contexts/SiteAccentContext';
import { vivid } from '@/lib/vivid';

interface ThemedCoverProps {
  /** Colour name from `categoryColours` (a theme's colour, or one from the site palette). */
  colour: string;
  /** Icon for what the card is (an offer, a group, a post…). Leave out for a plain cover band. */
  icon?: LucideIcon;
  /** Short text, usually the theme's name, shown in the top corner. */
  label?: string | null;
  size?: 'sm' | 'md' | 'lg';
  /**
   * The item the cover stands for (its id or `coverSeed`). Varies the way the
   * gradient runs and the corner of its soft light, the same every time for
   * the same item, so a grid of covers does not look stamped out. The icon
   * stays centred. Leave out for the usual look.
   */
  seed?: string | number;
  className?: string;
  'data-testid'?: string;
}

const ICON_SIZE = { sm: 'h-7 w-7', md: 'h-10 w-10', lg: 'h-16 w-16' } as const;
const TILE_PADDING = { sm: 'p-2.5', md: 'p-4', lg: 'p-5' } as const;

// The picture's square, the soft light and the label: frosted on the soft
// tint; on a vivid cover (the colour at full strength) the square and the
// label are solid, so neither the fill nor the light can reach the words or
// the picture (src/test/cover-label.contract.test.ts).
const ICON_TILE = {
  soft: 'bg-white/55 ring-1 ring-white/60 backdrop-blur-sm dark:bg-white/5 dark:ring-white/10',
  vivid: 'bg-surface shadow-sm',
} as const;
const LIGHT = { soft: 'bg-white/60 dark:bg-white/5', vivid: 'bg-white/25 dark:bg-white/5' } as const;
const LABEL = {
  soft: 'bg-white/75 ring-1 ring-black/5 backdrop-blur-sm dark:bg-black/30 dark:ring-white/10',
  // White under the vivid chip too, so the words are on solid ground even
  // before <html> is marked vivid.
  vivid: `bg-white ${vivid.chip}`,
} as const;

// Written out whole so Tailwind generates them. The first of each is the usual look.
const DIRECTIONS = ['bg-linear-to-br', 'bg-linear-to-bl', 'bg-linear-to-tr', 'bg-linear-to-tl'] as const;
const LIGHTS = ['-end-10 -top-12', '-start-10 -top-12', '-end-10 -bottom-12', '-start-10 -bottom-12'] as const;

// The faint texture laid over the gradient, in the cover's own colour. Dots
// were the only one; a page of covers now mixes four quiet textures (warmth
// plan P15). All stay a whisper — see the opacity where they are drawn.
const TEXTURES = [
  ['dots', 'bg-[radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] bg-[length:22px_22px]'],
  ['rings', 'bg-[radial-gradient(circle_at_center,transparent_0_9px,currentColor_9px_10px,transparent_10px)] bg-[length:30px_30px]'],
  ['lines', 'bg-[repeating-linear-gradient(45deg,currentColor_0_1px,transparent_1px_14px)]'],
  ['weave', 'bg-[repeating-linear-gradient(-45deg,currentColor_0_1px,transparent_1px_18px),repeating-linear-gradient(45deg,currentColor_0_1px,transparent_1px_18px)]'],
] as const;

/** A stable number for a seed; its parts pick the cover's direction, light and texture. */
function hashOf(seed: string | number): number {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * What a card or page shows in place of a photo: a soft gradient in a colour
 * that goes with the community colour, a faint dot texture, the theme's name
 * and an icon. Tailwind classes only (see `categoryColours`), with a light and
 * a dark variant for every colour. Decoration only — whatever it says is also
 * in the card's own text — so screen readers skip it.
 *
 * In a community that chose the VIVID colour strength (warmth phase 5) the
 * cover is its colour at full strength, and the label and the icon's square
 * are solid (see ICON_TILE / LABEL above).
 *
 * Put it in a sized box; it fills it. Inside an element with `group`, the icon
 * tilts gently when the card is hovered (not with reduced motion).
 */
export function ThemedCover({
  colour,
  icon: Icon,
  label,
  size = 'md',
  seed,
  className = '',
  'data-testid': testId,
}: ThemedCoverProps) {
  const strength = useSiteVivid() ? 'vivid' : 'soft';
  const known = categoryColour(colour);
  const hash = seed === undefined ? 0 : hashOf(seed);
  // 0–15: which direction (low 2 bits) and which light (next 2) — unchanged
  // from before textures, so every existing cover keeps its direction and light.
  const variant = hash % 16;
  const [textureName, textureClass] = TEXTURES[Math.floor(hash / 16) % TEXTURES.length]!;
  const cover = (strength === 'vivid' ? known.vividCover : known.cover).replace(DIRECTIONS[0], DIRECTIONS[variant % 4]!);
  const lightPlace = LIGHTS[Math.floor(variant / 4)]!;
  const iconClass = `${ICON_SIZE[size]} shrink-0 opacity-80 transition-transform duration-500 motion-safe:group-hover:-rotate-6 motion-safe:group-hover:scale-110`;

  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      data-colour={colour}
      className={`relative isolate flex h-full w-full overflow-hidden ${cover} ${className}`}
    >
      {/* A faint texture in the cover's own colour (one of four, by seed). */}
      {/* Kept a whisper (owner, 9 Nov 2026: stronger, it read as "loads of
          white dots"), and fainter on dark, where the dots are light on dark. */}
      <div data-cover-texture={textureName} className={`pointer-events-none absolute inset-0 ${textureClass} opacity-[0.05] dark:opacity-[0.035]`} />
      {/* A soft light in the top corner. */}
      <div data-cover-light className={`pointer-events-none absolute ${lightPlace} h-40 w-40 rounded-full blur-3xl ${LIGHT[strength]}`} />

      {/* One layout for every card, so a grid lines up: the icon always in the
          centre on its frosted square, the label (if any) in the top corner. */}
      {Icon && (
        <div className="relative z-10 flex w-full items-center justify-center">
          <span data-cover-icon className={`rounded-2xl ${ICON_TILE[strength]} ${TILE_PADDING[size]}`}>
            <Icon className={iconClass} aria-hidden="true" />
          </span>
        </div>
      )}
      {label && (
        <span className={`absolute start-0 top-0 z-20 m-3 max-w-[calc(100%-4.5rem)] truncate rounded-full px-2.5 py-1 text-xs font-semibold shadow-sm ${LABEL[strength]} ${size === 'lg' ? 'sm:m-5' : ''}`}>
          {label}
        </span>
      )}
    </div>
  );
}
