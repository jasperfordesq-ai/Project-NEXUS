// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('expo-image', () => ({
  Image: 'View',
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'distanceKilometers') return `${String(opts?.distance ?? '')} km away`;
      if (key === 'detail.hours') return `${String(opts?.count ?? '')} hrs`;
      return key;
    },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    surface: '#ffffff',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    border: '#e5e7eb',
  }),
}));

jest.mock('@/components/ui/Avatar', () => {
  const { Text } = require('react-native');
  return ({ name }: { name?: string }) => <Text>{name ?? 'Avatar'}</Text>;
});

jest.mock('@/components/ui/NativePressable', () => {
  const { Pressable } = require('react-native');
  return ({ children, onPress, accessibilityLabel }: { children: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) => (
    <Pressable onPress={onPress} accessibilityLabel={accessibilityLabel}>
      {children}
    </Pressable>
  );
});

import ExchangeCard from './ExchangeCard';
import type { Exchange } from '@/lib/api/exchanges';

const exchange: Exchange = {
  id: 42,
  title: 'Garden help',
  description: 'I can help tidy a garden.',
  type: 'offer',
  status: 'active',
  hours_estimate: 2,
  category_name: 'Gardening',
  category_color: null,
  image_url: null,
  location: 'Dublin',
  distance_km: 3.4,
  user: { id: 7, name: 'Alice', avatar_url: null },
  created_at: '2026-01-10T09:00:00Z',
  is_favorited: false,
};

describe('ExchangeCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('opens the exchange detail route through the native card press target', () => {
    const { getByLabelText, getByText } = render(<ExchangeCard exchange={exchange} />);

    expect(getByText('Garden help')).toBeTruthy();
    fireEvent.press(getByLabelText('Garden help'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/exchange-detail',
      params: { id: '42' },
    });
  });

  it('shows distance returned by nearby listing searches', () => {
    const { getByText } = render(<ExchangeCard exchange={exchange} />);

    expect(getByText('3.4 km away')).toBeTruthy();
  });

  /**
   * 🔴 Found in production on 2026-08-25, while capturing store screenshots: a listing whose
   * owner no longer resolves came back as `user: null` with `author_name: "Unknown"`, and the
   * card rendered a literal "?" — as the name, and again as the avatar's initial. The server
   * had a better answer the whole time.
   */
  it('falls back to the name the server sent when the member cannot be resolved', () => {
    const { getAllByText, queryByText } = render(
      <ExchangeCard exchange={{ ...exchange, user: undefined, author_name: 'Unknown' }} />,
    );

    // More than one node carries it — the visible label and the avatar's own text — which is
    // exactly why the old '?' appeared twice on screen.
    expect(getAllByText('Unknown').length).toBeGreaterThan(0);
    expect(queryByText('?')).toBeNull();
  });

  it('says "unknown member" rather than "?" when the server sends nothing either', () => {
    const { getAllByText, queryByText } = render(
      <ExchangeCard exchange={{ ...exchange, user: undefined, author_name: undefined }} />,
    );

    // The test i18n stub returns the key, so this asserts the key is reached at all.
    expect(getAllByText('unknownMember').length).toBeGreaterThan(0);
    expect(queryByText('?')).toBeNull();
  });

  it('exposes a card save action without opening the detail screen', () => {
    const onToggleSave = jest.fn();
    const { getByLabelText } = render(<ExchangeCard exchange={exchange} onToggleSave={onToggleSave} />);

    fireEvent.press(getByLabelText('saveListing'));

    expect(onToggleSave).toHaveBeenCalledWith(42, false);
  });
});
