// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockGetPodcastShowStats = jest.fn();

jest.mock('@/lib/api/podcasts', () => ({
  getPodcastShowStats: (...args: unknown[]) => mockGetPodcastShowStats(...args),
}));

jest.mock('react-i18next', () => {
  const map: Record<string, string> = {
    'studio.stats.title': 'Listener stats',
    'studio.stats.listens': 'Listens',
    'studio.stats.unique_listeners': 'Unique listeners',
    'studio.stats.completion_rate': 'Completion rate',
    'studio.stats.subscribers': 'Subscribers',
    'studio.stats.top_episodes': 'Top episodes',
    'studio.stats.listen_count': '{{count}} listens',
    'studio.stats.last_days': 'Listen activity covers the last {{days}} days.',
  };
  const translate = (key: string, options?: Record<string, unknown>) =>
    (map[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
  const i18n = { language: 'en' };
  return { useTranslation: () => ({ t: translate, i18n }) };
});

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: null, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
  }),
}));

jest.mock('@/components/ui/Icon', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/LoadingSpinner', () => 'View');

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  const Card = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  Card.Body = ({ children }: { children: React.ReactNode }) => <View>{children}</View>;
  return { Card, Text };
});

import PodcastShowStatsPanel from './PodcastShowStatsPanel';

describe('PodcastShowStatsPanel', () => {
  beforeEach(() => jest.clearAllMocks());

  it('asks for the stats of the show it was given and renders the four totals', async () => {
    mockGetPodcastShowStats.mockResolvedValue({
      enabled: true,
      days: 30,
      totals: { listens: 128, completed_listens: 60, completion_rate: 47, unique_listeners: 51, subscribers: 12, episodes: 4 },
      top_episodes: [
        { id: 1, show_id: 7, title: 'First hour', slug: 'first-hour', listen_count: 80 },
        { id: 2, show_id: 7, title: 'Second hour', slug: 'second-hour', listen_count: 20 },
      ],
      listens_over_time: [{ date: '2026-09-01', listens: 5 }],
    });

    const view = render(<PodcastShowStatsPanel showId={7} />);

    await waitFor(() => expect(view.getByText('Listener stats')).toBeTruthy());
    expect(mockGetPodcastShowStats).toHaveBeenCalledWith(7);
    expect(view.getByText('128')).toBeTruthy();
    expect(view.getByText('51')).toBeTruthy();
    expect(view.getByText('47%')).toBeTruthy();
    expect(view.getByText('12')).toBeTruthy();
    expect(view.getByText('First hour')).toBeTruthy();
    expect(view.getByText('80 listens')).toBeTruthy();
    expect(view.getByText('Listen activity covers the last 30 days.')).toBeTruthy();
  });

  it('renders nothing at all when the community has listen analytics switched off', async () => {
    mockGetPodcastShowStats.mockResolvedValue({ enabled: false });

    const view = render(<PodcastShowStatsPanel showId={7} />);

    await waitFor(() => expect(view.queryByText('Listener stats')).toBeNull());
    expect(view.toJSON()).toBeNull();
  });

  it('stays quiet rather than showing a panel of zeroes when the request fails', async () => {
    mockGetPodcastShowStats.mockRejectedValue(new Error('offline'));

    const view = render(<PodcastShowStatsPanel showId={7} />);

    await waitFor(() => expect(view.toJSON()).toBeNull());
  });

  it('does not divide by zero when every top episode has no listens yet', async () => {
    mockGetPodcastShowStats.mockResolvedValue({
      enabled: true,
      totals: { listens: 0, completed_listens: 0, completion_rate: 0, unique_listeners: 0, subscribers: 0, episodes: 1 },
      top_episodes: [{ id: 1, show_id: 7, title: 'Silent one', slug: 'silent-one', listen_count: 0 }],
    });

    const view = render(<PodcastShowStatsPanel showId={7} />);

    await waitFor(() => expect(view.getByText('Silent one')).toBeTruthy());
    expect(view.getByText('0 listens')).toBeTruthy();
  });
});
