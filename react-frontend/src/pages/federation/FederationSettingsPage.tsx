// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';

/**
 * Federation Settings Page - Configure federation preferences
 *
 * Lets users control profile visibility, communication, and service reach
 * across partner communities in the federation network.
 *
 * Route: /federation/settings
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from '@/lib/motion';

import Settings from 'lucide-react/icons/settings';
import Eye from 'lucide-react/icons/eye';
import MessageSquare from 'lucide-react/icons/message-square';
import MapPin from 'lucide-react/icons/map-pin';
import Save from 'lucide-react/icons/save';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldOff from 'lucide-react/icons/shield-off';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Globe from 'lucide-react/icons/globe';
import Star from 'lucide-react/icons/star';
import Search from 'lucide-react/icons/search';
import Zap from 'lucide-react/icons/zap';
import Send from 'lucide-react/icons/send';
import CreditCard from 'lucide-react/icons/credit-card';
import Mail from 'lucide-react/icons/mail';
import { useTranslation } from 'react-i18next';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { FederationSettings } from '@/types/api';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

type ServiceReach = FederationSettings['service_reach'];

interface SettingsFormData {
  profile_visible_federated: boolean;
  appear_in_federated_search: boolean;
  show_skills_federated: boolean;
  show_location_federated: boolean;
  show_reviews_federated: boolean;
  messaging_enabled_federated: boolean;
  transactions_enabled_federated: boolean;
  email_notifications: boolean;
  service_reach: ServiceReach;
  travel_radius_km: number;
}

const DEFAULT_SETTINGS: SettingsFormData = {
  profile_visible_federated: true,
  appear_in_federated_search: true,
  show_skills_federated: true,
  show_location_federated: false,
  show_reviews_federated: true,
  messaging_enabled_federated: true,
  transactions_enabled_federated: true,
  email_notifications: true,
  service_reach: 'local_only',
  travel_radius_km: 0,
};

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

// HeroUI input classNames
const inputClassNames = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
};

const selectClassNames = {
  trigger: 'bg-theme-elevated border-theme-default',
  value: 'text-theme-primary',
  label: 'text-theme-muted',
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function FederationSettingsPage() {
  const { t } = useTranslation('federation');
  usePageTitle(t('settings.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast â€” avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);
  const [federationOptedIn, setFederationOptedIn] = useState(false);
  const [settings, setSettings] = useState<SettingsFormData>(DEFAULT_SETTINGS);
  const [originalSettings, setOriginalSettings] = useState<SettingsFormData>(DEFAULT_SETTINGS);

  // Track dirty state â€” only enable save when changes exist
  const isDirty = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify(originalSettings);
  }, [settings, originalSettings]);

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Data Loading
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const loadSettings = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setLoadError(null);
      const response = await api.get<{
        settings: FederationSettings;
        enabled: boolean;
      }>('/v2/federation/settings');

      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const s = response.data.settings;
        const formData: SettingsFormData = {
          profile_visible_federated: s.profile_visible_federated ?? DEFAULT_SETTINGS.profile_visible_federated,
          appear_in_federated_search: s.appear_in_federated_search ?? DEFAULT_SETTINGS.appear_in_federated_search,
          show_skills_federated: s.show_skills_federated ?? DEFAULT_SETTINGS.show_skills_federated,
          show_location_federated: s.show_location_federated ?? DEFAULT_SETTINGS.show_location_federated,
          show_reviews_federated: s.show_reviews_federated ?? DEFAULT_SETTINGS.show_reviews_federated,
          messaging_enabled_federated: s.messaging_enabled_federated ?? DEFAULT_SETTINGS.messaging_enabled_federated,
          transactions_enabled_federated: s.transactions_enabled_federated ?? DEFAULT_SETTINGS.transactions_enabled_federated,
          email_notifications: s.email_notifications ?? DEFAULT_SETTINGS.email_notifications,
          service_reach: s.service_reach ?? DEFAULT_SETTINGS.service_reach,
          travel_radius_km: s.travel_radius_km ?? DEFAULT_SETTINGS.travel_radius_km,
        };
        setSettings(formData);
        setOriginalSettings(formData);
        setFederationOptedIn(response.data.enabled ?? s.federation_optin ?? false);
      } else {
        setLoadError(tRef.current('settings.load_error'));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load federation settings', error);
      setLoadError(tRef.current('settings.load_error_retry'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Handlers
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleToggleFederation = useCallback(async () => {
    const endpoint = federationOptedIn ? '/v2/federation/opt-out' : '/v2/federation/opt-in';

    try {
      setIsTogglingStatus(true);
      const response = await api.post(endpoint);
      if (response.success) {
        // Translate the interpolated action word — a hardcoded English
        // 'enabled'/'disabled' produced mixed-language toasts in other locales.
        const action = tRef.current(federationOptedIn ? 'settings.action_disabled' : 'settings.action_enabled');
        setFederationOptedIn(!federationOptedIn);
        toastRef.current.success(
          tRef.current('settings.federation_toggled_title', { action }),
          tRef.current('settings.federation_toggled_description', { action })
        );
      } else {
        toastRef.current.error(tRef.current('settings.action_failed'), tRef.current('settings.toggle_error', { action: federationOptedIn ? tRef.current('settings.disable') : tRef.current('settings.enable') }));
      }
    } catch (error) {
      logError(`Failed to toggle federation`, error);
      toastRef.current.error(tRef.current('settings.action_failed'), tRef.current('settings.toggle_error', { action: federationOptedIn ? tRef.current('settings.disable') : tRef.current('settings.enable') }));
    } finally {
      setIsTogglingStatus(false);
    }
  }, [federationOptedIn]);

  const handleSave = useCallback(async () => {
    try {
      setIsSaving(true);
      const response = await api.put('/v2/federation/settings', settings);
      if (response.success) {
        setOriginalSettings({ ...settings });
        toastRef.current.success(tRef.current('settings.save_success_title'), tRef.current('settings.save_success_description'));
      } else {
        toastRef.current.error(tRef.current('settings.save_failed_title'), tRef.current('settings.save_failed_description'));
      }
    } catch (error) {
      logError('Failed to save federation settings', error);
      toastRef.current.error(tRef.current('settings.save_failed_title'), tRef.current('settings.save_failed_retry'));
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof SettingsFormData>(key: K, value: SettingsFormData[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }, []);

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Loading / Error States
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Breadcrumbs items={[
          { label: t('settings.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('settings.breadcrumb_settings') },
        ]} />
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Settings className="w-7 h-7 text-accent dark:text-accent" aria-hidden="true" />
            {t('settings.heading')}
          </h1>
          <p className="text-theme-muted mt-1">
            {t('settings.subheading')}
          </p>
        </div>
        <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex items-center justify-center py-20">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto">
        <Breadcrumbs items={[
          { label: t('settings.breadcrumb_federation'), href: tenantPath('/federation') },
          { label: t('settings.breadcrumb_settings') },
        ]} />
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{loadError}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            onPress={loadSettings}
          >
            {t('settings.try_again')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Render
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-3xl mx-auto space-y-6"
    >
      <PageMeta title={t('settings.page_title')} noIndex />
      {/* Breadcrumbs */}
      <Breadcrumbs items={[
        { label: t('settings.breadcrumb_federation'), href: tenantPath('/federation') },
        { label: t('settings.breadcrumb_settings') },
      ]} />

      {/* Header */}
      <motion.div variants={itemVariants}>
        <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
          <Settings className="w-7 h-7 text-accent dark:text-accent" aria-hidden="true" />
          {t('settings.heading')}
        </h1>
        <p className="text-theme-muted mt-1">
          {t('settings.subheading')}
        </p>
      </motion.div>

      {/* â”€â”€â”€ Status Banner â”€â”€â”€ */}
      <motion.div variants={itemVariants}>
        {federationOptedIn ? (
          <GlassCard className="p-4 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-success">{t('settings.federation_active')}</p>
                  <p className="text-sm text-theme-subtle">
                    {t('settings.federation_active_description')}
                  </p>
                </div>
              </div>
              <Button
                variant="flat"
                className="bg-red-500/10 text-red-600 dark:text-red-400"
                onPress={handleToggleFederation}
                isLoading={isTogglingStatus}
              >
                {t('settings.disable_federation')}
              </Button>
            </div>
          </GlassCard>
        ) : (
          <GlassCard className="p-4 border-l-4 border-l-amber-500">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <ShieldOff className="w-5 h-5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-warning">{t('settings.federation_disabled')}</p>
                  <p className="text-sm text-theme-subtle">
                    {t('settings.federation_disabled_description')}
                  </p>
                </div>
              </div>
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                onPress={handleToggleFederation}
                isLoading={isTogglingStatus}
              >
                {t('settings.enable_federation')}
              </Button>
            </div>
          </GlassCard>
        )}
      </motion.div>

      {/* â”€â”€â”€ 1. Profile Visibility â”€â”€â”€ */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-6 flex items-center gap-2">
            <Eye className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
            {t('settings.profile_visibility')}
          </h2>

          <div className="space-y-1">
            <SettingToggle
              icon={<Globe className="w-4 h-4 text-accent" />}
              label={t('settings.show_profile_label')}
              description={t('settings.show_profile_description')}
              checked={settings.profile_visible_federated}
              onChange={(v) => updateSetting('profile_visible_federated', v)}
            />
            <SettingToggle
              icon={<Search className="w-4 h-4 text-accent" />}
              label={t('settings.appear_search_label')}
              description={t('settings.appear_search_description')}
              checked={settings.appear_in_federated_search}
              onChange={(v) => updateSetting('appear_in_federated_search', v)}
            />
            <SettingToggle
              icon={<Zap className="w-4 h-4 text-accent" />}
              label={t('settings.share_skills_label')}
              description={t('settings.share_skills_description')}
              checked={settings.show_skills_federated}
              onChange={(v) => updateSetting('show_skills_federated', v)}
            />
            <SettingToggle
              icon={<MapPin className="w-4 h-4 text-accent" />}
              label={t('settings.share_location_label')}
              description={t('settings.share_location_description')}
              checked={settings.show_location_federated}
              onChange={(v) => updateSetting('show_location_federated', v)}
            />
            <SettingToggle
              icon={<Star className="w-4 h-4 text-accent" />}
              label={t('settings.show_reviews_label')}
              description={t('settings.show_reviews_description')}
              checked={settings.show_reviews_federated}
              onChange={(v) => updateSetting('show_reviews_federated', v)}
              help={t('settings.show_reviews_federated.help')}
            />
          </div>
        </GlassCard>
      </motion.div>

      {/* â”€â”€â”€ 2. Communication â”€â”€â”€ */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-6 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
            {t('settings.communication')}
          </h2>

          <div className="space-y-1">
            <SettingToggle
              icon={<Send className="w-4 h-4 text-accent" />}
              label={t('settings.allow_messaging_label')}
              description={t('settings.allow_messaging_description')}
              checked={settings.messaging_enabled_federated}
              onChange={(v) => updateSetting('messaging_enabled_federated', v)}
            />
            <SettingToggle
              icon={<CreditCard className="w-4 h-4 text-accent" />}
              label={t('settings.allow_transactions_label')}
              description={t('settings.allow_transactions_description')}
              checked={settings.transactions_enabled_federated}
              onChange={(v) => updateSetting('transactions_enabled_federated', v)}
            />
            <SettingToggle
              icon={<Mail className="w-4 h-4 text-accent" />}
              label={t('settings.email_notifications_label')}
              description={t('settings.email_notifications_description')}
              checked={settings.email_notifications}
              onChange={(v) => updateSetting('email_notifications', v)}
            />
          </div>
        </GlassCard>
      </motion.div>

      {/* â”€â”€â”€ 3. Service Reach â”€â”€â”€ */}
      <motion.div variants={itemVariants}>
        <GlassCard className="p-6">
          <h2 className="text-lg font-semibold text-theme-primary mb-6 flex items-center gap-2">
            <MapPin className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
            {t('settings.service_reach')}
          </h2>

          <div className="space-y-4">
            <Select
              label={t('settings.service_availability')}
              selectedKeys={[settings.service_reach]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0] as string;
                if (value) {
                  updateSetting('service_reach', value as ServiceReach);
                }
              }}
              classNames={selectClassNames}
            >
              <SelectItem key="local_only" id="local_only">{t('settings.reach_local_only')}</SelectItem>
              <SelectItem key="remote_ok" id="remote_ok">{t('settings.reach_remote_ok')}</SelectItem>
              <SelectItem key="travel_ok" id="travel_ok">{t('settings.reach_travel_ok')}</SelectItem>
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
                  label={t('settings.travel_radius')}
                  placeholder="25"
                  value={String(settings.travel_radius_km)}
                  onChange={(e) => {
                    const num = parseInt(e.target.value, 10);
                    updateSetting('travel_radius_km', isNaN(num) ? 0 : Math.max(0, Math.min(500, num)));
                  }}
                  endContent={
                    <span className="text-theme-subtle text-sm">{t('settings.kilometers_short')}</span>
                  }
                  classNames={inputClassNames}
                  description={t('settings.travel_radius_description')}
                />
              </motion.div>
            )}
          </div>
        </GlassCard>
      </motion.div>

      {/* â”€â”€â”€ Save Button â”€â”€â”€ */}
      <motion.div variants={itemVariants} className="flex justify-end">
        <Button
          onPress={handleSave}
          className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
          startContent={<Save className="w-4 h-4" aria-hidden="true" />}
          isLoading={isSaving}
          isDisabled={!isDirty}
        >
          {t('settings.save_settings')}
        </Button>
      </motion.div>
    </motion.div>
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Sub-components
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface SettingToggleProps {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  icon?: React.ReactNode;
  help?: string;
}

function SettingToggle({ label, description, checked, onChange, icon, help }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between p-4 rounded-lg bg-theme-elevated">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        {icon && (
          <span className="mt-0.5 flex-shrink-0" aria-hidden="true">{icon}</span>
        )}
        <div className="min-w-0">
          <p className="font-medium text-theme-primary">{label}</p>
          <p className="text-sm text-theme-subtle">{description}</p>
          {help && (
            <p className="text-xs text-theme-subtle/80 mt-1 italic">{help}</p>
          )}
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

export default FederationSettingsPage;
