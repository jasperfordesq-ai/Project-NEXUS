// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetTickets = jest.fn();
const mockAllocate = jest.fn();
const mockCancel = jest.fn();
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: '4' }),
  router: { canGoBack: () => true, back: jest.fn() },
}));
jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ text: '#111111', textMuted: '#777777' }),
}));
jest.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'tickets.mobile.title': 'Event tickets',
    'tickets.mobile.gatewayDisabledTitle': 'Paid ticketing is disabled',
    'tickets.mobile.myTicketsTitle': 'My tickets',
    'tickets.mobile.entitlementSummary': '{{count}} ticket · {{status}}',
    'tickets.status.confirmed': 'Confirmed',
    'tickets.mobile.cancelTicket': 'Cancel ticket',
    'tickets.mobile.cancelTitle': 'Cancel this ticket?',
    'tickets.mobile.reasonLabel': 'Cancellation reason',
    'tickets.mobile.confirmCancellation': 'Confirm cancellation',
    'tickets.mobile.catalogueTitle': 'Available tickets',
    'tickets.mobile.free': 'Free',
    'tickets.mobile.remaining': '{{count}} remaining',
    'tickets.mobile.unitsLabel': 'Quantity (up to {{count}})',
    'tickets.mobile.claimFreeTicket': 'Claim free ticket',
    'tickets.mobile.timeCreditPrice': '{{credits}} time credits',
    'tickets.mobile.timeCreditDisabledTitle': 'Time-credit checkout unavailable',
  };
  return {
    useTranslation: () => ({
      t: (key: string, values?: Record<string, unknown>) => {
        let value = labels[key] ?? key;
        Object.entries(values ?? {}).forEach(([name, replacement]) => {
          value = value.replace(`{{${name}}}`, String(replacement));
        });
        return value;
      },
    }),
  };
});
jest.mock('@/lib/api/eventTickets', () => ({
  getEventTickets: (...args: unknown[]) => mockGetTickets(...args),
  allocateFreeEventTicket: (...args: unknown[]) => mockAllocate(...args),
  cancelEventTicket: (...args: unknown[]) => mockCancel(...args),
}));

import EventTicketsScreen from './event-tickets';

const freeTicket = {
  id: 7,
  version: 1,
  name: 'Community ticket',
  description: 'Free admission',
  kind: 'free',
  unit_price_credits: '0.00',
  allocation_limit: 10,
  sales_opens_at: '2030-07-01T09:00:00Z',
  sales_closes_at: '2030-08-01T09:00:00Z',
  per_member_limit: 2,
  refund_cutoff_at: null,
  organizer_cancel_refundable: false,
  status: 'active',
  availability: {
    eligibility: { eligible: true, reasons: [] },
    allocation_remaining: 9,
    member_remaining: 2,
    sales_window_open: true,
    materialization_supported: true,
    gateway_status: 'free',
    attendance_reward_included: false,
    refund_policy: { cutoff_at: null, organizer_cancel_refundable: false, execution_status: 'not_integrated' },
  },
  eligibility_policy: null,
};

const creditTicket = {
  ...freeTicket,
  id: 8,
  name: 'Credit ticket',
  kind: 'time_credit',
  unit_price_credits: '2.00',
  availability: {
    ...freeTicket.availability,
    materialization_supported: false,
    gateway_status: 'unavailable',
  },
};

const entitlement = {
  id: 12,
  ticket_type_id: 7,
  units: 1,
  kind: 'free',
  unit_price_credits: '0.00',
  total_price_credits: '0.00',
  status: 'confirmed',
  version: 1,
  confirmed_at: '2030-07-02T09:00:00Z',
  cancelled_at: null,
};

const catalogue = {
  contract_version: 1,
  event_id: 4,
  currency: 'time_credit',
  payment_gateway: { free_supported: true, time_credit_supported: false, money_supported: false },
  permissions: { manage: true, reconcile: true, allocate_self: true },
  ticket_types: [freeTicket, creditTicket],
  own_entitlements: [entitlement],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetTickets.mockResolvedValue(catalogue);
  mockAllocate.mockResolvedValue({ entitlement, confirmed_units_after: 1, changed: true, idempotent_replay: false });
  mockCancel.mockResolvedValue({
    entitlement: { ...entitlement, status: 'cancelled', version: 2, cancelled_at: '2030-07-03T09:00:00Z' },
    confirmed_units_after: 0,
    changed: true,
    idempotent_replay: false,
  });
});

describe('EventTicketsScreen', () => {
  it('supports free allocation and reasoned cancellation while keeping paid checkout disabled', async () => {
    const screen = render(<EventTicketsScreen />);

    expect(await screen.findAllByText('Community ticket')).toHaveLength(2);
    expect(screen.getByText('Paid ticketing is disabled')).toBeTruthy();
    expect(screen.getByText('Time-credit checkout unavailable')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('event-ticket-units-7'), '2');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => {
      expect(mockAllocate).toHaveBeenCalledWith(4, 7, 2, expect.any(String));
    });

    fireEvent.press(screen.getByText('Cancel ticket'));
    fireEvent.changeText(screen.getByTestId('event-ticket-cancel-reason'), 'Plans changed');
    fireEvent.press(screen.getByText('Confirm cancellation'));
    await waitFor(() => {
      expect(mockCancel).toHaveBeenCalledWith(4, 12, 1, 'Plans changed', expect.any(String));
    });

    expect(screen.queryByText('Buy with time credits')).toBeNull();
  });
});
