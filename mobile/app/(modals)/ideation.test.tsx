// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    info: '#2563eb',
    borderSubtle: '#e5e7eb',
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
        'common:buttons.retry': 'Retry',
        'ideation:title': 'Ideas',
        'ideation:subtitle': 'Browse challenges, submit ideas, and vote on proposals.',
        'ideation:searchLabel': 'Search',
        'ideation:searchPlaceholder': 'Search challenges',
        'ideation:allCategories': 'All',
        'ideation:categoryCount': opts ? `${String(opts.count)} challenges` : 'challenges',
        'ideation:filters.all': 'All',
        'ideation:filters.open': 'Open',
        'ideation:filters.voting': 'Voting',
        'ideation:filters.evaluating': 'Evaluating',
        'ideation:filters.closed': 'Closed',
        'ideation:status.open': 'Open',
        'ideation:ideasCount': opts ? `${String(opts.count)} ideas` : 'ideas',
        'ideation:viewChallenge': 'View challenge',
      };
      return map[key] ?? key;
    },
  }),
}));

import IdeationScreen from './ideation';

describe('IdeationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    let call = 0;
    mockUseApi.mockImplementation(() => {
      call += 1;
      if (call % 2 === 1) {
        return {
          data: {
            items: [
              {
                id: 12,
                title: 'Improve the park',
                description: 'Collect ideas for safer paths.',
                status: 'open',
                category: 'Environment',
                ideas_count: 3,
              },
            ],
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        };
      }
      return {
        data: [{ id: 5, name: 'Environment', challenges_count: 1 }],
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      };
    });
  });

  it('keeps the native ideation list frame full height with an explicit background', () => {
    const { getByTestId } = render(<IdeationScreen />);
    const screen = getByTestId('ideation-screen');
    const scroll = getByTestId('ideation-scroll');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 40,
    }));
  });

  it('renders challenges and opens detail', () => {
    const { getAllByText, getByLabelText } = render(<IdeationScreen />);

    expect(getAllByText('Ideas').length).toBeGreaterThan(0);
    expect(getAllByText('Environment').length).toBeGreaterThan(0);
    const challenge = getByLabelText(
      'Improve the park, Open, Environment, 3 ideas',
    );
    expect(challenge).toBeTruthy();

    fireEvent.press(challenge);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-detail', params: { id: '12' } });
  });
});
