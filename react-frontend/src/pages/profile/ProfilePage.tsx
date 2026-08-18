// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { Tooltip } from '@/components/ui/Tooltip';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, Navigate } from 'react-router-dom';
import { motion } from '@/lib/motion';

import User from 'lucide-react/icons/user';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import UserPlus from 'lucide-react/icons/user-plus';
import UserCheck from 'lucide-react/icons/user-check';
import MessageSquare from 'lucide-react/icons/message-square';
import Star from 'lucide-react/icons/star';
import Clock from 'lucide-react/icons/clock';
import ListTodo from 'lucide-react/icons/list-todo';
import Award from 'lucide-react/icons/award';
import Settings from 'lucide-react/icons/settings';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Trophy from 'lucide-react/icons/trophy';
import Lock from 'lucide-react/icons/lock';
import Users from 'lucide-react/icons/users';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import ArrowUpRight from 'lucide-react/icons/arrow-up-right';
import ArrowDownLeft from 'lucide-react/icons/arrow-down-left';
import Rss from 'lucide-react/icons/rss';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import ShieldOff from 'lucide-react/icons/shield-off';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ExternalLink from 'lucide-react/icons/external-link';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { LoadingScreen, EmptyState } from '@/components/feedback';
import { LocationMapCard } from '@/components/location/LocationMapCard';
import { ReviewModal } from '@/components/reviews';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { TransferModal } from '@/components/wallet';
import { ProfileFeed } from '@/components/profile/ProfileFeed';
import { VerificationBadgeRow, VerificationBadgeSummary } from '@/components/verification/VerificationBadge';
import { FederatedTrustBadge } from '@/components/federation';
import { EndorseButton } from '@/components/endorsements/EndorseButton';
import { AvailabilityGrid } from '@/components/availability/AvailabilityGrid';
import { StoryHighlights } from '@/components/stories/StoryHighlights';
import VereinCrossInvitationButton from '@/pages/vereine/VereinCrossInvitationButton';
import { useTranslation } from 'react-i18next';
import { useAuth, useFeature, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import type { User as UserType, Listing, Review } from '@/types/api';

type ConnectionStatus = 'none' | 'pending_sent' | 'pending_received' | 'connected';

interface ProfileBadge {
  key: string;
  name: string;
  description: string;
  icon: string;
  tier: string;
  earned: boolean;
  earned_at: string | null;
}

interface GamificationSummary {
  level: number;
  level_name: string;
  xp: number;
  total_badges: number;
  badges: ProfileBadge[];
}

interface ProfileStats {
  listings_count?: number;
}

interface ProfileApiBadge {
  name: string;
  badge_key: string;
  icon: string;
  description: string;
  earned_at: string;
}

interface NexusScoreSummary {
  total_score: number;
  tier: string;
  percentile: number;
}

interface ProfileApiUser extends UserType {
  badges?: ProfileApiBadge[];
  stats?: ProfileStats;
  nexus_score?: NexusScoreSummary | null;
}

interface GamificationProfileResponse {
  xp?: number;
  level?: number;
  badges_count?: number;
}

interface GamificationBadgeResponse {
  badge_key?: string;
  key?: string;
  name?: string;
  description?: string;
  icon?: string;
  earned_at?: string | null;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function ProfilePage() {
  const { t } = useTranslation('profile');
  const { id } = useParams<{ id: string }>();
  const { user: currentUser, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { tenantPath, hasModule } = useTenant();
  const hasConnections = useFeature('connections');
  const hasGamification = useFeature('gamification');
  const hasReviews = useFeature('reviews');
  const hasWallet = hasModule('wallet');
  const toast = useToast();

  const [profile, setProfile] = useState<ProfileApiUser | null>(null);
  usePageTitle(profile?.name ? `${profile.name}` : t('page_title'));
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('about');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('none');
  const [connectionId, setConnectionId] = useState<number | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [gamification, setGamification] = useState<GamificationSummary | null>(null);

  // Block state
  const [isBlocked, setIsBlocked] = useState(false);
  const [isBlockConfirmOpen, setIsBlockConfirmOpen] = useState(false);
  const [isBlocking, setIsBlocking] = useState(false);

  // Disconnect confirmation
  const [isDisconnectConfirmOpen, setIsDisconnectConfirmOpen] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Endorsement data keyed by skill name
  const [endorsements, setEndorsements] = useState<Record<string, { count: number; isEndorsed: boolean }>>({});
  const [isLoadingEndorsements, setIsLoadingEndorsements] = useState(true);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [translatedBio, setTranslatedBio] = useState<string | null>(null);

  // Reviews state
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoadingReviews, setIsLoadingReviews] = useState(false);
  const isLoadingReviewsRef = useRef(false);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [reviewsAvailable, setReviewsAvailable] = useState(true);
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [currentBalance, setCurrentBalance] = useState(0);

  // Resolve "me" alias (from gamification notification links) to own profile
  const resolvedId = id === 'me' ? undefined : id;
  // isOwnProfile must require authentication — unauthenticated users visiting /profile/me
  // would otherwise get isOwnProfile=true (via !resolvedId) and see the Settings/edit UI.
  const isOwnProfile = isAuthenticated && (!resolvedId || (currentUser != null && resolvedId === currentUser.id.toString()));
  const profileId = resolvedId || currentUser?.id?.toString();

  // Stable primitive dep for loadProfile — avoids regenerating the callback on every
  // auth context render where currentUser object identity changes but id is the same.
  const currentUserId = currentUser?.id?.toString();

  const loadProfile = useCallback(async () => {
    if (!profileId) {
      setIsLoading(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      setErrorCode(null);
      setEndorsements({});
      setIsLoadingEndorsements(true);

      const profileReq = api.get<UserType>(`/v2/users/${profileId}`);
      const listingsReq = api.get<Listing[]>(`/v2/users/${profileId}/listings?limit=6`);
      const gamProfileReq = hasGamification
        ? api.get<GamificationProfileResponse>(`/v2/gamification/profile?user_id=${profileId}`)
        : null;
      const gamBadgesReq = hasGamification
        ? api.get<GamificationBadgeResponse[]>(`/v2/gamification/badges?user_id=${profileId}`)
        : null;
      const connectionReq = (isAuthenticated && currentUserId && profileId !== currentUserId)
        ? api.get<{ status: ConnectionStatus; connection_id?: number }>(`/v2/connections/status/${profileId}`)
        : null;
      const blockStatusReq = (isAuthenticated && currentUserId && profileId !== currentUserId)
        ? api.get<{ is_blocked: boolean; is_blocked_by: boolean }>(`/v2/users/${profileId}/block-status`)
        : null;
      const endorsementsReq = api.get<{
        endorsements?: Record<string, {
          skill_name: string;
          count: number;
          endorsed_by_ids?: string;
        }>;
      }>(`/v2/members/${profileId}/endorsements`).catch((err: unknown) => {
        logError('Failed to load endorsements', err);
        return undefined;
      });

      const [profileRes, listingsRes, gamificationProfileRes, gamificationBadgesRes, connectionRes, blockStatusRes, endorsementsRes] =
        await Promise.all([
          profileReq,
          listingsReq,
          gamProfileReq ?? Promise.resolve(undefined),
          gamBadgesReq ?? Promise.resolve(undefined),
          connectionReq ?? Promise.resolve(undefined),
          blockStatusReq ?? Promise.resolve(undefined),
          endorsementsReq,
        ]) as [
          { success: boolean; data?: ProfileApiUser; code?: string },
          { success: boolean; data?: Listing[] },
          { success: boolean; data?: GamificationProfileResponse } | undefined,
          { success: boolean; data?: GamificationBadgeResponse[] } | undefined,
          { success: boolean; data?: { status: ConnectionStatus; connection_id?: number } } | undefined,
          { success: boolean; data?: { is_blocked: boolean; is_blocked_by: boolean } } | undefined,
          { success: boolean; data?: { endorsements?: Record<string, { skill_name: string; count: number; endorsed_by_ids?: string }> } } | undefined,
        ];

      if (controller.signal.aborted) return;

      if (profileRes.success && profileRes.data) {
        setProfile(profileRes.data);

        if (hasGamification) {
          const profileBadges: ProfileBadge[] = Array.isArray(profileRes.data.badges)
            ? profileRes.data.badges.map((b) => ({
                key: b.badge_key,
                name: b.name,
                description: b.description || '',
                icon: b.icon || '',
                tier: '',
                earned: true,
                earned_at: b.earned_at,
              }))
            : [];

          const gamificationBadges: ProfileBadge[] =
            gamificationBadgesRes?.success && Array.isArray(gamificationBadgesRes.data)
              ? gamificationBadgesRes.data
                  .map((b) => {
                    const key = b.badge_key || b.key;
                    if (!key || !b.name) return null;
                    return {
                      key,
                      name: b.name,
                      description: b.description || '',
                      icon: b.icon || '',
                      tier: '',
                      earned: true,
                      earned_at: b.earned_at ?? null,
                    };
                  })
                  .filter((b): b is ProfileBadge => b !== null)
              : [];

          const mergedBadges = gamificationBadges.length > 0 ? gamificationBadges : profileBadges;

          setGamification({
            level: gamificationProfileRes?.data?.level ?? profileRes.data.level ?? 1,
            level_name: '',
            xp: gamificationProfileRes?.data?.xp ?? profileRes.data.xp ?? 0,
            total_badges: gamificationProfileRes?.data?.badges_count ?? mergedBadges.length,
            badges: mergedBadges.slice(0, 12),
          });
        }
      } else {
        // Clear any previously-loaded profile so the error / incomplete state shows.
        // Without this, navigating from a loaded profile to one that fails to load
        // leaves the prior profile in state, and the `error && !profile` guard (and
        // the PROFILE_INCOMPLETE `!profile` fall-through) stay false — so the stale
        // profile renders under the new URL.
        setProfile(null);
        const resCode = profileRes.code ?? (profileRes as { code?: string }).code;
        setErrorCode(resCode ?? null);
        // PROFILE_INCOMPLETE gets a friendly EmptyState — don't set error so the
        // second !profile block handles it with the correct message.
        if (resCode !== 'PROFILE_INCOMPLETE') {
          setError(tRef.current('not_found'));
        }
        return;
      }

      if (listingsRes.success && listingsRes.data) {
        setListings(listingsRes.data);
      }
      if (connectionRes?.success && connectionRes.data) {
        setConnectionStatus(connectionRes.data.status);
        setConnectionId(connectionRes.data.connection_id ?? null);
      }
      if (blockStatusRes?.success && blockStatusRes.data) {
        setIsBlocked(blockStatusRes.data.is_blocked);
      }

      if (!controller.signal.aborted && endorsementsRes?.success && endorsementsRes.data?.endorsements) {
        const map: Record<string, { count: number; isEndorsed: boolean }> = {};
        for (const [skill, info] of Object.entries(endorsementsRes.data.endorsements)) {
          const endorserIds = info.endorsed_by_ids?.split(',') ?? [];
          map[skill] = {
            count: info.count || 0,
            isEndorsed: currentUserId ? endorserIds.includes(currentUserId) : false,
          };
        }
        setEndorsements(map);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load profile', err);
      // Clear stale profile (see the else branch above) so a failed reload shows
      // the error screen instead of the previously-loaded profile.
      setProfile(null);
      setError(tRef.current('load_error'));
    } finally {
      setIsLoading(false);
      setIsLoadingEndorsements(false);
    }
  }, [profileId, isAuthenticated, currentUserId, hasGamification]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Load reviews when Reviews tab is selected (lazy load)
  const loadReviews = useCallback(async () => {
    if (!profileId || reviewsLoaded || isLoadingReviewsRef.current) return;

    try {
      isLoadingReviewsRef.current = true;
      setIsLoadingReviews(true);
      const response = await api.get<Review[]>(`/v2/reviews/user/${profileId}?per_page=50`);

      if (response.success && response.data) {
        setReviews(response.data);
        setReviewsLoaded(true);
      } else {
        setReviewsAvailable(false);
      }
    } catch {
      setReviewsAvailable(false);
    } finally {
      isLoadingReviewsRef.current = false;
      setIsLoadingReviews(false);
    }
  }, [profileId, reviewsLoaded]);

  useEffect(() => {
    if (activeTab === 'reviews' && !reviewsLoaded) {
      loadReviews();
    }
  }, [activeTab, reviewsLoaded, loadReviews]);

  // Fetch wallet balance once when an authenticated user views another user's profile.
  useEffect(() => {
    if (isAuthenticated && !isOwnProfile && hasWallet) {
      api.get<{ balance: number }>('/v2/wallet/balance').then((res) => {
        if (res.success && res.data) setCurrentBalance(res.data.balance);
      }).catch((err) => logError('Failed to load wallet balance', err));
    }
  }, [isAuthenticated, isOwnProfile, hasWallet]);

  const handleConnect = useCallback(async () => {
    if (!profile?.id) return;

    try {
      setIsConnecting(true);

      if (connectionStatus === 'none') {
        const response = await api.post<{ connection_id: number }>('/v2/connections/request', {
          user_id: profile.id,
        });
        if (response.success) {
          setConnectionStatus('pending_sent');
          setConnectionId(response.data?.connection_id ?? null);
          toastRef.current.success(tRef.current('toast.request_sent_title'), tRef.current('toast.request_sent'));
        } else {
          toastRef.current.error(tRef.current('toast.failed'), response.error || tRef.current('toast.failed'));
        }
      } else if (connectionStatus === 'pending_received' && connectionId) {
        const response = await api.post(`/v2/connections/${connectionId}/accept`);
        if (response.success) {
          setConnectionStatus('connected');
          toastRef.current.success(tRef.current('toast.connected_title'), tRef.current('toast.connected'));
        } else {
          toastRef.current.error(tRef.current('toast.failed'), response.error || tRef.current('toast.failed'));
        }
      } else if (connectionStatus === 'pending_sent' && connectionId) {
        // Cancel pending request — no confirmation needed
        const response = await api.delete(`/v2/connections/${connectionId}`);
        if (response.success) {
          setConnectionStatus('none');
          setConnectionId(null);
          toastRef.current.info(tRef.current('toast.removed_title'), tRef.current('toast.removed'));
        } else {
          toastRef.current.error(tRef.current('toast.failed'), response.error || tRef.current('toast.failed'));
        }
      }
    } catch (error) {
      logError('Connection action failed', error);
      toastRef.current.error(tRef.current('toast.failed'), tRef.current('toast.error'));
    } finally {
      setIsConnecting(false);
    }
  }, [profile?.id, connectionStatus, connectionId]);

  const handleDisconnect = useCallback(async () => {
    if (!connectionId) return;
    try {
      setIsDisconnecting(true);
      const response = await api.delete(`/v2/connections/${connectionId}`);
      if (response.success) {
        setConnectionStatus('none');
        setConnectionId(null);
        setIsDisconnectConfirmOpen(false);
        toastRef.current.info(tRef.current('toast.removed_title'), tRef.current('toast.removed'));
      } else {
        toastRef.current.error(tRef.current('toast.failed'), response.error || tRef.current('toast.failed'));
      }
    } catch (error) {
      logError('Disconnect action failed', error);
      toastRef.current.error(tRef.current('toast.failed'), tRef.current('toast.error'));
    } finally {
      setIsDisconnecting(false);
    }
  }, [connectionId]);

  const handleBlock = useCallback(async () => {
    if (!profile?.id) return;
    try {
      setIsBlocking(true);
      const response = await api.post(`/v2/users/${profile.id}/block`);
      if (response.success) {
        setIsBlocked(true);
        setIsBlockConfirmOpen(false);
        toastRef.current.success(tRef.current('blocked_success'));
      } else {
        toastRef.current.error(tRef.current('block_failed'));
      }
    } catch (err) {
      logError('Failed to block user', err);
      toastRef.current.error(tRef.current('block_failed'));
    } finally {
      setIsBlocking(false);
    }
  }, [profile?.id]);

  const handleUnblock = useCallback(async () => {
    if (!profile?.id) return;
    try {
      const response = await api.delete(`/v2/users/${profile.id}/block`);
      if (response.success) {
        setIsBlocked(false);
        toastRef.current.success(tRef.current('unblocked_success'));
      } else {
        toastRef.current.error(tRef.current('unblock_failed'));
      }
    } catch (err) {
      logError('Failed to unblock user', err);
      toastRef.current.error(tRef.current('unblock_failed'));
    }
  }, [profile?.id]);

  // Redirect unauthenticated /profile/me to login once auth state is resolved
  if (id === 'me' && !isAuthLoading && !isAuthenticated) {
    return <Navigate to={tenantPath('/login')} replace />;
  }

  if (isLoading || isAuthLoading) {
    return <LoadingScreen message={t('loading')} />;
  }

  const fallbackPath = hasConnections ? tenantPath('/members') : tenantPath('/explore');
  const fallbackLabel = hasConnections ? t('browse_members') : t('back_to_explore');

  // Error state with retry (not PROFILE_INCOMPLETE — that falls through to !profile below)
  if (error && !profile) {
    return (
      <div className="max-w-4xl mx-auto">
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <div className="flex justify-center gap-3">
            <Button
              as={Link}
              to={fallbackPath}
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {fallbackLabel}
            </Button>
            <Button
              color="primary"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadProfile()}
            >
              {t('try_again')}
            </Button>
          </div>
        </GlassCard>
      </div>
    );
  }

  // Profile not found or incomplete
  if (!profile) {
    return (
      <EmptyState
        icon={<User className="w-12 h-12" aria-hidden="true" />}
        title={errorCode === 'PROFILE_INCOMPLETE' ? t('profile_incomplete') : t('not_found')}
        description={errorCode === 'PROFILE_INCOMPLETE' ? t('profile_incomplete_desc') : t('not_found_desc')}
        action={
          <Button
            as={Link}
            to={fallbackPath}
            variant="flat"
            className="bg-theme-elevated text-theme-primary"
            startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
          >
            {fallbackLabel}
          </Button>
        }
      />
    );
  }

  const profileName = profile.name || profile.first_name || t('member_fallback');
  const profileAvatar = profile.avatar_url || profile.avatar;
  const joinedDate = profile.created_at
    ? new Date(profile.created_at).toLocaleDateString(getFormattingLocale(), { month: 'long', year: 'numeric' })
    : null;
  const metaDescription = t('page_meta.description', { name: profileName });
  const earnedBadgeCount = gamification?.total_badges ?? gamification?.badges.length ?? 0;
  const visibleSkills = profile.skills ? (showAllSkills ? profile.skills : profile.skills.slice(0, 8)) : [];
  const taglineText = profile.tagline
    ? profile.tagline.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : '';

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-4xl mx-auto space-y-5 sm:space-y-6"
    >
      <PageMeta
        title={profileName}
        description={metaDescription}
        image={profileAvatar ? resolveAvatarUrl(profileAvatar) : undefined}
        type="profile"
        noIndex
      />
      {/* Profile Header */}
      <motion.div variants={itemVariants}>
        <GlassCard className="overflow-hidden">
          <div className="h-1.5 bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary,var(--color-primary)))]" aria-hidden="true" />
          <div className="p-5 sm:p-8">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start sm:gap-6">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <Avatar
                src={profileAvatar ? resolveAvatarUrl(profileAvatar) : undefined}
                name={profileName}
                showFallback
                className="w-24 h-24 sm:w-32 sm:h-32 ring-4 ring-theme-default shadow-lg"
              />
              {hasGamification && profile.level && (
                <div aria-hidden="true" className="absolute -bottom-2 -right-2 px-2 py-1 rounded-full bg-gradient-to-r from-[var(--color-primary)] to-[var(--color-secondary,var(--color-primary))] text-white text-xs font-bold">
                  {t('level', { level: profile.level })}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex min-w-0 flex-col items-center gap-2 sm:items-start">
                <div className="flex w-full min-w-0 flex-col items-center gap-2 sm:flex-row sm:items-start">
                  <h1 className="min-w-0 max-w-full text-xl font-bold leading-tight text-theme-primary sm:text-2xl lg:text-3xl">
                    <span className="block overflow-hidden text-ellipsis whitespace-nowrap sm:whitespace-normal sm:line-clamp-2">
                      {profileName}
                    </span>
                  </h1>
                  <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                    {/* Verification badges */}
                    <VerificationBadgeRow userId={profile.id} size="md" />
                    {/* Cross-federation reputation badge */}
                    {profile.federated_partner_id != null && typeof profile.federated_reputation_score === 'number' && (
                      <FederatedTrustBadge
                        score={profile.federated_reputation_score}
                        reviewCount={profile.federated_reputation_count ?? 0}
                        isFederated
                        size="md"
                      />
                    )}
                    {/* Connected chip for other users */}
                    {!isOwnProfile && hasConnections && connectionStatus === 'connected' && (
                      <Chip
                        color="success"
                        variant="flat"
                        size="sm"
                        startContent={<UserCheck className="w-3 h-3" aria-hidden="true" />}
                      >
                        {t('connected')}
                      </Chip>
                    )}
                  </div>
                </div>
              </div>
              {taglineText && (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-theme-muted sm:text-base sm:leading-7 line-clamp-2">{taglineText}</p>
              )}

              {/* Meta */}
              <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm text-theme-subtle sm:justify-start">
                {profile.location && (
                  <Tooltip content={profile.location}>
                    <span className="inline-flex max-w-full items-center gap-1 rounded-full bg-theme-elevated px-2.5 py-1 sm:max-w-[240px]">
                      <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{profile.location}</span>
                    </span>
                  </Tooltip>
                )}
                {joinedDate && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-theme-elevated px-2.5 py-1">
                    <Calendar className="w-4 h-4" aria-hidden="true" />
                    <time dateTime={profile.created_at}>
                      {t('joined', { date: joinedDate })}
                    </time>
                  </span>
                )}
                {typeof profile.rating === 'number' && profile.rating > 0 && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-theme-elevated px-2.5 py-1"
                    aria-label={t('aria.rating_summary', { rating: profile.rating.toFixed(1) })}
                  >
                    <Star className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    <span aria-hidden="true">{profile.rating.toFixed(1)}</span>
                  </span>
                )}
                {profile.nexus_score && (
                  isOwnProfile ? (
                    <Link
                      to={tenantPath('/nexus-score')}
                      className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/25 dark:text-accent"
                      aria-label={t('aria.nexus_score_link', {
                        score: profile.nexus_score.total_score,
                        tier: profile.nexus_score.tier,
                      })}
                    >
                      <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                      {profile.nexus_score.total_score}
                      <span className="text-[10px] opacity-70 capitalize">{profile.nexus_score.tier}</span>
                    </Link>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2.5 py-1 text-xs font-semibold text-accent dark:text-accent"
                      aria-label={t('aria.nexus_score_summary', {
                        score: profile.nexus_score.total_score,
                        tier: profile.nexus_score.tier,
                      })}
                    >
                      <Trophy className="w-3.5 h-3.5" aria-hidden="true" />
                      {profile.nexus_score.total_score}
                      <span className="text-[10px] opacity-70 capitalize">{profile.nexus_score.tier}</span>
                    </span>
                  )
                )}
              </div>

              {/* Actions */}
              <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:justify-start sm:gap-3">
                {isOwnProfile ? (
                  <Button
                    as={Link}
                    to={tenantPath('/settings')}
                    color="primary"
                    startContent={<Settings className="w-4 h-4" aria-hidden="true" />}
                    className="w-full sm:w-auto"
                  >
                    {t('settings')}
                  </Button>
                ) : isBlocked ? (
                  // Blocked state — show only unblock option and a notice
                  <>
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-rose-500/10 text-theme-danger text-sm">
                      <ShieldOff className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <span>{t('blocked_by_you')}</span>
                    </div>
                    <Button
                      variant="flat"
                      className="bg-theme-elevated text-theme-secondary"
                      startContent={<ShieldCheck className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => void handleUnblock()}
                    >
                      {t('unblock_user')}
                    </Button>
                  </>
                ) : (
                  <>
                    {isAuthenticated && (
                      <Button
                        as={Link}
                        to={tenantPath(`/messages/new/${profile.id}`)}
                        color="primary"
                        startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
                        className="w-full sm:w-auto"
                      >
                        {t('send_message')}
                      </Button>
                    )}
                    {!isAuthenticated && (
                      <Button
                        as={Link}
                        to={tenantPath('/login')}
                        variant="flat"
                        className="w-full bg-theme-elevated text-theme-primary sm:w-auto"
                        startContent={<MessageSquare className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('login_to_message')}
                      </Button>
                    )}
                    {hasConnections && isAuthenticated && connectionStatus !== 'connected' && (
                      <Button
                        variant="flat"
                        className={
                          connectionStatus === 'pending_sent'
                            ? 'w-full bg-amber-500/20 text-amber-600 dark:text-amber-400 sm:w-auto'
                            : connectionStatus === 'pending_received'
                            ? 'w-full bg-accent/20 text-accent dark:text-accent sm:w-auto'
                            : 'w-full bg-theme-elevated text-theme-primary sm:w-auto'
                        }
                        startContent={
                          connectionStatus === 'pending_sent' ? (
                            <Clock className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <UserPlus className="w-4 h-4" aria-hidden="true" />
                          )
                        }
                        onPress={handleConnect}
                        isLoading={isConnecting}
                      >
                        {connectionStatus === 'pending_sent'
                          ? t('cancel_request')
                          : connectionStatus === 'pending_received'
                          ? t('accept')
                          : t('connect')}
                      </Button>
                    )}
                    {!isOwnProfile && isAuthenticated && profile.id ? (
                      <VereinCrossInvitationButton userId={profile.id} />
                    ) : null}
                    {hasWallet && isAuthenticated && (
                      <Button
                        color="secondary"
                        startContent={<ArrowUpRight className="w-4 h-4" aria-hidden="true" />}
                        onPress={() => setIsTransferModalOpen(true)}
                        className="w-full sm:w-auto"
                      >
                        {t('send_credits')}
                      </Button>
                    )}
                    {isAuthenticated && (
                      <Dropdown>
                        <DropdownTrigger>
                          <Button isIconOnly variant="flat" className="bg-theme-elevated text-theme-secondary" aria-label={t('more_options')}>
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label={t('profile_actions')}
                          onAction={(key) => {
                            if (key === 'review') setIsReviewModalOpen(true);
                            if (key === 'disconnect') setIsDisconnectConfirmOpen(true);
                            if (key === 'block') setIsBlockConfirmOpen(true);
                          }}
                        >
                          {hasReviews ? (
                            <DropdownItem key="review" id="review" startContent={<Star className="w-4 h-4" />}>
                              {t('write_review')}
                            </DropdownItem>
                          ) : null}
                          {hasConnections && connectionStatus === 'connected' ? (
                            <DropdownItem key="disconnect" id="disconnect" startContent={<UserCheck className="w-4 h-4" />}>
                              {t('disconnect_confirm')}
                            </DropdownItem>
                          ) : null}
                          <DropdownItem key="block" id="block" className="text-danger" color="danger" startContent={<ShieldOff className="w-4 h-4" />}>
                            {t('block_user')}
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
          </div>
        </GlassCard>

        {/* Location Map */}
        {profile.location && profile.latitude && profile.longitude && (
          <LocationMapCard
            title={t('location_title')}
            locationText={profile.location}
            markers={[{
              id: profile.id,
              lat: Number(profile.latitude),
              lng: Number(profile.longitude),
              title: profile.name ?? '',
            }]}
            center={{ lat: Number(profile.latitude), lng: Number(profile.longitude) }}
            mapHeight="200px"
            zoom={13}
            className="mt-6"
          />
        )}
      </motion.div>

      {/* Stats Cards Row */}
      <motion.div variants={itemVariants}>
        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <ProfileStatCard
            icon={<ArrowUpRight className="w-5 h-5" aria-hidden="true" />}
            label={t('stats.hours_given')}
            value={profile.total_hours_given ?? 0}
            color="emerald"
          />
          <ProfileStatCard
            icon={<ArrowDownLeft className="w-5 h-5" aria-hidden="true" />}
            label={t('stats.hours_received')}
            value={profile.total_hours_received ?? 0}
            color="indigo"
          />
          <ProfileStatCard
            icon={<ListTodo className="w-5 h-5" aria-hidden="true" />}
            label={t('stats.active_listings')}
            value={profile.stats?.listings_count ?? listings.length}
            color="purple"
          />
          <ProfileStatCard
            icon={<Users className="w-5 h-5" aria-hidden="true" />}
            label={t('stats.groups')}
            value={profile.groups_count ?? 0}
            color="amber"
          />
          <ProfileStatCard
            icon={<CalendarCheck className="w-5 h-5" aria-hidden="true" />}
            label={t('stats.events')}
            value={profile.events_attended ?? 0}
            color="rose"
          />
        </dl>
      </motion.div>

      {/* Story Highlights */}
      {profile && (
        <motion.div variants={itemVariants}>
          <StoryHighlights
            userId={profile.id}
            userName={profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim()}
            userAvatar={profile.avatar_url ?? profile.avatar}
          />
        </motion.div>
      )}

      {/* Tabs Content */}
      <motion.div variants={itemVariants}>
        {(() => {
          const tabs: Array<{ key: string; icon: typeof User; label: string; count?: number }> = [
            { key: 'about', icon: User, label: t('tabs.about') },
            { key: 'listings', icon: ListTodo, label: t('tabs.listings'), count: profile.stats?.listings_count ?? listings.length },
            { key: 'activity', icon: Rss, label: t('tabs.activity') },
            { key: 'availability', icon: Calendar, label: t('tabs.availability') },
            ...(hasReviews && reviewsAvailable ? [{ key: 'reviews', icon: Star, label: t('tabs.reviews'), count: reviewsLoaded ? reviews.length : undefined }] : []),
            ...(hasGamification ? [{ key: 'achievements', icon: Award, label: t('tabs.achievements'), count: earnedBadgeCount }] : []),
          ];
          return (
            <Tabs
              aria-label={t('aria.profile_sections')}
              selectedKey={activeTab}
              onSelectionChange={(key) => setActiveTab(String(key))}
              variant="light"
              classNames={{
                base: 'w-full overflow-x-auto pb-1',
                tabList: 'w-max max-w-full bg-theme-elevated p-1 rounded-lg gap-1',
                cursor: 'bg-theme-hover shadow-sm',
                tab: 'min-h-9 w-auto min-w-0 px-3 py-2 text-xs sm:text-sm',
                tabContent: 'group-data-[selected=true]:text-theme-primary text-theme-muted',
              }}
            >
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <Tab
                    key={tab.key}
                    id={`tab-${tab.key}`}
                    aria-controls={`panel-${tab.key}`}
                    title={(
                      <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                        <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                        <span className="max-w-[9rem] truncate sm:max-w-[12rem] md:max-w-none">{tab.label}</span>
                        {typeof tab.count === 'number' && (
                          <span className="shrink-0 rounded-full bg-theme-default px-1.5 py-0.5 text-[10px] font-semibold leading-none text-theme-subtle">
                            {tab.count}
                          </span>
                        )}
                      </span>
                    )}
                  />
                );
              })}
            </Tabs>
          );
        })()}

        <div className="mt-6">
          {activeTab === 'about' && (
            <GlassCard role="tabpanel" id="panel-about" aria-labelledby="tab-about" className="p-6">
              <h2 className="text-lg font-semibold text-theme-primary mb-4">{t('about.heading')}</h2>
              {profile.bio ? (
                <div>
                  <SafeHtml
                    content={translatedBio ?? profile.bio}
                    as="div"
                    className={`text-theme-muted whitespace-pre-wrap prose prose-sm max-w-none dark:prose-invert${!isOwnProfile && !bioExpanded && profile.bio.length > 300 ? ' line-clamp-4' : ''}`}
                  />
                  {!isOwnProfile && profile.bio.length > 300 && (
                    <Button
                      size="sm"
                      variant="light"
                      color="primary"
                      className="mt-1 min-h-7 px-0 text-xs"
                      onPress={() => setBioExpanded((v) => !v)}
                    >
                      {bioExpanded ? t('read_less') : t('read_more')}
                    </Button>
                  )}
                  <TranslateButton
                    contentType="profile_bio"
                    contentId={profile.id ?? 0}
                    sourceText={profile.bio}
                    sourceLocale={(profile as { preferred_language?: string | null }).preferred_language ?? null}
                    onTextChange={(text, isTranslated) => setTranslatedBio(isTranslated ? text : null)}
                    className="mt-1"
                  />
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-theme-default bg-theme-elevated/50 p-4">
                  <p className="text-sm text-theme-subtle">{t('about.no_bio')}</p>
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-sm font-medium text-theme-muted mb-3">{t('about.skills')}</h3>
                {profile.skills && profile.skills.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {visibleSkills.map((skill) => (
                      <div key={skill} className="inline-flex items-center gap-1.5">
                        <Chip
                          variant="flat"
                          size="sm"
                          className="max-w-[12rem] bg-accent/20 text-accent dark:text-accent"
                        >
                          <span className="block truncate">{skill}</span>
                        </Chip>
                        {!isOwnProfile && isAuthenticated && profile.id && (
                          isLoadingEndorsements ? (
                            <Skeleton className="rounded w-6 h-4" />
                          ) : (
                            <EndorseButton
                              memberId={profile.id}
                              skillName={skill}
                              endorsementCount={endorsements[skill]?.count ?? 0}
                              isEndorsed={endorsements[skill]?.isEndorsed ?? false}
                              compact
                            />
                          )
                        )}
                      </div>
                    ))}
                    {profile.skills.length > 8 && !showAllSkills && (
                      <Button
                        variant="light"
                        size="sm"
                        className="bg-theme-elevated text-theme-muted hover:bg-theme-hover h-auto min-h-0 px-2 py-0.5 rounded-full text-xs"
                        onPress={() => setShowAllSkills(true)}
                      >
                        {t('show_more_skills', { count: profile.skills.length - 8 })}
                      </Button>
                    )}
                    {showAllSkills && profile.skills.length > 8 && (
                      <Button
                        variant="light"
                        size="sm"
                        className="bg-theme-elevated text-theme-muted hover:bg-theme-hover h-auto min-h-0 px-2 py-0.5 rounded-full text-xs"
                        onPress={() => setShowAllSkills(false)}
                      >
                        {t('show_less')}
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-theme-default bg-theme-elevated/50 p-4">
                    <p className="text-sm text-theme-subtle">
                      {isOwnProfile ? t('about.no_skills_own') : t('about.no_skills_other')}
                    </p>
                  </div>
                )}
              </div>

              {/* Verification Badges Summary */}
              {profile.id && (
                <div className="mt-6">
                  <VerificationBadgeSummary userId={profile.id} />
                </div>
              )}
            </GlassCard>
          )}

          {activeTab === 'listings' && (
            <div role="tabpanel" id="panel-listings" aria-labelledby="tab-listings" className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4" role={listings.length > 0 ? 'list' : undefined}>
                {listings.length > 0 ? (
                  listings.map((listing) => (
                    <Link
                      key={listing.id}
                      to={tenantPath(`/listings/${listing.id}`)}
                      aria-label={t('aria.listing_card', {
                        type: listing.type === 'offer' ? t('listing_type.offer') : t('listing_type.request'),
                        title: listing.title,
                      })}
                      className="min-w-0 cursor-pointer"
                    >
                      <article role="listitem" className="h-full min-w-0">
                        <GlassCard className="hover:scale-[1.02] transition-transform h-full flex flex-col overflow-hidden cursor-pointer">
                          {listing.image_url && (
                            <img
                              {...responsiveThumbnailProps(listing.image_url, {
                                width: 640,
                                height: 360,
                                sizes: '(min-width: 1024px) 360px, (min-width: 640px) 45vw, 92vw',
                              })}
                              alt={listing.title || t('listing_image_alt')}
                              className="w-full h-32 object-cover"
                              loading="lazy"
                            />
                          )}
                          <div className="flex min-w-0 flex-1 flex-col p-5">
                            <div className="flex items-center gap-2 mb-2">
                              <Chip
                                size="sm"
                                variant="flat"
                                aria-label={listing.type === 'offer' ? t('listing_type.offer') : t('listing_type.request')}
                                className={
                                  listing.type === 'offer'
                                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                                }
                              >
                                {listing.type === 'offer' ? t('listing_type.offer') : t('listing_type.request')}
                              </Chip>
                            </div>
                            <h3 className="mb-1 min-w-0 truncate font-medium text-theme-primary">{listing.title}</h3>
                            <SafeHtml content={listing.description} className="text-sm text-theme-subtle line-clamp-2" as="p" />
                            <div className="flex items-center gap-2 mt-3 text-xs text-theme-subtle">
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              {t('hours_abbrev', { hours: listing.hours_estimate ?? listing.estimated_hours ?? t('not_available_abbrev') })}
                            </div>
                          </div>
                        </GlassCard>
                      </article>
                    </Link>
                  ))
                ) : (
                  <div className="col-span-2">
                    <EmptyState
                      icon={<ListTodo className="w-12 h-12" aria-hidden="true" />}
                      title={t('no_listings')}
                      description={isOwnProfile ? t('no_listings_own') : t('no_listings_other')}
                      action={
                        isOwnProfile && (
                          <Button as={Link} to={tenantPath('/listings/create')} color="primary">
                            {t('create_listing')}
                          </Button>
                        )
                      }
                    />
                  </div>
                )}
              </div>
              {/* View all link — shown when we may have loaded only the first 6 */}
              {listings.length >= 6 && (
                <div className="text-center pt-2">
                  <Button
                    as={Link}
                    to={tenantPath(`/listings?user_id=${profile.id}`)}
                    variant="light"
                    color="primary"
                    endContent={<ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    {t('view_all_listings')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'activity' && profile && (
            <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity">
              <ProfileFeed userId={profile.id} isOwnProfile={!!isOwnProfile} />
            </div>
          )}

          {activeTab === 'availability' && profile && (
            <GlassCard role="tabpanel" id="panel-availability" aria-labelledby="tab-availability" className="p-6">
              <AvailabilityGrid
                userId={profile.id}
                editable={false}
                compact
                fallback={
                  <EmptyState
                    icon={<Calendar className="w-12 h-12" aria-hidden="true" />}
                    title={t('no_availability')}
                    description={t('no_availability_desc')}
                  />
                }
              />
            </GlassCard>
          )}

          {/* Reviews Tab */}
          {activeTab === 'reviews' && (
            <div role="tabpanel" id="panel-reviews" aria-labelledby="tab-reviews" className="space-y-4">
              {isLoadingReviews ? (
                <div role="status" aria-label={t('aria.loading_reviews')} aria-busy="true" className="space-y-3">
                  <GlassCard className="p-4">
                    <Skeleton className="h-4 w-24 rounded" />
                  </GlassCard>
                  {Array.from({ length: 2 }).map((_, i) => (
                    <GlassCard key={i} className="p-5">
                      <div className="flex items-start gap-4">
                        <Skeleton className="rounded-full flex-shrink-0">
                          <div className="w-10 h-10 rounded-full bg-surface-tertiary" />
                        </Skeleton>
                        <div className="flex-1 space-y-2">
                          <Skeleton className="rounded-lg">
                            <div className="h-4 rounded-lg bg-surface-tertiary w-1/4" />
                          </Skeleton>
                          <Skeleton className="rounded-lg">
                            <div className="h-3 rounded-lg bg-surface-tertiary w-1/5" />
                          </Skeleton>
                          <Skeleton className="rounded-lg">
                            <div className="h-3 rounded-lg bg-surface-tertiary w-3/4" />
                          </Skeleton>
                        </div>
                      </div>
                    </GlassCard>
                  ))}
                </div>
              ) : reviews.length > 0 ? (
                <>
                  {/* Reviews summary */}
                  {typeof profile.rating === 'number' && profile.rating > 0 && (
                    <GlassCard className="p-4">
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <div className="text-3xl font-bold text-theme-primary">{profile.rating.toFixed(1)}</div>
                          <div className="flex items-center gap-0.5 mt-1">
                            {[1, 2, 3, 4, 5].map((star) => (
                              <Star
                                key={star}
                                className={`w-4 h-4 ${
                                  star <= Math.round(profile.rating ?? 0)
                                    ? 'text-amber-400 fill-amber-400'
                                    : 'text-theme-subtle'
                                }`}
                                aria-hidden="true"
                              />
                            ))}
                          </div>
                          <p className="text-xs text-theme-subtle mt-1">
                            {t('reviews_count', { count: reviews.length })}
                          </p>
                        </div>
                      </div>
                    </GlassCard>
                  )}

                  {/* Individual reviews */}
                  <div aria-label={t('aria.user_reviews')}>
                    {reviews.map((review) => (
                      <ReviewCard key={review.id} review={review} />
                    ))}
                  </div>
                </>
              ) : (
                <GlassCard className="p-6">
                  <EmptyState
                    icon={<Star className="w-12 h-12" aria-hidden="true" />}
                    title={t('no_reviews')}
                    description={isOwnProfile ? t('no_reviews_own') : t('no_reviews_other')}
                  />
                </GlassCard>
              )}
            </div>
          )}

          {activeTab === 'achievements' && (
            <div role="tabpanel" id="panel-achievements" aria-labelledby="tab-achievements" className="space-y-4">
              {gamification && gamification.badges.length > 0 ? (
                <>
                  {/* Summary */}
                  <GlassCard className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20">
                          <Trophy className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-theme-primary">
                            {t('achievements.badges', { count: gamification.total_badges })}
                          </p>
                          {profile.level && (
                            <p className="text-xs text-theme-subtle">{t('achievements.level', { level: profile.level })}</p>
                          )}
                        </div>
                      </div>
                      {isOwnProfile && (
                        <Button
                          as={Link}
                          to={tenantPath('/achievements')}
                          size="sm"
                          variant="flat"
                          className="w-full bg-theme-elevated text-theme-muted sm:w-auto"
                        >
                          {t('achievements.view_all')}
                        </Button>
                      )}
                    </div>
                  </GlassCard>

                  {/* Badge Grid */}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {gamification.badges.map((badge) => (
                      <GlassCard
                        key={badge.key}
                        className={`min-w-0 p-4 text-center ${badge.earned ? '' : 'opacity-50'}`}
                      >
                        <div className="mb-2 flex h-8 items-center justify-center">
                          {badge.icon ? (
                            <span className="text-3xl leading-none" aria-hidden="true">{badge.icon}</span>
                          ) : (
                            <Trophy className="h-7 w-7 text-[var(--color-warning)]" aria-hidden="true" />
                          )}
                        </div>
                        <Tooltip content={badge.name}>
                          <p className="truncate text-sm font-medium text-theme-primary">{badge.name}</p>
                        </Tooltip>
                        <p className="text-xs text-theme-subtle mt-1 line-clamp-2">{badge.description}</p>
                        {badge.earned ? (
                          <span className="inline-block mt-2 text-xs text-theme-success font-medium">{t('achievements.badge_earned')}</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 mt-2 text-xs text-theme-subtle">
                            <Lock className="w-3 h-3" aria-hidden="true" /> {t('achievements.badge_locked')}
                          </span>
                        )}
                      </GlassCard>
                    ))}
                  </div>
                </>
              ) : (
                <GlassCard className="p-6">
                  <EmptyState
                    icon={<Award className="w-12 h-12" aria-hidden="true" />}
                    title={t('achievements.no_achievements')}
                    description={isOwnProfile ? t('achievements.no_achievements_own') : t('achievements.no_achievements_other')}
                    action={isOwnProfile && (
                      <Button as={Link} to={tenantPath('/achievements')} color="warning" className="text-white">
                        {t('achievements.view_badges')}
                      </Button>
                    )}
                  />
                </GlassCard>
              )}
            </div>
          )}
        </div>
      </motion.div>

      {/* Review Modal */}
      {profile && (
        <ReviewModal
          isOpen={isReviewModalOpen}
          onClose={() => setIsReviewModalOpen(false)}
          onSuccess={() => {
            setReviewsLoaded(false);
          }}
          receiverId={profile.id}
          receiverName={profile.name || ''}
          receiverAvatar={profile.avatar_url || ''}
        />
      )}

      {/* Transfer Credits Modal */}
      {profile && (
        <TransferModal
          isOpen={isTransferModalOpen}
          onClose={() => setIsTransferModalOpen(false)}
          currentBalance={currentBalance}
          onTransferComplete={() => {
            setIsTransferModalOpen(false);
            toast.success(t('credits_sent_success', { name: profile.name }));
          }}
          initialRecipientId={profile.id}
        />
      )}

      {/* Block User Confirmation Modal */}
      <Modal isOpen={isBlockConfirmOpen} onOpenChange={setIsBlockConfirmOpen} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">
                {t('block_modal_title', { name: profile?.name || profile?.first_name || t('member_fallback') })}
              </ModalHeader>
              <ModalBody>
                <p className="text-theme-muted text-sm">{t('block_modal_description')}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" className="bg-theme-elevated text-theme-primary" onPress={onClose}>
                  {t('block_cancel')}
                </Button>
                <Button
                  color="danger"
                  onPress={() => void handleBlock()}
                  isLoading={isBlocking}
                  startContent={<ShieldOff className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('block_confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Disconnect Confirmation Modal */}
      <Modal isOpen={isDisconnectConfirmOpen} onOpenChange={setIsDisconnectConfirmOpen} size="sm">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">
                {t('disconnect_confirm_title')}
              </ModalHeader>
              <ModalBody>
                <p className="text-theme-muted text-sm">
                  {t('disconnect_confirm_description', { name: profile?.name || profile?.first_name })}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" className="bg-theme-elevated text-theme-primary" onPress={onClose}>
                  {t('disconnect_cancel')}
                </Button>
                <Button
                  color="danger"
                  variant="flat"
                  onPress={() => void handleDisconnect()}
                  isLoading={isDisconnecting}
                >
                  {t('disconnect_confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Profile Stat Card
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileStatCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'emerald' | 'indigo' | 'purple' | 'amber' | 'rose';
}

const colorClasses: Record<string, string> = {
  emerald: 'from-emerald-500/20 to-teal-500/20 text-emerald-500',
  indigo: 'from-accent/20 to-blue-500/20 text-accent',
  purple: 'from-accent/20 to-fuchsia-500/20 text-accent',
  amber: 'from-amber-500/20 to-orange-500/20 text-[var(--color-warning)]',
  rose: 'from-rose-500/20 to-pink-500/20 text-rose-500',
};

function ProfileStatCard({ icon, label, value, color }: ProfileStatCardProps) {
  return (
    <GlassCard className="p-4 text-center hover:bg-theme-hover transition-colors">
      <div className={`inline-flex p-2 rounded-lg bg-gradient-to-br ${colorClasses[color]} mb-2`}>
        {icon}
      </div>
      <dt className="text-xs text-theme-subtle">{label}</dt>
      <dd className="text-xl font-bold text-theme-primary">{value}</dd>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Review Card
// ─────────────────────────────────────────────────────────────────────────────

interface ReviewCardProps {
  review: Review;
}

function ReviewCard({ review }: ReviewCardProps) {
  const { t } = useTranslation('profile');
  const { tenantPath } = useTenant();
  const reviewerName = review.reviewer
    ? `${review.reviewer.first_name} ${review.reviewer.last_name}`.trim()
    : t('anonymous');

  const nameContent = (
    <p className="font-medium text-theme-primary text-sm">{reviewerName}</p>
  );

  return (
    <GlassCard className="p-5">
      <div className="flex items-start gap-4">
        <Avatar
          src={resolveAvatarUrl(review.reviewer?.avatar)}
          name={reviewerName}
          size="sm"
          className="flex-shrink-0 ring-2 ring-theme-muted/20"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div>
              {review.reviewer?.id ? (
                <Link to={tenantPath(`/profile/${review.reviewer.id}`)} className="hover:underline">
                  {nameContent}
                </Link>
              ) : (
                nameContent
              )}
              {review.listing_title && (
                <p className="text-xs text-theme-subtle truncate">
                  {t('for_listing', { title: review.listing_title })}
                </p>
              )}
            </div>
            <time
              dateTime={review.created_at}
              className="text-xs text-theme-subtle flex-shrink-0"
            >
              {new Date(review.created_at).toLocaleDateString(getFormattingLocale(), {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </time>
          </div>

          {/* Star Rating */}
          <div className="flex items-center gap-0.5 mt-2" aria-label={t('aria.rating_summary', { rating: review.rating })}>
            {[1, 2, 3, 4, 5].map((star) => (
              <Star
                key={star}
                className={`w-4 h-4 ${
                  star <= review.rating
                    ? 'text-amber-400 fill-amber-400'
                    : 'text-theme-subtle'
                }`}
                aria-hidden="true"
              />
            ))}
          </div>

          {/* Comment */}
          {review.comment && (
            <p className="text-sm text-theme-muted mt-2 whitespace-pre-wrap">{review.comment}</p>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

export default ProfilePage;
