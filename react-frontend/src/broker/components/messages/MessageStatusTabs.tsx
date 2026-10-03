// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessageStatusTabs — the Messages page's deep-linkable status tabs, with the
 * live counts on Unreviewed and Urgent.
 */

import { useTranslation } from 'react-i18next';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Flag from 'lucide-react/icons/flag';
import MessageSquare from 'lucide-react/icons/message-square';
import type { LucideIcon } from 'lucide-react';

import { Chip, Tab, Tabs } from '@/components/ui';

// `urgent` = flagged and not yet reviewed: what the dashboard's Safeguarding
// Alerts card counts. It replaced the safeguarding "Flagged messages" page
// (October 2026), which listed these same copies a second time.
export const MESSAGE_FILTERS = ['unreviewed', 'urgent', 'flagged', 'reviewed', 'all'] as const;
export type MessageFilter = (typeof MESSAGE_FILTERS)[number];

/** The tabs that are queues; a message opened from one keeps a "Next". */
export const MESSAGE_QUEUE_FILTERS: readonly MessageFilter[] = ['unreviewed', 'urgent', 'flagged'];

const TAB_ICONS: Record<MessageFilter, LucideIcon> = {
  unreviewed: Clock,
  urgent: AlertCircle,
  flagged: Flag,
  reviewed: CheckCircle,
  all: MessageSquare,
};

interface MessageStatusTabsProps {
  filter: MessageFilter;
  onChange: (next: MessageFilter) => void;
  unreviewedCount: number | null;
  urgentCount: number | null;
}

export function MessageStatusTabs({ filter, onChange, unreviewedCount, urgentCount }: MessageStatusTabsProps) {
  const { t } = useTranslation('broker');

  const badge = (key: MessageFilter) => {
    if (key === 'unreviewed' && unreviewedCount !== null && unreviewedCount > 0) {
      return (
        <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
          {unreviewedCount}
        </Chip>
      );
    }
    if (key === 'urgent' && urgentCount !== null && urgentCount > 0) {
      return (
        <Chip size="sm" variant="soft" color="danger" className="tabular-nums">
          {urgentCount}
        </Chip>
      );
    }
    return null;
  };

  return (
    <Tabs
      aria-label={t('messages.review_tabs_aria')}
      selectedKey={filter}
      onSelectionChange={(key) => onChange(key as MessageFilter)}
      variant="underlined"
      size="sm"
    >
      {MESSAGE_FILTERS.map((key) => {
        const Icon = TAB_ICONS[key];
        return (
          <Tab
            key={key}
            title={
              <div className="flex items-center gap-2">
                <Icon size={14} aria-hidden="true" />
                <span>{t(`messages.tab_${key}`)}</span>
                {badge(key)}
              </div>
            }
          />
        );
      })}
    </Tabs>
  );
}

export default MessageStatusTabs;
