// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

const mockGetReactors = jest.fn();
const mockClose = jest.fn();

jest.mock('@/lib/api/feed', () => ({
  getReactors: (...args: unknown[]) => mockGetReactors(...args),
}));

jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ visible, children }: { visible: boolean; children: React.ReactNode }) =>
    visible ? <View testID="reactors-sheet">{children}</View> : null;
});

jest.mock('@gorhom/bottom-sheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetFlatList: ({ data, renderItem, ListEmptyComponent }: any) => (
      <View testID="reactors-list">
        {data.length
          ? data.map((item: unknown, index: number) => (
              <React.Fragment key={index}>{renderItem({ item })}</React.Fragment>
            ))
          : ListEmptyComponent}
      </View>
    ),
  };
});

jest.mock('@/components/ui/Avatar', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="reactor-avatar" />;
});

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#2563eb' }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    surface: '#fff', borderSubtle: '#ddd', textSecondary: '#555', text: '#111', textMuted: '#777',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'reaction.reactorsTitle': 'People who reacted',
      'reaction.love': 'Love',
      'reaction.like': 'Like',
      'reaction.noReactors': 'No reactions yet',
      'common:errors.generic': 'Could not load reactions',
    } as Record<string, string>)[key] ?? key,
  }),
}));

import ReactorsSheet from './ReactorsSheet';

const reactions = {
  counts: { love: 2, like: 1 },
  total: 3,
  user_reaction: null,
};

describe('ReactorsSheet', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetReactors.mockResolvedValue({
      data: [{ id: 42, name: 'Alex Member', avatar_url: null }],
    });
  });

  it('loads the most common reaction and exposes named reaction filters to TalkBack', async () => {
    const { getByLabelText, findByText } = render(
      <ReactorsSheet visible targetType="post" targetId={9} reactions={reactions as any} onClose={mockClose} />,
    );

    await waitFor(() => expect(mockGetReactors).toHaveBeenCalledWith('post', 9, 'love'));
    expect(await findByText('Alex Member')).toBeTruthy();
    expect(getByLabelText('Love')).toBeTruthy();

    fireEvent.press(getByLabelText('Like'));
    await waitFor(() => expect(mockGetReactors).toHaveBeenCalledWith('post', 9, 'like'));
  });

  it('closes the sheet before opening the selected member profile', async () => {
    const { findByLabelText } = render(
      <ReactorsSheet visible targetType="post" targetId={9} reactions={reactions as any} onClose={mockClose} />,
    );

    fireEvent.press(await findByLabelText('Alex Member'));
    expect(mockClose).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/member-profile',
      params: { id: '42' },
    });
  });

  it('shows a visible error when the reactor request fails', async () => {
    mockGetReactors.mockRejectedValue(new Error('offline'));
    const { findByText } = render(
      <ReactorsSheet visible targetType="post" targetId={9} reactions={reactions as any} onClose={mockClose} />,
    );

    expect(await findByText('Could not load reactions')).toBeTruthy();
  });
});
