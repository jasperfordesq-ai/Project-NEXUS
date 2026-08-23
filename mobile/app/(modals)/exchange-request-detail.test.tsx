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
        'requests.dispute.action': 'Report a problem',
        'requests.dispute.title': 'What went wrong?',
        'requests.dispute.body': 'A coordinator will see this and can step in.',
        'requests.dispute.safetyNote': 'This is not an emergency route.',
        'requests.dispute.detailsPlaceholder': 'Anything that helps (optional)',
        'requests.dispute.submit': 'Send report',
        'requests.dispute.sent': 'Reported. A coordinator will look into it.',
        'requests.dispute.reasons.hours': 'The hours are wrong',
        'requests.dispute.reasons.no_show': 'Nobody turned up',
        'requests.dispute.reasons.quality': 'Not what we agreed',
        'requests.dispute.reasons.conduct': 'How I was treated',
        'requests.dispute.reasons.other': 'Something else',
      };
      if (key === 'requests.proposedHours') return `Proposed: ${String(opts?.count ?? 0)} hours`;
      if (key === 'requests.messageOtherParty') return `Message ${String(opts?.name ?? '')}`;
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
const mockDispute = jest.fn();

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
    // 🔴 The real reason list, not a stub: it has to stay identical to the server's
    // ExchangeWorkflowService::DISPUTE_REASONS or every report is refused with a 422.
    DISPUTE_REASONS: actual.DISPUTE_REASONS,
    disputeExchangeRequest: (...a: unknown[]) => mockDispute(...a),
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

  /**
   * 🔴 Journey 3.9, walked 2026-08-22: this screen had no route to the person on the other
   * side of the exchange. The website offers one while the exchange is live and drops it once
   * it is finished, and that is the behaviour matched here.
   */
  it('offers a way to message the other party while the exchange is live', () => {
    const { getByText } = mount(exchange({ status: 'in_progress' }));
    expect(getByText('Message E2E UserB')).toBeTruthy();
  });

  it('names the requester when the viewer is the requester', () => {
    mockViewerId = 675;
    const { getByText } = mount(exchange({ status: 'accepted' }));
    expect(getByText('Message E2E UserA')).toBeTruthy();
  });

  it('drops the message button once the exchange is over', () => {
    const { queryByText } = mount(exchange({ status: 'completed' }));
    expect(queryByText('Message E2E UserB')).toBeNull();
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

  /*
    Journey 3.20 — reporting a problem. Nothing on the platform could raise a dispute
    before this: brokers had a resolve tool with nothing to resolve unless the automatic
    hours-variance rule fired.
  */
  it('offers reporting a problem exactly where the server allows it', () => {
    const running = mount(exchange({ status: 'in_progress' }));
    expect(running.queryByTestId('exchange-action-report')).not.toBeNull();
    running.unmount();

    const awaiting = mount(exchange({ status: 'pending_confirmation' }));
    expect(awaiting.queryByTestId('exchange-action-report')).not.toBeNull();
    awaiting.unmount();

    // 🔴 Not before the work starts (either side can just cancel) and not after it is
    // finished (the credits have moved; only staff can reverse that). A button offered
    // here would 409 on tap.
    const notStarted = mount(exchange({ status: 'pending_provider' }));
    expect(notStarted.queryByTestId('exchange-action-report')).toBeNull();
    notStarted.unmount();

    const finished = mount(exchange({ status: 'completed', final_hours: 1 }));
    expect(finished.queryByTestId('exchange-action-report')).toBeNull();
  });

  it('sends the reason and the details, and says the report landed', async () => {
    mockDispute.mockResolvedValue({ data: {} });
    const { getByTestId } = mount(exchange({ status: 'in_progress' }));

    fireEvent.press(getByTestId('exchange-action-report'));
    fireEvent.press(getByTestId('exchange-dispute-reason-no_show'));
    fireEvent.changeText(getByTestId('exchange-dispute-details'), '  Nobody came on Saturday.  ');
    fireEvent.press(getByTestId('exchange-dispute-submit'));

    await waitFor(() =>
      expect(mockDispute).toHaveBeenCalledWith(61, 'no_show', '  Nobody came on Saturday.  '),
    );
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Reported. A coordinator will look into it.' }),
      ),
    );
  });

  it('will not send a report with no reason chosen', () => {
    const { getByTestId } = mount(exchange({ status: 'in_progress' }));

    fireEvent.press(getByTestId('exchange-action-report'));
    // 🔴 Nothing is pre-selected: a pre-ticked reason is a guess put in the member's
    // mouth, and a broker reads this. So the submit has to wait.
    //
    // 🔴 BOTH halves are asserted on purpose. The button being disabled and the handler
    // refusing an empty reason each cover the other, so removing either one on its own
    // left this test green — measured by mutating each in turn. Asserting the visible
    // state as well as the outcome is what gives it teeth.
    expect(getByTestId('exchange-dispute-submit').props.accessibilityState?.disabled).toBe(true);

    fireEvent.press(getByTestId('exchange-dispute-submit'));

    expect(mockDispute).not.toHaveBeenCalled();
  });

  it('keeps telling this member who they are waiting for, even now they have a button', () => {
    // 🔴 This is a regression the report button caused and this test caught: the waiting
    // line used to be the "no buttons" branch, so adding one silently removed the only
    // sentence explaining why nothing was happening.
    const { getByText, queryByTestId } = mount(
      exchange({
        status: 'pending_confirmation',
        provider_confirmed_at: '2026-08-21 20:30:00',
        provider_confirmed_hours: 1,
      }),
    );

    expect(getByText('You have confirmed. Waiting for the other member.')).toBeTruthy();
    expect(queryByTestId('exchange-action-report')).not.toBeNull();
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
