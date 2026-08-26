// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Alert as HeroAlert, Button as HeroButton, Card as HeroCard, Chip, CloseButton, Spinner, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import { CameraView, useCameraPermissions } from 'expo-camera';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  createMarketplaceCollection,
  createMarketplacePickupSlot,
  createMarketplaceSavedSearch,
  createMerchantCoupon,
  deleteMarketplaceCollection,
  deleteMarketplacePickupSlot,
  deleteMarketplaceSavedSearch,
  deleteMerchantCoupon,
  getMarketplaceCollections,
  getMarketplacePickupSlots,
  getMarketplacePromotionProducts,
  getMarketplaceSavedSearches,
  getMerchantCoupons,
  getMerchantCouponRedemptions,
  getMyMarketplacePickups,
  getMyMarketplacePromotions,
  getMyMarketplaceListings,
  marketplaceHasMore,
  marketplaceNextCursor,
  promoteMarketplaceListing,
  redeemPublicMerchantCouponQr,
  scanMarketplacePickup,
  updateMerchantCoupon,
  updateMarketplacePickupSlot,
  type MarketplaceCollection,
  type MarketplaceListingItem,
  type MarketplacePickupReservation,
  type MarketplacePickupSlot,
  type MarketplacePromotion,
  type MarketplacePromotionProduct,
  type MarketplaceSavedSearch,
  type MerchantCoupon,
  type MerchantCouponQrRedemptionResult,
  type MerchantCouponRedemption,
} from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import {
  formatLegacyCouponMinorAmount,
  formatMarketplaceMinorAmount,
} from '@/lib/utils/marketplaceCurrency';

type ToolTab = 'collections' | 'savedSearches' | 'promotions' | 'pickups' | 'coupons';
type CouponDiscountType = 'percent' | 'fixed' | 'bogo';
type CouponStatus = 'draft' | 'active' | 'paused' | 'expired';
type CouponAppliesTo = 'all_listings' | 'listing_ids' | 'category_ids';
type CouponRouteMode = 'edit' | 'redemptions';
type SavedSearchAlertFrequency = 'instant' | 'daily' | 'weekly';
type SavedSearchAlertChannel = 'email' | 'push' | 'both';

interface CouponFormState {
  code: string;
  title: string;
  description: string;
  discountType: CouponDiscountType;
  discountValue: string;
  minOrderCents: string;
  maxUses: string;
  maxUsesPerMember: string;
  validFrom: string;
  validUntil: string;
  status: CouponStatus;
  appliesTo: CouponAppliesTo;
}

const TABS: ToolTab[] = ['collections', 'savedSearches', 'promotions', 'pickups', 'coupons'];
const COUPON_DISCOUNT_TYPES: CouponDiscountType[] = ['percent', 'fixed', 'bogo'];
const COUPON_STATUSES: CouponStatus[] = ['draft', 'active', 'paused', 'expired'];
const COUPON_APPLIES_TO: CouponAppliesTo[] = ['all_listings', 'listing_ids', 'category_ids'];
const SAVED_SEARCH_ALERT_FREQUENCIES: SavedSearchAlertFrequency[] = ['instant', 'daily', 'weekly'];
const SAVED_SEARCH_ALERT_CHANNELS: SavedSearchAlertChannel[] = ['push', 'email', 'both'];
const PICKUP_DEFAULT_CAPACITY = 4;
const PICKUP_MAX_CAPACITY = 1000;

const emptyCouponForm: CouponFormState = {
  code: '',
  title: '',
  description: '',
  discountType: 'percent',
  discountValue: '10',
  minOrderCents: '',
  maxUses: '',
  maxUsesPerMember: '1',
  validFrom: '',
  validUntil: '',
  status: 'draft',
  appliesTo: 'all_listings',
};

function isToolTab(value: string | string[] | undefined): value is ToolTab {
  return typeof value === 'string' && TABS.includes(value as ToolTab);
}

function couponRouteMode(value: string | string[] | undefined): CouponRouteMode | null {
  if (value === 'edit' || value === 'redemptions') return value;
  return null;
}

function routeCouponId(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string') return null;
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default function MarketplaceToolsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceToolsScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceToolsScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const { hasFeature } = useTenant();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const params = useLocalSearchParams<{ tab?: string }>();
  const initialTab = isToolTab(params.tab) ? params.tab : 'collections';
  const [tab, setTab] = useState<ToolTab>(initialTab);
  const marketplaceEnabled = hasFeature('marketplace');
  const availableTabs = useMemo(
    () => marketplaceEnabled ? TABS.filter((item) => item !== 'coupons' || hasFeature('merchant_coupons')) : [],
    [hasFeature, marketplaceEnabled],
  );

  useEffect(() => {
    if (isToolTab(params.tab)) setTab(params.tab);
  }, [params.tab]);

  useEffect(() => {
    if (!availableTabs.includes(tab)) {
      setTab(availableTabs[0] ?? 'collections');
    }
  }, [availableTabs, tab]);

  if (!marketplaceEnabled) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('tools.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 justify-center px-4">
          <EmptyState icon="construct-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
        </View>
      </SafeAreaView>
    );
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('tools.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="py-16">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('tools.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 justify-center px-4">
          <EmptyState
            icon="construct-outline"
            title={t('tools.signInTitle')}
            subtitle={t('tools.signInHint')}
            actionLabel={t('auth:login.submit')}
            onAction={() => router.push('/(auth)/login' as Href)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('tools.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={[tab]}
        keyExtractor={(item) => item}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        ListHeaderComponent={
          <>
            <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="construct-outline" size={25} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('tools.eyebrow')}</Text>
                    <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('tools.title')}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('tools.subtitle')}</Text>
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/marketplace-merchant-onboarding' as Href)}>
                    <Ionicons name="storefront-outline" size={16} color={primary} />
                    <HeroButton.Label>{t('tools.onboarding')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/marketplace-stripe-onboarding' as Href)}>
                    <Ionicons name="card-outline" size={16} color={primary} />
                    <HeroButton.Label>{t('tools.payments')}</HeroButton.Label>
                  </HeroButton>
                </View>
                <HeroButton variant="secondary" onPress={() => router.push('/(modals)/marketplace-shipping-options' as Href)}>
                  <Ionicons name="car-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('tools.shipping')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              {availableTabs.map((item) => (
                <HeroButton key={item} size="sm" variant={tab === item ? 'primary' : 'secondary'} onPress={() => setTab(item)}>
                  <HeroButton.Label>{t(`tools.tabs.${item}`)}</HeroButton.Label>
                </HeroButton>
              ))}
            </ScrollView>
          </>
        }
        renderItem={() => (
          <>
            {tab === 'collections' ? <CollectionsPanel /> : null}
            {tab === 'savedSearches' ? <SavedSearchesPanel /> : null}
            {tab === 'promotions' ? <PromotionsPanel /> : null}
            {tab === 'pickups' ? <PickupsPanel /> : null}
            {tab === 'coupons' ? <CouponsPanel /> : null}
          </>
        )}
      />
    </SafeAreaView>
  );
}

function CollectionsPanel() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { show: showToast } = useAppToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const collections = useApi(() => getMarketplaceCollections(), [], { enabled: true });

  async function create() {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      await createMarketplaceCollection({ name: name.trim(), description: description.trim() || null, is_public: false });
      setName('');
      setDescription('');
      collections.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.collections.saveFailed'), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  async function remove(item: MarketplaceCollection) {
    try {
      await deleteMarketplaceCollection(item.id);
      collections.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.collections.deleteFailed'), variant: 'danger' });
    }
  }

  return (
    <PanelCard icon="albums-outline" title={t('tools.collections.title')} subtitle={t('tools.collections.subtitle')}>
      <View className="gap-3">
        <FormInput label={t('tools.collections.name')} value={name} onChangeText={setName} placeholder={t('tools.collections.namePlaceholder')} />
        <FormInput label={t('tools.collections.description')} value={description} onChangeText={setDescription} placeholder={t('tools.collections.descriptionPlaceholder')} />
        <HeroButton variant="primary" onPress={create} isDisabled={isSaving || !name.trim()}>
          <HeroButton.Label>{t('tools.collections.create')}</HeroButton.Label>
        </HeroButton>
      </View>
      <PanelList
        isLoading={collections.isLoading}
        items={collections.data?.data ?? []}
        emptyTitle={t('tools.collections.empty')}
        renderItem={(item) => (
          <ToolRow
            key={item.id}
            icon="albums-outline"
            title={item.name}
            subtitle={item.description || t('tools.collections.count', { count: item.item_count })}
            trailing={t('tools.delete')}
            onPress={() => void remove(item)}
          />
        )}
      />
    </PanelCard>
  );
}

function SavedSearchesPanel() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { show: showToast } = useAppToast();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [alertFrequency, setAlertFrequency] = useState<SavedSearchAlertFrequency>('daily');
  const [alertChannel, setAlertChannel] = useState<SavedSearchAlertChannel>('push');
  const searches = useApi(() => getMarketplaceSavedSearches(), [], { enabled: true });

  async function create() {
    if (!name.trim()) return;
    try {
      await createMarketplaceSavedSearch({
        name: name.trim(),
        search_query: query.trim() || null,
        alert_frequency: alertFrequency,
        alert_channel: alertChannel,
      });
      setName('');
      setQuery('');
      searches.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.savedSearches.saveFailed'), variant: 'danger' });
    }
  }

  async function remove(item: MarketplaceSavedSearch) {
    try {
      await deleteMarketplaceSavedSearch(item.id);
      searches.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.savedSearches.deleteFailed'), variant: 'danger' });
    }
  }

  return (
    <PanelCard icon="notifications-outline" title={t('tools.savedSearches.title')} subtitle={t('tools.savedSearches.subtitle')}>
      <View className="gap-3">
        <FormInput label={t('tools.savedSearches.name')} value={name} onChangeText={setName} placeholder={t('tools.savedSearches.namePlaceholder')} />
        <FormInput label={t('tools.savedSearches.query')} value={query} onChangeText={setQuery} placeholder={t('tools.savedSearches.queryPlaceholder')} />
        <ChoiceGroup
          label={t('tools.savedSearches.alertFrequency')}
          values={SAVED_SEARCH_ALERT_FREQUENCIES}
          selected={alertFrequency}
          onSelect={setAlertFrequency}
          labelFor={(value) => t(`tools.savedSearches.frequency.${value}`)}
        />
        <ChoiceGroup
          label={t('tools.savedSearches.alertChannel')}
          values={SAVED_SEARCH_ALERT_CHANNELS}
          selected={alertChannel}
          onSelect={setAlertChannel}
          labelFor={(value) => t(`tools.savedSearches.channel.${value}`)}
        />
        <HeroButton variant="primary" onPress={create} isDisabled={!name.trim()}>
          <HeroButton.Label>{t('tools.savedSearches.create')}</HeroButton.Label>
        </HeroButton>
      </View>
      <PanelList
        isLoading={searches.isLoading}
        items={searches.data?.data ?? []}
        emptyTitle={t('tools.savedSearches.empty')}
        renderItem={(item) => (
          <ToolRow
            key={item.id}
            icon="search-outline"
            title={item.name}
            subtitle={item.search_query || t(`tools.savedSearches.frequency.${item.alert_frequency}`)}
            trailing={t('tools.delete')}
            onPress={() => void remove(item)}
          />
        )}
      />
    </PanelCard>
  );
}

function ChoiceGroup<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
}: {
  label: string;
  values: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {values.map((value) => (
          <HeroButton
            key={value}
            size="sm"
            variant={selected === value ? 'primary' : 'secondary'}
            onPress={() => onSelect(value)}
          >
            <HeroButton.Label>{labelFor(value)}</HeroButton.Label>
          </HeroButton>
        ))}
      </ScrollView>
    </View>
  );
}

function PromotionsPanel() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { show: showToast } = useAppToast();
  const { user } = useAuth();
  const [selectedListing, setSelectedListing] = useState<number | null>(null);
  const [promotionType, setPromotionType] = useState<MarketplacePromotionProduct['type'] | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);
  const products = useApi(() => getMarketplacePromotionProducts(), [], { enabled: true });
  const promotions = useApi(() => getMyMarketplacePromotions(), [], { enabled: true });
  const listings = usePaginatedApi<MarketplaceListingItem, Awaited<ReturnType<typeof getMyMarketplaceListings>>>(
    (cursor) => getMyMarketplaceListings(cursor, user?.id, 'active'),
    (response) => ({ items: response.data, cursor: marketplaceNextCursor(response), hasMore: marketplaceHasMore(response) }),
    [user?.id],
  );
  const promotionProducts = useMemo(() => products.data?.data ?? [], [products.data?.data]);

  useEffect(() => {
    if (!selectedListing && listings.items[0]) setSelectedListing(listings.items[0].id);
  }, [listings.items, selectedListing]);

  useEffect(() => {
    if (!promotionType && promotionProducts[0]) setPromotionType(promotionProducts[0].type);
  }, [promotionProducts, promotionType]);

  async function promote() {
    if (!selectedListing || !promotionType) return;
    setIsPromoting(true);
    try {
      await promoteMarketplaceListing(selectedListing, promotionType);
      showToast({ title: t('tools.promotions.successTitle'), description: t('tools.promotions.successHint'), variant: 'success' });
      promotions.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.promotions.failed'), variant: 'danger' });
    } finally {
      setIsPromoting(false);
    }
  }

  return (
    <PanelCard icon="megaphone-outline" title={t('tools.promotions.title')} subtitle={t('tools.promotions.subtitle')}>
      {listings.isLoading ? (
        <LoadingSpinner />
      ) : listings.items.length === 0 ? (
        <EmptyState icon="bag-handle-outline" title={t('tools.promotions.noListings')} subtitle={t('tools.promotions.noListingsHint')} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {listings.items.map((listing) => (
            <HeroButton key={listing.id} size="sm" variant={selectedListing === listing.id ? 'primary' : 'secondary'} onPress={() => setSelectedListing(listing.id)}>
              <HeroButton.Label>{listing.title}</HeroButton.Label>
            </HeroButton>
          ))}
        </ScrollView>
      )}
      {products.isLoading ? (
        <LoadingSpinner />
      ) : promotionProducts.length === 0 ? (
        <EmptyState icon="megaphone-outline" title={products.error ?? t('tools.promotions.noProducts')} subtitle={t('tools.promotions.noProductsHint')} />
      ) : (
        <View className="gap-2">
          {promotionProducts.map((product) => (
            <PromotionProductRow
              key={product.type}
              product={product}
              selected={promotionType === product.type}
              onPress={() => setPromotionType(product.type)}
            />
          ))}
        </View>
      )}
      <HeroButton variant="primary" onPress={promote} isDisabled={isPromoting || !selectedListing || !promotionType || promotionProducts.length === 0}>
        <HeroButton.Label>{t('tools.promotions.promote')}</HeroButton.Label>
      </HeroButton>
      <PanelList
        isLoading={promotions.isLoading}
        items={promotions.data?.data ?? []}
        emptyTitle={t('tools.promotions.empty')}
        renderItem={(item: MarketplacePromotion) => (
          <ToolRow
            key={item.id}
            icon="megaphone-outline"
            title={item.listing?.title ?? t(`tools.promotions.types.${item.promotion_type}`, { defaultValue: item.promotion_type })}
            subtitle={t('tools.promotions.metrics', { impressions: item.impressions ?? 0, clicks: item.clicks ?? 0 })}
          />
        )}
      />
    </PanelCard>
  );
}

function PromotionProductRow({
  product,
  selected,
  onPress,
}: {
  product: MarketplacePromotionProduct;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  const price = product.price > 0
    ? formatCurrencyAmount(Number(product.price), product.currency)
    : t('tools.promotions.free');
  return (
    <HeroButton
      variant={selected ? 'primary' : 'secondary'}
      onPress={onPress}
    >
      <View className="min-w-0 flex-1 items-start">
        <Text className="text-sm font-bold" style={{ color: selected ? '#fff' : theme.text }} numberOfLines={1}>{product.label}</Text>
        <Text className="text-xs" style={{ color: selected ? '#fff' : theme.textSecondary }} numberOfLines={2}>
          {product.description}
        </Text>
        <Text className="text-xs font-semibold" style={{ color: selected ? '#fff' : theme.textSecondary }}>
          {t('tools.promotions.productMeta', { price, duration: formatPromotionDuration(product.duration_hours, t) })}
        </Text>
      </View>
    </HeroButton>
  );
}

function formatCurrencyAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

function formatPromotionDuration(hours: number, t: (key: string, options?: Record<string, unknown>) => string): string {
  if (hours >= 24) return t('tools.promotions.durationDays', { count: Math.round(hours / 24) });
  return t('tools.promotions.durationHours', { count: hours });
}

function normalizePickupCapacity(value: string): number {
  const parsed = Number.parseInt(value.replace(/[\s,]/g, ''), 10);
  if (!Number.isFinite(parsed)) return PICKUP_DEFAULT_CAPACITY;
  return Math.min(PICKUP_MAX_CAPACITY, Math.max(1, parsed));
}

function PickupsPanel() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { show: showToast } = useAppToast();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [slotStart, setSlotStart] = useState('');
  const [slotEnd, setSlotEnd] = useState('');
  const [capacity, setCapacity] = useState(String(PICKUP_DEFAULT_CAPACITY));
  const [isRecurring, setIsRecurring] = useState(false);
  const [editingSlot, setEditingSlot] = useState<MarketplacePickupSlot | null>(null);
  const [qrCode, setQrCode] = useState('');
  const [lastScan, setLastScan] = useState<MarketplacePickupReservation | null>(null);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const slots = useApi(() => getMarketplacePickupSlots(), [], { enabled: true });
  const reservations = useApi(() => getMyMarketplacePickups(), [], { enabled: true });

  function resetSlotForm() {
    setSlotStart('');
    setSlotEnd('');
    setCapacity(String(PICKUP_DEFAULT_CAPACITY));
    setIsRecurring(false);
    setEditingSlot(null);
  }

  function openSlotEditor(slot: MarketplacePickupSlot) {
    setEditingSlot(slot);
    setSlotStart(slot.slot_start ?? '');
    setSlotEnd(slot.slot_end ?? '');
    setCapacity(String(slot.capacity ?? PICKUP_DEFAULT_CAPACITY));
    setIsRecurring(Boolean(slot.is_recurring));
  }

  async function saveSlot() {
    if (!slotStart.trim() || !slotEnd.trim()) return;
    const payload = {
      slot_start: slotStart.trim(),
      slot_end: slotEnd.trim(),
      capacity: normalizePickupCapacity(capacity),
      is_recurring: isRecurring,
      recurring_pattern: isRecurring ? 'weekly' : null,
      is_active: editingSlot?.is_active ?? true,
    };
    try {
      if (editingSlot) {
        await updateMarketplacePickupSlot(editingSlot.id, payload);
      } else {
        await createMarketplacePickupSlot(payload);
      }
      resetSlotForm();
      slots.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t(editingSlot ? 'tools.pickups.updateFailed' : 'tools.pickups.slotFailed'), variant: 'danger' });
    }
  }

  async function scan() {
    if (!qrCode.trim()) return;
    try {
      const response = await scanMarketplacePickup(qrCode.trim());
      setLastScan(response.data);
      setQrCode('');
      reservations.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.pickups.scanFailed'), variant: 'danger' });
    }
  }

  async function scanToken(token: string) {
    setQrCode(token);
    setIsScannerVisible(false);
    try {
      const response = await scanMarketplacePickup(token);
      setLastScan(response.data);
      setQrCode('');
      reservations.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.pickups.scanFailed'), variant: 'danger' });
    }
  }

  async function remove(slot: MarketplacePickupSlot) {
    try {
      await deleteMarketplacePickupSlot(slot.id);
      if (editingSlot?.id === slot.id) resetSlotForm();
      slots.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.pickups.deleteFailed'), variant: 'danger' });
    }
  }

  async function toggleSlot(slot: MarketplacePickupSlot) {
    try {
      await updateMarketplacePickupSlot(slot.id, { is_active: !slot.is_active });
      if (editingSlot?.id === slot.id) {
        setEditingSlot({ ...slot, is_active: !slot.is_active });
      }
      slots.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.pickups.updateFailed'), variant: 'danger' });
    }
  }

  return (
    <PanelCard icon="calendar-number-outline" title={t('tools.pickups.title')} subtitle={t('tools.pickups.subtitle')}>
      <View className="gap-3">
        {editingSlot ? (
          <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
            <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="create-outline" size={18} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('tools.pickups.editingTitle')}</Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{formatDateTime(editingSlot.slot_start)}</Text>
            </View>
          </Surface>
        ) : null}
        <FormInput label={t('tools.pickups.start')} value={slotStart} onChangeText={setSlotStart} placeholder={t('tools.pickups.startPlaceholder')} />
        <FormInput label={t('tools.pickups.end')} value={slotEnd} onChangeText={setSlotEnd} placeholder={t('tools.pickups.endPlaceholder')} />
        <FormInput label={t('tools.pickups.capacityLabel')} value={capacity} onChangeText={setCapacity} placeholder={t('tools.pickups.capacityPlaceholder')} keyboardType="decimal-pad" />
        <HeroButton
          variant={isRecurring ? 'primary' : 'secondary'}
          onPress={() => setIsRecurring((current) => !current)}
        >
          <HeroButton.Label>{t('tools.pickups.recurringWeekly')}</HeroButton.Label>
        </HeroButton>
        <HeroButton variant="primary" onPress={saveSlot} isDisabled={!slotStart.trim() || !slotEnd.trim()}>
          <HeroButton.Label>{editingSlot ? t('tools.pickups.updateSlot') : t('tools.pickups.createSlot')}</HeroButton.Label>
        </HeroButton>
        {editingSlot ? (
          <HeroButton variant="secondary" onPress={resetSlotForm}>
            <HeroButton.Label>{t('tools.pickups.cancelEdit')}</HeroButton.Label>
          </HeroButton>
        ) : null}
        <FormInput label={t('tools.pickups.qr')} value={qrCode} onChangeText={setQrCode} placeholder={t('tools.pickups.qrPlaceholder')} />
        <ScanButton label={t('tools.pickups.scanCamera')} primary={primary} onPress={() => setIsScannerVisible(true)} />
        <HeroButton variant="secondary" onPress={scan} isDisabled={!qrCode.trim()}>
          <HeroButton.Label>{t('tools.pickups.scan')}</HeroButton.Label>
        </HeroButton>
        {lastScan ? (
          <HeroAlert status="success">
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>{t('tools.pickups.lastScan')}</HeroAlert.Title>
              <HeroAlert.Description>
                {t('tools.pickups.lastScanDetail', { order: lastScan.order_id, status: t(`pickup.status.${lastScan.status}`, { defaultValue: lastScan.status }) })}
              </HeroAlert.Description>
            </HeroAlert.Content>
            <CloseButton onPress={() => setLastScan(null)} iconProps={{ size: 16, color: primary }} />
          </HeroAlert>
        ) : null}
      </View>
      <QrScannerSheet
        visible={isScannerVisible}
        title={t('tools.pickups.scanCamera')}
        onClose={() => setIsScannerVisible(false)}
        onScanned={(token) => void scanToken(token)}
      />
      <PanelList
        isLoading={slots.isLoading}
        items={slots.data?.data ?? []}
        emptyTitle={t('tools.pickups.emptySlots')}
        renderItem={(item: MarketplacePickupSlot) => (
          <PickupSlotToolCard
            key={item.id}
            item={item}
            onEdit={() => openSlotEditor(item)}
            onToggle={() => void toggleSlot(item)}
            onDelete={() => void remove(item)}
          />
        )}
      />
      <PanelList
        isLoading={reservations.isLoading}
        items={reservations.data?.data ?? []}
        emptyTitle={t('tools.pickups.emptyReservations')}
        renderItem={(item: MarketplacePickupReservation) => (
          <ToolRow key={item.id} icon="qr-code-outline" title={t('tools.pickups.order', { order: item.order_id })} subtitle={t(`pickup.status.${item.status}`, { defaultValue: item.status })} />
        )}
      />
    </PanelCard>
  );
}

function PickupSlotToolCard({
  item,
  onEdit,
  onToggle,
  onDelete,
}: {
  item: MarketplacePickupSlot;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const statusLabel = item.is_active ? t('tools.pickups.active') : t('tools.pickups.inactive');

  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
      <View className="flex-row items-start gap-3">
        <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Ionicons name="time-outline" size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{formatDateTime(item.slot_start)}</Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {t('tools.pickups.capacity', { booked: item.booked_count, capacity: item.capacity })}
          </Text>
        </View>
        <Chip size="sm" variant="secondary" color={item.is_active ? 'success' : 'default'}>
          <Chip.Label>{statusLabel}</Chip.Label>
        </Chip>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <HeroButton className="flex-1" size="sm" variant="secondary" onPress={onEdit}>
          <HeroButton.Label>{t('tools.pickups.edit')}</HeroButton.Label>
        </HeroButton>
        <HeroButton className="flex-1" size="sm" variant="secondary" onPress={onToggle}>
          <HeroButton.Label>{item.is_active ? t('tools.pickups.pause') : t('tools.pickups.activate')}</HeroButton.Label>
        </HeroButton>
        <HeroButton isIconOnly size="sm" variant="danger-soft" onPress={onDelete} accessibilityLabel={t('common:buttons.delete')}>
          <Ionicons name="trash-outline" size={16} color={theme.error} />
        </HeroButton>
      </View>
    </Surface>
  );
}

function CouponsPanel() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { tenant } = useTenant();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const params = useLocalSearchParams<{ couponId?: string; couponMode?: string }>();
  const targetCouponId = routeCouponId(params.couponId);
  const targetCouponMode = couponRouteMode(params.couponMode);
  const [form, setForm] = useState<CouponFormState>(emptyCouponForm);
  const [editingCoupon, setEditingCoupon] = useState<MerchantCoupon | null>(null);
  const [redemptionCoupon, setRedemptionCoupon] = useState<MerchantCoupon | null>(null);
  const [redemptions, setRedemptions] = useState<MerchantCouponRedemption[]>([]);
  const [redeemToken, setRedeemToken] = useState('');
  const [lastQrRedemption, setLastQrRedemption] = useState<MerchantCouponQrRedemptionResult | null>(null);
  const [isLoadingRedemptions, setIsLoadingRedemptions] = useState(false);
  const [isSavingCoupon, setIsSavingCoupon] = useState(false);
  const [isRedeemingQr, setIsRedeemingQr] = useState(false);
  const [isScannerVisible, setIsScannerVisible] = useState(false);
  const [handledRouteCouponKey, setHandledRouteCouponKey] = useState<string | null>(null);
  const coupons = useApi(() => getMerchantCoupons(), [], { enabled: true });

  function updateForm(key: keyof CouponFormState, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const openEdit = useCallback((coupon?: MerchantCoupon) => {
    setEditingCoupon(coupon ?? null);
    setForm(coupon ? {
      code: coupon.code ?? '',
      title: coupon.title ?? '',
      description: coupon.description ?? '',
      discountType: coupon.discount_type ?? 'percent',
      discountValue: coupon.discount_value != null ? String(coupon.discount_value) : '',
      minOrderCents: coupon.min_order_cents != null ? String(coupon.min_order_cents) : '',
      maxUses: coupon.max_uses != null ? String(coupon.max_uses) : '',
      maxUsesPerMember: coupon.max_uses_per_member != null ? String(coupon.max_uses_per_member) : '1',
      validFrom: coupon.valid_from ? String(coupon.valid_from).slice(0, 16) : '',
      validUntil: coupon.valid_until ? String(coupon.valid_until).slice(0, 16) : '',
      status: coupon.status ?? 'active',
      appliesTo: coupon.applies_to ?? 'all_listings',
    } : emptyCouponForm);
  }, []);

  async function save() {
    if (!form.title.trim()) return;
    const payload = couponPayload(form);
    setIsSavingCoupon(true);
    try {
      if (editingCoupon) {
        await updateMerchantCoupon(editingCoupon.id, payload);
      } else {
        await createMerchantCoupon(payload);
      }
      setEditingCoupon(null);
      setForm(emptyCouponForm);
      coupons.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.coupons.saveFailed'), variant: 'danger' });
    } finally {
      setIsSavingCoupon(false);
    }
  }

  function remove(item: MerchantCoupon) {
    confirm({
      title: t('tools.coupons.deleteTitle'),
      message: t('tools.coupons.deleteMessage', { code: item.code }),
      confirmLabel: t('tools.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteMerchantCoupon(item.id);
          coupons.refresh();
        } catch (err) {
          showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.coupons.deleteFailed'), variant: 'danger' });
        }
      },
    });
  }

  const openRedemptions = useCallback(async (item: MerchantCoupon) => {
    setRedemptionCoupon(item);
    setRedemptions([]);
    setIsLoadingRedemptions(true);
    try {
      const response = await getMerchantCouponRedemptions(item.id);
      setRedemptions(response.data.items);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.coupons.redemptionsFailed'), variant: 'danger' });
    } finally {
      setIsLoadingRedemptions(false);
    }
  }, [t, showToast]);

  async function redeemQr() {
    const token = redeemToken.trim();
    if (!token) return;
    setIsRedeemingQr(true);
    try {
      const response = await redeemPublicMerchantCouponQr(token);
      setLastQrRedemption(response.data);
      setRedeemToken('');
      coupons.refresh();
      if (redemptionCoupon) {
        void openRedemptions(redemptionCoupon);
      }
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.coupons.qrRedeemFailed'), variant: 'danger' });
    } finally {
      setIsRedeemingQr(false);
    }
  }

  async function redeemScannedQr(token: string) {
    setRedeemToken(token);
    setIsScannerVisible(false);
    setIsRedeemingQr(true);
    try {
      const response = await redeemPublicMerchantCouponQr(token);
      setLastQrRedemption(response.data);
      setRedeemToken('');
      coupons.refresh();
      if (redemptionCoupon) {
        void openRedemptions(redemptionCoupon);
      }
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('tools.coupons.qrRedeemFailed'), variant: 'danger' });
    } finally {
      setIsRedeemingQr(false);
    }
  }

  useEffect(() => {
    if (!targetCouponId || !targetCouponMode) return;
    const routeKey = `${targetCouponMode}:${targetCouponId}`;
    if (handledRouteCouponKey === routeKey) return;

    const targetCoupon = (coupons.data?.data.items ?? []).find((item) => item.id === targetCouponId);
    if (!targetCoupon) return;

    setHandledRouteCouponKey(routeKey);
    if (targetCouponMode === 'edit') {
      setRedemptionCoupon(null);
      openEdit(targetCoupon);
      return;
    }
    void openRedemptions(targetCoupon);
  }, [coupons.data?.data.items, handledRouteCouponKey, openEdit, openRedemptions, targetCouponId, targetCouponMode]);

  return (
    <PanelCard icon="ticket-outline" title={t('tools.coupons.title')} subtitle={t('tools.coupons.subtitle')}>
      <View className="gap-3">
        {editingCoupon ? (
          <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
            <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="create-outline" size={18} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>
                {t('tools.coupons.editingTitle')}
              </Text>
              <Text className="font-mono text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {editingCoupon.code}
              </Text>
            </View>
          </Surface>
        ) : null}
        <FormInput label={t('tools.coupons.code')} value={form.code} onChangeText={(value) => updateForm('code', value.toUpperCase())} placeholder={t('tools.coupons.codePlaceholder')} />
        <FormInput label={t('tools.coupons.name')} value={form.title} onChangeText={(value) => updateForm('title', value)} placeholder={t('tools.coupons.namePlaceholder')} />
        <FormInput label={t('tools.coupons.description')} value={form.description} onChangeText={(value) => updateForm('description', value)} placeholder={t('tools.coupons.descriptionPlaceholder')} multiline />
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('tools.coupons.discountType')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {COUPON_DISCOUNT_TYPES.map((type) => (
              <HeroButton key={type} size="sm" variant={form.discountType === type ? 'primary' : 'secondary'} onPress={() => updateForm('discountType', type)}>
                <HeroButton.Label>{t(`tools.coupons.discountTypes.${type}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </ScrollView>
        </View>
        <FormInput
          label={form.discountType === 'fixed' ? t('tools.coupons.valueFixed') : t('tools.coupons.value')}
          value={form.discountValue}
          onChangeText={(value) => updateForm('discountValue', value)}
          placeholder={form.discountType === 'fixed' ? t('tools.coupons.valueFixedPlaceholder') : t('tools.coupons.valuePlaceholder')}
          keyboardType="decimal-pad"
        />
        <FormInput
          label={t('tools.coupons.minOrder')}
          value={form.minOrderCents}
          onChangeText={(value) => updateForm('minOrderCents', value)}
          placeholder={t('tools.coupons.minOrderPlaceholder')}
          keyboardType="decimal-pad"
        />
        <View className="flex-row gap-2">
          <View className="min-w-0 flex-1">
            <FormInput label={t('tools.coupons.maxUses')} value={form.maxUses} onChangeText={(value) => updateForm('maxUses', value)} placeholder={t('tools.coupons.maxUsesPlaceholder')} keyboardType="decimal-pad" />
          </View>
          <View className="min-w-0 flex-1">
            <FormInput label={t('tools.coupons.perMember')} value={form.maxUsesPerMember} onChangeText={(value) => updateForm('maxUsesPerMember', value)} placeholder={t('tools.coupons.perMemberPlaceholder')} keyboardType="decimal-pad" />
          </View>
        </View>
        <View className="flex-row gap-2">
          <View className="min-w-0 flex-1">
            <FormInput label={t('tools.coupons.validFrom')} value={form.validFrom} onChangeText={(value) => updateForm('validFrom', value)} placeholder={t('tools.coupons.datePlaceholder')} />
          </View>
          <View className="min-w-0 flex-1">
            <FormInput label={t('tools.coupons.validUntil')} value={form.validUntil} onChangeText={(value) => updateForm('validUntil', value)} placeholder={t('tools.coupons.datePlaceholder')} />
          </View>
      </View>
      <View className="gap-2">
          <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('tools.coupons.status')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {COUPON_STATUSES.map((status) => (
              <HeroButton key={status} size="sm" variant={form.status === status ? 'primary' : 'secondary'} onPress={() => updateForm('status', status)}>
                <HeroButton.Label>{t(`tools.coupons.statuses.${status}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </ScrollView>
        </View>
        <View className="gap-2">
          <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('tools.coupons.appliesTo')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {COUPON_APPLIES_TO.map((scope) => (
              <HeroButton key={scope} size="sm" variant={form.appliesTo === scope ? 'primary' : 'secondary'} onPress={() => updateForm('appliesTo', scope)}>
                <HeroButton.Label>{t(`tools.coupons.applies.${scope}`)}</HeroButton.Label>
              </HeroButton>
            ))}
          </ScrollView>
        </View>
        <HeroButton variant="primary" onPress={save} isDisabled={isSavingCoupon || !form.title.trim()}>
          {isSavingCoupon ? <Spinner size="sm" /> : null}
          <HeroButton.Label>{isSavingCoupon ? t('tools.coupons.saving') : editingCoupon ? t('tools.coupons.update') : t('tools.coupons.create')}</HeroButton.Label>
        </HeroButton>
        {editingCoupon ? (
          <HeroButton variant="secondary" onPress={() => openEdit()}>
            <HeroButton.Label>{t('tools.coupons.cancelEdit')}</HeroButton.Label>
          </HeroButton>
        ) : null}
      </View>
      <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="qr-code-outline" size={18} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('tools.coupons.qrRedeemTitle')}</Text>
            <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>{t('tools.coupons.qrRedeemHint')}</Text>
          </View>
        </View>
        <FormInput label={t('tools.coupons.qrToken')} value={redeemToken} onChangeText={setRedeemToken} placeholder={t('tools.coupons.qrTokenPlaceholder')} />
        <ScanButton label={t('tools.coupons.scanCamera')} primary={primary} onPress={() => setIsScannerVisible(true)} />
        <HeroButton variant="secondary" onPress={redeemQr} isDisabled={isRedeemingQr || !redeemToken.trim()}>
          {isRedeemingQr ? <Spinner size="sm" /> : null}
          <HeroButton.Label>{isRedeemingQr ? t('tools.coupons.redeemingQr') : t('tools.coupons.redeemQr')}</HeroButton.Label>
        </HeroButton>
        {lastQrRedemption ? (
          <HeroAlert status="success">
            <HeroAlert.Indicator />
            <HeroAlert.Content>
              <HeroAlert.Title>{t('tools.coupons.qrRedeemed')}</HeroAlert.Title>
              <HeroAlert.Description>
                {t('tools.coupons.qrRedeemedDetail', {
                  coupon: lastQrRedemption.coupon_id,
                  date: lastQrRedemption.redeemed_at ? new Date(lastQrRedemption.redeemed_at).toLocaleString() : t('tools.coupons.dateUnknown'),
                })}
              </HeroAlert.Description>
            </HeroAlert.Content>
            <CloseButton onPress={() => setLastQrRedemption(null)} iconProps={{ size: 16, color: primary }} />
          </HeroAlert>
        ) : null}
      </Surface>
      <PanelList
        isLoading={coupons.isLoading}
        items={coupons.data?.data.items ?? []}
        emptyTitle={t('tools.coupons.empty')}
        renderItem={(item: MerchantCoupon) => (
          <CouponToolCard
            key={item.id}
            item={item}
            currency={tenant?.currency}
            onEdit={() => openEdit(item)}
            onRedemptions={() => void openRedemptions(item)}
            onDelete={() => void remove(item)}
          />
        )}
      />

      <QrScannerSheet
        visible={isScannerVisible}
        title={t('tools.coupons.scanCamera')}
        onClose={() => setIsScannerVisible(false)}
        onScanned={(token) => void redeemScannedQr(token)}
      />

      <BottomSheet visible={Boolean(redemptionCoupon)} onClose={() => setRedemptionCoupon(null)} snapPoints={['68%', '92%']}>
        <Surface variant="default" className="max-h-[78%] rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('tools.coupons.redemptionsTitle')}</Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }}>{redemptionCoupon?.title ?? ''}</Text>
              </View>
              <CloseButton onPress={() => setRedemptionCoupon(null)} iconProps={{ size: 20, color: primary }} />
            </View>
            {isLoadingRedemptions ? (
              <View className="py-10"><LoadingSpinner /></View>
            ) : redemptions.length === 0 ? (
              <EmptyState icon="receipt-outline" title={t('tools.coupons.noRedemptions')} />
            ) : (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                {redemptions.map((redemption) => (
                  <RedemptionRow key={redemption.id} redemption={redemption} currency={tenant?.currency} />
                ))}
              </ScrollView>
            )}
        </Surface>
      </BottomSheet>
      {confirmDialog}
    </PanelCard>
  );
}

function RedemptionRow({
  redemption,
  currency,
}: {
  redemption: MerchantCouponRedemption;
  currency?: string;
}) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  const primary = usePrimaryColor();
  const redeemedAt = redemption.redeemed_at ? new Date(redemption.redeemed_at).toLocaleString() : t('tools.coupons.dateUnknown');

  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
      <View className="flex-row items-start gap-3">
        <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Ionicons name="receipt-outline" size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>
            {t('tools.coupons.redemptionOrder', { order: redemption.order_id ?? '-' })}
          </Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
            {t('tools.coupons.redemptionValue', {
              value: formatMarketplaceMinorAmount(redemption.discount_applied_cents, currency),
              date: redeemedAt,
            })}
          </Text>
        </View>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Chip size="sm" variant="secondary">
          <Chip.Label>{t('tools.coupons.redemptionMember', { member: redemption.user_id })}</Chip.Label>
        </Chip>
        {redemption.redemption_method ? (
          <Chip size="sm" variant="secondary">
            <Chip.Label>{t('tools.coupons.redemptionMethod', { method: redemption.redemption_method })}</Chip.Label>
          </Chip>
        ) : null}
      </View>
    </Surface>
  );
}

function CouponToolCard({
  item,
  currency,
  onEdit,
  onRedemptions,
  onDelete,
}: {
  item: MerchantCoupon;
  currency?: string;
  onEdit: () => void;
  onRedemptions: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const usageCount = item.usage_count ?? item.used_count ?? 0;
  const statusLabel = t(`tools.coupons.statuses.${item.status}`, { defaultValue: item.status });
  const appliesLabel = t(`tools.coupons.applies.${item.applies_to ?? 'all_listings'}`, { defaultValue: item.applies_to ?? '' });

  return (
    <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
      <View className="flex-row items-start gap-3">
        <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Ionicons name="ticket-outline" size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="min-w-0 flex-1 text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{item.title}</Text>
            <Chip size="sm" variant="secondary" style={{ backgroundColor: withAlpha(theme.success, 0.15) }}>
              <Chip.Label style={{ color: theme.success }}>{couponDiscountLabel(item, currency, t)}</Chip.Label>
            </Chip>
          </View>
          <Text className="font-mono text-xs font-semibold" style={{ color: primary }}>{item.code}</Text>
          {item.description ? <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{item.description}</Text> : null}
        </View>
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Chip size="sm" variant="secondary">
          <Chip.Label>{statusLabel}</Chip.Label>
        </Chip>
        <Chip size="sm" variant="secondary">
          <Chip.Label>{t('tools.coupons.usageCount', { count: usageCount })}</Chip.Label>
        </Chip>
        <Chip size="sm" variant="secondary">
          <Chip.Label>{item.valid_until ? t('tools.coupons.validUntilShort', { date: new Date(item.valid_until).toLocaleDateString(dateLocale()) }) : t('tools.coupons.noExpiry')}</Chip.Label>
        </Chip>
        <Chip size="sm" variant="secondary">
          <Chip.Label>{t('tools.coupons.appliesLabel', { scope: appliesLabel })}</Chip.Label>
        </Chip>
      </View>
      <View className="flex-row gap-2">
        <HeroButton className="flex-1" size="sm" variant="secondary" onPress={onEdit}>
          <HeroButton.Label>{t('tools.coupons.edit')}</HeroButton.Label>
        </HeroButton>
        <HeroButton className="flex-1" size="sm" variant="secondary" onPress={onRedemptions}>
          <HeroButton.Label>{t('tools.coupons.redemptions')}</HeroButton.Label>
        </HeroButton>
        <HeroButton isIconOnly size="sm" variant="danger-soft" onPress={onDelete} accessibilityLabel={t('common:buttons.delete')}>
          <Ionicons name="trash-outline" size={16} color={theme.error} />
        </HeroButton>
      </View>
    </Surface>
  );
}

function couponPayload(form: CouponFormState) {
  return {
    code: form.code.trim() || null,
    title: form.title.trim(),
    description: form.description.trim() || null,
    discount_type: form.discountType,
    discount_value: form.discountType === 'bogo' ? null : Number(form.discountValue) || 0,
    min_order_cents: form.minOrderCents ? Number(form.minOrderCents) : null,
    max_uses: form.maxUses ? Number(form.maxUses) : null,
    max_uses_per_member: form.maxUsesPerMember ? Number(form.maxUsesPerMember) : 1,
    valid_from: form.validFrom.trim() || null,
    valid_until: form.validUntil.trim() || null,
    status: form.status,
    applies_to: form.appliesTo,
  };
}

function couponDiscountLabel(
  coupon: MerchantCoupon,
  currency: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (coupon.discount_type === 'percent') {
    return t('tools.coupons.percentValue', { value: coupon.discount_value ?? 0 });
  }
  if (coupon.discount_type === 'fixed') {
    return t('publicCoupons.fixedValue', {
      value: formatLegacyCouponMinorAmount(coupon.discount_value ?? 0, currency),
    });
  }
  return t('publicCoupons.bogo');
}

function PanelCard({
  icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name={icon} size={23} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{title}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{subtitle}</Text>
          </View>
        </View>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}

function PanelList<T>({
  isLoading,
  items,
  emptyTitle,
  renderItem,
}: {
  isLoading: boolean;
  items: T[];
  emptyTitle: string;
  renderItem: (item: T) => React.ReactNode;
}) {
  if (isLoading) {
    return <LoadingSpinner />;
  }
  if (items.length === 0) {
    return <EmptyState icon="file-tray-outline" title={emptyTitle} />;
  }
  return <View className="gap-2">{items.map(renderItem)}</View>;
}

function ToolRow({
  icon,
  title,
  subtitle,
  trailing,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle?: string | null;
  trailing?: string;
  onPress?: () => void;
}) {
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
      <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
        <Ionicons name={icon} size={18} color={primary} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {trailing && onPress ? (
        <HeroButton size="sm" variant="secondary" onPress={onPress}>
          <HeroButton.Label>{trailing}</HeroButton.Label>
        </HeroButton>
      ) : null}
    </Surface>
  );
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = 'default',
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  keyboardType?: 'default' | 'decimal-pad';
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <Input
        className={`${multiline ? 'min-h-24' : 'min-h-12'} text-sm`}
        style={{ color: theme.text, textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        multiline={multiline}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function QrScannerSheet({
  visible,
  title,
  onClose,
  onScanned,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  onScanned: (token: string) => void;
}) {
  const { t } = useTranslation(['marketplace', 'common']);
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  useEffect(() => {
    if (!visible) {
      setScanned(false);
      return;
    }
    if (!permission?.granted) {
      void requestPermission();
    }
  }, [permission?.granted, requestPermission, visible]);

  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoints={['60%', '88%']} title={title}>
      <View className="gap-3">
        {permission?.granted ? (
          <View className="h-80 overflow-hidden rounded-panel-inner">
            <CameraView
              style={{ flex: 1 }}
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={scanned ? undefined : (event) => {
                const token = event.data.trim();
                if (!token) return;
                setScanned(true);
                onScanned(token);
              }}
            />
          </View>
        ) : (
          <Surface variant="secondary" className="gap-2 rounded-panel-inner p-4">
            <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('tools.scanner.permissionTitle')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('tools.scanner.permissionHint')}</Text>
            <HeroButton variant="primary" onPress={() => void requestPermission()}>
              <HeroButton.Label>{t('tools.scanner.permissionAction')}</HeroButton.Label>
            </HeroButton>
          </Surface>
        )}
      </View>
    </BottomSheet>
  );
}

function ScanButton({ label, primary, onPress }: { label: string; primary: string; onPress: () => void }) {
  return (
    <HeroButton
      className="min-h-11 flex-row items-center justify-center gap-2 rounded-panel-inner border px-4"
      accessibilityLabel={label}
      onPress={onPress}
      variant="secondary"
      style={{
        borderColor: withAlpha(primary, 0.24),
        backgroundColor: withAlpha(primary, 0.08),
      }}
    >
      <Ionicons name="scan-outline" size={16} color={primary} />
      <HeroButton.Label className="text-sm font-bold" style={{ color: primary }}>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function formatDateTime(value: string): string {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
