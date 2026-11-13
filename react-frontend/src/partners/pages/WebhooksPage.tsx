// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Event Webhooks
 * Thin wrapper around the admin Webhooks module (automatic notifications
 * sent to partner systems when things happen here).
 */

import { useTranslation } from 'react-i18next';
import Webhook from 'lucide-react/icons/webhook';
import Webhooks from '@/admin/modules/federation/Webhooks';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function WebhooksPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.webhooks.title')}
      description={t('pages.webhooks.description')}
      icon={Webhook}
      color="warning"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <Webhooks />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
