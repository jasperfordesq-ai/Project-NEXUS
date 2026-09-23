// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CreateMarketplaceListingPage — Multi-section form to create a new listing.
 *
 * Sections (single scrollable page):
 * 1. Photos — drag-and-drop image upload (up to 20 images)
 * 2. Details — title, description, category, condition
 * 3. Pricing — price, currency, price type
 * 4. Delivery — location, shipping, delivery method
 *
 * Features:
 * - Dynamic category template fields
 * - AI description generation
 * - Form validation before submit
 * - Redirect to listing detail on success
 * - Requires authentication
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { OverlayActionButton } from '@/components/ui/OverlayActionButton';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';

import Camera from 'lucide-react/icons/camera';
import X from 'lucide-react/icons/x';
import Plus from 'lucide-react/icons/plus';
import Sparkles from 'lucide-react/icons/sparkles';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Truck from 'lucide-react/icons/truck';
import Package from 'lucide-react/icons/package';
import DollarSign from 'lucide-react/icons/dollar-sign';
import FileText from 'lucide-react/icons/file-text';
import Upload from 'lucide-react/icons/upload';
import Video from 'lucide-react/icons/video';
import { useTranslation } from 'react-i18next';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { userScopedStorageKey } from '@/lib/userScopedStorage';
import { usePageTitle, useDraftPersistence } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import {
  normalizeSupportedMarketplaceCurrency,
  SUPPORTED_MARKETPLACE_CURRENCIES,
} from '@/lib/marketplaceNumbers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MarketplaceCategory {
  id: number;
  name: string;
  slug: string;
}

interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
  required?: boolean;
}

interface ImagePreview {
  id: string;
  file: File;
  url: string;
}

interface MarketplaceListingDraft {
  title: string;
  description: string;
  categoryId: string;
  condition: string;
  priceType: string;
  price: string;
}

const CONDITIONS = [
  { value: 'new', tKey: 'condition.new' },
  { value: 'like_new', tKey: 'condition.like_new' },
  { value: 'good', tKey: 'condition.good' },
  { value: 'fair', tKey: 'condition.fair' },
  { value: 'poor', tKey: 'condition.poor' },
] as const;

const PRICE_TYPES = [
  { value: 'fixed', tKey: 'price_type.fixed' },
  { value: 'negotiable', tKey: 'price_type.negotiable' },
  { value: 'free', tKey: 'price_type.free' },
] as const;

const DELIVERY_METHODS = [
  { value: 'pickup', tKey: 'delivery_method.pickup' },
  { value: 'shipping', tKey: 'delivery_method.shipping' },
  { value: 'both', tKey: 'delivery_method.both' },
] as const;

const MAX_IMAGES = 20;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function CreateMarketplaceListingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('create.page_title'));
  const { isAuthenticated, user } = useAuth();
  const { tenant, tenantPath } = useTenant();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state — persisted draft
  const [draft, setDraft, clearDraft] = useDraftPersistence<MarketplaceListingDraft>(
    // F-109: drafts belong to one member of one community.
    userScopedStorageKey('marketplace-listing-draft', tenant?.id, user?.id),
    { title: '', description: '', categoryId: '', condition: 'good', priceType: 'fixed', price: '' },
  );
  const title = draft.title;
  const description = draft.description;
  const categoryId = draft.categoryId;
  const condition = draft.condition;
  const priceType = draft.priceType;
  const price = draft.price;
  // An unsupported or missing bootstrap value stays empty so the backend can
  // apply its authoritative tenant-currency default instead of sending EUR.
  const [currency, setCurrency] = useState(() => normalizeSupportedMarketplaceCurrency(tenant?.currency));

  const setTitle = (v: string) => setDraft((prev) => ({ ...prev, title: v }));
  const setDescription = useCallback((v: string) => setDraft((prev) => ({ ...prev, description: v })), [setDraft]);
  const setCategoryId = (v: string) => setDraft((prev) => ({ ...prev, categoryId: v }));
  const setCondition = (v: string) => setDraft((prev) => ({ ...prev, condition: v }));
  const setPriceType = (v: string) => setDraft((prev) => ({ ...prev, priceType: v }));
  const setPrice = (v: string) => setDraft((prev) => ({ ...prev, price: v }));
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [quantity, setQuantity] = useState('1');
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [templateFields, setTemplateFields] = useState<Record<string, string>>({});

  // Data state
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [categoryTemplate, setCategoryTemplate] = useState<TemplateField[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGeneratingDesc, setIsGeneratingDesc] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(tenantPath('/login'), { replace: true });
    }
  }, [isAuthenticated, navigate, tenantPath]);

  // Load categories
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.get<MarketplaceCategory[]>('/v2/marketplace/categories');
        if (!cancelled && response.success && response.data) {
          setCategories(response.data);
        }
      } catch (err) {
        logError('Failed to load marketplace categories', err);
      } finally {
        if (!cancelled) setIsLoadingCategories(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Load category template when category changes
  useEffect(() => {
    if (!categoryId) {
      setCategoryTemplate([]);
      setTemplateFields({});
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoadingTemplate(true);
      try {
        const response = await api.get<{ fields: TemplateField[] }>(
          `/v2/marketplace/categories/${categoryId}/template`
        );
        if (!cancelled && response.success && response.data?.fields) {
          setCategoryTemplate(response.data.fields);
          // Initialize template field values
          const initial: Record<string, string> = {};
          response.data.fields.forEach((f) => { initial[f.key] = ''; });
          setTemplateFields(initial);
        } else if (!cancelled) {
          setCategoryTemplate([]);
          setTemplateFields({});
        }
      } catch (err) {
        logError('Failed to load category template', err);
        if (!cancelled) {
          setCategoryTemplate([]);
          setTemplateFields({});
        }
      } finally {
        if (!cancelled) setIsLoadingTemplate(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [categoryId]);

  // Image handling
  const handleImageSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) {
      toast.error(t('create.max_images_error', { max: MAX_IMAGES }));
      return;
    }

    const newImages: ImagePreview[] = [];
    const fileArray = Array.from(files).slice(0, remaining);

    for (const file of fileArray) {
      if (!file.type.startsWith('image/')) {
        toast.error(t('create.not_image_error', { name: file.name }));
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(t('create.size_limit_error', { name: file.name }));
        continue;
      }
      newImages.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        url: URL.createObjectURL(file),
      });
    }

    setImages((prev) => [...prev, ...newImages]);
  }, [images.length, toast, t])

  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.url);
      return prev.filter((i) => i.id !== id);
    });
  }, []);

  // Video handling
  const handleVideoSelect = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0] as File;

    if (!ALLOWED_VIDEO_TYPES.includes(file.type)) {
      toast.error(t('create.video_type_error'));
      return;
    }
    if (file.size > MAX_VIDEO_SIZE) {
      toast.error(t('create.video_size_error', { name: file.name }));
      return;
    }

    // Revoke previous preview URL
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);

    setVideoFile(file);
    setVideoPreviewUrl(URL.createObjectURL(file));
  }, [videoPreviewUrl, toast, t]);

  const removeVideo = useCallback(() => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    setVideoFile(null);
    setVideoPreviewUrl(null);
  }, [videoPreviewUrl]);

  // Drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleImageSelect(e.dataTransfer.files);
  }, [handleImageSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  // AI description generation
  const handleGenerateDescription = useCallback(async () => {
    if (!title) {
      toast.error(t('create.enter_title_first'));
      return;
    }
    setIsGeneratingDesc(true);
    try {
      const selectedCategory = categories.find((c) => String(c.id) === categoryId);
      const response = await api.post<{ description: string }>('/v2/marketplace/listings/generate-description', {
        title,
        category: selectedCategory?.name || undefined,
        condition,
      });
      if (response.success && response.data?.description) {
        setDescription(response.data.description);
        toast.success(t('create.description_generated'));
      } else {
        toast.error(t('create.description_generate_failed'));
      }
    } catch (err) {
      logError('Failed to generate description', err);
      toast.error(t('create.description_generate_failed'));
    } finally {
      setIsGeneratingDesc(false);
    }
  }, [title, categoryId, condition, categories, setDescription, t, toast]);

  // Submit
  const handleSubmit = useCallback(async () => {
    // Validation
    if (!title.trim()) { toast.error(t('create.title_required')); return; }
    if (!description.trim()) { toast.error(t('create.description_required')); return; }
    if (priceType !== 'free' && (!price || parseFloat(price) <= 0)) {
      toast.error(t('create.price_invalid'));
      return;
    }

    setIsSubmitting(true);
    try {
      // Create listing first
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        condition,
        price_type: priceType,
        delivery_method: deliveryMethod,
        quantity: parseInt(quantity) || 1,
        status: 'active',
      };

      if (categoryId) body.category_id = parseInt(categoryId);
      if (priceType !== 'free' && price) body.price = parseFloat(price);
      if (currency) body.price_currency = currency;
      if (location.trim()) body.location = location.trim();
      if (latitude !== undefined) body.latitude = latitude;
      if (longitude !== undefined) body.longitude = longitude;

      // Include template fields
      const filledTemplateFields = Object.fromEntries(
        Object.entries(templateFields).filter(([, v]) => v.trim() !== '')
      );
      if (Object.keys(filledTemplateFields).length > 0) {
        body.template_data = filledTemplateFields;
      }

      const response = await api.post<{ id: number }>('/v2/marketplace/listings', body);
      if (!response.success || !response.data?.id) {
        toast.error(response.error || t('create.created_error'));
        return;
      }

      const listingId = response.data.id;

      // Then upload images to the created listing
      if (images.length > 0) {
        const formData = new FormData();
        images.forEach((img, idx) => {
          formData.append(`images[${idx}]`, img.file);
        });
        const imageResponse = await api.upload(`/v2/marketplace/listings/${listingId}/images`, formData);
        if (!imageResponse.success) {
          toast.error(imageResponse.error || t('create.created_error_retry'));
          navigate(tenantPath(`/marketplace/${listingId}/edit`));
          return;
        }
      }

      // Upload video if one was selected
      if (videoFile) {
        const videoFormData = new FormData();
        videoFormData.append('video', videoFile);
        const videoResponse = await api.upload(`/v2/marketplace/listings/${listingId}/video`, videoFormData);
        if (!videoResponse.success) {
          toast.error(videoResponse.error || t('create.created_error_retry'));
          navigate(tenantPath(`/marketplace/${listingId}/edit`));
          return;
        }
      }

      toast.success(t('create.created_success'));
      clearDraft();
      // Cleanup blob URLs
      images.forEach((img) => URL.revokeObjectURL(img.url));
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
      navigate(tenantPath(`/marketplace/${listingId}`));
    } catch (err) {
      logError('Failed to create marketplace listing', err);
      toast.error(t('create.created_error_retry'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    title, description, categoryId, condition, price, currency, priceType,
    location, latitude, longitude, deliveryMethod, quantity, images, templateFields,
    clearDraft, t, toast, navigate, tenantPath, videoFile, videoPreviewUrl,
  ]);

  if (!isAuthenticated) return null;

  return (
    <>
      <PageMeta title={t('create.page_title')} noIndex={true} />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            as={Link}
            to={tenantPath('/marketplace')}
            variant="tertiary"
            isIconOnly
            size="sm"
            aria-label={t('common.go_back')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">{t('create.title')}</h1>
            <p className="text-sm text-muted">{t('create.subtitle')}</p>
            {(draft.title || draft.description) && (
              <p className="text-xs text-muted mt-1">
                {t('create.draft_saved')}
              </p>
            )}
          </div>
        </div>

        {/* Section 1: Photos */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex flex-wrap items-center gap-2">
            <Camera className="w-5 h-5 text-accent" />
            {t('create.photos')}
            <span className="text-sm font-normal text-muted">
              {t('create.photos_count', { current: images.length, max: MAX_IMAGES })}
            </span>
          </h2>

          {/* Drop zone */}
          <div
            role="button"
            tabIndex={0}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
            className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer
              hover:border-accent hover:bg-accent/5 transition-colors"
          >
            <Upload className="w-10 h-10 text-muted mx-auto mb-3" />
            <p className="text-sm text-muted">
              {t('create.drop_zone_text')}
            </p>
            <p className="text-xs text-muted mt-1">
              {t('create.drop_zone_limits', { max: MAX_IMAGES })}
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            aria-hidden="true"
            tabIndex={-1}
            accept="image/*"
            multiple
            onChange={(e) => handleImageSelect(e.target.files)}
            className="hidden"
          />

          {/* Image previews */}
          {images.length > 0 && (
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
              {images.map((img, idx) => (
                <div key={img.id} className="relative aspect-square rounded-lg overflow-hidden group">
                  <img
                    src={img.url}
                    alt={t('create.image_alt', { number: idx + 1 })}
                    className="w-full h-full object-cover"
                  />
                  {idx === 0 && (
                    <div className="absolute top-1 left-1">
                      <Chip size="sm" color="accent" variant="primary" className="text-[10px]">
                        {t('create.cover')}
                      </Chip>
                    </div>
                  )}
                  <OverlayActionButton
                    variant="danger"
                    onPress={() => removeImage(img.id)}
                    className="absolute top-1 right-1 rounded-full transition-opacity"
                    aria-label={t('create.remove_image')}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </OverlayActionButton>
                </div>
              ))}

              {images.length < MAX_IMAGES && (
                <Button
                  variant="secondary"
                  onPress={() => fileInputRef.current?.click()}
                  className="aspect-square min-h-24 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center hover:border-accent hover:bg-accent/5 transition-colors min-w-0"
                >
                  <Plus className="w-5 h-5 text-muted" />
                  <span className="text-xs text-muted mt-1">{t('create.add')}</span>
                </Button>
              )}
            </div>
          )}
        </GlassCard>

        {/* Section 1b: Video */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Video className="w-5 h-5 text-accent" />
            {t('create.video')}
            <span className="text-sm font-normal text-muted">
              {t('create.video_optional')}
            </span>
          </h2>

          {videoPreviewUrl ? (
            <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
              <video
                src={videoPreviewUrl}
                controls
                preload="metadata"
                className="w-full h-full object-contain"
              />
              <Button
                isIconOnly
                variant="danger"
                onPress={removeVideo}
                className="absolute top-2 right-2 size-11 min-h-11 min-w-11 rounded-full p-0"
                aria-label={t('create.remove_video')}
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>
          ) : (
            <div
              role="button"
              tabIndex={0}
              onClick={() => videoInputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); videoInputRef.current?.click(); } }}
              className="border-2 border-dashed border-border rounded-xl p-6 text-center cursor-pointer
                hover:border-accent hover:bg-accent/5 transition-colors"
            >
              <Video className="w-8 h-8 text-muted mx-auto mb-2" />
              <p className="text-sm text-muted">
                {t('create.video_drop_zone')}
              </p>
              <p className="text-xs text-muted mt-1">
                {t('create.video_limits')}
              </p>
            </div>
          )}
          {!videoPreviewUrl && (
            <input
              ref={videoInputRef}
              type="file"
              aria-hidden="true"
              tabIndex={-1}
              accept="video/mp4,video/webm,video/quicktime"
              onChange={(e) => handleVideoSelect(e.target.files)}
              className="hidden"
            />
          )}
        </GlassCard>

        {/* Section 2: Details */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-5 h-5 text-accent" />
            {t('create.details')}
          </h2>

          <Input
            label={t('create.title_label')}
            placeholder={t('create.title_placeholder')}
            value={title}
            onValueChange={setTitle}
            isRequired
            maxLength={120}
            description={t('create.title_char_count', { count: title.length })}
          />

          <div className="space-y-2">
            <Textarea
              label={t('create.description_label')}
              placeholder={t('create.description_placeholder')}
              value={description}
              onValueChange={setDescription}
              isRequired
              minRows={4}
              maxRows={10}
            />
            <div className="flex justify-end">
              <Button
                variant="tertiary"
                size="sm"
                startContent={<Sparkles className="w-3.5 h-3.5" />}
                onPress={handleGenerateDescription}
                isLoading={isGeneratingDesc}
                isDisabled={!title.trim()}
              >
                {t('create.generate_with_ai')}
              </Button>
            </div>
          </div>

          <Select
            label={t('create.category_label')}
            placeholder={t('create.category_placeholder')}
            selectedKeys={categoryId ? [categoryId] : []}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0];
              setCategoryId(selected ? String(selected) : '');
            }}
            isLoading={isLoadingCategories}
          >
            {categories.map((cat) => (
              <SelectItem key={String(cat.id)} id={String(cat.id)}>
                {cat.name}
              </SelectItem>
            ))}
          </Select>

          <Select
            label={t('create.condition_label')}
            placeholder={t('create.condition_placeholder')}
            selectedKeys={[condition]}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0];
              if (selected) setCondition(String(selected));
            }}
            isRequired
          >
            {CONDITIONS.map((c) => (
              <SelectItem key={c.value} id={c.value}>
                {t(c.tKey)}
              </SelectItem>
            ))}
          </Select>

          <Input
            label={t('create.quantity_label')}
            type="number"
            min={1}
            value={quantity}
            onValueChange={setQuantity}
            className="max-w-[150px]"
          />

          {/* Dynamic template fields */}
          {isLoadingTemplate && (
            <div role="status" aria-busy="true" aria-label={t('create.loading_category_fields')} className="flex items-center gap-2 py-2">
              <Spinner size="sm" aria-hidden="true" />
              <span className="text-sm text-muted">{t('create.loading_category_fields')}</span>
            </div>
          )}
          {categoryTemplate.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-sm font-medium text-muted">{t('create.category_specific_details')}</p>
              {categoryTemplate.map((field) => {
                if (field.type === 'select' && field.options) {
                  return (
                    <Select
                      key={field.key}
                      label={field.label}
                      placeholder={t('create.select_field_placeholder', { field: field.label.toLowerCase() })}
                      selectedKeys={templateFields[field.key] ? [templateFields[field.key]].filter(Boolean) as string[] : []}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys)[0];
                        setTemplateFields((prev) => ({
                          ...prev,
                          [field.key]: selected ? String(selected) : '',
                        }));
                      }}
                      isRequired={field.required}
                    >
                      {field.options.map((opt) => (
                        <SelectItem key={opt} id={opt}>{opt}</SelectItem>
                      ))}
                    </Select>
                  );
                }
                return (
                  <Input
                    key={field.key}
                    label={field.label}
                    placeholder={t('create.enter_field_placeholder', { field: field.label.toLowerCase() })}
                    type={field.type === 'number' ? 'number' : 'text'}
                    value={templateFields[field.key] || ''}
                    onValueChange={(val) =>
                      setTemplateFields((prev) => ({ ...prev, [field.key]: val }))
                    }
                    isRequired={field.required}
                  />
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* Section 3: Pricing */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-accent" />
            {t('create.pricing')}
          </h2>

          <RadioGroup
            label={t('create.price_type_label')}
            value={priceType}
            onValueChange={setPriceType}
            orientation="horizontal"
          >
            {PRICE_TYPES.map((pt) => (
              <Radio key={pt.value} value={pt.value}>
                {t(pt.tKey)}
              </Radio>
            ))}
          </RadioGroup>

          {priceType !== 'free' && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                label={t('create.price_label')}
                placeholder="0.00"
                type="number"
                min={0}
                step={0.01}
                value={price}
                onValueChange={setPrice}
                isRequired
                className="w-full sm:flex-1"
                startContent={
                  <span className="text-muted text-sm">{currency}</span>
                }
              />
              <Autocomplete
                label={t('create.currency_label')}
                searchPlaceholder={t('create.currency_search')}
                value={currency}
                onChange={(key) => {
                  if (key && !Array.isArray(key)) setCurrency(String(key));
                }}
                className="w-full sm:w-32"
              >
                {SUPPORTED_MARKETPLACE_CURRENCIES.map((option) => (
                  <AutocompleteItem key={option} id={option}>{option}</AutocompleteItem>
                ))}
              </Autocomplete>
            </div>
          )}
        </GlassCard>

        {/* Section 4: Delivery */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Truck className="w-5 h-5 text-accent" />
            {t('create.location_delivery')}
          </h2>

          <PlaceAutocompleteInput
            label={t('create.location_label')}
            placeholder={t('create.location_placeholder')}
            value={location}
            onChange={setLocation}
            onPlaceSelect={(place) => {
              setLocation(place.formattedAddress);
              setLatitude(place.lat);
              setLongitude(place.lng);
            }}
            onClear={() => {
              setLocation('');
              setLatitude(undefined);
              setLongitude(undefined);
            }}
            classNames={{
              inputWrapper: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
            }}
          />

          <RadioGroup
            label={t('create.delivery_method_label')}
            value={deliveryMethod}
            onValueChange={setDeliveryMethod}
            orientation="horizontal"
          >
            {DELIVERY_METHODS.map((dm) => (
              <Radio key={dm.value} value={dm.value}>
                {t(dm.tKey)}
              </Radio>
            ))}
          </RadioGroup>
        </GlassCard>

        {/* Submit */}
        <div className="flex flex-col-reverse gap-3 pb-8 sm:flex-row sm:justify-end">
          <Button
            variant="tertiary"
            as={Link}
            to={tenantPath('/marketplace')}
          >
            {t('create.cancel')}
          </Button>
          <Button

            size="lg"
            onPress={handleSubmit}
            isLoading={isSubmitting}
            startContent={!isSubmitting ? <Package className="w-4 h-4" /> : undefined}
          >
            {t('create.publish')}
          </Button>
        </div>
      </div>
    </>
  );
}

export default CreateMarketplaceListingPage;
