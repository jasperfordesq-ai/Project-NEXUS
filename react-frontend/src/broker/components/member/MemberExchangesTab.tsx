// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member window — Exchanges tab: every exchange the member requested or
 * provided, newest first. The exchanges endpoint has no `user_id` filter, so
 * the list is read (100 per page, up to 5 pages) and filtered here.
 */

import { useTranslation } from 'react-i18next';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import { Link as RouterLink } from 'react-router-dom';
import { Chip } from '@/components/ui';
import { useTenant } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import type { ExchangeRequest } from '@/admin/api/types';
import { formatServerDate } from '@/lib/serverTime';
import { BrokerStatusChip } from '../BrokerStatusChip';
import { MemberTabSection, MemberTabRow } from './MemberTabSection';
import { collectAllPages, hasMorePages, asArray, useMemberTabData, PAGE_SIZE } from './memberWindowData';

async function loadExchanges(userId: number) {
  const { rows, truncated } = await collectAllPages<ExchangeRequest>(async (page) => {
    const res = await adminBroker.getExchanges({ page, per_page: PAGE_SIZE });
    if (!res.success) throw new Error('exchanges');
    const pageRows = asArray<ExchangeRequest>(res.data);
    return { rows: pageRows, hasMore: hasMorePages(res.meta, page, pageRows.length) };
  });
  return {
    rows: rows.filter((e) => Number(e.requester_id) === userId || Number(e.provider_id) === userId),
    truncated,
  };
}

export function MemberExchangesTab({ userId }: { userId: number }) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();
  const data = useMemberTabData<ExchangeRequest>(userId, loadExchanges);

  return (
    <MemberTabSection
      loading={data.loading}
      error={data.error}
      onRetry={data.reload}
      isEmpty={data.rows.length === 0}
      empty={{ icon: ArrowRightLeft, title: t('member_detail.exchanges_empty_title'), hint: t('member_detail.exchanges_empty_hint') }}
      seeAllPath="/broker/exchanges"
      truncated={data.truncated}
    >
      {data.rows.map((exchange) => {
        const isRequester = Number(exchange.requester_id) === userId;
        const counterpart = isRequester ? exchange.provider_name : exchange.requester_name;
        const hours = exchange.final_hours ?? exchange.proposed_hours;
        return (
          <MemberTabRow
            key={exchange.id}
            title={
              <RouterLink
                to={tenantPath(`/broker/exchanges/${exchange.id}`)}
                className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {exchange.listing_title || t('exchanges.col_service')}
              </RouterLink>
            }
            detail={
              <>
                <span>{isRequester ? t('member_detail.exchange_role_requester') : t('member_detail.exchange_role_provider')}</span>
                <span>{t('member_detail.exchange_with', { name: counterpart })}</span>
                {hours != null && hours !== '' && <span className="tabular-nums">{hours} {t('members.hours_short')}</span>}
                <span className="tabular-nums">{formatServerDate(exchange.created_at)}</span>
              </>
            }
            aside={
              <>
                <BrokerStatusChip status={exchange.status} />
                {exchange.reversal_transaction_id ? (
                  <Chip size="sm" variant="tertiary" color="warning">{t('member_detail.exchange_reversed')}</Chip>
                ) : null}
              </>
            }
          />
        );
      })}
    </MemberTabSection>
  );
}

export default MemberExchangesTab;
