// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), router: { push: (...args: unknown[]) => mockPush(...args) } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ title: 'Podcasts', subtitle: 'Community audio stories', 'browse.search_placeholder': 'Search shows', 'browse.empty': 'No podcast shows yet', 'browse.empty_hint': 'Check back soon', 'browse.retry': 'Try again', 'common:back': 'Back', 'common:actions.clear': 'Clear search' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', textMuted: '#777' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/podcasts', () => ({ getPodcastShows: jest.fn() }));

import PodcastsScreen from './podcasts';
import { getPodcastShows } from '@/lib/api/podcasts';

describe('PodcastsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getPodcastShows).mockResolvedValue({ items: [{ id: 2, title: 'Time stories', slug: 'time-stories', summary: 'Local voices.', episode_count: 4, subscriber_count: 9 }], page: 1, total: 1, hasMore: false, categories: [] });
  });

  it('opens a podcast show from the native catalogue', async () => {
    const { getByText } = render(<PodcastsScreen />);
    await waitFor(() => expect(getByText('Time stories')).toBeTruthy());
    fireEvent.press(getByText('Time stories'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/podcast-show', params: { slug: 'time-stories' } });
  });
});
