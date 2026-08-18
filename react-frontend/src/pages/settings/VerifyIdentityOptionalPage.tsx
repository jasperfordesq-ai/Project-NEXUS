// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VerifyIdentityOptionalPage — Voluntary identity verification for active members.
 *
 * Flow: DOB collection → Payment (if fee > 0) → Stripe Identity → Badge granted.
 * Payment is one-time per tenant. Retries after failure skip DOB and payment steps.
 */

import { lazy, Suspense, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldX from 'lucide-react/icons/shield-x';
import Fingerprint from 'lucide-react/icons/fingerprint';
import ExternalLink from 'lucide-react/icons/external-link';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import BadgeCheck from 'lucide-react/icons/badge-check';
import CalendarDays from 'lucide-react/icons/calendar-days';
import CreditCard from 'lucide-react/icons/credit-card';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';

const StripePaymentForm = lazy(() =>
  import('@/components/donations/StripePaymentForm').then((module) => ({ default: module.StripePaymentForm }))
);

interface VerificationStatusResponse {
  has_id_verified_badge: boolean;
  user_has_dob: boolean;
  fee_cents: number;
  fee_currency: string;
  payment_completed: boolean;
  verification_status: string | null;
  latest_session: {
    id: number;
    status: string;
    provider: string | null;
    created_at: string;
    failure_reason: string | null;
  } | null;
}

interface StartVerificationResponse {
  session_id?: number;
  redirect_url?: string | null;
  client_token?: string | null;
  provider?: string;
  expires_at?: string | null;
  status?: string;
  already_verified?: boolean;
}


type PageState = 'loading' | 'dob_collection' | 'payment_required' | 'start' | 'in_progress' | 'verified' | 'failed' | 'error';

export function VerifyIdentityOptionalPage() {
  const { t } = useTranslation('settings');
  usePageTitle(t('identity.page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [feeCents, setFeeCents] = useState(0);
  const [feeCurrency, setFeeCurrency] = useState('EUR');
  const [dob, setDob] = useState('');
  const [isSavingDob, setIsSavingDob] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userStartedRef = useRef(false);

  const feeFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: feeCurrency,
      }),
    [feeCurrency]
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const response = await api.get<VerificationStatusResponse>('/v2/identity/status');
      if (!response.success || !response.data) return;

      const data = response.data;
      setFeeCents(data.fee_cents || 0);
      setFeeCurrency(data.fee_currency || 'EUR');

      if (data.has_id_verified_badge) {
        setPageState('verified');
        stopPolling();
        return;
      }

      const sessionStatus = data.latest_session?.status;
      if (sessionStatus === 'passed') {
        setPageState('verified');
        stopPolling();
      } else if (sessionStatus === 'started' || sessionStatus === 'processing') {
        setPageState('in_progress');
      } else if (sessionStatus === 'created') {
        if (userStartedRef.current) {
          setPageState('in_progress');
        } else {
          setPageState('start');
        }
      } else if (sessionStatus === 'failed') {
        setFailureReason(data.latest_session?.failure_reason || null);
        setPageState('failed');
        stopPolling();
      } else {
        // No active session — check prerequisites
        if (!data.user_has_dob) {
          setPageState('dob_collection');
        } else if (data.fee_cents > 0 && !data.payment_completed) {
          setPageState('payment_required');
        } else {
          setPageState('start');
        }
      }
    } catch {
      setPageState('error');
      setErrorMessage(t('identity.error_check_status'));
    }
  }, [stopPolling, t]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(fetchStatus, 5000);
  }, [fetchStatus, stopPolling]);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchStatus();
    return stopPolling;
  }, [isAuthenticated, fetchStatus, stopPolling]);

  // ─── Handlers ──────────────────────────────────────────────────────

  const handleSaveDob = async () => {
    if (!dob) { setErrorMessage(t('identity.error_missing_dob')); return; }
    setIsSavingDob(true);
    setErrorMessage('');
    try {
      const response = await api.post('/v2/identity/save-dob', { date_of_birth: dob });
      if (!response.success) {
        setErrorMessage(response.error || t('identity.error_save_dob'));
        return;
      }
      // Re-fetch status to advance to next step
      await fetchStatus();
    } catch {
      setErrorMessage(t('identity.error_save_dob'));
    } finally {
      setIsSavingDob(false);
    }
  };

  const handleCreatePayment = async () => {
    setIsCreatingPayment(true);
    setErrorMessage('');
    try {
      const response = await api.post<{ client_secret?: string; already_paid?: boolean; payment_required?: boolean }>('/v2/identity/create-payment');
      if (response.success) {
        if (response.data?.already_paid || response.data?.payment_required === false) {
          await fetchStatus(); // Already paid, skip to next step
          return;
        }
        if (response.data?.client_secret) {
          setClientSecret(response.data.client_secret);
        }
      } else {
        setErrorMessage(response.error || t('identity.error_create_payment'));
      }
    } catch {
      setErrorMessage(t('identity.error_create_payment'));
    } finally {
      setIsCreatingPayment(false);
    }
  };

  const handlePaymentSuccess = () => {
    setClientSecret(null);
    // Re-fetch status — payment_completed will now be true
    fetchStatus();
  };

  const handlePaymentError = (error: string) => {
    setErrorMessage(error);
  };

  const handleStartVerification = async () => {
    setIsStarting(true);
    setErrorMessage('');
    userStartedRef.current = true;
    try {
      const response = await api.post<StartVerificationResponse>('/v2/identity/start');
      if (!response.success) {
        if (response.code === 'DOB_REQUIRED') { setPageState('dob_collection'); return; }
        if (response.code === 'PAYMENT_REQUIRED') { setPageState('payment_required'); return; }
        setErrorMessage(response.error || t('identity.error_start_verification'));
        userStartedRef.current = false;
        return;
      }
      if (response.data) {
        if (response.data.already_verified) { setPageState('verified'); return; }
        if (response.data.redirect_url) {
          setRedirectUrl(response.data.redirect_url);
          setPageState('in_progress');
          startPolling();
          window.open(response.data.redirect_url, '_blank', 'noopener,noreferrer');
        } else {
          setPageState('in_progress');
          startPolling();
        }
      }
    } catch {
      setErrorMessage(t('identity.error_start_verification'));
    } finally {
      setIsStarting(false);
    }
  };

  // ─── Render ────────────────────────────────────────────────────────

  if (!isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <GlassCard className="p-8 text-center max-w-md">
          <p className="text-theme-muted mb-4">{t('identity_auth.please_login')}</p>
          <Button as={Link} to={tenantPath('/login')}>{t('identity_auth.go_to_login')}</Button>
        </GlassCard>
      </div>
    );
  }

  if (pageState === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="min-h-[60vh] flex items-center justify-center p-4">
        <PageMeta title={t('identity.page_title')} noIndex />
        <GlassCard className="p-8 text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <Spinner size="lg" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold text-theme-primary">{t('identity.loading_title')}</h1>
        </GlassCard>
      </div>
    );
  }

  if (pageState === 'verified') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <PageMeta title={t('identity.page_title_verified')} noIndex />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <BadgeCheck className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('identity.verified_title')}</h1>
            <p className="text-theme-muted mb-2">{t('identity.verified_body')}</p>
            <div className="flex items-center justify-center gap-2 mt-4 mb-6 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{t('identity.verified_badge_label')}</span>
            </div>
            <div className="flex flex-col gap-3">
              <Button className="w-full" onPress={() => navigate(tenantPath('/settings'))}>{t('identity.go_to_settings')}</Button>
              <Button variant="tertiary" className="w-full" startContent={<ArrowLeft className="w-4 h-4" />} onPress={() => navigate(tenantPath('/dashboard'))}>{t('identity.back_to_dashboard')}</Button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  if (pageState === 'failed') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <PageMeta title={t('identity.page_title_failed')} noIndex />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <ShieldX className="w-8 h-8 text-red-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('identity.failed_title')}</h1>
            <p className="text-theme-muted mb-2">{t('identity.failed_body')}</p>
            {failureReason && <p className="text-red-700 dark:text-red-400 text-sm mb-4">{failureReason}</p>}
            <p className="text-theme-subtle text-sm mb-6">{t('identity.failed_hint')}</p>
            <div className="flex flex-col gap-3">
              <Button onPress={handleStartVerification} isLoading={isStarting} className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white" startContent={!isStarting ? <RefreshCw className="w-4 h-4" /> : undefined}>{t('identity.try_again')}</Button>
              <Button variant="tertiary" className="w-full" startContent={<ArrowLeft className="w-4 h-4" />} onPress={() => navigate(tenantPath('/dashboard'))}>{t('identity.back_to_dashboard')}</Button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  if (pageState === 'error') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <PageMeta title={t('identity.page_title')} noIndex />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <ShieldX className="w-8 h-8 text-red-400" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">{t('identity.error_title')}</h1>
            <p className="text-theme-muted mb-6">{errorMessage}</p>
            <Button onPress={() => { setPageState('loading'); fetchStatus(); }} className="w-full bg-gradient-to-r from-accent to-accent-gradient-end text-white" startContent={<RefreshCw className="w-4 h-4" />}>{t('identity.try_again')}</Button>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // ─── DOB Collection ────────────────────────────────────────────────

  if (pageState === 'dob_collection') {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <PageMeta title={t('identity.page_title_dob')} noIndex />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-5 sm:p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-4">
                <CalendarDays className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">{t('identity.dob_title')}</h1>
              <p className="text-theme-muted mt-2">{t('identity.dob_body')}</p>
              <p className="text-xs text-theme-subtle mt-1">{t('identity.step_indicator', { current: 1, total: feeCents > 0 ? 3 : 2 })}</p>
            </div>

            {errorMessage && (
              <div role="alert" className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-700 dark:text-red-400">{errorMessage}</div>
            )}

            <div className="space-y-4">
              <Input
                type="date"
                label={t('identity.dob_label')}
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                variant="secondary"
                max={new Date().toISOString().split('T')[0]}
                classNames={{ label: 'text-theme-primary' }} />

              <Button
                onPress={handleSaveDob}
                isLoading={isSavingDob}
                className="w-full bg-gradient-to-r from-accent to-emerald-600 text-white font-medium"
                size="lg"
                isDisabled={!dob}
              >
                {t('identity.continue')}
              </Button>

              <Button variant="tertiary" className="w-full" startContent={<ArrowLeft className="w-4 h-4" />} onPress={() => navigate(tenantPath('/dashboard'))}>{t('identity.maybe_later')}</Button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // ─── Payment Required ──────────────────────────────────────────────

  if (pageState === 'payment_required') {
    const feeDisplay = feeFormatter.format(feeCents / 100);

    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <PageMeta title={t('identity.page_title_payment')} noIndex />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-5 sm:p-8">
            <div className="text-center mb-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-4">
                <CreditCard className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">{t('identity.fee_title')}</h1>
              <p className="text-theme-muted mt-2">{t('identity.fee_body', { fee: feeDisplay })}</p>
              <p className="text-xs text-theme-subtle mt-1">{t('identity.step_indicator', { current: 2, total: 3 })}</p>
            </div>

            {errorMessage && (
              <div role="alert" className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-700 dark:text-red-400">{errorMessage}</div>
            )}

            {!clientSecret ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-accent/5 border border-accent/10 text-center">
                  <p className="text-3xl font-bold text-theme-primary">{feeDisplay}</p>
                  <p className="text-xs text-theme-muted mt-1">{t('identity.fee_one_time_label')}</p>
                </div>

                <Button
                  onPress={handleCreatePayment}
                  isLoading={isCreatingPayment}
                  className="w-full bg-gradient-to-r from-accent to-emerald-600 text-white font-medium"
                  size="lg"
                  startContent={!isCreatingPayment ? <CreditCard className="w-5 h-5" aria-hidden="true" /> : undefined}
                >
                  {t('identity.pay_button', { fee: feeDisplay })}
                </Button>

                <Button variant="tertiary" className="w-full" startContent={<ArrowLeft className="w-4 h-4" />} onPress={() => navigate(tenantPath('/dashboard'))}>{t('identity.maybe_later')}</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <Suspense fallback={null}>
                  <StripePaymentForm
                    clientSecret={clientSecret}
                    onSuccess={handlePaymentSuccess}
                    onError={handlePaymentError} />
                </Suspense>
              </div>
            )}
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // ─── Start / In-progress ───────────────────────────────────────────

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-4">
      <PageMeta title={t('identity.page_title')} noIndex />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <GlassCard className="p-5 sm:p-8">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-emerald-500/20 mb-4"
            >
              {pageState === 'in_progress' ? (
                <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="lg" color="accent" /></div>
              ) : (
                <Fingerprint className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              )}
            </motion.div>
            <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">
              {pageState === 'in_progress' ? t('identity.in_progress_title') : t('identity.start_title')}
            </h1>
            <p className="text-theme-muted mt-2">
              {pageState === 'in_progress' ? t('identity.in_progress_body') : t('identity.start_body')}
            </p>
            {pageState === 'start' && (
              <p className="text-xs text-theme-subtle mt-1">{t('identity.step_indicator', { current: feeCents > 0 ? 3 : 2, total: feeCents > 0 ? 3 : 2 })}</p>
            )}
          </div>

          {errorMessage && (
            <motion.div role="alert" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-700 dark:text-red-400">{errorMessage}</motion.div>
          )}

          {pageState === 'start' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10">
                <h3 className="font-medium text-theme-primary text-sm mb-2">{t('identity.what_needed_title')}</h3>
                <ul className="list-disc space-y-1 pl-5 text-sm text-theme-muted">
                  <li>{t('identity.need_document')}</li>
                  <li>{t('identity.need_camera')}</li>
                  <li>{t('identity.need_minutes')}</li>
                </ul>
              </div>

              <Button
                onPress={handleStartVerification}
                isLoading={isStarting}
                className="w-full bg-gradient-to-r from-accent to-emerald-600 text-white font-medium"
                size="lg"
                startContent={!isStarting ? <ShieldCheck className="w-5 h-5" aria-hidden="true" /> : undefined}
                spinner={<Spinner size="sm" />}
              >
                {t('identity.start_button')}
              </Button>

              <Button variant="tertiary" className="w-full" startContent={<ArrowLeft className="w-4 h-4" />} onPress={() => navigate(tenantPath('/dashboard'))}>{t('identity.maybe_later')}</Button>
            </div>
          )}

          {pageState === 'in_progress' && (
            <div className="space-y-4">
              {redirectUrl && (
                <Button as="a" href={redirectUrl} target="_blank" rel="noopener noreferrer" variant="outline" className="w-full border-accent/30 text-theme-primary hover:bg-accent/10" size="lg" startContent={<ExternalLink className="w-4 h-4" />}>
                  {t('identity.open_window')}
                </Button>
              )}

              <div className="flex items-center justify-center gap-2 text-sm text-theme-muted">
                <Spinner size="sm" aria-hidden="true" />
                {t('identity.waiting')}
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <Button variant="tertiary" size="sm" className="w-full text-theme-muted" onPress={() => { stopPolling(); setPageState('start'); setRedirectUrl(null); userStartedRef.current = false; }}>{t('identity.cancel_start_over')}</Button>
                <Button variant="tertiary" size="sm" className="w-full text-theme-subtle" startContent={<ArrowLeft className="w-3.5 h-3.5" />} onPress={() => navigate(tenantPath('/dashboard'))}>{t('identity.back_to_dashboard')}</Button>
              </div>
            </div>
          )}
        </GlassCard>
      </motion.div>
    </div>
  );
}

export default VerifyIdentityOptionalPage;
