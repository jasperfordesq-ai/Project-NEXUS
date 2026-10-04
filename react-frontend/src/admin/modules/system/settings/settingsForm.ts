// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shape, defaults, option lists and payload rules for the main admin Settings
 * form. Field names match the backend's TENANT_DIRECT_COLUMNS and
 * GENERAL_SETTING_KEYS in AdminConfigController exactly (the controller that
 * serves /v2/admin/settings; AdminSettingsController is unrouted).
 */

import type { AdminSettingsResponse } from '../../../api/types';

export type RegistrationMode = 'open' | 'invite_only' | 'closed';

export interface SettingsForm {
  name: string;               // tenants.name
  description: string;        // tenants.description
  contact_email: string;      // tenants.contact_email
  contact_phone: string;      // tenants.contact_phone
  registration_mode: RegistrationMode; // general.registration_mode
  email_verification: boolean; // general.email_verification (platform super-admin only)
  admin_approval: boolean;    // general.admin_approval (platform super-admin only)
  maintenance_mode: boolean;  // general.maintenance_mode (read-only here; CLI)
  footer_text: string;        // general.footer_text (charity number, legal name, etc.)
  partner_logo_url: string;      // general.partner_logo_url (footer left slot)
  partner_logo_label: string;    // general.partner_logo_label
  partner_logo_link_url: string; // general.partner_logo_link_url
  powered_by_label: string;      // general.powered_by_label (platform god only — footer right slot)
  powered_by_image_light: string; // general.powered_by_image_light
  powered_by_image_dark: string;  // general.powered_by_image_dark
  powered_by_url: string;         // general.powered_by_url
  default_currency: string;       // general.default_currency (ISO 4217 lowercase)
  region: string;                 // general.region (ISO 3166-1 alpha-2, drives date/number formatting)
  inactivity_timeout_minutes: string; // general.inactivity_timeout_minutes ('0' = disabled, 5–480)
  header_bg_color: string;        // tenants.configuration.header_bg_color ('' = default black)
  header_accent_color: string;    // tenants.configuration.header_accent_color ('' = match background)
}

export type SettingsFormKey = keyof SettingsForm;

/**
 * Regions offered for date and number formatting. The value is ISO 3166-1
 * alpha-2 and selects a whole set of conventions (field order, month names,
 * 24-hour clock, number grouping) in whichever language the reader has chosen —
 * it does not change the language itself. Ordered with the platform's own
 * communities first.
 */
export const REGION_OPTIONS: Array<{ code: string; labelKey: string }> = [
  { code: 'IE', labelKey: 'system.region_ie' },
  { code: 'GB', labelKey: 'system.region_gb' },
  { code: 'CH', labelKey: 'system.region_ch' },
  { code: 'DE', labelKey: 'system.region_de' },
  { code: 'FR', labelKey: 'system.region_fr' },
  { code: 'ES', labelKey: 'system.region_es' },
  { code: 'IT', labelKey: 'system.region_it' },
  { code: 'PT', labelKey: 'system.region_pt' },
  { code: 'NL', labelKey: 'system.region_nl' },
  { code: 'PL', labelKey: 'system.region_pl' },
  { code: 'US', labelKey: 'system.region_us' },
];

export const CURRENCY_OPTIONS: Array<{ code: string; labelKey: string }> = [
  { code: 'eur', labelKey: 'system.currency_eur' },
  { code: 'usd', labelKey: 'system.currency_usd' },
  { code: 'gbp', labelKey: 'system.currency_gbp' },
  { code: 'cad', labelKey: 'system.currency_cad' },
  { code: 'aud', labelKey: 'system.currency_aud' },
  { code: 'jpy', labelKey: 'system.currency_jpy' },
];

export const DEFAULT_SETTINGS: SettingsForm = {
  name: '',
  description: '',
  contact_email: '',
  contact_phone: '',
  registration_mode: 'open',
  email_verification: true,
  admin_approval: false,
  maintenance_mode: false,
  footer_text: '',
  partner_logo_url: '',
  partner_logo_label: '',
  partner_logo_link_url: '',
  powered_by_label: '',
  powered_by_image_light: '',
  powered_by_image_dark: '',
  powered_by_url: '',
  default_currency: 'eur',
  region: 'IE',
  inactivity_timeout_minutes: '0',
  header_bg_color: '',
  header_accent_color: '',
};

/**
 * Keys handled by the main form, hidden from the embedded additional
 * configuration so no setting has two controls on the page.
 */
export const DUPLICATE_KEYS = [
  'site_name',
  'site_description',
  'contact_email',
  'contact_phone',
  'footer_text',
  'registration_enabled',
  'require_approval',
  'require_email_verification',
  'maintenance_mode',
];

const truthy = (v: unknown) => v === true || v === 'true' || v === '1' || v === 1;

/**
 * The backend accepts open | invite_only | closed and the registration policy
 * service treats anything else as "defer to the policy table" (i.e. open).
 * Older rows may hold the legacy alias 'invite'.
 */
export function normaliseRegistrationMode(raw: unknown): RegistrationMode {
  if (raw === 'closed') return 'closed';
  if (raw === 'invite_only' || raw === 'invite') return 'invite_only';
  return 'open';
}

/** Map the GET /v2/admin/settings response onto the form. */
export function settingsFromResponse(data: AdminSettingsResponse): SettingsForm {
  const tenant = (data.tenant ?? {}) as Record<string, unknown>;
  const settings = (data.settings ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
  return {
    name: str(tenant.name),
    description: str(tenant.description),
    contact_email: str(tenant.contact_email),
    contact_phone: str(tenant.contact_phone),
    registration_mode: normaliseRegistrationMode(settings.registration_mode),
    email_verification: truthy(settings.email_verification),
    admin_approval: truthy(settings.admin_approval),
    maintenance_mode: truthy(settings.maintenance_mode),
    footer_text: str(settings.footer_text),
    partner_logo_url: str(settings.partner_logo_url),
    partner_logo_label: str(settings.partner_logo_label),
    partner_logo_link_url: str(settings.partner_logo_link_url),
    powered_by_label: str(settings.powered_by_label),
    powered_by_image_light: str(settings.powered_by_image_light),
    powered_by_image_dark: str(settings.powered_by_image_dark),
    powered_by_url: str(settings.powered_by_url),
    default_currency: str(settings.default_currency).toLowerCase() || 'eur',
    region: str(settings.region).toUpperCase() || 'IE',
    inactivity_timeout_minutes: String(settings.inactivity_timeout_minutes ?? '0'),
    header_bg_color: str(settings.header_bg_color),
    header_accent_color: str(settings.header_accent_color),
  };
}

export interface PayloadContext {
  /** Platform super-admin (F-054): may change email verification and approval. */
  isGod: boolean;
  /** `is_god` flag: may change the footer "powered by" slot. */
  isPlatformGod: boolean;
}

type Gate = 'god' | 'platformGod' | 'never';

interface PayloadRule {
  gate?: Gate;
  /** Convert the form value to what the API expects. */
  serialise?: (value: string | boolean) => unknown;
  /** Persists through the header-colours endpoint, not the settings PUT. */
  endpoint?: 'colors';
}

/**
 * One table instead of twenty hand-written comparisons. Anything not listed
 * is sent as-is when it changed. Gated keys are never sent by someone who
 * cannot change them — the server answers 403 for the WHOLE save otherwise.
 */
export const PAYLOAD_RULES: Partial<Record<SettingsFormKey, PayloadRule>> = {
  email_verification: { gate: 'god', serialise: String },
  admin_approval: { gate: 'god', serialise: String },
  maintenance_mode: { gate: 'never' },
  powered_by_label: { gate: 'platformGod' },
  powered_by_url: { gate: 'platformGod' },
  // Powered-by images are uploaded via dedicated endpoints (which persist
  // immediately), but REMOVAL has no delete endpoint — clearing the field is
  // persisted here as an empty value.
  powered_by_image_light: { gate: 'platformGod' },
  powered_by_image_dark: { gate: 'platformGod' },
  inactivity_timeout_minutes: { serialise: (v) => String(parseInt(String(v), 10) || 0) },
  header_bg_color: { endpoint: 'colors' },
  header_accent_color: { endpoint: 'colors' },
};

export const COLOR_KEYS: SettingsFormKey[] = ['header_bg_color', 'header_accent_color'];

export function changedKeys(form: SettingsForm, original: SettingsForm): SettingsFormKey[] {
  return (Object.keys(form) as SettingsFormKey[]).filter((k) => form[k] !== original[k]);
}

function gateAllows(gate: Gate | undefined, ctx: PayloadContext): boolean {
  if (gate === 'never') return false;
  if (gate === 'god') return ctx.isGod;
  if (gate === 'platformGod') return ctx.isPlatformGod;
  return true;
}

/** The settings PUT body: changed keys the caller may change, serialised. */
export function buildSettingsPayload(
  form: SettingsForm,
  original: SettingsForm,
  ctx: PayloadContext,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of changedKeys(form, original)) {
    const rule = PAYLOAD_RULES[key];
    if (rule?.endpoint === 'colors') continue;
    if (!gateAllows(rule?.gate, ctx)) continue;
    payload[key] = rule?.serialise ? rule.serialise(form[key]) : form[key];
  }
  return payload;
}

export function headerColorsChanged(form: SettingsForm, original: SettingsForm): boolean {
  return COLOR_KEYS.some((k) => form[k] !== original[k]);
}
