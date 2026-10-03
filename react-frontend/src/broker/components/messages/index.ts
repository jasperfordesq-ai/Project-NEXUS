// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pieces shared by the Messages list, the message page and the Review
 * Archive — one flag dialog, one quick view, one date-range filter.
 */

export { FlagMessageModal } from './FlagMessageModal';
export { MessageQuickView } from './MessageQuickView';
export { ApproveArchiveModal } from './ApproveArchiveModal';
export { MessageThreadCard } from './MessageThreadCard';
export { MonitorSenderModal } from './MonitorSenderModal';
export { BrokerDateRangeFilter, type DateRangeValue } from './BrokerDateRangeFilter';
export { MessageHotkeyHints, type HotkeyHint } from './MessageHotkeyHints';
export { buildMessageColumns, HIGHLIGHT_ATTR } from './messageColumns';
export { buildMessageExportColumns } from './messageExportColumns';
export { MessageKpiCards, type MessageQueueTotals } from './MessageKpiCards';
export { MessageStatusTabs, MESSAGE_FILTERS, MESSAGE_QUEUE_FILTERS, type MessageFilter } from './MessageStatusTabs';
export { FLAG_SEVERITIES, type FlagSeverity, normalizeSeverity, copyReasonLabel } from './messageLabels';
