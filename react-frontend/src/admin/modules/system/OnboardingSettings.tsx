import { Card, CardBody, CardHeader, Button, Spinner, Input, Textarea, Chip, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import Save from 'lucide-react/icons/save';
import Sparkles from 'lucide-react/icons/sparkles';
import UserCircle from 'lucide-react/icons/circle-user';
import HandHeart from 'lucide-react/icons/hand-heart';
import Shield from 'lucide-react/icons/shield';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Eye from 'lucide-react/icons/eye';
import FileText from 'lucide-react/icons/file-text';
import Globe from 'lucide-react/icons/globe';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin page for configuring the onboarding module per tenant.
 *
 * Sections:
 *  1. Module Control — enabled/disabled, mandatory/optional
 *  2. Step Configuration — each step with enabled/required toggles
 *  3. Profile Requirements — avatar, bio, min bio length
 *  4. Listing Creation — mode selector, max auto-generated
 *  5. Visibility Gating — completion/avatar/bio required for public profile
 *  6. Safeguarding — country preset, options management link
 *  7. Custom Text — welcome text, help text
 *
 * Route: /admin/onboarding-settings
 */


// ── Types ────────────────────────────────────────────────────────────────────

interface OnboardingConfig {
  enabled: boolean;
  mandatory: boolean;
  step_welcome_enabled: boolean;
  step_profile_enabled: boolean;
  step_profile_required: boolean;
  step_skills_enabled: boolean;
  step_skills_required: boolean;
  step_safeguarding_enabled: boolean;
  step_safeguarding_required: boolean;
  step_confirm_enabled: boolean;
  avatar_required: boolean;
  bio_required: boolean;
  bio_min_length: number;
  require_completion_for_visibility: boolean;
  require_avatar_for_visibility: boolean;
  require_bio_for_visibility: boolean;
  welcome_text: string | null;
  help_text: string | null;
  safeguarding_intro_text: string | null;
  country_preset: string;
}

interface SafeguardingOption {
  id: number;
  option_key: string;
  option_type: string;
  label: string;
  description: string | null;
  is_active: boolean;
  is_required: boolean;
  triggers: Record<string, unknown> | null;
  preset_source: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const COUNTRY_PRESET_LABEL_KEYS: Record<string, string> = {
  ireland: 'system.onboarding.preset_ireland',
  united_kingdom: 'system.onboarding.preset_united_kingdom',
  england_wales: 'system.onboarding.preset_england_wales',
  scotland: 'system.onboarding.preset_scotland',
  northern_ireland: 'system.onboarding.preset_northern_ireland',
  custom: 'system.onboarding.preset_custom',
};
const DEFAULT_COUNTRY_PRESET_LABEL_KEY = 'system.onboarding.preset_custom';

const STEP_ICONS: Record<string, typeof Sparkles> = {
  welcome: Sparkles,
  profile: UserCircle,
  skills: HandHeart,
  safeguarding: Shield,
  confirm: CheckCircle,
};

const STEPS_CONFIG = [
  { key: 'welcome', labelKey: 'system.onboarding.step_welcome', descriptionKey: 'system.onboarding.step_welcome_desc' },
  { key: 'profile', labelKey: 'system.onboarding.step_profile', descriptionKey: 'system.onboarding.step_profile_desc' },
  { key: 'skills', labelKey: 'system.onboarding.step_skills', descriptionKey: 'system.onboarding.step_skills_desc' },
  { key: 'safeguarding', labelKey: 'system.onboarding.step_safeguarding', descriptionKey: 'system.onboarding.step_safeguarding_desc' },
  { key: 'confirm', labelKey: 'system.onboarding.step_confirm', descriptionKey: 'system.onboarding.step_confirm_desc' },
];

// ── Component ────────────────────────────────────────────────────────────────

export function OnboardingSettings() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.onboarding.page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const getCountryPresetLabel = (preset: string) =>
    t(COUNTRY_PRESET_LABEL_KEYS[preset] ?? DEFAULT_COUNTRY_PRESET_LABEL_KEY);

  const [config, setConfig] = useState<OnboardingConfig | null>(null);
  const [safeguardingOptions, setSafeguardingOptions] = useState<SafeguardingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [applyingPreset, setApplyingPreset] = useState(false);

  const presetModal = useDisclosure();

  // ── Fetch config on mount ────────────────────────────────────────────────

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const configRes = await api.get<{ config: OnboardingConfig; safeguarding_options: SafeguardingOption[] }>('/v2/admin/config/onboarding');

      if (configRes.success && configRes.data) {
        const data = configRes.data;
        setConfig(data.config);
        setSafeguardingOptions(data.safeguarding_options ?? []);
      }
    } catch (error) {
      logError('Failed to load onboarding config', error);
      toast.error(t('system.onboarding.failed_to_load'), t('system.onboarding.please_try_again'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);


  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  // ── Save handler ─────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    if (!config) return;
    try {
      setSaving(true);
      const res = await api.put('/v2/admin/config/onboarding', config);
      if (res.success) {
        toast.success(t('system.onboarding.settings_saved'), t('system.onboarding.config_updated'));
      } else {
        toast.error(t('system.onboarding.save_failed'), t('system.onboarding.please_try_again'));
      }
    } catch (error) {
      logError('Failed to save onboarding config', error);
      toast.error(t('system.onboarding.save_failed'), t('system.onboarding.please_try_again'));
    } finally {
      setSaving(false);
    }
  }, [config, t, toast]);


  // ── Apply preset handler ─────────────────────────────────────────────────

  const handleApplyPreset = useCallback(async () => {
    if (!config) return;
    try {
      setApplyingPreset(true);
      const res = await api.post<{ options_created: string[] }>('/v2/admin/config/onboarding/apply-preset', {
        preset: config.country_preset,
      });
      if (res.success) {
        const created = res.data?.options_created ?? [];
        if (created.length > 0) {
          toast.success(t('system.onboarding.preset_applied'), t('system.onboarding.preset_created_options'));
        } else {
          toast.info(t('system.onboarding.no_changes'), t('system.onboarding.preset_already_exists'));
        }
        presetModal.onClose();
        fetchConfig();
      } else {
        toast.error(t('system.onboarding.failed_to_apply_preset'), t('system.onboarding.please_try_again'));
      }
    } catch (error) {
      logError('Failed to apply preset', error);
      toast.error(t('system.onboarding.failed_to_apply_preset'), t('system.onboarding.please_try_again'));
    } finally {
      setApplyingPreset(false);
    }
  }, [config, t, toast, fetchConfig, presetModal]);


  // ── Helpers ──────────────────────────────────────────────────────────────

  const updateConfig = useCallback((key: keyof OnboardingConfig, value: unknown) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
      </div>
    );
  }

  const activeOptionCount = safeguardingOptions.filter(o => o.is_active).length;

  return (
    <div>
      <PageHeader
        title={t('system.onboarding.page_title')}
        description={t('system.onboarding.page_description')}
      />

      <div className="space-y-6">

        {/* Section 1: Module Control */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold">{t('system.onboarding.module_control')}</h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.module_control_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <Switch isSelected={config.enabled} onValueChange={(v) => updateConfig('enabled', v)}>
              <div>
                <p className="font-medium">{t('system.onboarding.onboarding_enabled')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.onboarding_enabled_desc')}</p>
              </div>
            </Switch>
            <Switch isSelected={config.mandatory} onValueChange={(v) => updateConfig('mandatory', v)} isDisabled={!config.enabled}>
              <div>
                <p className="font-medium">{t('system.onboarding.onboarding_mandatory')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.onboarding_mandatory_desc')}</p>
              </div>
            </Switch>
          </CardBody>
        </Card>

        {/* Section 2: Step Configuration */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold">{t('system.onboarding.step_configuration')}</h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.step_configuration_desc')}</p>
          </CardHeader>
          <CardBody>
            <div className="space-y-3">
              {STEPS_CONFIG.map((step) => {
                const enabledKey = `step_${step.key}_enabled` as keyof OnboardingConfig;
                const requiredKey = `step_${step.key}_required` as keyof OnboardingConfig;
                const Icon = STEP_ICONS[step.key] || Sparkles;
                const isEnabled = config[enabledKey] as boolean;
                const hasRequired = requiredKey in config;

                return (
                  <div key={step.key} className="flex items-center justify-between p-3 rounded-lg bg-theme-elevated">
                    <div className="flex items-center gap-3">
                      <Icon aria-hidden="true" className="w-5 h-5 text-theme-muted" />
                      <div>
                        <p className="font-medium text-sm">{t(step.labelKey)}</p>
                        <p className="text-xs text-theme-muted">{t(step.descriptionKey)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <Switch size="sm" isSelected={isEnabled} onValueChange={(v) => updateConfig(enabledKey, v)} aria-label={t('system.onboarding.enable_step')}>
                        <span className="text-xs">{t('system.onboarding.enabled')}</span>
                      </Switch>
                      {hasRequired && (
                        <Switch size="sm" isSelected={config[requiredKey] as boolean} onValueChange={(v) => updateConfig(requiredKey, v)} isDisabled={!isEnabled} aria-label={t('system.onboarding.require_step')}>
                          <span className="text-xs">{t('system.onboarding.required')}</span>
                        </Switch>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Section 3: Profile Requirements */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold">{t('system.onboarding.profile_requirements')}</h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.profile_requirements_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <Switch isSelected={config.avatar_required} onValueChange={(v) => updateConfig('avatar_required', v)}>
              <div>
                <p className="font-medium">{t('system.onboarding.require_photo')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.require_photo_desc')}</p>
              </div>
            </Switch>
            <Switch isSelected={config.bio_required} onValueChange={(v) => updateConfig('bio_required', v)}>
              <div>
                <p className="font-medium">{t('system.onboarding.require_bio')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.require_bio_desc')}</p>
              </div>
            </Switch>
            <Input type="number" label={t('system.onboarding.min_bio_length')} value={String(config.bio_min_length)} onValueChange={(v) => updateConfig('bio_min_length', parseInt(v) || 0)} variant="secondary" min={0} max={500} description={t('system.onboarding.min_bio_length_desc')} isDisabled={!config.bio_required} className="max-w-xs" />
          </CardBody>
        </Card>

        {/* Section 5: Public Visibility Gating */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Eye aria-hidden="true" className="w-5 h-5" />
              {t('system.onboarding.visibility_gating')}
            </h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.visibility_gating_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <Switch isSelected={config.require_completion_for_visibility} onValueChange={(v) => updateConfig('require_completion_for_visibility', v)}>
              <div>
                <p className="font-medium">{t('system.onboarding.require_completion')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.require_completion_desc')}</p>
              </div>
            </Switch>
            <Switch isSelected={config.require_avatar_for_visibility} onValueChange={(v) => updateConfig('require_avatar_for_visibility', v)}>
              <div>
                <p className="font-medium">{t('system.onboarding.require_avatar_visibility')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.require_avatar_visibility_desc')}</p>
              </div>
            </Switch>
            <Switch isSelected={config.require_bio_for_visibility} onValueChange={(v) => updateConfig('require_bio_for_visibility', v)}>
              <div>
                <p className="font-medium">{t('system.onboarding.require_bio_visibility')}</p>
                <p className="text-xs text-theme-muted">{t('system.onboarding.require_bio_visibility_desc')}</p>
              </div>
            </Switch>
          </CardBody>
        </Card>

        {/* Section 6: Safeguarding Configuration */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Shield aria-hidden="true" className="w-5 h-5" />
              {t('system.onboarding.safeguarding_config')}
            </h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.safeguarding_config_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <div className="flex items-end gap-3">
            <Select label={t('system.onboarding.country_preset')} selectedKeys={[config.country_preset]} onSelectionChange={(keys) => { const key = Array.from(keys)[0] as string; updateConfig('country_preset', key); }} variant="secondary" description={t('system.onboarding.country_preset_desc')} className="max-w-xs">
                {Object.keys(COUNTRY_PRESET_LABEL_KEYS).map((key) => {
                  const label = getCountryPresetLabel(key);
                  return (
                    <SelectItem key={key} id={key} textValue={label}>
                      <div className="flex items-center gap-2">
                        <Globe aria-hidden="true" className="w-4 h-4" />
                        {label}
                      </div>
                    </SelectItem>
                  );
                })}
              </Select>
              <Button variant="secondary" onPress={presetModal.onOpen} isDisabled={config.country_preset === 'custom'}>
                {t('system.onboarding.apply_preset')}
              </Button>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-lg bg-warning/10 border border-warning/30">
              <AlertTriangle aria-hidden="true" className="w-5 h-5 text-warning-soft-foreground flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-warning-soft-foreground">{t('system.onboarding.legal_notice')}</p>
                <p className="text-warning-soft-foreground mt-1">{t('system.onboarding.legal_notice_desc')}</p>
              </div>
            </div>

            <div className="p-4 rounded-lg bg-theme-elevated">
              <div className="flex items-center justify-between mb-2">
                <p className="font-medium text-sm">{t('system.onboarding.configured_options')}</p>
                <Chip size="sm" variant="soft" color={activeOptionCount > 0 ? 'success' : 'default'}>
                  {t('system.onboarding.n_active', { count: activeOptionCount })}
                </Chip>
              </div>
              {safeguardingOptions.filter(o => o.is_active).length > 0 ? (
                <div className="space-y-1.5">
                  {safeguardingOptions.filter(o => o.is_active).map((opt) => (
                    <div key={opt.id} className="flex items-center gap-2 text-sm">
                      <CheckCircle aria-hidden="true" className="w-3.5 h-3.5 text-success-soft-foreground" />
                      <span>{opt.label}</span>
                      {opt.triggers && Object.values(opt.triggers).some(Boolean) && (
                        <Chip size="sm" variant="soft" color="warning" className="text-xs">{t('system.onboarding.has_triggers')}</Chip>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-theme-muted">{t('system.onboarding.no_options_configured')}</p>
              )}
              <Button size="sm" variant="secondary" className="mt-3" onPress={() => { navigate(tenantPath('/broker/safeguarding-options')); }}>
                {t('system.onboarding.manage_options')}
              </Button>
            </div>

            <Textarea label={t('system.onboarding.safeguarding_intro')} value={config.safeguarding_intro_text || ''} onValueChange={(v) => updateConfig('safeguarding_intro_text', v || null)} variant="secondary" placeholder={t('system.onboarding.safeguarding_intro_placeholder')} description={t('system.onboarding.safeguarding_intro_desc')} minRows={2} maxRows={5} />
          </CardBody>
        </Card>

        {/* Section 7: Custom Text */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <FileText aria-hidden="true" className="w-5 h-5" />
              {t('system.onboarding.custom_text')}
            </h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.custom_text_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <Textarea label={t('system.onboarding.welcome_text')} value={config.welcome_text || ''} onValueChange={(v) => updateConfig('welcome_text', v || null)} variant="secondary" placeholder={t('system.onboarding.welcome_text_placeholder')} description={t('system.onboarding.welcome_text_desc')} minRows={2} maxRows={4} />
            <Textarea label={t('system.onboarding.help_text')} value={config.help_text || ''} onValueChange={(v) => updateConfig('help_text', v || null)} variant="secondary" placeholder={t('system.onboarding.help_text_placeholder')} description={t('system.onboarding.help_text_desc')} minRows={2} maxRows={4} />
          </CardBody>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button size="lg" startContent={!saving ? <Save aria-hidden="true" className="w-5 h-5" /> : undefined} onPress={handleSave} isLoading={saving} isDisabled={saving}>
            {t('system.onboarding.save_settings')}
          </Button>
        </div>
      </div>

      {/* Preset Confirmation Modal */}
      <Modal isOpen={presetModal.isOpen} onClose={presetModal.onClose}>
        <ModalContent>
          <ModalHeader>{t('system.onboarding.apply_country_preset')}</ModalHeader>
          <ModalBody>
            <p>{t('system.onboarding.preset_confirm')}</p>
            <p className="text-sm text-theme-muted mt-2">{t('system.onboarding.preset_note')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={presetModal.onClose}>{t('cancel')}</Button>
            <Button onPress={handleApplyPreset} isLoading={applyingPreset} isDisabled={applyingPreset}>{t('system.onboarding.apply_preset')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default OnboardingSettings;
