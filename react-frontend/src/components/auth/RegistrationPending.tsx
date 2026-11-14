// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The screen a new member sees straight after Create Account: "check your
 * email", "waiting for approval" or "on the waitlist".
 *
 * Moved out of RegisterPage (B1 walk 2.12, 13 Nov 2026), which also gave it:
 *  - "Send it again", through the enumeration-safe
 *    `POST /auth/resend-verification-by-email`. Its confirmation stays as vague
 *    as the endpoint: it never says whether the address has an account or still
 *    needs verifying. The button then rests for a minute — the server's own
 *    per-address cooldown — so it cannot be hammered.
 *  - "Wrong address? Start again", back to the join form.
 *  - Theme text colours that keep 4.5:1 on their tinted panels in light and
 *    dark (they were blue-on-blue and amber-on-amber).
 *  - "Back to sign in" as a quieter way out: sign-in cannot work until the
 *    email is verified, so it is no longer the main button.
 */

import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import MailCheck from 'lucide-react/icons/mail-check';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import RotateCw from 'lucide-react/icons/rotate-cw';
import { CommunityWelcome } from '@/components/auth/CommunityWelcome';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import type { RegisterResult } from '@/contexts/AuthContext';
import { api } from '@/lib/api';
import { motion } from '@/lib/motion';

/** Matches EmailVerificationController::RESEND_COOLDOWN_SECONDS. */
const RESEND_REST_MS = 60_000;

type ResendNote = 'sent' | 'too_many' | 'failed' | null;

export interface RegistrationPendingProps {
  result: RegisterResult;
  firstName: string;
  email: string;
  loginLink: string;
  /** The page the member was on the way to, kept in the new link. */
  returnTo?: string;
  onStartAgain: () => void;
}

export function RegistrationPending({
  result,
  firstName,
  email,
  loginLink,
  returnTo,
  onStartAgain,
}: RegistrationPendingProps) {
  const { t } = useTranslation('auth');
  const [isSending, setIsSending] = useState(false);
  const [isResting, setIsResting] = useState(false);
  const [note, setNote] = useState<ResendNote>(null);
  const restTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (restTimer.current) clearTimeout(restTimer.current);
  }, []);

  const rest = () => {
    setIsResting(true);
    if (restTimer.current) clearTimeout(restTimer.current);
    restTimer.current = setTimeout(() => setIsResting(false), RESEND_REST_MS);
  };

  async function handleResend() {
    if (isSending || isResting) return;
    setIsSending(true);
    try {
      const res = await api.post(
        '/auth/resend-verification-by-email',
        { email, return_to: returnTo || undefined },
        { skipAuth: true },
      );
      // The endpoint answers the same way for every address; the only refusal it
      // can give is for asking too often from this connection.
      if (res?.success) {
        setNote('sent');
      } else {
        setNote(res?.code === 'RATE_LIMIT_EXCEEDED' ? 'too_many' : 'failed');
      }
      rest();
    } catch {
      setNote('failed');
    } finally {
      setIsSending(false);
    }
  }

  const nextStep = result.requiresWaitlist
    ? t('register.waitlist_next')
    : result.requiresVerification && result.requiresApproval
      ? t('register.next_verify_approve')
      : result.requiresVerification
        ? t('register.next_verify')
        : t('register.next_approve');

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <GlassCard className="overflow-hidden p-6 sm:p-8">
          {/* The community first, as on the form itself. */}
          <CommunityWelcome className="-mx-6 -mt-6 mb-6 sm:-mx-8 sm:-mt-8" />
          <div className="text-center">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-success/15"
            >
              {result.requiresWaitlist ? (
                <Users className="w-8 h-8 text-theme-info" aria-hidden="true" />
              ) : result.requiresVerification ? (
                <MailCheck className="w-8 h-8 text-theme-success" aria-hidden="true" />
              ) : (
                <ShieldCheck className="w-8 h-8 text-theme-success" aria-hidden="true" />
              )}
            </motion.div>

            <h1 className="text-xl sm:text-2xl font-bold text-theme-primary mb-2">
              {result.requiresWaitlist
                ? t('register.waitlist_title')
                : t('register.success_title', { name: firstName.trim() })}
            </h1>

            <div className="space-y-3 mt-4 text-left">
              {result.requiresWaitlist && (
                <div className="p-3 rounded-xl bg-accent/10 border border-accent/20 text-sm">
                  <div className="flex items-start gap-3">
                    <Clock aria-hidden="true" className="w-5 h-5 text-theme-info flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-theme-primary">
                        {result.waitlistPosition
                          ? t('register.waitlist_position', { position: result.waitlistPosition })
                          : t('register.waitlist_joined')}
                      </p>
                      <p className="text-theme-secondary mt-1">{t('register.waitlist_body')}</p>
                    </div>
                  </div>
                </div>
              )}

              {result.requiresVerification && (
                <div className="p-3 rounded-xl bg-[var(--color-info)]/10 border border-[var(--color-info)]/20 text-sm">
                  <div className="flex items-start gap-3">
                    <MailCheck aria-hidden="true" className="w-5 h-5 text-theme-info flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="font-medium text-theme-info">{t('register.verify_email_title')}</p>
                      <p className="text-theme-secondary mt-1 break-words">
                        <Trans
                          ns="auth"
                          i18nKey="register.verify_email_body"
                          values={{ email }}
                          components={{ strong: <strong className="text-theme-primary" /> }} />
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {result.requiresApproval && (
                <div className="p-3 rounded-xl bg-warning/10 border border-warning/20 text-sm">
                  <div className="flex items-start gap-3">
                    <ShieldCheck aria-hidden="true" className="w-5 h-5 text-theme-warning flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium text-theme-warning">{t('register.approval_title')}</p>
                      <p className="text-theme-secondary mt-1">{t('register.approval_body')}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <p className="text-theme-secondary text-sm mt-6">{nextStep}</p>

            {result.requiresVerification && (
              <div className="mt-6 space-y-3">
                <Button
                  variant="outline"
                  className="w-full font-medium"
                  size="lg"
                  onPress={handleResend}
                  isLoading={isSending}
                  isDisabled={isResting}
                  startContent={!isSending ? <RotateCw aria-hidden="true" className="w-4 h-4" /> : undefined}
                >
                  {t('register.resend_link')}
                </Button>

                {note && (
                  <p role="status" className="text-sm text-theme-secondary">
                    {note === 'sent'
                      ? t('register.resend_link_sent')
                      : note === 'too_many'
                        ? t('register.resend_link_too_many')
                        : t('register.resend_link_failed')}
                  </p>
                )}

                <p className="text-sm text-theme-secondary">
                  {t('register.wrong_address')}{' '}
                  <button
                    type="button"
                    onClick={onStartAgain}
                    className="font-medium text-theme-primary underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 rounded"
                  >
                    {t('register.start_again')}
                  </button>
                </p>
              </div>
            )}

            <Button
              as={Link}
              to={loginLink}
              variant="light"
              className="mt-4 w-full font-medium text-theme-secondary"
            >
              {t('verify_email.back_to_login')}
            </Button>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default RegistrationPending;
