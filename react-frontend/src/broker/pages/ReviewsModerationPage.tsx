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
import ReviewsModeration from '@/admin/modules/moderation/ReviewsModeration';
import { BrokerPageShell } from '../components';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';

export default function ReviewsModerationPage() {
  const { t } = useTranslation('broker');

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_moderation', articleId: 'broker_comments_reviews' }}
      title={t('moderation_reviews.title')}
      description={t('moderation_reviews.description')}
      icon={Star}
      color="warning"
    >
      <AdminEmbed>
        <ReviewsModeration />
      </AdminEmbed>
    </BrokerPageShell>
  );
}
