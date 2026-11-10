// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "November in {community}" — what the whole community has shared so far this
 * month (AWID feedback, Nov 2026: "energy, warmth, and community"). The app's
 * copy of the website dashboard's `CommunityMonthHighlight`: the same request
 * (GET /v2/community/this-month, totals only, no names), the same rules, the
 * same words in every language.
 *
 *  - A total still at zero is left out: "0" reads as a scolding, not a welcome.
 *  - Nothing at all in a quiet month, or when the totals cannot be loaded.
 *  - New offers and requests only where the community has offers switched on.
 *  - Each figure on a tile in a colour from the community's palette; every one
 *    clears WCAG AA in light and dark (lib/theme/itemColours.contrast.test.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import { getCommunityThisMonth, type CommunityMonthTotals } from '@/lib/api/community';
import { useOptionalTenantContext } from '@/lib/context/TenantContext';
import { useTheme } from '@/lib/hooks/useTheme';
import { bandColours } from '@/lib/theme/itemColours';
import { useColourScheme, useItemPalette } from '@/lib/theme/useItemColours';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatDecimal } from '@/lib/utils/decimal';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Tile {
  key: 'hours' | 'members' | 'listings';
  label: string;
  value: number;
  icon: IoniconName;
}

interface Props {
  /** Change it to read the totals again (the Home tab's pull to refresh). */
  refreshKey?: number;
}

export default function CommunityMonthHighlight({ refreshKey = 0 }: Props) {
  const { t } = useTranslation('home');
  const theme = useTheme();
  const scheme = useColourScheme();
  const palette = useItemPalette();
  const tenantContext = useOptionalTenantContext();
  const tenant = tenantContext?.tenant ?? null;
  const [totals, setTotals] = useState<CommunityMonthTotals | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCommunityThisMonth()
      .then((response) => {
        if (!cancelled && response?.data && typeof response.data.month === 'string') setTotals(response.data);
      })
      .catch(() => {
        // Not shown when it cannot load; nothing else on Home depends on it.
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey, tenant?.id]);

  // Unknown configuration (cold start) shows offers, like every other gate in the app.
  const showListings = !tenant || tenantContext?.hasModule('listings') !== false;
  const tiles = useMemo<Tile[]>(() => {
    if (!totals) return [];
    const all: Tile[] = [
      { key: 'hours', label: t('monthHighlight.hours'), value: Number(totals.hours_shared) || 0, icon: 'time-outline' },
      { key: 'members', label: t('monthHighlight.members'), value: Number(totals.new_members) || 0, icon: 'person-add-outline' },
      ...(showListings
        ? [{ key: 'listings' as const, label: t('monthHighlight.listings'), value: Number(totals.new_listings) || 0, icon: 'gift-outline' as const }]
        : []),
    ];
    return all.filter((tile) => tile.value > 0);
  }, [totals, showListings, t]);

  if (!totals || tiles.length === 0) return null;

  const [year, monthNumber] = totals.month.split('-').map(Number);
  let monthName = '';
  if (year && monthNumber) {
    try {
      monthName = new Date(year, monthNumber - 1, 1).toLocaleDateString(dateLocale(), { month: 'long' });
    } catch {
      monthName = '';
    }
  }
  const title = t('monthHighlight.title', { month: monthName, community: tenant?.name ?? '' });

  return (
    <Surface
      variant="default"
      className="mx-3 mt-2 gap-3 rounded-panel px-4 py-4"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      testID="community-month-highlight"
    >
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Ionicons name="sparkles-outline" size={16} color={bandColours(palette[0], scheme).text} />
          <Text accessibilityRole="header" className="min-w-0 flex-1 text-base font-bold" style={{ color: theme.text }}>
            {title}
          </Text>
        </View>
        <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('monthHighlight.subtitle')}</Text>
      </View>
      <View className="flex-row flex-wrap gap-2">
        {tiles.map((tile, index) => {
          const band = bandColours(palette[index % palette.length], scheme);
          const value = formatDecimal(tile.value, 1);
          return (
            <View
              key={tile.key}
              testID={`community-month-${tile.key}`}
              accessible
              accessibilityLabel={`${value} ${tile.label}`}
              className="min-w-[30%] flex-1 gap-1 rounded-2xl px-3 py-3"
              style={{ backgroundColor: band.background, flexBasis: '30%' }}
            >
              <View
                className="size-8 items-center justify-center rounded-xl"
                style={{ backgroundColor: scheme === 'light' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(255, 255, 255, 0.1)' }}
              >
                <Ionicons name={tile.icon} size={16} color={band.text} />
              </View>
              <Text className="text-2xl font-bold" style={{ color: band.text }}>{value}</Text>
              <Text className="text-xs font-medium" style={{ color: band.text }}>{tile.label}</Text>
            </View>
          );
        })}
      </View>
    </Surface>
  );
}
