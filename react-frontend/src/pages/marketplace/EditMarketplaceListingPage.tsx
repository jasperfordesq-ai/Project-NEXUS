// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { OverlayActionButton } from '@/components/ui/OverlayActionButton';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
/**
 * EditMarketplaceListingPage — Edit an existing marketplace listing.
 *
 * Loads the listing via GET /v2/marketplace/listings/{id}, pre-populates the
 * same form layout used by CreateMarketplaceListingPage, and saves changes
 * via PUT /v2/marketplace/listings/{id}.
 *
 * Features:
 * - Owner-only access (redirects non-owners)
 * - Existing image management (reorder, delete, add new)
 * - Dynamic category template fields
 * - AI description generation
 * - Redirect to listing detail on save
 * - Requires authentication
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';

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
import Save from 'lucide-react/icons/save';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { PlaceAutocompleteInput } from '@/components/location/PlaceAutocompleteInput';
import type { MarketplaceListingDetail } from '@/types/marketplace';
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
  file?: File;
  url: string;
  /** Existing image id from the server */
  serverId?: number;
  isExisting: boolean;
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
  { value: 'lend', tKey: 'price_type.lend' },
] as const;

const DELIVERY_METHODS = [
  { value: 'pickup', tKey: 'delivery_method.pickup' },
  { value: 'shipping', tKey: 'delivery_method.shipping' },
  { value: 'both', tKey: 'delivery_method.both' },
] as const;

/**
 * A lent item comes back, so it cannot be posted: the API refuses
 * `shipping`/`both` for `price_type = lend` (422). Only collection is offered.
 */
const LEND_DELIVERY_METHODS = DELIVERY_METHODS.filter((dm) => dm.value === 'pickup');

/** Mirrors the API's `loan_terms` max:500 rule. */
const MAX_LOAN_TERMS_LENGTH = 500;

const MAX_IMAGES = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function EditMarketplaceListingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('edit.page_title'));
  const { isAuthenticated, user } = useAuth();
  const { tenant, tenantPath } = useTenant();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Loading / error states
  const [isLoadingListing, setIsLoadingListing] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [condition, setCondition] = useState('good');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(() => normalizeSupportedMarketplaceCurrency(tenant?.currency));
  const [priceType, setPriceTypeState] = useState('fixed');
  const [loanTerms, setLoanTerms] = useState('');
  const isLend = priceType === 'lend';
  const hasPrice = priceType !== 'free' && !isLend;
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const setPriceType = (v: string) => {
    setPriceTypeState(v);
    // Switching to lend while a postal option is selected would be refused by
    // the API, so fall back to collection rather than leave a hidden invalid value.
    if (v === 'lend') setDeliveryMethod('pickup');
  };
  const [quantity, setQuantity] = useState('1');
  const [images, setImages] = useState<ImagePreview[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [templateFields, setTemplateFields] = useState<Record<string, string>>({});
  // AG46 — inventory tracking
  const [inventoryUnlimited, setInventoryUnlimited] = useState(true);
  const [inventoryCount, setInventoryCount] = useState('0');
  const [lowStockThreshold, setLowStockThreshold] = useState('5');
  const [oversoldProtected, setOversoldProtected] = useState(true);
  const [loadedInventoryFields, setLoadedInventoryFields] = useState({
    inventory: false,
    threshold: false,
    oversold: false,
  });

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

  // Load listing data
  useEffect(() => {
    if (!id || !isAuthenticated) return;
    let cancelled = false;

    const load = async () => {
      setIsLoadingListing(true);
      setLoadError(null);
      try {
        const response = await api.get<MarketplaceListingDetail>(`/v2/marketplace/listings/${id}`);
        if (cancelled) return;

        if (!response.success || !response.data) {
          setLoadError(t('edit.not_found'));
          return;
        }

        const listing = response.data;

        // Owner check
        if (!listing.is_own && listing.user?.id !== user?.id) {
          toast.error(t('edit.not_owner'));
          navigate(tenantPath(`/marketplace/${id}`), { replace: true });
          return;
        }

        // Populate form
        setTitle(listing.title);
        setDescription(listing.description || '');
        setCategoryId(listing.category?.id ? String(listing.category.id) : '');
        setCondition(listing.condition || 'good');
        setPrice(listing.price != null ? String(listing.price) : '');
        setCurrency(
          listing.price_currency?.trim().toUpperCase()
            || normalizeSupportedMarketplaceCurrency(tenant?.currency),
        );
        setPriceTypeState(listing.price_type || 'fixed');
        setLoanTerms(listing.price_type === 'lend' ? (listing.loan_terms ?? '') : '');
        setLocation(listing.location || '');
        setLatitude(listing.latitude ?? undefined);
        setLongitude(listing.longitude ?? undefined);
        setDeliveryMethod(listing.delivery_method || 'pickup');
        setQuantity(String(listing.quantity ?? 1));

        // AG46 — load inventory tracking
        const inv = (listing as unknown as {
          inventory_count?: number | null;
          low_stock_threshold?: number | null;
          is_oversold_protected?: boolean;
        });
        const hasInventory = Object.prototype.hasOwnProperty.call(inv, 'inventory_count');
        const hasThreshold = Object.prototype.hasOwnProperty.call(inv, 'low_stock_threshold');
        const hasOversold = Object.prototype.hasOwnProperty.call(inv, 'is_oversold_protected');
        setLoadedInventoryFields({
          inventory: hasInventory,
          threshold: hasThreshold,
          oversold: hasOversold,
        });
        if (hasInventory) {
          if (inv.inventory_count == null) {
            setInventoryUnlimited(true);
            setInventoryCount('0');
          } else {
            setInventoryUnlimited(false);
            setInventoryCount(String(inv.inventory_count));
          }
        }
        if (hasThreshold && inv.low_stock_threshold != null) {
          setLowStockThreshold(String(inv.low_stock_threshold));
        }
        if (hasOversold && typeof inv.is_oversold_protected === 'boolean') {
          setOversoldProtected(inv.is_oversold_protected);
        }

        // Map existing images
        if (listing.images?.length) {
          setImages(
            listing.images.map((img) => ({
              id: `existing-${img.id}`,
              url: img.url,
              serverId: img.id,
              isExisting: true,
            }))
          );
        }

        // Template fields
        if (listing.template_data && typeof listing.template_data === 'object') {
          const fields: Record<string, string> = {};
          for (const [key, val] of Object.entries(listing.template_data)) {
            fields[key] = String(val ?? '');
          }
          setTemplateFields(fields);
        }
      } catch (err) {
        logError('Failed to load marketplace listing for edit', err);
        if (!cancelled) {
          setLoadError(t('edit.load_error'));
        }
      } finally {
        if (!cancelled) setIsLoadingListing(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id, isAuthenticated, user?.id, navigate, tenant?.currency, tenantPath, toast, t])

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
          // Initialize missing template field values (keep existing ones)
          setTemplateFields((prev) => {
            const next = { ...prev };
            response.data!.fields.forEach((f) => {
              if (!(f.key in next)) next[f.key] = '';
            });
            return next;
          });
        } else if (!cancelled) {
          setCategoryTemplate([]);
        }
      } catch (err) {
        logError('Failed to load category template', err);
        if (!cancelled) setCategoryTemplate([]);
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
        isExisting: false,
      });
    }

    setImages((prev) => [...prev, ...newImages]);
  }, [images.length, toast, t])

  const removeImage = useCallback((imgId: string) => {
    setImages((prev) => {
      const img = prev.find((i) => i.id === imgId);
      if (!img) return prev;

      // Track removed existing images for the API
      if (img.isExisting && img.serverId) {
        setRemovedImageIds((ids) => [...ids, img.serverId!]);
      } else if (!img.isExisting) {
        URL.revokeObjectURL(img.url);
      }

      return prev.filter((i) => i.id !== imgId);
    });
  }, []);

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
  }, [title, categoryId, condition, categories, t, toast]);

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!title.trim()) { toast.error(t('create.title_required')); return; }
    if (!description.trim()) { toast.error(t('create.description_required')); return; }
    if (hasPrice && (!price || parseFloat(price) <= 0)) {
      toast.error(t('create.price_invalid'));
      return;
    }
    if (isLend && loanTerms.trim().length > MAX_LOAN_TERMS_LENGTH) {
      toast.error(t('create.loan_terms_too_long', { max: MAX_LOAN_TERMS_LENGTH }));
      return;
    }

    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim(),
        condition,
        price_type: priceType,
        // Lend listings are collected in person; the API refuses postal options.
        delivery_method: isLend ? 'pickup' : deliveryMethod,
        quantity: parseInt(quantity) || 1,
      };
      if (isLend) {
        // Explicit zeros: a listing that was for sale keeps its stored price
        // otherwise, and the API rejects a lend listing carrying any cash or
        // time-credit price or a postal option.
        body.price = 0;
        body.time_credit_price = 0;
        body.shipping_available = false;
        body.loan_terms = loanTerms.trim() || null;
      }

      // Only round-trip inventory fields that the API actually supplied, or
      // that the seller explicitly changed. Older responses omitted these
      // fields; treating omission as null silently erased finite inventory.
      if (loadedInventoryFields.inventory) {
        body.inventory_count = inventoryUnlimited ? null : Math.max(0, parseInt(inventoryCount) || 0);
      }
      if (loadedInventoryFields.threshold) {
        body.low_stock_threshold = Math.max(0, parseInt(lowStockThreshold) || 0);
      }
      if (loadedInventoryFields.oversold) {
        body.is_oversold_protected = oversoldProtected;
      }

      if (categoryId) body.category_id = parseInt(categoryId);
      if (hasPrice && price) body.price = parseFloat(price);
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

      const response = await api.put(`/v2/marketplace/listings/${id}`, body);
      if (response.success) {
        for (const removedId of removedImageIds) {
          const deleteResponse = await api.delete(`/v2/marketplace/listings/${id}/images/${removedId}`);
          if (!deleteResponse.success) {
            toast.error(deleteResponse.error || t('edit.updated_error_retry'));
            return;
          }
        }

        const newImageFiles = images.filter((img) => !img.isExisting && img.file);
        if (newImageFiles.length > 0) {
          const formData = new FormData();
          newImageFiles.forEach((img, idx) => {
            formData.append(`images[${idx}]`, img.file!);
          });
          const uploadResponse = await api.upload(
            `/v2/marketplace/listings/${id}/images`,
            formData,
          );
          if (!uploadResponse.success) {
            toast.error(uploadResponse.error || t('edit.updated_error_retry'));
            return;
          }
        }

        toast.success(t('edit.updated_success'));
        // Cleanup blob URLs
        images.forEach((img) => {
          if (!img.isExisting) URL.revokeObjectURL(img.url);
        });
        navigate(tenantPath(`/marketplace/${id}`));
      } else {
        toast.error(response.error || t('edit.updated_error'));
      }
    } catch (err) {
      logError('Failed to update marketplace listing', err);
      toast.error(t('edit.updated_error_retry'));
    } finally {
      setIsSubmitting(false);
    }
  }, [
    id, title, description, categoryId, condition, price, currency, priceType, hasPrice, isLend, loanTerms,
    location, latitude, longitude, deliveryMethod, quantity, images, removedImageIds, templateFields,
    inventoryUnlimited, inventoryCount, lowStockThreshold, oversoldProtected, loadedInventoryFields,
    toast, navigate, tenantPath, t,
  ]);

  if (!isAuthenticated) return null;

  // Loading state
  if (isLoadingListing) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
        <Spinner size="lg" color="accent" />
      </div>
    );
  }

  // Error state
  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={<Package className="w-8 h-8" />}
          title={t('edit.not_found_title')}
          description={loadError}
          action={{
            label: t('listing.back_to_marketplace'),
            onClick: () => navigate(tenantPath('/marketplace')),
          }}
        />
      </div>
    );
  }

  return (
    <>
      <PageMeta title={t('edit.page_title')} noIndex={true} />

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            as={Link}
            to={tenantPath(`/marketplace/${id}`)}
            variant="tertiary"
            isIconOnly
            size="sm"
            aria-label={t('common.go_back')}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground">{t('edit.title')}</h1>
            <p className="text-sm text-muted">{t('edit.subtitle')}</p>
          </div>
        </div>

        {/* Section 1: Photos */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
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
            accept="image/*"
            multiple
            onChange={(e) => handleImageSelect(e.target.files)}
            className="hidden"
            aria-hidden="true"
            tabIndex={-1}
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

        {/* Section 2: Details */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground flex flex-wrap items-center gap-2">
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

          {/* AG46 — Inventory tracking */}
          <div className="border-t border-separator pt-4 space-y-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">
                {t('inventory.section_title')}
              </h3>
              <p className="text-xs text-muted">
                {t('inventory.section_subtitle')}
              </p>
            </div>
            <Switch
              isSelected={inventoryUnlimited}
              onValueChange={(value) => {
                setLoadedInventoryFields((current) => ({ ...current, inventory: true }));
                setInventoryUnlimited(value);
              }}
            >
              {t('inventory.unlimited')}
            </Switch>
            {!inventoryUnlimited && (
              <div className="flex flex-wrap gap-3">
                <Input
                  label={t('inventory.count')}
                  type="number"
                  min={0}
                  value={inventoryCount}
                  onValueChange={(value) => {
                    setLoadedInventoryFields((current) => ({ ...current, inventory: true }));
                    setInventoryCount(value);
                  }}
                  className="max-w-[180px]"
                />
                <Input
                  label={t('inventory.low_stock_threshold')}
                  type="number"
                  min={0}
                  value={lowStockThreshold}
                  onValueChange={(value) => {
                    setLoadedInventoryFields((current) => ({ ...current, threshold: true }));
                    setLowStockThreshold(value);
                  }}
                  className="max-w-[180px]"
                />
              </div>
            )}
            <Switch
              isSelected={oversoldProtected}
              onValueChange={(value) => {
                setLoadedInventoryFields((current) => ({ ...current, oversold: true }));
                setOversoldProtected(value);
              }}
            >
              {t('inventory.oversold_protected')}
            </Switch>
          </div>

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

          {isLend && (
            <div className="space-y-3">
              <p className="text-sm text-muted">{t('create.lend_no_price_hint')}</p>
              <Textarea
                label={t('create.loan_terms_label')}
                placeholder={t('create.loan_terms_placeholder')}
                description={t('create.loan_terms_hint', { max: MAX_LOAN_TERMS_LENGTH, used: loanTerms.length })}
                value={loanTerms}
                onValueChange={setLoanTerms}
                maxLength={MAX_LOAN_TERMS_LENGTH}
                minRows={3}
                maxRows={6}
              />
            </div>
          )}

          {hasPrice && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                label={t('create.price_label')}
                placeholder={currency === 'JPY' ? '0' : '0.00'}
                type="number"
                min={0}
                step={currency === 'JPY' ? 1 : 0.01}
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
                {(currency && !SUPPORTED_MARKETPLACE_CURRENCIES.includes(
                  currency as (typeof SUPPORTED_MARKETPLACE_CURRENCIES)[number],
                )
                  ? [currency, ...SUPPORTED_MARKETPLACE_CURRENCIES]
                  : SUPPORTED_MARKETPLACE_CURRENCIES
                ).map((option) => (
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
            value={isLend ? 'pickup' : deliveryMethod}
            onValueChange={setDeliveryMethod}
            orientation="horizontal"
            description={isLend ? t('create.lend_delivery_hint') : undefined}
          >
            {(isLend ? LEND_DELIVERY_METHODS : DELIVERY_METHODS).map((dm) => (
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
            to={tenantPath(`/marketplace/${id}`)}
          >
            {t('common.cancel')}
          </Button>
          <Button

            size="lg"
            onPress={handleSubmit}
            isLoading={isSubmitting}
            startContent={!isSubmitting ? <Save className="w-4 h-4" /> : undefined}
          >
            {t('edit.save_changes')}
          </Button>
        </div>
      </div>
    </>
  );
}

export default EditMarketplaceListingPage;
