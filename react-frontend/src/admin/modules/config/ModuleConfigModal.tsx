import { Card, CardBody, Input, Button, Chip, Spinner, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter, Switch } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ModuleConfigModal
 * Modal for viewing and editing a module's granular configuration options.
 * Behavior varies by configSource:
 * - broker_config: editable exchange workflow config via adminBroker API
 * - group_config: editable group config (tabs, policies) via adminConfig group API
 * - onboarding_config: link-out to dedicated onboarding settings page
 * - none/others: "Coming Soon" placeholders
 */

import { useState, useEffect, useCallback } from 'react';

import { Separator } from '@/components/ui';
import ExternalLink from 'lucide-react/icons/external-link';
import Save from 'lucide-react/icons/save';
import Info from 'lucide-react/icons/info';
import Construction from 'lucide-react/icons/construction';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast, useTenant } from '@/contexts';
import { adminBroker, adminConfig } from '../../api/adminApi';
import type { BrokerConfig } from '../../api/types';
import type { ModuleDefinition, ConfigOption } from './moduleRegistry';
import { getOptionCategories } from './moduleRegistry';

type AdminTranslator = ReturnType<typeof useTranslation<'admin_config'>>['t'];

function slugConfigText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'value';
}

function optionToken(optionKey: string): string {
  return optionKey.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function getOptionLabel(t: AdminTranslator, option: ConfigOption): string {
  return t(`config.option_${optionToken(option.key)}_label`);
}

function getOptionDescription(t: AdminTranslator, option: ConfigOption): string {
  return t(`config.option_${optionToken(option.key)}_desc`);
}

function getCategoryLabel(t: AdminTranslator, category: string): string {
  return t(`config.option_category_${category}`);
}

function getChoiceLabel(t: AdminTranslator, option: ConfigOption, choiceValue: string): string {
  return t(`config.option_choice_${optionToken(option.key)}_${slugConfigText(choiceValue)}`);
}

interface ModuleConfigModalProps {
  module: ModuleDefinition | null;
  isOpen: boolean;
  onClose: () => void;
}

export default function ModuleConfigModal({ module, isOpen, onClose }: ModuleConfigModalProps) {
  const { t } = useTranslation('admin_config');
  const toast = useToast();
  const navigate = useNavigate();

  const nameKey = module ? `config.module_name_${module.id}` : '';
  const descKey = module ? `config.module_desc_${module.id}` : '';
  const moduleName = module ? t(nameKey) : '';
  const moduleDesc = module ? t(descKey) : '';
  const { tenantPath, refreshTenant } = useTenant();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Broker config state
  const [brokerConfig, setBrokerConfig] = useState<BrokerConfig | null>(null);

  // Group config state
  const [groupConfig, setGroupConfig] = useState<Record<string, boolean | number | string> | null>(null);

  // Listing config state
  const [listingConfig, setListingConfig] = useState<Record<string, boolean | number | string> | null>(null);

  // Volunteering config state
  const [volunteeringConfig, setVolunteeringConfig] = useState<Record<string, boolean | number | string> | null>(null);

  // Job config state
  const [jobConfig, setJobConfig] = useState<Record<string, boolean | number | string> | null>(null);

  // Podcast config state
  const [podcastConfig, setPodcastConfig] = useState<Record<string, boolean | number | string> | null>(null);

  // Identity verification config state
  const [identityConfig, setIdentityConfig] = useState<Record<string, boolean | number | string> | null>(null);

  // Authentication config state (TOTP and passkey enrollment policies)
  const [authenticationConfig, setAuthenticationConfig] = useState<Record<string, boolean | number | string> | null>(null);
  const [authenticationWritableKeys, setAuthenticationWritableKeys] = useState<string[]>([]);
  const [authenticationLoadError, setAuthenticationLoadError] = useState(false);

  // ── Loaders ───────────────────────────────────────────────────────────────

  const loadBrokerConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminBroker.getConfiguration();
      if (res.success && res.data) {
        setBrokerConfig(res.data);
      }
    } catch {
      toast.error(t('config.modal_broker_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadGroupConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminConfig.getGroupConfig();
      if (res.success && res.data) {
        setGroupConfig(res.data.config);
      }
    } catch {
      toast.error(t('config.modal_group_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadListingConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminConfig.getListingConfig();
      if (res.success && res.data) {
        setListingConfig(res.data.config);
      }
    } catch {
      toast.error(t('config.modal_listing_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadVolunteeringConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminConfig.getVolunteeringConfig();
      if (res.success && res.data) {
        setVolunteeringConfig(res.data.config);
      }
    } catch {
      toast.error(t('config.modal_volunteering_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadJobConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminConfig.getJobConfig();
      if (res.success && res.data) {
        setJobConfig(res.data.config);
      }
    } catch {
      toast.error(t('config.modal_job_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadPodcastConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminConfig.getPodcastConfig();
      if (res.success && res.data) {
        setPodcastConfig(res.data.config);
      }
    } catch {
      toast.error(t('config.modal_podcast_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadIdentityConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminConfig.getIdentityConfig();
      if (res.success && res.data) {
        setIdentityConfig(res.data.config);
      }
    } catch {
      toast.error(t('config.modal_identity_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  const loadAuthenticationConfig = useCallback(async () => {
    setLoading(true);
    setAuthenticationLoadError(false);
    try {
      const res = await adminConfig.getAuthenticationConfig();
      if (res.success && res.data) {
        setAuthenticationConfig(res.data.config);
        setAuthenticationWritableKeys(res.data.writable_keys ?? Object.keys(res.data.config));
      } else {
        setAuthenticationConfig(null);
        setAuthenticationLoadError(true);
        toast.error(t('config.modal_authentication_load_failed'));
      }
    } catch {
      setAuthenticationConfig(null);
      setAuthenticationLoadError(true);
      toast.error(t('config.modal_authentication_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])

  // Reset all config state when the modal closes or the module changes. Done
  // during render with a prev-prop comparison (not useEffect) so users never
  // see a stale frame of the previous module's config. Mirrors the original
  // effect deps [isOpen, module].
  const [prevTrigger, setPrevTrigger] = useState<{ isOpen: boolean; module: ModuleDefinition | null }>({ isOpen, module });
  if (isOpen !== prevTrigger.isOpen || module !== prevTrigger.module) {
    setPrevTrigger({ isOpen, module });
    if (!isOpen || !module) {
      setHasChanges(false);
      setBrokerConfig(null);
      setGroupConfig(null);
      setListingConfig(null);
      setVolunteeringConfig(null);
      setJobConfig(null);
      setPodcastConfig(null);
      setIdentityConfig(null);
      setAuthenticationConfig(null);
      setAuthenticationLoadError(false);
    }
  }

  // Load the appropriate config when the modal is open for a module.
  useEffect(() => {
    if (!isOpen || !module) {
      return;
    }
    if (module.configSource === 'broker_config') {
      loadBrokerConfig();
    } else if (module.configSource === 'group_config') {
      loadGroupConfig();
    } else if (module.configSource === 'listing_config') {
      loadListingConfig();
    } else if (module.configSource === 'volunteering_config') {
      loadVolunteeringConfig();
    } else if (module.configSource === 'job_config') {
      loadJobConfig();
    } else if (module.configSource === 'podcast_config') {
      loadPodcastConfig();
    } else if (module.configSource === 'identity_config') {
      loadIdentityConfig();
    } else if (module.configSource === 'authentication_config') {
      loadAuthenticationConfig();
    }
  }, [isOpen, module, loadBrokerConfig, loadGroupConfig, loadListingConfig, loadVolunteeringConfig, loadJobConfig, loadPodcastConfig, loadIdentityConfig, loadAuthenticationConfig]);

  // ── Save handlers ─────────────────────────────────────────────────────────

  async function handleSaveBrokerConfig() {
    if (!brokerConfig) return;
    setSaving(true);
    try {
      const res = await adminBroker.saveConfiguration(brokerConfig);
      if (res.success) {
        toast.success(t('config.modal_broker_saved'));
        setHasChanges(false);
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveGroupConfig() {
    if (!groupConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updateGroupConfigBulk(groupConfig);
      if (res.success) {
        toast.success(t('config.modal_group_saved'));
        setHasChanges(false);
        refreshTenant();
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveListingConfig() {
    if (!listingConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updateListingConfigBulk(listingConfig);
      if (res.success) {
        toast.success(t('config.modal_listing_saved'));
        setHasChanges(false);
        refreshTenant();
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveVolunteeringConfig() {
    if (!volunteeringConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updateVolunteeringConfigBulk(volunteeringConfig);
      if (res.success) {
        toast.success(t('config.modal_volunteering_saved'));
        setHasChanges(false);
        refreshTenant();
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveJobConfig() {
    if (!jobConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updateJobConfigBulk(jobConfig);
      if (res.success) {
        toast.success(t('config.modal_job_saved'));
        setHasChanges(false);
        refreshTenant();
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePodcastConfig() {
    if (!podcastConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updatePodcastConfigBulk(podcastConfig);
      if (res.success) {
        toast.success(t('config.modal_podcast_saved'));
        setHasChanges(false);
        refreshTenant();
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveIdentityConfig() {
    if (!identityConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updateIdentityConfigBulk(identityConfig);
      if (res.success) {
        toast.success(t('config.modal_identity_saved'));
        setHasChanges(false);
        refreshTenant();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveAuthenticationConfig() {
    if (!authenticationConfig) return;
    setSaving(true);
    try {
      const res = await adminConfig.updateAuthenticationConfigBulk(Object.fromEntries(Object.entries(authenticationConfig).filter(([key]) => authenticationWritableKeys.includes(key))));
      if (res.success) {
        toast.success(t('config.modal_authentication_saved'));
        setHasChanges(false);
        refreshTenant();
        onClose();
      } else {
        toast.error(t('config.modal_save_failed'));
      }
    } catch {
      toast.error(t('config.modal_save_failed'));
    } finally {
      setSaving(false);
    }
  }

  // ── Value updaters ────────────────────────────────────────────────────────

  function updateBrokerValue<K extends keyof BrokerConfig>(key: K, value: BrokerConfig[K]) {
    setBrokerConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updateGroupValue(key: string, value: boolean | number | string) {
    setGroupConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updateListingValue(key: string, value: boolean | number | string) {
    setListingConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updateVolunteeringValue(key: string, value: boolean | number | string) {
    setVolunteeringConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updateJobValue(key: string, value: boolean | number | string) {
    setJobConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updatePodcastValue(key: string, value: boolean | number | string) {
    setPodcastConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updateIdentityValue(key: string, value: boolean | number | string) {
    setIdentityConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function updateAuthenticationValue(key: string, value: boolean | number | string) {
    setAuthenticationConfig(prev => prev ? { ...prev, [key]: value } : prev);
    setHasChanges(true);
  }

  function handleNavigateToDetail() {
    if (module?.detailPageUrl) {
      onClose();
      navigate(tenantPath(module.detailPageUrl));
    }
  }

  if (!module) return null;

  const Icon = module.icon;
  const categories = getOptionCategories(module);
  const allComingSoon = module.configOptions.every(o => o.comingSoon);
  const isLinkOut = module.configSource === 'onboarding_config';
  const isBroker = module.configSource === 'broker_config';
  const isGroupConfig = module.configSource === 'group_config';
  const isListingConfig = module.configSource === 'listing_config';
  const isVolunteeringConfig = module.configSource === 'volunteering_config';
  const isJobConfig = module.configSource === 'job_config';
  const isPodcastConfig = module.configSource === 'podcast_config';
  const isIdentityConfig = module.configSource === 'identity_config';
  const isAuthenticationConfig = module.configSource === 'authentication_config';
  const isEditable = isBroker || isGroupConfig || isListingConfig || isVolunteeringConfig || isJobConfig || isPodcastConfig || isIdentityConfig || isAuthenticationConfig;

  return (
    <Modal size="4xl" isOpen={isOpen} onClose={onClose} scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3">
          <div
            className={`row-span-2 flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
              module.type === 'core'
                ? 'bg-accent-soft text-accent'
                : 'bg-accent/10 text-accent'
            }`}
          >
            <Icon size={20} aria-hidden="true" />
          </div>
          <ModalHeading className="flex min-w-0 items-center gap-2">
            <span>{moduleName}</span>
            {module.stage ? (
              <Chip size="sm" variant="soft" color={module.stage === 'alpha' ? 'warning' : 'secondary'} startContent={<Construction size={12} aria-hidden="true" />}>
                {t(`config.stage_${module.stage}`)}
              </Chip>
            ) : !isEditable && (
              <Chip size="sm" variant="soft" color="warning" startContent={<Construction size={12} aria-hidden="true" />}>
                {t('config.beta')}
              </Chip>
            )}
          </ModalHeading>
          <p className="text-sm font-normal text-muted">{moduleDesc}</p>
        </ModalHeader>

        <ModalBody>
          {/* Loading state */}
          {isEditable && loading && (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
              <Spinner size="lg" />
            </div>
          )}

          {isAuthenticationConfig && !loading && authenticationLoadError && (
            <Card className="border-danger/40 bg-danger/10">
              <CardBody className="flex flex-row items-center justify-between gap-3 py-3">
                <p className="text-sm text-danger">{t('config.modal_authentication_load_failed')}</p>
                <Button size="sm" variant="secondary" onPress={loadAuthenticationConfig}>
                  {t('common.retry')}
                </Button>
              </CardBody>
            </Card>
          )}

          {/* Link-out: onboarding */}
          {isLinkOut && (
            <Card className="bg-surface-secondary">
              <CardBody className="flex flex-col items-center gap-4 py-8">
                <Info size={40} className="text-muted" aria-hidden="true" />
                <div className="text-center">
                  <p className="text-sm text-muted">
                    {t('config.modal_onboarding_desc')}
                  </p>
                </div>
                {module.detailPageUrl && (
                  <Button
                    variant="tertiary"
                    startContent={<ExternalLink size={16} aria-hidden="true" />}
                    onPress={handleNavigateToDetail}
                  >
                    {t('config.modal_go_to_onboarding')}
                  </Button>
                )}
              </CardBody>
            </Card>
          )}

          {/* All coming-soon notice */}
          {!isLinkOut && !isEditable && allComingSoon && module.configOptions.length > 0 && (
            <Card className="bg-warning-50 dark:bg-warning-50/10 mb-4">
              <CardBody className="flex flex-row items-center gap-3 py-3">
                <Construction size={18} className="text-warning flex-shrink-0" aria-hidden="true" />
                <p className="text-sm text-warning-700 dark:text-warning-400">
                  {t('config.modal_coming_soon_notice')}
                </p>
              </CardBody>
            </Card>
          )}

          {module.id === 'two_factor_authentication' && (
            <p className="mb-4 rounded-lg border border-border p-4 text-sm" role="note">
              {t('config.two_factor_admin_requirement')}
            </p>
          )}
          {/* Config options grouped by category */}
          {!isLinkOut && (!isEditable || !loading) && !authenticationLoadError && categories.map(category => {
            const categoryOptions = module.configOptions.filter(o => o.category === category);
            return (
              <div key={category} className="mb-5 rounded-lg border border-border bg-surface-secondary/50">
                <div className="px-5 pt-4 pb-1">
                  <h4 className="text-sm font-semibold text-foreground">{getCategoryLabel(t, category)}</h4>
                </div>
                <div className="px-5 pb-4">
                  {categoryOptions.map((option, idx) => {
                    // Determine the current value based on config source
                    let currentValue: boolean | number | string = option.defaultValue;
                    if (isBroker && brokerConfig) {
                      currentValue = brokerConfig[option.key as keyof BrokerConfig];
                    } else if (isGroupConfig && groupConfig) {
                      currentValue = groupConfig[option.key] ?? option.defaultValue;
                    } else if (isListingConfig && listingConfig) {
                      currentValue = listingConfig[option.key] ?? option.defaultValue;
                    } else if (isVolunteeringConfig && volunteeringConfig) {
                      currentValue = volunteeringConfig[option.key] ?? option.defaultValue;
                    } else if (isJobConfig && jobConfig) {
                      currentValue = jobConfig[option.key] ?? option.defaultValue;
                    } else if (isPodcastConfig && podcastConfig) {
                      currentValue = podcastConfig[option.key] ?? option.defaultValue;
                    } else if (isIdentityConfig && identityConfig) {
                      currentValue = identityConfig[option.key] ?? option.defaultValue;
                    } else if (isAuthenticationConfig && authenticationConfig) {
                      currentValue = authenticationConfig[option.key] ?? option.defaultValue;
                    }

                    return (
                      <div key={option.key}>
                        {idx > 0 && <Separator className="my-2" />}
                        <ConfigOptionRow
                          option={option}
                          value={currentValue}
                          onChange={(val) => {
                            if (isBroker) {
                              updateBrokerValue(option.key as keyof BrokerConfig, val as never);
                            } else if (isGroupConfig) {
                              updateGroupValue(option.key, val);
                            } else if (isListingConfig) {
                              updateListingValue(option.key, val);
                            } else if (isVolunteeringConfig) {
                              updateVolunteeringValue(option.key, val);
                            } else if (isJobConfig) {
                              updateJobValue(option.key, val);
                            } else if (isPodcastConfig) {
                              updatePodcastValue(option.key, val);
                            } else if (isIdentityConfig) {
                              updateIdentityValue(option.key, val);
                            } else if (isAuthenticationConfig) {
                              updateAuthenticationValue(option.key, val);
                            }
                          }}
                          disabled={(isAuthenticationConfig && !authenticationWritableKeys.includes(option.key)) || option.comingSoon === true || (isBroker && !brokerConfig) || (isGroupConfig && !groupConfig) || (isListingConfig && !listingConfig) || (isVolunteeringConfig && !volunteeringConfig) || (isJobConfig && !jobConfig) || (isPodcastConfig && !podcastConfig) || (isIdentityConfig && !identityConfig) || (isAuthenticationConfig && !authenticationConfig)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Detail page link for broker config */}
          {isBroker && module.detailPageUrl && (
            <div className="flex justify-center pt-2">
              <Button
                variant="tertiary"
                size="sm"
                startContent={<ExternalLink size={14} aria-hidden="true" />}
                onPress={handleNavigateToDetail}
              >
                {t('config.modal_open_broker_page')}
              </Button>
            </div>
          )}

          {isGroupConfig && module.detailPageUrl && (
            <Card className="bg-surface-secondary">
              <CardBody className="flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-medium">{t('config.modal_group_management_title')}</p>
                  <p className="mt-1 text-xs text-muted">{t('config.modal_group_management_desc')}</p>
                </div>
                <Button
                  className="w-full sm:w-auto"
                  variant="tertiary"
                  size="sm"
                  startContent={<ExternalLink size={14} aria-hidden="true" />}
                  onPress={handleNavigateToDetail}
                >
                  {t('config.modal_open_group_management')}
                </Button>
              </CardBody>
            </Card>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>
            {isEditable && hasChanges ? t('config.cancel') : t('config.close')}
          </Button>
          {isEditable && (
            <Button
              startContent={<Save size={16} />}
              isLoading={saving}
              isDisabled={!hasChanges || (isBroker && !brokerConfig) || (isGroupConfig && !groupConfig) || (isListingConfig && !listingConfig) || (isVolunteeringConfig && !volunteeringConfig) || (isJobConfig && !jobConfig) || (isPodcastConfig && !podcastConfig) || (isIdentityConfig && !identityConfig) || (isAuthenticationConfig && !authenticationConfig)}
              onPress={isBroker ? handleSaveBrokerConfig : isListingConfig ? handleSaveListingConfig : isVolunteeringConfig ? handleSaveVolunteeringConfig : isJobConfig ? handleSaveJobConfig : isPodcastConfig ? handleSavePodcastConfig : isIdentityConfig ? handleSaveIdentityConfig : isAuthenticationConfig ? handleSaveAuthenticationConfig : handleSaveGroupConfig}
            >
              {t('config.save_changes')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Config Option Row
// ─────────────────────────────────────────────────────────────────────────────

interface ConfigOptionRowProps {
  option: ConfigOption;
  value: boolean | number | string;
  onChange: (value: boolean | number | string) => void;
  disabled: boolean;
}

function ConfigOptionRow({ option, value, onChange, disabled }: ConfigOptionRowProps) {
  const { t } = useTranslation('admin_config');
  const label = getOptionLabel(t, option);
  const description = getOptionDescription(t, option);

  return (
    <div className="flex items-start justify-between gap-6 py-2.5">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          {option.comingSoon && (
            <Chip size="sm" variant="soft" color="warning">{t('config.coming_soon')}</Chip>
          )}
        </div>
        <p className="text-xs text-muted mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="flex-shrink-0 pt-0.5">
        {option.type === 'boolean' && (
          <Switch
            size="sm"
            isSelected={value as boolean}
            isDisabled={disabled}
            onValueChange={(val) => onChange(val)}
            aria-label={label}
          />
        )}
        {option.type === 'number' && (
          <Input
            type="number"
            size="sm"
            variant="secondary"
            className="w-28"
            value={String(value)}
            min={option.min}
            max={option.max}
            isDisabled={disabled}
            onValueChange={(val) => onChange(Number(val) || 0)}
            aria-label={label}
          />
        )}
        {option.type === 'string' && (
          <Input
            size="sm"
            variant="secondary"
            className="w-56"
            value={value as string}
            isDisabled={disabled}
            onValueChange={(val) => onChange(val)}
            aria-label={label}
          />
        )}
        {option.type === 'select' && option.choices && (
          <Select
            size="sm"
            variant="secondary"
            className="w-40"
            selectedKeys={[value as string]}
            isDisabled={disabled}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0];
              if (selected) onChange(selected as string);
            }}
            aria-label={label}
          >
            {option.choices.map(c => (
              <SelectItem key={c.value} id={c.value}>{getChoiceLabel(t, option, c.value)}</SelectItem>
            ))}
          </Select>
        )}
      </div>
    </div>
  );
}
