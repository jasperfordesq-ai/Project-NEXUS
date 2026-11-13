// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The settings the admin Settings page saves through the enterprise config
 * endpoint: which keys exist, how they are typed, their defaults and
 * validation. Everything else on that page saves through /v2/admin/settings.
 *
 * Only settings the platform actually reads are listed. Owner decision,
 * 13 Nov 2026: thirteen controls came off the page. Ten saved to keys nothing
 * reads (default locale, currency name and symbol, the two auto-approve
 * switches, the email and push defaults, digest frequency, groups per member,
 * upload size); three work but are owned by another admin page (the
 * onboarding switch by Onboarding settings, the two listing limits by Module
 * Configuration). A stored value for any of them is left alone and never sent.
 */

import { getFormattingLocale } from '@/lib/helpers';

export interface ConfigSettingDef {
  key: string;
  label: string;
  description: string;
  type: 'number' | 'timezone';
  default?: string | number;
  /** Short unit shown after a number box (e.g. "hours"). */
  unit?: string;
  validation?: {
    min?: number;
    max?: number;
  };
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The most one transfer can carry on any community (WalletService::
 * PLATFORM_MAX_TRANSFER). A community's own limit is clamped to it, and 0
 * means "use it".
 */
export const PLATFORM_MAX_TRANSFER_HOURS = 1000;

/** Static type, default and validation — independent of translations. */
export type StaticSettingDef = Pick<ConfigSettingDef, 'key' | 'type' | 'default' | 'validation'>;

export const STATIC_SETTINGS: StaticSettingDef[] = [
  { key: 'timezone', type: 'timezone', default: 'UTC' },
  { key: 'starting_balance', type: 'number', default: 0, validation: { min: 0 } },
  { key: 'max_transaction', type: 'number', default: 0, validation: { min: 0, max: PLATFORM_MAX_TRANSFER_HOURS } },
];

/** Every key this half of the page may read or send. */
export const SCHEMA_KEYS: ReadonlySet<string> = new Set(STATIC_SETTINGS.map((s) => s.key));

/** Definitions keyed by setting key for fast lookup. */
export const SCHEMA_MAP: ReadonlyMap<string, StaticSettingDef> = new Map(STATIC_SETTINGS.map((s) => [s.key, s]));

/** The definitions with translated labels, help text and units. */
export function buildConfigSettings(t: Translate): ConfigSettingDef[] {
  const text: Record<string, Pick<ConfigSettingDef, 'label' | 'description' | 'unit'>> = {
    timezone: {
      label: t('enterprise.config_timezone'),
      description: t('enterprise.config_timezone_desc'),
    },
    starting_balance: {
      label: t('enterprise.config_starting_balance'),
      description: t('enterprise.config_starting_balance_desc'),
      unit: t('enterprise.config_unit_hours'),
    },
    max_transaction: {
      label: t('enterprise.config_max_transaction'),
      description: t('enterprise.config_max_transaction_desc', {
        max: new Intl.NumberFormat(getFormattingLocale()).format(PLATFORM_MAX_TRANSFER_HOURS),
      }),
      unit: t('enterprise.config_unit_hours'),
    },
  };
  return STATIC_SETTINGS.map((def) => ({ ...def, ...text[def.key]! }));
}

/**
 * Normalize a raw API value to the correct JS type based on schema definition.
 * Handles the string/number coercion issues from mixed storage formats.
 */
export function normalizeValue(raw: unknown, def: StaticSettingDef): unknown {
  if (raw === undefined || raw === null) return def.default ?? '';

  if (def.type === 'number') {
    if (typeof raw === 'number') return raw;
    const num = Number(raw);
    return isNaN(num) ? (def.default ?? 0) : num;
  }
  return String(raw);
}

/** Normalize all schema keys in a loaded config object. */
export function normalizeConfig(data: Record<string, unknown>): Record<string, unknown> {
  const result = { ...data };
  for (const [key, def] of SCHEMA_MAP) {
    result[key] = normalizeValue(result[key], def);
  }
  return result;
}

export function validateSetting(def: StaticSettingDef, value: unknown, t: Translate): string | null {
  const str = String(value ?? '');

  if (def.type === 'number' && str.trim() !== '') {
    const num = Number(str);
    if (isNaN(num)) return t('enterprise.validation_number');
    if (def.validation?.min !== undefined && num < def.validation.min) {
      return t('enterprise.validation_min', { value: def.validation.min });
    }
    if (def.validation?.max !== undefined && num > def.validation.max) {
      return t('enterprise.validation_max', { value: def.validation.max });
    }
  }

  return null;
}

/**
 * Settings that live on their own admin pages, listed at the foot of the
 * Settings page so an admin who came here for one of them is sent on.
 */
export interface RelatedAdminPage {
  labelKey: string;
  descriptionKey: string;
  /** Path relative to the tenant root (e.g. "/admin/federation"). Pass through tenantPath() at render. */
  href: string;
  destLabelKey: string;
}

export const RELATED_ADMIN_PAGES: RelatedAdminPage[] = [
  {
    labelKey: 'enterprise.related_onboarding_settings',
    descriptionKey: 'enterprise.related_onboarding_settings_desc',
    href: '/admin/onboarding-settings',
    destLabelKey: 'enterprise.related_onboarding',
  },
  {
    labelKey: 'enterprise.related_module_configuration',
    descriptionKey: 'enterprise.related_module_configuration_desc',
    href: '/admin/module-configuration',
    destLabelKey: 'enterprise.related_module_configuration_dest',
  },
  {
    labelKey: 'enterprise.related_registration_policy',
    descriptionKey: 'enterprise.related_registration_policy_desc',
    href: '/admin/settings/registration-policy',
    destLabelKey: 'enterprise.related_registration_policy',
  },
  {
    labelKey: 'enterprise.related_translation_settings',
    descriptionKey: 'enterprise.related_translation_settings_desc',
    href: '/admin/translation-config',
    destLabelKey: 'enterprise.related_translation_settings',
  },
  {
    labelKey: 'enterprise.related_image_settings',
    descriptionKey: 'enterprise.related_image_settings_desc',
    href: '/admin/image-settings',
    destLabelKey: 'enterprise.related_image_settings',
  },
  {
    labelKey: 'enterprise.related_federation',
    descriptionKey: 'enterprise.related_federation_desc',
    href: '/partner-timebanks',
    destLabelKey: 'enterprise.related_federation',
  },
  {
    labelKey: 'enterprise.related_broker_controls',
    descriptionKey: 'enterprise.related_broker_controls_desc',
    href: '/broker',
    destLabelKey: 'enterprise.related_broker_panel',
  },
  {
    labelKey: 'enterprise.related_safeguarding_options',
    descriptionKey: 'enterprise.related_safeguarding_options_desc',
    href: '/broker/safeguarding-options',
    destLabelKey: 'enterprise.related_safeguarding',
  },
  {
    labelKey: 'enterprise.related_operations',
    descriptionKey: 'enterprise.related_operations_desc',
    href: '/admin/operations',
    destLabelKey: 'enterprise.related_operations',
  },
];
