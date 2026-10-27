// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MerchantOnboardingPage — Self-serve business onboarding wizard (AG48).
 *
 * 4-step wizard:
 *   1. Business Profile  — identity, seller type, registration
 *   2. Location & Hours  — address fields + weekly schedule grid
 *   3. Profile Photo     — avatar upload (+ optional cover image)
 *   4. Complete          — summary + "Launch your shop" CTA → badge grant
 *
 * Feature gate: marketplace must be enabled.
 * Auth required.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

import Building2 from 'lucide-react/icons/building-2';
import MapPin from 'lucide-react/icons/map-pin';
import Clock from 'lucide-react/icons/clock';
import Camera from 'lucide-react/icons/camera';
import PartyPopper from 'lucide-react/icons/party-popper';
import Award from 'lucide-react/icons/award';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Upload from 'lucide-react/icons/upload';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { safeImageSource } from '@/lib/safeImageSource';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';
import { useLoginRedirect } from '@/hooks/useLoginRedirect';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface SellerProfile {
  id?: number;
  seller_type?: string;
  business_name?: string;
  display_name?: string;
  bio?: string;
  business_registration?: string;
  business_address?: string | Record<string, string>;
  opening_hours?: string | Record<string, { open: string; close: string } | null>;
  avatar_url?: string;
  cover_image_url?: string;
  onboarding_completed_at?: string | null;
}

interface OnboardingStatus {
  has_profile: boolean;
  onboarding_completed: boolean;
  profile: SellerProfile | null;
}

interface CompleteResult extends SellerProfile {
  badge_granted: boolean;
}

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

interface DayHours {
  open: string;
  close: string;
}

interface AddressFields {
  street: string;
  city: string;
  postal_code: string;
  country: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const TOTAL_STEPS = 4;

const defaultHours: DayHours = { open: '09:00', close: '18:00' };

// ─────────────────────────────────────────────────────────────────────────────
// Step indicator component
// ─────────────────────────────────────────────────────────────────────────────

interface StepIndicatorProps {
  current: number;
  labels: string[];
}

function StepIndicator({ current, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {labels.map((label, idx) => {
        const step = idx + 1;
        const isComplete = step < current;
        const isActive = step === current;
        return (
          <div key={step} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={[
                  'w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors',
                  isComplete
                    ? 'bg-success border-success text-white'
                    : isActive
                      ? 'bg-accent border-accent text-white'
                      : 'bg-[var(--color-surface)] border-border text-muted',
                ].join(' ')}
              >
                {isComplete ? <CheckCircle2 size={16} /> : step}
              </div>
              <span
                className={[
                  'mt-1 text-xs hidden sm:block max-w-[72px] text-center leading-tight',
                  isActive ? 'text-accent font-medium' : 'text-muted',
                ].join(' ')}
              >
                {label}
              </span>
            </div>
            {idx < labels.length - 1 && (
              <div
                className={[
                  'h-0.5 w-12 sm:w-16 mx-1 mb-4 transition-colors',
                  isComplete ? 'bg-success' : 'bg-surface-tertiary',
                ].join(' ')}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MerchantOnboardingPage() {
  const { t } = useTranslation('merchant_onboarding');
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  const { loginTarget } = useLoginRedirect(tenantPath);

  usePageTitle(t('meta.title'));

  // ── State ─────────────────────────────────────────────────────────────────
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [badgeGranted, setBadgeGranted] = useState(false);

  // Step 1
  const [sellerType, setSellerType] = useState<'private' | 'business'>('business');
  const [businessName, setBusinessName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [businessReg, setBusinessReg] = useState('');

  // Step 2 — address
  const [address, setAddress] = useState<AddressFields>({
    street: '',
    city: '',
    postal_code: '',
    country: '',
  });

  // Step 2 — opening hours: key → DayHours | null (null = closed)
  const [openingHours, setOpeningHours] = useState<Record<DayKey, DayHours | null>>({
    mon: { ...defaultHours },
    tue: { ...defaultHours },
    wed: { ...defaultHours },
    thu: { ...defaultHours },
    fri: { ...defaultHours },
    sat: { ...defaultHours },
    sun: null,
  });

  // Step 3
  const [avatarUrl, setAvatarUrl] = useState('');
  const [coverImageUrl, setCoverImageUrl] = useState('');
  const [avatarObjectUrl, setAvatarObjectUrl] = useState('');
  const [coverObjectUrl, setCoverObjectUrl] = useState('');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const avatarPreviewSource = safeImageSource(avatarObjectUrl, { allowBlob: true })
    ?? safeImageSource(avatarUrl);
  const coverPreviewSource = safeImageSource(coverObjectUrl, { allowBlob: true })
    ?? safeImageSource(coverImageUrl);

  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (avatarObjectUrl) URL.revokeObjectURL(avatarObjectUrl);
  }, [avatarObjectUrl]);

  useEffect(() => () => {
    if (coverObjectUrl) URL.revokeObjectURL(coverObjectUrl);
  }, [coverObjectUrl]);

  // ── Auth / feature guard ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated) {
      const login = loginTarget();
      navigate(login.to, { replace: true, state: login.state });
      return;
    }
    if (!hasFeature('marketplace')) {
      navigate(tenantPath('/marketplace'), { replace: true });
      return;
    }
  }, [isAuthenticated, navigate, tenantPath, hasFeature, loginTarget]);

  // ── Load existing status ──────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !hasFeature('marketplace')) return;

    (async () => {
      try {
        const res = await api.get<OnboardingStatus>('/v2/merchant-onboarding/status');
        const status = res.data;
        if (!status) return;

        if (status.onboarding_completed) {
          setCompleted(true);
          setLoading(false);
          return;
        }

        if (status.profile) {
          const p = status.profile;
          if (p.seller_type === 'private' || p.seller_type === 'business') {
            setSellerType(p.seller_type);
          }
          if (p.business_name) setBusinessName(p.business_name);
          if (p.display_name) setDisplayName(p.display_name);
          if (p.bio) setBio(p.bio);
          if (p.business_registration) setBusinessReg(p.business_registration);
          if (p.avatar_url) {
            setAvatarUrl(p.avatar_url);
          }
          if (p.cover_image_url) {
            setCoverImageUrl(p.cover_image_url);
          }
          // Hydrate address
          if (p.business_address) {
            const addr =
              typeof p.business_address === 'string'
                ? (JSON.parse(p.business_address) as AddressFields)
                : (p.business_address as unknown as AddressFields);
            setAddress({
              street: addr.street ?? '',
              city: addr.city ?? '',
              postal_code: addr.postal_code ?? '',
              country: addr.country ?? '',
            });
          }
          // Hydrate opening hours
          if (p.opening_hours) {
            const raw =
              typeof p.opening_hours === 'string'
                ? (JSON.parse(p.opening_hours) as Record<string, DayHours | null>)
                : (p.opening_hours as Record<string, DayHours | null>);
            setOpeningHours(prev => {
              const next = { ...prev };
              (Object.keys(raw) as DayKey[]).forEach(d => {
                next[d] = raw[d] ?? null;
              });
              return next;
            });
          }
        }
      } catch (err) {
        logError('MerchantOnboardingPage: status load', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [isAuthenticated, hasFeature]);

  // ── Step savers ───────────────────────────────────────────────────────────
  const saveStep1 = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const response = await api.post('/v2/merchant-onboarding/step-1', {
        seller_type: sellerType,
        business_name: businessName,
        display_name: displayName,
        bio,
        business_registration: businessReg || undefined,
      });
      if (!response.success) {
        showToast(response.error || t('errors.save_failed'), 'error');
      }
      return response.success;
    } catch (err) {
      logError('MerchantOnboardingPage: saveStep1', err);
      showToast(t('errors.save_failed'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [sellerType, businessName, displayName, bio, businessReg, showToast, t]);

  const saveStep2 = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    try {
      const response = await api.post('/v2/merchant-onboarding/step-2', {
        business_address: address,
        opening_hours: openingHours,
      });
      if (!response.success) {
        showToast(response.error || t('errors.save_failed'), 'error');
      }
      return response.success;
    } catch (err) {
      logError('MerchantOnboardingPage: saveStep2', err);
      showToast(t('errors.save_failed'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [address, openingHours, showToast, t]);

  const saveStep3 = useCallback(async (): Promise<boolean> => {
    if (!avatarUrl) return true; // photo is optional — allow skipping
    setSaving(true);
    try {
      const response = await api.post('/v2/merchant-onboarding/step-3', {
        avatar_url: avatarUrl || undefined,
        cover_image_url: coverImageUrl || undefined,
      });
      if (!response.success) {
        showToast(response.error || t('errors.save_failed'), 'error');
      }
      return response.success;
    } catch (err) {
      logError('MerchantOnboardingPage: saveStep3', err);
      showToast(t('errors.save_failed'), 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }, [avatarUrl, coverImageUrl, showToast, t]);

  const handleComplete = useCallback(async () => {
    setSaving(true);
    try {
      const res = await api.post<CompleteResult>('/v2/merchant-onboarding/complete', {});
      if (res.success) {
        setBadgeGranted(res.data?.badge_granted ?? false);
        setCompleted(true);
      } else {
        showToast(res.error || t('errors.complete_failed'), 'error');
      }
    } catch (err) {
      logError('MerchantOnboardingPage: complete', err);
      showToast(t('errors.complete_failed'), 'error');
    } finally {
      setSaving(false);
    }
  }, [showToast, t]);

  // ── Navigation ────────────────────────────────────────────────────────────
  const handleNext = useCallback(async () => {
    let ok = false;
    if (step === 1) ok = await saveStep1();
    else if (step === 2) ok = await saveStep2();
    else if (step === 3) ok = await saveStep3();
    if (ok) setStep(s => s + 1);
  }, [step, saveStep1, saveStep2, saveStep3]);

  const handleBack = useCallback(() => {
    setStep(s => Math.max(1, s - 1));
  }, []);

  // ── File upload helpers ───────────────────────────────────────────────────
  const handleAvatarFile = useCallback(
    async (file: File) => {
      setUploadingAvatar(true);
      try {
        const res = await api.upload<{ url: string }>('/v2/merchant-onboarding/image', file, 'avatar');
        const url = res.data?.url ?? '';
        setAvatarUrl(url);
        setAvatarObjectUrl(URL.createObjectURL(file));
      } catch {
        // Fallback: show URL input instead (graceful degradation)
        setAvatarObjectUrl(URL.createObjectURL(file));
      } finally {
        setUploadingAvatar(false);
      }
    },
    []
  );

  const handleCoverFile = useCallback(
    async (file: File) => {
      setUploadingCover(true);
      try {
        const res = await api.upload<{ url: string }>('/v2/merchant-onboarding/image', file, 'cover_image');
        const url = res.data?.url ?? '';
        setCoverImageUrl(url);
        setCoverObjectUrl(URL.createObjectURL(file));
      } catch {
        setCoverObjectUrl(URL.createObjectURL(file));
      } finally {
        setUploadingCover(false);
      }
    },
    []
  );

  // ── Opening hours helpers ─────────────────────────────────────────────────
  const toggleDay = (day: DayKey) => {
    setOpeningHours(prev => ({
      ...prev,
      [day]: prev[day] === null ? { ...defaultHours } : null,
    }));
  };

  const setDayTime = (day: DayKey, field: 'open' | 'close', value: string) => {
    setOpeningHours(prev => ({
      ...prev,
      [day]: prev[day] ? { ...prev[day]!, [field]: value } : prev[day],
    }));
  };

  // ── Step labels ───────────────────────────────────────────────────────────
  const stepLabels = [
    t('steps.profile'),
    t('steps.location'),
    t('steps.photo'),
    t('steps.complete'),
  ];

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center min-h-[60vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  // ── Already completed ─────────────────────────────────────────────────────
  if (completed && step < TOTAL_STEPS) {
    return (
      <div className="max-w-xl mx-auto px-4 py-12 text-center space-y-6">
        <PartyPopper size={56} className="mx-auto text-warning" />
        <h1 className="text-3xl font-bold text-[var(--color-text)]">{t('success_title')}</h1>
        {badgeGranted && (
          <Chip color="warning" variant="soft" startContent={<Award size={14} />}>
            {t('badge_earned')}
          </Chip>
        )}
        <Button
          size="lg"
          endContent={<ArrowRight size={16} />}
          onPress={() => navigate(tenantPath('/marketplace/sell'))}
        >
          {t('success_cta')}
        </Button>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageMeta
        title={t('meta.title')}
        description={t('meta.description')}
        url={tenantPath('/marketplace/become-partner')}
        noIndex
      />

      {/* Hero */}
      <div className="text-center mb-8">
        <Building2 size={44} className="mx-auto mb-3 text-accent" />
        <h1 className="text-2xl sm:text-3xl font-bold text-[var(--color-text)]">
          {t('hero_title')}
        </h1>
        <p className="mt-2 text-muted text-sm sm:text-base">
          {t('hero_subtitle')}
        </p>
        <p className="mt-1 text-xs text-muted">
          {t('step_of', { current: step, total: TOTAL_STEPS })}
        </p>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} labels={stepLabels} />

      <GlassCard className="p-6">

        {/* ── Step 1: Business Profile ─────────────────────────────────── */}
        {step === 1 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Building2 size={20} className="text-accent" />
              {t('steps.profile')}
            </h2>

            <RadioGroup
              label={t('seller_type')}
              orientation="horizontal"
              value={sellerType}
              onValueChange={v => setSellerType(v as 'private' | 'business')}
            >
              <Radio value="private">{t('private')}</Radio>
              <Radio value="business">{t('business')}</Radio>
            </RadioGroup>

            {sellerType === 'business' && (
              <Input
                label={t('business_name')}
                variant="secondary"
                value={businessName}
                onValueChange={setBusinessName}
                isRequired
              />
            )}

            <Input
              label={t('display_name')}
              variant="secondary"
              value={displayName}
              onValueChange={setDisplayName}
            />

            <Textarea
              label={t('bio')}
              variant="secondary"
              value={bio}
              onValueChange={setBio}
              minRows={3}
              maxRows={6}
            />

            {sellerType === 'business' && (
              <Input
                label={t('business_reg')}
                variant="secondary"
                value={businessReg}
                onValueChange={setBusinessReg}
              />
            )}
          </div>
        )}

        {/* ── Step 2: Location & Hours ─────────────────────────────────── */}
        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
              <MapPin size={20} className="text-accent" />
              {t('steps.location')}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label={t('address_street')}
                variant="secondary"
                className="sm:col-span-2"
                value={address.street}
                onValueChange={v => setAddress(a => ({ ...a, street: v }))}
              />
              <Input
                label={t('address_city')}
                variant="secondary"
                value={address.city}
                onValueChange={v => setAddress(a => ({ ...a, city: v }))}
              />
              <Input
                label={t('address_postal')}
                variant="secondary"
                value={address.postal_code}
                onValueChange={v => setAddress(a => ({ ...a, postal_code: v }))}
              />
              <Input
                label={t('address_country')}
                variant="secondary"
                className="sm:col-span-2"
                value={address.country}
                onValueChange={v => setAddress(a => ({ ...a, country: v }))}
              />
            </div>

            {/* Opening hours grid */}
            <div>
              <p className="text-sm font-medium text-[var(--color-text)] mb-3 flex items-center gap-2">
                <Clock size={16} className="text-accent" />
                {t('opening_hours')}
              </p>
              <div className="space-y-2">
                {DAYS.map(day => {
                  const hours = openingHours[day];
                  const isOpen = hours !== null;
                  return (
                    <div key={day} className="flex items-center gap-3">
                      <span className="w-20 text-sm text-muted shrink-0">
                        {t(`days.${day}`)}
                      </span>
                      <Switch
                        size="sm"
                        isSelected={isOpen}
                        onValueChange={() => toggleDay(day)}
                        aria-label={isOpen ? t('open') : t('closed')}
                      />
                      <span className="text-xs text-muted w-14">
                        {isOpen ? t('open') : t('closed')}
                      </span>
                      {isOpen && (
                        <div className="grid flex-1 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                          <Input
                            type="time"
                            size="sm"
                            variant="secondary"
                            aria-label={t('open_time')}
                            value={hours.open}
                            onValueChange={value => setDayTime(day, 'open', value)}
                            classNames={{
                              base: 'min-w-0',
                              inputWrapper: 'h-9 min-h-9 bg-[var(--color-surface)]',
                              input: 'text-sm',
                            }}
                          />
                          <span className="text-muted text-xs">-</span>
                          <Input
                            type="time"
                            size="sm"
                            variant="secondary"
                            aria-label={t('close_time')}
                            value={hours.close}
                            onValueChange={value => setDayTime(day, 'close', value)}
                            classNames={{
                              base: 'min-w-0',
                              inputWrapper: 'h-9 min-h-9 bg-[var(--color-surface)]',
                              input: 'text-sm',
                            }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Profile Photo ────────────────────────────────────── */}
        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-[var(--color-text)] flex items-center gap-2">
              <Camera size={20} className="text-accent" />
              {t('steps.photo')}
            </h2>

            {/* Avatar */}
            <div className="flex flex-col items-center gap-4">
              {avatarPreviewSource ? (
                <img
                  src={avatarPreviewSource}
                  alt={t('steps.photo')}
                  className="w-24 h-24 rounded-full object-cover border-2 border-accent"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-surface-secondary flex items-center justify-center border-2 border-dashed border-border">
                  <Camera size={32} className="text-muted" />
                </div>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleAvatarFile(file);
                }}
              />
              <Button
                variant="secondary"
                startContent={uploadingAvatar ? <Spinner size="sm" /> : <Upload size={16} />}
                isDisabled={uploadingAvatar}
                onPress={() => avatarInputRef.current?.click()}
              >
                {t('upload_photo')}
              </Button>
              {/* Fallback: manual URL input if upload fails */}
              {!avatarPreviewSource && (
                <Input
                  label={t('paste_image_url')}
                  variant="secondary"
                  size="sm"
                  value={avatarUrl}
                  onValueChange={setAvatarUrl}
                  className="max-w-xs"
                />
              )}
            </div>

            {/* Cover image */}
            <div className="space-y-3">
              {coverPreviewSource && (
                <img
                  src={coverPreviewSource}
                  alt={t('upload_cover')}
                  className="w-full h-32 object-cover rounded-xl border border-separator"
                />
              )}
              <input
                ref={coverInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) handleCoverFile(file);
                }}
              />
              <Button
                variant="secondary"
                size="sm"
                startContent={uploadingCover ? <Spinner size="sm" /> : <Upload size={14} />}
                isDisabled={uploadingCover}
                onPress={() => coverInputRef.current?.click()}
              >
                {t('upload_cover')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Complete ─────────────────────────────────────────── */}
        {step === 4 && !completed && (
          <div className="space-y-5">
            <h2 className="text-lg font-semibold text-[var(--color-text)]">
              {t('complete_title')}
            </h2>
            <p className="text-sm text-muted">{t('complete_summary')}</p>

            {/* Summary card */}
            <div className="rounded-xl border border-separator p-4 space-y-2 text-sm">
              {displayName && (
                <div className="flex gap-2">
                  <span className="font-medium text-muted w-32 shrink-0">{t('display_name')}:</span>
                  <span className="text-[var(--color-text)]">{displayName}</span>
                </div>
              )}
              {businessName && (
                <div className="flex gap-2">
                  <span className="font-medium text-muted w-32 shrink-0">{t('business_name')}:</span>
                  <span className="text-[var(--color-text)]">{businessName}</span>
                </div>
              )}
              {bio && (
                <div className="flex gap-2">
                  <span className="font-medium text-muted w-32 shrink-0">{t('bio')}:</span>
                  <span className="text-[var(--color-text)] line-clamp-2">{bio}</span>
                </div>
              )}
              {address.city && (
                <div className="flex gap-2">
                  <span className="font-medium text-muted w-32 shrink-0">{t('address_city')}:</span>
                  <span className="text-[var(--color-text)]">{address.city}, {address.country}</span>
                </div>
              )}
              {avatarPreviewSource && (
                <div className="flex items-center gap-2 pt-1">
                  <img
                    src={avatarPreviewSource}
                    alt={t('steps.photo')}
                    className="w-10 h-10 rounded-full object-cover border border-separator"
                  />
                </div>
              )}
            </div>

            <Button
              size="lg"
              className="w-full font-semibold"
              isLoading={saving}
              isDisabled={saving}
              onPress={handleComplete}
            >
              {saving ? t('launching') : t('launch')}
            </Button>
          </div>
        )}

        {/* ── Step 4: Success ──────────────────────────────────────────── */}
        {step === 4 && completed && (
          <div className="text-center space-y-5 py-4">
            <PartyPopper size={52} className="mx-auto text-warning" />
            <h2 className="text-2xl font-bold text-[var(--color-text)]">
              {t('success_title')}
            </h2>
            {badgeGranted && (
              <Chip color="warning" variant="soft" startContent={<Award size={14} />} size="lg">
                {t('badge_earned')}
              </Chip>
            )}
            <Button
              size="lg"
              endContent={<ArrowRight size={16} />}
              onPress={() => navigate(tenantPath('/marketplace/sell'))}
            >
              {t('success_cta')}
            </Button>
          </div>
        )}

        {/* ── Navigation buttons ───────────────────────────────────────── */}
        {step < 4 && (
          <div className="flex justify-between mt-6 pt-4 border-t border-separator">
            <Button
              variant="tertiary"
              startContent={<ArrowLeft size={16} />}
              isDisabled={step === 1 || saving}
              onPress={handleBack}
            >
              {t('back')}
            </Button>
            <Button
              endContent={saving ? undefined : <ArrowRight size={16} />}
              isLoading={saving}
              isDisabled={saving}
              onPress={handleNext}
            >
              {saving ? t('saving') : t('next')}
            </Button>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

export default MerchantOnboardingPage;
