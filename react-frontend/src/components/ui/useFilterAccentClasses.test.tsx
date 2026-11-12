// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/contexts/ThemeContext';
import { FILTER_ACCENT_CLASSES, type FilterAccent } from './filterAccent';
import { useFilterAccentClasses } from './useFilterAccentClasses';

const PAGE_COLOURS: FilterAccent[] = ['emerald', 'amber', 'blue', 'rose', 'violet'];

function CommunityColour({ colour }: { colour: string }) {
  const { setCommunityAccent } = useTheme();
  useEffect(() => setCommunityAccent(colour), [colour, setCommunityAccent]);
  return null;
}

function withCommunityColour({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <CommunityColour colour="#a3195b" />
      {children}
    </ThemeProvider>
  );
}

function withoutCommunityColour({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

describe('useFilterAccentClasses', () => {
  it('keeps each page its own filter colour while the community has not chosen one', () => {
    for (const accent of PAGE_COLOURS) {
      const { result } = renderHook(() => useFilterAccentClasses(accent), { wrapper: withoutCommunityColour });
      expect(result.current, accent).toBe(FILTER_ACCENT_CLASSES[accent]);
    }
  });

  // The page header above the filters already follows the community colour
  // (PublicPageHero). A header in the community's red over amber filter chips
  // looked like two different sites.
  it('follows the community colour on every page once the community has chosen one', async () => {
    for (const accent of PAGE_COLOURS) {
      const { result } = renderHook(() => useFilterAccentClasses(accent), { wrapper: withCommunityColour });
      await waitFor(() => expect(result.current, accent).toBe(FILTER_ACCENT_CLASSES.accent));
    }
  });

  it('works outside a ThemeProvider, with the page colour (isolated tests, shells)', () => {
    const { result } = renderHook(() => useFilterAccentClasses('emerald'));
    expect(result.current).toBe(FILTER_ACCENT_CLASSES.emerald);
  });

  it('defaults to the theme accent', () => {
    const { result } = renderHook(() => useFilterAccentClasses());
    expect(result.current).toBe(FILTER_ACCENT_CLASSES.accent);
  });
});
