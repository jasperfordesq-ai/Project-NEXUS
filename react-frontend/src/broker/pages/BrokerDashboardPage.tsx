// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Command Center
 *
 * The broker's first page, top to bottom:
 *   1. "What needs you now" — one line per kind of work that is waiting, most
 *      urgent first, with how many and how long the oldest has waited.
 *   2. A compact warning when the community has no safeguarding jurisdiction.
 *   3. "Waiting for you" (the first items of each kind, with quick decisions)
 *      beside "My week" (what this broker decided in the last 7 days).
 *   4. "Also worth knowing" — the two standing counts (monitored members,
 *      high-risk listings). They do not fall as a broker works, so they are
 *      not part of the waiting total: counted there, the page could never
 *      say "All clear" while one listing stayed tagged high risk.
 *   5. Recent activity — the broker action timeline, with "See all".
 *   6. The collapsible guide.
 *
 * Until Nov 2026 each number was shown three times (a pill in the hero, a
 * tile with a small graph further down, the menu badge) and a row of seven
 * shortcut buttons repeated the menu. Brokers found the page hard to read;
 * the pills, the queue tiles and the shortcuts are now the one list.
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
import ChevronRight from 'lucide-react/icons/chevron-right';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import LayoutDashboard from 'lucide-react/icons/layout-dashboard';
import Zap from 'lucide-react/icons/zap';
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
// The kinds of work that wait for a broker — severity-weighted so the list
// always puts the most urgent first. Paths carry the filter. Standing counts
// (monitored members, high-risk listings) are deliberately not here.
// ─────────────────────────────────────────────────────────────────────────────

interface QueueDef {
  key: keyof BrokerDashboardStats;
  labelKey: string;
  icon: LucideIcon;
  color: BrokerStatColor;
  path: string;
  /** Higher = more urgent; ties broken by count. */
  weight: number;
  /** The queue's key in `oldest_waiting`, when the server reports one. */
  ageKey?: BrokerTrendQueue;
}

const QUEUES: QueueDef[] = [
  { key: 'safeguarding_alerts', labelKey: 'dashboard.safeguarding_alerts', icon: AlertTriangle, color: 'danger', path: '/broker/messages?status=urgent', weight: 6, ageKey: 'safeguarding_alerts' },
  { key: 'unreviewed_messages', labelKey: 'dashboard.unreviewed_messages', icon: MessageSquareWarning, color: 'warning', path: '/broker/messages?status=unreviewed', weight: 4, ageKey: 'unreviewed_messages' },
  { key: 'pending_exchanges', labelKey: 'dashboard.pending_exchanges', icon: ArrowLeftRight, color: 'accent', path: '/broker/exchanges?status=needs_action', weight: 4, ageKey: 'pending_exchanges' },
  { key: 'open_reports', labelKey: 'dashboard.open_reports', icon: Flag, color: 'warning', path: '/broker/moderation/reports?status=pending', weight: 4, ageKey: 'open_reports' },
  { key: 'pending_members', labelKey: 'dashboard.pending_members', icon: UserPlus, color: 'accent', path: '/broker/members?status=pending', weight: 3, ageKey: 'pending_members' },
  { key: 'onboarding_safeguarding_flags', labelKey: 'dashboard.safeguarding_flags', icon: ShieldAlert, color: 'warning', path: '/broker/safeguarding/support-needs', weight: 3 },
  { key: 'vetting_review_requests', labelKey: 'dashboard.vetting_review_requests', icon: ShieldCheck, color: 'warning', path: '/broker/vetting?status=review_requested', weight: 3, ageKey: 'vetting_review_requests' },
];

const queueIconClass: Record<BrokerStatColor, string> = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  accent: 'bg-accent/10 text-accent-soft-foreground',
  neutral: 'bg-surface-tertiary text-muted',
};

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
  const { tenantPath, hasFeature, hasModule } = useTenant();
  const { user } = useAuth();
  const toast = useToast();

  const [stats, setStats] = useState<BrokerDashboardStats | null>(null);
  const [avgReviewHours, setAvgReviewHours] = useState<number | null>(null);
  const [inboxVisible, setInboxVisible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const showExchanges = hasFeature('exchange_workflow');
  // Match approvals follow offers and requests (see BrokerSidebar).
  const showMatchApprovals = hasModule('listings');

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
        showMatchApprovals ? adminMatching.getApprovalStats(7).catch(() => null) : Promise.resolve(null),
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
  }, [showMatchApprovals]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);
  useBrokerAutoRefresh(() => void loadDashboard(true));

  const failedMetrics = stats?._failed_metrics ?? [];
  const failed = (metric: string) => failedMetrics.includes(metric);

  const shownQueues = QUEUES.filter((q) => showExchanges || q.key !== 'pending_exchanges');

  // Rank the non-empty queues: severity first, then volume. `_partial` loads
  // can leave some counters null — those are excluded rather than treated as 0
  // so a failed query never silently reads as "all clear".
  const activeQueues = shownQueues
    .map((q) => ({ ...q, count: stats ? Number(stats[q.key] ?? 0) : 0 }))
    .filter((q) => Number.isFinite(q.count) && q.count > 0)
    .sort((a, b) => b.weight - a.weight || b.count - a.count);

  // A queue whose count could not be worked out gets a line of its own with a
  // dash, after the ones that loaded. Without it, a page whose only failure
  // was the safeguarding count would still have said "All clear".
  const failedQueues = shownQueues.filter((q) => failed(q.key));

  // Safeguarding alerts are flagged messages nobody has reviewed — a subset of
  // the messages to check. Both lines stay (the urgent one is the point), but
  // the total counts each message once.
  const overlap = activeQueues.some((q) => q.key === 'unreviewed_messages')
    ? Number(activeQueues.find((q) => q.key === 'safeguarding_alerts')?.count ?? 0)
    : 0;
  const totalOpen = activeQueues.reduce((sum, q) => sum + q.count, 0) - overlap;
  const hasDanger = activeQueues.some((q) => q.color === 'danger');
  const allClear = totalOpen === 0 && failedQueues.length === 0;

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
          <BrokerSkeleton variant="stats" count={2} />
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
          {/* ── "What needs you now" — one line per kind of work waiting ──── */}
          <Card
            className={`mb-6 rounded-2xl border shadow-sm shadow-black/[0.03] ${
              allClear
                ? 'border-success/30 bg-gradient-to-br from-success/10 via-surface to-surface'
                : hasDanger
                  ? 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface'
                  : 'border-accent/30 bg-gradient-to-br from-accent/10 via-surface to-surface'
            }`}
          >
            <CardBody className="p-5 sm:p-6">
              {allClear ? (
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
                <section aria-labelledby="broker-needs-you-title">
                  <div className="flex items-center gap-4">
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-current/20 ${
                        hasDanger ? 'bg-danger/15 text-danger' : 'bg-accent/15 text-accent-soft-foreground'
                      }`}
                    >
                      <Zap size={26} />
                    </span>
                    <div>
                      <h2 id="broker-needs-you-title" className="text-xl font-semibold tracking-tight text-foreground">
                        {t('dashboard.needs_attention')}
                      </h2>
                      {totalOpen > 0 && (
                        <p className="text-sm text-muted">
                          <span className="font-semibold tabular-nums text-foreground">
                            <HeroTotal value={totalOpen} />
                          </span>{' '}
                          {t('dashboard.open_items', { count: totalOpen })}
                        </p>
                      )}
                    </div>
                  </div>
                  <ul className="mt-4 divide-y divide-divider/70 overflow-hidden rounded-xl border border-divider/70 bg-surface">
                    {activeQueues.map((q) => {
                      const QIcon = q.icon;
                      const age = q.ageKey ? oldestWaitingLabel(stats?.oldest_waiting?.[q.ageKey], t) : undefined;
                      return (
                        <li key={q.key}>
                          <Link
                            to={tenantPath(q.path)}
                            className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-secondary motion-reduce:transition-none sm:px-4"
                          >
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${queueIconClass[q.color]}`}>
                              <QIcon size={18} aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-foreground">{t(q.labelKey)}</span>
                              {age && <span className="block text-xs text-muted">{age}</span>}
                            </span>
                            <span className="text-lg font-semibold tabular-nums text-foreground">
                              {q.count.toLocaleString(getFormattingLocale())}
                            </span>
                            <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
                          </Link>
                        </li>
                      );
                    })}
                    {failedQueues.map((q) => {
                      const QIcon = q.icon;
                      return (
                        <li key={q.key}>
                          <Link
                            to={tenantPath(q.path)}
                            className="flex items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-secondary motion-reduce:transition-none sm:px-4"
                          >
                            <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${queueIconClass.neutral}`}>
                              <QIcon size={18} aria-hidden="true" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-medium text-foreground">{t(q.labelKey)}</span>
                              <span className="block text-xs font-medium text-warning">{t('dashboard.could_not_load')}</span>
                            </span>
                            <span className="text-lg font-semibold text-muted">—</span>
                            <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </section>
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

          {/* ── Waiting for you (the first items of each queue, with quick
              decisions) beside My week ────────────────────────────────────── */}
          <div className={`mb-8 grid grid-cols-1 gap-4 ${inboxVisible ? 'xl:grid-cols-[2fr_1fr]' : ''}`}>
            <div className={inboxVisible ? 'min-w-0' : 'hidden'}>
              <BrokerInbox showExchanges={showExchanges} showMatchApprovals={showMatchApprovals} onVisibilityChange={setInboxVisible} />
            </div>
            <MyWeekCard
              week={stats?.my_week}
              failed={failed('my_week')}
              avgReviewHours={showMatchApprovals ? avgReviewHours : null}
              wide={!inboxVisible}
            />
          </div>

          {/* ── Also worth knowing — the two counts that do not fall as a
              broker works, kept apart from the waiting list above ─────────── */}
          <section aria-labelledby="broker-standing-title" className="mb-8">
            <h2 id="broker-standing-title" className="text-lg font-semibold tracking-tight text-foreground">
              {t('dashboard.standing_title')}
            </h2>
            <p className="mb-4 mt-1 text-sm text-muted">{t('dashboard.standing_hint')}</p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4">
              <BrokerStatCard
                label={t('dashboard.monitored_users')}
                value={stats?.monitored_users ?? null}
                icon={Eye}
                color="neutral"
                loading={loading}
                to={tenantPath('/broker/monitoring')}
                failed={failed('monitored_users')}
              />
              <BrokerStatCard
                label={t('dashboard.high_risk_listings')}
                value={stats?.high_risk_listings ?? null}
                icon={ShieldAlert}
                color="warning"
                loading={loading}
                to={tenantPath('/broker/risk-tags?level=elevated')}
                failed={failed('high_risk_listings')}
              />
            </div>
          </section>

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
