// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Network Settings
 * Thin wrapper around the admin FederationSettings module (the master
 * switches for what this timebank shares with partners).
 */

import { useTranslation } from 'react-i18next';
import Settings from 'lucide-react/icons/settings';
import FederationSettings from '@/admin/modules/federation/FederationSettings';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function NetworkSettingsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.settings.title')}
      description={t('pages.settings.description')}
      icon={Settings}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <FederationSettings />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
