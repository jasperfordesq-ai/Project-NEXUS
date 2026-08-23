// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockRouterPush(...args),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
  },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

const mockModules = { current: ['listings'] as string[] };

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({
    hasFeature: (feature: string) => ['events', 'groups', 'goals', 'marketplace', 'polls'].includes(feature),
    hasModule: (module: string) => mockModules.current.includes(module),
  }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
  }),
}));

import QuickCreateRoute from './quick-create';

describe('QuickCreateRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModules.current = ['listings'];
  });

  /*
    🔴 This screen loads only the `common` namespace, and the composer's label lives in
    `home`. The assertion on the rendered English is therefore load-bearing: it proves the
    explicit `home:newPost.title` key resolves here rather than rendering the key itself,
    which is what a missing namespace looks like on screen.
  */
  it('offers writing a post when the community has a feed, and opens the composer', () => {
    mockModules.current = ['listings', 'feed'];

    const { getByText } = render(<QuickCreateRoute />);
    const option = getByText('Create post');
    expect(option).toBeTruthy();

    fireEvent.press(option);
    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-post');
  });

  it('leaves the post option out when the community has no feed', () => {
    const { queryByText } = render(<QuickCreateRoute />);

    expect(queryByText('Create post')).toBeNull();
  });

  it('renders source-of-truth quick-create options without caring community', () => {
    const { getByText } = render(<QuickCreateRoute />);

    expect(getByText('New listing')).toBeTruthy();
    expect(getByText('Sell item')).toBeTruthy();
    expect(getByText('New message')).toBeTruthy();
    expect(getByText('New event')).toBeTruthy();
    expect(getByText('New poll')).toBeTruthy();
    expect(getByText('New group')).toBeTruthy();
    expect(getByText('New goal')).toBeTruthy();
  });

  it('opens the selected create flow', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('New event'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-event');
  });

  it('opens the native message composer from quick-create', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('New message'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-message');
  });

  it('opens the marketplace listing creator from quick-create', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('Sell item'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-marketplace-listing');
  });

  it('opens the native poll composer from quick-create', () => {
    const { getByText } = render(<QuickCreateRoute />);

    fireEvent.press(getByText('New poll'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/polls?create=1');
  });
});
