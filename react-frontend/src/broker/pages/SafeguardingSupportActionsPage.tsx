// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Support actions — actions prepared on a member's
 * behalf that wait for their answer, and the record of formal authority staff
 * have sighted. Formerly the fourth tab of a single Safeguarding page.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import { SupportActionsPanel } from '@/admin/modules/safeguarding/SupportActionsPanel';
import { SafeguardingHelp } from '@/admin/modules/safeguarding/SafeguardingHelp';
import { BrokerPageShell } from '../components';

export default function SafeguardingSupportActionsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.support_actions_title'));

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.support_actions_title')}
      description={t('safeguarding.support_actions_description')}
      icon={ClipboardCheck}
      color="danger"
    >
      <div className="space-y-6">
        <SupportActionsPanel />
        <SafeguardingHelp />
      </div>
    </BrokerPageShell>
  );
}
