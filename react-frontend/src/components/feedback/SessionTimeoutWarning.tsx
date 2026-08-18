// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SessionTimeoutWarning — WCAG 2.2.1 compliance
 *
 * Shows a modal ≥ 20 seconds before the user's session token expires,
 * giving them the option to extend their session or log out.
 *
 * Listens for SESSION_EXPIRING_EVENT dispatched by AuthContext after each
 * successful login/token refresh. On "Extend session" it calls the token
 * refresh endpoint and reschedules the warning timer.
 *
 * The countdown is derived from an absolute wall-clock deadline, never by
 * decrementing a counter: browsers throttle setInterval in background tabs
 * (to once a minute or slower), so a decrementing counter drifts late and a
 * hidden tab could show "30 seconds" long after the JWT actually expired.
 * Timers only decide how often we LOOK at the clock; visibilitychange/focus
 * reconcile a re-activated tab with reality immediately.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import LogOut from 'lucide-react/icons/log-out';

import { api, SESSION_EXPIRING_EVENT, tokenManager } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { Button, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui';

// How long to count down in the warning (seconds shown to user)
const COUNTDOWN_SECONDS = 30;
const TOKEN_CHECK_INTERVAL_MS = 5000;

function getTokenSecondsUntilExpiry(token: string | null): number | null {
  if (!token) return null;

  try {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) return null;
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { exp?: unknown };
    if (typeof payload.exp !== 'number') return null;
    return Math.ceil(payload.exp - Date.now() / 1000);
  } catch {
    return null;
  }
}

export function SessionTimeoutWarning() {
  const { t } = useTranslation('errors');
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const { logout, scheduleSessionWarning, isAuthenticated } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [isExtending, setIsExtending] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const deadlineRef = useRef<number | null>(null);
  const observedAccessTokenRef = useRef<string | null>(null);
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  const stopCountdown = useCallback(() => {
    if (countdownRef.current !== null) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    deadlineRef.current = null;
  }, []);

  // Recompute the displayed seconds from the wall-clock deadline. Safe to call
  // at any frequency — a throttled interval and an eager visibilitychange both
  // land on the same truth.
  const syncCountdown = useCallback(() => {
    const deadline = deadlineRef.current;
    if (deadline === null) return;
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    if (remaining <= 0) {
      stopCountdown();
    }
    setCountdown(remaining);
  }, [stopCountdown]);

  const startCountdown = useCallback((initialSeconds = COUNTDOWN_SECONDS) => {
    stopCountdown();
    const seconds = Math.max(1, Math.ceil(initialSeconds));
    deadlineRef.current = Date.now() + seconds * 1000;
    setCountdown(seconds);
    countdownRef.current = setInterval(syncCountdown, 1000);
  }, [stopCountdown, syncCountdown]);

  const handleClose = useCallback(() => {
    stopCountdown();
    setIsOpen(false);
  }, [stopCountdown]);

  const handleExtend = useCallback(async () => {
    // Do not let the countdown's auto-logout race a refresh that the user has
    // already requested. Success closes the dialog; transient failure starts
    // a fresh retry window; authoritative rejection logs out below.
    stopCountdown();
    setIsExtending(true);
    try {
      const outcome = await api.refreshSession();
      if (outcome === 'refreshed') {
        const accessToken = tokenManager.getAccessToken();
        observedAccessTokenRef.current = accessToken;
        const secondsUntilExpiry = getTokenSecondsUntilExpiry(accessToken);
        if (secondsUntilExpiry !== null && secondsUntilExpiry > 0) {
          scheduleSessionWarning(secondsUntilExpiry);
        }
        handleClose();
        return;
      }

      if (outcome === 'transient') {
        // A network failure or AUTH_REFRESH_SUPERSEDED response does not prove
        // that the shared session is invalid. Keep the credentials and give
        // the user another full window to retry instead of revoking a winner.
        startCountdown(COUNTDOWN_SECONDS);
        return;
      }

      // Only an authoritative credential rejection ends the session.
      handleClose();
      await logout();
      navigate(tenantPath('/login'));
    } finally {
      setIsExtending(false);
    }
  }, [handleClose, logout, navigate, tenantPath, scheduleSessionWarning, startCountdown, stopCountdown]);

  const handleLogout = useCallback(async () => {
    handleClose();
    await logout();
    navigate(tenantPath('/login'));
  }, [handleClose, logout, navigate, tenantPath]);

  // Auto-logout when countdown reaches zero
  useEffect(() => {
    if (countdown === 0 && isOpen) {
      void handleLogout();
    }
  }, [countdown, isOpen, handleLogout]);

  // Listen for the warning event from AuthContext
  useEffect(() => {
    const handleExpiring = (event: Event) => {
      // Only show if user is currently authenticated
      if (!isAuthenticatedRef.current) return;
      const requestedSeconds = event instanceof CustomEvent
        && typeof event.detail?.secondsRemaining === 'number'
        ? event.detail.secondsRemaining
        : COUNTDOWN_SECONDS;
      setIsOpen(true);
      startCountdown(requestedSeconds);
    };

    window.addEventListener(SESSION_EXPIRING_EVENT, handleExpiring);
    return () => {
      window.removeEventListener(SESSION_EXPIRING_EVENT, handleExpiring);
      stopCountdown();
    };
  }, [startCountdown, stopCountdown]);

  // A tab coming back to life must reconcile with the wall clock at once:
  // past the deadline → countdown hits 0 and the auto-logout effect fires,
  // otherwise → show the TRUE remaining time instead of the stale throttled one.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncCountdown();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', syncCountdown);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', syncCountdown);
    };
  }, [syncCountdown]);

  // Interactive login flows are scheduled by AuthContext. Restored sessions
  // and API-client refreshes do not carry that callback, so observe the JWT
  // expiry and schedule those token lifetimes here as well.
  useEffect(() => {
    if (!isAuthenticated) {
      observedAccessTokenRef.current = null;
      return;
    }

    const syncAccessTokenExpiry = () => {
      const accessToken = tokenManager.getAccessToken();
      if (!accessToken || accessToken === observedAccessTokenRef.current) return;

      observedAccessTokenRef.current = accessToken;
      const secondsRemaining = getTokenSecondsUntilExpiry(accessToken);
      if (secondsRemaining === null || secondsRemaining <= 0) return;

      if (secondsRemaining <= COUNTDOWN_SECONDS + 5) {
        window.dispatchEvent(new CustomEvent(SESSION_EXPIRING_EVENT, {
          detail: { secondsRemaining },
        }));
      } else {
        scheduleSessionWarning(secondsRemaining);
      }
    };

    syncAccessTokenExpiry();
    const interval = window.setInterval(syncAccessTokenExpiry, TOKEN_CHECK_INTERVAL_MS);
    window.addEventListener('storage', syncAccessTokenExpiry);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('storage', syncAccessTokenExpiry);
    };
  }, [isAuthenticated, scheduleSessionWarning]);

  // Close and cancel countdown when the user is no longer authenticated
  // (e.g., they logged out in another tab)
  useEffect(() => {
    if (!isAuthenticated && isOpen) {
      handleClose();
    }
  }, [isAuthenticated, isOpen, handleClose]);

  return (
    <Modal
      isOpen={isOpen}
      size="sm"
      isDismissable={false}
      isKeyboardDismissDisabled
      hideCloseButton
      classNames={{
        base: 'bg-overlay border border-theme-default',
      }}
      aria-labelledby="session-timeout-title"
      aria-describedby="session-timeout-description"
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader
              className="flex flex-col items-center gap-0 pt-6 pb-2"
            >
              <div className="flex justify-center mb-4">
                <div className="relative p-4 rounded-full bg-amber-500/20">
                  <Clock className="w-8 h-8 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                  {/* Countdown badge */}
                  <span
                    className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white"
                    aria-hidden="true"
                  >
                    {countdown}
                  </span>
                </div>
              </div>
              <ModalHeading
                id="session-timeout-title"
                className="text-xl font-semibold text-theme-primary"
              >
                {t('session_expiring')}
              </ModalHeading>
            </ModalHeader>

            <ModalBody
              id="session-timeout-description"
              className="text-center pb-4"
            >
              <p className="text-theme-muted">
                {t('session_expiring_message', { seconds: countdown })}
              </p>
              {/* Live region so screen readers announce the countdown.
                  Throttled so it doesn't speak every single second (which
                  floods the SR queue): step in 10s increments, then each of
                  the final 5 seconds. */}
              <p
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
              >
                {t('session_expiring_countdown_aria', {
                  seconds: countdown <= 5 ? countdown : Math.ceil(countdown / 10) * 10,
                })}
              </p>
            </ModalBody>

            <ModalFooter className="gap-3">
              <Button
                variant="flat"
                className="flex-1 bg-theme-elevated text-theme-primary"
                startContent={<LogOut className="w-4 h-4" aria-hidden="true" />}
                onPress={() => { void handleLogout(); }}
              >
                {t('auth.log_out', { ns: 'common' })}
              </Button>
              <Button
                className="flex-1 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                isLoading={isExtending}
                onPress={() => { void handleExtend(); }}
              >
                {t('extend_session')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default SessionTimeoutWarning;
