// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Inbound API Partners
 * Thin wrapper around the admin ApiPartnersAdminPage module (external
 * systems — banks, payment processors, municipal software — that call
 * into NEXUS). Route-gated on the partner_api feature.
 */

import { useTranslation } from 'react-i18next';
import Network from 'lucide-react/icons/network';
import ApiPartnersAdminPage from '@/admin/modules/api-partners/ApiPartnersAdminPage';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function InboundApiPartnersPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.inbound_api.title')}
      description={t('pages.inbound_api.description')}
      icon={Network}
      color="warning"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <ApiPartnersAdminPage />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
