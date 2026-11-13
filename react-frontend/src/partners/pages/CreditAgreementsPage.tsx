// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks — Credit Agreements
 * Thin wrapper around the admin CreditAgreements module (credit limits
 * agreed with partner timebanks).
 */

import { useTranslation } from 'react-i18next';
import Scale from 'lucide-react/icons/scale';
import CreditAgreements from '@/admin/modules/federation/CreditAgreements';
import { PartnersPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function CreditAgreementsPage() {
  const { t } = useTranslation('partners');
  // The embedded module's own buttons (Refresh, New…) are placed in this
  // page's header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <PartnersPageShell
      actions={actionsSlot}
      title={t('pages.credit_agreements.title')}
      description={t('pages.credit_agreements.description')}
      icon={Scale}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <CreditAgreements />
      </AdminEmbed>
    </PartnersPageShell>
  );
}
