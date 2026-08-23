// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  getGamificationProfile,
  claimDailyReward,
  claimChallengeReward,
  getBadges,
  getBadgeCollections,
  getChallenges,
  getDailyRewardStatus,
  getLeaderboard,
  getNexusScore,
  getShopItems,
  purchaseShopItem,
  updateBadgeShowcase,
  type Badge,
  type BadgeCollection,
  type Challenge,
  type DailyRewardStatus,
  type GamificationProfile,
  type LeaderboardEntry,
  type NexusScoreCategory,
  type NexusScoreData,
  type ShopItem,
} from '@/lib/api/gamification';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ErrorState from '@/components/ui/ErrorState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';

type Tab = 'badges' | 'challenges' | 'journeys' | 'leaderboard' | 'score' | 'shop';
type LeaderboardPeriod = 'weekly' | 'monthly' | 'all_time';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type ApiBadge = Badge & {
  badge_key?: string;
  earned?: boolean;
  is_showcased?: boolean;
  /**
   * 🔴 The column the server actually populates when a badge is awarded.
   *
   * `GET /v2/gamification/badges` returns `awarded_at` with a timestamp and leaves both
   * `earned_at` and `claimed_at` null. `is_earned` and `earned` are not sent at all. So
   * every check here missed, and all ten of a member's earned badges rendered as "Locked"
   * behind a padlock. Measured on a device 2026-08-23; found by auditing what the API
   * sends against what this screen declares it needs.
   */
  awarded_at?: string | null;
};
type ApiProfile = GamificationProfile & {
  level_progress?: {
    current_xp?: number;
    xp_for_current_level?: number;
    xp_for_next_level?: number;
    progress_percentage?: number;
  };
  badges_count?: number;
  current_streak?: number;
  streak?: number;
};
type ApiLeaderboardEntry = LeaderboardEntry & {
  position?: number;
  score?: number;
  is_current_user?: boolean;
  user: LeaderboardEntry['user'] & {
    avatar_url?: string | null;
  };
};
type ApiNexusScore = NexusScoreData & {
  tier?: NexusScoreData['tier'] | null;
};

const BADGE_ICON_MAP: Record<string, IoniconName> = {
  achievement: 'trophy-outline',
  achievements: 'trophy-outline',
  badge: 'ribbon-outline',
  badges: 'ribbon-outline',
  calendar: 'calendar-outline',
  chat: 'chatbubble-ellipses-outline',
  connection: 'people-circle-outline',
  connections: 'people-circle-outline',
  community: 'people-outline',
  event: 'calendar-outline',
  events: 'calendar-outline',
  exchange: 'swap-horizontal-outline',
  exchanges: 'swap-horizontal-outline',
  fire: 'flame-outline',
  first_exchange: 'swap-horizontal-outline',
  gift: 'gift-outline',
  heart: 'heart-outline',
  help: 'help-buoy-outline',
  level: 'flash-outline',
  listing: 'list-outline',
  medal: 'medal-outline',
  message: 'chatbubble-ellipses-outline',
  messages: 'chatbubble-ellipses-outline',
  offer: 'gift-outline',
  profile: 'person-circle-outline',
  request: 'hand-left-outline',
  review: 'star-outline',
  reviews: 'star-outline',
  ribbon: 'ribbon-outline',
  shield: 'shield-checkmark-outline',
  star: 'star-outline',
  streak: 'flame-outline',
  time: 'time-outline',
  trophy: 'trophy-outline',
  volunteer: 'heart-outline',
  volunteering: 'heart-outline',
  wallet: 'wallet-outline',
  xp: 'sparkles-outline',
};

function badgeKey(icon: string | null | undefined) {
  return (icon ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeBadgeIcon(icon: string | null | undefined): IoniconName {
  const raw = (icon ?? '').trim();
  const key = badgeKey(raw);
  const glyphMap = (Ionicons as unknown as { glyphMap?: Record<string, number> }).glyphMap;

  if (key && BADGE_ICON_MAP[key]) {
    return BADGE_ICON_MAP[key];
  }

  const candidates = [
    raw,
    raw ? `${raw}-outline` : '',
    key.replace(/_/g, '-'),
    key ? `${key.replace(/_/g, '-')}-outline` : '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (glyphMap?.[candidate]) {
      return candidate as IoniconName;
    }
  }

  const firstToken = key.split('_')[0];
  return BADGE_ICON_MAP[firstToken] ?? 'ribbon-outline';
}

function numberOrFallback(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getProfileXp(profile: ApiProfile) {
  return numberOrFallback(profile.xp);
}

function getProfileLevel(profile: ApiProfile) {
  return numberOrFallback(profile.level, 1);
}

function getProfileNextLevelXp(profile: ApiProfile) {
  return numberOrFallback(profile.next_level_xp, numberOrFallback(profile.level_progress?.xp_for_next_level, getProfileXp(profile)));
}

function getProfileRank(profile: ApiProfile, userRank: number | null) {
  return typeof profile.rank === 'number' && Number.isFinite(profile.rank) ? profile.rank : userRank;
}

function getProfileStreak(profile: ApiProfile) {
  return numberOrFallback(profile.streak_days, numberOrFallback(profile.current_streak, numberOrFallback(profile.streak)));
}

function isBadgeEarned(badge: ApiBadge) {
  // `awarded_at` last but load-bearing: it is the only one of these the server populates.
  return badge.is_earned === true
    || badge.earned === true
    || Boolean(badge.earned_at)
    || Boolean(badge.awarded_at);
}

function getBadgeKey(badge: ApiBadge) {
  return String(badge.id ?? badge.badge_key ?? badge.name);
}

function getBadgeShowcaseKey(badge: ApiBadge) {
  return String(badge.badge_key ?? badge.id ?? badge.name);
}

function getLeaderboardRank(entry: ApiLeaderboardEntry) {
  return numberOrFallback(entry.rank, numberOrFallback(entry.position));
}

function getInitialTab(pathname: string, tab?: string | string[]): Tab {
  const requested = Array.isArray(tab) ? tab[0] : tab;
  if (requested === 'leaderboard' || pathname.includes('leaderboard')) return 'leaderboard';
  if (requested === 'score' || requested === 'nexus-score' || pathname.includes('nexus-score')) return 'score';
  if (requested === 'challenges') return 'challenges';
  if (requested === 'journeys' || requested === 'collections') return 'journeys';
  if (requested === 'shop') return 'shop';
  return 'badges';
}

function getScoreCategoryIcon(category: NexusScoreCategory): IoniconName {
  const key = category.key.toLowerCase();
  if (key.includes('engagement')) return 'people-outline';
  if (key.includes('quality')) return 'star-outline';
  if (key.includes('volunteer')) return 'time-outline';
  if (key.includes('activity')) return 'trending-up-outline';
  if (key.includes('badge')) return 'medal-outline';
  if (key.includes('impact')) return 'heart-outline';
  return 'analytics-outline';
}

function XpBar({
  xp,
  nextLevelXp,
  primary,
}: {
  xp: number;
  nextLevelXp: number;
  primary: string;
}) {
  const percentage = nextLevelXp > 0 ? Math.min(100, Math.round((xp / nextLevelXp) * 100)) : 0;
  return (
    <View className="h-3 overflow-hidden rounded-full bg-default-200">
      <View
        className="h-3 rounded-full"
        style={{ width: `${percentage}%`, backgroundColor: primary }}
      />
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  tone,
  theme,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface variant="secondary" className="min-w-[46%] flex-1 gap-2 rounded-panel-inner p-3">
      <View className="flex-row items-center gap-2">
        <View className="size-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
          <Ionicons name={icon} size={16} color={tone} />
        </View>
        <Text className="flex-1 text-[11px] font-semibold uppercase text-muted-foreground" numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>
        {value}
      </Text>
    </Surface>
  );
}

function ProfileSection({
  profile,
  earnedCount,
  lockedCount,
  userRank,
  primary,
  theme,
  t,
}: {
  profile: ApiProfile;
  earnedCount: number;
  lockedCount: number;
  userRank: number | null;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const xp = getProfileXp(profile);
  const level = getProfileLevel(profile);
  const nextLevelXp = getProfileNextLevelXp(profile);
  const rank = getProfileRank(profile, userRank);
  const streak = getProfileStreak(profile);
  const toNextLevel = Math.max(0, nextLevelXp - xp);

  return (
    <HeroCard className="gap-5 overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-5 p-4 pt-0">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="trophy-outline" size={24} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-semibold uppercase text-muted-foreground">
              {t('heroEyebrow')}
            </Text>
            <Text className="text-2xl font-bold text-foreground" numberOfLines={1}>
              {t('title')}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {t('subtitle')}
            </Text>
          </View>
        </View>

        <View className="gap-3">
          <View className="flex-row items-end justify-between gap-3">
            <View>
              <Text className="text-[11px] font-semibold uppercase text-muted-foreground">
                {t('stats.totalXp')}
              </Text>
              <Text className="text-[34px] font-bold" style={{ color: primary }}>
                {t('xp', { xp })}
              </Text>
            </View>
            <Chip size="md" variant="secondary" color="accent">
              <Ionicons name="flash-outline" size={13} color={primary} />
              <Chip.Label>{t('level', { level })}</Chip.Label>
            </Chip>
          </View>
          <XpBar xp={xp} nextLevelXp={nextLevelXp} primary={primary} />
          <Text className="text-xs text-muted-foreground">
            {t('nextLevel', { xp: toNextLevel })}
          </Text>
        </View>

        <View className="flex-row flex-wrap gap-3">
          <StatTile
            icon="ribbon-outline"
            label={t('stats.earnedBadges')}
            value={String(earnedCount)}
            tone="#22c55e"
            theme={theme}
          />
          <StatTile
            icon="lock-closed-outline"
            label={t('stats.lockedBadges')}
            value={String(lockedCount)}
            tone="#f59e0b"
            theme={theme}
          />
          <StatTile
            icon="podium-outline"
            label={t('stats.rank')}
            value={rank !== null ? t('rank', { rank }) : t('unranked')}
            tone={primary}
            theme={theme}
          />
          <StatTile
            icon="flame-outline"
            label={t('stats.streak')}
            value={streak > 0 ? t('streak', { days: streak }) : t('streakNone')}
            tone="#ef4444"
            theme={theme}
          />
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function DailyRewardCard({
  status,
  isClaiming,
  onClaim,
  primary,
  theme,
  t,
}: {
  status: DailyRewardStatus | null;
  isClaiming: boolean;
  onClaim: () => Promise<void>;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!status) return null;

  const streak = numberOrFallback(status.current_streak);

  return (
    <HeroCard className="overflow-hidden rounded-panel p-0">
      <View className="h-1.5 bg-warning" />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.16) }}>
            <Ionicons name="gift-outline" size={24} color="#f59e0b" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('dailyReward.title')}</Text>
            <Text className="text-sm text-muted-foreground">
              {status.claimed_today
                ? t('dailyReward.comeBackTomorrow', { xp: status.next_reward_xp })
                : t('dailyReward.claimToday', { xp: status.reward_xp })}
            </Text>
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          {streak > 0 ? (
            <Chip size="sm" variant="secondary" color="warning">
              <Ionicons name="flame-outline" size={12} color="#f59e0b" />
              <Chip.Label>{t('dailyReward.streak', { count: streak })}</Chip.Label>
            </Chip>
          ) : null}
          {status.claimed_today ? (
            <Chip size="sm" variant="secondary" color="success">
              <Ionicons name="checkmark-circle-outline" size={12} color={theme.success ?? primary} />
              <Chip.Label>{t('dailyReward.claimed')}</Chip.Label>
            </Chip>
          ) : (
            <HeroButton
              size="sm"
              variant="primary"
              isDisabled={isClaiming}
              onPress={() => void onClaim()}
              accessibilityLabel={t('dailyReward.claimReward')}
              style={{ backgroundColor: isClaiming ? theme.border : primary }}
            >
              {isClaiming ? <LoadingSpinner /> : <Ionicons name="sparkles-outline" size={16} color={theme.onPrimary} />}
              <HeroButton.Label>{isClaiming ? t('dailyReward.claiming') : t('dailyReward.claimReward')}</HeroButton.Label>
            </HeroButton>
          )}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function BadgeCard({
  badge,
  primary,
  theme,
  t,
}: {
  badge: ApiBadge;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string) => string;
}) {
  const earnedDate = badge.earned_at
    ? new Date(badge.earned_at).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
    : null;
  const iconName = normalizeBadgeIcon(badge.icon);
  const earned = isBadgeEarned(badge);
  const tone = earned ? primary : theme.textMuted;

  return (
    <HeroCard
      variant={earned ? 'default' : 'secondary'}
      className="mb-3 min-w-[47%] flex-1 rounded-panel-inner p-0"
      style={{ borderColor: earned ? withAlpha(primary, 0.4) : theme.borderSubtle, borderWidth: 1 }}
    >
      <HeroCard.Body className="items-center gap-3 p-3">
        <View className="size-14 items-center justify-center rounded-2xl" style={{ backgroundColor: earned ? withAlpha(primary, 0.14) : theme.surface }}>
          <Ionicons name={iconName} size={27} color={tone} />
        </View>
        <View className="w-full gap-1">
          <Text className="text-center text-sm font-semibold text-foreground" numberOfLines={2}>
            {badge.name}
          </Text>
          {badge.description ? (
            <Text className="text-center text-xs text-muted-foreground" numberOfLines={2}>
              {badge.description}
            </Text>
          ) : null}
        </View>
        <Chip size="sm" variant="secondary" color={earned ? 'success' : 'default'}>
          <Ionicons name={earned ? 'checkmark-circle-outline' : 'lock-closed-outline'} size={12} color={tone} />
          <Chip.Label>{earned ? t('badges.earned') : t('badges.locked')}</Chip.Label>
        </Chip>
        {earned && earnedDate ? (
          <Text className="text-[11px] text-muted-foreground">{earnedDate}</Text>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function ShowcaseManager({
  badges,
  selectedKeys,
  saving,
  onToggle,
  onSave,
  primary,
  theme,
  t,
}: {
  badges: ApiBadge[];
  selectedKeys: Set<string>;
  saving: boolean;
  onToggle: (badge: ApiBadge) => void;
  onSave: () => Promise<void>;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const earnedBadges = badges.filter((badge) => isBadgeEarned(badge));

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="star-outline" size={20} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('showcase.title')}</Text>
            <Text className="text-sm text-muted-foreground">{t('showcase.selectedCount', { count: selectedKeys.size })}</Text>
          </View>
          <HeroButton
            size="sm"
            variant="primary"
            isDisabled={saving}
            onPress={() => void onSave()}
            accessibilityLabel={t('showcase.save')}
            style={{ backgroundColor: saving ? theme.border : primary }}
          >
            {saving ? <LoadingSpinner /> : <Ionicons name="save-outline" size={16} color={theme.onPrimary} />}
            <HeroButton.Label>{saving ? t('showcase.saving') : t('showcase.save')}</HeroButton.Label>
          </HeroButton>
        </View>
        {earnedBadges.length === 0 ? (
          <Text className="text-sm text-muted-foreground">{t('showcase.noBadgesEarned')}</Text>
        ) : (
          <View className="gap-2">
            {earnedBadges.map((badge) => {
              const badgeKeyValue = getBadgeShowcaseKey(badge);
              const selected = selectedKeys.has(badgeKeyValue);
              const disabled = !selected && selectedKeys.size >= 5;
              return (
                <HeroButton
                  key={badgeKeyValue}
                  variant={selected ? 'secondary' : 'ghost'}
                  className="justify-start rounded-panel-inner p-0"
                  isDisabled={disabled}
                  onPress={() => onToggle(badge)}
                  accessibilityLabel={t('showcase.toggleBadge', { name: badge.name })}
                  accessibilityState={{ selected, disabled }}
                >
                  <Surface variant="secondary" className="w-full flex-row items-center gap-3 rounded-panel-inner p-3">
                    <View className="size-9 items-center justify-center rounded-full" style={{ backgroundColor: selected ? withAlpha(primary, 0.14) : theme.surface }}>
                      <Ionicons name={selected ? 'star' : normalizeBadgeIcon(badge.icon)} size={17} color={selected ? primary : theme.textSecondary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{badge.name}</Text>
                      {badge.description ? (
                        <Text className="text-xs text-muted-foreground" numberOfLines={1}>{badge.description}</Text>
                      ) : null}
                    </View>
                    <Chip size="sm" variant="secondary" color={selected ? 'warning' : 'default'}>
                      <Chip.Label>{selected ? t('showcase.selected') : t('showcase.select')}</Chip.Label>
                    </Chip>
                  </Surface>
                </HeroButton>
              );
            })}
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function getChallengeProgress(challenge: Challenge) {
  if (typeof challenge.progress_percent === 'number' && Number.isFinite(challenge.progress_percent)) {
    return Math.min(100, Math.max(0, Math.round(challenge.progress_percent)));
  }
  return challenge.target_count > 0 ? Math.min(100, Math.round((challenge.user_progress / challenge.target_count) * 100)) : 0;
}

function ChallengeCard({
  challenge,
  claimingId,
  onClaim,
  primary,
  theme,
  t,
}: {
  challenge: Challenge;
  claimingId: number | null;
  onClaim: (challengeId: number) => Promise<void>;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const progress = getChallengeProgress(challenge);
  const canClaim = challenge.is_completed && !challenge.reward_claimed;
  const endDate = challenge.end_date ? new Date(challenge.end_date).toLocaleDateString(dateLocale()) : null;

  return (
    <HeroCard className="rounded-panel-inner p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(canClaim ? '#22c55e' : primary, 0.14) }}>
            <Ionicons name={challenge.is_completed ? 'checkmark-circle-outline' : 'flag-outline'} size={20} color={canClaim ? '#22c55e' : primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                {challenge.title}
              </Text>
              <Chip size="sm" variant="secondary" color="warning">
                <Chip.Label>{t('challenges.xpReward', { xp: challenge.reward_xp })}</Chip.Label>
              </Chip>
            </View>
            <Text className="text-sm text-muted-foreground" numberOfLines={3}>{challenge.description}</Text>
          </View>
        </View>
        <View className="gap-2">
          <XpBar xp={progress} nextLevelXp={100} primary={primary} />
          <View className="flex-row items-center justify-between gap-3">
            <Text className="text-xs text-muted-foreground">
              {t('challenges.progress', { current: challenge.user_progress, target: challenge.target_count })}
            </Text>
            {endDate ? (
              <Text className="text-xs text-muted-foreground">{endDate}</Text>
            ) : null}
          </View>
        </View>
        {canClaim ? (
          <HeroButton
            size="sm"
            variant="primary"
            isDisabled={claimingId === challenge.id}
            onPress={() => void onClaim(challenge.id)}
            accessibilityLabel={t('challenges.claimXp', { xp: challenge.reward_xp })}
            style={{ backgroundColor: claimingId === challenge.id ? theme.border : primary }}
          >
            {claimingId === challenge.id ? <LoadingSpinner /> : <Ionicons name="gift-outline" size={16} color={theme.onPrimary} />}
            <HeroButton.Label>{t('challenges.claimXp', { xp: challenge.reward_xp })}</HeroButton.Label>
          </HeroButton>
        ) : challenge.reward_claimed ? (
          <Chip size="sm" variant="secondary" color="success">
            <Ionicons name="checkmark-circle-outline" size={12} color={theme.success ?? primary} />
            <Chip.Label>{t('challenges.claimed')}</Chip.Label>
          </Chip>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function ChallengesSection({
  challenges,
  claimingId,
  onClaim,
  primary,
  theme,
  t,
}: {
  challenges: Challenge[];
  claimingId: number | null;
  onClaim: (challengeId: number) => Promise<void>;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (challenges.length === 0) {
    return <EmptyState icon="flag-outline" message={t('challenges.empty')} primary={primary} />;
  }

  const active = challenges.filter((challenge) => !challenge.is_completed && !challenge.reward_claimed);
  const completed = challenges.filter((challenge) => challenge.is_completed || challenge.reward_claimed);

  return (
    <View className="gap-4">
      {active.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('challenges.active')}</Text>
          {active.map((challenge) => (
            <ChallengeCard key={challenge.id} challenge={challenge} claimingId={claimingId} onClaim={onClaim} primary={primary} theme={theme} t={t} />
          ))}
        </View>
      ) : null}
      {completed.length > 0 ? (
        <View className="gap-3">
          <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('challenges.completed')}</Text>
          {completed.map((challenge) => (
            <ChallengeCard key={challenge.id} challenge={challenge} claimingId={claimingId} onClaim={onClaim} primary={primary} theme={theme} t={t} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function CollectionBadgeDot({
  badge,
  primary,
  theme,
}: {
  badge: BadgeCollection['badges'][number];
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  const iconName = badge.earned ? normalizeBadgeIcon(badge.icon) : 'lock-closed-outline';
  return (
    <View
      accessibilityLabel={badge.name}
      className="size-9 items-center justify-center rounded-full"
      style={{ backgroundColor: badge.earned ? withAlpha(primary, 0.14) : theme.surface, opacity: badge.earned ? 1 : 0.62 }}
    >
      <Ionicons name={iconName} size={16} color={badge.earned ? primary : theme.textMuted} />
    </View>
  );
}

function CollectionCard({
  collection,
  primary,
  theme,
  t,
}: {
  collection: BadgeCollection;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const progress = collection.total_count > 0
    ? Math.min(100, Math.round((collection.earned_count / collection.total_count) * 100))
    : 0;

  return (
    <HeroCard
      className="rounded-panel-inner p-0"
      style={collection.completed ? { borderColor: withAlpha('#22c55e', 0.45), borderWidth: 1 } : undefined}
    >
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(collection.completed ? '#22c55e' : primary, 0.14) }}>
            <Ionicons name="layers-outline" size={20} color={collection.completed ? '#22c55e' : primary} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                {collection.name}
              </Text>
              {collection.completed ? (
                <Chip size="sm" variant="secondary" color="success">
                  <Chip.Label>{t('journeys.complete')}</Chip.Label>
                </Chip>
              ) : collection.reward_xp > 0 ? (
                <Chip size="sm" variant="secondary" color="warning">
                  <Chip.Label>{t('journeys.xpReward', { xp: collection.reward_xp })}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            <Text className="text-sm text-muted-foreground" numberOfLines={3}>{collection.description}</Text>
          </View>
        </View>
        <View className="gap-2">
          <XpBar xp={progress} nextLevelXp={100} primary={collection.completed ? '#22c55e' : primary} />
          <Text className="text-xs text-muted-foreground">
            {t('journeys.badgesCollected', { earned: collection.earned_count, total: collection.total_count })}
          </Text>
        </View>
        {collection.badges.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {collection.badges.map((badge) => (
              <CollectionBadgeDot key={badge.badge_key} badge={badge} primary={primary} theme={theme} />
            ))}
          </View>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function JourneysSection({
  collections,
  primary,
  theme,
  t,
}: {
  collections: BadgeCollection[];
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (collections.length === 0) {
    return <EmptyState icon="layers-outline" message={t('journeys.empty')} primary={primary} />;
  }

  return (
    <View className="gap-3">
      {collections.map((collection) => (
        <CollectionCard key={collection.id} collection={collection} primary={primary} theme={theme} t={t} />
      ))}
    </View>
  );
}

function getShopItemCost(item: ShopItem) {
  return numberOrFallback(item.cost_xp, numberOrFallback(item.xp_cost));
}

function getShopIcon(item: ShopItem): IoniconName {
  if (item.item_type === 'badge') return 'medal-outline';
  if (item.item_type === 'title') return 'ribbon-outline';
  if (item.item_type === 'theme') return 'sparkles-outline';
  return 'bag-handle-outline';
}

function ShopItemCard({
  item,
  balance,
  purchasingId,
  onPurchase,
  primary,
  theme,
  t,
}: {
  item: ShopItem;
  balance: number;
  purchasingId: number | null;
  onPurchase: (item: ShopItem) => Promise<void>;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const cost = getShopItemCost(item);
  const isOwned = numberOrFallback(item.user_purchases) > 0;
  const canAfford = balance >= cost;
  const isAvailable = item.can_purchase && item.is_active !== false && !isOwned;

  return (
    <HeroCard className="rounded-panel-inner p-0" style={isOwned ? { opacity: 0.76 } : undefined}>
      <HeroCard.Body className="items-center gap-3 p-4">
        <View className="size-14 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          {item.icon ? (
            <Text className="text-2xl">{item.icon}</Text>
          ) : (
            <Ionicons name={getShopIcon(item)} size={27} color={primary} />
          )}
        </View>
        <View className="w-full gap-1">
          <Text className="text-center text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>{item.name}</Text>
          <Text className="text-center text-xs text-muted-foreground" numberOfLines={3}>{item.description}</Text>
        </View>
        <Chip size="sm" variant="secondary" color={canAfford ? 'accent' : 'danger'}>
          <Chip.Label>{t('shop.xpCost', { xp: cost })}</Chip.Label>
        </Chip>
        {item.stock_limit != null && !isOwned ? (
          <Text className="text-xs text-muted-foreground">{t('shop.stockLeft', { count: item.stock_limit })}</Text>
        ) : null}
        {isOwned ? (
          <Chip size="sm" variant="secondary" color="success">
            <Chip.Label>{t('shop.owned')}</Chip.Label>
          </Chip>
        ) : !isAvailable ? (
          <Chip size="sm" variant="secondary" color="default">
            <Chip.Label>{t('shop.unavailable')}</Chip.Label>
          </Chip>
        ) : (
          <HeroButton
            size="sm"
            variant="primary"
            isDisabled={!canAfford || purchasingId === item.id}
            onPress={() => void onPurchase(item)}
            accessibilityLabel={t('shop.purchaseItem', { name: item.name })}
            style={{ backgroundColor: !canAfford || purchasingId === item.id ? theme.border : primary }}
          >
            {purchasingId === item.id ? <LoadingSpinner /> : <Ionicons name="bag-add-outline" size={16} color={theme.onPrimary} />}
            <HeroButton.Label>{purchasingId === item.id ? t('shop.buying') : t('shop.purchase')}</HeroButton.Label>
          </HeroButton>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function ShopSection({
  items,
  balance,
  purchasingId,
  onPurchase,
  primary,
  theme,
  t,
}: {
  items: ShopItem[];
  balance: number;
  purchasingId: number | null;
  onPurchase: (item: ShopItem) => Promise<void>;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  return (
    <View className="gap-3">
      <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
        <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Ionicons name="diamond-outline" size={20} color={primary} />
        </View>
        <Text className="flex-1 text-sm font-semibold" style={{ color: theme.text }}>
          {t('shop.yourBalance', { xp: balance })}
        </Text>
      </Surface>
      {items.length === 0 ? (
        <EmptyState icon="bag-handle-outline" message={t('shop.empty')} primary={primary} />
      ) : (
        <View className="flex-row flex-wrap gap-3">
          {items.map((item) => (
            <View key={item.id} className="min-w-[47%] flex-1">
              <ShopItemCard item={item} balance={balance} purchasingId={purchasingId} onPurchase={onPurchase} primary={primary} theme={theme} t={t} />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function LeaderboardRow({
  entry,
  isCurrentUser,
  primary,
  theme,
  t,
}: {
  entry: ApiLeaderboardEntry;
  isCurrentUser: boolean;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const rank = getLeaderboardRank(entry);
  const avatar = entry.user.avatar ?? entry.user.avatar_url ?? null;
  const badgesCount = numberOrFallback(entry.badges_count);

  return (
    <HeroCard
      variant={isCurrentUser ? 'default' : 'secondary'}
      className="mb-3 rounded-panel-inner p-0"
      style={isCurrentUser ? { borderColor: withAlpha(primary, 0.45), borderWidth: 1 } : undefined}
    >
      <HeroCard.Body className="flex-row items-center gap-3 p-3">
        <View className="size-10 items-center justify-center rounded-full" style={{ backgroundColor: isCurrentUser ? withAlpha(primary, 0.14) : theme.surface }}>
          <Text className="text-xs font-bold" style={{ color: isCurrentUser ? primary : theme.textSecondary }}>
            #{rank}
          </Text>
        </View>
        <Avatar uri={avatar} name={entry.user.name} size={42} />
        <View className="min-w-0 flex-1">
          <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>
            {entry.user.name}
            {isCurrentUser ? ` (${t('leaderboard.you')})` : ''}
          </Text>
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {t('level', { level: entry.level })} · {t('leaderboard.badgesCount', { count: badgesCount })}
          </Text>
        </View>
        <Text className="text-sm font-bold" style={{ color: isCurrentUser ? primary : theme.text }}>
          {t('xp', { xp: entry.xp })}
        </Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function NexusScoreSection({
  score,
  primary,
  theme,
  t,
}: {
  score: ApiNexusScore | null;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  if (!score) {
    return <EmptyState icon="analytics-outline" message={t('nexusScore.empty')} primary={primary} />;
  }

  const total = numberOrFallback(score.total_score);
  const max = numberOrFallback(score.max_score, 1000);
  const percentage = numberOrFallback(score.percentage, max > 0 ? Math.round((total / max) * 100) : 0);
  const percentile = numberOrFallback(score.percentile);
  const tierName = score.tier?.name ?? t('nexusScore.tierFallback');

  return (
    <View className="gap-3">
      <HeroCard className="overflow-hidden rounded-panel p-0">
        <View className="h-1.5" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-start gap-3">
            <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="analytics-outline" size={24} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase text-muted-foreground">{t('nexusScore.eyebrow')}</Text>
              <Text className="text-2xl font-bold text-foreground">{t('nexusScore.title')}</Text>
              <Text className="text-sm text-muted-foreground">{t('nexusScore.subtitle')}</Text>
            </View>
          </View>
          <View className="flex-row items-end justify-between gap-3">
            <View>
              <Text className="text-[11px] font-semibold uppercase text-muted-foreground">{t('nexusScore.total')}</Text>
              <Text className="text-[34px] font-bold" style={{ color: primary }}>{t('nexusScore.scoreValue', { score: total, max })}</Text>
            </View>
            <Chip size="md" variant="secondary" color="accent">
              <Chip.Label>{tierName}</Chip.Label>
            </Chip>
          </View>
          <XpBar xp={percentage} nextLevelXp={100} primary={primary} />
          <Text className="text-xs text-muted-foreground">
            {t('nexusScore.percentile', { percentile })}
          </Text>
        </HeroCard.Body>
      </HeroCard>

      {score.breakdown.map((category) => (
        <Surface key={category.key} variant="secondary" className="gap-3 rounded-panel-inner p-3">
          <View className="flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
              <Ionicons name={getScoreCategoryIcon(category)} size={19} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-foreground" numberOfLines={1}>{category.label}</Text>
              <Text className="text-xs text-muted-foreground">
                {t('nexusScore.categoryScore', { score: category.score, max: category.max })}
              </Text>
            </View>
            <Text className="text-sm font-bold" style={{ color: theme.text }}>
              {t('nexusScore.percent', { percent: Math.round(category.percentage) })}
            </Text>
          </View>
          <XpBar xp={numberOrFallback(category.percentage)} nextLevelXp={100} primary={primary} />
        </Surface>
      ))}

      {score.insights.length > 0 ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-base font-semibold text-foreground">{t('nexusScore.insights')}</Text>
            {score.insights.map((insight, index) => {
              const text = typeof insight === 'string' ? insight : Object.values(insight).filter(Boolean).join(' ');
              return (
                <View key={`${index}-${text}`} className="flex-row gap-2">
                  <Ionicons name="bulb-outline" size={16} color={primary} />
                  <Text className="min-w-0 flex-1 text-sm text-muted-foreground">{text}</Text>
                </View>
              );
            })}
          </HeroCard.Body>
        </HeroCard>
      ) : null}
    </View>
  );
}

function EmptyState({
  icon,
  message,
  primary,
}: {
  icon: IoniconName;
  message: string;
  primary: string;
}) {
  return (
    <Surface variant="secondary" className="items-center gap-3 rounded-panel-inner p-8">
      <View className="size-12 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
        <Ionicons name={icon} size={24} color={primary} />
      </View>
      <Text className="text-center text-sm text-muted-foreground">{message}</Text>
    </Surface>
  );
}

function SegmentButton({
  label,
  isSelected,
  onPress,
}: {
  label: string;
  isSelected: boolean;
  onPress: () => void;
}) {
  return (
    <HeroButton
      className="flex-1"
      size="sm"
      variant={isSelected ? 'primary' : 'secondary'}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: isSelected }}
    >
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

export default function GamificationScreen() {
  const { t } = useTranslation(['gamification', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const pathname = usePathname();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { show: showToast } = useAppToast();

  const [activeTab, setActiveTab] = useState<Tab>(() => getInitialTab(pathname, params.tab));
  const [period, setPeriod] = useState<LeaderboardPeriod>('monthly');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dailyRewardOverride, setDailyRewardOverride] = useState<DailyRewardStatus | null>(null);
  const [isClaimingReward, setIsClaimingReward] = useState(false);
  const [challengeOverrides, setChallengeOverrides] = useState<Record<number, Partial<Challenge>>>({});
  const [claimingChallengeId, setClaimingChallengeId] = useState<number | null>(null);
  const [shopBalanceOverride, setShopBalanceOverride] = useState<number | null>(null);
  const [shopItemOverrides, setShopItemOverrides] = useState<Record<number, Partial<ShopItem>>>({});
  const [purchasingShopItemId, setPurchasingShopItemId] = useState<number | null>(null);
  const [showcaseKeysOverride, setShowcaseKeysOverride] = useState<Set<string> | null>(null);
  const [isSavingShowcase, setIsSavingShowcase] = useState(false);

  // 🔴 `error` is read here and nowhere else among these eight loads, deliberately.
  // The profile is what the whole screen hangs off; the other seven fill in sections.
  // Before this, none of the eight `error` values was read at all — the only four uses
  // of `error` in this file are user ACTIONS (claim, purchase, save) — so a failed load
  // had no path to the member at all: no message, no retry, nothing.
  //
  // 🔴 Scope, honestly: this does NOT explain the blank screen observed on the emulator
  // on 2026-08-19, and must not be described as fixing it. Instrumenting this render
  // showed `isLoading: false, hasProfile: true, profileErr: null` while the body painted
  // nothing at all — data present, no error, still blank — so that is a separate and
  // still-open RENDERING defect. See docs/PRODUCTION_READINESS.md; the leading suspicion
  // is the zero-size layout failure documented at the top of `app/+not-found.tsx`, which
  // bit that screen twice. This change is worth making on its own merits, because a
  // genuine load failure previously had no way to reach the member either.
  const {
    data: profileData,
    isLoading: profileLoading,
    error: profileError,
    refresh: refreshProfile,
  } = useApi(
    () => getGamificationProfile(),
    [],
  );
  const { data: badgesData, isLoading: badgesLoading, refresh: refreshBadges } = useApi(
    () => getBadges(),
    [],
  );
  const { data: leaderboardData, isLoading: lbLoading, refresh: refreshLb } = useApi(
    () => getLeaderboard(period),
    [period],
  );
  const { data: nexusScoreData, isLoading: scoreLoading, refresh: refreshScore } = useApi(
    () => getNexusScore(),
    [],
  );
  const { data: dailyRewardData, isLoading: rewardLoading, refresh: refreshReward } = useApi(
    () => getDailyRewardStatus(),
    [],
  );
  const { data: challengesData, isLoading: challengesLoading, refresh: refreshChallenges } = useApi(
    () => getChallenges(),
    [],
  );
  const { data: collectionsData, isLoading: collectionsLoading, refresh: refreshCollections } = useApi(
    () => getBadgeCollections(),
    [],
  );
  const { data: shopData, isLoading: shopLoading, refresh: refreshShop } = useApi(
    () => getShopItems(),
    [],
  );

  useEffect(() => {
    if (isRefreshing && !profileLoading && !badgesLoading && !lbLoading && !scoreLoading && !rewardLoading && !challengesLoading && !collectionsLoading && !shopLoading) {
      setIsRefreshing(false);
    }
  }, [isRefreshing, profileLoading, badgesLoading, lbLoading, scoreLoading, rewardLoading, challengesLoading, collectionsLoading, shopLoading]);

  function handleRefresh() {
    setIsRefreshing(true);
    refreshProfile();
    refreshBadges();
    refreshLb();
    refreshScore();
    refreshReward();
    refreshChallenges();
    refreshCollections();
    refreshShop();
  }

  function selectTab(tab: Tab) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(tab);
  }

  function selectPeriod(nextPeriod: LeaderboardPeriod) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPeriod(nextPeriod);
  }

  async function handleClaimDailyReward() {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsClaimingReward(true);
    try {
      const response = await claimDailyReward();
      const reward = response.data.reward;
      const current = dailyRewardOverride ?? dailyRewardData?.data ?? null;
      setDailyRewardOverride({
        claimed_today: true,
        reward_xp: current?.reward_xp ?? reward?.xp_earned ?? 0,
        next_reward_xp: current?.next_reward_xp ?? reward?.xp_earned ?? 0,
        current_streak: reward?.streak_day ?? (current?.current_streak ?? 0) + 1,
      });
      showToast({ title: t('dailyReward.claimedTitle'), description: t('dailyReward.claimedMessage', { xp: reward?.xp_earned ?? current?.reward_xp ?? 0 }), variant: 'success' });
      refreshProfile();
      refreshBadges();
      refreshReward();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('dailyReward.claimError'), variant: 'danger' });
    } finally {
      setIsClaimingReward(false);
    }
  }

  async function handleClaimChallengeReward(challengeId: number) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setClaimingChallengeId(challengeId);
    try {
      await claimChallengeReward(challengeId);
      setChallengeOverrides((current) => ({
        ...current,
        [challengeId]: { reward_claimed: true, is_completed: true },
      }));
      showToast({ title: t('challenges.claimedTitle'), description: t('challenges.claimedMessage'), variant: 'success' });
      refreshProfile();
      refreshChallenges();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('challenges.claimError'), variant: 'danger' });
    } finally {
      setClaimingChallengeId(null);
    }
  }

  async function handlePurchaseShopItem(item: ShopItem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const cost = getShopItemCost(item);
    const currentBalance = shopBalanceOverride ?? shopData?.meta?.user_xp ?? getProfileXp((profileData?.data ?? {}) as ApiProfile);
    if (currentBalance < cost) {
      showToast({ title: t('shop.notEnoughXp'), description: t('shop.notEnoughXpDescription', { xp: cost - currentBalance }), variant: 'warning' });
      return;
    }

    setPurchasingShopItemId(item.id);
    try {
      await purchaseShopItem(item.id);
      setShopItemOverrides((current) => ({
        ...current,
        [item.id]: { user_purchases: numberOrFallback(item.user_purchases) + 1, can_purchase: false },
      }));
      setShopBalanceOverride(currentBalance - cost);
      showToast({ title: t('shop.purchaseComplete'), description: t('shop.purchaseCompleteDescription', { name: item.name }), variant: 'success' });
      refreshProfile();
      refreshShop();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('shop.purchaseError'), variant: 'danger' });
    } finally {
      setPurchasingShopItemId(null);
    }
  }

  function getSelectedShowcaseKeys(currentBadges: ApiBadge[]) {
    return showcaseKeysOverride ?? new Set(currentBadges.filter((badge) => badge.is_showcased).map(getBadgeShowcaseKey));
  }

  function handleToggleShowcaseBadge(badge: ApiBadge) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const key = getBadgeShowcaseKey(badge);
    const next = new Set(getSelectedShowcaseKeys(badges));
    if (next.has(key)) {
      next.delete(key);
    } else if (next.size < 5) {
      next.add(key);
    }
    setShowcaseKeysOverride(next);
  }

  async function handleSaveShowcase() {
    const selectedKeys = Array.from(getSelectedShowcaseKeys(badges));
    setIsSavingShowcase(true);
    try {
      await updateBadgeShowcase(selectedKeys);
      setShowcaseKeysOverride(new Set(selectedKeys));
      showToast({ title: t('showcase.updated'), description: t('showcase.updatedDescription'), variant: 'success' });
      refreshBadges();
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('showcase.saveError'), variant: 'danger' });
    } finally {
      setIsSavingShowcase(false);
    }
  }

  const profile = (profileData?.data ?? null) as ApiProfile | null;
  const badges = useMemo(() => (badgesData?.data ?? []) as ApiBadge[], [badgesData?.data]);
  const leaderboardEntries = (leaderboardData?.data ?? []) as ApiLeaderboardEntry[];
  const nexusScore = (nexusScoreData?.data ?? null) as ApiNexusScore | null;
  const dailyReward = dailyRewardOverride ?? dailyRewardData?.data ?? null;
  const challenges = ((challengesData?.data ?? []) as Challenge[]).map((challenge) => ({
    ...challenge,
    ...(challengeOverrides[challenge.id] ?? {}),
  }));
  const collections = (collectionsData?.data ?? []) as BadgeCollection[];
  const shopItems = ((shopData?.data ?? []) as ShopItem[]).map((item) => ({
    ...item,
    ...(shopItemOverrides[item.id] ?? {}),
  }));
  const shopBalance = shopBalanceOverride ?? shopData?.meta?.user_xp ?? (profile ? getProfileXp(profile) : 0);
  const userRank = leaderboardData?.meta?.user_rank ?? leaderboardData?.meta?.your_position ?? null;
  const earnedCount = useMemo(() => badges.filter((badge) => isBadgeEarned(badge)).length, [badges]);
  const lockedCount = Math.max(0, badges.length - earnedCount);
  const selectedShowcaseKeys = getSelectedShowcaseKeys(badges);

  const periods: { key: LeaderboardPeriod; label: string }[] = [
    { key: 'weekly', label: t('leaderboard.weekly') },
    { key: 'monthly', label: t('leaderboard.monthly') },
    { key: 'all_time', label: t('leaderboard.allTime') },
  ];

  // 🔴 `lbLoading` was missing from this list while being present in the two refresh
  // effects above, so the screen could paint before the leaderboard arrived — which is
  // the tab a `/leaderboard` link opens on.
  const isLoading = profileLoading || badgesLoading || lbLoading || scoreLoading || rewardLoading || challengesLoading || collectionsLoading || shopLoading;

  // Nothing to show AND the load failed. Partial failures deliberately do not reach here:
  // if the profile arrived, the sections that loaded are still worth showing.
  const hasFailedOutright = Boolean(profileError) && !profile;

  return (
    <ModalErrorBoundary>
      {/*
        🔴 `style={{ flex: 1 }}` is load-bearing, and `className` here is DEAD.

        This SafeAreaView comes from `react-native-safe-area-context`. uniwind patches
        className onto React Native's OWN components (its resolver list includes
        `SafeAreaView` — the one in `react-native`), but it does not touch third-party
        packages, and nothing registers this one. So `className="flex-1 bg-background"`
        set neither the flex nor the background: it was inert.

        Consequence, isolated on a device rather than guessed: with no flex on the parent,
        the SafeAreaView sized to its content, so the top bar rendered and the ScrollView
        below it — sized with `flex-1` — collapsed to ZERO HEIGHT. The screen showed a
        title bar above a permanently blank body, with the data present and no error.
        A fixed-height probe placed as a sibling of the ScrollView rendered; the same probe
        placed INSIDE it did not. Adding this style made 1.75M pixels appear.

        The className is left in place deliberately: it is what every other screen in this
        app writes, and removing it here would hide that this whole pattern is inert. See
        `lib/security/../components/safeAreaFlex.test.ts` for the guard and the wider count.
      */}
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/home" />

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <LoadingSpinner />
          </View>
        ) : hasFailedOutright ? (
          <ErrorState
            testID="gamification-load-failed"
            onRetry={handleRefresh}
            isRetrying={isRefreshing}
          />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ gap: 16, paddingHorizontal: 16, paddingBottom: 40 }}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={handleRefresh}
                tintColor={primary}
                colors={[primary]}
              />
            }
          >
            {profile ? (
              <ProfileSection
                profile={profile}
                earnedCount={earnedCount}
                lockedCount={lockedCount}
                userRank={userRank}
                primary={primary}
                theme={theme}
                t={t}
              />
            ) : null}

            <DailyRewardCard
              status={dailyReward}
              isClaiming={isClaimingReward}
              onClaim={handleClaimDailyReward}
              primary={primary}
              theme={theme}
              t={t}
            />

            <Surface variant="default" className="gap-3 rounded-panel p-3">
              <View className="flex-row gap-2">
                <SegmentButton
                  label={t('badges.title')}
                  isSelected={activeTab === 'badges'}
                  onPress={() => selectTab('badges')}
                />
                <SegmentButton
                  label={t('challenges.title')}
                  isSelected={activeTab === 'challenges'}
                  onPress={() => selectTab('challenges')}
                />
                <SegmentButton
                  label={t('journeys.title')}
                  isSelected={activeTab === 'journeys'}
                  onPress={() => selectTab('journeys')}
                />
                <SegmentButton
                  label={t('leaderboard.title')}
                  isSelected={activeTab === 'leaderboard'}
                  onPress={() => selectTab('leaderboard')}
                />
                <SegmentButton
                  label={t('nexusScore.title')}
                  isSelected={activeTab === 'score'}
                  onPress={() => selectTab('score')}
                />
                <SegmentButton
                  label={t('shop.title')}
                  isSelected={activeTab === 'shop'}
                  onPress={() => selectTab('shop')}
                />
              </View>

              {activeTab === 'leaderboard' ? (
                <View className="flex-row gap-2">
                  {periods.map((periodOption) => (
                    <HeroButton
                      key={periodOption.key}
                      className="flex-1"
                      size="sm"
                      variant={period === periodOption.key ? 'primary' : 'tertiary'}
                      onPress={() => selectPeriod(periodOption.key)}
                      accessibilityState={{ selected: period === periodOption.key }}
                    >
                      <HeroButton.Label>{periodOption.label}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </View>
              ) : null}
            </Surface>

            {activeTab === 'score' ? (
              <NexusScoreSection score={nexusScore} primary={primary} theme={theme} t={t} />
            ) : activeTab === 'challenges' ? (
              <ChallengesSection challenges={challenges} claimingId={claimingChallengeId} onClaim={handleClaimChallengeReward} primary={primary} theme={theme} t={t} />
            ) : activeTab === 'journeys' ? (
              <JourneysSection collections={collections} primary={primary} theme={theme} t={t} />
            ) : activeTab === 'shop' ? (
              <ShopSection items={shopItems} balance={shopBalance} purchasingId={purchasingShopItemId} onPurchase={handlePurchaseShopItem} primary={primary} theme={theme} t={t} />
            ) : activeTab === 'badges' ? (
              badges.length > 0 ? (
                <View className="gap-3">
                  <ShowcaseManager
                    badges={badges}
                    selectedKeys={selectedShowcaseKeys}
                    saving={isSavingShowcase}
                    onToggle={handleToggleShowcaseBadge}
                    onSave={handleSaveShowcase}
                    primary={primary}
                    theme={theme}
                    t={t}
                  />
                  <View className="flex-row flex-wrap gap-3">
                    {badges.map((badge) => (
                      <BadgeCard key={getBadgeKey(badge)} badge={badge} primary={primary} theme={theme} t={t} />
                    ))}
                  </View>
                </View>
              ) : (
                <EmptyState icon="ribbon-outline" message={t('badges.empty')} primary={primary} />
              )
            ) : leaderboardEntries.length > 0 ? (
              <View>
                {leaderboardEntries.map((entry) => (
                  <LeaderboardRow
                    key={`${getLeaderboardRank(entry)}-${entry.user.id}`}
                    entry={entry}
                    isCurrentUser={entry.is_current_user === true || (userRank !== null && getLeaderboardRank(entry) === userRank)}
                    primary={primary}
                    theme={theme}
                    t={t}
                  />
                ))}
              </View>
            ) : (
              <EmptyState icon="podium-outline" message={t('leaderboard.empty')} primary={primary} />
            )}

            {lbLoading && activeTab === 'leaderboard' ? (
              <View className="items-center py-4">
                <LoadingSpinner />
              </View>
            ) : null}
          </ScrollView>
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
