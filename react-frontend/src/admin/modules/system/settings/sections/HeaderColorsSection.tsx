// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Palette from 'lucide-react/icons/palette';
import { useTenant } from '@/contexts';
import { SettingsSection } from '../SettingsSection';
import { ColorSettingField } from '../ColorSettingField';
import { DEFAULT_HEADER_ACCENT, DEFAULT_HEADER_BG, readableHeaderText } from '../headerPreview';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const HEADER_COLORS_SECTION_ID = 'header-colours';

/** Themes the accessible (GOV.UK-style) header bar; stored in tenants.configuration. */
export function HeaderColorsSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { tenant } = useTenant();
  const { form, setField } = state;

  const bg = form.header_bg_color || DEFAULT_HEADER_BG;
  const accent = form.header_accent_color || form.header_bg_color || DEFAULT_HEADER_ACCENT;

  return (
    <SettingsSection
      id={HEADER_COLORS_SECTION_ID}
      icon={<Palette size={20} aria-hidden="true" />}
      title={t('admin_settings.header_colors_section')}
      description={t('admin_settings.header_colors_desc')}
    >
      {/* Live preview of the accessible header bar. Inline colours are the
          content being edited, not styling — there is no token for them. */}
      <div className="overflow-hidden rounded-xl border border-divider" aria-hidden="true">
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ backgroundColor: bg, borderBottom: `8px solid ${accent}`, color: readableHeaderText(bg) }}
        >
          <span className="text-sm font-semibold">{tenant?.name || t('system.your_community')}</span>
          <span className="text-xs">{t('admin_settings.header_colors_preview')}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ColorSettingField
          id="header-bg"
          label={t('admin_settings.header_bg_color_label')}
          hint={t('admin_settings.header_bg_color_hint')}
          value={form.header_bg_color}
          fallback={DEFAULT_HEADER_BG}
          onChange={(hex) => setField('header_bg_color', hex)}
        />
        <ColorSettingField
          id="header-accent"
          label={t('admin_settings.header_accent_color_label')}
          hint={t('admin_settings.header_accent_color_hint')}
          value={form.header_accent_color}
          fallback={form.header_bg_color || DEFAULT_HEADER_ACCENT}
          onChange={(hex) => setField('header_accent_color', hex)}
        />
      </div>
    </SettingsSection>
  );
}

export default HeaderColorsSection;
