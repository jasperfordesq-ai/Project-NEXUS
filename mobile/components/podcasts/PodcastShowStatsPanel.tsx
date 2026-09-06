// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Creator-facing listen analytics for one show (studio panel).
 *
 * Native port of `react-frontend/src/components/podcasts/PodcastShowStatsPanel.tsx`.
 * Plain Views for the bars, exactly as the web panel uses plain Tailwind bars —
 * no charting library is pulled into the app bundle for four numbers and five
 * rows.
 */

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import { getPodcastShowStats, type PodcastShowStats } from '@/lib/api/podcasts';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

export default function PodcastShowStatsPanel({ showId }: { showId: number }) {
  const { t } = useTranslation('podcasts');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const [stats, setStats] = useState<PodcastShowStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPodcastShowStats(showId)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [showId]);

  // Analytics disabled for the community (or the request failed) — stay quiet
  // rather than showing a panel of zeroes that looks like a real measurement.
  if (!loading && (!stats || !stats.enabled)) return null;

  const totals = stats?.totals;
  const topEpisodes = (stats?.top_episodes ?? []).slice(0, 5);
  const maxListens = Math.max(1, ...topEpisodes.map((episode) => episode.listen_count ?? 0));

  const tiles: { key: string; value: string }[] = [
    { key: 'listens', value: String(totals?.listens ?? 0) },
    { key: 'unique_listeners', value: String(totals?.unique_listeners ?? 0) },
    { key: 'completion_rate', value: `${totals?.completion_rate ?? 0}%` },
    { key: 'subscribers', value: String(totals?.subscribers ?? 0) },
  ];

  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <Ionicons name="stats-chart-outline" size={18} color={primary} />
          <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('studio.stats.title')}</Text>
        </View>

        {loading ? (
          <View className="py-6">
            <LoadingSpinner />
          </View>
        ) : (
          <>
            <View className="flex-row flex-wrap gap-2">
              {tiles.map((tile) => (
                <View
                  key={tile.key}
                  className="min-w-[46%] flex-1 rounded-panel-inner px-3 py-2"
                  style={{ backgroundColor: withAlpha(primary, 0.08) }}
                >
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t(`studio.stats.${tile.key}`)}</Text>
                  <Text className="text-lg font-bold" style={{ color: theme.text }}>{tile.value}</Text>
                </View>
              ))}
            </View>

            {topEpisodes.length > 0 ? (
              <View className="gap-2">
                <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('studio.stats.top_episodes')}</Text>
                {topEpisodes.map((episode) => (
                  <View key={episode.id} className="gap-1">
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="min-w-0 flex-1 text-xs" style={{ color: theme.text }} numberOfLines={1}>{episode.title}</Text>
                      <Text className="text-xs" style={{ color: theme.textSecondary }}>
                        {t('studio.stats.listen_count', { count: episode.listen_count ?? 0 })}
                      </Text>
                    </View>
                    <View className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: theme.borderSubtle }}>
                      <View
                        className="h-full rounded-full"
                        style={{
                          backgroundColor: primary,
                          width: `${Math.max(4, ((episode.listen_count ?? 0) / maxListens) * 100)}%`,
                        }}
                      />
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {(stats?.listens_over_time?.length ?? 0) > 0 ? (
              <Text className="text-xs" style={{ color: theme.textSecondary }}>
                {t('studio.stats.last_days', { days: stats?.days ?? 30 })}
              </Text>
            ) : null}
          </>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}
