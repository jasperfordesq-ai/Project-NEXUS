// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * StripeOnboardingPage — Stripe Connect onboarding flow for marketplace sellers.
 *
 * Flow:
 *   1. Explain what Stripe Connect is and what sellers need
 *   2. "Start Onboarding" button → POST /v2/marketplace/seller/onboard → redirect to Stripe
 *   3. Return page checks status via GET /v2/marketplace/seller/onboard/status
 *   4. Shows success or retry UI based on onboarding completion
 *
 * Auth required.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';import CreditCard from 'lucide-react/icons/credit-card';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Building2 from 'lucide-react/icons/building-2';
import Shield from 'lucide-react/icons/shield';
import ArrowRight from 'lucide-react/icons/arrow-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { useLoginRedirect } from '@/hooks/useLoginRedirect';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface OnboardingStatus {
  stripe_onboarding_complete: boolean;
  stripe_account_id?: string;
  charges_enabled?: boolean;
  payouts_enabled?: boolean;
  details_submitted?: boolean;
}

interface OnboardingResponse {
  url: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function StripeOnboardingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('onboarding.page_title'));
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const { loginTarget } = useLoginRedirect(tenantPath);
  const toast = useToast();

  // State
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  // Did Stripe just redirect back?
  const isReturn = searchParams.get('return') === '1' || searchParams.get('complete') === '1' || searchParams.get('refresh') === '1';

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      const login = loginTarget();
      navigate(login.to, { replace: true, state: login.state });
    }
  }, [isAuthenticated, navigate, loginTarget]);

  // Load onboarding status
  const loadStatus = useCallback(async () => {
    setIsLoadingStatus(true);
    try {
      const response = await api.get<OnboardingStatus>('/v2/marketplace/seller/onboard/status');
      if (response.success && response.data) {
        setStatus(response.data);
      }
    } catch (err) {
      logError('Failed to load Stripe onboarding status', err);
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    loadStatus();
  }, [isAuthenticated, loadStatus]);

  // Show toast if returning from Stripe
  useEffect(() => {
    if (isReturn && status) {
      if (status.stripe_onboarding_complete) {
        toast.success(t('onboarding.complete_toast'));
      }
    }
  }, [isReturn, status?.stripe_onboarding_complete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start onboarding
  const handleStartOnboarding = useCallback(async () => {
    setIsStarting(true);
    try {
      const response = await api.post<OnboardingResponse>('/v2/marketplace/seller/onboard');
      if (response.success && response.data?.url) {
        window.location.href = response.data.url;
        return;
      }
      toast.error(response.error || t('onboarding.start_error'));
    } catch (err) {
      logError('Failed to start Stripe onboarding', err);
      toast.error(t('onboarding.start_error'));
    } finally {
      setIsStarting(false);
    }
  }, [toast, t])

  if (!isAuthenticated) return null;

  // Loading
  if (isLoadingStatus) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-24">
        <Spinner size="lg" color="accent" />
      </div>
    );
  }

  const isComplete = status?.stripe_onboarding_complete === true;
  const isIncomplete = status && !status.stripe_onboarding_complete && status.stripe_account_id;

  return (
    <>
      <PageMeta
        title={t('onboarding.page_title')}
        description={t('onboarding.subtitle')}
        noIndex
      />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 mb-2">
            <CreditCard className="w-8 h-8 text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            {t('onboarding.title')}
          </h1>
          <p className="text-muted text-sm max-w-md mx-auto">
            {t('onboarding.subtitle')}
          </p>
        </div>

        {/* Success State */}
        {isComplete && (
          <GlassCard className="p-6 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-success/10">
              <CheckCircle2 className="w-7 h-7 text-success" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t('onboarding.complete_title')}
              </h2>
              <p className="text-muted text-sm mt-1">
                {t('onboarding.complete_description')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              {status?.charges_enabled && (
                <Chip size="sm" color="success" variant="soft">
                  {t('onboarding.charges_enabled')}
                </Chip>
              )}
              {status?.payouts_enabled && (
                <Chip size="sm" color="success" variant="soft">
                  {t('onboarding.payouts_enabled')}
                </Chip>
              )}
            </div>
            <Button

              variant="tertiary"
              onPress={() => navigate(tenantPath('/marketplace/my-listings'))}
            >
              {t('onboarding.go_to_listings')}
            </Button>
          </GlassCard>
        )}

        {/* Incomplete State (returned from Stripe without finishing) */}
        {isIncomplete && (
          <GlassCard className="p-6 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-warning/10">
              <AlertCircle className="w-7 h-7 text-warning" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                {t('onboarding.incomplete_title')}
              </h2>
              <p className="text-muted text-sm mt-1">
                {t('onboarding.incomplete_description')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button

                onPress={handleStartOnboarding}
                isLoading={isStarting}
                startContent={!isStarting ? <RefreshCw className="w-4 h-4" /> : undefined}
              >
                {t('onboarding.continue_onboarding')}
              </Button>
              <Button
                variant="tertiary"
                onPress={loadStatus}
                startContent={<RefreshCw className="w-4 h-4" />}
              >
                {t('onboarding.check_status')}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Initial State (no Stripe account yet) */}
        {!isComplete && !isIncomplete && (
          <>
            {/* What is Stripe Connect */}
            <GlassCard className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('onboarding.what_is_stripe_title')}
              </h2>
              <p className="text-sm text-muted">
                {t('onboarding.what_is_stripe_description')}
              </p>
            </GlassCard>

            {/* What you need */}
            <GlassCard className="p-6 space-y-4">
              <h2 className="text-lg font-semibold text-foreground">
                {t('onboarding.what_you_need_title')}
              </h2>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('onboarding.need_bank')}
                    </p>
                    <p className="text-xs text-muted">
                      {t('onboarding.need_bank_desc')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Shield className="w-4 h-4 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {t('onboarding.need_id')}
                    </p>
                    <p className="text-xs text-muted">
                      {t('onboarding.need_id_desc')}
                    </p>
                  </div>
                </div>
              </div>
            </GlassCard>

            {/* Start button */}
            <div className="flex justify-center">
              <Button

                size="lg"
                onPress={handleStartOnboarding}
                isLoading={isStarting}
                endContent={!isStarting ? <ArrowRight className="w-5 h-5" /> : undefined}
                className="min-w-[240px]"
              >
                {t('onboarding.start_button')}
              </Button>
            </div>

            {/* Security note */}
            <p className="text-center text-xs text-muted">
              {t('onboarding.security_note')}
            </p>
          </>
        )}
      </div>
    </>
  );
}

export default StripeOnboardingPage;
