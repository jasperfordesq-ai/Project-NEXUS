// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

import { api } from '@/lib/api';
import {
  FALLBACK_RADIUS_KM,
  persistRadiusPreference,
  resetSavedRadiusCache,
  snapToRadiusOption,
  useSavedRadiusKm,
} from './useSavedRadiusKm';

describe('snapToRadiusOption', () => {
  it('snaps an arbitrary saved value to the nearest offered option', () => {
    expect(snapToRadiusOption(30)).toBe(25);
    expect(snapToRadiusOption(40)).toBe(50);
    expect(snapToRadiusOption(7)).toBe(5);
    expect(snapToRadiusOption(100)).toBe(100);
  });

  it('falls back for values that are not a usable distance', () => {
    expect(snapToRadiusOption(0)).toBe(FALLBACK_RADIUS_KM);
    expect(snapToRadiusOption(-5)).toBe(FALLBACK_RADIUS_KM);
    expect(snapToRadiusOption(Number.NaN)).toBe(FALLBACK_RADIUS_KM);
  });
});

describe('useSavedRadiusKm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSavedRadiusCache();
  });

  it('adopts the saved preference', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { max_distance_km: 50 } });

    const { result } = renderHook(() => useSavedRadiusKm());

    await waitFor(() => expect(result.current).toBe(50));
    expect(api.get).toHaveBeenCalledWith('/v2/users/me/match-preferences');
  });

  it('snaps a saved value that is not one of the offered options', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { max_distance_km: 30 } });

    const { result } = renderHook(() => useSavedRadiusKm());

    await waitFor(() => expect(result.current).toBe(25));
  });

  it('falls back when the request fails — api.ts resolves rather than throws', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: false, error: 'nope' });

    const { result } = renderHook(() => useSavedRadiusKm());

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current).toBe(FALLBACK_RADIUS_KM);
  });

  it('fetches once even when several filters mount', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { max_distance_km: 10 } });

    const first = renderHook(() => useSavedRadiusKm());
    const second = renderHook(() => useSavedRadiusKm());

    await waitFor(() => expect(first.result.current).toBe(10));
    await waitFor(() => expect(second.result.current).toBe(10));

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when disabled', () => {
    renderHook(() => useSavedRadiusKm(false));

    expect(api.get).not.toHaveBeenCalled();
  });
});

describe('persistRadiusPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSavedRadiusCache();
  });

  it('writes the preference back so the next page opens on it', () => {
    vi.mocked(api.put).mockResolvedValue({ success: true });

    persistRadiusPreference(50);

    expect(api.put).toHaveBeenCalledWith('/v2/users/me/match-preferences', { max_distance_km: 50 });
  });

  it('survives a client that throws synchronously', () => {
    // A page whose test double (or a transport failure) makes api.put throw
    // rather than reject must not have its filter-apply flow broken by a
    // best-effort preference write.
    vi.mocked(api.put).mockImplementation(() => {
      throw new TypeError('api.put is not a function');
    });

    expect(() => persistRadiusPreference(50)).not.toThrow();
  });

  it('applies in-session even if the write fails', async () => {
    vi.mocked(api.put).mockRejectedValue(new Error('offline'));
    vi.mocked(api.get).mockResolvedValue({ success: true, data: { max_distance_km: 5 } });

    persistRadiusPreference(100);

    const { result } = renderHook(() => useSavedRadiusKm());

    // Served from the cache the write primed — no refetch, no revert to 5.
    expect(result.current).toBe(100);
    expect(api.get).not.toHaveBeenCalled();
  });
});
