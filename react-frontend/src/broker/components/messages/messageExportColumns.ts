// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CSV columns for the Messages list export: what was sent, between whom, why
 * it was copied, and what the broker did with it.
 */

import type { TFunction } from 'i18next';
import { formatServerDateTime } from '@/lib/serverTime';
import type { BrokerMessage } from '@/admin/api/types';
import type { CsvColumn } from '@/broker/useCsvExport';
import { copyReasonLabel, normalizeSeverity } from './messageLabels';

export function buildMessageExportColumns(t: TFunction<'broker'>): CsvColumn<BrokerMessage>[] {
  return [
    { label: t('messages.export_col_id'), value: (row) => row.id },
    { label: t('messages.detail_sent'), value: (row) => formatServerDateTime(row.sent_at ?? row.created_at) },
    { label: t('messages.col_sender'), value: (row) => row.sender_name },
    { label: t('messages.col_receiver'), value: (row) => row.receiver_name },
    { label: t('messages.detail_listing'), value: (row) => row.listing_title },
    { label: t('messages.detail_copy_reason'), value: (row) => copyReasonLabel(t, row.copy_reason) },
    { label: t('messages.flagged_label'), value: (row) => t(row.flagged ? 'messages.flagged_yes' : 'messages.flagged_no') },
    { label: t('messages.col_severity'), value: (row) => (row.flagged ? t(`status.${normalizeSeverity(row.flag_severity)}`) : '') },
    { label: t('messages.detail_reason'), value: (row) => row.flag_reason },
    { label: t('messages.col_status'), value: (row) => t(row.reviewed_at ? 'status.reviewed' : 'status.unreviewed') },
    { label: t('messages.detail_reviewed_by'), value: (row) => row.reviewed_by },
    { label: t('messages.detail_reviewed_at'), value: (row) => (row.reviewed_at ? formatServerDateTime(row.reviewed_at) : '') },
  ];
}
