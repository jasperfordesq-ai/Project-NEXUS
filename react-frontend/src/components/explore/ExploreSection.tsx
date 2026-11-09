// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ChevronRight from 'lucide-react/icons/chevron-right';
import type { LucideIcon } from 'lucide-react';
import { motion } from '@/lib/motion';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { categoryColour } from '@/lib/categoryColours';

interface ExploreSectionProps {
  title: string;
  subtitle?: string;
  seeAllLink?: string;
  seeAllLabel?: string;
  /** A small picture beside the heading (decoration). */
  icon?: LucideIcon;
  /** Which colour of the community palette the picture sits on. */
  colourIndex?: number;
  children: ReactNode;
  className?: string;
}

/**
 * Reusable section wrapper for the Explore page.
 * Provides consistent heading, optional subtitle, and "See All" link — and,
 * when given an icon, a small tile in a colour from the community's palette
 * beside the heading, so a long page of sections is easy to scan (AWID
 * feedback, Nov 2026: "clear categories, attractive visuals").
 */
export function ExploreSection({
  title,
  subtitle,
  seeAllLink,
  seeAllLabel,
  icon: Icon,
  colourIndex = 0,
  children,
  className = '',
}: ExploreSectionProps) {
  const { t } = useTranslation('explore');
  const resolvedSeeAllLabel = seeAllLabel ?? t('see_all');
  const palette = useSitePalette();
  const colour = palette[Math.abs(colourIndex) % palette.length] ?? 'slate';

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-50px' }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`mb-10 ${className}`}
    >
      <div className="flex items-end justify-between gap-3 mb-4">
        <div className="flex min-w-0 items-center gap-3">
          {Icon && (
            <span
              data-testid="explore-section-icon"
              data-colour={colour}
              aria-hidden="true"
              className={`flex size-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-black/5 dark:ring-white/10 ${categoryColour(colour).band}`}
            >
              <Icon className="size-5" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-[var(--text-primary)]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>
            )}
          </div>
        </div>
        {seeAllLink && (
          <Link
            to={seeAllLink}
            className="flex items-center gap-1 text-sm font-medium text-[var(--color-primary)] hover:underline shrink-0"
          >
            {resolvedSeeAllLabel}
            <ChevronRight className="w-4 h-4" />
          </Link>
        )}
      </div>
      {children}
    </motion.section>
  );
}
