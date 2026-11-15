// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin → "Make it yours" → "App icon" (warmth phase 6, A4): an optional
 * square picture a phone puts on its home screen when a member adds the
 * community's site to it. Like the logo and photo it lives in
 * tenants.configuration and saves as it uploads; it reaches phones through the
 * install manifest and the iPhone home-screen icon (lib/communityHead.ts).
 *
 * Optional and not one of the six steps, so it never moves the meter. It lives
 * on this page only (one admin place per setting). Without one, phones keep
 * the standard icon, exactly as before.
 */

import { useTranslation } from 'react-i18next';
import Smartphone from 'lucide-react/icons/smartphone';
import { useTenant } from '@/contexts';
import { safeAppIconPath } from '@/lib/communityHead';
import { resolveAssetUrl } from '@/lib/helpers';
import { SettingsSection } from '../settings/SettingsSection';
import { LogoUploadField } from '../settings/LogoUploadField';
import type { AdminSettingsFormState } from '../settings/useAdminSettingsForm';

export function AppIconSection({ state }: { state: AdminSettingsFormState }) {
  const { t } = useTranslation('admin_system');
  const { branding } = useTenant();
  const { uploading, upload, remove } = state;
  const stored = safeAppIconPath(branding.app_icon_url);
  const icon = stored ? resolveAssetUrl(stored) : null;

  return (
    <SettingsSection
      id="make-it-yours-app-icon-section"
      icon={<Smartphone size={20} aria-hidden="true" />}
      title={t('admin_settings.app_icon_section')}
      description={t('admin_settings.app_icon_desc')}
    >
      {icon && (
        // The shape a phone gives it: a rounded square.
        <img
          src={icon}
          alt={t('admin_settings.app_icon_label')}
          data-testid="app-icon-preview"
          className="size-24 rounded-3xl border border-divider object-cover"
        />
      )}
      <LogoUploadField
        id="app-icon"
        label={t('admin_settings.app_icon_label')}
        hint={t('admin_settings.app_icon_hint')}
        value={icon}
        preview="none"
        accept="image/png,image/jpeg,image/webp"
        persistence="immediate"
        uploading={uploading.app_icon}
        onUpload={(file) => upload('app_icon', file)}
        onRemove={() => remove('app_icon')}
      />
    </SettingsSection>
  );
}

export default AppIconSection;
