// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useGreeting, partOfDay } from './useGreeting';

describe('useGreeting', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    [5, 'morning'], [11, 'morning'], [12, 'afternoon'], [17, 'afternoon'], [18, 'evening'], [23, 'evening'], [0, 'evening'], [4, 'evening'],
  ])('treats %i:00 as %s', (hour, expected) => {
    expect(partOfDay(new Date(2026, 10, 9, hour, 30))).toBe(expected);
  });

  it("greets by name for the member's own time of day", () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 15, 0));
    const { result } = renderHook(() => useGreeting('Maeve'));
    expect(result.current).toBe('Good afternoon, Maeve');
  });

  it('greets without a name when there is none', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 8, 0));
    expect(renderHook(() => useGreeting('  ')).result.current).toBe('Good morning');
    expect(renderHook(() => useGreeting(null)).result.current).toBe('Good morning');
  });
});
