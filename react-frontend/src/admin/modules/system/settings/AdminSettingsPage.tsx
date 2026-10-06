// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Settings — the community's main configuration page.
 *
 * One scrolling page: jump-link pills, a card per section, and a single
 * sticky Save bar that saves BOTH halves — the main form (name, branding,
 * header, registration) through /v2/admin/settings and the additional
 * configuration (wallet, moderation, notifications, limits) through the
 * enterprise config endpoint. The two key sets are disjoint by construction
 * (DUPLICATE_KEYS), so order cannot overwrite anything; a half that fails to
 * save stays dirty so the admin can retry just that part.
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import Settings from 'lucide-react/icons/settings';
import Settings2 from 'lucide-react/icons/settings-2';
import Languages from 'lucide-react/icons/languages';
import Sparkles from 'lucide-react/icons/sparkles';
import Wallet from 'lucide-react/icons/wallet';
import Shield from 'lucide-react/icons/shield';
import Bell from 'lucide-react/icons/bell';
import Gauge from 'lucide-react/icons/gauge';
import MoreHorizontal from 'lucide-react/icons/more-horizontal';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import {
  Button,
  Card,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Skeleton,
  useConfirm,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../../AdminMetaContext';
import { PageHeader } from '../../../components/PageHeader';
import { AdminSaveBar } from '../../../components/AdminSaveBar';
import { useUnsavedChangesGuard } from '../../../components/useUnsavedChangesGuard';
import { SystemConfig, systemConfigSectionId } from '../../enterprise/SystemConfig';
import { RelatedAdminPages, RELATED_PAGES_SECTION_ID } from '../../enterprise/RelatedAdminPages';
import { useSystemConfigForm } from '../../enterprise/useSystemConfigForm';
import { DUPLICATE_KEYS, type SettingsFormKey } from './settingsForm';
import { useAdminSettingsForm } from './useAdminSettingsForm';
import { SettingsJumpNav, type JumpNavSection } from './SettingsJumpNav';
import { settingsSectionAnchor } from './SettingsSection';
import { GeneralSection, GENERAL_SECTION_ID } from './sections/GeneralSection';
import { BrandingSection, BRANDING_SECTION_ID } from './sections/BrandingSection';
import { HeaderLogoSection, HEADER_LOGO_SECTION_ID } from './sections/HeaderLogoSection';
import { HeaderColorsSection, HEADER_COLORS_SECTION_ID } from './sections/HeaderColorsSection';
import { PoweredBySection, POWERED_BY_SECTION_ID } from './sections/PoweredBySection';
import { RegistrationSection, REGISTRATION_SECTION_ID } from './sections/RegistrationSection';

/** Which form fields belong to which section, for the jump-nav dirty dots. */
const SECTION_FIELDS: Record<string, SettingsFormKey[]> = {
  [GENERAL_SECTION_ID]: ['name', 'description', 'contact_email', 'contact_phone', 'default_currency', 'region'],
  [BRANDING_SECTION_ID]: ['footer_text', 'partner_logo_url', 'partner_logo_label', 'partner_logo_link_url'],
  [HEADER_LOGO_SECTION_ID]: [],
  [HEADER_COLORS_SECTION_ID]: ['header_bg_color', 'header_accent_color'],
  [POWERED_BY_SECTION_ID]: [
    'powered_by_wording', 'powered_by_label', 'powered_by_url', 'powered_by_image_light', 'powered_by_image_dark',
    'network_powered_by_wording', 'network_powered_by_label', 'network_powered_by_url', 'network_powered_by_image_light', 'network_powered_by_image_dark',
  ],
  [REGISTRATION_SECTION_ID]: ['registration_mode', 'email_verification', 'admin_approval', 'inactivity_timeout_minutes'],
};

const SYSTEM_CONFIG_ICONS: Record<string, ReactNode> = {
  general: <Languages size={20} aria-hidden="true" />,
  registration: <Sparkles size={20} aria-hidden="true" />,
  wallet: <Wallet size={20} aria-hidden="true" />,
  content: <Shield size={20} aria-hidden="true" />,
  notifications: <Bell size={20} aria-hidden="true" />,
  limits: <Gauge size={20} aria-hidden="true" />,
};

type SavePart = 'general' | 'colors' | 'system';

function SettingsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-28 rounded-full" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <Card key={i} className="rounded-2xl border border-divider/70 bg-surface p-5 shadow-sm shadow-black/[0.03]">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-3 w-72 rounded" />
            </div>
          </div>
          <div className="mt-6 space-y-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </Card>
      ))}
    </div>
  );
}

export function AdminSettingsPage() {
  const { t } = useTranslation('admin_system');
  const toast = useToast();
  const confirm = useConfirm();
  const { tenant, refreshTenant } = useTenant();
  useAdminPageMeta({ title: t('system.admin_settings_title') });

  const general = useAdminSettingsForm();
  const system = useSystemConfigForm({ excludeKeys: DUPLICATE_KEYS, icons: SYSTEM_CONFIG_ICONS });
  const [busy, setBusy] = useState(false);

  const loading = general.loading && system.loading && !general.dirty;
  const dirty = general.dirty || system.dirty;
  const saving = busy || general.saving || system.saving;
  const hasErrors = Object.keys(system.errors).length > 0;
  useUnsavedChangesGuard(dirty && !saving);

  const sections = useMemo<JumpNavSection[]>(() => {
    const changed = new Set(general.changed);
    const own: JumpNavSection[] = [
      { id: GENERAL_SECTION_ID, label: t('system.section_general') },
      { id: BRANDING_SECTION_ID, label: t('system.section_branding_legal') },
      { id: HEADER_LOGO_SECTION_ID, label: t('admin_settings.header_logo_section') },
      { id: HEADER_COLORS_SECTION_ID, label: t('admin_settings.header_colors_section') },
      ...(general.ctx.isPlatformGod ? [{ id: POWERED_BY_SECTION_ID, label: t('system.powered_by_branding_section') }] : []),
      { id: REGISTRATION_SECTION_ID, label: t('system.section_registration_access') },
    ].map((s) => ({ ...s, dirty: (SECTION_FIELDS[s.id] ?? []).some((f) => changed.has(f)) }));
    const extra: JumpNavSection[] = system.schema.map((group) => ({
      id: systemConfigSectionId(group.key),
      label: group.label,
      dirty: group.settings.some((s) => system.dirtyKeys.has(s.key)),
    }));
    return [...own, ...extra, { id: RELATED_PAGES_SECTION_ID, label: t('admin_settings.section_related_pill') }];
  }, [general.changed, general.ctx.isPlatformGod, system.schema, system.dirtyKeys, t]);

  const partLabel = (part: SavePart) => t(`admin_settings.save_part_${part}`);

  const handleSaveAll = useCallback(async () => {
    // Validate every field in the additional configuration before any
    // network call, so a half-saved page cannot result from a typo.
    const errors = system.validateAll();
    if (Object.keys(errors).length > 0) {
      toast.error(t('admin_settings.fix_errors_before_saving'));
      const firstKey = Object.keys(errors)[0];
      const group = system.schema.find((g) => g.settings.some((s) => s.key === firstKey));
      if (group) {
        document
          .getElementById(settingsSectionAnchor(systemConfigSectionId(group.key)))
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      return;
    }

    setBusy(true);
    try {
      const results: Array<{ part: SavePart; ok: boolean; changed: boolean; error?: string }> = [];

      // General first: a 403 on the security-gated keys (F-054) must abort
      // before anything else is written.
      const r1 = await general.save();
      results.push({ part: 'general', ...(r1.ok ? { ok: true, changed: r1.changed } : { ok: false, changed: true, error: r1.error }) });

      if (r1.ok) {
        const r2 = await general.saveHeaderColors();
        results.push({ part: 'colors', ...(r2.ok ? { ok: true, changed: r2.changed } : { ok: false, changed: true, error: r2.error }) });
      }

      // Independent endpoint with disjoint keys — still attempted after a
      // general failure so the admin's other edits are not held hostage.
      const r3 = await system.save();
      results.push({ part: 'system', ...(r3.ok ? { ok: true, changed: r3.changed } : { ok: false, changed: true, error: r3.error }) });

      const attempted = results.filter((r) => r.changed);
      const failed = attempted.filter((r) => !r.ok);

      if (failed.length === 0) {
        toast.success(t('system.settings_saved'));
      } else if (failed.length === attempted.length) {
        toast.error(failed[0]?.error ?? t('system.save_failed'));
      } else {
        toast.warning(t('admin_settings.save_partial', { parts: failed.map((f) => partLabel(f.part)).join(', ') }));
      }

      // Reload what saved so the saved copy matches, and refresh the tenant
      // bootstrap so live surfaces (footer, header, formatting) update at once.
      if (results.some((r) => r.ok && r.changed && r.part !== 'system')) await general.refetch();
      await refreshTenant();
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- partLabel is derived from t
  }, [general, system, toast, t, refreshTenant]);

  const handleDiscard = useCallback(() => {
    general.discard();
    system.discard();
  }, [general, system]);

  const handleReload = useCallback(async () => {
    setBusy(true);
    try {
      await Promise.all([general.refetch(), system.reload()]);
      toast.success(t('admin_settings.reload_done'));
    } finally {
      setBusy(false);
    }
  }, [general, system, toast, t]);

  const handleReset = useCallback(async () => {
    const ok = await confirm({
      title: t('admin_settings.reset_additional_config'),
      body: t('admin_settings.reset_confirm_body'),
      confirmLabel: t('admin_settings.reset_additional_config'),
      status: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await system.reset();
      if (!res.ok) {
        toast.error(t('system.save_failed'));
        return;
      }
      // Reset also deletes rows the main form owns (registration mode, footer
      // text, the gate keys), so both halves reload.
      await general.refetch();
      await refreshTenant();
      toast.success(t('admin_settings.reset_done'));
    } finally {
      setBusy(false);
    }
  }, [confirm, system, general, refreshTenant, toast, t]);

  const blockedReason = hasErrors ? t('admin_settings.fix_errors_before_saving') : null;

  return (
    <div className="pb-24">
      <PageHeader
        icon={<Settings size={20} aria-hidden="true" />}
        title={t('system.admin_settings_title')}
        description={t('system.admin_settings_desc', { name: tenant?.name || t('system.your_community') })}
      />

      {loading ? (
        <SettingsSkeleton />
      ) : (
        <div className="space-y-6">
          <SettingsJumpNav sections={sections} />

          <GeneralSection state={general} />
          <BrandingSection state={general} />
          <HeaderLogoSection state={general} />
          <HeaderColorsSection state={general} />
          {general.ctx.isPlatformGod && <PoweredBySection state={general} />}
          <RegistrationSection state={general} />

          <div className="flex items-center gap-3 pt-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-tertiary text-muted">
              <Settings2 size={16} aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold tracking-tight text-foreground">{t('system.additional_configuration')}</h2>
              <p className="text-sm text-muted">{t('system.additional_configuration_desc')}</p>
            </div>
          </div>

          {system.loadError ? (
            <Card className="rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center">
              <p className="font-medium text-danger">{t('system.failed_to_load_settings')}</p>
              <div className="mt-3">
                <Button variant="secondary" size="sm" onPress={() => void system.reload()} startContent={<RefreshCw size={14} aria-hidden="true" />}>
                  {t('common.retry')}
                </Button>
              </div>
            </Card>
          ) : (
            <SystemConfig form={system} />
          )}

          <RelatedAdminPages />

          <AdminSaveBar
            dirty={dirty}
            saving={saving}
            blockedReason={blockedReason}
            onSave={() => void handleSaveAll()}
            onDiscard={handleDiscard}
            secondaryActions={
              <Dropdown placement="top-end">
                <DropdownTrigger>
                  <Button isIconOnly size="sm" variant="tertiary" aria-label={t('admin_settings.more_actions')} isDisabled={saving}>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu
                  aria-label={t('admin_settings.more_actions')}
                  onAction={(key) => {
                    if (key === 'reload') void handleReload();
                    if (key === 'reset') void handleReset();
                  }}
                >
                  <DropdownItem id="reload" startContent={<RefreshCw size={14} aria-hidden="true" />}>
                    {t('admin_settings.reload_from_server')}
                  </DropdownItem>
                  <DropdownItem id="reset" color="danger" className="text-danger" startContent={<RotateCcw size={14} aria-hidden="true" />}>
                    {t('admin_settings.reset_additional_config')}
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            }
          />
        </div>
      )}
    </div>
  );
}

export default AdminSettingsPage;
