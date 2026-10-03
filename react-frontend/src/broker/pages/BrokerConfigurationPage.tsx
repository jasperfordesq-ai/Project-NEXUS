// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Configuration
 * Configure broker controls, messaging oversight, and risk settings.
 * Parity: PHP BrokerControlsController::configuration()
 *
 * The page renders its rows from `components/configuration/configurationSchema.ts`:
 * grouped section cards with jump links, admin-only settings surfaced with
 * the shared AdminOnlyBadge, number fields with their unit, a sticky save
 * bar (Save disabled when clean, Discard restores the loaded values), an
 * unsaved-changes guard on leaving, and an honest load-error state. A
 * non-admin's save sends only the settings they changed (F-547).
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Settings from 'lucide-react/icons/settings';
import Lock from 'lucide-react/icons/lock';
import AlertCircle from 'lucide-react/icons/circle-alert';

import { Button, Alert } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerConfig } from '@/admin/api/types';
import { useAuth, useTenant, useToast } from '@/contexts';
import { isAdminTierUser } from '@/lib/access';
import { BrokerPageShell, BrokerSkeleton, BrokerEmptyState } from '../components';
import {
  ConfigurationSection,
  ConfigurationSaveBar,
  configSectionAnchor,
  useUnsavedChangesGuard,
  CONFIGURATION_SCHEMA,
  ADMIN_ONLY_CONFIG_KEYS,
  DEFAULT_BROKER_CONFIG,
  toFormValues,
  fromFormValues,
  isConfigDirty,
  changedConfigKeys,
  validateConfigForm,
  type ConfigFormValues,
} from '../components/configuration';

export default function BrokerConfiguration() {
  const { t } = useTranslation('broker');
  usePageTitle(t('configuration.page_title'));
  const { hasFeature } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  // `saved` is the configuration as the server last returned it (the keys
  // this page knows); `form` is what the broker is editing. Dirty is the
  // difference between the two, so toggling a switch back makes the page
  // clean again.
  const [saved, setSaved] = useState<BrokerConfig>(DEFAULT_BROKER_CONFIG);
  const [form, setForm] = useState<ConfigFormValues>(() => toFormValues(DEFAULT_BROKER_CONFIG));

  // The raw server object, which carries admin-only keys this page never
  // shows (e.g. exchange_workflow_enabled). An admin's save echoes them back
  // unchanged; a broker's save must never include them (F-547).
  const savedRawRef = useRef<Partial<BrokerConfig>>({});

  const isAdminTier = isAdminTierUser(user);
  const canEditKey = useCallback(
    (key: keyof BrokerConfig) => isAdminTier || !ADMIN_ONLY_CONFIG_KEYS.has(key),
    [isAdminTier],
  );

  // Stash t/toast in refs so loadConfig's identity never churns (a t/toast
  // dependency would refetch on every language switch and can loop vitest).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getConfiguration();
      if (res.success && res.data) {
        savedRawRef.current = res.data;
        const next = { ...DEFAULT_BROKER_CONFIG, ...res.data };
        setSaved(next);
        setForm(toFormValues(next));
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('configuration.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const dirty = useMemo(() => isConfigDirty(form, saved), [form, saved]);
  useUnsavedChangesGuard(dirty && !loading && !loadError);

  async function handleSave() {
    const problem = validateConfigForm(form, t);
    if (problem) {
      toast.error(problem);
      return;
    }
    setSaving(true);
    try {
      const next = fromFormValues(form, saved);
      // F-547: a non-admin sends only the settings they changed. The server
      // refuses the whole save if it contains any admin-only key, even
      // unchanged — including ones an admin set to an admin-only value
      // (random_sample_percentage at 100, F-242).
      const payload: Partial<BrokerConfig> = isAdminTier
        ? { ...savedRawRef.current, ...next }
        : Object.fromEntries(
            changedConfigKeys(form, saved)
              .filter(canEditKey)
              .map((key) => [key, next[key]]),
          );

      const res = await adminBroker.saveConfiguration(payload);
      if (res.success) {
        savedRawRef.current = { ...savedRawRef.current, ...payload, ...res.data };
        const confirmed = { ...next, ...res.data };
        setSaved(confirmed);
        setForm(toFormValues(confirmed));
        toast.success(t('configuration.save_success'));
      } else {
        toast.error(t('configuration.save_failed'));
      }
    } catch {
      toast.error(t('configuration.save_failed'));
    } finally {
      setSaving(false);
    }
  }

  function handleDiscard() {
    setForm(toFormValues(saved));
  }

  const updateField = useCallback(
    <K extends keyof BrokerConfig>(key: K, value: ConfigFormValues[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const visibleSections = CONFIGURATION_SCHEMA.filter((section) => !section.feature || hasFeature(section.feature));

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_role', articleId: 'broker_configuration' }}
      title={t('configuration.title')}
      description={t('configuration.description')}
      icon={Settings}
      color="neutral"
    >
      {loading ? (
        <BrokerSkeleton variant="cards" count={4} />
      ) : loadError ? (
        // Honest error state — never render editable defaults over a failed
        // load, where "Save" would silently overwrite the tenant's settings.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('configuration.load_error_title')}
          hint={t('configuration.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={loadConfig}>
              {t('configuration.retry')}
            </Button>
          }
        />
      ) : (
        <>
          <div className="space-y-6">
            {!isAdminTier && (
              // Dark text on the card surface with an amber edge: the amber-on-
              // pale-amber card this replaces measured 3.6:1, below WCAG AA.
              <Alert
                color="warning"
                className="rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface p-4 shadow-sm"
                classNames={{
                  title: 'text-sm font-semibold text-foreground',
                  description: 'text-sm leading-6 text-foreground',
                  icon: 'text-warning',
                }}
                icon={<Lock size={18} aria-hidden="true" />}
                title={t('configuration.limited_access_title')}
                description={t('configuration.limited_access_body')}
              />
            )}

            {/* Section jump links — a long page, one click to the right card */}
            <nav aria-label={t('configuration.jump_to_section')} className="flex flex-wrap gap-2">
              {visibleSections.map((section) => (
                <a
                  key={section.id}
                  href={`#${configSectionAnchor(section.id)}`}
                  className="rounded-full border border-divider bg-surface px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-surface-secondary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  {t(`configuration.section_${section.id}`)}
                </a>
              ))}
            </nav>

            {visibleSections.map((section) => (
              <ConfigurationSection
                key={section.id}
                section={section}
                form={form}
                canEditKey={canEditKey}
                onChange={updateField}
              />
            ))}
          </div>

          <ConfigurationSaveBar dirty={dirty} saving={saving} onSave={handleSave} onDiscard={handleDiscard} />
        </>
      )}
    </BrokerPageShell>
  );
}
