// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Protected Route Component
 * Redirects to login if user is not authenticated.
 * Preserves tenant slug prefix in the redirect URL.
 */

import { lazy, Suspense } from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { LoadingScreen } from '@/components/feedback/LoadingScreen';
import { Button } from '@/components/ui/Button';
import { useLegalGate } from '@/hooks/useLegalGate';

const LegalAcceptanceGate = lazy(() =>
  import('@/components/legal/LegalAcceptanceGate').then((module) => ({ default: module.LegalAcceptanceGate }))
);

interface ProtectedRouteProps {
  children?: React.ReactNode;
}

/** Path segments that must never be blocked by the legal gate */
const LEGAL_GATE_BYPASS_SEGMENTS = new Set([
  'terms', 'privacy', 'cookies', 'accessibility',
  'community-guidelines', 'acceptable-use', 'account-deletion', 'child-safety',
  'legal', 'onboarding', 'platform',
  // 🔴 Version history and comparison. This check reads only the LAST path
  // segment, so /terms/versions had a last segment of "versions" and was blocked
  // — meaning a member facing the gate could not read what had changed before
  // agreeing to it. Missing these is the difference between informed consent and
  // a button.
  'versions', 'compare',
]);

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { t } = useTranslation('common');
  const { isAuthenticated, isLoading, status, user } = useAuth();
  const { tenantPath, tenant } = useTenant();
  const location = useLocation();
  const {
    hasPending,
    pendingDocs,
    acceptAll,
    isAccepting,
    isLoading: legalLoading,
    error: legalError,
    refresh: refreshLegalStatus,
  } = useLegalGate();

  // Show loading while checking auth status
  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('checking_authentication')} />;
  }

  // Redirect to login if not authenticated, preserving tenant slug prefix
  if (!isAuthenticated) {
    return <Navigate to={tenantPath('/login')} state={{ from: tenantPath(location.pathname) + location.search }} replace />;
  }

  // Redirect non-admin users away from /admin routes
  const isAdminRoute = location.pathname.includes('/admin');
  if (isAdminRoute) {
    const isAdmin =
      user?.role === 'admin' ||
      user?.role === 'super_admin' ||
      user?.is_super_admin ||
      user?.is_tenant_super_admin;

    if (!isAdmin) {
      return <Navigate to={tenantPath('/dashboard')} replace />;
    }
  }

  // Redirect to onboarding only if the flag is not set AND onboarding is
  // both enabled and mandatory for this tenant. onboarding_completed is the
  // authoritative source of truth — the backend already requires avatar+bio
  // before it will set this flag.
  //
  // The tenant bootstrap payload includes onboarding settings. When
  // onboarding.enabled=false or onboarding.mandatory=false, we skip the
  // redirect entirely so members can use the platform without onboarding.
  const pathSegments = location.pathname.replace(/\/+$/, '').split('/');
  const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
  const onboardingSettings = tenant?.settings as Record<string, unknown> | undefined;
  const onboardingEnabled = onboardingSettings?.onboarding_enabled !== false;
  const onboardingMandatory = onboardingSettings?.onboarding_mandatory !== false;
  const isGodOrSuperAdmin = user?.is_god || user?.is_super_admin;
  const needsOnboarding = user && !user.onboarding_completed && onboardingEnabled && onboardingMandatory && !isGodOrSuperAdmin;
  if (needsOnboarding && lastSegment !== 'onboarding') {
    return <Navigate to={tenantPath('/onboarding')} replace />;
  }

  // Legal gate: block protected pages when user has unaccepted legal documents.
  // Skip the gate on legal/onboarding pages so users can read docs before accepting.
  const isLegalBypassPath = LEGAL_GATE_BYPASS_SEGMENTS.has(lastSegment);
  const protectedContent = children ? <>{children}</> : <Outlet />;

  if (isLegalBypassPath) {
    return protectedContent;
  }

  if (legalLoading) {
    return <LoadingScreen message={t('checking_authentication')} />;
  }

  if (legalError) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4" role="alert">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-theme-primary">
            {t('errors.unexpected')}
          </h1>
          <p className="mt-2 text-sm text-theme-muted">
            {t('errors.connection_failed_detail')}
          </p>
          <Button className="mt-5" onPress={refreshLegalStatus}>
            {t('actions.retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (hasPending) {
    return (
      <Suspense fallback={<LoadingScreen message={t('loading')} />}>
        <LegalAcceptanceGate
          pendingDocs={pendingDocs}
          onAcceptAll={acceptAll}
          isAccepting={isAccepting}
        />
      </Suspense>
    );
  }

  return protectedContent;
}

export default ProtectedRoute;
