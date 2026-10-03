// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ExchangeStatusTabs — the deep-linkable status strip on the Exchanges list.
 *
 * `needs_action` is not a real status: the API expands it to
 * pending_broker + disputed, the same set the broker dashboard's "Pending
 * Exchanges" card counts and links here with. The two badges read the same
 * probes the KPI cards read, so a tab can never disagree with its card.
 */

import { useTranslation } from 'react-i18next';
import AlertCircle from 'lucide-react/icons/circle-alert';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Ban from 'lucide-react/icons/ban';
import CheckCheck from 'lucide-react/icons/check-check';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Hourglass from 'lucide-react/icons/hourglass';
import Users from 'lucide-react/icons/users';
import type { LucideIcon } from 'lucide-react';
import { Chip, Tab, Tabs } from '@/components/ui';

export const EXCHANGE_STATUSES = [
  'all', 'needs_action', 'pending_broker', 'accepted', 'in_progress', 'completed', 'cancelled', 'disputed',
] as const;

export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

const TAB_ICONS: Record<ExchangeStatus, LucideIcon> = {
  all: Users,
  needs_action: AlertCircle,
  pending_broker: Clock,
  accepted: CheckCircle,
  in_progress: Hourglass,
  completed: CheckCheck,
  cancelled: Ban,
  disputed: AlertTriangle,
};

export interface ExchangeStatusTabsProps {
  status: ExchangeStatus;
  onChange: (status: ExchangeStatus) => void;
  /** Badge counts; null while unknown (no badge is drawn). */
  counts: { needsAction: number | null; pending: number | null };
}

export function ExchangeStatusTabs({ status, onChange, counts }: ExchangeStatusTabsProps) {
  const { t } = useTranslation('broker');
  const badge = (value: number | null) =>
    value != null && value > 0 ? (
      <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
        {value}
      </Chip>
    ) : null;

  return (
    <Tabs
      aria-label={t('exchanges.tabs_aria')}
      selectedKey={status}
      onSelectionChange={(key) => onChange(key as ExchangeStatus)}
      variant="underlined"
      size="sm"
    >
      {EXCHANGE_STATUSES.map((key) => {
        const Icon = TAB_ICONS[key];
        return (
          <Tab
            key={key}
            title={
              <div className="flex items-center gap-2">
                <Icon size={14} aria-hidden="true" />
                <span>{t(`exchanges.tab_${key}`)}</span>
                {key === 'needs_action' && badge(counts.needsAction)}
                {key === 'pending_broker' && badge(counts.pending)}
              </div>
            }
          />
        );
      })}
    </Tabs>
  );
}

export default ExchangeStatusTabs;
