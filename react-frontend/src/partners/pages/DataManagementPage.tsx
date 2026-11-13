// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Data Management
 * Thin wrapper around the admin federation DataManagement module
 * (export, import and clean-up of partnering data).
 */

import { useTranslation } from 'react-i18next';
import Database from 'lucide-react/icons/database';
import DataManagement from '@/admin/modules/federation/DataManagement';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function DataManagementPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.data.title')}
      description={t('pages.data.description')}
      icon={Database}
      color="neutral"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <DataManagement />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
