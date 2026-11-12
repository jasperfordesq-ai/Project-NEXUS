// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { FaceStack } from '@/components/ui/FaceStack';
import { kindTile } from '@/components/feed/feedTypeColours';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { NewMembersStrip } from './NewMembersStrip';
import { CommunityMonthHighlight } from './CommunityMonthHighlight';
import { CommunityHoursChart } from './CommunityHoursChart';
import { MembershipAnniversary } from './MembershipAnniversary';
import { CommunityMilestone } from './CommunityMilestone';
import { PhotoPrompt } from './PhotoPrompt';
import { Card, CardBody } from '@/components/ui/Card';
import { useGreeting } from '@/hooks/useGreeting';
import { GuardianConsentPrompt } from '@/components/safeguarding/GuardianConsentPrompt';
import { SupportActionPrompt } from '@/components/subaccounts/SupportActionPrompt';
import { LocationMissingPrompt, shouldShowLocationReminder } from '@/components/location/LocationMissingPrompt';
import { LevelProgress } from '@/components/ui/LevelProgress';
import { Skeleton } from '@/components/ui/Skeleton';
import { LatestBadge, type EarnedBadge } from './LatestBadge';
/**
 * Dashboard Page - Main user dashboard
 * Theme-aware styling for light and dark modes
 *
 * Layout: V2-style flat responsive grid (no sidebar)
 * Grid: 1 col → 2 col (md) → 4 col (lg) with intelligent card spanning
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Clock from 'lucide-react/icons/clock';
import ListTodo from 'lucide-react/icons/list-todo';
import MessageSquare from 'lucide-react/icons/message-square';
import Wallet from 'lucide-react/icons/wallet';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import Calendar from 'lucide-react/icons/calendar';
import Bell from 'lucide-react/icons/bell';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Activity from 'lucide-react/icons/activity';
import Sparkles from 'lucide-react/icons/sparkles';
import MapPin from 'lucide-react/icons/map-pin';
import Heart from 'lucide-react/icons/heart';
import MessageCircle from 'lucide-react/icons/message-circle';
import UserPlus from 'lucide-react/icons/user-plus';
import Award from 'lucide-react/icons/award';
import Flame from 'lucide-react/icons/flame';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant, useFeature, useModule, useNotifications } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { CommunityPhoto } from '@/components/branding/CommunityPhoto';
import { vivid } from '@/lib/vivid';
import { useSiteVivid } from '@/contexts/SiteAccentContext';
import { logError } from '@/lib/logger';
import { formatDayOfMonth, formatMonthShort, formatRelativeTime, resolveAvatarUrl } from '@/lib/helpers';
import type { WalletBalance, Listing, Event, Group } from '@/types/api';
import { CARING_COMMUNITY_ROUTE } from '@/pages/caring-community/config';

interface GamificationProfile {
  level: number;
  xp: number;
  /**
   * How far through the current level. The server sends an object
   * (GamificationV2Controller::profile); a bare number is still accepted.
   */
  level_progress?: {
    progress_percentage?: number;
    xp_for_current_level?: number;
    xp_for_next_level?: number;
  } | number | null;
  badges_count: number;
  /** The member's own sign-in streak in days (own profile only). */
  current_streak?: number;
  level_thresholds?: Record<number, number>;
}

interface FeedActivityItem {
  id: number;
  content: string;
  author: {
    id: number;
    name: string;
    avatar_url?: string;
  };
  created_at: string;
  type: 'post' | 'listing' | 'event' | 'poll' | 'goal' | 'blog' | 'discussion';
  likes_count: number;
  comments_count: number;
  is_liked: boolean;
}

/** Strip HTML tags for plain-text preview */
function stripHtml(html: string): string {
  if (!html) return '';
  return html.replace(/<[^>]*>/g, '').trim();
}

interface EndorsementEntry { skill: string; count: number; endorsers: Array<{ id: number; name: string | null; avatar_url: string | null }>; }

/** Normalized shape the "Suggested for You" card renders — built either from
 * a Smart Matching /v2/matches/all listing match or a plain Listing fallback. */
interface SuggestionCard {
  id: number;
  title: string;
  type: 'offer' | 'request';
  authorName: string;
  authorAvatar?: string | null;
  matchScore?: number;
  distanceKm?: number | null;
  isRemote?: boolean;
}

interface MatchApiItem {
  module: string;
  listing_id?: number;
  title: string;
  type?: 'offer' | 'request';
  user_name?: string;
  avatar_url?: string | null;
  match_score: number;
  distance_km?: number | null;
  is_remote?: boolean;
}

function suggestionFromMatch(match: MatchApiItem): SuggestionCard | null {
  if (match.listing_id == null) return null;
  return {
    id: match.listing_id,
    title: match.title,
    type: match.type ?? 'offer',
    authorName: match.user_name ?? '',
    authorAvatar: match.avatar_url,
    matchScore: match.match_score,
    distanceKm: match.distance_km,
    isRemote: match.is_remote,
  };
}

function suggestionFromListing(listing: Listing): SuggestionCard {
  return {
    id: listing.id,
    title: listing.title,
    type: listing.type,
    authorName: listing.author_name ?? listing.user?.name ?? '',
    authorAvatar: listing.author_avatar ?? listing.user?.avatar,
  };
}

interface DashboardStats {
  walletBalance: WalletBalance | null;
  recentListings: Listing[];
  activeListingsCount: number;
  gamification: GamificationProfile | null;
  /** The member's newest earned badge, or null when they have none. */
  latestBadge: EarnedBadge | null;
  recentActivity: FeedActivityItem[];
  suggestedListings: SuggestionCard[];
  myGroups: Group[];
  upcomingEvents: Event[];
  myEndorsements: EndorsementEntry[];
}

function normalizePercent(value: unknown): number {
  // The server's shape is { progress_percentage }. Reading the object itself
  // as a number gave NaN → 0%, so the bar was empty for every member.
  const raw = value !== null && typeof value === 'object'
    ? (value as { progress_percentage?: unknown }).progress_percentage
    : value;
  const percent = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(percent)) return 0;
  return Math.min(Math.max(percent, 0), 100);
}

/**
 * XP gained inside the current level, and the XP that level spans, from the
 * thresholds the server sends beside progress_percentage. Both 0 when they are
 * missing or the member is at the top level (next threshold = current), so the
 * level bar then shows only the percentage.
 */
function xpWithinLevel(xp: unknown, value: GamificationProfile['level_progress']): { current: number; required: number } {
  if (value === null || typeof value !== 'object') return { current: 0, required: 0 };
  const total = Number(xp);
  const from = Number(value.xp_for_current_level);
  const to = Number(value.xp_for_next_level);
  if (![total, from, to].every(Number.isFinite) || to <= from) return { current: 0, required: 0 };
  return { current: Math.max(0, total - from), required: to - from };
}

function formatActivityAction(item: FeedActivityItem, t: (key: string) => string): string {
  switch (item.type) {
    case 'listing': return t('activity.action_listing');
    case 'event': return t('activity.action_event');
    case 'poll': return t('activity.action_poll');
    case 'goal': return t('activity.action_goal');
    default: return t('activity.action_post');
  }
}

const iconContainerColors = {
  indigo: 'bg-accent/15 dark:bg-accent/20',
  purple: 'bg-accent/15 dark:bg-accent/20',
  amber: 'bg-amber-500/15 dark:bg-amber-500/20',
  teal: 'bg-teal-500/15 dark:bg-teal-500/20',
  rose: 'bg-rose-500/15 dark:bg-rose-500/20',
  emerald: 'bg-emerald-500/15 dark:bg-emerald-500/20',
} as const;

// The VIVID colour strength (warmth phase 5): the tile filled with its colour
// and the picture in it white. Each fill carries white at 4.5:1 — the
// community's button shade, or the lightest shade of the tile's hue that does
// (amber/teal/emerald -700, rose -600; palette-white-text.contract.test.ts).
const vividIconContainerColors: Record<keyof typeof iconContainerColors, string> = {
  indigo: 'bg-accent-strong [&>svg]:text-white!',
  purple: 'bg-accent-strong [&>svg]:text-white!',
  amber: 'bg-amber-700 [&>svg]:text-white!',
  teal: 'bg-teal-700 [&>svg]:text-white!',
  rose: 'bg-rose-600 [&>svg]:text-white!',
  emerald: 'bg-emerald-700 [&>svg]:text-white!',
};

function SectionIcon({ children, color }: { children: React.ReactNode; color: keyof typeof iconContainerColors }) {
  const isVivid = useSiteVivid();
  return (
    <div className={`w-8 h-8 rounded-lg ${(isVivid ? vividIconContainerColors : iconContainerColors)[color]} flex items-center justify-center shrink-0`}>
      {children}
    </div>
  );
}

function SectionHeader({ icon, iconColor, title, linkTo, linkText, linkAriaLabel }: {
  icon: React.ReactNode; iconColor: keyof typeof iconContainerColors; title: string; linkTo?: string; linkText?: string; linkAriaLabel?: string;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex min-w-0 items-center gap-2.5 text-base font-semibold text-theme-primary sm:text-lg">
        <SectionIcon color={iconColor}>{icon}</SectionIcon>
        <span className="truncate">{title}</span>
      </h2>
      {linkTo && linkText && (
        <Link to={linkTo} aria-label={linkAriaLabel ?? linkText} className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-1 py-1 text-sm text-[var(--color-primary)] transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">
          {linkText} <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

interface DashboardEmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description?: string;
  actionTo?: string;
  actionLabel?: string;
}

function DashboardEmptyState({ icon, title, description, actionTo, actionLabel }: DashboardEmptyStateProps) {
  return (
    <div className="flex min-h-36 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--glass-border)] bg-theme-elevated/60 px-4 py-8 text-center text-theme-subtle">
      {/* The icon in a soft circle in the community colour, like the site's other
          empty states (was faded grey). Callers pass h-10 w-10 icons. */}
      <div
        data-testid="dashboard-empty-icon"
        aria-hidden="true"
        className="mb-3 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-soft-foreground [&_svg]:size-6 [&_svg]:text-accent-soft-foreground!"
      >
        {icon}
      </div>
      <p className="text-sm font-medium text-theme-secondary">{title}</p>
      {description && <p className="mt-1 max-w-sm text-xs leading-5 text-theme-subtle">{description}</p>}
      {actionTo && actionLabel && (
        <Button
          as={Link}
          to={actionTo}
          size="sm"
          variant="tertiary"
          className="mt-4 bg-theme-hover text-theme-primary"
          endContent={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.08 } } };
const itemVariants = { hidden: { opacity: 0, y: 20 }, visible: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 100, damping: 15 } } };

export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  usePageTitle(t('meta.title'));
  const { user } = useAuth();
  const { branding, tenantPath } = useTenant();
  const greeting = useGreeting(user?.first_name || user?.name?.split(' ')[0]);
  const { counts: notificationCounts } = useNotifications();
  const hasGamification = useFeature('gamification');
  const hasEvents = useFeature('events');
  const hasGroups = useFeature('groups');
  const hasConnections = useFeature('connections');
  const hasExchangeWorkflow = useFeature('exchange_workflow');
  const hasCaringCommunity = useFeature(CARING_COMMUNITY_ROUTE.feature);
  const hasFeedModule = useModule('feed');
  const hasListingsModule = useModule('listings');
  const hasProfileModule = useModule('profile');
  const hasWalletModule = useModule('wallet');
  const hasNotificationsModule = useModule('notifications');
  const hasMessagesModule = useModule('messages');
  const hasVolunteering = useFeature('volunteering');

  const [stats, setStats] = useState<DashboardStats>({
    walletBalance: null, recentListings: [], activeListingsCount: 0,
    gamification: null, latestBadge: null, recentActivity: [], suggestedListings: [], myGroups: [],
    upcomingEvents: [], myEndorsements: [],
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [suggestedLoading, setSuggestedLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(true);

  // Stable ref for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const loadDashboardData = useCallback(async () => {
    try {
      setError(null); setIsLoading(true); setActivityLoading(true);
      setSuggestedLoading(true); setGroupsLoading(true); setEventsLoading(true);

      const coreRequests = [
        hasWalletModule ? api.get<WalletBalance>('/v2/wallet/balance').catch(() => null) : Promise.resolve(null),
        hasListingsModule ? api.get<Listing[]>('/v2/listings/mine?status=live&limit=5').catch(() => null) : Promise.resolve(null),
      ];

      const optionalRequests: Array<{ key: string; promise: Promise<unknown> }> = [];
      if (hasGamification) {
        optionalRequests.push({ key: 'gamification', promise: api.get<GamificationProfile>('/v2/gamification/profile').catch(() => null) });
        // The profile carries only the badges a member chose to showcase, so the
        // newest badge comes from their earned list — the same request the
        // achievements page makes. The server sends it newest first
        // (UserBadge::getForUser orders by awarded_at, descending).
        optionalRequests.push({ key: 'badges', promise: api.get<EarnedBadge[]>('/v2/gamification/badges').catch(() => null) });
      }
      if (hasFeedModule) optionalRequests.push({ key: 'activity', promise: api.get<FeedActivityItem[]>('/v2/feed?per_page=5').catch(() => null) });
      if (hasListingsModule) {
        optionalRequests.push({
          key: 'suggested',
          promise: api.get<{ matches?: MatchApiItem[] }>('/v2/matches/all?modules=listings&limit=4&min_score=40').catch(() => null),
        });
        optionalRequests.push({ key: 'suggestedFallback', promise: api.get<Listing[]>('/v2/listings?per_page=4').catch(() => null) });
      }
      if (hasGroups) optionalRequests.push({ key: 'groups', promise: api.get<Group[]>(`/v2/groups?user_id=${user?.id}&per_page=3`).catch(() => null) });
      if (hasProfileModule && user?.id) optionalRequests.push({ key: 'endorsements', promise: api.get(`/v2/members/${user.id}/endorsements`).catch(() => null) });
      if (hasEvents) optionalRequests.push({ key: 'events', promise: api.get<Event[]>('/v2/events?when=upcoming&per_page=3').catch(() => null) });

      const allPromises = [...coreRequests, ...optionalRequests.map((r) => r.promise)];
      const results = await Promise.allSettled(allPromises);

      const walletRes = results[0]?.status === 'fulfilled' ? results[0].value : null;
      const listingsRes = results[1]?.status === 'fulfilled' ? results[1].value : null;
      const walletData = walletRes as { success?: boolean; data?: WalletBalance } | null;
      // Same source as the "Live" tab on My listings, so the card's number
      // always matches what the member sees when they click it.
      const listingsData = listingsRes as { success?: boolean; data?: Listing[]; meta?: { counts?: { live?: number } } } | null;

      const optionalResults: Record<string, unknown> = {};
      optionalRequests.forEach((req, index) => {
        const result = results[coreRequests.length + index];
        optionalResults[req.key] = result?.status === 'fulfilled' ? result.value : null;
      });

      let gamificationData: GamificationProfile | null = null;
      if (optionalResults.gamification) { const gRes = optionalResults.gamification as { success?: boolean; data?: GamificationProfile }; if (gRes?.success && gRes.data) gamificationData = gRes.data; }
      let latestBadgeData: EarnedBadge | null = null;
      if (optionalResults.badges) { const bRes = optionalResults.badges as { success?: boolean; data?: EarnedBadge[] }; if (bRes?.success && Array.isArray(bRes.data) && bRes.data[0]?.badge_key) latestBadgeData = bRes.data[0]; }
      let activityData: FeedActivityItem[] = [];
      if (optionalResults.activity) { const aRes = optionalResults.activity as { success?: boolean; data?: FeedActivityItem[] }; if (aRes?.success && Array.isArray(aRes.data)) activityData = aRes.data; }
      let suggestedData: SuggestionCard[] = [];
      if (optionalResults.suggested) {
        const sRes = optionalResults.suggested as { success?: boolean; data?: { matches?: MatchApiItem[] } };
        if (sRes?.success && Array.isArray(sRes.data?.matches)) {
          suggestedData = sRes.data.matches
            .map(suggestionFromMatch)
            .filter((s): s is SuggestionCard => s != null);
        }
      }
      if (suggestedData.length === 0 && optionalResults.suggestedFallback) {
        const fRes = optionalResults.suggestedFallback as { success?: boolean; data?: Listing[] };
        if (fRes?.success && Array.isArray(fRes.data)) suggestedData = fRes.data.map(suggestionFromListing);
      }
      let groupsData: Group[] = [];
      if (optionalResults.groups) { const gRes = optionalResults.groups as { success?: boolean; data?: Group[] }; if (gRes?.success && Array.isArray(gRes.data)) groupsData = gRes.data; }
      let eventsData: Event[] = [];
      if (optionalResults.events) { const eRes = optionalResults.events as { success?: boolean; data?: Event[] }; if (eRes?.success && Array.isArray(eRes.data)) eventsData = eRes.data; }
      let endorsementsData: EndorsementEntry[] = [];
      if (optionalResults.endorsements) {
        const eRes = optionalResults.endorsements as { success?: boolean; data?: { endorsements?: Array<{ skill_name: string; count: number; endorsements?: Array<{ endorser_id: number; endorser_name?: string | null; endorser_avatar?: string | null }> }> } };
        if (eRes?.success && Array.isArray(eRes.data?.endorsements)) {
          // The newest three people who endorsed each skill — the same names and
          // photos the member's own profile endorsements already carry.
          endorsementsData = eRes.data.endorsements.map((e) => ({ skill: e.skill_name, count: Number(e.count) || 0, endorsers: (Array.isArray(e.endorsements) ? e.endorsements : []).slice(0, 3).map((r) => ({ id: r.endorser_id, name: r.endorser_name ?? null, avatar_url: r.endorser_avatar ?? null })) })).filter((e) => e.count > 0).sort((a, b) => b.count - a.count).slice(0, 6);
        }
      }

      const listingsCount = listingsData?.meta?.counts?.live ?? listingsData?.data?.length ?? 0;
      setStats({
        walletBalance: walletData?.success ? walletData.data ?? null : null,
        recentListings: listingsData?.success ? listingsData.data ?? [] : [],
        activeListingsCount: listingsCount,
        gamification: gamificationData, latestBadge: latestBadgeData, recentActivity: activityData, suggestedListings: suggestedData,
        myGroups: groupsData, upcomingEvents: eventsData, myEndorsements: endorsementsData,
      });
    } catch (err) {
      logError('Failed to load dashboard data', err);
      setError(tRef.current('unable_to_load'));
    } finally {
      setIsLoading(false); setActivityLoading(false); setSuggestedLoading(false);
      setGroupsLoading(false); setEventsLoading(false);
    }
  }, [hasEvents, hasFeedModule, hasGamification, hasGroups, hasListingsModule, hasProfileModule, hasWalletModule, user?.id]);

  useEffect(() => { loadDashboardData(); }, [loadDashboardData]);

  const levelProgress = normalizePercent(stats.gamification?.level_progress);
  const levelXp = xpWithinLevel(stats.gamification?.xp, stats.gamification?.level_progress);
  const currentStreak = Math.max(0, Math.floor(Number(stats.gamification?.current_streak) || 0));
  const walletBalanceValue = stats.walletBalance ? t('stats.hours_value', { value: stats.walletBalance.balance }) : '\u2014';

  if (error) {
    return (
      <>
        <PageMeta title={t('meta.title')} description={t('meta.description')} noIndex />
        <GlassCard className="mx-auto max-w-xl p-6 text-center sm:p-8" role="alert" aria-live="assertive">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h2>
          <p className="mb-5 text-sm leading-6 text-theme-muted">{error}</p>
          <Button className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white" startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />} onPress={() => loadDashboardData()}>{t('try_again')}</Button>
        </GlassCard>
      </>
    );
  }

  return (
    <>
      <PageMeta title={t('meta.title')} description={t('meta.description')} noIndex />
      <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6 min-w-0 max-w-full">
        {/*
          A guardian arrangement waiting for the member's answer. Renders nothing
          when there is none. Without this the only route to that decision was an
          email, or knowing to look several clicks deep in Settings.
        */}
        <motion.div variants={itemVariants}>
          <GuardianConsentPrompt />
        </motion.div>

        {/* A co-decide action a supporter prepared, waiting for this member's
            answer. Same discoverability reasoning as the guardian prompt
            above; renders nothing when nothing is pending. */}
        <motion.div variants={itemVariants}>
          <SupportActionPrompt />
        </motion.div>

        {/* Onboarding Banner */}
        {user && user.onboarding_completed === false && (
          <motion.div variants={itemVariants}>
            <GlassCard className="border-l-4 border-l-accent p-4 sm:p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <SectionIcon color="indigo"><Sparkles className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" /></SectionIcon>
                  <div className="min-w-0">
                    <p className="font-semibold text-theme-primary">{t('onboarding.banner_title')}</p>
                    <p className="mt-1 text-sm leading-5 text-theme-muted">{t('onboarding.banner_subtitle')}</p>
                  </div>
                </div>
                <Button as={Link} to={tenantPath('/onboarding')} size="sm" className="w-full bg-gradient-to-r from-accent-strong to-accent-strong-end text-white sm:w-auto" endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}>{t('onboarding.get_started')}</Button>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* "Where are you based?" — for a member with no town. Deliberately has no
            dismiss control: it stays until they add one (owner decision, 9 Oct 2026).
            Shown whether or not onboarding is finished; a member still in onboarding
            may see the banner above as well. */}
        {shouldShowLocationReminder(user) && (
          <motion.div variants={itemVariants}>
            <LocationMissingPrompt />
          </motion.div>
        )}

        {/* Welcome Header — a soft panel in the community colour with a
            greeting for the time of day, like the offers page (AWID: warmth). */}
        <motion.div variants={itemVariants}>
          <Card data-testid="dashboard-welcome" className={`relative overflow-hidden border-0 bg-accent-soft shadow-none ${vivid.panel}`}>
            {/* The same soft glow of the companion colour as every other page opening. */}
            <div aria-hidden="true" data-hero-glow="true" className={`hero-glow pointer-events-none absolute -right-16 -top-24 size-48 rounded-full blur-3xl sm:size-72 ${vivid.glow}`} />
            <CardBody className="relative flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6 lg:p-8">
              {/* The community's own photo, when it has one: above the greeting
                  on a phone, at the far end of the panel on wider screens. */}
              <CommunityPhoto
                data-testid="dashboard-welcome-photo"
                className="h-32 w-full rounded-2xl shadow-sm ring-1 ring-black/5 sm:order-last sm:h-28 sm:w-48 lg:w-64 dark:ring-white/10"
              />
              <div className="min-w-0 sm:flex-1">
                <h1 className={`text-2xl font-bold leading-tight tracking-tight text-theme-primary sm:text-3xl ${vivid.text}`}>{greeting}</h1>
                <p className={`mt-1 max-w-2xl text-sm leading-6 text-theme-secondary sm:text-base ${vivid.text}`}>{t('community_activity', { community: branding.name })}</p>
              </div>
              <div className={`flex shrink-0 gap-3 ${vivid.tray}`}>
                {hasListingsModule && <Button as={Link} to={tenantPath('/listings/create')} variant="primary" size="lg" className="w-full font-semibold sm:w-auto" startContent={<Plus className="w-4 h-4" aria-hidden="true" />}>{t('new_listing')}</Button>}
              </div>
            </CardBody>
          </Card>
        </motion.div>

        {/* The member's own joining anniversary; renders nothing on other days. */}
        <MembershipAnniversary />

        {/* A round number of hours shared by the whole community (seen once per
            milestone), and a nudge to add a profile photo for a member without
            one. Each renders nothing when it has nothing to say. */}
        <CommunityMilestone />
        <PhotoPrompt />

        {hasCaringCommunity && (
          <motion.div variants={itemVariants}>
            <GlassCard className="border-l-4 border-l-emerald-500 p-5 sm:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3">
                  <SectionIcon color="emerald">
                    <Heart className="w-4 h-4 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                  </SectionIcon>
                  <div>
                    <h2 className="text-lg font-semibold text-theme-primary">{t('caring_community.title')}</h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-theme-muted">
                      {t('caring_community.subtitle')}
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:min-w-[420px]">
                  <Button as={Link} to={tenantPath(CARING_COMMUNITY_ROUTE.href)} className="w-full justify-start bg-theme-elevated text-theme-primary" variant="tertiary" startContent={<Heart className="w-4 h-4" aria-hidden="true" />}>
                    {t('caring_community.actions.open_hub')}
                  </Button>
                  {hasListingsModule && <Button as={Link} to={tenantPath('/listings/create?type=request')} className="w-full justify-start bg-theme-elevated text-theme-primary" variant="tertiary" startContent={<ListTodo className="w-4 h-4" aria-hidden="true" />}>
                    {t('caring_community.actions.request_help')}
                  </Button>}
                  {hasVolunteering && <Button as={Link} to={tenantPath('/volunteering?tab=hours')} className="w-full justify-start bg-theme-elevated text-theme-primary" variant="tertiary" startContent={<Clock className="w-4 h-4" aria-hidden="true" />}>
                    {t('caring_community.actions.log_hours')}
                  </Button>}
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* Stats Grid */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 lg:gap-6">
          {hasWalletModule && <StatCard icon={<Wallet className="w-5 h-5" aria-hidden="true" />} label={t('stats.balance')} value={walletBalanceValue} color="indigo" href="/wallet" isLoading={isLoading} />}
          {hasListingsModule && <StatCard icon={<ListTodo className="w-5 h-5" aria-hidden="true" />} label={t('stats.active_listings')} value={stats.activeListingsCount.toString()} color="emerald" href="/listings/mine" isLoading={isLoading} />}
          {hasMessagesModule && <StatCard icon={<MessageSquare className="w-5 h-5" aria-hidden="true" />} label={t('stats.messages')} value={notificationCounts.messages.toString()} color="amber" href="/messages" isLoading={isLoading} />}
        </motion.div>

        {/* FLAT 2-COLUMN GRID — V2 layout (no sidebar) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 min-w-0">

          {/* This month in the community (span 2); renders nothing in a quiet month */}
          <CommunityMonthHighlight className="md:col-span-2" />
          <CommunityHoursChart className="md:col-span-2" />

          {/* New members to say hello to (span 2); renders nothing when nobody is new */}
          <NewMembersStrip className="md:col-span-2" />

          {/* Recent Listings (span 2) */}
          {hasListingsModule && <motion.div variants={itemVariants} className="md:col-span-2">
            <GlassCard className="h-full p-5 sm:p-6">
              <SectionHeader icon={<ListTodo className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />} iconColor="indigo" title={t('sections.my_listings')} linkTo={tenantPath('/listings/mine')} linkText={t('view_all')} linkAriaLabel={t('aria.view_my_listings')} />
              {isLoading ? (
                <div aria-label={t('aria.loading_listings')} role="status" aria-busy="true" className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (<Skeleton key={i} className="rounded-lg"><div className="h-16 rounded-lg bg-surface-tertiary" /></Skeleton>))}
                </div>
              ) : stats.recentListings.length > 0 ? (
                <div className="divide-y divide-[var(--glass-border)]">
                  {stats.recentListings.map((listing) => (
                    <article key={listing.id}>
                      <Link to={tenantPath(`/listings/${listing.id}`)} className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0 group" aria-label={`${listing.title} - ${listing.type === 'offer' ? t('listings.offering') : t('listings.requesting')}`}>
                        <div className="flex min-w-0 items-start gap-3">
                          <Avatar src={resolveAvatarUrl(listing.author_avatar ?? listing.user?.avatar)} name={listing.author_name ?? listing.user?.name ?? t('listings.user_fallback')} size="sm" className="shrink-0" />
                          <div className="min-w-0">
                            <h3 className="font-medium text-theme-primary truncate group-hover:text-[var(--color-primary)] transition-colors">{listing.title}</h3>
                            <p className="text-sm text-theme-muted line-clamp-1">{listing.description}</p>
                          </div>
                        </div>
                        <Chip size="sm" variant="soft" color={listing.type === 'offer' ? 'success' : 'warning'} className="shrink-0">{listing.type === 'offer' ? t('listings.offering') : t('listings.requesting')}</Chip>
                      </Link>
                    </article>
                  ))}
                </div>
              ) : (
                <DashboardEmptyState
                  icon={<ListTodo className="h-10 w-10" aria-hidden="true" />}
                  title={t('listings.empty')}
                  description={t('listings.empty_description')}
                  actionTo={tenantPath('/listings/create')}
                  actionLabel={t('listings.create_first')}
                />
              )}
            </GlassCard>
          </motion.div>}

          {/* Recent Activity Feed (span 2) */}
          {hasFeedModule && (
            <motion.div variants={itemVariants} className="md:col-span-2">
              <GlassCard className="h-full p-5 sm:p-6">
                <SectionHeader icon={<Activity className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />} iconColor="purple" title={t('sections.recent_activity')} linkTo={tenantPath('/feed')} linkText={t('view_all_caps')} linkAriaLabel={t('aria.view_all_activity')} />
                {activityLoading ? (
                  <div aria-label={t('aria.loading_activity')} role="status" aria-busy="true" className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-3">
                        <Skeleton className="rounded-full shrink-0"><div className="w-10 h-10 rounded-full bg-surface-tertiary" /></Skeleton>
                        <div className="flex-1 space-y-2">
                          <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-3/4" /></Skeleton>
                          <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/2" /></Skeleton>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : stats.recentActivity.length > 0 ? (
                  <div className="divide-y divide-[var(--glass-border)]">
                    {stats.recentActivity.map((item, idx) => (
                      <Link key={`${item.type}-${item.id}-${idx}`} to={tenantPath('/feed')} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 group">
                        <Avatar src={resolveAvatarUrl(item.author?.avatar_url)} name={item.author?.name} size="sm" className="shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-theme-primary"><span className="font-medium">{item.author?.name}</span>{' '}<span className="text-theme-muted">{formatActivityAction(item, (key) => t(key))}</span></p>
                          <p className="text-xs text-theme-subtle line-clamp-1">{stripHtml(item.content)}</p>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 text-theme-subtle text-xs">
                          {item.likes_count > 0 && (<span className="hidden sm:flex items-center gap-1"><Heart className="w-3 h-3" aria-hidden="true" />{item.likes_count}<span className="sr-only">{t('likes_count', { count: item.likes_count })}</span></span>)}
                          {item.comments_count > 0 && (<span className="hidden sm:flex items-center gap-1"><MessageCircle className="w-3 h-3" aria-hidden="true" />{item.comments_count}<span className="sr-only">{t('comments_count', { count: item.comments_count })}</span></span>)}
                          <span className="whitespace-nowrap">{formatRelativeTime(item.created_at)}</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <DashboardEmptyState
                    icon={<Activity className="h-10 w-10" aria-hidden="true" />}
                    title={t('activity.empty')}
                    description={t('activity.empty_description')}
                    actionTo={tenantPath('/feed')}
                    actionLabel={t('activity.check_feed')}
                  />
                )}
              </GlassCard>
            </motion.div>
          )}

          {/* Upcoming Events (span 2) */}
          {hasEvents && (
            <motion.div variants={itemVariants} className="md:col-span-2">
              <GlassCard className="relative h-full overflow-hidden p-5 sm:p-6">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-rose-500/10 via-transparent to-pink-500/10 pointer-events-none" />
                <div className="relative">
                  <SectionHeader icon={<Calendar className="w-4 h-4 text-rose-500 dark:text-rose-400" aria-hidden="true" />} iconColor="rose" title={t('sections.upcoming_events')} linkTo={tenantPath('/events')} linkText={t('view_all_caps')} linkAriaLabel={t('aria.view_all_events')} />
                  {eventsLoading ? (
                    <div aria-label={t('aria.loading_events')} role="status" aria-busy="true" className="space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="flex items-center gap-3"><Skeleton className="rounded-lg shrink-0"><div className="w-12 h-14 rounded-lg bg-surface-tertiary" /></Skeleton><div className="flex-1 space-y-2"><Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-3/4" /></Skeleton><Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/2" /></Skeleton></div></div>
                      ))}
                    </div>
                  ) : stats.upcomingEvents.length > 0 ? (
                    <div className="divide-y divide-[var(--glass-border)]">
                      {stats.upcomingEvents.map((event) => {
                        const eventDate = new Date(event.start_date);
                        const day = formatDayOfMonth(eventDate);
                        const month = formatMonthShort(eventDate, true);
                        return (
                          <Link key={event.id} to={tenantPath(`/events/${event.id}`)} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 group">
                            <div className="w-12 h-14 rounded-lg bg-gradient-to-br from-rose-500/20 to-pink-500/20 flex flex-col items-center justify-center shrink-0">
                              <span className="text-xs font-semibold text-theme-danger leading-none">{month}</span>
                              <span className="text-lg font-bold text-theme-primary leading-none mt-0.5">{day}</span>
                            </div>
                            <div className="min-w-0 flex-1">
                              <h3 className="text-sm font-medium text-theme-primary truncate group-hover:text-[var(--color-primary)] transition-colors">{event.title}</h3>
                              {event.location && (<p className="text-xs text-theme-subtle flex items-center gap-1 mt-0.5"><MapPin className="w-3 h-3 shrink-0" aria-hidden="true" /><span className="truncate">{event.location}</span></p>)}
                              {event.is_online && !event.location && (<p className="text-xs text-theme-subtle mt-0.5">{t('events.online_event')}</p>)}
                            </div>
                            {/* A few faces of members going, as on the events page
                                (warmth plan P10). The server sends only people the
                                directory would show this viewer. Decoration here. */}
                            <FaceStack people={event.going_preview ?? []} data-testid="dashboard-event-face" />
                          </Link>
                        );
                      })}
                    </div>
                  ) : (
                    <DashboardEmptyState
                      icon={<Calendar className="h-10 w-10" aria-hidden="true" />}
                      title={t('events.empty')}
                      description={t('events.empty_description')}
                      actionTo={tenantPath('/events')}
                      actionLabel={t('events.browse')}
                    />
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* My Groups (span 1) */}
          {hasGroups && (
            <motion.div variants={itemVariants} className="md:col-span-1">
              <GlassCard className="h-full p-5 sm:p-6">
                <SectionHeader icon={<Users className="w-4 h-4 text-teal-500 dark:text-teal-400" aria-hidden="true" />} iconColor="teal" title={t('sections.my_groups')} linkTo={tenantPath('/groups')} linkText={t('view_all_caps')} linkAriaLabel={t('aria.view_all_groups')} />
                {groupsLoading ? (
                  <div aria-label={t('aria.loading_groups')} role="status" aria-busy="true" className="space-y-3">
                    {Array.from({ length: 3 }).map((_, i) => (<div key={i} className="flex items-center gap-3"><Skeleton className="rounded-lg shrink-0"><div className="w-10 h-10 rounded-lg bg-surface-tertiary" /></Skeleton><div className="flex-1 space-y-2"><Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-2/3" /></Skeleton><Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/3" /></Skeleton></div></div>))}
                  </div>
                ) : stats.myGroups.length > 0 ? (
                  <div className="divide-y divide-[var(--glass-border)]">
                    {stats.myGroups.map((group) => (
                      <Link key={group.id} to={tenantPath(`/groups/${group.id}`)} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0 group">
                        {group.image_url ? (
                          <Avatar src={resolveAvatarUrl(group.image_url)} alt={group.image_alt?.trim() || undefined} name={group.name} size="sm" radius="sm" className="shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-teal-500/20 to-emerald-500/20 flex items-center justify-center shrink-0">
                            <span className="text-sm font-bold text-teal-600 dark:text-teal-400">{group.name.charAt(0).toUpperCase()}</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-medium text-theme-primary truncate">{group.name}</h3>
                          <p className="text-xs text-theme-subtle flex items-center gap-1"><UserPlus className="w-3 h-3" aria-hidden="true" />{t('groups.members_count', { count: group.member_count ?? group.members_count ?? 0 })}</p>
                        </div>
                        {/* A few of the group's members, as on the groups page. */}
                        <FaceStack people={group.recent_members ?? []} data-testid="dashboard-group-face" />
                      </Link>
                    ))}
                  </div>
                ) : (
                  <DashboardEmptyState
                    icon={<Users className="h-10 w-10" aria-hidden="true" />}
                    title={t('groups.empty')}
                    description={t('groups.empty_description')}
                    actionTo={tenantPath('/groups')}
                    actionLabel={t('groups.discover')}
                  />
                )}
              </GlassCard>
            </motion.div>
          )}

          {/* Gamification Preview (span 1) */}
          {hasGamification && (
            <motion.div variants={itemVariants} className="md:col-span-1">
              <GlassCard className="relative h-full overflow-hidden p-5 sm:p-6">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-amber-500/10 via-transparent to-orange-500/10 pointer-events-none" />
                <div className="relative">
                  <SectionHeader icon={<TrendingUp className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />} iconColor="amber" title={t('sections.your_progress')} linkTo={tenantPath('/achievements')} linkText={t('view_achievements')} linkAriaLabel={t('aria.view_achievements')} />
                  {isLoading ? (
                    <div aria-label={t('aria.loading_progress')} role="status" aria-busy="true" className="space-y-4">
                      <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-1/2" /></Skeleton>
                      <Skeleton className="rounded-full"><div className="h-2 rounded-full bg-surface-secondary" /></Skeleton>
                      <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-secondary w-1/3" /></Skeleton>
                    </div>
                  ) : stats.gamification ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-theme-primary flex items-center gap-1.5"><Award className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />{t('gamification.level', { level: stats.gamification.level })}</span>
                        <Chip size="sm" variant="soft" color="warning" className="text-xs">{t('gamification.xp_value', { count: stats.gamification.xp })}</Chip>
                      </div>
                      {/* The shared level bar. Its figure is the server's
                          progress_percentage; the XP line counts XP gained
                          inside this level. */}
                      <LevelProgress
                        compact
                        level={stats.gamification.level}
                        currentXP={levelXp.current}
                        requiredXP={levelXp.required}
                        percentage={levelProgress}
                      />
                      {/* The newest badge the member earned — only once they have one. */}
                      {stats.latestBadge && <LatestBadge badge={stats.latestBadge} />}
                      <div className="flex justify-center gap-2 pt-2">
                        <div className="text-center p-2 rounded-lg bg-theme-elevated w-full">
                          <div className="text-lg font-bold text-theme-primary">{stats.gamification.badges_count}</div>
                          <div className="text-xs text-theme-subtle">{t('gamification.badges')}</div>
                        </div>
                        {/* The member's own streak, once they have one: a
                            second figure beside the badges. */}
                        {currentStreak > 0 && (
                          <div data-testid="dashboard-streak" className="text-center p-2 rounded-lg bg-theme-elevated w-full">
                            <div className="flex items-center justify-center gap-1 text-lg font-bold text-theme-primary">
                              <Flame className="h-4 w-4 text-orange-500" aria-hidden="true" />
                              {t('gamification.streak_days', { count: currentStreak })}
                            </div>
                            <div className="text-xs text-theme-subtle">{t('gamification.streak')}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-sm text-theme-subtle text-center">{t('gamification.start_earning')}</p>
                      <Button as={Link} to={tenantPath('/achievements')} size="sm" variant="tertiary" className="w-full bg-theme-elevated text-theme-primary" endContent={<ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />}>{t('view_achievements')}</Button>
                    </div>
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Suggested Matches (span 2) */}
          {hasListingsModule && (
            <motion.div variants={itemVariants} className="md:col-span-2">
              <GlassCard className="relative h-full overflow-hidden p-5 sm:p-6">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-accent/10 via-transparent to-accent-gradient-end/10 pointer-events-none" />
                <div className="relative">
                  <SectionHeader icon={<Sparkles className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" />} iconColor="amber" title={t('sections.suggested_for_you')} linkTo={tenantPath('/matches')} linkText={t('suggestions.see_all_matches')} linkAriaLabel={t('aria.browse_all_listings')} />
                  {suggestedLoading ? (
                    <div aria-label={t('aria.loading_suggestions')} role="status" aria-busy="true" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {Array.from({ length: 4 }).map((_, i) => (<Skeleton key={i} className="rounded-lg"><div className="h-24 rounded-lg bg-surface-tertiary" /></Skeleton>))}
                    </div>
                  ) : stats.suggestedListings.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {stats.suggestedListings.map((listing) => (
                        <Link key={listing.id} to={tenantPath(`/listings/${listing.id}`)} className="block p-3 rounded-lg bg-theme-elevated hover:bg-theme-hover transition-colors group" aria-label={`${listing.title} - ${listing.type === 'offer' ? t('listings.offer') : t('listings.request')}`}>
                          <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <Avatar src={resolveAvatarUrl(listing.authorAvatar)} name={listing.authorName || t('listings.user_fallback')} size="sm" className="w-6 h-6" />
                            <Chip size="sm" variant="soft" color={listing.type === 'offer' ? 'success' : 'warning'} className="h-5 text-[10px]">{listing.type === 'offer' ? t('listings.offer') : t('listings.request')}</Chip>
                            {listing.matchScore != null && (
                              <Chip size="sm" variant="flat" className="h-5 text-[10px]">{t('suggestions.score_chip', { score: listing.matchScore })}</Chip>
                            )}
                            {listing.distanceKm != null && (
                              <Chip size="sm" variant="flat" className="h-5 text-[10px]">{t('suggestions.distance_chip', { value: listing.distanceKm.toFixed(1) })}</Chip>
                            )}
                          </div>
                          <h3 className="text-sm font-medium text-theme-primary line-clamp-2 group-hover:text-[var(--color-primary)] transition-colors">{listing.title}</h3>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <DashboardEmptyState
                      icon={<Sparkles className="h-10 w-10" aria-hidden="true" />}
                      title={t('suggestions.empty')}
                      description={t('suggestions.empty_description')}
                      actionTo={tenantPath('/listings')}
                      actionLabel={t('browse_all')}
                    />
                  )}
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Endorsements (span 1) */}
          {(isLoading || stats.myEndorsements.length > 0) && (
            <motion.div variants={itemVariants} className="md:col-span-1">
              <GlassCard className="h-full p-5 sm:p-6">
                <SectionHeader icon={<ThumbsUp className="w-4 h-4 text-accent dark:text-accent" aria-hidden="true" />} iconColor="indigo" title={t('sections.endorsements')} linkTo={tenantPath(`/profile/${user?.id}`)} linkText={t('view_all')} linkAriaLabel={t('aria.view_all_endorsements')} />
                {isLoading ? (
                  <div aria-label={t('aria.loading_endorsements')} role="status" aria-busy="true" className="space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => (<div key={i} className="flex items-center justify-between p-2"><Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-2/3" /></Skeleton><Skeleton className="rounded-full"><div className="h-5 w-8 rounded-full bg-surface-tertiary" /></Skeleton></div>))}
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--glass-border)]">
                    {stats.myEndorsements.map(({ skill, count, endorsers }) => (
                      <div key={skill} className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0">
                        <span className="text-sm text-theme-primary truncate">{skill}</span>
                        <span className="flex items-center gap-2 ml-2 shrink-0">
                          {/* A few faces of the people who endorsed this skill. Decoration: the count beside them carries the meaning. */}
                          <FaceStack people={endorsers} max={3} data-testid="dashboard-endorser-face" />
                          <span className="flex items-center gap-1 text-xs font-semibold text-accent dark:text-accent"><ThumbsUp className="w-3 h-3" aria-hidden="true" />{count}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </GlassCard>
            </motion.div>
          )}

          {/* Exchanges needing your attention (span 1) */}
          {hasExchangeWorkflow && (
            <motion.div variants={itemVariants} className="md:col-span-1">
              <ExchangesAttentionCard />
            </motion.div>
          )}

          {/* Quick Actions (full width) */}
          <motion.div variants={itemVariants} className="md:col-span-2">
            <GlassCard className="p-5 sm:p-6">
              <SectionHeader icon={<Sparkles className="w-4 h-4 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />} iconColor="emerald" title={t('sections.quick_actions')} />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))] gap-3">
                {hasListingsModule && <QuickActionLink kind="listing" to={tenantPath('/listings/create')} icon={<Plus aria-hidden="true" />} label={t('quick_actions.create_listing')} />}
                {hasMessagesModule && <QuickActionLink kind="message" to={tenantPath('/messages')} icon={<MessageSquare aria-hidden="true" />} label={t('quick_actions.messages')} />}
                {hasWalletModule && <QuickActionLink kind="exchange" to={tenantPath('/wallet')} icon={<Wallet aria-hidden="true" />} label={t('quick_actions.view_wallet')} />}
                {hasConnections && <QuickActionLink kind="member" to={tenantPath('/members')} icon={<Users aria-hidden="true" />} label={t('quick_actions.find_members')} />}
                {hasEvents && (<QuickActionLink kind="event" to={tenantPath('/events')} icon={<Calendar aria-hidden="true" />} label={t('quick_actions.browse_events')} />)}
                {hasCaringCommunity && <QuickActionLink to={tenantPath(CARING_COMMUNITY_ROUTE.href)} icon={<Heart aria-hidden="true" />} label={t('quick_actions.caring_community')} />}
                {hasNotificationsModule && <QuickActionLink to={tenantPath('/notifications')} icon={<Bell aria-hidden="true" />} label={t('quick_actions.notifications')} />}
              </div>
            </GlassCard>
          </motion.div>
        </div>
      </motion.div>
    </>
  );
}

// Sub-components

interface StatCardProps {
  icon: React.ReactNode; label: string; value: string;
  color: 'indigo' | 'emerald' | 'amber' | 'rose'; href: string; isLoading?: boolean;
}

const colorClasses = {
  indigo: 'bg-accent/10 text-accent-soft-foreground dark:bg-accent/15',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-500/10 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  rose: 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
};

function StatCard({ icon, label, value, color, href, isLoading }: StatCardProps) {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('dashboard');
  return (
    // The icon sits in a coloured circle beside the number. (It was an
    // inline-flex box that the card's column layout stretched into a wide,
    // empty colour bar.)
    <Link to={tenantPath(href)} aria-label={`${label}: ${isLoading ? t('common.loading') : value}`} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface-base)]">
      <GlassCard hoverable className="p-4 focus-within:ring-2 focus-within:ring-accent/40 sm:p-5">
        <div className="flex items-center gap-4">
          <div data-testid="stat-icon" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${colorClasses[color]}`}>{icon}</div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-theme-secondary">{label}</div>
            {isLoading ? (<Skeleton className="mt-1 rounded-lg"><div className="h-8 w-16 rounded-lg bg-surface-tertiary" /></Skeleton>) : (<div className="truncate text-3xl font-bold leading-tight text-theme-primary">{value}</div>)}
          </div>
        </div>
      </GlassCard>
    </Link>
  );
}

interface QuickActionLinkProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  /**
   * The kind of thing the shortcut leads to (offer, event, member…): its icon
   * then sits on that kind's colour, the same one the feed, search and
   * notifications use for it (warmth plan P18). Left out, the icon is plain.
   */
  kind?: string;
}

function QuickActionLink({ to, icon, label, kind }: QuickActionLinkProps) {
  const isVivid = useSiteVivid();
  return (
    <Button
      as={Link}
      to={to}
      fullWidth
      variant="secondary"
      className="min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border border-border bg-surface-secondary px-3 py-3 text-center text-foreground shadow-none transition-colors data-[hover=true]:border-accent data-[hover=true]:bg-surface-tertiary"
    >
      {kind ? (
        <span
          data-testid="quick-action-tile"
          className={`flex size-10 items-center justify-center rounded-full [&>svg]:h-5 [&>svg]:w-5 ${kindTile(kind, isVivid)}`}
        >
          {icon}
        </span>
      ) : (
        <span className="text-accent [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      )}
      <span className="max-w-full whitespace-normal break-words text-center text-xs font-semibold leading-snug">{label}</span>
    </Button>
  );
}

// Exchanges Needing Attention Card
//
// Driven by the exchange WORKFLOW (GET /v2/exchanges/needs-attention-count →
// ExchangeService::countNeedingAttention), NOT raw wallet transactions: a request
// to accept, a completion to confirm, or a completed exchange to review. Stays
// empty unless a genuine exchange is waiting on the member.

interface AttentionExchange {
  id: number;
  status: string;
  action: 'accept' | 'confirm' | 'review' | 'active' | 'view';
  listing_title?: string | null;
  counterparty_name: string;
  counterparty_avatar?: string | null;
}

function ExchangesAttentionCard() {
  const { tenantPath } = useTenant();
  const { t } = useTranslation('dashboard');
  const [items, setItems] = useState<AttentionExchange[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAttention = async () => {
      try {
        const response = await api.get<{ count: number; items: AttentionExchange[] }>('/v2/exchanges/needs-attention-count');
        const data = response.data;
        setCount(typeof data?.count === 'number' ? data.count : 0);
        setItems(Array.isArray(data?.items) ? data.items.slice(0, 3) : []);
      } catch (error) {
        logError('Failed to fetch exchanges needing attention', { error });
      } finally { setLoading(false); }
    };
    fetchAttention();
  }, []);

  const header = (
    <div className="flex items-center gap-2.5 mb-4">
      <SectionIcon color="amber"><Clock className="w-4 h-4 text-[var(--color-warning)]" aria-hidden="true" /></SectionIcon>
      <h2 className="text-lg font-semibold text-theme-primary">{t('sections.exchanges_attention')}</h2>
      {count > 0 && <Chip size="sm" color="warning" variant="soft" className="ml-auto">{count}</Chip>}
    </div>
  );

  if (loading) {
    return (
      <GlassCard className="h-full p-5 sm:p-6">
        {header}
        <div aria-label={t('aria.loading_exchanges_attention')} role="status" aria-busy="true" className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (<Skeleton key={i} className="rounded-lg"><div className="h-16 rounded-lg bg-surface-tertiary" /></Skeleton>))}
        </div>
      </GlassCard>
    );
  }

  if (count === 0) {
    return (
      <GlassCard className="h-full p-5 sm:p-6">
        {header}
        <DashboardEmptyState
          icon={<Clock className="h-10 w-10" aria-hidden="true" />}
          title={t('exchanges_attention.none')}
          description={t('exchanges_attention.none_description')}
        />
      </GlassCard>
    );
  }

  return (
    <GlassCard className="h-full p-5 sm:p-6">
      {header}
      <div className="divide-y divide-[var(--glass-border)]">
        {items.map((item) => (
          <Link key={item.id} to={tenantPath(`/exchanges/${item.id}`)} className="block py-3 first:pt-0 last:pb-0 group">
            <div className="flex items-center gap-3 mt-1">
              <Avatar src={resolveAvatarUrl(item.counterparty_avatar) ?? undefined} name={item.counterparty_name} size="sm" className="w-7 h-7 shrink-0" />
              <div className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-theme-primary group-hover:text-[var(--color-primary)] transition-colors line-clamp-1">{item.counterparty_name}</span>
                {item.listing_title && <p className="text-xs text-theme-subtle line-clamp-1">{item.listing_title}</p>}
              </div>
              <Chip size="sm" color="warning" variant="soft" className="shrink-0">{t(`exchanges_attention.action.${item.action}`)}</Chip>
            </div>
          </Link>
        ))}
      </div>
      <Link to={tenantPath('/exchanges')} className="mt-4 block rounded-lg py-1 text-center text-sm text-[var(--color-primary)] transition-opacity hover:opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" aria-label={t('aria.view_exchanges_attention')}>
        {t('exchanges_attention.view_all')} <ArrowRight className="w-3.5 h-3.5 inline-block ml-1" aria-hidden="true" />
      </Link>
    </GlassCard>
  );
}

export default DashboardPage;
