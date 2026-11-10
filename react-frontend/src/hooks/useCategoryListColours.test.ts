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
    localStorage.clear();
  });

  // Checked in a browser (10 Nov 2026): when the page's items arrived before
  // the category list, covers showed a stand-in colour and then changed. The
  // last list is kept, so a later visit has the right colours from the start.
  it('remembers the list, so the next visit has its colours before the list arrives', async () => {
    mockGet.mockResolvedValue({ success: true, data: list });
    const first = renderHook(() => useCategoryListColours('/v2/categories?type=event'));
    await waitFor(() => expect(first.result.current(2)).toBeDefined());
    const colour = first.result.current(2);
    first.unmount();

    mockGet.mockReturnValue(new Promise(() => {})); // the list never arrives this time
    const second = renderHook(() => useCategoryListColours('/v2/categories?type=event'));
    expect(second.result.current(2)).toBe(colour);
  });

  it('keeps each list apart', async () => {
    mockGet.mockResolvedValue({ success: true, data: list });
    const events = renderHook(() => useCategoryListColours('/v2/categories?type=event'));
    await waitFor(() => expect(events.result.current(2)).toBeDefined());
    events.unmount();

    mockGet.mockReturnValue(new Promise(() => {}));
    const blog = renderHook(() => useCategoryListColours('/v2/blog/categories'));
    expect(blog.result.current(2)).toBeUndefined();
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
