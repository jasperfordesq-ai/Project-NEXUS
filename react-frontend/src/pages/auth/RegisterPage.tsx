// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Registration Page
 *
 * Step-by-step registration form for better mobile UX:
 * - Step 1: Community & Profile Type
 * - Step 2: Personal Details (name, location, phone)
 * - Step 3: Account Setup (email, password)
 * - Step 4: Terms & Consent
 *
 * Desktop shows all fields, mobile shows one step at a time
 */

import { lazy, Suspense, useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Separator } from '@/components/ui/Separator';
import { Spinner } from '@/components/ui/Spinner';
import { motion,
  AnimatePresence } from '@/lib/motion';
import User from 'lucide-react/icons/user';
import Mail from 'lucide-react/icons/mail';
import Lock from 'lucide-react/icons/lock';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Building2 from 'lucide-react/icons/building-2';
import Phone from 'lucide-react/icons/phone';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import ChevronLeft from 'lucide-react/icons/chevron-left';
import MailCheck from 'lucide-react/icons/mail-check';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Ticket from 'lucide-react/icons/ticket';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import { useTranslation,
  Trans } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts/TenantContext';
import type { RegisterResult } from '@/contexts/AuthContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { SsoButtons } from '@/components/auth/SsoButtons';
import { PageMeta } from '@/components/seo/PageMeta';
import { api, tokenManager } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePasswordCheck } from '@/hooks/usePasswordCheck';
import { PasswordStrength } from '@/components/auth/PasswordStrength';

const PlaceAutocompleteInput = lazy(() =>
  import('@/components/location/PlaceAutocompleteInput').then((module) => ({
    default: module.PlaceAutocompleteInput,
  }))
);

interface Tenant {
  id: number;
  name: string;
  slug: string;
  domain?: string;
  tagline?: string;
  logo_url?: string;
}

interface RegistrationInfo {
  registration_mode: string;
  requires_invite_code: boolean;
  requires_verification?: boolean;
  is_waitlist?: boolean;
  is_closed?: boolean;
  can_register?: boolean;
  message?: string | null;
}

type ProfileType = 'individual' | 'organisation';
type RegistrationInfoStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

const STEP_KEYS = ['community', 'details', 'account', 'terms'] as const;

const STEPS = STEP_KEYS.map((key, index) => ({ id: index + 1, key }));

const requiredLabel = (label: string) => (
  <span className="inline-flex items-center gap-0.5">
    <span>{label}</span>
    <span className="text-danger" aria-hidden="true">*</span>
  </span>
);

// E.164 phone validation.
const isPhoneValid = (value: string) => {
  if (!value.trim()) return false;
  return /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s\-()]/g, ''));
};

export function RegisterPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('page_meta.register.title'));
  const navigate = useNavigate();
  const { register, isAuthenticated, isLoading, error, clearError } = useAuth();
  const { tenant, tenantSlug, tenantPath } = useTenant();
  const [searchParams] = useSearchParams();

  // Step state (1-4)
  const [currentStep, setCurrentStep] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [isLocationAutocompleteActivated, setIsLocationAutocompleteActivated] = useState(false);

  // Bot protection — single off-screen honeypot. Multi-field decoys
  // (`confirm_email`, `address_line_2`, etc.) were autofilled by browsers
  // and silently blocked legitimate users; reverted 2026-05-16.
  const [formStartTime] = useState(() => Date.now());
  const honeypotRef = useRef<HTMLInputElement>(null);
  // Cloudflare Turnstile removed from registration 2026-05-16 — member
  // feedback found the widget too confusing. Bot defence: honeypot input
  // + per-IP route throttle (3/5min) + admin-approval gate.

  // Tenant state
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>('');
  const [tenantsLoading, setTenantsLoading] = useState(true);

  // Form state - Basic
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  // Live password check — length minimum + HIBP breach lookup.
  const passwordCheck = usePasswordCheck(password);
  const [showPassword, setShowPassword] = useState(false);

  // Form state - Profile
  const [profileType, setProfileType] = useState<ProfileType>('individual');
  const [organizationName, setOrganizationName] = useState('');

  // Form state - Contact
  const [location, setLocation] = useState('');
  const [latitude, setLatitude] = useState<number | undefined>();
  const [longitude, setLongitude] = useState<number | undefined>();
  const [phone, setPhone] = useState('');
  const [locationTouched, setLocationTouched] = useState(false);
  const [phoneTouched, setPhoneTouched] = useState(false);

  const phoneError = !phone.trim()
    ? t('register.phone_required')
    : !isPhoneValid(phone)
      ? t('register.phone_error')
      : '';
  const locationError = !location.trim() ? t('register.location_required') : '';

  // Form state - Consents
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [newsletterOptIn, setNewsletterOptIn] = useState(false);

  // Invite code state (for invite_only tenants)
  const [inviteCode, setInviteCode] = useState('');
  const [inviteCodeValid, setInviteCodeValid] = useState<boolean | null>(null);
  const [inviteCodeChecking, setInviteCodeChecking] = useState(false);
  const [requiresInviteCode, setRequiresInviteCode] = useState(false);
  const [registrationClosed, setRegistrationClosed] = useState(false);
  const [registrationInfoStatus, setRegistrationInfoStatus] = useState<RegistrationInfoStatus>(
    () => (tenant?.id ? 'loading' : 'idle')
  );

  // Post-registration pending state (verification/approval required)
  const [pendingResult, setPendingResult] = useState<RegisterResult | null>(null);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Fetch available tenants on mount, with ?tenant= hint support (TRS-001 Phase 0)
  useEffect(() => {
    let cancelled = false;
    const fetchTenants = async () => {
      try {
        const response = await api.get<Tenant[]>('/v2/tenants', { skipAuth: true, skipTenant: true });
        if (cancelled) return;
        if (response.success && response.data) {
          setTenants(response.data);

          // Priority: TenantContext (custom domain) > URL slug > ?tenant= > auto-select single
          const tenantHint = tenantSlug || searchParams.get('tenant');
          const contextMatch = tenant?.id
            ? response.data.find((t) => t.id === tenant.id)
            : null;
          const hintMatch = tenantHint
            ? response.data.find((t) => t.slug === tenantHint)
            : null;

          const match = contextMatch || hintMatch;
          if (match) {
            setSelectedTenantId(String(match.id));
            tokenManager.setTenantId(match.id);
          } else if (response.data.length === 1) {
            const firstTenant = response.data[0];
            if (firstTenant) {
              setSelectedTenantId(String(firstTenant.id));
              tokenManager.setTenantId(firstTenant.id);
            }
          }
        }
      } catch (err) {
        if (cancelled) return;
        logError('[RegisterPage] Failed to fetch tenants', err);
      } finally {
        if (!cancelled) setTenantsLoading(false);
      }
    };
    fetchTenants();
    return () => { cancelled = true; };
  }, [tenantSlug, searchParams, tenant?.id]);

  // Fetch registration info when tenant is resolved (to know if invite code is required)
  useEffect(() => {
    const effectiveTenantId = selectedTenantId || (tenant?.id ? String(tenant.id) : '');
    if (!effectiveTenantId) {
      setRegistrationInfoStatus('idle');
      return;
    }

    let cancelled = false;
    const fetchRegInfo = async () => {
      setRequiresInviteCode(false);
      setInviteCodeValid(null);
      setRegistrationClosed(false);
      setRegistrationInfoStatus('loading');
      try {
        const res = await api.get<RegistrationInfo>('/v2/auth/registration-info', { skipAuth: true });
        if (cancelled) return;
        if (res.success && res.data) {
          setRequiresInviteCode(res.data.requires_invite_code);
          setRegistrationClosed(
            res.data.is_closed === true ||
            res.data.registration_mode === 'closed' ||
            res.data.can_register === false
          );
          setRegistrationInfoStatus('ready');
        } else {
          setRegistrationInfoStatus('unavailable');
        }
      } catch (err) {
        if (cancelled) return;
        logError('[RegisterPage] Failed to fetch registration policy', err);
        setRegistrationInfoStatus('unavailable');
      }
    };
    fetchRegInfo();
    return () => { cancelled = true; };
  }, [selectedTenantId, tenant?.id]);

  // Handle tenant selection
  const handleTenantChange = useCallback((keys: unknown) => {
    // HeroUI Select passes SharedSelection which is Set-like or 'all'
    if (keys === 'all' || !keys) return;
    const selectedKeys = keys as Iterable<string>;
    const tenantId = Array.from(selectedKeys)[0] || '';
    setSelectedTenantId(tenantId);
    if (tenantId) {
      tokenManager.setTenantId(tenantId);
    }
  }, []);

  // Handle profile type selection
  const handleProfileTypeChange = useCallback((keys: unknown) => {
    const selectedKeys = keys as Set<string>;
    const type = (Array.from(selectedKeys)[0] as ProfileType) || 'individual';
    setProfileType(type);
    if (type === 'individual') {
      setOrganizationName('');
    }
  }, []);

  // Redirect after successful registration
  useEffect(() => {
    if (isAuthenticated) {
      navigate(tenantPath('/dashboard'), { replace: true });
    }
  }, [isAuthenticated, navigate, tenantPath]);

  // Clear error when form changes
  useEffect(() => {
    if (error) {
      clearError();
    }
  }, [firstName, lastName, email, password, passwordConfirm, location, phone]); // eslint-disable-line react-hooks/exhaustive-deps -- clear validation error on input change; error/clearError excluded to avoid loop

  // Validate invite code (debounced on blur)
  const validateInviteCode = useCallback(async () => {
    if (!inviteCode.trim() || inviteCode.trim().length < 4) {
      setInviteCodeValid(null);
      return;
    }
    setInviteCodeChecking(true);
    try {
      const res = await api.post<{ valid: boolean; reason: string | null }>('/v2/auth/validate-invite', { code: inviteCode.trim().toUpperCase() }, { skipAuth: true });
      if (res.success && res.data) {
        setInviteCodeValid(res.data.valid);
      }
    } catch {
      setInviteCodeValid(null);
    } finally {
      setInviteCodeChecking(false);
    }
  }, [inviteCode]);

  // Validation for each step
  // tenant?.id means TenantContext already resolved the tenant (custom domain or slug route)
  const tenantSelected = !!tenant?.id || tenants.length === 0 || tenants.length === 1 || !!selectedTenantId;
  const registrationPolicyTenantResolved = !!selectedTenantId || !!tenant?.id;
  const registrationPolicyReady = !registrationPolicyTenantResolved || registrationInfoStatus === 'ready';
  const isStep1Valid = registrationPolicyReady && !registrationClosed && tenantSelected && (!requiresInviteCode || inviteCodeValid === true);
  // Verified-location is encouraged but NOT a hard client-side gate. If
  // Google Places fails to load (ad-blocker, slow network, maps disabled
  // for tenant) lat/lng stay undefined — we still let the user submit and
  // let the server make the final call. Was a hard block; that silently
  // disabled the submit button when Places hadn't fired place_changed.
  const isStep2Valid =
    firstName.trim() &&
    lastName.trim() &&
    (profileType === 'individual' || organizationName.trim()) &&
    location.trim() &&
    phone.trim() &&
    isPhoneValid(phone);
  const isStep3Valid =
    email.trim() &&
    password.trim() &&
    passwordConfirm.trim() &&
    passwordCheck.isAcceptable &&
    password === passwordConfirm;
  const isStep4Valid = termsAccepted;

  const canProceed = useCallback(() => {
    switch (currentStep) {
      case 1:
        return isStep1Valid;
      case 2:
        return isStep2Valid;
      case 3:
        return isStep3Valid;
      case 4:
        return isStep4Valid;
      default:
        return false;
    }
  }, [currentStep, isStep1Valid, isStep2Valid, isStep3Valid, isStep4Valid]);

  const handleNext = useCallback(() => {
    if (currentStep < 4 && canProceed()) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep, canProceed]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  }, [currentStep]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();

    if (registrationClosed || !registrationPolicyReady) {
      return;
    }

    // Bot protection — only the legacy `website` honeypot is checked here.
    // The decoy fields (`confirm_email`, `address_line_2`, `referral_code`)
    // were autofilled by browsers (Chrome especially ignores autocomplete=
    // "off" on semantic field names) and silently blocked real users. Keep
    // them in the DOM so bots that fill everything still get logged via
    // the server-side honeypot check, but do NOT use them to gate submit
    // client-side.
    const honeypotValue = honeypotRef.current?.value;
    if (honeypotValue) {
      // Bot detected - silently fail
      return;
    }

    const timeTaken = Date.now() - formStartTime;
    if (timeTaken < 5000) {
      // Form submitted too fast (< 5 seconds) - likely a bot.
      // Intentionally silent: showing an error would tell bots exactly what to adjust.
      clearError();
      return;
    }

    // Password gate — length + HIBP breach check (see usePasswordCheck).
    if (!passwordCheck.isAcceptable) {
      return;
    }

    if (password !== passwordConfirm) {
      return;
    }

    // Get selected tenant — fall back to TenantContext (custom domain) if no explicit selection
    const selectedTenant = tenants.find((t) => String(t.id) === selectedTenantId);
    const tenantId = selectedTenant?.id || parseInt(selectedTenantId) || tenant?.id || undefined;

    const result = await register({
      first_name: firstName,
      last_name: lastName,
      email,
      password,
      password_confirmation: passwordConfirm,
      tenant_id: tenantId,
      profile_type: profileType,
      organization_name: profileType === 'organisation' ? organizationName : undefined,
      location: location.trim(),
      latitude,
      longitude,
      phone: phone.trim(),
      terms_accepted: termsAccepted,
      newsletter_opt_in: newsletterOptIn,
      invite_code: requiresInviteCode ? inviteCode.trim().toUpperCase() : undefined,
      form_started_at: formStartTime,
    } as Parameters<typeof register>[0]);

    if (result.success) {
      // If verification, approval, or waitlist is required, show pending screen
      if (result.requiresVerification || result.requiresApproval || result.requiresWaitlist) {
        setPendingResult(result);
        return;
      }
      // Check if onboarding is required before redirecting to dashboard
      if ((result as { requiresOnboarding?: boolean }).requiresOnboarding) {
        navigate(tenantPath('/onboarding'), { replace: true });
        return;
      }
      // No gates — redirect to dashboard (fully authenticated)
      navigate(tenantPath('/dashboard'), { replace: true });
    }
  }, [
    formStartTime, clearError, password, passwordConfirm, tenants, selectedTenantId,
    tenant?.id, register, firstName, lastName, email, profileType, organizationName,
    location, latitude, longitude, phone, termsAccepted, newsletterOptIn,
    requiresInviteCode, inviteCode, navigate, tenantPath, passwordCheck.isAcceptable,
    registrationClosed, registrationPolicyReady,
  ]);

  const passwordValid = passwordCheck.isAcceptable;
  const passwordsMatch = password === passwordConfirm;
  // Track whether the confirm field has ever been focused (for real-time match indicator)
  const [confirmTouched, setConfirmTouched] = useState(false);

  const isFormValid =
    firstName.trim() &&
    lastName.trim() &&
    email.trim() &&
    password.trim() &&
    passwordConfirm.trim() &&
    termsAccepted &&
    passwordValid &&
    passwordsMatch &&
    (profileType === 'individual' || organizationName.trim()) &&
    location.trim() &&
    phone.trim() &&
    isPhoneValid(phone) &&
    (tenants.length === 0 || !!selectedTenantId || !!tenant?.id) &&
    (!requiresInviteCode || inviteCodeValid === true) &&
    registrationPolicyReady &&
    !registrationClosed;

  // Step progress percentage
  const progressPercent = (currentStep / STEPS.length) * 100;
  const getStepLabel = (stepId: number) => t(`register.step_${STEPS[stepId - 1]?.key ?? STEP_KEYS[0]}`);
  const registrationPolicyLoading = registrationPolicyTenantResolved && registrationInfoStatus === 'loading';
  const registrationPolicyUnavailable = registrationPolicyTenantResolved && registrationInfoStatus === 'unavailable';
  const registerHeaderTitle = registrationClosed
    ? t('register.registration_closed_title')
    : registrationPolicyUnavailable
      ? t('register.registration_status_unavailable_title')
      : registrationPolicyLoading
        ? t('register.registration_status_checking_title')
        : t('register.title');
  const registerHeaderSubtitle =
    registrationClosed || registrationPolicyUnavailable || registrationPolicyLoading
      ? null
      : t('register.subtitle_with_name', { name: tenant?.name || 'NEXUS' });

  // Render step content
  const renderStepContent = (step: number) => {
    switch (step) {
      case 1:
        return (
          <div className="space-y-4">
            {/* Tenant Selector - Only show if multiple tenants AND tenant not already known from context */}
            {!tenantsLoading && tenants.length > 1 && !tenant?.id && (
              <Autocomplete
                label={t('register.community_label')}
                placeholder={t('register.community_placeholder')}
                searchPlaceholder={t('register.community_search')}
                value={selectedTenantId || null}
                onChange={(key) => handleTenantChange(key && !Array.isArray(key) ? new Set([String(key)]) : new Set<string>())}
                startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                isRequired
                classNames={{
                  trigger:
                    'bg-white/90 dark:bg-white/10 backdrop-blur-xl border border-gray-200 dark:border-white/10',
                  value: 'text-theme-primary',
                  popover:
                    'bg-surface border border-theme-default',
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
                        <span className="text-gray-500 dark:text-gray-400 text-xs">
                          {t.tagline}
                        </span>
                      )}
                    </div>
                  </AutocompleteItem>
                ))}
              </Autocomplete>
            )}

            {/* Show auto-detected community (custom domain or context-resolved tenant) */}
            {tenant?.id && (
              <div className="p-3 rounded-xl bg-white/90 dark:bg-white/10 backdrop-blur-xl border border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  <div>
                    <p className="text-gray-900 dark:text-white font-medium">{tenant.name}</p>
                    {tenant.tagline && (
                      <p className="text-gray-500 dark:text-gray-400 text-xs">{tenant.tagline}</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Show selected tenant if only one (and context not already set) */}
            {!tenant?.id && !tenantsLoading && tenants.length === 1 && (
              <div className="p-3 rounded-xl bg-white/90 dark:bg-white/10 backdrop-blur-xl border border-gray-200 dark:border-white/10">
                <div className="flex items-center gap-3">
                  <Building2 className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  <div>
                    <p className="text-gray-900 dark:text-white font-medium">{tenants[0]?.name}</p>
                    {tenants[0]?.tagline && (
                      <p className="text-gray-500 dark:text-gray-400 text-xs">
                        {tenants[0]?.tagline}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* No tenants message */}
            {!tenantsLoading && tenants.length === 0 && !tenant?.id && (
              <div className="p-3 rounded-xl bg-white/90 dark:bg-white/10 backdrop-blur-xl border border-gray-200 dark:border-white/10 text-center">
                <p className="text-theme-muted text-sm">
                  {t('register.joining', { name: tenant?.name || 'NEXUS' })}
                </p>
              </div>
            )}

            {/* Profile Type */}
            <Select
              label={t('register.profile_type_label')}
              placeholder={t('register.profile_type_placeholder')}
              selectedKeys={new Set([profileType])}
              onSelectionChange={handleProfileTypeChange}
              isRequired
              classNames={{
                trigger:
                  'bg-white/90 dark:bg-white/10 backdrop-blur-xl border border-gray-200 dark:border-white/10',
                label: 'text-theme-muted',
                value: 'text-theme-primary',
                popoverContent:
                  'bg-surface border border-theme-default',
              }}
            >
              <SelectItem
                key="individual" id="individual"
                textValue={t('register.type_individual')}
                classNames={{
                  base: 'text-gray-900 dark:text-white data-[hover=true]:bg-gray-100 dark:data-[hover=true]:bg-white/10',
                }}
              >
                {t('register.type_individual')}
              </SelectItem>
              <SelectItem
                key="organisation" id="organisation"
                textValue={t('register.type_organisation')}
                classNames={{
                  base: 'text-gray-900 dark:text-white data-[hover=true]:bg-gray-100 dark:data-[hover=true]:bg-white/10',
                }}
              >
                {t('register.type_organisation')}
              </SelectItem>
            </Select>

            {/* Organisation Name - Only show for organisations */}
            {profileType === 'organisation' && (
              <Input
                type="text"
                label={t('register.org_name_label')}
                placeholder={t('register.org_name_placeholder')}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                startContent={<Building2 className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                isRequired
                classNames={{
                  inputWrapper:
                    'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />
            )}

            {/* Invite Code - Only show for invite_only tenants */}
            {requiresInviteCode && (
              <Input
                type="text"
                label={t('register.invite_code_label')}
                placeholder={t('register.invite_code_placeholder')}
                value={inviteCode}
                onChange={(e) => {
                  setInviteCode(e.target.value.toUpperCase());
                  setInviteCodeValid(null);
                }}
                onBlur={validateInviteCode}
                startContent={<Ticket className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                endContent={
                  inviteCodeChecking ? (
                    <Spinner size="sm" aria-hidden="true" />
                  ) : inviteCodeValid === true ? (
                    <Check className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                  ) : inviteCodeValid === false ? (
                    <X className="w-4 h-4 text-[var(--color-error)]" aria-hidden="true" />
                  ) : null
                }
                isRequired
                isInvalid={inviteCodeValid === false}
                errorMessage={inviteCodeValid === false ? t('register.invite_code_invalid') : ''}
                description={inviteCodeValid !== false ? t('register.invite_code_description') : undefined}
                classNames={{
                  inputWrapper:
                    'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle uppercase tracking-widest',
                  description: 'text-theme-subtle text-xs',
                }} />
            )}
          </div>
        );

      case 2:
        return (
          <div className="space-y-4">
            {/* Name Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                type="text"
                label={t('register.first_name_label')}
                placeholder={t('register.first_name_placeholder')}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                isRequired
                autoComplete="given-name"
                classNames={{
                  inputWrapper:
                    'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />

              <Input
                type="text"
                label={t('register.last_name_label')}
                placeholder={t('register.last_name_placeholder')}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                isRequired
                autoComplete="family-name"
                description={
                  profileType === 'organisation' ? t('register.admin_only_note') : undefined
                }
                classNames={{
                  inputWrapper:
                    'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                  description: 'text-theme-subtle text-xs',
                }} />
            </div>

            {/* Location */}
            {isLocationAutocompleteActivated ? (
              <Suspense
                fallback={
                  <Input
                    type="text"
                    label={requiredLabel(t('register.location_label'))}
                    placeholder={t('register.location_placeholder')}
                    value={location}
                    onChange={(e) => {
                      setLocation(e.target.value);
                      setLocationTouched(true);
                    }}
                    isRequired
                    isInvalid={locationTouched && !!locationError}
                    errorMessage={locationTouched ? locationError : ''}
                    autoComplete="address-level2"
                    classNames={{
                      inputWrapper: 'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                      label: 'text-theme-muted',
                      input: 'text-theme-primary placeholder:text-theme-subtle',
                    }}
                  />
                }
              >
                <PlaceAutocompleteInput
                  label={requiredLabel(t('register.location_label'))}
                  placeholder={t('register.location_placeholder')}
                  value={location}
                  onChange={(val) => {
                    setLocation(val);
                    setLocationTouched(true);
                  }}
                  onPlaceSelect={(place) => {
                    setLocation(place.formattedAddress);
                    setLatitude(place.lat);
                    setLongitude(place.lng);
                    setLocationTouched(true);
                  }}
                  onClear={() => {
                    setLocation('');
                    setLatitude(undefined);
                    setLongitude(undefined);
                    setLocationTouched(true);
                  }}
                  isRequired
                  isInvalid={locationTouched && !!locationError}
                  errorMessage={locationTouched ? locationError : ''}
                  classNames={{
                    inputWrapper: 'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                    label: 'text-theme-muted',
                    input: 'text-theme-primary placeholder:text-theme-subtle',
                  }}
                />
              </Suspense>
            ) : (
              <Input
                type="text"
                label={requiredLabel(t('register.location_label'))}
                placeholder={t('register.location_placeholder')}
                value={location}
                onFocus={() => setIsLocationAutocompleteActivated(true)}
                onChange={(e) => {
                  setLocation(e.target.value);
                  setLocationTouched(true);
                  setIsLocationAutocompleteActivated(true);
                }}
                isRequired
                isInvalid={locationTouched && !!locationError}
                errorMessage={locationTouched ? locationError : ''}
                autoComplete="address-level2"
                classNames={{
                  inputWrapper: 'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }}
              />
            )}

            {/* Phone */}
            <Input
              type="tel"
              label={requiredLabel(t('register.phone_label'))}
              placeholder={t('register.phone_placeholder')}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onBlur={() => setPhoneTouched(true)}
              startContent={<Phone className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              autoComplete="tel"
              isRequired
              isInvalid={phoneTouched && !!phoneError}
              errorMessage={phoneTouched ? phoneError : ''}
              description={phoneTouched && phoneError ? undefined : t('register.phone_admin_note')}
              classNames={{
                inputWrapper:
                  'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                label: 'text-theme-muted',
                input: 'text-theme-primary placeholder:text-theme-subtle',
                description: 'text-theme-subtle text-xs',
              }} />
          </div>
        );

      case 3:
        return (
          <div className="space-y-4">
            {/* Email */}
            <Input
              type="email"
              label={t('register.email_label')}
              placeholder={t('register.email_placeholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              startContent={<Mail className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              isRequired
              autoComplete="email"
              classNames={{
                inputWrapper:
                  'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                label: 'text-theme-muted',
                input: 'text-theme-primary placeholder:text-theme-subtle',
              }} />

            {/* Password */}
            <div>
              <Input
                type={showPassword ? 'text' : 'password'}
                label={t('register.password_label')}
                placeholder={t('register.password_placeholder')}
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
                    aria-label={showPassword ? t('register.hide_password') : t('register.show_password')}
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" aria-hidden="true" />
                    )}
                  </Button>
                }
                isRequired
                autoComplete="new-password"
                classNames={{
                  inputWrapper:
                    'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                  label: 'text-theme-muted',
                  input: 'text-theme-primary placeholder:text-theme-subtle',
                }} />

              {/* Password strength — NIST 800-63B aligned: length + HIBP live check */}
              <div className="mt-2">
                <PasswordStrength state={passwordCheck} />
              </div>
            </div>

            {/* Confirm Password */}
            <Input
              type={showPassword ? 'text' : 'password'}
              label={t('register.confirm_password_label')}
              placeholder={t('register.confirm_password_placeholder')}
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              onFocus={() => setConfirmTouched(true)}
              startContent={<Lock className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
              isRequired
              autoComplete="new-password"
              isInvalid={confirmTouched && passwordConfirm.length > 0 && !passwordsMatch}
              color={
                confirmTouched && passwordConfirm.length > 0
                  ? passwordsMatch
                    ? 'success'
                    : 'danger'
                  : 'default'
              }
              errorMessage={
                confirmTouched && passwordConfirm.length > 0 && !passwordsMatch
                  ? t('register.passwords_must_match')
                  : ''
              }
              description={
                confirmTouched && passwordConfirm.length > 0 && passwordsMatch
                  ? t('register.passwords_match')
                  : undefined
              }
              classNames={{
                inputWrapper:
                  'glass-card backdrop-blur-lg border-glass-border hover:border-glass-border-hover',
                label: 'text-theme-muted',
                input: 'text-theme-primary placeholder:text-theme-subtle',
                description: 'text-emerald-600 dark:text-emerald-400',
              }} />
          </div>
        );

      case 4:
        return (
          <div className="space-y-4">
            {/* Consents */}
            <div className="space-y-3">
              {/*
                🔴 Two faults reported by a coordinator running a real sign-up
                (Minehead & Coast, 2026-08-12), both on this consent block:

                1. The control was "almost invisible" on desktop and iOS. It used
                   size="sm", which the local Checkbox wrapper maps to `size-3`
                   — a 12px box. HeroUI v3 itself has no size prop; that mapping
                   is ours. A consent control that carries legal weight is the
                   last place to shrink, so this is size="lg" (20px) with an
                   explicit accent fill so "ticked" is unmistakable.
                2. Opening Terms wiped the whole form. These links used to be
                   plain in-tab <Link>s, and every field on this 4-step wizard
                   lives in component state, so navigating away and coming back
                   discarded the lot. They open in a new tab now. Do NOT revert
                   these to in-tab links, and do NOT "fix" it by persisting the
                   form to storage instead — this step holds the password.
              */}
              <Checkbox
                isSelected={termsAccepted}
                onValueChange={setTermsAccepted}
                size="lg"
                color="primary"
                classNames={{
                  label: 'text-theme-muted text-sm',
                  // Border override, not a whim. The control inherits
                  // --input-border, which in light mode is rgba(0,0,0,0.12) —
                  // roughly 1.2:1 against the card, where WCAG 1.4.11 asks for
                  // 3:1 on a UI component boundary. That faintness, not just the
                  // old 12px size, is what "almost invisible" described. These
                  // two are overridden here rather than by editing the shared
                  // token because --input-border styles every input on the
                  // platform; raising it globally is a design decision, not a
                  // bug fix. If that global change ever happens, delete these.
                  wrapper: 'border-black/50 dark:border-white/50',
                }}
              >
                <span>
                  <Trans
                    i18nKey="register.terms_agreement"
                    t={t}
                    components={{
                      termsLink: <Link to={tenantPath('/terms')} target="_blank" rel="noopener noreferrer" className="text-accent dark:text-accent hover:underline" />,
                      privacyLink: <Link to={tenantPath('/privacy')} target="_blank" rel="noopener noreferrer" className="text-accent dark:text-accent hover:underline" />,
                    }} />
                </span>
              </Checkbox>

              <Checkbox
                isSelected={newsletterOptIn}
                onValueChange={setNewsletterOptIn}
                size="lg"
                color="primary"
                classNames={{
                  label: 'text-theme-muted text-sm',
                  // See the contrast note on the terms checkbox above.
                  wrapper: 'border-black/50 dark:border-white/50',
                }}
              >
                {t('register.newsletter_opt_in')}
              </Checkbox>
            </div>

            {/* Data Protection Notice */}
            <div className="p-3 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-xs text-theme-muted space-y-2">
              <p className="font-medium text-theme-primary">{t('register.data_protection_title')}</p>
              <p>
                {t('register.data_protection_body')}
              </p>
              <p>
                <Link
                  to={tenantPath('/privacy')}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent dark:text-accent hover:underline"
                >
                  {t('register.data_protection_privacy_link')}
                </Link>
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const renderClosedRegistrationNotice = () => (
    <div
      role="alert"
      className="rounded-xl border border-amber-300/70 bg-amber-50 p-4 text-left text-amber-950 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
        <div className="space-y-2">
          <p className="text-sm leading-6">{t('register.registration_closed_body')}</p>
          <Link
            to={tenantPath('/login')}
            className="inline-flex text-sm font-medium text-theme-warning underline underline-offset-4 hover:text-amber-900 dark:hover:text-amber-100"
          >
            {t('register.registration_closed_login')}
          </Link>
        </div>
      </div>
    </div>
  );

  const renderRegistrationPolicyNotice = (status: 'loading' | 'unavailable') => {
    const isUnavailable = status === 'unavailable';

    return (
      <div
        role={isUnavailable ? 'alert' : 'status'}
        aria-live={isUnavailable ? 'assertive' : 'polite'}
        className={`rounded-xl border p-4 text-left ${
          isUnavailable
            ? 'border-red-300/70 bg-red-50 text-red-950 dark:border-red-400/30 dark:bg-red-500/10 dark:text-red-100'
            : 'border-blue-300/70 bg-blue-50 text-blue-950 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-100'
        }`}
      >
        <div className="flex items-start gap-3">
          {isUnavailable ? (
            <ShieldCheck className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-300" aria-hidden="true" />
          ) : (
            <Spinner size="md" aria-hidden="true" />
          )}
          <p className="text-sm leading-6">
            {isUnavailable
              ? t('register.registration_status_unavailable_body')
              : t('register.registration_status_checking_body')}
          </p>
        </div>
      </div>
    );
  };

  // Desktop: Show all fields at once
  // Mobile: Show step-by-step
  const renderForm = () => {
    if (!isMobile) {
      // Desktop view - all fields visible
      const oauthTenantId = selectedTenantId || (tenant?.id ? String(tenant.id) : '');
      return (
        <form onSubmit={handleSubmit} aria-label={t('register.title')} className="space-y-4">
          {oauthTenantId && (
            <div className="space-y-3">
              <SsoButtons tenantId={oauthTenantId} />
              <OAuthButtons intent="register" tenantId={oauthTenantId} />
            </div>
          )}
          {/* Honeypot — single field, off-screen. Multi-field decoys were
              autofilled by browsers and silently blocked real users. */}
          <div aria-hidden="true" className="sr-only">
            <label htmlFor="website">{t('register.honeypot_label')}</label>
            <input ref={honeypotRef} type="text" name="website" id="website" tabIndex={-1} autoComplete="off" />
          </div>

          {/* All steps content */}
          {renderStepContent(1)}
          {renderStepContent(2)}
          {renderStepContent(3)}
          {renderStepContent(4)}

          <Button
            type="submit"
            isLoading={isLoading}
            isDisabled={!isFormValid}
            color="primary"
            className="w-full font-medium"
            size="lg"
            spinner={<Spinner size="sm" aria-hidden="true" />}
          >
            {t('register.submit')}
          </Button>
        </form>
      );
    }

    // Mobile view - step by step
    const oauthTenantIdMobile = selectedTenantId || (tenant?.id ? String(tenant.id) : '');
    return (
      <form onSubmit={handleSubmit} aria-label={t('register.title')} className="space-y-4">
        {currentStep === 1 && oauthTenantIdMobile && (
          <div className="space-y-3">
            <SsoButtons tenantId={oauthTenantIdMobile} />
            <OAuthButtons intent="register" tenantId={oauthTenantIdMobile} />
          </div>
        )}
        {/* Honeypot — single field, off-screen. See desktop block above. */}
        <div aria-hidden="true" className="sr-only">
          <label htmlFor="website">{t('register.honeypot_label')}</label>
          <input ref={honeypotRef} type="text" name="website" id="website" tabIndex={-1} autoComplete="off" />
        </div>

        {/* Step indicator */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-theme-primary">
              {t('register.step_indicator', { step: currentStep, total: STEPS.length })}
            </span>
            <span className="text-sm text-theme-muted">{getStepLabel(currentStep)}</span>
          </div>
          <Progress
            value={progressPercent}
            color="primary"
            size="sm"
            aria-label={t('register.progress_aria', { step: currentStep, total: STEPS.length })} />
          {/* Step dots */}
          <div className="flex justify-between mt-2">
            {STEPS.map((step) => (
              <Button
                key={step.id}
                variant="tertiary"
                size="sm"
                className={`flex min-h-11 flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 leading-none ${
                  step.id === currentStep
                    ? 'bg-accent-soft text-accent'
                    : step.id < currentStep
                      ? 'text-theme-muted'
                      : 'text-theme-subtle'
                }`}
                onPress={() => step.id < currentStep && setCurrentStep(step.id)}
                isDisabled={step.id > currentStep}
                aria-label={t('register.step_button_aria', { step: step.id, label: getStepLabel(step.id) })}
              >
                <div
                  className={`w-2.5 h-2.5 rounded-full ${
                    step.id === currentStep
                      ? 'bg-accent'
                      : step.id < currentStep
                        ? 'bg-emerald-500'
                        : 'bg-theme-elevated'
                  }`} />
                <span className="text-[10px] leading-none">{getStepLabel(step.id)}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* Animated step content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderStepContent(currentStep)}
          </motion.div>
        </AnimatePresence>

        {/* Navigation buttons */}
        <div className="flex gap-3 pt-4">
          {currentStep > 1 && (
            <Button
              type="button"
              variant="tertiary"
              onPress={handleBack}
              className="flex-1 bg-theme-elevated text-theme-secondary"
              startContent={<ChevronLeft className="w-4 h-4" aria-hidden="true" />}
            >
              {t('register.back')}
            </Button>
          )}

          {currentStep < 4 ? (
            <Button
              type="button"
              onPress={handleNext}
              isDisabled={!canProceed()}
              color="primary"
              className={`${currentStep === 1 ? 'w-full' : 'flex-1'} font-medium`}
              endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
            >
              {t('register.continue')}
            </Button>
          ) : (
            <Button
              type="submit"
              isLoading={isLoading}
              isDisabled={!isFormValid}
              color="primary"
              className="flex-1 font-medium"
              spinner={<Spinner size="sm" aria-hidden="true" />}
            >
              {t('register.submit')}
            </Button>
          )}
        </div>
      </form>
    );
  };

  // ── Pending Registration Success Screen ──────────────────────────────────
  if (pendingResult) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md relative z-10"
        >
          <GlassCard className="p-6 sm:p-8">
            <div className="text-center">
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: 1 }}
                className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-success/15"
              >
                {pendingResult.requiresWaitlist ? (
                  <Users className="w-8 h-8 text-accent dark:text-accent" aria-hidden="true" />
                ) : pendingResult.requiresVerification ? (
                  <MailCheck className="w-8 h-8 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="w-8 h-8 text-emerald-500 dark:text-emerald-400" aria-hidden="true" />
                )}
              </motion.div>

              <h1 className="text-xl sm:text-2xl font-bold text-theme-primary mb-2">
                {pendingResult.requiresWaitlist ? t('register.waitlist_title') : t('register.success_title')}
              </h1>

              <div className="space-y-3 mt-4 text-left">
                {pendingResult.requiresWaitlist && (
                  <div className="p-3 rounded-xl bg-accent/10 border border-accent/20 text-sm">
                    <div className="flex items-start gap-3">
                      <Clock aria-hidden="true" className="w-5 h-5 text-accent dark:text-accent flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-accent dark:text-accent">
                          {pendingResult.waitlistPosition
                            ? t('register.waitlist_position', { position: pendingResult.waitlistPosition })
                            : t('register.waitlist_joined')}
                        </p>
                        <p className="text-accent/80 dark:text-accent/80 mt-1">
                          {t('register.waitlist_body')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {pendingResult.requiresVerification && (
                  <div className="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-sm">
                    <div className="flex items-start gap-3">
                      <MailCheck aria-hidden="true" className="w-5 h-5 text-[var(--color-info)] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-blue-600 dark:text-blue-400">{t('register.verify_email_title')}</p>
                        <p className="text-blue-600/80 dark:text-blue-300/80 mt-1">
                          <Trans
                            ns="auth"
                            i18nKey="register.verify_email_body"
                            values={{ email }}
                            components={{ strong: <strong /> }} />
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {pendingResult.requiresApproval && (
                  <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm">
                    <div className="flex items-start gap-3">
                      <ShieldCheck aria-hidden="true" className="w-5 h-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-theme-warning">{t('register.approval_title')}</p>
                        <p className="text-amber-600/80 dark:text-amber-300/80 mt-1">
                          {t('register.approval_body')}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <p className="text-theme-muted text-sm mt-6">
                {pendingResult.requiresWaitlist
                  ? t('register.waitlist_next')
                  : pendingResult.requiresVerification && pendingResult.requiresApproval
                    ? t('register.next_verify_approve')
                    : pendingResult.requiresVerification
                      ? t('register.next_verify')
                      : t('register.next_approve')}
              </p>

              <Button
                color="primary"
                className="mt-6 w-full font-medium"
                size="lg"
                onPress={() => navigate(tenantPath('/login'))}
              >
                {t('register.go_to_login')}
              </Button>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 py-12">
      <PageMeta title={t('page_meta.register.title')} noIndex />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md relative z-10"
      >
        <GlassCard className="p-6 sm:p-8">
          {/* Header */}
          <div className="text-center mb-6 sm:mb-8">
            <motion.div
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 sm:h-16 sm:w-16"
            >
              <User className="w-7 h-7 sm:w-8 sm:h-8 text-accent dark:text-accent" aria-hidden="true" />
            </motion.div>
            <h1 className="text-xl sm:text-2xl font-bold text-theme-primary">{registerHeaderTitle}</h1>
            {registerHeaderSubtitle && (
              <p className="text-theme-muted mt-2 text-sm sm:text-base">
                {registerHeaderSubtitle}
              </p>
            )}
          </div>

          {/* Error Alert */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-theme-danger text-sm"
              role="alert"
            >
              {error}
            </motion.div>
          )}

          {/* Form */}
          {registrationClosed
            ? renderClosedRegistrationNotice()
            : registrationPolicyUnavailable
              ? renderRegistrationPolicyNotice('unavailable')
              : registrationPolicyLoading
                ? renderRegistrationPolicyNotice('loading')
                : renderForm()}

          {/* Divider */}
          <Separator className="my-6 bg-theme-elevated" />

          {/* Login Link */}
          <p className="text-center text-theme-muted text-sm">
            {t('register.have_account')}{' '}
            <Link
              to={tenantPath('/login')}
              className="text-accent dark:text-accent hover:text-accent dark:hover:text-accent font-medium transition-colors"
            >
              {t('register.sign_in_link')}
            </Link>
          </p>
        </GlassCard>

        {/* Back to home link */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-6 text-center"
        >
          <Link
            to={tenantPath('/')}
            className="inline-flex items-center gap-2 text-theme-subtle hover:text-theme-muted text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            {t('register.back_to_home')}
          </Link>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default RegisterPage;
