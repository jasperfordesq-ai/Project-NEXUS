// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Command Center
 *
 * The flagship broker page: a "what needs you now" triage hero ranking the
 * open review queues by severity, a deep-linked KPI grid, a quick-action
 * launcher, and the broker activity timeline. Every tile drills into the
 * relevant management page with the filter already applied.
 *
 * Parity: PHP BrokerControlsController::dashboard()
 */

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, Button, Chip } from '@/components/ui';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ShieldCheck from 'lucide-react/icons/shield-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Activity from 'lucide-react/icons/activity';
import Settings from 'lucide-react/icons/settings';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Zap from 'lucide-react/icons/zap';
import UserCheck from 'lucide-react/icons/user-check';
import type { LucideIcon } from 'lucide-react';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminBroker } from '@/admin/api/adminApi';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerSkeleton,
  BrokerEmptyState,
  useCountUp,
  type BrokerStatColor,
} from '../components';
import type { BrokerDashboardStats, BrokerActivityEntry } from '@/admin/api/types';
import { parseServerTimestamp } from '@/lib/serverTime';
import { BrokerControlsHelp } from './BrokerHelpPage';

// ─────────────────────────────────────────────────────────────────────────────
// Triage queues — severity-weighted so the hero always surfaces the most
// urgent work first. Labels reuse the stat-card keys; paths carry the filter.
// ─────────────────────────────────────────────────────────────────────────────

interface QueueDef {
  key: keyof BrokerDashboardStats;
  labelKey: string;
  icon: LucideIcon;
  color: BrokerStatColor;
  path: string;
  /** Higher = more urgent; ties broken by count. */
  weight: number;
}

const QUEUES: QueueDef[] = [
  { key: 'safeguarding_alerts', labelKey: 'dashboard.safeguarding_alerts', icon: AlertTriangle, color: 'danger', path: '/broker/safeguarding?filter=critical', weight: 6 },
  { key: 'high_risk_listings', labelKey: 'dashboard.high_risk_listings', icon: ShieldAlert, color: 'danger', path: '/broker/risk-tags?level=high', weight: 5 },
  { key: 'unreviewed_messages', labelKey: 'dashboard.unreviewed_messages', icon: MessageSquareWarning, color: 'warning', path: '/broker/messages?status=unreviewed', weight: 4 },
  { key: 'pending_exchanges', labelKey: 'dashboard.pending_exchanges', icon: ArrowLeftRight, color: 'accent', path: '/broker/exchanges?status=pending_broker', weight: 4 },
  { key: 'onboarding_safeguarding_flags', labelKey: 'dashboard.safeguarding_flags', icon: ShieldAlert, color: 'warning', path: '/broker/safeguarding?tab=preferences', weight: 3 },
  { key: 'vetting_review_requests', labelKey: 'dashboard.vetting_review_requests', icon: ShieldCheck, color: 'warning', path: '/broker/vetting?status=review_requested', weight: 3 },
];

const queuePillClass: Record<BrokerStatColor, string> = {
  danger: 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15',
  warning: 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15',
  success: 'border-success/30 bg-success/10 text-success hover:bg-success/15',
  accent: 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/15',
  neutral: 'border-divider bg-surface-secondary text-muted hover:bg-surface-tertiary',
};

// Quick-link metadata. Title + description are translated at render time
// using the broker.dashboard.links.* namespace. Path/icon/color are
// presentation-only and stay defined here.
const QUICK_LINKS = [
  { key: 'exchanges',       icon: ArrowLeftRight,       color: 'accent'  as const, path: '/broker/exchanges',       feature: 'exchange_workflow' as const },
  { key: 'match_approvals', icon: UserCheck,            color: 'accent'  as const, path: '/broker/match-approvals', feature: 'exchange_workflow' as const },
  { key: 'risk_tags',       icon: ShieldAlert,          color: 'danger'  as const, path: '/broker/risk-tags' },
  { key: 'messages',        icon: MessageSquareWarning, color: 'warning' as const, path: '/broker/messages' },
  { key: 'monitoring',      icon: Eye,                  color: 'warning' as const, path: '/broker/monitoring' },
  { key: 'vetting',         icon: ShieldCheck,          color: 'success' as const, path: '/broker/vetting' },
  { key: 'configuration',   icon: Settings,             color: 'neutral' as const, path: '/broker/configuration' },
];

// Tailwind JIT needs full class names at build time — dynamic `bg-${color}/10` won't work
const tileBgClass: Record<BrokerStatColor, string> = {
  accent: 'bg-accent/10 text-accent',
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  neutral: 'bg-surface-secondary text-muted',
};

function HeroTotal({ value }: { value: number }) {
  const display = useCountUp(value);
  return <>{display.toLocaleString(getFormattingLocale())}</>;
}

export function BrokerDashboard() {
  const { t } = useTranslation('broker');
  usePageTitle(t('dashboard.title'));
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();

  const [stats, setStats] = useState<BrokerDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Stash the latest `t` and `toast` in refs so loadDashboard's identity
  // doesn't churn on every language switch (which would otherwise refetch
  // the entire dashboard for no reason — only labels translate, not numbers).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getDashboard();
      if (res.success && res.data) {
        setStats(res.data);
      } else {
        setLoadError(true);
        toastRef.current.error(tRef.current('dashboard.load_failed'));
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('dashboard.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const showExchanges = hasFeature('exchange_workflow');

  // Rank the non-empty queues: severity first, then volume. `_partial` loads
  // can leave some counters null — those are excluded rather than treated as 0
  // so a failed query never silently reads as "all clear".
  const activeQueues = QUEUES
    .filter((q) => (showExchanges || q.key !== 'pending_exchanges'))
    .map((q) => ({ ...q, count: stats ? Number(stats[q.key] ?? 0) : 0 }))
    .filter((q) => Number.isFinite(q.count) && q.count > 0)
    .sort((a, b) => b.weight - a.weight || b.count - a.count);

  const totalOpen = activeQueues.reduce((sum, q) => sum + q.count, 0);
  const hasDanger = activeQueues.some((q) => q.color === 'danger');

  const quickLinks = QUICK_LINKS.filter((l) => !l.feature || hasFeature(l.feature));

  return (
    <BrokerPageShell
      title={t('dashboard.title')}
      description={t('dashboard.description')}
      icon={LayoutDashboard}
      color="accent"
      actions={
        <Button
          variant="tertiary"
          startContent={<RefreshCw size={16} />}
          onPress={loadDashboard}
          isLoading={loading}
          size="sm"
        >
          {t('dashboard.refresh')}
        </Button>
      }
    >
      {/* Partial-load banner — surfaces when the controller's per-query
          try/catch swallowed at least one error. Hiding this would mask
          a DB hiccup as a clean dashboard, exactly the wrong direction
          for a risk-surfacing UI. */}
      {stats?._partial && (
        <Card className="mb-4 rounded-2xl border border-warning/30 bg-warning/10">
          <CardBody className="flex flex-row items-start gap-3 py-3">
            <AlertCircle size={20} className="text-warning shrink-0 mt-0.5" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-warning">{t('dashboard.partial_title')}</p>
              <p className="text-muted">{t('dashboard.partial_body')}</p>
            </div>
            <Button size="sm" variant="tertiary" onPress={loadDashboard}>
              {t('dashboard.refresh')}
            </Button>
          </CardBody>
        </Card>
      )}

      {loading && !stats ? (
        <div className="space-y-6">
          <BrokerSkeleton variant="cards" count={1} />
          <BrokerSkeleton variant="stats" count={8} />
        </div>
      ) : loadError && !stats ? (
        // Distinct error state — a load failure must never render as a
        // friendly "all clear" hero, which would lie about what happened.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('dashboard.load_error_title')}
          hint={t('dashboard.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={loadDashboard}>
              {t('dashboard.refresh')}
            </Button>
          }
        />
      ) : (
        <>
          {/* ── "What needs you now" triage hero ─────────────────────────── */}
          <Card
            className={`mb-6 rounded-2xl border shadow-sm shadow-black/[0.03] ${
              totalOpen === 0
                ? 'border-success/30 bg-gradient-to-br from-success/10 via-surface to-surface'
                : hasDanger
                  ? 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface'
                  : 'border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface'
            }`}
          >
            <CardBody className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
              {totalOpen === 0 ? (
                <div className="flex items-center gap-4">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/15 text-success ring-1 ring-inset ring-success/20">
                    <CheckCircle2 size={26} />
                  </span>
                  <div>
                    <p className="text-xl font-semibold tracking-tight text-foreground">
                      {t('dashboard.all_clear')}
                    </p>
                    <p className="text-sm text-muted">{t('dashboard.all_clear_hint')}</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-4">
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-current/20 ${
                        hasDanger ? 'bg-danger/15 text-danger' : 'bg-accent/15 text-accent'
                      }`}
                    >
                      <Zap size={26} />
                    </span>
                    <div>
                      <p className="text-xl font-semibold tracking-tight text-foreground">
                        {t('dashboard.needs_attention')}
                      </p>
                      <p className="text-sm text-muted">
                        <span className="font-semibold tabular-nums text-foreground">
                          <HeroTotal value={totalOpen} />
                        </span>{' '}
                        {t('dashboard.open_items', { count: totalOpen })}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {activeQueues.slice(0, 4).map((q) => {
                      const QIcon = q.icon;
                      return (
                        <Link
                          key={q.key}
                          to={tenantPath(q.path)}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none ${queuePillClass[q.color]}`}
                        >
                          <QIcon size={15} aria-hidden="true" />
                          <span className="text-foreground">{t(q.labelKey)}</span>
                          <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular-nums">
                            {q.count}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                </>
              )}
            </CardBody>
          </Card>

          {/* ── KPI grid — each tile deep-links with the filter applied ──── */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {showExchanges && (
              <BrokerStatCard
                label={t('dashboard.pending_exchanges')}
                value={stats?.pending_exchanges ?? null}
                icon={ArrowLeftRight}
                color="accent"
                loading={loading}
                to={tenantPath('/broker/exchanges?status=pending_broker')}
              />
            )}
            <BrokerStatCard
              label={t('dashboard.unreviewed_messages')}
              value={stats?.unreviewed_messages ?? null}
              icon={MessageSquareWarning}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/messages?status=unreviewed')}
            />
            <BrokerStatCard
              label={t('dashboard.high_risk_listings')}
              value={stats?.high_risk_listings ?? null}
              icon={ShieldAlert}
              color="danger"
              loading={loading}
              to={tenantPath('/broker/risk-tags?level=high')}
            />
            <BrokerStatCard
              label={t('dashboard.monitored_users')}
              value={stats?.monitored_users ?? null}
              icon={Eye}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/monitoring')}
            />
            <BrokerStatCard
              label={t('dashboard.vetting_review_requests')}
              value={stats?.vetting_review_requests ?? null}
              icon={ShieldCheck}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/vetting?status=review_requested')}
            />
            <BrokerStatCard
              label={t('dashboard.safeguarding_alerts')}
              value={stats?.safeguarding_alerts ?? null}
              icon={AlertTriangle}
              color="danger"
              loading={loading}
              to={tenantPath('/broker/safeguarding?filter=critical')}
            />
            <BrokerStatCard
              label={t('dashboard.safeguarding_flags')}
              value={stats?.onboarding_safeguarding_flags ?? null}
              icon={ShieldAlert}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/safeguarding?tab=preferences')}
            />
          </div>

          {/* ── Quick-action launcher ────────────────────────────────────── */}
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
            {t('dashboard.quick_access')}
          </h2>
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Card
                  key={link.path}
                  isPressable
                  as={Link}
                  to={tenantPath(link.path)}
                  className="group rounded-2xl border border-divider/70 bg-surface text-left shadow-sm shadow-black/[0.03] transition-all hover:-translate-y-0.5 hover:border-divider hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <CardBody className="flex flex-row items-center gap-4 p-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${tileBgClass[link.color]}`}
                    >
                      <Icon size={22} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">
                        {t(`dashboard.links.${link.key}_title`)}
                      </p>
                      <p className="line-clamp-2 text-sm text-muted">
                        {t(`dashboard.links.${link.key}_desc`)}
                      </p>
                    </div>
                    <ChevronRight
                      size={18}
                      className="shrink-0 text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted motion-reduce:transition-none"
                      aria-hidden="true"
                    />
                  </CardBody>
                </Card>
              );
            })}
          </div>

          {/* ── Activity timeline ────────────────────────────────────────── */}
          <h2 className="mb-4 text-lg font-semibold tracking-tight text-foreground">
            {t('dashboard.recent_activity')}
          </h2>
          {stats?.recent_activity && stats.recent_activity.length > 0 ? (
            <Card className="rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
              <CardBody className="p-0">
                <div className="flex items-center gap-2 border-b border-divider px-4 py-3">
                  <Activity size={16} className="text-muted" aria-hidden="true" />
                  <span className="text-sm font-semibold text-foreground">
                    {t('dashboard.broker_actions_heading')}
                  </span>
                </div>
                <ul className="px-4 py-2">
                  {stats.recent_activity.map((entry: BrokerActivityEntry, idx) => {
                    // Composite key: ids collide between activity_log and
                    // org_audit_log, so the source tag from the controller is
                    // load-bearing here. Falling back to action_type+id keeps
                    // older API responses (pre-source) from breaking.
                    const rowKey = `${entry.source ?? entry.action_type}-${entry.id}`;
                    const fullName = resolveUserDisplayName(entry);
                    const actorName = fullName || t('dashboard.deleted_user');
                    const isLast = idx === (stats.recent_activity?.length ?? 0) - 1;
                    const dotColor = actionChipColorMap[entry.action_type] ?? 'default';
                    return (
                      <li key={rowKey} className="relative flex gap-3 pb-0">
                        {/* timeline rail */}
                        <div className="flex flex-col items-center">
                          <span
                            aria-hidden="true"
                            className={`mt-4 h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-surface ${timelineDotClass[dotColor]}`}
                          />
                          {!isLast && <span aria-hidden="true" className="w-px flex-1 bg-divider" />}
                        </div>
                        <div className="flex min-w-0 flex-1 items-center gap-3 py-3">
                          <ActivityChip actionType={entry.action_type} />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm text-foreground">
                              <span className="font-medium">{actorName}</span>{' '}
                              {formatActionLabel(entry.action_type, t)}
                            </p>
                            {entry.details && (
                              <p className="truncate text-xs text-muted">{entry.details}</p>
                            )}
                          </div>
                          <span className="shrink-0 text-xs tabular-nums text-muted">
                            {formatTimeAgo(entry.created_at, t)}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ) : (
            <BrokerEmptyState
              icon={Activity}
              title={t('dashboard.no_recent_activity')}
              hint={t('dashboard.no_recent_activity_hint')}
            />
          )}

          {/* Collapsible guidance panel — title visible, body tucked into accordion sections */}
          <BrokerControlsHelp />
        </>
      )}
    </BrokerPageShell>
  );
}

type ChipColor = 'success' | 'danger' | 'accent' | 'warning' | 'default';

const timelineDotClass: Record<ChipColor, string> = {
  success: 'bg-success',
  danger: 'bg-danger',
  accent: 'bg-accent',
  warning: 'bg-warning',
  default: 'bg-muted/60',
};

// Action keys MUST match the action strings emitted by the backend dashboard
// query in AdminBrokerController::dashboard (UNION of activity_log +
// org_audit_log). Any mismatch causes the row to render with a default-grey
// chip and a readable snake_case fallback label.
const actionChipColorMap: Record<string, ChipColor> = {
  // org_audit_log entries (broker controller writes via AuditLogService::log)
  exchange_approved: 'success',
  exchange_rejected: 'danger',
  match_approved: 'success',
  match_rejected: 'danger',
  broker_message_reviewed: 'accent',
  broker_message_approved: 'success',
  broker_message_flagged: 'warning',
  listing_risk_tag_created: 'warning',
  listing_risk_tag_updated: 'warning',
  listing_risk_tag_removed: 'default',
  user_monitoring_added: 'default',
  user_monitoring_removed: 'default',
  broker_config_updated: 'accent',
  // activity_log entries (insurance controller writes via ActivityLog::log)
  insurance_cert_created: 'accent',
  insurance_cert_updated: 'accent',
  insurance_cert_verified: 'success',
  insurance_cert_rejected: 'danger',
  insurance_cert_deleted: 'default',
};

// Action keys → broker.json sub-key suffix. The full path is
// `dashboard.activity.chip_${suffix}` and `dashboard.activity.verb_${suffix}`.
// Mapping is needed because the backend emits keys like
// 'broker_message_reviewed' but i18n keys are kept short ('message_reviewed').
const actionI18nKeySuffix: Record<string, string> = {
  exchange_approved: 'exchange_approved',
  exchange_rejected: 'exchange_rejected',
  match_approved: 'match_approved',
  match_rejected: 'match_rejected',
  broker_message_reviewed: 'message_reviewed',
  broker_message_approved: 'message_approved',
  broker_message_flagged: 'message_flagged',
  listing_risk_tag_created: 'risk_tag_created',
  listing_risk_tag_updated: 'risk_tag_updated',
  listing_risk_tag_removed: 'risk_tag_removed',
  user_monitoring_added: 'monitoring_added',
  user_monitoring_removed: 'monitoring_removed',
  broker_config_updated: 'config_updated',
  insurance_cert_created: 'insurance_created',
  insurance_cert_updated: 'insurance_updated',
  insurance_cert_verified: 'insurance_verified',
  insurance_cert_rejected: 'insurance_rejected',
  insurance_cert_deleted: 'insurance_deleted',
};

function ActivityChip({ actionType }: { actionType: string }) {
  const { t } = useTranslation('broker');
  const color: ChipColor = actionChipColorMap[actionType] ?? 'default';
  const suffix = actionI18nKeySuffix[actionType];
  const label = suffix
    ? t(`dashboard.activity.chip_${suffix}`)
    : actionType.replace(/_/g, ' ');
  return (
    <Chip size="sm" variant="tertiary" color={color} className="shrink-0">
      {label}
    </Chip>
  );
}

type TFunc = (key: string, options?: Record<string, unknown>) => string;

function formatActionLabel(actionType: string, t: TFunc): string {
  const suffix = actionI18nKeySuffix[actionType];
  return suffix
    ? t(`dashboard.activity.verb_${suffix}`)
    : actionType.replace(/_/g, ' ');
}

function formatTimeAgo(dateStr: string, t: TFunc): string {
  const date = parseServerTimestamp(dateStr);
  if (!date) return '';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  // Clock skew between server and client can produce a negative diff.
  // Clamp to 0 so the user doesn't see "in the future" labels on rows
  // that just happened.
  const diffMins = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMins < 1) return t('dashboard.time_just_now');
  if (diffMins < 60) return t('dashboard.time_minutes_ago', { count: diffMins });
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return t('dashboard.time_hours_ago', { count: diffHrs });
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return t('dashboard.time_days_ago', { count: diffDays });
  return date.toLocaleDateString(getFormattingLocale());
}

export default BrokerDashboard;
