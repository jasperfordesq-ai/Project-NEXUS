// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Reviews Moderation Page — reuses the admin ReviewsModeration module
 * untouched inside the broker shell. Gated on the `reviews` feature at the
 * route level (mirrors the admin sidebar gate). See adminEmbed for the pattern.
 */

import { useTranslation } from 'react-i18next';
import Star from 'lucide-react/icons/star';
import { usePageTitle } from '@/hooks';
import ReviewsModeration from '@/admin/modules/moderation/ReviewsModeration';
import { BrokerPageShell } from '../components';
import { AdminEmbed, useAdminEmbedActionsHost } from '@/admin/components/AdminEmbedContext';

export default function ReviewsModerationPage() {
  const { t } = useTranslation('broker');
  // The embedded admin module sets its own title too; React runs a child's
  // effects before its parent's, so this wrapper's title wins the browser tab.
  usePageTitle(t('moderation_reviews.title'));
  // The embedded module's own action buttons (Refresh, Settings…) render
  // into the broker page header, so the content area starts with the
  // content — see AdminEmbedContext.
  const { actionsHost, actionsSlot } = useAdminEmbedActionsHost();

  return (
    <BrokerPageShell
      actions={actionsSlot}
      help={{ sectionId: 'broker_moderation', articleId: 'broker_comments_reviews' }}
      title={t('moderation_reviews.title')}
      description={t('moderation_reviews.description')}
      icon={Star}
      color="warning"
    >
      <AdminEmbed actionsHost={actionsHost}>
        <ReviewsModeration />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
