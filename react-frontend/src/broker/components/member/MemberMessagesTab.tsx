// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member window — Message copies tab: broker copies of messages the member
 * sent or received. The endpoint has no `user_id` filter but does search
 * both people's names (`q`), so the member's name narrows the read before
 * the rows are matched on sender/receiver id here.
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import MessageSquare from 'lucide-react/icons/message-square';
import { Link as RouterLink } from 'react-router-dom';
import { Chip } from '@/components/ui';
import { useTenant } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerMessage } from '@/admin/api/types';
import { formatServerDate } from '@/lib/serverTime';
import { MemberTabSection, MemberTabRow } from './MemberTabSection';
import { collectAllPages, hasMorePages, asArray, useMemberTabData, PAGE_SIZE } from './memberWindowData';

export function MemberMessagesTab({ userId, memberName }: { userId: number; memberName?: string | null }) {
  const { t } = useTranslation('broker');
  const { tenantPath } = useTenant();

  const load = useCallback(async (id: number) => {
    const name = memberName?.trim();
    const { rows, truncated } = await collectAllPages<BrokerMessage>(async (page) => {
      const res = await adminBroker.getMessages({ page, per_page: PAGE_SIZE, ...(name ? { q: name } : {}) });
      if (!res.success) throw new Error('messages');
      const pageRows = asArray<BrokerMessage>(res.data);
      return { rows: pageRows, hasMore: hasMorePages(res.meta, page, pageRows.length) };
    });
    return {
      rows: rows.filter((m) => Number(m.sender_id) === id || Number(m.receiver_id) === id),
      truncated,
    };
  }, [memberName]);

  const data = useMemberTabData<BrokerMessage>(userId, load);

  return (
    <MemberTabSection
      loading={data.loading}
      error={data.error}
      onRetry={data.reload}
      isEmpty={data.rows.length === 0}
      empty={{ icon: MessageSquare, title: t('member_detail.messages_empty_title'), hint: t('member_detail.messages_empty_hint') }}
      seeAllPath="/broker/messages"
      truncated={data.truncated}
    >
      {data.rows.map((message) => {
        const sent = Number(message.sender_id) === userId;
        const other = sent ? message.receiver_name : message.sender_name;
        return (
          <MemberTabRow
            key={message.id}
            title={
              <RouterLink
                to={tenantPath(`/broker/messages/${message.id}`)}
                className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                {sent ? t('member_detail.message_to', { name: other }) : t('member_detail.message_from', { name: other })}
              </RouterLink>
            }
            detail={
              <>
                {message.listing_title && <span className="truncate">{message.listing_title}</span>}
                <span className="tabular-nums">{formatServerDate(message.sent_at || message.created_at)}</span>
              </>
            }
            aside={
              <>
                {message.flagged ? (
                  <Chip size="sm" variant="soft" color="danger">{t('messages.flagged_label')}</Chip>
                ) : null}
                <Chip size="sm" variant="tertiary" color={message.reviewed_at ? 'success' : 'warning'}>
                  {message.reviewed_at ? t('messages.status_reviewed') : t('messages.status_unreviewed')}
                </Chip>
              </>
            }
          />
        );
      })}
    </MemberTabSection>
  );
}

export default MemberMessagesTab;
