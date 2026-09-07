// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

const mockCapabilities = jest.fn();

jest.mock('@/lib/context/TenantContext', () => ({
  useOptionalTenantCapabilities: () => mockCapabilities(),
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

import { withRouteGate } from './withRouteGate';

function WalletScreen({ label = 'The wallet' }: { label?: string }) {
  return <Text>{label}</Text>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCapabilities.mockReturnValue(null);
});

describe('withRouteGate', () => {
  it('returns the screen itself when the route has no requirement', () => {
    const Gated = withRouteGate(WalletScreen, 'support');
    expect(Gated).toBe(WalletScreen);
  });

  it('renders the screen, with its props, when the module is on', () => {
    mockCapabilities.mockReturnValue({ features: {}, modules: { wallet: true } });
    const Gated = withRouteGate(WalletScreen, 'wallet');

    const { getByText } = render(<Gated label="Balance 3.5" />);

    expect(getByText('Balance 3.5')).toBeTruthy();
  });

  /**
   * 🔴 Unknown must allow. A cold start, an offline start with no cached config and a
   * screen test with no provider all report null; refusing then would make a slow network
   * look like "every module is switched off".
   */
  it('renders the screen while the community configuration is still unknown', () => {
    mockCapabilities.mockReturnValue(null);
    const Gated = withRouteGate(WalletScreen, 'wallet');

    const { getByText } = render(<Gated />);

    expect(getByText('The wallet')).toBeTruthy();
  });

  it('refuses the screen when the community has switched its module off', () => {
    mockCapabilities.mockReturnValue({ features: {}, modules: { wallet: false } });
    const Gated = withRouteGate(WalletScreen, 'wallet');

    const { queryByText, getByText, getByTestId } = render(<Gated />);

    expect(queryByText('The wallet')).toBeNull();
    expect(getByTestId('route-unavailable')).toBeTruthy();
    expect(getByText('Your community has not switched this on.')).toBeTruthy();
  });

  it('refuses a feature-gated screen when the feature is off', () => {
    mockCapabilities.mockReturnValue({ features: { events: false }, modules: {} });
    const Gated = withRouteGate(WalletScreen, 'event-detail');

    const { queryByText } = render(<Gated />);

    expect(queryByText('The wallet')).toBeNull();
  });

  it('names the wrapped screen for React DevTools and error reports', () => {
    const Gated = withRouteGate(WalletScreen, 'wallet');
    expect(Gated.displayName).toBe('withRouteGate(WalletScreen)');
  });
});
