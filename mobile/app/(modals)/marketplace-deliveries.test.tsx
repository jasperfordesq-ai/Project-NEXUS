// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

const mockShowToast = jest.fn();
const mockRefresh = jest.fn(async () => undefined);
const mockOpportunity = {
  order_id: 41,
  quantity: 1,
  created_at: '2026-09-13T10:00:00Z',
  can_offer: true,
  listing: { id: 8, title: 'Community parcel', location: 'Town centre', image: null },
  my_offer: null,
};

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => ({
      'common:back': 'Back',
      'common:errors.alertTitle': 'Error',
      'common:buttons.retry': 'Retry',
      'communityDelivery.deliveriesTitle': 'Community deliveries',
      'communityDelivery.deliveriesSubtitle': 'Help deliver paid marketplace orders.',
      'communityDelivery.offerAction': 'Offer to deliver',
      'communityDelivery.offerTitle': 'Offer community delivery',
      'communityDelivery.offerHint': 'Choose credits and estimated time.',
      'communityDelivery.creditsLabel': 'Requested time credits',
      'communityDelivery.minutesLabel': 'Estimated minutes (optional)',
      'communityDelivery.notesLabel': 'Note (optional)',
      'communityDelivery.sendOffer': 'Send delivery offer',
      'communityDelivery.sending': 'Sending offer…',
      'communityDelivery.offerSent': 'Delivery offer sent',
      'communityDelivery.offerFailed': 'Could not send the delivery offer.',
      'orders.quantity': `${String(opts?.count ?? 0)} item`,
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/components/withRouteGate', () => ({ withRouteGate: (component: unknown) => component }));
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ui/BottomSheet', () => {
  const { View } = require('react-native');
  return ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? <View>{children}</View> : null;
});
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShowToast }) }));
jest.mock('@/components/ui/RemoteImage', () => () => null);
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 77 }, isAuthenticated: true, isLoading: false }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006fee',
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff', surface: '#fff', border: '#ddd', text: '#111', textSecondary: '#555', textMuted: '#666',
  }),
}));
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: () => ({
    items: [mockOpportunity], isLoading: false, isLoadingMore: false, error: null, hasMore: false,
    refresh: mockRefresh, loadMore: jest.fn(),
  }),
}));
jest.mock('@/lib/api/marketplace', () => ({
  createMarketplaceDeliveryOffer: jest.fn(),
  getMarketplaceDeliveryOffers: jest.fn(),
  getMarketplaceDeliveryOpportunities: jest.fn(),
  marketplaceHasMore: jest.fn(() => false),
  marketplaceNextCursor: jest.fn(() => null),
}));

import MarketplaceDeliveriesRoute from './marketplace-deliveries';
import { createMarketplaceDeliveryOffer, getMarketplaceDeliveryOffers } from '@/lib/api/marketplace';

describe('MarketplaceDeliveriesRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createMarketplaceDeliveryOffer).mockResolvedValue({ data: { id: 9 } } as never);
  });

  it('exposes available orders and serializes rapid delivery offers', async () => {
    const ui = render(<MarketplaceDeliveriesRoute />);
    expect(ui.getByText('Community parcel')).toBeTruthy();
    expect(ui.getByText('Town centre')).toBeTruthy();

    fireEvent.press(ui.getByText('Offer to deliver'));
    fireEvent.changeText(ui.getByLabelText('Requested time credits'), '1.5');
    fireEvent.changeText(ui.getByLabelText('Estimated minutes (optional)'), '45');
    fireEvent.changeText(ui.getByLabelText('Note (optional)'), 'After lunch');
    const send = ui.getByText('Send delivery offer');
    fireEvent.press(send);
    fireEvent.press(send);

    await waitFor(() => expect(createMarketplaceDeliveryOffer).toHaveBeenCalledTimes(1));
    expect(createMarketplaceDeliveryOffer).toHaveBeenCalledWith(41, {
      time_credits: 1.5,
      estimated_minutes: 45,
      notes: 'After lunch',
    });
  });

  it('accepts an exact authoritative offer after the POST response is lost', async () => {
    jest.mocked(createMarketplaceDeliveryOffer).mockRejectedValueOnce(new ApiResponseError(0, 'Network request failed'));
    jest.mocked(getMarketplaceDeliveryOffers).mockResolvedValueOnce({
      data: [{
        id: 9,
        order_id: 41,
        deliverer_id: 77,
        time_credits: 1.5,
        estimated_minutes: 45,
        notes: 'After lunch',
        status: 'pending',
      }],
    } as never);
    const ui = render(<MarketplaceDeliveriesRoute />);
    fireEvent.press(ui.getByText('Offer to deliver'));
    fireEvent.changeText(ui.getByLabelText('Requested time credits'), '1.5');
    fireEvent.changeText(ui.getByLabelText('Estimated minutes (optional)'), '45');
    fireEvent.changeText(ui.getByLabelText('Note (optional)'), 'After lunch');
    fireEvent.press(ui.getByText('Send delivery offer'));

    await waitFor(() => expect(getMarketplaceDeliveryOffers).toHaveBeenCalledWith(41));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delivery offer sent', variant: 'success' }));
    expect(mockShowToast).not.toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
  });
});
