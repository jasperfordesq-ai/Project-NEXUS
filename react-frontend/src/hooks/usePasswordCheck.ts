// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * usePasswordCheck — live NIST SP 800-63B aligned password strength check.
 *
 * Modern password policy (NIST 2017+):
 *   - Length is the primary security signal (min 12 chars).
 *   - Character-class rules (must-have-uppercase / digit / symbol) push
 *     users toward predictable patterns like "P@ssw0rd1!" and are removed.
 *   - The meaningful check is against breach corpora (Have I Been Pwned)
 *     because attackers use credential-stuffing from those exact lists.
 *
 * This hook runs both checks in the browser as the user types:
 *   1. Length check — instant
 *   2. HIBP k-anonymity check — debounced 350ms after typing stops. SHA-1
 *      hashes the password locally, sends only the first 5 hex chars to
 *      api.pwnedpasswords.com/range/{prefix}, looks up the remaining
 *      suffix in the returned list. Server never learns the password.
 *
 * Failure mode: HIBP network error, non-OK response, or no answer within
 * HIBP_TIMEOUT_MS → treated as "not pwned" (fail-open) so an HIBP outage —
 * or a request that hangs behind a firewall, captive portal or privacy
 * extension — doesn't block registration or a password reset. The request
 * is aborted, `breachCheckUnavailable` is set, and the message says the check
 * could not run. The server-side check (PwnedPasswordService, run on both
 * register and reset) is the real gate.
 */

export const PASSWORD_MIN_LENGTH = 12;

const HIBP_API = 'https://api.pwnedpasswords.com/range/';

/** How long the breach check may take before it is abandoned (fail-open). */
export const HIBP_TIMEOUT_MS = 4000;

/** Debounce after the last keystroke before the breach check starts. */
const HIBP_DEBOUNCE_MS = 350;

async function sha1Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export interface PasswordCheckState {
  /** Current character count. */
  length: number;
  /** True when the password meets the length minimum. */
  isLongEnough: boolean;
  /** null = not yet checked, true = appears in HIBP corpus, false = clean. */
  isPwned: boolean | null;
  /** True while the HIBP request is in flight. */
  isChecking: boolean;
  /**
   * True when the breach check could not run (network error, error response,
   * or no answer within HIBP_TIMEOUT_MS). The password is still accepted here;
   * the server repeats the check on submit.
   */
  breachCheckUnavailable: boolean;
  /** True when the password is acceptable for submission. */
  isAcceptable: boolean;
  /** Plain-language status message for the user. */
  message: string;
  /** Severity for visual styling. */
  tone: 'idle' | 'warn' | 'error' | 'success';
}

// Cache results by SHA-1 hash so that re-typing the same password doesn't
// spam HIBP. Map is process-scoped — fine for a single registration session.
const checkCache = new Map<string, boolean>();

export function usePasswordCheck(password: string): PasswordCheckState {
  const { t } = useTranslation('auth');
  const length = password.length;
  const isLongEnough = length >= PASSWORD_MIN_LENGTH;
  const [isPwned, setIsPwned] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [breachCheckUnavailable, setBreachCheckUnavailable] = useState(false);

  useEffect(() => {
    setBreachCheckUnavailable(false);
    if (!isLongEnough) {
      setIsPwned(null);
      setIsChecking(false);
      return;
    }

    let cancelled = false;
    let settled = false;
    let deadline: number | undefined;
    const controller = new AbortController();
    setIsChecking(true);

    // Every outcome goes through here exactly once, so a late answer can't
    // overwrite the fail-open result after the time limit (or vice versa).
    const finish = (found: boolean, unavailable: boolean) => {
      if (cancelled || settled) return;
      settled = true;
      window.clearTimeout(deadline);
      setIsPwned(found);
      setBreachCheckUnavailable(unavailable);
      setIsChecking(false);
    };

    const timer = window.setTimeout(async () => {
      // A request that hangs rather than fails would otherwise leave
      // isChecking true for ever and the form could never be submitted.
      deadline = window.setTimeout(() => {
        controller.abort();
        finish(false, true); // fail-open
      }, HIBP_TIMEOUT_MS);

      try {
        const hash = (await sha1Hex(password)).toUpperCase();
        if (cancelled || settled) return;
        if (checkCache.has(hash)) {
          finish(checkCache.get(hash) === true, false);
          return;
        }
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);
        const resp = await fetch(`${HIBP_API}${prefix}`, {
          headers: { 'Add-Padding': 'true' },
          signal: controller.signal,
        });
        if (cancelled || settled) return;
        if (!resp.ok) {
          finish(false, true); // fail-open
          return;
        }
        const body = await resp.text();
        if (cancelled || settled) return;
        const found = body.split('\n').some((line) => {
          const [s, c] = line.trim().split(':');
          return s === suffix && Number(c) > 0;
        });
        checkCache.set(hash, found);
        finish(found, false);
      } catch {
        finish(false, true); // fail-open on network/abort/crypto error
      }
    }, HIBP_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [password, isLongEnough]);

  let message = '';
  let tone: PasswordCheckState['tone'] = 'idle';

  if (length === 0) {
    message = t('password_check.hint', { min: PASSWORD_MIN_LENGTH });
    tone = 'idle';
  } else if (!isLongEnough) {
    message = t('password_check.add_more', { count: PASSWORD_MIN_LENGTH - length });
    tone = 'warn';
  } else if (isChecking) {
    message = t('password_check.checking');
    tone = 'idle';
  } else if (isPwned === true) {
    message = t('password_check.breached');
    tone = 'error';
  } else if (isPwned === false && breachCheckUnavailable) {
    message = t('password_check.unavailable');
    tone = 'idle';
  } else if (isPwned === false) {
    message = t('password_check.strong');
    tone = 'success';
  }

  const isAcceptable = isLongEnough && isPwned === false;

  return {
    length,
    isLongEnough,
    isPwned,
    isChecking,
    breachCheckUnavailable,
    isAcceptable,
    message,
    tone,
  };
}
