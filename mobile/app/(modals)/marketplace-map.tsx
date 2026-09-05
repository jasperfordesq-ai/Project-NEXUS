// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ReactNode, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  getNearbyMarketplaceListings,
  type MarketplaceNearbyListing,
} from '@/lib/api/marketplace';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AccentIcon from '@/components/ui/AccentIcon';

const RADIUS_OPTIONS = ['5', '10', '25', '50', '100'];

export default function MarketplaceMapRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceMapScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceMapScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const params = useLocalSearchParams<{
    latitude?: string | string[];
    longitude?: string | string[];
    lat?: string | string[];
    lng?: string | string[];
    radius?: string | string[];
  }>();
  const { hasFeature } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const { show: showToast } = useAppToast();
  const [latitude, setLatitude] = useState(firstParam(params.latitude) ?? firstParam(params.lat) ?? '');
  const [longitude, setLongitude] = useState(firstParam(params.longitude) ?? firstParam(params.lng) ?? '');
  const [radius, setRadius] = useState(normalizeRadius(firstParam(params.radius)));
  const [items, setItems] = useState<MarketplaceNearbyListing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const lat = parseCoordinate(latitude);
    const lng = parseCoordinate(longitude);
    const radiusKm = Number(radius) || 25;

    if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      showToast({ title: t('common:errors.alertTitle'), description: t('map.invalidCoordinates'), variant: 'warning' });
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    setError(null);
    try {
      const response = await getNearbyMarketplaceListings({
        latitude: lat,
        longitude: lng,
        radius: radiusKm,
        limit: 50,
      });
      setItems(response.data);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : t('map.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  async function searchCurrentLocation() {
    setIsLoading(true);
    setHasSearched(true);
    setError(null);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setItems([]);
        setError(t('map.locationPermissionDenied'));
        return;
      }

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const nextLatitude = String(current.coords.latitude);
      const nextLongitude = String(current.coords.longitude);
      setLatitude(nextLatitude);
      setLongitude(nextLongitude);

      const response = await getNearbyMarketplaceListings({
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
        radius: Number(radius) || 25,
        limit: 50,
      });
      setItems(response.data);
    } catch (err) {
      setItems([]);
      setError(err instanceof Error ? err.message : t('map.locationLoadFailed'));
    } finally {
      setIsLoading(false);
    }
  }

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('map.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="map-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('map.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 + bottomInset }}
        ListHeaderComponent={
          <View className="gap-3">
            <HeroCard className="overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="map-outline" size={25} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('map.eyebrow')}</Text>
                    <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('map.title')}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('map.subtitle')}</Text>
                  </View>
                </View>
                <MapPreview
                  latitude={latitude}
                  longitude={longitude}
                  radius={radius}
                  resultCount={items.length}
                  hasSearched={hasSearched}
                  primary={primary}
                  theme={theme}
                  t={t}
                />
              </HeroCard.Body>
            </HeroCard>

            <Surface variant="default" className="gap-4 rounded-panel p-4">
              <View className="gap-1">
                <Text className="text-base font-bold" style={{ color: theme.text }}>{t('map.searchPanelTitle')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('map.searchPanelSubtitle')}</Text>
              </View>
              <View className="flex-row gap-2">
                <CoordinateInput label={t('map.latitude')} value={latitude} onChangeText={setLatitude} placeholder={t('map.latitudePlaceholder')} />
                <CoordinateInput label={t('map.longitude')} value={longitude} onChangeText={setLongitude} placeholder={t('map.longitudePlaceholder')} />
              </View>
              <FilterStrip label={t('map.radius')}>
                {RADIUS_OPTIONS.map((option) => (
                  <FilterButton
                    key={option}
                    active={radius === option}
                    label={t('map.radiusOption', { radius: option })}
                    onPress={() => setRadius(option)}
                  />
                ))}
              </FilterStrip>
              <View className="gap-2">
                <HeroButton variant="primary" onPress={() => void search()} isDisabled={isLoading}>
                  <AccentIcon name="locate-outline" size={16} />
                  <HeroButton.Label>{t('map.search')}</HeroButton.Label>
                </HeroButton>
                <HeroButton variant="secondary" onPress={() => void searchCurrentLocation()} isDisabled={isLoading}>
                  <Ionicons name="navigate-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('map.useCurrentLocation')}</HeroButton.Label>
                </HeroButton>
              </View>
            </Surface>

            {items.length > 0 ? (
              <View className="gap-2">
                <Text className="text-base font-bold" style={{ color: theme.text }}>{t('map.resultsTitle')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  <Chip size="sm" variant="secondary"><Chip.Label>{t('map.results', { count: items.length })}</Chip.Label></Chip>
                  <Chip size="sm" variant="secondary"><Chip.Label>{t('map.radiusLabel', { radius })}</Chip.Label></Chip>
                  <Chip size="sm" variant="secondary"><Chip.Label>{t('map.coordinatesLabel', { latitude, longitude })}</Chip.Label></Chip>
                </View>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View>
            {item.distance_km != null ? (
              <View className="mb-1 self-start">
                <Chip size="sm" variant="secondary">
                  <Ionicons name="navigate-outline" size={12} color={primary} />
                  <Chip.Label>{t('map.distance', { distance: Number(item.distance_km).toFixed(1) })}</Chip.Label>
                </Chip>
              </View>
            ) : null}
            <MarketplaceListingCard
              item={item}
              onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.id) } } as unknown as Href)}
            />
          </View>
        )}
        ListEmptyComponent={
          isLoading ? (
            <View className="py-16"><LoadingSpinner /></View>
          ) : hasSearched ? (
            <EmptyState icon="map-outline" title={error ?? t('map.emptyTitle')} subtitle={t('map.emptySubtitle')} actionLabel={t('common:buttons.retry')} onAction={() => void search()} />
          ) : (
            <EmptyState icon="location-outline" title={t('map.startTitle')} subtitle={t('map.startSubtitle')} />
          )
        }
      />
    </SafeAreaView>
  );
}

function MapPreview({
  latitude,
  longitude,
  radius,
  resultCount,
  hasSearched,
  primary,
  theme,
  t,
}: {
  latitude: string;
  longitude: string;
  radius: string;
  resultCount: number;
  hasSearched: boolean;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  // The preview card floats over the map with an absolute bottom; it must clear the nav bar itself.
  const bottomInset = useBottomInset();
  const hasCoordinates = parseCoordinate(latitude) !== null && parseCoordinate(longitude) !== null;

  return (
    <Surface variant="secondary" className="overflow-hidden rounded-panel-inner p-0">
      <View className="relative h-48 overflow-hidden rounded-panel-inner">
        <View className="absolute inset-0" style={{ backgroundColor: withAlpha(primary, 0.08) }} />
        <View className="absolute left-0 right-0 top-12 h-px" style={{ backgroundColor: withAlpha(primary, 0.18) }} />
        <View className="absolute left-0 right-0 top-24 h-px" style={{ backgroundColor: withAlpha(theme.text, 0.08) }} />
        <View className="absolute left-0 right-0 top-36 h-px" style={{ backgroundColor: withAlpha(primary, 0.14) }} />
        <View className="absolute bottom-0 top-0 left-16 w-px" style={{ backgroundColor: withAlpha(theme.text, 0.08) }} />
        <View className="absolute bottom-0 top-0 left-36 w-px" style={{ backgroundColor: withAlpha(primary, 0.14) }} />
        <View className="absolute bottom-0 top-0 right-20 w-px" style={{ backgroundColor: withAlpha(theme.text, 0.08) }} />

        <View className="absolute left-7 top-8 size-7 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha('#14b8a6', 0.16) }}>
          <View className="size-2.5 rounded-full" style={{ backgroundColor: '#14b8a6' }} />
        </View>
        <View className="absolute right-10 top-12 size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.18) }}>
          <View className="size-3 rounded-full" style={{ backgroundColor: primary }} />
        </View>
        <View className="absolute bottom-10 left-28 size-7 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha('#f59e0b', 0.18) }}>
          <View className="size-2.5 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
        </View>

        {/* Floats over the map; `bottom` includes the Android nav-bar inset or the card sits under it. */}
        <View
          testID="marketplace-map-preview"
          className="absolute inset-x-4 gap-3 rounded-panel-inner p-3"
          style={{ bottom: 16 + bottomInset, backgroundColor: withAlpha(theme.surface, 0.94) }}
        >
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {t('map.previewTitle')}
              </Text>
              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {hasCoordinates
                  ? t('map.previewCoordinates', { latitude, longitude })
                  : t('map.previewCoordinatesEmpty')}
              </Text>
            </View>
            <Chip size="sm" variant="secondary">
              <Ionicons name="radio-button-on-outline" size={12} color={primary} />
              <Chip.Label>{t('map.previewRadius', { radius })}</Chip.Label>
            </Chip>
          </View>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {hasSearched ? t('map.pinCount', { count: resultCount }) : t('map.previewHint')}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

function FilterStrip({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {children}
      </ScrollView>
    </View>
  );
}

function FilterButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  return (
    <HeroButton size="sm" variant={active ? 'primary' : 'secondary'} onPress={onPress}>
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function CoordinateInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View className="min-w-0 flex-1">
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
      />
    </View>
  );
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeRadius(value?: string): string {
  if (!value) return '25';
  const radius = Number(value);
  if (!Number.isFinite(radius)) return '25';
  return String(Math.max(1, Math.min(200, Math.round(radius))));
}

function parseCoordinate(value: string): number | null {
  if (!value.trim()) return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : null;
}
