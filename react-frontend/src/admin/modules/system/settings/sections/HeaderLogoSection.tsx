// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTranslation } from 'react-i18next';
import Image from 'lucide-react/icons/image';
import { useTenant } from '@/contexts';
import { resolveAssetUrl } from '@/lib/helpers';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const HEADER_LOGO_SECTION_ID = 'header-logo';

/**
 * Header logos live in tenants.configuration, not the settings form: uploads
 * and removals persist at once and show up through the tenant bootstrap as
 * branding.logo / branding.logoDark.
 */
export function HeaderLogoSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { branding } = useTenant();
  const { uploading, upload, remove } = state;

  return (
    <SettingsSection
      id={HEADER_LOGO_SECTION_ID}
      icon={<Image size={20} aria-hidden="true" />}
      title={t('admin_settings.header_logo_section')}
      description={t('admin_settings.header_logo_desc')}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <LogoUploadField
          id="header-light"
          label={t('admin_settings.header_logo_light_label')}
          hint={t('admin_settings.header_logo_hint')}
          value={branding.logo ? resolveAssetUrl(branding.logo) : null}
          persistence="immediate"
          uploading={uploading.header_light}
          onUpload={(file) => upload('header_light', file)}
          onRemove={() => remove('header_light')}
        />
        <LogoUploadField
          id="header-dark"
          label={t('admin_settings.header_logo_dark_label')}
          hint={t('admin_settings.header_logo_dark_hint')}
          value={branding.logoDark ? resolveAssetUrl(branding.logoDark) : null}
          persistence="immediate"
          uploading={uploading.header_dark}
          onUpload={(file) => upload('header_dark', file)}
          onRemove={() => remove('header_dark')}
        />
      </div>
    </SettingsSection>
  );
}

export default HeaderLogoSection;
