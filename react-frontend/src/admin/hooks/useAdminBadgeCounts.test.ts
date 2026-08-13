// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cover for the admin sidebar badge counts.
 *
 * 🔴 Context worth keeping. The badge field, its renderer and the backend
 * count service all existed independently for a long time with nothing joining
 * them up, so the "Pending approvals" item never showed a number and a
 * coordinator had no way to see that somebody was locked out waiting for them.
 * These tests pin the two decisions that make the badge trustworthy: it never
 * shows a meaningless "0", and a failed fetch leaves the sidebar alone rather
 * than breaking it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const mockGet = vi.fn();
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => mockGet(...args) } }));

import { useAdminBadgeCounts, badgeForCount } from './useAdminBadgeCounts';

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ success: true, data: {} });
});

describe('badgeForCount', () => {
  it('shows nothing at all for zero', () => {
    // A badge reading "0" is noise, and noise teaches people to ignore badges —
    // which would defeat the entire point of adding one.
    expect(badgeForCount(0)).toBeUndefined();
  });

  it('shows nothing when the count is missing', () => {
    expect(badgeForCount(undefined)).toBeUndefined();
  });

  it('shows the number when somebody is actually waiting', () => {
    expect(badgeForCount(1)).toBe('1');
    expect(badgeForCount(7)).toBe('7');
  });

  it('caps at 99+ so a long number cannot break the sidebar layout', () => {
    expect(badgeForCount(99)).toBe('99');
    expect(badgeForCount(100)).toBe('99+');
    expect(badgeForCount(4321)).toBe('99+');
  });
});

describe('useAdminBadgeCounts', () => {
  it('reads the pending count from the endpoint', async () => {
    mockGet.mockResolvedValue({ success: true, data: { pending_users: 3 } });

    const { result } = renderHook(() => useAdminBadgeCounts());

    await waitFor(() => expect(result.current.counts.pending_users).toBe(3));
    expect(mockGet).toHaveBeenCalledWith('/v2/admin/badge-counts');
  });

  it('leaves counts empty when the request is unsuccessful', async () => {
    // api.ts never throws — it returns { success: false }. A sidebar that
    // renders a stale or bogus badge because of a failed fetch is worse than
    // one showing no badge, so this must stay empty rather than guess.
    mockGet.mockResolvedValue({ success: false, error: 'nope' });

    const { result } = renderHook(() => useAdminBadgeCounts());

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current.counts.pending_users).toBeUndefined();
    expect(badgeForCount(result.current.counts.pending_users)).toBeUndefined();
  });

  it('ignores a success response carrying no usable data', async () => {
    mockGet.mockResolvedValue({ success: true, data: null });

    const { result } = renderHook(() => useAdminBadgeCounts());

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(result.current.counts).toEqual({});
  });
});
