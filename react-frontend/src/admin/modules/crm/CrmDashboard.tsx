// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CRM overview
 *
 * The front page of the member CRM. Data source: GET /api/v2/admin/crm/dashboard
 * (+ /export/dashboard for the CSV of every figure).
 *
 * Top to bottom: what is waiting on a coordinator right now (approvals,
 * overdue tasks, tasks due today — each a link into the list with the filter
 * applied, or a green "nothing is waiting" when all three are zero); eight
 * figures, each a link to the page it comes from; the caller's own next
 * tasks and the latest notes they may read; and a card per CRM tool.
 *
 * A failed load shows an error with Retry — until 2026-10-05 it showed every
 * figure as 0, which read as an empty community rather than a broken page.
 * A refresh keeps the figures on screen (dimmed) instead of blanking them.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import Activity from 'lucide-react/icons/activity';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import CheckCircle2 from 'lucide-react/icons/circle-check-big';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import ContactRound from 'lucide-react/icons/contact-round';
import Download from 'lucide-react/icons/download';
import Filter from 'lucide-react/icons/filter';
import ListChecks from 'lucide-react/icons/list-checks';
import Pin from 'lucide-react/icons/pin';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import StickyNote from 'lucide-react/icons/sticky-note';
import Tag from 'lucide-react/icons/tag';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import UserCheck from 'lucide-react/icons/user-check';
import UserPlus from 'lucide-react/icons/user-plus';
import Users from 'lucide-react/icons/users';
import Zap from 'lucide-react/icons/zap';
import {
  Avatar, Button, Card, CardBody, CardHeader, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Spinner,
} from '@/components/ui';
import { useAuth, useTenant, useToast } from '@/contexts';
import { formatPercentValue, getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import type { CrmDashboardStats, CrmNextTask, CrmRecentNote } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';

// ----- Formatting -----

function formatNumber(value: number): string {
  return value.toLocaleString(getFormattingLocale());
}

function parseDateTime(value: string): Date | null {
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// due_date is a date without a time. Parsing it with `new Date('YYYY-MM-DD')`
// gives UTC midnight, which displays as the previous day west of Greenwich,
// so it is parsed as a local calendar date instead (as the tasks page does).
function parseDateOnly(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDay(value: string): string {
  return parseDateOnly(value).toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * "5 minutes ago", "yesterday", "3 weeks ago" — in the admin's language, with
 * the plural rules the browser already knows, so no translation key has to
 * carry a number.
 */
function formatAgo(value: string): string | null {
  const parsed = parseDateTime(value);
  if (!parsed) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' });
  if (seconds < 60) return rtf.format(0, 'minute');
  if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86_400) return rtf.format(-Math.floor(seconds / 3600), 'hour');
  const days = Math.floor(seconds / 86_400);
  if (days < 14) return rtf.format(-days, 'day');
  if (days < 61) return rtf.format(-Math.round(days / 7), 'week');
  if (days < 365) return rtf.format(-Math.round(days / 30), 'month');
  return rtf.format(-Math.round(days / 365), 'year');
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });
}

// ----- Static look-ups -----

type ChipColor = 'default' | 'accent' | 'success' | 'warning' | 'danger';

const PRIORITY_COLOR: Record<CrmNextTask['priority'], ChipColor> = {
  urgent: 'danger',
  high: 'warning',
  medium: 'default',
  low: 'default',
};

const CATEGORY_COLOR: Record<CrmRecentNote['category'], ChipColor> = {
  general: 'default',
  outreach: 'accent',
  support: 'success',
  onboarding: 'accent',
  concern: 'danger',
  follow_up: 'warning',
};

interface Tool {
  key: string;
  labelKey: string;
  descKey: string;
  path: string;
  icon: LucideIcon;
  accentClassName: string;
}

const TOOLS: readonly Tool[] = [
  { key: 'notes', labelKey: 'crm.qa_member_notes', descKey: 'crm.tool_notes_desc', path: '/admin/crm/notes', icon: StickyNote, accentClassName: 'bg-accent/10 text-accent' },
  { key: 'tasks', labelKey: 'crm.qa_crm_tasks', descKey: 'crm.tool_tasks_desc', path: '/admin/crm/tasks', icon: ClipboardList, accentClassName: 'bg-warning/10 text-warning' },
  { key: 'tags', labelKey: 'crm.qa_member_tags', descKey: 'crm.tool_tags_desc', path: '/admin/crm/tags', icon: Tag, accentClassName: 'bg-accent-soft text-accent' },
  { key: 'timeline', labelKey: 'crm.qa_activity_timeline', descKey: 'crm.tool_timeline_desc', path: '/admin/crm/timeline', icon: Activity, accentClassName: 'bg-success/10 text-success' },
  { key: 'funnel', labelKey: 'crm.qa_onboarding_funnel', descKey: 'crm.tool_funnel_desc', path: '/admin/crm/funnel', icon: Filter, accentClassName: 'bg-accent/10 text-accent' },
  { key: 'members', labelKey: 'crm.qa_all_members', descKey: 'crm.tool_members_desc', path: '/admin/users', icon: Users, accentClassName: 'bg-surface-tertiary text-muted' },
];

// ----- Attention strip -----

type QueueColor = 'danger' | 'warning';

interface Queue {
  key: string;
  label: string;
  count: number;
  icon: LucideIcon;
  color: QueueColor;
  path: string;
}

const pillClass: Record<QueueColor, string> = {
  danger: 'border-danger/30 bg-danger/10 hover:bg-danger/15',
  warning: 'border-warning/30 bg-warning/10 hover:bg-warning/15',
};

const pillIconClass: Record<QueueColor, string> = {
  danger: 'text-danger',
  warning: 'text-warning',
};

/**
 * What is waiting on a coordinator right now, one chip per queue, each a link
 * into the list with the filter applied. Mirrors the admin dashboard's strip
 * so the two pages read the same way.
 */
function AttentionStrip({ data }: { data: CrmDashboardStats }) {
  const { t } = useTranslation('admin_crm');
  const { tenantPath } = useTenant();

  // Most urgent first: tasks already late, then today's, then people waiting to get in.
  const allQueues: Queue[] = [
    { key: 'overdue', label: t('crm.attention_overdue'), count: data.overdue_tasks, icon: TriangleAlert, color: 'danger', path: '/admin/crm/tasks?status=overdue' },
    { key: 'due_today', label: t('crm.attention_due_today'), count: data.tasks_due_today, icon: CalendarClock, color: 'warning', path: '/admin/crm/tasks?status=open' },
    { key: 'pending', label: t('crm.attention_pending'), count: data.pending_approvals, icon: UserCheck, color: 'warning', path: '/admin/users?filter=pending' },
  ];
  const queues = allQueues.filter((q) => q.count > 0);

  const total = queues.reduce((sum, q) => sum + q.count, 0);

  if (total === 0) {
    return (
      <Card
        role="status"
        className="rounded-2xl border border-success/30 bg-gradient-to-br from-success/10 via-surface to-surface shadow-sm shadow-black/[0.03]"
        data-testid="crm-attention-clear"
      >
        <CardBody className="flex flex-row items-center gap-4 p-5 sm:p-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-success/15 text-success ring-1 ring-inset ring-success/20">
            <CheckCircle2 size={26} aria-hidden="true" />
          </span>
          <div>
            <p className="text-xl font-semibold tracking-tight text-foreground">{t('crm.attention_all_clear')}</p>
            <p className="text-sm text-muted">{t('crm.attention_all_clear_hint')}</p>
          </div>
        </CardBody>
      </Card>
    );
  }

  const hasDanger = queues.some((q) => q.color === 'danger');

  return (
    <Card
      className={`rounded-2xl border shadow-sm shadow-black/[0.03] ${
        hasDanger
          ? 'border-danger/30 bg-gradient-to-br from-danger/10 via-surface to-surface'
          : 'border-warning/30 bg-gradient-to-br from-warning/10 via-surface to-surface'
      }`}
      data-testid="crm-attention"
    >
      {/* The chips sit beside the heading only when the content column is wide
          enough for whole chips; below that they wrap underneath. The admin
          sidebar takes ~320px, so this keys off the xl breakpoint, not sm. */}
      <CardBody className="flex flex-col gap-4 p-5 xl:flex-row xl:items-center xl:justify-between xl:p-6">
        <div className="flex min-w-0 items-center gap-4">
          <span
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ring-inset ring-current/20 ${
              hasDanger ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
            }`}
          >
            <Zap size={26} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xl font-semibold tracking-tight text-foreground">{t('crm.attention_title')}</p>
            <p className="text-sm text-muted">{t('crm.attention_summary', { total: formatNumber(total) })}</p>
          </div>
        </div>
        <nav aria-label={t('crm.attention_title')} className="flex flex-wrap items-center gap-2 xl:shrink-0 xl:justify-end">
          {queues.map((q) => {
            const QIcon = q.icon;
            return (
              <Link
                key={q.key}
                to={tenantPath(q.path)}
                aria-label={`${q.label}: ${formatNumber(q.count)}`}
                className={`flex items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition-colors motion-reduce:transition-none ${pillClass[q.color]}`}
              >
                <QIcon size={15} aria-hidden="true" className={pillIconClass[q.color]} />
                <span className="text-foreground">{q.label}</span>
                <span className="rounded-full bg-surface px-1.5 text-xs font-semibold tabular-nums text-foreground">
                  {formatNumber(q.count)}
                </span>
              </Link>
            );
          })}
        </nav>
      </CardBody>
    </Card>
  );
}

// ----- Section card -----

interface SectionCardProps {
  title: string;
  description: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

function SectionCard({ title, description, footer, children }: SectionCardProps) {
  return (
    <Card className="flex h-full flex-col border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardHeader className="flex flex-col items-start gap-1 px-5 pb-0 pt-5">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-3 px-5 pb-5 pt-4">
        {children}
        {footer && <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">{footer}</div>}
      </CardBody>
    </Card>
  );
}

// ----- Page -----

export function CrmDashboard() {
  const { t } = useTranslation('admin_crm');
  useAdminPageMeta({ title: t('crm.crm_dashboard_title') });
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();

  const [data, setData] = useState<CrmDashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminCrm.getDashboard();
      if (!res.success || !res.data) throw new Error('crm dashboard: empty response');
      setData(res.data);
      setLoadedAt(new Date());
    } catch {
      setError(t('crm.failed_to_load_c_r_m_dashboard_data'));
      toast.error(t('crm.failed_to_load_c_r_m_dashboard_data'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = async (what: string) => {
    const exporters: Record<string, () => Promise<unknown>> = {
      figures: adminCrm.exportDashboard,
      notes: adminCrm.exportNotes,
      tasks: adminCrm.exportTasks,
      tags: adminCrm.exportTags,
      activity: () => adminCrm.exportTimeline(),
    };
    const run = exporters[what];
    if (!run) return;
    setExporting(true);
    try {
      await run();
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(t('crm.export_failed'));
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <PageHeader
      title={t('crm.crm_dashboard_title')}
      description={t('crm.crm_dashboard_desc')}
      icon={<ContactRound size={20} />}
      actions={
        <>
          <Dropdown>
            <DropdownTrigger>
              <Button
                variant="secondary"
                startContent={<Download size={16} aria-hidden="true" />}
                endContent={<ChevronDown size={14} aria-hidden="true" />}
                isLoading={exporting}
                isDisabled={!data}
              >
                {t('crm.overview_export_menu')}
              </Button>
            </DropdownTrigger>
            <DropdownMenu aria-label={t('crm.overview_export_menu_label')} onAction={(key) => { void handleExport(String(key)); }}>
              <DropdownItem key="figures" id="figures">{t('crm.overview_export_figures')}</DropdownItem>
              <DropdownItem key="notes" id="notes">{t('crm.export_notes')}</DropdownItem>
              <DropdownItem key="tasks" id="tasks">{t('crm.export_tasks')}</DropdownItem>
              <DropdownItem key="tags" id="tags">{t('crm.export_tags')}</DropdownItem>
              <DropdownItem key="activity" id="activity">{t('crm.export_activity')}</DropdownItem>
            </DropdownMenu>
          </Dropdown>
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} aria-hidden="true" />}
            onPress={() => { void fetchData(); }}
            isDisabled={loading}
          >
            {t('crm.refresh')}
          </Button>
        </>
      }
    />
  );

  // ----- First load / failure -----

  if (loading && !data) {
    return (
      <div className="flex min-h-[420px] items-center justify-center" role="status" aria-busy="true">
        <Spinner size="lg" label={t('crm.loading_dashboard')} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl">
        {header}
        <Card className="border border-danger/30 bg-surface">
          <CardBody className="flex flex-col items-center gap-4 px-6 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <TriangleAlert size={28} aria-hidden="true" />
            </div>
            <p className="text-foreground">{error || t('crm.failed_to_load_c_r_m_dashboard_data')}</p>
            <Button variant="secondary" onPress={() => { void fetchData(); }} startContent={<RefreshCw size={16} aria-hidden="true" />}>
              {t('common.retry')}
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  // ----- Derived figures -----

  const todayKey = localDateKey(new Date());
  const myTasksPath = user?.id ? `/admin/crm/tasks?assigned_to=${user.id}` : '/admin/crm/tasks';
  const moreMyTasks = Math.max(0, data.my_tasks.open - data.next_tasks.length);
  const pendingColor = data.pending_approvals > 0 ? 'warning' : 'default';
  const overdueColor = data.overdue_tasks > 0 ? 'danger' : 'default';

  const dueChip = (task: CrmNextTask) => {
    if (!task.due_date) {
      return <Chip size="sm" variant="soft" color="default">{t('crm.task_no_due_date')}</Chip>;
    }
    const key = task.due_date.slice(0, 10);
    if (key < todayKey) return <Chip size="sm" variant="soft" color="danger">{t('crm.status_overdue')}</Chip>;
    if (key === todayKey) return <Chip size="sm" variant="soft" color="warning">{t('crm.due_today')}</Chip>;
    return <Chip size="sm" variant="soft" color="default">{t('crm.task_due_on', { date: formatDay(task.due_date) })}</Chip>;
  };

  return (
    <div className="mx-auto max-w-6xl">
      {header}

      {/* A refresh keeps the figures on screen (dimmed) instead of blanking the page. */}
      <div
        className={`flex flex-col gap-6 pb-10 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={loading || undefined}
      >
        <AttentionStrip data={data} />

        <section className="flex flex-col gap-3">
          {loadedAt && (
            <p className="text-right text-xs text-muted" aria-live="polite">
              {t('crm.overview_updated', { time: formatClock(loadedAt) })}
            </p>
          )}
          {/* One tile per row on a phone so the hint under each figure is not
              cut off; two-up from sm; four-up only once the content column
              (viewport minus the admin sidebar) is wide enough for whole hints. */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('crm.stat_members')}
              value={data.total_members}
              icon={Users}
              to={tenantPath('/admin/users')}
              description={t('crm.stat_members_hint', { never: formatNumber(data.never_logged_in) })}
            />
            <StatCard
              label={t('crm.stat_active')}
              value={data.active_members}
              icon={Activity}
              color="success"
              description={t('crm.stat_active_hint', { percent: formatPercentValue(data.retention_rate, { maximumFractionDigits: 0 }) })}
            />
            <StatCard
              label={t('crm.stat_new')}
              value={data.new_this_month}
              icon={UserPlus}
              color="secondary"
              description={t('crm.stat_new_hint')}
            />
            <StatCard
              label={t('crm.stat_pending')}
              value={data.pending_approvals}
              icon={UserCheck}
              color={pendingColor}
              to={tenantPath('/admin/users?filter=pending')}
              description={t('crm.stat_pending_hint')}
            />
            <StatCard
              label={t('crm.stat_open_tasks')}
              value={data.open_tasks}
              icon={ClipboardList}
              to={tenantPath('/admin/crm/tasks')}
              description={t('crm.stat_open_tasks_hint', { mine: formatNumber(data.my_tasks.open) })}
            />
            <StatCard
              label={t('crm.stat_overdue')}
              value={data.overdue_tasks}
              icon={TriangleAlert}
              color={overdueColor}
              to={tenantPath('/admin/crm/tasks?status=overdue')}
              description={data.overdue_tasks > 0 ? t('crm.stat_overdue_hint') : t('crm.stat_overdue_none')}
            />
            <StatCard
              label={t('crm.stat_notes')}
              value={data.total_notes}
              icon={StickyNote}
              to={tenantPath('/admin/crm/notes')}
              description={t('crm.stat_notes_hint', { recent: formatNumber(data.notes_last_30_days) })}
            />
            <StatCard
              label={t('crm.stat_tags')}
              value={data.tags_in_use}
              icon={Tag}
              color="secondary"
              to={tenantPath('/admin/crm/tags')}
              description={t('crm.stat_tags_hint', { members: formatNumber(data.tagged_members) })}
            />
          </div>
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Your next tasks */}
          <SectionCard
            title={t('crm.my_tasks_title')}
            description={t('crm.my_tasks_desc')}
            footer={
              data.next_tasks.length > 0 ? (
                <>
                  <Button as={Link} to={tenantPath(myTasksPath)} variant="tertiary" size="sm" endContent={<ChevronRight size={14} aria-hidden="true" />}>
                    {t('crm.my_tasks_all')}
                  </Button>
                  {moreMyTasks > 0 && (
                    <span className="text-xs text-muted">{t('crm.my_tasks_more', { more: formatNumber(moreMyTasks) })}</span>
                  )}
                </>
              ) : (
                <Button as={Link} to={tenantPath('/admin/crm/tasks')} variant="tertiary" size="sm" endContent={<ChevronRight size={14} aria-hidden="true" />}>
                  {t('crm.tasks_browse')}
                </Button>
              )
            }
          >
            {data.next_tasks.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary px-4 py-8 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-success/10 text-success">
                  <ListChecks size={22} aria-hidden="true" />
                </span>
                <p className="font-medium text-foreground">{t('crm.my_tasks_empty')}</p>
                <p className="text-sm text-muted">{t('crm.my_tasks_empty_hint', { open: formatNumber(data.open_tasks) })}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="crm-next-tasks">
                {data.next_tasks.map((task) => (
                  <li key={task.id}>
                    <Link
                      to={tenantPath(myTasksPath)}
                      className="flex items-start gap-3 rounded-xl border border-divider/70 bg-surface-secondary px-3 py-2.5 transition-colors hover:border-accent/40 hover:bg-accent/5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{task.title}</span>
                        {task.user_name && (
                          <span className="block truncate text-xs text-muted">{t('crm.task_about', { name: task.user_name })}</span>
                        )}
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {(task.priority === 'urgent' || task.priority === 'high') && (
                          <Chip size="sm" variant="soft" color={PRIORITY_COLOR[task.priority]}>{t(`crm.priority_${task.priority}`)}</Chip>
                        )}
                        {dueChip(task)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* Recent notes */}
          <SectionCard
            title={t('crm.recent_notes_title')}
            description={t('crm.recent_notes_desc')}
            footer={
              <Button as={Link} to={tenantPath('/admin/crm/notes')} variant="tertiary" size="sm" endContent={<ChevronRight size={14} aria-hidden="true" />}>
                {t('crm.recent_notes_all')}
              </Button>
            }
          >
            {data.recent_notes.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-xl bg-surface-secondary px-4 py-8 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
                  <StickyNote size={22} aria-hidden="true" />
                </span>
                <p className="font-medium text-foreground">{t('crm.recent_notes_empty')}</p>
                <p className="text-sm text-muted">{t('crm.recent_notes_empty_hint')}</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2" data-testid="crm-recent-notes">
                {data.recent_notes.map((note) => {
                  const ago = formatAgo(note.created_at);
                  const name = note.user_name ?? '';
                  return (
                    <li key={note.id} className="rounded-xl border border-divider/70 bg-surface-secondary px-3 py-2.5">
                      <div className="flex items-start gap-3">
                        <Avatar
                          src={note.user_avatar ? resolveAvatarUrl(note.user_avatar) : undefined}
                          name={name}
                          size="sm"
                          className="mt-0.5 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <Link
                              to={tenantPath(`/admin/crm/notes?user_id=${note.user_id}`)}
                              aria-label={t('crm.note_member_notes', { name })}
                              className="truncate text-sm font-medium text-foreground hover:text-accent hover:underline"
                            >
                              {name}
                            </Link>
                            <Chip size="sm" variant="soft" color={CATEGORY_COLOR[note.category] ?? 'default'}>
                              {t(`crm.category_${note.category}`)}
                            </Chip>
                            {note.is_pinned && (
                              <Chip size="sm" variant="soft" color="warning" startContent={<Pin size={12} aria-hidden="true" />}>
                                {t('crm.pin_button_pinned')}
                              </Chip>
                            )}
                          </div>
                          <p className="mt-1 line-clamp-2 break-words text-sm text-muted [overflow-wrap:anywhere]">{note.excerpt}</p>
                          <p className="mt-1 text-xs text-muted">
                            {note.author_name}
                            {note.author_name && ago ? ' · ' : ''}
                            {ago && <time dateTime={note.created_at}>{ago}</time>}
                          </p>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* CRM tools */}
        <section aria-labelledby="crm-tools-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="crm-tools-heading" className="text-lg font-semibold text-foreground">{t('crm.tools_title')}</h2>
            <p className="text-sm text-muted">{t('crm.tools_desc')}</p>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <li key={tool.key}>
                  <Link
                    to={tenantPath(tool.path)}
                    className="group flex h-full items-start gap-3 rounded-2xl border border-divider/70 bg-surface p-4 shadow-sm shadow-black/[0.03] transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset ring-current/10 ${tool.accentClassName}`}>
                      <Icon size={20} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-foreground">{t(tool.labelKey)}</span>
                      <span className="mt-0.5 block text-sm text-muted">{t(tool.descKey)}</span>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" className="mt-1 shrink-0 text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default CrmDashboard;
