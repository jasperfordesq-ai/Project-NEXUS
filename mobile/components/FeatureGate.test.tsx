// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockHasFeature = jest.fn();
const mockHasModule = jest.fn();

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ hasFeature: mockHasFeature, hasModule: mockHasModule }),
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#000', textSecondary: '#666', textMuted: '#999', border: '#ddd' }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'common:buttons.back': 'Back',
      'common:featureUnavailable.title': 'Not available here',
      'common:featureUnavailable.subtitle': 'Your community has not switched this on.',
    } as Record<string, string>)[key] ?? key,
  }),
}));

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => {
  const React2 = require('react');
  const { Text: RNText, View } = require('react-native');
  return function MockEmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
    return React2.createElement(View, null,
      React2.createElement(RNText, null, title),
      subtitle ? React2.createElement(RNText, null, subtitle) : null);
  };
});

import FeatureGate from './FeatureGate';

const CHILD = <Text>The builder</Text>;

beforeEach(() => {
  jest.clearAllMocks();
  mockHasFeature.mockReturnValue(true);
  mockHasModule.mockReturnValue(true);
});

describe('FeatureGate', () => {
  it('renders the screen when the community has the feature', () => {
    const { getByText } = render(
      <FeatureGate feature="courses" title="Courses" fallbackHref="/(modals)/courses">{CHILD}</FeatureGate>,
    );

    expect(getByText('The builder')).toBeTruthy();
    expect(mockHasFeature).toHaveBeenCalledWith('courses');
  });

  /**
   * 🔴 The reason this component exists. Hiding the "+" menu entry was never a gate —
   * a deep link, a notification or a shared URL reaches the screen directly, and
   * `+native-intent.ts` now routes `/courses/instructor` and `/podcasts/studio`.
   */
  it('refuses the screen when the community has the feature switched off', () => {
    mockHasFeature.mockReturnValue(false);

    const { queryByText, getByText } = render(
      <FeatureGate feature="courses" title="Courses" fallbackHref="/(modals)/courses">{CHILD}</FeatureGate>,
    );

    expect(queryByText('The builder')).toBeNull();
    expect(getByText('Not available here')).toBeTruthy();
  });

  it('gates on a module as well as a feature, and needs both', () => {
    mockHasModule.mockReturnValue(false);

    const { queryByText } = render(
      <FeatureGate module="feed" title="Feed" fallbackHref="/(tabs)/home">{CHILD}</FeatureGate>,
    );

    expect(queryByText('The builder')).toBeNull();
    expect(mockHasModule).toHaveBeenCalledWith('feed');
  });

  it('lets a screen through when neither a feature nor a module is named', () => {
    const { getByText } = render(
      <FeatureGate title="Anything" fallbackHref="/(tabs)/home">{CHILD}</FeatureGate>,
    );

    expect(getByText('The builder')).toBeTruthy();
    expect(mockHasFeature).not.toHaveBeenCalled();
    expect(mockHasModule).not.toHaveBeenCalled();
  });

  /** Says the module is unavailable rather than silently moving the member elsewhere. */
  it('explains why, instead of redirecting', () => {
    mockHasFeature.mockReturnValue(false);

    const { getByText } = render(
      <FeatureGate feature="podcasts" title="Studio" fallbackHref="/(modals)/podcasts">{CHILD}</FeatureGate>,
    );

    expect(getByText('Your community has not switched this on.')).toBeTruthy();
  });
});
