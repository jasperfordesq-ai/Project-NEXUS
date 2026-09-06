// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

const mockUseApi = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ id: '7' }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    info: '#2563eb',
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
        'resources:articleTitle': 'Article',
        'resources:views': opts ? `${String(opts.count)} views` : 'views',
        'resources:helpful': opts ? `${String(opts.yes)} helpful` : 'helpful',
        'resources:errorTitle': 'Could not load resources',
        'resources:emptyTitle': 'Nothing found',
      };
      return map[key] ?? key;
    },
  }),
}));

import KbArticleScreen from './kb-article';

describe('KbArticleScreen', () => {
  beforeEach(() => {
    mockUseApi.mockReturnValue({
      data: {
        id: 7,
        title: 'Using time credits',
        content: '<p>Time credits are exchanged hour for hour.</p>',
        category_name: 'Basics',
        views_count: 12,
        helpful_yes: 3,
        helpful_no: 1,
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it('renders article content and metadata', () => {
    const { getAllByText, getByText } = render(<KbArticleScreen />);

    expect(getAllByText('Using time credits').length).toBeGreaterThan(0);
    expect(getByText('Time credits are exchanged hour for hour.')).toBeTruthy();
    expect(getByText('Basics')).toBeTruthy();
    expect(getByText('12 views')).toBeTruthy();
    expect(getByText('3 helpful')).toBeTruthy();
  });
});
