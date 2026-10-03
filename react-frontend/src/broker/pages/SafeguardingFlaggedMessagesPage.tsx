// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Flagged messages — copies of messages taken for
 * safeguarding review. Formerly the first tab of a single Safeguarding page.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import Flag from 'lucide-react/icons/flag';
import { FlaggedMessagesPanel } from '@/admin/modules/safeguarding/FlaggedMessagesPanel';
import { SafeguardingHelp } from '@/admin/modules/safeguarding/SafeguardingHelp';
import { BrokerPageShell } from '../components';

export default function SafeguardingFlaggedMessagesPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.flagged_title'));

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.flagged_title')}
      description={t('safeguarding.flagged_description')}
      icon={Flag}
      color="danger"
    >
      <div className="space-y-6">
        <FlaggedMessagesPanel />
        <SafeguardingHelp />
      </div>
    </BrokerPageShell>
  );
}
