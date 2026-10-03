// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Content Queue Page
 *
 * Reuses the admin content-moderation queue (ModerationQueuePage) untouched
 * inside the broker shell. Since F-543 (2 Oct 2026) the queue's moderation
 * settings are broker-or-admin too, so the embedded page's "Settings" button
 * is shown to everyone who can open this page. AdminEmbed collapses the
 * module's own page header to its action buttons.
 */

import { useTranslation } from 'react-i18next';
import Shield from 'lucide-react/icons/shield';
import { usePageTitle } from '@/hooks';
import ModerationQueuePage from '@/admin/modules/reports/ModerationQueuePage';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';
import { BrokerPageShell } from '../components';

export default function ContentQueuePage() {
  const { t } = useTranslation('broker');
  // The embedded admin module sets its own title too; React runs a child's
  // effects before its parent's, so this wrapper's title is the one that
  // lands in the browser tab.
  usePageTitle(t('moderation_queue.title'));

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_moderation', articleId: 'broker_content_queue' }}
      title={t('moderation_queue.title')}
      description={t('moderation_queue.description')}
      icon={Shield}
      color="accent"
    >
      <AdminEmbed>
        <ModerationQueuePage />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
