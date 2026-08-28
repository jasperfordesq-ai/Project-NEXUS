// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';

import type { EventAnalyticsSummary } from '@/lib/api/eventAnalytics';
import type { Theme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

type Translate = (key: string, options?: Record<string, unknown>) => string;

export function EventAnalyticsCard({
  summary,
  isLoading,
  error,
  onRefresh,
  primary,
  theme,
  t,
}: {
  summary: EventAnalyticsSummary | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  primary: string;
  theme: Theme;
  t: Translate;
}) {
  // Read here rather than threaded in as a prop: a prop can be handed a bare
  // language code, which formats as US English.
  const locale = dateLocale();
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const percent = (value: number | null, suppressed = false) => {
    if (suppressed) return t('analytics.suppressed');
    if (value === null) return '—';
    return new Intl.NumberFormat(locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    }).format(value / 10_000);
  };

  if (!summary && isLoading) {
    return (
      <Surface
        variant="secondary"
        className="flex-row items-center gap-2 rounded-xl px-4 py-3"
        accessibilityLiveRegion="polite"
        accessibilityLabel={t('analytics.loading')}
      >
        <Spinner size="sm" />
        <Text className="text-sm" style={{ color: theme.textSecondary }}>
          {t('analytics.loading')}
        </Text>
      </Surface>
    );
  }

  if (!summary && error) {
    return (
      <Surface variant="secondary" className="gap-2 rounded-xl px-4 py-3">
        <Text className="text-sm" style={{ color: theme.textSecondary }}>
          {t('analytics.load_error')}
        </Text>
        <HeroButton
          variant="secondary"
          size="sm"
          className="self-start"
          onPress={onRefresh}
          accessibilityLabel={t('analytics.retry')}
        >
          <Ionicons name="refresh-outline" size={16} color={primary} />
          <HeroButton.Label>{t('analytics.retry')}</HeroButton.Label>
        </HeroButton>
      </Surface>
    );
  }

  if (!summary) return null;

  const rows = [
    [t('analytics.metrics.confirmed'), number(summary.registration.confirmed)],
    [
      t('analytics.metrics.capacity_remaining'),
      summary.registration.remaining === null
        ? t('analytics.not_limited')
        : number(summary.registration.remaining),
    ],
    [t('analytics.metrics.waitlist_conversion'), percent(summary.waitlist.conversion.basis_points)],
    [t('analytics.metrics.attendance_rate'), percent(summary.attendance.attendance_rate.basis_points)],
    [t('analytics.metrics.no_show'), number(summary.attendance.no_show)],
    [t('analytics.metrics.delivered'), number(summary.communications.delivered)],
    [
      t('analytics.metrics.event_views'),
      summary.optional_funnel.event_views.suppressed
        ? t('analytics.suppressed')
        : number(summary.optional_funnel.event_views.value ?? 0),
    ],
    [
      t('analytics.metrics.start_conversion'),
      percent(
        summary.optional_funnel.start_to_registration_conversion.basis_points,
        summary.optional_funnel.start_to_registration_conversion.suppressed,
      ),
    ],
  ];

  return (
    <HeroCard variant="secondary">
      <HeroCard.Body className="gap-4 px-4 py-4">
        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-row items-center gap-2">
            <Ionicons name="bar-chart-outline" size={20} color={primary} />
            <Text className="text-base font-semibold" style={{ color: theme.text }}>
              {t('analytics.title')}
            </Text>
          </View>
          <Chip size="sm" variant="soft" color="accent">
            <Chip.Label>{t('analytics.consent_bound')}</Chip.Label>
          </Chip>
        </View>

        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
          {t('analytics.privacy_note', { count: summary.privacy_threshold })}
        </Text>

        <View
          className="overflow-hidden rounded-xl border"
          style={{ borderColor: theme.border }}
          accessibilityRole="summary"
        >
          {rows.map(([label, value], index) => (
            <View
              key={label}
              className="flex-row items-center justify-between gap-4 px-3 py-3"
              style={index === 0 ? undefined : { borderTopWidth: 1, borderTopColor: theme.border }}
            >
              <Text className="flex-1 text-sm" style={{ color: theme.textSecondary }}>{label}</Text>
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>{value}</Text>
            </View>
          ))}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}
