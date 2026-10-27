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
import { AuthUnavailableScreen } from './AuthUnavailableScreen';
import { Button } from '@/components/ui/Button';
import { useLegalGate } from '@/hooks/useLegalGate';
import { isVisitingManager } from '@/lib/access';
import { buildReturnTarget } from '@/lib/auth-return';

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

/**
 * Pages about the signed-in account's OWN membership of this community. A
 * manager visiting from a community above has none here (it looks around, it
 * does not take part — E-107), so these send it to the community feed (or home
 * page) instead of an empty or misleading page. Matched on any path segment.
 */
const VISITOR_PERSONAL_SEGMENTS = new Set([
  'dashboard', 'messages', 'wallet', 'notifications', 'settings', 'onboarding', 'exchanges', 'matches',
]);
/** Form pages for creating or changing something: taking part, not looking. */
const VISITOR_FORM_SEGMENTS = new Set(['create', 'new', 'edit']);

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { t } = useTranslation('common');
  const { isAuthenticated, isLoading, status, user } = useAuth();
  const { tenantPath, tenant, hasModule } = useTenant();
  const location = useLocation();
  // A tenant super admin managing a community below its own (owner rule,
  // 12 Oct 2026). It is not a member here: member pages would be refused by
  // the server, and this community's member terms and onboarding are not its.
  const visiting = isAuthenticated && isVisitingManager(user, tenant?.id);
  const {
    hasPending,
    pendingDocs,
    acceptAll,
    isAccepting,
    isLoading: legalLoading,
    error: legalError,
    refresh: refreshLegalStatus,
  } = useLegalGate({ enabled: !visiting });

  // Show loading while checking auth status
  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('checking_authentication')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  // Redirect to login if not authenticated, preserving tenant slug prefix
  if (!isAuthenticated) {
    // The whole address (query and fragment too) survives sign-in — see lib/auth-return.ts.
    const login = buildReturnTarget(tenantPath('/login'), tenantPath(location.pathname) + location.search + location.hash);
    return <Navigate to={login.to} state={login.state} replace />;
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
  // A manager from a community above may look around the member side (owner,
  // 15 Oct 2026: "browse the children so he can see what's going on"). The
  // server refuses every member action it tries; the banner says so. This
  // community's member terms and onboarding are not its, so neither applies.
  if (visiting) {
    const segments = location.pathname.replace(/\/+$/, '').split('/');
    const personal = segments.some((segment) => VISITOR_PERSONAL_SEGMENTS.has(segment))
      || segments.some((segment) => VISITOR_FORM_SEGMENTS.has(segment))
      || segments[segments.length - 1] === 'profile';
    if (personal) {
      return <Navigate to={tenantPath(hasModule?.('feed') ? '/feed' : '/')} replace />;
    }
    return children ? <>{children}</> : <Outlet />;
  }

  const pathSegments = location.pathname.replace(/\/+$/, '').split('/');
  const lastSegment = pathSegments[pathSegments.length - 1] ?? '';
  const onboardingSettings = tenant?.settings as Record<string, unknown> | undefined;
  const onboardingEnabled = onboardingSettings?.onboarding_enabled !== false;
  const onboardingMandatory = onboardingSettings?.onboarding_mandatory !== false;
  const isGodOrSuperAdmin = user?.is_god || user?.is_super_admin;
  const needsOnboarding = user && !user.onboarding_completed && onboardingEnabled && onboardingMandatory && !isGodOrSuperAdmin;
  if (needsOnboarding && lastSegment !== 'onboarding') {
    // Onboarding first, then on to the page the member asked for (an emailed
    // link, say) rather than the dashboard.
    const onboarding = buildReturnTarget(tenantPath('/onboarding'), tenantPath(location.pathname) + location.search + location.hash);
    return <Navigate to={onboarding.to} state={onboarding.state} replace />;
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
