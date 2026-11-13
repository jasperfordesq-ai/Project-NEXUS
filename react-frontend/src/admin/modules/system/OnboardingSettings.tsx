import { Card, CardBody, CardHeader, Button, Spinner, Input, Textarea, Chip, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Radio, RadioGroup } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';

import Save from 'lucide-react/icons/save';
import Sparkles from 'lucide-react/icons/sparkles';
import UserCircle from 'lucide-react/icons/circle-user';
import HandHeart from 'lucide-react/icons/hand-heart';
import Shield from 'lucide-react/icons/shield';
import KeyRound from 'lucide-react/icons/key-round';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Eye from 'lucide-react/icons/eye';
import MessageSquareHeart from 'lucide-react/icons/message-square-heart';
import Globe from 'lucide-react/icons/globe';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Smartphone from 'lucide-react/icons/smartphone';
import Info from 'lucide-react/icons/info';
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
 * Admin → Welcome steps: what a new member is shown and asked after joining.
 *
 * Sections:
 *  1. Who goes through the welcome steps — everyone / offered / switched off
 *  2. The steps — each one on or off, with what the profile and safeguarding
 *     steps ask for
 *  3. Who other members can see — hiding unfinished or bare profiles
 *  4. Safeguarding questions — a country's standard set, and the community's
 *     own introduction
 *  5. Your own welcome — the community's welcome message
 *
 * Every control here changes something a member meets. Rebuilt on 13 Nov 2026:
 * until then five controls did nothing (they are gone, and their settings are
 * retired on the server), two combinations left new members unable to finish,
 * and most labels described something other than what the control did.
 *
 * Route: /admin/onboarding-settings
 */


// ── Types ────────────────────────────────────────────────────────────────────

interface OnboardingConfig {
  enabled: boolean;
  mandatory: boolean;
  step_welcome_enabled: boolean;
  step_profile_enabled: boolean;
  step_skills_enabled: boolean;
  step_safeguarding_enabled: boolean;
  step_safeguarding_required: boolean;
  /** "Protect your account" — always optional, so there is no _required key. */
  step_security_enabled: boolean;
  avatar_required: boolean;
  bio_required: boolean;
  bio_min_length: number;
  require_completion_for_visibility: boolean;
  require_avatar_for_visibility: boolean;
  require_bio_for_visibility: boolean;
  welcome_text: string | null;
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

interface ApplyPresetResult {
  options_created?: string[];
  jurisdiction_warning?: string | null;
}

/**
 * The two stored settings (`enabled`, `mandatory`) are one choice for an admin.
 * Shown as two switches, "off" could be saved with "must finish" still on.
 */
type Mode = 'required' | 'optional' | 'off';

const BIO_MIN = 1;
const BIO_MAX = 500;

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

type StepKey = 'welcome' | 'profile' | 'skills' | 'safeguarding' | 'security' | 'confirm';

const STEPS: { key: StepKey; icon: typeof Sparkles; labelKey: string; descriptionKey: string }[] = [
  { key: 'welcome', icon: Sparkles, labelKey: 'system.onboarding.step_welcome', descriptionKey: 'system.onboarding.step_welcome_desc' },
  { key: 'profile', icon: UserCircle, labelKey: 'system.onboarding.step_profile', descriptionKey: 'system.onboarding.step_profile_desc' },
  { key: 'skills', icon: HandHeart, labelKey: 'system.onboarding.step_skills', descriptionKey: 'system.onboarding.step_skills_desc' },
  { key: 'safeguarding', icon: Shield, labelKey: 'system.onboarding.step_safeguarding', descriptionKey: 'system.onboarding.step_safeguarding_desc' },
  { key: 'security', icon: KeyRound, labelKey: 'system.onboarding.step_security', descriptionKey: 'system.onboarding.step_security_desc' },
  { key: 'confirm', icon: CheckCircle, labelKey: 'system.onboarding.step_confirm', descriptionKey: 'system.onboarding.step_confirm_desc' },
];

/**
 * One setting: its name and what it does on the left, the switch on the right
 * (the Settings page's layout). The switch carries the name as its accessible
 * name; a label rendered inside the switch stacks under the toggle.
 */
function SwitchRow({ label, description, isSelected, onValueChange, isDisabled }: {
  label: string;
  description: string;
  isSelected: boolean;
  onValueChange: (value: boolean) => void;
  isDisabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-theme-muted">{description}</p>
      </div>
      <Switch
        size="sm"
        className="mt-0.5 flex-shrink-0"
        isSelected={isSelected}
        onValueChange={onValueChange}
        isDisabled={isDisabled}
        aria-label={label}
      />
    </div>
  );
}

function clampBioLength(value: number): number {
  if (!Number.isFinite(value)) return BIO_MIN;
  return Math.min(BIO_MAX, Math.max(BIO_MIN, Math.round(value)));
}

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
      toast.error(t('system.onboarding.load_failed'), t('system.onboarding.try_again'));
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
      const res = await api.put('/v2/admin/config/onboarding', {
        ...config,
        bio_min_length: clampBioLength(config.bio_min_length),
      });
      if (res.success) {
        toast.success(t('system.onboarding.saved'), t('system.onboarding.saved_desc'));
      } else {
        toast.error(t('system.onboarding.save_failed'), t('system.onboarding.try_again'));
      }
    } catch (error) {
      logError('Failed to save onboarding config', error);
      toast.error(t('system.onboarding.save_failed'), t('system.onboarding.try_again'));
    } finally {
      setSaving(false);
    }
  }, [config, t, toast]);


  // ── Country's standard questions ─────────────────────────────────────────

  const handleApplyPreset = useCallback(async () => {
    if (!config) return;
    const country = t(COUNTRY_PRESET_LABEL_KEYS[config.country_preset] ?? DEFAULT_COUNTRY_PRESET_LABEL_KEY);
    try {
      setApplyingPreset(true);
      const res = await api.post<ApplyPresetResult>('/v2/admin/config/onboarding/apply-preset', {
        preset: config.country_preset,
      });
      if (res.success) {
        toast.success(t('system.onboarding.preset_done'), t('system.onboarding.preset_done_desc', { country }));
        // The server keeps a safeguarding country that was already chosen and
        // says so when it differs from this one. Its words, in the admin's
        // language — it was never shown before.
        const warning = res.data?.jurisdiction_warning;
        if (warning) {
          toast.warning(t('system.onboarding.preset_country_differs'), warning);
        }
        presetModal.onClose();
        fetchConfig();
      } else {
        toast.error(t('system.onboarding.preset_failed'), t('system.onboarding.try_again'));
      }
    } catch (error) {
      logError('Failed to apply preset', error);
      toast.error(t('system.onboarding.preset_failed'), t('system.onboarding.try_again'));
    } finally {
      setApplyingPreset(false);
    }
  }, [config, t, toast, fetchConfig, presetModal]);


  // ── Helpers ──────────────────────────────────────────────────────────────

  const updateConfig = useCallback((key: keyof OnboardingConfig, value: unknown) => {
    setConfig(prev => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const setMode = useCallback((mode: Mode) => {
    setConfig(prev => prev ? { ...prev, enabled: mode !== 'off', mandatory: mode === 'required' } : prev);
  }, []);

  // ── Loading state ────────────────────────────────────────────────────────

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center py-20">
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
      </div>
    );
  }

  const mode: Mode = !config.enabled ? 'off' : config.mandatory ? 'required' : 'optional';
  const stepsOff = mode === 'off';
  const activeOptions = safeguardingOptions.filter(o => o.is_active);
  const countryLabel = getCountryPresetLabel(config.country_preset);

  return (
    <div>
      <PageHeader
        title={t('system.onboarding.page_title')}
        description={t('system.onboarding.page_description')}
      />

      <div className="space-y-6">

        {/* Section 1: Who goes through the welcome steps */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold">{t('system.onboarding.mode_heading')}</h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.mode_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <RadioGroup
              aria-label={t('system.onboarding.mode_heading')}
              value={mode}
              onValueChange={(value) => setMode(value as Mode)}
            >
              <Radio value="required" description={t('system.onboarding.mode_required_desc')}>
                {t('system.onboarding.mode_required')}
              </Radio>
              <Radio value="optional" description={t('system.onboarding.mode_optional_desc')}>
                {t('system.onboarding.mode_optional')}
              </Radio>
              <Radio value="off" description={t('system.onboarding.mode_off_desc')}>
                {t('system.onboarding.mode_off')}
              </Radio>
            </RadioGroup>
            <p className="flex items-start gap-2 text-xs text-theme-muted">
              <Smartphone aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{t('system.onboarding.mode_app_note')}</span>
            </p>
          </CardBody>
        </Card>

        {/* Section 2: The steps */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="text-lg font-semibold">{t('system.onboarding.steps_heading')}</h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.steps_desc')}</p>
          </CardHeader>
          <CardBody>
            {stepsOff && (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-theme-elevated p-3 text-sm text-theme-muted">
                <Info aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{t('system.onboarding.steps_off_note')}</span>
              </p>
            )}
            <div className="space-y-3">
              {STEPS.map((step) => {
                const Icon = step.icon;
                const label = t(step.labelKey);
                const alwaysShown = step.key === 'confirm';
                const enabledKey = `step_${step.key}_enabled` as keyof OnboardingConfig;
                const isShown = alwaysShown || Boolean(config[enabledKey]);

                return (
                  <div key={step.key} data-step={step.key} className="rounded-lg bg-theme-elevated p-3">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex min-w-0 items-start gap-3">
                        <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0 text-theme-muted" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-theme-muted">{t(step.descriptionKey)}</p>
                        </div>
                      </div>
                      {alwaysShown ? (
                        <Chip size="sm" variant="soft" color="default" className="flex-shrink-0">{t('system.onboarding.always_shown')}</Chip>
                      ) : (
                        <div className="flex flex-shrink-0 items-center gap-2">
                          <span aria-hidden="true" className="text-xs text-theme-muted">{t('system.onboarding.shown')}</span>
                          <Switch
                            size="sm"
                            isSelected={isShown}
                            onValueChange={(v) => updateConfig(enabledKey, v)}
                            aria-label={t('system.onboarding.show_step', { step: label })}
                          />
                        </div>
                      )}
                    </div>

                    {/* What the profile step asks for. Only while the step is
                        shown: the server demands nothing a step did not ask for. */}
                    {step.key === 'profile' && isShown && (
                      <div className="ml-8 mt-3 space-y-3 border-l-2 border-theme-default pl-4">
                        <SwitchRow
                          label={t('system.onboarding.photo_required')}
                          description={t('system.onboarding.photo_required_desc')}
                          isSelected={config.avatar_required}
                          onValueChange={(v) => updateConfig('avatar_required', v)}
                        />
                        <SwitchRow
                          label={t('system.onboarding.bio_required')}
                          description={t('system.onboarding.bio_required_desc')}
                          isSelected={config.bio_required}
                          onValueChange={(v) => updateConfig('bio_required', v)}
                        />
                        {config.bio_required && (
                          <Input
                            type="number"
                            label={t('system.onboarding.bio_min_length')}
                            value={String(config.bio_min_length)}
                            onValueChange={(v) => updateConfig('bio_min_length', Number.parseInt(v, 10) || 0)}
                            onBlur={() => updateConfig('bio_min_length', clampBioLength(config.bio_min_length))}
                            variant="secondary"
                            min={BIO_MIN}
                            max={BIO_MAX}
                            description={t('system.onboarding.bio_min_length_desc', { min: BIO_MIN, max: BIO_MAX })}
                            className="max-w-xs"
                          />
                        )}
                      </div>
                    )}

                    {step.key === 'safeguarding' && isShown && (
                      <div className="ml-8 mt-3 space-y-3 border-l-2 border-theme-default pl-4">
                        <SwitchRow
                          label={t('system.onboarding.safeguarding_must_answer')}
                          description={t('system.onboarding.safeguarding_must_answer_desc')}
                          isSelected={config.step_safeguarding_required}
                          onValueChange={(v) => updateConfig('step_safeguarding_required', v)}
                        />
                        {activeOptions.length === 0 && (
                          <p className="flex items-start gap-2 text-xs text-warning-soft-foreground">
                            <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 flex-shrink-0" />
                            <span>{t('system.onboarding.safeguarding_no_questions_note')}</span>
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>

        {/* Section 3: Who other members can see */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Eye aria-hidden="true" className="h-5 w-5" />
              {t('system.onboarding.visibility_heading')}
            </h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.visibility_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <SwitchRow
              label={t('system.onboarding.hide_unfinished')}
              description={stepsOff ? t('system.onboarding.hide_unfinished_off_desc') : t('system.onboarding.hide_unfinished_desc')}
              isSelected={!stepsOff && config.require_completion_for_visibility}
              onValueChange={(v) => updateConfig('require_completion_for_visibility', v)}
              isDisabled={stepsOff}
            />
            <SwitchRow
              label={t('system.onboarding.hide_no_photo')}
              description={t('system.onboarding.hide_no_photo_desc')}
              isSelected={config.require_avatar_for_visibility}
              onValueChange={(v) => updateConfig('require_avatar_for_visibility', v)}
            />
            <SwitchRow
              label={t('system.onboarding.hide_no_bio')}
              description={t('system.onboarding.hide_no_bio_desc')}
              isSelected={config.require_bio_for_visibility}
              onValueChange={(v) => updateConfig('require_bio_for_visibility', v)}
            />
          </CardBody>
        </Card>

        {/* Section 4: Safeguarding questions */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <Shield aria-hidden="true" className="h-5 w-5" />
              {t('system.onboarding.safeguarding_heading')}
            </h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.safeguarding_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <div className="rounded-lg bg-theme-elevated p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium">{t('system.onboarding.questions_on')}</p>
                <Chip size="sm" variant="soft" color={activeOptions.length > 0 ? 'success' : 'default'}>
                  {t('system.onboarding.n_active', { count: activeOptions.length })}
                </Chip>
              </div>
              {activeOptions.length > 0 ? (
                <div className="space-y-1.5">
                  {activeOptions.map((opt) => (
                    <div key={opt.id} className="flex items-center gap-2 text-sm">
                      <CheckCircle aria-hidden="true" className="h-3.5 w-3.5 flex-shrink-0 text-success-soft-foreground" />
                      <span>{opt.label}</span>
                      {opt.triggers && Object.values(opt.triggers).some(Boolean) && (
                        <Chip size="sm" variant="soft" color="warning" className="text-xs">{t('system.onboarding.starts_protection')}</Chip>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-theme-muted">{t('system.onboarding.no_questions')}</p>
              )}
              <Button size="sm" variant="secondary" className="mt-3" onPress={() => { navigate(tenantPath('/broker/safeguarding-options')); }}>
                {t('system.onboarding.manage_questions')}
              </Button>
            </div>

            <div className="flex flex-col items-start gap-3">
              <Select label={t('system.onboarding.country_label')} selectedKeys={[config.country_preset]} onSelectionChange={(keys) => { const key = Array.from(keys)[0] as string; updateConfig('country_preset', key); }} variant="secondary" description={t('system.onboarding.country_desc')} className="max-w-xs">
                {Object.keys(COUNTRY_PRESET_LABEL_KEYS).map((key) => {
                  const label = getCountryPresetLabel(key);
                  return (
                    <SelectItem key={key} id={key} textValue={label}>
                      <div className="flex items-center gap-2">
                        <Globe aria-hidden="true" className="h-4 w-4" />
                        {label}
                      </div>
                    </SelectItem>
                  );
                })}
              </Select>
              <Button variant="secondary" onPress={presetModal.onOpen} isDisabled={config.country_preset === 'custom'}>
                {t('system.onboarding.set_up_questions')}
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3">
              <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 flex-shrink-0 text-warning-soft-foreground" />
              <div className="text-sm">
                <p className="font-medium text-warning-soft-foreground">{t('system.onboarding.policy_note')}</p>
                <p className="mt-1 text-warning-soft-foreground">{t('system.onboarding.policy_note_desc')}</p>
              </div>
            </div>

            <Textarea label={t('system.onboarding.safeguarding_intro')} value={config.safeguarding_intro_text || ''} onValueChange={(v) => updateConfig('safeguarding_intro_text', v || null)} variant="secondary" placeholder={t('system.onboarding.safeguarding_intro_placeholder')} description={t('system.onboarding.safeguarding_intro_desc')} minRows={2} maxRows={5} />
          </CardBody>
        </Card>

        {/* Section 5: Your own welcome */}
        <Card>
          <CardHeader className="flex flex-col items-start gap-1 pb-0">
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <MessageSquareHeart aria-hidden="true" className="h-5 w-5" />
              {t('system.onboarding.welcome_heading')}
            </h3>
            <p className="text-sm text-theme-muted">{t('system.onboarding.welcome_heading_desc')}</p>
          </CardHeader>
          <CardBody className="gap-4">
            <Textarea label={t('system.onboarding.welcome_text')} value={config.welcome_text || ''} onValueChange={(v) => updateConfig('welcome_text', v || null)} variant="secondary" placeholder={t('system.onboarding.welcome_text_placeholder')} description={t('system.onboarding.welcome_text_desc')} minRows={2} maxRows={4} />
          </CardBody>
        </Card>

        {/* Save Button */}
        <div className="flex justify-end">
          <Button size="lg" startContent={!saving ? <Save aria-hidden="true" className="h-5 w-5" /> : undefined} onPress={handleSave} isLoading={saving} isDisabled={saving}>
            {t('system.onboarding.save')}
          </Button>
        </div>
      </div>

      {/* A country's standard questions: say exactly what will change */}
      <Modal isOpen={presetModal.isOpen} onClose={presetModal.onClose}>
        <ModalContent>
          <ModalHeader>{t('system.onboarding.preset_modal_title', { country: countryLabel })}</ModalHeader>
          <ModalBody>
            <p>{t('system.onboarding.preset_modal_intro', { country: countryLabel })}</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-theme-muted">
              <li>{t('system.onboarding.preset_modal_reset')}</li>
              <li>{t('system.onboarding.preset_modal_other_country')}</li>
              <li>{t('system.onboarding.preset_modal_own')}</li>
            </ul>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={presetModal.onClose}>{t('cancel')}</Button>
            <Button onPress={handleApplyPreset} isLoading={applyingPreset} isDisabled={applyingPreset}>{t('system.onboarding.set_up_questions')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default OnboardingSettings;
