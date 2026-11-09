// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The dashboard's monthly highlight (AWID feedback, Nov 2026: "energy,
 * warmth, and community"): what the whole community has shared so far this
 * month — hours, new members, new offers and requests — from
 * GET /v2/community/this-month (totals only, no names). Three tiles in the
 * community's own palette.
 *
 * Leaves out any total still at zero, and shows nothing in a quiet month (a
 * row of zeros is discouraging, not warm) or when the totals cannot be loaded.
 */

import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import Clock from 'lucide-react/icons/clock';
import Gift from 'lucide-react/icons/gift';
import Sparkles from 'lucide-react/icons/sparkles';
import UserPlus from 'lucide-react/icons/user-plus';
import { GlassCard } from '@/components/ui/GlassCard';
import { useTenant } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { api } from '@/lib/api';
import { categoryColour } from '@/lib/categoryColours';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface MonthTotals {
  month: string;
  hours_shared: number;
  new_members: number;
  new_listings: number;
}

interface Tile {
  key: string;
  label: string;
  value: number;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>;
}

/** Tile columns on wider screens, by how many totals are shown. */
const GRID_COLUMNS: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };

export function CommunityMonthHighlight({ className = '' }: { className?: string }) {
  const { t } = useTranslation('dashboard');
  const { tenant, branding, hasModule } = useTenant();
  const palette = useSitePalette();
  const [totals, setTotals] = useState<MonthTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.get<MonthTotals>('/v2/community/this-month')
      .then((res) => {
        if (!cancelled && res.success && res.data) setTotals(res.data);
      })
      .catch((err) => logError('Community month highlight failed to load', err));
    return () => {
      cancelled = true;
    };
  }, []);

  const showListings = hasModule('listings');
  const tiles = useMemo<Tile[]>(() => {
    if (!totals) return [];
    return [
      { key: 'hours', label: t('month_highlight.hours'), value: totals.hours_shared, icon: Clock },
      { key: 'members', label: t('month_highlight.members'), value: totals.new_members, icon: UserPlus },
      ...(showListings
        ? [{ key: 'listings', label: t('month_highlight.listings'), value: totals.new_listings, icon: Gift }]
        : []),
      // A total still at zero is left out: "0" reads as a scolding, not a welcome.
    ].filter((tile) => tile.value > 0);
  }, [totals, showListings, t]);

  if (!totals || tiles.length === 0) return null;

  const locale = getFormattingLocale();
  const [year, monthNumber] = totals.month.split('-').map(Number);
  const monthName = year && monthNumber
    ? new Date(year, monthNumber - 1, 1).toLocaleDateString(locale, { month: 'long' })
    : '';
  const community = branding?.name || tenant?.name || '';

  return (
    <GlassCard data-testid="community-month-highlight" className={`p-5 sm:p-6 ${className}`}>
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-accent" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-theme-primary">
          {t('month_highlight.title', { month: monthName, community })}
        </h2>
      </div>
      <p className="mt-1 text-sm text-theme-secondary">{t('month_highlight.subtitle')}</p>
      <dl className={`mt-4 grid grid-cols-1 gap-3 ${GRID_COLUMNS[tiles.length] ?? 'sm:grid-cols-3'}`}>
        {tiles.map((tile, i) => {
          const Icon = tile.icon;
          return (
            // <dt> and <dd> sit directly in this <div>, as a description list
            // requires (axe "definition-list"); the icon rides inside the <dt>,
            // placed beside both lines. The value reads above its label.
            <div
              key={tile.key}
              data-testid={`community-month-${tile.key}`}
              className={`relative flex min-h-[4.5rem] min-w-0 flex-col-reverse justify-center rounded-2xl p-4 ps-[4.25rem] ${categoryColour(palette[i % palette.length]).band}`}
            >
              <dt className="text-sm font-medium">
                <span className="absolute start-4 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-xl bg-white/60 dark:bg-white/10" aria-hidden="true">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                {tile.label}
              </dt>
              <dd className="text-2xl font-bold leading-tight">
                {tile.value.toLocaleString(locale, { maximumFractionDigits: 1 })}
              </dd>
            </div>
          );
        })}
      </dl>
    </GlassCard>
  );
}

export default CommunityMonthHighlight;
