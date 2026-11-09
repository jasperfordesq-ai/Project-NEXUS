// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';

/**
 * Federation Onboarding Page - Step-by-step wizard for first-time federation setup
 *
 * 4-step wizard:
 *  1. Welcome    - Benefits overview
 *  2. Privacy    - Profile visibility switches
 *  3. Communication - Messaging, transactions, service reach
 *  4. Confirmation  - Summary + enable
 *
 * Route: /federation/onboarding
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import Globe from 'lucide-react/icons/globe';
import Users from 'lucide-react/icons/users';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Eye from 'lucide-react/icons/eye';
import Search from 'lucide-react/icons/search';
import Zap from 'lucide-react/icons/zap';
import MapPin from 'lucide-react/icons/map-pin';
import Star from 'lucide-react/icons/star';
import Send from 'lucide-react/icons/send';
import CreditCard from 'lucide-react/icons/credit-card';
import Mail from 'lucide-react/icons/mail';
import Shield from 'lucide-react/icons/shield';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Sparkles from 'lucide-react/icons/sparkles';
import HandHeart from 'lucide-react/icons/hand-heart';
import Network from 'lucide-react/icons/network';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { usePageTitle } from '@/hooks';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { fetchUserFederationOptIn } from '@/lib/federationStatus';
import { logError } from '@/lib/logger';
import type { FederationPartner } from '@/types/api';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ServiceReach = 'local_only' | 'remote_ok' | 'travel_ok';

interface OnboardingSettings {
  // Step 2 â€” Privacy
  profile_visible_federated: boolean;
  appear_in_federated_search: boolean;
  show_skills_federated: boolean;
  show_location_federated: boolean;
  show_reviews_federated: boolean;
  // Step 3 â€” Communication
  messaging_enabled_federated: boolean;
  transactions_enabled_federated: boolean;
  email_notifications: boolean;
  service_reach: ServiceReach;
  travel_radius_km: number;
}

const DEFAULT_SETTINGS: OnboardingSettings = {
  profile_visible_federated: true,
  appear_in_federated_search: true,
  show_skills_federated: true,
  show_location_federated: false,
  show_reviews_federated: true,
  messaging_enabled_federated: true,
  transactions_enabled_federated: true,
  email_notifications: true,
  service_reach: 'local_only',
  travel_radius_km: 25,
};

const TOTAL_STEPS = 4;

// HeroUI shared classNames
const selectClassNames = {
  trigger: 'bg-theme-elevated border-theme-default',
  value: 'text-theme-primary',
  label: 'text-theme-muted',
};

const inputClassNames = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function FederationOnboardingPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('onboarding.page_title'));
  const navigate = useNavigate();
  useAuth(); // Ensure authenticated
  const { tenantPath } = useTenant();
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast â€” avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [currentStep, setCurrentStep] = useState(1);
  const [settings, setSettings] = useState<OnboardingSettings>(DEFAULT_SETTINGS);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Idempotency check: redirect already opted-in users straight to the hub
  useEffect(() => {
    let cancelled = false;
    fetchUserFederationOptIn().then((optedIn) => {
      if (cancelled) return;
      if (optedIn) {
        navigate(tenantPath('/federation'), { replace: true });
      }
    }).catch(() => {
      // Non-critical â€” if the check fails, let the wizard proceed normally
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Step 4 â€” partner data
  const [partners, setPartners] = useState<FederationPartner[]>([]);
  const [partnersLoading, setPartnersLoading] = useState(false);

  const loadPartners = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPartnersLoading(true);
      const response = await api.get<FederationPartner[]>('/v2/federation/partners');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setPartners(Array.isArray(response.data) ? response.data : []);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load federation partners', error);
    } finally {
      setPartnersLoading(false);
    }
  }, []);

  // Load partners when reaching step 4
  useEffect(() => {
    if (currentStep === 4) {
      loadPartners();
    }
  }, [currentStep, loadPartners]);

  const updateSetting = useCallback(<K extends keyof OnboardingSettings>(key: K, value: OnboardingSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  const goNext = useCallback(() => {
    setCurrentStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, []);

  const goBack = useCallback(() => {
    setCurrentStep((s) => Math.max(s - 1, 1));
  }, []);

  const handleComplete = useCallback(async () => {
    try {
      setIsSubmitting(true);

      // Single atomic request: opt in + save settings together
      const response = await api.post('/v2/federation/setup', settings);
      if (!response.success) {
        toastRef.current.error(tRef.current('onboarding.toast_setup_failed'), tRef.current('onboarding.toast_enable_error'));
        return;
      }

      toastRef.current.success(tRef.current('onboarding.toast_enabled'), tRef.current('onboarding.toast_welcome'));
      navigate(tenantPath('/federation'));
    } catch (error) {
      logError('Failed to complete federation onboarding', error);
      toastRef.current.error(tRef.current('onboarding.toast_setup_failed'), tRef.current('onboarding.toast_generic_error'));
    } finally {
      setIsSubmitting(false);
    }
  }, [settings, navigate, tenantPath]);

  const handleSkip = useCallback(() => {
    navigate(tenantPath('/federation'));
  }, [navigate, tenantPath]);

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Animation
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const slideVariants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 80 : -80,
      opacity: 0,
    }),
    center: { x: 0, opacity: 1 },
    exit: (direction: number) => ({
      x: direction < 0 ? 80 : -80,
      opacity: 0,
    }),
  };

  // Track slide direction for animation
  const [slideDirection, setSlideDirection] = useState(1);

  const goNextAnimated = useCallback(() => {
    setSlideDirection(1);
    goNext();
  }, [goNext]);

  const goBackAnimated = useCallback(() => {
    setSlideDirection(-1);
    goBack();
  }, [goBack]);

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Render
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="max-w-2xl mx-auto py-6 space-y-6">
      <PageMeta title={t('onboarding.page_title')} noIndex />
      {/* Title — the same soft panel in the community colour that opens the
          offers, events and groups pages (AWID: warmer, more inviting). */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <PublicPageHero
          size="compact"
          title={t('onboarding.title')}
          description={t('onboarding.subtitle')}
          icon={<Network className="h-6 w-6" aria-hidden="true" />}
          accent="indigo"
        />
      </motion.div>

      {/* Progress Bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-theme-subtle">{t('onboarding.step_of', { current: currentStep, total: TOTAL_STEPS })}</span>
          <span className="text-sm text-theme-subtle">
            {currentStep === 1 && t('onboarding.step_welcome')}
            {currentStep === 2 && t('onboarding.step_privacy')}
            {currentStep === 3 && t('onboarding.step_communication')}
            {currentStep === 4 && t('onboarding.step_confirm')}
          </span>
        </div>
        <Progress
          value={(currentStep / TOTAL_STEPS) * 100}
          classNames={{
            indicator: 'bg-gradient-to-r from-accent to-accent-gradient-end',
            track: 'bg-theme-elevated',
          }}
          aria-label={t('onboarding.progress_aria', { current: currentStep, total: TOTAL_STEPS })}
        />
      </motion.div>

      {/* Step Content */}
      <AnimatePresence mode="wait" custom={slideDirection}>
        <motion.div
          key={currentStep}
          custom={slideDirection}
          variants={slideVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: 0.25, ease: 'easeInOut' }}
        >
          {/* â”€â”€â”€ Step 1: Welcome â”€â”€â”€ */}
          {currentStep === 1 && (
            <div className="space-y-6">
              {/* Hero icons */}
              <GlassCard className="p-8 text-center">
                <div className="flex items-center justify-center gap-4 mb-6">
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut' }}
                    className="p-4 rounded-2xl bg-accent/20"
                  >
                    <Globe className="w-10 h-10 text-accent dark:text-accent" aria-hidden="true" />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut', delay: 0.4 }}
                    className="p-4 rounded-2xl bg-accent/20"
                  >
                    <Users className="w-10 h-10 text-accent dark:text-accent" aria-hidden="true" />
                  </motion.div>
                  <motion.div
                    animate={{ y: [0, -6, 0] }}
                    transition={{ repeat: Infinity, duration: 3, ease: 'easeInOut', delay: 0.8 }}
                    className="p-4 rounded-2xl bg-emerald-500/20"
                  >
                    <ArrowRightLeft className="w-10 h-10 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  </motion.div>
                </div>

                <h2 className="text-xl font-bold text-theme-primary mb-2">
                  {t('onboarding.welcome_title')}
                </h2>
                <p className="text-theme-muted max-w-md mx-auto">
                  {t('onboarding.welcome_description')}
                </p>
              </GlassCard>

              {/* Benefit cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <BenefitCard
                  icon={<Sparkles className="w-6 h-6 text-accent" />}
                  title={t('onboarding.benefit_discover_title')}
                  description={t('onboarding.benefit_discover_description')}
                />
                <BenefitCard
                  icon={<HandHeart className="w-6 h-6 text-accent" />}
                  title={t('onboarding.benefit_meet_title')}
                  description={t('onboarding.benefit_meet_description')}
                />
                <BenefitCard
                  icon={<Network className="w-6 h-6 text-emerald-500" />}
                  title={t('onboarding.benefit_exchange_title')}
                  description={t('onboarding.benefit_exchange_description')}
                />
              </div>

              {/* CTA */}
              <div className="flex justify-center">
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white px-8"
                  endContent={<ArrowRight className="w-5 h-5" aria-hidden="true" />}
                  onPress={goNextAnimated}
                >
                  {t('onboarding.get_started')}
                </Button>
              </div>
            </div>
          )}

          {/* â”€â”€â”€ Step 2: Privacy Settings â”€â”€â”€ */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <Eye className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('onboarding.profile_visibility')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('onboarding.profile_visibility_description')}
                </p>

                <div className="space-y-1">
                  <OnboardingToggle
                    icon={<Globe className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_profile_visible')}
                    description={t('onboarding.toggle_profile_visible_desc')}
                    checked={settings.profile_visible_federated}
                    onChange={(v) => updateSetting('profile_visible_federated', v)}
                  />
                  <OnboardingToggle
                    icon={<Search className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_search_visible')}
                    description={t('onboarding.toggle_search_visible_desc')}
                    checked={settings.appear_in_federated_search}
                    onChange={(v) => updateSetting('appear_in_federated_search', v)}
                  />
                  <OnboardingToggle
                    icon={<Zap className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_skills_shared')}
                    description={t('onboarding.toggle_skills_shared_desc')}
                    checked={settings.show_skills_federated}
                    onChange={(v) => updateSetting('show_skills_federated', v)}
                  />
                  <OnboardingToggle
                    icon={<MapPin className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_location_shared')}
                    description={t('onboarding.toggle_location_shared_desc')}
                    checked={settings.show_location_federated}
                    onChange={(v) => updateSetting('show_location_federated', v)}
                  />
                  <OnboardingToggle
                    icon={<Star className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_reviews_visible')}
                    description={t('onboarding.toggle_reviews_visible_desc')}
                    checked={settings.show_reviews_federated}
                    onChange={(v) => updateSetting('show_reviews_federated', v)}
                  />
                </div>
              </GlassCard>

              <StepNavigation
                onBack={goBackAnimated}
                onNext={goNextAnimated}
              />
            </div>
          )}

          {/* â”€â”€â”€ Step 3: Communication Preferences â”€â”€â”€ */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('onboarding.communication_preferences')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('onboarding.communication_preferences_description')}
                </p>

                <div className="space-y-1">
                  <OnboardingToggle
                    icon={<Send className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_messaging')}
                    description={t('onboarding.toggle_messaging_desc')}
                    checked={settings.messaging_enabled_federated}
                    onChange={(v) => updateSetting('messaging_enabled_federated', v)}
                  />
                  <OnboardingToggle
                    icon={<CreditCard className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_transactions')}
                    description={t('onboarding.toggle_transactions_desc')}
                    checked={settings.transactions_enabled_federated}
                    onChange={(v) => updateSetting('transactions_enabled_federated', v)}
                  />
                  <OnboardingToggle
                    icon={<Mail className="w-4 h-4 text-accent" />}
                    label={t('onboarding.toggle_email_notifications')}
                    description={t('onboarding.toggle_email_notifications_desc')}
                    checked={settings.email_notifications}
                    onChange={(v) => updateSetting('email_notifications', v)}
                  />
                </div>
              </GlassCard>

              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('onboarding.service_reach')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('onboarding.service_reach_description')}
                </p>

                <div className="space-y-4">
                  <Select
                    label={t('onboarding.service_availability')}
                    selectedKeys={[settings.service_reach]}
                    onSelectionChange={(keys) => {
                      const value = Array.from(keys)[0] as string;
                      if (value) {
                        updateSetting('service_reach', value as ServiceReach);
                      }
                    }}
                    classNames={selectClassNames}
                  >
                    <SelectItem key="local_only" id="local_only">{t('onboarding.reach_local_only')}</SelectItem>
                    <SelectItem key="remote_ok" id="remote_ok">{t('onboarding.reach_remote_ok')}</SelectItem>
                    <SelectItem key="travel_ok" id="travel_ok">{t('onboarding.reach_travel_ok')}</SelectItem>
                  </Select>

                  {settings.service_reach === 'travel_ok' && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <Input
                        type="number"
                        label={t('onboarding.travel_radius')}
                        placeholder="25"
                        value={String(settings.travel_radius_km)}
                        onChange={(e) => {
                          const num = parseInt(e.target.value, 10);
                          updateSetting('travel_radius_km', isNaN(num) ? 0 : Math.max(0, Math.min(500, num)));
                        }}
                        endContent={
                          <span className="text-theme-subtle text-sm">{t('onboarding.kilometers_short')}</span>
                        }
                        classNames={inputClassNames}
                        description={t('onboarding.travel_radius_description')}
                      />
                    </motion.div>
                  )}
                </div>
              </GlassCard>

              <StepNavigation
                onBack={goBackAnimated}
                onNext={goNextAnimated}
              />
            </div>
          )}

          {/* â”€â”€â”€ Step 4: Confirmation â”€â”€â”€ */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-2 flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                  {t('onboarding.review_settings')}
                </h2>
                <p className="text-theme-muted text-sm mb-6">
                  {t('onboarding.review_settings_description')}
                </p>

                {/* Summary sections */}
                <div className="space-y-4">
                  {/* Privacy summary */}
                  <div>
                    <h3 className="text-sm font-medium text-theme-muted mb-2 flex items-center gap-2">
                      <Eye className="w-4 h-4" aria-hidden="true" />
                      {t('onboarding.profile_visibility')}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <SummaryChip
                        label={t('onboarding.summary_profile_visible')}
                        enabled={settings.profile_visible_federated}
                      />
                      <SummaryChip
                        label={t('onboarding.summary_in_search')}
                        enabled={settings.appear_in_federated_search}
                      />
                      <SummaryChip
                        label={t('onboarding.summary_skills_shared')}
                        enabled={settings.show_skills_federated}
                      />
                      <SummaryChip
                        label={t('onboarding.summary_location_shared')}
                        enabled={settings.show_location_federated}
                      />
                      <SummaryChip
                        label={t('onboarding.summary_reviews_visible')}
                        enabled={settings.show_reviews_federated}
                      />
                    </div>
                  </div>

                  <div className="border-t border-theme-default" />

                  {/* Communication summary */}
                  <div>
                    <h3 className="text-sm font-medium text-theme-muted mb-2 flex items-center gap-2">
                      <Shield className="w-4 h-4" aria-hidden="true" />
                      {t('onboarding.summary_communication')}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      <SummaryChip
                        label={t('onboarding.summary_messaging')}
                        enabled={settings.messaging_enabled_federated}
                      />
                      <SummaryChip
                        label={t('onboarding.summary_transactions')}
                        enabled={settings.transactions_enabled_federated}
                      />
                      <SummaryChip
                        label={t('onboarding.summary_email_alerts')}
                        enabled={settings.email_notifications}
                      />
                    </div>
                  </div>

                  <div className="border-t border-theme-default" />

                  {/* Service reach summary */}
                  <div>
                    <h3 className="text-sm font-medium text-theme-muted mb-2 flex items-center gap-2">
                      <MapPin className="w-4 h-4" aria-hidden="true" />
                      {t('onboarding.service_reach')}
                    </h3>
                    <p className="text-theme-primary">
                      {t(`onboarding.reach_${settings.service_reach}`)}
                      {settings.service_reach === 'travel_ok' && (
                        <span className="text-theme-subtle"> {t('onboarding.up_to_km', { km: settings.travel_radius_km })}</span>
                      )}
                    </p>
                  </div>
                </div>
              </GlassCard>

              {/* Partner communities preview */}
              <GlassCard className="p-6">
                <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                  <Globe className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                  {t('onboarding.partner_communities')}
                </h2>

                {partnersLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-6">
                    <Spinner size="md" />
                  </div>
                ) : partners.length > 0 ? (
                  <div className="space-y-3">
                    <p className="text-theme-muted text-sm">
                      {t('onboarding.partners_available', { count: partners.length })}
                    </p>
                    <div className="space-y-2">
                      {partners.slice(0, 5).map((partner) => (
                        <div
                          key={partner.id}
                          className="flex items-center justify-between p-3 rounded-lg bg-theme-elevated"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-lg bg-accent/20">
                              <Globe className="w-4 h-4 text-accent" aria-hidden="true" />
                            </div>
                            <div>
                              <p className="font-medium text-theme-primary text-sm">{partner.name}</p>
                              {partner.location && (
                                <p className="text-xs text-theme-subtle">{partner.location}</p>
                              )}
                            </div>
                          </div>
                          <Chip size="sm" variant="flat" color="primary">
                            {t('onboarding.member_count', { count: partner.member_count })}
                          </Chip>
                        </div>
                      ))}
                      {partners.length > 5 && (
                        <p className="text-sm text-theme-subtle text-center pt-2">
                          {t('onboarding.and_more', { count: partners.length - 5 })}
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-4">
                    <Globe className="w-10 h-10 text-theme-subtle mx-auto mb-2" aria-hidden="true" />
                    <p className="text-theme-muted text-sm">
                      {t('onboarding.no_partners_yet')}
                    </p>
                  </div>
                )}
              </GlassCard>

              {/* Action buttons */}
              <div className="flex items-center justify-between gap-3">
                <Button
                  variant="light"
                  className="text-theme-muted"
                  onPress={goBackAnimated}
                  startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('onboarding.back')}
                </Button>

                <div className="flex items-center gap-3">
                  <Button
                    variant="light"
                    className="text-theme-subtle"
                    onPress={handleSkip}
                  >
                    {t('onboarding.do_this_later')}
                  </Button>
                  <Button
                    size="lg"
                    className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                    onPress={handleComplete}
                    isLoading={isSubmitting}
                    startContent={!isSubmitting && <CheckCircle className="w-5 h-5" aria-hidden="true" />}
                  >
                    {t('onboarding.enable_federation')}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sub-components
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface OnboardingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ReactNode;
}

function OnboardingToggle({ label, description, checked, onChange, icon }: OnboardingToggleProps) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-theme-elevated">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {icon && (
          <span className="mt-0.5 flex-shrink-0" aria-hidden="true">{icon}</span>
        )}
        <div className="min-w-0">
          <p className="font-medium text-theme-primary">{label}</p>
          <p className="text-sm text-theme-subtle">{description}</p>
        </div>
      </div>
      <Switch
        aria-label={label}
        isSelected={checked}
        onValueChange={onChange}
        classNames={{
          wrapper: 'group-data-[selected=true]:bg-accent',
        }}
      />
    </div>
  );
}

interface BenefitCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

function BenefitCard({ icon, title, description }: BenefitCardProps) {
  return (
    <GlassCard className="p-5 text-center">
      <div className="flex justify-center mb-3" aria-hidden="true">
        {icon}
      </div>
      <h3 className="font-semibold text-theme-primary text-sm mb-1">{title}</h3>
      <p className="text-xs text-theme-subtle">{description}</p>
    </GlassCard>
  );
}

interface SummaryChipProps {
  label: string;
  enabled: boolean;
}

function SummaryChip({ label, enabled }: SummaryChipProps) {
  const { t } = useTranslation('federation');
  return (
    <Chip
      size="sm"
      variant="flat"
      color={enabled ? 'success' : 'default'}
      className={!enabled ? 'opacity-60' : ''}
    >
      {label}: {enabled ? t('onboarding.on') : t('onboarding.off')}
    </Chip>
  );
}

interface StepNavigationProps {
  onBack: () => void;
  onNext: () => void;
  nextLabel?: string;
  isLoading?: boolean;
}

function StepNavigation({ onBack, onNext, nextLabel, isLoading }: StepNavigationProps) {
  const { t } = useTranslation('federation');
  const resolvedNextLabel = nextLabel || t('onboarding.next');
  return (
    <div className="flex items-center justify-between">
      <Button
        variant="light"
        className="text-theme-muted"
        onPress={onBack}
        startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
      >
        {t('onboarding.back')}
      </Button>
      <Button
        className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
        endContent={<ArrowRight className="w-4 h-4" aria-hidden="true" />}
        onPress={onNext}
        isLoading={isLoading}
      >
        {resolvedNextLabel}
      </Button>
    </div>
  );
}

export default FederationOnboardingPage;
