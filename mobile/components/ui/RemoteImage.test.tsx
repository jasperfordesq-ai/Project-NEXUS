// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

// The placeholder is hidden from the accessibility tree on purpose, and RNTL skips hidden
// elements by default — hence `includeHiddenElements` on every fallback query below.

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ surface: '#fff', borderSubtle: '#F1F5F9', textMuted: '#64748B' }),
}));

jest.mock('expo-image', () => {
  const React2 = require('react');
  const { View } = require('react-native');
  return {
    Image: (props: Record<string, unknown>) => React2.createElement(View, props),
  };
});

jest.mock('@/components/ui/Icon', () => ({ Ionicons: 'View' }));

import RemoteImage from './RemoteImage';

describe('RemoteImage', () => {
  it('tries a replacement image after the previous URI failed', () => {
    const screen = render(<RemoteImage uri="https://example.test/gone.jpg" testID="photo" />);
    fireEvent(screen.getByTestId('photo'), 'error');
    screen.rerender(<RemoteImage uri="https://example.test/replacement.jpg" testID="photo" />);
    expect(screen.getByTestId('photo').props.source.uri).toBe('https://example.test/replacement.jpg');
  });
  it('renders the picture when there is one', () => {
    const { getByTestId, queryByTestId } = render(
      <RemoteImage uri="https://example.test/photo.jpg" testID="listing-photo" style={{ width: 100, height: 100 }} />,
    );

    expect(getByTestId('listing-photo')).toBeTruthy();
    expect(queryByTestId('listing-photo-fallback', { includeHiddenElements: true })).toBeNull();
  });

  it('shows a placeholder rather than nothing when there is no picture', () => {
    const { getByTestId } = render(<RemoteImage uri={null} testID="listing-photo" style={{ width: 100, height: 100 }} />);

    expect(getByTestId('listing-photo-fallback', { includeHiddenElements: true })).toBeTruthy();
  });

  /**
   * 🔴 The reason this component exists. Every remote image in the app was a bare
   * `<Image>` with no `onError` anywhere in the codebase (audit 2026-09-07, A/F-13), so a
   * photo that 404s left a blank rectangle the size of the picture — which reads as a
   * broken screen rather than a missing photo.
   */
  it('falls back to the placeholder when the picture cannot be loaded', () => {
    const { getByTestId, queryByTestId } = render(
      <RemoteImage uri="https://example.test/gone.jpg" testID="listing-photo" style={{ width: 100, height: 100 }} />,
    );

    fireEvent(getByTestId('listing-photo'), 'error', { error: '404' });

    expect(queryByTestId('listing-photo')).toBeNull();
    expect(getByTestId('listing-photo-fallback', { includeHiddenElements: true })).toBeTruthy();
  });

  it('hides the placeholder from a screen reader, because it carries no information', () => {
    const { getByTestId } = render(<RemoteImage uri={null} testID="listing-photo" />);

    expect(getByTestId('listing-photo-fallback', { includeHiddenElements: true }).props.accessibilityElementsHidden).toBe(true);
  });
});
