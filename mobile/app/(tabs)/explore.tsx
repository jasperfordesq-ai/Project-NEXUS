// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo, useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getExplore,
  type ExploreBlogPost,
  type ExploreData,
  type ExploreEvent,
  type ExploreGroup,
  type ExploreJob,
  type ExploreListing,
  type ExploreMember,
  type ExploreOrganisation,
  type ExplorePoll,
  type ExplorePost,
  type ExploreResource,
  type ExploreVolunteeringOpportunity,
} from '@/lib/api/explore';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import NativePressable from '@/components/ui/NativePressable';
import OfflineBanner from '@/components/OfflineBanner';

type ExploreTab = 'all' | 'forYou' | 'listings' | 'people' | 'events' | 'groups';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: ExploreTab[] = ['all', 'forYou', 'listings', 'people', 'events', 'groups'];

interface SectionMeta {
  key: string;
  titleKey: string;
  subtitleKey: string;
  icon: IoniconName;
  tone: string;
  tab: ExploreTab;
  featureGate?: string;
  seeAllRoute?: Href;
}

const SECTION_META: SectionMeta[] = [
  { key: 'recommended', titleKey: 'sections.recommended.title', subtitleKey: 'sections.recommended.subtitle', icon: 'sparkles-outline', tone: '#8b5cf6', tab: 'forYou', seeAllRoute: '/(modals)/matches' as Href },
  { key: 'popularListings', titleKey: 'sections.popularListings.title', subtitleKey: 'sections.popularListings.subtitle', icon: 'storefront-outline', tone: '#0f766e', tab: 'listings', seeAllRoute: '/(tabs)/exchanges' as Href },
  { key: 'nearYou', titleKey: 'sections.nearYou.title', subtitleKey: 'sections.nearYou.subtitle', icon: 'navigate-outline', tone: '#14b8a6', tab: 'listings', seeAllRoute: '/(tabs)/exchanges' as Href },
  { key: 'events', titleKey: 'sections.events.title', subtitleKey: 'sections.events.subtitle', icon: 'calendar-outline', tone: '#f43f5e', tab: 'events', featureGate: 'events', seeAllRoute: '/(tabs)/events' as Href },
  { key: 'groups', titleKey: 'sections.groups.title', subtitleKey: 'sections.groups.subtitle', icon: 'people-outline', tone: '#06b6d4', tab: 'groups', featureGate: 'groups', seeAllRoute: '/(tabs)/groups' as Href },
  { key: 'people', titleKey: 'sections.people.title', subtitleKey: 'sections.people.subtitle', icon: 'person-add-outline', tone: '#6366f1', tab: 'people', featureGate: 'connections', seeAllRoute: '/(tabs)/members' as Href },
  { key: 'contributors', titleKey: 'sections.contributors.title', subtitleKey: 'sections.contributors.subtitle', icon: 'trophy-outline', tone: '#f59e0b', tab: 'people', featureGate: 'gamification', seeAllRoute: '/(modals)/gamification' as Href },
  { key: 'posts', titleKey: 'sections.posts.title', subtitleKey: 'sections.posts.subtitle', icon: 'chatbubble-ellipses-outline', tone: '#22c55e', tab: 'forYou', seeAllRoute: '/(tabs)/home' as Href },
  { key: 'volunteering', titleKey: 'sections.volunteering.title', subtitleKey: 'sections.volunteering.subtitle', icon: 'heart-outline', tone: '#e11d48', tab: 'all', featureGate: 'volunteering', seeAllRoute: '/(modals)/volunteering' as Href },
  { key: 'organisations', titleKey: 'sections.organisations.title', subtitleKey: 'sections.organisations.subtitle', icon: 'business-outline', tone: '#6366f1', tab: 'all', featureGate: 'organisations', seeAllRoute: '/(modals)/organisations' as Href },
  { key: 'blog', titleKey: 'sections.blog.title', subtitleKey: 'sections.blog.subtitle', icon: 'newspaper-outline', tone: '#f97316', tab: 'all', featureGate: 'blog', seeAllRoute: '/(modals)/blog' as Href },
  { key: 'jobs', titleKey: 'sections.jobs.title', subtitleKey: 'sections.jobs.subtitle', icon: 'briefcase-outline', tone: '#2563eb', tab: 'all', featureGate: 'job_vacancies', seeAllRoute: '/(modals)/jobs' as Href },
  { key: 'polls', titleKey: 'sections.polls.title', subtitleKey: 'sections.polls.subtitle', icon: 'stats-chart-outline', tone: '#7c3aed', tab: 'all', featureGate: 'polls', seeAllRoute: '/(modals)/polls' as Href },
  { key: 'resources', titleKey: 'sections.resources.title', subtitleKey: 'sections.resources.subtitle', icon: 'folder-open-outline', tone: '#0ea5e9', tab: 'all', featureGate: 'resources', seeAllRoute: '/(modals)/resources' as Href },
];

function stripHtml(value: string | null | undefined): string {
  return (value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countItems(data: ExploreData | null, key: string): number {
  if (!data) return 0;
  const value = {
    recommended: data.recommended_listings,
    popularListings: data.popular_listings,
    nearYou: data.near_you_listings,
    events: data.upcoming_events,
    groups: data.active_groups,
    people: [...data.suggested_connections, ...data.new_members],
    contributors: data.top_contributors,
    posts: data.trending_posts,
    volunteering: data.volunteering_opportunities,
    organisations: data.active_organisations,
    blog: data.trending_blog_posts,
    jobs: data.latest_jobs,
    polls: data.active_polls,
    resources: data.featured_resources,
  }[key];
  return value?.length ?? 0;
}

function visibleForTab(section: SectionMeta, tab: ExploreTab): boolean {
  return tab === 'all' || section.tab === tab || (tab === 'forYou' && section.key === 'recommended');
}

export default function ExploreScreen() {
  const { t } = useTranslation(['explore', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasFeature } = useTenant();
  const [activeTab, setActiveTab] = useState<ExploreTab>('all');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { data: response, isLoading, error, refresh } = useApi(() => getExplore(), []);
  const data = response?.data ?? null;

  const sections = useMemo(
    () => SECTION_META
      .filter((section) => (!section.featureGate || hasFeature(section.featureGate)) && countItems(data, section.key) > 0)
      .filter((section) => visibleForTab(section, activeTab)),
    [activeTab, data, hasFeature],
  );

  const onRefresh = useCallback(() => {
    setIsRefreshing(true);
    refresh();
    setTimeout(() => setIsRefreshing(false), 650);
  }, [refresh]);

  const stats = data?.community_stats;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <OfflineBanner />
      <ScrollView
        className="flex-1"
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={isRefreshing && isLoading} onRefresh={onRefresh} tintColor={primary} />}
      >
        <View className="px-4 pb-4 pt-3">
          <HeroCard className="overflow-hidden rounded-panel">
            <HeroCard.Header className="gap-3 px-5 pt-5">
              <Chip size="sm" variant="secondary">
                <Ionicons name="compass-outline" size={13} color={primary} />
                <Chip.Label>{t('eyebrow')}</Chip.Label>
              </Chip>
              <HeroCard.Title className="text-2xl font-bold leading-8">
                {t('title')}
              </HeroCard.Title>
              <HeroCard.Description className="text-sm leading-5">
                {t('subtitle')}
              </HeroCard.Description>
            </HeroCard.Header>
            <HeroCard.Footer className="flex-row gap-3 px-5 pb-5 pt-2">
              <HeroButton className="flex-1" variant="primary" onPress={() => router.push('/(modals)/search' as Href)}>
                <Ionicons name="search-outline" size={18} color="#fff" />
                <HeroButton.Label>{t('actions.search')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/matches' as Href)}>
                <Ionicons name="sparkles-outline" size={18} color={primary} />
                <HeroButton.Label>{t('actions.forYou')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Footer>
          </HeroCard>

          <View className="mt-4 flex-row flex-wrap gap-3">
            <StatCard icon="people-outline" label={t('stats.members')} value={stats?.total_members} theme={theme} tone="#10b981" />
            <StatCard icon="swap-horizontal-outline" label={t('stats.exchanges')} value={stats?.exchanges_this_month} theme={theme} tone="#6366f1" />
            <StatCard icon="time-outline" label={t('stats.hours')} value={stats?.hours_exchanged} suffix="h" theme={theme} tone="#f59e0b" />
            <StatCard icon="list-outline" label={t('stats.listings')} value={stats?.active_listings} theme={theme} tone="#0ea5e9" />
          </View>
        </View>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as ExploreTab)} variant="secondary" className="px-4">
          <Tabs.List className="mb-3">
            {TABS.map((tab) => (
              <Tabs.Trigger key={tab} value={tab}>
                <Tabs.Label>{t(`tabs.${tab}`)}</Tabs.Label>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs>

        {isLoading && !data ? (
          <View className="items-center justify-center py-12">
            <Spinner size="lg" color={primary} />
            <Text className="mt-3 text-sm" style={{ color: theme.textSecondary }}>{t('loading')}</Text>
          </View>
        ) : error ? (
          <EmptyState icon="alert-circle-outline" title={t('errorTitle')} subtitle={error} actionLabel={t('common:buttons.retry')} onAction={refresh} />
        ) : sections.length === 0 ? (
          <EmptyState icon="compass-outline" title={t('emptyTitle')} subtitle={t('emptySubtitle')} actionLabel={t('actions.search')} onAction={() => router.push('/(modals)/search' as Href)} />
        ) : (
          <View className="gap-4">
            {sections.map((section) => (
              <ExploreSection key={section.key} section={section} data={data} theme={theme} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, label, value, suffix = '', tone, theme }: { icon: IoniconName; label: string; value?: number; suffix?: string; tone: string; theme: Theme }) {
  return (
    <HeroCard className="min-h-[86px] flex-1 basis-[46%] rounded-panel-inner">
      <HeroCard.Body className="gap-2 p-3">
        <View className="h-8 w-8 items-center justify-center rounded-2xl" style={{ backgroundColor: `${tone}22` }}>
          <Ionicons name={icon} size={17} color={tone} />
        </View>
        <Text className="text-xl font-bold" style={{ color: theme.text }}>
          {typeof value === 'number' ? `${value}${suffix}` : '—'}
        </Text>
        <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function ExploreSection({ section, data, theme }: { section: SectionMeta; data: ExploreData | null; theme: Theme }) {
  const { t } = useTranslation('explore');
  const { width } = useWindowDimensions();
  const items = getSectionItems(section.key, data).slice(0, 8);
  const cardWidth = Math.min(320, Math.max(272, width - 56));
  if (items.length === 0) return null;

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-3 px-4">
        <View className="h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: `${section.tone}22` }}>
          <Ionicons name={section.icon} size={20} color={section.tone} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{t(section.titleKey)}</Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{t(section.subtitleKey)}</Text>
        </View>
        {section.seeAllRoute ? (
          <HeroButton size="sm" variant="ghost" onPress={() => router.push(section.seeAllRoute!)} accessibilityLabel={t('actions.seeAll')}>
            <HeroButton.Label>{t('actions.seeAll')}</HeroButton.Label>
            <Ionicons name="chevron-forward-outline" size={16} color={section.tone} />
          </HeroButton>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 2 }}
      >
        {items.map((item) => (
          <ExploreItemCard key={`${section.key}-${item.id}`} section={section} item={item} theme={theme} cardWidth={cardWidth} />
        ))}
      </ScrollView>
    </View>
  );
}

function getSectionItems(sectionKey: string, data: ExploreData | null): (Record<string, unknown> & { id: number })[] {
  if (!data) return [];
  const map: Record<string, (Record<string, unknown> & { id: number })[]> = {
    recommended: data.recommended_listings as unknown as (Record<string, unknown> & { id: number })[],
    popularListings: data.popular_listings as unknown as (Record<string, unknown> & { id: number })[],
    nearYou: data.near_you_listings as unknown as (Record<string, unknown> & { id: number })[],
    events: data.upcoming_events as unknown as (Record<string, unknown> & { id: number })[],
    groups: data.active_groups as unknown as (Record<string, unknown> & { id: number })[],
    people: [...data.suggested_connections, ...data.new_members] as unknown as (Record<string, unknown> & { id: number })[],
    contributors: data.top_contributors as unknown as (Record<string, unknown> & { id: number })[],
    posts: data.trending_posts as unknown as (Record<string, unknown> & { id: number })[],
    volunteering: data.volunteering_opportunities as unknown as (Record<string, unknown> & { id: number })[],
    organisations: data.active_organisations as unknown as (Record<string, unknown> & { id: number })[],
    blog: data.trending_blog_posts as unknown as (Record<string, unknown> & { id: number })[],
    jobs: data.latest_jobs as unknown as (Record<string, unknown> & { id: number })[],
    polls: data.active_polls as unknown as (Record<string, unknown> & { id: number })[],
    resources: data.featured_resources as unknown as (Record<string, unknown> & { id: number })[],
  };
  return map[sectionKey] ?? [];
}

function ExploreItemCard({
  section,
  item,
  theme,
  cardWidth,
}: {
  section: SectionMeta;
  item: Record<string, unknown> & { id: number };
  theme: Theme;
  cardWidth: number;
}) {
  const { t } = useTranslation('explore');
  const title = getItemTitle(section.key, item);
  const subtitle = getItemSubtitle(section.key, item, (level) => t('itemMeta.level', { level }));
  const imageUrl = getItemImage(section.key, item);
  const route = getItemRoute(section.key, item);

  return (
    <NativePressable
      onPress={() => route && router.push(route)}
      accessibilityLabel={title}
      style={{ width: cardWidth }}
      feedback="highlight"
    >
      <HeroCard className="min-h-[188px] w-full overflow-hidden rounded-3xl p-0">
        <View className="h-1.5 w-full" style={{ backgroundColor: section.tone }} />
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-start gap-3">
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} className="h-12 w-12 rounded-2xl bg-surface" resizeMode="cover" />
            ) : section.key === 'people' || section.key === 'contributors' ? (
              <Avatar uri={(item.avatar as string | null | undefined) ?? null} name={title} size={48} />
            ) : (
              <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: `${section.tone}22` }}>
                <Ionicons name={section.icon} size={22} color={section.tone} />
              </View>
            )}
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold leading-5" style={{ color: theme.text }} numberOfLines={2}>{title}</Text>
              {subtitle ? (
                <Text className="mt-1 text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>{subtitle}</Text>
              ) : null}
            </View>
          </View>
          <View className="mt-auto flex-row items-center justify-between">
            <Chip size="sm" variant="secondary">
              <Chip.Label>{t(`itemTypes.${section.key}`, { defaultValue: t('itemTypes.default') })}</Chip.Label>
            </Chip>
            <Ionicons name="chevron-forward-outline" size={17} color={section.tone} />
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function getItemTitle(sectionKey: string, item: Record<string, unknown>): string {
  if (sectionKey === 'posts') return stripHtml((item as unknown as ExplorePost).excerpt);
  if (sectionKey === 'people' || sectionKey === 'contributors') return String((item as unknown as ExploreMember).name ?? '');
  if (sectionKey === 'groups') return String((item as unknown as ExploreGroup).name ?? '');
  if (sectionKey === 'organisations') return String((item as unknown as ExploreOrganisation).name ?? '');
  if (sectionKey === 'polls') return String((item as unknown as ExplorePoll).question ?? '');
  return String((item as { title?: string }).title ?? '');
}

function getItemSubtitle(sectionKey: string, item: Record<string, unknown>, levelLabel: (level: number) => string): string {
  switch (sectionKey) {
    case 'recommended':
    case 'popularListings':
    case 'nearYou': {
      const listing = item as unknown as ExploreListing;
      return [listing.category_name, listing.location].filter(Boolean).join(' • ');
    }
    case 'events': {
      const event = item as unknown as ExploreEvent;
      return [event.location, event.start_at].filter(Boolean).join(' • ');
    }
    case 'groups': {
      const group = item as unknown as ExploreGroup;
      return group.description ?? '';
    }
    case 'people':
    case 'contributors': {
      const member = item as unknown as ExploreMember;
      return member.tagline || member.reason || (typeof member.level === 'number' ? levelLabel(member.level) : '');
    }
    case 'posts': {
      const post = item as unknown as ExplorePost;
      return post.author_name;
    }
    case 'volunteering': {
      const opportunity = item as unknown as ExploreVolunteeringOpportunity;
      return [opportunity.org_name, opportunity.location].filter(Boolean).join(' • ');
    }
    case 'organisations': {
      return (item as unknown as ExploreOrganisation).description ?? '';
    }
    case 'blog': {
      const post = item as unknown as ExploreBlogPost;
      return post.excerpt ?? post.author_name;
    }
    case 'jobs': {
      const job = item as unknown as ExploreJob;
      return [job.org_name, job.location].filter(Boolean).join(' • ');
    }
    case 'polls': {
      const poll = item as unknown as ExplorePoll;
      return poll.author_name;
    }
    case 'resources': {
      const resource = item as unknown as ExploreResource;
      return resource.description ?? resource.category_name;
    }
    default:
      return '';
  }
}

function getItemImage(sectionKey: string, item: Record<string, unknown>): string | null {
  if (sectionKey === 'people' || sectionKey === 'contributors') return null;
  const image =
    (item.image_url as string | null | undefined) ??
    (item.author_avatar as string | null | undefined) ??
    (item.logo_url as string | null | undefined) ??
    (item.org_logo as string | null | undefined) ??
    null;
  return resolveImageUrl(image);
}

function getItemRoute(sectionKey: string, item: Record<string, unknown> & { id: number }): Href | null {
  switch (sectionKey) {
    case 'recommended':
    case 'popularListings':
    case 'nearYou':
      return { pathname: '/(modals)/exchange-detail', params: { id: String(item.id) } } as Href;
    case 'events':
      return { pathname: '/(modals)/event-detail', params: { id: String(item.id) } } as Href;
    case 'groups':
      return { pathname: '/(modals)/group-detail', params: { id: String(item.id) } } as Href;
    case 'people':
    case 'contributors':
      return { pathname: '/(modals)/member-profile', params: { id: String(item.id) } } as Href;
    case 'posts':
      return { pathname: '/(modals)/feed-item-detail', params: { id: String(item.id) } } as Href;
    case 'blog': {
      const slug = (item as unknown as ExploreBlogPost).slug || String(item.id);
      return { pathname: '/(modals)/blog-post', params: { id: slug } } as Href;
    }
    case 'volunteering':
      return { pathname: '/(modals)/volunteering-detail', params: { id: String(item.id) } } as Href;
    case 'organisations':
      return { pathname: '/(modals)/organisation-detail', params: { id: String(item.id) } } as Href;
    case 'jobs':
      return { pathname: '/(modals)/job-detail', params: { id: String(item.id) } } as Href;
    case 'polls':
      return '/(modals)/polls' as Href;
    case 'resources':
      return '/(modals)/resources' as Href;
    default:
      return null;
  }
}
