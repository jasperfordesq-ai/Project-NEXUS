// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { motion } from '@/lib/motion';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { Info } from 'lucide-react';
import { Trans, useTranslation } from 'react-i18next';
import { Spinner } from '@/components/ui/Spinner';
import type { PasswordCheckState } from '@/hooks/usePasswordCheck';
import { PASSWORD_MIN_LENGTH } from '@/hooks/usePasswordCheck';

interface PasswordStrengthProps {
  state: PasswordCheckState;
  /** Hide the breach-check status until the user has typed >= MIN_LENGTH. */
  compactWhileTyping?: boolean;
}

/**
 * PasswordStrength — accessible feedback under the password input.
 *
 * Shows:
 *   - A length progress bar (0 → MIN_LENGTH → 100%).
 *   - A status line that updates live as the user types.
 *   - Once the password is long enough, a breach-check status appears
 *     ("Checking…" → "Strong enough" / "This password is in a breach").
 *
 * The status line is wired up to `aria-live="polite"` so screen readers
 * announce it on change, but only after the user stops typing for a beat.
 */
export function PasswordStrength({ state }: PasswordStrengthProps) {
  const { t } = useTranslation('auth');
  const { length, isLongEnough, tone, message } = state;
  const pct = Math.min(100, Math.round((length / PASSWORD_MIN_LENGTH) * 100));
  const overshoot = isLongEnough ? Math.min(100, Math.round(((length - PASSWORD_MIN_LENGTH) / 8) * 100)) : 0;

  const barColor =
    tone === 'success'
      ? 'bg-success'
      : tone === 'error'
        ? 'bg-danger'
        : tone === 'warn'
          ? 'bg-warning'
          : 'bg-accent';

  const Icon = tone === 'success' ? CheckCircle : tone === 'error' ? AlertCircle : Info;

  return (
    <div className="space-y-2 text-sm" role="group" aria-label={t('register.aria.password_strength')}>
      {/* Two-segment bar: 0-100% to minimum, then up to 100% bonus for overshoot. */}
      <div className="flex gap-1 h-1.5">
        <div className="flex-1 rounded-full bg-theme-elevated overflow-hidden">
          <motion.div
            className={`h-full ${barColor}`}
            initial={false}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
        <div className="flex-1 rounded-full bg-theme-elevated overflow-hidden" aria-hidden={!isLongEnough}>
          <motion.div
            className={`h-full ${tone === 'success' ? 'bg-success' : 'bg-success/50'}`}
            initial={false}
            animate={{ width: `${overshoot}%` }}
            transition={{ duration: 0.25 }}
          />
        </div>
      </div>

      <p
        className={
          tone === 'error'
            ? 'text-danger flex items-center gap-2'
            : tone === 'success'
              ? 'text-emerald-700 dark:text-emerald-400 flex items-center gap-2'
              : tone === 'warn'
                ? 'text-warning flex items-center gap-2'
                : 'text-theme-muted flex items-center gap-2'
        }
        aria-live="polite"
      >
        {state.isChecking ? <Spinner size="sm" aria-hidden="true" /> : <Icon className="w-4 h-4" aria-hidden="true" />}
        <span>{message}</span>
      </p>

      {length === 0 && (
        <p className="text-theme-subtle text-xs">
          <Trans
            i18nKey="register.password_tip"
            ns="auth"
            values={{
              strongExample: t('register.password_tip_strong_example'),
              weakExample: t('register.password_tip_weak_example'),
            }}
            components={{
              strongExample: <span className="font-mono" />,
              weakExample: <span className="font-mono" />,
            }}
          />
        </p>
      )}
    </div>
  );
}
