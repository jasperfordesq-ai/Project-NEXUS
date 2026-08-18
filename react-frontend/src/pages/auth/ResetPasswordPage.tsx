// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reset Password Page - Set new password with token
 */

import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';import Lock from 'lucide-react/icons/lock';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { PageMeta } from '@/components/seo/PageMeta';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';
import { usePasswordCheck } from '@/hooks/usePasswordCheck';
import { PasswordStrength } from '@/components/auth/PasswordStrength';

export function ResetPasswordPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('reset_password.page_title'));
  const { branding, tenantPath } = useTenant();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState('');
  // Live password check — length + HIBP breach lookup.
  const passwordCheck = usePasswordCheck(password);
  // Track whether the confirm-password field has been blurred so we only
  // show the mismatch error after the user has left the field (onBlur pattern).
  const [confirmTouched, setConfirmTouched] = useState(false);

  // Validate token exists
  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PageMeta title={t('page_meta.reset_password.title')} noIndex />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard className="p-5 text-center sm:p-8">
            <h1 className="text-2xl font-bold text-theme-primary mb-4">{t('reset_password.invalid_title')}</h1>
            <p className="text-theme-muted mb-6">
              {t('reset_password.invalid_message')}
            </p>
            <Button as={Link} to={tenantPath('/password/forgot')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
              {t('reset_password.request_new_link')}
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validation — length + HIBP breach check via usePasswordCheck.
    if (!passwordCheck.isAcceptable) {
      setError(passwordCheck.message);
      return;
    }
    if (password !== confirmPassword) {
      setError(t('reset_password.passwords_no_match'));
      return;
    }

    try {
      setIsLoading(true);
      const response = await api.post('/auth/reset-password', {
        token,
        password,
        password_confirmation: confirmPassword,
      });
      if (response.success) {
        setIsSuccess(true);
      } else {
        setError(response.error || t('reset_password.link_expired_error'));
      }
    } catch {
      setError(t('reset_password.link_expired_error'));
    } finally {
      setIsLoading(false);
    }
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <PageMeta title={t('page_meta.reset_password.title')} noIndex />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md"
        >
          <GlassCard className="p-5 text-center sm:p-8">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('reset_password.success_title')}</h1>
            <p className="text-theme-muted mb-6">
              {t('reset_password.success_message')}
            </p>
            <Button as={Link} to={tenantPath('/login')} className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white">
              {t('reset_password.sign_in')}
            </Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <PageMeta title={t('page_meta.reset_password.title')} noIndex />
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
          {t('reset_password.back_to_login')}
        </Link>

        <GlassCard className="p-5 sm:p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('reset_password.page_title')}</h1>
            <p className="text-theme-muted">
              {t('reset_password.page_subtitle')}
            </p>
          </div>

          {/* Error */}
          {error && (
            <div role="alert" className="p-3 mb-6 rounded-lg bg-red-500/20 border border-red-500/30 text-theme-danger text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} aria-label={t('reset_password.title')} className="space-y-6">
            <div>
              <Input
                type={showPassword ? 'text' : 'password'}
                label={t('reset_password.new_password_label')}
                placeholder={t('reset_password.new_password_placeholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                startContent={<Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                endContent={
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    className="min-h-8 min-w-8 p-0 text-theme-subtle"
                    onPress={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? t('reset_password.hide_password') : t('reset_password.show_password')}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                  </Button>
                }
                classNames={{
                  input: 'bg-transparent text-theme-primary',
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
                isRequired
                autoComplete="new-password"
              />
              {/* Password strength — length + HIBP breach check */}
              <div className="mt-2">
                <PasswordStrength state={passwordCheck} />
              </div>
            </div>

            <Input
              type={showPassword ? 'text' : 'password'}
              label={t('reset_password.confirm_label')}
              placeholder={t('reset_password.confirm_placeholder')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => setConfirmTouched(true)}
              startContent={<Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              isInvalid={confirmTouched && confirmPassword.length > 0 && password !== confirmPassword}
              errorMessage={confirmTouched && confirmPassword.length > 0 && password !== confirmPassword ? t('reset_password.passwords_no_match') : ''}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
                label: 'text-theme-muted',
              }}
              isRequired
              autoComplete="new-password"
            />

            <Button
              type="submit"
              className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              isLoading={isLoading}
              isDisabled={!password || !confirmPassword}
            >
              {t('reset_password.submit')}
            </Button>
          </form>
        </GlassCard>

        {/* Branding */}
        <p className="text-center text-theme-subtle text-sm mt-6">
          {branding.name}
        </p>
      </motion.div>
    </div>
  );
}

export default ResetPasswordPage;
