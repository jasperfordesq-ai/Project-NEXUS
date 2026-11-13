// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Credit Commons
 * Thin wrapper around the admin CreditCommonsConfig module. Credit Commons
 * is a general external protocol (like Komunitin/TimeOverflow), NOT a
 * Caring Community surface — see the owner decision of 2026-07-02.
 */

import { useTranslation } from 'react-i18next';
import Landmark from 'lucide-react/icons/landmark';
import CreditCommonsConfig from '@/admin/modules/federation/CreditCommonsConfig';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function CreditCommonsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.credit_commons.title')}
      description={t('pages.credit_commons.description')}
      icon={Landmark}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <CreditCommonsConfig />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
