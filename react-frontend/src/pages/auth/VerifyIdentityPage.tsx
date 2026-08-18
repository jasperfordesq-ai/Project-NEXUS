// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Verify Identity Page — Guides users through identity verification.
 *
 * Flow:
 * 1. On mount, polls /api/v2/auth/verification-status
 * 2. If status is 'pending_verification' and no active session → shows "Start Verification"
 * 3. If a session exists with a redirect_url → shows "Continue to Verification"
 * 4. Polls periodically until status changes to passed/failed/active
 * 5. Shows appropriate success/failure states
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from '@/lib/motion';import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldX from 'lucide-react/icons/shield-x';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ExternalLink from 'lucide-react/icons/external-link';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { PageMeta } from '@/components/seo/PageMeta';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';

interface VerificationStatus {
  status: string;
  email_verified: boolean;
  is_approved: boolean;
  verification_status: string;
  verification_provider: string | null;
  registration_mode: string;
  latest_session: {
    id: number;
    status: string;
    provider: string;
    created_at: string;
    completed_at: string | null;
    failure_reason: string | null;
  } | null;
}

interface StartVerificationResult {
  session_id: number;
  redirect_url: string | null;
  client_token: string | null;
  provider: string;
  expires_at: string | null;
  status: string;
}

type PageState = 'loading' | 'start' | 'in_progress' | 'passed' | 'failed' | 'active' | 'error';

const MAX_POLL_MS = 10 * 60 * 1000;

// Exponential backoff: 5s, 7.5s, 11s, 17s, 25s, capped at 30s.
const nextPollDelayMs = (attempt: number) =>
  Math.min(30_000, Math.round(5_000 * Math.pow(1.5, attempt)));

export function VerifyIdentityPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('page_meta.verify_identity.title'));
  const navigate = useNavigate();
  const { branding, tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();

  const [pageState, setPageState] = useState<PageState>('loading');
  const [verificationData, setVerificationData] = useState<VerificationStatus | null>(null);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollStartRef = useRef<number>(Date.now());
  const pollAttemptRef = useRef<number>(0);

  // Stable refs for t — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;

  const pageMeta = (
    <PageMeta
      title={t('page_meta.verify_identity.title')}
      description={t('page_meta.verify_identity.description')}
      noIndex />
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    if (Date.now() - pollStartRef.current > MAX_POLL_MS) {
      stopPolling();
      setPageState('error');
      setErrorMessage(tRef.current('verify_identity.timeout_error'));
      return;
    }
    try {
      const response = await api.get<VerificationStatus>('/v2/auth/verification-status');
      if (!response.success || !response.data) return;

      const data = response.data;
      setVerificationData(data);

      switch (data.status) {
        case 'active':
          setPageState('active');
          stopPolling();
          break;
        case 'pending_verification':
          if (data.latest_session?.status === 'started' || data.latest_session?.status === 'processing') {
            setPageState('in_progress');
          } else {
            setPageState('start');
          }
          break;
        case 'verification_failed':
          setPageState('failed');
          stopPolling();
          break;
        case 'pending_admin_review':
          setPageState('passed');
          stopPolling();
          break;
        default:
          // If verification_status is 'passed' but waiting for admin
          if (data.verification_status === 'passed') {
            setPageState('passed');
            stopPolling();
          } else if (data.verification_status === 'none' && data.registration_mode !== 'verified_identity' && data.registration_mode !== 'government_id') {
            // Not a verification tenant — redirect to dashboard
            navigate(tenantPath('/dashboard'), { replace: true });
          } else {
            setPageState('start');
          }
      }
    } catch {
      setPageState('error');
      setErrorMessage(tRef.current('verify_identity.fetch_error'));
    }
  }, [navigate, tenantPath, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollStartRef.current = Date.now();
    pollAttemptRef.current = 0;
    const tick = () => {
      void fetchStatus().finally(() => {
        if (pollRef.current === null && pollStartRef.current === 0) return;
        const delay = nextPollDelayMs(pollAttemptRef.current++);
        pollRef.current = setTimeout(tick, delay);
      });
    };
    pollRef.current = setTimeout(tick, nextPollDelayMs(0));
  }, [fetchStatus, stopPolling]);

  // Initial fetch + polling
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchStatus();
    startPolling();
    return stopPolling;
  }, [isAuthenticated, fetchStatus, startPolling, stopPolling]);

  const handleStartVerification = async () => {
    setIsStarting(true);
    setErrorMessage('');
    try {
      const response = await api.post<StartVerificationResult>('/v2/auth/start-verification');
      if (response.success && response.data) {
        if (response.data.redirect_url) {
          setRedirectUrl(response.data.redirect_url);
          setPageState('in_progress');
          startPolling();
          // Open in new tab
          window.open(response.data.redirect_url, '_blank', 'noopener,noreferrer');
        } else {
          // No redirect — poll for status
          setPageState('in_progress');
          startPolling();
        }
      }
    } catch {
      setErrorMessage(tRef.current('verify_identity.start_error'));
    } finally {
      setIsStarting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <GlassCard className="p-8 text-center max-w-md">
          <p className="text-theme-muted mb-4">
            {t('verify_identity.login_required')}
          </p>
          <Button as={Link} to={tenantPath('/login')} color="primary">
            {t('verify_identity.go_to_login')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  // Loading state
  if (pageState === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        {pageMeta}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent/10 flex items-center justify-center">
              <Spinner size="lg" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">
              {t('verify_identity.loading_title')}
            </h1>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  // Active / already verified
  if (pageState === 'active') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">
              {t('verify_identity.active_title')}
            </h1>
            <p className="text-theme-muted mb-6">
              {t('verify_identity.active_subtitle')}
            </p>
            <Button as={Link} to={tenantPath('/dashboard')} color="primary" className="w-full">
              {t('verify_identity.go_to_dashboard')}
            </Button>
          </GlassCard>
          <p className="text-center text-theme-subtle text-sm mt-6">{branding.name}</p>
        </motion.div>
      </div>
    );
  }

  // Verification passed — pending admin review
  if (pageState === 'passed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="w-8 h-8 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">
              {t('verify_identity.passed_title')}
            </h1>
            <p className="text-theme-muted mb-4">
              {t('verify_identity.passed_subtitle')}
            </p>
            {verificationData && !verificationData.is_approved && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-left mb-6">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-[var(--color-warning)] shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-theme-warning">
                      {t('verify_identity.pending_approval_title')}
                    </p>
                    <p className="text-amber-600/80 dark:text-amber-300/80 mt-1">
                      {t('verify_identity.pending_approval_body')}
                    </p>
                  </div>
                </div>
              </div>
            )}
            <Button as={Link} to={tenantPath('/login')} variant="flat" className="w-full bg-theme-elevated text-theme-primary" startContent={<ArrowLeft className="w-4 h-4" />}>
              {t('verify_identity.back_to_login')}
            </Button>
          </GlassCard>
          <p className="text-center text-theme-subtle text-sm mt-6">{branding.name}</p>
        </motion.div>
      </div>
    );
  }

  // Verification failed
  if (pageState === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <ShieldX className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">
              {t('verify_identity.failed_title')}
            </h1>
            <p className="text-theme-muted mb-2">
              {t('verify_identity.failed_subtitle')}
            </p>
            {verificationData?.latest_session?.failure_reason && (
              <p className="text-theme-danger text-sm mb-6">
                {verificationData.latest_session.failure_reason}
              </p>
            )}
            <div className="flex flex-col gap-3">
              <Button
                onPress={handleStartVerification}
                isLoading={isStarting}
                color="primary"
                className="w-full"
                startContent={!isStarting ? <RefreshCw className="w-4 h-4" /> : undefined}
              >
                {t('verify_identity.retry')}
              </Button>
              <Button as={Link} to={tenantPath('/login')} variant="flat" className="w-full bg-theme-elevated text-theme-primary" startContent={<ArrowLeft className="w-4 h-4" />}>
                {t('verify_identity.back_to_login')}
              </Button>
            </div>
          </GlassCard>
          <p className="text-center text-theme-subtle text-sm mt-6">{branding.name}</p>
        </motion.div>
      </div>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
          <GlassCard className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-500/20 flex items-center justify-center">
              <ShieldX className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary mb-2">
              {t('verify_identity.error_title')}
            </h1>
            <p className="text-theme-muted mb-6">{errorMessage}</p>
            <Button
              onPress={() => { setPageState('loading'); fetchStatus(); }}
              color="primary"
              className="w-full"
              startContent={<RefreshCw className="w-4 h-4" />}
            >
              {t('verify_identity.retry')}
            </Button>
          </GlassCard>
          <p className="text-center text-theme-subtle text-sm mt-6">{branding.name}</p>
        </motion.div>
      </div>
    );
  }

  // Start / In-progress states
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md relative z-10">
        <GlassCard className="p-5 sm:p-8">
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-4"
            >
              {pageState === 'in_progress' ? (
                <div role="status" aria-busy="true" aria-label={t('common:loading')} className="flex justify-center py-4"><Spinner size="lg" color="secondary" /></div>
              ) : (
                <ShieldAlert className="w-8 h-8 text-accent" />
              )}
            </motion.div>
            <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">
              {pageState === 'in_progress'
                ? t('verify_identity.in_progress_title')
                : t('verify_identity.start_title')}
            </h1>
            <p className="text-theme-muted mt-2">
              {pageState === 'in_progress'
                ? t('verify_identity.in_progress_subtitle')
                : t('verify_identity.start_subtitle')}
            </p>
          </div>

          {errorMessage && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-theme-danger"
            >
              {errorMessage}
            </motion.div>
          )}

          {pageState === 'start' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-accent/5 border border-accent/10">
                <h3 className="font-medium text-theme-primary text-sm mb-2">
                  {t('verify_identity.what_needed_title')}
                </h3>
                <ul className="list-disc pl-5 text-sm text-theme-muted space-y-1">
                  <li>{t('verify_identity.need_document')}</li>
                  <li>{t('verify_identity.need_camera')}</li>
                  <li>{t('verify_identity.need_minutes')}</li>
                </ul>
              </div>

              <Button
                onPress={handleStartVerification}
                isLoading={isStarting}
                color="primary"
                className="w-full font-medium"
                size="lg"
                startContent={!isStarting ? <ShieldCheck className="w-5 h-5" /> : undefined}
                spinner={<Spinner size="sm" />}
              >
                {t('verify_identity.start_button')}
              </Button>
            </div>
          )}

          {pageState === 'in_progress' && (
            <div className="space-y-4">
              {redirectUrl && (
                <Button
                  as="a"
                  href={redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="bordered"
                  color="primary"
                  className="w-full"
                  size="lg"
                  startContent={<ExternalLink className="w-4 h-4" />}
                >
                  {t('verify_identity.open_verification')}
                </Button>
              )}

              <div className="flex items-center justify-center gap-2 text-sm text-theme-muted">
                <Spinner size="sm" />
                {t('verify_identity.waiting')}
              </div>
            </div>
          )}

          <div className="mt-6 text-center">
            <Link
              to={tenantPath('/login')}
              className="inline-flex items-center gap-2 text-theme-subtle hover:text-theme-secondary text-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('verify_identity.back_to_login')}
            </Link>
          </div>
        </GlassCard>
        <p className="text-center text-theme-subtle text-sm mt-6">{branding.name}</p>
      </motion.div>
    </div>
  );
}

export default VerifyIdentityPage;
