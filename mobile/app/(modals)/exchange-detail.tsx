// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBottomInset } from '@/lib/ui/rootInsets';
import { useLocalSearchParams, router, type Href } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';

import {
  checkActiveExchange,
  createExchangeRequest,
  deleteExchange,
  getExchange,
  getExchangeWorkflowConfig,
  reportExchange,
  renewExchange,
  saveExchange,
  toggleExchangeLike,
  unsaveExchange,
  type ActiveExchange,
  type RelatedExchange,
  type Exchange,
} from '@/lib/api/exchanges';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { useAuth } from '@/lib/hooks/useAuth';
import { buildWebUrl } from '@/lib/utils/webUrl';
import { contrastText } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import VerificationBadgeRow from '@/components/verification/VerificationBadgeRow';
import CommentSheet from '@/components/comments/CommentSheet';
import NativePressable from '@/components/ui/NativePressable';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';

interface DetailStateProps {
  title: string;
  backLabel: string;
  message: string;
  onAction: () => void;
}

const reportReasons = ['safety_concern', 'inappropriate', 'misleading', 'spam', 'not_timebank_service', 'other'] as const;

function DetailState({ title, backLabel, message, onAction }: DetailStateProps) {
  const theme = useTheme();

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={backLabel} fallbackHref="/(tabs)/exchanges" />
      <Surface variant="secondary" className="mx-4 my-8 items-center gap-4 rounded-panel p-6">
        <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
        <Text className="text-center text-sm text-muted-foreground">{message}</Text>
        <HeroButton variant="secondary" onPress={onAction}>
          <HeroButton.Label>{backLabel}</HeroButton.Label>
        </HeroButton>
      </Surface>
    </SafeAreaView>
  );
}

export default function ExchangeDetailModal() {
  return (
    <ModalErrorBoundary>
      <ExchangeDetailModalInner />
    </ModalErrorBoundary>
  );
}

function ExchangeDetailModalInner() {
  const { t } = useTranslation(['exchanges', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const primary = usePrimaryColor();
  const onPrimary = contrastText(primary);
  const theme = useTheme();
  const bottomInset = useBottomInset();
  const { tenant } = useTenant();
  const { user: currentUser } = useAuth();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRenewing, setIsRenewing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [workflowEnabled, setWorkflowEnabled] = useState(false);
  const [activeExchange, setActiveExchange] = useState<ActiveExchange | null>(null);
  const [showRequestForm, setShowRequestForm] = useState(false);
  const [requestMessage, setRequestMessage] = useState('');
  const [requestHours, setRequestHours] = useState('');
  const [isLiked, setIsLiked] = useState(false);
  const [likesCount, setLikesCount] = useState(0);
  const [commentsCount, setCommentsCount] = useState(0);
  const [isLiking, setIsLiking] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showReportForm, setShowReportForm] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [isReported, setIsReported] = useState(false);
  const [reportReason, setReportReason] = useState('safety_concern');
  const [reportDetails, setReportDetails] = useState('');
  const [activeImageIndex, setActiveImageIndex] = useState(0);

  const exchangeId = Number(id);
  const safeExchangeId = isNaN(exchangeId) || exchangeId <= 0 ? 0 : exchangeId;

  const { data, isLoading, error, refresh } = useApi(
    () => getExchange(safeExchangeId),
    [safeExchangeId],
    { enabled: safeExchangeId > 0 },
  );

  // Support both { data: Exchange } wrapper and bare Exchange responses.
  const exchange: Exchange | undefined = (data as { data?: Exchange })?.data ?? (data as Exchange | null) ?? undefined;

  useEffect(() => {
    if (safeExchangeId <= 0) return;
    let cancelled = false;

    void getExchangeWorkflowConfig()
      .then((response) => {
        if (cancelled) return;
        const config = 'data' in response ? response.data : response;
        setWorkflowEnabled(Boolean(config?.exchange_workflow_enabled));
      })
      .catch(() => {
        if (!cancelled) setWorkflowEnabled(false);
      });

    void checkActiveExchange(safeExchangeId)
      .then((response) => {
        if (cancelled) return;
        const exchange = response && 'data' in response ? response.data : response;
        setActiveExchange(exchange ?? null);
      })
      .catch(() => {
        if (!cancelled) setActiveExchange(null);
      });

    return () => {
      cancelled = true;
    };
  }, [safeExchangeId]);

  useEffect(() => {
    if (exchange) {
      setIsSaved(Boolean(exchange.is_favorited));
      setIsLiked(Boolean(exchange.is_liked));
      setLikesCount(exchange.likes_count ?? 0);
      setCommentsCount(exchange.comments_count ?? 0);
      setIsReported(Boolean(exchange.is_reported));
      setShowComments(false);
      setActiveImageIndex(0);
    }
  }, [exchange]);

  const handleAction = useCallback(
    (recipientId: number, recipientName: string) => {
      if (isSubmitting) return;
      setIsSubmitting(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      router.push({
        pathname: '/(modals)/thread',
        params: { recipientId: String(recipientId), name: recipientName, listing: String(safeExchangeId) },
      });
      // Reset after navigation begins so the button is re-enabled if user returns
      setTimeout(() => setIsSubmitting(false), 600);
    },
    [isSubmitting, safeExchangeId],
  );

  if (isNaN(exchangeId) || exchangeId <= 0) {
    return (
      <DetailState
        title={t('detailTitle')}
        backLabel={t('detail.goBack')}
        message={t('detail.invalidId')}
        onAction={() => router.back()}
      />
    );
  }

  if (isLoading && !exchange) return <LoadingSpinner />;

  if (error || !exchange) {
    return (
      <DetailState
        title={t('detailTitle')}
        backLabel={t('detail.goBack')}
        message={error ?? t('detail.notFound')}
        onAction={() => router.back()}
      />
    );
  }

  // Guard against missing user object — API may return exchange without nested user
  const listing = exchange;
  const exchangeUser = listing.user ?? { id: 0, name: '?', avatar_url: null };
  const exchangeUserName = listing.author_name
    || exchangeUser.name
    || `${exchangeUser.first_name ?? ''} ${exchangeUser.last_name ?? ''}`.trim()
    || t('detail.communityMember');
  const exchangeUserAvatar = exchangeUser.avatar_url ?? exchangeUser.avatar ?? listing.author_avatar ?? null;
  const isOwner = currentUser?.id === (listing.user_id ?? exchangeUser.id);
  const listingImages = [
    ...(listing.images ?? [])
      .map((image) => ({
        id: image.id,
        url: resolveImageUrl(image.url),
        altText: image.alt_text ?? null,
      }))
      .filter((image): image is { id: number; url: string; altText: string | null } => typeof image.url === 'string' && image.url.length > 0),
    ...(listing.image_url ? [{ id: 0, url: resolveImageUrl(listing.image_url), altText: null }] : []),
  ]
    .filter((image): image is { id: number; url: string; altText: string | null } => typeof image.url === 'string' && image.url.length > 0)
    .filter((image, index, images) => images.findIndex((candidate) => candidate.url === image.url) === index);
  const activeImage = listingImages[Math.min(activeImageIndex, Math.max(listingImages.length - 1, 0))] ?? null;
  const accent = listing.type === 'offer' ? theme.success : theme.warning;
  const categoryLabel = listing.category_name ?? t('category');
  const locationLabel = listing.location ?? t('detail.onlineOrFlexible');
  const serviceTypeLabel = listing.service_type ? t(`serviceType.${listing.service_type}`) : null;
  const tags = Array.isArray(listing.skill_tags) ? listing.skill_tags.filter(Boolean) : [];
  const requestHoursValue = Number(requestHours || listing.hours_estimate || listing.estimated_hours || 1);
  const authorRating = listing.author_rating ?? exchangeUser.average_rating ?? null;
  const authorReviews = listing.author_reviews_count ?? exchangeUser.reviews_count ?? 0;
  const authorExchanges = listing.author_exchanges_count ?? 0;
  const memberOffers = uniqueRelatedListings(listing.member_offers ?? [], listing.id, listing.title);
  const memberRequests = uniqueRelatedListings(listing.member_requests ?? [], listing.id, listing.title);
  const viewCount = listing.views_count ?? listing.view_count ?? 0;
  const saveCount = listing.save_count ?? 0;
  const responseCount = listing.responses_count ?? 0;
  const contactCount = listing.contact_count ?? 0;
  const showMemberActions = !isOwner && exchangeUser.id > 0;
  // useBottomInset, not insets.bottom: the raw hook reports 0 inside Android modal
  // screens, which put this footer under the 3-button nav bar.
  const footerBottomPadding = Math.max(16, bottomInset + 12);
  const footerReservedSpace = showMemberActions ? footerBottomPadding + 112 : 32;
  const primaryActionLabel = workflowEnabled
    ? activeExchange ? t('detail.exchangeActive') : t('detail.requestExchange')
    : exchange.type === 'offer' ? t('detail.requestService') : t('detail.offerHelp');
  const primaryActionIcon = workflowEnabled ? 'repeat-outline' : 'swap-horizontal-outline';

  async function handleShare() {
    try {
      await Share.share({
        title: exchange!.title,
        // Slug-prefixed so the link resolves to this community on the shared host.
        message: `${exchange!.title}\n${buildWebUrl(tenant?.slug, `/listings/${exchange!.id}`)}`,
        url: buildWebUrl(tenant?.slug, `/listings/${exchange!.id}`),
      });
    } catch {
      // User cancelled or share failed — silently ignore
    }
  }

  async function handleSaveToggle() {
    if (isSaving) return;
    setIsSaving(true);
    const nextSaved = !isSaved;
    setIsSaved(nextSaved);
    try {
      if (nextSaved) {
        await saveExchange(listing.id);
      } else {
        await unsaveExchange(listing.id);
      }
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      setIsSaved(!nextSaved);
      showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.saveFailed')), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleLikeToggle() {
    if (isLiking) return;
    setIsLiking(true);
    const wasLiked = isLiked;
    const previousCount = likesCount;
    setIsLiked(!wasLiked);
    setLikesCount((current) => wasLiked ? Math.max(0, current - 1) : current + 1);
    try {
      const response = await toggleExchangeLike(listing.id);
      const payload = (response.data ?? response) as { liked?: boolean; status?: string; action?: string; likes_count?: number };
      const nextLiked = payload.liked ?? (payload.status === 'liked' || payload.action === 'liked' || !wasLiked);
      setIsLiked(Boolean(nextLiked));
      setLikesCount(payload.likes_count ?? previousCount + (nextLiked ? 1 : -1));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (err) {
      setIsLiked(wasLiked);
      setLikesCount(previousCount);
      showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.likeFailed')), variant: 'danger' });
    } finally {
      setIsLiking(false);
    }
  }

  function handleToggleComments() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowComments(true);
  }

  async function handleReportSubmit() {
    if (isReporting || isReported || !reportReason.trim()) return;
    setIsReporting(true);
    try {
      const response = await reportExchange(listing.id, {
        reason: reportReason.trim(),
        details: reportDetails.trim() || undefined,
      });
      if (response.code === 'ALREADY_REPORTED') {
        showToast({ title: t('detail.reportAlreadyTitle'), description: t('detail.reportAlreadyMessage'), variant: 'default' });
      } else {
        showToast({ title: t('detail.reportSentTitle'), description: t('detail.reportSentMessage'), variant: 'success' });
      }
      setIsReported(true);
      setShowReportForm(false);
      setReportDetails('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.reportFailed')), variant: 'danger' });
    } finally {
      setIsReporting(false);
    }
  }

  async function handleRenew() {
    if (isRenewing) return;
    setIsRenewing(true);
    try {
      await renewExchange(listing.id);
      refresh();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('detail.renewedTitle'), description: t('detail.renewedMessage'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.renewFailed')), variant: 'danger' });
    } finally {
      setIsRenewing(false);
    }
  }

  function handleDelete() {
    confirm({
      title: t('detail.deleteTitle'),
      message: t('detail.deleteMessage'),
      confirmLabel: t('detail.deleteConfirm'),
      cancelLabel: t('detail.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        setIsDeleting(true);
        try {
          await deleteExchange(listing.id);
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          router.replace('/(tabs)/exchanges' as Href);
        } catch (err) {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.deleteFailed')), variant: 'danger' });
        } finally {
          setIsDeleting(false);
        }
      },
    });
  }

  async function handleRequestExchange() {
    if (isSubmitting || activeExchange) {
      if (activeExchange) {
        showToast({ title: t('detail.exchangeActiveTitle'), description: t('detail.exchangeActiveMessage'), variant: 'warning' });
      }
      return;
    }
    setIsSubmitting(true);
    try {
      const response = await createExchangeRequest({
        listing_id: listing.id,
        proposed_hours: Number.isFinite(requestHoursValue) && requestHoursValue > 0 ? requestHoursValue : null,
        message: requestMessage.trim() || null,
      });
      setActiveExchange(response.data);
      setShowRequestForm(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('detail.exchangeRequestedTitle'), description: t('detail.exchangeRequestedMessage'), variant: 'success' });
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('detail.actionFailedTitle'), description: describeApiError(err, t('detail.exchangeRequestFailed')), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView
      testID="exchange-detail-screen"
      className="flex-1 bg-background"
      style={{ flex: 1, backgroundColor: theme.bg }}
    >
      <AppTopBar
        title={t('detailTitle')}
        backLabel={t('detail.goBack')}
        fallbackHref="/(tabs)/exchanges"
        rightAction={{ accessibilityLabel: t('share'), icon: 'share-outline', onPress: handleShare }}
      />
      <ScrollView
        testID="exchange-detail-scroll"
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: footerReservedSpace, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && Boolean(exchange)}
            onRefresh={refresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
      >
        <HeroCard variant="default" className="overflow-hidden">
          <View className="h-1 w-full" style={{ backgroundColor: accent }} />
          {activeImage ? (
            <View className="gap-2">
              <Image source={{ uri: activeImage.url }} style={{ width: '100%', height: 180 }} contentFit="cover" accessibilityLabel={activeImage.altText ?? listing.title} />
              {listingImages.length > 1 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 12, paddingBottom: 10 }}>
                  {listingImages.map((image, index) => {
                    const isActive = image.url === activeImage.url;
                    return (
                      <HeroButton
                        key={`${image.id}-${image.url}`}
                        isIconOnly
                        variant="ghost"
                        accessibilityRole="button"
                        accessibilityLabel={t('detail.imageThumbnail', { number: index + 1 })}
                        onPress={() => setActiveImageIndex(index)}
                        className={`h-[62px] w-[62px] overflow-hidden rounded-2xl border p-0 ${isActive ? 'border-primary' : 'border-border'}`}
                        accessibilityState={{ selected: isActive }}
                      >
                        <Image source={{ uri: image.url }} style={{ width: 58, height: 58 }} contentFit="cover" />
                      </HeroButton>
                    );
                  })}
                </ScrollView>
              ) : null}
            </View>
          ) : null}
          <HeroCard.Body className="gap-4 px-4 py-4">
            <View className="flex-row flex-wrap gap-2">
              <Chip color={exchange.type === 'offer' ? 'success' : 'warning'} size="sm" variant="soft">
                <Ionicons name={exchange.type === 'offer' ? 'gift-outline' : 'help-circle-outline'} size={12} color={accent} />
                <Chip.Label>{exchange.type === 'offer' ? t('offering') : t('requesting')}</Chip.Label>
              </Chip>
              <Chip color="default" size="sm" variant="soft">
                <Ionicons name="pricetag-outline" size={12} color={theme.textMuted} />
                <Chip.Label>{categoryLabel}</Chip.Label>
              </Chip>
            </View>
            <HeroCard.Title className="text-2xl leading-8">{exchange.title ?? ''}</HeroCard.Title>
            {exchange.description ? (
              <HeroCard.Description className="text-sm leading-6">
                {stripHtml(exchange.description)}
              </HeroCard.Description>
            ) : null}
          </HeroCard.Body>
        </HeroCard>

        <View className="flex-row gap-3">
          <DetailMetric
            icon="time-outline"
            label={t('detail.timeEstimate')}
            value={(exchange.hours_estimate ?? 0) > 0 ? t('detail.hours', { count: exchange.hours_estimate ?? 0 }) : t('detail.flexible')}
            primary={primary}
          />
          <DetailMetric
            icon="location-outline"
            label={t('detail.location')}
            value={locationLabel}
            primary={primary}
          />
        </View>

        {(serviceTypeLabel || tags.length > 0 || exchange.likes_count || exchange.comments_count) ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="construct-outline" title={t('detail.practicalDetails')} primary={primary} theme={theme} />
              <View className="flex-row flex-wrap gap-2">
                {serviceTypeLabel ? (
                  <Chip color="default" size="sm" variant="soft">
                    <Ionicons name="swap-horizontal-outline" size={12} color={primary} />
                    <Chip.Label>{serviceTypeLabel}</Chip.Label>
                  </Chip>
                ) : null}
                {tags.map((tag) => (
                  <Chip key={tag} color="default" size="sm" variant="soft">
                    <Chip.Label>{tag}</Chip.Label>
                  </Chip>
                ))}
                {typeof exchange.likes_count === 'number' ? (
                  <Chip color="default" size="sm" variant="soft">
                    <Ionicons name="heart-outline" size={12} color={theme.textMuted} />
                    <Chip.Label>{t('detail.likes', { count: exchange.likes_count })}</Chip.Label>
                  </Chip>
                ) : null}
                {typeof exchange.comments_count === 'number' ? (
                  <Chip color="default" size="sm" variant="soft">
                    <Ionicons name="chatbubble-outline" size={12} color={theme.textMuted} />
                    <Chip.Label>{t('detail.comments', { count: exchange.comments_count })}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        <NativePressable
          accessibilityLabel={exchangeUserName}
          onPress={() => {
            if (exchangeUser.id > 0) {
              router.push({ pathname: '/(modals)/member-profile', params: { id: String(exchangeUser.id) } });
            }
          }}
          feedback="highlight"
        >
          <Surface
            variant="secondary"
            className="w-full rounded-panel-inner p-4"
          >
              <View className="flex-row items-start gap-3">
                <Avatar uri={exchangeUserAvatar} name={exchangeUserName} size={52} />
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-xs text-muted-foreground">{t('detail.postedBy')}</Text>
                  <Text className="text-base font-semibold text-foreground" numberOfLines={1}>{exchangeUserName}</Text>
                  {exchangeUser.tagline ? (
                    <Text className="text-xs text-muted-foreground" numberOfLines={2}>{exchangeUser.tagline}</Text>
                  ) : null}
                </View>
                <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
              </View>
              {exchangeUser.id ? (
                <View className="mt-3">
                  <VerificationBadgeRow userId={exchangeUser.id} showUnverified />
                </View>
              ) : null}
              {(authorRating || authorExchanges) ? (
                <View className="mt-3 flex-row flex-wrap gap-2">
                  {authorRating ? (
                    <Chip color="default" size="sm" variant="soft">
                      <Ionicons name="star" size={12} color={theme.warning} />
                      <Chip.Label>{t('detail.rating', { rating: authorRating.toFixed(1), count: authorReviews })}</Chip.Label>
                    </Chip>
                  ) : null}
                  {authorExchanges ? (
                    <Chip color="default" size="sm" variant="soft">
                      <Ionicons name="repeat-outline" size={12} color={theme.textMuted} />
                      <Chip.Label>{t('detail.completedExchanges', { count: authorExchanges })}</Chip.Label>
                    </Chip>
                  ) : null}
                </View>
              ) : null}
          </Surface>
        </NativePressable>

        {exchange.created_at ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-2 px-4 py-4">
              <SectionTitle icon="information-circle-outline" title={t('detail.aboutListing')} primary={primary} theme={theme} />
              <InfoRow icon="calendar-outline" label={t('detail.postedOn', { date: formatDate(exchange.created_at) })} theme={theme} />
              <InfoRow icon={isSaved ? 'bookmark' : 'bookmark-outline'} label={isSaved ? t('detail.saved') : t('detail.notSaved')} theme={theme} />
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {listing.expires_at ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-2 px-4 py-4">
              <SectionTitle icon="hourglass-outline" title={t('detail.availabilityWindow')} primary={primary} theme={theme} />
              <InfoRow
                icon={listing.status === 'expired' ? 'alert-circle-outline' : 'calendar-outline'}
                label={listing.status === 'expired'
                  ? t('detail.expiredOn', { date: formatDate(listing.expires_at) })
                  : t('detail.expiresOn', { date: formatDate(listing.expires_at) })}
                theme={theme}
              />
              {(listing.renewal_count ?? 0) > 0 ? (
                <InfoRow icon="refresh-outline" label={t('detail.renewedCount', { count: listing.renewal_count })} theme={theme} />
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {isOwner && (viewCount > 0 || saveCount > 0 || responseCount > 0 || contactCount > 0) ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="analytics-outline" title={t('detail.ownerAnalytics')} primary={primary} theme={theme} />
              <View className="flex-row flex-wrap gap-3">
                <MiniStat icon="eye-outline" label={t('detail.views')} value={viewCount} primary={primary} theme={theme} />
                <MiniStat icon="bookmark-outline" label={t('detail.saves')} value={saveCount} primary={primary} theme={theme} />
                <MiniStat icon="chatbubble-ellipses-outline" label={t('detail.contacts')} value={contactCount} primary={primary} theme={theme} />
                <MiniStat icon="repeat-outline" label={t('detail.responses')} value={responseCount} primary={primary} theme={theme} />
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {(memberOffers.length > 0 || memberRequests.length > 0) ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="git-compare-outline" title={t('detail.moreFromMember', { name: exchangeUserName })} primary={primary} theme={theme} />
              {memberOffers.length > 0 ? (
                <RelatedListingGroup title={t('detail.alsoOffers')} listings={memberOffers} primary={theme.success} theme={theme} />
              ) : null}
              {memberRequests.length > 0 ? (
                <RelatedListingGroup title={t('detail.lookingFor')} listings={memberRequests} primary={theme.warning} theme={theme} />
              ) : null}
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        <HeroCard variant="secondary">
          <HeroCard.Body className="gap-3 px-4 py-4">
            <SectionTitle icon="sparkles-outline" title={t('detail.communityActions')} primary={primary} theme={theme} />
            <View className="flex-row flex-wrap gap-2">
              <HeroButton variant={isLiked ? 'secondary' : 'ghost'} isDisabled={isLiking} onPress={() => void handleLikeToggle()}>
                {isLiking ? <Spinner size="sm" /> : <Ionicons name={isLiked ? 'heart' : 'heart-outline'} size={18} color={isLiked ? theme.error : theme.textMuted} />}
                <HeroButton.Label>{likesCount > 0 ? t('detail.likes', { count: likesCount }) : t(isLiked ? 'detail.liked' : 'detail.like')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant={showComments ? 'secondary' : 'ghost'} onPress={handleToggleComments}>
                <Ionicons name="chatbubble-outline" size={18} color={showComments ? primary : theme.textMuted} />
                <HeroButton.Label>{commentsCount > 0 ? t('detail.comments', { count: commentsCount }) : t('detail.comment')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="ghost" onPress={() => void handleShare()}>
                <Ionicons name="share-outline" size={18} color={theme.textMuted} />
                <HeroButton.Label>{t('detail.share')}</HeroButton.Label>
              </HeroButton>
              {!isOwner ? (
                <HeroButton
                  variant={isReported ? 'secondary' : 'ghost'}
                  isDisabled={isReported}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowReportForm(true);
                  }}
                >
                  <Ionicons name="flag-outline" size={18} color={isReported ? theme.warning : theme.textMuted} />
                  <HeroButton.Label>{isReported ? t('detail.reported') : t('detail.report')}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </View>
          </HeroCard.Body>
        </HeroCard>

        {isOwner ? (
          <HeroCard variant="secondary">
            <HeroCard.Body className="gap-3 px-4 py-4">
              <SectionTitle icon="settings-outline" title={t('detail.ownerTools')} primary={primary} theme={theme} />
              <View className="flex-row flex-wrap gap-3">
                <HeroButton
                  className="flex-1"
                  variant="secondary"
                  onPress={() => router.push(`/(modals)/edit-exchange?id=${listing.id}` as Href)}
                >
                  <Ionicons name="create-outline" size={18} color={primary} />
                  <HeroButton.Label>{t('detail.edit')}</HeroButton.Label>
                </HeroButton>
                <HeroButton
                  className="flex-1"
                  variant="secondary"
                  isDisabled={isRenewing}
                  onPress={() => void handleRenew()}
                >
                  {isRenewing ? <Spinner size="sm" /> : <Ionicons name="refresh-outline" size={18} color={primary} />}
                  <HeroButton.Label>{t('detail.renew')}</HeroButton.Label>
                </HeroButton>
                <HeroButton
                  className="flex-1"
                  variant="danger-soft"
                  isDisabled={isDeleting}
                  onPress={handleDelete}
                >
                  {isDeleting ? <Spinner size="sm" /> : <Ionicons name="trash-outline" size={18} color={theme.error} />}
                  <HeroButton.Label>{t('detail.delete')}</HeroButton.Label>
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

      </ScrollView>

      <CommentSheet
        visible={showComments}
        targetType="listing"
        targetId={listing.id}
        initialCount={commentsCount}
        strings={{
          title: t('detail.comment'),
          placeholder: t('detail.commentPlaceholder'),
          empty: t('detail.noComments'),
          loadFailed: t('detail.commentsFailed'),
          submitFailed: t('detail.commentFailed'),
          actionFailedTitle: t('detail.actionFailedTitle'),
          reactionFailed: t('detail.likeFailed'),
          send: t('common:buttons.send'),
          authorFallback: t('common:labels.member'),
          reply: t('detail.commentReply'),
          replyingTo: t('detail.commentReplyingTo'),
          edit: t('common:buttons.edit'),
          editing: t('detail.commentEditing'),
          delete: t('common:buttons.delete'),
          deleteConfirmTitle: t('detail.commentDeleteTitle'),
          deleteConfirmMessage: t('detail.commentDeleteMessage'),
          edited: t('detail.commentEdited'),
          cancel: t('common:buttons.cancel'),
          like: t('detail.commentLike'),
          editFailed: t('detail.commentEditFailed'),
          deleteFailed: t('detail.commentDeleteFailed'),
        }}
        onClose={() => setShowComments(false)}
        onCountChange={setCommentsCount}
      />

      <BottomSheet
        visible={!isOwner && workflowEnabled && showRequestForm}
        onClose={() => setShowRequestForm(false)}
        snapPoints={['52%', '84%']}
        title={t('detail.requestExchange')}
      >
        <View testID="exchange-request-sheet" className="gap-4 py-3">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('detail.requestMessagePlaceholder')}
          </Text>
          <Input
            value={requestHours}
            onChangeText={setRequestHours}
            keyboardType="decimal-pad"
            placeholder={t('detail.requestHoursPlaceholder')}
            placeholderTextColor={theme.textMuted}
            containerClassName="mb-0"
            style={{ color: theme.text }}
            accessibilityLabel={t('detail.requestHoursPlaceholder')}
          />
          <Input
            value={requestMessage}
            onChangeText={setRequestMessage}
            placeholder={t('detail.requestMessagePlaceholder')}
            placeholderTextColor={theme.textMuted}
            multiline
            textAlignVertical="top"
            containerClassName="mb-0"
            inputClassName="min-h-[132px] flex-1 text-base"
            style={{ color: theme.text, textAlignVertical: 'top' }}
            accessibilityLabel={t('detail.requestMessagePlaceholder')}
          />
          <View className="flex-row gap-3">
            <HeroButton
              variant="secondary"
              className="min-w-0 flex-1"
              isDisabled={isSubmitting}
              accessibilityLabel={t('detail.cancel')}
              onPress={() => setShowRequestForm(false)}
            >
              <HeroButton.Label>{t('detail.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              variant="primary"
              className="min-w-0 flex-1"
              isDisabled={isSubmitting}
              accessibilityLabel={t('detail.sendRequest')}
              onPress={() => void handleRequestExchange()}
            >
              {isSubmitting ? (
                <Spinner size="sm" color={onPrimary} />
              ) : (
                <>
                  <Ionicons name="paper-plane-outline" size={16} color={onPrimary} />
                  <HeroButton.Label style={{ color: onPrimary }}>{t('detail.sendRequest')}</HeroButton.Label>
                </>
              )}
            </HeroButton>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet
        visible={!isOwner && showReportForm && !isReported}
        onClose={() => setShowReportForm(false)}
        snapPoints={['62%', '88%']}
        title={t('detail.reportTitle')}
      >
        <View testID="exchange-report-sheet" className="gap-4 py-3">
          <View className="flex-row flex-wrap gap-2">
            {reportReasons.map((reason) => {
              const selected = reportReason === reason;
              return (
                <HeroButton
                  key={reason}
                  size="sm"
                  variant={selected ? 'secondary' : 'outline'}
                  onPress={() => setReportReason(reason)}
                  accessibilityState={{ selected }}
                >
                  <HeroButton.Label>{t(`detail.reportReason.${reason}`)}</HeroButton.Label>
                </HeroButton>
              );
            })}
          </View>
          <Input
            value={reportDetails}
            onChangeText={setReportDetails}
            placeholder={t('detail.reportDetailsPlaceholder')}
            placeholderTextColor={theme.textMuted}
            multiline
            textAlignVertical="top"
            containerClassName="mb-0"
            inputClassName="min-h-[112px] flex-1 text-base"
            style={{ color: theme.text, textAlignVertical: 'top' }}
            accessibilityLabel={t('detail.reportDetailsPlaceholder')}
          />
          <View className="flex-row gap-3">
            <HeroButton
              variant="secondary"
              className="min-w-0 flex-1"
              isDisabled={isReporting}
              accessibilityLabel={t('detail.cancel')}
              onPress={() => setShowReportForm(false)}
            >
              <HeroButton.Label>{t('detail.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              variant="danger-soft"
              className="min-w-0 flex-1"
              isDisabled={isReporting}
              accessibilityLabel={t('detail.reportSubmit')}
              onPress={() => void handleReportSubmit()}
            >
              {isReporting ? <Spinner size="sm" /> : <Ionicons name="flag-outline" size={18} color={theme.error} />}
              <HeroButton.Label>{t('detail.reportSubmit')}</HeroButton.Label>
            </HeroButton>
          </View>
        </View>
      </BottomSheet>

      {showMemberActions ? (
        <Surface
          testID="exchange-detail-footer"
          variant="default"
          className="flex-row items-center gap-2 border-t border-border px-3 pt-3"
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            paddingBottom: footerBottomPadding,
            backgroundColor: theme.surface,
            borderTopWidth: 1,
            borderTopColor: theme.border,
          }}
        >
          <HeroButton
            testID="exchange-detail-save-action"
            isIconOnly
            size="md"
            variant="secondary"
            isDisabled={isSaving}
            accessibilityLabel={isSaved ? t('detail.savedShort') : t('detail.save')}
            onPress={() => void handleSaveToggle()}
            style={{ height: 48, width: 48, flexShrink: 0 }}
          >
            {isSaving ? (
              <Spinner size="sm" />
            ) : (
              <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={20} color={primary} />
            )}
          </HeroButton>
          <HeroButton
            size="md"
            variant="secondary"
            accessibilityLabel={t('detail.messageMember')}
            onPress={() => handleAction(exchangeUser.id, exchangeUserName)}
            style={{ flex: 0.72, minWidth: 84, height: 48 }}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={primary} />
            <HeroButton.Label className="text-[13px] leading-4" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.76}>
              {t('detail.messageMember')}
            </HeroButton.Label>
          </HeroButton>
          <HeroButton
            size="md"
            variant="primary"
            isDisabled={isSubmitting}
            style={{ flex: 1.78, minWidth: 148, height: 48 }}
            accessibilityLabel={
              primaryActionLabel
            }
            onPress={() => {
              if (workflowEnabled) {
                if (activeExchange) {
                  showToast({ title: t('detail.exchangeActiveTitle'), description: t('detail.exchangeActiveMessage'), variant: 'warning' });
                  return;
                }
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowRequestForm(true);
                return;
              }
              handleAction(exchangeUser.id, exchangeUserName);
            }}
          >
            {isSubmitting ? (
              <Spinner size="sm" />
            ) : (
              <>
                <HeroButton.Label className="text-[13px] font-semibold leading-4" style={{ color: onPrimary }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>
                  {primaryActionLabel}
                </HeroButton.Label>
                <Ionicons name={primaryActionIcon} size={16} color={onPrimary} />
              </>
            )}
          </HeroButton>
        </Surface>
      ) : null}
      {confirmDialog}
    </SafeAreaView>
  );
}

function RelatedListingGroup({ title, listings, primary, theme }: { title: string; listings: RelatedExchange[]; primary: string; theme: Theme }) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-semibold uppercase text-muted-foreground">{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        {/* This button carried a `rounded-button` class that was never defined
            anywhere, so it emitted no CSS. Removed rather than invented as a token:
            `size="sm"` already applies rounded-3xl, which is what it was reaching
            for. Guarded by lib/theme/panelRadius.test.ts. */}
        {listings.slice(0, 6).map((item) => (
          <HeroButton
            key={item.id}
            size="sm"
            variant="outline"
            className="px-3 py-2"
            style={{ borderColor: primary }}
            onPress={() => router.push({ pathname: '/(modals)/exchange-detail', params: { id: String(item.id) } })}
            accessibilityLabel={item.title}
          >
            <View className="max-w-56 items-start">
              <Text className="max-w-56 text-xs font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {item.title}
              </Text>
              {(item.hours_estimate ?? 0) > 0 ? (
                <Text className="text-[11px]" style={{ color: theme.textMuted }}>{item.hours_estimate}h</Text>
              ) : null}
            </View>
          </HeroButton>
        ))}
      </View>
    </View>
  );
}

function MiniStat({ icon, label, value, primary, theme }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: number; primary: string; theme: Theme }) {
  return (
    <Surface variant="default" className="min-w-24 flex-1 rounded-panel-inner border border-border p-3">
      <View className="gap-1">
        <Ionicons name={icon} size={17} color={primary} />
        <Text className="text-lg font-bold" style={{ color: theme.text }}>{value}</Text>
        <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textMuted }}>{label}</Text>
      </View>
    </Surface>
  );
}

function DetailMetric({ icon, label, value, primary }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; value: string; primary: string }) {
  return (
    <HeroCard variant="secondary" className="flex-1">
      <HeroCard.Body className="gap-1 px-3 py-3">
        <Ionicons name={icon} size={18} color={primary} />
        <Text className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</Text>
        <Text className="text-sm font-bold text-foreground" numberOfLines={2}>{value}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function SectionTitle({ icon, title, primary, theme }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; primary: string; theme: Theme }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={18} color={primary} />
      <Text className="text-base font-semibold" style={{ color: theme.text }}>{title}</Text>
    </View>
  );
}

function InfoRow({ icon, label, theme }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; theme: Theme }) {
  return (
    <View className="flex-row items-center gap-2">
      <Ionicons name={icon} size={16} color={theme.textMuted} />
      <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }}>{label}</Text>
    </View>
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(dateLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return iso;
  }
}

function uniqueRelatedListings(items: RelatedExchange[], currentId: number, currentTitle: string): RelatedExchange[] {
  const seen = new Set<number>();
  const seenTitles = new Set<string>();
  const currentTitleKey = normalizeRelatedTitle(currentTitle);
  return items.filter((item) => {
    const titleKey = normalizeRelatedTitle(item.title);
    if (!item.id || item.id === currentId || titleKey === currentTitleKey || seen.has(item.id) || seenTitles.has(titleKey)) return false;
    seen.add(item.id);
    seenTitles.add(titleKey);
    return true;
  });
}

function normalizeRelatedTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}
