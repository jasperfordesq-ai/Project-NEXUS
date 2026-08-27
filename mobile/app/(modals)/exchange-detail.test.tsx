// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { RefreshControl, StyleSheet } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '5' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detail.title': 'Exchange Details',
        'detail.invalidId': 'Invalid exchange ID.',
        'detail.notFound': 'Exchange not found.',
        'detail.goBack': 'Go Back',
        'detail.postedBy': 'Posted by',
        'detail.timeEstimate': 'Time Estimate',
        'detail.requestService': 'Request this Service',
        'detail.offerHelp': 'Offer Help',
        'detail.requestExchange': 'Request exchange',
        'detail.requestHoursPlaceholder': 'Proposed hours',
        'detail.requestMessagePlaceholder': 'Add a note for the member',
        'detail.sendRequest': 'Send request',
        'detail.cancel': 'Cancel',
        'detail.exchangeActive': 'Exchange open',
        'detail.exchangeActiveTitle': 'Exchange already open',
        'detail.exchangeActiveMessage': 'You already have an exchange in progress for this listing.',
        'detail.messageMember': 'Message',
        'detail.save': 'Save',
        'detail.communityActions': 'Community actions',
        'detail.like': 'Like',
        'detail.comment': 'Comment',
        'detail.share': 'Share',
        'detail.report': 'Report',
        'detail.reported': 'Reported',
        'detail.reportTitle': 'Report this listing',
        'detail.reportSubmit': 'Submit report',
        'detail.reportDetailsPlaceholder': 'Add details (optional)',
        'detail.reportReason.safety_concern': 'Safety concern',
        'detail.reportReason.spam': 'Spam',
        'detail.ownerTools': 'Listing tools',
        'offering': 'Offering',
        'requesting': 'Requesting',
        'common:errors.alertTitle': 'Error',
        'common:buttons.cancel': 'Cancel',
        'detail.imageThumbnail': opts ? `Show listing image ${String(opts.number ?? '')}` : 'Show listing image',
        'detail.hours': opts ? `${String(opts.count ?? 0)} hrs` : '0 hrs',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
    errorBg: '#fee2e2',
    successBg: '#dcfce7',
    infoBg: '#dbeafe',
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 99, name: 'Current User' } }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Medium: 'medium', Light: 'light' },
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

// Mirror the volunteering-detail.test.tsx convention: the project BottomSheet
// wrapper renders its title + children inline when visible, nothing otherwise.
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function MockBottomSheet({
    children,
    visible,
    title,
  }: {
    children: React.ReactNode;
    visible: boolean;
    title?: string;
  }) {
    return visible ? (
      <View>
        {title ? <Text>{title}</Text> : null}
        {children}
      </View>
    ) : null;
  };
});

jest.mock('@/lib/api/exchanges', () => ({
  getExchange: jest.fn(),
  getExchangeWorkflowConfig: jest.fn().mockResolvedValue({ data: { exchange_workflow_enabled: true } }),
  checkActiveExchange: jest.fn().mockResolvedValue({ data: null }),
  getExchangeComments: jest.fn().mockResolvedValue({ data: { comments: [], count: 0 } }),
  createExchangeRequest: jest.fn(),
  deleteExchange: jest.fn(),
  renewExchange: jest.fn(),
  saveExchange: jest.fn(),
  unsaveExchange: jest.fn(),
  submitExchangeComment: jest.fn(),
  toggleExchangeLike: jest.fn(),
  reportExchange: jest.fn(),
}));

jest.mock('@/lib/api/verification', () => ({
  getUserVerificationBadges: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: invoking confirm() runs the action immediately, mirroring the
// old Alert.alert destructive-button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/comments/CommentSheet', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return function MockCommentSheet({
    visible,
    targetType,
    targetId,
  }: {
    visible: boolean;
    targetType: string;
    targetId: number;
  }) {
    return visible ? <Text>{`comments-${targetType}-${targetId}`}</Text> : null;
  };
});

// --- Tests ---

import ExchangeDetailModal from './exchange-detail';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockUseApi.mockReturnValue(defaultApiState);
});

const mockExchange = {
  id: 5,
  title: 'Homemade Bread Baking Lessons',
  description: 'I will teach you how to bake sourdough bread at home.',
  type: 'offer' as const,
  hours_estimate: 2,
  image_url: null,
  user: {
    id: 42,
    name: 'Alice Baker',
    avatar_url: null,
  },
};

describe('ExchangeDetailModal', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { toJSON } = render(<ExchangeDetailModal />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<ExchangeDetailModal />)).not.toThrow();
  });

  it('renders the exchange title when loaded', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<ExchangeDetailModal />);
    expect(getByText('Homemade Bread Baking Lessons')).toBeTruthy();
  });

  it('keeps pull-to-refresh active until the exchange request completes', () => {
    jest.useFakeTimers();
    const apiState = {
      data: { data: mockExchange },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    mockUseApi.mockImplementation(() => apiState);

    const screen = render(<ExchangeDetailModal />);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');

    apiState.isLoading = true;
    screen.rerender(<ExchangeDetailModal />);
    jest.advanceTimersByTime(2000);
    screen.rerender(<ExchangeDetailModal />);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);

    apiState.isLoading = false;
    screen.rerender(<ExchangeDetailModal />);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    jest.useRealTimers();
  });

  it('renders the not found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getAllByText, getByText } = render(<ExchangeDetailModal />);
    expect(getByText('Exchange not found.')).toBeTruthy();
    expect(getAllByText('Go Back').length).toBeGreaterThan(0);
  });

  it('renders the exchange type (offer/request) badge', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<ExchangeDetailModal />);
    // type is 'offer', so badge text is 'Offering'
    expect(getByText('Offering')).toBeTruthy();
  });

  it('opens author profiles from HeroUI Native-backed author cards', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');

    const { getByLabelText } = render(<ExchangeDetailModal />);
    fireEvent.press(getByLabelText('Alice Baker'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/member-profile',
      params: { id: '42' },
    });
  });

  it('keeps member workflow actions available in the bottom footer', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByLabelText, getByText } = render(<ExchangeDetailModal />);

    expect(getByLabelText('Save')).toBeTruthy();
    expect(getByLabelText('Message')).toBeTruthy();
    expect(getByLabelText('Request this Service')).toBeTruthy();
    expect(getByText('Request this Service').props.numberOfLines).toBe(1);
    expect(getByText('Message').props.numberOfLines).toBe(1);
  });

  it('pins the detail content and member action footer to a full-height Android layout', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByTestId } = render(<ExchangeDetailModal />);

    expect(StyleSheet.flatten(getByTestId('exchange-detail-screen').props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: '#ffffff' }),
    );
    expect(StyleSheet.flatten(getByTestId('exchange-detail-scroll').props.style)).toEqual(
      expect.objectContaining({ flex: 1, backgroundColor: '#ffffff' }),
    );
    expect(StyleSheet.flatten(getByTestId('exchange-detail-footer').props.style)).toEqual(
      expect.objectContaining({ position: 'absolute', bottom: 0, left: 0, right: 0 }),
    );
    expect(StyleSheet.flatten(getByTestId('exchange-detail-save-action').props.style)).toEqual(
      expect.objectContaining({ height: 48, width: 48, flexShrink: 0 }),
    );
  });

  it('opens member messages with the listing context attached', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');

    const { getByLabelText } = render(<ExchangeDetailModal />);
    fireEvent.press(getByLabelText('Message'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: { recipientId: '42', name: 'Alice Baker', listing: '5' },
    });
  });

  it('opens the request exchange form as a bottom sheet', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByLabelText, getByTestId, queryByTestId } = render(<ExchangeDetailModal />);

    await waitFor(() => {
      expect(getByLabelText('Request exchange')).toBeTruthy();
    });

    expect(queryByTestId('exchange-request-sheet')).toBeNull();
    fireEvent.press(getByLabelText('Request exchange'));

    await waitFor(() => {
      expect(getByTestId('exchange-request-sheet')).toBeTruthy();
      expect(getByLabelText('Proposed hours')).toBeTruthy();
      expect(getByLabelText('Add a note for the member')).toBeTruthy();
      expect(getByLabelText('Send request')).toBeTruthy();
    });
  });

  it('submits an exchange request from the bottom sheet and closes it', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });
    const { createExchangeRequest } = require('@/lib/api/exchanges');
    (createExchangeRequest as jest.Mock).mockResolvedValue({ data: { id: 77, status: 'requested' } });

    const { getByLabelText, getByPlaceholderText, getByTestId, queryByTestId } = render(<ExchangeDetailModal />);

    await waitFor(() => {
      expect(getByLabelText('Request exchange')).toBeTruthy();
    });
    fireEvent.press(getByLabelText('Request exchange'));

    await waitFor(() => {
      expect(getByTestId('exchange-request-sheet')).toBeTruthy();
    });

    fireEvent.changeText(getByPlaceholderText('Proposed hours'), '3');
    fireEvent.changeText(getByPlaceholderText('Add a note for the member'), 'I would love a lesson.');
    fireEvent.press(getByLabelText('Send request'));

    await waitFor(() => {
      expect(createExchangeRequest).toHaveBeenCalledWith({
        listing_id: 5,
        proposed_hours: 3,
        message: 'I would love a lesson.',
      });
    });
    await waitFor(() => {
      expect(queryByTestId('exchange-request-sheet')).toBeNull();
    });
  });

  it('opens the report listing form as a bottom sheet and submits it', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });
    const { reportExchange } = require('@/lib/api/exchanges');
    (reportExchange as jest.Mock).mockResolvedValue({});

    const { getByLabelText, getByPlaceholderText, getByTestId, getByText, queryByTestId } = render(<ExchangeDetailModal />);

    expect(queryByTestId('exchange-report-sheet')).toBeNull();
    fireEvent.press(getByText('Report'));

    await waitFor(() => {
      expect(getByTestId('exchange-report-sheet')).toBeTruthy();
      expect(getByText('Safety concern')).toBeTruthy();
    });

    fireEvent.press(getByText('Spam'));
    fireEvent.changeText(getByPlaceholderText('Add details (optional)'), 'This looks like spam.');
    fireEvent.press(getByLabelText('Submit report'));

    await waitFor(() => {
      expect(reportExchange).toHaveBeenCalledWith(5, {
        reason: 'spam',
        details: 'This looks like spam.',
      });
    });
    await waitFor(() => {
      expect(queryByTestId('exchange-report-sheet')).toBeNull();
    });
  });

  it('opens listing comments in a native bottom sheet', () => {
    mockUseApi.mockReturnValue({ data: { data: mockExchange }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<ExchangeDetailModal />);
    fireEvent.press(getByText('Comment'));

    expect(getByText('comments-listing-5')).toBeTruthy();
  });

  it('renders backend listing image galleries from detail responses', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockExchange,
          images: [
            { id: 10, url: '/uploads/listings/first.jpg', sort_order: 0, alt_text: 'Fresh bread on a table' },
            { id: 11, url: '/uploads/listings/second.jpg', sort_order: 1, alt_text: null },
          ],
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByLabelText } = render(<ExchangeDetailModal />);

    fireEvent.press(getByLabelText('Show listing image 2'));
    expect(getByLabelText('Show listing image 1')).toBeTruthy();
    expect(getByLabelText('Show listing image 2')).toBeTruthy();
  });
});
