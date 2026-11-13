// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import { Select, SelectItem } from '@/components/ui';
import { ConfigSettingRow } from '../../../enterprise/ConfigSettingRow';
import type { SystemConfigFormState } from '../../../enterprise/useSystemConfigForm';
import { SettingsSection, SettingsRow } from '../SettingsSection';
import { CURRENCY_OPTIONS, REGION_OPTIONS } from '../settingsForm';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const DATES_MONEY_SECTION_ID = 'dates-money';

/** The enterprise-config keys this section edits, for the jump-nav dirty dot and error scrolling. */
export const DATES_MONEY_CONFIG_KEYS = ['timezone'] as const;

/**
 * Where and how the community keeps time and counts money: its time zone, how
 * dates and numbers are written, and the currency for real-money prices. The
 * language is deliberately not here — it is chosen on Module Configuration.
 */
export function DatesMoneySection({ state, form: config }: { state: AdminSettingsFormState; form: SystemConfigFormState }) {
  const { t, i18n } = useTranslation('admin_system');
  const { form, setField } = state;

  // Shows the selected region's conventions in the admin's own language before
  // saving. A country name alone does not tell an admin whether they are about
  // to get 17/08/2026 or 8/17/2026, which is the whole point of the control.
  // Formats the picked region directly rather than through getFormattingLocale(),
  // which still holds the SAVED region.
  const regionSample = useMemo(() => {
    const sampleDate = new Date(Date.UTC(2026, 7, 17, 15, 4));
    // locale-exempt: previews the region currently SELECTED in the form, which
    // is not yet saved. Language still comes from the app (i18n.language).
    const previewLocale = `${(i18n.language || 'en').split('-')[0]}-${form.region || 'IE'}`;
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };
    try {
      // locale-exempt: previewing the unsaved region, as explained above.
      return {
        longDate: sampleDate.toLocaleDateString(previewLocale, { ...options, day: 'numeric', month: 'long', year: 'numeric' }),
        shortDate: sampleDate.toLocaleDateString(previewLocale, options),
        time: sampleDate.toLocaleTimeString(previewLocale, { ...options, hour: '2-digit', minute: '2-digit' }),
        number: new Intl.NumberFormat(previewLocale).format(1234567.89),
      };
    } catch {
      return { longDate: '', shortDate: '', time: '', number: '' };
    }
  }, [form.region, i18n.language]);

  return (
    <SettingsSection
      id={DATES_MONEY_SECTION_ID}
      icon={<CalendarClock size={20} aria-hidden="true" />}
      title={t('admin_settings.dates_money_section')}
      description={t('admin_settings.dates_money_section_desc')}
      layout="rows"
    >
      {/* Saved through the second endpoint: if that one could not be read,
          offering a default here would invite overwriting the real value. */}
      {!config.loadError && <ConfigSettingRow form={config} settingKey="timezone" />}

      <SettingsRow
        label={t('system.label_region')}
        help={
          <>
            <p>{t('system.desc_region')}</p>
            {/* The label names a country; this shows what members will actually
                read, which is the thing being chosen. */}
            <p className="mt-1.5 text-foreground" data-testid="region-sample">
              {t('system.region_sample', {
                shortDate: regionSample.shortDate,
                longDate: regionSample.longDate,
                time: regionSample.time,
              })}
              <span className="ms-2 font-mono text-xs tabular-nums text-muted">{regionSample.number}</span>
            </p>
          </>
        }
      >
        <Select
          aria-label={t('system.label_region')}
          className="w-full sm:w-64"
          selectedKeys={[form.region]}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as string | undefined;
            if (val) setField('region', val);
          }}
        >
          {REGION_OPTIONS.map((opt) => (
            <SelectItem key={opt.code} id={opt.code}>{t(opt.labelKey)}</SelectItem>
          ))}
        </Select>
      </SettingsRow>

      <SettingsRow label={t('admin_settings.money_currency_label')} help={t('admin_settings.money_currency_help')}>
        <Select
          aria-label={t('admin_settings.money_currency_label')}
          className="w-full sm:w-64"
          selectedKeys={[form.default_currency]}
          onSelectionChange={(keys) => {
            const val = Array.from(keys)[0] as string | undefined;
            if (val) setField('default_currency', val);
          }}
        >
          {CURRENCY_OPTIONS.map((opt) => (
            <SelectItem key={opt.code} id={opt.code}>{t(opt.labelKey)}</SelectItem>
          ))}
        </Select>
      </SettingsRow>
    </SettingsSection>
  );
}

export default DatesMoneySection;
