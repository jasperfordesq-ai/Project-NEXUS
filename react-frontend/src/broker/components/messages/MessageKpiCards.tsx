// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessageKpiCards — the Messages page's four counts. Three are whole-queue
 * totals read from the same endpoint their tab lists (so a card can never
 * disagree with its list); the fourth is the current filter's total.
 */

import { useTranslation } from 'react-i18next';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Flag from 'lucide-react/icons/flag';
import Inbox from 'lucide-react/icons/inbox';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';

import { useTenant } from '@/contexts';
import { BrokerStatCard } from '../BrokerStatCard';

export interface MessageQueueTotals {
  flagged: number | null;
  reviewed: number | null;
  urgent: number | null;
}

interface MessageKpiCardsProps {
  unreviewedCount: number | null;
  countLoading: boolean;
  queueTotals: MessageQueueTotals;
  totalsLoading: boolean;
  /** Total of the filter on screen. */
  filteredTotal: number;
  hasLoaded: boolean;
}

export function MessageKpiCards({ unreviewedCount, countLoading, queueTotals, totalsLoading, filteredTotal, hasLoaded }: MessageKpiCardsProps) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();

  return (
    <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
      <BrokerStatCard
        label={t('messages.stat_unreviewed')}
        value={unreviewedCount}
        icon={MessageSquareWarning}
        color="warning"
        loading={countLoading}
        to={tenantPath('/broker/messages?status=unreviewed')}
        description={t('messages.stat_unreviewed_hint')}
      />
      <BrokerStatCard
        label={t('messages.stat_flagged_total')}
        value={queueTotals.flagged}
        icon={Flag}
        color="danger"
        loading={totalsLoading}
        to={tenantPath('/broker/messages?status=flagged')}
        description={t('messages.stat_flagged_total_hint')}
      />
      <BrokerStatCard
        label={t('messages.stat_reviewed_total')}
        value={queueTotals.reviewed}
        icon={CheckCircle}
        color="success"
        loading={totalsLoading}
        to={tenantPath('/broker/messages?status=reviewed')}
        description={t('messages.stat_reviewed_total_hint')}
      />
      <BrokerStatCard
        label={t('messages.stat_filtered')}
        value={filteredTotal}
        icon={Inbox}
        color="accent"
        loading={!hasLoaded}
        description={t('messages.stat_filtered_hint')}
      />
    </div>
  );
}

export default MessageKpiCards;
