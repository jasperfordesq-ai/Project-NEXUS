// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

const mockUseApi = jest.fn();

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
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
        'activity.title': 'Activity',
        'activity.subtitle': 'Your recent timebanking and community activity.',
        'activity.hoursGiven': 'Hours given',
        'activity.hoursReceived': 'Hours received',
        'activity.netBalance': opts ? `${String(opts.count)}h net` : '0h net',
        'activity.connections': 'Connections',
        'activity.groupsJoined': 'Groups joined',
        'activity.posts': 'Posts',
        'activity.skills': 'Skills',
        'activity.monthlyActivity': 'Monthly activity',
        'activity.monthlyActivityA11y': 'Monthly given and received hours chart',
        'activity.given': 'Given',
        'activity.received': 'Received',
        'activity.recent': 'Recent activity',
        'activity.emptyTitle': 'No activity yet',
        'activity.emptySubtitle': 'Your activity will appear here after you take part.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/api/activity', () => ({
  getActivityDashboard: jest.fn(),
}));

import ActivityScreen from './activity';

describe('ActivityScreen', () => {
  beforeEach(() => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          timeline: [
            {
              id: 1,
              activity_type: 'post',
              description: 'Posted an update',
              created_at: '2026-05-29T10:00:00Z',
            },
          ],
          hours_summary: {
            hours_given: 2,
            hours_received: 3,
            transactions_given: 1,
            transactions_received: 2,
            net_balance: 1,
          },
          connection_stats: {
            total_connections: 4,
            pending_requests: 1,
            groups_joined: 2,
          },
          engagement: {
            posts_count: 5,
            comments_count: 6,
            likes_given: 7,
            likes_received: 8,
          },
          skills_breakdown: {
            skills: [{ skill_name: 'Gardening', is_offering: true, is_requesting: false, proficiency: null, endorsements: 2 }],
            offering_count: 1,
            requesting_count: 0,
          },
          monthly_hours: [
            { month: '2026-04', label: 'Apr', given: 2, received: 1 },
            { month: '2026-05', label: 'May', given: 3, received: 4 },
          ],
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it('renders activity summary and recent timeline items', () => {
    const { getAllByText, getByText } = render(<ActivityScreen />);

    expect(getAllByText('Activity').length).toBeGreaterThan(0);
    expect(getByText('Hours given')).toBeTruthy();
    expect(getAllByText('2').length).toBeGreaterThan(0);
    expect(getByText('Connections')).toBeTruthy();
    expect(getByText('Monthly activity')).toBeTruthy();
    expect(getByText('Given')).toBeTruthy();
    expect(getByText('Received')).toBeTruthy();
    expect(getByText('Gardening')).toBeTruthy();
    expect(getByText('Posted an update')).toBeTruthy();
  });
});
