// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Login Page with 2FA Support and Tenant Selection
 * Theme-aware styling for light and dark modes
 *
 * Tenant resolution priority:
 * 1. TenantContext already resolved a tenant from URL slug or custom domain → use it, no dropdown
 * 2. No URL tenant, but bootstrap resolved tenant 1 (platform) → use it, no dropdown
 * 3. No URL tenant and no bootstrap tenant → show community dropdown (multi-tenant chooser)
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { Link, useNavigate, useLocation, useSearchParams } from 'react-router-dom';

import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { Separator } from '@/components/ui/Separator';
import { Spinner } from '@/components/ui/Spinner';
import { motion, AnimatePresence } from '@/lib/motion';
import Mail from 'lucide-react/icons/mail';
import Lock from 'lucide-react/icons/lock';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Shield from 'lucide-react/icons/shield';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Building2 from 'lucide-react/icons/building-2';
import Fingerprint from 'lucide-react/icons/fingerprint';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldX from 'lucide-react/icons/shield-x';
import Clock from 'lucide-react/icons/clock';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { SsoButtons } from '@/components/auth/SsoButtons';
import { PageMeta } from '@/components/seo/PageMeta';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api, tokenManager } from '@/lib/api';
import { logError } from '@/lib/logger';

interface Tenant {
  id: number;
  name: string;
  slug: string;
  domain?: string;
  tagline?: string;
  logo_url?: string;
  features?: {
    biometric_login?: boolean;
  };
  authentication_config?: {
    'passkeys.conditional_autofill'?: boolean;
    'passkeys.enrollment_enabled'?: boolean;
  };
}

function browserHasPasskeyApi(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export function LoginPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('page_meta.login.title'));
  const navigate = useNavigate();
  const location = useLocation();
  const {
    status,
    error,
    isAuthenticated,
    login,
    loginWithBiometric,
    verify2FA,
    clearError,
    cancel2FA,
    twoFactorMethods,
    twoFactorTrustDeviceAllowed,
    twoFactorTrustedDeviceDays,
  } = useAuth();
  const { tenant, branding, tenantSlug, tenantPath, authenticationConfig, hasFeature, isLoading: tenantLoading } = useTenant();
  const toast = useToast();
  const [searchParams] = useSearchParams();

  // Tenant state — only used when no tenant is resolved from URL/domain
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [tenantsLoading, setTenantsLoading] = useState(false);

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Cloudflare Turnstile removed from login 2026-05-16 — member feedback
  // found the widget confusing. Bot defence is now the DB-backed per-email
  // + per-IP brute force limiter plus the named route-level login throttle.

  // 2FA state
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [useBackupCode, setUseBackupCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

  // Verification resend state
  const [loginErrorCode, setLoginErrorCode] = useState<string | undefined>();
  const [loginRetryAfter, setLoginRetryAfter] = useState<number | null>(null);
  // 🔴 Waiting for a coordinator to approve you is NOT a sign-in failure, and
  // must not be dressed as one. Reported by a coordinator walking the real
  // journey (Minehead & Coast, 2026-08-12): the member saw a red box headed
  // "Sign-in failed. Please check your details and try again." — which tells
  // them they typed something wrong — with the actual reason demoted to amber
  // small print underneath. They go back and retype correct details forever.
  // Approval-required is the DEFAULT for a new community, so this is the normal
  // new-member experience, not an edge case. This flag downgrades the whole
  // alert to a calm, positive treatment and promotes the real reason to the
  // headline. Keep the generic "check your details" copy OUT of this branch.
  const isPendingApproval = loginErrorCode === 'AUTH_ACCOUNT_PENDING_APPROVAL';
  const [isResendingVerification, setIsResendingVerification] = useState(false);
  const [resendVerificationSent, setResendVerificationSent] = useState(false);

  // Passkey login state
  const biometricAvailable = browserHasPasskeyApi();
  const [biometricLoading, setBiometricLoading] = useState(false);
  const conditionalAbortRef = useRef<AbortController | null>(null);
  const conditionalStartedRef = useRef(false);
  const biometricAbortRef = useRef<AbortController | null>(null);
  const biometricInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const selectedTenantIdRef = useRef(selectedTenantId);
  selectedTenantIdRef.current = selectedTenantId;
  const selectedTenant = tenants.find((candidate) => String(candidate.id) === selectedTenantId);
  const passkeyAuthenticationEnabled = selectedTenant
    ? selectedTenant.features?.biometric_login === true
    : hasFeature('biometric_login');
  const conditionalAutofillEnabled = selectedTenant?.authentication_config?.['passkeys.conditional_autofill']
    ?? authenticationConfig?.['passkeys.conditional_autofill']
    ?? true;

  // Redirect after successful login (preserve tenant slug prefix)
  const from = (location.state as { from?: string })?.from || tenantPath('/feed');

  // Clear stale auth tokens on mount — login page should always start clean
  useEffect(() => {
    tokenManager.clearTokens();
  }, []);

  // Start conditional mediation (passkey autofill) after the user focuses the
  // email field. Loading SimpleWebAuthn on mount was competing with login paint.
  const startConditionalAuth = useCallback(async () => {
    if (conditionalStartedRef.current) return;
    if (biometricInFlightRef.current) return;
    if (!selectedTenantId) return;
    if (!passkeyAuthenticationEnabled) return;
    if (!conditionalAutofillEnabled) return;
    if (!browserHasPasskeyApi()) return;

    conditionalStartedRef.current = true;
    conditionalAbortRef.current?.abort();
    const controller = new AbortController();
    conditionalAbortRef.current = controller;
    const tenantId = selectedTenantId;
    let conditionalUnsupported = false;

    try {
      const {
        isConditionalMediationAvailable,
        startConditionalAuthentication,
      } = await import('@/lib/webauthn');
      if (controller.signal.aborted || selectedTenantIdRef.current !== tenantId) return;

      const supported = await isConditionalMediationAvailable();
      if (controller.signal.aborted || selectedTenantIdRef.current !== tenantId) return;
      if (!supported) {
        conditionalUnsupported = true;
        return;
      }

      // Bind every request and eventual token write to this immutable tenant.
      tokenManager.setTenantId(tenantId);

      const result = await startConditionalAuthentication(controller.signal);
      if (controller.signal.aborted || selectedTenantIdRef.current !== tenantId) return;
      if (result?.success && result.data) {
        // Reload so AuthContext bootstraps the authenticated session normally.
        tokenManager.setAccessToken(result.data.access_token);
        tokenManager.setRefreshToken(result.data.refresh_token);
        window.location.href = from;
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        logError('[LoginPage] Conditional passkey sign-in failed', err);
      }
    } finally {
      if (conditionalAbortRef.current === controller) {
        conditionalAbortRef.current = null;
        conditionalStartedRef.current = conditionalUnsupported;
      }
    }
  }, [selectedTenantId, passkeyAuthenticationEnabled, conditionalAutofillEnabled, from]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      conditionalAbortRef.current?.abort();
      biometricAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    conditionalAbortRef.current?.abort();
    conditionalAbortRef.current = null;
    conditionalStartedRef.current = false;
    biometricAbortRef.current?.abort();
    biometricAbortRef.current = null;
    biometricInFlightRef.current = false;
    setBiometricLoading(false);
  }, [selectedTenantId, passkeyAuthenticationEnabled, conditionalAutofillEnabled]);

  // Tenant is "resolved from URL" only when there's an explicit URL slug or
  // the hostname is a custom tenant domain (not the generic app.* domain).
  // If bootstrap just fell back to tenant 1 with no URL hint, we still need
  // the dropdown so regular users can pick their community.
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  const isGenericAppDomain = hostname === 'app.project-nexus.ie' || hostname === 'localhost' || hostname === '127.0.0.1';
  const tenantResolvedFromUrl = !tenantLoading && tenant !== null && (!!tenantSlug || !isGenericAppDomain);

  // When tenant is resolved from URL/domain, set it directly — no dropdown needed.
  useEffect(() => {
    if (tenantResolvedFromUrl && tenant) {
      setSelectedTenantId(String(tenant.id));
      tokenManager.setTenantId(tenant.id);
    }
  }, [tenantResolvedFromUrl, tenant]);

  // Only fetch the tenant list when URL/domain gives us no tenant hint.
  // This is the fallback for app.project-nexus.ie/login with no slug.
  useEffect(() => {
    if (tenantLoading) return; // Wait for context to settle first
    if (tenantResolvedFromUrl) return; // Already have a tenant — no list needed

    let cancelled = false;
    const fetchTenants = async () => {
      setTenantsLoading(true);
      try {
        // Fetch ALL tenants including tenant 1 for super admin access
        const response = await api.get<Tenant[]>('/v2/tenants?include_master=1', { skipAuth: true, skipTenant: true });
        if (cancelled) return;
        if (response.success && response.data) {
          setTenants(response.data);

          // Pre-select from ?tenant= query param
          const tenantHint = searchParams.get('tenant');
          const hintMatch = tenantHint
            ? response.data.find((t) => t.slug === tenantHint)
            : null;

          if (hintMatch) {
            setSelectedTenantId(String(hintMatch.id));
            tokenManager.setTenantId(hintMatch.id);
          } else if (response.data.length === 1) {
            const firstTenant = response.data[0];
            if (firstTenant) {
              setSelectedTenantId(String(firstTenant.id));
              tokenManager.setTenantId(firstTenant.id);
            }
          }
        }
      } catch (err) {
        if (!cancelled) logError('[LoginPage] Failed to fetch tenants', err);
      } finally {
        if (!cancelled) setTenantsLoading(false);
      }
    };
    fetchTenants();
    return () => { cancelled = true; };
  }, [tenantLoading, tenantResolvedFromUrl, tenantSlug, searchParams]);

  // Handle tenant selection from dropdown
  const handleTenantChange = (keys: unknown) => {
    if (biometricInFlightRef.current || status === 'loading') return;
    if (keys === 'all' || !keys || !(keys instanceof Set)) return;
    const tenantId = Array.from(keys as Set<string>)[0] || '';
    conditionalAbortRef.current?.abort();
    conditionalAbortRef.current = null;
    conditionalStartedRef.current = false;
    setSelectedTenantId(tenantId);
    if (tenantId) {
      tokenManager.setTenantId(tenantId);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, navigate, from]);

  // Clear error when form changes
  useEffect(() => {
    if (error) {
      clearError();
    }
  }, [email, password, twoFactorCode, selectedTenantId]); // eslint-disable-line react-hooks/exhaustive-deps -- clear validation error on input change; error/clearError excluded to avoid loop

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();

    if (biometricInFlightRef.current) return;
    if (!email.trim() || !password.trim()) return;
    if (!selectedTenantId) return;

    conditionalAbortRef.current?.abort();
    conditionalAbortRef.current = null;
    conditionalStartedRef.current = false;
    setLoginErrorCode(undefined);
    setLoginRetryAfter(null);
    setResendVerificationSent(false);
    tokenManager.clearTokens();
    tokenManager.setTenantId(selectedTenantId);

    const result = await login({ email, password });
    // Admin without 2FA — route directly into the setup flow.
    if (!result.success && result.requires2FASetup) {
      navigate(tenantPath('/settings/security?force_2fa_setup=1'), { replace: true });
      return;
    }
    if (!result.success && result.errorCode) {
      setLoginErrorCode(result.errorCode);
      if (result.errorCode === 'RATE_LIMITED' || (result as { retryAfter?: number }).retryAfter) {
        setLoginRetryAfter((result as { retryAfter?: number }).retryAfter ?? null);
      }
    }
  };

  const handleResendVerification = async () => {
    if (!email.trim()) return;
    setIsResendingVerification(true);
    try {
      await api.post('/auth/resend-verification-by-email', { email }, { skipAuth: true });
      setResendVerificationSent(true);
    } catch {
      // Silently handle — the endpoint always returns success for security
    } finally {
      setIsResendingVerification(false);
    }
  };

  const handleBiometricLogin = async () => {
    if (!selectedTenantId || !passkeyAuthenticationEnabled || isLoading || biometricInFlightRef.current) return;
    const tenantId = selectedTenantId;
    const controller = new AbortController();
    biometricAbortRef.current?.abort();
    biometricAbortRef.current = controller;
    biometricInFlightRef.current = true;

    conditionalAbortRef.current?.abort();
    conditionalAbortRef.current = null;
    conditionalStartedRef.current = false;

    if (mountedRef.current) setBiometricLoading(true);
    tokenManager.clearTokens();
    tokenManager.setTenantId(tenantId);

    try {
      const result = await loginWithBiometric(undefined, controller.signal);
      if (controller.signal.aborted || selectedTenantIdRef.current !== tenantId) return;

      if (result.success) {
        navigate(from, { replace: true });
      } else if (result.errorCode === 'cancelled') {
        // User cancelled; no error is necessary.
      } else if (
        result.errorCode === 'domain_not_allowed'
        || result.errorCode === 'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED'
      ) {
        logError('[LoginPage] Passkey RP ID rejected for this origin', result.error);
        toast.error(t('passkey_error_domain'));
      } else if (result.errorCode === 'FEATURE_DISABLED') {
        toast.error(t('passkey_disabled'));
      } else if (result.errorCode === 'AUTH_WEBAUTHN_CREDENTIAL_NOT_FOUND') {
        // Compatibility with older servers. Current public login normalises
        // this code to avoid account/passkey enumeration.
        toast.error(t('passkey_not_found'));
      } else {
        logError('[LoginPage] Passkey sign-in failed', result.error);
        toast.error(t('passkey_login_failed'));
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        logError('[LoginPage] Passkey sign-in failed before completion', err);
        toast.error(t('passkey_login_failed'));
      }
    } finally {
      if (biometricAbortRef.current === controller) {
        biometricAbortRef.current = null;
        biometricInFlightRef.current = false;
        if (mountedRef.current) setBiometricLoading(false);
      }
    }
  };

  const handleVerify2FA = async (e: FormEvent) => {
    e.preventDefault();

    const code = twoFactorCode.trim().replace(/[-\s]/g, '').toUpperCase();
    const expectedLength = useBackupCode ? 8 : 6;

    const validFormat = useBackupCode ? /^[A-Z0-9]+$/.test(code) : /^\d+$/.test(code);
    if (!code || code.length !== expectedLength || !validFormat) return;

    const success = await verify2FA({
      code,
      use_backup_code: useBackupCode,
      trust_device: trustDevice,
    });

    if (success) {
      navigate(from, { replace: true });
    }
  };

  const handleBack2FA = () => {
    setTwoFactorCode('');
    setUseBackupCode(false);
    setTrustDevice(false);
    cancel2FA();
  };

  const isLoading = status === 'loading';
  const requires2FA = status === 'requires_2fa';

  // Show dropdown only when no URL/domain tenant is resolved AND multiple tenants exist
  const showTenantDropdown = !tenantResolvedFromUrl && !tenantsLoading && tenants.length > 1;
  const showTenantCard = !tenantResolvedFromUrl && !tenantsLoading && tenants.length === 1;
  // Show resolved tenant info (from URL/domain) when known
  const showResolvedTenant = tenantResolvedFromUrl && tenant;

  const canSubmit = email.trim() && password.trim() && !!selectedTenantId;

  return (
    <>
      <PageMeta title={t("login_meta_title")} description={t("login_meta_description")} noIndex />
      <div className="min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ y: 20 }}
          animate={{ y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10"
        >
          <GlassCard className="p-5 sm:p-8">
            <AnimatePresence mode="wait">
              {!requires2FA ? (
                // Login Form
                <motion.div
                  key="login"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                >
                  {/* Header */}
                  <div className="text-center mb-8">
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-4"
                    >
                      <Mail className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
                    </motion.div>
                    <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">{t('login.title')}</h1>
                    <p className="text-theme-muted mt-2">
                      {t('login.subtitle_community', { name: branding.name })}
                    </p>
                  </div>

                  {/* Error Alert */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`mb-6 p-4 rounded-xl border text-sm ${
                        isPendingApproval
                          ? 'bg-emerald-500/10 border-emerald-500/20'
                          : 'bg-red-500/10 border-red-500/20'
                      }`}
                      role={isPendingApproval ? 'status' : 'alert'}
                    >
                      {/* Suppressed for pending approval — see isPendingApproval above. */}
                      {!isPendingApproval && (
                        <p className="text-red-600 dark:text-red-400">{error}</p>
                      )}
                      {/* Rate limit: show retry_after seconds if available */}
                      {loginErrorCode === 'RATE_LIMITED' && (
                        <p className="text-red-600 dark:text-red-400 text-xs mt-1">
                          {loginRetryAfter && loginRetryAfter > 0
                            ? t('login.rate_limited_seconds', { seconds: loginRetryAfter })
                            : t('login.rate_limited')}
                        </p>
                      )}
                      {/* Resend verification email button */}
                      {loginErrorCode === 'AUTH_EMAIL_NOT_VERIFIED' && (
                        <div className="mt-3">
                          {resendVerificationSent ? (
                            <p className="text-emerald-600 dark:text-emerald-400 text-xs">
                              {t('login.verification_email_sent')}
                            </p>
                          ) : (
                            <Button
                              size="sm"
                              variant="secondary"
                              onPress={handleResendVerification}
                              isLoading={isResendingVerification}
                              className="bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                              startContent={!isResendingVerification ? <Mail className="w-3 h-3" aria-hidden="true" /> : undefined}
                            >
                              {t('login.resend_verification')}
                            </Button>
                          )}
                        </div>
                      )}
                      {loginErrorCode === 'AUTH_PENDING_VERIFICATION' && (
                        <div className="mt-3 flex items-start gap-2">
                          <ShieldAlert className="w-4 h-4 text-[var(--color-warning)] mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-amber-600 dark:text-amber-400 text-xs">
                              {t('login.pending_verification')}
                            </p>
                            <Button
                              size="sm"
                              variant="secondary"
                              as={Link}
                              to={tenantPath('/verify-identity')}
                              className="mt-2 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20"
                              startContent={<ShieldAlert className="w-3 h-3" aria-hidden="true" />}
                            >
                              {t('login.continue_verification')}
                            </Button>
                          </div>
                        </div>
                      )}
                      {/*
                        🔴 There was no branch for AUTH_ACCOUNT_PENDING_APPROVAL, and
                        approval-required is the DEFAULT for a new community
                        (TenantSettingsService::requiresAdminApproval() returns true
                        when unset). So the normal new-member experience was: sign up,
                        be told to check your email, verify, try to log in, and get a
                        single line of red text with no explanation of who approves,
                        how long it takes, or what to do next. This explains it.
                      */}
                      {isPendingApproval && (
                        <div className="flex items-start gap-2">
                          <Clock className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-emerald-700 dark:text-emerald-300 font-medium">
                              {t('login.pending_approval_title')}
                            </p>
                            <p className="text-emerald-700 dark:text-emerald-300 text-xs mt-1">
                              {t('login.pending_approval')}
                            </p>
                            <Button
                              size="sm"
                              variant="secondary"
                              as={Link}
                              to={tenantPath('/contact')}
                              className="mt-2 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                            >
                              {t('login.pending_approval_contact')}
                            </Button>
                          </div>
                        </div>
                      )}
                      {loginErrorCode === 'AUTH_VERIFICATION_FAILED' && (
                        <div className="mt-3 flex items-start gap-2">
                          <ShieldX className="w-4 h-4 text-[var(--color-error)] mt-0.5 flex-shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-red-600 dark:text-red-400 text-xs">
                              {t('login.verification_failed')}
                            </p>
                            <Button
                              size="sm"
                              variant="secondary"
                              as={Link}
                              to={tenantPath('/verify-identity')}
                              className="mt-2 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20"
                              startContent={<ShieldX className="w-3 h-3" aria-hidden="true" />}
                            >
                              {t('login.retry_verification')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Social login buttons (SOC13) */}
                  {selectedTenantId && (
                    <div className="mb-5 space-y-3">
                      <SsoButtons tenantId={selectedTenantId} />
                      <OAuthButtons intent="login" tenantId={selectedTenantId} />
                    </div>
                  )}

                  {/* Form */}
                  <form onSubmit={handleLogin} aria-label={t('login.title')} className="space-y-5">
                    {/* Tenant resolved from URL/domain — show as read-only info */}
                    {showResolvedTenant && (
                      <div className="p-3 rounded-xl bg-theme-elevated border border-theme-default">
                        <div className="flex items-center gap-3">
                          <Building2 className="w-5 h-5 text-accent flex-shrink-0" />
                          <div>
                            <p className="text-theme-primary font-medium">{tenant.name}</p>
                            {tenant.tagline && (
                              <p className="text-theme-muted text-xs">{tenant.tagline}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Multi-tenant dropdown — only when tenant not resolved from URL */}
                    {showTenantDropdown && (
                      <Autocomplete
                        label={t('login.community_label')}
                        placeholder={t('login.community_placeholder')}
                        searchPlaceholder={t('login.community_search')}
                        value={selectedTenantId || null}
                        onChange={(key) => handleTenantChange(key && !Array.isArray(key) ? new Set([String(key)]) : new Set<string>())}
                        startContent={<Building2 className="w-4 h-4 text-theme-subtle" />}
                        isRequired
                        isDisabled={isLoading || biometricLoading}
                        classNames={{
                          trigger: 'bg-white/90 dark:bg-white/10 backdrop-blur-xl border border-gray-200 dark:border-white/10',
                          value: 'text-theme-primary',
                          popover: 'bg-overlay border border-theme-default',
                        }}
                      >
                        {tenants.map((t) => (
                          <AutocompleteItem
                            key={String(t.id)} id={String(t.id)}
                            textValue={t.name}
                            classNames={{
                              base: 'text-gray-900 dark:text-white data-[hover=true]:bg-gray-100 dark:data-[hover=true]:bg-white/10',
                            }}
                          >
                            <div className="flex flex-col">
                              <span className="text-gray-900 dark:text-white">{t.name}</span>
                              {t.tagline && (
                                <span className="text-gray-500 dark:text-gray-400 text-xs">{t.tagline}</span>
                              )}
                            </div>
                          </AutocompleteItem>
                        ))}
                      </Autocomplete>
                    )}

                    {/* Single tenant card */}
                    {showTenantCard && (
                      <div className="p-3 rounded-xl bg-theme-elevated border border-theme-default">
                        <div className="flex items-center gap-3">
                          <Building2 className="w-5 h-5 text-accent" />
                          <div>
                            <p className="text-theme-primary font-medium">{tenants[0]?.name}</p>
                            {tenants[0]?.tagline && (
                              <p className="text-theme-muted text-xs">{tenants[0]?.tagline}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    <Input
                      id="login-email"
                      name="username"
                      type="email"
                      label={t('login.email_label')}
                      placeholder={t('login.email_placeholder')}
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setLoginErrorCode(undefined); setLoginRetryAfter(null); }}
                      onFocus={() => { void startConditionalAuth(); }}
                      startContent={<Mail className="w-4 h-4 text-theme-subtle" />}
                      isRequired
                      autoComplete="username webauthn"
                      classNames={{
                        inputWrapper: 'glass-card min-h-11 backdrop-blur-lg',
                        label: 'text-theme-muted',
                        input: 'text-theme-primary placeholder:text-theme-subtle',
                      }} />

                    <Input
                      id="login-password"
                      name="password"
                      type={showPassword ? 'text' : 'password'}
                      label={t('login.password_label')}
                      placeholder={t('login.password_placeholder')}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setLoginErrorCode(undefined); setLoginRetryAfter(null); }}
                      startContent={<Lock className="w-4 h-4 text-theme-subtle" />}
                      endContent={
                        <Button
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          className="size-8 min-w-8 p-0 text-theme-subtle"
                          onPress={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? t('login.hide_password') : t('login.show_password')}
                        >
                          {showPassword ? (
                            <EyeOff className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <Eye className="w-4 h-4" aria-hidden="true" />
                          )}
                        </Button>
                      }
                      isRequired
                      autoComplete="current-password"
                      classNames={{
                        inputWrapper: 'glass-card min-h-11 backdrop-blur-lg',
                        label: 'text-theme-muted',
                        input: 'text-theme-primary placeholder:text-theme-subtle',
                      }} />

                    <div className="flex items-center justify-end">
                      <Link
                        to={tenantPath('/password/forgot')}
                        className="text-sm text-accent dark:text-accent hover:text-accent dark:hover:text-accent transition-colors"
                      >
                        {t('login.forgot_password')}
                      </Link>
                    </div>

                    <Button
                      type="submit"
                      isLoading={isLoading}
                      isDisabled={!canSubmit}
                      className="w-full font-medium"
                      size="lg"
                      spinner={<Spinner size="sm" />}
                    >
                      {t('login.submit')}
                    </Button>
                  </form>

                  {/* Passkey Login */}
                  {biometricAvailable && passkeyAuthenticationEnabled && selectedTenantId && (
                    <>
                      <div className="relative flex items-center my-5">
                        <div className="flex-grow border-t border-[var(--border-default)]" />
                        <span className="flex-shrink mx-3 text-xs text-theme-subtle">
                          {t('login.or')}
                        </span>
                        <div className="flex-grow border-t border-[var(--border-default)]" />
                      </div>

                      <Button
                        type="button"
                        variant="secondary"
                        onPress={handleBiometricLogin}
                        isLoading={biometricLoading}
                        isDisabled={isLoading || biometricLoading}
                        className="w-full border-accent/30 text-theme-primary hover:bg-accent/10"
                        size="lg"
                        startContent={
                          !biometricLoading ? (
                            <Fingerprint className="w-5 h-5 text-accent" aria-hidden="true" />
                          ) : undefined
                        }
                        spinner={<Spinner size="sm" />}
                      >
                        {t('login.passkey_login')}
                      </Button>
                      <p className="text-xs text-theme-muted text-center mt-1.5">
                        {t('login.passkey_hint')}
                      </p>
                    </>
                  )}

                  {/* Divider */}
                  <Separator className="my-6 bg-[var(--border-default)]" />

                  {/* Register Link */}
                  <p className="text-center text-theme-muted text-sm">
                    {t('login.no_account')}{' '}
                    <Link
                      to={tenantPath('/register')}
                      className="text-accent dark:text-accent hover:text-accent dark:hover:text-accent font-medium transition-colors"
                    >
                      {t('login.create_account_link')}
                    </Link>
                  </p>
                </motion.div>
              ) : (
                // 2FA Form
                <motion.div
                  key="2fa"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                >
                  {/* Header */}
                  <div className="text-center mb-8">
                    <motion.div
                      initial={{ scale: 0.8 }}
                      animate={{ scale: 1 }}
                      className="inline-flex items-center justify-center w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-accent/20 to-accent-gradient-end/20 mb-4"
                    >
                      <Shield className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
                    </motion.div>
                    <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">
                      {t('login.twofa_title')}
                    </h1>
                    <p className="text-theme-muted mt-2">
                      {t('login.twofa_subtitle')}
                    </p>
                  </div>

                  {/* Error Alert */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm"
                      role="alert"
                    >
                      {error}
                    </motion.div>
                  )}

                  {/* Form */}
                  <form onSubmit={handleVerify2FA} aria-label={t('page_meta.verify_identity.title')} className="space-y-5">
                    <Input
                      type="text"
                      label={useBackupCode ? t('login.twofa_backup_code_label') : t('login.twofa_code_label')}
                      placeholder={useBackupCode ? t('login.twofa_backup_placeholder') : t('login.twofa_code_placeholder')}
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(
                        useBackupCode
                          ? e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
                          : e.target.value.replace(/\D/g, '').slice(0, 6)
                      )}
                      inputMode={useBackupCode ? 'text' : 'numeric'}
                      startContent={<Shield className="w-4 h-4 text-theme-subtle" />}
                      isRequired
                      autoComplete="one-time-code"
                      aria-label={useBackupCode ? t('login.twofa_backup_code_label') : t('login.two_factor_code_label')}
                      classNames={{
                        inputWrapper: 'glass-card min-h-11 backdrop-blur-lg',
                        label: 'text-theme-muted',
                        input: 'text-theme-primary placeholder:text-theme-subtle text-center text-xl tracking-widest',
                      }} />

                    <div className="space-y-3">
                      {twoFactorMethods.includes('backup_code') && (
                        <Checkbox
                          isSelected={useBackupCode}
                          onValueChange={(checked) => {
                            setUseBackupCode(checked);
                            setTwoFactorCode('');
                          }}
                          size="sm"
                          classNames={{
                            label: 'text-theme-muted text-sm',
                          }}
                        >
                          {t('login.twofa_use_backup')}
                        </Checkbox>
                      )}

                      {twoFactorTrustDeviceAllowed !== false && <Checkbox
                        isSelected={trustDevice}
                        onValueChange={setTrustDevice}
                        size="sm"
                        classNames={{
                          label: 'text-theme-muted text-sm',
                        }}
                      >
                        {t('login.twofa_trust_device', { days: twoFactorTrustedDeviceDays ?? 30 })}
                      </Checkbox>}
                    </div>

                    <div className="flex gap-3">
                      <Button
                        type="button"
                        variant="tertiary"
                        onPress={handleBack2FA}
                        className="flex-1 bg-theme-elevated text-theme-muted hover:bg-theme-hover"
                        startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('login.back')}
                      </Button>

                      <Button
                        type="submit"
                        isLoading={isLoading}
                        isDisabled={!twoFactorCode.trim()}
                        className="flex-1 font-medium"
                        spinner={<Spinner size="sm" />}
                      >
                        {t('login.twofa_verify')}
                      </Button>
                    </div>
                  </form>

                  {/* Help text */}
                  <p className="mt-6 text-center text-theme-subtle text-xs">
                    {t('login.twofa_help')}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>

          {/* Back to home link */}
          <div className="mt-6 text-center">
            <Link
              to={tenantPath('/')}
              className="inline-flex items-center gap-2 text-theme-subtle hover:text-theme-secondary text-sm transition-colors"
            >
              <ArrowLeft className="w-4 h-4" aria-hidden="true" />
              {t('login.back_to_home')}
            </Link>
          </div>
        </motion.div>
      </div>
    </>
  );
}

export default LoginPage;
