// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Feed Moderation Page
 *
 * Content moderation is a broker duty, so the broker panel reuses the full
 * admin FeedModeration module untouched, framed in BrokerPageShell. The
 * embedded page owns its own document title and data fetching; AdminEmbed
 * collapses the admin PageHeader to its action buttons so the title is not
 * shown twice. See SafeguardingPage for the pattern rationale.
 */

import { useTranslation } from 'react-i18next';
import MessageSquare from 'lucide-react/icons/message-square';
import { usePageTitle } from '@/hooks';
import FeedModeration from '@/admin/modules/moderation/FeedModeration';
import { BrokerPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function FeedModerationPage() {
  const { t } = useTranslation('broker');
  // The embedded admin module sets its own title too; React runs a child's
  // effects before its parent's, so this wrapper's title wins the browser tab.
  usePageTitle(t('moderation_feed.title'));
  // The embedded module's own action buttons (Refresh, Settings…) render
  // into the broker page header, so the content area starts with the
  // content — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <BrokerPageShell
      actions={actionsSlot}
      help={{ sectionId: 'broker_moderation', articleId: 'broker_feed_posts' }}
      title={t('moderation_feed.title')}
      description={t('moderation_feed.description')}
      icon={MessageSquare}
      color="accent"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <FeedModeration />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
