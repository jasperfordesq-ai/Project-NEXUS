// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockAuthState: {
  isAuthenticated: boolean;
  isLoading: boolean;
} = {
  isAuthenticated: true,
  isLoading: false,
};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ mode: 'sent' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
        'offers.eyebrow': 'Negotiations',
        'offers.title': 'Marketplace offers',
        'offers.subtitle': 'Review received offers and track offers you have made.',
        'offers.received': 'Received',
        'offers.sentTab': 'Sent',
        'offers.signInTitle': 'Sign in to view marketplace offers',
        'offers.signInHint': 'Offers you send or receive are available after you sign in.',
        'offers.listing': 'Listing',
        'offers.sellerLabel': 'Seller',
        'offers.buyerLabel': 'Buyer',
        'offers.acceptCounter': 'Accept counter',
        'offers.withdraw': 'Withdraw',
        'offers.decline': 'Decline',
        'offers.countered': 'Countered',
        'offers.emptySent': 'No sent offers',
        'offers.emptySentHint': 'Offers you make on marketplace listings will appear here.',
        'offers.status.countered': 'Countered',
        'actions.view': 'View',
        'auth:login.submit': 'Sign in',
      };
      if (key === 'offers.date') return `Sent ${String(opts?.date ?? '')}`;
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { currency: 'EUR' }, hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    error: '#dc2626',
    success: '#16a34a',
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/utils/resolveImageUrl', () => ({
  resolveImageUrl: (value?: string | null) => value ?? null,
}));

jest.mock('@/lib/api/marketplace', () => ({
  acceptMarketplaceOffer: jest.fn(),
  acceptMarketplaceCounterOffer: jest.fn(),
  counterMarketplaceOffer: jest.fn(),
  declineMarketplaceOffer: jest.fn(),
  getMarketplaceOffers: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  withdrawMarketplaceOffer: jest.fn(),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import MarketplaceOffersRoute from './marketplace-offers';
import { getMarketplaceOffers } from '@/lib/api/marketplace';

describe('MarketplaceOffersRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
    };
    (getMarketplaceOffers as jest.Mock).mockResolvedValue({
      data: [
        {
          id: 8,
          amount: 40,
          currency: 'EUR',
          message: 'Can collect today',
          status: 'countered',
          counter_amount: 45,
          counter_message: 'I can include delivery',
          created_at: '2026-05-15T10:30:00Z',
          listing: {
            id: 12,
            title: 'Cordless drill',
            image: { url: '/uploads/marketplace/drill.jpg', thumbnail_url: '/uploads/marketplace/drill-thumb.jpg' },
          },
          seller: { id: 4, name: 'Jordan Seller', avatar_url: '/uploads/avatars/jordan.jpg' },
        },
      ],
      meta: { cursor: null, has_more: false },
    });
  });

  it('shows seller context and buyer-safe actions for sent counter-offers', async () => {
    const { getByText, queryByText, unmount } = render(<MarketplaceOffersRoute />);

    await waitFor(() => {
      expect(getByText('Jordan Seller')).toBeTruthy();
      expect(getByText('Seller')).toBeTruthy();
    });

    expect(getByText('Withdraw')).toBeTruthy();
    expect(queryByText('Decline')).toBeNull();
    unmount();
  });

  it('shows the sign-in state without calling protected offer APIs when unauthenticated', async () => {
    mockAuthState = { isAuthenticated: false, isLoading: false };

    const { getByText, unmount } = render(<MarketplaceOffersRoute />);

    expect(getByText('Sign in to view marketplace offers')).toBeTruthy();
    expect(getMarketplaceOffers).not.toHaveBeenCalled();
    unmount();
  });

  it('opens accepted sent offers with the authoritative offer checkout context', async () => {
    (getMarketplaceOffers as jest.Mock).mockResolvedValueOnce({
      data: [{
        id: 31,
        amount: 37,
        currency: 'EUR',
        status: 'accepted',
        created_at: '2026-05-15T10:30:00Z',
        listing: { id: 12, title: 'Cordless drill', status: 'reserved' },
        seller: { id: 4, name: 'Jordan Seller' },
      }],
      meta: { cursor: null, has_more: false },
    });

    const { getByText } = render(<MarketplaceOffersRoute />);
    fireEvent.press(await waitFor(() => getByText('View')));

    expect(require('expo-router').router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/marketplace-detail',
      params: { id: '12', offer_id: '31', offer_amount: '37' },
    });
  });
});
