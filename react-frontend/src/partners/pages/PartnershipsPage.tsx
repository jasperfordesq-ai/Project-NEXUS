// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Partnerships
 * Thin wrapper: reuses the admin Partnerships module untouched, framed in
 * PartnersPageShell. The embedded page owns its own document title and data
 * fetching; AdminEmbed tells the admin PageHeader to drop its duplicate title
 * and hand its action buttons to this page's header.
 */

import { useTranslation } from 'react-i18next';
import Handshake from 'lucide-react/icons/handshake';
import Partnerships from '@/admin/modules/federation/Partnerships';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function PartnershipsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.partnerships.title')}
      description={t('pages.partnerships.description')}
      icon={Handshake}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <Partnerships />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
