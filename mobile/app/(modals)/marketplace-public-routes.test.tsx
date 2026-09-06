// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockParams: Record<string, string | undefined> = {};
let mockFeatures = new Set(['marketplace', 'merchant_coupons']);
const mockUseApi = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.alertTitle': 'Error',
        'actions.browse': 'Browse marketplace',
        loadMore: 'Load more',
        'featureGate.title': 'Marketplace unavailable',
        'featureGate.description': 'Marketplace is not enabled.',
        'free.title': 'Free items',
        'free.eyebrow': 'Free marketplace',
        'free.subtitle': 'Give away useful items to members nearby.',
        'free.giveAway': 'Give away item',
        'free.unableToLoad': 'Could not load free items.',
        'free.loadMoreFailed': 'Could not load more free items.',
        'free.emptyTitle': 'No free items yet',
        'free.emptySubtitle': 'Offer something for free to get started.',
        'publicCoupons.title': 'Community coupons',
        'publicCoupons.eyebrow': 'Member offers',
        'publicCoupons.subtitle': 'Use active marketplace coupons.',
        'publicCoupons.empty': 'No coupons available',
        'publicCoupons.emptyHint': 'Check back later.',
        'publicCoupons.unavailableTitle': 'Coupons unavailable',
        'publicCoupons.unavailableSubtitle': 'Coupon features are not enabled.',
        'publicCoupons.details': 'Details',
        'publicCoupons.percentSuffix': '% off',
        'publicCoupons.fixedValue': `${String(opts?.value ?? '')} off`,
        'publicCoupons.bogo': 'Buy one, get one',
        'publicCoupons.validUntil': `Valid until ${String(opts?.date ?? '')}`,
        'publicCoupons.minOrder': `Min ${String(opts?.value ?? '')}`,
        'publicCoupons.usage': `${String(opts?.used ?? 0)} of ${String(opts?.max ?? 0)} used`,
        'publicCoupons.perMember': `${String(opts?.count ?? 0)} per member`,
        'publicCoupons.notFound': 'Coupon not found',
        'publicCoupons.backToCoupons': 'Back to coupons',
        'publicCoupons.code': 'Code',
        'publicCoupons.useOnline': 'Use online',
        'publicCoupons.redeemInStore': 'Redeem in store',
        'publicCoupons.generatingQr': 'Generating QR',
        'publicCoupons.showQr': 'Show QR code',
        'publicCoupons.scanAtCheckout': 'Scan this at checkout.',
        'publicCoupons.qrAlt': 'Coupon QR code',
        'publicCoupons.qrExpires': `Expires at ${String(opts?.time ?? '')}`,
        'publicCoupons.status.active': 'Active',
        'publicCoupons.appliesTo.all_listings': 'All listings',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('react-native-qrcode-svg', () => {
  const { View } = require('react-native');
  return ({ value }: { value: string }) => <View testID="merchant-coupon-qr" accessibilityLabel={value} />;
});
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text, Pressable, View } = require('react-native');
  return ({ title, rightAction }: { title: string; rightAction?: { accessibilityLabel: string; onPress: () => void } }) => (
    <View>
      <Text>{title}</Text>
      {rightAction ? (
        <Pressable accessibilityLabel={rightAction.accessibilityLabel} onPress={rightAction.onPress}>
          <Text>{rightAction.accessibilityLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
});
jest.mock('@/components/ui/EmptyState', () => {
  const { Text, Pressable, View } = require('react-native');
  return ({ title, subtitle, actionLabel, onAction }: { title: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) => (
    <View>
      <Text>{title}</Text>
      {subtitle ? <Text>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <Pressable onPress={onAction}><Text>{actionLabel}</Text></Pressable>
      ) : null}
    </View>
  );
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/BottomSheet', () => {
  const { View } = require('react-native');
  return ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? <View>{children}</View> : null;
});
jest.mock('@/components/marketplace/MarketplaceListingCard', () => {
  const { Text, Pressable } = require('react-native');
  return ({ item, onPress }: { item: { title: string }; onPress: () => void }) => (
    <Pressable onPress={onPress}><Text>{item.title}</Text></Pressable>
  );
});
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({
    tenant: { currency: 'GBP' },
    hasFeature: (feature: string) => mockFeatures.has(feature),
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#d1d5db',
    borderSubtle: '#e5e7eb',
    success: '#16a34a',
    warning: '#f59e0b',
    error: '#dc2626',
  }),
}));
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));
jest.mock('@/lib/api/marketplace', () => ({
  generatePublicMerchantCouponQr: jest.fn(),
  getMarketplaceListings: jest.fn(),
  getPublicMerchantCoupon: jest.fn(),
  getPublicMerchantCoupons: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  saveMarketplaceListing: jest.fn(),
  unsaveMarketplaceListing: jest.fn(),
}));

import MarketplaceFreeRoute from './marketplace-free';
import MarketplaceCouponsRoute from './marketplace-coupons';
import MarketplaceCouponDetailRoute from './marketplace-coupon-detail';
import {
  generatePublicMerchantCouponQr,
  getMarketplaceListings,
} from '@/lib/api/marketplace';

const coupon = {
  id: 8,
  code: 'COMMUNITY10',
  title: 'Community discount',
  description: 'Ten percent off shared tools.',
  discount_type: 'percent' as const,
  discount_value: 10,
  min_order_cents: 500,
  max_uses: 20,
  max_uses_per_member: 1,
  usage_count: 3,
  valid_until: '2026-08-01T10:00:00Z',
  status: 'active' as const,
  applies_to: 'all_listings' as const,
};

describe('public marketplace routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockFeatures = new Set(['marketplace', 'merchant_coupons']);
    mockUseApi.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    jest.mocked(getMarketplaceListings).mockResolvedValue({
      data: [],
      meta: { has_more: false, next_cursor: null },
    } as never);
  });

  it('loads the free-items route with the free listing filter and opens free listing creation', async () => {
    jest.mocked(getMarketplaceListings).mockResolvedValueOnce({
      data: [{ id: 4, title: 'Spare plant pots', is_saved: false }],
      meta: { has_more: false, next_cursor: null },
    } as never);

    const { getAllByText, getByText } = render(<MarketplaceFreeRoute />);

    await waitFor(() => {
      expect(getMarketplaceListings).toHaveBeenCalledWith(expect.objectContaining({
        price_type: 'free',
        sort: 'newest',
      }));
      expect(getByText('Spare plant pots')).toBeTruthy();
    });

    fireEvent.press(getAllByText('Give away item')[0]);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/new-marketplace-listing',
      params: { price_type: 'free' },
    });
  });

  it('renders public coupons and opens coupon detail', () => {
    mockUseApi.mockReturnValue({
      data: { data: { items: [coupon] } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText, getByText } = render(<MarketplaceCouponsRoute />);

    expect(getAllByText('Community coupons').length).toBeGreaterThan(0);
    expect(getByText('COMMUNITY10')).toBeTruthy();

    fireEvent.press(getByText('Details'));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/(modals)/marketplace-coupon-detail',
      params: { id: '8' },
    });
  });

  it('formats fixed coupons and minimum spend in the tenant currency', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          items: [{ ...coupon, discount_type: 'fixed', discount_value: 500 }],
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<MarketplaceCouponsRoute />);

    expect(getByText('£5.00 off')).toBeTruthy();
    expect(getByText('Min £5.00')).toBeTruthy();
  });

  it('renders coupon detail and can open the QR sheet', async () => {
    mockParams = { id: '8' };
    mockUseApi.mockReturnValue({
      data: { data: coupon },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    jest.mocked(generatePublicMerchantCouponQr).mockResolvedValue({
      data: {
        token: 'coupon-token',
        expires_at: '2026-08-01T10:10:00Z',
        coupon_code: 'COMMUNITY10',
      },
    } as never);

    const { getByText, findByText, findByTestId } = render(<MarketplaceCouponDetailRoute />);

    expect(getByText('Community discount')).toBeTruthy();
    expect(getByText('COMMUNITY10')).toBeTruthy();

    fireEvent.press(getByText('Redeem in store'));

    expect(await findByText('Show QR code')).toBeTruthy();
    expect(await findByText('coupon-token')).toBeTruthy();
    expect(await findByTestId('merchant-coupon-qr')).toBeTruthy();
    const source = require('fs').readFileSync(require.resolve('./marketplace-coupon-detail'), 'utf8');
    expect(source).not.toContain('api.qrserver.com');
  });
});
