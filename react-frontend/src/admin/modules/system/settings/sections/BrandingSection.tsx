// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Scale from 'lucide-react/icons/scale';
import { Input, Textarea } from '@/components/ui';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const BRANDING_SECTION_ID = 'branding';

export function BrandingSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { form, originalForm, setField, uploading, upload, remove } = state;

  return (
    <SettingsSection
      id={BRANDING_SECTION_ID}
      icon={<Scale size={20} aria-hidden="true" />}
      title={t('system.section_branding_legal')}
      description={t('admin_settings.section_branding_desc')}
    >
      <Textarea
        label={t('system.label_footer_legal_text')}
        description={t('system.desc_displayed_in_the_site_footer_and_legal_h')}
        placeholder={t('system.placeholder_footer_legal_text')}
        variant="secondary"
        minRows={2}
        value={form.footer_text}
        onValueChange={(val) => setField('footer_text', val)}
      />

      <LogoUploadField
        id="partner"
        label={t('admin_settings.partner_logo_label')}
        hint={t('admin_settings.partner_logo_hint')}
        value={form.partner_logo_url || null}
        persistence="deferred"
        pendingRemoval={form.partner_logo_url === '' && originalForm.partner_logo_url !== ''}
        uploading={uploading.partner}
        onUpload={(file) => upload('partner', file)}
        onRemove={() => remove('partner')}
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Input
          label={t('system.label_partner_logo_label')}
          placeholder={t('system.placeholder_partner_logo_label')}
          description={t('system.desc_partner_logo_label')}
          variant="secondary"
          value={form.partner_logo_label}
          onValueChange={(val) => setField('partner_logo_label', val)}
        />
        <Input
          label={t('system.partner_logo_link_url')}
          placeholder="https://example.com"
          description={t('system.partner_logo_link_url_description')}
          variant="secondary"
          type="url"
          value={form.partner_logo_link_url}
          onValueChange={(val) => setField('partner_logo_link_url', val)}
        />
      </div>
    </SettingsSection>
  );
}

export default BrandingSection;
