import { Card, CardBody, CardHeader, Input, Button, Textarea, Spinner, Chip, Select, SelectItem, Switch, Tooltip } from '@/components/ui';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import Settings from 'lucide-react/icons/settings';
import Save from 'lucide-react/icons/save';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Scale from 'lucide-react/icons/scale';
import Lock from 'lucide-react/icons/lock';
import Upload from 'lucide-react/icons/upload';
import X from 'lucide-react/icons/x';
import Palette from 'lucide-react/icons/palette';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useToast, useTenant, useAuth } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { adminSettings } from '../../api/adminApi';
import { resolveAssetUrl } from '@/lib/helpers';
import type { AdminSettingsResponse } from '../../api/types';
import SystemConfig from '../enterprise/SystemConfig';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Settings
 * Global platform configuration and settings management.
 */


// Keys handled directly by the cards above — excluded from the embedded
// SystemConfig editor below to avoid duplicate controls.
const DUPLICATE_KEYS = [
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

// Field names match the backend's TENANT_DIRECT_COLUMNS and GENERAL_SETTING_KEYS exactly
interface SettingsForm {
  name: string;               // tenants.name
  description: string;        // tenants.description
  contact_email: string;      // tenants.contact_email
  contact_phone: string;      // tenants.contact_phone
  registration_mode: string;  // general.registration_mode ('open' | 'closed' | 'invite')
  email_verification: boolean; // general.email_verification
  admin_approval: boolean;    // general.admin_approval
  maintenance_mode: boolean;  // general.maintenance_mode
  footer_text: string;        // general.footer_text (charity number, legal name, etc.)
  partner_logo_url: string;      // general.partner_logo_url (shown in footer left slot)
  partner_logo_label: string;    // general.partner_logo_label (label shown above partner logo)
  partner_logo_link_url: string; // general.partner_logo_link_url (hyperlink for partner logo)
  powered_by_label: string;      // general.powered_by_label (God-only — footer right slot)
  powered_by_image_light: string; // general.powered_by_image_light
  powered_by_image_dark: string;  // general.powered_by_image_dark
  powered_by_url: string;         // general.powered_by_url
  default_currency: string;       // general.default_currency (ISO 4217 lowercase, e.g. 'eur', 'usd')
  region: string;                 // general.region (ISO 3166-1 alpha-2, drives date/number formatting)
  inactivity_timeout_minutes: string; // general.inactivity_timeout_minutes ('0' = disabled, 5–480)
  header_bg_color: string;        // tenants.configuration.header_bg_color (accessible header background; '' = default black)
  header_accent_color: string;    // tenants.configuration.header_accent_color (accessible header accent line; '' = match background / GOV.UK blue)
}

/**
 * Regions offered for date and number formatting. The value is ISO 3166-1
 * alpha-2 and selects a whole set of conventions (field order, month names,
 * 24-hour clock, number grouping) in whichever language the reader has chosen —
 * it does not change the language itself.
 *
 * Ordered with the platform's own communities first. The label is the country's
 * English name, which is translated; the sample date beside the control is what
 * an admin should actually judge the choice by.
 */
const REGION_OPTIONS: Array<{ code: string; labelKey: string }> = [
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

const CURRENCY_OPTIONS: Array<{ code: string; labelKey: string }> = [
  { code: 'eur', labelKey: 'system.currency_eur' },
  { code: 'usd', labelKey: 'system.currency_usd' },
  { code: 'gbp', labelKey: 'system.currency_gbp' },
  { code: 'cad', labelKey: 'system.currency_cad' },
  { code: 'aud', labelKey: 'system.currency_aud' },
  { code: 'jpy', labelKey: 'system.currency_jpy' },
];

const DEFAULT_SETTINGS: SettingsForm = {
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

// Mirror of AlphaController::readableForeground — pick white or near-black text
// for the live preview so it matches what the accessible header actually renders
// (WCAG relative-luminance contrast, whichever foreground wins).
function readableHeaderText(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  const v = m?.[1];
  if (!v) return '#ffffff';
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L =
    0.2126 * lin(parseInt(v.slice(0, 2), 16)) +
    0.7152 * lin(parseInt(v.slice(2, 4), 16)) +
    0.0722 * lin(parseInt(v.slice(4, 6), 16));
  return 1.05 / (L + 0.05) >= (L + 0.05) / 0.05 ? '#ffffff' : '#0b0c0c';
}

export function AdminSettings() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t, i18n } = useTranslation('admin_system');
  useAdminPageMeta({ title: tNav('system') });
  const toast = useToast();
  const { tenant, tenantPath, refreshTenant, branding } = useTenant();
  const { user } = useAuth();
  const userRecord = user as Record<string, unknown> | null;
  const isGod =
    (user?.role as string) === 'god' ||
    (user?.role as string) === 'super_admin' ||
    userRecord?.is_super_admin === true;
  const isPlatformGod = userRecord?.is_god === true;

  const [form, setForm] = useState<SettingsForm>(DEFAULT_SETTINGS);
  // Shows the selected region's conventions in the admin's own language,
  // before saving. A country name alone does not tell an admin whether they are
  // about to get 17/08/2026 or 8/17/2026, which is the whole point of the
  // control. Formats the picked region directly rather than through
  // getFormattingLocale(), which still holds the SAVED region.
  const regionSample = useMemo(() => {
    const sampleDate = new Date(Date.UTC(2026, 7, 17, 15, 4));
    // locale-exempt: previews the region currently SELECTED in the form, which
    // is not yet saved. getFormattingLocale() deliberately reports the region
    // already in force, so using it here would show the old setting and make
    // the control appear broken. Language still comes from the app — read
    // directly off i18n so the dependency below is real and the preview
    // recomputes when the member switches language.
    const previewLocale = `${(i18n.language || 'en').split('-')[0]}-${form.region || 'IE'}`;
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
    try {
      // locale-exempt: previewing the unsaved region, as explained above.
      return {
        longDate: sampleDate.toLocaleDateString(previewLocale, {
          ...options,
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        }),
        shortDate: sampleDate.toLocaleDateString(previewLocale, options),
        time: sampleDate.toLocaleTimeString(previewLocale, {
          ...options,
          hour: '2-digit',
          minute: '2-digit',
        }),
      };
    } catch {
      return { longDate: '', shortDate: '', time: '' };
    }
  }, [form.region, i18n.language]);
  const [originalForm, setOriginalForm] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingPbLight, setUploadingPbLight] = useState(false);
  const [uploadingPbDark, setUploadingPbDark] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pbLightInputRef = useRef<HTMLInputElement>(null);
  const pbDarkInputRef  = useRef<HTMLInputElement>(null);
  const headerLogoInputRef = useRef<HTMLInputElement>(null);
  const headerLogoDarkInputRef = useRef<HTMLInputElement>(null);
  const [uploadingHeaderLogo, setUploadingHeaderLogo] = useState(false);
  const [uploadingHeaderLogoDark, setUploadingHeaderLogoDark] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminSettings.get();
      const data = res.data as AdminSettingsResponse | undefined;
      if (data) {
        // API returns nested structure: { tenant: {...}, settings: {...} }
        const tenant = data.tenant;
        const settings = data.settings;

        const loaded: SettingsForm = {
          name: (tenant.name as string) ?? '',
          description: (tenant.description as string) ?? '',
          contact_email: (tenant.contact_email as string) ?? '',
          contact_phone: (tenant.contact_phone as string) ?? '',
          registration_mode: (settings.registration_mode as string) ?? 'open',
          email_verification: settings.email_verification === 'true' || settings.email_verification === '1',
          admin_approval: settings.admin_approval === 'true' || settings.admin_approval === '1',
          maintenance_mode: settings.maintenance_mode === 'true' || settings.maintenance_mode === '1',
          footer_text: (settings.footer_text as string) ?? '',
          partner_logo_url: (settings.partner_logo_url as string) ?? '',
          partner_logo_label: (settings.partner_logo_label as string) ?? '',
          partner_logo_link_url: (settings.partner_logo_link_url as string) ?? '',
          powered_by_label: (settings.powered_by_label as string) ?? '',
          powered_by_image_light: (settings.powered_by_image_light as string) ?? '',
          powered_by_image_dark: (settings.powered_by_image_dark as string) ?? '',
          powered_by_url: (settings.powered_by_url as string) ?? '',
          default_currency: (settings.default_currency as string)?.toLowerCase() || 'eur',
          region: ((settings.region as string) || '').toUpperCase() || 'IE',
          inactivity_timeout_minutes: String(settings.inactivity_timeout_minutes ?? '0'),
          header_bg_color: (settings.header_bg_color as string) ?? '',
          header_accent_color: (settings.header_accent_color as string) ?? '',
        };
        setForm(loaded);
        setOriginalForm(loaded);
      }
    } catch {
      toast.error(t('system.failed_to_load_settings'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // Only send fields that actually changed — prevents clobbering values
      // set on other admin pages (enterprise config, registration policy, etc.)
      const changes: Record<string, unknown> = {};
      if (form.name !== originalForm.name) changes.name = form.name;
      if (form.description !== originalForm.description) changes.description = form.description;
      if (form.contact_email !== originalForm.contact_email) changes.contact_email = form.contact_email;
      if (form.contact_phone !== originalForm.contact_phone) changes.contact_phone = form.contact_phone;
      if (form.registration_mode !== originalForm.registration_mode) changes.registration_mode = form.registration_mode;
      if (form.email_verification !== originalForm.email_verification) changes.email_verification = String(form.email_verification);
      if (form.admin_approval !== originalForm.admin_approval) changes.admin_approval = String(form.admin_approval);
      if (form.footer_text !== originalForm.footer_text) changes.footer_text = form.footer_text;
      if (form.partner_logo_url !== originalForm.partner_logo_url) changes.partner_logo_url = form.partner_logo_url;
      if (form.partner_logo_label !== originalForm.partner_logo_label) changes.partner_logo_label = form.partner_logo_label;
      if (form.partner_logo_link_url !== originalForm.partner_logo_link_url) changes.partner_logo_link_url = form.partner_logo_link_url;
      if (isPlatformGod && form.powered_by_label !== originalForm.powered_by_label) changes.powered_by_label = form.powered_by_label;
      if (isPlatformGod && form.powered_by_url !== originalForm.powered_by_url) changes.powered_by_url = form.powered_by_url;
      // Powered-by images are uploaded via dedicated endpoints (which persist
      // immediately), but REMOVAL has no delete endpoint — clearing the field
      // is persisted here as an empty value. Track the diff so "remove + save"
      // actually clears it instead of reporting "no changes".
      if (isPlatformGod && form.powered_by_image_light !== originalForm.powered_by_image_light) changes.powered_by_image_light = form.powered_by_image_light;
      if (isPlatformGod && form.powered_by_image_dark !== originalForm.powered_by_image_dark) changes.powered_by_image_dark = form.powered_by_image_dark;
      if (form.default_currency !== originalForm.default_currency) changes.default_currency = form.default_currency;
      if (form.region !== originalForm.region) changes.region = form.region;
      if (form.inactivity_timeout_minutes !== originalForm.inactivity_timeout_minutes) {
        changes.inactivity_timeout_minutes = String(parseInt(form.inactivity_timeout_minutes, 10) || 0);
      }

      // Accessible (GOV.UK alpha) header colours live in tenants.configuration,
      // not the general settings KV table, so they persist via a dedicated
      // endpoint rather than the `changes` diff above.
      const headerColorsChanged =
        form.header_bg_color !== originalForm.header_bg_color ||
        form.header_accent_color !== originalForm.header_accent_color;

      if (Object.keys(changes).length === 0 && !headerColorsChanged) {
        toast.error(t('system.no_changes_to_save'));
        setSaving(false);
        return;
      }

      let ok = true;

      if (Object.keys(changes).length > 0) {
        const res = await adminSettings.update(changes);
        if (!res.success) {
          ok = false;
          // admin-i18n-ignore: localized server message — AdminSettingsController
          // refusals are __() keys.
          toast.error(res.error || t('system.save_failed'));
        }
      }

      if (ok && headerColorsChanged) {
        const res = await adminSettings.saveHeaderColors(
          form.header_bg_color || null,
          form.header_accent_color || null,
        );
        if (res.success === false) {
          ok = false;
          toast.error(t('system.save_failed'));
        }
      }

      if (ok) {
        toast.success(t('system.settings_saved'));
        // Reload settings to confirm persistence
        fetchSettings();
        // Refresh the tenant bootstrap context so live surfaces (footer
        // powered-by label/URL, footer text, partner logo) reflect the new
        // values immediately — mirrors the powered-by image upload handler.
        // Without this, saved text/URL changes only appear after a hard reload.
        refreshTenant();
      }
    } catch (err) {
      toast.error(t('system.failed_to_save_settings'));
      console.error('Settings save error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handlePartnerLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const res = await adminSettings.uploadPartnerLogo(file);
      if (res.data?.url) {
        setForm(prev => ({ ...prev, partner_logo_url: res.data!.url }));
        setOriginalForm(prev => ({ ...prev, partner_logo_url: res.data!.url }));
        toast.success(t('admin_settings.logo_uploaded'));
        refreshTenant();
      } else {
        toast.error(t('admin_settings.upload_failed'));
      }
    } catch {
      toast.error(t('admin_settings.upload_failed'));
    } finally {
      setUploadingLogo(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePoweredByUpload = async (
    variant: 'light' | 'dark',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const setUploading = variant === 'light' ? setUploadingPbLight : setUploadingPbDark;
    const inputRef     = variant === 'light' ? pbLightInputRef     : pbDarkInputRef;
    const field        = variant === 'light' ? 'powered_by_image_light' : 'powered_by_image_dark';
    const uploadFn     = variant === 'light'
      ? adminSettings.uploadPoweredByImageLight
      : adminSettings.uploadPoweredByImageDark;

    setUploading(true);
    try {
      const res = await uploadFn(file);
      if (res.data?.url) {
        setForm(prev => ({ ...prev, [field]: res.data!.url }));
        setOriginalForm(prev => ({ ...prev, [field]: res.data!.url }));
        toast.success(t('system.powered_by_image_uploaded'));
        refreshTenant();
      } else {
        toast.error(t('system.upload_failed'));
      }
    } catch {
      toast.error(t('system.upload_failed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // Header logo lives in tenants.configuration (not tenant_settings), so it is
  // uploaded immediately and reflected via refreshTenant() rather than the
  // form/save cycle. The bootstrap exposes it as branding.logo / branding.logoDark.
  const handleHeaderLogoUpload = async (
    variant: 'light' | 'dark',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const setUploading = variant === 'light' ? setUploadingHeaderLogo : setUploadingHeaderLogoDark;
    const inputRef     = variant === 'light' ? headerLogoInputRef     : headerLogoDarkInputRef;
    const uploadFn     = variant === 'light'
      ? adminSettings.uploadHeaderLogo
      : adminSettings.uploadHeaderLogoDark;

    setUploading(true);
    try {
      const res = await uploadFn(file);
      if (res.data?.url) {
        toast.success(t('admin_settings.header_logo_uploaded'));
        await refreshTenant();
      } else {
        toast.error(t('admin_settings.upload_failed'));
      }
    } catch {
      toast.error(t('admin_settings.upload_failed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleHeaderLogoRemove = async (variant: 'light' | 'dark') => {
    const removeFn = variant === 'light'
      ? adminSettings.removeHeaderLogo
      : adminSettings.removeHeaderLogoDark;
    try {
      const res = await removeFn();
      if (res.success === false) {
        toast.error(t('admin_settings.upload_failed'));
        return;
      }
      toast.success(t('admin_settings.header_logo_removed'));
      await refreshTenant();
    } catch {
      toast.error(t('admin_settings.upload_failed'));
    }
  };

  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('system.admin_settings_title')}
          description={t('system.admin_settings_desc', { name: tenant?.name || t('system.your_community') })}
        />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('system.admin_settings_title')}
        description={t('system.admin_settings_desc', { name: tenant?.name || t('system.your_community') })}
      />

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Settings size={20} aria-hidden="true" /> {t('system.section_general')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <Input
              label={t('system.label_site_name')}
              placeholder={t('system.placeholder_project_nexus')}
              variant="secondary"
              value={form.name}
              onValueChange={(val) => setForm(prev => ({ ...prev, name: val }))}
            />
            <Textarea
              label={t('system.label_site_description')}
              placeholder={t('system.placeholder_community_timebanking_platform')}
              variant="secondary"
              minRows={2}
              value={form.description}
              onValueChange={(val) => setForm(prev => ({ ...prev, description: val }))}
            />
            <Input
              label={t('system.label_support_email')}
              placeholder="support@project-nexus.ie"
              variant="secondary"
              value={form.contact_email}
              onValueChange={(val) => setForm(prev => ({ ...prev, contact_email: val }))}
            />
            <Input
              label={t('system.label_contact_phone')}
              placeholder="+1 555 123 4567"
              variant="secondary"
              value={form.contact_phone}
              onValueChange={(val) => setForm(prev => ({ ...prev, contact_phone: val }))}
            />
            <Select
              label={t('system.label_default_currency')}
              description={t('system.desc_default_currency')}
              variant="secondary"
              selectedKeys={[form.default_currency]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string | undefined;
                if (val) setForm(prev => ({ ...prev, default_currency: val }));
              }}
            >
              {CURRENCY_OPTIONS.map(opt => (
                <SelectItem key={opt.code} id={opt.code}>{t(opt.labelKey)}</SelectItem>
              ))}
            </Select>
            <Select
              label={t('system.label_region')}
              description={t('system.desc_region')}
              variant="secondary"
              selectedKeys={[form.region]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string | undefined;
                if (val) setForm(prev => ({ ...prev, region: val }));
              }}
            >
              {REGION_OPTIONS.map(opt => (
                <SelectItem key={opt.code} id={opt.code}>{t(opt.labelKey)}</SelectItem>
              ))}
            </Select>
            {/* The label names a country; this shows what members will actually
                read, which is the thing being chosen. */}
            <p className="text-sm text-[var(--color-text-muted)]">
              {t('system.region_sample', {
                shortDate: regionSample.shortDate,
                longDate: regionSample.longDate,
                time: regionSample.time,
              })}
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Scale size={20} aria-hidden="true" /> {t('system.section_branding_legal')}
            </h3>
          </CardHeader>
          <CardBody className="gap-4">
            <Textarea
              label={t('system.label_footer_legal_text')}
              description={t('system.desc_displayed_in_the_site_footer_and_legal_h')}
              placeholder={t('system.placeholder_footer_legal_text')}
              variant="secondary"
              minRows={2}
              value={form.footer_text}
              onValueChange={(val) => setForm(prev => ({ ...prev, footer_text: val }))}
            />
            {/* Partner Logo Upload */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('admin_settings.partner_logo_label')}</p>
              <p className="text-xs text-muted">
                {t('admin_settings.partner_logo_hint')}
              </p>
              {form.partner_logo_url && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary p-3">
                  <img
                    src={form.partner_logo_url}
                    alt={t('admin_settings.partner_logo_label')}
                    className="h-14 w-auto max-w-[180px] object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <Button
                    isIconOnly
                    size="sm"
                    variant="danger"
                    aria-label={t('admin_settings.remove_partner_logo')}
                    onPress={() => {
                      setForm(prev => ({ ...prev, partner_logo_url: '' }));
                    }}
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={handlePartnerLogoUpload}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  isLoading={uploadingLogo}
                  startContent={!uploadingLogo ? <Upload size={14} /> : undefined}
                  onPress={() => fileInputRef.current?.click()}
                >
                  {form.partner_logo_url ? t('admin_settings.replace_image') : t('admin_settings.upload_image')}
                </Button>
              </div>
            </div>
            {/* Partner Logo Label */}
            <Input
              label={t('system.label_partner_logo_label')}
              placeholder={t('system.placeholder_partner_logo_label')}
              description={t('system.desc_partner_logo_label')}
              variant="secondary"
              value={form.partner_logo_label}
              onValueChange={(val) => setForm(prev => ({ ...prev, partner_logo_label: val }))}
            />
            {/* Partner Logo Link URL */}
            <Input
              label={t('system.partner_logo_link_url')}
              placeholder="https://example.com"
              value={form.partner_logo_link_url}
              onValueChange={(val) => setForm(prev => ({ ...prev, partner_logo_link_url: val }))}
              description={t('system.partner_logo_link_url_description')}
              type="url"
            />
          </CardBody>
        </Card>

        {/* Header Logo — overrides the default initials/text branding in the site header */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('admin_settings.header_logo_section')}</h3>
          </CardHeader>
          <CardBody className="gap-5">
            <p className="text-sm text-muted">{t('admin_settings.header_logo_desc')}</p>

            {/* Light / default variant */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('admin_settings.header_logo_light_label')}</p>
              <p className="text-xs text-muted">{t('admin_settings.header_logo_hint')}</p>
              {branding.logo && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary p-3">
                  <img
                    src={resolveAssetUrl(branding.logo)}
                    alt={t('admin_settings.header_logo_light_label')}
                    className="h-14 w-auto max-w-[180px] object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <Button
                    isIconOnly size="sm" variant="danger"
                    aria-label={t('admin_settings.remove_header_logo')}
                    onPress={() => handleHeaderLogoRemove('light')}
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
              <input
                ref={headerLogoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleHeaderLogoUpload('light', e)}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="secondary" size="sm"
                  isLoading={uploadingHeaderLogo}
                  startContent={!uploadingHeaderLogo ? <Upload size={14} /> : undefined}
                  onPress={() => headerLogoInputRef.current?.click()}
                >
                  {branding.logo ? t('admin_settings.replace_image') : t('admin_settings.upload_image')}
                </Button>
              </div>
            </div>

            {/* Dark variant — previewed on a dark surface so it reads correctly */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('admin_settings.header_logo_dark_label')}</p>
              <p className="text-xs text-muted">{t('admin_settings.header_logo_dark_hint')}</p>
              {branding.logoDark && (
                <div className="flex items-start gap-3 rounded-lg border border-border bg-neutral-900 p-3">
                  <img
                    src={resolveAssetUrl(branding.logoDark)}
                    alt={t('admin_settings.header_logo_dark_label')}
                    className="h-14 w-auto max-w-[180px] object-contain rounded"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                  <Button
                    isIconOnly size="sm" variant="danger"
                    aria-label={t('admin_settings.remove_header_logo_dark')}
                    onPress={() => handleHeaderLogoRemove('dark')}
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
              <input
                ref={headerLogoDarkInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleHeaderLogoUpload('dark', e)}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="secondary" size="sm"
                  isLoading={uploadingHeaderLogoDark}
                  startContent={!uploadingHeaderLogoDark ? <Upload size={14} /> : undefined}
                  onPress={() => headerLogoDarkInputRef.current?.click()}
                >
                  {branding.logoDark ? t('admin_settings.replace_image') : t('admin_settings.upload_image')}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>

        {/* Accessible header colour — themes the GOV.UK alpha header bar */}
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Palette size={20} aria-hidden="true" /> {t('admin_settings.header_colors_section')}
            </h3>
          </CardHeader>
          <CardBody className="gap-5">
            <p className="text-sm text-muted">{t('admin_settings.header_colors_desc')}</p>

            {/* Live preview of the accessible header bar */}
            <div className="rounded-lg overflow-hidden border border-border">
              <div
                className="flex items-center justify-between px-4 py-3"
                style={{
                  backgroundColor: form.header_bg_color || '#0b0c0c',
                  borderBottom: `8px solid ${form.header_accent_color || form.header_bg_color || '#1d70b8'}`,
                  color: readableHeaderText(form.header_bg_color || '#0b0c0c'),
                }}
              >
                <span className="font-semibold text-sm">{tenant?.name || t('system.your_community')}</span>
                <span className="text-xs">{t('admin_settings.header_colors_preview')}</span>
              </div>
            </div>

            {/* Background colour */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('admin_settings.header_bg_color_label')}</p>
              <p className="text-xs text-muted">{t('admin_settings.header_bg_color_hint')}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  type="color"
                  aria-label={t('admin_settings.header_bg_color_label')}
                  variant="secondary"
                  className="w-16"
                  value={form.header_bg_color || '#0b0c0c'}
                  onValueChange={(v) => setForm(prev => ({ ...prev, header_bg_color: v }))}
                />
                <Input
                  aria-label={t('admin_settings.header_bg_color_label')}
                  variant="secondary"
                  className="w-40"
                  placeholder="#0053BE"
                  value={form.header_bg_color}
                  onValueChange={(v) => setForm(prev => ({ ...prev, header_bg_color: v }))}
                />
                {form.header_bg_color && (
                  <Button
                    variant="secondary" size="sm"
                    onPress={() => setForm(prev => ({ ...prev, header_bg_color: '' }))}
                  >
                    {t('admin_settings.header_colors_reset')}
                  </Button>
                )}
              </div>
            </div>

            {/* Accent line colour */}
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('admin_settings.header_accent_color_label')}</p>
              <p className="text-xs text-muted">{t('admin_settings.header_accent_color_hint')}</p>
              <div className="flex items-center gap-3 flex-wrap">
                <Input
                  type="color"
                  aria-label={t('admin_settings.header_accent_color_label')}
                  variant="secondary"
                  className="w-16"
                  value={form.header_accent_color || form.header_bg_color || '#1d70b8'}
                  onValueChange={(v) => setForm(prev => ({ ...prev, header_accent_color: v }))}
                />
                <Input
                  aria-label={t('admin_settings.header_accent_color_label')}
                  variant="secondary"
                  className="w-40"
                  placeholder="#ffffff"
                  value={form.header_accent_color}
                  onValueChange={(v) => setForm(prev => ({ ...prev, header_accent_color: v }))}
                />
                {form.header_accent_color && (
                  <Button
                    variant="secondary" size="sm"
                    onPress={() => setForm(prev => ({ ...prev, header_accent_color: '' }))}
                  >
                    {t('admin_settings.header_colors_reset')}
                  </Button>
                )}
              </div>
            </div>
          </CardBody>
        </Card>

        {/* God-only: Powered By Branding (footer right slot) */}
        {isPlatformGod && (
          <Card className="border-2 border-warning/30">
            <CardHeader>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Lock size={18} className="text-warning" aria-hidden="true" />
                {t('system.powered_by_branding_section')}
                <Chip size="sm" color="warning" variant="soft">{t('system.god_only_chip')}</Chip>
              </h3>
            </CardHeader>
            <CardBody className="gap-5">
              <p className="text-sm text-muted">{t('system.powered_by_branding_desc')}</p>

              <Input
                label={t('system.label_powered_by_label')}
                placeholder={t('system.placeholder_powered_by_label')}
                description={t('system.desc_powered_by_label')}
                variant="secondary"
                value={form.powered_by_label}
                onValueChange={(val) => setForm(prev => ({ ...prev, powered_by_label: val }))}
              />
              <Input
                label={t('system.label_powered_by_url')}
                placeholder={t('system.placeholder_powered_by_url')}
                description={t('system.desc_powered_by_url')}
                variant="secondary"
                value={form.powered_by_url}
                onValueChange={(val) => setForm(prev => ({ ...prev, powered_by_url: val }))}
              />

              {/* Light mode image */}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('system.label_powered_by_image_light')}</p>
                {form.powered_by_image_light && (
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary p-3">
                    <img
                      src={form.powered_by_image_light}
                      alt={t('system.label_powered_by_image_light')}
                      className="h-14 w-auto max-w-[180px] object-contain rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <Button
                      isIconOnly size="sm" variant="danger"
                      aria-label={t('admin_settings.remove_light_image')}
                      onPress={() => {
                        // Only clear the form value — leaving originalForm intact so
                        // handleSave detects the removal and persists the empty value.
                        setForm(prev => ({ ...prev, powered_by_image_light: '' }));
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
                <input
                  ref={pbLightInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => handlePoweredByUpload('light', e)}
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <Button
                  variant="secondary" size="sm"
                  isLoading={uploadingPbLight}
                  startContent={!uploadingPbLight ? <Upload size={14} /> : undefined}
                  onPress={() => pbLightInputRef.current?.click()}
                >
                  {form.powered_by_image_light ? t('system.replace_image') : t('system.upload_image')}
                </Button>
              </div>

              {/* Dark mode image */}
              <div className="space-y-2">
                <p className="text-sm font-medium">{t('system.label_powered_by_image_dark')}</p>
                {form.powered_by_image_dark && (
                  <div className="flex items-start gap-3 rounded-lg border border-border bg-surface-secondary p-3">
                    <img
                      src={form.powered_by_image_dark}
                      alt={t('system.label_powered_by_image_dark')}
                      className="h-14 w-auto max-w-[180px] object-contain rounded"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                    <Button
                      isIconOnly size="sm" variant="danger"
                      aria-label={t('admin_settings.remove_dark_image')}
                      onPress={() => {
                        // Only clear the form value — leaving originalForm intact so
                        // handleSave detects the removal and persists the empty value.
                        setForm(prev => ({ ...prev, powered_by_image_dark: '' }));
                      }}
                    >
                      <X size={14} />
                    </Button>
                  </div>
                )}
                <input
                  ref={pbDarkInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => handlePoweredByUpload('dark', e)}
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <Button
                  variant="secondary" size="sm"
                  isLoading={uploadingPbDark}
                  startContent={!uploadingPbDark ? <Upload size={14} /> : undefined}
                  onPress={() => pbDarkInputRef.current?.click()}
                >
                  {form.powered_by_image_dark ? t('system.replace_image') : t('system.upload_image')}
                </Button>
              </div>
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{t('system.section_registration_access')}</h3>
            <Button as={Link} to={tenantPath("/admin/settings/registration-policy")} size="sm" variant="secondary" startContent={<ShieldCheck size={14} />}>
              {t('system.advanced_policy')}
            </Button>
          </CardHeader>
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('system.label_open_registration')}</p>
                <p className="text-sm text-muted">{t('system.desc_open_registration')}</p>
              </div>
              <Switch
                isSelected={form.registration_mode === 'open'}
                onValueChange={(val) => setForm(prev => ({ ...prev, registration_mode: val ? 'open' : 'closed' }))}
                aria-label={t('system.label_open_registration')}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t('system.require_email_verification')}</p>
                  {!isGod && (
                    <Tooltip content={t('system.super_admin_only_tooltip')}>
                      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} />}>{t('system.super_admin_only')}</Chip>
                    </Tooltip>
                  )}
                </div>
                <p className="text-sm text-muted">{t('system.desc_email_verification')}</p>
              </div>
              <Switch
                isSelected={form.email_verification}
                onValueChange={(val) => setForm(prev => ({ ...prev, email_verification: val }))}
                isDisabled={!isGod}
                aria-label={t('system.label_email_verification')}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t('system.admin_approval_required')}</p>
                  {!isGod && (
                    <Tooltip content={t('system.super_admin_only_tooltip')}>
                      <Chip size="sm" color="warning" variant="soft" startContent={<Lock size={10} />}>{t('system.super_admin_only')}</Chip>
                    </Tooltip>
                  )}
                </div>
                <p className="text-sm text-muted">{t('system.admin_approval_required_desc')}</p>
              </div>
              <Switch
                isSelected={form.admin_approval}
                onValueChange={(val) => setForm(prev => ({ ...prev, admin_approval: val }))}
                isDisabled={!isGod}
                aria-label={t('system.label_admin_approval')}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="font-medium">{t('system.label_inactivity_timeout')}</p>
                <p className="text-sm text-muted">{t('system.desc_inactivity_timeout')}</p>
              </div>
              <Input
                type="number"
                min={0}
                max={480}
                step={5}
                className="w-28"
                value={form.inactivity_timeout_minutes}
                onValueChange={(val) => setForm(prev => ({ ...prev, inactivity_timeout_minutes: val }))}
                aria-label={t('system.label_inactivity_timeout')}
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-muted">{t('system.maintenance_mode_read_only')}</p>
                <p className="text-sm text-muted">{t('system.maintenance_mode_cli_prefix')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                  <code className="rounded bg-surface-secondary px-1 text-xs">sudo bash scripts/maintenance.sh on|off</code>
                </p>
              </div>
              <Switch
                isSelected={form.maintenance_mode}
                isDisabled
                aria-label={t('system.label_maintenance_mode')}
              />
            </div>
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button
            startContent={!saving ? <Save size={16} /> : undefined}
            onPress={handleSave}
            isLoading={saving}
          >
            {t('system.btn_save_settings')}
          </Button>
        </div>

        {/* Additional platform configuration. Persists via the enterprise
            config endpoint; duplicate keys handled by the cards above are
            hidden via excludeKeys. Rendered without an outer Card to avoid
            double card nesting — SystemConfig provides its own per-group Cards. */}
        <div className="mt-2 border-t border-border pt-6">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">{t('system.additional_configuration')}</h2>
            <p className="mt-1 text-sm text-muted">
              {t('system.additional_configuration_desc')}
            </p>
          </div>
          <SystemConfig
            excludeKeys={DUPLICATE_KEYS}
            onAfterChange={fetchSettings}
          />
        </div>
      </div>
    </div>
  );
}

export default AdminSettings;
