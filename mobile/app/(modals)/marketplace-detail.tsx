// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Image, Linking, ScrollView, Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { ResizeMode, Video } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { Button as HeroButton, CloseButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import * as Haptics from '@/lib/haptics';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { formatMarketplacePrice } from '@/components/marketplace/MarketplaceListingCard';
import {
  addMarketplaceCollectionItem,
  confirmMarketplacePayment,
  createMarketplaceOrder,
  createMarketplacePaymentIntent,
  getMarketplaceListingPickupSlots,
  getMarketplaceSellerShippingOptions,
  getMarketplaceSellerListings,
  getMarketplaceCollections,
  getMarketplaceListing,
  makeMarketplaceOffer,
  reportMarketplaceListing,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  validateMarketplaceCoupon,
  type MarketplaceCollection,
  type MarketplaceListingDetail,
  type MarketplaceListingItem,
  type MarketplacePickupSlotOption,
  type MarketplaceShippingOption,
} from '@/lib/api/marketplace';
import { APP_URL } from '@/lib/constants';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useAuth } from '@/lib/hooks/useAuth';
import { presentMarketplacePayment } from '@/lib/payments/marketplacePayment';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import AccentIcon from '@/components/ui/AccentIcon';

export default function MarketplaceDetailRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceDetailScreen />
    </ModalErrorBoundary>
  );
}

type ReportReason = 'counterfeit' | 'illegal' | 'unsafe' | 'misleading' | 'discrimination' | 'ip_violation' | 'other';
const REPORT_REASONS: ReportReason[] = ['counterfeit', 'illegal', 'unsafe', 'misleading', 'discrimination', 'ip_violation', 'other'];
type FulfilmentChoice = 'pickup' | `shipping:${number}`;

function MarketplaceDetailScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const params = useLocalSearchParams<{ id?: string; offer_id?: string; offer_amount?: string }>();
  const primary = usePrimaryColor();
  const { hasFeature, tenant } = useTenant();
  const theme = useTheme();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();
  const listingId = Number(params.id);
  const safeId = Number.isFinite(listingId) && listingId > 0 ? listingId : 0;
  const parsedOfferId = Number(params.offer_id);
  const acceptedOfferId = Number.isInteger(parsedOfferId) && parsedOfferId > 0 ? parsedOfferId : null;
  const parsedOfferAmount = Number(params.offer_amount);
  const acceptedOfferAmount = Number.isFinite(parsedOfferAmount) && parsedOfferAmount >= 0
    ? parsedOfferAmount
    : null;
  const [listing, setListing] = useState<MarketplaceListingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [activeImage, setActiveImage] = useState(0);
  const [offerOpen, setOfferOpen] = useState(false);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [collections, setCollections] = useState<MarketplaceCollection[]>([]);
  const [isCollectionLoading, setIsCollectionLoading] = useState(false);
  const [pickupSlots, setPickupSlots] = useState<MarketplacePickupSlotOption[]>([]);
  const [shippingOptions, setShippingOptions] = useState<MarketplaceShippingOption[]>([]);
  const [isShippingLoading, setIsShippingLoading] = useState(false);
  const [shippingLoadFailed, setShippingLoadFailed] = useState(false);
  const [sellerListings, setSellerListings] = useState<MarketplaceListingItem[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [fulfilmentChoice, setFulfilmentChoice] = useState<FulfilmentChoice | null>(null);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'cash' | 'time_credits'>('cash');
  const [offerAmount, setOfferAmount] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [reportReason, setReportReason] = useState<ReportReason>('misleading');
  const [reportDescription, setReportDescription] = useState('');
  const checkoutIdempotencyKeyRef = useRef<string | null>(null);

  useEffect(() => {
    checkoutIdempotencyKeyRef.current = null;
    setCheckoutPaymentMethod('cash');
    void loadListing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeId, acceptedOfferId]);

  useEffect(() => {
    if (!listing || listing.is_own || (user?.id && listing.user?.id === user.id)) return;
    let mounted = true;
    getMarketplaceListingPickupSlots(listing.id, acceptedOfferId)
      .then((response) => {
        if (mounted) setPickupSlots(response.data);
      })
      .catch(() => {
        if (mounted) setPickupSlots([]);
      });
    return () => {
      mounted = false;
    };
  }, [listing, user?.id, acceptedOfferId]);

  useEffect(() => {
    const deliveryMethod = listing?.delivery_method;
    const supportsShipping = deliveryMethod === 'shipping' || deliveryMethod === 'both';
    const supportsPickup = Boolean(listing?.local_pickup || deliveryMethod === 'pickup' || deliveryMethod === 'both');
    const sellerUserId = listing?.user?.id;

    if (!listing || !supportsShipping || !sellerUserId) {
      setShippingOptions([]);
      setShippingLoadFailed(false);
      setIsShippingLoading(false);
      setFulfilmentChoice(supportsPickup ? 'pickup' : null);
      return undefined;
    }

    let mounted = true;
    setIsShippingLoading(true);
    setShippingLoadFailed(false);
    setFulfilmentChoice(supportsPickup ? 'pickup' : null);

    getMarketplaceSellerShippingOptions(sellerUserId)
      .then((response) => {
        if (!mounted) return;
        const hasCashCheckout = listing.price_type === 'fixed' && Number(listing.price ?? 0) > 0;
        const hasTimeCreditCheckout = Number(listing.time_credit_price ?? 0) > 0;
        const requiresFreeShipping = listing.price_type === 'free'
          || (hasTimeCreditCheckout && (!hasCashCheckout || checkoutPaymentMethod === 'time_credits'));
        const activeOptions = response.data.filter((option) => option.is_active !== false
          && (!requiresFreeShipping || Number(option.price ?? 0) <= 0));
        setShippingOptions(activeOptions);
        if (!supportsPickup) {
          const defaultOption = activeOptions.find((option) => option.is_default) ?? activeOptions[0];
          setFulfilmentChoice(defaultOption ? `shipping:${defaultOption.id}` : null);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setShippingOptions([]);
        setShippingLoadFailed(true);
        if (!supportsPickup) setFulfilmentChoice(null);
      })
      .finally(() => {
        if (mounted) setIsShippingLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [checkoutPaymentMethod, listing?.delivery_method, listing?.id, listing?.local_pickup, listing?.price, listing?.price_type, listing?.time_credit_price, listing?.user?.id]);

  useEffect(() => {
    const sellerId = listing?.user?.id;
    if (!listing || !sellerId) {
      setSellerListings([]);
      return undefined;
    }

    let mounted = true;
    getMarketplaceSellerListings(sellerId, null, 4)
      .then((response) => {
        if (mounted) setSellerListings(response.data.filter((item) => item.id !== listing.id).slice(0, 3));
      })
      .catch(() => {
        if (mounted) setSellerListings([]);
      });
    return () => {
      mounted = false;
    };
  }, [listing]);

  async function loadListing() {
    if (!safeId) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const response = await getMarketplaceListing(safeId, acceptedOfferId);
      setListing(response.data);
    } catch {
      setListing(null);
    } finally {
      setIsLoading(false);
    }
  }

  if (!safeId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="bag-handle-outline" title={t('detail.invalid')} subtitle={t('detail.invalidHint')} />
      </SafeAreaView>
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 items-center justify-center" style={{ flex: 1 }}>
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!listing) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('detail.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState
          icon="bag-handle-outline"
          title={t('detail.notFound')}
          subtitle={t('detail.notFoundHint')}
          actionLabel={t('actions.browse')}
          onAction={() => router.replace('/(modals)/marketplace' as Href)}
        />
      </SafeAreaView>
    );
  }

  const images = listing.images?.length ? listing.images : listing.image ? [listing.image] : [];
  const activeImageUrl = resolveImageUrl(images[activeImage]?.url ?? images[activeImage]?.thumbnail_url);
  const videoUrl = resolveImageUrl(listing.video_url);
  const accent = listing.price_type === 'free' ? theme.success : listing.is_promoted ? theme.warning : primary;
  const isAcceptedOfferCheckout = acceptedOfferId !== null && acceptedOfferAmount !== null;
  const checkoutMoneyPrice = isAcceptedOfferCheckout ? acceptedOfferAmount : Number(listing.price ?? 0);
  const priceLabel = formatMarketplacePrice(
    checkoutMoneyPrice,
    isAcceptedOfferCheckout ? 'fixed' : listing.price_type,
    listing.price_currency,
    t('common.free'),
    tenant?.currency,
  );
  const isOwner = Boolean(listing.is_own || (user?.id && listing.user?.id === user.id));
  const isActiveNonOwner = !isOwner && (
    listing.status === 'active'
    || (isAcceptedOfferCheckout && listing.status === 'reserved')
  );
  const isTimeCreditListing = !isAcceptedOfferCheckout && Number(listing.time_credit_price ?? 0) > 0;
  const isCashCheckoutEligible = isAcceptedOfferCheckout
    ? checkoutMoneyPrice > 0
    : listing.price_type === 'fixed' && Number(listing.price ?? 0) > 0;
  const isFreeCheckoutEligible = !isAcceptedOfferCheckout && listing.price_type === 'free';
  const isHybridCheckout = isCashCheckoutEligible && isTimeCreditListing;
  const effectivePaymentMethod: 'cash' | 'time_credits' | 'free' = isAcceptedOfferCheckout
    ? 'cash'
    : isFreeCheckoutEligible
    ? 'free'
    : isTimeCreditListing && !isCashCheckoutEligible
      ? 'time_credits'
      : checkoutPaymentMethod;
  const canBuy = isActiveNonOwner
    && (isCashCheckoutEligible || isFreeCheckoutEligible || isTimeCreditListing);
  const supportsShipping = listing.delivery_method === 'shipping' || listing.delivery_method === 'both';
  const supportsPickup = Boolean(listing.local_pickup || listing.delivery_method === 'pickup' || listing.delivery_method === 'both');
  const selectedShippingOptionId = fulfilmentChoice?.startsWith('shipping:')
    ? Number(fulfilmentChoice.slice('shipping:'.length))
    : null;
  const fulfilmentReady = !supportsShipping
    || fulfilmentChoice === 'pickup'
    || (selectedShippingOptionId !== null && shippingOptions.some((option) => option.id === selectedShippingOptionId));
  const pickupSlotReady = fulfilmentChoice !== 'pickup'
    || pickupSlots.length === 0
    || selectedSlotId !== null;
  const couponsEnabled = !isAcceptedOfferCheckout && hasFeature('merchant_coupons');
  const templateEntries = getListingTemplateEntries(listing.template_data);

  async function handleToggleSave() {
    if (!listing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const previous = listing;
    setListing({ ...listing, is_saved: !listing.is_saved });
    try {
      if (listing.is_saved) await unsaveMarketplaceListing(listing.id);
      else await saveMarketplaceListing(listing.id);
    } catch {
      setListing(previous);
      showToast({ title: t('common:errors.alertTitle'), description: t('common.save_failed'), variant: 'danger' });
    }
  }

  async function handleBuyNow() {
    if (!listing || isActionLoading || !canBuy) return;
    if (!fulfilmentReady || !pickupSlotReady) {
      showToast({ title: t('common:errors.alertTitle'), description: t('checkout.deliveryRequired'), variant: 'warning' });
      return;
    }
    setIsActionLoading(true);
    try {
      const idempotencyKey = checkoutIdempotencyKeyRef.current ?? `mobile-marketplace-${randomUUID()}`;
      checkoutIdempotencyKeyRef.current = idempotencyKey;
      const response = await createMarketplaceOrder({
        listing_id: listing.id,
        ...(acceptedOfferId ? { offer_id: acceptedOfferId } : {}),
        quantity: 1,
        idempotency_key: idempotencyKey,
        ...(selectedShippingOptionId !== null ? { shipping_option_id: selectedShippingOptionId } : {}),
        ...(fulfilmentChoice === 'pickup'
          ? {
              shipping_method: 'pickup' as const,
              ...(selectedSlotId ? { pickup_slot_id: selectedSlotId } : {}),
            }
          : listing.delivery_method === 'community_delivery'
            ? { shipping_method: 'community_delivery' as const }
            : {}),
        ...(!isAcceptedOfferCheckout && effectivePaymentMethod === 'cash' && couponApplied && couponCode.trim()
          ? { coupon_code: couponCode.trim().toUpperCase() }
          : {}),
        payment_method: effectivePaymentMethod,
      });
      const orderId = Number(response.data?.id);
      const orderNumber = response.data?.order_number;
      if (!Number.isInteger(orderId) || orderId <= 0 || !orderNumber) {
        showToast({ title: t('common:errors.alertTitle'), description: t('detail.orderFailed'), variant: 'danger' });
        return;
      }
      if (response.data.requires_payment === false || response.data.status === 'paid') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({
          title: t('detail.orderCreated'),
          description: t('detail.orderCreatedHint', { order: orderNumber }),
          variant: 'success',
        });
        router.push({ pathname: '/(modals)/marketplace-orders', params: { mode: 'purchases' } } as unknown as Href);
        return;
      }
      let payment;
      try {
        payment = await createMarketplacePaymentIntent(orderId);
      } catch {
        showToast({ title: t('checkout.paymentRecoveryTitle'), description: t('checkout.paymentRecoveryHint', { order: orderNumber }), variant: 'danger' });
        router.push({ pathname: '/(modals)/marketplace-orders', params: { mode: 'purchases' } } as unknown as Href);
        return;
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (payment.data.checkout_url) {
        try {
          await Linking.openURL(payment.data.checkout_url);
        } catch {
          showToast({ title: t('checkout.paymentRecoveryTitle'), description: t('checkout.paymentRecoveryHint', { order: orderNumber }), variant: 'danger' });
          router.push({ pathname: '/(modals)/marketplace-orders', params: { mode: 'purchases' } } as unknown as Href);
        }
        return;
      }
      if (payment.data.client_secret) {
        const paymentResult = await presentMarketplacePayment({
          clientSecret: payment.data.client_secret,
          merchantDisplayName: t('checkout.merchantDisplayName'),
        });
        if (paymentResult.status === 'completed' && payment.data.payment_intent_id) {
          await confirmMarketplacePayment(payment.data.payment_intent_id);
          showToast({ title: t('checkout.paymentCompleteTitle'), description: t('checkout.paymentCompleteHint'), variant: 'success' });
          router.push({ pathname: '/(modals)/marketplace-orders', params: { mode: 'purchases' } } as unknown as Href);
          return;
        }
        if (paymentResult.status === 'failed') {
          showToast({ title: t('common:errors.alertTitle'), description: paymentResult.message || t('checkout.paymentSheetFailed'), variant: 'danger' });
          return;
        }
        showToast({ title: t('checkout.openedTitle'), description: t('checkout.clientSecretHint'), variant: 'default' });
        return;
      }
      showToast({ title: t('checkout.paymentRecoveryTitle'), description: t('checkout.paymentRecoveryHint', { order: orderNumber }), variant: 'danger' });
      router.push({ pathname: '/(modals)/marketplace-orders', params: { mode: 'purchases' } } as unknown as Href);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('detail.orderFailed'), variant: 'danger' });
    } finally {
      setIsActionLoading(false);
    }
  }

  async function applyCoupon() {
    if (!listing || !couponCode.trim()) return;
    setIsActionLoading(true);
    try {
      await validateMarketplaceCoupon({
        code: couponCode.trim().toUpperCase(),
        listing_id: listing.id,
        ...(selectedShippingOptionId !== null ? { shipping_option_id: selectedShippingOptionId } : {}),
      });
      setCouponApplied(true);
      showToast({ title: t('checkout.couponAppliedTitle'), description: t('checkout.couponAppliedHint'), variant: 'success' });
    } catch {
      setCouponApplied(false);
      showToast({ title: t('common:errors.alertTitle'), description: t('checkout.invalidCoupon'), variant: 'danger' });
    } finally {
      setIsActionLoading(false);
    }
  }

  function togglePickupSlot(slotId: number) {
    setFulfilmentChoice('pickup');
    setSelectedSlotId((current) => current === slotId ? null : slotId);
  }

  function chooseFulfilment(choice: FulfilmentChoice) {
    setFulfilmentChoice(choice);
    if (choice !== 'pickup') setSelectedSlotId(null);
  }

  async function handleSubmitOffer() {
    if (!listing || isActionLoading) return;
    const amount = Number(offerAmount.replace(/[,\s]/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast({ title: t('forms.validation'), description: t('offers.amountRequired'), variant: 'warning' });
      return;
    }
    setIsActionLoading(true);
    try {
      await makeMarketplaceOffer(listing.id, { amount, message: offerMessage.trim() || null });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOfferOpen(false);
      setOfferAmount('');
      setOfferMessage('');
      showToast({ title: t('offers.sent'), description: t('offers.sentHint'), variant: 'success' });
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('offers.failed'), variant: 'danger' });
    } finally {
      setIsActionLoading(false);
    }
  }

  async function handleSubmitReport() {
    if (!listing || isActionLoading) return;
    if (!reportDescription.trim()) {
      showToast({ title: t('forms.validation'), description: t('detail.reportRequired'), variant: 'warning' });
      return;
    }
    setIsActionLoading(true);
    try {
      await reportMarketplaceListing(listing.id, {
        reason: reportReason,
        description: reportDescription.trim(),
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setReportOpen(false);
      setReportReason('misleading');
      setReportDescription('');
      showToast({ title: t('detail.reportSubmittedTitle'), description: t('detail.reportSubmittedHint'), variant: 'success' });
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('detail.reportFailed'), variant: 'danger' });
    } finally {
      setIsActionLoading(false);
    }
  }

  async function openCollections() {
    setCollectionOpen(true);
    if (collections.length > 0 || isCollectionLoading) return;
    setIsCollectionLoading(true);
    try {
      const response = await getMarketplaceCollections();
      setCollections(response.data);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('collections.unableToLoad'), variant: 'danger' });
    } finally {
      setIsCollectionLoading(false);
    }
  }

  async function addToCollection(collection: MarketplaceCollection) {
    if (!listing) return;
    setIsActionLoading(true);
    try {
      await addMarketplaceCollectionItem(collection.id, listing.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCollectionOpen(false);
      showToast({ title: t('collections.addedTitle'), description: t('collections.addedHint', { name: collection.name }), variant: 'success' });
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('collections.addFailed'), variant: 'danger' });
    } finally {
      setIsActionLoading(false);
    }
  }

  async function handleShare() {
    try {
      await Share.share({
        title: listing!.title,
        message: `${listing!.title}\n\n${APP_URL}/marketplace/${listing!.id}`,
        url: `${APP_URL}/marketplace/${listing!.id}`,
      });
    } catch {
      // Share dismissed.
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('detail.title')}
        backLabel={t('common:back')}
        fallbackHref={'/(modals)/marketplace' as Href}
        rightAction={{ accessibilityLabel: t('detail.share'), icon: 'share-outline', onPress: handleShare }}
      />

      <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 142 }}>
        <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: accent }} />
          <HeroCard.Body className="gap-4 p-4">
            {videoUrl ? (
              <Surface variant="secondary" className="aspect-video overflow-hidden rounded-panel-inner bg-black p-0">
                <Video
                  accessibilityLabel={t('detail.video')}
                  resizeMode={ResizeMode.CONTAIN}
                  shouldPlay={false}
                  source={{ uri: videoUrl }}
                  style={{ width: '100%', height: '100%' }}
                  useNativeControls
                />
              </Surface>
            ) : null}

            {activeImageUrl || !videoUrl ? (
              <Surface variant="secondary" className="aspect-[4/3] items-center justify-center overflow-hidden rounded-panel-inner p-0">
                {activeImageUrl ? (
                  <Image source={{ uri: activeImageUrl }} className="h-full w-full" resizeMode="cover" />
                ) : (
                  <View className="items-center gap-2">
                    <Ionicons name="bag-handle-outline" size={44} color={accent} />
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.noImages')}</Text>
                  </View>
                )}
              </Surface>
            ) : null}

            {images.length > 1 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {images.map((image, index) => {
                  const thumb = resolveImageUrl(image.thumbnail_url ?? image.url);
                  return (
                    <HeroButton
                      key={`${image.id ?? index}`}
                      isIconOnly
                      variant={activeImage === index ? 'primary' : 'secondary'}
                      onPress={() => setActiveImage(index)}
                      accessibilityLabel={t('common:aria.carouselImage', { current: index + 1, total: images.length })}
                    >
                      {thumb ? <Image source={{ uri: thumb }} className="size-9 rounded-xl" resizeMode="cover" /> : <Ionicons name="image-outline" size={17} color={activeImage === index ? '#fff' : primary} />}
                    </HeroButton>
                  );
                })}
              </ScrollView>
            ) : null}

            <View className="gap-2">
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary">
                  <Ionicons name={listing.price_type === 'free' ? 'gift-outline' : 'pricetag-outline'} size={12} color={accent} />
                  <Chip.Label>{priceLabel}</Chip.Label>
                </Chip>
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t(`priceType.${listing.price_type}`)}</Chip.Label>
                </Chip>
                {listing.condition ? (
                  <Chip size="sm" variant="secondary">
                    <Chip.Label>{t(`condition.${listing.condition}`)}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
              <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{listing.title}</Text>
              {listing.tagline ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{listing.tagline}</Text> : null}
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="mb-3 rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-base font-bold" style={{ color: theme.text }}>{t('detail.seller')}</Text>
            <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
              <Avatar uri={listing.user?.avatar_url} name={listing.user?.name} size={44} />
              <View className="min-w-0 flex-1">
                <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                  {listing.user?.name ?? t('common.seller')}
                </Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                  {listing.user?.is_verified ? t('detail.verifiedSeller') : t('detail.communitySeller')}
                </Text>
              </View>
              {listing.user?.is_verified ? <Ionicons name="shield-checkmark-outline" size={20} color={theme.success} /> : null}
            </Surface>
            {listing.user?.id ? (
              <HeroButton variant="secondary" onPress={() => router.push({ pathname: '/(modals)/marketplace-seller', params: { id: String(listing.user?.id) } } as unknown as Href)}>
                <Ionicons name="storefront-outline" size={16} color={primary} />
                <HeroButton.Label>{t('detail.viewSeller')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="mb-3 rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-base font-bold" style={{ color: theme.text }}>{t('detail.description')}</Text>
            <Text className="text-sm leading-6" style={{ color: theme.textSecondary }}>{listing.description}</Text>
            {templateEntries.length > 0 ? (
              <View className="gap-3 border-t pt-3" style={{ borderColor: theme.border }}>
                <Text className="text-sm font-bold" style={{ color: theme.text }}>{t('detail.additionalDetails')}</Text>
                <View className="gap-2">
                  {templateEntries.map((entry) => (
                    <Surface key={entry.key} variant="secondary" className="gap-1 rounded-panel-inner p-3">
                      <Text className="text-[11px] font-bold uppercase" style={{ color: theme.textMuted }}>
                        {t('detail.templateFieldLabel', { field: entry.label })}
                      </Text>
                      <Text className="text-sm font-semibold" style={{ color: theme.text }}>{entry.value}</Text>
                    </Surface>
                  ))}
                </View>
              </View>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {listing.location ? (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="location-outline" size={12} color={primary} />
                  <Chip.Label>{listing.location}</Chip.Label>
                </Chip>
              ) : null}
              <Chip size="sm" variant="secondary">
                <Ionicons name="cube-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('detail.quantity', { count: listing.quantity })}</Chip.Label>
              </Chip>
              <Chip size="sm" variant="secondary">
                <Ionicons name="eye-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('detail.views', { count: listing.views_count })}</Chip.Label>
              </Chip>
              <Chip size="sm" variant="secondary">
                <Ionicons name="car-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t(`delivery_method.${listing.delivery_method || 'other'}`)}</Chip.Label>
              </Chip>
            </View>
          </HeroCard.Body>
        </HeroCard>

        {listing.delivery_method === 'community_delivery' ? (
          <CommunityDeliveryInfoCard primary={primary} theme={theme} />
        ) : null}

        {sellerListings.length > 0 ? (
          <MoreFromSellerCard
            listings={sellerListings}
            sellerName={listing.user?.name ?? t('common.seller')}
            primary={primary}
            theme={theme}
          />
        ) : null}

        {isOwner ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('owner.title')}</Text>
              <View className="flex-row gap-2">
                <HeroButton className="flex-1" variant="primary" onPress={() => router.push({ pathname: '/(modals)/edit-marketplace-listing', params: { id: String(listing.id) } } as unknown as Href)}>
                  <AccentIcon name="create-outline" size={16} />
                  <HeroButton.Label>{t('owner.edit')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/marketplace-my-listings' as Href)}>
                  <Ionicons name="stats-chart-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('owner.manage')}</HeroButton.Label>
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {canBuy ? (
          <HeroCard className="mb-3 rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('checkout.title')}</Text>
              {isHybridCheckout ? (
                <View className="gap-2" accessibilityRole="radiogroup" accessibilityLabel={t('checkout.paymentMethodLabel')}>
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('checkout.paymentMethodLabel')}</Text>
                  <View className="flex-row gap-2">
                    <HeroButton
                      className="flex-1"
                      variant={checkoutPaymentMethod === 'cash' ? 'primary' : 'secondary'}
                      onPress={() => setCheckoutPaymentMethod('cash')}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: checkoutPaymentMethod === 'cash' }}
                      testID="marketplace-payment-cash"
                    >
                      <HeroButton.Label>{t('checkout.payWithMoney', { amount: priceLabel })}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton
                      className="flex-1"
                      variant={checkoutPaymentMethod === 'time_credits' ? 'primary' : 'secondary'}
                      onPress={() => {
                        setCheckoutPaymentMethod('time_credits');
                        setCouponApplied(false);
                      }}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: checkoutPaymentMethod === 'time_credits' }}
                      testID="marketplace-payment-time-credits"
                    >
                      <HeroButton.Label>{t('checkout.payWithTimeCredits', { count: Number(listing.time_credit_price ?? 0) })}</HeroButton.Label>
                    </HeroButton>
                  </View>
                </View>
              ) : null}
              {supportsShipping ? (
                <View className="gap-2">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('checkout.deliveryTitle')}</Text>
                  {supportsPickup ? (
                    <HeroButton
                      variant={fulfilmentChoice === 'pickup' ? 'primary' : 'secondary'}
                      onPress={() => chooseFulfilment('pickup')}
                      accessibilityState={{ selected: fulfilmentChoice === 'pickup' }}
                      testID="marketplace-fulfilment-pickup"
                    >
                      <Ionicons name="location-outline" size={16} color={fulfilmentChoice === 'pickup' ? '#fff' : primary} />
                      <HeroButton.Label>{t('checkout.localPickup')}</HeroButton.Label>
                    </HeroButton>
                  ) : null}
                  {isShippingLoading ? (
                    <Text style={{ color: theme.textSecondary }}>{t('checkout.shippingLoading')}</Text>
                  ) : shippingLoadFailed ? (
                    <Text style={{ color: theme.error }}>{t('checkout.shippingLoadFailed')}</Text>
                  ) : shippingOptions.length === 0 ? (
                    <Text style={{ color: theme.textSecondary }}>{t('checkout.shippingUnavailable')}</Text>
                  ) : (
                    shippingOptions.map((option) => {
                      const choice = `shipping:${option.id}` as FulfilmentChoice;
                      const selected = fulfilmentChoice === choice;
                      return (
                        <HeroButton
                          key={option.id}
                          variant={selected ? 'primary' : 'secondary'}
                          onPress={() => chooseFulfilment(choice)}
                          accessibilityState={{ selected }}
                          testID={`marketplace-shipping-option-${option.id}`}
                        >
                          <Ionicons name="cube-outline" size={16} color={selected ? '#fff' : primary} />
                          <HeroButton.Label>{formatShippingOption(option)}</HeroButton.Label>
                        </HeroButton>
                      );
                    })
                  )}
                </View>
              ) : null}
              {pickupSlots.length > 0 && fulfilmentChoice === 'pickup' ? (
                <View className="gap-2">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('pickup.chooseSlot')}</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {pickupSlots.map((slot) => (
                      <HeroButton
                        key={slot.id}
                        size="sm"
                        variant={selectedSlotId === slot.id ? 'primary' : 'secondary'}
                        onPress={() => togglePickupSlot(slot.id)}
                        accessibilityLabel={formatPickupSlot(slot, t('pickup.slotFallback', { id: slot.id }))}
                        accessibilityState={{ selected: selectedSlotId === slot.id }}
                        testID={`marketplace-pickup-slot-${slot.id}`}
                      >
                        <HeroButton.Label onPress={() => togglePickupSlot(slot.id)}>{formatPickupSlot(slot, t('pickup.slotFallback', { id: slot.id }))}</HeroButton.Label>
                      </HeroButton>
                    ))}
                  </ScrollView>
                </View>
              ) : null}
              {couponsEnabled && effectivePaymentMethod === 'cash' ? (
                <View className="flex-row gap-2">
                  <View className="min-w-0 flex-1">
                    <FormInput label={t('checkout.coupon')} value={couponCode} onChangeText={(value) => { setCouponCode(value); setCouponApplied(false); }} placeholder={t('checkout.couponPlaceholder')} />
                  </View>
                  <HeroButton className="self-end" variant={couponApplied ? 'primary' : 'secondary'} onPress={() => void applyCoupon()} isDisabled={isActionLoading || !couponCode.trim()} style={couponApplied ? { backgroundColor: theme.success } : undefined}>
                    <HeroButton.Label>{couponApplied ? t('checkout.applied') : t('checkout.apply')}</HeroButton.Label>
                  </HeroButton>
                </View>
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

      </ScrollView>

      {!isOwner ? (
        <Surface variant="default" className="border-t border-border/50 px-4 pt-3 pb-4">
          <View className="gap-2">
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" variant="secondary" onPress={handleToggleSave}>
                <Ionicons name={listing.is_saved ? 'heart' : 'heart-outline'} size={17} color={primary} />
                <HeroButton.Label>{listing.is_saved ? t('detail.saved') : t('detail.save')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant="secondary" onPress={() => void openCollections()}>
                <Ionicons name="folder-open-outline" size={17} color={primary} />
                <HeroButton.Label>{t('detail.addToCollection')}</HeroButton.Label>
              </HeroButton>
            </View>
            <View className="flex-row gap-2">
              {!isAcceptedOfferCheckout ? (
                <HeroButton className="flex-1" variant="secondary" onPress={() => setOfferOpen(true)}>
                  <Ionicons name="hand-left-outline" size={17} color={primary} />
                  <HeroButton.Label>{t('detail.makeOffer')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {canBuy ? (
                <HeroButton className="flex-1" variant="primary" onPress={handleBuyNow} isDisabled={isActionLoading || !fulfilmentReady || !pickupSlotReady}>
                  <AccentIcon name="card-outline" size={17} />
                  <HeroButton.Label>{t('detail.buyNow')}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </View>
            <HeroButton variant="secondary" onPress={() => setReportOpen(true)}>
              <Ionicons name="flag-outline" size={17} color={theme.error} />
              <HeroButton.Label>{t('detail.reportListing')}</HeroButton.Label>
            </HeroButton>
          </View>
        </Surface>
      ) : null}

      <BottomSheet visible={collectionOpen} onClose={() => setCollectionOpen(false)} snapPoints={['58%', '86%']}>
        <Surface variant="default" className="max-h-[72%] rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('collections.addTitle')}</Text>
              <CloseButton onPress={() => setCollectionOpen(false)} iconProps={{ size: 20, color: primary }} />
            </View>
            {isCollectionLoading ? (
              <View className="py-8"><LoadingSpinner /></View>
            ) : collections.length === 0 ? (
              <View className="gap-3">
                <EmptyState icon="folder-open-outline" title={t('collections.empty')} subtitle={t('collections.emptyHint')} />
                <HeroButton variant="primary" onPress={() => { setCollectionOpen(false); router.push('/(modals)/marketplace-tools' as Href); }}>
                  <AccentIcon name="add-outline" size={17} />
                  <HeroButton.Label>{t('collections.manage')}</HeroButton.Label>
                </HeroButton>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ gap: 10 }}>
                {collections.map((collection) => (
                  <HeroButton key={collection.id} variant="secondary" onPress={() => void addToCollection(collection)} isDisabled={isActionLoading}>
                    <Ionicons name="folder-outline" size={17} color={primary} />
                    <HeroButton.Label>{collection.name}</HeroButton.Label>
                  </HeroButton>
                ))}
              </ScrollView>
            )}
        </Surface>
      </BottomSheet>

      <BottomSheet visible={offerOpen} onClose={() => setOfferOpen(false)} snapPoints={['48%', '78%']}>
        <Surface variant="default" className="rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('offers.makeTitle')}</Text>
              <CloseButton onPress={() => setOfferOpen(false)} iconProps={{ size: 20, color: primary }} />
            </View>
            <View className="gap-3">
              <FormInput label={t('offers.amount')} value={offerAmount} onChangeText={setOfferAmount} placeholder={t('offers.amountPlaceholder')} keyboardType="decimal-pad" />
              <FormInput label={t('offers.message')} value={offerMessage} onChangeText={setOfferMessage} placeholder={t('offers.messagePlaceholder')} multiline />
              <HeroButton variant="primary" onPress={handleSubmitOffer} isDisabled={isActionLoading}>
                <AccentIcon name="send-outline" size={17} />
                <HeroButton.Label>{t('offers.submit')}</HeroButton.Label>
              </HeroButton>
            </View>
        </Surface>
      </BottomSheet>

      <BottomSheet visible={reportOpen} onClose={() => setReportOpen(false)} snapPoints={['70%', '92%']}>
        <Surface variant="default" className="max-h-[86%] rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('detail.reportTitle')}</Text>
              <CloseButton onPress={() => setReportOpen(false)} iconProps={{ size: 20, color: primary }} />
            </View>
            <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('detail.reportHint')}</Text>
              <View className="gap-2">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('detail.reportReason')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {REPORT_REASONS.map((reason) => (
                    <HeroButton
                      key={reason}
                      size="sm"
                      variant={reportReason === reason ? 'primary' : 'secondary'}
                      onPress={() => setReportReason(reason)}
                      style={{ minWidth: '46%' }}
                    >
                      <HeroButton.Label>{t(`detail.reportReasons.${reason}`)}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </View>
              </View>
              <FormInput label={t('detail.reportDescription')} value={reportDescription} onChangeText={setReportDescription} placeholder={t('detail.reportDescriptionPlaceholder')} multiline />
              <HeroButton variant="danger" onPress={handleSubmitReport} isDisabled={isActionLoading}>
                <Ionicons name="flag-outline" size={17} color="#fff" />
                <HeroButton.Label>{t('detail.reportSubmit')}</HeroButton.Label>
              </HeroButton>
            </ScrollView>
        </Surface>
      </BottomSheet>
    </SafeAreaView>
  );
}

function CommunityDeliveryInfoCard({ primary, theme }: { primary: string; theme: ReturnType<typeof useTheme> }) {
  const { t } = useTranslation('marketplace');
  const steps: { icon: ComponentProps<typeof Ionicons>['name']; label: string }[] = [
    { icon: 'people-outline', label: t('communityDelivery.step1') },
    { icon: 'time-outline', label: t('communityDelivery.step2') },
    { icon: 'checkmark-circle-outline', label: t('communityDelivery.step3') },
  ];

  return (
    <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: theme.success }} />
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(theme.success, 0.14) }}>
            <Ionicons name="car-outline" size={23} color={theme.success} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
              {t('communityDelivery.eyebrow')}
            </Text>
            <Text className="text-base font-bold" style={{ color: theme.text }}>
              {t('communityDelivery.title')}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t('communityDelivery.description')}
            </Text>
          </View>
        </View>
        <View className="gap-2">
          {steps.map((step) => (
            <Surface key={step.icon} variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner px-3 py-2.5">
              <View className="size-8 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                <Ionicons name={step.icon} size={15} color={primary} />
              </View>
              <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {step.label}
              </Text>
            </Surface>
          ))}
        </View>
        <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>
          {t('communityDelivery.orderManagedHint')}
        </Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function MoreFromSellerCard({
  listings,
  sellerName,
  primary,
  theme,
}: {
  listings: MarketplaceListingItem[];
  sellerName: string;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  const { t } = useTranslation('marketplace');
  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center justify-between gap-3">
          <Text className="min-w-0 flex-1 text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
            {t('detail.moreFromSeller', { name: sellerName })}
          </Text>
          <Ionicons name="storefront-outline" size={18} color={primary} />
        </View>
        <View className="gap-2">
          {listings.map((item) => (
            <HeroButton
              key={item.id}
              className="justify-start"
              variant="secondary"
              onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.id) } } as unknown as Href)}
            >
              <Ionicons name="bag-handle-outline" size={16} color={primary} />
              <HeroButton.Label>{item.title}</HeroButton.Label>
            </HeroButton>
          ))}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function formatPickupSlot(slot: MarketplacePickupSlotOption, fallback: string) {
  try {
    if (!slot.slot_start) return fallback;
    const remaining = Number.isFinite(Number(slot.remaining)) ? ` (${slot.remaining})` : '';
    return `${new Date(slot.slot_start).toLocaleString()}${remaining}`;
  } catch {
    return fallback;
  }
}

function formatShippingOption(option: MarketplaceShippingOption): string {
  const amount = Number(option.price);
  if (!Number.isFinite(amount)) {
    return `${option.courier_name} · ${option.currency} ${String(option.price)}`;
  }
  try {
    const formattedAmount = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: option.currency,
      currencyDisplay: 'code',
    }).format(amount).replace(/\s+/g, ' ');
    return `${option.courier_name} · ${formattedAmount}`;
  } catch {
    return `${option.courier_name} · ${option.currency} ${amount}`;
  }
}

function getListingTemplateEntries(templateData?: Record<string, unknown> | null): { key: string; label: string; value: string }[] {
  if (!templateData) return [];
  return Object.entries(templateData).flatMap(([key, value]) => {
    if (value === null || value === undefined) return [];
    const text = Array.isArray(value) ? value.map((item) => String(item)).join(', ') : String(value);
    if (!text.trim()) return [];
    return [{ key, label: formatTemplateFieldLabel(key), value: text }];
  });
}

function formatTemplateFieldLabel(key: string): string {
  const label = key
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : key;
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
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        keyboardType={keyboardType}
        multiline={multiline}
        accessibilityLabel={label}
      />
    </View>
  );
}
