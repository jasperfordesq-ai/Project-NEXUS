// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { SiteAccentContext } from '@/contexts/SiteAccentContext';
import { confettiColoursFor, STANDARD_CONFETTI_ACCENT, useConfettiColours } from './confettiColours';

describe('confetti colours', () => {
  it('leads with the community colour and a lighter shade of it', () => {
    const colours = confettiColoursFor('#a3195b');
    expect(colours[0]).toBe('#a3195b');
    expect(colours[1]).not.toBe('#a3195b');
    expect(colours[1]).toMatch(/^#[0-9a-f]{6}$/i);
    expect(colours).toHaveLength(5);
  });

  it('falls back to the standard colour when there is none', () => {
    expect(confettiColoursFor(null)[0]).toBe(STANDARD_CONFETTI_ACCENT);
    expect(confettiColoursFor(undefined)[0]).toBe(STANDARD_CONFETTI_ACCENT);
  });

  it('gives a different set for a different community', () => {
    expect(confettiColoursFor('#15803d').slice(0, 2)).not.toEqual(confettiColoursFor('#a3195b').slice(0, 2));
  });

  it('reads the colour the site is showing', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SiteAccentContext.Provider value="#15803d">{children}</SiteAccentContext.Provider>
    );
    const { result } = renderHook(() => useConfettiColours(), { wrapper });
    expect(result.current[0]).toBe('#15803d');
  });

  it('works outside a ThemeProvider, with the standard colour', () => {
    const { result } = renderHook(() => useConfettiColours());
    expect(result.current[0]).toBe(STANDARD_CONFETTI_ACCENT);
  });
});
