// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { Stop } from 'react-native-svg';

jest.mock('@sentry/react-native', () => ({ addBreadcrumb: jest.fn(), captureException: jest.fn() }));

import ItemCover from './ItemCover';
import CategoryLabel from './CategoryLabel';
import RemoteImage from './RemoteImage';
import { bandColours, coverColours } from '@/lib/theme/itemColours';
import { themeStore } from '@/lib/theme/themeStore';

describe('ItemCover', () => {
  it('paints the item\'s own colour as a gradient, in the scheme now showing', () => {
    const scheme = themeStore.getSnapshot();
    const expected = coverColours('teal', scheme);
    const screen = render(<ItemCover colour="teal" icon="calendar-outline" testID="cover" />);

    const stops = screen.UNSAFE_getAllByType(Stop);
    expect(stops.map((stop) => stop.props.stopColor)).toEqual([...expected.stops]);
    expect(stops.map((stop) => stop.props.stopOpacity)).toEqual([...expected.opacities]);
    expect(screen.getByTestId('cover-icon', { includeHiddenElements: true })).toBeTruthy();
  });

  it('is decoration: screen readers skip it, the card\'s own words say what the item is', () => {
    const screen = render(<ItemCover colour="rose" testID="cover" />);
    const cover = screen.getByTestId('cover', { includeHiddenElements: true });

    expect(cover.props.accessibilityElementsHidden).toBe(true);
    expect(cover.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(screen.queryByTestId('cover-icon', { includeHiddenElements: true })).toBeNull();
  });

  it('shows an unknown colour name as slate, as the website does', () => {
    const screen = render(<ItemCover colour="#ff0000" />);
    const expected = coverColours('slate', themeStore.getSnapshot());
    expect(screen.UNSAFE_getAllByType(Stop)[0]!.props.stopColor).toBe(expected.stops[0]);
  });
});

describe('CategoryLabel', () => {
  it('shows the category in its own colour', () => {
    const band = bandColours('amber', themeStore.getSnapshot());
    const screen = render(<CategoryLabel label="Gardening" colour="amber" />);

    const text = screen.getByText('Gardening');
    expect(StyleSheet.flatten(text.props.style)).toEqual(expect.objectContaining({ color: band.text }));
  });
});

describe('RemoteImage with an item cover', () => {
  it('shows the cover in place of a missing picture, never the grey box', () => {
    const screen = render(
      <RemoteImage uri={null} style={{ height: 120 }} fallback={<Text>cover</Text>} testID="photo" />,
    );

    expect(screen.getByText('cover')).toBeTruthy();
    expect(screen.getByTestId('photo-fallback')).toBeTruthy();
  });
});
