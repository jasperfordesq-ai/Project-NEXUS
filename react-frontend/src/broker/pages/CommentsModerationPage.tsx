// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Comments Moderation Page — reuses the admin CommentsModeration
 * module untouched inside the broker shell. See SafeguardingPage / adminEmbed
 * for the embed pattern.
 */

import { useTranslation } from 'react-i18next';
import MessageCircle from 'lucide-react/icons/message-circle';
import CommentsModeration from '@/admin/modules/moderation/CommentsModeration';
import { BrokerPageShell } from '../components';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';

export default function CommentsModerationPage() {
  const { t } = useTranslation('broker');

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_moderation', articleId: 'broker_comments_reviews' }}
      title={t('moderation_comments.title')}
      description={t('moderation_comments.description')}
      icon={MessageCircle}
      color="accent"
    >
      <AdminEmbed>
        <CommentsModeration />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
