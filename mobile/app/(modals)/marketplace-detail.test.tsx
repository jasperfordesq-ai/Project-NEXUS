// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockFeatures = new Set(['merchant_coupons']);
let mockRouteParams: { id?: string; offer_id?: string; offer_amount?: string } = { id: '9' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('expo-crypto', () => ({ randomUUID: () => 'checkout-test-uuid' }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common.free': 'Free',
        'common.seller': 'Seller',
        'common:errors.alertTitle': 'Error',
        'detail.title': 'Listing details',
        'detail.noImages': 'No images yet',
        'detail.seller': 'Seller',
        'detail.video': 'Listing video',
        'detail.communitySeller': 'Community seller',
        'detail.viewSeller': 'View seller profile',
        'detail.description': 'Description',
        'detail.additionalDetails': 'Additional details',
        'detail.quantity': opts ? `${String(opts.count ?? 0)} available` : '0 available',
        'detail.views': opts ? `${String(opts.count ?? 0)} views` : '0 views',
        'priceType.fixed': 'Fixed price',
        'condition.good': 'Good',
        'delivery_method.pickup': 'Local pickup',
        'delivery_method.community_delivery': 'Community delivery',
        'detail.save': 'Save',
        'detail.addToCollection': 'Add to collection',
        'detail.makeOffer': 'Make offer',
        'detail.buyNow': 'Buy now',
        'detail.orderCreated': 'Order created',
        'detail.orderCreatedHint': `Order ${String(opts?.order ?? '')} was created. Payment and delivery details can be managed from orders.`,
        'detail.orderFailed': 'Order could not be created.',
        'detail.reportListing': 'Report listing',
        'detail.moreFromSeller': `More from ${String(opts?.name ?? 'this seller')}`,
        'communityDelivery.eyebrow': 'Community-powered delivery',
        'communityDelivery.title': 'Community delivery',
        'communityDelivery.description': 'A trusted member can offer to deliver this order for time credits after checkout.',
        'communityDelivery.step1': 'The buyer creates an order for this community-delivery listing.',
        'communityDelivery.step2': 'Eligible community members can offer delivery time and requested credits.',
        'communityDelivery.step3': 'The buyer or seller accepts an offer, then confirms delivery when the item arrives.',
        'communityDelivery.orderManagedHint': 'Delivery offers are managed from Marketplace orders after checkout.',
        'checkout.title': 'Checkout',
        'checkout.paymentMethodLabel': 'Choose how to pay',
        'checkout.payWithMoney': `Pay ${String(opts?.amount ?? '')}`,
        'checkout.payWithTimeCredits': `Pay with ${String(opts?.count ?? '')} time credits`,
        'checkout.coupon': 'Coupon code',
        'checkout.couponPlaceholder': 'COMMUNITY10',
        'checkout.apply': 'Apply',
        'checkout.applied': 'Applied',
        'checkout.merchantDisplayName': 'Project NEXUS marketplace',
        'pickup.chooseSlot': 'Pickup slot',
        'pickup.slotFallback': `Slot ${String(opts?.id ?? '')}`,
        'checkout.openedTitle': 'Checkout started',
        'checkout.clientSecretHint': 'The order was created. Complete payment from the web checkout if the payment sheet does not open on this device.',
        'checkout.paymentCompleteTitle': 'Payment complete',
        'checkout.paymentCompleteHint': 'Your order is paid. You can track it from Orders.',
        'checkout.paymentSheetFailed': 'The secure payment sheet could not be opened. Continue payment from Orders.',
        'checkout.paymentRecoveryTitle': 'Checkout paused',
        'checkout.paymentRecoveryHint': `Order ${String(opts?.order ?? '')} was created, but payment could not start. Continue payment from Orders.`,
        'checkout.deliveryTitle': 'Delivery method',
        'checkout.localPickup': 'Local pickup',
        'checkout.shippingLoading': 'Loading shipping options…',
        'checkout.shippingLoadFailed': 'Shipping options could not be loaded. Try again before buying.',
        'checkout.shippingUnavailable': 'This seller has no active shipping options.',
        'checkout.deliveryRequired': 'Choose a delivery method before buying.',
        'checkout.unsupportedTitle': 'Checkout unavailable',
        'checkout.timeCreditUnsupportedHint': 'Time-credit checkout is not connected in the mobile app yet. No order or wallet debit has been created.',
        'checkout.freeUnsupportedHint': 'Free-item checkout is not connected in the mobile app yet. No order has been created.',
        'checkout.pickupRecoveryTitle': 'Pickup not reserved',
        'checkout.pickupRecoveryHint': `Order ${String(opts?.order ?? '')} was created, but the pickup slot could not be reserved. Review or cancel it from Orders before trying again.`,
      };
      if (key === 'detail.templateFieldLabel') return String(opts?.field ?? '');
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { currency: 'EUR' }, hasFeature: (feature: string) => mockFeatures.has(feature) }),
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
    error: '#dc2626',
    success: '#16a34a',
    warning: '#f59e0b',
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 99, name: 'Current User' } }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-av', () => {
  const { Text } = require('react-native');
  return {
    ResizeMode: { CONTAIN: 'contain' },
    Video: ({ accessibilityLabel }: { accessibilityLabel?: string }) => <Text>{accessibilityLabel}</Text>,
  };
});
jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/BottomSheet', () => ({
  __esModule: true,
  default: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => {
    const { View } = require('react-native');
    return visible ? <View>{children}</View> : null;
  },
}));
jest.mock('@/components/marketplace/MarketplaceListingCard', () => ({
  formatMarketplacePrice: () => 'EUR 25',
}));
jest.mock('@/lib/utils/resolveImageUrl', () => ({
  resolveImageUrl: (value?: string | null) => value ?? null,
}));

jest.mock('@/lib/api/marketplace', () => ({
  addMarketplaceCollectionItem: jest.fn(),
  confirmMarketplacePayment: jest.fn(),
  createMarketplaceOrder: jest.fn(),
  createMarketplacePaymentIntent: jest.fn(),
  getMarketplaceListingPickupSlots: jest.fn().mockResolvedValue({ data: [] }),
  getMarketplaceSellerShippingOptions: jest.fn().mockResolvedValue({ data: [] }),
  getMarketplaceSellerListings: jest.fn().mockResolvedValue({ data: [] }),
  getMarketplaceCollections: jest.fn().mockResolvedValue({ data: [] }),
  getMarketplaceListing: jest.fn(),
  makeMarketplaceOffer: jest.fn(),
  reportMarketplaceListing: jest.fn(),
  saveMarketplaceListing: jest.fn(),
  unsaveMarketplaceListing: jest.fn(),
  validateMarketplaceCoupon: jest.fn(),
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

import MarketplaceDetailRoute from './marketplace-detail';
import { useAppToast } from '@/components/ui/AppToast';
import {
  confirmMarketplacePayment,
  createMarketplaceOrder,
  createMarketplacePaymentIntent,
  getMarketplaceListing,
  getMarketplaceListingPickupSlots,
  getMarketplaceSellerShippingOptions,
  getMarketplaceSellerListings,
} from '@/lib/api/marketplace';
import { presentMarketplacePayment } from '@/lib/payments/marketplacePayment';

const mockListing = {
  id: 9,
  title: 'Oak dining table',
  tagline: 'Seats six comfortably',
  description: 'Solid oak table in good condition.',
  price: 25,
  price_currency: 'EUR',
  price_type: 'fixed' as const,
  time_credit_price: null,
  condition: 'good' as const,
  quantity: 1,
  location: 'Community hall',
  delivery_method: 'pickup',
  shipping_available: false,
  local_pickup: true,
  seller_type: 'private',
  status: 'active',
  image: null,
  image_count: 0,
  images: [],
  category: null,
  user: { id: 22, name: 'Sam Seller', avatar_url: null, is_verified: false },
  is_saved: false,
  is_own: false,
  is_promoted: false,
  views_count: 4,
  saves_count: 0,
  created_at: '2026-05-01T10:00:00Z',
  template_data: {
    frame_size: 'Medium',
    material: 'Oak',
  },
};

describe('MarketplaceDetailRoute', () => {
  const showToast = useAppToast().show as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { id: '9' };
    mockFeatures = new Set(['merchant_coupons']);
    (getMarketplaceListing as jest.Mock).mockResolvedValue({ data: mockListing });
    (getMarketplaceListingPickupSlots as jest.Mock).mockResolvedValue({ data: [] });
    (getMarketplaceSellerShippingOptions as jest.Mock).mockResolvedValue({ data: [] });
    (getMarketplaceSellerListings as jest.Mock).mockResolvedValue({ data: [] });
  });

  it('renders category-specific template details from the listing payload', async () => {
    const { getByText } = render(<MarketplaceDetailRoute />);

    await waitFor(() => {
      expect(getByText('Additional details')).toBeTruthy();
      expect(getByText('Frame size')).toBeTruthy();
      expect(getByText('Medium')).toBeTruthy();
      expect(getByText('Material')).toBeTruthy();
      expect(getByText('Oak')).toBeTruthy();
    });
  });

  it('loads more listings from the same seller and excludes the current listing', async () => {
    (getMarketplaceSellerListings as jest.Mock).mockResolvedValueOnce({
      data: [
        { ...mockListing, id: 9, title: 'Oak dining table' },
        { ...mockListing, id: 10, title: 'Matching chair' },
      ],
    });

    const { getByText, queryAllByText } = render(<MarketplaceDetailRoute />);

    await waitFor(() => {
      expect(getMarketplaceSellerListings).toHaveBeenCalledWith(22, null, 4);
      expect(getByText('More from Sam Seller')).toBeTruthy();
      expect(getByText('Matching chair')).toBeTruthy();
    });
    expect(queryAllByText('Oak dining table')).toHaveLength(1);
  });

  it('renders listing video media without showing the empty image state', async () => {
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: {
        ...mockListing,
        images: [],
        image: null,
        video_url: '/uploads/marketplace/demo.mp4',
      },
    });

    const { getByText, queryByText } = render(<MarketplaceDetailRoute />);

    await waitFor(() => {
      expect(getByText('Listing video')).toBeTruthy();
    });
    expect(queryByText('No images yet')).toBeNull();
  });

  it('shows pending-payment recovery when checkout fails after order creation', async () => {
    (createMarketplaceOrder as jest.Mock).mockResolvedValue({
      data: { id: 44, order_number: 'MKT-000044', status: 'pending_payment' },
    });
    (createMarketplacePaymentIntent as jest.Mock).mockRejectedValue(new Error('Seller payments are not ready'));

    const { getByText } = render(<MarketplaceDetailRoute />);

    await waitFor(() => {
      expect(getByText('Buy now')).toBeTruthy();
    });

    const buyNow = await waitFor(() => getByText('Buy now'));
    fireEvent.press(buyNow);

    await waitFor(() => {
      expect(createMarketplacePaymentIntent).toHaveBeenCalledWith(44);
      expect(showToast).toHaveBeenCalledWith({
        title: 'Checkout paused',
        description: 'Order MKT-000044 was created, but payment could not start. Continue payment from Orders.',
        variant: 'danger',
      });
      expect(require('expo-router').router.push).toHaveBeenCalledWith({
        pathname: '/(modals)/marketplace-orders',
        params: { mode: 'purchases' },
      });
    });
  });

  it('checks out an accepted offer as cash with the offer context and no substitutions', async () => {
    mockRouteParams = { id: '9', offer_id: '31', offer_amount: '37' };
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: { ...mockListing, status: 'reserved', time_credit_price: 4 },
    });
    (createMarketplaceOrder as jest.Mock).mockResolvedValueOnce({
      data: { id: 51, order_number: 'MKT-OFFER-51', status: 'pending_payment' },
    });
    (createMarketplacePaymentIntent as jest.Mock).mockRejectedValueOnce(new Error('stop after order'));

    const { getByText, queryByText, queryByPlaceholderText } = render(<MarketplaceDetailRoute />);
    await waitFor(() => expect(getMarketplaceListing).toHaveBeenCalledWith(9, 31));
    await waitFor(() => expect(getMarketplaceListingPickupSlots).toHaveBeenCalledWith(9, 31));
    await waitFor(() => expect(getByText('Checkout')).toBeTruthy());
    expect(queryByText(/time credits/i)).toBeNull();
    expect(queryByPlaceholderText('COMMUNITY10')).toBeNull();

    fireEvent.press(getByText('Buy now'));
    await waitFor(() => {
      expect(createMarketplaceOrder).toHaveBeenCalledWith(expect.objectContaining({
        listing_id: 9,
        offer_id: 31,
        payment_method: 'cash',
        shipping_method: 'pickup',
      }));
    });
    const payload = (createMarketplaceOrder as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('coupon_code');
  });

  it('submits pickup slot selection atomically with order creation', async () => {
    (getMarketplaceListingPickupSlots as jest.Mock).mockResolvedValueOnce({
      data: [
        {
          id: 12,
          slot_start: '2026-06-01T10:00:00Z',
          slot_end: '2026-06-01T12:00:00Z',
          remaining: 2,
        },
      ],
    });
    (createMarketplaceOrder as jest.Mock).mockRejectedValue(new Error('Slot is full'));

    const { getByText, findByText, findByTestId } = render(<MarketplaceDetailRoute />);

    const slot = await findByText(/2026/);
    fireEvent.press(slot);
    await waitFor(async () => {
      const slotButton = await findByTestId('marketplace-pickup-slot-12');
      expect(slotButton.props.accessibilityState).toEqual(expect.objectContaining({ selected: true }));
    });
    const buyNow = await waitFor(() => getByText('Buy now'));
    fireEvent.press(buyNow);

    await waitFor(() => {
      expect(createMarketplaceOrder).toHaveBeenCalledWith(expect.objectContaining({
        listing_id: 9,
        shipping_method: 'pickup',
        pickup_slot_id: 12,
      }));
      expect(createMarketplacePaymentIntent).not.toHaveBeenCalled();
      expect(presentMarketplacePayment).not.toHaveBeenCalled();
      expect(showToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Slot is full',
        variant: 'danger',
      });
    });
  });

  it('completes free and time-credit orders without starting Stripe', async () => {
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: { ...mockListing, price_type: 'free', price: 0 },
    });
    (createMarketplaceOrder as jest.Mock).mockResolvedValueOnce({
      data: { id: 48, order_number: 'MKT-FREE', status: 'paid', requires_payment: false },
    });

    const freeListing = render(<MarketplaceDetailRoute />);
    fireEvent.press(await waitFor(() => freeListing.getByText('Buy now')));
    await waitFor(() => {
      expect(createMarketplaceOrder).toHaveBeenCalledWith(expect.objectContaining({
        listing_id: 9,
        payment_method: 'free',
      }));
      expect(showToast).toHaveBeenCalledWith({
        title: 'Order created',
        description: 'Order MKT-FREE was created. Payment and delivery details can be managed from orders.',
        variant: 'success',
      });
    });
    expect(createMarketplacePaymentIntent).not.toHaveBeenCalled();
    freeListing.unmount();
    jest.clearAllMocks();

    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: { ...mockListing, price: null, time_credit_price: 2 },
    });
    (getMarketplaceListingPickupSlots as jest.Mock).mockResolvedValue({ data: [] });
    (getMarketplaceSellerShippingOptions as jest.Mock).mockResolvedValue({ data: [] });
    (getMarketplaceSellerListings as jest.Mock).mockResolvedValue({ data: [] });
    (createMarketplaceOrder as jest.Mock).mockResolvedValueOnce({
      data: { id: 49, order_number: 'MKT-CREDITS', status: 'paid', requires_payment: false },
    });
    const creditListing = render(<MarketplaceDetailRoute />);
    fireEvent.press(await waitFor(() => creditListing.getByText('Buy now')));
    await waitFor(() => expect(createMarketplaceOrder).toHaveBeenCalledWith(expect.objectContaining({
      listing_id: 9,
      payment_method: 'time_credits',
    })));
    expect(createMarketplacePaymentIntent).not.toHaveBeenCalled();
  });

  it('defaults a hybrid listing to cash and lets the buyer choose time credits', async () => {
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: { ...mockListing, price: 25, price_type: 'fixed', time_credit_price: 2 },
    });
    (createMarketplaceOrder as jest.Mock).mockResolvedValueOnce({
      data: { id: 50, order_number: 'MKT-HYBRID-CREDITS', status: 'paid', requires_payment: false },
    });

    const screen = render(<MarketplaceDetailRoute />);
    const cashButton = await screen.findByTestId('marketplace-payment-cash');
    const timeCreditButton = await screen.findByTestId('marketplace-payment-time-credits');

    expect(cashButton.props.accessibilityState).toEqual(expect.objectContaining({ checked: true }));
    expect(timeCreditButton.props.accessibilityState).toEqual(expect.objectContaining({ checked: false }));

    fireEvent.press(timeCreditButton);
    await waitFor(() => {
      expect(screen.getByTestId('marketplace-payment-time-credits').props.accessibilityState)
        .toEqual(expect.objectContaining({ checked: true }));
    });

    fireEvent.press(screen.getByText('Buy now'));
    await waitFor(() => expect(createMarketplaceOrder).toHaveBeenCalledWith(expect.objectContaining({
      listing_id: 9,
      payment_method: 'time_credits',
    })));
    expect(createMarketplacePaymentIntent).not.toHaveBeenCalled();
  });

  it('submits only the server-owned shipping option id with a stable idempotency key', async () => {
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: {
        ...mockListing,
        delivery_method: 'shipping',
        shipping_available: true,
        local_pickup: false,
      },
    });
    (getMarketplaceSellerShippingOptions as jest.Mock).mockResolvedValueOnce({
      data: [{ id: 7, courier_name: 'An Post', price: 6.5, currency: 'EUR', is_default: true, is_active: true }],
    });
    (createMarketplaceOrder as jest.Mock).mockResolvedValue({
      data: { id: 47, order_number: 'MKT-000047', status: 'pending_payment' },
    });
    (createMarketplacePaymentIntent as jest.Mock).mockRejectedValue(new Error('Checkout unavailable'));

    const { getByText } = render(<MarketplaceDetailRoute />);
    await waitFor(() => {
      expect(getByText('An Post · EUR 6.50')).toBeTruthy();
    });
    fireEvent.press(getByText('Buy now'));

    await waitFor(() => {
      expect(createMarketplaceOrder).toHaveBeenCalledWith({
        listing_id: 9,
        quantity: 1,
        idempotency_key: 'mobile-marketplace-checkout-test-uuid',
        shipping_option_id: 7,
        coupon_code: undefined,
        payment_method: 'cash',
      });
    });
    const payload = (createMarketplaceOrder as jest.Mock).mock.calls[0][0];
    expect(payload).not.toHaveProperty('shipping_cost');
    expect(payload).not.toHaveProperty('shipping_method');
  });

  it('does not create an order when a shipping-only seller has no active option', async () => {
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: {
        ...mockListing,
        delivery_method: 'shipping',
        shipping_available: true,
        local_pickup: false,
      },
    });
    (getMarketplaceSellerShippingOptions as jest.Mock).mockResolvedValueOnce({ data: [] });

    const { getByText } = render(<MarketplaceDetailRoute />);
    await waitFor(() => {
      expect(getByText('This seller has no active shipping options.')).toBeTruthy();
    });
    fireEvent.press(getByText('Buy now'));
    expect(createMarketplaceOrder).not.toHaveBeenCalled();
  });

  it('does not report success or start payment for a malformed order response', async () => {
    (createMarketplaceOrder as jest.Mock).mockResolvedValue({ data: {} });

    const { getByText } = render(<MarketplaceDetailRoute />);
    fireEvent.press(await waitFor(() => getByText('Buy now')));

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith({
        title: 'Error',
        description: 'Order could not be created.',
        variant: 'danger',
      });
    });
    expect(createMarketplacePaymentIntent).not.toHaveBeenCalled();
  });

  it('confirms marketplace payment after the native payment sheet completes', async () => {
    (createMarketplaceOrder as jest.Mock).mockResolvedValue({
      data: { id: 46, order_number: 'MKT-000046', status: 'pending_payment' },
    });
    (createMarketplacePaymentIntent as jest.Mock).mockResolvedValue({
      data: { client_secret: 'pi_secret_complete', payment_intent_id: 'pi_46' },
    });
    (presentMarketplacePayment as jest.Mock).mockResolvedValueOnce({ status: 'completed' });
    (confirmMarketplacePayment as jest.Mock).mockResolvedValueOnce({
      data: { payment_id: 12, status: 'succeeded', amount: 25, currency: 'EUR', order_id: 46 },
    });

    const { getByText } = render(<MarketplaceDetailRoute />);

    const buyNow = await waitFor(() => getByText('Buy now'));
    fireEvent.press(buyNow);

    await waitFor(() => {
      expect(confirmMarketplacePayment).toHaveBeenCalledWith('pi_46');
      expect(showToast).toHaveBeenCalledWith({
        title: 'Payment complete',
        description: 'Your order is paid. You can track it from Orders.',
        variant: 'success',
      });
    });
  });

  it('hides coupon checkout controls when merchant coupons are disabled', async () => {
    mockFeatures = new Set();

    const { getByText, queryByText } = render(<MarketplaceDetailRoute />);

    await waitFor(() => {
      expect(getByText('Checkout')).toBeTruthy();
    });

    expect(queryByText('Coupon code')).toBeNull();
    expect(queryByText('Apply')).toBeNull();
  });

  it('shows only the valid order-based community delivery surface on listing detail', async () => {
    (getMarketplaceListing as jest.Mock).mockResolvedValueOnce({
      data: {
        ...mockListing,
        delivery_method: 'community_delivery',
      },
    });

    const { getAllByText, getByText, queryByText } = render(<MarketplaceDetailRoute />);

    await waitFor(() => {
      expect(getAllByText('Community delivery').length).toBeGreaterThan(0);
      expect(getByText('Delivery offers are managed from Marketplace orders after checkout.')).toBeTruthy();
    });

    expect(queryByText(/Mobile can manage/i)).toBeNull();
    expect(queryByText('Offer to deliver')).toBeNull();
  });
});
