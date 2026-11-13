// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Phone app — who in this community has the app.
 *
 * Until 13 Nov 2026 this page also carried a 24-field settings form (app
 * identity, store metadata, push credentials, web-app colours), a "Deployment
 * Readiness" panel and a "build manifest" download. Every one of those saved or
 * displayed `native_app_*` settings that nothing read — the phone app's
 * identity is fixed in the app, push is sent with server-level credentials and
 * the web-app manifest uses fixed values — so they were removed (E-127 / F-621).
 * Do not reintroduce a setting here without a reader for it.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { PageHeader } from '../../components/PageHeader';
import { NativeAppInstallStats } from './NativeAppInstallStats';

export function NativeApp() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.phone_app.title'));

  return (
    <div>
      <PageHeader
        title={t('system.phone_app.title')}
        description={t('system.phone_app.description')}
      />

      <div className="space-y-4">
        <NativeAppInstallStats />
      </div>
    </div>
  );
}

export default NativeApp;
