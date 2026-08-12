// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Listing Detail Page - View single listing
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';

import Clock from 'lucide-react/icons/clock';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import User from 'lucide-react/icons/user';
import Tag from 'lucide-react/icons/tag';
import MessageSquare from 'lucide-react/icons/message-square';
import Heart from 'lucide-react/icons/heart';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import AlertCircle from 'lucide-react/icons/circle-alert';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Bookmark from 'lucide-react/icons/bookmark';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import BarChart3 from 'lucide-react/icons/chart-column';
import Flag from 'lucide-react/icons/flag';
import Monitor from 'lucide-react/icons/monitor';
import HelpCircle from 'lucide-react/icons/circle-help';
import Star from 'lucide-react/icons/star';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { Breadcrumbs } from '@/components/navigation';
import { LoadingScreen, EmptyState, ErrorBoundary } from '@/components/feedback';
import { PageMeta } from '@/components/seo/PageMeta';
import { LocationMapCard } from '@/components/location/LocationMapCard';
import { CommentsSection } from '@/components/social/CommentsSection';
import { LikersModal } from '@/components/social/LikersModal';
import { ShareButton } from '@/components/social/ShareButton';
import { ListingAnalyticsPanel } from '@/components/listings/ListingAnalyticsPanel';
import { FeaturedBadge } from '@/components/listings/FeaturedBadge';
import { VerificationBadgeRow } from '@/components/verification/VerificationBadge';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSocialInteractions } from '@/hooks/useSocialInteractions';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveAssetUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import type { Listing, ListingDetail, ExchangeConfig } from '@/types/api';

interface ListingStructuredDataOptions {
  origin: string;
  pathname: string;
  profileUrl: (path: string) => string;
  communityMemberLabel: string;
}

function maybeNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// api.get() returns { success: false } (it does NOT throw) for connection/timeout/
// server failures too, so a failed listing fetch surfaces with an error code rather
// than as a thrown error. A failure is treated as a genuine missing/forbidden listing
// (no retry — retrying won't help) ONLY for an unambiguous 404/403/410; EVERYTHING
// else (network, timeout, 5xx, parse errors, unknown/custom codes) is treated as
// transient and offered a retry. We err toward offering recovery: wrongly telling a
// user a listing was "removed" after a blip is worse than a redundant retry on a 404.
const NOT_FOUND_ERROR_CODES = new Set(['NOT_FOUND', 'FORBIDDEN', 'HTTP_403', 'HTTP_404', 'HTTP_410']);
function isGenuineNotFound(code: string | undefined | null): boolean {
  return !!code && NOT_FOUND_ERROR_CODES.has(code);
}

function buildListingStructuredData(listing: Listing, options: ListingStructuredDataOptions) {
  const category = listing.category?.name || listing.category_name;
  const authorName = listing.user?.name
    || `${listing.user?.first_name ?? ''} ${listing.user?.last_name ?? ''}`.trim()
    || listing.author_name
    || options.communityMemberLabel;
  const hoursEstimate = listing.estimated_hours ?? listing.hours_estimate;
  const latitude = maybeNumber(listing.latitude);
  const longitude = maybeNumber(listing.longitude);
  const ratingValue = maybeNumber(listing.author_rating ?? listing.user?.average_rating);
  const reviewCount = maybeNumber(listing.author_reviews_count ?? listing.user?.reviews_count);

  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    '@id': `${options.origin}${options.pathname}#listing`,
    mainEntityOfPage: `${options.origin}${options.pathname}`,
    name: listing.title,
    description: listing.description?.substring(0, 300),
    url: `${options.origin}${options.pathname}`,
    serviceType: category || listing.service_type || listing.type,
    category,
    ...(listing.image_url ? { image: resolveAssetUrl(listing.image_url) } : {}),
    ...(listing.created_at ? { datePosted: listing.created_at } : {}),
    ...(listing.updated_at ? { dateModified: listing.updated_at } : {}),
    ...(listing.expires_at ? { validThrough: listing.expires_at } : {}),
    ...(listing.location ? { areaServed: listing.location } : {}),
    ...(latitude !== null && longitude !== null ? {
      serviceArea: {
        '@type': 'Place',
        name: listing.location,
        geo: {
          '@type': 'GeoCoordinates',
          latitude,
          longitude,
        },
      },
    } : {}),
    provider: {
      '@type': 'Person',
      name: authorName,
      ...(listing.user?.id ? { url: `${options.origin}${options.profileUrl(`/profile/${listing.user.id}`)}` } : {}),
      ...(ratingValue !== null && ratingValue > 0 ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue,
          ...(reviewCount !== null && reviewCount > 0 ? { reviewCount } : {}),
        },
      } : {}),
    },
    ...(hoursEstimate ? {
      offers: {
        '@type': 'Offer',
        price: hoursEstimate,
        priceCurrency: 'HOUR',
        availability: listing.status === 'active' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
      },
    } : {}),
    potentialAction: {
      '@type': listing.type === 'request' ? 'AskAction' : 'CommunicateAction',
      target: `${options.origin}${options.pathname}`,
    },
  };
}

export function ListingDetailPage() {
  const { t } = useTranslation('listings');
  usePageTitle(t('title'));
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [listing, setListing] = useState<Listing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes a transient/connection failure (retryable) from a genuinely
  // missing or forbidden listing, so the error screen can offer "Try Again"
  // instead of falsely telling the user the listing was removed.
  const [isConnectionError, setIsConnectionError] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [exchangeConfig, setExchangeConfig] = useState<ExchangeConfig | null>(null);
  const [activeExchange, setActiveExchange] = useState<{ id: number; status: string; role: string; proposed_hours: number } | null>(null);
  const [showComments, setShowComments] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [translatedDesc, setTranslatedDesc] = useState<string | null>(null);
  const [isReported, setIsReported] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [reportReason, setReportReason] = useState<string>('');
  const [reportDetails, setReportDetails] = useState('');
  const { isOpen: isReportOpen, onOpen: onReportOpen, onClose: onReportClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const commentsRegionRef = useRef<HTMLDivElement | null>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);
  // Dedicated abort ref for checkActiveExchange — keeps it isolated from loadListing's controller
  const exchangeAbortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Social fields from API response (set after listing loads)
  const [socialInit, setSocialInit] = useState<{ liked: boolean; likes: number; comments: number }>({ liked: false, likes: 0, comments: 0 });

  // Social interactions hook
  const social = useSocialInteractions({
    targetType: 'listing',
    targetId: Number(id) || 0,
    enabled: isAuthenticated,
    initialLiked: socialInit.liked,
    initialLikesCount: socialInit.likes,
    initialCommentsCount: socialInit.comments,
  });
  const { commentsLoaded, commentsLoading, loadComments } = social;

  // Likers modal
  const { isOpen: isLikersOpen, onOpen: onLikersOpen, onClose: onLikersClose } = useDisclosure();

  const loadExchangeConfig = useCallback(async () => {
    try {
      const response = await api.get<ExchangeConfig>('/v2/exchanges/config');
      if (abortRef.current?.signal.aborted) return;
      if (response.success && response.data) {
        setExchangeConfig(response.data);
      }
    } catch {
      // Exchange workflow may not be enabled
    }
  }, []);

  const checkActiveExchange = useCallback(async () => {
    if (!id || !isAuthenticated) return;
    exchangeAbortRef.current?.abort();
    const controller = new AbortController();
    exchangeAbortRef.current = controller;
    try {
      const response = await api.get<{ id: number; status: string; role: string; proposed_hours: number } | null>(`/v2/exchanges/check?listing_id=${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setActiveExchange(response.data);
      }
    } catch {
      // Not critical
    }
  }, [id, isAuthenticated]);

  const loadListing = useCallback(async () => {
    if (!id) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      setIsConnectionError(false);
      const response = await api.get<ListingDetail>(`/v2/listings/${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setListing(response.data);
        setIsSaved(response.data.is_favorited ?? false);
        setSocialInit({
          liked: response.data.is_liked ?? false,
          likes: response.data.likes_count ?? 0,
          comments: response.data.comments_count ?? 0,
        });
      } else if (isGenuineNotFound(response.code)) {
        setError(tRef.current('not_found_error'));
      } else {
        // Transient/unknown (network/timeout/5xx/…) — offer a retry instead of
        // claiming the listing was removed.
        setIsConnectionError(true);
        setError(tRef.current('load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load listing', err);
      setIsConnectionError(true);
      setError(tRef.current('load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadListing();
    loadExchangeConfig();
    checkActiveExchange();
    return () => { abortRef.current?.abort(); exchangeAbortRef.current?.abort(); };
  }, [loadListing, loadExchangeConfig, checkActiveExchange]);

  // Reset image error state when navigating to a different listing
  useEffect(() => { setImageError(false); }, [id]);

  useEffect(() => {
    if (typeof window === 'undefined' || !/^#comment-\d+$/.test(window.location.hash)) {
      return;
    }

    setShowComments(true);
    if (!commentsLoaded && !commentsLoading) {
      void loadComments();
    }
  }, [id, commentsLoaded, commentsLoading, loadComments]);

  async function handleDelete() {
    if (!listing) return;

    try {
      setIsDeleting(true);
      const response = await api.delete(`/v2/listings/${listing.id}`);
      // api.delete resolves { success: false } on 4xx (403/404/429/…) WITHOUT
      // throwing, so the catch below never runs for a rejected delete. Without
      // this check the user got a success toast and was navigated away while
      // the listing still existed.
      if (!response.success) {
        toastRef.current.error(tRef.current('delete_error_title'), response.error || tRef.current('error_retry'));
        return;
      }
      toastRef.current.success(tRef.current('delete_success_title'));
      navigate(tenantPath('/listings'), { replace: true });
    } catch (err) {
      logError('Failed to delete listing', err);
      toastRef.current.error(tRef.current('delete_error_title'), tRef.current('error_retry'));
    } finally {
      setIsDeleting(false);
    }
  }

  const handleSave = async () => {
    if (!id || isSaving) return;
    const wasAlreadySaved = isSaved;
    setIsSaved(!wasAlreadySaved); // optimistic update
    setIsSaving(true);
    try {
      const response = wasAlreadySaved
        ? await api.delete(`/v2/listings/${id}/save`)
        : await api.post(`/v2/listings/${id}/save`, {});

      if (response.success) {
        if (wasAlreadySaved) {
          toastRef.current.info(tRef.current('unsave_title'));
        } else {
          toastRef.current.success(tRef.current('save_success_title'), tRef.current('save_success_subtitle'));
        }
      } else {
        // api.post/api.delete resolve to { success: false } on a 4xx/5xx WITHOUT
        // throwing (and 4xx never fires the global, 5xx-only error toast), so the
        // catch never runs for them. Without this branch the optimistic heart stuck
        // ON and a false "Saved!" toast fired despite the failed request. Roll the
        // optimistic toggle back and surface the error instead.
        setIsSaved(wasAlreadySaved);
        toastRef.current.error(tRef.current('save_error'), response.error || tRef.current('error_retry'));
      }
    } catch (err) {
      logError('Failed to save listing', err);
      setIsSaved(wasAlreadySaved); // rollback on network/throw failure
      toastRef.current.error(tRef.current('save_error'), tRef.current('error_retry'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleRenew = async () => {
    if (!listing || isRenewing) return;
    setIsRenewing(true);
    try {
      const response = await api.post<{ renewed: boolean; new_expires_at: string }>(`/v2/listings/${listing.id}/renew`, {});
      if (response.success) {
        toastRef.current.success(tRef.current('renew_success'));
        loadListing(); // Reload to get updated data
      } else {
        // 4xx failures resolve with { success: false } instead of throwing —
        // without this branch the spinner stopped silently with no feedback.
        toastRef.current.error(tRef.current('renew_error'), response.error || tRef.current('error_retry'));
      }
    } catch (err) {
      logError('Failed to renew listing', err);
      toastRef.current.error(tRef.current('renew_error'));
    } finally {
      setIsRenewing(false);
    }
  };

  const handleReport = async () => {
    if (!listing || isReporting || !reportReason) return;
    setIsReporting(true);
    try {
      const payload: { reason: string; details?: string } = { reason: reportReason };
      if (reportDetails.trim()) {
        payload.details = reportDetails.trim();
      }
      const response = await api.post(`/v2/listings/${listing.id}/report`, payload);
      if (response.success) {
        setIsReported(true);
        onReportClose();
        setReportReason('');
        setReportDetails('');
        toastRef.current.success(tRef.current('report_success'));
      } else if (response.code === 'ALREADY_REPORTED') {
        setIsReported(true);
        onReportClose();
        toastRef.current.info(tRef.current('report_already'));
      } else {
        toastRef.current.error(tRef.current('report_error'));
      }
    } catch (err) {
      logError('Failed to report listing', err);
      toastRef.current.error(tRef.current('report_error'));
    } finally {
      setIsReporting(false);
    }
  };

  function toggleComments() {
    setShowComments((prev) => {
      const next = !prev;
      if (next && !commentsLoaded && !commentsLoading) {
        void loadComments();
      }
      if (next) {
        window.setTimeout(() => {
          if (typeof commentsRegionRef.current?.scrollIntoView === 'function') {
            commentsRegionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 50);
      }
      return next;
    });
  }

  const isOwner = user && listing && user.id === listing.user_id;

  if (isLoading) {
    return (
      <>
        <PageMeta title={t('loading')} noIndex />
        <LoadingScreen message={t('loading')} />
      </>
    );
  }

  if (error || !listing) {
    const errorTitle = isConnectionError ? t('load_error_title') : t('not_found_title');
    return (
      <>
        <PageMeta title={errorTitle} noIndex />
        <EmptyState
          icon={<AlertCircle className="w-12 h-12" aria-hidden="true" />}
          title={errorTitle}
          description={error || t('not_found_fallback')}
          action={
            <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
              {isConnectionError && (
                <Button
                  className="bg-linear-to-r from-accent to-accent-gradient-end text-white"
                  onPress={() => void loadListing()}
                >
                  {t('try_again')}
                </Button>
              )}
              <Button as={Link} to={tenantPath('/listings')}
                variant={isConnectionError ? 'flat' : undefined}
                className={isConnectionError ? undefined : 'bg-linear-to-r from-accent to-accent-gradient-end text-white'}
              >
                {t('browse')}
              </Button>
            </div>
          }
        />
      </>
    );
  }

  const listingStructuredData = buildListingStructuredData(listing, {
    origin: window.location.origin,
    pathname: window.location.pathname,
    profileUrl: tenantPath,
    communityMemberLabel: t('community_member'),
  });
  const listingLatitude = maybeNumber(listing.latitude);
  const listingLongitude = maybeNumber(listing.longitude);
  const listingMapCenter = listingLatitude !== null && listingLongitude !== null
    ? { lat: listingLatitude, lng: listingLongitude }
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      // Structural hook for the E2E suite. Deliberately on the SUCCESS branch
      // only — the loading and error branches above return early, so the
      // presence of this element means the listing itself rendered, not merely
      // that the route resolved.
      data-listing-detail=""
      className="max-w-6xl mx-auto space-y-5 sm:space-y-6"
    >
      <PageMeta
        title={listing?.title}
        description={listing?.description?.replace(/\s+/g, ' ').trim().slice(0, 160)}
        image={listing?.image_url ? resolveAssetUrl(listing.image_url) : undefined}
        type="article"
        publishedTime={listing.created_at}
        modifiedTime={listing.updated_at}
      />
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify(listingStructuredData).replace(/</g, '\\u003c')}
        </script>
      </Helmet>
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('title'), href: tenantPath('/listings') },
        { label: listing?.title || t('detail_fallback_label') },
      ]} />

      {/* Main Content */}
      <GlassCard className="overflow-hidden p-0">
        {/* Listing Image */}
        <div className="relative overflow-hidden bg-theme-hover">
          {listing.image_url && !imageError ? (
            <img
              {...responsiveThumbnailProps(listing.image_url, {
                width: 1200,
                height: 675,
                fit: 'contain',
                widths: [640, 960, 1200],
                sizes: '(max-width: 768px) 100vw, 72vw',
              })}
              alt={t('detail_image_alt', { title: listing.title })}
              className="h-64 w-full object-cover sm:h-80 lg:h-[24rem]"
              loading="lazy"
              decoding="async"
              width={1200}
              height={672}
              onError={() => setImageError(true)}
            />
          ) : (
            <div className="flex h-64 items-center justify-center sm:h-80 lg:h-[24rem]">
              <ImagePlaceholder size="lg" />
            </div>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-linear-to-t from-black/70 via-black/20 to-transparent p-4 sm:p-6">
            <div className="flex flex-wrap items-center gap-2">
              <Chip
                variant="soft"
                className={listing.type === 'offer' ? 'bg-emerald-500/90 text-white' : 'bg-amber-500/90 text-white'}
              >
                {listing.type === 'offer' ? t('offering') : t('requesting')}
              </Chip>
              {listing.is_featured && <FeaturedBadge size="md" />}
              {(listing.category || listing.category_name) && (
                <Chip
                  variant="soft"
                  startContent={<Tag className="h-3.5 w-3.5" aria-hidden="true" />}
                  className="max-w-full bg-white/90 text-slate-800"
                >
                  <span className="truncate">{listing.category?.name || listing.category_name}</span>
                </Chip>
              )}
            </div>
          </div>
        </div>

        <div className="p-5 sm:p-8">
        {/* Header */}
        <div className="mb-6 flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-sm font-medium text-theme-muted">
              {listing.type === 'offer' ? t('detail_offer_eyebrow') : t('detail_request_eyebrow')}
            </p>
            <h1 className="text-2xl font-bold leading-tight text-theme-primary wrap-break-word sm:text-4xl">
              {listing.title}
            </h1>
          </div>

          {isOwner && (
            <div className="flex flex-wrap gap-2 rounded-2xl border border-theme-default bg-theme-hover/60 p-2">
              <Button as={Link} to={tenantPath(`/listings/edit/${listing.id}`)}
                size="sm"
                variant="secondary"
                className="bg-theme-elevated text-theme-primary"
                startContent={<Edit className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail_edit')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="bg-theme-elevated text-theme-primary"
                startContent={<BarChart3 className="w-4 h-4" aria-hidden="true" />}
                onPress={() => setShowAnalytics(!showAnalytics)}
              >
                {t('detail_analytics')}
              </Button>
              {(listing.status === 'expired' || listing.expires_at) && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-emerald-500/10 text-emerald-500"
                  startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                  onPress={handleRenew}
                  isLoading={isRenewing}
                >
                  {listing.status === 'expired' ? t('detail_renew') : t('detail_extend')}
                </Button>
              )}
              <Button
                size="sm"
                variant="danger-soft"
                className="bg-red-500/10 text-red-400"
                startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                onPress={onDeleteOpen}
                isLoading={isDeleting}
              >
                {t('detail_delete')}
              </Button>
            </div>
          )}
        </div>

        {/* Meta Grid - Top Row */}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-theme-default bg-theme-hover/60 p-3 text-theme-muted">
            <div className="p-2 rounded-lg bg-accent/20" aria-hidden="true">
              <Clock className="w-5 h-5 text-accent dark:text-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-theme-subtle">{t('detail_duration')}</div>
              <div className="truncate text-sm font-medium text-theme-primary sm:text-base">
                {(listing.hours_estimate ?? listing.estimated_hours)
                  ? t('detail_hours', { count: listing.hours_estimate ?? listing.estimated_hours })
                  : t('detail_flexible')}
              </div>
              {/* Total-hours cap, shown only when the member set one. Kept inside
                  the duration tile rather than added as a fifth tile, so the
                  two hour numbers read together and the 4-column grid holds. */}
              {listing.hours_available != null && (
                <div className="truncate text-xs text-theme-subtle">
                  {t('detail_hours_available', { count: listing.hours_available })}
                </div>
              )}
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-theme-default bg-theme-hover/60 p-3 text-theme-muted">
            <div className="p-2 rounded-lg bg-amber-500/20" aria-hidden="true">
              <Calendar className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-theme-subtle">{t('detail_posted')}</div>
              <div className="truncate text-sm font-medium text-theme-primary sm:text-base">
                {new Date(listing.created_at).toLocaleDateString(getFormattingLocale())}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-theme-default bg-theme-hover/60 p-3 text-theme-muted">
            <div className="p-2 rounded-lg bg-accent/20" aria-hidden="true">
              <Tag className="w-5 h-5 text-accent dark:text-accent" />
            </div>
            <div className="min-w-0">
              <div className="text-xs text-theme-subtle">{t('detail_status')}</div>
              <div className="truncate text-sm font-medium text-theme-primary sm:text-base">
                {t(`status_${listing.status}`)}
              </div>
            </div>
          </div>

          {listing.service_type && (
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-theme-default bg-theme-hover/60 p-3 text-theme-muted">
              <div className={`p-2 rounded-lg ${
                listing.service_type === 'remote_only' ? 'bg-blue-500/20' :
                listing.service_type === 'hybrid' ? 'bg-teal-500/20' :
                listing.service_type === 'physical_only' ? 'bg-emerald-500/20' :
                'bg-gray-500/20'
              }`} aria-hidden="true">
                {listing.service_type === 'remote_only' && <Monitor className="w-5 h-5 text-blue-600 dark:text-blue-400" />}
                {listing.service_type === 'hybrid' && <ArrowRightLeft className="w-5 h-5 text-teal-600 dark:text-teal-400" />}
                {listing.service_type === 'physical_only' && <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />}
                {listing.service_type === 'location_dependent' && <HelpCircle className="w-5 h-5 text-gray-600 dark:text-gray-400" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs text-theme-subtle">{t('delivery_mode')}</div>
                <div className="truncate text-sm font-medium text-theme-primary sm:text-base">
                  {listing.service_type === 'physical_only' && t('service_type_physical_only')}
                  {listing.service_type === 'remote_only' && t('service_type_remote_only')}
                  {listing.service_type === 'hybrid' && t('service_type_hybrid')}
                  {listing.service_type === 'location_dependent' && t('service_type_location_dependent')}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Location - Separate Row to prevent text bleeding */}
        {listing.location && (
          <div className="mb-8 flex items-center gap-3 rounded-xl border border-theme-default bg-theme-hover/60 p-3 text-theme-muted">
            <div className="p-2 rounded-lg bg-emerald-500/20" aria-hidden="true">
              <MapPin className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-theme-subtle">{t('detail_location')}</div>
              <div className="wrap-break-word text-sm font-medium text-theme-primary sm:text-base">{listing.location}</div>
            </div>
          </div>
        )}

        {/* Location Map */}
        {listing.location && listingMapCenter && (
          <LocationMapCard
            title={t('detail_service_location')}
            locationText={listing.location}
            markers={[{
              id: listing.id,
              lat: listingMapCenter.lat,
              lng: listingMapCenter.lng,
              title: listing.title,
            }]}
            center={listingMapCenter}
            mapHeight="250px"
            zoom={15}
            className="mt-6"
          />
        )}

        {/* Spacer if no location */}
        {!listing.location && <div className="mb-4" />}

        {/* Description */}
        <div className="mb-8 rounded-2xl border border-theme-default bg-theme-surface/60 p-4 sm:p-5">
          <h2 className="text-lg font-semibold text-theme-primary mb-3">{t('detail_description')}</h2>
          <div className="prose prose-invert max-w-none">
            {(() => {
              const isLongDesc = (listing.description?.length ?? 0) > 500;
              return (
                <>
                  <div className={isLongDesc && !showFullDesc ? 'line-clamp-6 overflow-hidden' : ''}>
                    <SafeHtml content={translatedDesc ?? listing.description} className="text-theme-muted whitespace-pre-wrap wrap-break-word" as="div" />
                  </div>
                  {listing.description && (
                    <TranslateButton
                      contentType="listing"
                      contentId={listing.id}
                      sourceText={listing.description}
                      sourceLocale={(listing as { locale?: string | null }).locale ?? null}
                      onTextChange={(text, isTranslated) => setTranslatedDesc(isTranslated ? text : null)}
                      className="mt-1"
                    />
                  )}
                  {isLongDesc && (
                    <Button
                      variant="tertiary"
                      size="sm"
                      className="mt-2 text-theme-accent px-0"
                      onPress={() => setShowFullDesc((prev) => !prev)}
                    >
                      {showFullDesc ? t('show_less') : t('show_more')}
                    </Button>
                  )}
                </>
              );
            })()}
          </div>
        </div>

        {/* Social Proof */}
        {(social.likesCount > 0 || social.commentsCount > 0) && (
          <div className="flex gap-4 text-sm text-theme-subtle mb-4">
            {social.likesCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onPress={onLikersOpen}
                className="flex min-h-7 items-center gap-1.5 p-0 transition-colors hover:text-theme-primary"
              >
                <span className="w-4 h-4 rounded-full bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center">
                  <Heart className="w-2.5 h-2.5 text-white fill-white" aria-hidden="true" />
                </span>
                {social.likesCount} {social.likesCount === 1 ? t('like') : t('likes')}
              </Button>
            )}
            {social.commentsCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onPress={toggleComments}
                aria-expanded={showComments}
                aria-controls="listing-comments"
                className="min-h-7 p-0 transition-colors hover:text-theme-primary"
              >
                {social.commentsCount} {social.commentsCount === 1 ? t('comment') : t('comments')}
              </Button>
            )}
          </div>
        )}

        {/* Action Buttons */}
        {isAuthenticated && !isOwner && (
          <div className="rounded-2xl border border-theme-default bg-theme-hover/70 p-3 sm:p-4">
            <div className="mb-3">
              <h2 className="text-sm font-semibold text-theme-primary">{t('detail_cta_title')}</h2>
              <p className="text-sm text-theme-muted">{t('detail_cta_body')}</p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {exchangeConfig?.exchange_workflow_enabled ? (
              activeExchange ? (
                <Button as={Link} to={tenantPath(`/exchanges/${activeExchange.id}`)}
                  className="w-full bg-theme-elevated text-theme-primary"
                  startContent={<ArrowRightLeft className="w-4 h-4" aria-hidden="true" />}
                  endContent={
                    <Chip size="sm" variant="soft" color={
                      activeExchange.status === 'accepted' || activeExchange.status === 'in_progress' ? 'success' :
                      activeExchange.status === 'pending_provider' || activeExchange.status === 'pending_broker' ? 'warning' :
                      activeExchange.status === 'pending_confirmation' ? 'primary' :
                      'default'
                    }>
                      {activeExchange.status === 'pending_provider' ? t('exchange_status_pending_provider') :
                       activeExchange.status === 'pending_broker' ? t('exchange_status_pending_broker') :
                       activeExchange.status === 'accepted' ? t('exchange_status_accepted') :
                       activeExchange.status === 'in_progress' ? t('exchange_status_in_progress') :
                       activeExchange.status === 'pending_confirmation' ? t('exchange_status_pending_confirmation') :
                       activeExchange.status === 'disputed' ? t('exchange_status_disputed') :
                       activeExchange.status.replace(/_/g, ' ')}
                    </Chip>
                  }
                >
                  {t('detail_exchange')}
                </Button>
              ) : (
                <Button as={Link} to={tenantPath(`/listings/${listing.id}/request-exchange`)}
                  className="w-full bg-linear-to-r from-emerald-500 to-teal-600 text-white"
                  startContent={<ArrowRightLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('detail_request_exchange')}
                </Button>
              )
            ) : (
              <Button as={Link} to={tenantPath(`/messages?to=${listing.user_id}&listing=${listing.id}`)}
                className="w-full bg-linear-to-r from-accent to-accent-gradient-end text-white"
                startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
              >
                {t('detail_send_message')}
              </Button>
            )}
            <Button
              variant="secondary"
              className={`w-full ${social.isLiked ? 'bg-rose-500/20 text-rose-500' : 'bg-theme-elevated text-theme-primary'}`}
              startContent={<Heart className={`w-4 h-4 ${social.isLiked ? 'fill-current' : ''}`} aria-hidden="true" />}
              onPress={() => void social.toggleLike()}
              isDisabled={social.isLiking}
              aria-label={social.isLiked ? t('detail_unlike_aria', { title: listing.title }) : t('detail_like_aria', { title: listing.title })}
            >
              {social.likesCount > 0 ? `${social.likesCount} ` : ''}{social.isLiked ? t('detail_liked') : t('detail_like')}
            </Button>
            <Button
              variant="secondary"
              className={`w-full ${showComments ? 'bg-accent/20 text-accent' : 'bg-theme-elevated text-theme-primary'}`}
              startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
              onPress={toggleComments}
              aria-expanded={showComments}
              aria-controls="listing-comments"
            >
              {social.commentsCount > 0 ? `${social.commentsCount} ` : ''}{t('detail_comments')}
            </Button>
            <Button
              variant="secondary"
              className={`w-full ${isSaved ? 'bg-accent/20 text-accent' : 'bg-theme-elevated text-theme-primary'}`}
              startContent={isSaved ? <Bookmark className="w-4 h-4 fill-current" aria-hidden="true" /> : <Bookmark className="w-4 h-4" aria-hidden="true" />}
              onPress={() => void handleSave()}
              isDisabled={isSaving}
              aria-label={isSaved ? t('detail_unsave_aria', { title: listing.title }) : t('detail_save_aria', { title: listing.title })}
            >
              {isSaved ? t('detail_saved') : t('detail_save')}
            </Button>
            <ShareButton
              shareToFeed={social.shareToFeed}
              title={listing.title}
              description={listing.description}
              isAuthenticated={isAuthenticated}
              canShareToFeed={!isOwner}
              shareToFeedDisabledReason={t('cannot_share_own_content', { ns: 'social' })}
              className="w-full"
            />
            <Button
              variant="secondary"
              className={`w-full ${isReported ? 'bg-orange-500/20 text-orange-500' : 'bg-theme-elevated text-theme-primary'}`}
              startContent={<Flag className="w-4 h-4" aria-hidden="true" />}
              onPress={onReportOpen}
              isDisabled={isReported}
            >
              {isReported ? t('detail_reported') : t('detail_report')}
            </Button>
            </div>
          </div>
        )}

        {isAuthenticated && isOwner && (
          <div className="grid grid-cols-1 gap-2 rounded-2xl border border-theme-default bg-theme-hover/70 p-3 sm:grid-cols-3 sm:p-4">
            <Button
              variant="secondary"
              className={`w-full ${social.isLiked ? 'bg-rose-500/20 text-rose-500' : 'bg-theme-elevated text-theme-primary'}`}
              startContent={<Heart className={`w-4 h-4 ${social.isLiked ? 'fill-current' : ''}`} aria-hidden="true" />}
              onPress={() => void social.toggleLike()}
              isDisabled={social.isLiking}
              aria-label={social.isLiked ? t('detail_unlike_aria', { title: listing.title }) : t('detail_like_aria', { title: listing.title })}
            >
              {social.likesCount > 0 ? `${social.likesCount} ` : ''}{social.isLiked ? t('detail_liked') : t('detail_like')}
            </Button>
            <Button
              variant="secondary"
              className={`w-full ${showComments ? 'bg-accent/20 text-accent' : 'bg-theme-elevated text-theme-primary'}`}
              startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
              onPress={toggleComments}
              aria-expanded={showComments}
              aria-controls="listing-comments"
            >
              {social.commentsCount > 0 ? `${social.commentsCount} ` : ''}{t('detail_comments')}
            </Button>
            <ShareButton
              shareToFeed={social.shareToFeed}
              title={listing.title}
              description={listing.description}
              isAuthenticated={isAuthenticated}
              canShareToFeed={!isOwner}
              shareToFeedDisabledReason={t('cannot_share_own_content', { ns: 'social' })}
              className="w-full"
            />
          </div>
        )}

        {showComments && (
          <div id="listing-comments" ref={commentsRegionRef} className="mt-5" aria-live="polite">
            <ErrorBoundary fallback={
              <GlassCard className="p-6 text-center text-theme-muted">
                {t('comments_error')}
              </GlassCard>
            }>
              <GlassCard className="p-6">
                <CommentsSection
                  comments={social.comments}
                  commentsCount={social.commentsCount}
                  commentsLoading={social.commentsLoading}
                  commentsLoaded={social.commentsLoaded}
                  loadComments={social.loadComments}
                  submitComment={social.submitComment}
                  editComment={social.editComment}
                  deleteComment={social.deleteComment}
                  toggleReaction={social.toggleReaction}
                  searchMentions={social.searchMentions}
                  isAuthenticated={isAuthenticated}
                  currentUserId={user?.id}
                  currentUserAvatar={user?.avatar ?? undefined}
                  currentUserName={user?.first_name || user?.name}
                />
              </GlassCard>
            </ErrorBoundary>
          </div>
        )}
        </div>
      </GlassCard>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose} size="sm">
        <ModalContent>
          <ModalHeader>{t('delete_confirm_title')}</ModalHeader>
          <ModalBody>
            <p className="text-theme-secondary">{t('delete_confirm_body')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onDeleteClose}>{t('cancel')}</Button>
            <Button variant="danger" onPress={() => { onDeleteClose(); void handleDelete(); }} isLoading={isDeleting}>
              {t('delete_confirm_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Report Listing Modal */}
      <Modal isOpen={isReportOpen} onClose={onReportClose} size="md">
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('report_title')}</ModalHeader>
          <ModalBody>
            <RadioGroup
              label={t('report_reason_label')}
              value={reportReason}
              onValueChange={setReportReason}
              classNames={{ label: 'text-theme-secondary' }}
            >
              <Radio value="inappropriate" autoFocus>{t('report_reason_inappropriate')}</Radio>
              <Radio value="safety_concern">{t('report_reason_safety')}</Radio>
              <Radio value="misleading">{t('report_reason_misleading')}</Radio>
              <Radio value="spam">{t('report_reason_spam')}</Radio>
              <Radio value="not_timebank_service">{t('report_reason_not_timebank')}</Radio>
              <Radio value="other">{t('report_reason_other')}</Radio>
            </RadioGroup>
            <Textarea
              label={t('report_details_label')}
              placeholder={t('report_details_placeholder')}
              value={reportDetails}
              onValueChange={setReportDetails}
              maxLength={500}
              variant="secondary"
              description={`${reportDetails.length}/500`}
              classNames={{ label: 'text-theme-secondary' }}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onReportClose}>
              {t('cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={() => void handleReport()}
              isDisabled={!reportReason || isReporting}
              isLoading={isReporting}
            >
              {t('report_submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* User Card */}
      {(listing.user || listing.author_name) && (() => {
        const userName = listing.user?.name || listing.author_name || `${listing.user?.first_name ?? ''} ${listing.user?.last_name ?? ''}`.trim();
        const userId = listing.user?.id || listing.user_id;
        const userAvatar = resolveAvatarUrl(listing.user?.avatar || listing.author_avatar);

        return (
          <GlassCard className="p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
              <User className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
              {listing.type === 'offer' ? t('detail_offered_by') : t('detail_requested_by')}
            </h2>

            {userId ? (
              <Link
                to={tenantPath(`/profile/${userId}`)}
                className="group flex items-start gap-4 rounded-2xl border border-theme-default bg-theme-hover/50 p-3 transition-colors hover:bg-theme-hover"
                aria-label={t('detail_view_profile_aria', { name: userName })}
              >
                <Avatar
                  src={userAvatar}
                  name={userName}
                  size="lg"
                  className="ring-2 ring-white/20 group-hover:ring-accent/50 transition-all"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-theme-primary transition-colors group-hover:text-accent">
                      {userName}
                    </h3>
                    {listing.user?.id && <VerificationBadgeRow userId={listing.user.id} size="sm" />}
                  </div>
                  {listing.user?.tagline && (
                    <p className="text-theme-muted text-sm truncate">{listing.user.tagline}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {listing.author_rating != null && listing.author_rating > 0 && (
                      <span className="flex items-center gap-1 text-xs text-theme-muted">
                        <Star className="w-3.5 h-3.5 fill-amber-500 text-[var(--color-warning)]" aria-hidden="true" />
                        <span className="font-medium text-theme-primary">{listing.author_rating.toFixed(1)}</span>
                        {listing.author_reviews_count != null && listing.author_reviews_count > 0 && (
                          <span>({listing.author_reviews_count} {listing.author_reviews_count === 1 ? t('review') : t('reviews')})</span>
                        )}
                      </span>
                    )}
                    {listing.author_exchanges_count != null && listing.author_exchanges_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-theme-muted">
                        <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                        {listing.author_exchanges_count} {listing.author_exchanges_count === 1 ? t('exchange') : t('exchanges_completed')}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-theme-subtle mt-1">{t('detail_view_profile')}</p>
                </div>
              </Link>
            ) : (
              <span className="flex items-start gap-4 rounded-2xl border border-theme-default bg-theme-hover/50 p-3">
                <Avatar
                  src={userAvatar}
                  name={userName}
                  size="lg"
                  className="ring-2 ring-white/20"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-semibold text-theme-primary">{userName}</h3>
                  </div>
                  {listing.user?.tagline && (
                    <p className="text-theme-muted text-sm truncate">{listing.user.tagline}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {listing.author_rating != null && listing.author_rating > 0 && (
                      <span className="flex items-center gap-1 text-xs text-theme-muted">
                        <Star className="w-3.5 h-3.5 fill-amber-500 text-[var(--color-warning)]" aria-hidden="true" />
                        <span className="font-medium text-theme-primary">{listing.author_rating.toFixed(1)}</span>
                        {listing.author_reviews_count != null && listing.author_reviews_count > 0 && (
                          <span>({listing.author_reviews_count} {listing.author_reviews_count === 1 ? t('review') : t('reviews')})</span>
                        )}
                      </span>
                    )}
                    {listing.author_exchanges_count != null && listing.author_exchanges_count > 0 && (
                      <span className="flex items-center gap-1 text-xs text-theme-muted">
                        <ArrowRightLeft className="w-3.5 h-3.5" aria-hidden="true" />
                        {listing.author_exchanges_count} {listing.author_exchanges_count === 1 ? t('exchange') : t('exchanges_completed')}
                      </span>
                    )}
                  </div>
                </div>
              </span>
            )}
          </GlassCard>
        );
      })()}

      {/* Skill Tags */}
      {listing.skill_tags && listing.skill_tags.length > 0 && (
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-4 h-4 text-theme-muted" aria-hidden="true" />
            <span className="text-sm font-medium text-theme-muted">{t('detail_skills')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {listing.skill_tags.map((tag) => (
              <Chip
                key={tag}
                size="sm"
                variant="secondary"
                className="max-w-full bg-accent/10 text-accent"
              >
                <span className="truncate">{tag}</span>
              </Chip>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Member's Other Listings (Reciprocity) */}
      {((listing.member_offers?.length ?? 0) > 0 || (listing.member_requests?.length ?? 0) > 0) && (
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-emerald-500" aria-hidden="true" />
            {t('detail_more_from', { name: listing.author_name || t('detail_this_member') })}
          </h2>
          {(listing.member_offers?.length ?? 0) > 0 && (
            <div className="mb-3">
              <h3 className="text-sm font-medium text-emerald-500 mb-2">{t('detail_also_offers')}</h3>
              <div className="flex flex-wrap gap-2">
                {listing.member_offers!.map((l) => (
                  <Link key={l.id} to={tenantPath(`/listings/${l.id}`)}>
                    <Chip variant="soft" className="max-w-full cursor-pointer bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-400">
                      <span className="truncate">{l.title}</span>
                    </Chip>
                  </Link>
                ))}
              </div>
            </div>
          )}
          {(listing.member_requests?.length ?? 0) > 0 && (
            <div>
              <h3 className="text-sm font-medium text-[var(--color-warning)] mb-2">{t('detail_looking_for')}</h3>
              <div className="flex flex-wrap gap-2">
                {listing.member_requests!.map((l) => (
                  <Link key={l.id} to={tenantPath(`/listings/${l.id}`)}>
                    <Chip variant="soft" className="max-w-full cursor-pointer bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400">
                      <span className="truncate">{l.title}</span>
                    </Chip>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {/* Listing Analytics (owner only) */}
      {isOwner && showAnalytics && (
        <ListingAnalyticsPanel listingId={listing.id} />
      )}

      {/* Expiry / Renewal Info */}
      {listing.expires_at && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 text-sm">
            <Calendar className="w-4 h-4 text-theme-muted" aria-hidden="true" />
            <span className="text-theme-muted">
              {listing.status === 'expired'
                ? t('detail_expired_on', { date: new Date(listing.expires_at).toLocaleDateString(getFormattingLocale()) })
                : t('detail_expires_on', { date: new Date(listing.expires_at).toLocaleDateString(getFormattingLocale()) })}
            </span>
            {listing.renewal_count !== undefined && listing.renewal_count > 0 && (
              <span className="text-xs text-theme-subtle">
                ({t('detail_renewed_count', { count: listing.renewal_count })})
              </span>
            )}
          </div>
        </GlassCard>
      )}

      {/* Likers Modal */}
      <LikersModal
        isOpen={isLikersOpen}
        onClose={onLikersClose}
        loadLikers={social.loadLikers}
        likesCount={social.likesCount}
      />
    </motion.div>
  );
}

export default ListingDetailPage;
