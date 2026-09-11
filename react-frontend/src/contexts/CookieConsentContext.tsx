// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cookie Consent Context
 *
 * Manages GDPR cookie consent state, persisted in localStorage AND
 * synced to the server for authenticated users (survives device changes).
 *
 * Three consent categories matching the Cookie Policy page:
 * - Essential (always on — cannot be toggled)
 * - Analytics (Sentry error tracking)
 * - Preferences (theme, locale)
 *
 * Server sync:
 * - On save → fire-and-forget POST /api/cookie-consent
 * - After first paint/idle (if auth token exists) → fetch server consent, prefer most recent
 */

import { createContext, use, useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { api, tokenManager } from '@/lib/api';
import {
  clearStoredConsent,
  readStoredConsent,
  writeStoredConsent,
  type CookieConsent,
} from '@/lib/cookieConsentStorage';

export { readStoredConsent };
export type { CookieConsent };

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CookieConsentContextValue {
  /** Current consent state, or null if user hasn't decided yet */
  consent: CookieConsent | null;
  /** Whether the banner should be shown */
  showBanner: boolean;
  /** Accept all cookie categories */
  acceptAll: () => void;
  /** Accept essential only (reject optional) */
  acceptEssentialOnly: () => void;
  /** Save custom preferences */
  savePreferences: (analytics: boolean, preferences: boolean) => void;
  /** Check if a specific category is consented */
  hasConsent: (category: 'analytics' | 'preferences') => boolean;
  /** Reset consent — re-shows the banner so user can change preferences */
  resetConsent: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const AHREFS_ANALYTICS_KEY = 'dQCLnhFgNF6rOd6nvIEc9Q';
const AHREFS_ANALYTICS_DELAY_MS = 30000;
const SENTRY_ANALYTICS_DELAY_MS = 45000;

let ahrefsAnalyticsLoading = false;
let ahrefsAnalyticsScheduled = false;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions,
  ) => number;
  cancelIdleCallback?: (handle: number) => void;
};

function isAuthEntryPath(pathname: string): boolean {
  const normalizedPath = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  const segments = normalizedPath.split('/').filter(Boolean);
  const candidatePaths = segments.map((_, index) => `/${segments.slice(index).join('/')}`);
  const authPaths = new Set([
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/password/forgot',
    '/password/reset',
    '/verify-email',
    '/verify-identity',
    '/auth/oauth/callback',
    '/auth/two-factor/setup',
    '/oauth/callback',
  ]);

  return candidatePaths.some((candidate) => authPaths.has(candidate));
}

function loadAhrefsAnalytics(): void {
  if (typeof document === 'undefined' || ahrefsAnalyticsLoading || ahrefsAnalyticsScheduled) return;
  if (document.querySelector('script[data-nexus-ahrefs="true"]')) {
    ahrefsAnalyticsLoading = true;
    return;
  }

  const appendScript = () => {
    ahrefsAnalyticsScheduled = false;
    if (document.querySelector('script[data-nexus-ahrefs="true"]')) {
      ahrefsAnalyticsLoading = true;
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://analytics.ahrefs.com/analytics.js';
    script.async = true;
    script.dataset.key = AHREFS_ANALYTICS_KEY;
    script.dataset.nexusAhrefs = 'true';
    document.head.appendChild(script);
    ahrefsAnalyticsLoading = true;
  };

  ahrefsAnalyticsScheduled = true;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(appendScript, { timeout: 5000 });
  } else {
    globalThis.setTimeout(appendScript, 1500);
  }
}

function runAfterFirstPaintIdle(callback: () => void): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }

  let cancelled = false;
  let firstFrame = 0;
  let secondFrame = 0;
  let timeoutHandle: number | null = null;
  let idleHandle: number | null = null;

  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  const scheduleIdle = () => {
    const idleWindow = window as IdleWindow;
    if (typeof idleWindow.requestIdleCallback === 'function') {
      idleHandle = idleWindow.requestIdleCallback(run, { timeout: 5000 });
      return;
    }

    timeoutHandle = window.setTimeout(run, 1500);
  };

  firstFrame = window.requestAnimationFrame(() => {
    secondFrame = window.requestAnimationFrame(scheduleIdle);
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(firstFrame);
    window.cancelAnimationFrame(secondFrame);
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
    }
    if (idleHandle !== null) {
      const idleWindow = window as IdleWindow;
      idleWindow.cancelIdleCallback?.(idleHandle);
    }
  };
}

function runAfterDelayedIdle(callback: () => void, delayMs: number): () => void {
  if (typeof window === 'undefined') {
    callback();
    return () => {};
  }

  let cancelIdle: (() => void) | null = null;
  const timeoutHandle = window.setTimeout(() => {
    cancelIdle = runAfterFirstPaintIdle(callback);
  }, delayMs);

  return () => {
    window.clearTimeout(timeoutHandle);
    cancelIdle?.();
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (also used by sentry.ts before React mounts)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Server sync helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget POST to persist consent on the server.
 * Maps frontend categories to backend schema:
 *   preferences → functional, analytics → analytics, marketing always false
 */
function syncConsentToServer(consent: CookieConsent): void {
  if (!tokenManager.getAccessToken()) return; // Only sync for authenticated users

  api.post('/cookie-consent', {
    functional: consent.preferences,
    analytics: consent.analytics,
    marketing: false,
    source: 'web',
  });
}

/**
 * Fetch consent from server for authenticated users.
 * Returns mapped CookieConsent or null if no server record.
 */
async function fetchServerConsent(): Promise<CookieConsent | null> {
  if (!tokenManager.getAccessToken()) return null;

  try {
    const response = await api.get<{
      consent: {
        analytics: boolean;
        functional: boolean;
        created_at: string;
      } | null;
    }>('/cookie-consent');

    if (response.success && response.data?.consent) {
      return {
        essential: true,
        analytics: !!response.data.consent.analytics,
        preferences: !!response.data.consent.functional,
        timestamp: response.data.consent.created_at,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [consent, setConsent] = useState<CookieConsent | null>(() => readStoredConsent());

  const serverSyncDone = useRef(false);

  const persist = useCallback((newConsent: CookieConsent) => {
    setConsent(newConsent);
    writeStoredConsent(newConsent);
    syncConsentToServer(newConsent);
  }, []);

  // On mount: if authenticated, restore server consent after first paint/idle.
  // Consent is useful across devices, but the read is non-critical and should
  // not compete with login/register or first app-route rendering.
  useEffect(() => {
    if (serverSyncDone.current) return;
    serverSyncDone.current = true;

    if (!tokenManager.getAccessToken()) return;

    const localConsent = readStoredConsent();
    return runAfterFirstPaintIdle(() => {
      fetchServerConsent().then((serverConsent) => {
        if (!serverConsent) return;

        // If no local consent, use server consent (e.g. new device)
        if (!localConsent) {
          setConsent(serverConsent);
          writeStoredConsent(serverConsent);
          return;
        }

        // If server consent is newer, prefer it
        const localTime = new Date(localConsent.timestamp).getTime();
        const serverTime = new Date(serverConsent.timestamp).getTime();
        if (serverTime > localTime) {
          setConsent(serverConsent);
          writeStoredConsent(serverConsent);
        }
      });
    });
  }, []);

  useEffect(() => {
    if (consent?.analytics && !isAuthEntryPath(location.pathname)) {
      const cancelAhrefs = runAfterDelayedIdle(loadAhrefsAnalytics, AHREFS_ANALYTICS_DELAY_MS);
      const cancelSentry = runAfterDelayedIdle(() => {
        void import('@/lib/sentry').then(({ initSentryAfterIdle }) => initSentryAfterIdle());
      }, SENTRY_ANALYTICS_DELAY_MS);

      return () => {
        cancelAhrefs();
        cancelSentry();
      };
    }
  }, [consent?.analytics, location.pathname]);

  const acceptAll = useCallback(() => {
    persist({
      essential: true,
      analytics: true,
      preferences: true,
      timestamp: new Date().toISOString(),
    });
  }, [persist]);

  const acceptEssentialOnly = useCallback(() => {
    persist({
      essential: true,
      analytics: false,
      preferences: false,
      timestamp: new Date().toISOString(),
    });
  }, [persist]);

  const savePreferences = useCallback((analytics: boolean, preferences: boolean) => {
    persist({
      essential: true,
      analytics,
      preferences,
      timestamp: new Date().toISOString(),
    });
  }, [persist]);

  const hasConsent = useCallback(
    (category: 'analytics' | 'preferences') => consent?.[category] ?? false,
    [consent]
  );

  const resetConsent = useCallback(() => {
    setConsent(null);
    clearStoredConsent();
  }, []);

  const showBanner = consent === null;

  const value = useMemo<CookieConsentContextValue>(
    () => ({ consent, showBanner, acceptAll, acceptEssentialOnly, savePreferences, hasConsent, resetConsent }),
    [consent, showBanner, acceptAll, acceptEssentialOnly, savePreferences, hasConsent, resetConsent]
  );

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
    </CookieConsentContext.Provider>
  );
}

export function useCookieConsent(): CookieConsentContextValue {
  const ctx = use(CookieConsentContext);
  if (!ctx) {
    throw new Error('useCookieConsent must be used within CookieConsentProvider');
  }
  return ctx;
}
