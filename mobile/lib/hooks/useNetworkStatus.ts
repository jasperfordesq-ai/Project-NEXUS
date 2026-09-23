// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { API_BASE_URL } from '@/lib/constants';
import { emitReconnect } from '@/lib/network/reconnectSignal';

/** How long to wait for the health-check ping before treating as offline (ms). */
const PING_TIMEOUT_MS = 10_000;

/** URL to ping - lightweight PHP health endpoint with CORS enabled. */
const HEALTH_URL = `${API_BASE_URL}/health.php`;

export interface NetworkStatus {
  /** True when the device appears to have connectivity. */
  isOnline: boolean;
  /** True while a connectivity check is in flight (native only). */
  isChecking: boolean;
}

/**
 * Detects connectivity by two different strategies depending on platform:
 *
 * **Native (iOS / Android)**
 *   Pings the API health endpoint (`/health.php`) on mount and every time the app
 *   returns to the foreground. This confirms actual backend connectivity
 *   rather than just local-network reachability.
 *
 * **Web**
 *   Uses `navigator.onLine` and the browser's `online`/`offline` events.
 *   An API ping is unreliable in web preview sandboxes (e.g. Codex, Expo
 *   Snack) where outbound requests are blocked — a false offline state
 *   would hide the entire app behind an "offline" banner.
 *
 * Default: `isOnline = true` to avoid false-positive "offline" banners on
 * first render before the first check completes.
 */
export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(true);
  const [isChecking, setIsChecking] = useState(false);

  // ── Web path ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    // Sync to the browser's connectivity flag immediately.
    setIsOnline(navigator.onLine);

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // ── Native path ─────────────────────────────────────────────────────────────
  const isMountedRef = useRef(true);
  const isCheckingRef = useRef(false); // guard against concurrent pings

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const checkConnectivity = useCallback(async () => {
    if (Platform.OS === 'web') return; // handled above
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;

    if (isMountedRef.current) setIsChecking(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    let online = false;
    try {
      const response = await fetch(HEALTH_URL, {
        method: 'GET',
        signal: controller.signal,
      });
      online = response.ok || response.status < 500;
    } catch {
      // AbortError (timeout) or network error → offline
      online = false;
    } finally {
      clearTimeout(timeoutId);
    }

    if (isMountedRef.current) {
      setIsOnline(online);
      setIsChecking(false);
    }
    isCheckingRef.current = false;
  }, []);

  // Run an immediate check on mount (native only).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    void checkConnectivity();
  }, [checkConnectivity]);

  // Native reachability changes should update the UI immediately. The API ping
  // remains as a backend-specific confirmation layer for foreground resumes.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    return NetInfo.addEventListener((state) => {
      if (state.isInternetReachable === true) {
        setIsOnline(true);
        return;
      }

      // Android emulators and some networks can report native reachability as
      // disconnected while the configured API is reachable. Confirm with the
      // backend before showing a global offline banner.
      void checkConnectivity();
    });
  }, [checkConnectivity]);

  // Re-check every time the app returns to the foreground (native only).
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        void checkConnectivity();
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => subscription.remove();
  }, [checkConnectivity]);

  // Announce offline -> online once, so screens that failed with nothing to show retry.
  const wasOfflineRef = useRef(false);
  useEffect(() => {
    if (isOnline && wasOfflineRef.current) emitReconnect();
    wasOfflineRef.current = !isOnline;
  }, [isOnline]);

  return { isOnline, isChecking };
}
