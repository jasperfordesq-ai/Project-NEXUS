// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { act, renderHook, waitFor } from '@testing-library/react-native';

let netInfoListener: ((state: { isConnected: boolean | null; isInternetReachable: boolean | null }) => void) | null = null;

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn((listener) => {
    netInfoListener = listener;
    return jest.fn();
  }),
}));

import NetInfo from '@react-native-community/netinfo';
import { useNetworkStatus } from './useNetworkStatus';
import { onReconnect } from '@/lib/network/reconnectSignal';

describe('useNetworkStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    netInfoListener = null;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as jest.Mock;
  });

  it('lets backend reachability override a native offline signal', async () => {
    let resolveFetch: ((value: { ok: boolean; status: number }) => void) | undefined;
    const pendingFetch = new Promise<{ ok: boolean; status: number }>((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = jest.fn().mockReturnValue(pendingFetch) as jest.Mock;

    const { result } = renderHook(() => useNetworkStatus());

    expect(NetInfo.addEventListener).toHaveBeenCalled();
    expect(result.current.isOnline).toBe(true);

    act(() => {
      netInfoListener?.({ isConnected: false, isInternetReachable: false });
    });

    expect(result.current.isOnline).toBe(true);

    await act(async () => {
      resolveFetch?.({ ok: true, status: 200 });
      await pendingFetch;
    });

    expect(result.current.isOnline).toBe(true);
  });

  it('announces the return from offline to online exactly once', async () => {
    const heard = jest.fn();
    const stop = onReconnect(heard);
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as jest.Mock;
    const { result } = renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isOnline).toBe(false));
    expect(heard).not.toHaveBeenCalled();
    act(() => { netInfoListener?.({ isConnected: true, isInternetReachable: true }); });
    await waitFor(() => expect(result.current.isOnline).toBe(true));
    expect(heard).toHaveBeenCalledTimes(1);
    act(() => { netInfoListener?.({ isConnected: true, isInternetReachable: true }); });
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
  });

  it('marks the app offline when backend reachability fails', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Network error')) as jest.Mock;

    const { result } = renderHook(() => useNetworkStatus());

    await waitFor(() => {
      expect(result.current.isOnline).toBe(false);
    });
  });

  it('keeps the app online while backend reachability confirms an ambiguous native signal', async () => {
    let resolveFetch: ((value: { ok: boolean; status: number }) => void) | undefined;
    const pendingFetch = new Promise<{ ok: boolean; status: number }>((resolve) => {
      resolveFetch = resolve;
    });
    global.fetch = jest.fn().mockReturnValue(pendingFetch) as jest.Mock;

    const { result } = renderHook(() => useNetworkStatus());

    act(() => {
      netInfoListener?.({ isConnected: true, isInternetReachable: false });
    });

    expect(result.current.isOnline).toBe(true);

    await act(async () => {
      resolveFetch?.({ ok: true, status: 200 });
      await pendingFetch;
    });

    expect(result.current.isOnline).toBe(true);
  });

  it('checks the lightweight PHP health endpoint', () => {
    renderHook(() => useNetworkStatus());

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/health.php'),
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
