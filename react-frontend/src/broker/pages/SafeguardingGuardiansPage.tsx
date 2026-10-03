// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Guardians — guardian arrangements staff have
 * recorded for members who want extra support. Formerly the second tab of a
 * single Safeguarding page.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import Users from 'lucide-react/icons/users';
import { GuardiansPanel } from '@/admin/modules/safeguarding/GuardiansPanel';
import { SafeguardingHelp } from '@/admin/modules/safeguarding/SafeguardingHelp';
import { BrokerPageShell } from '../components';

export default function SafeguardingGuardiansPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.guardians_title'));

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.guardians_title')}
      description={t('safeguarding.guardians_description')}
      icon={Users}
      color="danger"
    >
      <div className="space-y-6">
        <GuardiansPanel />
        <SafeguardingHelp />
      </div>
    </BrokerPageShell>
  );
}
