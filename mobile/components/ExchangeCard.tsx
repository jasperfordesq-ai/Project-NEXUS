// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatDecimal } from '@/lib/utils/decimal';
import { Text, View } from 'react-native';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Separator, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';

import { type Exchange } from '@/lib/api/exchanges';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { formatRelativeTime } from '@/lib/utils/formatRelativeTime';
import Avatar from '@/components/ui/Avatar';
import NativePressable from '@/components/ui/NativePressable';

interface ExchangeCardProps {
  exchange: Exchange;
  onToggleSave?: (listingId: number, currentlySaved: boolean) => void;
}

export default function ExchangeCard({ exchange, onToggleSave }: ExchangeCardProps) {
  const { t } = useTranslation('exchanges');
  const primary = usePrimaryColor();
  const theme = useTheme();

  function openDetail() {
    router.push({ pathname: '/(modals)/exchange-detail', params: { id: String(exchange.id) } });
  }

  const hours = exchange.hours_estimate ?? 0;
  /**
   * 🔴 The server sends `author_name` and `author_avatar` alongside the nested `user`, and
   * this card threw both away: when `user` was null it rendered a literal '?', twice — once
   * as the name and once as the avatar initial derived from it.
   *
   * Seen in production on 2026-08-25 while capturing store screenshots: a listing whose
   * `user_id` no longer resolves came back as `user: null, author_name: "Unknown"`, and the
   * card showed "?" over a bare date. A question mark tells a member nothing; it reads like
   * the app is broken rather than like the person is gone.
   */
  const user = exchange.user ?? {
    id: 0,
    name: exchange.author_name?.trim() || t('unknownMember'),
    avatar_url: exchange.author_avatar ?? null,
  };
  const imageUrl = resolveImageUrl(exchange.image_url);
  const isOffer = exchange.type === 'offer';
  const accent = isOffer ? '#10B981' : '#F59E0B';
  const accentSoft = isOffer ? 'rgba(16, 185, 129, 0.14)' : 'rgba(245, 158, 11, 0.14)';
  const isFavorited = exchange.is_favorited === true;
  const serviceType = exchange.service_type ?? null;
  const distanceKm = typeof exchange.distance_km === 'number' ? exchange.distance_km : null;

  function toggleSave() {
    onToggleSave?.(exchange.id, isFavorited);
  }

  return (
    <NativePressable
      className="mx-4 my-2"
      onPress={openDetail}
      accessibilityLabel={exchange.title ?? ''}
      feedback="highlight"
    >
      <HeroCard variant="default" className="w-full overflow-hidden">
        <View className="h-1 w-full" style={{ backgroundColor: accent }} />
        {imageUrl ? (
          <Image source={{ uri: imageUrl }} style={{ width: '100%', height: 150 }} contentFit="cover" />
        ) : null}

        <HeroCard.Header className="flex-row items-start justify-between gap-3 px-4 pb-2 pt-4">
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Chip size="sm" variant="soft" color={isOffer ? 'success' : 'warning'}>
                <Ionicons name={isOffer ? 'gift-outline' : 'hand-left-outline'} size={12} color={accent} />
                <Chip.Label>{isOffer ? t('offering') : t('requesting')}</Chip.Label>
              </Chip>
              {exchange.category_name ? (
                <Chip size="sm" variant="soft" color="default">
                  <Chip.Label>{exchange.category_name}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            <Text className="text-lg font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>
              {exchange.title ?? ''}
            </Text>
          </View>
          <View className="items-end gap-2">
            {onToggleSave ? (
              <HeroButton
                isIconOnly
                size="sm"
                variant={isFavorited ? 'danger-soft' : 'secondary'}
                onPress={toggleSave}
                testID={`exchange-save-${exchange.id}`}
                accessibilityLabel={isFavorited ? t('unsaveListing') : t('saveListing')}
              >
                <Ionicons
                  name={isFavorited ? 'heart' : 'heart-outline'}
                  size={17}
                  color={isFavorited ? '#E11D48' : primary}
                />
              </HeroButton>
            ) : null}
            {/* 🔴 p-0 is load-bearing. HeroUI Native Surface has `p-4` in its BASE
                class, so a 36dp (`size-9`) box keeps only 36 - 2x16 = 4dp of content
                box and the 18dp arrow drew at 4dp — measured on device at 10x12px
                against the heart button's correct 45x47px. It read as an empty grey
                circle on every listing card. Giving a Surface a size does NOT reset
                its padding. Guarded by components/surfacePadding.test.ts. */}
            <Surface variant="secondary" className="size-9 items-center justify-center rounded-full p-0">
              <Ionicons name="arrow-forward" size={18} color={primary} />
            </Surface>
          </View>
        </HeroCard.Header>

        <HeroCard.Body className="gap-3 px-4 pb-4 pt-0">
          {exchange.description ? (
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
              {exchange.description}
            </Text>
          ) : null}

          <View className="flex-row flex-wrap gap-2">
            {hours > 0 ? (
              <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5" style={{ backgroundColor: accentSoft }}>
                <Ionicons name="time-outline" size={14} color={accent} />
                <Text className="text-xs font-semibold" style={{ color: accent }}>
                  {t('detail.hours', { count: hours })}
                </Text>
              </Surface>
            ) : null}
            {exchange.location ? (
              <Surface variant="secondary" className="flex-row max-w-full items-center gap-1 rounded-full px-3 py-1.5">
                <Ionicons name="location-outline" size={14} color={theme.textMuted} />
                <Text className="max-w-[210px] text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {exchange.location}
                </Text>
              </Surface>
            ) : null}
            {distanceKm !== null ? (
              <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                <Ionicons name="navigate-outline" size={14} color={primary} />
                <Text className="text-xs font-semibold" style={{ color: primary }}>
                  {formatDistance(distanceKm, t)}
                </Text>
              </Surface>
            ) : null}
            {serviceType ? (
              <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                <Ionicons name={serviceType === 'remote_only' ? 'desktop-outline' : 'swap-horizontal-outline'} size={14} color={theme.textMuted} />
                <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {t(`serviceType.${serviceType}`)}
                </Text>
              </Surface>
            ) : null}
          </View>
        </HeroCard.Body>

        <View className="mx-4">
          <Separator />
        </View>

        <HeroCard.Footer className="flex-row items-center gap-3 px-4 py-3">
          <Avatar uri={user.avatar_url} name={user.name} size={28} />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
              {user.name}
            </Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {formatRelativeTime(exchange.created_at)}
            </Text>
          </View>
          <Surface variant="secondary" className="flex-row items-center gap-2 rounded-full px-3 py-1.5">
            <Text className="text-xs font-semibold" style={{ color: primary }}>
              {t('viewDetails')}
            </Text>
            <Ionicons name="chevron-forward-outline" size={14} color={primary} />
          </Surface>
        </HeroCard.Footer>
      </HeroCard>
    </NativePressable>
  );
}

function formatDistance(distanceKm: number, t: ReturnType<typeof useTranslation>['t']) {
  if (distanceKm < 1) {
    return t('distanceMeters', { distance: Math.round(distanceKm * 1000) });
  }

  return t('distanceKilometers', { distance: formatDecimal(distanceKm, 1) });
}
