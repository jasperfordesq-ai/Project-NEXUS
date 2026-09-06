// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetHistory = jest.fn();
let mockEventId = '7';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: mockEventId }),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));
jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111111',
    textSecondary: '#555555',
    error: '#cc0000',
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#4f46e5' }));
jest.mock('@/lib/api/eventLifecycleHistory', () => ({
  getEventLifecycleHistory: (...args: unknown[]) => mockGetHistory(...args),
}));

import EventLifecycleHistoryScreen from './event-lifecycle-history';

function entry(id: number, version = id) {
  return {
    id,
    lifecycle_version: version,
    publication: { from: 'pending_review', to: 'published' },
    operational: { from: 'scheduled', to: 'scheduled' },
    reason: `Reason ${id}`,
    actor: { id: 4, display_name: `Manager ${id}` },
    evidence: {
      axes_changed: ['publication'],
      cascade: {},
      series: null,
      notifications_suppressed: false,
    },
    created_at: '2026-07-12T10:00:00+00:00',
    immutable: true,
  };
}

function response(data: ReturnType<typeof entry>[], nextCursor: string | null) {
  return {
    data,
    meta: { per_page: 20, next_cursor: nextCursor, has_more: nextCursor !== null },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('EventLifecycleHistoryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEventId = '7';
  });

  it('loads every bounded page and de-duplicates immutable entries', async () => {
    mockGetHistory
      .mockResolvedValueOnce(response([entry(3), entry(2)], 'next-page'))
      .mockResolvedValueOnce(response([entry(2), entry(1)], null));

    const screen = render(<EventLifecycleHistoryScreen />);
    expect(await screen.findByText('Version 3')).toBeTruthy();
    fireEvent.press(screen.getByText('Load more history'));

    expect(await screen.findByText('Version 1')).toBeTruthy();
    expect(screen.getAllByText('Immutable')).toHaveLength(3);
    expect(screen.queryByText('Load more history')).toBeNull();
    expect(mockGetHistory).toHaveBeenNthCalledWith(2, 7, 'next-page');
  });

  it('ignores a stale event response after navigation changes the subject', async () => {
    const stale = deferred<ReturnType<typeof response>>();
    const current = deferred<ReturnType<typeof response>>();
    mockGetHistory
      .mockReturnValueOnce(stale.promise)
      .mockReturnValueOnce(current.promise);

    const screen = render(<EventLifecycleHistoryScreen />);
    mockEventId = '8';
    screen.rerender(<EventLifecycleHistoryScreen />);

    await act(async () => current.resolve(response([entry(80, 8)], null)));
    expect(await screen.findByText('Version 8')).toBeTruthy();
    await act(async () => stale.resolve(response([entry(70, 7)], null)));
    await waitFor(() => expect(screen.queryByText('Version 7')).toBeNull());
  });

  it('offers retry after an error and then renders the empty state', async () => {
    mockGetHistory
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response([], null));

    const screen = render(<EventLifecycleHistoryScreen />);
    expect(await screen.findByText('Lifecycle history unavailable')).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));

    expect(await screen.findByText('No lifecycle changes yet')).toBeTruthy();
    expect(mockGetHistory).toHaveBeenCalledTimes(2);
  });
});
