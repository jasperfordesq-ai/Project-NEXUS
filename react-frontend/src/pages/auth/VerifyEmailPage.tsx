// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Verify Email Page - Verifies email address with token from URL
 *
 * The user arrives here via an email verification link containing a token.
 * On mount, the page automatically POSTs the token to the API.
 * Shows loading -> success or error states.
 */

import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Mail from 'lucide-react/icons/mail';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';

type VerifyState = 'loading' | 'success' | 'error';

export function VerifyEmailPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('page_meta.verify_email.title'));
  const { branding, tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();
  const toast = useToast();

  /*
   * Whether this member is still waiting on an administrator after verifying.
   *
   * 🔴 This used to read `tenant.settings.admin_approval` from the bootstrap
   * payload, and that key is DELIBERATELY excluded from the public bootstrap (see
   * TenantBootstrapController's exclusion list) — so the value was permanently
   * undefined, the flag permanently false, and the "awaiting approval" panel below
   * was dead code. Since approval-required is the DEFAULT for a new community, that
   * meant the default new-member experience never explained itself.
   *
   * The verify-email response now reports it directly, which fixes the screen
   * without publishing a tenant configuration value to anonymous callers.
   */
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [state, setState] = useState<VerifyState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  // Auto-verify on mount when token is present
  useEffect(() => {
    if (!token) {
      setState('error');
      setErrorMessage(t('verify_email.no_token_error'));
      return;
    }

    let cancelled = false;

    async function verifyEmail() {
      try {
        const response = await api.post<{ verified?: boolean; requires_approval?: boolean }>(
          '/auth/verify-email',
          { token },
        );
        if (!cancelled) {
          if (response.success) {
            setRequiresApproval(response.data?.requires_approval === true);
            setState('success');
          } else {
            setState('error');
            setErrorMessage(response.error || t('verify_email.expired_error'));
          }
        }
      } catch {
        if (!cancelled) {
          setState('error');
          setErrorMessage(t('verify_email.expired_error'));
        }
      }
    }

    verifyEmail();

    return () => {
      cancelled = true;
    };
  }, [token, t]);

  async function handleResendVerification() {
    if (!isAuthenticated) return;

    try {
      setIsResending(true);
      const res = await api.post('/auth/resend-verification');
      // api.post resolves { success:false } on a 4xx (e.g. rate-limited) WITHOUT
      // throwing, so the catch never fired — gate the "sent" confirmation on a confirmed
      // resend, else show the error so the user isn't left waiting for an email that
      // never comes.
      if (res.success) {
        setResendSuccess(true);
        toast.success(t('resend_sent'));
      } else {
        setErrorMessage(t('verify_email.resend_error'));
      }
    } catch {
      setErrorMessage(t('verify_email.resend_error'));
    } finally {
      setIsResending(false);
    }
  }

  // Loading state
  if (state === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PageMeta title={t('page_meta.verify_email.title')} noIndex />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard className="p-8 text-center">
            <div role="status" aria-busy="true" aria-label={t('verify_email.loading_title')} className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent/20 flex items-center justify-center">
              <Spinner size="lg" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('verify_email.loading_title')}</h1>
            <p className="text-theme-muted">
              {t('verify_email.loading_subtitle')}
            </p>
          </GlassCard>

          {/* Branding */}
          <p className="text-center text-theme-subtle text-sm mt-6">
            {branding.name}
          </p>
        </motion.div>
      </div>
    );
  }

  // Success state
  if (state === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle aria-hidden="true" className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('verify_email.success_title')}</h1>
            <p className="text-theme-muted mb-4">
              {t('verify_email.success_subtitle')}
            </p>

            {/* If tenant requires admin approval, warn user they still can't login yet */}
            {requiresApproval && !isAuthenticated && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-left mb-6">
                <div className="flex items-start gap-3">
                  <ShieldCheck aria-hidden="true" className="w-5 h-5 text-[var(--color-warning)] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-amber-700 dark:text-amber-400">{t('verify_email.awaiting_approval_title')}</p>
                    <p className="text-amber-600/80 dark:text-amber-300/80 mt-1">
                      {t('verify_email.awaiting_approval_body')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isAuthenticated ? (
              <Button as={Link} to={tenantPath('/dashboard')} className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white">
                {t('verify_email.go_to_dashboard')}
              </Button>
            ) : (
              <Button as={Link} to={tenantPath('/login')} className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white">
                {requiresApproval ? t('verify_email.back_to_login') : t('verify_email.go_to_login')}
              </Button>
            )}
          </GlassCard>

          {/* Branding */}
          <p className="text-center text-theme-subtle text-sm mt-6">
            {branding.name}
          </p>
        </motion.div>
      </div>
    );
  }

  // Error state
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        <GlassCard className="p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
            <XCircle aria-hidden="true" className="w-8 h-8 text-red-400" />
          </div>
          <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('verify_email.error_title')}</h1>
          <p className="text-theme-muted mb-6">
            {errorMessage}
          </p>

          <div className="flex flex-col gap-3">
            {/* Resend verification — only available when authenticated */}
            {isAuthenticated ? (
              resendSuccess ? (
                <div role="status" className="p-3 rounded-lg bg-emerald-500/20 border border-emerald-500/30 text-emerald-800 dark:text-emerald-400 text-sm">
                  {t('verify_email.resend_success')}
                </div>
              ) : (
                <Button
                  onPress={handleResendVerification}
                  isLoading={isResending}
                  className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                  startContent={!isResending ? <Mail aria-hidden="true" className="w-4 h-4" /> : undefined}
                >
                  {t('verify_email.resend')}
                </Button>
              )
            ) : (
              <p className="text-theme-subtle text-sm">
                {t('verify_email.login_required')}
              </p>
            )}

            <Button as={Link} to={isAuthenticated ? tenantPath('/dashboard') : tenantPath('/login')}
              variant="flat"
              className="w-full bg-theme-elevated text-theme-primary"
              startContent={<ArrowLeft aria-hidden="true" className="w-4 h-4" />}
            >
              {isAuthenticated ? t('verify_email.back_to_dashboard') : t('verify_email.back_to_login')}
            </Button>
          </div>
        </GlassCard>

        {/* Branding */}
        <p className="text-center text-theme-subtle text-sm mt-6">
          {branding.name}
        </p>
      </motion.div>
    </div>
  );
}

export default VerifyEmailPage;
