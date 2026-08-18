// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Forgot Password Page - Request password reset
 */

import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';import Mail from 'lucide-react/icons/mail';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';

export function ForgotPasswordPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('page_meta.forgot_password.title'));
  const { branding, tenantPath } = useTenant();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Synchronous re-entry guard: the submit button isn't natively disabled while
  // the request is in flight (isLoading only renders a spinner), and pressing
  // Enter submits the native form — so a double-Enter would fire two reset-email
  // requests before isLoading state flushes. A ref blocks the second submit.
  const isSubmittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || isSubmittingRef.current) return;

    isSubmittingRef.current = true;
    setSubmitError(null);
    setIsLoading(true);

    try {
      const response = await api.post<{ message?: string }>('/auth/forgot-password', { email });

      if (response.success) {
        setIsSubmitted(true);
        return;
      }

      // Surface concrete failures so the user knows they should retry rather
      // than waiting forever for an email that will never arrive.
      if (response.code === 'RATE_LIMIT_EXCEEDED') {
        setSubmitError(t('forgot_password.rate_limited'));
        return;
      }
      // Generic fallthrough — show the message so the user has a chance to act.
      setSubmitError(response.error || t('forgot_password.generic_error'));
    } finally {
      isSubmittingRef.current = false;
      setIsLoading(false);
    }
  }

  if (isSubmitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PageMeta title={t('page_meta.forgot_password.title')} noIndex />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard className="p-5 text-center sm:p-8">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('forgot_password.success_title')}</h1>
            <p className="text-theme-muted mb-6">
              {t('forgot_password.success_subtitle')}
            </p>
            <p className="text-theme-subtle text-sm mb-6">
              {t('forgot_password.help_text')}
            </p>
            <div className="flex flex-col gap-3">
              <Button
                onPress={() => setIsSubmitted(false)}
                variant="flat"
                className="bg-theme-elevated text-theme-primary"
              >
                {t('forgot_password.try_again')}
              </Button>
              <Button as={Link} to={tenantPath('/login')}
                variant="flat"
                className="w-full bg-theme-elevated text-theme-primary"
                startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
              >
                {t('forgot_password.back_to_login')}
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PageMeta title={t('page_meta.forgot_password.title')} noIndex />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
      >
        {/* Back to login */}
        <Link
          to={tenantPath('/login')}
          className="flex items-center gap-2 text-theme-muted hover:text-theme-primary transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          {t('forgot_password.back_to_login')}
        </Link>

        <GlassCard className="p-5 sm:p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('forgot_password.page_title')}</h1>
            <p className="text-theme-muted">
              {t('forgot_password.page_subtitle')}
            </p>
          </div>

          {submitError && (
            <div
              role="alert"
              className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-theme-danger"
            >
              {submitError}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} aria-label={t('forgot_password.title')} className="space-y-6">
            <Input
              type="email"
              label={t('forgot_password.email_address_label')}
              placeholder={t('forgot_password.email_placeholder')}
              value={email}
              onChange={(e) => { setEmail(e.target.value); setSubmitError(null); }}
              startContent={<Mail className="w-4 h-4 text-theme-subtle" />}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
              isRequired
              autoComplete="email"
            />

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              isLoading={isLoading}
              isDisabled={!email.trim()}
            >
              {t('forgot_password.send_button')}
            </Button>
          </form>

          {/* Footer */}
          <div className="mt-6 text-center text-sm text-theme-subtle">
            {t('forgot_password.remember_password')}{' '}
            <Link to={tenantPath('/login')} className="text-accent dark:text-accent hover:underline">
              {t('forgot_password.sign_in_link')}
            </Link>
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

export default ForgotPasswordPage;
