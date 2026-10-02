// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Reports Page — reuses the admin ReportsManagement module untouched
 * inside the broker shell for triaging member reports. See adminEmbed for the
 * embed pattern.
 */

import { useTranslation } from 'react-i18next';
import Flag from 'lucide-react/icons/flag';
import ReportsManagement from '@/admin/modules/moderation/ReportsManagement';
import { BrokerPageShell } from '../components';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';

export default function ReportsPage() {
  const { t } = useTranslation('broker');

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_moderation', articleId: 'broker_reports' }}
      title={t('moderation_reports.title')}
      description={t('moderation_reports.description')}
      icon={Flag}
      color="danger"
    >
      <AdminEmbed>
        <ReportsManagement />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
