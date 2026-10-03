// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi } from 'vitest';
import { collectAllPages, hasMorePages, asArray, PAGE_SIZE } from './memberWindowData';

describe('collectAllPages', () => {
  it('reads until the list ends and reports no truncation', async () => {
    const fetchPage = vi.fn(async (page: number) => ({ rows: [page], hasMore: page < 3 }));
    const result = await collectAllPages(fetchPage, 5);
    expect(result).toEqual({ rows: [1, 2, 3], truncated: false });
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('stops at the page cap and says so', async () => {
    const fetchPage = vi.fn(async (page: number) => ({ rows: [page], hasMore: true }));
    const result = await collectAllPages(fetchPage, 2);
    expect(result).toEqual({ rows: [1, 2], truncated: true });
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it('treats an empty page as the end even if the endpoint claims more', async () => {
    const fetchPage = vi.fn(async () => ({ rows: [] as number[], hasMore: true }));
    const result = await collectAllPages(fetchPage, 5);
    expect(result.truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});

describe('hasMorePages', () => {
  it('prefers has_more, then total_pages, then total, then a full page', () => {
    expect(hasMorePages({ has_more: false, total_pages: 9 }, 1, PAGE_SIZE)).toBe(false);
    expect(hasMorePages({ total_pages: 3 }, 2, 5)).toBe(true);
    expect(hasMorePages({ total_pages: 3 }, 3, 5)).toBe(false);
    expect(hasMorePages({ total: 250 }, 2, PAGE_SIZE)).toBe(true);
    expect(hasMorePages({ total: 150 }, 2, 50)).toBe(false);
    expect(hasMorePages(undefined, 1, PAGE_SIZE)).toBe(true);
    expect(hasMorePages(undefined, 1, 3)).toBe(false);
  });
});

describe('asArray', () => {
  it('unwraps both bare arrays and { data } envelopes', () => {
    expect(asArray([1])).toEqual([1]);
    expect(asArray({ data: [2] })).toEqual([2]);
    expect(asArray({ nope: true })).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });
});
