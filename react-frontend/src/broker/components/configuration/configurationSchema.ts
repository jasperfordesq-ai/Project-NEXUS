// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The broker configuration page as data. Each section lists its settings:
 * key, control type, unit, who may change it, and its bounds. The page
 * renders rows from this, so adding a setting is one entry here plus its
 * three translation keys (`field_<key>_label`, `_help`, `_aria`).
 *
 * `adminOnly` is a UI hint that mirrors the server's policy (F-547/F-548):
 * the server refuses a non-admin save that carries any of these keys.
 */

import type { LucideIcon } from 'lucide-react';
import MessageSquare from 'lucide-react/icons/message-square';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Eye from 'lucide-react/icons/eye';
import Copy from 'lucide-react/icons/copy';
import ShieldCheck from 'lucide-react/icons/shield-check';
import type { BrokerConfig } from '@/admin/api/types';
import type { TenantFeatures } from '@/types/api';
import type { BrokerStatColor } from '../BrokerStatCard';

export type ConfigUnit = 'hours' | 'days' | 'percent';

export interface ConfigSettingDef {
  key: keyof BrokerConfig;
  type: 'boolean' | 'number' | 'email';
  /** Shown as a suffix on number fields. */
  unit?: ConfigUnit;
  adminOnly: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** The control is disabled unless this boolean setting is on. */
  enabledWhen?: keyof BrokerConfig;
  /** The row is shown only while this boolean setting is on. */
  visibleWhen?: keyof BrokerConfig;
}

export interface ConfigSectionDef {
  /** Translation suffix (`section_<id>`, `section_<id>_desc`) and anchor id. */
  id: string;
  icon: LucideIcon;
  color: BrokerStatColor;
  /** Tenant feature the whole section needs. */
  feature?: keyof TenantFeatures;
  settings: ConfigSettingDef[];
}

const bool = (key: keyof BrokerConfig, adminOnly = false, extra: Partial<ConfigSettingDef> = {}): ConfigSettingDef =>
  ({ key, type: 'boolean', adminOnly, ...extra });

const num = (
  key: keyof BrokerConfig,
  unit: ConfigUnit,
  min: number,
  max: number,
  extra: Partial<ConfigSettingDef> = {},
): ConfigSettingDef => ({ key, type: 'number', unit, min, max, adminOnly: false, ...extra });

export const CONFIGURATION_SCHEMA: ConfigSectionDef[] = [
  {
    id: 'messaging',
    icon: MessageSquare,
    color: 'warning',
    settings: [
      bool('broker_messaging_enabled', true),
      bool('broker_copy_all_messages', true),
      num('broker_copy_threshold_hours', 'hours', 0, 100),
      num('new_member_monitoring_days', 'days', 0, 365),
      bool('require_exchange_for_listings', true),
    ],
  },
  {
    id: 'risk_tagging',
    icon: ShieldAlert,
    color: 'danger',
    settings: [
      bool('risk_tagging_enabled', true),
      bool('auto_flag_high_risk', true),
      bool('require_approval_high_risk', true),
      bool('notify_on_high_risk_match', true),
    ],
  },
  {
    id: 'exchange_workflow',
    icon: ArrowLeftRight,
    color: 'accent',
    feature: 'exchange_workflow',
    settings: [
      bool('broker_approval_required', true),
      bool('auto_approve_low_risk', true),
      num('exchange_timeout_days', 'days', 1, 90),
      num('max_hours_without_approval', 'hours', 0, 24, { step: 0.5, adminOnly: true }),
      num('confirmation_deadline_hours', 'hours', 1, 720),
      num('expiry_hours', 'hours', 1, 720),
      bool('allow_hour_adjustment'),
      num('max_hour_variance_percent', 'percent', 0, 100, { visibleWhen: 'allow_hour_adjustment' }),
    ],
  },
  {
    id: 'broker_visibility',
    icon: Eye,
    color: 'neutral',
    settings: [
      bool('broker_visible_to_members'),
      bool('show_broker_name'),
      { key: 'broker_contact_email', type: 'email', adminOnly: false },
    ],
  },
  {
    id: 'message_copy_rules',
    icon: Copy,
    color: 'warning',
    settings: [
      bool('copy_first_contact'),
      bool('copy_new_member_messages'),
      bool('copy_high_risk_listing_messages'),
      num('random_sample_percentage', 'percent', 0, 100),
      num('retention_days', 'days', 1, 3650),
    ],
  },
  {
    id: 'compliance_safeguarding',
    icon: ShieldCheck,
    color: 'success',
    settings: [
      bool('insurance_enabled', true),
      bool('enforce_insurance_on_exchanges', true, { enabledWhen: 'insurance_enabled' }),
      num('insurance_expiry_warning_days', 'days', 1, 365, { enabledWhen: 'insurance_enabled' }),
    ],
  },
];

/** Every setting the page shows, in display order. */
export const CONFIGURATION_SETTINGS: ConfigSettingDef[] = CONFIGURATION_SCHEMA.flatMap((s) => s.settings);

/** The keys only an admin may change — derived from the schema so the two never drift. */
export const ADMIN_ONLY_CONFIG_KEYS: ReadonlySet<keyof BrokerConfig> = new Set(
  CONFIGURATION_SETTINGS.filter((s) => s.adminOnly).map((s) => s.key),
);

/** Defaults shown before the server answers; every key the page knows. */
export const DEFAULT_BROKER_CONFIG: BrokerConfig = {
  broker_messaging_enabled: true,
  broker_copy_all_messages: false,
  broker_copy_threshold_hours: 5,
  new_member_monitoring_days: 30,
  require_exchange_for_listings: false,
  risk_tagging_enabled: true,
  auto_flag_high_risk: true,
  require_approval_high_risk: false,
  notify_on_high_risk_match: true,
  broker_approval_required: true,
  auto_approve_low_risk: false,
  exchange_timeout_days: 7,
  max_hours_without_approval: 5,
  confirmation_deadline_hours: 48,
  allow_hour_adjustment: false,
  max_hour_variance_percent: 20,
  expiry_hours: 168,
  broker_visible_to_members: false,
  show_broker_name: false,
  broker_contact_email: '',
  copy_first_contact: true,
  copy_new_member_messages: true,
  copy_high_risk_listing_messages: true,
  random_sample_percentage: 0,
  retention_days: 90,
  insurance_enabled: false,
  enforce_insurance_on_exchanges: false,
  insurance_expiry_warning_days: 30,
};

export const CONFIG_KEYS = Object.keys(DEFAULT_BROKER_CONFIG) as (keyof BrokerConfig)[];

/** Intl options that render the unit after the number ("30 days", "5 hours", "20%"). */
export function unitFormatOptions(unit: ConfigUnit | undefined, step?: number): Intl.NumberFormatOptions | undefined {
  const fraction = step !== undefined && !Number.isInteger(step) ? { maximumFractionDigits: 1 } : {};
  switch (unit) {
    case 'hours':
      return { style: 'unit', unit: 'hour', unitDisplay: 'long', ...fraction };
    case 'days':
      return { style: 'unit', unit: 'day', unitDisplay: 'long', ...fraction };
    case 'percent':
      return { style: 'unit', unit: 'percent', ...fraction };
    default:
      return fraction.maximumFractionDigits ? fraction : undefined;
  }
}
