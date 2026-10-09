// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HIBP_TIMEOUT_MS, PASSWORD_MIN_LENGTH, usePasswordCheck } from './usePasswordCheck';

async function sha1HexUpper(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

describe('usePasswordCheck synchronous state', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('exports a minimum length of 12', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
  });

  it('shows the idle guidance for an empty password', () => {
    const { result } = renderHook(() => usePasswordCheck(''));
    expect(result.current.length).toBe(0);
    expect(result.current.isLongEnough).toBe(false);
    expect(result.current.isPwned).toBeNull();
    expect(result.current.isAcceptable).toBe(false);
    expect(result.current.tone).toBe('idle');
    expect(result.current.message).toContain('Use 12 or more');
  });

  it('asks for more characters with correct pluralisation', () => {
    const { result: many } = renderHook(() => usePasswordCheck('abc')); // 3 chars, 9 remaining
    expect(many.current.tone).toBe('warn');
    expect(many.current.message).toBe('Add 9 more characters.');

    const { result: one } = renderHook(() => usePasswordCheck('elevenchars')); // 11 chars, 1 remaining
    expect(one.current.message).toBe('Add 1 more character.');
  });

  it('does not run the breach check while below the length minimum', () => {
    renderHook(() => usePasswordCheck('short'));
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('usePasswordCheck HIBP breach check', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports a clean password as acceptable', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => 'FFFF:1\r\nEEEE:2',
    } as Response);

    const { result } = renderHook(() => usePasswordCheck('correct horse battery staple'));
    await waitFor(() => expect(result.current.isChecking).toBe(false));

    expect(result.current.isLongEnough).toBe(true);
    expect(result.current.isPwned).toBe(false);
    expect(result.current.isAcceptable).toBe(true);
    expect(result.current.message).toBe('Strong enough.');
    expect(result.current.tone).toBe('success');
    expect(result.current.breachCheckUnavailable).toBe(false);
  });

  it('flags a breached password as unacceptable', async () => {
    const pw = 'breached-passphrase-001';
    const suffix = (await sha1HexUpper(pw)).slice(5);
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => `${suffix}:1337\r\n0000ABCDEF:1`,
    } as Response);

    const { result } = renderHook(() => usePasswordCheck(pw));
    await waitFor(() => expect(result.current.isPwned).toBe(true));

    expect(result.current.isAcceptable).toBe(false);
    expect(result.current.tone).toBe('error');
    expect(result.current.message).toContain('known data breach');
  });

  it('fails open (treats as clean) when HIBP returns a non-ok response', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);

    const { result } = renderHook(() => usePasswordCheck('failopen-passphrase-9'));
    await waitFor(() => expect(result.current.isChecking).toBe(false));

    expect(result.current.isPwned).toBe(false);
    expect(result.current.isAcceptable).toBe(true);
    expect(result.current.breachCheckUnavailable).toBe(true);
  });

  it('fails open when the HIBP request throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => usePasswordCheck('network-error-passphrase'));
    await waitFor(() => expect(result.current.isChecking).toBe(false));

    expect(result.current.isPwned).toBe(false);
    expect(result.current.isAcceptable).toBe(true);
    expect(result.current.breachCheckUnavailable).toBe(true);
  });
});

describe('usePasswordCheck when the breach check hangs', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // A request that never settles — what a firewall, captive portal or
    // privacy extension can do instead of failing outright.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('keeps checking until the time limit, then fails open', async () => {
    const { result } = renderHook(() => usePasswordCheck('hanging-request-passphrase'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350 + HIBP_TIMEOUT_MS - 1);
    });
    expect(result.current.isChecking).toBe(true);
    expect(result.current.isAcceptable).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.isChecking).toBe(false);
    expect(result.current.isPwned).toBe(false);
    expect(result.current.isAcceptable).toBe(true);
    expect(result.current.breachCheckUnavailable).toBe(true);
    expect(result.current.message).toContain('could not check');
  });

  it('aborts the hanging request when the time limit passes', async () => {
    renderHook(() => usePasswordCheck('abort-the-request-passphrase'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.signal?.aborted).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(HIBP_TIMEOUT_MS);
    });
    expect(init.signal?.aborted).toBe(true);
  });
});
