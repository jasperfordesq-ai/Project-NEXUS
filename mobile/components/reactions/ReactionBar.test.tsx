// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 The reduced-motion branch shipped untested.
 *
 * `ReactionBar` runs hand-written `Animated` code, which sits outside HeroUI's own
 * reduced-motion handling, so the 2026-09-07 audit added an early return that snaps the
 * pill straight to its final values when the OS setting is on. That branch had no test:
 * CI caught it as a coverage regression on `components/reactions` (84.27% against a floor
 * of 86.4%) rather than as a behaviour failure, which is the coverage ratchet doing
 * exactly its job.
 *
 * These tests pin the behaviour a member with "reduce motion" switched on actually gets:
 * the bar appears at once, and nothing is animated.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Animated } from 'react-native';

let mockReducedMotion = false;
jest.mock('@/lib/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockReducedMotion,
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    border: '#e2e8f0',
    borderSubtle: '#f1f5f9',
    text: '#111111',
    textSecondary: '#666666',
    textMuted: '#999999',
  }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

import ReactionBar, { REACTION_CONFIGS } from './ReactionBar';

const baseProps = {
  visible: true,
  userReaction: null,
  primary: '#6366f1',
  onSelect: jest.fn(),
  onDismiss: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockReducedMotion = false;
});

describe('ReactionBar', () => {
  it('renders every reaction the platform offers', () => {
    const { getByLabelText } = render(<ReactionBar {...baseProps} />);

    for (const config of REACTION_CONFIGS) {
      expect(getByLabelText(config.labelKey)).toBeTruthy();
    }
  });

  it('renders nothing at all while it is closed', () => {
    const { queryByLabelText } = render(<ReactionBar {...baseProps} visible={false} />);

    expect(queryByLabelText(REACTION_CONFIGS[0]!.labelKey)).toBeNull();
  });

  it('reports the reaction that was chosen', () => {
    const onSelect = jest.fn();
    const { getByLabelText } = render(<ReactionBar {...baseProps} onSelect={onSelect} />);

    fireEvent.press(getByLabelText('reaction.love'));

    expect(onSelect).toHaveBeenCalledWith('love');
  });

  it('🔴 does not animate when the member has asked for reduced motion', () => {
    mockReducedMotion = true;
    const timing = jest.spyOn(Animated, 'timing');
    const spring = jest.spyOn(Animated, 'spring');

    const { getByLabelText } = render(<ReactionBar {...baseProps} />);

    // The bar is there immediately — the point of the branch — and nothing was animated.
    expect(getByLabelText('reaction.like')).toBeTruthy();
    expect(timing).not.toHaveBeenCalled();
    expect(spring).not.toHaveBeenCalled();

    timing.mockRestore();
    spring.mockRestore();
  });

  it('animates normally when reduced motion is off', () => {
    mockReducedMotion = false;
    const timing = jest.spyOn(Animated, 'timing');

    render(<ReactionBar {...baseProps} />);

    expect(timing).toHaveBeenCalled();

    timing.mockRestore();
  });
});
