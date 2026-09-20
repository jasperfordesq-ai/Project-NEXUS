// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { digestStringAsync } from 'expo-crypto';
import { storage } from '@/lib/storage';

jest.mock('expo-secure-store');
jest.mock('expo-crypto');
jest.mock('@/lib/storage');
const persistedTicketOperations = new Map<string, string>();

const mockGetTickets = jest.fn();
const mockAllocate = jest.fn();
const mockCancel = jest.fn();
const mockShowToast = jest.fn();
let mockEventId = '4';
let mockUserId = 1;
let mockTenantId = 2;

jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ useTenant: () => ({ tenant: { id: mockTenantId } }) }));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: mockEventId }),
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
jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) { super(message); this.status = status; this.code = code; this.name = 'ApiResponseError'; }
  },
}));
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
  mockEventId = '4';
  mockUserId = 1;
  mockTenantId = 2;
  jest.clearAllMocks();
  persistedTicketOperations.clear();
  jest.mocked(storage.getJson).mockImplementation(async () => ({ id: mockUserId }));
  jest.mocked(storage.get).mockImplementation(async () => String(mockTenantId));
  jest.mocked(digestStringAsync).mockImplementation(async (_algorithm, value) => value);
  jest.mocked(SecureStore.getItemAsync).mockImplementation(async key => persistedTicketOperations.get(key) ?? null);
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { persistedTicketOperations.set(key, value); });
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
  it.each(['completed', 'removed', 'replaced'])('does not turn a stale pending retry into a new claim (%s)', async state => {
    const { reserveEventTicketOperation, completeEventTicketOperation } = jest.requireActual('@/lib/eventTicketOperation');
    const operation = await reserveEventTicketOperation(JSON.stringify(['allocate', 4, 7, 1]));
    const screen = render(<EventTicketsScreen />);
    await screen.findByTestId('event-ticket-retry-pending');
    if (state === 'removed') persistedTicketOperations.delete(operation.storageKey);
    else {
      await completeEventTicketOperation(operation);
      if (state === 'replaced') await reserveEventTicketOperation(operation.intent);
    }
    const writesBeforeRetry = jest.mocked(SecureStore.setItemAsync).mock.calls.length;
    await act(async () => { fireEvent.press(screen.getByTestId('event-ticket-retry-pending')); });
    expect(mockAllocate).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(writesBeforeRetry);
    expect(mockGetTickets).toHaveBeenCalledTimes(2);
    if (state !== 'replaced') expect(screen.queryByTestId('event-ticket-pending')).toBeNull();
  });

  it('shows a non-retryable unavailable state for a catalogue validation refusal', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockGetTickets.mockRejectedValue(new ApiResponseError(422, 'Invalid occurrence', undefined, 'EVENT_TICKET_VALIDATION_FAILED'));
    const screen = render(<EventTicketsScreen />);
    expect(await screen.findByTestId('event-tickets-refused')).toBeTruthy();
    expect(screen.queryByText('common:buttons.retry')).toBeNull();
  });

  it('keeps the original unresolved record when a retry is refused after response loss', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockAllocate.mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'))
      .mockRejectedValueOnce(new ApiResponseError(403, 'Access changed', undefined, 'EVENT_TICKET_FORBIDDEN'));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(1));
    fireEvent.press(screen.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('event-ticket-pending')).toBeTruthy();
    expect(mockAllocate.mock.calls[1]).toEqual(mockAllocate.mock.calls[0]);
  });

  it.each(['sold-out', 'refused'])('restores the original request after reopening a %s catalogue without automatically sending', async (state) => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockAllocate.mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const first = render(<EventTicketsScreen />);
    await first.findAllByText('Community ticket');
    fireEvent.changeText(first.getByTestId('event-ticket-units-7'), '2');
    fireEvent.press(first.getByText('Claim free ticket'));
    await first.findByTestId('event-ticket-retry-pending');
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    first.unmount();
    if (state === 'refused') mockGetTickets.mockRejectedValue(new ApiResponseError(403, 'Forbidden'));
    else mockGetTickets.mockResolvedValue({ ...catalogue, ticket_types: [{ ...freeTicket, availability: { ...freeTicket.availability, member_remaining: 0 } }] });
    const next = render(<EventTicketsScreen />);
    await next.findByTestId('event-ticket-pending');
    expect(mockAllocate).toHaveBeenCalledTimes(1);
    expect(next.queryByText('Claim free ticket')).toBeNull();
    fireEvent.press(next.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(2));
    expect(mockAllocate.mock.calls[1]).toEqual(mockAllocate.mock.calls[0]);
  });

  it('retries the original quantity instead of a changed form value', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockAllocate.mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    fireEvent.changeText(screen.getByTestId('event-ticket-units-7'), '2');
    fireEvent.press(screen.getByText('Claim free ticket'));
    expect(mockAllocate).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(2));
    expect(mockAllocate.mock.calls[1]).toEqual(mockAllocate.mock.calls[0]);
  });

  it('allows correcting a new request after a definite server validation refusal', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockAllocate.mockRejectedValueOnce(new ApiResponseError(422, 'Quantity refused', undefined, 'EVENT_TICKET_VALIDATION_FAILED'));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    expect(screen.queryByTestId('event-ticket-pending')).toBeNull();
    fireEvent.changeText(screen.getByTestId('event-ticket-units-7'), '2');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(2));
    expect(mockAllocate.mock.calls[1][2]).toBe(2);
    expect(mockAllocate.mock.calls[1][3]).not.toBe(mockAllocate.mock.calls[0][3]);
  });

  it('reuses the persisted claim key after leaving and reopening following response loss', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockAllocate.mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const first = render(<EventTicketsScreen />);
    await first.findAllByText('Community ticket');
    fireEvent.press(first.getByText('Claim free ticket'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    first.unmount();
    const next = render(<EventTicketsScreen />);
    await next.findAllByText('Community ticket');
    fireEvent.press(next.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(2));
    expect(mockAllocate.mock.calls[1][3]).toBe(mockAllocate.mock.calls[0][3]);
  });

  it('does not dispatch after leaving while the request key is being persisted', async () => {
    let finishSave!: () => void;
    jest.mocked(SecureStore.setItemAsync).mockImplementationOnce((key, value) => new Promise(resolve => {
      finishSave = () => { persistedTicketOperations.set(key, value); resolve(); };
    }));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(SecureStore.setItemAsync).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { finishSave(); });
    expect(mockAllocate).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('does not submit a claim when its retry record cannot be saved', async () => {
    jest.mocked(SecureStore.setItemAsync).mockRejectedValueOnce(new Error('Storage unavailable'));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    expect(mockAllocate).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'])('ignores an obsolete retry %s after a newer catalogue loads', async (outcome) => {
    mockGetTickets.mockRejectedValueOnce(new Error('Offline'));
    const screen = render(<EventTicketsScreen />);
    const retry = await screen.findByText('common:buttons.retry');
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (error: Error) => void;
    mockGetTickets.mockImplementationOnce(() => new Promise((resolve, reject) => {
      resolveOld = resolve;
      rejectOld = reject;
    }));
    mockGetTickets.mockResolvedValueOnce({ ...catalogue, ticket_types: [{ ...freeTicket, name: 'Latest ticket' }], own_entitlements: [] });
    act(() => {
      fireEvent.press(retry);
      fireEvent.press(retry);
    });
    await screen.findByText('Latest ticket');
    await act(async () => {
      if (outcome === 'success') resolveOld(catalogue);
      else rejectOld(new Error('Old failure'));
    });
    expect(screen.getByText('Latest ticket')).toBeTruthy();
    expect(screen.queryByText('common:buttons.retry')).toBeNull();
  });

  it('reuses the allocation key after a lost response, then starts a new key after confirmed success', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockAllocate.mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    fireEvent.press(screen.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockGetTickets).toHaveBeenCalledTimes(2));
    expect(mockAllocate.mock.calls[1][3]).toBe(mockAllocate.mock.calls[0][3]);
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(3));
    expect(mockAllocate.mock.calls[2][3]).not.toBe(mockAllocate.mock.calls[0][3]);
  });

  it('reuses the cancellation key when the same request is retried after response loss', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockCancel.mockRejectedValueOnce(new ApiResponseError(0, 'Response lost'));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Cancel ticket'));
    fireEvent.changeText(screen.getByTestId('event-ticket-cancel-reason'), 'Plans changed');
    fireEvent.press(screen.getByText('Confirm cancellation'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' })));
    fireEvent.press(screen.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(2));
    expect(mockCancel.mock.calls[1][4]).toBe(mockCancel.mock.calls[0][4]);
  });

  it.each(['event', 'account', 'community'])('clears the old cancellation form on %s replacement', async (identity) => {
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Cancel ticket'));
    fireEvent.changeText(screen.getByTestId('event-ticket-cancel-reason'), 'Old context');
    if (identity === 'event') mockEventId = '5';
    if (identity === 'account') mockUserId = 3;
    if (identity === 'community') mockTenantId = 9;
    screen.rerender(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    expect(screen.queryByTestId('event-ticket-cancel-reason')).toBeNull();
    expect(mockGetTickets).toHaveBeenCalledTimes(2);
  });

  it('ignores an old event catalogue that finishes after the new event loads', async () => {
    let resolveOld!: (value: unknown) => void;
    mockGetTickets.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const screen = render(<EventTicketsScreen />);
    mockEventId = '5';
    mockGetTickets.mockResolvedValue({ ...catalogue, event_id: 5, ticket_types: [{ ...freeTicket, name: 'New event ticket' }], own_entitlements: [] });
    screen.rerender(<EventTicketsScreen />);
    await screen.findByText('New event ticket');
    await act(async () => { resolveOld(catalogue); });
    expect(screen.getByText('New event ticket')).toBeTruthy();
    expect(screen.queryAllByText('Community ticket')).toHaveLength(0);
  });

  it('serializes immediate allocation attempts before the busy state renders', async () => {
    let resolveAllocation!: (value: unknown) => void;
    mockAllocate.mockImplementationOnce(() => new Promise((resolve) => { resolveAllocation = resolve; }));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    act(() => {
      fireEvent.press(screen.getByText('Claim free ticket'));
      fireEvent.press(screen.getByText('Claim free ticket'));
    });
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(1));
    await act(async () => { resolveAllocation({ entitlement }); });
  });

  it('does not announce or reload a completed allocation after departure', async () => {
    let resolveAllocation!: (value: unknown) => void;
    mockAllocate.mockImplementationOnce(() => new Promise((resolve) => { resolveAllocation = resolve; }));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Claim free ticket'));
    await waitFor(() => expect(mockAllocate).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { resolveAllocation({ entitlement }); });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetTickets).toHaveBeenCalledTimes(1);
  });

  it('blocks competing claims while cancellation is pending and releases the lock after failure', async () => {
    let rejectCancellation!: (reason: Error) => void;
    mockCancel.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectCancellation = reject; }));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Cancel ticket'));
    fireEvent.changeText(screen.getByTestId('event-ticket-cancel-reason'), 'Plans changed');
    act(() => {
      fireEvent.press(screen.getByText('Confirm cancellation'));
      fireEvent.press(screen.getByText('Confirm cancellation'));
      fireEvent.press(screen.getByText('Claim free ticket'));
    });
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    expect(mockAllocate).not.toHaveBeenCalled();
    await act(async () => { rejectCancellation(new Error('Unavailable')); });
    expect(screen.getByTestId('event-ticket-cancel-reason').props.value).toBe('Plans changed');
    fireEvent.press(screen.getByTestId('event-ticket-retry-pending'));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(2));
  });

  it('does not announce or reload a cancellation completed after departure', async () => {
    let resolveCancellation!: (value: unknown) => void;
    mockCancel.mockImplementationOnce(() => new Promise((resolve) => { resolveCancellation = resolve; }));
    const screen = render(<EventTicketsScreen />);
    await screen.findAllByText('Community ticket');
    fireEvent.press(screen.getByText('Cancel ticket'));
    fireEvent.changeText(screen.getByTestId('event-ticket-cancel-reason'), 'Plans changed');
    fireEvent.press(screen.getByText('Confirm cancellation'));
    await waitFor(() => expect(mockCancel).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { resolveCancellation({ entitlement }); });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetTickets).toHaveBeenCalledTimes(1);
  });

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

  /*
    🔴 A refusal is not a failure. Opened by someone who is not the organiser — or who
    was one and no longer is — this screen used to say "could not load" and offer Try
    again, a button that can never work. Audit 2026-09-07, fixed 2026-09-08.
  */
  it('says the tickets are not theirs on a 403, with no dead Try again', async () => {
    const { ApiResponseError } = require('@/lib/api/client');
    mockGetTickets.mockRejectedValue(new ApiResponseError(403, 'Forbidden'));

    const screen = render(<EventTicketsScreen />);

    expect(await screen.findByTestId('event-tickets-refused')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });
});
