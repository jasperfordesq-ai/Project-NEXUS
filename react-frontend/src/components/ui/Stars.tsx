// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Star from 'lucide-react/icons/star';
import { getFormattingLocale } from '@/lib/helpers';

interface StarsProps {
  /** The rating, usually 0–5. Rounded to the nearest whole star. */
  rating: number;
  max?: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /**
   * What a screen reader hears, e.g. "Rated 4 out of 5". Callers that already
   * have their own wording pass it here; otherwise a general one is used.
   */
  label?: string;
  className?: string;
}

const SIZES = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' } as const;

/**
 * A read-only row of stars (warmth plan B7).
 *
 * Replaces the hand-built `[1, 2, 3, 4, 5].map(<Star …/>)` rows that each page
 * coloured a little differently. One picture for screen readers (`role="img"`
 * with the rating as its name), so the five stars are not read one by one.
 * Filled stars carry an amber-600 outline so they stay visible on white (3:1
 * for a graphic); empty ones are outlines in the muted text colour.
 *
 * For choosing a rating use `ui/StarRating.tsx`, which is the input.
 */
export function Stars({ rating, max = 5, size = 'sm', label, className = '' }: StarsProps) {
  const { t } = useTranslation('common');
  const safe = Number.isFinite(rating) ? Math.max(0, Math.min(max, rating)) : 0;
  const filled = Math.round(safe);
  const name = label ?? t('stars.rating_label', {
    rating: safe.toLocaleString(getFormattingLocale(), { maximumFractionDigits: 1 }),
    max,
  });

  return (
    <span role="img" aria-label={name} data-testid="stars" className={`inline-flex items-center gap-0.5 ${className}`}>
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          aria-hidden="true"
          data-filled={i < filled ? 'true' : 'false'}
          className={`${SIZES[size]} ${
            i < filled
              ? 'fill-amber-400 text-amber-600 dark:text-amber-400'
              : 'text-theme-subtle'
          }`}
        />
      ))}
    </span>
  );
}

export default Stars;
