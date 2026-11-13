// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Clock from 'lucide-react/icons/clock';
import { ConfigSettingRow } from '../../../enterprise/ConfigSettingRow';
import type { SystemConfigFormState } from '../../../enterprise/useSystemConfigForm';
import { SettingsSection } from '../SettingsSection';

export const TIME_CREDITS_SECTION_ID = 'time-credits';

/** The enterprise-config keys this section edits, for the jump-nav dirty dot and error scrolling. */
export const TIME_CREDITS_CONFIG_KEYS = ['starting_balance', 'max_transaction'] as const;

/** What a new member starts with, and the most one transfer can carry. */
export function TimeCreditsSection({ form }: { form: SystemConfigFormState }) {
  const { t } = useTranslation('admin_system');

  return (
    <SettingsSection
      id={TIME_CREDITS_SECTION_ID}
      icon={<Clock size={20} aria-hidden="true" />}
      title={t('admin_settings.time_credits_section')}
      description={t('admin_settings.time_credits_section_desc')}
      layout="rows"
    >
      {TIME_CREDITS_CONFIG_KEYS.map((key) => (
        <ConfigSettingRow key={key} form={form} settingKey={key} />
      ))}
    </SettingsSection>
  );
}

export default TimeCreditsSection;
