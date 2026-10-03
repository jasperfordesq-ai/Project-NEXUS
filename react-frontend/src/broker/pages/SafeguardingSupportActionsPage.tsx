// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Support actions — actions prepared on a member's
 * behalf that wait for their answer, and the record of formal authority staff
 * have sighted. Formerly the fourth tab of a single Safeguarding page.
 *
 * The panel's Refresh button is rendered into this page's header, so the
 * content area starts with the content — see AdminEmbedContext.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import { SupportActionsPanel } from '@/admin/modules/safeguarding/SupportActionsPanel';
import { SafeguardingHelp } from '@/admin/modules/safeguarding/SafeguardingHelp';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';
import { BrokerPageShell } from '../components';

export default function SafeguardingSupportActionsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.support_actions_title'));
  // The panel's Refresh button renders into the page header — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <BrokerPageShell
      actions={actionsSlot}
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.support_actions_title')}
      description={t('safeguarding.support_actions_description')}
      icon={ClipboardCheck}
      color="danger"
    >
      <div className="space-y-6">
        <AdminEmbed actionsHost={actionsHost}>
          <SupportActionsPanel />
        </AdminEmbed>
        <SafeguardingHelp />
      </div>
    </BrokerPageShell>
  );
}
