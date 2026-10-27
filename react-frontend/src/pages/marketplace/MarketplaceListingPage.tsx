// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceListingPage — Detail page for a single marketplace listing.
 *
 * Features:
 * - Image gallery (grid on desktop, swipeable on mobile)
 * - Price display with currency/free/negotiable badges
 * - Seller card with avatar, rating, response time
 * - Action buttons: Make Offer, Message Seller, Save
 * - "More from this seller" section
 * - View count increment on mount
 */

import { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { motion, AnimatePresence } from '@/lib/motion';

import { Separator } from '@/components/ui/Separator';
import Heart from 'lucide-react/icons/heart';
import MessageCircle from 'lucide-react/icons/message-circle';
import MapPin from 'lucide-react/icons/map-pin';
import Eye from 'lucide-react/icons/eye';
import Clock from 'lucide-react/icons/clock';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Share2 from 'lucide-react/icons/share-2';
import Star from 'lucide-react/icons/star';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import ChevronRight from 'lucide-react/icons/chevron-right';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Package from 'lucide-react/icons/package';
import User from 'lucide-react/icons/user';
import ExternalLink from 'lucide-react/icons/external-link';
import Flag from 'lucide-react/icons/flag';
import Handshake from 'lucide-react/icons/handshake';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { BuyNowButton } from '@/components/marketplace/BuyNowButton';
import {
  LoyaltyRedemptionCard,
  type LoyaltyRedemptionSelection,
} from '@/components/marketplace/LoyaltyRedemptionCard';
import { MarketplaceListingDetailSkeleton } from '@/components/marketplace/MarketplaceListingDetailSkeleton';
import { ShippingSelector } from '@/components/marketplace/ShippingSelector';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveThumbnailUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageMeta } from '@/components/seo/PageMeta';
import { VerificationBadgeRow } from '@/components/verification/VerificationBadge';
import type { MarketplaceShippingOption } from '@/types/marketplace';
import { formatMarketplaceCurrency, normalizeMarketplaceListing } from '@/lib/marketplaceNumbers';
import { toJsonLd } from '@/lib/json-ld';
import { useLoginRedirect } from '@/hooks/useLoginRedirect';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ListingDetail {
  id: number;
  title: string;
  description: string;
  tagline?: string;
  price: number | null;
  price_currency: string;
  price_type: 'fixed' | 'negotiable' | 'free' | 'auction' | 'contact' | 'lend';
  time_credit_price?: number | null;
  /** Owner's conditions for a borrow & lend listing; the API returns it only when price_type is 'lend'. */
  loan_terms?: string | null;
  condition: string;
  quantity: number;
  category?: { id: number; name: string; slug: string; icon?: string } | null;
  location: string | null;
  latitude: number | null;
  longitude: number | null;
  shipping_available: boolean;
  local_pickup: boolean;
  delivery_method: string | null;
  seller_type: string;
  images: { id: number; url: string; thumbnail_url?: string; alt_text?: string; is_primary?: boolean }[];
  video_url?: string | null;
  user: {
    id: number;
    name: string;
    avatar_url: string | null;
    is_verified?: boolean;
    member_since?: string;
  } | null;
  template_data: Record<string, unknown> | null;
  views_count: number;
  saves_count: number;
  is_saved: boolean;
  is_own: boolean;
  is_promoted: boolean;
  status: string;
  expires_at?: string;
  created_at: string;
  updated_at: string;
}

interface SellerListing {
  id: number;
  title: string;
  price: number | null;
  price_type: string;
  price_currency: string;
  images: { url: string; thumbnail_url: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CONDITION_COLORS: Record<string, 'success' | 'primary' | 'warning' | 'danger' | 'default'> = {
  new: 'success',
  like_new: 'primary',
  good: 'warning',
  fair: 'danger',
  poor: 'default',
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface PriceLabels {
  free: string;
  lend: string;
}

function formatPrice(price: number | null, priceType: string, currency: string, labels: PriceLabels): string {
  // Lend first: a lend listing also has a null/zero price, but it is not "free" —
  // the item comes back.
  if (priceType === 'lend') return labels.lend;
  if (priceType === 'free' || price === null || price === 0) return labels.free;
  return formatMarketplaceCurrency(price, currency);
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON-LD structured data
// ─────────────────────────────────────────────────────────────────────────────

const AVAILABILITY_MAP: Record<string, string> = {
  active: 'https://schema.org/InStock',
  sold: 'https://schema.org/SoldOut',
  reserved: 'https://schema.org/LimitedAvailability',
  expired: 'https://schema.org/Discontinued',
};

const CONDITION_MAP: Record<string, string> = {
  new: 'https://schema.org/NewCondition',
  like_new: 'https://schema.org/UsedCondition',
  good: 'https://schema.org/UsedCondition',
  fair: 'https://schema.org/UsedCondition',
  poor: 'https://schema.org/DamagedCondition',
};

function buildProductSchema(
  listing: ListingDetail,
  tenantPath: (p: string) => string,
  tenantName: string,
): string {
  const base = window.location.origin;
  const canonicalUrl = base + tenantPath(`/marketplace/${listing.id}`);

  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    'name': listing.title,
    'description': listing.description ?? '',
    'sku': String(listing.id),
    'brand': {
      '@type': 'Organization',
      'name': tenantName,
    },
  };

  // A borrow & lend listing is not for sale, so it carries no Offer at all: a
  // zero-priced Offer would tell search engines the item can be had for nothing.
  // Free (Freecycle) items genuinely can, so they keep an Offer at price 0.
  if (listing.price_type !== 'lend') {
    schema['offers'] = {
      '@type': 'Offer',
      'url': canonicalUrl,
      'priceCurrency': listing.price_currency,
      'price': listing.price_type === 'free' ? '0' : String(listing.price ?? 0),
      'availability': AVAILABILITY_MAP[listing.status] ?? 'https://schema.org/InStock',
      'itemCondition': listing.condition
        ? (CONDITION_MAP[listing.condition] ?? 'https://schema.org/UsedCondition')
        : undefined,
      'seller': {
        '@type': 'Person',
        'name': listing.user?.name || '',
      },
    };
  }

  // Image URLs
  if (listing.images.length > 0) {
    schema['image'] = listing.images.map((img) => img.url);
  }

  return toJsonLd(schema);
}

function getDeliveryMethodKey(method: string): string {
  if (method === 'pickup' || method === 'shipping' || method === 'both' || method === 'community_delivery') {
    return `delivery_method.${method}`;
  }
  return 'delivery_method.other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Image Gallery
// ─────────────────────────────────────────────────────────────────────────────

function ImageGallery({ images, videoUrl }: { images: ListingDetail['images']; videoUrl?: string | null }) {
  const { t } = useTranslation('marketplace');
  const [activeIndex, setActiveIndex] = useState(0);

  if (images.length === 0 && !videoUrl) {
    return (
      <div className="aspect-video bg-surface-secondary rounded-xl flex items-center justify-center">
        <ShoppingBag className="w-16 h-16 text-muted" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Video player — shown above images if available */}
      {videoUrl && (
        <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
          <video
            src={videoUrl}
            controls
            preload="metadata"
            className="w-full h-full object-contain"
            aria-label={t('listing.video')}
          >
            {t('listing.video_unsupported')}
          </video>
        </div>
      )}

      {images.length === 0 ? null : (
      <>
      {/* Main image */}
      <div className="relative aspect-video bg-surface-secondary rounded-xl overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.img
            key={activeIndex}
            {...responsiveThumbnailProps(images[activeIndex]?.url, {
              width: 1200,
              height: 675,
              fit: 'contain',
              widths: [640, 960, 1200],
              sizes: '(max-width: 768px) 100vw, 58vw',
            })}
            alt={images[activeIndex]?.alt_text || t('listing.image_alt', { number: activeIndex + 1 })}
            className="w-full h-full object-contain"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            decoding="async"
          />
        </AnimatePresence>

        {images.length > 1 && (
          <>
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={() => setActiveIndex((i) => (i - 1 + images.length) % images.length)}
              className="absolute left-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm"
              aria-label={t('listing.previous_image')}
            >
              <ChevronLeft className="w-5 h-5" aria-hidden="true" />
            </Button>
            <Button
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={() => setActiveIndex((i) => (i + 1) % images.length)}
              className="absolute right-2 top-1/2 -translate-y-1/2 bg-background/80 backdrop-blur-sm"
              aria-label={t('listing.next_image')}
            >
              <ChevronRight className="w-5 h-5" aria-hidden="true" />
            </Button>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
              {images.map((image, idx) => (
                <Button
                  key={image.id}
                  isIconOnly
                  variant="tertiary"
                  size="sm"
                  onPress={() => setActiveIndex(idx)}
                  className={`w-2 h-2 min-w-0 min-h-0 rounded-full p-0 ${
                    idx === activeIndex ? 'bg-accent' : 'bg-white/50'
                  }`}
                  aria-label={t('listing.view_image', { number: idx + 1 })}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {images.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {images.map((img, idx) => (
            <Button
              key={img.id || idx}
              isIconOnly
              variant="tertiary"
              size="sm"
              onPress={() => setActiveIndex(idx)}
              aria-label={t('listing.thumbnail_label', { n: idx + 1 })}
              className={`shrink-0 w-16 h-16 min-w-0 rounded-lg overflow-hidden border-2 transition-colors p-0 ${
                idx === activeIndex ? 'border-accent' : 'border-transparent'
              }`}
            >
              <img
                src={resolveThumbnailUrl(img.thumbnail_url || img.url, { width: 128, height: 128 })}
                alt={t('listing.thumbnail_alt', { number: idx + 1 })}
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </Button>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceListingPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('page_title'));
  const { isAuthenticated } = useAuth();
  const { tenant, tenantPath, branding, hasModule, hasFeature } = useTenant();
  const { loginTarget } = useLoginRedirect(tenantPath);
  // Same gate as SellerProfilePage: without messaging there is nothing behind
  // "Message seller" / "Ask to borrow", so the buttons must not render.
  const canMessage = hasModule('messages') && hasFeature('direct_messaging');
  const toast = useToast();
  const offerModal = useDisclosure();
  const priceLabels: PriceLabels = { free: t('price.free'), lend: t('price.lend') };

  // State
  const [listing, setListing] = useState<ListingDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sellerListings, setSellerListings] = useState<SellerListing[]>([]);
  const [offerAmount, setOfferAmount] = useState('');
  const [offerMessage, setOfferMessage] = useState('');
  const [isSubmittingOffer, setIsSubmittingOffer] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [selectedShippingOption, setSelectedShippingOption] = useState<MarketplaceShippingOption | null | undefined>(undefined);
  const [loyaltyRedemption, setLoyaltyRedemption] = useState<LoyaltyRedemptionSelection | null>(null);
  const [checkoutPaymentMethod, setCheckoutPaymentMethod] = useState<'cash' | 'time_credits'>('cash');
  const sellerId = listing?.user?.id;

  // Load listing
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await api.get<ListingDetail>(`/v2/marketplace/listings/${id}`);
        if (cancelled) return;
        if (response.success && response.data) {
          setListing(normalizeMarketplaceListing(response.data));
        } else {
          setError(response.error || t('listing.not_found_title'));
        }
      } catch (err) {
        if (!cancelled) {
          logError('Failed to load marketplace listing', err);
          setError(t('hub.unable_to_load'));
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [id, t])

  // Load seller listings
  useEffect(() => {
    if (!sellerId || !listing?.id) return;
    let cancelled = false;

    const load = async () => {
      try {
        const response = await api.get<SellerListing[]>(
          `/v2/marketplace/sellers/${sellerId}/listings?limit=4`
        );
        if (!cancelled && response.success && response.data) {
          setSellerListings(response.data.filter((l) => l.id !== listing.id));
        }
      } catch (err) {
        logError('Failed to load seller listings', err);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [sellerId, listing?.id]);

  useEffect(() => {
    setSelectedShippingOption(undefined);
    setLoyaltyRedemption(null);
    setCheckoutPaymentMethod('cash');
  }, [listing?.id]);

  // Toggle save
  const handleToggleSave = useCallback(async () => {
    if (!listing || !isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = listing.is_saved
        ? await api.delete(`/v2/marketplace/listings/${listing.id}/save`)
        : await api.post(`/v2/marketplace/listings/${listing.id}/save`);
      if (response.success) {
        setListing((prev) => prev ? { ...prev, is_saved: !prev.is_saved } : prev);
        toast.success(listing.is_saved ? t('common.removed_from_saved') : t('common.saved_for_later'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to toggle save', err);
      toast.error(t('common.save_failed'));
    }
  }, [listing, isAuthenticated, toast, t])

  // Share
  const handleShare = useCallback(async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: listing?.title, url });
      } catch {
        // User cancelled share
      }
    } else {
      await navigator.clipboard.writeText(url);
      toast.success(t('listing.link_copied'));
    }
  }, [listing?.title, toast, t])

  // Submit report
  const handleSubmitReport = useCallback(async () => {
    if (!listing || !reportReason.trim()) return;
    try {
      const response = await api.post<{ id: number }>(`/v2/marketplace/listings/${listing.id}/report`, { reason: 'other', description: reportReason.trim() });
      if (response.success) {
        toast.success(t('listing.report_submitted'));
        if (response.data?.id) {
          navigate(tenantPath(`/marketplace/reports/${response.data.id}`));
        }
      } else {
        toast.error(response.error || t('listing.report_error'));
      }
    } catch {
      toast.error(t('listing.report_error'));
    } finally {
      setReportModalOpen(false);
      setReportReason('');
    }
  }, [listing, navigate, reportReason, tenantPath, toast, t])

  // Make offer
  const handleMakeOffer = useCallback(async () => {
    if (!listing || !offerAmount) return;
    const parsedOffer = Math.round(parseFloat(offerAmount) * 100) / 100;
    if (parsedOffer <= 0 || parsedOffer > 999999) {
      toast.error(t('offer.amount_invalid'));
      return;
    }
    setIsSubmittingOffer(true);
    try {
      const response = await api.post(`/v2/marketplace/listings/${listing.id}/offers`, {
        amount: parsedOffer,
        message: offerMessage || undefined,
      });
      if (response.success) {
        toast.success(t('offer.sent_success'));
        offerModal.onClose();
        setOfferAmount('');
        setOfferMessage('');
      } else {
        toast.error(response.error || t('offer.sent_error'));
      }
    } catch (err) {
      logError('Failed to make offer', err);
      toast.error(t('offer.sent_error'));
    } finally {
      setIsSubmittingOffer(false);
    }
  }, [listing, offerAmount, offerMessage, toast, offerModal, t])

  // Loading state — skeleton instead of spinner
  if (isLoading) {
    return (
      <>
        <PageMeta title={t('page_title')} noIndex />
        <div role="status" aria-label={t('common.loading')} aria-busy="true">
          <MarketplaceListingDetailSkeleton />
        </div>
      </>
    );
  }

  // Error state
  if (error || !listing) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <PageMeta title={t('listing.not_found_title')} noIndex />
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8" />}
          title={t('listing.not_found_title')}
          description={error || t('listing.not_found_description')}
          action={{ label: t('listing.back_to_marketplace'), onClick: () => navigate(tenantPath('/marketplace')) }}
        />
      </div>
    );
  }

  const listingCurrency = listing.price_currency || tenant?.currency || '';
  const priceDisplay = formatPrice(listing.price, listing.price_type, listingCurrency, priceLabels);
  const shippingRequired = Boolean(listing.shipping_available || listing.local_pickup);
  const isOwnListing = listing.is_own;
  // Borrow & lend: never bought, never offered on — the API answers 422 to both.
  // Borrowers ask the owner through the existing message-seller route.
  const isLendListing = listing.price_type === 'lend';
  const messageSellerHref = listing.user
    ? tenantPath(
        `/messages?to=${listing.user.id}&ref=marketplace&listing_id=${listing.id}`
        + `&listing_title=${encodeURIComponent(listing.title)}`
        + `&body=${encodeURIComponent(t(isLendListing ? 'listing.borrow_message_template' : 'listing.message_template', { title: listing.title }))}`,
      )
    : undefined;
  const hasCashCheckout = listing.price_type === 'fixed'
    && listing.price != null
    && listing.price > 0;
  const hasTimeCreditCheckout = Number(listing.time_credit_price ?? 0) > 0;
  const isHybridCheckout = hasCashCheckout && hasTimeCreditCheckout;
  const effectivePaymentMethod: 'cash' | 'time_credits' | 'free' = listing.price_type === 'free'
    ? 'free'
    : hasTimeCreditCheckout && !hasCashCheckout
      ? 'time_credits'
      : checkoutPaymentMethod;
  const metaDescription = (listing.tagline || listing.description || t('listing.meta_description_fallback'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

  return (
    <>
      <PageMeta
        title={`${listing.title} - ${t('page_title')}`}
        description={metaDescription}
        image={listing.images.find((image) => image.is_primary)?.url || listing.images[0]?.url}
        type="article"
        publishedTime={listing.created_at}
        modifiedTime={listing.updated_at}
      />
      <Helmet>
        <script type="application/ld+json">
          {buildProductSchema({ ...listing, price_currency: listingCurrency }, tenantPath, branding.name)}
        </script>
      </Helmet>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* Breadcrumb / Back */}
        <div className="flex items-center gap-2 text-sm">
          <Button
            as={Link}
            to={tenantPath('/marketplace')}
            variant="tertiary"
            size="sm"
            startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
          >
            {t('listing.marketplace')}
          </Button>
          {listing.category?.name && listing.category?.slug && (
            <>
              <span className="text-muted">/</span>
              <Link
                to={tenantPath(`/marketplace/category/${listing.category?.slug}`)}
                className="text-muted hover:text-accent transition-colors"
              >
                {listing.category?.name}
              </Link>
            </>
          )}
        </div>

        {/* Main content */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Image gallery — 3 cols */}
          <div className="lg:col-span-3">
            <ImageGallery images={listing.images} videoUrl={listing.video_url} />
          </div>

          {/* Details sidebar — 2 cols */}
          <div className="lg:col-span-2 space-y-4">
            {/* Price */}
            <GlassCard className="p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  {isLendListing ? (
                    <Chip
                      size="lg"
                      color="accent"
                      variant="primary"
                      className="font-semibold"
                      startContent={<Handshake className="w-4 h-4" aria-hidden="true" />}
                    >
                      {t('listing.lend')}
                    </Chip>
                  ) : (
                    <span className="text-3xl font-bold text-foreground">{priceDisplay}</span>
                  )}
                  {listing.price_type === 'negotiable' && (
                    <Chip size="sm" color="warning" variant="soft" className="ml-2">
                      {t('listing.negotiable')}
                    </Chip>
                  )}
                  {listing.price_type === 'free' && (
                    <Chip size="sm" color="success" variant="soft" className="ml-2">
                      {t('listing.free')}
                    </Chip>
                  )}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Button
                    isIconOnly
                    variant="tertiary"
                    size="sm"
                    onPress={handleShare}
                    aria-label={t('listing.share_aria')}
                  >
                    <Share2 className="w-4 h-4" />
                  </Button>
                  <Button
                    isIconOnly
                    variant={listing.is_saved ? 'danger-soft' : 'tertiary'}
                    size="sm"
                    onPress={handleToggleSave}
                    aria-label={listing.is_saved ? t('listing.unsave_aria') : t('listing.save_aria')}
                  >
                    <Heart className={`w-4 h-4 ${listing.is_saved ? 'fill-current' : ''}`} />
                  </Button>
                </div>
              </div>

              <h1 className="text-xl font-semibold text-foreground">{listing.title}</h1>

              <div className="flex items-center gap-2 flex-wrap">
                {listing.condition && (
                  <Chip
                    size="sm"
                    variant="soft"
                    color={CONDITION_COLORS[listing.condition] || 'default'}
                  >
                    {t(`condition.${listing.condition}`)}
                  </Chip>
                )}
                {listing.quantity > 1 && (
                  <Chip size="sm" variant="soft" startContent={<Package className="w-3 h-3" aria-hidden="true" />}>
                    {t('listing.available_count', { count: listing.quantity })}
                  </Chip>
                )}
                {listing.is_promoted && (
                  <Chip size="sm" color="warning" variant="soft" startContent={<Star className="w-3 h-3" aria-hidden="true" />}>
                    {t('listing.featured')}
                  </Chip>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                {listing.location && (
                  <span className="flex items-center gap-1">
                    <MapPin className="w-3 h-3" aria-hidden="true" />
                    {listing.location}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Eye className="w-3 h-3" aria-hidden="true" />
                  {t('listing.views_count', { count: listing.views_count })}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {new Date(listing.created_at).toLocaleDateString(getFormattingLocale())}
                </span>
              </div>

              {/* Action buttons */}
              {!isOwnListing && <div className="flex flex-col gap-2 pt-2">
                {!isLendListing && ((listing.price_type === 'fixed' && listing.price != null && listing.price > 0)
                  || listing.price_type === 'free'
                  || Number(listing.time_credit_price ?? 0) > 0) && (
                  <>
                    {isHybridCheckout && (
                      <div className="space-y-2" role="group" aria-label={t('checkout.payment_method_label')}>
                        <p className="text-sm font-medium text-theme-primary">
                          {t('checkout.payment_method_label')}
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <Button
                            variant={checkoutPaymentMethod === 'cash' ? 'primary' : 'secondary'}
                            aria-pressed={checkoutPaymentMethod === 'cash'}
                            onPress={() => setCheckoutPaymentMethod('cash')}
                          >
                            {t('checkout.pay_with_money', { amount: priceDisplay })}
                          </Button>
                          <Button
                            variant={checkoutPaymentMethod === 'time_credits' ? 'primary' : 'secondary'}
                            aria-pressed={checkoutPaymentMethod === 'time_credits'}
                            onPress={() => {
                              setCheckoutPaymentMethod('time_credits');
                              setLoyaltyRedemption(null);
                            }}
                          >
                            {t('checkout.pay_with_time_credits', { count: Number(listing.time_credit_price ?? 0) })}
                          </Button>
                        </div>
                      </div>
                    )}
                    {hasCashCheckout && effectivePaymentMethod === 'cash' && (
                      <LoyaltyRedemptionCard
                        sellerId={listing.user?.id ?? 0}
                        listingId={listing.id}
                        orderTotalChf={listing.price ?? 0}
                        currency={listing.price_currency || 'CHF'}
                        onRedemptionChange={setLoyaltyRedemption}
                      />
                    )}
                    {(listing.shipping_available || listing.local_pickup) && (
                      <ShippingSelector
                        sellerId={listing.user?.id ?? 0}
                        localPickup={listing.local_pickup}
                        freeOnly={effectivePaymentMethod !== 'cash'}
                        onSelect={setSelectedShippingOption}
                      />
                    )}
                    <BuyNowButton
                      listingId={listing.id}
                      listingTitle={listing.title}
                      price={listing.price ?? 0}
                      currency={listing.price_currency}
                      sellerId={listing.user?.id ?? 0}
                      selectedShippingOption={selectedShippingOption}
                      shippingRequired={shippingRequired}
                      loyaltyRedemptionId={loyaltyRedemption?.redemptionId}
                      loyaltyDiscount={loyaltyRedemption?.discountChf}
                      paymentMethod={effectivePaymentMethod}
                      timeCredits={Number(listing.time_credit_price ?? 0)}
                      shippingMethod={listing.delivery_method === 'community_delivery' ? 'community_delivery' : 'pickup'}
                      onSuccess={() => {
                        toast.success(t('listing.order_created'));
                      }}
                    />
                  </>
                )}
                {isLendListing ? (
                  canMessage ? (
                    // One prominent action: asking to borrow IS messaging the owner.
                    <Button
                      fullWidth
                      size="lg"
                      startContent={<Handshake className="w-4 h-4" aria-hidden="true" />}
                      as={listing.user ? Link : undefined}
                      to={messageSellerHref}
                      isDisabled={!isAuthenticated || !listing.user}
                    >
                      {t('listing.ask_to_borrow')}
                    </Button>
                  ) : (
                    <p className="text-sm text-muted" data-testid="borrow-in-person">
                      {t('listing.borrow_in_person_notice')}
                    </p>
                  )
                ) : (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    {listing.price_type !== 'free' && (
                      <Button
                        fullWidth
                        startContent={<DollarSign className="w-4 h-4" aria-hidden="true" />}
                        onPress={offerModal.onOpen}
                        isDisabled={!isAuthenticated}
                      >
                        {t('listing.make_offer')}
                      </Button>
                    )}
                    {canMessage && (
                      <Button
                        variant="secondary"
                        fullWidth
                        startContent={<MessageCircle className="w-4 h-4" aria-hidden="true" />}
                        as={listing.user ? Link : undefined}
                        to={messageSellerHref}
                        isDisabled={!isAuthenticated || !listing.user}
                      >
                        {t('listing.message_seller')}
                      </Button>
                    )}
                  </div>
                )}
              </div>}

              {!isOwnListing && !isAuthenticated && canMessage && (
                <p className="text-xs text-muted text-center">
                  <Link to={loginTarget().to} className="text-accent hover:underline">
                    {t('listing.sign_in')}
                  </Link>
                  {' '}{t('listing.sign_in_to_contact')}
                </p>
              )}
            </GlassCard>

            {/* Loan terms — borrow & lend listings only */}
            {isLendListing && (
              <GlassCard className="p-5 space-y-2 border border-accent/30" data-testid="loan-terms">
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wide flex items-center gap-2">
                  <Handshake className="w-4 h-4 text-accent" aria-hidden="true" />
                  {t('listing.loan_terms')}
                </h3>
                {listing.loan_terms?.trim() && (
                  <p className="text-sm text-foreground whitespace-pre-wrap">{listing.loan_terms}</p>
                )}
                <p className="text-xs text-muted">{t('listing.lend_notice')}</p>
              </GlassCard>
            )}

            {/* Seller card */}
            {listing.user && (
            <GlassCard className="p-5 space-y-3">
              <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
                {t('listing.seller')}
              </h3>
              <div className="flex items-center gap-3">
                <Avatar
                  src={resolveAvatarUrl(listing.user.avatar_url) || undefined}
                  name={listing.user.name}
                  size="lg"
                />
                <div className="min-w-0 flex-1">
                  <Link
                    to={tenantPath(`/marketplace/seller/${listing.user.id}`)}
                    className="font-semibold text-foreground hover:text-accent transition-colors"
                  >
                    {listing.user.name}
                  </Link>
                  <VerificationBadgeRow userId={listing.user.id} size="sm" />
                  <div className="flex items-center gap-3 text-xs text-muted mt-0.5">
                    {listing.user.member_since && (
                      <span>{t('listing.member_since', { date: new Date(listing.user.member_since).getFullYear() })}</span>
                    )}
                  </div>
                  {listing.seller_type === 'business' && (
                    <Chip size="sm" variant="soft" className="mt-1">
                      {t('listing.seller_type_business')}
                    </Chip>
                  )}
                </div>
              </div>
              <Button
                as={Link}
                to={tenantPath(`/marketplace/seller/${listing.user.id}`)}
                variant="tertiary"
                fullWidth
                size="sm"
                endContent={<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />}
              >
                {t('listing.view_profile')}
              </Button>
            </GlassCard>
            )}

            {/* Delivery */}
            {listing.delivery_method && (
              <GlassCard className="p-5">
                <h3 className="text-sm font-semibold text-muted uppercase tracking-wide mb-2">
                  {t('listing.delivery')}
                </h3>
                <p className="text-sm text-foreground">
                  {t(getDeliveryMethodKey(listing.delivery_method))}
                </p>
              </GlassCard>
            )}
          </div>
        </div>

        {/* Description */}
        <GlassCard className="p-6 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">{t('listing.description')}</h2>
          <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 whitespace-pre-wrap">
            {listing.description}
          </div>

          {/* Template fields */}
          {listing.template_data && Object.keys(listing.template_data).length > 0 && (
            <>
              <Separator />
              <h3 className="text-md font-semibold text-foreground">{t('listing.details')}</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Object.entries(listing.template_data).map(([key, value]) => (
                  <div key={key} className="space-y-0.5">
                    <span className="text-xs text-muted capitalize">
                      {t('listing.detail_field_label', { field: key.replace(/_/g, ' ') })}
                    </span>
                    <p className="text-sm text-foreground">{String(value)}</p>
                  </div>
                ))}
              </div>
            </>
          )}
        </GlassCard>

        {/* More from this seller */}
        {sellerListings.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <User className="w-5 h-5 text-muted" aria-hidden="true" />
                {t('listing.more_from_seller', { name: listing.user?.name ?? '' })}
              </h2>
              <Button
                as={Link}
                to={tenantPath(`/marketplace/seller/${listing.user?.id}`)}
                variant="tertiary"
                size="sm"
                endContent={<ChevronRight className="w-4 h-4" aria-hidden="true" />}
              >
                {t('listing.view_all')}
              </Button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {sellerListings.map((item) => (
                <Link
                  key={item.id}
                  to={tenantPath(`/marketplace/${item.id}`)}
                  className="block group"
                >
                  <GlassCard hoverable className="overflow-hidden">
                    <div className="aspect-square bg-surface-secondary overflow-hidden rounded-t-xl">
                      {item.images?.[0] ? (
                        <img
                          {...responsiveThumbnailProps(item.images[0].thumbnail_url || item.images[0].url, {
                            width: 360,
                            height: 360,
                            widths: [180, 240, 360],
                            sizes: '(max-width: 640px) 50vw, 25vw',
                          })}
                          alt={item.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          loading="lazy"
                          decoding="async"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ShoppingBag className="w-8 h-8 text-muted" aria-hidden="true" />
                        </div>
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="text-sm font-medium line-clamp-1 text-foreground group-hover:text-accent transition-colors">
                        {item.title}
                      </p>
                      <p className="text-sm font-semibold text-accent mt-0.5">
                        {formatPrice(
                          item.price,
                          item.price_type,
                          item.price_currency || tenant?.currency || '',
                          priceLabels,
                        )}
                      </p>
                    </div>
                  </GlassCard>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Report link */}
        <div className="flex justify-center pb-4">
          <Button
            variant="danger-soft"
            size="sm"
            startContent={<Flag className="w-3.5 h-3.5" aria-hidden="true" />}
            onPress={() => {
              if (!isAuthenticated) { toast.error(t('listing.sign_in_to_report')); return; }
              setReportModalOpen(true);
            }}
          >
            {t('listing.report_listing')}
          </Button>
        </div>
      </div>

      {/* Report Listing Modal */}
      <Modal isOpen={reportModalOpen} onOpenChange={(open) => { setReportModalOpen(open); if (!open) setReportReason(''); }} placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('listing.report_modal_title')}</ModalHeader>
              <ModalBody>
                <Textarea
                  label={t('listing.report_reason_label')}
                  placeholder={t('listing.report_reason_placeholder')}
                  value={reportReason}
                  onValueChange={setReportReason}
                  minRows={3}
                  maxRows={6}
                  isRequired
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('offer.cancel')}
                </Button>
                <Button variant="danger"

                  onPress={handleSubmitReport}
                  isDisabled={!reportReason.trim()}
                >
                  {t('listing.report_submit')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Make Offer Modal */}
      <Modal isOpen={offerModal.isOpen} onOpenChange={offerModal.onOpenChange} placement="center">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('offer.modal_title')}</ModalHeader>
              <ModalBody className="space-y-4">
                <div>
                  <p className="text-sm text-muted mb-3">
                    {t('offer.asking_price')}{' '}
                    <span className="font-semibold text-foreground">{priceDisplay}</span>
                  </p>
                  <Input
                    label={t('offer.your_offer')}
                    placeholder={t('offer.amount_placeholder')}
                    type="number"
                    min={0}
                    max={999999}
                    step={0.01}
                    value={offerAmount}
                    onValueChange={setOfferAmount}
                    startContent={
                      <span className="text-muted text-sm">
                        {listingCurrency}
                      </span>
                    }
                    isRequired
                  />
                </div>
                <Textarea
                  label={t('offer.message_label')}
                  placeholder={t('offer.message_placeholder')}
                  value={offerMessage}
                  onValueChange={setOfferMessage}
                  minRows={2}
                  maxRows={4}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('offer.cancel')}
                </Button>
                <Button
                  onPress={handleMakeOffer}
                  isLoading={isSubmittingOffer}
                  isDisabled={!offerAmount || parseFloat(offerAmount) <= 0}
                >
                  {t('offer.send')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}

export default MarketplaceListingPage;
