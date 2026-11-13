// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Neighbourhoods
 * Thin wrapper around the admin Neighborhoods module (geographic
 * groupings that can be shared with partner timebanks).
 */

import { useTranslation } from 'react-i18next';
import MapPin from 'lucide-react/icons/map-pin';
import Neighborhoods from '@/admin/modules/federation/Neighborhoods';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function NeighborhoodsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.neighborhoods.title')}
      description={t('pages.neighborhoods.description')}
      icon={MapPin}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <Neighborhoods />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
