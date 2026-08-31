import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Select, SelectItem, Tooltip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, Pagination } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, useConfirm } from '@/components/ui';
import { Separator } from '@/components/ui';
import Activity from 'lucide-react/icons/activity';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import Clock3 from 'lucide-react/icons/clock-3';
import Mail from 'lucide-react/icons/mail';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Search from 'lucide-react/icons/search';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { formatPercentValue } from '@/lib/helpers';
import { useToast } from '@/contexts/ToastContext';
import { usePageTitle } from '@/hooks/usePageTitle';

interface EmailWarning {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message_key: string;
  params?: Record<string, unknown>;
}

interface TriggerAudit {
  score: number;
  issue_count: number;
  matrix_count: number;
  issues_by_severity?: Record<string, number>;
  issues?: TriggerAuditIssue[];
}

interface TriggerAuditIssue {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  tenant_id: number | null;
  module: string;
  event: string;
  params?: Record<string, unknown>;
}

interface SummaryData {
  window_days: number;
  total: number;
  by_status: Record<string, number>;
  delivered_pct: number | null;
  accepted_pct?: number | null;
  unconfirmed_sent?: number;
  bounced_pct: number | null;
  warnings?: EmailWarning[];
  trigger_audit?: TriggerAudit;
}

interface PushFailureRow {
  id: number;
  user_id: number | null;
  activity_type: string;
  status: string;
  fcm_failed: number;
  error: string | null;
  created_at: string;
}

interface PushSummaryData {
  available: boolean;
  window_days: number;
  total: number;
  delivered: number;
  partial: number;
  failed: number;
  success_pct: number | null;
  fcm_sent: number;
  fcm_failed: number;
  web_delivered: number;
  by_type: Record<string, number>;
  recent_failures: PushFailureRow[];
}

interface LogRow {
  id: number;
  user_id: number | null;
  recipient_email: string;
  category: string | null;
  subject: string | null;
  status: string;
  provider?: string | null;
  provider_message_id: string | null;
  error: string | null;
  sent_at: string | null;
  delivered_at: string | null;
  bounced_at: string | null;
  opened_at: string | null;
  created_at: string;
}

interface SuppressionRow {
  id: number;
  email: string;
  reason: string;
  detail: string | null;
  suppressed_at: string;
}

interface QueueDiagnosticRow {
  source:
    | 'notification_queue'
    | 'newsletter_queue'
    | 'civic_digest_delivery_claims'
    | 'transaction_notification_deliveries'
    | 'marketplace_order_notification_deliveries'
    | 'marketplace_seller_ratings'
    | 'marketplace_disputes'
    | 'event_reminder_delivery_claims'
    | 'vol_reminder_delivery_claims'
    | 'listing_expiry_reminders_sent'
    | 'marketplace_report_notifications'
    | 'event_reminders'
    | 'goal_reminders'
    | 'job_interviews'
    | 'vol_reminders_sent'
    | 'member_subscription_events'
    | 'vol_donations'
    | 'federation_messages'
    | 'federation_transactions'
    | 'federation_inbound_connections'
    | 'reviews'
    | 'user_safeguarding_preferences'
    | 'notifications';
  id: number;
  email: string | null;
  category: string | null;
  subject: string | null;
  status: string;
  frequency: string | null;
  attempts: number;
  last_attempted_at: string | null;
  error: string | null;
  processing_started_at: string | null;
  created_at: string | null;
}

const STATUS_COLORS: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'primary'> = {
  queued: 'default',
  sent: 'primary',
  delivered: 'success',
  failed: 'danger',
  bounced: 'danger',
  suppressed: 'warning',
};

const SEVERITY_COLORS: Record<TriggerAuditIssue['severity'], 'default' | 'warning' | 'danger' | 'primary'> = {
  info: 'primary',
  warning: 'warning',
  critical: 'danger',
};

const PAGE_SIZE_OPTIONS = [25, 50, 100];
const LOG_STATUSES = ['', 'sent', 'delivered', 'bounced', 'failed', 'suppressed'];
const SUPPRESSION_REASONS = ['', 'bounce', 'block', 'invalid', 'spam_report', 'unsubscribe'];
const KNOWN_SUPPRESSION_REASONS = new Set(SUPPRESSION_REASONS.filter(Boolean));

export default function EmailDeliverability() {
  const { t } = useTranslation(['admin_advanced', 'common']);
  const confirm = useConfirm();
  usePageTitle(t('email_deliverability.title'));
  const toast = useToast();

  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [summaryDays, setSummaryDays] = useState(7);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [pushSummary, setPushSummary] = useState<PushSummaryData | null>(null);
  const [loadingPushSummary, setLoadingPushSummary] = useState(true);

  const [logRows, setLogRows] = useState<LogRow[]>([]);
  const [logTotal, setLogTotal] = useState(0);
  const [logPage, setLogPage] = useState(1);
  const [logLimit, setLogLimit] = useState(50);
  const [logSearch, setLogSearch] = useState('');
  const [logStatus, setLogStatus] = useState('');
  const [logCategory, setLogCategory] = useState('');
  const [logSince, setLogSince] = useState('');
  const [logUntil, setLogUntil] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [suppRows, setSuppRows] = useState<SuppressionRow[]>([]);
  const [suppTotal, setSuppTotal] = useState(0);
  const [suppPage, setSuppPage] = useState(1);
  const [suppLimit, setSuppLimit] = useState(50);
  const [suppSearch, setSuppSearch] = useState('');
  const [suppReason, setSuppReason] = useState('');
  const [loadingSupp, setLoadingSupp] = useState(false);

  const [queueRows, setQueueRows] = useState<QueueDiagnosticRow[]>([]);
  const [loadingQueues, setLoadingQueues] = useState(false);

  const logOffset = (logPage - 1) * logLimit;
  const suppOffset = (suppPage - 1) * suppLimit;
  const logPages = Math.max(1, Math.ceil(logTotal / logLimit));
  const suppPages = Math.max(1, Math.ceil(suppTotal / suppLimit));

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    try {
      const query = new URLSearchParams({ days: String(summaryDays) });
      const r = await api.get<SummaryData>(`/v2/admin/email-deliverability/summary?${query}`);
      if (r.success && r.data) setSummary(r.data);
    } finally {
      setLoadingSummary(false);
    }
  }, [summaryDays]);

  const loadPushSummary = useCallback(async () => {
    setLoadingPushSummary(true);
    try {
      const query = new URLSearchParams({ days: String(summaryDays) });
      const r = await api.get<PushSummaryData>(`/v2/admin/email-deliverability/push-summary?${query}`);
      if (r.success && r.data) setPushSummary(r.data);
    } finally {
      setLoadingPushSummary(false);
    }
  }, [summaryDays]);

  const loadLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const query = new URLSearchParams();
      if (logSearch) query.set('email', logSearch);
      if (logStatus) query.set('status', logStatus);
      if (logCategory) query.set('category', logCategory);
      if (logSince) query.set('since', logSince);
      if (logUntil) query.set('until', logUntil);
      query.set('limit', String(logLimit));
      query.set('offset', String(logOffset));
      const r = await api.get<{ rows: LogRow[]; total: number }>(`/v2/admin/email-deliverability/logs?${query}`);
      if (r.success && r.data) {
        setLogRows(r.data.rows ?? []);
        setLogTotal(r.data.total ?? 0);
      }
    } finally {
      setLoadingLogs(false);
    }
  }, [logCategory, logLimit, logOffset, logSearch, logSince, logStatus, logUntil]);

  const loadSuppressions = useCallback(async () => {
    setLoadingSupp(true);
    try {
      const query = new URLSearchParams();
      if (suppSearch) query.set('email', suppSearch);
      if (suppReason) query.set('reason', suppReason);
      query.set('limit', String(suppLimit));
      query.set('offset', String(suppOffset));
      const r = await api.get<{ rows: SuppressionRow[]; total: number }>(
        `/v2/admin/email-deliverability/suppressions?${query}`
      );
      if (r.success && r.data) {
        setSuppRows(r.data.rows ?? []);
        setSuppTotal(r.data.total ?? 0);
      }
    } finally {
      setLoadingSupp(false);
    }
  }, [suppLimit, suppOffset, suppReason, suppSearch]);

  const loadQueues = useCallback(async () => {
    setLoadingQueues(true);
    try {
      const r = await api.get<{ rows: QueueDiagnosticRow[] }>('/v2/admin/email-deliverability/queues?limit=50');
      if (r.success && r.data) {
        setQueueRows(r.data.rows ?? []);
      }
    } finally {
      setLoadingQueues(false);
    }
  }, []);

  useEffect(() => { loadSummary(); }, [loadSummary]);
  useEffect(() => { loadPushSummary(); }, [loadPushSummary]);
  useEffect(() => { loadLogs(); }, [loadLogs]);
  useEffect(() => { loadSuppressions(); }, [loadSuppressions]);
  useEffect(() => { loadQueues(); }, [loadQueues]);

  const removeSuppression = async (id: number, email: string) => {
    const ok = await confirm({
      title: t('email_deliverability.suppressions.confirm_remove', { email }),
      status: 'warning',
      confirmLabel: t('common:confirm'),
    });
    if (!ok) return;
    const r = await api.delete<{ removed: boolean }>(`/v2/admin/email-deliverability/suppressions/${id}`);
    if (r.success) {
      toast.success(t('email_deliverability.suppressions.removed', { email }));
      loadSuppressions();
    } else {
      toast.error(t('email_deliverability.suppressions.remove_failed'));
    }
  };

  const runLogSearch = () => {
    if (logPage === 1) {
      loadLogs();
      return;
    }
    setLogPage(1);
  };

  const runSuppressionSearch = () => {
    if (suppPage === 1) {
      loadSuppressions();
      return;
    }
    setSuppPage(1);
  };

  const resetLogFilters = () => {
    setLogSearch('');
    setLogStatus('');
    setLogCategory('');
    setLogSince('');
    setLogUntil('');
    setLogPage(1);
  };

  const resetSuppressionFilters = () => {
    setSuppSearch('');
    setSuppReason('');
    setSuppPage(1);
  };

  const statusLabel = (status: string) => (
    Object.prototype.hasOwnProperty.call(STATUS_COLORS, status)
      ? t(`email_deliverability.status.${status}`)
      : t('email_deliverability.status.unknown', { status })
  );

  const suppressionReasonLabel = (reason: string) => (
    KNOWN_SUPPRESSION_REASONS.has(reason)
      ? t(`email_deliverability.suppressions.reasons.${reason}`)
      : t('email_deliverability.suppressions.reasons.unknown', { reason })
  );

  const categoryLabel = (category: string | null) => (
    category
      ? t(`email_deliverability.categories.${category}`, {
          defaultValue: t('email_deliverability.categories.unknown'),
        })
      : t('email_deliverability.categories.not_available')
  );

  const statusChip = (status: string) => (
    <Chip size="sm" color={STATUS_COLORS[status] ?? 'default'} variant="soft">
      {statusLabel(status)}
    </Chip>
  );

  const summaryStatuses = useMemo(() => Object.keys(summary?.by_status ?? {}), [summary]);
  const warnings = summary?.warnings ?? [];
  const warningCounts = summary?.trigger_audit?.issues_by_severity ?? {};
  const triggerIssues = summary?.trigger_audit?.issues ?? [];

  const metricCards = [
    {
      key: 'total',
      label: t('email_deliverability.metrics.total'),
      value: summary?.total ?? 0,
      icon: Mail,
      color: 'text-theme-primary',
      detail: t('email_deliverability.metrics.window_days', { days: summaryDays }),
    },
    {
      key: 'trigger',
      label: t('email_deliverability.metrics.trigger_score'),
      value: summary?.trigger_audit ? `${summary.trigger_audit.score}/1000` : '-',
      icon: Activity,
      color: (summary?.trigger_audit?.score ?? 1000) >= 900 ? 'text-[var(--color-success)]' : 'text-[var(--color-warning)]',
      detail: summary?.trigger_audit
        ? t('email_deliverability.trigger_coverage', {
          issues: summary.trigger_audit.issue_count,
          count: summary.trigger_audit.matrix_count,
        })
        : t('email_deliverability.metrics.not_available'),
    },
    {
      key: 'accepted',
      label: t('email_deliverability.metrics.accepted'),
      value: summary?.accepted_pct !== null && summary?.accepted_pct !== undefined ? formatPercentValue(summary.accepted_pct) : '-',
      icon: CheckCircle2,
      color: 'text-[var(--color-success)]',
      detail: t('email_deliverability.metrics.unconfirmed', { count: summary?.unconfirmed_sent ?? 0 }),
    },
    {
      key: 'delivered',
      label: t('email_deliverability.metrics.delivered'),
      value: summary?.delivered_pct !== null && summary?.delivered_pct !== undefined ? formatPercentValue(summary.delivered_pct) : '-',
      icon: Clock3,
      color: 'text-[var(--color-success)]',
      detail: t('email_deliverability.metrics.webhook_confirmed'),
    },
    {
      key: 'bounced',
      label: t('email_deliverability.metrics.bounced'),
      value: summary?.bounced_pct !== null && summary?.bounced_pct !== undefined ? formatPercentValue(summary.bounced_pct) : '-',
      icon: ShieldAlert,
      color: 'text-[var(--color-error)]',
      detail: t('email_deliverability.metrics.bad_outcomes', {
        count: (summary?.by_status.failed ?? 0) + (summary?.by_status.bounced ?? 0) + (summary?.by_status.suppressed ?? 0),
      }),
    },
  ];

  return (
    <div className="space-y-6 p-4">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Mail aria-hidden="true" className="h-7 w-7 text-theme-primary" />
            <div>
              <h1 className="text-2xl font-bold text-theme-primary">{t('email_deliverability.title')}</h1>
              <p className="text-sm text-theme-secondary">{t('email_deliverability.subtitle')}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            size="sm"
            className="w-36"
            aria-label={t('email_deliverability.filters.window')}
            selectedKeys={[String(summaryDays)]}
            onSelectionChange={(keys) => {
              const v = Array.from(keys)[0];
              if (v) setSummaryDays(Number(v));
            }}
          >
            <SelectItem key="1" id="1">{t('email_deliverability.windows.1')}</SelectItem>
            <SelectItem key="7" id="7">{t('email_deliverability.windows.7')}</SelectItem>
            <SelectItem key="30" id="30">{t('email_deliverability.windows.30')}</SelectItem>
            <SelectItem key="90" id="90">{t('email_deliverability.windows.90')}</SelectItem>
          </Select>
          <Tooltip content={t('email_deliverability.actions.refresh')}>
            <Button size="sm" variant="tertiary" onPress={loadSummary} isIconOnly aria-label={t('email_deliverability.actions.refresh')}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </Tooltip>
        </div>
      </section>

      {warnings.length > 0 && (
        <section className="space-y-2">
          {warnings.map((warning, index) => (
            <Alert
              key={`${warning.code}-${warning.severity}-${index}`}
              color={warning.severity === 'critical' ? 'danger' : warning.severity === 'warning' ? 'warning' : 'primary'}
              variant="tertiary"
              startContent={<AlertTriangle aria-hidden="true" className="h-4 w-4" />}
              title={t([
                `email_deliverability.warnings.${warning.code}.title`,
                'email_deliverability.warnings.default_title',
              ])}
              description={t([
                `email_deliverability.warnings.${warning.code}.body`,
                'email_deliverability.warnings.default_body',
              ], warning.params ?? {})}
            />
          ))}
        </section>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        {metricCards.map((metric) => {
          const Icon = metric.icon;
          return (
            <Card key={metric.key} className="border border-[var(--color-border)]">
              <CardBody className="gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold uppercase text-theme-subtle">{metric.label}</div>
                  <Icon aria-hidden="true" className={`h-4 w-4 ${metric.color}`} />
                </div>
                <div className={`text-2xl font-bold ${metric.color}`}>{loadingSummary ? <span role="status" aria-busy="true" aria-label={t('common.loading')} className="inline-flex"><Spinner size="sm" /></span>: metric.value}</div>
                <div className="text-xs text-theme-secondary">{metric.detail}</div>
              </CardBody>
            </Card>
          );
        })}
      </section>

      <Card className="border border-[var(--color-border)]">
        <CardHeader className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">{t('email_deliverability.push.title')}</h2>
            <p className="text-sm text-theme-secondary">{t('email_deliverability.push.subtitle')}</p>
          </div>
          <Button size="sm" variant="tertiary" onPress={loadPushSummary} isIconOnly aria-label={t('email_deliverability.actions.refresh')}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
          </Button>
        </CardHeader>
        <Separator />
        <CardBody className="gap-4">
          {pushSummary && !pushSummary.available ? (
            <Alert variant="secondary">{t('email_deliverability.push.unavailable')}</Alert>
          ) : (
            <>
              {(pushSummary?.fcm_sent ?? 0) > 0 ? (
                <Alert variant="secondary">
                  {t('email_deliverability.metrics.unconfirmed', { count: pushSummary?.fcm_sent ?? 0 })}
                </Alert>
              ) : null}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                {[
                  { key: 'total', label: t('email_deliverability.push.total'), value: pushSummary?.total ?? 0, color: 'text-theme-primary' },
                  { key: 'accepted', label: t('email_deliverability.metrics.accepted'), value: pushSummary?.delivered ?? 0, color: 'text-[var(--color-success)]' },
                  { key: 'partial', label: t('email_deliverability.push.partial'), value: pushSummary?.partial ?? 0, color: 'text-[var(--color-warning)]' },
                  { key: 'failed', label: t('email_deliverability.push.failed'), value: pushSummary?.failed ?? 0, color: 'text-[var(--color-error)]' },
                  { key: 'fcm', label: t('email_deliverability.push.fcm'), value: `${pushSummary?.fcm_sent ?? 0}/${pushSummary?.fcm_failed ?? 0}`, color: 'text-theme-primary' },
                  { key: 'web', label: t('email_deliverability.push.web'), value: pushSummary?.web_delivered ?? 0, color: 'text-theme-primary' },
                ].map((tile) => (
                  <div key={tile.key} className="rounded-md border border-[var(--color-border)] p-3">
                    <div className="text-xs font-semibold uppercase text-theme-subtle">{tile.label}</div>
                    <div className={`mt-1 text-xl font-semibold ${tile.color}`}>
                      {loadingPushSummary ? <span role="status" aria-busy="true" aria-label={t('common.loading')} className="inline-flex"><Spinner size="sm" /></span> : tile.value}
                    </div>
                  </div>
                ))}
              </div>
              {(pushSummary?.recent_failures?.length ?? 0) > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-theme-subtle">{t('email_deliverability.push.recent_failures')}</div>
                  <div className="flex flex-col gap-2">
                    {pushSummary!.recent_failures.slice(0, 8).map((f) => (
                      <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] p-2 text-sm">
                        <div className="flex min-w-0 items-center gap-2">
                          <Chip size="sm" color={f.status === 'failed' ? 'danger' : 'warning'} variant="soft">
                            {t(`admin_advanced:email_deliverability.status.${f.status}`, {
                              defaultValue: t('admin_advanced:email_deliverability.status.unknown', { status: f.status }),
                            })}
                          </Chip>
                          <span className="truncate text-theme-secondary">{f.activity_type}{f.user_id ? ` · #${f.user_id}` : ''}</span>
                        </div>
                        {f.error ? <span className="max-w-[45%] truncate text-xs text-theme-subtle" title={f.error}>{f.error}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <Card className="border border-[var(--color-border)]">
        <CardHeader className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">{t('email_deliverability.status_breakdown.title')}</h2>
            <p className="text-sm text-theme-secondary">{t('email_deliverability.status_breakdown.subtitle')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {summaryStatuses.length > 0 ? summaryStatuses.map((status) => (
              <Chip key={status} size="sm" color={STATUS_COLORS[status] ?? 'default'} variant="soft">
                {statusLabel(status)}: {summary?.by_status[status]}
              </Chip>
            )) : (
              <Chip size="sm" variant="soft">{t('email_deliverability.empty.no_statuses')}</Chip>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-md border border-[var(--color-border)] p-3">
              <div className="text-xs font-semibold uppercase text-theme-subtle">{t('email_deliverability.trigger_health.critical')}</div>
              <div className="mt-1 text-xl font-semibold text-[var(--color-error)]">{warningCounts.critical ?? 0}</div>
            </div>
            <div className="rounded-md border border-[var(--color-border)] p-3">
              <div className="text-xs font-semibold uppercase text-theme-subtle">{t('email_deliverability.trigger_health.warning')}</div>
              <div className="mt-1 text-xl font-semibold text-[var(--color-warning)]">{warningCounts.warning ?? 0}</div>
            </div>
            <div className="rounded-md border border-[var(--color-border)] p-3">
              <div className="text-xs font-semibold uppercase text-theme-subtle">{t('email_deliverability.trigger_health.monitored')}</div>
              <div className="mt-1 text-xl font-semibold text-theme-primary">{summary?.trigger_audit?.matrix_count ?? '-'}</div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="border border-[var(--color-border)]">
        <CardHeader className="flex flex-col items-start gap-1">
          <h2 className="text-lg font-semibold text-theme-primary">{t('email_deliverability.trigger_issues.title')}</h2>
          <p className="text-sm text-theme-secondary">{t('email_deliverability.trigger_issues.subtitle')}</p>
        </CardHeader>
        <Separator />
        <CardBody>
          <Table aria-label={t('email_deliverability.trigger_issues.table_label')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('email_deliverability.trigger_issues.columns.severity')}</TableColumn>
              <TableColumn>{t('email_deliverability.trigger_issues.columns.module')}</TableColumn>
              <TableColumn>{t('email_deliverability.trigger_issues.columns.event')}</TableColumn>
              <TableColumn>{t('email_deliverability.trigger_issues.columns.issue')}</TableColumn>
              <TableColumn>{t('email_deliverability.trigger_issues.columns.tenant')}</TableColumn>
              <TableColumn>{t('email_deliverability.trigger_issues.columns.params')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('email_deliverability.trigger_issues.empty')}>
              {triggerIssues.map((issue, index) => (
                <TableRow key={`${issue.code}-${issue.tenant_id ?? 'all'}-${index}`}>
                  <TableCell>
                    <Chip size="sm" color={SEVERITY_COLORS[issue.severity] ?? 'default'} variant="soft">
                      {t(`email_deliverability.severity.${issue.severity}`)}
                    </Chip>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{issue.module}</TableCell>
                  <TableCell className="font-mono text-xs">{issue.event}</TableCell>
                  <TableCell>
                    <div className="max-w-sm">
                      <div className="font-medium text-theme-primary">
                        {t([
                          `email_deliverability.warnings.${issue.code}.title`,
                          'email_deliverability.warnings.default_title',
                        ])}
                      </div>
                      <div className="text-xs text-theme-secondary">
                        {t([
                          `email_deliverability.warnings.${issue.code}.body`,
                          'email_deliverability.warnings.default_body',
                        ], issue.params ?? {})}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">{issue.tenant_id ?? t('email_deliverability.trigger_issues.all_tenants')}</TableCell>
                  <TableCell className="max-w-xs truncate font-mono text-xs">
                    {issue.params && Object.keys(issue.params).length > 0 ? JSON.stringify(issue.params) : '-'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Card className="border border-[var(--color-border)]">
        <CardHeader className="flex flex-col items-start gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">{t('email_deliverability.queues.title')}</h2>
            <p className="text-sm text-theme-secondary">{t('email_deliverability.queues.subtitle')}</p>
          </div>
          <Tooltip content={t('email_deliverability.actions.refresh')}>
            <Button size="sm" variant="tertiary" onPress={loadQueues} isIconOnly aria-label={t('email_deliverability.actions.refresh')}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </Tooltip>
        </CardHeader>
        <Separator />
        <CardBody>
          {loadingQueues ? <span role="status" aria-busy="true" aria-label={t('common.loading')} className="inline-flex"><Spinner /></span>: (
            <Table aria-label={t('email_deliverability.queues.table_label')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('email_deliverability.queues.columns.source')}</TableColumn>
                <TableColumn>{t('email_deliverability.queues.columns.recipient')}</TableColumn>
                <TableColumn>{t('email_deliverability.queues.columns.category')}</TableColumn>
                <TableColumn>{t('email_deliverability.queues.columns.status')}</TableColumn>
                <TableColumn>{t('email_deliverability.queues.columns.attempts')}</TableColumn>
                <TableColumn>{t('email_deliverability.queues.columns.last_attempt')}</TableColumn>
                <TableColumn>{t('email_deliverability.queues.columns.error')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('email_deliverability.queues.empty')}>
                {queueRows.map((row) => (
                  <TableRow key={`${row.source}-${row.id}`}>
                    <TableCell>
                      <Chip size="sm" variant="soft">
                        {t(`email_deliverability.queues.sources.${row.source}`)}
                      </Chip>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{row.email ?? '-'}</TableCell>
                    <TableCell>
                      <div className="max-w-xs">
                        <div className="text-xs">{categoryLabel(row.category)}</div>
                        <div className="truncate text-xs text-theme-secondary">{row.subject ?? ''}</div>
                      </div>
                    </TableCell>
                    <TableCell>{statusChip(row.status)}</TableCell>
                    <TableCell className="text-xs">{row.attempts}</TableCell>
                    <TableCell className="text-xs">{row.last_attempted_at ?? row.processing_started_at ?? row.created_at ?? '-'}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-[var(--color-error)]">{row.error ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card className="border border-[var(--color-border)]">
        <CardHeader className="flex flex-col items-start gap-3">
          <div className="flex w-full flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">{t('email_deliverability.logs.title')}</h2>
              <p className="text-sm text-theme-secondary">{t('email_deliverability.logs.subtitle')}</p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2 xl:w-auto xl:grid-cols-6">
              <Input
                size="sm"
                startContent={<Search aria-hidden="true" className="h-4 w-4 text-theme-subtle" />}
                label={t('email_deliverability.filters.recipient')}
                value={logSearch}
                onValueChange={setLogSearch}
              />
              <Input
                size="sm"
                label={t('email_deliverability.filters.category')}
                value={logCategory}
                onValueChange={setLogCategory}
              />
              <Select
                size="sm"
                label={t('email_deliverability.filters.status')}
                selectedKeys={logStatus ? [logStatus] : ['']}
                onSelectionChange={(keys) => setLogStatus((Array.from(keys)[0] as string) ?? '')}
              >
                {LOG_STATUSES.map((status) => (
                  <SelectItem key={status} id={status}>{status ? t(`email_deliverability.status.${status}`) : t('email_deliverability.filters.all')}</SelectItem>
                ))}
              </Select>
              <Input size="sm" type="date" label={t('email_deliverability.filters.since')} value={logSince} onValueChange={setLogSince} />
              <Input size="sm" type="date" label={t('email_deliverability.filters.until')} value={logUntil} onValueChange={setLogUntil} />
              <div className="flex items-end gap-2">
                <Button size="sm" onPress={runLogSearch}>{t('email_deliverability.actions.search')}</Button>
                <Button size="sm" variant="tertiary" onPress={resetLogFilters}>{t('email_deliverability.actions.reset')}</Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardBody className="gap-4">
          {loadingLogs ? <span role="status" aria-busy="true" aria-label={t('common.loading')} className="inline-flex"><Spinner /></span>: (
            <Table aria-label={t('email_deliverability.logs.table_label')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('email_deliverability.logs.columns.recipient')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.category')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.subject')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.status')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.provider')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.sent')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.delivered')}</TableColumn>
                <TableColumn>{t('email_deliverability.logs.columns.error')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('email_deliverability.logs.empty')}>
                {logRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.recipient_email}</TableCell>
                    <TableCell><Chip size="sm" variant="soft">{categoryLabel(row.category)}</Chip></TableCell>
                    <TableCell className="max-w-xs truncate">{row.subject ?? '-'}</TableCell>
                    <TableCell>{statusChip(row.status)}</TableCell>
                    <TableCell className="text-xs">{row.provider ?? '-'}</TableCell>
                    <TableCell className="text-xs">{row.sent_at ?? row.created_at ?? '-'}</TableCell>
                    <TableCell className="text-xs">{row.delivered_at ?? '-'}</TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-[var(--color-error)]">{row.error ?? ''}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-theme-secondary">
              {t('email_deliverability.pagination.summary', {
                from: logTotal === 0 ? 0 : logOffset + 1,
                to: Math.min(logOffset + logLimit, logTotal),
                total: logTotal,
              })}
            </div>
            <div className="flex items-center gap-3">
              <Select
                size="sm"
                className="w-28"
                aria-label={t('email_deliverability.pagination.page_size')}
                selectedKeys={[String(logLimit)]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0];
                  if (value) {
                    setLogLimit(Number(value));
                    setLogPage(1);
                  }
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={String(size)} id={String(size)}>{String(size)}</SelectItem>)}
              </Select>
              <Pagination total={logPages} page={logPage} onChange={setLogPage} showControls />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="border border-[var(--color-border)]">
        <CardHeader className="flex flex-col items-start gap-3">
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">{t('email_deliverability.suppressions.title')}</h2>
              <p className="text-sm text-theme-secondary">{t('email_deliverability.suppressions.subtitle')}</p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 md:grid-cols-2 lg:w-auto lg:grid-cols-4">
              <Input
                size="sm"
                startContent={<Search aria-hidden="true" className="h-4 w-4 text-theme-subtle" />}
                label={t('email_deliverability.filters.email')}
                value={suppSearch}
                onValueChange={setSuppSearch}
              />
              <Select
                size="sm"
                label={t('email_deliverability.filters.reason')}
                selectedKeys={suppReason ? [suppReason] : ['']}
                onSelectionChange={(keys) => setSuppReason((Array.from(keys)[0] as string) ?? '')}
              >
                {SUPPRESSION_REASONS.map((reason) => (
                  <SelectItem key={reason} id={reason}>{reason ? t(`email_deliverability.suppressions.reasons.${reason}`) : t('email_deliverability.filters.all')}</SelectItem>
                ))}
              </Select>
              <Button size="sm" onPress={runSuppressionSearch}>{t('email_deliverability.actions.search')}</Button>
              <Button size="sm" variant="tertiary" onPress={resetSuppressionFilters}>{t('email_deliverability.actions.reset')}</Button>
            </div>
          </div>
        </CardHeader>
        <CardBody className="gap-4">
          {loadingSupp ? <span role="status" aria-busy="true" aria-label={t('common.loading')} className="inline-flex"><Spinner /></span>: (
            <Table aria-label={t('email_deliverability.suppressions.table_label')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('email_deliverability.suppressions.columns.email')}</TableColumn>
                <TableColumn>{t('email_deliverability.suppressions.columns.reason')}</TableColumn>
                <TableColumn>{t('email_deliverability.suppressions.columns.detail')}</TableColumn>
                <TableColumn>{t('email_deliverability.suppressions.columns.suppressed_at')}</TableColumn>
                <TableColumn>{t('email_deliverability.suppressions.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('email_deliverability.suppressions.empty')}>
                {suppRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.email}</TableCell>
                    <TableCell>
                      <Chip size="sm" variant="soft">{suppressionReasonLabel(row.reason)}</Chip>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{row.detail ?? '-'}</TableCell>
                    <TableCell className="text-xs">{row.suppressed_at}</TableCell>
                    <TableCell>
                      <Tooltip content={t('email_deliverability.suppressions.remove')}>
                        <Button
                          size="sm"
                          variant="danger"
                          isIconOnly
                          aria-label={t('email_deliverability.suppressions.remove')}
                          onPress={() => removeSuppression(row.id, row.email)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="text-sm text-theme-secondary">
              {t('email_deliverability.pagination.summary', {
                from: suppTotal === 0 ? 0 : suppOffset + 1,
                to: Math.min(suppOffset + suppLimit, suppTotal),
                total: suppTotal,
              })}
            </div>
            <div className="flex items-center gap-3">
              <Select
                size="sm"
                className="w-28"
                aria-label={t('email_deliverability.pagination.page_size')}
                selectedKeys={[String(suppLimit)]}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys)[0];
                  if (value) {
                    setSuppLimit(Number(value));
                    setSuppPage(1);
                  }
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => <SelectItem key={String(size)} id={String(size)}>{String(size)}</SelectItem>)}
              </Select>
              <Pagination total={suppPages} page={suppPage} onChange={setSuppPage} showControls />
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
