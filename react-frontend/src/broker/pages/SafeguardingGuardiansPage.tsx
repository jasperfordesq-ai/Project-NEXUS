// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Guardians — guardian arrangements staff have
 * recorded for members who want extra support. Formerly the second tab of a
 * single Safeguarding page.
 *
 * Ward and guardian names open the panel-wide member window (see
 * BrokerMemberWindow); the embedded panel refreshes itself after any change
 * made there (AdminEmbedAutoRefresh).
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import Users from 'lucide-react/icons/users';
import { GuardiansPanel } from '@/admin/modules/safeguarding/GuardiansPanel';
import { SafeguardingHelp } from '@/admin/modules/safeguarding/SafeguardingHelp';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';
import { useMemberWindow } from '@/broker/BrokerMemberWindow';
import { BrokerPageShell } from '../components';

export default function SafeguardingGuardiansPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.guardians_title'));
  const { open: openMember } = useMemberWindow();

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.guardians_title')}
      description={t('safeguarding.guardians_description')}
      icon={Users}
      color="danger"
    >
      <div className="space-y-6">
        <AdminEmbed>
          <GuardiansPanel onOpenMember={openMember} />
        </AdminEmbed>
        <SafeguardingHelp />
      </div>
    </BrokerPageShell>
  );
}
