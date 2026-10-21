// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Volunteering incidents (F-536).
 *
 * Volunteering incidents alert brokers and coordinators and link here, so
 * they are handled here. Assigning an organisation's designated liaison person
 * stays admin-only. Only reachable when the tenant has the volunteering
 * feature — the route and the sidebar item are both gated.
 *
 * Below the incidents sit the volunteer wellbeing alerts: a volunteer who says
 * they are Low or Struggling, and lets someone get in touch, lands here for the
 * community's team to follow up. A broker's or coordinator's wellbeing bell and
 * email link here with ?alert={id}, which opens that alert's drawer: the
 * check-ins, who was told, and the permanent notes (21 Oct 2026).
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import HandHeart from 'lucide-react/icons/hand-heart';
import { VolunteerSafeguarding } from '@/admin/modules/volunteering/VolunteerSafeguarding';
import { WellbeingAlertsPanel } from '@/admin/modules/volunteering/WellbeingAlertsPanel';
import { WellbeingAlertDrawer } from '@/admin/modules/volunteering/WellbeingAlertDrawer';
import { useWellbeingAlertDeepLink } from '@/admin/modules/volunteering/useWellbeingAlertDeepLink';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';
import { BrokerPageShell } from '../components';

export default function SafeguardingVolunteeringPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.volunteering_incidents_title'));
  const { openId, open, close } = useWellbeingAlertDeepLink();
  const [refreshKey, setRefreshKey] = useState(0);
  const changed = useCallback(() => setRefreshKey((k) => k + 1), []);
  // The embedded module's own action buttons (Refresh, Settings…) render
  // into the broker page header, so the content area starts with the
  // content — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <BrokerPageShell
      actions={actionsSlot}
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.volunteering_incidents_title')}
      description={t('safeguarding.volunteering_incidents_description')}
      icon={HandHeart}
      color="danger"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <VolunteerSafeguarding canAssignDlp={false} caseBasePath="/broker/safeguarding/volunteering" />
        <div className="mt-6">
          <WellbeingAlertsPanel refreshKey={refreshKey} onOpen={open} />
        </div>
        <WellbeingAlertDrawer alertId={openId} isOpen={openId !== null} onClose={close} onChanged={changed} />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
