// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
  * 🔴 Measured against `GET /v2/gamification/badges` on 2026-08-24. The server sends
  * `awarded_at`, `claimed_at` AND `earned_at` — and does NOT send `is_earned`, which was
  * declared required here. That is the field whose absence rendered all ten of a member's
  * earned badges as "Locked" behind a padlock (row 8.1): `earned_at` is null on rows that
  * `awarded_at` fills in.
  */
export interface Badge {
  id: number;
  name: string;
  description: string;
  icon: string;
  earned_at: string | null;
  /** The one the server actually fills in when a badge has been earned. */
  awarded_at?: string | null;
  claimed_at?: string | null;
  /** NOT sent by the API. Kept optional for callers that compute it themselves. */
  is_earned?: boolean;
}

/**
  * 🔴 Measured against `GET /v2/gamification/profile` on 2026-08-24. Of the six fields this
  * declared required, FOUR are never sent: `next_level_xp`, `badges`, `rank` and
  * `streak_days`. The screens survive only because they were written defensively —
  * `numberOrFallback(profile.next_level_xp, profile.level_progress?.xp_for_next_level, …)` —
  * but `profile.badges.map(...)` would have compiled and crashed. What the server does send
  * and this type did not mention is listed below.
  */
export interface GamificationProfile {
  xp: number;
  level: number;
  /** Absent from the response; read `level_progress.xp_for_next_level` instead. */
  next_level_xp?: number;
  level_progress?: {
    current_xp?: number;
    xp_for_current_level?: number;
    xp_for_next_level?: number;
    progress_percentage?: number;
  };
  /** Absent from the response. Badges come from `GET /v2/gamification/badges`. */
  badges?: Badge[];
  badges_count?: number;
  showcased_badges?: Badge[];
  /** Absent from the response; the leaderboard endpoint carries a member's rank. */
  rank?: number | null;
  /** Absent from the response. */
  streak_days?: number;
  // Sent, and previously undeclared:
  level_name?: string | null;
  level_thresholds?: Record<string, number> | number[];
  xp_values?: Record<string, number>;
  is_own_profile?: boolean;
  user?: { id: number; name?: string | null; avatar_url?: string | null } | null;
}

export interface LeaderboardEntry {
  rank: number;
  user: {
    id: number;
    name: string;
    avatar: string | null;
  };
  xp: number;
  level: number;
  badges_count: number;
}

export interface LeaderboardResponse {
  data: LeaderboardEntry[];
  meta: {
    total: number;
    user_rank: number | null;
    your_position?: number | null;
  };
}

export interface NexusScoreCategory {
  key: string;
  label: string;
  score: number;
  max: number;
  percentage: number;
  details?: Record<string, unknown>;
}

export interface NexusScoreData {
  total_score: number;
  max_score: number;
  percentage: number;
  percentile: number;
  tier: {
    name: string;
    icon?: string | null;
    color?: string | null;
  };
  breakdown: NexusScoreCategory[];
  insights: (string | Record<string, string>)[];
}

export interface DailyRewardStatus {
  claimed_today: boolean;
  reward_xp: number;
  next_reward_xp: number;
  current_streak: number;
}

export interface DailyRewardClaimResponse {
  claimed: boolean;
  reward?: {
    xp_earned?: number;
    streak_day?: number;
  };
}

export interface Challenge {
  id: number;
  title: string;
  description: string;
  reward_xp: number;
  user_progress: number;
  target_count: number;
  end_date: string | null;
  is_completed: boolean;
  reward_claimed: boolean;
  progress_percent?: number;
  challenge_type?: string;
}

export interface BadgeCollection {
  id: number;
  name: string;
  description: string;
  badges: {
    badge_key: string;
    name: string;
    icon: string | null;
    earned: boolean;
  }[];
  earned_count: number;
  total_count: number;
  reward_xp: number;
  completed: boolean;
}

export interface ShopItem {
  id: number;
  name: string;
  description: string;
  cost_xp?: number;
  xp_cost?: number;
  item_type: string;
  icon: string | null;
  can_purchase: boolean;
  user_purchases: number;
  stock_limit: number | null;
  is_active: boolean;
}

export interface ShopResponse {
  data: ShopItem[];
  meta?: {
    user_xp?: number;
  };
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * GET /api/v2/gamification/profile
 * Returns the current user's XP, level, rank, streak, and earned badges.
 */
export function getGamificationProfile(userId?: number): Promise<{ data: GamificationProfile }> {
  if (userId) {
    return api.get<{ data: GamificationProfile }>(`${API_V2}/gamification/profile`, { user_id: String(userId) });
  }
  return api.get<{ data: GamificationProfile }>(`${API_V2}/gamification/profile`);
}

/**
 * GET /api/v2/gamification/badges
 * Returns all badges (earned and locked) for the current user.
 */
export function getBadges(userId?: number): Promise<{ data: Badge[] }> {
  if (userId) {
    return api.get<{ data: Badge[] }>(`${API_V2}/gamification/badges`, { user_id: String(userId) });
  }
  return api.get<{ data: Badge[] }>(`${API_V2}/gamification/badges`);
}

/**
 * GET /api/v2/gamification/leaderboard
 * Returns ranked leaderboard entries for the given time period.
 *
 * @param period  'weekly' | 'monthly' | 'all_time' (default: 'monthly')
 */
export function getLeaderboard(
  period: 'weekly' | 'monthly' | 'all_time' = 'monthly',
): Promise<LeaderboardResponse> {
  const apiPeriod = period === 'weekly' ? 'week' : period === 'monthly' ? 'month' : 'all';
  return api.get<LeaderboardResponse>(`${API_V2}/gamification/leaderboard`, { period: apiPeriod });
}

/**
 * GET /api/v2/gamification/nexus-score
 * Returns the current user's reputation score breakdown.
 */
export function getNexusScore(force = false): Promise<{ data: NexusScoreData }> {
  if (force) {
    return api.get<{ data: NexusScoreData }>(`${API_V2}/gamification/nexus-score`, { force: 'true' });
  }
  return api.get<{ data: NexusScoreData }>(`${API_V2}/gamification/nexus-score`);
}

/**
 * GET /api/v2/gamification/daily-reward
 * Returns today's claim status and streak reward.
 */
export function getDailyRewardStatus(): Promise<{ data: DailyRewardStatus }> {
  return api.get<{ data: DailyRewardStatus }>(`${API_V2}/gamification/daily-reward`);
}

/**
 * POST /api/v2/gamification/daily-reward
 * Claims today's XP reward.
 */
export function claimDailyReward(): Promise<{ data: DailyRewardClaimResponse }> {
  return api.post<{ data: DailyRewardClaimResponse }>(`${API_V2}/gamification/daily-reward`);
}

/**
 * GET /api/v2/gamification/challenges
 * Returns active and completed gamification challenges.
 */
export function getChallenges(): Promise<{ data: Challenge[] }> {
  return api.get<{ data: Challenge[] }>(`${API_V2}/gamification/challenges`);
}

/**
 * POST /api/v2/gamification/challenges/{id}/claim
 * Claims XP for a completed challenge.
 */
export function claimChallengeReward(challengeId: number): Promise<{ data?: unknown }> {
  return api.post<{ data?: unknown }>(`${API_V2}/gamification/challenges/${challengeId}/claim`);
}

/**
 * GET /api/v2/gamification/collections
 * Returns badge collections/journeys and their completion progress.
 */
export function getBadgeCollections(): Promise<{ data: BadgeCollection[] }> {
  return api.get<{ data: BadgeCollection[] }>(`${API_V2}/gamification/collections`);
}

/**
 * GET /api/v2/gamification/shop
 * Returns purchasable XP shop rewards.
 */
export function getShopItems(): Promise<ShopResponse> {
  return api.get<ShopResponse>(`${API_V2}/gamification/shop`);
}

/**
 * POST /api/v2/gamification/shop/purchase
 * Purchases an XP shop item.
 */
export function purchaseShopItem(itemId: number): Promise<{ data?: unknown }> {
  return api.post<{ data?: unknown }>(`${API_V2}/gamification/shop/purchase`, { item_id: itemId });
}

/**
 * PUT /api/v2/gamification/showcase
 * Updates the badge keys shown on the user's profile.
 */
export function updateBadgeShowcase(badgeKeys: string[]): Promise<{ data?: unknown }> {
  return api.put<{ data?: unknown }>(`${API_V2}/gamification/showcase`, { badge_keys: badgeKeys });
}
