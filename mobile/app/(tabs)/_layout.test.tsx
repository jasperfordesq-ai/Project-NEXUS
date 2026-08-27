// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render } from '@testing-library/react-native';

const tabScreens: { name: string; options?: Record<string, unknown>; listeners?: Record<string, (event: { preventDefault: () => void }) => void> }[] = [];
const mockRouterPush = jest.fn();
const mockResetUnread = jest.fn();

jest.mock('expo-router', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Tabs = ({ children }: { children: React.ReactNode }) => React.createElement(View, { testID: 'tabs' }, children);
  Tabs.Screen = (props: { name: string; options?: Record<string, unknown>; listeners?: Record<string, (event: { preventDefault: () => void }) => void> }) => {
    tabScreens.push(props);
    return null;
  };

  return {
    Tabs,
    router: { push: (...args: unknown[]) => mockRouterPush(...args) },
    usePathname: () => '/home',
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    surface: '#ffffff',
    border: '#dddddd',
    textSecondary: '#666666',
  }),
}));

jest.mock('@/lib/context/RealtimeContext', () => ({
  useRealtimeContext: () => ({
    unreadMessages: 0,
    resetUnread: mockResetUnread,
  }),
}));

import TabsLayout from './_layout';

describe('TabsLayout', () => {
  beforeEach(() => {
    tabScreens.length = 0;
    jest.clearAllMocks();
  });

  it('matches the source-of-truth mobile bottom navigation order', () => {
    render(<TabsLayout />);

    expect(tabScreens.slice(0, 5).map((screen) => screen.name)).toEqual([
      'home',
      'exchanges',
      'create',
      'messages',
      'profile',
    ]);
    expect(tabScreens.find((screen) => screen.name === 'explore')?.options?.href).toBeNull();
    expect(tabScreens.find((screen) => screen.name === 'search')?.options?.href).toBeNull();
    expect(tabScreens.find((screen) => screen.name === 'groups')?.options?.href).toBeNull();
  });

  it('opens quick create from the Create tab instead of navigating to a blank tab', () => {
    const preventDefault = jest.fn();
    render(<TabsLayout />);

    tabScreens.find((screen) => screen.name === 'create')?.listeners?.tabPress?.({ preventDefault });

    expect(preventDefault).toHaveBeenCalled();
    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/quick-create');
  });
});
