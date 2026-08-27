// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

let mockParams: Record<string, string | undefined> = { id: '7' };
const mockHasFeature = jest.fn<boolean, [string]>(() => true);
const mockHasModule = jest.fn<boolean, [string]>(() => true);

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'profile.loadError': 'Failed to load member profile.',
        'profile.verified': 'Verified',
        'profile.federatedMember': 'Federated member',
        'profile.federatedProfile': 'Federated profile',
        'profile.federatedProfileHint': opts ? `This profile is shared from ${String(opts.community ?? '')}.` : 'This profile is federated.',
        'profile.externalFederatedMember': 'External federated member',
        'profile.externalFederatedMemberDescription': 'This member is shared by an external federation partner.',
        'profile.externalFederatedTrustHint': 'Partner-provided reviews appear here.',
        'profile.backToFederatedMembers': 'Back to federated members',
        'profile.federatedMessaging': 'Messaging enabled',
        'profile.federatedExchanges': 'Exchanges enabled',
        'profile.pendingReceived': 'Connection request',
        'profile.accept': 'Accept',
        'profile.decline': 'Decline',
        'profile.connected': 'Connected',
        'profile.disconnect': 'Disconnect',
        'profile.connectionError': 'Connection could not be updated.',
        'profile.sendCredits': 'Send credits',
        'profile.sendCreditsTo': opts ? `Send credits to ${String(opts.name ?? '')}` : 'Send credits',
        'profile.amountHours': 'Amount (hours)',
        'profile.amountPlaceholder': '1-100',
        'profile.transferDescription': 'Description',
        'profile.transferDescriptionPlaceholder': 'What are these credits for?',
        'profile.transferSummary': opts ? `Sending ${String(opts.amount ?? '')} hour(s) to ${String(opts.name ?? '')}.` : 'Sending credits.',
        'profile.transferValidationTitle': 'Check transfer details',
        'profile.transferAmountRequired': 'Enter a whole-hour amount between 1 and 100.',
        'profile.transferDescriptionRequired': 'Add a description for this transfer.',
        'profile.transferSuccessTitle': 'Credits sent',
        'profile.transferSuccessMessage': opts ? `${String(opts.amount ?? '')} hour(s) sent to ${String(opts.name ?? '')}.` : 'Credits sent.',
        'profile.transferFailedTitle': 'Could not send credits',
        'profile.transferFailedMessage': 'Please check federation exchanges are enabled and try again.',
        'profile.cancelTransfer': 'Cancel transfer',
        'profile.hoursGiven': 'Hours Given',
        'profile.hoursReceived': 'Hours Received',
        'profile.totalHours': 'Total Hours',
        'profile.activeListings': 'Active Listings',
        'profile.groups': 'Groups',
        'profile.events': 'Events',
        'profile.skills': 'Skills',
        'profile.noSkills': 'No skills listed.',
        'profile.trustStatus': 'Trust status',
        'profile.trustStatusHint': 'Verification labels are loaded from the member verification system.',
        'profile.achievements': 'Achievements',
        'profile.achievementsSummary': opts ? `Level ${String(opts.level ?? 1)} · ${String(opts.count ?? 0)} badges` : 'Achievements summary',
        'profile.level': opts ? `Level ${String(opts.level ?? 1)}` : 'Level 1',
        'profile.xp': 'XP',
        'profile.badges': 'Badges',
        'profile.nextLevel': 'To next level',
        'profile.noBadges': 'No badges earned yet.',
        'profile.viewAllAchievements': 'View all achievements',
        'profile.memberListings': 'Member listings',
        'profile.noListings': 'No public listings yet.',
        'profile.offer': 'Offer',
        'profile.request': 'Request',
        'profile.viewListing': opts ? `View ${String(opts.title ?? '')}` : 'View listing',
        'profile.hoursEstimate': opts ? `${String(opts.hours ?? '')} hrs` : 'hrs',
        'profile.reviews': 'Reviews',
        'profile.noReviews': 'No reviews yet.',
        'profile.reviewCount': opts ? `${String(opts.count ?? '')} reviews` : 'reviews',
        'profile.anonymousReviewer': 'Community member',
        'federation:reviews.fromPartner': opts ? `via ${String(opts.partner ?? '')}` : 'via partner',
        'federation:reviews.verified': 'Verified',
        'profile.sendMessage': 'Send Message',
        'profile.safety': 'Safety',
        'profile.safetyHint': 'Block this member if they should not contact you.',
        'profile.block': 'Block member',
        'profile.blockConfirmTitle': opts ? `Block ${String(opts.name ?? '')}?` : 'Block member?',
        'profile.blockConfirmMessage': 'You will not be able to contact each other.',
        'profile.blockSuccessTitle': 'Member blocked',
        'profile.blockSuccessMessage': 'This member can no longer contact you.',
        'profile.blockFailed': 'Could not block this member',
        'profile.memberSince': opts ? `Member since ${String(opts.date ?? '')}` : 'Member since',
        'federation:directory.members.title': 'Federated Members',
        'federation:directory.members.memberFallback': 'Member',
        'federation:directory.unknownCommunity': 'Partner community',
        'common:errors.notFound': 'Member not found.',
        'common:buttons.back': 'Go Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: mockHasFeature, hasModule: mockHasModule }),
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
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
    errorBg: '#fef2f2',
    successBg: '#f0fdf4',
    infoBg: '#eff6ff',
    warningBg: '#fffbeb',
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

jest.mock('@/lib/api/members', () => ({
  getMember: jest.fn(),
  getMemberListings: jest.fn().mockResolvedValue({ data: [] }),
  getMemberReviews: jest.fn().mockResolvedValue({ data: [] }),
}));

jest.mock('@/lib/api/settings', () => ({
  blockUser: jest.fn().mockResolvedValue({ data: { success: true } }),
}));

jest.mock('@/lib/api/federation', () => ({
  acceptFederationConnection: jest.fn().mockResolvedValue({}),
  getFederationMember: jest.fn(),
  getFederationMemberReviews: jest.fn().mockResolvedValue({ data: [] }),
  getFederationConnectionStatus: jest.fn().mockResolvedValue({ data: { status: 'none', connection_id: null } }),
  rejectFederationConnection: jest.fn().mockResolvedValue({}),
  removeFederationConnection: jest.fn().mockResolvedValue({}),
  sendFederationTransaction: jest.fn().mockResolvedValue({ data: { transaction_id: 44, status: 'completed' } }),
  sendFederationConnectionRequest: jest.fn().mockResolvedValue({ data: { connection_id: 20 } }),
}));

jest.mock('@/lib/api/connections', () => ({
  getConnectionStatus: jest.fn().mockResolvedValue({ data: { status: 'none', connection_id: null } }),
  sendConnectionRequest: jest.fn().mockResolvedValue({ data: { connection_id: 10 } }),
  acceptConnection: jest.fn().mockResolvedValue({}),
  removeConnection: jest.fn().mockResolvedValue({}),
}));

jest.mock('@/lib/api/verification', () => ({
  getUserVerificationBadges: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/lib/api/gamification', () => ({
  getGamificationProfile: jest.fn().mockResolvedValue({ data: null }),
  getBadges: jest.fn().mockResolvedValue({ data: [] }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Test User', tenant_id: 2 }, isAuthenticated: true }),
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

// Auto-confirm: triggering the confirm runs the action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

// --- Tests ---

import MemberProfileScreen from './member-profile';
import {
  acceptFederationConnection,
  getFederationMember,
  getFederationMemberReviews,
  rejectFederationConnection,
  sendFederationTransaction,
} from '@/lib/api/federation';
import { getMember } from '@/lib/api/members';
import { blockUser } from '@/lib/api/settings';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockParams = { id: '7' };
  jest.clearAllMocks();
  mockHasFeature.mockReturnValue(true);
  mockHasModule.mockReturnValue(true);
  mockUseApi.mockReturnValue(defaultApiState);
});

const mockMember = {
  id: 7,
  name: 'Alice Tanner',
  bio: 'Passionate community gardener and timebank advocate.',
  avatar_url: null,
  location: 'Cork, Ireland',
  time_balance: 12,
  skills: ['Gardening', 'Cooking'],
  joined_at: '2024-06-15T00:00:00Z',
  last_active_at: '2026-03-20T10:00:00Z',
  total_hours_given: 15,
  total_hours_received: 8,
  rating: 4.7,
  is_verified: false,
  stats: { listings_count: 1 },
  groups_count: 2,
  events_attended: 3,
  listings: [
    {
      id: 55,
      title: 'Garden help',
      type: 'offer',
      category_name: 'Gardening',
      description: 'Help with raised beds.',
      hours_estimate: 2,
    },
  ],
  reviews: [
    {
      id: 91,
      rating: 5,
      comment: 'Lovely exchange.',
      created_at: '2026-03-22T10:00:00Z',
      reviewer: { id: 8, first_name: 'Nora', last_name: 'Walsh' },
    },
  ],
  achievements: {
    profile: {
      xp: 250,
      level: 3,
      next_level_xp: 500,
      badges: [],
      badges_count: 2,
      rank: null,
      streak_days: 0,
    },
    badges: [
      {
        id: 1,
        name: 'First Exchange',
        description: 'Completed an exchange.',
        icon: 'exchange',
        earned_at: '2026-01-01T00:00:00Z',
        is_earned: true,
      },
    ],
  },
};

describe('MemberProfileScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });

    const { toJSON } = render(<MemberProfileScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders a loading spinner when the API is loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    const { toJSON } = render(<MemberProfileScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the member name when loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<MemberProfileScreen />);
    expect(getByText('Alice Tanner')).toBeTruthy();
  });

  it('renders the not-found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<MemberProfileScreen />);
    expect(getByText('Failed to load member profile.')).toBeTruthy();
    expect(getByText('Go Back')).toBeTruthy();
  });

  it('renders the Send Message button when member is loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<MemberProfileScreen />);
    expect(getByText('Send Message')).toBeTruthy();
  });

  it('blocks a same-community member from their profile and leaves the hidden profile', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');
    const { getByText } = render(<MemberProfileScreen />);

    fireEvent.press(getByText('Block member'));

    await waitFor(() => {
      expect(blockUser).toHaveBeenCalledWith(7);
      expect(router.replace).toHaveBeenCalledWith('/(modals)/members');
    });
  });

  it('does not offer the local block endpoint on federated profiles', () => {
    mockParams = { id: '272', tenant_id: '5' };
    mockUseApi.mockReturnValue({
      data: { data: { ...mockMember, id: 272, tenant_id: 5, timebank: { id: 5, name: 'Partner Demo' } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { queryByText } = render(<MemberProfileScreen />);

    expect(queryByText('Block member')).toBeNull();
  });

  it('opens same-community wallet transfers from member profiles', () => {
    mockHasFeature.mockReturnValue(false);
    mockHasModule.mockImplementation((module: string) => module === 'wallet');
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');

    const { getByLabelText } = render(<MemberProfileScreen />);
    fireEvent.press(getByLabelText('Send credits'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/wallet',
      params: { to: '7', name: 'Alice Tanner' },
    });
  });

  it('renders profile parity sections for stats, achievements, listings, reviews, and trust status', () => {
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<MemberProfileScreen />);
    expect(getByText('Active Listings')).toBeTruthy();
    expect(getByText('Trust status')).toBeTruthy();
    expect(getByText('Achievements')).toBeTruthy();
    expect(getByText('Level 3')).toBeTruthy();
    expect(getByText('Member listings')).toBeTruthy();
    expect(getByText('Garden help')).toBeTruthy();
    expect(getByText('Reviews')).toBeTruthy();
    expect(getByText('Lovely exchange.')).toBeTruthy();
  });

  it('opens member listings from HeroUI Native-backed listing rows', () => {
    mockUseApi.mockReturnValue({ data: { data: mockMember }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');

    const { getByLabelText } = render(<MemberProfileScreen />);
    fireEvent.press(getByLabelText('View Garden help'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/exchange-detail',
      params: { id: '55' },
    });
  });

  it('uses the federation member endpoint when a partner tenant_id is present', async () => {
    mockParams = { id: '272', tenant_id: '5' };
    (getFederationMember as jest.Mock).mockResolvedValue({
      data: {
        ...mockMember,
        id: 272,
        tenant_id: 5,
        timebank: { id: 5, name: 'Partner Demo' },
        reputation_score: 4.8,
      },
    });
    (getFederationMemberReviews as jest.Mock).mockResolvedValue({
      data: [{
        id: 'fed-91',
        rating: 5,
        comment: 'Trusted across our network.',
        created_at: '2026-03-22T10:00:00Z',
        reviewer: { name: 'Partner reviewer' },
        partner: { id: 5, name: 'Partner Demo' },
        verified: true,
      }],
    });
    mockUseApi.mockImplementation((loader: () => Promise<unknown>) => ({
      data: { data: { ...mockMember, id: 272, tenant_id: 5, timebank: { id: 5, name: 'Partner Demo' } } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
      __loader: loader,
    }));

    render(<MemberProfileScreen />);
    const loader = mockUseApi.mock.calls[0][0] as () => Promise<unknown>;
    await loader();

    expect(getFederationMember).toHaveBeenCalledWith(272, 5);
    expect(getFederationMemberReviews).toHaveBeenCalledWith(272, 5);
    expect(getMember).not.toHaveBeenCalled();
  });

  it('renders federated reviews with partner trust context', () => {
    mockParams = { id: '272', tenant_id: '5' };
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockMember,
          id: 272,
          tenant_id: 5,
          timebank: { id: 5, name: 'Partner Demo' },
          rating: 4.8,
          reviews: [{
            id: 'fed-91',
            rating: 5,
            comment: 'Trusted across our network.',
            created_at: '2026-03-22T10:00:00Z',
            reviewer: { name: 'Partner reviewer' },
            partner: { id: 5, name: 'Partner Demo' },
            verified: true,
          }],
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<MemberProfileScreen />);

    expect(getByText('Trusted across our network.')).toBeTruthy();
    expect(getByText('via Partner Demo')).toBeTruthy();
    expect(getByText('Verified')).toBeTruthy();
  });

  it('accepts incoming federated connection requests through the federation API', async () => {
    mockParams = { id: '272', tenant_id: '5' };
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockMember,
          id: 272,
          tenant_id: 5,
          timebank: { id: 5, name: 'Partner Demo' },
          connection_status: { status: 'pending', direction: 'incoming', connection_id: 77 },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<MemberProfileScreen />);

    await waitFor(() => expect(getByText('Accept')).toBeTruthy());
    fireEvent.press(getByText('Accept'));

    await waitFor(() => {
      expect(acceptFederationConnection).toHaveBeenCalledWith(77);
    });
  });

  it('declines incoming federated connection requests through the federation API', async () => {
    mockParams = { id: '272', tenant_id: '5' };
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockMember,
          id: 272,
          tenant_id: 5,
          timebank: { id: 5, name: 'Partner Demo' },
          connection_status: { status: 'pending', direction: 'incoming', connection_id: 78 },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<MemberProfileScreen />);

    await waitFor(() => expect(getByText('Decline')).toBeTruthy());
    fireEvent.press(getByText('Decline'));

    await waitFor(() => {
      expect(rejectFederationConnection).toHaveBeenCalledWith(78);
    });
  });

  it('sends federated time credits from a partner member profile', async () => {
    mockParams = { id: '272', tenant_id: '5' };
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockMember,
          id: 272,
          tenant_id: 5,
          timebank: { id: 5, name: 'Partner Demo' },
          transactions_enabled: true,
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText, getByPlaceholderText } = render(<MemberProfileScreen />);

    fireEvent.press(getAllByText('Send credits')[0]);
    fireEvent.changeText(getByPlaceholderText('1-100'), '2');
    fireEvent.changeText(getByPlaceholderText('What are these credits for?'), 'Repair help');
    fireEvent.press(getAllByText('Send credits')[0]);

    await waitFor(() => {
      expect(sendFederationTransaction).toHaveBeenCalledWith({
        receiver_id: 272,
        receiver_tenant_id: 5,
        amount: 2,
        description: 'Repair help',
      });
    });
  });

  it('opens external federated member deep links as messageable partner profiles', () => {
    mockParams = { id: 'ext-7-123', name: 'External Sam' };
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { router } = require('expo-router');
    const { getAllByText, getByText } = render(<MemberProfileScreen />);

    expect(getByText('External Sam')).toBeTruthy();
    expect(getAllByText('External federated member').length).toBeGreaterThan(0);

    fireEvent.press(getByText('Send Message'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-messages',
      params: {
        compose: 'true',
        to_user: 'ext-7-123',
        to_tenant: 'ext-7',
        name: 'External Sam',
      },
    });
  });

  it('loads backend-supported reviews for external federated member deep links', async () => {
    mockParams = { id: 'ext-7-123', name: 'External Sam' };
    mockUseApi
      .mockReturnValueOnce({ data: null, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce({
        data: {
          data: [{
            id: 'external-review-1',
            rating: 5,
            comment: 'Reliable cross-network helper.',
            created_at: '2026-03-22T10:00:00Z',
            reviewer: { name: 'Partner reviewer' },
            partner: { id: 'ext-7', name: 'Remote partner' },
            verified: true,
          }],
        },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      });

    const { getByText } = render(<MemberProfileScreen />);
    const reviewsLoader = mockUseApi.mock.calls[1][0] as () => Promise<unknown>;
    await reviewsLoader();

    expect(getFederationMemberReviews).toHaveBeenCalledWith('ext-7-123', 'ext-7');
    expect(getByText('Partner-provided reviews appear here.')).toBeTruthy();
    expect(getByText('Reliable cross-network helper.')).toBeTruthy();
    expect(getByText('via Remote partner')).toBeTruthy();
  });
});
