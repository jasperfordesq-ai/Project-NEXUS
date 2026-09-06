// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'stories.you': 'You',
        'stories.member': 'Member',
        'stories.memberInitial': 'Member',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 7, avatar_url: null },
    displayName: 'Alice Smith',
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    borderSubtle: '#F0F0F0',
    textSecondary: '#687076',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('heroui-native', () => {
  const React = require('react');
  const { Pressable, View } = require('react-native');

  return {
    Button: ({ children, onPress, accessibilityLabel }: { children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) => (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>
        {children}
      </Pressable>
    ),
    Surface: ({ children }: { children?: React.ReactNode }) => <View>{children}</View>,
  };
});

jest.mock('@/components/ui/Avatar', () => 'View');

import StoryCircles from './StoryCircles';

describe('StoryCircles', () => {
  it('routes the current member and story members through pressable story avatars', () => {
    const onPress = jest.fn();
    const { getByLabelText } = render(
      <StoryCircles
        members={[
          { id: 12, name: 'Brian Lee', avatar: null },
          { id: 15, name: 'Ciara Murphy', avatar: null },
        ]}
        onPress={onPress}
      />,
    );

    fireEvent.press(getByLabelText('You'));
    fireEvent.press(getByLabelText('Brian Lee'));

    expect(onPress).toHaveBeenNthCalledWith(1, 7);
    expect(onPress).toHaveBeenNthCalledWith(2, 12);
  });
});
