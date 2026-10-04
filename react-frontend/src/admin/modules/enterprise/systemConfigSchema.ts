// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Schema for the "additional configuration" half of the admin Settings page:
 * which keys exist, how they are typed, their defaults and validation. Moved
 * out of SystemConfig.tsx unchanged so the form hook and the presentational
 * component share one definition.
 */

import type { ReactNode } from 'react';

export interface ConfigSettingDef {
  key: string;
  label: string;
  description: string;
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea' | 'email' | 'url';
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
  validation?: {
    required?: boolean;
    min?: number;
    max?: number;
    pattern?: string;
  };
  /**
   * Optional inline "Configure" link rendered next to the control. Use for
   * master-switch settings whose full configuration lives on another page.
   */
  manage?: { href: string; label: string };
}

export interface ConfigGroup {
  key: string;
  /** Translated section title. */
  label: string;
  /** Translated one-line description. */
  description: string;
  icon: ReactNode;
  settings: ConfigSettingDef[];
}

export type Translate = (key: string, options?: Record<string, unknown>) => string;

// Supported platform language codes — names resolved via i18n inside the component
export const SUPPORTED_LOCALE_CODES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;

/**
 * Build the config schema with translated labels and descriptions. Icons are
 * supplied by the caller so this module stays free of JSX.
 */
export function buildConfigSchema(t: Translate, icons: Record<string, ReactNode>): ConfigGroup[] {
  return [
    {
      key: 'general',
      // The Settings page relabels this group "Localisation" once its name,
      // description and contact fields are excluded (see useSystemConfigForm).
      label: t('enterprise.config_group_general'),
      description: t('enterprise.config_group_general_desc'),
      icon: icons.general,
      settings: [
        { key: 'site_name', label: t('enterprise.config_site_name'), description: t('enterprise.config_site_name_desc'), type: 'text', default: '' },
        { key: 'site_description', label: t('enterprise.config_site_description'), description: t('enterprise.config_site_description_desc'), type: 'textarea', default: '' },
        { key: 'contact_email', label: t('enterprise.config_contact_email'), description: t('enterprise.config_contact_email_desc'), type: 'email', default: '' },
        { key: 'contact_phone', label: t('enterprise.config_contact_phone'), description: t('enterprise.config_contact_phone_desc'), type: 'text', default: '' },
        { key: 'timezone', label: t('enterprise.config_timezone'), description: t('enterprise.config_timezone_desc'), type: 'text', default: 'UTC' },
        { key: 'footer_text', label: t('enterprise.config_footer_text'), description: t('enterprise.config_footer_text_desc'), type: 'textarea', default: '' },
        {
          key: 'locale', label: t('enterprise.config_locale'), description: t('enterprise.config_locale_desc'), type: 'select', default: 'en',
          options: SUPPORTED_LOCALE_CODES.map((code) => ({ label: code, value: code })),
        },
      ],
    },
    {
      key: 'registration',
      label: t('enterprise.config_group_registration'),
      description: t('enterprise.config_group_registration_desc'),
      icon: icons.registration,
      settings: [
        { key: 'registration_enabled', label: t('enterprise.config_registration_enabled'), description: t('enterprise.config_registration_enabled_desc'), type: 'boolean', default: true },
        { key: 'require_approval', label: t('enterprise.config_require_approval'), description: t('enterprise.config_require_approval_desc'), type: 'boolean', default: false },
        { key: 'require_email_verification', label: t('enterprise.config_require_email_verification'), description: t('enterprise.config_require_email_verification_desc'), type: 'boolean', default: true },
        { key: 'maintenance_mode', label: t('enterprise.config_maintenance_mode'), description: t('enterprise.config_maintenance_mode_desc'), type: 'boolean', default: false },
        {
          key: 'onboarding_enabled',
          label: t('enterprise.config_onboarding_enabled'),
          description: t('enterprise.config_onboarding_enabled_desc'),
          type: 'boolean',
          default: true,
          manage: { href: '/admin/onboarding-settings', label: t('enterprise.config_configure_steps') },
        },
        { key: 'welcome_message', label: t('enterprise.config_welcome_message'), description: t('enterprise.config_welcome_message_desc'), type: 'textarea', default: '' },
      ],
    },
    {
      key: 'wallet',
      label: t('enterprise.config_group_wallet'),
      description: t('enterprise.config_group_wallet_desc'),
      icon: icons.wallet,
      settings: [
        { key: 'starting_balance', label: t('enterprise.config_starting_balance'), description: t('enterprise.config_starting_balance_desc'), type: 'number', default: 0, validation: { min: 0 } },
        { key: 'max_transaction', label: t('enterprise.config_max_transaction'), description: t('enterprise.config_max_transaction_desc'), type: 'number', default: 0, validation: { min: 0 } },
        { key: 'currency_name', label: t('enterprise.config_currency_name'), description: t('enterprise.config_currency_name_desc'), type: 'text', default: t('enterprise.config_default_currency_name') },
        { key: 'currency_symbol', label: t('enterprise.config_currency_symbol'), description: t('enterprise.config_currency_symbol_desc'), type: 'text', default: 'h' },
      ],
    },
    {
      key: 'content',
      label: t('enterprise.config_group_content'),
      description: t('enterprise.config_group_content_desc'),
      icon: icons.content,
      settings: [
        { key: 'auto_approve_listings', label: t('enterprise.config_auto_approve_listings'), description: t('enterprise.config_auto_approve_listings_desc'), type: 'boolean', default: true },
        { key: 'auto_approve_blog', label: t('enterprise.config_auto_approve_blog'), description: t('enterprise.config_auto_approve_blog_desc'), type: 'boolean', default: false },
        { key: 'max_listing_images', label: t('enterprise.config_max_listing_images'), description: t('enterprise.config_max_listing_images_desc'), type: 'number', default: 5, validation: { min: 1, max: 20 } },
        { key: 'profanity_filter', label: t('enterprise.config_profanity_filter'), description: t('enterprise.config_profanity_filter_desc'), type: 'boolean', default: false },
      ],
    },
    {
      key: 'notifications',
      label: t('enterprise.config_group_notifications'),
      description: t('enterprise.config_group_notifications_desc'),
      icon: icons.notifications,
      settings: [
        { key: 'email_notifications_enabled', label: t('enterprise.config_email_notifications_enabled'), description: t('enterprise.config_email_notifications_enabled_desc'), type: 'boolean', default: true },
        { key: 'push_notifications_enabled', label: t('enterprise.config_push_notifications_enabled'), description: t('enterprise.config_push_notifications_enabled_desc'), type: 'boolean', default: true },
        {
          key: 'digest_frequency', label: t('enterprise.config_digest_frequency'), description: t('enterprise.config_digest_frequency_desc'), type: 'select', default: 'monthly',
          options: [
            { label: t('enterprise.config_digest_daily'), value: 'daily' },
            { label: t('enterprise.config_digest_weekly'), value: 'weekly' },
            { label: t('enterprise.config_digest_monthly'), value: 'monthly' },
            { label: t('enterprise.config_digest_never'), value: 'never' },
          ],
        },
      ],
    },
    {
      key: 'limits',
      label: t('enterprise.config_group_limits'),
      description: t('enterprise.config_group_limits_desc'),
      icon: icons.limits,
      settings: [
        { key: 'max_listings_per_user', label: t('enterprise.config_max_listings_per_user'), description: t('enterprise.config_max_listings_per_user_desc'), type: 'number', default: 0, validation: { min: 0 } },
        { key: 'max_groups_per_user', label: t('enterprise.config_max_groups_per_user'), description: t('enterprise.config_max_groups_per_user_desc'), type: 'number', default: 0, validation: { min: 0 } },
        { key: 'max_file_upload_mb', label: t('enterprise.config_max_file_upload_mb'), description: t('enterprise.config_max_file_upload_mb_desc'), type: 'number', default: 10, validation: { min: 1, max: 100 } },
      ],
    },
  ];
}

/** Static type+default definitions for normalization/validation — no labels (those come from translations) */
export type StaticSettingDef = Pick<ConfigSettingDef, 'key' | 'type' | 'default' | 'validation'>;

export const STATIC_SETTINGS: StaticSettingDef[] = [
  { key: 'site_name', type: 'text', default: '' },
  { key: 'site_description', type: 'textarea', default: '' },
  { key: 'contact_email', type: 'email', default: '' },
  { key: 'contact_phone', type: 'text', default: '' },
  { key: 'timezone', type: 'text', default: 'UTC' },
  { key: 'footer_text', type: 'textarea', default: '' },
  { key: 'locale', type: 'select', default: 'en' },
  { key: 'registration_enabled', type: 'boolean', default: true },
  { key: 'require_approval', type: 'boolean', default: false },
  { key: 'require_email_verification', type: 'boolean', default: true },
  { key: 'maintenance_mode', type: 'boolean', default: false },
  { key: 'onboarding_enabled', type: 'boolean', default: true },
  { key: 'welcome_message', type: 'textarea', default: '' },
  { key: 'starting_balance', type: 'number', default: 0, validation: { min: 0 } },
  { key: 'max_transaction', type: 'number', default: 0, validation: { min: 0 } },
  { key: 'currency_name', type: 'text', default: '' },
  { key: 'currency_symbol', type: 'text', default: 'h' },
  { key: 'auto_approve_listings', type: 'boolean', default: true },
  { key: 'auto_approve_blog', type: 'boolean', default: false },
  { key: 'max_listing_images', type: 'number', default: 5, validation: { min: 1, max: 20 } },
  { key: 'profanity_filter', type: 'boolean', default: false },
  { key: 'email_notifications_enabled', type: 'boolean', default: true },
  { key: 'push_notifications_enabled', type: 'boolean', default: true },
  { key: 'digest_frequency', type: 'select', default: 'monthly' },
  { key: 'max_listings_per_user', type: 'number', default: 0, validation: { min: 0 } },
  { key: 'max_groups_per_user', type: 'number', default: 0, validation: { min: 0 } },
  { key: 'max_file_upload_mb', type: 'number', default: 10, validation: { min: 1, max: 100 } },
];

/** All known schema keys — static list for normalization/validation (independent of translations) */
export const SCHEMA_KEYS: ReadonlySet<string> = new Set(STATIC_SETTINGS.map((s) => s.key));

/**
 * Keys only a platform super-admin may change (F-054). They land on
 * general.email_verification / general.admin_approval, which the server
 * refuses from anyone else with 403, so they are locked in the UI and never
 * sent for other admins. maintenance_mode is CLI-only and never sent at all.
 */
export const PLATFORM_SUPER_ADMIN_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'require_approval',
  'require_email_verification',
]);

/** Settings managed outside this page and never written from it. */
export const READ_ONLY_CONFIG_KEYS: ReadonlySet<string> = new Set(['maintenance_mode']);

/** Schema definitions keyed by setting key for fast lookup */
export const SCHEMA_MAP: ReadonlyMap<string, StaticSettingDef> = new Map(STATIC_SETTINGS.map((s) => [s.key, s]));

/**
 * Normalize a raw API value to the correct JS type based on schema definition.
 * Handles all the string/boolean/number coercion issues from mixed storage formats.
 */
export function normalizeValue(raw: unknown, def: StaticSettingDef): unknown {
  if (raw === undefined || raw === null) return def.default ?? '';

  switch (def.type) {
    case 'boolean':
      if (typeof raw === 'boolean') return raw;
      if (typeof raw === 'number') return raw !== 0;
      if (typeof raw === 'string') {
        return raw === 'true' || raw === '1' || raw === 'on';
      }
      return Boolean(raw);

    case 'number': {
      if (typeof raw === 'number') return raw;
      const num = Number(raw);
      return isNaN(num) ? (def.default ?? 0) : num;
    }

    case 'select':
    case 'text':
    case 'email':
    case 'url':
    case 'textarea':
      return String(raw ?? '');

    default:
      return raw;
  }
}

/** Normalize all schema keys in a loaded config object */
export function normalizeConfig(
  data: Record<string, unknown>,
  localizedDefaults: ReadonlyMap<string, ConfigSettingDef['default']>,
): Record<string, unknown> {
  const result = { ...data };
  for (const [key, def] of SCHEMA_MAP) {
    result[key] = normalizeValue(result[key], {
      ...def,
      default: localizedDefaults.get(key) ?? def.default,
    });
  }
  return result;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;

export function validateSetting(def: ConfigSettingDef, value: unknown, t: Translate): string | null {
  const str = String(value ?? '');

  if (def.validation?.required && str.trim() === '') {
    return t('enterprise.validation_required');
  }

  if (def.type === 'email' && str.trim() !== '' && !EMAIL_RE.test(str)) {
    return t('enterprise.validation_email');
  }

  if (def.type === 'url' && str.trim() !== '' && !URL_RE.test(str)) {
    return t('enterprise.validation_url');
  }

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

  if (def.validation?.pattern && str.trim() !== '') {
    const re = new RegExp(def.validation.pattern);
    if (!re.test(str)) return t('enterprise.validation_format');
  }

  return null;
}

/**
 * Curated list of related admin pages. Always visible — these are peer
 * configuration pages that admins commonly reach for from the Settings page.
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
    labelKey: 'enterprise.related_operations',
    descriptionKey: 'enterprise.related_operations_desc',
    href: '/admin/operations',
    destLabelKey: 'enterprise.related_operations',
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
    labelKey: 'enterprise.related_registration_policy',
    descriptionKey: 'enterprise.related_registration_policy_desc',
    href: '/admin/settings/registration-policy',
    destLabelKey: 'enterprise.related_registration_policy',
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
];
