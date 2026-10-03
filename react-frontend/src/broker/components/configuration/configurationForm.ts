// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The configuration form's state, kept apart from the saved configuration.
 *
 * Numbers may be '' while a field is being cleared: the old page did
 * `parseInt(v) || 7`, so backspacing a value snapped it to a default before
 * the broker could type the new one. The blank is only rejected on save.
 */

import type { TFunction } from 'i18next';
import type { BrokerConfig } from '@/admin/api/types';
import { CONFIG_KEYS, CONFIGURATION_SETTINGS, type ConfigSettingDef } from './configurationSchema';

export type ConfigFormValues = {
  [K in keyof BrokerConfig]: BrokerConfig[K] extends number ? number | '' : BrokerConfig[K];
};

export function toFormValues(config: BrokerConfig): ConfigFormValues {
  const form = {} as Record<string, unknown>;
  for (const key of CONFIG_KEYS) {
    const value = config[key];
    form[key] = typeof value === 'number' && !Number.isFinite(value) ? '' : value;
  }
  return form as ConfigFormValues;
}

/** The form as a configuration; a blank number falls back to the saved value. */
export function fromFormValues(form: ConfigFormValues, saved: BrokerConfig): BrokerConfig {
  const config = {} as Record<string, unknown>;
  for (const key of CONFIG_KEYS) {
    const value = form[key];
    config[key] = value === '' ? saved[key] : value;
  }
  return config as unknown as BrokerConfig;
}

/** True when any shown setting differs from what the server last returned. */
export function isConfigDirty(form: ConfigFormValues, saved: BrokerConfig): boolean {
  return CONFIG_KEYS.some((key) => form[key] !== saved[key]);
}

/** The keys whose form value differs from the saved one. */
export function changedConfigKeys(form: ConfigFormValues, saved: BrokerConfig): (keyof BrokerConfig)[] {
  return CONFIG_KEYS.filter((key) => form[key] !== saved[key]);
}

function settingLabel(setting: ConfigSettingDef, t: TFunction<'broker'>): string {
  return t(`configuration.field_${setting.key}_label`);
}

/**
 * The first problem that stops a save, as a translated message, or null.
 * Checked against the schema's bounds; only number settings can fail.
 */
export function validateConfigForm(form: ConfigFormValues, t: TFunction<'broker'>): string | null {
  for (const setting of CONFIGURATION_SETTINGS) {
    if (setting.type !== 'number') continue;
    const value = form[setting.key];
    if (value === '' || typeof value !== 'number' || !Number.isFinite(value)) {
      return t('configuration.invalid_number', { field: settingLabel(setting, t) });
    }
    if ((setting.min !== undefined && value < setting.min) || (setting.max !== undefined && value > setting.max)) {
      return t('configuration.number_out_of_range', {
        field: settingLabel(setting, t),
        min: setting.min ?? '',
        max: setting.max ?? '',
      });
    }
  }
  return null;
}
