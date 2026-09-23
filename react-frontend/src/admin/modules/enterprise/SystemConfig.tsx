import { Card, CardBody, CardHeader, Input, Button, Spinner, Textarea, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tooltip } from '@/components/ui';
import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import ArrowRight from 'lucide-react/icons/arrow-right';
import { useAuth, useTenant } from '@/contexts';
import { isPlatformSuperAdminUser } from '@/lib/access';
import Save from 'lucide-react/icons/save';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Settings2 from 'lucide-react/icons/settings-2';
import UserPlus from 'lucide-react/icons/user-plus';
import Wallet from 'lucide-react/icons/wallet';
import Shield from 'lucide-react/icons/shield';
import Bell from 'lucide-react/icons/bell';
import Gauge from 'lucide-react/icons/gauge';
import Info from 'lucide-react/icons/info';
import { useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * System Configuration
 * Grouped settings editor with descriptions, validation, and reset-to-defaults.
 * Replaces the legacy flat key-value editor.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Config schema types
// ─────────────────────────────────────────────────────────────────────────────

interface ConfigSettingDef {
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

interface ConfigGroup {
  key: string;
  label: string;
  description: string;
  icon: ReactNode;
  settings: ConfigSettingDef[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Config schema definition
// ─────────────────────────────────────────────────────────────────────────────

// Supported platform language codes — names resolved via i18n inside the component
const SUPPORTED_LOCALE_CODES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;

/** Build the config schema with translated labels and descriptions. */
function buildConfigSchema(t: (key: string, options?: Record<string, unknown>) => string): ConfigGroup[] {
  return [
    {
      key: 'general',
      label: t('enterprise.config_group_general'),
      description: t('enterprise.config_group_general_desc'),
      icon: <Settings2 size={18} />,
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
      icon: <UserPlus size={18} />,
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
      icon: <Wallet size={18} />,
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
      icon: <Shield size={18} />,
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
      icon: <Bell size={18} />,
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
      icon: <Gauge size={18} />,
      settings: [
        { key: 'max_listings_per_user', label: t('enterprise.config_max_listings_per_user'), description: t('enterprise.config_max_listings_per_user_desc'), type: 'number', default: 0, validation: { min: 0 } },
        { key: 'max_groups_per_user', label: t('enterprise.config_max_groups_per_user'), description: t('enterprise.config_max_groups_per_user_desc'), type: 'number', default: 0, validation: { min: 0 } },
        { key: 'max_file_upload_mb', label: t('enterprise.config_max_file_upload_mb'), description: t('enterprise.config_max_file_upload_mb_desc'), type: 'number', default: 10, validation: { min: 1, max: 100 } },
      ],
    },
  ];
}

/** Static type+default definitions for normalization/validation — no labels (those come from translations) */
type StaticSettingDef = Pick<ConfigSettingDef, 'key' | 'type' | 'default' | 'validation'>;

const STATIC_SETTINGS: StaticSettingDef[] = [
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
const SCHEMA_KEYS = new Set(STATIC_SETTINGS.map((s) => s.key));

/**
 * Keys only a platform super-admin may change (F-054). They land on
 * general.email_verification / general.admin_approval, which the server
 * refuses from anyone else with 403, so they are locked in the UI and never
 * sent for other admins. maintenance_mode is CLI-only and never sent at all.
 */
const PLATFORM_SUPER_ADMIN_CONFIG_KEYS: ReadonlySet<string> = new Set([
  'require_approval',
  'require_email_verification',
]);

/**
 * Curated list of related admin pages. Always visible — these are peer
 * configuration pages that admins commonly reach for from the Settings page.
 */
interface RelatedAdminPage {
  labelKey: string;
  descriptionKey: string;
  /** Path relative to the tenant root (e.g. "/admin/federation"). Pass through tenantPath() at render. */
  href: string;
  destLabelKey: string;
}

const RELATED_ADMIN_PAGES: RelatedAdminPage[] = [
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

/** Schema definitions keyed by setting key for fast lookup */
const SCHEMA_MAP = new Map<string, StaticSettingDef>(STATIC_SETTINGS.map((s) => [s.key, s]));

/**
 * Normalize a raw API value to the correct JS type based on schema definition.
 * Handles all the string/boolean/number coercion issues from mixed storage formats.
 */
function normalizeValue(raw: unknown, def: StaticSettingDef): unknown {
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
function normalizeConfig(
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

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\/.+/;

function validateSetting(def: ConfigSettingDef, value: unknown, t: (key: string, options?: Record<string, unknown>) => string): string | null {
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

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

interface SystemConfigProps {
  /** Setting keys to hide from the editor (used to suppress duplicates with the parent's own form). */
  excludeKeys?: string[];
  /**
   * Called after a successful save or reset. The parent should refetch its own
   * data — Reset in particular clears keys that may be owned by the parent.
   */
  onAfterChange?: () => void;
}

/**
 * Embedded-only editor for platform configuration. Rendered inside the Admin
 * Settings page; never routed standalone (the legacy /admin/enterprise/config
 * route was retired and its sidebar entries removed).
 */
export function SystemConfig({ excludeKeys, onAfterChange }: SystemConfigProps = {}) {
  const { t } = useTranslation(['admin_enterprise', 'admin_system']);
  const { tenantPath } = useTenant();
  const toast = useToast();
  const { user } = useAuth();
  const canChangePlatformKeys = isPlatformSuperAdminUser(user);
  const isTierLocked = (key: string) =>
    PLATFORM_SUPER_ADMIN_CONFIG_KEYS.has(key) && !canChangePlatformKeys;

  const excludeSet = useMemo(() => new Set(excludeKeys ?? []), [excludeKeys]);

  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [edited, setEdited] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);

  // Track whether there are unsaved changes
  const hasChanges = JSON.stringify(config) !== JSON.stringify(edited);

  // Translated locale options — built inside the component so t() is available
  const localeOptions = SUPPORTED_LOCALE_CODES.map((code) => ({
    label: t(`system.lang_${code}`),
    value: code,
  }));

  const configSchema = buildConfigSchema(t)
    .map((g) => ({ ...g, settings: g.settings.filter((s) => !excludeSet.has(s.key)) }))
    .filter((g) => g.settings.length > 0);

  // ── Data loading ──────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminEnterprise.getConfig();
      if (!res.success || !res.data) {
        toast.error(t('enterprise.failed_to_load_settings'));
        setLoadError(true);
        return;
      }
      const raw = res.data as unknown as Record<string, unknown>;
      const localizedDefaults = new Map(
        buildConfigSchema(t)
          .flatMap((group) => group.settings)
          .map((setting) => [setting.key, setting.default] as const),
      );
      const data = normalizeConfig(raw, localizedDefaults);
      setConfig(data);
      setEdited({ ...data });
      setErrors({});
    } catch {
      toast.error(t('enterprise.failed_to_load_settings'));
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [toast, t]);


  useEffect(() => {
    loadData();
  }, [loadData]);

  // ── Setting value helpers ─────────────────────────────────────────────

  function getSettingValue(key: string, defaultVal?: unknown): unknown {
    return edited[key] ?? defaultVal ?? '';
  }


  // ── Change handler ────────────────────────────────────────────────────

  function handleChange(key: string, value: unknown, def?: ConfigSettingDef) {
    setEdited((prev) => ({ ...prev, [key]: value }));

    if (def) {
      const error = validateSetting(def, value, t);
      setErrors((prev) => {
        const next = { ...prev };
        if (error) {
          next[key] = error;
        } else {
          delete next[key];
        }
        return next;
      });
    }
  }

  // ── Save handler ──────────────────────────────────────────────────────

  async function handleSave() {
    if (loadError) {
      toast.error(t('enterprise.settings_not_loaded'));
      return;
    }
    // Validate all schema fields
    const newErrors: Record<string, string> = {};
    for (const group of configSchema) {
      for (const def of group.settings) {
        const error = validateSetting(def, getSettingValue(def.key, def.default), t);
        if (error) newErrors[def.key] = error;
      }
    }
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) {
      toast.error(t('enterprise.fix_errors_before_saving'));
      return;
    }

    setSaving(true);
    try {
      // Only send fields the user actually changed — prevents clobbering values
      // set on other pages or in previous sessions. maintenance_mode is always
      // excluded because it requires the .maintenance file layer (CLI only);
      // platform-super-admin-only keys are left out for everyone else (F-054).
      const payload: Record<string, unknown> = {};
      for (const key of SCHEMA_KEYS) {
        if (key === 'maintenance_mode') continue;
        if (isTierLocked(key)) continue;
        if (key in edited && JSON.stringify(edited[key]) !== JSON.stringify(config[key])) {
          payload[key] = edited[key];
        }
      }
      if (Object.keys(payload).length === 0) {
        toast.error(t('enterprise.no_changes_to_save'));
        setSaving(false);
        return;
      }
      const res = await adminEnterprise.updateConfig(payload);
      if (res.success) {
        toast.success(t('enterprise.settings_saved'));
        await loadData();
        onAfterChange?.();
      } else {
        toast.error(t('enterprise.failed_to_save_settings'));
      }
    } catch {
      toast.error(t('enterprise.failed_to_save_settings'));
    } finally {
      setSaving(false);
    }
  }

  // ── Reset handler ─────────────────────────────────────────────────────

  async function handleReset() {
    setResetting(true);
    try {
      const res = await adminEnterprise.resetConfig();
      if (res.success) {
        toast.success(t('enterprise.configuration_reset_to_defaults'));
        setShowResetModal(false);
        await loadData();
        onAfterChange?.();
      } else {
        toast.error(t('enterprise.failed_to_reset_configuration'));
      }
    } catch {
      toast.error(t('enterprise.failed_to_reset_configuration'));
    } finally {
      setResetting(false);
    }
  }

  // ── Render individual setting ─────────────────────────────────────────

  function renderSetting(def: ConfigSettingDef) {
    const value = getSettingValue(def.key, def.default);
    const error = errors[def.key];

    switch (def.type) {
      case 'boolean': {
        // Some settings are managed by dedicated pages and must not be toggled here
        const READ_ONLY_KEYS = new Set(['maintenance_mode']);
        const tierLocked = isTierLocked(def.key);
        const isReadOnly = READ_ONLY_KEYS.has(def.key) || tierLocked;
        return (
          <div key={def.key} className="flex items-center justify-between gap-4 py-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className={`text-sm font-medium ${isReadOnly ? 'text-muted' : 'text-foreground'}`}>{def.label}</span>
                <Tooltip content={def.description} delay={300}>
                  <Info size={14} className="text-muted shrink-0 cursor-help" />
                </Tooltip>
              </div>
              <p className="text-xs text-muted mt-0.5">{def.description}</p>
              {tierLocked && (
                <p className="text-xs text-warning mt-0.5">{t('admin_system:system.super_admin_only_tooltip')}</p>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {def.manage && (
                <Button
                  as={Link}
                  to={tenantPath(def.manage.href)}
                  size="sm"
                  variant="secondary"
                  endContent={<ArrowRight size={14} />}
                >
                  {def.manage.label}
                </Button>
              )}
              <Switch
                isSelected={value === true}
                onValueChange={isReadOnly ? undefined : (v) => handleChange(def.key, v, def)}
                isDisabled={isReadOnly}
                aria-label={def.label}
                size="sm"
              />
            </div>
          </div>
        );
      }

      case 'select':
        return (
          <div key={def.key} className="py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm font-medium text-foreground">{def.label}</span>
              <Tooltip content={def.description} delay={300}>
                <Info size={14} className="text-muted shrink-0 cursor-help" />
              </Tooltip>
            </div>
            <Select
              selectedKeys={value ? [String(value)] : []}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                if (selected !== undefined) handleChange(def.key, String(selected), def);
              }}
              aria-label={def.label}
              variant="secondary"
              size="sm"
              className="max-w-xs"
              isInvalid={!!error}
              errorMessage={error}
            >
              {(def.key === 'locale' ? localeOptions : (def.options ?? [])).map((opt) => (
                <SelectItem key={opt.value} id={opt.value}>{opt.label}</SelectItem>
              ))}
            </Select>
            <p className="text-xs text-muted mt-1">{def.description}</p>
          </div>
        );

      case 'textarea':
        return (
          <div key={def.key} className="py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm font-medium text-foreground">{def.label}</span>
              <Tooltip content={def.description} delay={300}>
                <Info size={14} className="text-muted shrink-0 cursor-help" />
              </Tooltip>
            </div>
            <Textarea
              value={String(value)}
              onValueChange={(v) => handleChange(def.key, v, def)}
              aria-label={def.label}
              variant="secondary"
              size="sm"
              minRows={2}
              maxRows={5}
              isInvalid={!!error}
              errorMessage={error}
            />
            <p className="text-xs text-muted mt-1">{def.description}</p>
          </div>
        );

      case 'number':
        return (
          <div key={def.key} className="py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm font-medium text-foreground">{def.label}</span>
              <Tooltip content={def.description} delay={300}>
                <Info size={14} className="text-muted shrink-0 cursor-help" />
              </Tooltip>
            </div>
            <Input
              type="number"
              value={String(value ?? '')}
              onValueChange={(v) => handleChange(def.key, v === '' ? (def.default ?? 0) : Number(v), def)}
              aria-label={def.label}
              variant="secondary"
              size="sm"
              className="max-w-xs"
              isInvalid={!!error}
              errorMessage={error}
              min={def.validation?.min}
              max={def.validation?.max}
            />
            <p className="text-xs text-muted mt-1">{def.description}</p>
          </div>
        );

      default: {
        // text, email, url
        return (
          <div key={def.key} className="py-2">
            <div className="flex items-center gap-1.5 mb-1">
              <span className="text-sm font-medium text-foreground">{def.label}</span>
              <Tooltip content={def.description} delay={300}>
                <Info size={14} className="text-muted shrink-0 cursor-help" />
              </Tooltip>
            </div>
            <Input
              type={def.type === 'email' ? 'email' : def.type === 'url' ? 'url' : 'text'}
              value={String(value)}
              onValueChange={(v) => handleChange(def.key, v, def)}
              aria-label={def.label}
              variant="secondary"
              size="sm"
              className="max-w-md"
              isInvalid={!!error}
              errorMessage={error}
            />
            <p className="text-xs text-muted mt-1">{def.description}</p>
          </div>
        );
      }
    }
  }

  // ── Loading state ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return (
      <Card className="border border-danger/30 bg-danger/10">
        <CardBody className="text-center py-12">
          <p className="text-danger font-medium mb-3">{t('enterprise.failed_to_load_settings')}</p>
          <p className="text-sm text-muted mb-4">{t('enterprise.failed_to_load_settings_desc')}</p>
          <Button variant="secondary" onPress={loadData} startContent={<RefreshCw size={16} />}>
            {t('common.retry')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div>
      <div className="flex justify-end mb-3">
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="secondary"
            startContent={<RefreshCw size={16} />}
            onPress={loadData}
            size="sm"
          >
            {t('enterprise.reload')}
          </Button>
          <Button
            variant="danger"
            startContent={<RotateCcw size={16} />}
            onPress={() => setShowResetModal(true)}
            size="sm"
          >
            {t('enterprise.reset_to_defaults')}
          </Button>
          <Button
            startContent={<Save size={16} />}
            onPress={handleSave}
            isLoading={saving}
            isDisabled={!hasChanges || Object.keys(errors).length > 0}
            size="sm"
          >
            {t('enterprise.save_changes')}
          </Button>
        </div>
      </div>

      <div className="space-y-6">
        {configSchema.map((group) => (
          <Card key={group.key}>
            <CardHeader className="flex items-center gap-3 pb-1">
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 text-accent">
                {group.icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-foreground">{group.label}</h3>
                <p className="text-xs text-muted">{group.description}</p>
              </div>
            </CardHeader>
            <CardBody className="px-5 pb-4 pt-2">
              <div className="divide-y divide-border">
                {group.settings.map((def) => renderSetting(def))}
              </div>
            </CardBody>
          </Card>
        ))}

        {/* Related admin pages — peer configuration surfaces that don't fit
            the schema above. Always visible since these admin pages always
            exist on the platform. */}
        <Card>
          <CardHeader className="flex items-center gap-3 pb-1">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-accent/10 text-accent">
              <Settings2 size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-foreground">{t('enterprise.related_admin_pages')}</h3>
              <p className="text-xs text-muted">
                {t('enterprise.related_admin_pages_desc')}
              </p>
            </div>
          </CardHeader>
          <CardBody className="px-5 pb-4 pt-2">
            <div className="divide-y divide-border">
              {RELATED_ADMIN_PAGES.map((entry) => (
                <div key={entry.href} className="flex items-center justify-between gap-4 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{t(entry.labelKey)}</p>
                    <p className="text-xs text-muted mt-0.5">{t(entry.descriptionKey)}</p>
                  </div>
                  <Button
                    as={Link}
                    to={tenantPath(entry.href)}
                    size="sm"
                    variant="secondary"
                    endContent={<ArrowRight size={14} />}
                  >
                    {t('enterprise.open_related_page', { name: t(entry.destLabelKey) })}
                  </Button>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Reset confirmation modal */}
      <Modal isOpen={showResetModal} onOpenChange={setShowResetModal} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                {t('enterprise.reset_configuration_to_defaults')}
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-foreground">
                  {t('enterprise.reset_configuration_intro')}
                </p>
                <p className="text-sm text-muted">
                  {t('enterprise.reset_configuration_cleared')}
                </p>
                <p className="text-sm text-muted">
                  {t('enterprise.reset_configuration_preserved')}
                </p>
                <p className="text-sm font-medium text-danger">
                  {t('enterprise.action_cannot_be_undone')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} size="sm">
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  onPress={handleReset}
                  isLoading={resetting}
                  size="sm"
                >
                  {t('enterprise.reset_all')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default SystemConfig;
