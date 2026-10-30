// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleLogout, parseIdleTimeoutMs } from './useIdleLogout';

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: { post: mockPost } }));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(),
  useTenant: vi.fn(),
  useToast: vi.fn(),
}));

import { useAuth, useTenant, useToast } from '@/contexts';

const mockUseAuth = useAuth as ReturnType<typeof vi.fn>;
const mockUseTenant = useTenant as ReturnType<typeof vi.fn>;
const mockUseToast = useToast as ReturnType<typeof vi.fn>;

function setup({ timeoutMinutes, user }: { timeoutMinutes: unknown; user: object | null }) {
  const logout = vi.fn().mockResolvedValue(undefined);
  const toastInfo = vi.fn();
  mockUseAuth.mockReturnValue({ user, logout });
  mockUseTenant.mockReturnValue({
    tenant: { id: 2, settings: { inactivity_timeout_minutes: timeoutMinutes } },
  });
  mockUseToast.mockReturnValue({ info: toastInfo, success: vi.fn(), error: vi.fn(), warning: vi.fn() });
  return { logout, toastInfo };
}

describe('parseIdleTimeoutMs', () => {
  it('returns 0 for disabled/invalid values', () => {
    expect(parseIdleTimeoutMs(undefined)).toBe(0);
    expect(parseIdleTimeoutMs(null)).toBe(0);
    expect(parseIdleTimeoutMs(false)).toBe(0); // bootstrap coerces '0' to false
    expect(parseIdleTimeoutMs(true)).toBe(0);
    expect(parseIdleTimeoutMs('0')).toBe(0);
    expect(parseIdleTimeoutMs('4')).toBe(0); // below minimum
    expect(parseIdleTimeoutMs('abc')).toBe(0);
  });

  it('converts valid minute values to milliseconds', () => {
    expect(parseIdleTimeoutMs('30')).toBe(30 * 60_000);
    expect(parseIdleTimeoutMs(120)).toBe(120 * 60_000);
  });

  it('caps at 480 minutes', () => {
    expect(parseIdleTimeoutMs('9999')).toBe(480 * 60_000);
  });
});

describe('useIdleLogout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    // Activity now also pings the server (E-119 F-608); api.post returns a promise.
    mockPost.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('logs out after the configured idle period', async () => {
    const { logout } = setup({ timeoutMinutes: '5', user: { id: 1 } });
    renderHook(() => useIdleLogout());

    await act(async () => {
      vi.advanceTimersByTime(5 * 60_000 + 31_000);
    });

    expect(logout).toHaveBeenCalledTimes(1);
  });

  it('does not log out while the user stays active', async () => {
    const { logout } = setup({ timeoutMinutes: '5', user: { id: 1 } });
    renderHook(() => useIdleLogout());

    // Simulate activity every 2 minutes for 12 minutes total
    for (let i = 0; i < 6; i++) {
      await act(async () => {
        vi.advanceTimersByTime(2 * 60_000);
        window.dispatchEvent(new Event('pointerdown'));
      });
    }

    expect(logout).not.toHaveBeenCalled();
  });

  it('respects activity recorded by another tab via localStorage', async () => {
    const { logout } = setup({ timeoutMinutes: '5', user: { id: 1 } });
    renderHook(() => useIdleLogout());

    await act(async () => {
      vi.advanceTimersByTime(4 * 60_000);
      // Another tab records fresh activity
      localStorage.setItem('nexus_last_activity', String(Date.now()));
      vi.advanceTimersByTime(2 * 60_000);
    });

    expect(logout).not.toHaveBeenCalled();
  });

  it('does nothing when the timeout is disabled', async () => {
    const { logout } = setup({ timeoutMinutes: false, user: { id: 1 } });
    renderHook(() => useIdleLogout());

    await act(async () => {
      vi.advanceTimersByTime(24 * 60 * 60_000);
    });

    expect(logout).not.toHaveBeenCalled();
  });

  it('does nothing when no user is authenticated', async () => {
    const { logout } = setup({ timeoutMinutes: '5', user: null });
    renderHook(() => useIdleLogout());

    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });

    expect(logout).not.toHaveBeenCalled();
  });

  // E-119 F-608: reloading the page used to restart the clock, so a member who
  // left and came back long after the timeout was still signed in.
  it('does not restart the clock when the page is reloaded after a long idle', async () => {
    const { logout } = setup({ timeoutMinutes: '30', user: { id: 1 } });
    localStorage.setItem('nexus_last_activity', String(Date.now() - 31 * 60_000));
    renderHook(() => useIdleLogout());

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });

    expect(logout).toHaveBeenCalledTimes(1);
  });

  // E-119 F-608: the server now enforces the timeout too, so a member who is
  // reading or typing (no API calls) must tell it they are still here.
  it('tells the server the member is still here while they are active, not while idle', async () => {
    mockPost.mockResolvedValue({ success: true });
    setup({ timeoutMinutes: '30', user: { id: 1 } });
    renderHook(() => useIdleLogout());

    await act(async () => {
      window.dispatchEvent(new Event('pointerdown'));
    });
    expect(mockPost).toHaveBeenCalledWith('/v2/auth/activity', {});

    mockPost.mockClear();
    await act(async () => {
      window.dispatchEvent(new Event('keydown'));
    });
    expect(mockPost).not.toHaveBeenCalled(); // throttled

    await act(async () => {
      vi.advanceTimersByTime(20 * 60_000); // idle: no events
    });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('opens a warning before signing out, and staying signed in restarts the clock', async () => {
    mockPost.mockResolvedValue({ success: true });
    const { logout } = setup({ timeoutMinutes: '30', user: { id: 1 } });
    const { result } = renderHook(() => useIdleLogout());

    expect(result.current.warningOpen).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(25 * 60_000 + 31_000);
    });
    expect(result.current.warningOpen).toBe(true);
    expect(result.current.secondsLeft).toBeGreaterThan(0);
    expect(logout).not.toHaveBeenCalled();

    await act(async () => {
      result.current.staySignedIn();
    });
    expect(result.current.warningOpen).toBe(false);
    expect(mockPost).toHaveBeenCalledWith('/v2/auth/activity', {});

    await act(async () => {
      vi.advanceTimersByTime(20 * 60_000);
    });
    expect(logout).not.toHaveBeenCalled();
  });

  it('only logs out once even across multiple check ticks', async () => {
    const { logout } = setup({ timeoutMinutes: '5', user: { id: 1 } });
    renderHook(() => useIdleLogout());

    await act(async () => {
      vi.advanceTimersByTime(10 * 60_000);
    });

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
