// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Text, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Chip, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { type Member } from '@/lib/api/members';
import Avatar from '@/components/ui/Avatar';
import VerificationBadgeRow from '@/components/verification/VerificationBadgeRow';
import NativePressable from '@/components/ui/NativePressable';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

interface MemberCardProps {
  member: Member;
}

export default function MemberCard({ member }: MemberCardProps) {
  const { t } = useTranslation(['members', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();

  const displayName = member.name?.trim() ||
    [member.first_name, member.last_name].filter(Boolean).join(' ') ||
    t('common:labels.member');
  const totalExchanged = (member.total_hours_given ?? 0) + (member.total_hours_received ?? 0);

  return (
    <NativePressable
      className="mx-4 my-1.5"
      onPress={() => {
        router.push({ pathname: '/(modals)/member-profile', params: { id: String(member.id) } });
      }}
      accessibilityLabel={t('memberCard.accessibilityLabel', { name: displayName })}
      feedback="highlight"
    >
      <HeroCard
        variant="default"
        className="w-full overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-3 p-4 pl-5">
          <View className="flex-row items-start gap-3">
            <View
              className="rounded-full p-1"
              style={{ backgroundColor: withAlpha(primary, 0.1), borderColor: withAlpha(primary, 0.18), borderWidth: 1 }}
            >
              {/* Decorative: the card is already labelled with this member's name. */}
              <Avatar uri={member.avatar ?? member.avatar_url ?? null} name={displayName} size={56} decorative />
            </View>
            <View className="min-w-0 flex-1 gap-2">
              <View className="flex-row items-start justify-between gap-2">
                <Text className="min-w-0 flex-1 text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>
                  {displayName}
                </Text>
                <Ionicons name="chevron-forward" size={17} color={theme.textMuted} />
              </View>

              <View className="flex-row">
                <VerificationBadgeRow userId={member.id} showUnverified />
              </View>

              {member.tagline ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                  {member.tagline}
                </Text>
              ) : (
                <Text className="text-sm leading-5" style={{ color: theme.textMuted }} numberOfLines={2}>
                  {t('memberCard.noTagline')}
                </Text>
              )}

              <View className="flex-row flex-wrap gap-2">
                {member.location ? (
                  <Surface variant="secondary" className="max-w-full flex-row items-center gap-1 rounded-full px-3 py-1.5">
                    <Ionicons name="location-outline" size={13} color={theme.textMuted} />
                    <Text className="max-w-[190px] text-xs font-medium" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {member.location}
                    </Text>
                  </Surface>
                ) : null}
                {member.rating != null ? (
                  <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                    <Ionicons name="star" size={13} color={theme.warning} />
                    <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>
                      {member.rating.toFixed(1)}
                    </Text>
                  </Surface>
                ) : null}
              </View>
            </View>
          </View>

          <View
            className="flex-row flex-wrap gap-2 rounded-2xl px-3 py-2"
            style={{ backgroundColor: withAlpha(primary, 0.06), borderColor: withAlpha(primary, 0.12), borderWidth: 1 }}
          >
            <Chip size="sm" variant="soft" color="default">
              <Ionicons name="arrow-up-outline" size={12} color={primary} />
              <Chip.Label>{t('hoursGivenShort', { count: Math.round(member.total_hours_given ?? 0) })}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="soft" color="default">
              <Ionicons name="swap-horizontal-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{t('hoursTotalShort', { count: Math.round(totalExchanged) })}</Chip.Label>
            </Chip>
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}
