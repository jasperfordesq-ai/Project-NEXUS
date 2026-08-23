// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReactionSummaryRow — Facebook-style "👍❤️ Anna, Bob and 3 others" line for
 * feed cards (web ReactionSummary parity). Tapping opens the reactors sheet.
 */

import { Text, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';

import type { ReactionsSummary } from '@/lib/api/feed';
import NativePressable from '@/components/ui/NativePressable';
import { useTheme } from '@/lib/hooks/useTheme';
import { REACTION_EMOJI_MAP } from './ReactionBar';

export default function ReactionSummaryRow({
  reactions,
  primary,
  onPress,
}: {
  reactions: ReactionsSummary;
  primary: string;
  onPress: () => void;
}) {
  const { t } = useTranslation('home');
  const theme = useTheme();

  const total = reactions.total;
  if (!total) return null;

  // Top 3 emoji by count, mirroring web ReactionSummary
  const topEmojis = Object.entries(reactions.counts ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 3)
    .map(([type]) => type);

  const names = (reactions.top_reactors ?? [])
    .map((reactor) => reactor.name)
    .filter((name): name is string => Boolean(name));
  let label: string;
  if (names.length === 0) {
    label = t('stats.reactions', { count: total });
  } else if (total === 1) {
    label = names[0];
  } else if (total === 2 && names.length >= 2) {
    label = t('reaction.summaryTwo', { a: names[0], b: names[1] });
  } else {
    label = t('reaction.summaryMany', { name: names[0], count: total - 1 });
  }

  return (
    <NativePressable
      onPress={onPress}
      accessibilityLabel={t('reaction.viewReactors')}
      feedback="none"
      className="min-h-11 flex-row items-center gap-1.5 py-1"
    >
      <View className="flex-row items-center">
        {topEmojis.map((type, index) => (
          <View
            key={type}
            className="size-5 items-center justify-center rounded-full"
            style={{
              backgroundColor: theme.surface,
              marginLeft: index === 0 ? 0 : -4,
              zIndex: 3 - index,
              borderWidth: 1,
              borderColor: theme.borderSubtle,
            }}
          >
            {type === 'time_credit' ? (
              <Ionicons name="time-outline" size={12} color={primary} />
            ) : (
              <Text style={{ fontSize: 11 }}>{REACTION_EMOJI_MAP[type] ?? '👍'}</Text>
            )}
          </View>
        ))}
      </View>
      <Text className="min-w-0 flex-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {label}
      </Text>
    </NativePressable>
  );
}
