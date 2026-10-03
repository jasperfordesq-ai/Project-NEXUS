// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker › Safeguarding › Members' support needs.
 *
 * The first safeguarding page in the sidebar on purpose: these are members who
 * told us they would like extra support, and their answers can change what
 * they can do on the platform. Until October 2026 this was the third tab of a
 * single Safeguarding page, and brokers said it was too hidden.
 *
 * Member names open the panel-wide member window (`?member=<id>`, see
 * BrokerMemberWindow) rather than a modal of this page's own, so a member
 * opened here looks and behaves exactly as one opened from any other broker
 * page. A change made in that window (approve, suspend, edit) fires the
 * platform's write event, which the embedded panel listens to, so the list
 * below refreshes on its own — see AdminEmbedAutoRefresh.
 */

import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import HeartHandshake from 'lucide-react/icons/heart-handshake';
import { MemberSupportNeedsPanel } from '@/admin/modules/safeguarding/MemberSupportNeedsPanel';
import { SafeguardingHelp } from '@/admin/modules/safeguarding/SafeguardingHelp';
import { AdminEmbed } from '@/admin/components/AdminEmbedContext';
import { useMemberWindow } from '@/broker/BrokerMemberWindow';
import { BrokerPageShell } from '../components';

export default function SafeguardingSupportNeedsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('safeguarding.support_needs_title'));
  const { open: openMember } = useMemberWindow();

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_safeguarding_page' }}
      title={t('safeguarding.support_needs_title')}
      description={t('safeguarding.support_needs_description')}
      icon={HeartHandshake}
      color="danger"
    >
      <div className="space-y-6">
        <AdminEmbed>
          <MemberSupportNeedsPanel onOpenMember={openMember} />
        </AdminEmbed>
        <SafeguardingHelp />
      </div>
    </BrokerPageShell>
  );
}
