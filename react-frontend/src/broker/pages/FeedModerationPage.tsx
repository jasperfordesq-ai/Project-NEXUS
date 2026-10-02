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
import FeedModeration from '@/admin/modules/moderation/FeedModeration';
import { BrokerPageShell } from '../components';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';

export default function FeedModerationPage() {
  const { t } = useTranslation('broker');

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_moderation', articleId: 'broker_feed_posts' }}
      title={t('moderation_feed.title')}
      description={t('moderation_feed.description')}
      icon={MessageSquare}
      color="accent"
    >
      <AdminEmbed>
        <FeedModeration />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
