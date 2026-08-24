// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), patch: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import { claimChallengeReward, claimDailyReward, getBadgeCollections, getChallenges, getDailyRewardStatus, getGamificationProfile, getBadges, getLeaderboard, getNexusScore, getShopItems, purchaseShopItem, updateBadgeShowcase } from './gamification';
import type { BadgeCollection, Challenge, DailyRewardStatus, GamificationProfile, Badge, LeaderboardResponse, NexusScoreData, ShopItem } from './gamification';

const mockBadge: Badge = {
  id: 1,
  name: 'First Exchange',
  description: 'Completed your first exchange',
  icon: 'star',
  earned_at: '2026-01-10T12:00:00Z',
  is_earned: true,
};

/*
  🔴 The keys `GET /v2/gamification/profile` actually returns, read off the live API on
  2026-08-24. The previous fixture put `next_level_xp`, `badges`, `rank` and `streak_days`
  in the profile; the server sends none of them, so it was testing a shape that does not
  exist while the real screens got by on fallbacks.
*/
const mockProfile: GamificationProfile = {
  xp: 250,
  level: 3,
  level_name: 'Contributor',
  level_progress: { current_xp: 250, xp_for_next_level: 500, progress_percentage: 50 },
  badges_count: 1,
  showcased_badges: [mockBadge],
  is_own_profile: true,
};

const mockLeaderboardResponse: LeaderboardResponse = {
  data: [
    {
      rank: 1,
      user: { id: 5, name: 'Top User', avatar: null },
      xp: 1500,
      level: 10,
      badges_count: 8,
    },
  ],
  meta: { total: 50, user_rank: 12 },
};

const mockNexusScore: NexusScoreData = {
  total_score: 620,
  max_score: 1000,
  percentage: 62,
  percentile: 78,
  tier: { name: 'Advanced' },
  breakdown: [{ key: 'engagement', label: 'Engagement', score: 120, max: 200, percentage: 60 }],
  insights: ['Keep exchanging to grow your score.'],
};

const mockDailyReward: DailyRewardStatus = {
  claimed_today: false,
  reward_xp: 20,
  next_reward_xp: 25,
  current_streak: 3,
};

const mockChallenge: Challenge = {
  id: 10,
  title: 'Complete three exchanges',
  description: 'Finish three exchanges this month.',
  reward_xp: 50,
  user_progress: 2,
  target_count: 3,
  end_date: null,
  is_completed: false,
  reward_claimed: false,
};

const mockCollection: BadgeCollection = {
  id: 7,
  name: 'Exchange Starter',
  description: 'Complete your first exchange journey.',
  badges: [{ badge_key: 'first_exchange', name: 'First Exchange', icon: 'swap-horizontal', earned: true }],
  earned_count: 1,
  total_count: 3,
  reward_xp: 100,
  completed: false,
};

const mockShopItem: ShopItem = {
  id: 12,
  name: 'Profile Sparkle',
  description: 'Add sparkle to your profile.',
  cost_xp: 75,
  xp_cost: 75,
  item_type: 'theme',
  icon: null,
  can_purchase: true,
  user_purchases: 0,
  stock_limit: 4,
  is_active: true,
};

describe('getGamificationProfile', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with no params', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockProfile });
    const result = await getGamificationProfile();
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/profile');
    expect(result.data.xp).toBe(250);
    expect(result.data.level).toBe(3);
    // Progress comes from `level_progress`, which is what the server sends. `next_level_xp`
    // and `streak_days` are NOT in the response — see the fixture note above.
    expect(result.data.level_progress?.xp_for_next_level).toBe(500);
  });

  it('carries the showcased badges the profile really contains', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockProfile });
    const result = await getGamificationProfile();
    // 🔴 Not `badges`: the profile endpoint sends `showcased_badges` and `badges_count`, and
    // the full list comes from GET /v2/gamification/badges.
    expect(result.data.showcased_badges).toHaveLength(1);
    expect(result.data.showcased_badges?.[0]?.name).toBe('First Exchange');
    expect(result.data.badges_count).toBe(1);
  });

  it('passes a target user id when loading another member profile', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockProfile });
    await getGamificationProfile(195);
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/profile', { user_id: '195' });
  });
});

describe('getBadges', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct badges endpoint with no params', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [mockBadge] });
    const result = await getBadges();
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/badges');
    expect(result.data).toHaveLength(1);
    expect(result.data[0].is_earned).toBe(true);
  });

  it('passes a target user id when loading another member badges', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [mockBadge] });
    await getBadges(195);
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/badges', { user_id: '195' });
  });
});

describe('getLeaderboard', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls the correct endpoint with default period (monthly)', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockLeaderboardResponse);
    const result = await getLeaderboard();
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/leaderboard', { period: 'month' });
    expect(result.data).toHaveLength(1);
    expect(result.meta.user_rank).toBe(12);
  });

  it('passes weekly period when specified', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockLeaderboardResponse);
    await getLeaderboard('weekly');
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/leaderboard', { period: 'week' });
  });

  it('passes all_time period when specified', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockLeaderboardResponse);
    await getLeaderboard('all_time');
    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/leaderboard', { period: 'all' });
  });
});

describe('getNexusScore', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads the current user Nexus Score breakdown', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockNexusScore });

    const result = await getNexusScore();

    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/nexus-score');
    expect(result.data.total_score).toBe(620);
    expect(result.data.breakdown[0].key).toBe('engagement');
  });

  it('passes force refresh when requested', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockNexusScore });

    await getNexusScore(true);

    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/nexus-score', { force: 'true' });
  });
});

describe('daily rewards', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads daily reward status', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: mockDailyReward });

    const result = await getDailyRewardStatus();

    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/daily-reward');
    expect(result.data.reward_xp).toBe(20);
  });

  it('claims the daily reward', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { claimed: true, reward: { xp_earned: 20, streak_day: 4 } } });

    const result = await claimDailyReward();

    expect(api.post).toHaveBeenCalledWith('/api/v2/gamification/daily-reward');
    expect(result.data.reward?.streak_day).toBe(4);
  });
});

describe('challenges', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads gamification challenges', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [mockChallenge] });

    const result = await getChallenges();

    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/challenges');
    expect(result.data[0].title).toBe('Complete three exchanges');
  });

  it('claims a completed challenge reward', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await claimChallengeReward(10);

    expect(api.post).toHaveBeenCalledWith('/api/v2/gamification/challenges/10/claim');
  });
});

describe('getBadgeCollections', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads badge collections and progress data', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [mockCollection] });

    const result = await getBadgeCollections();

    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/collections');
    expect(result.data[0].badges[0].badge_key).toBe('first_exchange');
  });
});

describe('XP shop', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('loads shop items and XP balance metadata', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: [mockShopItem], meta: { user_xp: 250 } });

    const result = await getShopItems();

    expect(api.get).toHaveBeenCalledWith('/api/v2/gamification/shop');
    expect(result.data[0].name).toBe('Profile Sparkle');
    expect(result.meta?.user_xp).toBe(250);
  });

  it('purchases a shop item', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });

    await purchaseShopItem(12);

    expect(api.post).toHaveBeenCalledWith('/api/v2/gamification/shop/purchase', { item_id: 12 });
  });
});

describe('updateBadgeShowcase', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('saves showcased badge keys', async () => {
    (api.put as jest.Mock).mockResolvedValue({ data: {} });

    await updateBadgeShowcase(['first_exchange', 'welcome']);

    expect(api.put).toHaveBeenCalledWith('/api/v2/gamification/showcase', { badge_keys: ['first_exchange', 'welcome'] });
  });
});
