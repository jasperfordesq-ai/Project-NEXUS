// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Partner Cooperatives (Caring Community)
 * Thin wrapper around the caring-community FederationPeersAdminPage
 * module (remote NEXUS installs this cooperative exchanges hour
 * transfers with). Route-gated on the caring_community feature; the
 * sidebar section disappears entirely when the module is off.
 */

import { useTranslation } from 'react-i18next';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import FederationPeersAdminPage from '@/admin/modules/caring-community/FederationPeersAdminPage';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function CaringPeersPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.caring_peers.title')}
      description={t('pages.caring_peers.description')}
      icon={HeartHandshake}
      color="success"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <FederationPeersAdminPage />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
