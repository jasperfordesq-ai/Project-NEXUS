// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Settings — the community's main configuration page.
 *
 * One scrolling page: jump-link pills, a card per thing an admin comes here
 * to do, and a single sticky Save bar. The cards are grouped by task, not by
 * where a value is stored, so one card may hold fields from both forms: the
 * main form (name, contact details, joining rules, footer, header colours)
 * saves through /v2/admin/settings, and three settings (time zone, starting
 * balance, largest transfer) save through the enterprise config endpoint. The
 * two key sets are disjoint, so order cannot overwrite anything; a half that
 * fails to save stays dirty so the admin can retry just that part.
 *
 * Only settings that do something, and that no other admin page owns, are
 * here (owner, 13 Nov 2026) — see systemConfigSchema.ts for what came off.
 *
 * The header logo, the community colour (with the looks and Soft / Vivid) and
 * the community photo are NOT here: since 13 Nov 2026 they live on "Make it
 * yours" only (owner: no duplicates). A notice at the top of this page says
 * where they are. The community colour still travels in this page's form —
 * the colours endpoint takes it together with the accessible header colours —
 * but it is never edited here, so it is sent back exactly as it was loaded.
 */

import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Settings from 'lucide-react/icons/settings';
import Sparkles from 'lucide-react/icons/sparkles';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { Button, Card, Skeleton } from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../../AdminMetaContext';
import { PageHeader } from '../../../components/PageHeader';
import { AdminSaveBar } from '../../../components/AdminSaveBar';
import { useUnsavedChangesGuard } from '../../../components/useUnsavedChangesGuard';
import { RelatedAdminPages, RELATED_PAGES_SECTION_ID } from '../../enterprise/RelatedAdminPages';
import { useSystemConfigForm } from '../../enterprise/useSystemConfigForm';
import type { SettingsFormKey } from './settingsForm';
import { useAdminSettingsForm } from './useAdminSettingsForm';
import { SettingsJumpNav, type JumpNavSection } from './SettingsJumpNav';
import { settingsSectionAnchor } from './SettingsSection';
import { AboutSection, ABOUT_SECTION_ID } from './sections/AboutSection';
import { JoiningSection, JOINING_SECTION_ID } from './sections/JoiningSection';
import { TimeCreditsSection, TIME_CREDITS_SECTION_ID, TIME_CREDITS_CONFIG_KEYS } from './sections/TimeCreditsSection';
import { DatesMoneySection, DATES_MONEY_SECTION_ID, DATES_MONEY_CONFIG_KEYS } from './sections/DatesMoneySection';
import { FooterSection, FOOTER_SECTION_ID } from './sections/FooterSection';
import { HeaderColorsSection, HEADER_COLORS_SECTION_ID } from './sections/HeaderColorsSection';
import { PoweredBySection, POWERED_BY_SECTION_ID } from './sections/PoweredBySection';

/** Which main-form fields belong to which section, for the jump-nav dirty dots. */
const SECTION_FIELDS: Record<string, SettingsFormKey[]> = {
  [ABOUT_SECTION_ID]: ['name', 'description', 'contact_email', 'contact_phone'],
  [JOINING_SECTION_ID]: ['registration_mode', 'email_verification', 'admin_approval', 'approval_email_message', 'inactivity_timeout_minutes'],
  [DATES_MONEY_SECTION_ID]: ['region', 'default_currency'],
  [FOOTER_SECTION_ID]: ['footer_text', 'partner_logo_url', 'partner_logo_label', 'partner_logo_link_url'],
  [HEADER_COLORS_SECTION_ID]: ['header_bg_color', 'header_accent_color'],
  [POWERED_BY_SECTION_ID]: [
    'powered_by_wording', 'powered_by_label', 'powered_by_url', 'powered_by_image_light', 'powered_by_image_dark',
    'network_powered_by_wording', 'network_powered_by_label', 'network_powered_by_url', 'network_powered_by_image_light', 'network_powered_by_image_dark',
  ],
};

/** Which enterprise-config keys belong to which section (dirty dots, and where to scroll on a validation error). */
const SECTION_CONFIG_KEYS: Record<string, readonly string[]> = {
  [TIME_CREDITS_SECTION_ID]: TIME_CREDITS_CONFIG_KEYS,
  [DATES_MONEY_SECTION_ID]: DATES_MONEY_CONFIG_KEYS,
};

type SavePart = 'general' | 'colors' | 'system';

function SettingsSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true">
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 6 }).map((_, i) => (
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
  const { tenant, tenantPath, refreshTenant } = useTenant();
  useAdminPageMeta({ title: t('system.admin_settings_title') });

  const general = useAdminSettingsForm();
  const system = useSystemConfigForm();
  const [busy, setBusy] = useState(false);

  const loading = general.loading && system.loading && !general.dirty;
  const dirty = general.dirty || system.dirty;
  const saving = busy || general.saving || system.saving;
  const hasErrors = Object.keys(system.errors).length > 0;
  useUnsavedChangesGuard(dirty && !saving);

  const sections = useMemo<JumpNavSection[]>(() => {
    const changed = new Set(general.changed);
    const own: JumpNavSection[] = [
      { id: ABOUT_SECTION_ID, label: t('admin_settings.about_section') },
      { id: JOINING_SECTION_ID, label: t('admin_settings.joining_section') },
      { id: TIME_CREDITS_SECTION_ID, label: t('admin_settings.time_credits_section') },
      { id: DATES_MONEY_SECTION_ID, label: t('admin_settings.dates_money_section') },
      { id: FOOTER_SECTION_ID, label: t('admin_settings.footer_section') },
      { id: HEADER_COLORS_SECTION_ID, label: t('admin_settings.header_colors_section') },
      ...(general.ctx.isPlatformGod ? [{ id: POWERED_BY_SECTION_ID, label: t('system.powered_by_branding_section') }] : []),
    ].map((s) => ({
      ...s,
      dirty:
        (SECTION_FIELDS[s.id] ?? []).some((f) => changed.has(f)) ||
        (SECTION_CONFIG_KEYS[s.id] ?? []).some((k) => system.dirtyKeys.has(k)),
    }));
    return [...own, { id: RELATED_PAGES_SECTION_ID, label: t('admin_settings.section_related_pill') }];
  }, [general.changed, general.ctx.isPlatformGod, system.dirtyKeys, t]);

  const partLabel = (part: SavePart) => t(`admin_settings.save_part_${part}`);

  const handleSaveAll = useCallback(async () => {
    // Validate the number fields before any network call, so a half-saved
    // page cannot result from a typo.
    const errors = system.validateAll();
    const firstInvalid = Object.keys(errors)[0];
    if (firstInvalid !== undefined) {
      toast.error(t('admin_settings.fix_errors_before_saving'));
      const sectionId = Object.keys(SECTION_CONFIG_KEYS).find((id) => SECTION_CONFIG_KEYS[id]?.includes(firstInvalid));
      if (sectionId) {
        document.getElementById(settingsSectionAnchor(sectionId))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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

  // The community colour is no longer edited here, so a colour saved before
  // the "readable on white" rule existed must not block saving this page: it
  // is fixed on "Make it yours", where the rule is explained.
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

          {/* The logo, colour and photo are on "Make it yours" only (owner,
              13 Nov 2026: never in two places). This says where they are. */}
          <Card
            data-testid="settings-moved-notice"
            aria-labelledby="settings-moved-notice-title"
            className="rounded-2xl border border-accent/30 bg-accent-soft p-4 shadow-sm shadow-black/[0.03] sm:p-5"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface text-accent-soft-foreground"
              >
                <Sparkles size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="settings-moved-notice-title" className="text-base font-semibold tracking-tight text-foreground">
                  {t('admin_settings.miy_moved_title')}
                </h2>
                <p className="mt-0.5 text-sm leading-5 text-foreground">{t('admin_settings.miy_moved_text')}</p>
              </div>
              <Button
                as={Link}
                to={tenantPath('/admin/make-it-yours')}
                size="sm"
                variant="primary"
                className="shrink-0 self-start sm:self-center"
                endContent={<ArrowRight size={14} aria-hidden="true" />}
              >
                {t('admin_settings.miy_moved_open')}
              </Button>
            </div>
          </Card>

          <AboutSection state={general} />
          <JoiningSection state={general} />

          {system.loadError && (
            <Card className="rounded-2xl border border-danger/30 bg-danger/5 p-6 text-center" data-testid="settings-config-load-error">
              <p className="font-medium text-danger">{t('admin_settings.config_load_failed')}</p>
              <div className="mt-3">
                <Button variant="secondary" size="sm" onPress={() => void system.reload()} startContent={<RefreshCw size={14} aria-hidden="true" />}>
                  {t('common.retry')}
                </Button>
              </div>
            </Card>
          )}

          {!system.loadError && <TimeCreditsSection form={system} />}
          <DatesMoneySection state={general} form={system} />
          <FooterSection state={general} />
          <HeaderColorsSection state={general} />
          {general.ctx.isPlatformGod && <PoweredBySection state={general} />}

          <RelatedAdminPages />

          <AdminSaveBar
            dirty={dirty}
            saving={saving}
            blockedReason={blockedReason}
            onSave={() => void handleSaveAll()}
            onDiscard={handleDiscard}
          />
        </div>
      )}
    </div>
  );
}

export default AdminSettingsPage;
