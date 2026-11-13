// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin → "Make it yours" → "Community photo" (AWID feedback, Nov 2026:
 * "warmth, and community"). One photo of the community, shown by the member
 * website on the home page only (owner, 13 Nov 2026: "in too many places";
 * it came off the dashboard the same day). Like the header logos it lives in tenants.configuration,
 * so an upload or removal persists at once and reaches the website through
 * the tenant bootstrap (branding.communityPhoto).
 *
 * Once there is a photo, the section shows the top of the community's real
 * home page with the photo in it (owner, 13 Nov 2026), so the admin sees how
 * it is trimmed before any visitor does.
 */

import { useTranslation } from 'react-i18next';
import Camera from 'lucide-react/icons/camera';
import { useTenant } from '@/contexts';
import { resolveAssetUrl } from '@/lib/helpers';
import { SettingsSection } from '../SettingsSection';
import { LogoUploadField } from '../LogoUploadField';
import { HomePagePhotoPreview, useHomePageBanner } from './HomePagePhotoPreview';
import type { AdminSettingsFormState } from '../useAdminSettingsForm';

export const COMMUNITY_PHOTO_SECTION_ID = 'community-photo';

export function CommunityPhotoSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { branding } = useTenant();
  const { uploading, upload, remove } = state;
  const photo = branding.communityPhoto ? resolveAssetUrl(branding.communityPhoto) : null;
  const banner = useHomePageBanner();

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
        value={photo}
        // The home page preview below shows the photo; the plain picture is
        // for a community that has switched its welcome banner off.
        preview={banner ? 'none' : 'photo'}
        accept="image/jpeg,image/png,image/webp"
        persistence="immediate"
        uploading={uploading.community_photo}
        onUpload={(file) => upload('community_photo', file)}
        onRemove={() => remove('community_photo')}
      />
      {photo && <HomePagePhotoPreview banner={banner} />}
    </SettingsSection>
  );
}

export default CommunityPhotoSection;
