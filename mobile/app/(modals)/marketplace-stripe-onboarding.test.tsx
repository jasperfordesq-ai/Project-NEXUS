// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
        'stripeOnboarding.title': 'Payment setup',
        'stripeOnboarding.eyebrow': 'Stripe Connect',
        'stripeOnboarding.subtitle': 'Connect Stripe so marketplace buyers can pay securely.',
        'stripeOnboarding.completeTitle': 'Payments ready',
        'stripeOnboarding.completeSubtitle': 'Stripe has confirmed that payments and payouts are available.',
        'stripeOnboarding.incompleteTitle': 'Finish Stripe setup',
        'stripeOnboarding.incompleteSubtitle': 'Your Stripe account exists, but charges or payouts are not enabled yet.',
        'stripeOnboarding.charges': 'Charges',
        'stripeOnboarding.payouts': 'Payouts',
        'stripeOnboarding.details': 'Details',
        'stripeOnboarding.readinessTitle': 'Connect readiness',
        'stripeOnboarding.readinessHint': 'Stripe must enable all three checks before buyers can pay you.',
        'stripeOnboarding.requirementReady': '{{label}} ready',
        'stripeOnboarding.requirementMissing': '{{label}} not ready',
        'stripeOnboarding.needBank': 'Bank details',
        'stripeOnboarding.needBankHint': 'Stripe asks for payout details directly in its secure onboarding flow.',
        'stripeOnboarding.needIdentity': 'Identity checks',
        'stripeOnboarding.needIdentityHint': 'Stripe may ask for identity or business verification depending on seller type.',
        'stripeOnboarding.secure': 'Secure handoff',
        'stripeOnboarding.secureHint': 'The mobile app opens Stripe onboarding in the browser and returns here for status checks.',
        'stripeOnboarding.continue': 'Continue Stripe setup',
        'stripeOnboarding.completeButton': 'Setup complete',
        'stripeOnboarding.returnCompleteTitle': 'Stripe setup complete',
        'stripeOnboarding.returnCompleteMessage': 'Your Stripe account is ready for marketplace payments.',
        'stripeOnboarding.returnIncompleteTitle': 'Finish Stripe setup',
        'stripeOnboarding.returnIncompleteMessage': 'Stripe still needs one or more checks before payments and payouts are fully enabled.',
        'stripeOnboarding.checkStatus': 'Check status',
        'stripeOnboarding.goListings': 'Back to listings',
        'stripeOnboarding.balanceTitle': 'Seller balance',
        'stripeOnboarding.balanceSubtitle': 'Track marketplace funds from completed Stripe payments.',
        'stripeOnboarding.pending': 'Pending',
        'stripeOnboarding.available': 'Available',
        'stripeOnboarding.totalEarned': 'Total earned',
        'stripeOnboarding.payoutHistory': 'Payout history',
        'stripeOnboarding.payoutHistoryHint': 'Recent marketplace payments and payout status.',
        'stripeOnboarding.noPayouts': 'No payout records yet.',
      };
      return (map[key] ?? key).replace('{{label}}', String(options?.label ?? ''));
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { currency: 'JPY' }, hasFeature: () => true }),
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
    warning: '#f59e0b',
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/lib/api/marketplace', () => ({
  getMarketplaceSellerBalance: jest.fn(),
  getMarketplaceSellerPayouts: jest.fn(),
  getMarketplaceStripeOnboardingStatus: jest.fn(),
  startMarketplaceStripeOnboarding: jest.fn(),
}));

import MarketplaceStripeOnboardingRoute from './marketplace-stripe-onboarding';
import { useAppToast } from '@/components/ui/AppToast';
import {
  getMarketplaceSellerBalance,
  getMarketplaceSellerPayouts,
  getMarketplaceStripeOnboardingStatus,
} from '@/lib/api/marketplace';

const toastShow = useAppToast().show as jest.Mock;

describe('MarketplaceStripeOnboardingRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    (getMarketplaceStripeOnboardingStatus as jest.Mock).mockResolvedValue({
      data: {
        stripe_account_id: 'acct_123',
        stripe_onboarding_complete: false,
        details_submitted: true,
        charges_enabled: false,
        payouts_enabled: false,
      },
    });
    (getMarketplaceSellerBalance as jest.Mock).mockResolvedValue({
      data: { pending: 0, available: 0, total_earned: 0, currency: 'EUR' },
    });
    (getMarketplaceSellerPayouts as jest.Mock).mockResolvedValue({
      data: [],
      meta: { cursor: null, has_more: false },
    });
  });

  it('shows a resume-onboarding message for incomplete Stripe accounts', async () => {
    const { getByText, queryByText, unmount } = render(<MarketplaceStripeOnboardingRoute />);

    await waitFor(() => {
      expect(getByText('Finish Stripe setup')).toBeTruthy();
    });

    expect(getByText('Your Stripe account exists, but charges or payouts are not enabled yet.')).toBeTruthy();
    expect(getByText('Connect readiness')).toBeTruthy();
    expect(getByText('Details ready')).toBeTruthy();
    expect(getByText('Charges not ready')).toBeTruthy();
    expect(getByText('Payouts not ready')).toBeTruthy();
    expect(getByText('Continue Stripe setup')).toBeTruthy();
    expect(queryByText('Connect Stripe so marketplace buyers can pay securely.')).toBeNull();
    unmount();
  });

  it('acknowledges a completed Stripe return link', async () => {
    mockParams = { complete: '1' };
    (getMarketplaceStripeOnboardingStatus as jest.Mock).mockResolvedValueOnce({
      data: {
        stripe_account_id: 'acct_123',
        stripe_onboarding_complete: true,
        details_submitted: true,
        charges_enabled: true,
        payouts_enabled: true,
      },
    });
    const { getByText, unmount } = render(<MarketplaceStripeOnboardingRoute />);

    await waitFor(() => {
      expect(getByText('Payments ready')).toBeTruthy();
      expect(toastShow).toHaveBeenCalledWith({
        title: 'Stripe setup complete',
        description: 'Your Stripe account is ready for marketplace payments.',
        variant: 'success',
      });
    });

    unmount();
  });

  it('does not invent decimals for zero-decimal seller balances', async () => {
    (getMarketplaceSellerBalance as jest.Mock).mockResolvedValueOnce({
      data: { pending: 2500, available: 0, total_earned: 2500, currency: 'JPY' },
    });

    const { findAllByText } = render(<MarketplaceStripeOnboardingRoute />);
    const balances = await findAllByText(/2[,.]500/);

    expect(balances.length).toBeGreaterThan(0);
    balances.forEach((balance) => expect(String(balance.props.children)).not.toMatch(/[,.]00(?:\D|$)/));
  });
});
