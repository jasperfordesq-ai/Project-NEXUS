// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Command Center
 *
 * The flagship broker page, top to bottom:
 *   1. "What needs you now" — the open review queues ranked by severity.
 *   2. A compact warning when the community has no safeguarding jurisdiction.
 *   3. Quick links — one row of small buttons (the sidebar has the same pages).
 *   4. "Waiting for you" (the first items of each queue, with quick decisions)
 *      beside "My week" (what this broker decided in the last 7 days).
 *   5. The KPI grid — every tile deep-links with its filter applied, says how
 *      long its oldest item has waited, and shows a fortnight of arrivals.
 *   6. Recent activity — the broker action timeline, with "See all".
 *   7. The collapsible guide.
 *
 * Each number appears once: the hero ranks the queues, the inbox shows the
 * items, the tiles carry the age and the trend.
 *
 * Parity: AdminBrokerController::dashboard()
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Card, CardBody, Button } from '@/components/ui';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import MessageSquareWarning from 'lucide-react/icons/message-square-warning';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Eye from 'lucide-react/icons/eye';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Settings from 'lucide-react/icons/settings';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Zap from 'lucide-react/icons/zap';
import UserCheck from 'lucide-react/icons/user-check';
import UserPlus from 'lucide-react/icons/user-plus';
import Flag from 'lucide-react/icons/flag';
import CalendarCheck from 'lucide-react/icons/calendar-check';
import type { LucideIcon } from 'lucide-react';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { adminBroker, adminMatching } from '@/admin/api/adminApi';
import { isAdminTierUser } from '@/lib/access';
import { getFormattingLocale } from '@/lib/helpers';
import { JURISDICTION_SETTING_PATH } from '../components/configuration/configurationSchema';
import { parseServerTimestamp } from '@/lib/serverTime';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerSkeleton,
  BrokerEmptyState,
  BrokerSectionCard,
  BrokerActivityTimeline,
  useCountUp,
  type BrokerStatColor,
} from '../components';
import type {
  BrokerDashboardStats,
  BrokerMyWeek,
  BrokerTrendQueue,
  MatchApprovalStats,
} from '@/admin/api/types';
import { BrokerControlsHelp } from './BrokerHelpPage';
import { useBrokerAutoRefresh } from '../useBrokerAutoRefresh';
import { BrokerInbox } from '../components/BrokerInbox';

// The activity feed's plain-English rendering lives with the timeline now;
// re-exported so existing imports (and its tests) keep working.
export { formatActivityDetails } from '../components/BrokerActivityTimeline';

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
  { key: 'safeguarding_alerts', labelKey: 'dashboard.safeguarding_alerts', icon: AlertTriangle, color: 'danger', path: '/broker/messages?status=urgent', weight: 6 },
  { key: 'high_risk_listings', labelKey: 'dashboard.high_risk_listings', icon: ShieldAlert, color: 'danger', path: '/broker/risk-tags?level=elevated', weight: 5 },
  { key: 'unreviewed_messages', labelKey: 'dashboard.unreviewed_messages', icon: MessageSquareWarning, color: 'warning', path: '/broker/messages?status=unreviewed', weight: 4 },
  { key: 'pending_exchanges', labelKey: 'dashboard.pending_exchanges', icon: ArrowLeftRight, color: 'accent', path: '/broker/exchanges?status=needs_action', weight: 4 },
  { key: 'open_reports', labelKey: 'dashboard.open_reports', icon: Flag, color: 'warning', path: '/broker/moderation/reports?status=pending', weight: 4 },
  { key: 'pending_members', labelKey: 'dashboard.pending_members', icon: UserPlus, color: 'accent', path: '/broker/members?status=pending', weight: 3 },
  { key: 'onboarding_safeguarding_flags', labelKey: 'dashboard.safeguarding_flags', icon: ShieldAlert, color: 'warning', path: '/broker/safeguarding/support-needs', weight: 3 },
  { key: 'vetting_review_requests', labelKey: 'dashboard.vetting_review_requests', icon: ShieldCheck, color: 'warning', path: '/broker/vetting?status=review_requested', weight: 3 },
];

const queuePillClass: Record<BrokerStatColor, string> = {
  danger: 'border-danger/30 bg-danger/10 text-danger hover:bg-danger/15',
  warning: 'border-warning/30 bg-warning/10 text-warning hover:bg-warning/15',
  success: 'border-success/30 bg-success/10 text-success hover:bg-success/15',
  accent: 'border-accent/30 bg-accent/10 text-accent hover:bg-accent/15',
  neutral: 'border-divider bg-surface-secondary text-muted hover:bg-surface-tertiary',
};

// Quick-link metadata. Titles are translated at render time from the
// broker.dashboard.links.* namespace; the sidebar lists the same pages, so
// these are a single compact row rather than seven cards.
const QUICK_LINKS = [
  { key: 'exchanges',       icon: ArrowLeftRight,       path: '/broker/exchanges',       feature: 'exchange_workflow' as const },
  { key: 'match_approvals', icon: UserCheck,            path: '/broker/match-approvals', feature: 'exchange_workflow' as const },
  { key: 'risk_tags',       icon: ShieldAlert,          path: '/broker/risk-tags' },
  { key: 'messages',        icon: MessageSquareWarning, path: '/broker/messages' },
  { key: 'monitoring',      icon: Eye,                  path: '/broker/monitoring' },
  { key: 'vetting',         icon: ShieldCheck,          path: '/broker/vetting' },
  { key: 'configuration',   icon: Settings,             path: '/broker/configuration' },
];

type TFunc = (key: string, options?: Record<string, unknown>) => string;

/**
 * "Oldest waiting 3 days" for a queue's oldest arrival; "Oldest arrived
 * today" for one that came in today; nothing when the queue is empty.
 */
export function oldestWaitingLabel(iso: string | null | undefined, t: TFunc, now: Date = new Date()): string | undefined {
  const date = parseServerTimestamp(iso);
  if (!date) return undefined;
  const days = Math.floor(Math.max(0, now.getTime() - date.getTime()) / 86_400_000);
  return days === 0 ? t('dashboard.oldest_waiting_today') : t('dashboard.oldest_waiting_days', { count: days });
}

function HeroTotal({ value }: { value: number }) {
  const display = useCountUp(value);
  return <>{display.toLocaleString(getFormattingLocale())}</>;
}

function WeekFigure({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-surface-secondary/60 px-3 py-2.5">
      <p className="text-xl font-semibold leading-none tracking-tight text-foreground tabular-nums">{value}</p>
      <p className="mt-1.5 text-xs leading-4 text-muted">{label}</p>
    </div>
  );
}

interface MyWeekCardProps {
  week: BrokerMyWeek | null | undefined;
  failed: boolean;
  /** Average hours to review a match (exchange-workflow communities only). */
  avgReviewHours: number | null;
  /** Lay the figures out in one row when the card has the whole width. */
  wide: boolean;
}

function MyWeekCard({ week, failed, avgReviewHours, wide }: MyWeekCardProps) {
  const { t } = useTranslation('broker');
  const nothingYet = !failed && (!week || week.total === 0);
  const figures = week
    ? [
        { key: 'exchanges_decided', value: week.exchanges_decided },
        { key: 'messages_reviewed', value: week.messages_reviewed },
        { key: 'matches_decided', value: week.matches_decided },
        { key: 'vetting_handled', value: week.vetting_handled },
      ]
    : [];
  const showAverage = avgReviewHours !== null && Number.isFinite(avgReviewHours) && avgReviewHours > 0;

  return (
    <BrokerSectionCard
      title={t('dashboard.my_week.title')}
      icon={CalendarCheck}
      color="success"
      count={failed ? null : (week?.total ?? null)}
      description={t('dashboard.my_week.description')}
    >
      {failed ? (
        <BrokerEmptyState bare icon={AlertCircle} color="danger" title={t('dashboard.could_not_load')} className="py-6" />
      ) : nothingYet ? (
        <p className="text-sm leading-6 text-muted">{t('dashboard.my_week.empty')}</p>
      ) : (
        <div className={`grid grid-cols-2 gap-2 ${wide ? 'sm:grid-cols-4 xl:grid-cols-5' : ''}`}>
          {figures.map((f) => (
            <WeekFigure key={f.key} label={t(`dashboard.my_week.${f.key}`)} value={f.value.toLocaleString(getFormattingLocale())} />
          ))}
          {showAverage && (
            <WeekFigure
              label={t('dashboard.my_week.avg_review_hours')}
              value={t('dashboard.my_week.avg_review_value', { hours: avgReviewHours.toFixed(1) })}
            />
          )}
        </div>
      )}
    </BrokerSectionCard>
  );
}

export function BrokerDashboard() {
  const { t } = useTranslation('broker');
  usePageTitle(t('dashboard.title'));
  const { tenantPath, hasFeature } = useTenant();
  const { user } = useAuth();
  const toast = useToast();

  const [stats, setStats] = useState<BrokerDashboardStats | null>(null);
  const [avgReviewHours, setAvgReviewHours] = useState<number | null>(null);
  const [inboxVisible, setInboxVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const showExchanges = hasFeature('exchange_workflow');

  // Stash the latest `t` and `toast` in refs so loadDashboard's identity
  // doesn't churn on every language switch (which would otherwise refetch
  // the entire dashboard for no reason — only labels translate, not numbers).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // `quiet` is the automatic refresh: numbers change in place, with no
  // skeleton flash and no error toast if one background attempt fails.
  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) {
      setLoading(true);
      setLoadError(false);
    }
    try {
      const [res, matchRes] = await Promise.all([
        adminBroker.getDashboard(),
        // The match review time comes from the matching module's own stats;
        // it is a nicety, so its failure never fails the dashboard.
        showExchanges ? adminMatching.getApprovalStats(7).catch(() => null) : Promise.resolve(null),
      ]);
      if (res.success && res.data) {
        setStats(res.data);
        setLoadError(false);
      } else if (!quiet) {
        setLoadError(true);
        toastRef.current.error(tRef.current('dashboard.load_failed'));
      }
      if (matchRes?.success && matchRes.data) {
        // Same unwrap BrokerLayout does: the stats endpoint sometimes wraps its
        // payload once more in `data`.
        const payload = matchRes.data as unknown;
        const matchStats =
          payload && typeof payload === 'object' && 'data' in (payload as Record<string, unknown>)
            ? (payload as { data: MatchApprovalStats }).data
            : (payload as MatchApprovalStats);
        const hours = Number(matchStats?.avg_review_hours);
        setAvgReviewHours(Number.isFinite(hours) ? hours : null);
      }
    } catch {
      if (!quiet) {
        setLoadError(true);
        toastRef.current.error(tRef.current('dashboard.load_failed'));
      }
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [showExchanges]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  useBrokerAutoRefresh(() => void loadDashboard(true));

  // Rank the non-empty queues: severity first, then volume. `_partial` loads
  // can leave some counters null — those are excluded rather than treated as 0
  // so a failed query never silently reads as "all clear".
  const activeQueues = QUEUES
    .filter((q) => (showExchanges || q.key !== 'pending_exchanges'))
    .map((q) => ({ ...q, count: stats ? Number(stats[q.key] ?? 0) : 0 }))
    .filter((q) => Number.isFinite(q.count) && q.count > 0)
    .sort((a, b) => b.weight - a.weight || b.count - a.count);

  // Safeguarding alerts are flagged messages nobody has reviewed — a subset of
  // Unreviewed Messages. Both chips stay (the urgent one is the point), but
  // the total counts each message once.
  const overlap = activeQueues.some((q) => q.key === 'unreviewed_messages')
    ? Number(activeQueues.find((q) => q.key === 'safeguarding_alerts')?.count ?? 0)
    : 0;
  const totalOpen = activeQueues.reduce((sum, q) => sum + q.count, 0) - overlap;
  const hasDanger = activeQueues.some((q) => q.color === 'danger');

  const quickLinks = QUICK_LINKS.filter((l) => !l.feature || hasFeature(l.feature));

  const failedMetrics = stats?._failed_metrics ?? [];
  const failed = (metric: string) => failedMetrics.includes(metric);

  // What every KPI tile gets beyond its count: the sparkline and delta from
  // the queue's trend, how long its oldest item has waited, and whether its
  // own figure failed. A flat zero fortnight draws no sparkline.
  const queueTileProps = (key: BrokerTrendQueue, count: number | null | undefined) => {
    const trend = stats?.trends?.[key];
    const points = trend?.points && trend.points.some((p) => p > 0) ? trend.points : undefined;
    return {
      trend: points,
      delta: typeof trend?.delta === 'number' ? trend.delta : undefined,
      deltaLabel: t('dashboard.vs_previous_fortnight'),
      description: count ? oldestWaitingLabel(stats?.oldest_waiting?.[key], t) : undefined,
      failed: failed(key),
    };
  };

  const canSetJurisdiction = isAdminTierUser(user);

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_role', articleId: 'broker_dashboard' }}
      title={t('dashboard.title')}
      description={t('dashboard.description')}
      icon={LayoutDashboard}
      color="accent"
      actions={
        <Button
          variant="tertiary"
          startContent={<RefreshCw size={16} />}
          onPress={() => void loadDashboard()}
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
          for a risk-surfacing UI. The affected tiles are marked too. */}
      {stats?._partial && (
        // Same treatment as the panel's other notices: foreground text on the
        // card surface with an amber edge (the amber-on-amber card it replaces
        // was hard to read).
        <Alert
          role="status"
          color="warning"
          className="mb-4 rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface p-4 shadow-sm"
          classNames={{
            title: 'text-sm font-semibold text-foreground',
            description: 'text-sm leading-6 text-foreground',
            icon: 'text-warning',
          }}
          icon={<AlertCircle size={20} aria-hidden="true" />}
          title={t('dashboard.partial_title')}
          description={t('dashboard.partial_body')}
          endContent={(
            <Button size="sm" variant="secondary" className="shrink-0 self-center" onPress={() => void loadDashboard()}>
              <RefreshCw size={14} aria-hidden="true" />
              {t('dashboard.refresh')}
            </Button>
          )}
        />
      )}

      {loading && !stats ? (
        <div className="space-y-6">
          <BrokerSkeleton variant="cards" count={1} />
          <BrokerSkeleton variant="stats" count={8} />
          <BrokerSkeleton variant="timeline" count={4} />
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
            <Button size="sm" variant="danger-soft" onPress={() => void loadDashboard()}>
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
                  {/* shrink-0: with several queues the chips wrap, not the heading. */}
                  <div className="flex shrink-0 items-center gap-4">
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
                  <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
                    {activeQueues.map((q) => {
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

          {/* ── Safeguarding jurisdiction not set — a compact pointer. Only an
              admin can set it (owner decision, 3 Oct 2026); everyone else is
              told who to ask. ─────────────────────────────────────────────── */}
          {stats?.safeguarding_jurisdiction_configured === false && (
            <Card
              role="status"
              className="mb-6 rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface shadow-sm"
            >
              <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning ring-1 ring-inset ring-current/10">
                    <ShieldAlert size={18} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{t('jurisdiction_notice.title')}</p>
                    <p className="text-sm leading-5 text-muted">
                      {canSetJurisdiction ? t('jurisdiction_notice.effect_vetting') : t('jurisdiction_notice.action_ask_admin')}
                    </p>
                  </div>
                </div>
                {canSetJurisdiction && (
                  <Button as={Link} to={tenantPath(JURISDICTION_SETTING_PATH)} size="sm" variant="primary" className="shrink-0 self-start sm:self-center">
                    {t('jurisdiction_notice.set_button')}
                  </Button>
                )}
              </CardBody>
            </Card>
          )}

          {/* ── Quick links — one compact row; the sidebar has the same pages ── */}
          <nav aria-label={t('dashboard.quick_access')} className="mb-6 flex flex-wrap gap-2">
            {quickLinks.map((link) => {
              const Icon = link.icon;
              return (
                <Button
                  key={link.path}
                  as={Link}
                  to={tenantPath(link.path)}
                  size="sm"
                  variant="secondary"
                  className="rounded-full"
                  startContent={<Icon size={14} aria-hidden="true" />}
                >
                  {t(`dashboard.links.${link.key}_title`)}
                </Button>
              );
            })}
          </nav>

          {/* ── Waiting for you (the first items of each queue, with quick
              decisions) beside My week ────────────────────────────────────── */}
          <div className={`mb-8 grid grid-cols-1 gap-4 ${inboxVisible ? 'xl:grid-cols-[2fr_1fr]' : ''}`}>
            <div className={inboxVisible ? 'min-w-0' : 'hidden'}>
              <BrokerInbox showExchanges={showExchanges} onVisibilityChange={setInboxVisible} />
            </div>
            <MyWeekCard
              week={stats?.my_week}
              failed={failed('my_week')}
              avgReviewHours={showExchanges ? avgReviewHours : null}
              wide={!inboxVisible}
            />
          </div>

          {/* ── KPI grid — each tile deep-links with the filter applied ──── */}
          <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
            <BrokerStatCard
              label={t('dashboard.pending_members')}
              value={stats?.pending_members ?? null}
              icon={UserPlus}
              color="accent"
              loading={loading}
              to={tenantPath('/broker/members?status=pending')}
              {...queueTileProps('pending_members', stats?.pending_members)}
            />
            <BrokerStatCard
              label={t('dashboard.open_reports')}
              value={stats?.open_reports ?? null}
              icon={Flag}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/moderation/reports?status=pending')}
              {...queueTileProps('open_reports', stats?.open_reports)}
            />
            {showExchanges && (
              <BrokerStatCard
                label={t('dashboard.pending_exchanges')}
                value={stats?.pending_exchanges ?? null}
                icon={ArrowLeftRight}
                color="accent"
                loading={loading}
                to={tenantPath('/broker/exchanges?status=needs_action')}
                {...queueTileProps('pending_exchanges', stats?.pending_exchanges)}
              />
            )}
            <BrokerStatCard
              label={t('dashboard.unreviewed_messages')}
              value={stats?.unreviewed_messages ?? null}
              icon={MessageSquareWarning}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/messages?status=unreviewed')}
              {...queueTileProps('unreviewed_messages', stats?.unreviewed_messages)}
            />
            <BrokerStatCard
              label={t('dashboard.high_risk_listings')}
              value={stats?.high_risk_listings ?? null}
              icon={ShieldAlert}
              color="danger"
              loading={loading}
              to={tenantPath('/broker/risk-tags?level=elevated')}
              failed={failed('high_risk_listings')}
            />
            <BrokerStatCard
              label={t('dashboard.monitored_users')}
              value={stats?.monitored_users ?? null}
              icon={Eye}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/monitoring')}
              failed={failed('monitored_users')}
            />
            <BrokerStatCard
              label={t('dashboard.vetting_review_requests')}
              value={stats?.vetting_review_requests ?? null}
              icon={ShieldCheck}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/vetting?status=review_requested')}
              {...queueTileProps('vetting_review_requests', stats?.vetting_review_requests)}
            />
            <BrokerStatCard
              label={t('dashboard.safeguarding_alerts')}
              value={stats?.safeguarding_alerts ?? null}
              icon={AlertTriangle}
              color="danger"
              loading={loading}
              to={tenantPath('/broker/messages?status=urgent')}
              {...queueTileProps('safeguarding_alerts', stats?.safeguarding_alerts)}
            />
            <BrokerStatCard
              label={t('dashboard.safeguarding_flags')}
              value={stats?.onboarding_safeguarding_flags ?? null}
              icon={ShieldAlert}
              color="warning"
              loading={loading}
              to={tenantPath('/broker/safeguarding/support-needs')}
              failed={failed('onboarding_safeguarding_flags')}
            />
          </div>

          {/* ── Activity timeline ────────────────────────────────────────── */}
          <div className="mb-8">
            <BrokerActivityTimeline entries={stats?.recent_activity ?? []} failed={failed('recent_activity')} />
          </div>

          {/* Collapsible guidance panel — title visible, body tucked into accordion sections */}
          <BrokerControlsHelp />
        </>
      )}
    </BrokerPageShell>
  );
}

export default BrokerDashboard;
