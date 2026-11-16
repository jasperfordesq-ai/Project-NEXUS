// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Messages list's columns, built once per render from the page's state.
 *
 * Both names open the member window (MemberName); the preview opens the
 * message itself. The row the keyboard has highlighted (j / k) is marked on
 * its first cell with `aria-current`, since DataTable has no row-level hook.
 */

import type { TFunction } from 'i18next';
import { Link } from 'react-router-dom';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Eye from 'lucide-react/icons/eye';
import Flag from 'lucide-react/icons/flag';

import { formatServerDate } from '@/lib/serverTime';
import type { Column } from '@/admin/components';
import type { BrokerMessage } from '@/admin/api/types';
import { Avatar, Button, Chip } from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { BrokerStatusChip } from '../BrokerStatusChip';
import { copyReasonLabel } from './messageLabels';

export const HIGHLIGHT_ATTR = 'data-hotkey-row';

/** How much of a message the list shows before the ellipsis. */
const PREVIEW_LENGTH = 180;

interface MessageColumnOptions {
  t: TFunction<'broker'>;
  /** Tenant-prefixed path of a message's detail page. */
  detailHref: (id: number) => string;
  highlightedId: number | null;
  reviewingId: number | null;
  onReview: (id: number) => void;
  onQuickView: (item: BrokerMessage) => void;
  onFlag: (id: number) => void;
}

export function buildMessageColumns({
  t,
  detailHref,
  highlightedId,
  reviewingId,
  onReview,
  onQuickView,
  onFlag,
}: MessageColumnOptions): Column<BrokerMessage>[] {
  return [
    {
      key: 'sender_name',
      label: t('messages.col_participants'),
      // Not sortable: sorting reordered only the twenty rows on screen, never
      // the queue, and j / k then moved in an order the list no longer showed.
      render: (item) => {
        const highlighted = item.id === highlightedId;
        return (
          <div
            className={`flex min-w-0 items-center gap-2 rounded-lg ${
              highlighted ? '-mx-2 bg-accent/10 px-2 py-1 ring-1 ring-inset ring-accent/40' : ''
            }`}
            aria-current={highlighted ? 'true' : undefined}
            {...(highlighted ? { [HIGHLIGHT_ATTR]: 'true' } : {})}
          >
            <Avatar name={item.sender_name} size="sm" className="shrink-0" />
            <MemberName userId={item.sender_id} name={item.sender_name} className="min-w-0 truncate text-sm" />
            <ArrowRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
            <Avatar name={item.receiver_name} size="sm" className="shrink-0" />
            <MemberName userId={item.receiver_id} name={item.receiver_name} className="min-w-0 truncate text-sm" />
          </div>
        );
      },
    },
    {
      key: 'message_body',
      label: t('messages.col_preview'),
      // The preview opens the message; until Oct 2026 only the sender's name
      // did, and brokers clicked the text and nothing happened. Since the
      // names now open the member window, this is the row's link. The whole
      // row opens the message too (the page's `onRowClick`); the link stays
      // for the keyboard and for "open in a new tab". Two lines of the
      // message, so most copies can be read without opening them at all.
      // The column only widens on a wide screen: on a laptop the extra width
      // pushed Reason, Status and Date out of sight under the pinned buttons.
      render: (item) => (
        <Link
          to={detailHref(item.id)}
          className="line-clamp-2 min-w-0 max-w-[15rem] whitespace-normal break-words text-sm text-muted hover:text-foreground hover:underline min-[1800px]:max-w-[26rem]"
        >
          {item.message_body
            ? item.message_body.substring(0, PREVIEW_LENGTH) + (item.message_body.length > PREVIEW_LENGTH ? '…' : '')
            : '—'}
        </Link>
      ),
    },
    {
      key: 'copy_reason',
      label: t('messages.col_reason'),
      render: (item) =>
        item.copy_reason ? (
          <Chip size="sm" variant="tertiary" color="default">
            {copyReasonLabel(t, item.copy_reason)}
          </Chip>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'flagged',
      hideBelow: '2xl',
      label: t('messages.col_flagged'),
      render: (item) =>
        item.flagged ? (
          <BrokerStatusChip status={item.flag_severity || 'concern'} />
        ) : (
          <span className="text-sm text-muted">{t('messages.flagged_no')}</span>
        ),
    },
    {
      key: 'reviewed_at',
      label: t('messages.col_status'),
      render: (item) => <BrokerStatusChip status={item.reviewed_at ? 'reviewed' : 'unreviewed'} />,
    },
    {
      key: 'created_at',
      label: t('messages.col_date'),
      // Sorted by the server across the whole queue (newest or oldest first).
      sortable: true,
      render: (item) => <span className="text-sm tabular-nums text-muted">{formatServerDate(item.created_at)}</span>,
    },
    {
      key: 'actions',
      label: t('messages.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {/* A flagged copy is read before it is reviewed: it has no one-press
              Review here, exactly as the `r` key and the bulk action refuse
              it. Its row and the quick view both lead to the review. */}
          {!item.reviewed_at && !item.flagged && (
            <Button
              size="sm"
              variant="tertiary"
              color="success"
              startContent={<CheckCircle size={14} aria-hidden="true" />}
              onPress={() => onReview(item.id)}
              isLoading={reviewingId === item.id}
              aria-label={t('messages.mark_reviewed_aria')}
            >
              {t('messages.review_action')}
            </Button>
          )}
          <Button isIconOnly size="sm" variant="tertiary" onPress={() => onQuickView(item)} aria-label={t('messages.quick_view_aria')}>
            <Eye size={14} aria-hidden="true" />
          </Button>
          {!item.flagged && (
            <Button
              size="sm"
              variant="tertiary"
              color="warning"
              startContent={<Flag size={14} aria-hidden="true" />}
              onPress={() => onFlag(item.id)}
              aria-label={t('messages.flag_message_aria')}
            >
              {t('messages.flag_action')}
            </Button>
          )}
        </div>
      ),
    },
  ];
}
