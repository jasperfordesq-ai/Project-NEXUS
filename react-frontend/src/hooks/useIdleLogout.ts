// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';

/**
 * Auto-logout after a tenant-configurable period of user inactivity.
 *
 * The timeout comes from the tenant bootstrap setting
 * `inactivity_timeout_minutes` (admin-configurable, 0/absent = disabled,
 * 5–480 minutes when enabled). Activity is tracked across tabs via
 * localStorage so a user active in one tab is not logged out in another.
 *
 * E-119 F-608 (30 Oct 2026): the server now enforces the same timeout
 * (TokenService), so this hook also
 *  - warns before signing out, with a way to stay signed in (WCAG 2.2.1, the
 *    GOV.UK/DWP session timeout pattern) — it used to sign out silently;
 *  - keeps the last activity across reloads — reloading used to restart the
 *    clock, so a member could leave and come back long after the timeout;
 *  - tells the server "still here" (`POST /v2/auth/activity`) while the member
 *    reads or types without the page calling the API.
 */

const LAST_ACTIVITY_KEY = 'nexus_last_activity';
const CHECK_INTERVAL_MS = 30_000;
/** Throttle for localStorage writes — activity bursts only persist once per window. */
const PERSIST_THROTTLE_MS = 15_000;
/** Preferred warning lead; clamped below the timeout (the DWP pattern asks for at least 2 minutes). */
const WARNING_LEAD_MAX_MS = 5 * 60_000;
const ACTIVITY_EVENTS: ReadonlyArray<keyof WindowEventMap> = [
  'pointerdown',
  'keydown',
  'wheel',
  'touchstart',
  'mousemove',
];

/** Parse the tenant setting into milliseconds; 0 = disabled. */
export function parseIdleTimeoutMs(raw: unknown): number {
  // Bootstrap coerces stored '0' to false; the validator guarantees enabled
  // values are >= 5 so a boolean can only ever mean "disabled".
  if (raw === null || raw === undefined || typeof raw === 'boolean') return 0;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 5) return 0;
  return Math.min(minutes, 480) * 60_000;
}

/**
 * How long before sign-out the warning opens: a fifth of the timeout, at least
 * 2 minutes (the DWP pattern's minimum), at most 5, and never more than half
 * the timeout — so a 5-minute timeout warns at 3 minutes idle, not 1.
 */
export function warningLeadMs(timeoutMs: number): number {
  return Math.min(WARNING_LEAD_MAX_MS, Math.floor(timeoutMs / 2), Math.max(2 * 60_000, Math.floor(timeoutMs / 5)));
}

/** How often activity may be reported to the server: well inside the timeout. */
function serverPingIntervalMs(timeoutMs: number): number {
  return Math.max(60_000, Math.min(5 * 60_000, Math.floor(timeoutMs / 3)));
}

function readPersistedActivity(): number {
  try {
    const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
    const ts = raw === null ? NaN : Number(raw);
    return Number.isFinite(ts) ? ts : 0;
  } catch {
    return 0;
  }
}

function persistActivity(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    // Storage unavailable (private mode / quota) — in-tab tracking still works
  }
}

export interface IdleLogoutState {
  /** True while the "you will be signed out soon" warning should show. */
  warningOpen: boolean;
  /** Seconds until sign-out while the warning is open. */
  secondsLeft: number;
  /** The member chose to stay signed in: counts as activity. */
  staySignedIn: () => void;
  /** The member chose to sign out now from the warning. */
  signOutNow: () => void;
}

export function useIdleLogout(): IdleLogoutState {
  const { user, logout } = useAuth();
  const { tenant } = useTenant();
  const toast = useToast();
  const { t } = useTranslation('errors');

  const timeoutMs = parseIdleTimeoutMs(tenant?.settings?.inactivity_timeout_minutes);
  const isActive = Boolean(user) && timeoutMs > 0;

  const lastActivityRef = useRef<number>(Date.now());
  const lastPersistRef = useRef<number>(0);
  const lastServerPingRef = useRef<number>(0);
  const loggingOutRef = useRef<boolean>(false);
  const [warningOpen, setWarningOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const warningOpenRef = useRef(false);
  warningOpenRef.current = warningOpen;

  const pingServer = useCallback((now: number, force = false) => {
    if (!force && now - lastServerPingRef.current < serverPingIntervalMs(timeoutMs)) return;
    lastServerPingRef.current = now;
    // Best effort: a failed ping must never sign the member out by itself.
    void api.post('/v2/auth/activity', {}).catch(() => undefined);
  }, [timeoutMs]);

  const signOut = useCallback((announce: boolean) => {
    if (loggingOutRef.current) return;
    loggingOutRef.current = true;
    setWarningOpen(false);
    try {
      localStorage.removeItem(LAST_ACTIVITY_KEY);
    } catch {
      // ignore
    }
    void logout().finally(() => {
      if (announce) toast.info(t('idle_logout_title'), t('idle_logout_message'));
    });
  }, [logout, toast, t]);

  const markActive = useCallback((forceServerPing: boolean) => {
    const now = Date.now();
    lastActivityRef.current = now;
    if (now - lastPersistRef.current >= PERSIST_THROTTLE_MS) {
      lastPersistRef.current = now;
      persistActivity(now);
    }
    pingServer(now, forceServerPing);
  }, [pingServer]);

  useEffect(() => {
    if (!isActive) return;

    // A reload or a returning tab keeps the activity it last recorded; only a
    // first visit with nothing recorded starts the clock now.
    const persisted = readPersistedActivity();
    lastActivityRef.current = persisted > 0 ? persisted : Date.now();
    loggingOutRef.current = false;
    const lead = warningLeadMs(timeoutMs);

    const recordActivity = () => {
      // While the warning is open, only its button counts: a stray mouse move
      // must not silently cancel a warning the member has not read.
      if (warningOpenRef.current) return;
      markActive(false);
    };

    const checkIdle = () => {
      if (loggingOutRef.current) return;
      const effectiveLast = Math.max(lastActivityRef.current, readPersistedActivity());
      const remaining = effectiveLast + timeoutMs - Date.now();
      if (remaining <= 0) {
        signOut(true);
        return;
      }
      if (remaining <= lead) {
        setSecondsLeft(Math.ceil(remaining / 1000));
        setWarningOpen(true);
      } else if (warningOpenRef.current) {
        // Another tab recorded activity: this tab's warning no longer applies.
        setWarningOpen(false);
      }
    };

    const onVisibilityChange = () => {
      // A tab waking from sleep may be long past the deadline — check at once
      if (document.visibilityState === 'visible') {
        checkIdle();
      }
    };

    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, recordActivity, { passive: true }));
    document.addEventListener('visibilitychange', onVisibilityChange);
    const interval = window.setInterval(checkIdle, CHECK_INTERVAL_MS);
    checkIdle();

    return () => {
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, recordActivity));
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(interval);
    };
  }, [isActive, timeoutMs, markActive, signOut]);

  // While the warning is open, count down once a second.
  useEffect(() => {
    if (!warningOpen) return;
    const tick = window.setInterval(() => {
      const remaining = Math.max(lastActivityRef.current, readPersistedActivity()) + timeoutMs - Date.now();
      if (remaining <= 0) {
        signOut(true);
      } else {
        setSecondsLeft(Math.ceil(remaining / 1000));
      }
    }, 1000);
    return () => window.clearInterval(tick);
  }, [warningOpen, timeoutMs, signOut]);

  const staySignedIn = useCallback(() => {
    setWarningOpen(false);
    markActive(true);
  }, [markActive]);

  const signOutNow = useCallback(() => signOut(false), [signOut]);

  return { warningOpen: isActive && warningOpen, secondsLeft, staySignedIn, signOutNow };
}
