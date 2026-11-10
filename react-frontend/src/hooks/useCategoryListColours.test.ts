// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

import { useCategoryListColours } from './useCategoryListColours';
import { categoryListColours } from '@/lib/categoryListColours';

const list = [
  { id: 4, name: 'Repairs', color: 'blue' },
  { id: 2, name: 'Gardening', color: 'blue' },
  { id: 9, name: 'Music', color: 'blue' },
];

describe('useCategoryListColours', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it("gives each category of the list its distinct colour, once the list arrives", async () => {
    mockGet.mockResolvedValue({ success: true, data: list });
    const { result } = renderHook(() => useCategoryListColours('/v2/categories?type=event'));

    const expected = categoryListColours(list, null);
    await waitFor(() => expect(result.current(2)).toBe(expected.get('2')));
    expect(result.current(4)).toBe(expected.get('4'));
    expect(result.current('9')).toBe(expected.get('9'));
    expect(new Set([result.current(2), result.current(4), result.current(9)]).size).toBe(3);
    expect(mockGet).toHaveBeenCalledWith('/v2/categories?type=event', expect.objectContaining({ cacheTtlMs: expect.any(Number) }));
  });

  it('knows no colour for a category outside the list, or none at all', async () => {
    mockGet.mockResolvedValue({ success: true, data: list });
    const { result } = renderHook(() => useCategoryListColours('/v2/categories?type=event'));
    await waitFor(() => expect(result.current(2)).toBeDefined());
    expect(result.current(77)).toBeUndefined();
    expect(result.current(null)).toBeUndefined();
    expect(result.current(undefined)).toBeUndefined();
  });

  it('knows no colours when the list cannot be loaded, so pages fall back', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useCategoryListColours('/v2/categories?type=event'));
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current(2)).toBeUndefined();
  });

  it('asks for nothing without a list', () => {
    const { result } = renderHook(() => useCategoryListColours(null));
    expect(mockGet).not.toHaveBeenCalled();
    expect(result.current(2)).toBeUndefined();
  });
});
