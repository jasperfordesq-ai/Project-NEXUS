// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import PanelBottom from 'lucide-react/icons/panel-bottom';
import { Input, Textarea } from '@/components/ui';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const FOOTER_SECTION_ID = 'footer';

/** The legal line and the partner logo at the foot of every page. */
export function FooterSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { form, originalForm, setField, uploading, upload, remove } = state;

  return (
    <SettingsSection
      id={FOOTER_SECTION_ID}
      icon={<PanelBottom size={20} aria-hidden="true" />}
      title={t('admin_settings.footer_section')}
      description={t('admin_settings.footer_section_desc')}
    >
      <Textarea
        label={t('admin_settings.footer_legal_text_label')}
        description={t('admin_settings.footer_legal_text_help')}
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
          label={t('admin_settings.partner_logo_link_label')}
          placeholder="https://example.com"
          description={t('admin_settings.partner_logo_link_help')}
          variant="secondary"
          type="url"
          value={form.partner_logo_link_url}
          onValueChange={(val) => setField('partner_logo_link_url', val)}
        />
      </div>
    </SettingsSection>
  );
}

export default FooterSection;
