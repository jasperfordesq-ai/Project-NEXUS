// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Volunteering incidents › one incident's case file.
 * The same case file staff see in the admin panel, inside the broker shell.
 */

import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import HandHeart from 'lucide-react/icons/hand-heart';
import { VolunteerIncidentCase } from '@/admin/modules/volunteering/incidents/VolunteerIncidentCase';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';
import { BrokerPageShell } from '../components';

export default function SafeguardingVolunteeringCasePage() {
  const { t } = useTranslation('broker');
  const { id } = useParams<{ id: string }>();
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <BrokerPageShell
      actions={actionsSlot}
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.volunteering_case_title')}
      icon={HandHeart}
      color="danger"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <VolunteerIncidentCase incidentId={Number(id)} backPath="/broker/safeguarding/volunteering" />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
