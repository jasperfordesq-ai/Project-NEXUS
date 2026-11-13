// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Users from 'lucide-react/icons/users';
import { Input, Textarea } from '@/components/ui';
import { SettingsSection } from '../SettingsSection';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const ABOUT_SECTION_ID = 'about';

/** Who the community is: its name, a line about it, and how to reach it. */
export function AboutSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { form, setField } = state;

  return (
    <SettingsSection
      id={ABOUT_SECTION_ID}
      icon={<Users size={20} aria-hidden="true" />}
      title={t('admin_settings.about_section')}
      description={t('admin_settings.about_section_desc')}
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Input
            label={t('admin_settings.community_name_label')}
            placeholder={t('admin_settings.community_name_placeholder')}
            description={t('admin_settings.community_name_help')}
            variant="secondary"
            value={form.name}
            onValueChange={(val) => setField('name', val)}
          />
        </div>
        <div className="lg:col-span-2">
          <Textarea
            label={t('admin_settings.community_description_label')}
            placeholder={t('admin_settings.community_description_placeholder')}
            description={t('admin_settings.community_description_help')}
            variant="secondary"
            minRows={2}
            value={form.description}
            onValueChange={(val) => setField('description', val)}
          />
        </div>
        <Input
          label={t('admin_settings.support_email_label')}
          type="email"
          placeholder="hello@example.org"
          description={t('admin_settings.support_email_help')}
          variant="secondary"
          value={form.contact_email}
          onValueChange={(val) => setField('contact_email', val)}
        />
        <Input
          label={t('admin_settings.contact_phone_label')}
          type="tel"
          placeholder="+1 555 123 4567"
          description={t('admin_settings.contact_phone_help')}
          variant="secondary"
          value={form.contact_phone}
          onValueChange={(val) => setField('contact_phone', val)}
        />
      </div>
    </SettingsSection>
  );
}

export default AboutSection;
