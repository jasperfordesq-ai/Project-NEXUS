// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockRefresh = jest.fn();
const mockAccept = jest.fn();
const mockDecline = jest.fn();
const mockStart = jest.fn();
const mockComplete = jest.fn();
const mockConfirm = jest.fn();
const mockCancel = jest.fn();
const mockShowToast = jest.fn();
const mockBack = jest.fn();
let mockViewerId = 674;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'requests.detailTitle': 'Exchange',
        'requests.back': 'Back',
        'requests.actions.accept': 'Accept',
        'requests.actions.decline': 'Decline',
        'requests.actions.start': 'Start',
        'requests.actions.complete': 'Mark as done',
        'requests.actions.confirm': 'Confirm hours',
        'requests.actions.cancel': 'Cancel exchange',
        'requests.actions.cancelSheet': 'Not now',
        'requests.status.pending_provider': 'Awaiting acceptance',
        'requests.status.pending_confirmation': 'Awaiting confirmation',
        'requests.status.completed': 'Completed',
        'requests.awaitingOther': 'You have confirmed. Waiting for the other member.',
        'requests.noActions': 'Nothing to do here right now.',
        'requests.confirmationsLabel': 'Confirmations',
        'requests.notConfirmedYet': 'Not confirmed yet',
        'requests.acceptedToast': 'Request accepted',
        'requests.confirmedToast': 'Hours confirmed',
        'requests.actionFailedTitle': 'That did not work',
        'requests.actionFailedFallback': 'Please try again.',
        'requests.hoursInvalidTitle': 'Check the hours',
        'requests.hoursInvalidBody': 'Enter the hours given.',
        'requests.confirmSheetTitle': 'Confirm hours',
        'requests.untitledListing': 'Untitled listing',
      };
      if (key === 'requests.proposedHours') return `Proposed: ${String(opts?.count ?? 0)} hours`;
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mockViewerId } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#000', border: '#ddd' }),
}));
jest.mock('@/lib/haptics', () => ({
  notificationAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('@/lib/api/exchangeRequests', () => {
  const actual = jest.requireActual('@/lib/api/exchangeRequests');
  return {
    // 🔴 The action rules are NOT mocked. They are the thing worth testing here: which
    // buttons a member is offered has to follow the server's own guards, or a tap 403s.
    exchangeRequestActions: actual.exchangeRequestActions,
    getExchangeRequest: jest.fn(),
    acceptExchangeRequest: (...a: unknown[]) => mockAccept(...a),
    declineExchangeRequest: (...a: unknown[]) => mockDecline(...a),
    startExchangeRequest: (...a: unknown[]) => mockStart(...a),
    completeExchangeRequest: (...a: unknown[]) => mockComplete(...a),
    confirmExchangeRequest: (...a: unknown[]) => mockConfirm(...a),
    cancelExchangeRequest: (...a: unknown[]) => mockCancel(...a),
  };
});
jest.mock('@/lib/api/describeApiError', () => ({
  describeApiError: (_error: unknown, fallback: string) => fallback,
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('expo-router', () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  useLocalSearchParams: () => ({ id: '61' }),
  // Runs the effect once on mount, which is what focus does on a freshly opened screen.
  useFocusEffect: (cb: () => void) => {
    const React = require('react');
    React.useEffect(() => cb(), [cb]);
  },
}));
jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return function AppTopBar({ title }: { title?: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: (...args: unknown[]) => mockShowToast(...args) }),
}));
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return function BottomSheet({
    visible,
    children,
  }: {
    visible: boolean;
    children: React.ReactNode;
  }) {
    // Only render when open, exactly as the real sheet does, so a test cannot press a
    // button inside a closed sheet and call it working.
    return visible ? <View testID="bottom-sheet">{children}</View> : null;
  };
});
jest.mock('@/components/ui/ErrorState', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function ErrorState({ title }: { title?: string }) {
    return <View>{title ? <Text>{title}</Text> : null}</View>;
  };
});
jest.mock('@/components/ui/Input', () => {
  const React = require('react');
  const { TextInput } = require('react-native');
  return function Input(props: Record<string, unknown>) {
    return <TextInput {...props} />;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => {
  const React = require('react');
  return function ModalErrorBoundary({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  };
});

import ExchangeRequestDetailScreen from './exchange-request-detail';

function exchange(overrides: Record<string, unknown> = {}) {
  return {
    id: 61,
    listing_id: 513,
    requester_id: 675,
    provider_id: 674,
    listing: { id: 513, title: 'Gardening help', type: 'offer' },
    requester: { id: 675, name: 'E2E UserB', avatar: null },
    provider: { id: 674, name: 'E2E UserA', avatar: null },
    proposed_hours: 1,
    prep_time: null,
    final_hours: null,
    status: 'pending_provider',
    risk_level: null,
    message: null,
    requester_confirmed_at: null,
    requester_confirmed_hours: null,
    provider_confirmed_at: null,
    provider_confirmed_hours: null,
    broker_notes: null,
    created_at: '2026-08-21 20:21:12',
    status_history: [],
    ...overrides,
  };
}

function mount(data: Record<string, unknown>) {
  mockUseApi.mockReturnValue({
    data: { data },
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  });
  return render(<ExchangeRequestDetailScreen />);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockViewerId = 674;
  mockAccept.mockResolvedValue({ data: exchange({ status: 'accepted' }) });
  mockConfirm.mockResolvedValue({ data: exchange({ status: 'completed' }) });
});

describe('ExchangeRequestDetailScreen', () => {
  it('offers accept and decline to the provider on a pending request', () => {
    const { getByTestId } = mount(exchange());

    expect(getByTestId('exchange-action-accept')).toBeTruthy();
    expect(getByTestId('exchange-action-decline')).toBeTruthy();
  });

  it('does NOT offer accept to the requester — the server answers 403', () => {
    mockViewerId = 675;
    const { queryByTestId, getByTestId } = mount(exchange());

    expect(queryByTestId('exchange-action-accept')).toBeNull();
    expect(queryByTestId('exchange-action-decline')).toBeNull();
    // Walking away is still theirs to do.
    expect(getByTestId('exchange-action-cancel')).toBeTruthy();
  });

  it('accepts the request and reports it', async () => {
    const { getByTestId } = mount(exchange());

    fireEvent.press(getByTestId('exchange-action-accept'));

    await waitFor(() => expect(mockAccept).toHaveBeenCalledWith(61));
    expect(mockShowToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Request accepted' }),
    );
    // The screen re-reads rather than trusting its own optimistic guess about the status.
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('confirms the hours through the sheet, pre-filled with the agreed figure', async () => {
    const { getByTestId, queryByTestId } = mount(
      exchange({ status: 'pending_confirmation', proposed_hours: 1.5 }),
    );

    expect(queryByTestId('bottom-sheet')).toBeNull();

    fireEvent.press(getByTestId('exchange-action-confirm'));
    expect(getByTestId('bottom-sheet')).toBeTruthy();
    expect(getByTestId('exchange-confirm-hours').props.value).toBe('1.5');

    fireEvent.press(getByTestId('exchange-confirm-submit'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(61, 1.5));
  });

  it('refuses a confirmation of zero hours without calling the server', async () => {
    const { getByTestId } = mount(exchange({ status: 'pending_confirmation' }));

    fireEvent.press(getByTestId('exchange-action-confirm'));
    fireEvent.changeText(getByTestId('exchange-confirm-hours'), '0');
    fireEvent.press(getByTestId('exchange-confirm-submit'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Check the hours' }),
      ),
    );
    // 🔴 The server would reject this anyway; the point is not to spend a round trip and
    // not to show a generic failure for something the app can see is wrong.
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('accepts a comma as the decimal separator, because half the locales use one', async () => {
    const { getByTestId } = mount(exchange({ status: 'pending_confirmation' }));

    fireEvent.press(getByTestId('exchange-action-confirm'));
    fireEvent.changeText(getByTestId('exchange-confirm-hours'), '2,5');
    fireEvent.press(getByTestId('exchange-confirm-submit'));

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledWith(61, 2.5));
  });

  it('says who it is waiting for once this member has confirmed', () => {
    const { getByText, queryByTestId } = mount(
      exchange({
        status: 'pending_confirmation',
        provider_confirmed_at: '2026-08-21 20:30:00',
        provider_confirmed_hours: 1,
      }),
    );

    expect(queryByTestId('exchange-action-confirm')).toBeNull();
    expect(getByText('You have confirmed. Waiting for the other member.')).toBeTruthy();
  });

  it('offers nothing on a completed exchange, and says so', () => {
    const { getByText, queryByTestId } = mount(
      exchange({ status: 'completed', final_hours: 1 }),
    );

    expect(queryByTestId('exchange-action-confirm')).toBeNull();
    expect(queryByTestId('exchange-action-cancel')).toBeNull();
    expect(getByText('Nothing to do here right now.')).toBeTruthy();
  });

  it('shows the failure reason from the server rather than a generic apology', async () => {
    mockAccept.mockRejectedValue(new Error('nope'));
    const { getByTestId } = mount(exchange());

    fireEvent.press(getByTestId('exchange-action-accept'));

    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'That did not work', variant: 'danger' }),
      ),
    );
  });
});
