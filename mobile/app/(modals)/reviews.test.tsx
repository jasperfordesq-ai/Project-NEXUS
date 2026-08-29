// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockUseAuth = jest.fn();
const mockCreateReview = jest.fn();
const mockDeleteReview = jest.fn();
const mockSearchParams: { tab?: string; transaction_id?: string } = {};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: (...args: unknown[]) => mockUseAuth(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#e5e7eb',
    surface: '#ffffff',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    onPrimary: '#ffffff',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <View testID="review-form-sheet">{children}</View> : null;
});
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'reviews.title': 'Reviews',
        'reviews.subtitle': 'Trust signals from completed exchanges.',
        'reviews.received': 'Received',
        'reviews.given': 'Given',
        'reviews.pending': 'Pending',
        'reviews.total': 'Total reviews',
        'reviews.average': 'Average rating',
        'reviews.pendingCount': 'Pending reviews',
        'reviews.delete': 'Delete',
        'reviews.deleteSuccess': 'Review deleted.',
        'reviews.write': 'Write review',
        'reviews.cancel': 'Cancel',
        'reviews.submit': 'Submit review',
        'reviews.comment': 'Comment',
        'reviews.commentPlaceholder': 'Share what went well...',
        'reviews.emptyReceivedTitle': 'No received reviews yet',
        'reviews.emptyGivenTitle': 'No given reviews yet',
        'reviews.emptyPendingTitle': 'No pending reviews',
        'reviews.emptySubtitle': 'Reviews will appear here after completed exchanges.',
        'reviews.errorTitle': 'Could not load reviews',
        'reviews.anonymous': 'Anonymous member',
        'reviews.ratingLabel': opts ? `${String(opts.rating)} out of 5` : 'Rating',
        'reviews.rateStar': opts ? `Rate ${String(opts.star)} stars` : 'Rate stars',
        'reviews.forExchange': opts ? `For ${String(opts.title)}` : 'For exchange',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/api/reviews', () => ({
  getUserReviews: jest.fn(),
  getPendingReviews: jest.fn(),
  createReview: (...args: unknown[]) => mockCreateReview(...args),
  deleteReview: (...args: unknown[]) => mockDeleteReview(...args),
}));

import ReviewsScreen from './reviews';

describe('ReviewsScreen', () => {
  const refreshReceived = jest.fn();
  const refreshPending = jest.fn();
  let useApiCall = 0;

  beforeEach(() => {
    jest.clearAllMocks();
    delete mockSearchParams.tab;
    delete mockSearchParams.transaction_id;
    useApiCall = 0;
    mockUseAuth.mockReturnValue({ user: { id: 7 } });
    mockCreateReview.mockResolvedValue({ success: true });
    mockDeleteReview.mockResolvedValue({ success: true });
    const reviewsState = {
        data: {
          items: [
            {
              id: 1,
              rating: 5,
              comment: 'Thoughtful exchange.',
              reviewer: { id: 2, name: 'Niamh' },
              created_at: '2026-05-29T10:00:00Z',
            },
            {
              id: 2,
              rating: 4,
              comment: 'I shared a lift.',
              reviewer: { id: 7, name: 'Me' },
              created_at: '2026-05-28T10:00:00Z',
              direction: 'given',
            },
          ],
          cursor: null,
          hasMore: false,
        },
        isLoading: false,
        error: null,
        refresh: refreshReceived,
      };
    const pendingState = {
        data: [
          {
            exchange_id: 22,
            receiver_id: 8,
            receiver_name: 'Sam',
            receiver_avatar: null,
            transaction_id: 99,
            exchange_title: 'Garden help',
          },
        ],
        isLoading: false,
        error: null,
        refresh: refreshPending,
      };
    mockUseApi.mockImplementation(() => {
      useApiCall += 1;
      return useApiCall % 2 === 1 ? reviewsState : pendingState;
    });
  });

  it('renders received reviews, stats, and pending review count', () => {
    const { getAllByText, getByText } = render(<ReviewsScreen />);

    expect(getAllByText('Reviews').length).toBeGreaterThan(0);
    expect(getByText('Total reviews')).toBeTruthy();
    expect(getByText('5 out of 5')).toBeTruthy();
    expect(getByText('Thoughtful exchange.')).toBeTruthy();
    expect(getByText('Pending reviews')).toBeTruthy();
  });

  it('submits a pending review and refreshes the pending list', async () => {
    const { getByLabelText, getByPlaceholderText, getByTestId, getByText } = render(<ReviewsScreen />);

    fireEvent.press(getByText('Pending'));
    fireEvent.press(getByText('Write review'));
    expect(getByTestId('review-form-sheet')).toBeTruthy();
    fireEvent.press(getByLabelText('Rate 4 stars'));
    fireEvent.changeText(getByPlaceholderText('Share what went well...'), 'Friendly and clear.');
    fireEvent.press(getByText('Submit review'));

    await waitFor(() => expect(mockCreateReview).toHaveBeenCalledWith({
      receiver_id: 8,
      rating: 4,
      comment: 'Friendly and clear.',
      transaction_id: 99,
    }));
    expect(refreshPending).toHaveBeenCalled();
  });

  it('opens the matching pending composer from a review-request deep link', async () => {
    mockSearchParams.tab = 'pending';
    mockSearchParams.transaction_id = '99';

    const { findByTestId, getAllByText } = render(<ReviewsScreen />);

    expect(await findByTestId('review-form-sheet')).toBeTruthy();
    expect(getAllByText('For Garden help').length).toBeGreaterThan(0);
  });

  it('deletes a given review', async () => {
    const { getByText } = render(<ReviewsScreen />);

    fireEvent.press(getByText('Given'));
    fireEvent.press(getByText('Delete'));

    await waitFor(() => expect(mockDeleteReview).toHaveBeenCalledWith(2));
    expect(refreshReceived).toHaveBeenCalled();
  });
});
