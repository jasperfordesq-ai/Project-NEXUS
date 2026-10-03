// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Safeguarding Options Page — reuses the admin SafeguardingOptionsAdmin
 * module untouched inside the broker shell. See adminEmbed for the pattern.
 */

import { useTranslation } from 'react-i18next';
import Shield from 'lucide-react/icons/shield';
import { usePageTitle } from '@/hooks';
import SafeguardingOptionsAdmin from '@/admin/modules/safeguarding/SafeguardingOptionsAdmin';
import { BrokerPageShell } from '../components';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';

export default function SafeguardingOptionsPage() {
  const { t } = useTranslation('broker');
  // The embedded admin module sets its own title too; React runs a child's
  // effects before its parent's, so this wrapper's title wins the browser tab.
  usePageTitle(t('safeguarding_options.title'));

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_options' }}
      title={t('safeguarding_options.title')}
      description={t('safeguarding_options.description')}
      icon={Shield}
      color="danger"
    >
      <AdminEmbed>
        <SafeguardingOptionsAdmin />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
