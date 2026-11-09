// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin → Settings → "Community photo" (AWID feedback, Nov 2026: "warmth,
 * and community"). One photo of the community, shown by the member website on
 * the sign-in and join pages, the dashboard and the feed. Like the header
 * logos it lives in tenants.configuration, so an upload or removal persists at
 * once and reaches the website through the tenant bootstrap
 * (branding.communityPhoto).
 */

import { useTranslation } from 'react-i18next';
import Camera from 'lucide-react/icons/camera';
import { useTenant } from '@/contexts';
import { resolveAssetUrl } from '@/lib/helpers';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const COMMUNITY_PHOTO_SECTION_ID = 'community-photo';

export function CommunityPhotoSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { branding } = useTenant();
  const { uploading, upload, remove } = state;

  return (
    <SettingsSection
      id={COMMUNITY_PHOTO_SECTION_ID}
      icon={<Camera size={20} aria-hidden="true" />}
      title={t('admin_settings.community_photo_section')}
      description={t('admin_settings.community_photo_desc')}
    >
      <LogoUploadField
        id="community-photo"
        label={t('admin_settings.community_photo_label')}
        hint={
          <>
            {t('admin_settings.community_photo_hint')}{' '}
            <strong className="font-medium text-foreground">{t('admin_settings.community_photo_consent')}</strong>
          </>
        }
        value={branding.communityPhoto ? resolveAssetUrl(branding.communityPhoto) : null}
        preview="photo"
        accept="image/jpeg,image/png,image/webp"
        persistence="immediate"
        uploading={uploading.community_photo}
        onUpload={(file) => upload('community_photo', file)}
        onRemove={() => remove('community_photo')}
      />
    </SettingsSection>
  );
}

export default CommunityPhotoSection;
