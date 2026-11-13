// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Activity Feed
 * Thin wrapper around the admin federation ActivityFeed module (a running
 * log of everything exchanged with partner timebanks).
 */

import { useTranslation } from 'react-i18next';
import Activity from 'lucide-react/icons/activity';
import ActivityFeed from '@/admin/modules/federation/ActivityFeed';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function ActivityFeedPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.activity.title')}
      description={t('pages.activity.description')}
      icon={Activity}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <ActivityFeed />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
