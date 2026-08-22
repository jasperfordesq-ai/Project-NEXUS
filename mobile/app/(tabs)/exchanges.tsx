// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { FlatList, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Chip, Separator, Slider, Spinner, Surface, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getExchangeCategories,
  getExchanges,
  saveExchange,
  unsaveExchange,
  type Exchange,
  type ExchangeCategory,
  type ExchangeListResponse,
  type ExchangeType,
} from '@/lib/api/exchanges';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText } from '@/lib/utils/color';
import ExchangeCard from '@/components/ExchangeCard';
import OfflineBanner from '@/components/OfflineBanner';
import SearchInput from '@/components/ui/SearchInput';
import { ExchangeCardSkeleton } from '@/components/ui/Skeleton';
import AccentIcon from '@/components/ui/AccentIcon';

function extractExchangePage(response: ExchangeListResponse) {
  const seen = new Set<number>();
  const unique = response.data.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { items: unique, cursor: response.meta.cursor, hasMore: response.meta.has_more };
}

type HoursRange = 'any' | 'quick' | 'short' | 'half_day' | 'full_day';
type ServiceFilter = 'any' | 'remote' | 'in_person';
type PostedWithin = 'any' | '1' | '7' | '30';
type SortMode = 'recommended' | 'newest';

interface NearMeCoordinates {
  lat: number;
  lng: number;
}

const DEFAULT_RADIUS_KM = 25;
const RADIUS_PRESETS = [5, 10, 25, 50, 100] as const;

const durationOptions: { value: HoursRange; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'any', labelKey: 'duration.any', icon: 'time-outline' },
  { value: 'quick', labelKey: 'duration.quick', icon: 'flash-outline' },
  { value: 'short', labelKey: 'duration.short', icon: 'timer-outline' },
  { value: 'half_day', labelKey: 'duration.halfDay', icon: 'partly-sunny-outline' },
  { value: 'full_day', labelKey: 'duration.fullDay', icon: 'sunny-outline' },
];

const serviceOptions: { value: ServiceFilter; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'any', labelKey: 'service.any', icon: 'swap-horizontal-outline' },
  { value: 'remote', labelKey: 'service.remote', icon: 'desktop-outline' },
  { value: 'in_person', labelKey: 'service.inPerson', icon: 'walk-outline' },
];

const postedOptions: { value: PostedWithin; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'any', labelKey: 'posted.any', icon: 'calendar-outline' },
  { value: '1', labelKey: 'posted.today', icon: 'today-outline' },
  { value: '7', labelKey: 'posted.week', icon: 'calendar-number-outline' },
  { value: '30', labelKey: 'posted.month', icon: 'calendar-clear-outline' },
];

const sortOptions: { value: SortMode; labelKey: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'recommended', labelKey: 'sort.recommended', icon: 'sparkles-outline' },
  { value: 'newest', labelKey: 'sort.newest', icon: 'arrow-down-outline' },
];

function getHoursParams(value: HoursRange): Record<string, string> {
  switch (value) {
    case 'quick':
      return { max_hours: '1' };
    case 'short':
      return { min_hours: '1', max_hours: '3' };
    case 'half_day':
      return { min_hours: '3', max_hours: '6' };
    case 'full_day':
      return { min_hours: '6' };
    default:
      return {};
  }
}

export default function ExchangesScreen() {
  const { t } = useTranslation(['exchanges', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | ExchangeType>('all');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categories, setCategories] = useState<ExchangeCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [hoursRange, setHoursRange] = useState<HoursRange>('any');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('any');
  const [postedWithin, setPostedWithin] = useState<PostedWithin>('any');
  const [sortMode, setSortMode] = useState<SortMode>('recommended');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [nearMeCoordinates, setNearMeCoordinates] = useState<NearMeCoordinates | null>(null);
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [radiusDraftKm, setRadiusDraftKm] = useState(DEFAULT_RADIUS_KM);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [savedOverrides, setSavedOverrides] = useState<Record<number, boolean>>({});
  const debouncedSearch = useDebounce(search, 400);

  useEffect(() => {
    let cancelled = false;

    getExchangeCategories()
      .then((response) => {
        if (!cancelled) setCategories(response.data ?? []);
      })
      .catch(() => {
        if (!cancelled) setCategories([]);
      })
      .finally(() => {
        if (!cancelled) setCategoriesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchExchanges = useCallback(
    (cursor: string | null) => {
      const params: Record<string, string> = {
        personalised: sortMode === 'recommended' ? 'true' : 'false',
      };

      if (debouncedSearch) params.search = debouncedSearch;
      if (typeFilter !== 'all') params.type = typeFilter;
      if (categoryId !== null) params.category_id = String(categoryId);
      Object.assign(params, getHoursParams(hoursRange));
      if (serviceFilter === 'remote') params.service_type = 'remote_only,hybrid';
      if (serviceFilter === 'in_person') params.service_type = 'physical_only';
      if (postedWithin !== 'any') params.posted_within = postedWithin;
      if (sortMode === 'newest') params.sort = 'newest';
      if (nearMeCoordinates) {
        params.near_lat = String(nearMeCoordinates.lat);
        params.near_lng = String(nearMeCoordinates.lng);
        params.radius_km = String(radiusKm);
      }

      return getExchanges(cursor, params);
    },
    [categoryId, debouncedSearch, hoursRange, nearMeCoordinates, postedWithin, radiusKm, serviceFilter, sortMode, typeFilter],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<Exchange, ExchangeListResponse>(
      fetchExchanges,
      extractExchangePage,
      [debouncedSearch, typeFilter, categoryId, hoursRange, serviceFilter, postedWithin, sortMode, nearMeCoordinates, radiusKm],
    );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const wasRefreshingRef = useRef(false);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    wasRefreshingRef.current = true;
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (wasRefreshingRef.current && !isLoading) {
      wasRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, [isLoading]);

  // Reconcile optimistic save toggles: once the server's is_favorited matches an
  // override (e.g. after a refresh or filter change), drop it so stale local state
  // can't mask a later server-side change made from another device.
  useEffect(() => {
    setSavedOverrides((current) => {
      const keys = Object.keys(current);
      if (keys.length === 0) return current;
      const next: Record<number, boolean> = {};
      let changed = false;
      for (const key of keys) {
        const id = Number(key);
        const item = items.find((i) => i.id === id);
        if (item && item.is_favorited === current[id]) {
          changed = true; // server caught up — drop the override
        } else {
          next[id] = current[id];
        }
      }
      return changed ? next : current;
    });
  }, [items]);

  const visibleItems = useMemo(
    () => items.map((item) => (
      Object.prototype.hasOwnProperty.call(savedOverrides, item.id)
        ? { ...item, is_favorited: savedOverrides[item.id] }
        : item
    )),
    [items, savedOverrides],
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryId !== null) count += 1;
    if (hoursRange !== 'any') count += 1;
    if (serviceFilter !== 'any') count += 1;
    if (postedWithin !== 'any') count += 1;
    if (sortMode !== 'recommended') count += 1;
    if (nearMeCoordinates) count += 1;
    return count;
  }, [categoryId, hoursRange, nearMeCoordinates, postedWithin, serviceFilter, sortMode]);

  const hasActiveFilters = Boolean(search.trim()) || typeFilter !== 'all' || activeFilterCount > 0;

  const resetFilters = useCallback(() => {
    setSearch('');
    setTypeFilter('all');
    setCategoryId(null);
    setHoursRange('any');
    setServiceFilter('any');
    setPostedWithin('any');
    setSortMode('recommended');
    setShowAdvancedFilters(false);
    setNearMeCoordinates(null);
    setRadiusKm(DEFAULT_RADIUS_KM);
    setRadiusDraftKm(DEFAULT_RADIUS_KM);
    setLocationError(null);
  }, []);

  const handleNearMePress = useCallback(async () => {
    if (nearMeCoordinates) {
      setNearMeCoordinates(null);
      setLocationError(null);
      return;
    }

    setIsLocating(true);
    setLocationError(null);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setLocationError(t('locationPermissionDenied'));
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setNearMeCoordinates({
        lat: current.coords.latitude,
        lng: current.coords.longitude,
      });
      void Haptics.selectionAsync();
    } catch {
      setLocationError(t('locationUnavailable'));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsLocating(false);
    }
  }, [nearMeCoordinates, t]);

  const normaliseRadius = useCallback((value: number | number[]) => {
    const next = Array.isArray(value) ? value[0] : value;
    if (!Number.isFinite(next)) return null;
    return Math.max(1, Math.min(100, Math.round(next)));
  }, []);

  const handleRadiusPreviewChange = useCallback((value: number | number[]) => {
    const next = normaliseRadius(value);
    if (next === null) return;
    setRadiusDraftKm(next);
  }, [normaliseRadius]);

  const handleRadiusCommitChange = useCallback((value: number | number[]) => {
    const next = normaliseRadius(value);
    if (next === null) return;
    setRadiusDraftKm(next);
    setRadiusKm(next);
  }, [normaliseRadius]);

  const handleRadiusPresetPress = useCallback((value: number) => {
    setRadiusDraftKm(value);
    setRadiusKm(value);
  }, []);

  const handleToggleSave = useCallback(async (listingId: number, currentlySaved: boolean) => {
    const nextSaved = !currentlySaved;
    setSavedOverrides((current) => ({ ...current, [listingId]: nextSaved }));

    try {
      if (nextSaved) {
        await saveExchange(listingId);
      } else {
        await unsaveExchange(listingId);
      }
      void Haptics.selectionAsync();
    } catch {
      setSavedOverrides((current) => ({ ...current, [listingId]: currentlySaved }));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }, []);

  const controls = (
    <Surface variant="default" className="gap-3 rounded-panel-inner p-3">
      <View className="flex-row items-center justify-between gap-3">
        <View className="min-w-0 flex-1">
          <Text className="text-xl font-bold leading-6" style={{ color: theme.text }}>
            {t('title')}
          </Text>
          <Text className="mt-0.5 text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {t('filtersIntro')}
          </Text>
        </View>
        <View className="flex-row items-center gap-2">
          <Chip size="sm" variant="soft" color="success">
            <Ionicons name="swap-horizontal-outline" size={12} color="#10B981" />
            <Chip.Label>{isLoading ? t('resultsLoading') : t('resultsCount', { count: visibleItems.length })}</Chip.Label>
          </Chip>
          <HeroButton
            isIconOnly
            size="sm"
            variant="primary"
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(modals)/new-exchange');
            }}
            accessibilityLabel={t('newListing')}
          >
            <AccentIcon name="add" size={20} />
          </HeroButton>
        </View>
      </View>

      <SearchInput
        testID="listings-search"
        value={search}
        onChangeText={setSearch}
        placeholder={t('searchPlaceholder')}
        clearLabel={t('clearSearch')}
        returnKeyType="search"
        accessibilityLabel={t('searchPlaceholder')}
        containerClassName="mb-0"
      />

      <Tabs value={typeFilter} onValueChange={(value) => setTypeFilter(value as 'all' | ExchangeType)} variant="secondary">
        <Tabs.List>
          <Tabs.Indicator />
          <Tabs.Trigger value="all">
            <Ionicons name="apps-outline" size={15} color={typeFilter === 'all' ? primary : theme.textMuted} />
            <Tabs.Label>{t('filterAllTypes')}</Tabs.Label>
          </Tabs.Trigger>
          <Tabs.Trigger value="offer">
            <Ionicons name="gift-outline" size={15} color={typeFilter === 'offer' ? '#10B981' : theme.textMuted} />
            <Tabs.Label>{t('offer')}</Tabs.Label>
          </Tabs.Trigger>
          <Tabs.Trigger value="request">
            <Ionicons name="hand-left-outline" size={15} color={typeFilter === 'request' ? '#F59E0B' : theme.textMuted} />
            <Tabs.Label>{t('request')}</Tabs.Label>
          </Tabs.Trigger>
        </Tabs.List>
      </Tabs>

      <View className="flex-row gap-2">
        <HeroButton
          size="sm"
          variant={nearMeCoordinates ? 'primary' : 'secondary'}
          onPress={() => void handleNearMePress()}
          isDisabled={isLocating}
          accessibilityState={{ selected: nearMeCoordinates !== null, busy: isLocating }}
        >
          {isLocating ? <Spinner size="sm" /> : <Ionicons name={nearMeCoordinates ? 'location' : 'location-outline'} size={15} color={nearMeCoordinates ? contrastText(primary) : primary} />}
          <HeroButton.Label style={nearMeCoordinates ? { color: contrastText(primary) } : undefined} numberOfLines={1}>
            {nearMeCoordinates ? t('nearMeOnWithRadius', { radius: radiusKm }) : t('nearMe')}
          </HeroButton.Label>
        </HeroButton>

        <HeroButton
          size="sm"
          variant={showAdvancedFilters ? 'primary' : 'secondary'}
          onPress={() => setShowAdvancedFilters((current) => !current)}
          accessibilityState={{ expanded: showAdvancedFilters }}
        >
          <Ionicons name="options-outline" size={15} color={showAdvancedFilters ? contrastText(primary) : theme.textMuted} />
          <HeroButton.Label style={showAdvancedFilters ? { color: contrastText(primary) } : undefined} numberOfLines={1}>
            {activeFilterCount > 0 ? t('filtersWithCount', { count: activeFilterCount }) : t('filters')}
          </HeroButton.Label>
        </HeroButton>
      </View>

      {(nearMeCoordinates || locationError) ? (
        <NearMeFilter
          radiusKm={radiusDraftKm}
          appliedRadiusKm={radiusKm}
          locationError={locationError}
          onRadiusPreviewChange={handleRadiusPreviewChange}
          onRadiusCommitChange={handleRadiusCommitChange}
          onPresetPress={handleRadiusPresetPress}
          primary={primary}
          theme={theme}
          t={t}
        />
      ) : null}

      <Separator />

      <FilterStrip label={t('sort.label')}>
        {sortOptions.map((option) => (
          <FilterButton
            key={option.value}
            active={sortMode === option.value}
            label={t(option.labelKey)}
            icon={option.icon}
            onPress={() => setSortMode(option.value)}
            primary={primary}
            theme={theme}
          />
        ))}
      </FilterStrip>

      {showAdvancedFilters ? (
        <View className="gap-3">
          {categories.length > 0 || categoriesLoading ? (
            <FilterStrip label={t('category')}>
              <FilterButton
                active={categoryId === null}
                label={categoriesLoading ? t('categoriesLoading') : t('filterAllCategories')}
                icon="albums-outline"
                onPress={() => setCategoryId(null)}
                primary={primary}
                theme={theme}
              />
              {categories.map((category) => (
                <FilterButton
                  key={category.id}
                  active={categoryId === category.id}
                  label={category.name}
                  icon="pricetag-outline"
                  onPress={() => setCategoryId(category.id)}
                  primary={category.color || primary}
                  theme={theme}
                />
              ))}
            </FilterStrip>
          ) : null}

          <FilterStrip label={t('duration.label')}>
            {durationOptions.map((option) => (
              <FilterButton
                key={option.value}
                active={hoursRange === option.value}
                label={t(option.labelKey)}
                icon={option.icon}
                onPress={() => setHoursRange(option.value)}
                primary={primary}
                theme={theme}
              />
            ))}
          </FilterStrip>

          <FilterStrip label={t('service.label')}>
            {serviceOptions.map((option) => (
              <FilterButton
                key={option.value}
                active={serviceFilter === option.value}
                label={t(option.labelKey)}
                icon={option.icon}
                onPress={() => setServiceFilter(option.value)}
                primary={primary}
                theme={theme}
              />
            ))}
          </FilterStrip>

          <FilterStrip label={t('posted.label')}>
            {postedOptions.map((option) => (
              <FilterButton
                key={option.value}
                active={postedWithin === option.value}
                label={t(option.labelKey)}
                icon={option.icon}
                onPress={() => setPostedWithin(option.value)}
                primary={primary}
                theme={theme}
              />
            ))}
          </FilterStrip>
        </View>
      ) : null}

      {hasActiveFilters ? (
        <HeroButton
          size="sm"
          variant="ghost"
          onPress={resetFilters}
        >
          <Ionicons name="close-outline" size={16} color={theme.textMuted} />
          <HeroButton.Label style={{ color: theme.textMuted }}>
            {activeFilterCount > 0 ? t('clearFiltersWithCount', { count: activeFilterCount }) : t('clearFilters')}
          </HeroButton.Label>
        </HeroButton>
      ) : null}
    </Surface>
  );

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <OfflineBanner />

      <View className="px-4 pb-2 pt-3">
        {controls}
      </View>

      <FlatList<Exchange>
        data={visibleItems}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <ExchangeCard exchange={item} onToggleSave={handleToggleSave} />}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />
        }
        onEndReached={() => { if (hasMore) loadMore(); }}
        onEndReachedThreshold={0.3}
        initialNumToRender={6}
        maxToRenderPerBatch={8}
        windowSize={11}
        ListEmptyComponent={
          isLoading ? (
            <><ExchangeCardSkeleton /><ExchangeCardSkeleton /><ExchangeCardSkeleton /></>
          ) : error ? (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-4">
                <Ionicons name="warning-outline" size={30} color={primary} />
                <Text className="text-center text-sm leading-5 text-danger">{error}</Text>
                <HeroButton variant="primary" onPress={() => void refresh()}>
                  <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ) : (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-3">
                <Ionicons name="search-outline" size={34} color={primary} />
                <Text className="text-center text-[17px] font-semibold" style={{ color: theme.text }}>
                  {t('empty')}
                </Text>
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {hasActiveFilters ? t('emptySubtitle') : t('emptyNoListings')}
                </Text>
                {hasActiveFilters ? (
                  <HeroButton size="sm" variant="secondary" onPress={resetFilters}>
                    <HeroButton.Label>{t('clearFilters')}</HeroButton.Label>
                  </HeroButton>
                ) : (
                  <HeroButton size="sm" variant="primary" onPress={() => router.push('/(modals)/new-exchange')}>
                    <AccentIcon name="add" size={16} />
                    <HeroButton.Label>{t('newListing')}</HeroButton.Label>
                  </HeroButton>
                )}
              </HeroCard.Body>
            </HeroCard>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4 items-center"><Spinner size="sm" /></View>
          ) : !hasMore && visibleItems.length > 0 && !isLoading ? (
            <View className="py-4 items-center">
              <Text className="text-xs text-muted-foreground">{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 112 }}
      />
    </SafeAreaView>
  );
}

function FilterStrip({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 4 }}>
        {children}
      </ScrollView>
    </View>
  );
}

function FilterButton({
  active,
  label,
  icon,
  onPress,
  primary,
  theme,
}: {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <HeroButton
      size="sm"
      variant={active ? 'primary' : 'secondary'}
      onPress={onPress}
      accessibilityState={{ selected: active }}
    >
      <Ionicons name={icon} size={14} color={active ? contrastText(primary) : theme.textMuted} />
      <HeroButton.Label style={active ? { color: contrastText(primary) } : undefined} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}

function NearMeFilter({
  radiusKm,
  appliedRadiusKm,
  locationError,
  onRadiusPreviewChange,
  onRadiusCommitChange,
  onPresetPress,
  primary,
  theme,
  t,
}: {
  radiusKm: number;
  appliedRadiusKm: number;
  locationError: string | null;
  onRadiusPreviewChange: (value: number | number[]) => void;
  onRadiusCommitChange: (value: number | number[]) => void;
  onPresetPress: (value: number) => void;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: ReturnType<typeof useTranslation>['t'];
}) {
  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
      <View className="gap-3">
        <Slider
          value={radiusKm}
          minValue={1}
          maxValue={100}
          step={1}
          onChange={onRadiusPreviewChange}
          onChangeEnd={onRadiusCommitChange}
          accessibilityLabel={t('radiusSliderLabel')}
        >
          <View className="flex-row items-center justify-between">
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
                {t('nearMeRadiusTitle')}
              </Text>
              <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {locationError ? t('nearMeDescription') : t('nearMeActiveDescription', { radius: radiusKm })}
              </Text>
            </View>
            <Text className="text-sm font-bold" style={{ color: primary }}>
              {t('radiusKm', { radius: radiusKm })}
            </Text>
          </View>
          <Slider.Track className="h-3 rounded-full bg-default">
            <Slider.Fill className="rounded-full bg-success" />
            <Slider.Thumb />
          </Slider.Track>
        </Slider>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {RADIUS_PRESETS.map((preset) => (
            <HeroButton
              key={preset}
              size="sm"
              variant={appliedRadiusKm === preset ? 'primary' : 'secondary'}
              onPress={() => onPresetPress(preset)}
              accessibilityState={{ selected: appliedRadiusKm === preset }}
            >
              <HeroButton.Label style={appliedRadiusKm === preset ? { color: contrastText(primary) } : undefined}>
                {t('radiusKm', { radius: preset })}
              </HeroButton.Label>
            </HeroButton>
          ))}
        </ScrollView>
      </View>

      {locationError ? (
        <Text className="text-xs font-medium leading-4 text-danger">
          {locationError}
        </Text>
      ) : null}
    </Surface>
  );
}
