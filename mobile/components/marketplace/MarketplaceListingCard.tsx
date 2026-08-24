// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Image, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import type { MarketplaceListingItem } from '@/lib/api/marketplace';
import Avatar from '@/components/ui/Avatar';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { formatMarketplaceCurrency } from '@/lib/utils/marketplaceCurrency';

export function formatMarketplacePrice(
  price: number | null | undefined,
  priceType: string | undefined,
  currency: string | undefined,
  freeLabel: string,
  fallbackCurrency?: string,
): string {
  if (priceType === 'free' || price === null || price === undefined || Number(price) === 0) {
    return freeLabel;
  }

  return formatMarketplaceCurrency(Number(price), currency || fallbackCurrency);
}

export default function MarketplaceListingCard({
  item,
  onPress,
  onSavePress,
}: {
  item: MarketplaceListingItem;
  onPress: () => void;
  onSavePress?: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const accent =
    item.price_type === 'free'
      ? theme.success
      : item.is_promoted
        ? theme.warning
        : primary;
  const imageUrl = resolveImageUrl(item.image?.thumbnail_url ?? item.image?.url ?? item.images?.[0]?.thumbnail_url ?? item.images?.[0]?.url);
  const price = formatMarketplacePrice(
    item.price,
    item.price_type,
    item.price_currency,
    t('common.free'),
    tenant?.currency,
  );
  const inventory = inventoryChip(item);

  return (
    <HeroCard className="mb-3 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
      <View className="h-1.5" style={{ backgroundColor: accent }} />
      <HeroCard.Body className="gap-3 p-3">
        <View className="flex-row gap-3">
          <Surface variant="secondary" className="h-24 w-24 items-center justify-center overflow-hidden rounded-panel-inner p-0">
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <Ionicons name="bag-handle-outline" size={30} color={accent} />
            )}
          </Surface>

          <View className="min-w-0 flex-1">
            <View className="flex-row items-start gap-2">
              <View className="min-w-0 flex-1">
                <Text className="text-base font-bold leading-5" style={{ color: theme.text }} numberOfLines={2}>
                  {item.title}
                </Text>
                {item.tagline ? (
                  <Text className="mt-1 text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={3}>
                    {item.tagline}
                  </Text>
                ) : null}
              </View>
              {onSavePress ? (
                <HeroButton
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  accessibilityLabel={item.is_saved ? t('detail.unsave') : t('detail.save')}
                  onPress={onSavePress}
                  style={{ backgroundColor: withAlpha(primary, 0.12) }}
                >
                  <Ionicons name={item.is_saved ? 'heart' : 'heart-outline'} size={18} color={primary} />
                </HeroButton>
              ) : null}
            </View>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-1.5">
          <Chip size="sm" variant="secondary">
            <Ionicons name={item.price_type === 'free' ? 'gift-outline' : 'pricetag-outline'} size={12} color={accent} />
            <Chip.Label>{price}</Chip.Label>
          </Chip>
          {item.condition ? (
            <Chip size="sm" variant="secondary">
              <Chip.Label>{t(`condition.${item.condition}`)}</Chip.Label>
            </Chip>
          ) : null}
          {item.category?.name ? (
            <Chip size="sm" variant="secondary">
              <Chip.Label>{item.category.name}</Chip.Label>
            </Chip>
          ) : null}
          {inventory ? (
            <Chip size="sm" variant="secondary">
              <Ionicons name={inventory.icon} size={12} color={inventory.tone} />
              <Chip.Label style={{ color: inventory.tone }}>{t(inventory.labelKey, inventory.params)}</Chip.Label>
            </Chip>
          ) : null}
        </View>

        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1 flex-row items-center gap-2">
            <Avatar uri={item.user?.avatar_url} name={item.user?.name} size={28} />
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-1">
                <Text className="min-w-0 text-xs font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                  {item.user?.name ?? t('common.seller')}
                </Text>
                {item.user?.is_verified ? <Ionicons name="shield-checkmark-outline" size={14} color={theme.success} /> : null}
              </View>
              <Text className="text-[11px] leading-4" style={{ color: theme.textMuted }} numberOfLines={1}>
                {item.location || t(`delivery_method.${item.delivery_method || 'other'}`)}
              </Text>
            </View>
          </View>
          <HeroButton
            size="sm"
            variant="secondary"
            className="shrink-0"
            accessibilityLabel={t('actions.viewListing', { title: item.title })}
            onPress={onPress}
          >
            <HeroButton.Label>{t('actions.view')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function inventoryChip(item: MarketplaceListingItem): null | {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  labelKey: string;
  params?: Record<string, number>;
  tone: string;
} {
  const inventory = item.inventory_count;
  if (inventory === null || inventory === undefined) return null;
  if (inventory <= 0) {
    return { icon: 'close-circle-outline', labelKey: 'inventory.soldOut', tone: '#ef4444' };
  }
  if (item.low_stock_threshold !== null && item.low_stock_threshold !== undefined && inventory <= item.low_stock_threshold) {
    return { icon: 'alert-circle-outline', labelKey: 'inventory.low', params: { count: inventory }, tone: '#f59e0b' };
  }
  return { icon: 'cube-outline', labelKey: 'inventory.count', params: { count: inventory }, tone: '#64748b' };
}
