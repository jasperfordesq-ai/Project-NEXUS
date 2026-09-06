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
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'orders.eyebrow': 'Marketplace orders',
        'orders.title': 'Orders',
        'orders.subtitle': 'Track purchases and sales from marketplace checkout.',
        'orders.purchases': 'Purchases',
        'orders.sales': 'Sales',
        'orders.signInTitle': 'Sign in to view marketplace orders',
        'orders.signInHint': 'Purchases, sales, and payment recovery are available after you sign in.',
        'orders.tabs.all': 'All',
        'orders.tabs.active': 'Active',
        'orders.tabs.completed': 'Completed',
        'orders.tabs.cancelled': 'Closed',
        'orders.empty': 'No orders yet',
        'orders.emptyHint': 'Marketplace purchases and sales will appear here.',
        'orders.sellerLabel': 'Seller',
        'orders.buyerLabel': 'Buyer',
        'orders.deliveryOffers': 'Delivery offers',
        'orders.waitingShipment': 'Waiting for shipment',
        'orders.continuePayment': 'Continue payment',
        'orders.paymentMerchantDisplayName': 'Project NEXUS marketplace',
        'orders.paymentCompleteTitle': 'Payment complete',
        'orders.paymentCompleteHint': 'Your order is paid. The seller can now prepare it.',
        'orders.awaitingPayment': 'Awaiting payment',
        'orders.paymentStartedTitle': 'Payment started',
        'orders.paymentClientSecretHint': 'The payment is ready. Complete checkout from the secure payment sheet or web checkout.',
        'orders.paymentSheetFailed': 'The secure payment sheet could not be opened. Try again from Orders.',
        'orders.awaitingConfirmation': 'Awaiting buyer confirmation',
        'orders.awaitingCompletion': 'Awaiting completion',
        'orders.saleCompleted': 'Sale completed',
        'orders.buyerRated': 'Buyer rated',
        'orders.disputeOpen': 'Dispute open',
        'orders.rate': 'Rate order',
        'orders.rated': 'Rated',
        'orders.deliveryOffersTitle': 'Community delivery',
        'orders.deliveryVerified': 'Verified',
        'orders.acceptDeliveryOffer': 'Accept offer',
        'orders.status.paid': 'Paid',
        'orders.status.pending_payment': 'Pending payment',
        'orders.status.shipped': 'Shipped',
        'orders.status.delivered': 'Delivered',
        'orders.status.completed': 'Completed',
        'orders.status.disputed': 'Disputed',
        'orders.status.unknown': 'Unknown status',
        'orders.deliveryStatus.pending': 'Pending',
        'orders.statusHint.purchases.pending_payment': 'Payment is not complete yet. Continue checkout to keep this purchase moving.',
        'orders.statusHint.purchases.paid': 'Payment is complete. The seller can now prepare the order.',
        'orders.statusHint.purchases.delivered': 'Delivery is confirmed. You can rate this order now.',
        'orders.statusHint.purchases.completed': 'This purchase is complete. You can still review the order details.',
        'orders.statusHint.sales.pending_payment': 'The buyer still needs to finish payment before you ship.',
        'orders.statusHint.sales.paid': 'Payment is complete. Mark the order shipped when it is ready.',
        'orders.statusHint.sales.shipped': 'The order is on its way. Wait for the buyer to confirm delivery.',
        'orders.statusHint.sales.delivered': 'Delivery is confirmed. The order will complete after review or auto-completion.',
        'orders.statusHint.sales.completed': 'This sale is complete.',
        'orders.statusHint.sales.disputed': 'A dispute is open on this sale.',
        'orders.statusHint.unknown': 'This order is in a status the app does not recognise yet.',
        'actions.view': 'View',
        'auth:login.submit': 'Sign in',
      };
      if (key === 'orders.number') return `Order ${String(opts?.number ?? '')}`;
      if (key === 'orders.date') return String(opts?.date ?? '');
      if (key === 'orders.deliveryTimeCredits') return `${String(opts?.count ?? '')} time credits`;
      if (key === 'orders.totalTimeCredits') {
        return Number(opts?.count) === 1
          ? `${String(opts?.count ?? '')} time credit`
          : `${String(opts?.count ?? '')} time credits`;
      }
      if (key === 'orders.deliveryEstimate') return `${String(opts?.count ?? '')} minutes`;
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { currency: 'EUR', slug: 'hour-timebank' } }),
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
    warning: '#f59e0b',
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/BottomSheet', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => {
    const { View } = require('react-native');
    return visible ? <View>{children}</View> : null;
  },
}));
jest.mock('@/lib/utils/resolveImageUrl', () => ({
  resolveImageUrl: (value?: string | null) => value ?? null,
}));

jest.mock('@/lib/api/marketplace', () => ({
  acceptMarketplaceDeliveryOffer: jest.fn(),
  cancelMarketplaceOrder: jest.fn(),
  confirmMarketplacePayment: jest.fn(),
  confirmMarketplaceDeliveryOffer: jest.fn(),
  confirmMarketplaceOrderDelivery: jest.fn(),
  createMarketplacePaymentIntent: jest.fn(),
  disputeMarketplaceOrder: jest.fn(),
  getMarketplaceDeliveryOffers: jest.fn(),
  getMarketplaceOrder: jest.fn(),
  getMarketplaceOrders: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
  rateMarketplaceOrder: jest.fn(),
  shipMarketplaceOrder: jest.fn(),
}));
jest.mock('@/lib/payments/marketplacePayment', () => ({
  presentMarketplacePayment: jest.fn().mockResolvedValue({ status: 'redirected' }),
}));

// Stable references so screens that put `show` in a useCallback/useEffect
// dependency array don't re-run their effects on every render.
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import MarketplaceOrdersRoute from './marketplace-orders';
import { useAppToast } from '@/components/ui/AppToast';
import {
  confirmMarketplacePayment,
  createMarketplacePaymentIntent,
  getMarketplaceDeliveryOffers,
  getMarketplaceOrder,
  getMarketplaceOrders,
} from '@/lib/api/marketplace';
import { presentMarketplacePayment } from '@/lib/payments/marketplacePayment';

describe('MarketplaceOrdersRoute', () => {
  const showToast = useAppToast().show as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState = {
      isAuthenticated: true,
      isLoading: false,
    };
    mockParams = {};
    (getMarketplaceOrders as jest.Mock).mockResolvedValue({
      data: [],
      meta: { cursor: null, has_more: false },
    });
    (getMarketplaceDeliveryOffers as jest.Mock).mockResolvedValue({ data: [] });
    (getMarketplaceOrder as jest.Mock).mockResolvedValue({ data: null });
    (createMarketplacePaymentIntent as jest.Mock).mockResolvedValue({
      data: { client_secret: 'pi_secret', payment_intent_id: 'pi_42' },
    });
  });

  it('includes pending-payment recovery states in the active orders filter', async () => {
    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getMarketplaceOrders).toHaveBeenCalledWith('purchases', null, null);
    });

    fireEvent.press(getByText('Active'));

    await waitFor(() => {
      expect(getMarketplaceOrders).toHaveBeenCalledWith(
        'purchases',
        null,
        'pending_payment,paid,processing,shipped',
      );
    });

    unmount();
  });

  it('opens the requested sales order first and highlights its exact card', async () => {
    mockParams = { mode: 'sales', order_id: '72' };
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 71,
          order_number: 'MKT-000071',
          quantity: 1,
          unit_price: 10,
          total_price: 10,
          currency: 'EUR',
          status: 'paid',
          created_at: '2026-08-01T10:00:00Z',
          listing: { id: 101, title: 'Other sale', image: null, delivery_method: 'shipping' },
        },
        {
          id: 72,
          order_number: 'MKT-000072',
          quantity: 1,
          unit_price: 12,
          total_price: 12,
          currency: 'EUR',
          status: 'paid',
          created_at: '2026-08-02T10:00:00Z',
          listing: { id: 102, title: 'Payout sale', image: null, delivery_method: 'shipping' },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getByTestId, getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getMarketplaceOrders).toHaveBeenCalledWith('sales', null, null);
      expect(getByText('Payout sale')).toBeTruthy();
    });
    expect(getByTestId('marketplace-order-card-72')).toHaveStyle({ borderWidth: 2 });
    expect(getByTestId('marketplace-order-card-71')).toHaveStyle({ borderWidth: 1 });
    unmount();
  });

  it('loads the referenced order directly when it has fallen off the first list page', async () => {
    mockParams = { mode: 'sales', order_id: '99' };
    (getMarketplaceOrder as jest.Mock).mockResolvedValueOnce({
      data: {
        id: 99,
        order_number: 'MKT-000099',
        quantity: 1,
        unit_price: 22,
        total_price: 22,
        currency: 'EUR',
        status: 'completed',
        created_at: '2026-01-02T10:00:00Z',
        listing: { id: 199, title: 'Older referenced sale', image: null, delivery_method: 'shipping' },
      },
    });

    const { getByTestId, getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getMarketplaceOrder).toHaveBeenCalledWith(99);
      expect(getByText('Older referenced sale')).toBeTruthy();
    });
    expect(getByTestId('marketplace-order-card-99')).toHaveStyle({ borderWidth: 2 });
    unmount();
  });

  it('shows the sign-in state without calling protected order APIs when unauthenticated', () => {
    mockAuthState = { isAuthenticated: false, isLoading: false };

    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    expect(getByText('Sign in to view marketplace orders')).toBeTruthy();
    expect(getMarketplaceOrders).not.toHaveBeenCalled();
    unmount();
  });

  it('shows the waiting-for-shipment state for paid purchase orders', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 41,
          order_number: 'MKT-000041',
          quantity: 1,
          unit_price: 18,
          total_price: 18,
          currency: 'EUR',
          status: 'paid',
          created_at: '2026-05-22T10:00:00Z',
          listing: {
            id: 71,
            title: 'Paid order lamp',
            image: null,
            delivery_method: 'pickup',
          },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Paid order lamp')).toBeTruthy();
    });

    expect(getByText('Waiting for shipment')).toBeTruthy();
    expect(getByText('Payment is complete. The seller can now prepare the order.')).toBeTruthy();
    unmount();
  });

  /**
   * 🔴 A time-credit purchase has a cash total of zero. The row printed that cash total, so
   * the buyer saw "€0.00" for an order they had paid two credits for — measured on a device
   * on 2026-08-22 against real orders 34 and 35.
   */
  it('shows what a time-credit order actually cost, not €0.00', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 43,
          order_number: 'MKT-000043',
          quantity: 1,
          unit_price: 0,
          total_price: 0,
          currency: 'EUR',
          time_credits_used: 2,
          status: 'paid',
          created_at: '2026-08-22T10:00:00Z',
          listing: { id: 100, title: 'Folding wooden drying rack', image: null, delivery_method: 'pickup' },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getByText, queryByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => expect(getByText('Folding wooden drying rack')).toBeTruthy());
    expect(getByText('2 time credits')).toBeTruthy();
    expect(queryByText('€0.00')).toBeNull();
    unmount();
  });

  it('still shows the cash total for an ordinary paid order', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 44,
          order_number: 'MKT-000044',
          quantity: 1,
          unit_price: 18,
          total_price: 18,
          currency: 'EUR',
          time_credits_used: 0,
          status: 'paid',
          created_at: '2026-08-22T10:00:00Z',
          listing: { id: 71, title: 'Cash order lamp', image: null, delivery_method: 'pickup' },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => expect(getByText('Cash order lamp')).toBeTruthy());
    expect(getByText('€18.00')).toBeTruthy();
    unmount();
  });

  it('surfaces pending-payment recovery guidance and action', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 42,
          order_number: 'MKT-000042',
          quantity: 1,
          unit_price: 18,
          total_price: 18,
          currency: 'EUR',
          status: 'pending_payment',
          created_at: '2026-05-22T10:00:00Z',
          listing: {
            id: 72,
            title: 'Pending payment lamp',
            image: null,
            delivery_method: 'pickup',
          },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getAllByText, getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Pending payment lamp')).toBeTruthy();
    });

    expect(getAllByText('Pending payment').length).toBeGreaterThan(0);
    expect(getByText('Payment is not complete yet. Continue checkout to keep this purchase moving.')).toBeTruthy();
    expect(getByText('Continue payment')).toBeTruthy();
    unmount();
  });

  it('restarts and confirms pending marketplace payments with the native payment sheet', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 42,
          order_number: 'MKT-000042',
          quantity: 1,
          unit_price: 18,
          total_price: 18,
          currency: 'EUR',
          status: 'pending_payment',
          created_at: '2026-05-22T10:00:00Z',
          listing: {
            id: 72,
            title: 'Pending payment lamp',
            image: null,
            delivery_method: 'pickup',
          },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });
    (presentMarketplacePayment as jest.Mock).mockResolvedValueOnce({ status: 'completed' });
    (confirmMarketplacePayment as jest.Mock).mockResolvedValueOnce({
      data: { payment_id: 15, status: 'succeeded', amount: 18, currency: 'EUR', order_id: 42 },
    });

    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Pending payment lamp')).toBeTruthy();
    });

    fireEvent.press(getByText('Continue payment'));

    await waitFor(() => {
      expect(createMarketplacePaymentIntent).toHaveBeenCalledWith(42);
      // 🔴 tenantSlug is asserted deliberately: without it the web fallback lands
      // on the platform page, not this community's orders.
      expect(presentMarketplacePayment).toHaveBeenCalledWith({
        clientSecret: 'pi_secret',
        merchantDisplayName: 'Project NEXUS marketplace',
        tenantSlug: 'hour-timebank',
      });
      expect(confirmMarketplacePayment).toHaveBeenCalledWith('pi_42');
      expect(showToast).toHaveBeenCalledWith({
        title: 'Payment complete',
        description: 'Your order is paid. The seller can now prepare it.',
        variant: 'success',
      });
    });
    unmount();
  });

  it('shows rating actions for delivered purchases until the buyer has rated', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 43,
          order_number: 'MKT-000043',
          quantity: 1,
          unit_price: 20,
          total_price: 20,
          currency: 'EUR',
          status: 'delivered',
          created_at: '2026-05-23T10:00:00Z',
          listing: {
            id: 73,
            title: 'Delivered basket',
            image: null,
            delivery_method: 'shipping',
          },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
          ratings: [],
        },
        {
          id: 44,
          order_number: 'MKT-000044',
          quantity: 1,
          unit_price: 22,
          total_price: 22,
          currency: 'EUR',
          status: 'completed',
          created_at: '2026-05-24T10:00:00Z',
          listing: {
            id: 74,
            title: 'Rated chair',
            image: null,
            delivery_method: 'pickup',
          },
          seller: { id: 3, name: 'Sam Seller', avatar_url: null },
          ratings: [{ id: 10, rater_role: 'buyer', rating: 5 }],
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getByText, getAllByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Delivered basket')).toBeTruthy();
      expect(getByText('Rated chair')).toBeTruthy();
    });

    expect(getByText('Delivery is confirmed. You can rate this order now.')).toBeTruthy();
    expect(getAllByText('Rate order')).toHaveLength(1);
    expect(getByText('Rated')).toBeTruthy();
    unmount();
  });

  it('shows seller-side payment and delivery status actions', async () => {
    mockParams = { mode: 'sales' };
    (getMarketplaceOrders as jest.Mock)
      .mockResolvedValueOnce({
        data: [
          {
            id: 61,
            order_number: 'MKT-000061',
            quantity: 1,
            unit_price: 12,
            total_price: 12,
            currency: 'EUR',
            status: 'pending_payment',
            created_at: '2026-05-22T10:00:00Z',
            listing: { id: 91, title: 'Pending seller sale', image: null, delivery_method: 'pickup' },
            buyer: { id: 4, name: 'Bea Buyer', avatar_url: null },
          },
          {
            id: 62,
            order_number: 'MKT-000062',
            quantity: 1,
            unit_price: 14,
            total_price: 14,
            currency: 'EUR',
            status: 'shipped',
            created_at: '2026-05-23T10:00:00Z',
            listing: { id: 92, title: 'Shipped seller sale', image: null, delivery_method: 'shipping' },
            buyer: { id: 5, name: 'Bo Buyer', avatar_url: null },
          },
          {
            id: 63,
            order_number: 'MKT-000063',
            quantity: 1,
            unit_price: 16,
            total_price: 16,
            currency: 'EUR',
            status: 'delivered',
            created_at: '2026-05-24T10:00:00Z',
            listing: { id: 93, title: 'Delivered seller sale', image: null, delivery_method: 'shipping' },
            buyer: { id: 6, name: 'Bay Buyer', avatar_url: null },
          },
          {
            id: 64,
            order_number: 'MKT-000064',
            quantity: 1,
            unit_price: 18,
            total_price: 18,
            currency: 'EUR',
            status: 'disputed',
            created_at: '2026-05-25T10:00:00Z',
            listing: { id: 94, title: 'Disputed seller sale', image: null, delivery_method: 'shipping' },
            buyer: { id: 7, name: 'Bex Buyer', avatar_url: null },
          },
          {
            id: 65,
            order_number: 'MKT-000065',
            quantity: 1,
            unit_price: 20,
            total_price: 20,
            currency: 'EUR',
            status: 'completed',
            created_at: '2026-05-26T10:00:00Z',
            listing: { id: 95, title: 'Rated seller sale', image: null, delivery_method: 'shipping' },
            buyer: { id: 8, name: 'Ben Buyer', avatar_url: null },
            ratings: [{ id: 11, rater_role: 'buyer', rating: 4 }],
          },
        ],
        meta: { cursor: null, has_more: false },
      });

    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getMarketplaceOrders).toHaveBeenCalledWith('sales', null, null);
      expect(getByText('Pending seller sale')).toBeTruthy();
    });

    expect(getByText('Awaiting payment')).toBeTruthy();
    expect(getByText('Awaiting buyer confirmation')).toBeTruthy();
    expect(getByText('Awaiting completion')).toBeTruthy();
    expect(getByText('Dispute open')).toBeTruthy();
    expect(getByText('Buyer rated')).toBeTruthy();
    unmount();
  });

  it('shows delivery-offer actions only for community-delivery orders', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 31,
          order_number: 'MKT-000031',
          quantity: 1,
          unit_price: 25,
          total_price: 25,
          currency: 'EUR',
          status: 'paid',
          created_at: '2026-05-20T10:00:00Z',
          listing: {
            id: 61,
            title: 'Pickup-only lamp',
            image: null,
            delivery_method: 'pickup',
          },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
        {
          id: 32,
          order_number: 'MKT-000032',
          quantity: 1,
          unit_price: 30,
          total_price: 30,
          currency: 'EUR',
          status: 'paid',
          created_at: '2026-05-21T10:00:00Z',
          listing: {
            id: 62,
            title: 'Community vase',
            image: null,
            delivery_method: 'community_delivery',
          },
          seller: { id: 3, name: 'Sam Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getByText, getAllByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Community vase')).toBeTruthy();
    });

    expect(getAllByText('Delivery offers')).toHaveLength(1);
    unmount();
  });

  it('shows community delivery offer identity and verification details', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 32,
          order_number: 'MKT-000032',
          quantity: 1,
          unit_price: 30,
          total_price: 30,
          currency: 'EUR',
          status: 'paid',
          created_at: '2026-05-21T10:00:00Z',
          listing: {
            id: 62,
            title: 'Community vase',
            image: null,
            delivery_method: 'community_delivery',
          },
          seller: { id: 3, name: 'Sam Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });
    (getMarketplaceDeliveryOffers as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 91,
          order_id: 32,
          deliverer_id: 77,
          time_credits: 1.5,
          estimated_minutes: 45,
          notes: 'I can deliver after lunch.',
          status: 'pending',
          deliverer: {
            id: 77,
            name: 'Dana Deliverer',
            avatar_url: null,
            is_verified: true,
          },
        },
      ],
    });

    const { getByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Community vase')).toBeTruthy();
    });

    fireEvent.press(getByText('Delivery offers'));

    await waitFor(() => {
      expect(getMarketplaceDeliveryOffers).toHaveBeenCalledWith(32);
      expect(getByText('Dana Deliverer')).toBeTruthy();
    });
    expect(getByText('Verified')).toBeTruthy();
    expect(getByText('1.5 time credits - 45 minutes')).toBeTruthy();
    expect(getByText('I can deliver after lunch.')).toBeTruthy();
    expect(getByText('Accept offer')).toBeTruthy();
    unmount();
  });

  it('uses a translated fallback for unknown order statuses', async () => {
    (getMarketplaceOrders as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 51,
          order_number: 'MKT-000051',
          quantity: 1,
          unit_price: 12,
          total_price: 12,
          currency: 'EUR',
          status: 'awaiting_seller_review',
          created_at: '2026-05-24T10:00:00Z',
          listing: {
            id: 81,
            title: 'Review state chair',
            image: null,
            delivery_method: 'pickup',
          },
          seller: { id: 2, name: 'Pat Seller', avatar_url: null },
        },
      ],
      meta: { cursor: null, has_more: false },
    });

    const { getAllByText, getByText, queryByText, unmount } = render(<MarketplaceOrdersRoute />);

    await waitFor(() => {
      expect(getByText('Review state chair')).toBeTruthy();
      expect(getAllByText('Unknown status').length).toBeGreaterThan(0);
    });

    expect(queryByText('orders.status.awaiting_seller_review')).toBeNull();
    expect(queryByText('awaiting_seller_review')).toBeNull();
    unmount();
  });
});
