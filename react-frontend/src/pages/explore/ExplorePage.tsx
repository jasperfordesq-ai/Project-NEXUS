// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { OverlayActionButton } from '@/components/ui/OverlayActionButton';
import { Progress } from '@/components/ui/Progress';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, Tab } from '@/components/ui/Tabs';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Clock from 'lucide-react/icons/clock';
import ListTodo from 'lucide-react/icons/list-todo';
import Eye from 'lucide-react/icons/eye';
import Bookmark from 'lucide-react/icons/bookmark';
import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import Crown from 'lucide-react/icons/crown';
import Trophy from 'lucide-react/icons/trophy';
import Hash from 'lucide-react/icons/hash';
import UserPlus from 'lucide-react/icons/user-plus';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Heart from 'lucide-react/icons/heart';
import MessageSquare from 'lucide-react/icons/message-square';
import TrendingUp from 'lucide-react/icons/trending-up';
import AlertCircle from 'lucide-react/icons/circle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Navigation from 'lucide-react/icons/navigation';
import BookOpen from 'lucide-react/icons/book-open';
import HandHeart from 'lucide-react/icons/hand-heart';
import Building2 from 'lucide-react/icons/building-2';
import BarChart3 from 'lucide-react/icons/chart-column';
import Wrench from 'lucide-react/icons/wrench';
import FolderOpen from 'lucide-react/icons/folder-open';
import Briefcase from 'lucide-react/icons/briefcase';
import X from 'lucide-react/icons/x';
import History from 'lucide-react/icons/history';
import Trash2 from 'lucide-react/icons/trash-2';
import { motion } from '@/lib/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { PageMeta } from '@/components/seo/PageMeta';
import { useApi } from '@/hooks/useApi';
import { useTenant, useAuth } from '@/contexts';
import { canCreateEvents } from '@/lib/access';
import { resolveAvatarUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import apiClient from '@/lib/api';
import { ExploreSection, ExploreStatCard, HorizontalScroll } from '@/components/explore';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TrendingPost {
  id: number;
  user_id: number;
  excerpt: string;
  image_url: string | null;
  created_at: string;
  author_name: string;
  author_avatar: string | null;
  likes_count: number;
  comments_count: number;
  engagement: number;
}
interface PopularListing {
  id: number;
  title: string;
  type: string;
  image_url: string | null;
  location: string | null;
  estimated_hours: number | null;
  created_at: string;
  view_count: number;
  save_count: number;
  category_name: string;
  category_slug: string;
  category_color: string | null;
  author_name: string;
  author_avatar: string | null;
}

interface ActiveGroup {
  id: number;
  name: string;
  description: string | null;
  image_url: string | null;
  privacy: string;
  member_count: number;
  created_at: string;
}

interface UpcomingEvent {
  id: number;
  title: string;
  description: string | null;
  image_url: string | null;
  start_at: string;
  end_at: string | null;
  location: string | null;
  is_online: boolean;
  max_attendees: number | null;
  rsvp_count: number;
}

interface TopContributor {
  id: number;
  name: string;
  avatar: string | null;
  xp: number;
  level: number;
  tagline: string | null;
}

interface TrendingHashtag {
  id: number;
  tag: string;
  post_count: number;
  last_used_at: string | null;
}

interface NewMember {
  id: number;
  name: string;
  avatar: string | null;
  tagline: string | null;
  created_at: string;
}

interface FeaturedChallenge {
  id: number;
  title: string;
  description: string | null;
  status: string;
  start_date: string | null;
  end_date: string | null;
  idea_count: number;
}

interface RecommendedListing {
  id: number;
  title: string;
  type: string;
  image_url: string | null;
  location: string | null;
  category_name: string;
  category_slug: string;
  author_name: string;
  author_avatar: string | null;
  match_reason: string | null;
  match_score: number | null;
  distance_km: number | null;
}

interface NearYouListing {
  id: number;
  title: string;
  type: string;
  image_url: string | null;
  location: string | null;
  category_name: string;
  category_slug: string;
  author_name: string;
  author_avatar: string | null;
  distance_km: number;
}

interface SuggestedConnection {
  id: number;
  name: string;
  avatar: string | null;
  tagline: string | null;
  reason: string | null;
}

interface BlogPost {
  id: number;
  title: string;
  slug: string;
  excerpt: string | null;
  image_url: string | null;
  published_at: string;
  reading_time: number;
  view_count: number;
  author_name: string;
  author_avatar: string | null;
}

interface VolunteeringOpportunity {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  skills_needed: string | null;
  org_name: string;
  org_logo: string | null;
  application_count: number;
  created_at: string;
}

interface Organisation {
  id: number;
  name: string;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  opportunity_count: number;
}

interface ActivePoll {
  id: number;
  question: string;
  description: string | null;
  author_name: string;
  option_count: number;
  vote_count: number;
  closes_at: string | null;
  created_at: string;
}

interface InDemandSkill {
  skill_name: string;
  request_count: number;
  offer_count: number;
}

interface FeaturedResource {
  id: number;
  title: string;
  description: string | null;
  resource_type: string | null;
  url: string | null;
  view_count: number;
  category_name: string;
}

interface JobVacancy {
  id: number;
  title: string;
  description: string | null;
  location: string | null;
  org_name: string;
  application_count: number;
  deadline: string | null;
  created_at: string;
}

interface CommunityStats {
  total_members: number;
  exchanges_this_month: number;
  hours_exchanged: number;
  active_listings: number;
}

interface ExploreData {
  trending_posts: TrendingPost[];
  popular_listings: PopularListing[];
  active_groups: ActiveGroup[];
  upcoming_events: UpcomingEvent[];
  top_contributors: TopContributor[];
  trending_hashtags: TrendingHashtag[];
  new_members: NewMember[];
  featured_challenges: FeaturedChallenge[];
  community_stats: CommunityStats;
  recommended_listings: RecommendedListing[];
  // Phase 1+2 — new sections
  near_you_listings: NearYouListing[];
  suggested_connections: SuggestedConnection[];
  trending_blog_posts: BlogPost[];
  volunteering_opportunities: VolunteeringOpportunity[];
  active_organisations: Organisation[];
  active_polls: ActivePoll[];
  in_demand_skills: InDemandSkill[];
  featured_resources: FeaturedResource[];
  latest_jobs: JobVacancy[];
  categories?: Array<{ id: number; name: string; slug: string; color?: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recently Viewed helpers (localStorage)
// ─────────────────────────────────────────────────────────────────────────────

interface RecentlyViewedItem {
  id: string;
  type: string;
  title: string;
  image_url: string | null;
  url: string;
}

const RECENTLY_VIEWED_KEY = 'nexus:recently_viewed';
const MAX_RECENTLY_VIEWED = 10;

function getRecentlyViewed(): RecentlyViewedItem[] {
  try {
    const raw = localStorage.getItem(RECENTLY_VIEWED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_RECENTLY_VIEWED);
  } catch {
    return [];
  }
}

function clearRecentlyViewed(): void {
  try {
    localStorage.removeItem(RECENTLY_VIEWED_KEY);
  } catch {
    // Ignore storage errors
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab definitions
// ─────────────────────────────────────────────────────────────────────────────

const VALID_TABS = ['all', 'for_you', 'listings', 'people', 'events', 'groups'] as const;
type ExploreTab = (typeof VALID_TABS)[number];

function isValidTab(value: string | null): value is ExploreTab {
  return value != null && (VALID_TABS as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// For You feed item (from /v2/explore/for-you)
// ─────────────────────────────────────────────────────────────────────────────

interface ForYouItem {
  content_type: 'listing' | 'post' | 'event' | 'group' | 'member' | 'blog';
  id: number;
  title: string;
  subtitle: string | null;
  image_url: string | null;
  meta: string | null;
  url: string;
  score: number;
  created_at: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state component
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ icon: Icon, message, cta, onAction }: {
  icon: React.ElementType;
  message: string;
  cta?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-[var(--surface-elevated)] flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-[var(--text-subtle)]" aria-hidden="true" />
      </div>
      <p className="text-sm text-[var(--text-muted)] max-w-xs">{message}</p>
      {cta && onAction && (
        <Button size="sm" variant="secondary" className="mt-3" onPress={onAction}>
          {cta}
        </Button>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

// Format a date to a short readable format
const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(getFormattingLocale(), { month: 'short', day: 'numeric' });
};

const formatDateTime = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(getFormattingLocale(), {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const getChallengeProgress = (startDate: string, endDate: string) => {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 100;
  }

  const elapsedRatio = ((now - start) / (end - start)) * 100;
  return Math.min(100, Math.max(5, elapsedRatio));
};

export default function ExplorePage() {
  // 'gamification' is listed because the Top Contributors strip renders
  // gamification:achievements.xp_value. Cross-namespace keys only resolve when
  // the namespace is loaded, otherwise the raw key is shown to the user.
  const { t } = useTranslation(['explore', 'gamification']);
  usePageTitle(t('page_title'));

  const navigate = useNavigate();
  const { tenantPath, hasFeature } = useTenant();
  const { isAuthenticated, user } = useAuth();
  const hasConnections = hasFeature('connections');
  const hasEvents = hasFeature('events');
  const mayCreateEvent = isAuthenticated && canCreateEvents(user);
  const hasGroups = hasFeature('groups');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Tab navigation (persisted in URL ?tab=...) ──────────────────────────
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab');
  const requestedTab: ExploreTab = isValidTab(tabFromUrl) ? tabFromUrl : 'all';
  const activeTab: ExploreTab =
    (!hasConnections && requestedTab === 'people') ||
    (!hasEvents && requestedTab === 'events') ||
    (!hasGroups && requestedTab === 'groups')
      ? 'all'
      : requestedTab;

  const handleTabChange = useCallback((key: React.Key) => {
    const newTab = String(key) as ExploreTab;
    setSearchParams((prev: URLSearchParams) => {
      const next = new URLSearchParams(prev);
      if (newTab === 'all') {
        next.delete('tab');
      } else {
        next.set('tab', newTab);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // ── Recently viewed items (localStorage) ─────────────────────────────────
  const [recentlyViewed, setRecentlyViewed] = useState<RecentlyViewedItem[]>([]);

  useEffect(() => {
    setRecentlyViewed(getRecentlyViewed());
  }, []);

  const handleClearRecentlyViewed = useCallback(() => {
    clearRecentlyViewed();
    setRecentlyViewed([]);
  }, []);

  // Helper to check if a section should show for the current tab
  const showSection = useCallback((...tabs: ExploreTab[]) => {
    return activeTab === 'all' || tabs.includes(activeTab);
  }, [activeTab]);

  const { data, isLoading, error, execute: retry } = useApi<ExploreData>('/v2/explore');

  // Fetch categories for quick-filter chips (fallback — also included in explore response now)
  const { data: categories } = useApi<Array<{ id: number; name: string; slug: string; color?: string }>>(
    '/v2/categories?type=listing'
  );
  // Prefer categories from explore response (Phase 5 — eliminates 2nd API call)
  const effectiveCategories: Array<{ id: number; name: string; slug: string; color?: string }> | null | undefined = data?.categories ?? categories;

  // ── For You infinite scroll feed ──────────────────────────────────────────
  const [forYouItems, setForYouItems] = useState<ForYouItem[]>([]);
  const [forYouPage, setForYouPage] = useState(1);
  const [forYouLoading, setForYouLoading] = useState(false);
  const [forYouHasMore, setForYouHasMore] = useState(true);
  const forYouSentinelRef = useRef<HTMLDivElement>(null);

  // Fetch For You feed when tab is active
  const loadForYouPage = useCallback(async (page: number, reset = false) => {
    if (forYouLoading) return;
    setForYouLoading(true);
    try {
      const res = await apiClient.get<{ items: ForYouItem[]; total: number }>(`/v2/explore/for-you?page=${page}&per_page=15`);
      const result = res.data ?? { items: [], total: 0 };
      const items: ForYouItem[] = result.items ?? [];
      setForYouItems(prev => reset ? items : [...prev, ...items]);
      setForYouHasMore(items.length > 0 && (reset ? items.length : forYouItems.length + items.length) < (result.total ?? 0));
      setForYouPage(page);
    } catch {
      // Non-critical
    } finally {
      setForYouLoading(false);
    }
  }, [forYouLoading, forYouItems.length]);

  // Load first page when switching to For You tab
  useEffect(() => {
    if (activeTab === 'for_you' && forYouItems.length === 0 && !forYouLoading) {
      loadForYouPage(1, true);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps -- reset when tab changes; loadForYouPage excluded to avoid loop

  // Infinite scroll via IntersectionObserver
  useEffect(() => {
    if (activeTab !== 'for_you' || !forYouHasMore || forYouLoading) return;
    const sentinel = forYouSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && forYouHasMore && !forYouLoading) {
          loadForYouPage(forYouPage + 1);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, forYouPage, forYouHasMore, forYouLoading, loadForYouPage]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      navigate(tenantPath(`/search?q=${encodeURIComponent(searchQuery.trim())}`));
    }
  };

  // Track explore interactions for recommendation learning
  const trackInteraction = useCallback((itemType: string, itemId: number, action: string) => {
    if (!isAuthenticated) return;
    apiClient.post('/v2/explore/track', { item_type: itemType, item_id: itemId, action }).catch(() => {});
  }, [isAuthenticated]);

  // Dismiss a recommended item
  const [dismissedIds, setDismissedIds] = useState<Set<number>>(new Set());
  const handleDismiss = useCallback((itemType: string, itemId: number, reason?: string) => {
    setDismissedIds(prev => new Set(prev).add(itemId));
    apiClient.post('/v2/explore/dismiss', { item_type: itemType, item_id: itemId, reason }).catch(() => {});
  }, []);

  const stats = data?.community_stats;

  // Memoize time-ago for trending posts
  const timeAgo = useCallback((dateStr: string) => {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    if (diffHours < 1) return t('time_ago.just_now');
    if (diffHours < 24) return t('time_ago.hours_ago', { count: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return t('time_ago.days_ago', { count: diffDays });
    return formatDate(dateStr);
  }, [t]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      <PageMeta title={t('page_title')} description={t('page_description')} />

      {/* ─── Hero Search Bar ──────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="text-center mb-8"
      >
        <h1 className="text-3xl sm:text-4xl font-bold text-[var(--text-primary)] mb-2">
          {t('heading')}
        </h1>
        <p className="text-[var(--text-muted)] mb-6 max-w-xl mx-auto">
          {t('subtitle')}
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSearch(); }}
          className="max-w-2xl mx-auto mb-4 flex gap-2"
        >
          <SearchField
            size="lg"
            variant="secondary"
            placeholder={t('search_placeholder')}
            aria-label={t('search_placeholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            onSubmit={() => handleSearch()}
            className="flex-1"
            classNames={{
              inputWrapper: 'bg-[var(--glass-bg)] border-[var(--glass-border)] backdrop-blur-md',
            }}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="shrink-0"
            aria-label={t('search_placeholder')}
          >
            <Search className="w-5 h-5" aria-hidden="true" />
          </Button>
        </form>

        {/* Category quick-filter chips */}
        {effectiveCategories && effectiveCategories.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {effectiveCategories.slice(0, 8).map((cat) => (
              <Button
                key={cat.id}
                variant="flat"
                size="sm"
                className="cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                onPress={() => navigate(tenantPath(`/listings?category=${cat.slug}`))}
              >
                {cat.name}
              </Button>
            ))}
          </div>
        )}
      </motion.div>

      {/* ─── Tab Navigation ──────────────────────────────────────────────── */}
      <div className="flex justify-center mb-8">
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={handleTabChange}
          variant="underlined"
          classNames={{
            base: 'w-full max-w-full sm:w-auto',
            tabList: 'w-max max-w-full gap-1 sm:gap-2 justify-start sm:justify-center border-b border-border',
            tab: 'min-h-10 px-4 sm:px-5 text-sm sm:text-base',
            cursor: 'bg-accent',
            tabContent: 'group-data-[selected=true]:text-accent',
          }}
          aria-label={t('aria.content_tabs')}
        >
          <Tab key="all" title={t('tabs.all')} />
          <Tab key="for_you" title={t('tabs.for_you')} />
          <Tab key="listings" title={t('tabs.listings')} />
          {hasConnections && <Tab key="people" title={t('tabs.people')} />}
          {hasEvents && <Tab key="events" title={t('tabs.events')} />}
          {hasGroups && <Tab key="groups" title={t('tabs.groups')} />}
        </Tabs>
      </div>

      {/* ─── API Error Banner ─────────────────────────────────────────────── */}
      {error && !isLoading && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-danger" role="alert">
          <AlertCircle className="w-5 h-5 shrink-0" aria-hidden="true" />
          <span className="text-sm flex-1">{t('error_loading')}</span>
          <Button size="sm" variant="danger-soft" onPress={() => retry()} startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}>
            {t('retry')}
          </Button>
        </div>
      )}

      {/* ─── aria-live region for screen readers ─────────────────────────── */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {isLoading ? t('loading') : data ? t('sections_loaded') : ''}
      </div>

      {/* ─── For You Infinite Scroll Feed ──────────────────────────────────── */}
      {activeTab === 'for_you' && (
        <div className="mb-10">
          {forYouItems.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {forYouItems.map((item, idx) => (
                <Link
                  key={`${item.content_type}-${item.id}-${idx}`}
                  to={tenantPath(item.url)}
                  onClick={() => trackInteraction(item.content_type, item.id, 'click')}
                >
                  <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                    <CardBody className="p-4 gap-3">
                      <div className="flex items-center gap-2">
                        <Chip size="sm" variant="soft" className="text-xs capitalize">
                          {item.content_type}
                        </Chip>
                        {item.meta && (
                          <span className="text-xs text-[var(--text-muted)] truncate">{item.meta}</span>
                        )}
                      </div>
                      {item.image_url && (
                        <img
                          {...responsiveThumbnailProps(item.image_url, {
                            width: 420,
                            height: 240,
                            sizes: '(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 92vw',
                          })}
                          alt={item.title}
                          className="w-full h-32 object-cover rounded-lg"
                          loading="lazy"
                        />
                      )}
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                        {item.title}
                      </h3>
                      {item.subtitle && (
                        <p className="text-xs text-[var(--text-muted)] truncate">{item.subtitle}</p>
                      )}
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          ) : !forYouLoading ? (
            <EmptyState
              icon={TrendingUp}
              message={t('for_you_empty')}
              cta={t('tabs.all')}
              onAction={() => handleTabChange('all')}
            />
          ) : null}

          {/* Loading indicator */}
          {forYouLoading && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardBody className="p-4 gap-3">
                    <Skeleton className="w-16 h-5 rounded" />
                    <Skeleton className="w-full h-32 rounded-lg" />
                    <Skeleton className="w-3/4 h-5 rounded" />
                    <Skeleton className="w-1/2 h-4 rounded" />
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          {/* Infinite scroll sentinel */}
          {forYouHasMore && <div ref={forYouSentinelRef} className="h-4" />}

          {/* End of feed */}
          {!forYouHasMore && forYouItems.length > 0 && (
            <p className="text-center text-sm text-[var(--text-muted)] mt-6">
              {t('end_of_feed')}
            </p>
          )}
        </div>
      )}

      {/* ─── Community Stats Banner (All tab only) ────────────────────────── */}
      {activeTab === 'all' && <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="mb-10"
      >
        <Card
          className="border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)]"
        >
          <CardBody className="p-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[var(--border-default)]">
              {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex flex-col items-center gap-2 p-5">
                    <Skeleton className="w-10 h-10 rounded-xl" />
                    <Skeleton className="w-16 h-7 rounded" />
                    <Skeleton className="w-20 h-4 rounded" />
                  </div>
                ))
              ) : (
                <>
                  <ExploreStatCard icon={Users} label={t('stats.members')} value={stats?.total_members ?? 0} />
                  <ExploreStatCard icon={ArrowRightLeft} label={t('stats.exchanges_this_month')} value={stats?.exchanges_this_month ?? 0} />
                  <ExploreStatCard icon={Clock} label={t('stats.hours_exchanged')} value={stats?.hours_exchanged ?? 0} suffix="h" />
                  <ExploreStatCard icon={ListTodo} label={t('stats.active_listings')} value={stats?.active_listings ?? 0} />
                </>
              )}
            </div>
          </CardBody>
        </Card>
      </motion.div>}

      {/* ─── Trending Posts ────────────────────────────────────────────────── */}
      {showSection('all') && (isLoading || (data?.trending_posts && data.trending_posts.length > 0)) && (
        <ExploreSection
          title={t('trending_posts.title')}
          subtitle={t('trending_posts.subtitle')}
          seeAllLink={tenantPath('/feed')}
        >
          {isLoading ? (
            <div className="flex gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="min-w-[280px] snap-start">
                  <CardBody className="p-4 gap-3">
                    <div className="flex items-center gap-2">
                      <Skeleton className="w-8 h-8 rounded-full" />
                      <Skeleton className="w-24 h-4 rounded" />
                    </div>
                    <Skeleton className="w-full h-12 rounded" />
                    <Skeleton className="w-20 h-4 rounded" />
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : (
            <HorizontalScroll>
              {data!.trending_posts.map((post) => (
                <Link
                  key={post.id}
                  to={tenantPath(`/feed/posts/${post.id}`)}
                  className="min-w-[280px] max-w-[320px] snap-start shrink-0"
                >
                  <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                    <CardBody className="p-4 gap-3">
                      <div className="flex items-center gap-2">
                        <Avatar
                          src={resolveAvatarUrl(post.author_avatar)}
                          size="sm"
                          name={post.author_name}
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {post.author_name}
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {timeAgo(post.created_at)}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-[var(--text-secondary)] line-clamp-3">
                        {post.excerpt?.replace(/<[^>]*>/g, '') || ''}
                      </p>
                      <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <Heart className="w-3.5 h-3.5" aria-hidden="true" />
                          {post.likes_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                          {post.comments_count}
                        </span>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </HorizontalScroll>
          )}
        </ExploreSection>
      )}

      {/* ─── Popular Listings Grid ────────────────────────────────────────── */}
      {showSection('all', 'listings') && (isLoading || (data?.popular_listings && data.popular_listings.length > 0)) && (
        <ExploreSection
          title={t('popular_listings.title')}
          subtitle={t('popular_listings.subtitle')}
          seeAllLink={tenantPath('/listings?sort=popular')}
        >
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}>
                  <CardBody className="p-4 gap-3">
                    <Skeleton className="w-full h-32 rounded-lg" />
                    <Skeleton className="w-3/4 h-5 rounded" />
                    <Skeleton className="w-1/2 h-4 rounded" />
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {data!.popular_listings.map((listing) => (
                <Link key={listing.id} to={tenantPath(`/listings/${listing.id}`)}>
                  <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                    <CardBody className="p-4 gap-3">
                      {listing.image_url ? (
                        <img
                          {...responsiveThumbnailProps(listing.image_url, {
                            width: 420,
                            height: 240,
                            sizes: '(min-width: 1024px) 23vw, (min-width: 640px) 45vw, 92vw',
                          })}
                          alt={listing.title}
                          className="w-full h-32 object-cover rounded-lg"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-32 rounded-lg bg-gradient-to-br from-[var(--surface-elevated)] to-[var(--glass-bg)] flex flex-col items-center justify-center gap-1.5">
                          {listing.type === 'offer' ? (
                            <HandHeart className="w-7 h-7 text-accent opacity-40" aria-hidden="true" />
                          ) : (
                            <Search className="w-7 h-7 text-accent opacity-40" aria-hidden="true" />
                          )}
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-subtle)]">
                            {listing.type}
                          </span>
                        </div>
                      )}
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {listing.category_name && (
                            <Chip
                              size="sm"
                              variant="soft"
                              className="text-xs"
                            >
                              {listing.category_name}
                            </Chip>
                          )}
                          <Chip size="sm" variant="soft" className="text-xs capitalize">
                            {listing.type}
                          </Chip>
                        </div>
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                          {listing.title}
                        </h3>
                      </div>
                      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                          {listing.view_count}
                        </span>
                        <span className="flex items-center gap-1">
                          <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />
                          {listing.save_count}
                        </span>
                        {listing.location && (
                          <span className="flex items-center gap-1 truncate max-w-[80px]">
                            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{listing.location}</span>
                          </span>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </ExploreSection>
      )}

      {/* ─── Upcoming Events ──────────────────────────────────────────────── */}
      {showSection('all', 'events') && hasFeature('events') && (isLoading || (data?.upcoming_events && data.upcoming_events.length > 0)) && (
        <ExploreSection
          title={t('upcoming_events.title')}
          subtitle={t('upcoming_events.subtitle')}
          seeAllLink={tenantPath('/events')}
        >
          {isLoading ? (
            <div className="flex gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="min-w-[260px]">
                  <CardBody className="p-4 gap-3">
                    <Skeleton className="w-full h-28 rounded-lg" />
                    <Skeleton className="w-3/4 h-5 rounded" />
                    <Skeleton className="w-1/2 h-4 rounded" />
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : (
            <HorizontalScroll>
              {data!.upcoming_events.map((event) => (
                <Link
                  key={event.id}
                  to={tenantPath(`/events/${event.id}`)}
                  className="min-w-[260px] max-w-[300px] snap-start shrink-0"
                >
                  <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                    <CardBody className="p-4 gap-3">
                      {event.image_url ? (
                        <img
                          {...responsiveThumbnailProps(event.image_url, {
                            width: 420,
                            height: 240,
                            sizes: '(min-width: 1024px) 300px, 80vw',
                          })}
                          alt={event.title}
                          className="w-full h-28 object-cover rounded-lg"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-28 rounded-lg bg-accent-soft flex items-center justify-center">
                          <Calendar className="w-8 h-8 text-accent" aria-hidden="true" />
                        </div>
                      )}
                      <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                        {event.title}
                      </h3>
                      <div className="flex flex-col gap-1 text-xs text-[var(--text-muted)]">
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                          {formatDateTime(event.start_at)}
                        </span>
                        {event.location && (
                          <span className="flex items-center gap-1 truncate">
                            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span className="truncate">{event.is_online ? t('upcoming_events.online') : event.location}</span>
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" aria-hidden="true" />
                          {t('upcoming_events.attending', { count: event.rsvp_count })}
                          {event.max_attendees && ` / ${event.max_attendees}`}
                        </span>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </HorizontalScroll>
          )}
        </ExploreSection>
      )}

      {/* ─── Active Groups ────────────────────────────────────────────────── */}
      {showSection('all', 'groups') && hasFeature('groups') && (isLoading || (data?.active_groups && data.active_groups.length > 0)) && (
        <ExploreSection
          title={t('active_groups.title')}
          subtitle={t('active_groups.subtitle')}
          seeAllLink={tenantPath('/groups')}
        >
          {isLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Card key={i}>
                  <CardBody className="p-4 gap-3">
                    <Skeleton className="w-12 h-12 rounded-full" />
                    <Skeleton className="w-3/4 h-5 rounded" />
                    <Skeleton className="w-full h-8 rounded" />
                  </CardBody>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {data!.active_groups.map((group) => (
                <Link key={group.id} to={tenantPath(`/groups/${group.id}`)}>
                  <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                    <CardBody className="p-4 gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={group.image_url ? resolveAvatarUrl(group.image_url) : undefined}
                          name={group.name}
                          size="md"
                          className="shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] truncate">
                            {group.name}
                          </h3>
                          <p className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                            <Users className="w-3 h-3" aria-hidden="true" />
                            {t('active_groups.members', { count: group.member_count })}
                          </p>
                        </div>
                      </div>
                      {group.description && (
                        <p className="text-xs text-[var(--text-secondary)] line-clamp-2">
                          {group.description}
                        </p>
                      )}
                      {/* Visual CTA only — the whole card is already a <Link>, so this
                          must not be an interactive <button> nested inside the anchor. */}
                      <span
                        aria-hidden="true"
                        className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)]"
                      >
                        {t('active_groups.view_group')}
                      </span>
                    </CardBody>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </ExploreSection>
      )}

      {/* ─── Top Contributors ─────────────────────────────────────────────── */}
      {showSection('all', 'people') && hasFeature('gamification') && (isLoading || (data?.top_contributors && data.top_contributors.length > 0)) && (
        <ExploreSection
          title={t('top_contributors.title')}
          subtitle={t('top_contributors.subtitle')}
          seeAllLink={tenantPath('/leaderboard')}
        >
          {isLoading ? (
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2 min-w-[100px]">
                  <Skeleton className="w-16 h-16 rounded-full" />
                  <Skeleton className="w-16 h-4 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <HorizontalScroll>
              {data!.top_contributors.map((user, index) => (
                <Link
                  key={user.id}
                  to={tenantPath(`/profile/${user.id}`)}
                  className="flex flex-col items-center gap-2 min-w-[110px] snap-start shrink-0 p-2 rounded-xl hover:bg-[var(--surface-hover)] transition-colors"
                >
                  <div className="relative">
                    <Avatar
                      src={resolveAvatarUrl(user.avatar)}
                      name={user.name}
                      size="lg"
                      className="w-16 h-16"
                    />
                    {index === 0 && (
                      <Crown className="w-5 h-5 text-amber-400 absolute -top-1.5 -right-1.5 drop-shadow" aria-hidden="true" />
                    )}
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2">
                      <Chip size="sm" variant="solid" color="primary" className="text-[10px] px-1.5 h-5 min-h-5">
                        {t('top_contributors.level', { level: user.level })}
                      </Chip>
                    </div>
                  </div>
                  <span className="text-xs font-medium text-[var(--text-primary)] text-center truncate max-w-[100px]">
                    {user.name}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-0.5">
                    <Trophy className="w-3 h-3" aria-hidden="true" />
                    {t('gamification:achievements.xp_value', { xp: user.xp.toLocaleString(getFormattingLocale()) })}
                  </span>
                </Link>
              ))}
            </HorizontalScroll>
          )}
        </ExploreSection>
      )}

      {/* ─── Trending Hashtags ────────────────────────────────────────────── */}
      {showSection('all') && (isLoading || (data?.trending_hashtags && data.trending_hashtags.length > 0)) && (
        <ExploreSection
          title={t('trending_hashtags.title')}
          subtitle={t('trending_hashtags.subtitle')}
          seeAllLink={tenantPath('/feed/hashtags')}
        >
          {isLoading ? (
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="w-24 h-8 rounded-full" />
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data!.trending_hashtags.map((hashtag) => (
                <Link key={hashtag.id} to={tenantPath(`/feed/hashtag/${hashtag.tag}`)}>
                  <Chip
                    variant="soft"
                    size="md"
                    startContent={<Hash className="w-3.5 h-3.5" aria-hidden="true" />}
                    className="cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                  >
                    {hashtag.tag}
                    <span className="ml-1 text-[var(--text-muted)] text-xs">
                      ({hashtag.post_count})
                    </span>
                  </Chip>
                </Link>
              ))}
            </div>
          )}
        </ExploreSection>
      )}

      {/* ─── Recommended For You ──────────────────────────────────────────── */}
      {showSection('all', 'for_you', 'listings') && isAuthenticated && data?.recommended_listings && data.recommended_listings.length > 0 && (
        <ExploreSection
          title={t('recommended.title')}
          subtitle={t('recommended.subtitle')}
          seeAllLink={tenantPath('/matches')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.recommended_listings
              .filter((l) => !dismissedIds.has(l.id))
              .slice(0, 6)
              .map((listing) => (
              <div key={listing.id} className="relative group">
                <Link
                  to={tenantPath(`/listings/${listing.id}`)}
                  onClick={() => trackInteraction('listing', listing.id, 'click')}
                >
                  <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                    <CardBody className="p-4 gap-3">
                      <div className="flex items-center gap-2">
                        {listing.match_reason && (
                          <Chip size="sm" variant="soft" color="secondary" className="text-xs">
                            <TrendingUp className="w-3 h-3" aria-hidden="true" />
                            {listing.match_reason}
                          </Chip>
                        )}
                        {listing.match_score != null && listing.match_score > 0 && (
                          <Chip size="sm" variant="solid" color="primary" className="text-xs ml-auto">
                            {t('match_score', { score: Math.round(listing.match_score) })}
                          </Chip>
                        )}
                      </div>
                      <div className="flex items-start gap-3">
                        <Avatar
                          src={resolveAvatarUrl(listing.author_avatar)}
                          name={listing.author_name}
                          size="sm"
                          className="shrink-0 mt-0.5"
                        />
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                            {listing.title}
                          </h3>
                          <p className="text-xs text-[var(--text-muted)]">
                            {t('recommended.by_author', { name: listing.author_name })}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {listing.category_name && (
                              <Chip size="sm" variant="soft" className="text-[10px]">
                                {listing.category_name}
                              </Chip>
                            )}
                            {listing.distance_km != null && (
                              <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-0.5">
                                <Navigation className="w-2.5 h-2.5" aria-hidden="true" />
                                {t('near_you.distance', { distance: listing.distance_km })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                </Link>
                {/* Dismiss button */}
                <OverlayActionButton
                  variant="tertiary"
                  radius="full"
                  className="absolute -top-2 -right-2 rounded-full bg-[var(--surface-elevated)] shadow-sm transition-opacity [--button-bg-hover:var(--surface-hover)]"
                  onPress={() => handleDismiss('listing', listing.id, 'not_relevant')}
                  aria-label={t('dismiss')}
                >
                  <X className="size-4 text-[var(--text-muted)]" aria-hidden="true" />
                </OverlayActionButton>
              </div>
            ))}
          </div>
        </ExploreSection>
      )}

      {/* ─── Near You (Phase 1) ──────────────────────────────────────────── */}
      {showSection('all', 'for_you') && isAuthenticated && data?.near_you_listings && data.near_you_listings.length > 0 && (
        <ExploreSection
          title={t('near_you.title')}
          subtitle={t('near_you.subtitle')}
          seeAllLink={tenantPath('/listings?sort=nearby')}
        >
          <HorizontalScroll>
            {data.near_you_listings.map((listing) => (
              <Link
                key={listing.id}
                to={tenantPath(`/listings/${listing.id}`)}
                className="min-w-[260px] max-w-[300px] snap-start shrink-0"
                onClick={() => trackInteraction('listing', listing.id, 'click')}
              >
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    <div className="flex items-center gap-2 text-xs text-accent font-medium">
                      <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('near_you.distance', { distance: listing.distance_km })}
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                      {listing.title}
                    </h3>
                    <div className="flex items-center gap-2">
                      <Avatar
                        src={resolveAvatarUrl(listing.author_avatar)}
                        name={listing.author_name}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="text-xs text-[var(--text-muted)] truncate">{listing.author_name}</span>
                    </div>
                    {listing.category_name && (
                      <Chip size="sm" variant="soft" className="text-xs">{listing.category_name}</Chip>
                    )}
                  </CardBody>
                </Card>
              </Link>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── Suggested Connections (Phase 1) ────────────────────────────── */}
      {showSection('all', 'people') && hasConnections && isAuthenticated && data?.suggested_connections && data.suggested_connections.length > 0 && (
        <ExploreSection
          title={t('suggested_connections.title')}
          subtitle={t('suggested_connections.subtitle')}
          seeAllLink={tenantPath('/members')}
        >
          <HorizontalScroll>
            {data.suggested_connections.map((member) => (
              <div
                key={member.id}
                className="flex flex-col items-center gap-2 min-w-[130px] snap-start shrink-0 p-3"
              >
                <Link to={tenantPath(`/profile/${member.id}`)}>
                  <Avatar
                    src={resolveAvatarUrl(member.avatar)}
                    name={member.name}
                    size="lg"
                    className="w-16 h-16"
                  />
                </Link>
                <Link
                  to={tenantPath(`/profile/${member.id}`)}
                  className="text-xs font-medium text-[var(--text-primary)] text-center truncate max-w-[120px] hover:underline"
                >
                  {member.name}
                </Link>
                {member.reason && (
                  <span className="text-[10px] text-accent text-center">
                    {member.reason === 'Recommended for you' ? t('suggested_connections.recommended')
                      : member.reason === 'Similar interests' ? t('suggested_connections.similar')
                      : t('suggested_connections.mutual')}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  className="text-xs h-7 px-3"
                  startContent={<UserPlus className="w-3 h-3" aria-hidden="true" />}
                  onPress={() => navigate(tenantPath(`/messages/new/${member.id}`))}
                >
                  {t('suggested_connections.connect')}
                </Button>
              </div>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── Blog Posts (Phase 2) ──────────────────────────────────────── */}
      {showSection('all') && hasFeature('blog') && data?.trending_blog_posts && data.trending_blog_posts.length > 0 && (
        <ExploreSection
          title={t('blog_posts.title')}
          subtitle={t('blog_posts.subtitle')}
          seeAllLink={tenantPath('/blog')}
        >
          <HorizontalScroll>
            {data.trending_blog_posts.map((post) => (
              <Link
                key={post.id}
                to={tenantPath(`/blog/${post.slug}`)}
                className="min-w-[280px] max-w-[320px] snap-start shrink-0"
              >
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    {post.image_url ? (
                      <img
                        {...responsiveThumbnailProps(post.image_url, {
                          width: 420,
                          height: 240,
                          sizes: '(min-width: 1024px) 320px, 82vw',
                        })}
                        alt={post.title}
                        className="w-full h-28 object-cover rounded-lg"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-28 rounded-lg bg-accent-soft flex items-center justify-center">
                        <BookOpen className="w-8 h-8 text-accent" aria-hidden="true" />
                      </div>
                    )}
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                      {post.title}
                    </h3>
                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('blog_posts.read_time', { count: post.reading_time || 3 })}
                      </span>
                      <span className="flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                        {t('blog_posts.views', { count: post.view_count })}
                      </span>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── Volunteering Opportunities (Phase 2) ──────────────────────── */}
      {showSection('all') && hasFeature('volunteering') && data?.volunteering_opportunities && data.volunteering_opportunities.length > 0 && (
        <ExploreSection
          title={t('volunteering.title')}
          subtitle={t('volunteering.subtitle')}
          seeAllLink={tenantPath('/volunteering')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.volunteering_opportunities.map((opp) => (
              <Link key={opp.id} to={tenantPath(`/volunteering/opportunities/${opp.id}`)}>
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[var(--color-success)]/10 shrink-0">
                        <HandHeart className="w-5 h-5 text-[var(--color-success)]" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">
                          {opp.title}
                        </h3>
                        {opp.org_name && (
                          <p className="text-xs text-[var(--text-muted)]">{opp.org_name}</p>
                        )}
                        {opp.description && (
                          <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mt-1">
                            {opp.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
                          {opp.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" aria-hidden="true" />
                              <span className="truncate max-w-[100px]">{opp.location}</span>
                            </span>
                          )}
                          <span className="flex items-center gap-1">
                            <Users className="w-3 h-3" aria-hidden="true" />
                            {t('volunteering.applications', { count: opp.application_count })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </ExploreSection>
      )}

      {/* ─── Active Polls (Phase 2) ────────────────────────────────────── */}
      {showSection('all') && hasFeature('polls') && data?.active_polls && data.active_polls.length > 0 && (
        <ExploreSection
          title={t('polls.title')}
          subtitle={t('polls.subtitle')}
          seeAllLink={tenantPath('/polls')}
        >
          <HorizontalScroll>
            {data.active_polls.map((poll) => (
              <Link
                key={poll.id}
                to={tenantPath(`/polls/${poll.id}`)}
                className="min-w-[260px] max-w-[300px] snap-start shrink-0"
              >
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-accent" aria-hidden="true" />
                      <span className="text-xs text-[var(--text-muted)]">
                        {t('polls.options', { count: poll.option_count })}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                      {poll.question}
                    </h3>
                    <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                      <span>{t('polls.votes', { count: poll.vote_count })}</span>
                      {poll.closes_at && (
                        <span>{t('polls.closes', { date: formatDate(poll.closes_at) })}</span>
                      )}
                    </div>
                    {/* Visual CTA only — the whole card is already a <Link>, so this
                        must not be an interactive <button> nested inside the anchor. */}
                    <span
                      aria-hidden="true"
                      className="inline-flex w-full items-center justify-center rounded-lg border border-[var(--border-default)] bg-[var(--surface-elevated)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)]"
                    >
                      {t('polls.vote_now')}
                    </span>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── Skills In Demand (Phase 2) ────────────────────────────────── */}
      {showSection('all') && data?.in_demand_skills && data.in_demand_skills.length > 0 && (
        <ExploreSection
          title={t('in_demand_skills.title')}
          subtitle={t('in_demand_skills.subtitle')}
          seeAllLink={tenantPath('/skills')}
        >
          <div className="flex flex-wrap gap-2">
            {data.in_demand_skills.map((skill) => (
              <Button
                key={skill.skill_name}
                variant="flat"
                size="sm"
                startContent={<Wrench className="w-3.5 h-3.5" aria-hidden="true" />}
                className="cursor-pointer hover:bg-[var(--surface-hover)] transition-colors"
                onPress={() => navigate(tenantPath(`/search?q=${encodeURIComponent(skill.skill_name)}`))}
              >
                {skill.skill_name}
                <span className="ml-1 text-[var(--text-muted)] text-xs">
                  ({t('in_demand_skills.requested', { count: skill.request_count })})
                </span>
              </Button>
            ))}
          </div>
        </ExploreSection>
      )}

      {/* ─── Organisations (Phase 2) ───────────────────────────────────── */}
      {showSection('all') && hasFeature('volunteering') && data?.active_organisations && data.active_organisations.length > 0 && (
        <ExploreSection
          title={t('organisations.title')}
          subtitle={t('organisations.subtitle')}
          seeAllLink={tenantPath('/organisations')}
        >
          <HorizontalScroll>
            {data.active_organisations.map((org) => (
              <Link
                key={org.id}
                to={tenantPath(`/organisations/${org.id}`)}
                className="min-w-[220px] max-w-[260px] snap-start shrink-0"
              >
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3 items-center text-center">
                    <Avatar
                      src={org.logo_url ? resolveAvatarUrl(org.logo_url) : undefined}
                      name={org.name}
                      size="lg"
                      className="w-14 h-14"
                      fallback={<Building2 className="w-6 h-6" aria-hidden="true" />}
                    />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">
                      {org.name}
                    </h3>
                    {org.description && (
                      <p className="text-xs text-[var(--text-secondary)] line-clamp-2">{org.description}</p>
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('organisations.opportunities', { count: org.opportunity_count })}
                    </span>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── Job Opportunities (Phase 2) ───────────────────────────────── */}
      {showSection('all') && hasFeature('job_vacancies') && data?.latest_jobs && data.latest_jobs.length > 0 && (
        <ExploreSection
          title={t('jobs.title')}
          subtitle={t('jobs.subtitle')}
          seeAllLink={tenantPath('/jobs')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.latest_jobs.map((job) => (
              <Link key={job.id} to={tenantPath(`/jobs/${job.id}`)}>
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-2">
                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent-soft shrink-0">
                        <Briefcase className="w-5 h-5 text-accent" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">
                          {job.title}
                        </h3>
                        {job.org_name && (
                          <p className="text-xs text-[var(--text-muted)]">{job.org_name}</p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                          {job.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" aria-hidden="true" />
                              <span className="truncate max-w-[80px]">{job.location}</span>
                            </span>
                          )}
                          {job.deadline && (
                            <span>{t('jobs.deadline', { date: formatDate(job.deadline) })}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </ExploreSection>
      )}

      {/* ─── Featured Resources (Phase 2) ──────────────────────────────── */}
      {showSection('all') && hasFeature('resources') && data?.featured_resources && data.featured_resources.length > 0 && (
        <ExploreSection
          title={t('resources.title')}
          subtitle={t('resources.subtitle')}
          seeAllLink={tenantPath('/resources')}
        >
          <HorizontalScroll>
            {data.featured_resources.map((resource) => (
              <Link
                key={resource.id}
                to={tenantPath('/resources')}
                className="min-w-[220px] max-w-[260px] snap-start shrink-0"
              >
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    <FolderOpen className="w-6 h-6 text-accent" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                      {resource.title}
                    </h3>
                    {resource.category_name && (
                      <Chip size="sm" variant="soft" className="text-xs">{resource.category_name}</Chip>
                    )}
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('resources.views', { count: resource.view_count })}
                    </span>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── Recently Viewed (localStorage, client-side) ─────────────────── */}
      {showSection('all', 'for_you') && recentlyViewed.length > 0 && (
        <ExploreSection
          title={t('recently_viewed.title')}
          subtitle={t('recently_viewed.subtitle')}
        >
          <div className="flex items-center justify-end mb-2 -mt-2">
            <Button
              size="sm"
              variant="danger-soft"
              startContent={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
              onPress={handleClearRecentlyViewed}
            >
              {t('recently_viewed.clear')}
            </Button>
          </div>
          <HorizontalScroll>
            {recentlyViewed.map((item) => (
              <Link
                key={`${item.type}-${item.id}`}
                to={item.url}
                className="min-w-[200px] max-w-[240px] snap-start shrink-0"
              >
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    {item.image_url ? (
                      <img
                        {...responsiveThumbnailProps(item.image_url, {
                          width: 360,
                          height: 200,
                          sizes: '(min-width: 1024px) 240px, 70vw',
                        })}
                        alt={item.title}
                        className="w-full h-24 object-cover rounded-lg"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-24 rounded-lg bg-[var(--surface-elevated)] flex items-center justify-center">
                        <History className="w-6 h-6 text-[var(--text-subtle)]" aria-hidden="true" />
                      </div>
                    )}
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-2">
                      {item.title}
                    </h3>
                    <Chip size="sm" variant="soft" className="text-xs capitalize">
                      {item.type}
                    </Chip>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </HorizontalScroll>
        </ExploreSection>
      )}

      {/* ─── New Members ──────────────────────────────────────────────────── */}
      {showSection('all', 'people') && hasConnections && (isLoading || (data?.new_members && data.new_members.length > 0)) && (
        <ExploreSection
          title={t('new_members.title')}
          subtitle={t('new_members.subtitle')}
          seeAllLink={tenantPath('/members')}
        >
          {isLoading ? (
            <div className="flex gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col items-center gap-2 min-w-[100px]">
                  <Skeleton className="w-14 h-14 rounded-full" />
                  <Skeleton className="w-16 h-4 rounded" />
                </div>
              ))}
            </div>
          ) : (
            <HorizontalScroll>
              {data!.new_members.map((member) => (
                <div
                  key={member.id}
                  className="flex flex-col items-center gap-2 min-w-[120px] snap-start shrink-0 p-3"
                >
                  <Link to={tenantPath(`/profile/${member.id}`)}>
                    <Avatar
                      src={resolveAvatarUrl(member.avatar)}
                      name={member.name}
                      size="lg"
                      className="w-14 h-14"
                    />
                  </Link>
                  <Link
                    to={tenantPath(`/profile/${member.id}`)}
                    className="text-xs font-medium text-[var(--text-primary)] text-center truncate max-w-[110px] hover:underline"
                  >
                    {member.name}
                  </Link>
                  {member.tagline && (
                    <p className="text-[10px] text-[var(--text-muted)] text-center truncate max-w-[110px]">
                      {member.tagline}
                    </p>
                  )}
                  {isAuthenticated && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="text-xs h-7 px-3"
                      startContent={<UserPlus className="w-3 h-3" aria-hidden="true" />}
                      onPress={() => navigate(tenantPath(`/messages/new/${member.id}`))}
                    >
                      {t('new_members.connect')}
                    </Button>
                  )}
                </div>
              ))}
            </HorizontalScroll>
          )}
        </ExploreSection>
      )}

      {/* ─── Featured Challenges ──────────────────────────────────────────── */}
      {showSection('all') && hasFeature('ideation_challenges') && data?.featured_challenges && data.featured_challenges.length > 0 && (
        <ExploreSection
          title={t('featured_challenges.title')}
          subtitle={t('featured_challenges.subtitle')}
          seeAllLink={tenantPath('/ideation')}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data.featured_challenges.map((challenge) => (
              <Link key={challenge.id} to={tenantPath(`/ideation/${challenge.id}`)}>
                <Card className="h-full border border-[var(--card-border)] bg-[var(--card-bg)] hover:bg-[var(--card-hover-bg)] transition-colors">
                  <CardBody className="p-4 gap-3">
                    <div className="flex items-start gap-3">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-accent-soft shrink-0">
                        <Lightbulb className="w-5 h-5 text-accent" aria-hidden="true" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-sm font-semibold text-[var(--text-primary)] line-clamp-1">
                          {challenge.title}
                        </h3>
                        {challenge.description && (
                          <p className="text-xs text-[var(--text-secondary)] line-clamp-2 mt-1">
                            {challenge.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs text-[var(--text-muted)]">
                          <span className="flex items-center gap-1">
                            <Lightbulb className="w-3 h-3" aria-hidden="true" />
                            {t('featured_challenges.ideas_count', { count: challenge.idea_count })}
                          </span>
                          {challenge.end_date && (
                            <span>
                              {t('featured_challenges.ends', { date: formatDate(challenge.end_date) })}
                            </span>
                          )}
                        </div>
                        {challenge.end_date && challenge.start_date && (
                          <div className="mt-2">
                            <Progress
                              aria-label={t('featured_challenges.progress')}
                              size="sm"
                              value={getChallengeProgress(challenge.start_date, challenge.end_date)}
                              classNames={{
                                track: 'bg-[var(--surface-elevated)]',
                                indicator: 'bg-accent',
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            ))}
          </div>
        </ExploreSection>
      )}

      {/* ─── Empty states for filtered tabs ──────────────────────────────── */}
      {!isLoading && activeTab === 'listings' && !data?.popular_listings?.length && !data?.recommended_listings?.length && (
        <EmptyState icon={ListTodo} message={t('empty_listings')} cta={t('create_listing')} onAction={() => navigate(tenantPath('/listings/create'))} />
      )}
      {!isLoading && hasConnections && activeTab === 'people' && !data?.suggested_connections?.length && !data?.new_members?.length && !data?.top_contributors?.length && (
        <EmptyState icon={Users} message={t('empty_people')} />
      )}
      {!isLoading && activeTab === 'events' && !data?.upcoming_events?.length && (
        // The community can restrict who creates Events, so the CTA is dropped
        // rather than offered as a dead end.
        <EmptyState
          icon={Calendar}
          message={t('empty_events')}
          cta={mayCreateEvent ? t('create_event') : undefined}
          onAction={mayCreateEvent ? () => navigate(tenantPath('/events/create')) : undefined}
        />
      )}
      {!isLoading && activeTab === 'groups' && !data?.active_groups?.length && (
        <EmptyState icon={Users} message={t('empty_groups')} cta={t('create_group')} onAction={() => navigate(tenantPath('/groups/create'))} />
      )}
    </div>
  );
}
