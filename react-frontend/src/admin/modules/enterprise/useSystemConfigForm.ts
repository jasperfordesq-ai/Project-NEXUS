// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * State and persistence for the settings the admin Settings page saves through
 * the enterprise config endpoint (time zone, starting balance, largest
 * transfer). Kept apart from the main form so the page's single sticky Save
 * bar can save both. The hook never toasts: the page owns messaging.
 *
 * The endpoint knows many more keys than this page offers. Only the keys in
 * SCHEMA_KEYS are ever compared or sent, so nothing else can be written from
 * here whatever a caller sets.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminEnterprise } from '../../api/adminApi';
import {
  buildConfigSettings,
  normalizeConfig,
  validateSetting,
  SCHEMA_KEYS,
  SCHEMA_MAP,
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
  /** Translated definitions of every setting this hook owns. */
  settings: ConfigSettingDef[];
  getValue: (key: string) => unknown;
  setValue: (key: string, value: unknown) => void;
  /** Validates every field, stores and returns the errors. */
  validateAll: () => Record<string, string>;
  /** Changed keys only — what save() would PUT. */
  buildPayload: () => Record<string, unknown>;
  save: () => Promise<SaveOutcome>;
  reload: () => Promise<void>;
  discard: () => void;
}

export function useSystemConfigForm(): SystemConfigFormState {
  const { t } = useTranslation('admin_enterprise');

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [edited, setEdited] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);

  const settings = useMemo(() => buildConfigSettings(t), [t]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminEnterprise.getConfig();
      if (!res.success || !res.data) {
        setLoadError(true);
        return;
      }
      const data = normalizeConfig(res.data as unknown as Record<string, unknown>);
      setConfig(data);
      setEdited({ ...data });
      setErrors({});
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirtyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of SCHEMA_KEYS) {
      if (key in edited && JSON.stringify(edited[key]) !== JSON.stringify(config[key])) keys.add(key);
    }
    return keys;
  }, [edited, config]);
  const dirty = dirtyKeys.size > 0;

  const getValue = useCallback(
    (key: string) => edited[key] ?? SCHEMA_MAP.get(key)?.default ?? '',
    [edited],
  );

  const setValue = useCallback((key: string, value: unknown) => {
    setEdited((prev) => ({ ...prev, [key]: value }));
    const def = SCHEMA_MAP.get(key);
    if (!def) return;
    const error = validateSetting(def, value, t);
    setErrors((prev) => {
      const next = { ...prev };
      if (error) next[key] = error;
      else delete next[key];
      return next;
    });
  }, [t]);

  const validateAll = useCallback(() => {
    const newErrors: Record<string, string> = {};
    for (const def of SCHEMA_MAP.values()) {
      const error = validateSetting(def, edited[def.key] ?? def.default ?? '', t);
      if (error) newErrors[def.key] = error;
    }
    setErrors(newErrors);
    return newErrors;
  }, [edited, t]);

  const buildPayload = useCallback(() => {
    // Only fields the admin actually changed — prevents clobbering values set
    // on other pages.
    const payload: Record<string, unknown> = {};
    for (const key of dirtyKeys) payload[key] = edited[key];
    return payload;
  }, [dirtyKeys, edited]);

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
    settings,
    getValue,
    setValue,
    validateAll,
    buildPayload,
    save,
    reload,
    discard,
  };
}

export default useSystemConfigForm;
