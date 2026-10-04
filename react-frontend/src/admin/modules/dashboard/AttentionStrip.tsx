// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Needs your attention" — the dashboard's triage strip.
 *
 * One chip per queue that is waiting on a coordinator, ordered by how urgent
 * the queue is, each a link straight into the list with the filter applied.
 * When every queue is empty it says so in green rather than showing nothing;
 * while the counts are still loading it shows a placeholder so it can never
 * flash "All clear" before the first answer. Mirrors the broker dashboard's
 * hero (BrokerDashboardPage) so the two panels read the same way.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import Zap from 'lucide-react/icons/zap';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import UserCheck from 'lucide-react/icons/user-check';
import ListChecks from 'lucide-react/icons/list-checks';
import Building2 from 'lucide-react/icons/building-2';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import FileLock2 from 'lucide-react/icons/file-lock-2';
import { Card, CardBody, Skeleton } from '@/components/ui';
import { useAuth, useTenant } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { isGodUser } from '@/lib/access';
import type { AdminBadgeCounts } from '../../hooks/useAdminBadgeCounts';

type QueueColor = 'danger' | 'warning' | 'accent';

interface Queue {
  key: keyof AdminBadgeCounts | 'pending_orgs';
  labelKey: string;
  icon: LucideIcon;
  color: QueueColor;
  path: string;
  /** Hidden when the feature or module behind the queue is off for this tenant. */
  show: boolean;
}

const pillClass: Record<QueueColor, string> = {
  danger: 'border-danger/30 bg-danger/10 hover:bg-danger/15',
  warning: 'border-warning/30 bg-warning/10 hover:bg-warning/15',
  accent: 'border-accent/30 bg-accent/10 hover:bg-accent/15',
};

const iconClass: Record<QueueColor, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
  accent: 'text-accent',
};

interface AttentionStripProps {
  counts: AdminBadgeCounts;
  /** False until the first badge-count request has answered. */
  loaded: boolean;
  /** From the dashboard stats; the badge service has the same count, this one wins when present. */
  pendingOrganisations?: number | null;
}

export function AttentionStrip({ counts, loaded, pendingOrganisations }: AttentionStripProps) {
  const { t } = useTranslation('admin_dashboard');
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const { user } = useAuth();
  const locale = getFormattingLocale();

  const orgs = pendingOrganisations ?? counts.pending_orgs ?? 0;

  // Most urgent first: money and personal-data obligations, then people
  // waiting to get in, then content and messages, then exchanges.
  const queues: Queue[] = [
    { key: 'fraud_alerts', labelKey: 'attention.fraud_alerts', icon: ShieldAlert, color: 'danger', path: '/admin/timebanking/alerts', show: hasModule('wallet') },
    { key: 'gdpr_requests', labelKey: 'attention.gdpr_requests', icon: FileLock2, color: 'danger', path: '/admin/enterprise/gdpr/requests', show: isGodUser(user) },
    { key: 'pending_users', labelKey: 'attention.pending_users', icon: UserCheck, color: 'warning', path: '/admin/users?filter=pending', show: true },
    { key: 'pending_orgs', labelKey: 'attention.pending_orgs', icon: Building2, color: 'warning', path: '/admin/volunteering/organizations', show: hasFeature('volunteering') },
    { key: 'pending_listings', labelKey: 'attention.pending_listings', icon: ListChecks, color: 'warning', path: '/admin/listings?status=pending', show: true },
    { key: 'unreviewed_messages', labelKey: 'attention.unreviewed_messages', icon: MessageSquareWarning, color: 'warning', path: '/broker/messages?status=unreviewed', show: true },
    { key: 'pending_exchanges', labelKey: 'attention.pending_exchanges', icon: ArrowLeftRight, color: 'accent', path: '/broker/exchanges?status=needs_action', show: hasFeature('exchange_workflow') },
  ];

  const countFor = (q: Queue): number =>
    q.key === 'pending_orgs' ? orgs : (counts[q.key] ?? 0);

  const active = queues.filter((q) => q.show && countFor(q) > 0);
  const total = active.reduce((sum, q) => sum + countFor(q), 0);

  if (!loaded) {
    return (
      <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]" data-testid="attention-strip-loading">
        <CardBody className="flex items-center gap-4 p-5 sm:p-6">
          <Skeleton role="status" aria-busy="true" aria-label={t('loading')} className="h-12 w-12 shrink-0 rounded-2xl bg-surface-tertiary" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-48 rounded bg-surface-tertiary" />
            <Skeleton className="h-4 w-72 max-w-full rounded bg-surface-tertiary" />
          </div>
        </CardBody>
      </Card>
    );
  }

  if (total === 0) {
    return (
      <Card
        role="status"
        className="rounded-2xl border border-success/30 bg-gradient-to-br from-success/10 via-surface to-surface shadow-sm shadow-black/[0.03]"
        data-testid="attention-strip-clear"
      >
        <CardBody className="flex items-center gap-4 p-5 sm:p-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/15 text-success ring-1 ring-inset ring-success/20">
            <CheckCircle2 size={26} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xl font-semibold tracking-tight text-foreground">{t('attention.all_clear')}</p>
            <p className="text-sm text-muted">{t('attention.all_clear_hint')}</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const hasDanger = active.some((q) => q.color === 'danger');

  return (
    <Card
      className={`rounded-2xl border shadow-sm shadow-black/[0.03] ${
        hasDanger
          ? 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface'
          : 'border-warning/30 bg-gradient-to-br from-warning/10 via-surface to-surface'
      }`}
      data-testid="attention-strip"
    >
      <CardBody className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div className="flex shrink-0 items-center gap-4">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-current/20 ${
              hasDanger ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
            }`}
          >
            <Zap size={26} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xl font-semibold tracking-tight text-foreground">{t('attention.title')}</p>
            <p className="text-sm text-muted">
              {t('attention.open_items', { count: total, formatted: total.toLocaleString(locale) })}
            </p>
          </div>
        </div>
        <nav aria-label={t('attention.title')} className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
          {active.map((q) => {
            const QIcon = q.icon;
            const count = countFor(q);
            return (
              <Link
                key={q.key}
                to={tenantPath(q.path)}
                aria-label={t('attention.open_queue', { queue: t(q.labelKey), count })}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none ${pillClass[q.color]}`}
              >
                <QIcon size={15} aria-hidden="true" className={iconClass[q.color]} />
                <span className="text-foreground">{t(q.labelKey)}</span>
                <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular-nums text-foreground">
                  {count.toLocaleString(locale)}
                </span>
              </Link>
            );
          })}
        </nav>
      </CardBody>
    </Card>
  );
}

export default AttentionStrip;
