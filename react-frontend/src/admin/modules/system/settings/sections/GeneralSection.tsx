// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import Settings from 'lucide-react/icons/settings';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import { Input, Select, SelectItem, Textarea } from '@/components/ui';
import { SettingsSection } from '../SettingsSection';
import { CURRENCY_OPTIONS, REGION_OPTIONS } from '../settingsForm';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const GENERAL_SECTION_ID = 'general';

export function GeneralSection({ state }: { state: AdminSettingsFormState }) {
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
      id={GENERAL_SECTION_ID}
      icon={<Settings size={20} aria-hidden="true" />}
      title={t('system.section_general')}
      description={t('admin_settings.section_general_desc')}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Input
          label={t('system.label_site_name')}
          placeholder={t('system.placeholder_project_nexus')}
          variant="secondary"
          value={form.name}
          onValueChange={(val) => setField('name', val)}
        />
        <Input
          label={t('system.label_support_email')}
          type="email"
          placeholder="support@project-nexus.ie"
          variant="secondary"
          value={form.contact_email}
          onValueChange={(val) => setField('contact_email', val)}
        />
        <div className="lg:col-span-2">
          <Textarea
            label={t('system.label_site_description')}
            placeholder={t('system.placeholder_community_timebanking_platform')}
            variant="secondary"
            minRows={2}
            value={form.description}
            onValueChange={(val) => setField('description', val)}
          />
        </div>
        <Input
          label={t('system.label_contact_phone')}
          type="tel"
          placeholder="+1 555 123 4567"
          variant="secondary"
          value={form.contact_phone}
          onValueChange={(val) => setField('contact_phone', val)}
        />
        <Select
          label={t('system.label_default_currency')}
          description={t('system.desc_default_currency')}
          variant="secondary"
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
        <div className="flex flex-col gap-3 lg:col-span-2 lg:flex-row lg:items-start">
          <div className="lg:w-1/2">
            <Select
              label={t('system.label_region')}
              description={t('system.desc_region')}
              variant="secondary"
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
          </div>
          {/* The label names a country; this shows what members will actually
              read, which is the thing being chosen. */}
          <div className="flex items-start gap-3 rounded-xl border border-divider bg-surface-secondary/60 p-3 text-sm lg:mt-6 lg:w-1/2">
            <CalendarClock size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="text-foreground">
                {t('system.region_sample', {
                  shortDate: regionSample.shortDate,
                  longDate: regionSample.longDate,
                  time: regionSample.time,
                })}
              </p>
              <p className="mt-0.5 font-mono text-xs tabular-nums text-muted">{regionSample.number}</p>
            </div>
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

export default GeneralSection;
