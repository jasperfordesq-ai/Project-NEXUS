// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The app had no font-scale handling at all: not one `maxFontSizeMultiplier` anywhere,
 * and a tab bar pinned at 60dp with 11pt labels. At the OS's larger text settings — 2.0 on
 * Android, the accessibility sizes on iOS — tab labels were clipped mid-word and screen
 * titles squeezed their own Back button off the row. Audit 2026-09-09, item 3.
 *
 * These tests pin the three places a cap is load-bearing, and the rule that body text is
 * NOT capped. That last one matters most: the fix must not quietly undo the accessibility
 * setting it exists to support.
 */

import fs from 'fs';
import path from 'path';

import { render, screen } from '@testing-library/react-native';
import { PixelRatio, Text } from 'react-native';

import AppTopBar from '@/components/ui/AppTopBar';
import Button from '@/components/ui/Button';
import { CHROME_MAX_FONT_SCALE, TAB_LABEL_MAX_FONT_SCALE } from '@/lib/ui/textScale';

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
}));

jest.mock('expo-router', () => ({
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
  useFocusEffect: jest.fn(),
}));

describe('text scaling caps', () => {
  it('caps a screen title so it cannot squeeze the Back button off the row', () => {
    render(<AppTopBar title="Wallet" backLabel="Back" />);

    const title = screen.getByText('Wallet');
    expect(title.props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
  });

  it('announces the screen title as a heading', () => {
    render(<AppTopBar title="Wallet" backLabel="Back" />);

    expect(screen.getByText('Wallet').props.accessibilityRole).toBe('header');
  });

  it('caps a button label', () => {
    render(<Button>Turn on notifications</Button>);

    expect(screen.getByText('Turn on notifications').props.maxFontSizeMultiplier).toBe(CHROME_MAX_FONT_SCALE);
  });

  it('leaves body text uncapped, because that setting is the whole point', () => {
    render(<Text>Some ordinary body copy on a screen.</Text>);

    expect(screen.getByText('Some ordinary body copy on a screen.').props.maxFontSizeMultiplier).toBeUndefined();
  });

  it('keeps the two caps far enough apart to be deliberate', () => {
    // A tab label lives in a fixed-height bar and has to be tighter than a title in a row
    // that can grow. If these ever converge, one of them has been changed by accident.
    expect(TAB_LABEL_MAX_FONT_SCALE).toBeLessThan(CHROME_MAX_FONT_SCALE);
    expect(TAB_LABEL_MAX_FONT_SCALE).toBeGreaterThan(1);
  });
});

describe('tab bar height follows the capped font scale', () => {
  /*
    The height calculation lives in app/(tabs)/_layout.tsx and is reproduced here rather than
    exported, because rendering the real navigator needs the whole provider tree. What is
    being pinned is the RELATIONSHIP: the bar must grow when the OS text setting grows, and
    must stop growing at the same point the label stops growing. A bar that stayed at 60dp
    while the label grew is the clipping bug this replaced.
  */
  const barHeight = () => Math.round(60 + (Math.min(PixelRatio.getFontScale(), TAB_LABEL_MAX_FONT_SCALE) - 1) * 16);

  afterEach(() => jest.restoreAllMocks());

  it('is the base height at the default text size', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1);
    expect(barHeight()).toBe(60);
  });

  it('grows when the member enlarges system text', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    expect(barHeight()).toBeGreaterThan(60);
  });

  it('stops growing where the label stops growing', () => {
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(1.3);
    const atCap = barHeight();
    jest.spyOn(PixelRatio, 'getFontScale').mockReturnValue(2);
    expect(barHeight()).toBe(atCap);
  });

  /*
    🔴 The three assertions above exercise a copy of the formula, so on their own they would
    stay green if the real layout went back to a hard-coded 60. This one reads the layout
    itself. It is a source scan rather than a render because mounting the real tab navigator
    needs the whole provider tree, and the thing worth protecting is one expression.
  */
  it('is wired to the real tab layout, not just to this test', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');

    expect(source).toContain('PixelRatio.getFontScale()');
    expect(source).toContain('TAB_LABEL_MAX_FONT_SCALE');
    expect(source).toContain('height: tabBarContentHeight + (insets.bottom || 0)');
    // The label has to be rendered to carry a cap; `tabBarLabelStyle` alone cannot express one.
    expect(source).toContain('maxFontSizeMultiplier={TAB_LABEL_MAX_FONT_SCALE}');
    expect(source).not.toContain('height: 60 + (insets.bottom || 0)');
  });
});
