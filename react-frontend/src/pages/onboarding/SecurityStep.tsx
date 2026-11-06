// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Protect your account" step for the onboarding wizard (slug `security`).
 *
 * Offers two-step sign-in (an authenticator app on the member's phone as well
 * as their password). Always optional: "Not now" just moves on and records
 * nothing. The server only includes this step for members who can set it up
 * (community allows it, the community setting is on, the member has a password
 * of their own and it is not already on).
 *
 * As a second check, on mount we read `/v2/auth/2fa/status` and skip the step
 * when two-factor is already on or the community does not allow enrolment.
 *
 * The enrolment itself is the shared `TwoFactorEnrolment` flow used by
 * Settings → Security, so it keeps the fresh "confirm it is you" check
 * (E-035 F-170). It is never bypassed here.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Smartphone from 'lucide-react/icons/smartphone';
import KeyRound from 'lucide-react/icons/key-round';
import Clock from 'lucide-react/icons/clock';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import SkipForward from 'lucide-react/icons/skip-forward';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { TwoFactorEnrolment } from '@/components/security/TwoFactorEnrolment';
import { useTwoFactorEnrolment } from '@/components/security/useTwoFactorEnrolment';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

interface TwoFactorStatus {
  enabled: boolean;
  enrollment_allowed?: boolean;
}

export interface SecurityStepProps {
  /** Move to the next step. Never completes onboarding by itself. */
  onNext: () => void;
  onBack: () => void;
  /**
   * Called (once) when this member cannot or need not set it up: two-factor
   * is already on, or the community does not allow enrolment.
   */
  onUnavailable: () => void;
}

export function SecurityStep({ onNext, onBack, onUnavailable }: SecurityStepProps) {
  const { t } = useTranslation('onboarding');
  const [checking, setChecking] = useState(true);
  const enrolment = useTwoFactorEnrolment();
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => { onUnavailableRef.current = onUnavailable; }, [onUnavailable]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<TwoFactorStatus>('/v2/auth/2fa/status');
        if (cancelled) return;
        if (res.success && res.data && (res.data.enabled === true || res.data.enrollment_allowed === false)) {
          onUnavailableRef.current();
          return;
        }
      } catch (error) {
        // The server only offers this step to members who can use it; if the
        // status cannot be read, still offer it — set-up is checked again there.
        logError('Failed to load two-factor status for onboarding', error);
      }
      if (!cancelled) setChecking(false);
    })();
    return () => { cancelled = true; };
  }, []);

  if (checking) {
    return (
      <div role="status" aria-busy="true" aria-label={t('security_checking')} className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const inProgress = enrolment.phase !== 'idle';
  const showingCodes = enrolment.phase === 'codes';

  return (
    <div className="space-y-6">
      <GlassCard className="p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/20 shrink-0">
            <ShieldCheck className="w-6 h-6 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-theme-primary">{t('security_title')}</h2>
            <p className="text-sm text-theme-muted">{t('security_subtitle')}</p>
          </div>
        </div>

        {!showingCodes && (
          <>
            <p className="text-theme-primary">{t('security_intro')}</p>

            <div>
              <h3 className="font-medium text-theme-primary mb-2">{t('security_need_title')}</h3>
              <ul className="space-y-2 text-sm text-theme-muted">
                <li className="flex items-start gap-2">
                  <Smartphone className="w-4 h-4 mt-0.5 shrink-0 text-theme-subtle" aria-hidden="true" />
                  <span>{t('security_need_phone')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <KeyRound className="w-4 h-4 mt-0.5 shrink-0 text-theme-subtle" aria-hidden="true" />
                  <span>{t('security_need_password')}</span>
                </li>
                <li className="flex items-start gap-2">
                  <Clock className="w-4 h-4 mt-0.5 shrink-0 text-theme-subtle" aria-hidden="true" />
                  <span>{t('security_need_time')}</span>
                </li>
              </ul>
            </div>

            <p className="text-sm text-theme-subtle">{t('security_optional_note')}</p>
          </>
        )}

        {inProgress && (
          <div className="border-t border-theme-default pt-5">
            <TwoFactorEnrolment
              enrolment={enrolment}
              variant="inline"
              doneLabel={t('security_continue')}
              onDone={onNext}
              confirmFailedHint={t('security_confirm_failed_hint')}
            />
          </div>
        )}
      </GlassCard>

      {!showingCodes && (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="tertiary"
            className="text-theme-muted"
            onPress={onBack}
            startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
          >
            {t('back')}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="tertiary"
              className="text-theme-subtle"
              onPress={onNext}
              endContent={<SkipForward className="w-4 h-4" aria-hidden="true" />}
            >
              {t('security_not_now')}
            </Button>
            {!inProgress && (
              <Button
                className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium"
                endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
                onPress={() => { void enrolment.start(); }}
              >
                {t('security_set_up')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SecurityStep;
