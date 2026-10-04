// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Lock from 'lucide-react/icons/lock';
import { Chip, Input } from '@/components/ui';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const POWERED_BY_SECTION_ID = 'powered-by';

/** Platform-god only: the footer's right-hand "Powered by" slot. */
export function PoweredBySection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { form, originalForm, setField, uploading, upload, remove } = state;

  return (
    <SettingsSection
      id={POWERED_BY_SECTION_ID}
      icon={<Lock size={20} aria-hidden="true" />}
      tone="warning"
      title={t('system.powered_by_branding_section')}
      description={t('system.powered_by_branding_desc')}
      badge={<Chip size="sm" color="warning" variant="soft">{t('system.god_only_chip')}</Chip>}
      className="border-warning/40"
    >
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Input
          label={t('system.label_powered_by_label')}
          placeholder={t('system.placeholder_powered_by_label')}
          description={t('system.desc_powered_by_label')}
          variant="secondary"
          value={form.powered_by_label}
          onValueChange={(val) => setField('powered_by_label', val)}
        />
        <Input
          label={t('system.label_powered_by_url')}
          placeholder={t('system.placeholder_powered_by_url')}
          description={t('system.desc_powered_by_url')}
          variant="secondary"
          type="url"
          value={form.powered_by_url}
          onValueChange={(val) => setField('powered_by_url', val)}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogoUploadField
          id="powered-light"
          label={t('system.label_powered_by_image_light')}
          value={form.powered_by_image_light || null}
          persistence="deferred"
          pendingRemoval={form.powered_by_image_light === '' && originalForm.powered_by_image_light !== ''}
          uploading={uploading.powered_light}
          onUpload={(file) => upload('powered_light', file)}
          onRemove={() => remove('powered_light')}
        />
        <LogoUploadField
          id="powered-dark"
          label={t('system.label_powered_by_image_dark')}
          value={form.powered_by_image_dark || null}
          persistence="deferred"
          pendingRemoval={form.powered_by_image_dark === '' && originalForm.powered_by_image_dark !== ''}
          uploading={uploading.powered_dark}
          onUpload={(file) => upload('powered_dark', file)}
          onRemove={() => remove('powered_dark')}
        />
      </div>
    </SettingsSection>
  );
}

export default PoweredBySection;
