// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Analytics
 * Thin wrapper around the admin FederationAnalytics module (charts and
 * numbers for activity with partner timebanks).
 */

import { useTranslation } from 'react-i18next';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import FederationAnalytics from '@/admin/modules/federation/FederationAnalytics';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function AnalyticsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.analytics.title')}
      description={t('pages.analytics.description')}
      icon={BarChart3}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <FederationAnalytics />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
