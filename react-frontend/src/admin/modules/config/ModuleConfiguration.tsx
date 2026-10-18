// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Module Configuration
 * Central admin page listing all platform modules with granular config options.
 * Marked as Beta — under active development.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { ButtonGroup } from '@/components/ui';
import Search from 'lucide-react/icons/search';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Construction from 'lucide-react/icons/construction';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminConfig } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { TenantConfig } from '../../api/types';
import ModuleCard from './ModuleCard';
import ModuleConfigModal from './ModuleConfigModal';
import PlatformInfrastructure from './PlatformInfrastructure';
import {
  getCoreModules,
  getFeatureModules,
  type ModuleDefinition,
} from './moduleRegistry';
import {
  Alert,
  Button,
  Chip,
  Spinner,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/ui';

type FilterType = 'all' | 'core' | 'feature';

export default function ModuleConfiguration() {
  const { t } = useTranslation('admin_config');
  usePageTitle(t('config.module_configuration_title'));
  const toast = useToast();
  const { refreshTenant, tenantPath } = useTenant();
  const navigate = useNavigate();

  const [config, setConfig] = useState<TenantConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [selectedModule, setSelectedModule] = useState<ModuleDefinition | null>(null);
  const [pendingPasskeyDisable, setPendingPasskeyDisable] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const handleConfigure = useCallback((module: ModuleDefinition) => {
    if (module.detailPageUrl) {
      navigate(tenantPath(module.detailPageUrl));
      return;
    }
    setSelectedModule(module);
  }, [navigate, tenantPath]);

  const coreModules = getCoreModules();
  const featureModules = getFeatureModules();

  /**
   * `?configure=<module id>` opens that module's window straight away. The
   * volunteering sidebar's "Settings" entry links here this way, so a
   * community admin lands in the volunteering settings instead of on a page
   * of platform-wide switches. Only module ids the registry knows are
   * honoured; anything else is ignored.
   */
  const configureParam = searchParams.get('configure');
  const openedFromLink = configureParam !== null;
  useEffect(() => {
    if (!configureParam) return;
    const target = [...coreModules, ...featureModules].find((module) => module.id === configureParam);
    if (target && !target.detailPageUrl) {
      setSelectedModule(target);
    }
    // The module lists are constant registry data; re-running on them would
    // reopen the window after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configureParam]);

  const handleModalClose = useCallback(() => {
    setSelectedModule(null);
    if (!openedFromLink) return;
    // Opened from a module's own sidebar entry: go back there rather than
    // leaving the admin on this page, which their sidebar may not even list.
    if (configureParam === 'volunteering') {
      navigate(tenantPath('/admin/volunteering'));
      return;
    }
    setSearchParams({}, { replace: true });
  }, [openedFromLink, configureParam, navigate, tenantPath, setSearchParams]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminConfig.get();
      if (res.success && res.data) {
        setConfig(res.data);
      } else {
        setConfig(null);
        setLoadError(true);
        toast.error(t('config.module_config_load_failed'));
      }
    } catch {
      setConfig(null);
      setLoadError(true);
      toast.error(t('config.module_config_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // ── Toggle handlers (same pattern as TenantFeatures.tsx) ────────────────

  const applyToggle = async (id: string, enabled: boolean, confirmDisable = false): Promise<boolean> => {
    if (!config) return false;

    // Determine if this is a core module or feature
    const isCore = coreModules.some(m => m.id === id);
    setToggling(id);

    try {
      const res = isCore
        ? await adminConfig.updateModule(id, enabled)
        : confirmDisable
          ? await adminConfig.updateFeature(id, enabled, { confirmDisable: true })
          : await adminConfig.updateFeature(id, enabled);

      if (res.success) {
        setConfig(prev => {
          if (!prev) return prev;
          if (isCore) {
            return { ...prev, modules: { ...prev.modules, [id]: enabled } };
          }
          return { ...prev, features: { ...prev.features, [id]: enabled } };
        });
        const mod = [...coreModules, ...featureModules].find(m => m.id === id);
        const moduleName = mod ? t(`config.module_name_${mod.id}`) : id;
        toast.success(t(enabled ? 'config.module_enabled' : 'config.module_disabled', { name: moduleName }));
        refreshTenant();
        return true;
      }

      toast.error(t('config.failed_to_update_module'));
      return false;
    } catch {
      toast.error(t('config.failed_to_update_module'));
      return false;
    } finally {
      setToggling(null);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    if (id === 'biometric_login' && !enabled) {
      setPendingPasskeyDisable(true);
      return;
    }

    await applyToggle(id, enabled);
  };

  // ── Filter logic ────────────────────────────────────────────────────────

  const filterModules = useCallback((modules: ModuleDefinition[]) => {
    if (!searchQuery) return modules;
    const q = searchQuery.toLowerCase();
    return modules.filter(
      m => {
        const nameKey = `config.module_name_${m.id}`;
        const descKey = `config.module_desc_${m.id}`;
        const name = t(nameKey);
        const description = t(descKey);
        return name.toLowerCase().includes(q) || description.toLowerCase().includes(q);
      }
    );
  }, [searchQuery, t]);

  const filteredCore = useMemo(
    () => filterType !== 'feature' ? filterModules(coreModules) : [],
    [filterType, filterModules, coreModules]
  );

  const filteredFeatures = useMemo(
    () => filterType !== 'core' ? filterModules(featureModules) : [],
    [filterType, filterModules, featureModules]
  );

  function isModuleEnabled(id: string, isCore: boolean): boolean {
    if (!config) return false;
    if (isCore) {
      return config.modules?.[id] !== false;
    }
    return config.features?.[id] !== false;
  }

  const rawPasskeyImpact = config?.security_impact?.biometric_login;
  const passkeyImpact = rawPasskeyImpact
    && Number.isInteger(rawPasskeyImpact.credential_count)
    && rawPasskeyImpact.credential_count >= 0
    && Number.isInteger(rawPasskeyImpact.registered_users)
    && rawPasskeyImpact.registered_users >= 0
    && Number.isInteger(rawPasskeyImpact.passkey_only_users)
    && rawPasskeyImpact.passkey_only_users >= 0
    ? rawPasskeyImpact
    : null;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 pb-8">
      <PageHeader
        title={t('config.module_configuration_title')}
        description={t('config.module_configuration_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Chip color="warning" variant="soft" size="sm" startContent={<Construction size={14} aria-hidden="true" />}>
              {t('config.beta')}
            </Chip>
            <Button variant="tertiary" size="sm" startContent={<RefreshCw size={16} />} onPress={loadConfig}>
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      {/* Search + filter bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-6">
        <Input
          size="sm"
          variant="secondary"
          type="text"
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          data-bwignore="true"
          data-1p-ignore=""
          placeholder={t('config.search_modules')}
          aria-label={t('config.search_modules')}
          startContent={<Search size={16} className="text-muted" />}
          value={searchQuery}
          onValueChange={(val) => {
            // Reject autofill injections — module names never contain @
            if (val.includes('@')) return;
            setSearchQuery(val);
          }}
          className="sm:max-w-xs"
          isClearable
          onClear={() => setSearchQuery('')}
        />
        <ButtonGroup size="sm" variant="tertiary" role="group" aria-label={t('config.filter_modules')}>
          <Button
            color={filterType === 'all' ? 'primary' : 'default'}
            onPress={() => setFilterType('all')}
          >
            {t('config.filter_all')} ({coreModules.length + featureModules.length})
          </Button>
          <Button
            color={filterType === 'core' ? 'primary' : 'default'}
            onPress={() => setFilterType('core')}
          >
            {t('config.filter_core')} ({coreModules.length})
          </Button>
          <Button
            color={filterType === 'feature' ? 'primary' : 'default'}
            onPress={() => setFilterType('feature')}
          >
            {t('config.filter_features')} ({featureModules.length})
          </Button>
        </ButtonGroup>
      </div>

      {/* Loading state — inline so the search Input is never unmounted (prevents browser search-history re-injection) */}
      {loading && (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center items-center min-h-[300px]">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && loadError && (
        <Alert
          color="danger"
          title={t('config.module_config_load_error_title')}
          description={t('config.module_config_load_error_desc')}
          endContent={(
            <Button size="sm" variant="secondary" onPress={loadConfig}>
              {t('common.retry')}
            </Button>
          )}
        />
      )}

      {/* Core Modules section */}
      {!loading && !loadError && filteredCore.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('config.core_modules')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredCore.map(mod => (
              <ModuleCard
                key={mod.id}
                module={mod}
                enabled={isModuleEnabled(mod.id, true)}
                onToggle={handleToggle}
                onConfigure={handleConfigure}
                toggling={toggling === mod.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* Optional Features section */}
      {!loading && !loadError && filteredFeatures.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('config.optional_features')}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredFeatures.map(mod => (
              <ModuleCard
                key={mod.id}
                module={mod}
                enabled={isModuleEnabled(mod.id, false)}
                onToggle={handleToggle}
                onConfigure={handleConfigure}
                toggling={toggling === mod.id}
              />
            ))}
          </div>
        </section>
      )}

      {/* No results */}
      {!loading && !loadError && filteredCore.length === 0 && filteredFeatures.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-muted">
          <Search size={48} className="mb-4" aria-hidden="true" />
          <p className="text-lg">{t('config.no_modules_match')}</p>
          <Button
            variant="tertiary"
            size="sm"
            className="mt-2"
            onPress={() => { setSearchQuery(''); setFilterType('all'); }}
          >
            {t('config.clear_filters')}
          </Button>
        </div>
      )}

      {/* Platform Infrastructure — tenant-wide settings that aren't tied to a module */}
      {!loading && !loadError && !searchQuery && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold mb-1">{t('config.platform_infrastructure')}</h2>
          <p className="text-sm text-muted mb-4">
            {t('config.platform_infrastructure_desc')}
          </p>
          <PlatformInfrastructure config={config} onConfigChange={setConfig} />
        </section>
      )}

      {/* Config modal */}
      <ModuleConfigModal
        module={selectedModule}
        isOpen={selectedModule !== null}
        onClose={handleModalClose}
      />

      <Modal isOpen={pendingPasskeyDisable} onOpenChange={setPendingPasskeyDisable}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-warning" aria-hidden="true" />
                {t('config.passkey_disable_title')}
              </ModalHeader>
              <ModalBody className="space-y-3">
                <p>{t('config.passkey_disable_warning')}</p>
                {passkeyImpact ? (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
                    <p>
                      {t(
                        passkeyImpact.registered_users === 1
                          ? 'config.passkey_disable_registered_users_one'
                          : 'config.passkey_disable_registered_users_other',
                        { count: passkeyImpact.registered_users },
                      )}
                    </p>
                    <p className="font-semibold text-danger">
                      {t(
                        passkeyImpact.passkey_only_users === 1
                          ? 'config.passkey_disable_passkey_only_users_one'
                          : 'config.passkey_disable_passkey_only_users_other',
                        { count: passkeyImpact.passkey_only_users },
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger" role="alert">
                    {t('config.passkey_disable_impact_unavailable')}
                  </div>
                )}
                <p className="text-sm text-muted">{t('config.passkey_disable_recovery')}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('config.cancel')}
                </Button>
                <Button
                  variant="danger"
                  isPending={toggling === 'biometric_login'}
                  isDisabled={!passkeyImpact}
                  onPress={async () => {
                    if (await applyToggle('biometric_login', false, true)) {
                      onClose();
                    }
                  }}
                >
                  {t('config.passkey_disable_confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
