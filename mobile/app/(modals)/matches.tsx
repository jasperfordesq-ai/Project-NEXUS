// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import AccentIcon from '@/components/ui/AccentIcon';
import { describeApiError } from '@/lib/api/describeApiError';
import { useAppToast } from '@/components/ui/AppToast';
import { useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { Tabs } from '@/components/ui/NativeTabs';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import {
  dismissMatch,
  getMatches,
  type MatchItem,
  type MatchSourceType,
} from '@/lib/api/matches';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import * as Haptics from '@/lib/haptics';
import { withRouteGate } from '@/components/withRouteGate';

type Filter = 'all' | MatchSourceType;
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

/*
  🔴 One filter per kind of match the server can return. There was a "Jobs" filter here that
  could never fill (the server has no jobs match) and no "Events" filter although events are
  matched, so an event could only ever be found under "All".
*/
const FILTERS: Filter[] = ['all', 'listing', 'volunteering', 'group', 'event'];

const SOURCE_CONFIG: Record<MatchSourceType, { icon: IoniconName; tone: string; route: (id: number) => Parameters<typeof router.push>[0] }> = {
  listing: {
    icon: 'list-outline',
    tone: '#2563eb',
    route: (id) => ({ pathname: '/(modals)/exchange-detail', params: { id: String(id) } }),
  },
  /*
    🔴 A volunteering match is an OPPORTUNITY, and `source_id` is its opportunity id
    (`lib/api/matches.ts`). This screen used to be handed the ORGANISATION's id and passed
    it to the opportunity screen, which opened an unrelated opportunity.
  */
  volunteering: {
    icon: 'heart-outline',
    tone: '#e11d48',
    route: (id) => ({ pathname: '/(modals)/volunteering-detail', params: { id: String(id) } }),
  },
  group: {
    icon: 'people-outline',
    tone: '#14b8a6',
    route: (id) => ({ pathname: '/(modals)/group-detail', params: { id: String(id) } }),
  },
  /*
    🔴 `event` was missing while the server has always been able to return it
    (`CrossModuleMatchingService` emits listing, volunteering AND event). Reading
    `SOURCE_CONFIG[undefined].tone` is what crashed this screen — "Cannot read property
    'tone' of undefined" — for every member on 2026-08-23. `lib/api/matches.ts` now also
    falls back for any module this map does not know, so a new one server-side cannot take
    Matches down a second time.
  */
  event: {
    icon: 'calendar-outline',
    tone: '#7c3aed',
    route: (id) => ({ pathname: '/(modals)/event-detail', params: { id: String(id) } }),
  },
};

/** A browsing suggestion for a member with nothing posted yet, not a scored match. */
function isSuggestion(match: MatchItem): boolean {
  return match.match_type === 'cold_start';
}

/** The score a member is shown: a whole number. */
function displayScore(score: number): number {
  return Number.isFinite(score) ? Math.min(100, Math.max(0, Math.round(score))) : 0;
}

/** When an event starts, in the app's language; null when the server sent nothing usable. */
function eventStartText(value: string | null | undefined): string | null {
  if (!value) return null;
  // The server writes "2026-12-05 14:00:00"; Hermes only parses the ISO form.
  const parsed = new Date(value.includes(' ') && !value.includes('T') ? value.replace(' ', 'T') : value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleString(dateLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

type NoticeKind = 'paused' | 'location' | 'safeguarding';

function MatchesScreen() {
  const { t } = useTranslation(['profile', 'common']);
  const { show: showToast } = useAppToast();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { data, isLoading, error, refresh } = useApi(() => getMatches());
  const params = useLocalSearchParams<{
    highlight?: string | string[];
    type?: string | string[];
  }>();
  const [filter, setFilter] = useState<Filter>('all');
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(new Set());
  const [dismissingKey, setDismissingKey] = useState<string | null>(null);

  const matches = useMemo(
    () => (data?.data ?? []).filter((match) => !dismissedKeys.has(match.key)),
    [data?.data, dismissedKeys],
  );
  const requestedType = Array.isArray(params.type) ? params.type[0] : params.type;
  const rawHighlight = Array.isArray(params.highlight) ? params.highlight[0] : params.highlight;
  const highlightMatch = rawHighlight?.match(/^listing-(\d+)$/);
  const highlightedListingId = highlightMatch ? Number(highlightMatch[1]) : null;
  const filteredMatches = useMemo(() => {
    let visible = filter === 'all' ? matches : matches.filter((match) => match.source_type === filter);
    if (requestedType === 'mutual') {
      visible = visible.filter((match) => match.match_type === 'mutual');
    }
    if (highlightedListingId !== null) {
      visible = [...visible].sort((left, right) => {
        const leftIsTarget = left.source_type === 'listing' && left.source_id === highlightedListingId;
        const rightIsTarget = right.source_type === 'listing' && right.source_id === highlightedListingId;
        return Number(rightIsTarget) - Number(leftIsTarget);
      });
    }
    return visible;
  }, [filter, highlightedListingId, matches, requestedType]);
  // Suggestions shown to a member with nothing posted yet carry a placeholder score, so
  // they stay out of the average and the hot-match count.
  const scoredMatches = matches.filter((match) => !isSuggestion(match));
  const averageScore = scoredMatches.length
    ? Math.round(scoredMatches.reduce((total, match) => total + displayScore(match.match_score), 0) / scoredMatches.length)
    : 0;
  const hotMatches = scoredMatches.filter((match) => displayScore(match.match_score) >= 80).length;
  const sourceCount = new Set(matches.map((match) => match.source_type)).size;

  /**
   * 🔴 An empty matches list has a REASON, and the server sends it. This screen used to
   * show one generic sentence for every case, so a member whose profile has no area — which
   * stops the engine considering any physical listing at all — was told "no matches yet",
   * i.e. "nobody suits you", when the truth was "we cannot look yet, and here is what to do".
   * Measured on 2026-08-24 against the live API: zero listing matches with
   * `needs_location: true, degraded_reason: "no_coordinates"`.
   *
   * Order matters. A community that has switched matching off comes first, because nothing
   * the member does would change it. Paused is the member's own choice, so it is said next;
   * then a missing area, which blocks everything; then an unfinished safeguarding setup,
   * which only the community team can finish; then having nothing posted yet. Anything else
   * keeps the original wording.
   */
  /*
    🔴 Only when there is nothing AT ALL. A member who has matches but taps a filter with
    none in it must not be told to add their area — they already have matches; this tab is
    just empty. Caught while checking the fix on a device, where the volunteering match
    would have sat behind a "you have no location" message.
  */
  const hasAnyMatch = matches.length > 0;
  const safeguardingUnavailable = data?.meta?.degradedReason === 'safeguarding_policy_unavailable';
  const emptyReason: 'disabled' | 'paused' | 'location' | 'safeguarding' | 'listings' | 'none' = hasAnyMatch
    ? 'none'
    : data?.meta?.disabled
    ? 'disabled'
    : data?.meta?.paused
    ? 'paused'
    : data?.meta?.needsLocation
      ? 'location'
      : safeguardingUnavailable
        ? 'safeguarding'
        : data?.meta?.hasActiveListings === false
          ? 'listings'
          : 'none';

  /*
    🔴 The same reasons still matter when SOME cards exist. A paused member, or one with no
    area, still gets group, volunteering and event cards — and used to be told nothing at
    all, because the explanation lived only in the empty state. They are said above the list
    as notices: softer than the empty state, and never in place of the cards.
  */
  const notices: NoticeKind[] = !hasAnyMatch
    ? []
    : [
        ...(data?.meta?.paused ? ['paused' as const] : []),
        ...(data?.meta?.needsLocation ? ['location' as const] : []),
        ...(safeguardingUnavailable ? ['safeguarding' as const] : []),
      ];

  async function handleDismiss(match: MatchItem) {
    if (match.source_id === null || dismissingKey !== null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setDismissingKey(match.key);
    try {
      await dismissMatch(match.source_id, match.source_type);
      setDismissedKeys((current) => new Set(current).add(match.key));
    } catch (err) {
      // Without this the rejection was unhandled: the spinner stopped and the card stayed.
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('matches.dismissFailed')), variant: 'danger' });
    } finally {
      setDismissingKey(null);
    }
  }

  function openMatch(match: MatchItem) {
    if (match.source_id === null) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(SOURCE_CONFIG[match.source_type].route(match.source_id));
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('matches.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList<MatchItem>
          data={filteredMatches}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <MatchCard
              item={item}
              highlighted={item.source_type === 'listing' && item.source_id === highlightedListingId}
              isDismissing={dismissingKey === item.key}
              onDismiss={() => void handleDismiss(item)}
              onOpen={() => openMatch(item)}
            />
          )}
          refreshControl={<RefreshControl refreshing={isLoading && Boolean(data)} onRefresh={() => void refresh()} tintColor={primary} colors={[primary]} />}
          contentContainerStyle={{ paddingBottom: 40 }}
          ListHeaderComponent={
            <View className="gap-3 pb-2">
              <HeroCard variant="default" className="mx-4 overflow-hidden rounded-panel p-0">
                <View className="h-1 w-full" style={{ backgroundColor: primary }} />
                <HeroCard.Body className="gap-4 p-4">
                  <View className="flex-row items-start gap-3">
                    <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                      <Ionicons name="sparkles-outline" size={25} color={primary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                        {t('matches.title')}
                      </Text>
                      <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {t('matches.subtitle')}
                      </Text>
                    </View>
                  </View>
                  <HeroButton
                    size="sm"
                    variant="secondary"
                    accessibilityLabel={t('matchPreferences.heading')}
                    onPress={() => router.push('/(modals)/match-preferences' as Href)}
                  >
                    <Ionicons name="options-outline" size={17} color={primary} />
                    <HeroButton.Label>{t('matchPreferences.heading')}</HeroButton.Label>
                  </HeroButton>
                </HeroCard.Body>
              </HeroCard>

              {notices.map((kind) => (
                <MatchNotice
                  key={kind}
                  kind={kind}
                  onAction={
                    kind === 'paused'
                      ? () => router.push('/(modals)/match-preferences' as Href)
                      : kind === 'location'
                        ? () => router.push('/(modals)/edit-profile' as Href)
                        : undefined
                  }
                />
              ))}

              <View className="mx-4 flex-row flex-wrap gap-3">
                <StatTile icon="radio-button-on-outline" label={t('matches.total')} value={matches.length} tone={primary} />
                <StatTile icon="trending-up-outline" label={t('matches.average')} value={`${averageScore}%`} tone="#22c55e" />
                <StatTile icon="flash-outline" label={t('matches.hot')} value={hotMatches} tone="#f59e0b" />
                <StatTile icon="filter-outline" label={t('matches.sources')} value={sourceCount} tone="#8b5cf6" />
              </View>

              <Surface variant="default" className="mx-4 rounded-panel-inner p-2">
                <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)} variant="secondary">
                  <Tabs.List>
                    <Tabs.ScrollView scrollAlign="start" contentContainerClassName="gap-1">
                      <Tabs.Indicator />
                      {FILTERS.map((value) => (
                        <Tabs.Trigger key={value} value={value}>
                          <Tabs.Label>{t(`matches.filter.${value}`)}</Tabs.Label>
                        </Tabs.Trigger>
                      ))}
                    </Tabs.ScrollView>
                  </Tabs.List>
                </Tabs>
              </Surface>
            </View>
          }
          ListEmptyComponent={
            isLoading ? (
              <View className="items-center justify-center py-14">
                <LoadingSpinner />
              </View>
            ) : (
              <View className="px-4 py-8">
                <EmptyState
                  icon={
                    error
                      ? 'warning-outline'
                      : emptyReason === 'location'
                        ? 'location-outline'
                        : emptyReason === 'paused'
                          ? 'pause-circle-outline'
                          : emptyReason === 'disabled'
                            ? 'power-outline'
                            : emptyReason === 'safeguarding'
                              ? 'shield-outline'
                              : emptyReason === 'listings'
                                ? 'add-circle-outline'
                                : 'sparkles-outline'
                  }
                  title={
                    error
                      ? t('matches.errorTitle')
                      : emptyReason === 'none'
                        ? t('matches.emptyTitle')
                        : t(`matches.empty.${emptyReason}Title`)
                  }
                  subtitle={
                    error
                      ? String(error)
                      : emptyReason === 'none'
                        ? t('matches.emptySubtitle')
                        : t(`matches.empty.${emptyReason}Body`)
                  }
                  // No button for a community that has matching off, or an unfinished
                  // safeguarding setup: the member cannot change either.
                  actionLabel={
                    error
                      ? t('common:buttons.retry')
                      : emptyReason === 'location'
                        ? t('matches.empty.locationAction')
                        : emptyReason === 'paused'
                          ? t('matches.empty.pausedAction')
                        : emptyReason === 'listings'
                          ? t('matches.empty.listingsAction')
                          : undefined
                  }
                  onAction={
                    error
                      ? () => void refresh()
                      : emptyReason === 'location'
                        ? () => router.push('/(modals)/edit-profile' as Href)
                        : emptyReason === 'paused'
                          ? () => router.push('/(modals)/match-preferences' as Href)
                        : emptyReason === 'listings'
                          ? () => router.push('/(modals)/new-exchange' as Href)
                          : undefined
                  }
                  testID={`matches-empty-${emptyReason}`}
                />
              </View>
            )
          }
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

const NOTICE_ICON: Record<NoticeKind, IoniconName> = {
  paused: 'pause-circle-outline',
  location: 'location-outline',
  safeguarding: 'shield-outline',
};

function MatchNotice({ kind, onAction }: { kind: NoticeKind; onAction?: () => void }) {
  const { t } = useTranslation(['profile']);
  const theme = useTheme();
  const primary = usePrimaryColor();

  return (
    <Surface variant="secondary" className="mx-4 gap-3 rounded-panel-inner p-4" testID={`matches-notice-${kind}`}>
      <View className="flex-row items-start gap-3">
        <Ionicons name={NOTICE_ICON[kind]} size={22} color={theme.warning} />
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-base font-bold" style={{ color: theme.text }}>
            {t(`matches.notice.${kind}Title`)}
          </Text>
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t(`matches.notice.${kind}Body`)}
          </Text>
        </View>
      </View>
      {onAction ? (
        <HeroButton size="sm" variant="secondary" onPress={onAction}>
          <HeroButton.Label>{t(`matches.notice.${kind}Action`)}</HeroButton.Label>
          <Ionicons name="chevron-forward-outline" size={16} color={primary} />
        </HeroButton>
      ) : null}
    </Surface>
  );
}

function MatchCard({
  item,
  highlighted,
  isDismissing,
  onDismiss,
  onOpen,
}: {
  item: MatchItem;
  highlighted: boolean;
  isDismissing: boolean;
  onDismiss: () => void;
  onOpen: () => void;
}) {
  const { t } = useTranslation(['profile']);
  const theme = useTheme();
  const config = SOURCE_CONFIG[item.source_type];
  const suggestion = isSuggestion(item);
  const score = displayScore(item.match_score);
  const scoreTone = score >= 80 ? theme.success : score >= 60 ? theme.warning : config.tone;
  const canOpen = item.source_id !== null;
  // Every kind of match can be hidden (the server records all four).
  const canDismiss = item.source_id !== null;
  const eventStart = item.source_type === 'event' ? eventStartText(item.metadata?.event_date) : null;
  const organisation = item.source_type === 'volunteering' ? item.metadata?.organization_name ?? null : null;
  const place = item.source_type === 'event' || item.source_type === 'volunteering' ? item.metadata?.location ?? null : null;
  const going = item.source_type === 'event' ? item.metadata?.attendee_count ?? null : null;

  return (
    <HeroCard
      variant="default"
      className="mx-4 my-2 overflow-hidden rounded-panel p-0"
      style={highlighted ? { borderWidth: 2, borderColor: config.tone } : undefined}
      testID={`match-card-${item.key}`}
    >
      <View className="h-1 w-full" style={{ backgroundColor: config.tone }} />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(config.tone, 0.14) }}>
            <Ionicons name={config.icon} size={22} color={config.tone} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary">
                <Chip.Label>{t(`matches.source.${item.source_type}`)}</Chip.Label>
              </Chip>
              {suggestion ? (
                // A suggestion for someone with nothing posted yet: not a scored match, so
                // it is not given a percentage.
                <Chip size="sm" variant="secondary">
                  <Ionicons name="sparkles-outline" size={12} color={config.tone} />
                  <Chip.Label>{t('matches.suggested')}</Chip.Label>
                </Chip>
              ) : (
                <Chip size="sm" variant="secondary">
                  <Ionicons name="analytics-outline" size={12} color={scoreTone} />
                  <Chip.Label>{t('matches.score', { score })}</Chip.Label>
                </Chip>
              )}
            </View>
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
              {item.title}
            </Text>
            {item.description ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {item.description}
              </Text>
            ) : null}
            {eventStart ? <DetailLine icon="time-outline" text={eventStart} /> : null}
            {organisation ? <DetailLine icon="business-outline" text={organisation} /> : null}
            {place ? <DetailLine icon="location-outline" text={place} /> : null}
            {going ? <DetailLine icon="people-outline" text={t('matches.going', { total: going })} /> : null}
          </View>
        </View>

        {item.reasons.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {item.reasons.slice(0, 4).map((reason) => (
              <Chip key={reason} size="sm" variant="secondary">
                <Chip.Label>{reason}</Chip.Label>
              </Chip>
            ))}
          </View>
        ) : null}

        {canOpen || canDismiss ? (
          <View className="flex-row gap-2">
            {canOpen ? (
              <HeroButton
                className="flex-1"
                size="sm"
                variant="primary"
                onPress={onOpen}
                // Named for the thing it opens: a screen reader used to hear "Open match"
                // once per card, with nothing to tell them apart.
                accessibilityLabel={t('matches.openNamed', { title: item.title })}
              >
                <HeroButton.Label>{t('matches.open')}</HeroButton.Label>
                <AccentIcon name="chevron-forward-outline" size={16} />
              </HeroButton>
            ) : null}
            {canDismiss ? (
              <HeroButton
                className="flex-1"
                size="sm"
                variant="danger-soft"
                onPress={onDismiss}
                isDisabled={isDismissing}
                accessibilityLabel={t('matches.dismissNamed', { title: item.title })}
              >
                <Ionicons name="close-outline" size={16} color={theme.error} />
                <HeroButton.Label>{t('matches.dismiss')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function DetailLine({ icon, text }: { icon: IoniconName; text: string }) {
  const theme = useTheme();

  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons name={icon} size={14} color={theme.textSecondary} />
      <Text className="min-w-0 flex-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: IoniconName;
  label: string;
  value: number | string;
  tone: string;
}) {
  const theme = useTheme();

  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-2 rounded-panel-inner p-4">
      <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
        <Ionicons name={icon} size={18} color={tone} />
      </View>
      <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={1}>
        {value}
      </Text>
      <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={2}>
        {label}
      </Text>
    </Surface>
  );
}

export default withRouteGate(MatchesScreen, 'matches');
