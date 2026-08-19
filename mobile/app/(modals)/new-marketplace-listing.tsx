// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, TagGroup, Text } from 'heroui-native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import * as Haptics from '@/lib/haptics';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import FormActionFooter from '@/components/ui/FormActionFooter';
import Input from '@/components/ui/Input';
import Toggle from '@/components/ui/Toggle';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  createMarketplaceListing,
  deleteMarketplaceListingImage,
  generateMarketplaceDescription,
  getMarketplaceCategories,
  getMarketplaceCategoryTemplate,
  getMarketplaceListing,
  deleteMarketplaceVideo,
  updateMarketplaceListing,
  uploadMarketplaceImages,
  uploadMarketplaceVideo,
  type MarketplaceCategory,
  type MarketplaceCategoryTemplateField,
  type MarketplaceCondition,
  type MarketplaceDeliveryMethod,
  type MarketplaceImage,
  type MarketplaceListingPayload,
  type MarketplacePriceType,
  type MarketplaceVideoUpload,
} from '@/lib/api/marketplace';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';

const PRICE_TYPES: MarketplacePriceType[] = ['fixed', 'negotiable', 'free', 'contact'];
const CURRENCIES = ['EUR', 'GBP', 'USD', 'CAD', 'AUD', 'NZD', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'JPY'] as const;
const CONDITIONS: MarketplaceCondition[] = ['new', 'like_new', 'good', 'fair', 'poor'];
const DELIVERY: MarketplaceDeliveryMethod[] = ['pickup', 'shipping', 'both', 'community_delivery'];
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];
const MAX_IMAGES = 20;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;

function toNumber(value: string): number | null {
  const parsed = Number(value.replace(/[,\s]/g, ''));
  return Number.isFinite(parsed) && value.trim() ? parsed : null;
}

function basenameFromUri(uri: string): string {
  const cleanUri = uri.split('?')[0] ?? uri;
  return cleanUri.split('/').pop() || 'marketplace-video.mp4';
}

function normalizeSupportedCurrency(value?: string | null): string {
  const candidate = (value ?? '').trim().toUpperCase();
  return CURRENCIES.includes(candidate as (typeof CURRENCIES)[number]) ? candidate : '';
}

function normalizeExistingCurrency(value?: string | null): string {
  const candidate = (value ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(candidate) ? candidate : '';
}

export default function NewMarketplaceListingRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceListingForm />
    </ModalErrorBoundary>
  );
}

export function MarketplaceListingForm() {
  const { t } = useTranslation(['marketplace', 'common']);
  const params = useLocalSearchParams<{ id?: string; price_type?: MarketplacePriceType }>();
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const listingId = Number(params.id);
  const isEditing = Number.isFinite(listingId) && listingId > 0;
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [title, setTitle] = useState('');
  const [tagline, setTagline] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [timeCredits, setTimeCredits] = useState('');
  const initialPriceType = PRICE_TYPES.includes(params.price_type as MarketplacePriceType) ? params.price_type as MarketplacePriceType : 'fixed';
  const [priceType, setPriceType] = useState<MarketplacePriceType>(initialPriceType);
  // Leave unsupported/missing bootstrap values empty so create falls back to
  // the backend's authoritative tenant currency.
  const [currency, setCurrency] = useState(() => normalizeSupportedCurrency(tenant?.currency));
  const [condition, setCondition] = useState<MarketplaceCondition>('good');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categoryTemplate, setCategoryTemplate] = useState<MarketplaceCategoryTemplateField[]>([]);
  const [templateFields, setTemplateFields] = useState<Record<string, string>>({});
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [quantity, setQuantity] = useState('1');
  const [inventoryUnlimited, setInventoryUnlimited] = useState(true);
  const [inventoryCount, setInventoryCount] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [oversoldProtected, setOversoldProtected] = useState(true);
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [deliveryMethod, setDeliveryMethod] = useState<MarketplaceDeliveryMethod>('pickup');
  const [sellerType, setSellerType] = useState<'private' | 'business'>('private');
  const [existingImages, setExistingImages] = useState<MarketplaceImage[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [imageUris, setImageUris] = useState<string[]>([]);
  const [videoAsset, setVideoAsset] = useState<MarketplaceVideoUpload | null>(null);
  const [existingVideoUrl, setExistingVideoUrl] = useState<string | null>(null);
  const [removeExistingVideo, setRemoveExistingVideo] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDescription, setIsGeneratingDescription] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    getMarketplaceCategories()
      .then((response) => {
        if (mounted) setCategories(response.data);
      })
      .catch(() => {
        if (mounted) setCategories([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isEditing || hydrated) return;
    let mounted = true;
    getMarketplaceListing(listingId)
      .then((response) => {
        if (!mounted) return;
        const listing = response.data;
        setTitle(listing.title ?? '');
        setTagline(listing.tagline ?? '');
        setDescription(listing.description ?? '');
        setPrice(listing.price !== null && listing.price !== undefined ? String(listing.price) : '');
        setCurrency(
          normalizeExistingCurrency(listing.price_currency)
          || normalizeSupportedCurrency(tenant?.currency),
        );
        setTimeCredits(listing.time_credit_price !== null && listing.time_credit_price !== undefined ? String(listing.time_credit_price) : '');
        setPriceType(listing.price_type ?? 'fixed');
        setCondition(listing.condition ?? 'good');
        setCategoryId(listing.category?.id ?? null);
        if (listing.template_data && typeof listing.template_data === 'object') {
          const fields: Record<string, string> = {};
          Object.entries(listing.template_data).forEach(([key, value]) => {
            fields[key] = String(value ?? '');
          });
          setTemplateFields(fields);
        } else {
          setTemplateFields({});
        }
        setQuantity(String(listing.quantity ?? 1));
        if (listing.inventory_count === null || listing.inventory_count === undefined) {
          setInventoryUnlimited(true);
          setInventoryCount('0');
        } else {
          setInventoryUnlimited(false);
          setInventoryCount(String(listing.inventory_count));
        }
        setLowStockThreshold(String(listing.low_stock_threshold ?? 5));
        setOversoldProtected(listing.is_oversold_protected ?? true);
        setLocation(listing.location ?? '');
        setLatitude(listing.latitude !== null && listing.latitude !== undefined ? String(listing.latitude) : '');
        setLongitude(listing.longitude !== null && listing.longitude !== undefined ? String(listing.longitude) : '');
        setDeliveryMethod((listing.delivery_method as MarketplaceDeliveryMethod) ?? 'pickup');
        setSellerType(listing.seller_type === 'business' ? 'business' : 'private');
        setExistingImages(listing.images ?? []);
        setRemovedImageIds([]);
        setImageUris([]);
        setExistingVideoUrl(listing.video_url ?? null);
        setVideoAsset(null);
        setRemoveExistingVideo(false);
        setHydrated(true);
      })
      .catch(() => showToast({ title: t('common:errors.alertTitle'), description: t('forms.loadFailed'), variant: 'danger' }));
    return () => {
      mounted = false;
    };
  }, [hydrated, isEditing, listingId, showToast, t, tenant?.currency]);

  useEffect(() => {
    if (!categoryId) {
      setCategoryTemplate([]);
      setTemplateFields({});
      return;
    }

    let mounted = true;
    setIsLoadingTemplate(true);
    getMarketplaceCategoryTemplate(categoryId)
      .then((response) => {
        if (!mounted) return;
        const fields = response.data.fields ?? [];
        setCategoryTemplate(fields);
        setTemplateFields((current) => {
          const next: Record<string, string> = {};
          fields.forEach((field) => {
            next[field.key] = current[field.key] ?? '';
          });
          return next;
        });
      })
      .catch(() => {
        if (!mounted) return;
        setCategoryTemplate([]);
        setTemplateFields({});
      })
      .finally(() => {
        if (mounted) setIsLoadingTemplate(false);
      });

    return () => {
      mounted = false;
    };
  }, [categoryId]);

  async function submit() {
    if (!title.trim() || !description.trim()) {
      showToast({ title: t('forms.validation'), description: t('forms.required'), variant: 'warning' });
      return;
    }

    const priceValue = priceType === 'free' ? 0 : toNumber(price);
    if (priceType !== 'free' && priceType !== 'contact' && (priceValue === null || priceValue <= 0)) {
      showToast({ title: t('forms.validation'), description: t('forms.priceRequired'), variant: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      const hasLatitude = latitude.trim().length > 0;
      const hasLongitude = longitude.trim().length > 0;
      const latitudeValue = toNumber(latitude);
      const longitudeValue = toNumber(longitude);
      if (
        hasLatitude !== hasLongitude
        || (hasLatitude && (latitudeValue === null || latitudeValue < -90 || latitudeValue > 90))
        || (hasLongitude && (longitudeValue === null || longitudeValue < -180 || longitudeValue > 180))
      ) {
        showToast({ title: t('forms.validation'), description: t('forms.invalidCoordinates'), variant: 'warning' });
        return;
      }
      const filledTemplateFields = Object.fromEntries(
        Object.entries(templateFields).filter(([, value]) => value.trim() !== ''),
      );
      const payload: MarketplaceListingPayload = {
        title: title.trim(),
        tagline: tagline.trim() || null,
        description: description.trim(),
        price: priceType === 'contact' ? null : priceValue,
        ...(currency ? { price_currency: currency } : {}),
        price_type: priceType,
        time_credit_price: toNumber(timeCredits),
        category_id: categoryId,
        condition,
        quantity: toNumber(quantity) ?? 1,
        inventory_count: inventoryUnlimited ? null : Math.max(0, toNumber(inventoryCount) ?? 0),
        low_stock_threshold: Math.max(0, toNumber(lowStockThreshold) ?? 0),
        is_oversold_protected: oversoldProtected,
        location: location.trim() || null,
        latitude: latitudeValue,
        longitude: longitudeValue,
        delivery_method: deliveryMethod,
        shipping_available: deliveryMethod === 'shipping' || deliveryMethod === 'both',
        local_pickup: deliveryMethod === 'pickup' || deliveryMethod === 'both' || deliveryMethod === 'community_delivery',
        seller_type: sellerType,
        status: 'active',
      };
      if (Object.keys(filledTemplateFields).length > 0) {
        payload.template_data = filledTemplateFields;
      }
      const response = isEditing
        ? await updateMarketplaceListing(listingId, payload)
        : await createMarketplaceListing(payload);
      if (isEditing && removedImageIds.length > 0) {
        await Promise.all(removedImageIds.map((imageId) => deleteMarketplaceListingImage(response.data.id, imageId)));
      }
      if (imageUris.length > 0) {
        await uploadMarketplaceImages(response.data.id, imageUris);
      }
      if (isEditing && removeExistingVideo && !videoAsset) {
        await deleteMarketplaceVideo(response.data.id);
      }
      if (videoAsset) {
        await uploadMarketplaceVideo(response.data.id, videoAsset);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace({ pathname: '/(modals)/marketplace-detail', params: { id: String(response.data.id) } } as unknown as Href);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('forms.saveFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function generateDescription() {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      showToast({ title: t('forms.validation'), description: t('forms.generateTitleRequired'), variant: 'warning' });
      return;
    }

    setIsGeneratingDescription(true);
    try {
      const selectedCategory = categories.find((category) => category.id === categoryId);
      const response = await generateMarketplaceDescription({
        title: cleanTitle,
        category: selectedCategory?.name,
        condition,
      });
      setDescription(response.data.description);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('forms.generateDescriptionFailed'), variant: 'danger' });
    } finally {
      setIsGeneratingDescription(false);
    }
  }

  async function pickImages() {
    const availableSlots = Math.max(0, MAX_IMAGES - existingImages.length - imageUris.length);
    if (availableSlots <= 0) {
      showToast({ title: t('forms.validation'), description: t('forms.maxImagesReached', { max: MAX_IMAGES }), variant: 'warning' });
      return;
    }
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ title: t('forms.permissionTitle'), description: t('forms.permissionMessage'), variant: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.82,
      selectionLimit: availableSlots,
    });
    if (result.canceled) return;
    const nextUris = result.assets.map((asset) => asset.uri).filter(Boolean);
    setImageUris((current) => [...current, ...nextUris].slice(0, current.length + availableSlots));
  }

  async function pickVideo() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ title: t('forms.permissionTitle'), description: t('forms.permissionMessage'), variant: 'warning' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Videos,
      allowsMultipleSelection: false,
      quality: 0.82,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset?.uri) return;

    if (asset.mimeType && !ALLOWED_VIDEO_TYPES.includes(asset.mimeType)) {
      showToast({ title: t('forms.validation'), description: t('forms.videoTypeError'), variant: 'warning' });
      return;
    }
    if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE) {
      showToast({ title: t('forms.validation'), description: t('forms.videoSizeError'), variant: 'warning' });
      return;
    }

    setVideoAsset({
      uri: asset.uri,
      fileName: asset.fileName ?? basenameFromUri(asset.uri),
      mimeType: asset.mimeType ?? null,
    });
    setRemoveExistingVideo(false);
  }

  function removeVideo() {
    if (videoAsset) {
      setVideoAsset(null);
      return;
    }
    if (existingVideoUrl) {
      setExistingVideoUrl(null);
      setRemoveExistingVideo(true);
    }
  }

  function removeExistingImage(image: MarketplaceImage) {
    if (image.id) {
      setRemovedImageIds((current) => [...current, image.id!]);
    }
    setExistingImages((current) => current.filter((item) => item !== image));
  }

  const totalImageCount = existingImages.length + imageUris.length;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={isEditing ? t('forms.editTitle') : t('forms.createTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 132, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <View
                className="h-12 w-12 items-center justify-center rounded-3xl"
                style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
              >
                <Ionicons name="bag-add-outline" size={23} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('forms.eyebrow')}</Text>
                <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>{isEditing ? t('forms.editTitle') : t('forms.createTitle')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('forms.subtitle')}</Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
          <HeroCard.Body className="gap-5 p-3.5">
            <FormField label={t('forms.title')} value={title} onChangeText={setTitle} placeholder={t('forms.titlePlaceholder')} />
            <FormField label={t('forms.tagline')} value={tagline} onChangeText={setTagline} placeholder={t('forms.taglinePlaceholder')} />
            <FormField label={t('forms.description')} value={description} onChangeText={setDescription} placeholder={t('forms.descriptionPlaceholder')} multiline />
            <HeroButton variant="secondary" onPress={() => void generateDescription()} isDisabled={isGeneratingDescription || !title.trim()}>
              <Ionicons name="sparkles-outline" size={16} color={primary} />
              <HeroButton.Label>{isGeneratingDescription ? t('forms.generatingDescription') : t('forms.generateDescription')}</HeroButton.Label>
            </HeroButton>
            <ButtonGroup label={t('forms.priceType')} values={PRICE_TYPES} selected={priceType} onSelect={setPriceType} labelFor={(value) => t(`priceType.${value}`)} primary={primary} />
            {priceType !== 'free' && priceType !== 'contact' ? (
              <>
                <FormField label={t('forms.price')} value={price} onChangeText={setPrice} placeholder={t('forms.pricePlaceholder')} keyboardType="decimal-pad" />
                <ButtonGroup
                  label={t('forms.currency')}
                  values={currency && !CURRENCIES.includes(currency as (typeof CURRENCIES)[number])
                    ? [currency, ...CURRENCIES]
                    : CURRENCIES}
                  selected={currency}
                  onSelect={setCurrency}
                  labelFor={(value) => value}
                  primary={primary}
                />
              </>
            ) : null}
            <FormField label={t('forms.timeCredits')} value={timeCredits} onChangeText={setTimeCredits} placeholder={t('forms.timeCreditsPlaceholder')} keyboardType="decimal-pad" />
            <ButtonGroup label={t('forms.condition')} values={CONDITIONS} selected={condition} onSelect={setCondition} labelFor={(value) => t(`condition.${value}`)} primary={primary} />
            <CategoryGroup categories={categories} selected={categoryId} onSelect={setCategoryId} primary={primary} />
            <TemplateFieldsSection
              fields={categoryTemplate}
              values={templateFields}
              isLoading={isLoadingTemplate}
              onChange={(key, value) => setTemplateFields((current) => ({ ...current, [key]: value }))}
              primary={primary}
            />
            <FormField label={t('forms.quantity')} value={quantity} onChangeText={setQuantity} placeholder={t('forms.quantityPlaceholder')} keyboardType="decimal-pad" />
            <View className="gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
              <View className="flex-row items-start gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="cube-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('inventory.section_title')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('inventory.section_subtitle')}</Text>
                </View>
              </View>
              <SwitchRow label={t('inventory.unlimited')} value={inventoryUnlimited} onValueChange={setInventoryUnlimited} />
              {!inventoryUnlimited ? (
                <View className="flex-row gap-3">
                  <View className="flex-1">
                    <FormField label={t('inventory.stockCount')} value={inventoryCount} onChangeText={setInventoryCount} placeholder={t('inventory.countPlaceholder')} keyboardType="decimal-pad" />
                  </View>
                  <View className="flex-1">
                    <FormField label={t('inventory.low_stock_threshold')} value={lowStockThreshold} onChangeText={setLowStockThreshold} placeholder={t('inventory.lowStockPlaceholder')} keyboardType="decimal-pad" />
                  </View>
                </View>
              ) : null}
              <SwitchRow label={t('inventory.oversold_protected')} value={oversoldProtected} onValueChange={setOversoldProtected} />
            </View>
            <FormField label={t('forms.location')} value={location} onChangeText={setLocation} placeholder={t('forms.locationPlaceholder')} />
            <View className="gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
              <View className="flex-row items-start gap-3">
                <View className="h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="navigate-outline" size={18} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('forms.coordinates')}</Text>
                  <Text className="text-xs leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('forms.coordinatesHint')}</Text>
                </View>
              </View>
              <View className="flex-row gap-3">
                <View className="min-w-0 flex-1">
                  <FormField label={t('forms.latitude')} value={latitude} onChangeText={setLatitude} placeholder={t('forms.latitudePlaceholder')} keyboardType="decimal-pad" />
                </View>
                <View className="min-w-0 flex-1">
                  <FormField label={t('forms.longitude')} value={longitude} onChangeText={setLongitude} placeholder={t('forms.longitudePlaceholder')} keyboardType="decimal-pad" />
                </View>
              </View>
            </View>
            <ButtonGroup label={t('forms.delivery')} values={DELIVERY} selected={deliveryMethod} onSelect={setDeliveryMethod} labelFor={(value) => t(`delivery_method.${value}`)} primary={primary} />
            <ButtonGroup label={t('forms.sellerType')} values={['private', 'business'] as const} selected={sellerType} onSelect={setSellerType} labelFor={(value) => t(`sellerType.${value}`)} primary={primary} />
            <View className="gap-3">
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('forms.media')}</Text>
                <Text className="text-xs font-semibold" style={{ color: theme.textMuted }}>
                  {t('forms.photosCount', { current: totalImageCount, max: MAX_IMAGES })}
                </Text>
              </View>
              <HeroButton variant="secondary" onPress={pickImages}>
                <Ionicons name="images-outline" size={16} color={primary} />
                <HeroButton.Label>{t('forms.addImages')}</HeroButton.Label>
              </HeroButton>
              {totalImageCount > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {existingImages.map((image, index) => (
                    <View key={`existing-${image.id ?? image.url}-${index}`} className="relative">
                      <Image
                        source={{ uri: resolveImageUrl(image.thumbnail_url || image.url) ?? image.url }}
                        accessibilityLabel={t('forms.imageAlt', { number: index + 1 })}
                        className="size-20 rounded-panel-inner"
                        resizeMode="cover"
                      />
                      {index === 0 ? (
                        <View className="absolute bottom-1 left-1 rounded-full px-2 py-0.5" style={{ backgroundColor: withAlpha(primary, 0.92) }}>
                          <Text className="text-[10px] font-bold text-white">{t('forms.coverImage')}</Text>
                        </View>
                      ) : null}
                      <HeroButton
                        isIconOnly
                        size="sm"
                        variant="danger"
                        accessibilityLabel={t('forms.removeImage')}
                        className="absolute right-1 top-1"
                        onPress={() => removeExistingImage(image)}
                      >
                        <Ionicons name="close-outline" size={14} color="#fff" />
                      </HeroButton>
                    </View>
                  ))}
                  {imageUris.map((uri, index) => (
                    <View key={`${uri}-${index}`} className="relative">
                      <Image
                        source={{ uri }}
                        accessibilityLabel={t('forms.imageAlt', { number: existingImages.length + index + 1 })}
                        className="size-20 rounded-panel-inner"
                        resizeMode="cover"
                      />
                      {existingImages.length === 0 && index === 0 ? (
                        <View className="absolute bottom-1 left-1 rounded-full px-2 py-0.5" style={{ backgroundColor: withAlpha(primary, 0.92) }}>
                          <Text className="text-[10px] font-bold text-white">{t('forms.coverImage')}</Text>
                        </View>
                      ) : null}
                      <HeroButton
                        isIconOnly
                        size="sm"
                        variant="danger"
                        accessibilityLabel={t('forms.removeImage')}
                        className="absolute right-1 top-1"
                        onPress={() => setImageUris((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <Ionicons name="close-outline" size={14} color="#fff" />
                      </HeroButton>
                    </View>
                  ))}
                </ScrollView>
              ) : null}
              <View className="gap-2 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: withAlpha(primary, 0.05) }}>
                <View className="flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('forms.video')}</Text>
                    <Text className="text-xs leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('forms.videoHint')}</Text>
                  </View>
                  <HeroButton size="sm" variant="secondary" onPress={pickVideo}>
                    <Ionicons name="videocam-outline" size={15} color={primary} />
                    <HeroButton.Label>{videoAsset || existingVideoUrl ? t('forms.changeVideo') : t('forms.addVideo')}</HeroButton.Label>
                  </HeroButton>
                </View>
                {videoAsset || existingVideoUrl ? (
                  <View className="flex-row items-center gap-3 rounded-panel-inner px-3 py-2" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: theme.bg }}>
                    <Ionicons name="film-outline" size={18} color={primary} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                        {videoAsset ? t('forms.videoSelected') : t('forms.currentVideo')}
                      </Text>
                      <Text className="text-sm" style={{ color: theme.text }} numberOfLines={1}>
                        {videoAsset?.fileName || (existingVideoUrl ? basenameFromUri(existingVideoUrl) : '')}
                      </Text>
                    </View>
                    <HeroButton isIconOnly size="sm" variant="danger-soft" accessibilityLabel={t('forms.removeVideo')} onPress={removeVideo}>
                      <Ionicons name="close-outline" size={15} color={theme.error} />
                    </HeroButton>
                  </View>
                ) : null}
              </View>
              <Text className="text-xs leading-5" style={{ color: theme.textMuted }}>{t('forms.mediaHint')}</Text>
            </View>
          </HeroCard.Body>
        </HeroCard>
      </ScrollView>
      <FormActionFooter
        title={isEditing ? t('forms.footerEditTitle') : t('forms.footerCreateTitle')}
        subtitle={t('forms.footerSubtitle')}
        submitLabel={isEditing ? t('forms.update') : t('forms.publish')}
        primary={primary}
        isSubmitting={isSubmitting}
        onSubmit={submit}
      />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ButtonGroup<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
  primary,
}: {
  label: string;
  values: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
  primary: string;
}) {
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      <TagGroup
        size="sm"
        selectionMode="single"
        selectedKeys={[selected]}
        onSelectionChange={(keys) => {
          const next = Array.from(keys)[0];
          if (next !== undefined) onSelect(next as T);
        }}
      >
        <TagGroup.List>
          {values.map((value) => {
            const isSelected = selected === value;
            return (
              <TagGroup.Item
                key={value}
                id={value}
              >
                <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                  {labelFor(value)}
                </TagGroup.ItemLabel>
              </TagGroup.Item>
            );
          })}
        </TagGroup.List>
      </TagGroup>
    </View>
  );
}

function SwitchRow({ label, value, onValueChange }: { label: string; value: boolean; onValueChange: (value: boolean) => void }) {
  const theme = useTheme();
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>{label}</Text>
      <Toggle value={value} onValueChange={onValueChange} />
    </View>
  );
}

function CategoryGroup({ categories, selected, onSelect, primary }: { categories: MarketplaceCategory[]; selected: number | null; onSelect: (value: number | null) => void; primary: string }) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('forms.category')}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 2 }}>
        <HeroButton size="sm" variant={selected === null ? 'primary' : 'secondary'} onPress={() => onSelect(null)}>
          <HeroButton.Label>{t('filters.noCategory')}</HeroButton.Label>
        </HeroButton>
        {categories.map((category) => (
          <HeroButton key={category.id} size="sm" variant={selected === category.id ? 'primary' : 'secondary'} onPress={() => onSelect(category.id)}>
            <HeroButton.Label>{category.name}</HeroButton.Label>
          </HeroButton>
        ))}
      </ScrollView>
    </View>
  );
}

function TemplateFieldsSection({
  fields,
  values,
  isLoading,
  onChange,
  primary,
}: {
  fields: MarketplaceCategoryTemplateField[];
  values: Record<string, string>;
  isLoading: boolean;
  onChange: (key: string, value: string) => void;
  primary: string;
}) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();

  if (isLoading) {
    return (
      <View className="min-h-12 flex-row items-center gap-3 rounded-panel-inner px-3" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: withAlpha(primary, 0.05) }}>
        <Ionicons name="options-outline" size={18} color={primary} />
        <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>{t('forms.loadingCategoryFields')}</Text>
      </View>
    );
  }

  if (fields.length === 0) return null;

  return (
    <View className="gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: withAlpha(primary, 0.06) }}>
      <View className="flex-row items-start gap-3">
        <View className="h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Ionicons name="options-outline" size={18} color={primary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('forms.categorySpecificDetails')}</Text>
          <Text className="text-xs leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('forms.categorySpecificHint')}</Text>
        </View>
      </View>
      {fields.map((field) => {
        const label = field.required ? `${field.label} *` : field.label;
        if (field.type === 'select' && field.options?.length) {
          return (
            <TemplateSelectField
              key={field.key}
              field={{ ...field, label }}
              value={values[field.key] ?? ''}
              onChange={(value) => onChange(field.key, value)}
              primary={primary}
            />
          );
        }

        return (
          <FormField
            key={field.key}
            label={label}
            value={values[field.key] ?? ''}
            onChangeText={(value) => onChange(field.key, value)}
            placeholder={t('forms.templateFieldPlaceholder', { field: field.label.toLowerCase() })}
            keyboardType={field.type === 'number' ? 'decimal-pad' : undefined}
          />
        );
      })}
    </View>
  );
}

function TemplateSelectField({
  field,
  value,
  onChange,
  primary,
}: {
  field: MarketplaceCategoryTemplateField;
  value: string;
  onChange: (value: string) => void;
  primary: string;
}) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  const options = field.options ?? [];

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{field.label}</Text>
      {!value ? (
        <Text className="text-xs leading-5" style={{ color: theme.textMuted }} numberOfLines={2}>
          {t('forms.templateSelectPlaceholder', { field: field.label.replace(/\s+\*$/, '').toLowerCase() })}
        </Text>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 2 }}>
        {options.map((option) => (
          <HeroButton
            key={option}
            size="sm"
            variant={value === option ? 'primary' : 'secondary'}
            onPress={() => onChange(value === option ? '' : option)}
          >
            <HeroButton.Label>{option}</HeroButton.Label>
          </HeroButton>
        ))}
      </ScrollView>
    </View>
  );
}

function FormField({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  const theme = useTheme();
  return (
    <View className="w-full gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      <Input
        containerClassName="mb-0 w-full"
        inputClassName={`w-full ${multiline ? 'min-h-28' : 'min-h-12'} text-sm`}
        style={{ color: theme.text, textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        accessibilityLabel={label}
      />
    </View>
  );
}
