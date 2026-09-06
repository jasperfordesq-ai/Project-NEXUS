// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  usePathname: () => '/(modals)/gamification',
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'gamification:title': 'Gamification',
        title: 'Gamification',
        subtitle: 'Track your level, badges, streak, and community standing.',
        heroEyebrow: 'Community progress',
        'common:back': 'Back',
        'stats.totalXp': 'Total XP',
        'stats.earnedBadges': 'Earned badges',
        'stats.lockedBadges': 'Locked badges',
        'stats.rank': 'Current rank',
        'stats.streak': 'Streak',
        'gamification:level': opts ? `Level ${String(opts.level ?? 1)}` : 'Level 1',
        level: opts ? `Level ${String(opts.level ?? 1)}` : 'Level 1',
        'gamification:rank': opts ? `Rank #${String(opts.rank ?? 1)}` : 'Rank #1',
        rank: opts ? `Rank #${String(opts.rank ?? 1)}` : 'Rank #1',
        'gamification:unranked': 'Unranked',
        unranked: 'Unranked',
        'gamification:streak': opts ? `${String(opts.days ?? 0)} day streak` : '0 day streak',
        streak: opts ? `${String(opts.days ?? 0)} day streak` : '0 day streak',
        streakNone: 'No active streak',
        'gamification:xp': opts ? `${String(opts.xp ?? 0)} XP` : '0 XP',
        xp: opts ? `${String(opts.xp ?? 0)} XP` : '0 XP',
        'gamification:nextLevel': opts ? `${String(opts.xp ?? 0)} XP to next level` : '0 XP to next level',
        nextLevel: opts ? `${String(opts.xp ?? 0)} XP to next level` : '0 XP to next level',
        'gamification:badges.title': 'Badges',
        'badges.title': 'Badges',
        'gamification:badges.empty': 'No badges yet.',
        'badges.empty': 'No badges yet.',
        'gamification:badges.earned': 'Earned',
        'badges.earned': 'Earned',
        'gamification:badges.locked': 'Locked',
        'badges.locked': 'Locked',
        'gamification:leaderboard.title': 'Leaderboard',
        'leaderboard.title': 'Leaderboard',
        'gamification:leaderboard.empty': 'No leaderboard data.',
        'leaderboard.empty': 'No leaderboard data.',
        'gamification:leaderboard.weekly': 'Weekly',
        'leaderboard.weekly': 'Weekly',
        'gamification:leaderboard.monthly': 'Monthly',
        'leaderboard.monthly': 'Monthly',
        'gamification:leaderboard.allTime': 'All Time',
        'leaderboard.allTime': 'All Time',
        'gamification:leaderboard.you': 'You',
        'leaderboard.you': 'You',
        'leaderboard.badgesCount': opts ? `${String(opts.count ?? 0)} badges` : '0 badges',
        'nexusScore.title': 'Nexus Score',
        'nexusScore.eyebrow': 'Reputation score',
        'nexusScore.subtitle': 'See your reputation breakdown.',
        'nexusScore.total': 'Total score',
        'nexusScore.scoreValue': opts ? `${String(opts.score ?? 0)} / ${String(opts.max ?? 0)}` : '0 / 0',
        'nexusScore.percentile': opts ? `Top ${String(opts.percentile ?? 0)} percentile` : 'Top 0 percentile',
        'nexusScore.categoryScore': opts ? `${String(opts.score ?? 0)} of ${String(opts.max ?? 0)}` : '0 of 0',
        'nexusScore.percent': opts ? `${String(opts.percent ?? 0)}%` : '0%',
        'nexusScore.insights': 'Insights',
        'nexusScore.empty': 'No Nexus Score yet.',
        'nexusScore.tierFallback': 'Starter',
        'dailyReward.title': 'Daily reward',
        'dailyReward.claimToday': opts ? `Claim ${String(opts.xp ?? 0)} XP today` : 'Claim XP today',
        'dailyReward.comeBackTomorrow': opts ? `Come back tomorrow for ${String(opts.xp ?? 0)} XP` : 'Come back tomorrow',
        'dailyReward.streak': opts ? `${String(opts.count ?? 0)} day streak` : '0 day streak',
        'dailyReward.claimReward': 'Claim reward',
        'dailyReward.claiming': 'Claiming',
        'dailyReward.claimed': 'Claimed',
        'dailyReward.claimedTitle': 'Reward claimed',
        'dailyReward.claimedMessage': opts ? `You earned ${String(opts.xp ?? 0)} XP.` : 'Reward claimed.',
        'dailyReward.claimError': 'Could not claim reward.',
        'challenges.title': 'Challenges',
        'challenges.empty': 'No challenges yet.',
        'challenges.active': 'Active challenges',
        'challenges.completed': 'Completed challenges',
        'challenges.xpReward': opts ? `${String(opts.xp ?? 0)} XP` : '0 XP',
        'challenges.progress': opts ? `${String(opts.current ?? 0)} / ${String(opts.target ?? 0)}` : '0 / 0',
        'challenges.claimXp': opts ? `Claim ${String(opts.xp ?? 0)} XP` : 'Claim XP',
        'challenges.claimed': 'Claimed',
        'challenges.claimedTitle': 'Challenge claimed',
        'challenges.claimedMessage': 'Challenge reward claimed.',
        'challenges.claimError': 'Could not claim challenge.',
        'journeys.title': 'Journeys',
        'journeys.empty': 'No journeys yet.',
        'journeys.complete': 'Complete',
        'journeys.xpReward': opts ? `${String(opts.xp ?? 0)} XP` : '0 XP',
        'journeys.badgesCollected': opts ? `${String(opts.earned ?? 0)} of ${String(opts.total ?? 0)} badges` : '0 of 0 badges',
        'shop.title': 'Shop',
        'shop.yourBalance': opts ? `Balance: ${String(opts.xp ?? 0)} XP` : 'Balance: 0 XP',
        'shop.empty': 'No shop items yet.',
        'shop.xpCost': opts ? `${String(opts.xp ?? 0)} XP` : '0 XP',
        'shop.stockLeft': opts ? `${String(opts.count ?? 0)} left` : '0 left',
        'shop.owned': 'Owned',
        'shop.unavailable': 'Unavailable',
        'shop.purchase': 'Purchase',
        'shop.buying': 'Buying',
        'shop.purchaseItem': opts ? `Purchase ${String(opts.name ?? '')}` : 'Purchase item',
        'shop.purchaseComplete': 'Purchase complete',
        'shop.purchaseCompleteDescription': opts ? `${String(opts.name ?? '')} is yours.` : 'Purchased.',
        'shop.notEnoughXp': 'Not enough XP',
        'shop.notEnoughXpDescription': opts ? `You need ${String(opts.xp ?? 0)} more XP.` : 'You need more XP.',
        'shop.purchaseError': 'Could not purchase item.',
        'showcase.title': 'Profile showcase',
        'showcase.selectedCount': opts ? `${String(opts.count ?? 0)} selected` : '0 selected',
        'showcase.save': 'Save',
        'showcase.saving': 'Saving',
        'showcase.noBadgesEarned': 'No badges earned yet.',
        'showcase.toggleBadge': opts ? `Toggle ${String(opts.name ?? '')}` : 'Toggle badge',
        'showcase.selected': 'Selected',
        'showcase.select': 'Select',
        'showcase.updated': 'Showcase updated',
        'showcase.updatedDescription': 'Your profile showcase was updated.',
        'showcase.saveError': 'Could not save showcase.',
        'common:errors.alertTitle': 'Something went wrong',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/gamification', () => ({
  getGamificationProfile: jest.fn(),
  claimDailyReward: jest.fn().mockResolvedValue({ data: { claimed: true, reward: { xp_earned: 20, streak_day: 4 } } }),
  claimChallengeReward: jest.fn().mockResolvedValue({ data: {} }),
  getBadges: jest.fn(),
  getBadgeCollections: jest.fn(),
  getChallenges: jest.fn(),
  getDailyRewardStatus: jest.fn(),
  getLeaderboard: jest.fn(),
  getNexusScore: jest.fn(),
  getShopItems: jest.fn(),
  purchaseShopItem: jest.fn().mockResolvedValue({ data: {} }),
  updateBadgeShowcase: jest.fn().mockResolvedValue({ data: {} }),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// --- Tests ---

import GamificationScreen from './gamification';
import { claimChallengeReward, claimDailyReward, purchaseShopItem, updateBadgeShowcase } from '@/lib/api/gamification';
import { useAppToast } from '@/components/ui/AppToast';

// Grab the stable toast `show` mock to assert on branded toasts.
const { show: mockToastShow } = useAppToast();

const defaultLoadingState = { data: null, isLoading: true, error: null, refresh: jest.fn() };

beforeEach(() => {
  // Default: all loading so LoadingSpinner is rendered
  mockUseApi.mockReturnValue(defaultLoadingState);
  (mockToastShow as jest.Mock).mockClear();
  (claimDailyReward as jest.Mock).mockClear();
  (claimChallengeReward as jest.Mock).mockClear();
  (purchaseShopItem as jest.Mock).mockClear();
  (updateBadgeShowcase as jest.Mock).mockClear();
});

const mockProfile = {
  level: 3,
  xp: 750,
  next_level_xp: 1000,
  rank: 5,
  streak_days: 7,
};

/**
 * 🔴 The badge shape the server ACTUALLY sends.
 *
 * `mockBadge` below sets `is_earned: true` and `earned_at` — neither of which
 * `GET /v2/gamification/badges` returns. It populates `awarded_at` and leaves `earned_at`
 * and `claimed_at` null. So the earned check missed on every badge, and all ten of a
 * member's earned badges rendered as "Locked" behind a padlock. Measured on a device
 * 2026-08-23. Fourth fixture today written from the client's type instead of the response.
 */
const realAwardedBadge = {
  id: 2855,
  name: 'Team Player',
  description: 'joining your first group',
  icon: '👥',
  badge_key: 'group_join_1',
  awarded_at: '2026-08-23 13:03:44',
  earned_at: null,
  claimed_at: null,
  is_showcased: 0,
};

const mockBadge = {
  id: 1,
  name: 'First Exchange',
  description: 'Completed your first exchange.',
  icon: 'ribbon-outline',
  badge_key: 'first_exchange',
  is_earned: true,
  is_showcased: false,
  earned_at: '2026-01-15T10:00:00Z',
};

const mockNexusScore = {
  total_score: 620,
  max_score: 1000,
  percentage: 62,
  percentile: 78,
  tier: { name: 'Advanced' },
  breakdown: [{ key: 'engagement', label: 'Engagement', score: 120, max: 200, percentage: 60 }],
  insights: ['Keep exchanging to grow your score.'],
};

const mockDailyReward = {
  claimed_today: false,
  reward_xp: 20,
  next_reward_xp: 25,
  current_streak: 3,
};

const mockChallenges = [
  {
    id: 10,
    title: 'Complete three exchanges',
    description: 'Finish three exchanges this month.',
    reward_xp: 50,
    user_progress: 2,
    target_count: 3,
    end_date: '2026-06-01T00:00:00Z',
    is_completed: false,
    reward_claimed: false,
  },
  {
    id: 11,
    title: 'Welcome helper',
    description: 'Help a new member get started.',
    reward_xp: 25,
    user_progress: 1,
    target_count: 1,
    end_date: null,
    is_completed: true,
    reward_claimed: false,
  },
];

const mockCollections = [
  {
    id: 7,
    name: 'Exchange Starter',
    description: 'Complete your first exchange journey.',
    badges: [{ badge_key: 'first_exchange', name: 'First Exchange', icon: 'swap-horizontal', earned: true }],
    earned_count: 1,
    total_count: 3,
    reward_xp: 100,
    completed: false,
  },
  {
    id: 8,
    name: 'Community Builder',
    description: 'Collect core community badges.',
    badges: [{ badge_key: 'welcome', name: 'Welcome', icon: 'heart', earned: true }],
    earned_count: 3,
    total_count: 3,
    reward_xp: 0,
    completed: true,
  },
];

const mockShopItems = [
  {
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
  },
  {
    id: 13,
    name: 'Founding Badge',
    description: 'A badge you already own.',
    cost_xp: 10,
    xp_cost: 10,
    item_type: 'badge',
    icon: null,
    can_purchase: false,
    user_purchases: 1,
    stock_limit: null,
    is_active: true,
  },
];

function mockLoadedGamification({
  badges = [],
  leaderboard = [],
  score = mockNexusScore,
  reward = mockDailyReward,
  challenges = [],
  collections = [],
  shopItems = [],
  shopXp = 250,
}: {
  badges?: unknown[];
  leaderboard?: unknown[];
  score?: unknown;
  reward?: unknown;
  challenges?: unknown[];
  collections?: unknown[];
  shopItems?: unknown[];
  shopXp?: number;
} = {}) {
  mockUseApi.mockImplementation((loader: unknown) => {
    const source = String(loader);
    if (source.includes('getGamificationProfile')) {
      return { data: { data: mockProfile }, isLoading: false, error: null, refresh: jest.fn() };
    }
    if (source.includes('getBadges')) {
      return { data: { data: badges }, isLoading: false, error: null, refresh: jest.fn() };
    }
    if (source.includes('getLeaderboard')) {
      return { data: { data: leaderboard, meta: { user_rank: null } }, isLoading: false, error: null, refresh: jest.fn() };
    }
    if (source.includes('getNexusScore')) {
      return { data: { data: score }, isLoading: false, error: null, refresh: jest.fn() };
    }
    if (source.includes('getChallenges')) {
      return { data: { data: challenges }, isLoading: false, error: null, refresh: jest.fn() };
    }
    if (source.includes('getBadgeCollections')) {
      return { data: { data: collections }, isLoading: false, error: null, refresh: jest.fn() };
    }
    if (source.includes('getShopItems')) {
      return { data: { data: shopItems, meta: { user_xp: shopXp } }, isLoading: false, error: null, refresh: jest.fn() };
    }
    return { data: { data: reward }, isLoading: false, error: null, refresh: jest.fn() };
  });
}

describe('GamificationScreen', () => {
  it('renders loading state (no content visible) when APIs are loading', () => {
    // Default useApi mock returns isLoading:true for all three calls
    const { queryByText } = render(<GamificationScreen />);
    // Tab buttons should not be visible — profile+badges loading blocks render
    expect(queryByText('Badges')).toBeNull();
    expect(queryByText('Leaderboard')).toBeNull();
  });

  it('renders tab buttons when profile and badges data are loaded', () => {
    mockLoadedGamification();

    const { getByText } = render(<GamificationScreen />);
    expect(getByText('Badges')).toBeTruthy();
    expect(getByText('Leaderboard')).toBeTruthy();
    expect(getByText('Nexus Score')).toBeTruthy();
  });

  it('renders profile XP when loaded', () => {
    mockLoadedGamification();

    const { getByText } = render(<GamificationScreen />);
    expect(getByText('750 XP')).toBeTruthy();
  });

  it('renders badge cards when badges are loaded', () => {
    mockLoadedGamification({ badges: [mockBadge] });

    const { getAllByText } = render(<GamificationScreen />);
    expect(getAllByText('First Exchange').length).toBeGreaterThan(0);
  });

  it('selects and saves profile showcase badges', async () => {
    mockLoadedGamification({ badges: [mockBadge] });

    const { getByLabelText, getByText } = render(<GamificationScreen />);

    expect(getByText('Profile showcase')).toBeTruthy();
    expect(getByText('0 selected')).toBeTruthy();
    fireEvent.press(getByLabelText('Toggle First Exchange'));
    expect(getByText('1 selected')).toBeTruthy();
    fireEvent.press(getByText('Save'));

    expect(updateBadgeShowcase).toHaveBeenCalledWith(['first_exchange']);
    await Promise.resolve();
    expect(mockToastShow).toHaveBeenCalledWith({ title: 'Showcase updated', description: 'Your profile showcase was updated.', variant: 'success' });
  });

  it('switches to leaderboard tab when tapped', () => {
    let callCount = 0;
    mockUseApi.mockImplementation(() => {
      callCount += 1;
      const pos = ((callCount - 1) % 8) + 1;
      if (pos === 1) return { data: { data: mockProfile }, isLoading: false, error: null, refresh: jest.fn() };
      if (pos === 2) return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      if (pos === 3) return { data: { data: [], meta: { user_rank: null } }, isLoading: false, error: null, refresh: jest.fn() };
      if (pos === 4) return { data: { data: mockNexusScore }, isLoading: false, error: null, refresh: jest.fn() };
      if (pos === 5) return { data: { data: mockDailyReward }, isLoading: false, error: null, refresh: jest.fn() };
      if (pos === 6) return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      if (pos === 7) return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
      return { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() };
    });

    const { getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Leaderboard'));
    // After pressing Leaderboard tab, period selector appears
    expect(getByText('Weekly')).toBeTruthy();
    expect(getByText('Monthly')).toBeTruthy();
    expect(getByText('All Time')).toBeTruthy();
  });

  it('renders empty badges message when badge list is empty', () => {
    mockLoadedGamification();

    const { getByText } = render(<GamificationScreen />);
    expect(getByText('No badges yet.')).toBeTruthy();
  });

  it('renders Nexus Score breakdown when the score tab is selected', () => {
    mockLoadedGamification();

    const { getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Nexus Score'));

    expect(getByText('620 / 1000')).toBeTruthy();
    expect(getByText('Advanced')).toBeTruthy();
    expect(getByText('Engagement')).toBeTruthy();
    expect(getByText('120 of 200')).toBeTruthy();
    expect(getByText('Keep exchanging to grow your score.')).toBeTruthy();
  });

  it('claims the daily reward and shows a translated confirmation', async () => {
    mockLoadedGamification();

    const { getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Claim reward'));

    expect(claimDailyReward).toHaveBeenCalled();
    await Promise.resolve();
    expect(mockToastShow).toHaveBeenCalledWith({ title: 'Reward claimed', description: 'You earned 20 XP.', variant: 'success' });
  });

  it('renders challenges and claims a completed challenge reward', async () => {
    mockLoadedGamification({ challenges: mockChallenges });

    const { getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Challenges'));

    expect(getByText('Active challenges')).toBeTruthy();
    expect(getByText('Complete three exchanges')).toBeTruthy();
    expect(getByText('2 / 3')).toBeTruthy();
    expect(getByText('Completed challenges')).toBeTruthy();
    expect(getByText('Welcome helper')).toBeTruthy();

    fireEvent.press(getByText('Claim 25 XP'));

    expect(claimChallengeReward).toHaveBeenCalledWith(11);
    await Promise.resolve();
    expect(mockToastShow).toHaveBeenCalledWith({ title: 'Challenge claimed', description: 'Challenge reward claimed.', variant: 'success' });
  });

  it('renders badge collection journeys with progress and completion state', () => {
    mockLoadedGamification({ collections: mockCollections });

    const { getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Journeys'));

    expect(getByText('Exchange Starter')).toBeTruthy();
    expect(getByText('Complete your first exchange journey.')).toBeTruthy();
    expect(getByText('1 of 3 badges')).toBeTruthy();
    expect(getByText('100 XP')).toBeTruthy();
    expect(getByText('Community Builder')).toBeTruthy();
    expect(getByText('Complete')).toBeTruthy();
  });

  it('renders XP shop items and purchases an affordable item', async () => {
    mockLoadedGamification({ shopItems: mockShopItems, shopXp: 250 });

    const { getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Shop'));

    expect(getByText('Balance: 250 XP')).toBeTruthy();
    expect(getByText('Profile Sparkle')).toBeTruthy();
    expect(getByText('Add sparkle to your profile.')).toBeTruthy();
    expect(getByText('4 left')).toBeTruthy();
    expect(getByText('Founding Badge')).toBeTruthy();
    expect(getByText('Owned')).toBeTruthy();

    fireEvent.press(getByText('Purchase'));

    expect(purchaseShopItem).toHaveBeenCalledWith(12);
    await Promise.resolve();
    expect(mockToastShow).toHaveBeenCalledWith({ title: 'Purchase complete', description: 'Profile Sparkle is yours.', variant: 'success' });
  });

  it('disables XP shop purchase when balance is too low', () => {
    mockLoadedGamification({ shopItems: mockShopItems, shopXp: 20 });

    const { getByLabelText, getByText } = render(<GamificationScreen />);
    fireEvent.press(getByText('Shop'));

    expect(getByLabelText('Purchase Profile Sparkle').props.accessibilityState).toMatchObject({ disabled: true });
    expect(purchaseShopItem).not.toHaveBeenCalled();
  });

  describe('a load that failed outright', () => {
    // 🔴 This screen read `error` from NONE of its eight loads. The only four uses of
    // `error` in the file are user actions (claim, purchase, save), so a failed load had
    // no path to the member at all — not a message, not a retry. The screen is reachable
    // by three link types (/achievements, /leaderboard, /nexus-score), so a member can
    // arrive here from an email and find nothing.
    const failedState = { data: null, isLoading: false, error: new Error('offline'), refresh: jest.fn() };

    it('🔴 offers a retry instead of an empty screen', () => {
      mockUseApi.mockReturnValue(failedState);

      const { getByTestId } = render(<GamificationScreen />);

      expect(getByTestId('gamification-load-failed')).toBeTruthy();
    });

    it('does not replace the page when the profile loaded but a section did not', () => {
      // Partial failure must still show what arrived. Blanking the whole screen because
      // the XP shop was unavailable would be a worse bug than the one being fixed.
      // The helper always resolves the profile call, which is exactly this case: profile
      // present, the seven section loads empty.
      mockLoadedGamification();

      const { queryByTestId } = render(<GamificationScreen />);

      expect(queryByTestId('gamification-load-failed')).toBeNull();
    });

    it('shows the spinner rather than the failure while still loading', () => {
      // Order matters: an error from a first attempt must not flash a failure panel over
      // a load that is still in flight.
      mockUseApi.mockReturnValue({ ...failedState, isLoading: true });

      const { queryByTestId } = render(<GamificationScreen />);

      expect(queryByTestId('gamification-load-failed')).toBeNull();
    });
  });
  it('shows a badge the server has awarded as earned, not locked', () => {
    mockLoadedGamification({ badges: [realAwardedBadge] });

    const { getAllByText, queryByText } = render(<GamificationScreen />);

    expect(getAllByText('Earned').length).toBeGreaterThan(0);
    // "Locked" beside a badge the member has genuinely won is the fault this pins.
    expect(queryByText('Locked')).toBeNull();
  });

  it('still treats a badge with no award timestamp as locked', () => {
    const unearned = { ...realAwardedBadge, id: 9999, name: 'Not Yet', awarded_at: null };
    mockLoadedGamification({ badges: [unearned] });

    const { getAllByText, queryByText } = render(<GamificationScreen />);

    expect(getAllByText('Locked').length).toBeGreaterThan(0);
    expect(queryByText('Earned')).toBeNull();
  });
});
