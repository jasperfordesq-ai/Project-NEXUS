// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * State and persistence for the "additional configuration" half of the admin
 * Settings page (wallet, moderation, notifications, limits, …). Lifted out of
 * SystemConfig.tsx so the page's single sticky Save bar can save this half
 * together with the main form. The hook never toasts: the page owns messaging.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts';
import { isPlatformSuperAdminUser } from '@/lib/access';
import { adminEnterprise } from '../../api/adminApi';
import {
  buildConfigSchema,
  normalizeConfig,
  validateSetting,
  PLATFORM_SUPER_ADMIN_CONFIG_KEYS,
  READ_ONLY_CONFIG_KEYS,
  SCHEMA_KEYS,
  SUPPORTED_LOCALE_CODES,
  type ConfigGroup,
  type ConfigSettingDef,
} from './systemConfigSchema';

export type SaveOutcome = { ok: true; changed: boolean } | { ok: false; error?: string };

export interface SystemConfigFormState {
  /** Last loaded (normalised) values. */
  config: Record<string, unknown>;
  edited: Record<string, unknown>;
  errors: Record<string, string>;
  loading: boolean;
  loadError: boolean;
  saving: boolean;
  dirty: boolean;
  /** Keys whose edited value differs from the loaded one. */
  dirtyKeys: ReadonlySet<string>;
  /** Translated schema with excluded keys removed and empty groups dropped. */
  schema: ConfigGroup[];
  /** Translated language options for the `locale` select. */
  localeOptions: { label: string; value: string }[];
  /** True when the current admin may not change this key (F-054). */
  isTierLocked: (key: string) => boolean;
  isReadOnly: (key: string) => boolean;
  getValue: (key: string, defaultVal?: unknown) => unknown;
  setValue: (key: string, value: unknown, def?: ConfigSettingDef) => void;
  /** Validates every visible field, stores and returns the errors. */
  validateAll: () => Record<string, string>;
  /** Changed, writable keys only — what save() would PUT. */
  buildPayload: () => Record<string, unknown>;
  save: () => Promise<SaveOutcome>;
  reset: () => Promise<{ ok: boolean }>;
  reload: () => Promise<void>;
  discard: () => void;
}

export interface UseSystemConfigFormOptions {
  /** Setting keys owned by the parent form; hidden here and never sent. */
  excludeKeys?: readonly string[];
  /** Icons for each group, keyed by group key. */
  icons?: Record<string, ReactNode>;
}

// Module-level so a caller passing no icons does not hand the hook a fresh
// object every render (which would rebuild the schema and refetch in a loop).
const NO_ICONS: Record<string, ReactNode> = {};

export function useSystemConfigForm({ excludeKeys, icons = NO_ICONS }: UseSystemConfigFormOptions = {}): SystemConfigFormState {
  const { t } = useTranslation(['admin_enterprise', 'admin_system']);
  const { user } = useAuth();
  const canChangePlatformKeys = isPlatformSuperAdminUser(user);

  const excludeSet = useMemo(() => new Set(excludeKeys ?? []), [excludeKeys]);

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [edited, setEdited] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const isTierLocked = useCallback(
    (key: string) => PLATFORM_SUPER_ADMIN_CONFIG_KEYS.has(key) && !canChangePlatformKeys,
    [canChangePlatformKeys],
  );
  const isReadOnly = useCallback(
    (key: string) => READ_ONLY_CONFIG_KEYS.has(key) || isTierLocked(key),
    [isTierLocked],
  );

  const localeOptions = useMemo(
    () => SUPPORTED_LOCALE_CODES.map((code) => ({ label: t(`system.lang_${code}`), value: code })),
    [t],
  );

  const fullSchema = useMemo(() => buildConfigSchema(t, icons), [t, icons]);
  const schema = useMemo(() => {
    // Once the parent form owns name/description/contact and the sign-up
    // gates, what is left of these two groups is localisation and onboarding,
    // so they are renamed to say what they now contain.
    const relabel: Record<string, { label: string; description: string }> = {
      general: {
        label: t('admin_system:admin_settings.localisation_section'),
        description: t('admin_system:admin_settings.localisation_section_desc'),
      },
      registration: {
        label: t('admin_system:admin_settings.onboarding_section'),
        description: t('admin_system:admin_settings.onboarding_section_desc'),
      },
    };
    return fullSchema
      .map((g) => ({ ...g, settings: g.settings.filter((s) => !excludeSet.has(s.key)) }))
      .filter((g) => g.settings.length > 0)
      .map((g) => (excludeSet.size > 0 && relabel[g.key] ? { ...g, ...relabel[g.key] } : g));
  }, [fullSchema, excludeSet, t]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminEnterprise.getConfig();
      if (!res.success || !res.data) {
        setLoadError(true);
        return;
      }
      const raw = res.data as unknown as Record<string, unknown>;
      // Built here from `t` alone (not from the memoised schema) so reload()'s
      // identity does not depend on the caller's icons object.
      const localizedDefaults = new Map(
        buildConfigSchema(t, NO_ICONS)
          .flatMap((group) => group.settings)
          .map((setting) => [setting.key, setting.default] as const),
      );
      const data = normalizeConfig(raw, localizedDefaults);
      setConfig(data);
      setEdited({ ...data });
      setErrors({});
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirtyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of SCHEMA_KEYS) {
      if (excludeSet.has(key)) continue;
      if (key in edited && JSON.stringify(edited[key]) !== JSON.stringify(config[key])) keys.add(key);
    }
    return keys;
  }, [edited, config, excludeSet]);
  const dirty = dirtyKeys.size > 0;

  const getValue = useCallback((key: string, defaultVal?: unknown) => edited[key] ?? defaultVal ?? '', [edited]);

  const setValue = useCallback((key: string, value: unknown, def?: ConfigSettingDef) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
    if (def) {
      const error = validateSetting(def, value, t);
      setErrors((prev) => {
        const next = { ...prev };
        if (error) next[key] = error;
        else delete next[key];
        return next;
      });
    }
  }, [t]);

  const validateAll = useCallback(() => {
    const newErrors: Record<string, string> = {};
    for (const group of schema) {
      for (const def of group.settings) {
        const error = validateSetting(def, edited[def.key] ?? def.default ?? '', t);
        if (error) newErrors[def.key] = error;
      }
    }
    setErrors(newErrors);
    return newErrors;
  }, [schema, edited, t]);

  const buildPayload = useCallback(() => {
    // Only fields the admin actually changed — prevents clobbering values set
    // on other pages. maintenance_mode is never sent (CLI-only); platform
    // super-admin-only keys are left out for everyone else (F-054).
    const payload: Record<string, unknown> = {};
    for (const key of dirtyKeys) {
      if (isReadOnly(key)) continue;
      payload[key] = edited[key];
    }
    return payload;
  }, [dirtyKeys, edited, isReadOnly]);

  const save = useCallback(async (): Promise<SaveOutcome> => {
    if (loadError) return { ok: false, error: t('enterprise.settings_not_loaded') };
    const payload = buildPayload();
    if (Object.keys(payload).length === 0) return { ok: true, changed: false };
    setSaving(true);
    try {
      const res = await adminEnterprise.updateConfig(payload);
      if (!res.success) {
        // admin-i18n-ignore: localized server message — AdminEnterpriseController
        // refusals are __() keys.
        return { ok: false, error: res.error || t('enterprise.failed_to_save_settings') };
      }
      await reload();
      return { ok: true, changed: true };
    } catch {
      return { ok: false, error: t('enterprise.failed_to_save_settings') };
    } finally {
      setSaving(false);
    }
  }, [loadError, buildPayload, reload, t]);

  const reset = useCallback(async () => {
    setSaving(true);
    try {
      const res = await adminEnterprise.resetConfig();
      if (!res.success) return { ok: false };
      await reload();
      return { ok: true };
    } catch {
      return { ok: false };
    } finally {
      setSaving(false);
    }
  }, [reload]);

  const discard = useCallback(() => {
    setEdited({ ...config });
    setErrors({});
  }, [config]);

  return {
    config,
    edited,
    errors,
    loading,
    loadError,
    saving,
    dirty,
    dirtyKeys,
    schema,
    localeOptions,
    isTierLocked,
    isReadOnly,
    getValue,
    setValue,
    validateAll,
    buildPayload,
    save,
    reset,
    reload,
    discard,
  };
}

export default useSystemConfigForm;
