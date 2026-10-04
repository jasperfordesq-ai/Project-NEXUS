// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Chip, Spinner, Input, Select, SelectItem, useDisclosure, Code, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tabs, Tab, Tooltip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Checkbox } from '@/components/ui';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Separator } from '@/components/ui';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Play from 'lucide-react/icons/play';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Search from 'lucide-react/icons/search';
import ExternalLink from 'lucide-react/icons/external-link';
import HardDrive from 'lucide-react/icons/hard-drive';
import LayoutGrid from 'lucide-react/icons/layout-grid';
import Briefcase from 'lucide-react/icons/briefcase';
import Activity from 'lucide-react/icons/activity';
import AlertOctagon from 'lucide-react/icons/octagon-alert';
import StopCircle from 'lucide-react/icons/circle-stop';
import Trash from 'lucide-react/icons/trash-2';
import Bot from 'lucide-react/icons/bot';
import Gauge from 'lucide-react/icons/gauge';
import Zap from 'lucide-react/icons/zap';
import ShieldCheck from 'lucide-react/icons/shield-check';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast, useAuth } from '@/contexts';
import { usePusherOptional } from '@/contexts/PusherContext';
import { isPlatformSuperAdminUser } from '@/lib/access';
import { formatPercentValue, formatUnit, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../../components/PageHeader';
import { ConfirmModal } from '../../../components/ConfirmModal';
import {
  adminPrerender,
  type PrerenderSummary,
  type PrerenderInventoryItem,
  type PrerenderCoverageRow,
  type PrerenderJob,
  type PrerenderEvent,
  type PrerenderFailure,
  type PrerenderInspect,
  type PrerenderAnalytics,
  type PrerenderHealth,
  type PrerenderAuditEntry,
  type PrerenderTtlInspect,
} from '../../../api/adminApi';
import { GuidedWorkflows, OperatorGuide } from './OperatorGuide';
import { PurgeControls } from './PurgeControls';
import { TenantSafetyTab } from './TenantSafetyTab';
import {
  formatAge,
  formatBytes,
  formatTs,
  httpStatusColor,
  jobStatusColor,
  seoGradeColor,
  SEO_GRADE_TEXT_CLASSES,
  stalenessColor,
} from './prerenderFormat';
import type { ToastShape } from './prerenderAdminTypes';

// Backend protocol token. The phrase shown and typed by the operator is
// localized; only the confirmed request payload uses this invariant value.
const RESET_ALL_API_CONFIRMATION = 'RESET ALL SNAPSHOTS';
const PRERENDER_TAB_KEYS = new Set([
  'overview',
  'tenant-safety',
  'inventory',
  'coverage',
  'jobs',
  'analytics',
  'events',
  'failures',
  'history',
]);

/**
 * Prerender Admin — control panel for the bot-only prerender engine.
 *
 * Tabs:
 *   Overview   — health, summary, last run, force-refresh actions
 *   Inventory  — every rendered HTML file with age/staleness, deep inspect drawer
 *   Coverage   — per-tenant expected-vs-rendered route matrix
 *   Jobs       — queued/running/completed force-refresh job history
 *   Events     — JSONL event stream (start/supersede/success/fail/partial)
 *   Failures   — recent failed cache paths inside the backoff window
 *
 * Read endpoints require admin; enqueue/cancel require super_admin and are
 * also blocked client-side via the disabled state derived from useAuth().
 */


// ─── helpers ───────────────────────────────────────────────────────────────

// ─── main component ────────────────────────────────────────────────────────

/**
 * Shared cross-tab signal that a job state changed in realtime. Tabs key
 * their reload effect off this, replacing the old polling.
 */
function useJobUpdates(): { lastUpdate: number; live: boolean } {
  const pusher = usePusherOptional();
  const [lastUpdate, setLastUpdate] = useState(0);
  const [live, setLive] = useState(false);
  const client = pusher?.client;
  const connected = pusher?.isConnected ?? false;

  useEffect(() => {
    if (!client || !connected) {
      setLive(false);
      return;
    }
    const ch = client.subscribe('private-admin-prerender');
    const onSub = () => setLive(true);
    const onErr = () => setLive(false);
    const onEvent = () => setLastUpdate(Date.now());
    ch.bind('pusher:subscription_succeeded', onSub);
    ch.bind('pusher:subscription_error', onErr);
    ch.bind('job.updated', onEvent);
    return () => {
      ch.unbind('job.updated', onEvent);
      ch.unbind('pusher:subscription_succeeded', onSub);
      ch.unbind('pusher:subscription_error', onErr);
      try { client.unsubscribe('private-admin-prerender'); } catch { /* noop */ }
    };
  }, [client, connected]);

  return { lastUpdate, live };
}

export function PrerenderAdmin() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender' });
  usePageTitle(t('title'));
  const toast = useToast();
  const { user } = useAuth();
  // PLATFORM super-admin only — the engine runs cross-tenant operations.
  // is_tenant_super_admin is intentionally NOT accepted (matches the backend
  // requirePlatformSuperAdmin gate and the private-admin-prerender channel auth).
  const isSuperAdmin = isPlatformSuperAdminUser(user);

  // Tell tenant admins WHY they can't use the action buttons. The greyed-out
  // state alone was confusing — buttons just appeared broken.
  const readOnly = !isSuperAdmin;

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab') || 'overview';
  const tab = PRERENDER_TAB_KEYS.has(requestedTab) ? requestedTab : 'overview';
  const coverageFilter = searchParams.get('tenant');
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [resetting, setResetting] = useState(false);

  const closeReset = useCallback(() => {
    if (resetting) return;
    setResetOpen(false);
    // Never retain destructive confirmation across modal sessions.
    setResetConfirmation('');
  }, [resetting]);

  // URL state is the single source of truth. This avoids the two-effect race
  // where a tab click could be overwritten by the previous search params and
  // makes browser back/forward navigation deterministic.
  const navigateAdmin = useCallback((nextTab: string, tenant?: string | null, replace = false) => {
    const safeTab = PRERENDER_TAB_KEYS.has(nextTab) ? nextTab : 'overview';
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (safeTab === 'overview') next.delete('tab'); else next.set('tab', safeTab);
      if (tenant !== undefined) {
        if (tenant) next.set('tenant', tenant); else next.delete('tenant');
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  const clearCoverageFilter = useCallback(() => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('tenant');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const { lastUpdate, live } = useJobUpdates();

  const resetAll = async () => {
    setResetting(true);
    try {
      const response = await adminPrerender.resetAll(RESET_ALL_API_CONFIRMATION);
      if (response.data) {
        toast.success(t('reset_all.queued', {
          id: response.data.job_id,
          tenants: response.data.tenant_count,
          routes: response.data.planned_routes,
        }));
        setResetOpen(false);
        setResetConfirmation('');
        navigateAdmin('jobs');
      }
    } catch {
      toast.error(t('reset_all.failed'));
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={(
          <Button
            variant="danger"
            startContent={<RotateCcw size={16} />}
            onPress={() => {
              setResetConfirmation('');
              setResetOpen(true);
            }}
            isDisabled={!isSuperAdmin}
          >
            {t('reset_all.button')}
          </Button>
        )}
      />

      <Modal isOpen={resetOpen} onClose={closeReset}>
        <ModalContent>
          <ModalHeader>{t('reset_all.title')}</ModalHeader>
          <ModalBody className="gap-4">
            <p className="text-sm text-muted">{t('reset_all.description')}</p>
            <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
              {t('reset_all.safety')}
            </div>
            <Input
              label={t('reset_all.confirmation_label')}
              description={t('reset_all.confirmation_help', { phrase: t('reset_all.confirmation_phrase') })}
              value={resetConfirmation}
              onValueChange={setResetConfirmation}
              autoComplete="off"
              isDisabled={resetting}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeReset} isDisabled={resetting}>
              {t('reset_all.cancel')}
            </Button>
            <Button
              variant="danger"
              startContent={<RotateCcw size={16} />}
              onPress={resetAll}
              isLoading={resetting}
              isDisabled={resetConfirmation !== t('reset_all.confirmation_phrase')}
            >
              {t('reset_all.confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {readOnly && (
        <div className="mb-3 rounded-md border border-warning/30 bg-warning/10 text-warning-soft-foreground px-3 py-2 text-sm">
          {t('readonly.prefix')}{' '}
          <strong>{t('readonly.role')}</strong>{' '}
          {t('readonly.suffix')}
        </div>
      )}

      <HealthBanner isSuperAdmin={isSuperAdmin} toast={toast} lastUpdate={lastUpdate} />
      <OperatorGuide />
      <GuidedWorkflows
        onSelect={(nextTab) => navigateAdmin(nextTab)}
      />

      <div className="flex justify-end mb-2">
        <Chip
          size="sm"
          variant="soft"
          color={live ? 'success' : 'default'}
          startContent={<span className={`inline-block w-2 h-2 rounded-full ${live ? 'bg-success animate-pulse' : 'bg-muted'}`} />}
        >
          {live ? t('live_connected') : t('polling_fallback')}
        </Chip>
      </div>

      <Tabs
        aria-label={t('tabs_aria')}
        scrollAffordance
        selectedKey={tab}
        onSelectionChange={(k) => navigateAdmin(String(k))}
        variant="underlined"
        classNames={{ tabList: 'mb-4' }}
      >
        <Tab
          key="overview"
          title={<span className="flex items-center gap-2"><Activity size={16} />{t('tabs.overview')}</span>}
        >
          <OverviewTab isSuperAdmin={isSuperAdmin} toast={toast} lastUpdate={lastUpdate} live={live} />
        </Tab>
        <Tab
          key="tenant-safety"
          title={<span className="flex items-center gap-2"><ShieldCheck size={16} />{t('tabs.tenant_safety')}</span>}
        >
          <TenantSafetyTab
            isSuperAdmin={isSuperAdmin}
            toast={toast}
            onOpenInventory={(slug) => navigateAdmin('inventory', slug)}
          />
        </Tab>
        <Tab
          key="inventory"
          title={<span className="flex items-center gap-2"><HardDrive size={16} />{t('tabs.inventory')}</span>}
        >
          <InventoryTab presetTenant={coverageFilter} onPresetConsumed={clearCoverageFilter} />
        </Tab>
        <Tab
          key="coverage"
          title={<span className="flex items-center gap-2"><LayoutGrid size={16} />{t('tabs.coverage')}</span>}
        >
          <CoverageTab
            isSuperAdmin={isSuperAdmin}
            toast={toast}
            onDrillDown={(slug) => navigateAdmin('inventory', slug)}
          />
        </Tab>
        <Tab
          key="jobs"
          title={<span className="flex items-center gap-2"><Briefcase size={16} />{t('tabs.jobs')}</span>}
        >
          <JobsTab isSuperAdmin={isSuperAdmin} toast={toast} lastUpdate={lastUpdate} live={live} />
        </Tab>
        <Tab
          key="analytics"
          title={<span className="flex items-center gap-2"><Bot size={16} />{t('tabs.analytics')}</span>}
        >
          <AnalyticsTab />
        </Tab>
        <Tab
          key="events"
          title={<span className="flex items-center gap-2"><Activity size={16} />{t('tabs.events')}</span>}
        >
          <EventsTab />
        </Tab>
        <Tab
          key="failures"
          title={<span className="flex items-center gap-2"><AlertOctagon size={16} />{t('tabs.failures')}</span>}
        >
          <FailuresTab />
        </Tab>
        <Tab
          key="history"
          title={<span className="flex items-center gap-2"><Clock size={16} />{t('tabs.history')}</span>}
        >
          <AuditTab />
        </Tab>
      </Tabs>
    </div>
  );
}

export default PrerenderAdmin;

// ─── Overview ──────────────────────────────────────────────────────────────

function OverviewTab({ isSuperAdmin, toast, lastUpdate, live }: { isSuperAdmin: boolean; toast: ToastShape; lastUpdate: number; live: boolean }) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.overview' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const [summary, setSummary] = useState<PrerenderSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [enqueuing, setEnqueuing] = useState(false);
  const [tenantSlug, setTenantSlug] = useState('');
  const [routes, setRoutes] = useState('');
  const [force, setForce] = useState(false);
  const [dryRun, setDryRun] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminPrerender.getSummary()
      .then((res) => { if (res.data) setSummary(res.data as PrerenderSummary); })
      .catch(() => toast.error(t('errors.load_summary')))
      .finally(() => setLoading(false));
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);
  // Reload on Pusher signal; fall back to 30s poll ONLY when realtime is down,
  // otherwise we double-fetch every Pusher event.
  useEffect(() => { if (lastUpdate > 0) load(); }, [lastUpdate, load]);
  useEffect(() => {
    if (live) return;
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, [load, live]);

  const enqueue = async () => {
    setEnqueuing(true);
    try {
      const res = await adminPrerender.enqueueJob({
        tenant_slug: tenantSlug.trim() || undefined,
        routes: routes.trim() || undefined,
        force,
        dry_run: dryRun,
      });
      if (res.data) {
        toast.success(t('messages.job_queued', { id: res.data.job_id }));
        setTenantSlug('');
        setRoutes('');
        load();
      }
    } catch {
      toast.error(t('errors.enqueue_job'));
    } finally {
      setEnqueuing(false);
    }
  };

  const downloadMetrics = async () => {
    try {
      await adminPrerender.downloadMetrics();
    } catch {
      toast.error(t('errors.download_metrics'));
    }
  };

  if (loading && !summary) {
    return <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>;
  }
  if (!summary) return <p className="text-muted">{t('empty_summary')}</p>;

  const healthBadge = summary.plan_error_count > 0
    ? <Chip color="danger" variant="soft">{summary.plan_error_count} × {tAdmin('advanced.prerender.sitemap_explorer.error')}</Chip>
    : summary.inventory_truncated
      ? <Chip color="danger" variant="soft">{tAdmin('advanced.prerender.inventory.truncated', { count: summary.inventory_hard_cap })}</Chip>
    : !summary.cache_readable
    ? <Chip color="danger" variant="soft">{t('health.cache_unreachable')}</Chip>
    : !summary.cache_writable
      ? <Chip color="danger" variant="soft">{t('health.cache_read_only')}</Chip>
    : summary.missing_count > 0
      ? <Chip color="warning" variant="soft">{t('health.missing', { count: summary.missing_count })}</Chip>
      : summary.stale_count > 0
        ? <Chip color="warning" variant="soft">{t('health.stale', { count: summary.stale_count })}</Chip>
        : <Chip color="success" variant="soft">{t('health.healthy')}</Chip>;

  return (
    <div className="space-y-4">
      {(summary.plan_error_count > 0 || summary.inventory_truncated) && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger-foreground">
          {summary.plan_error_count > 0 && (
            <p>{summary.plan_error_count} × {tAdmin('advanced.prerender.sitemap_explorer.error')}</p>
          )}
          {summary.inventory_truncated && (
            <p>{tAdmin('advanced.prerender.inventory.truncated', { count: summary.inventory_hard_cap })}</p>
          )}
        </div>
      )}
      {/* KPI grid — 11 cards, breakpoints chosen so every row fills cleanly. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 xl:grid-cols-4 gap-3">
        <KpiCard label={t('kpi.coverage')} value={formatPercentValue(summary.coverage_pct)} hint={`${summary.expected_rendered_count} / ${summary.expected_count}`} />
        <KpiCard label={t('kpi.missing')} value={summary.missing_count} hint={t('hints.tenants_routes', { tenants: summary.tenant_count, routes: summary.expected_routes.length })} tone={summary.missing_count > 0 ? 'warning' : 'default'} />
        <KpiCard label={t('kpi.unexpected')} value={summary.unexpected_count} hint={t('hints.unexpected')} tone={summary.unexpected_count > 0 ? 'warning' : 'default'} />
        <KpiCard label={t('kpi.age_stale')} value={summary.stale_count} hint={t('hints.aging', { count: summary.warn_count })} tone={summary.stale_count > 0 ? 'warning' : 'default'} />
        <KpiCard label={t('kpi.content_stale')} value={summary.content_stale_count} hint={t('hints.content_stale')} tone={summary.content_stale_count > 0 ? 'warning' : 'default'} />
        <KpiCard label={t('kpi.asset_broken')} value={summary.asset_invalid_count} hint={t('hints.asset_broken')} tone={summary.asset_invalid_count > 0 ? 'danger' : 'default'} />
        <KpiCard label={t('kpi.cache_size')} value={formatBytes(summary.total_size_bytes)} hint={t('hints.cache_age', { oldest: formatAge(summary.oldest_age_s), newest: formatAge(summary.newest_age_s) })} />
        <KpiCard label={t('kpi.queued_jobs')} value={summary.queued_jobs} hint={t('hints.active_jobs', { count: summary.active_jobs })} tone={summary.active_jobs > 0 ? 'primary' : 'default'} />
        <KpiCard label={t('kpi.recent_failures')} value={summary.recent_failures} hint={t('hints.backoff_window')} tone={summary.recent_failures > 0 ? 'danger' : 'default'} />
        <KpiCard label={t('kpi.build_commit')} value={summary.build_commit || '—'} hint={summary.last_event_at ? t('hints.event_at', { time: formatTs(summary.last_event_at) }) : t('hints.no_events')} />
        <KpiCard label={t('kpi.status')} value={healthBadge} hint={summary.cache_path} />
        <KpiCard
          label={t('kpi.metrics')}
          value={
            <>
              <Button size="sm" variant="tertiary" onPress={downloadMetrics}>
                {t('actions.download_metrics')}
              </Button>
            </>
          }
          hint={t('hints.prometheus')}
        />
      </div>

      {/* Last run */}
      {summary.last_run && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('last_run')}</h3>
          </CardHeader>
          <CardBody>
            <Code className="text-xs whitespace-pre-wrap block">
              {JSON.stringify(summary.last_run, null, 2)}
            </Code>
          </CardBody>
        </Card>
      )}

      {/* Force refresh */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Play size={18} />{t('force_refresh.title')}
          </h3>
          {!isSuperAdmin && (
            <Chip color="warning" variant="soft" size="sm">{t('super_admin_only')}</Chip>
          )}
        </CardHeader>
        <CardBody className="gap-3">
          <p className="text-sm text-muted">
            {t('force_refresh.description')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label={t('fields.tenant_slug')}
              placeholder={t('placeholders.tenant_slug')}
              variant="secondary"
              value={tenantSlug}
              onValueChange={setTenantSlug}
              isDisabled={!isSuperAdmin}
            />
            <Input
              label={t('fields.routes')}
              placeholder={t('placeholders.routes')}
              variant="secondary"
              value={routes}
              onValueChange={setRoutes}
              isDisabled={!isSuperAdmin}
            />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-6">
            <Switch isSelected={force} onValueChange={setForce} isDisabled={!isSuperAdmin}>
              <span className="text-sm">{t('force_refresh.force')}</span>
            </Switch>
            <Switch isSelected={dryRun} onValueChange={setDryRun} isDisabled={!isSuperAdmin}>
              <span className="text-sm">{t('force_refresh.dry_run')}</span>
            </Switch>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={load}
              isDisabled={loading}
            >
              {t('actions.refresh')}
            </Button>
            <Button
              startContent={<Play size={16} />}
              onPress={enqueue}
              isLoading={enqueuing}
              isDisabled={!isSuperAdmin}
            >
              {t('actions.queue_job')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <FreshnessControls isSuperAdmin={isSuperAdmin} toast={toast} onActed={load} />
      <TtlInspector />
      <SitemapExplorer />
      <PurgeControls isSuperAdmin={isSuperAdmin} toast={toast} onActed={load} />
    </div>
  );
}

// ─── Overview helpers: freshness + purge action cards ──────────────────────

function FreshnessControls({
  isSuperAdmin, toast, onActed,
}: { isSuperAdmin: boolean; toast: ToastShape; onActed: () => void }) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.freshness' });
  const [autoRecLoading, setAutoRecLoading] = useState(false);
  const [autoRecOutput, setAutoRecOutput] = useState<string>('');
  const [driftLoading, setDriftLoading] = useState(false);
  const [driftOutput, setDriftOutput] = useState<string>('');
  const [purgeLoading, setPurgeLoading] = useState(false);
  const [confirmPurgeOpen, setConfirmPurgeOpen] = useState(false);
  const [purgeOutput, setPurgeOutput] = useState<{ deleted_total: number; by_tenant: Record<string, string[]>; dry_run: boolean; preview_token?: string | null } | null>(null);
  const [purgePreviewToken, setPurgePreviewToken] = useState<string | null>(null);

  const runPurgeUnexpected = async (apply: boolean) => {
    setPurgeLoading(true);
    setPurgeOutput(null);
    try {
      const res = await adminPrerender.purgeUnexpected(apply, apply ? purgePreviewToken ?? undefined : undefined);
      if (res.data) {
        setPurgeOutput(res.data);
        setPurgePreviewToken(apply ? null : (res.data.preview_token ?? null));
        toast.success(apply
          ? t('messages.purged_ungated', { count: res.data.deleted_total, tenants: Object.keys(res.data.by_tenant).length })
          : t('messages.purge_dry_run', { count: res.data.deleted_total }));
        if (apply) onActed();
      }
    } catch {
      if (apply) setPurgePreviewToken(null);
      toast.error(t('errors.purge_unexpected'));
    } finally {
      setPurgeLoading(false);
      if (apply) setConfirmPurgeOpen(false);
    }
  };

  const runAutoRecache = async (apply: boolean) => {
    setAutoRecLoading(true);
    setAutoRecOutput('');
    try {
      const res = await adminPrerender.triggerAutoRecache(apply);
      if (res.data) {
        setAutoRecOutput(res.data.output || t('no_output'));
        toast.success(apply ? t('messages.auto_recache_applied') : t('messages.auto_recache_dry_run'));
        if (apply) onActed();
      }
    } catch {
      toast.error(t('errors.auto_recache'));
    } finally {
      setAutoRecLoading(false);
    }
  };

  const runDriftDetect = async (apply: boolean) => {
    setDriftLoading(true);
    setDriftOutput('');
    try {
      const res = await adminPrerender.triggerDetectDrift(apply);
      if (res.data) {
        setDriftOutput(res.data.output || t('no_output'));
        toast.success(apply ? t('messages.drift_applied') : t('messages.drift_dry_run'));
        if (apply) onActed();
      }
    } catch {
      toast.error(t('errors.drift_detection'));
    } finally {
      setDriftLoading(false);
    }
  };

  return (
    <>
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Zap size={18} />{t('title')}
        </h3>
      </CardHeader>
      <CardBody className="gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <p className="font-medium flex items-center gap-2">
              <Gauge size={16} className="text-warning" />{t('auto_recache.title')}
            </p>
            <p className="text-sm text-muted">
              {t('auto_recache.description')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="tertiary"
                onPress={() => runAutoRecache(false)}
                isLoading={autoRecLoading}
                isDisabled={!isSuperAdmin}
                size="sm"
              >
                {t('actions.dry_run')}
              </Button>
              <Button
                onPress={() => runAutoRecache(true)}
                isLoading={autoRecLoading}
                isDisabled={!isSuperAdmin}
                size="sm"
                startContent={<Play size={14} />}
              >
                {t('actions.apply')}
              </Button>
            </div>
            {autoRecOutput && (
              <Code className="text-xs whitespace-pre-wrap block max-h-48 overflow-auto">
                {autoRecOutput}
              </Code>
            )}
          </div>

          <div className="space-y-2">
            <p className="font-medium flex items-center gap-2">
              <Search size={16} className="text-accent" />{t('drift.title')}
            </p>
            <p className="text-sm text-muted">
              {t('drift.description')}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="tertiary"
                onPress={() => runDriftDetect(false)}
                isLoading={driftLoading}
                isDisabled={!isSuperAdmin}
                size="sm"
              >
                {t('actions.dry_run')}
              </Button>
              <Button
                onPress={() => runDriftDetect(true)}
                isLoading={driftLoading}
                isDisabled={!isSuperAdmin}
                size="sm"
                startContent={<Play size={14} />}
              >
                {t('actions.apply')}
              </Button>
            </div>
            {driftOutput && (
              <Code className="text-xs whitespace-pre-wrap block max-h-48 overflow-auto">
                {driftOutput}
              </Code>
            )}
          </div>
        </div>

        <Separator className="my-2" />

        <div className="space-y-2">
          <p className="font-medium flex items-center gap-2">
            <Trash size={16} className="text-danger" />{t('purge_ungated.title')}
          </p>
          <p className="text-sm text-muted">
            {t('purge_ungated.description')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="tertiary"
              onPress={() => runPurgeUnexpected(false)}
              isLoading={purgeLoading}
              isDisabled={!isSuperAdmin}
              size="sm"
            >
              {t('actions.dry_run')}
            </Button>
            <Button variant="danger"
              onPress={() => setConfirmPurgeOpen(true)}
              isLoading={purgeLoading}
              isDisabled={!isSuperAdmin || !purgePreviewToken}
              size="sm"
              startContent={<Trash size={14} />}
            >
              {t('actions.apply')}
            </Button>
          </div>
          {purgeOutput && (
            <div className="space-y-1">
              <p className="text-sm font-medium">
                {purgeOutput.dry_run
                  ? t('result.would_delete', { count: purgeOutput.deleted_total, tenants: Object.keys(purgeOutput.by_tenant).length })
                  : t('result.deleted', { count: purgeOutput.deleted_total, tenants: Object.keys(purgeOutput.by_tenant).length })}
              </p>
              {Object.keys(purgeOutput.by_tenant).length > 0 && (
                <Code className="text-xs whitespace-pre-wrap block max-h-64 overflow-auto">
                  {Object.entries(purgeOutput.by_tenant)
                    .map(([slug, routes]) => `${slug} (${routes.length}):\n  ${routes.join('\n  ')}`)
                    .join('\n\n')}
                </Code>
              )}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
    <ConfirmModal
      isOpen={confirmPurgeOpen}
      onClose={() => setConfirmPurgeOpen(false)}
      onConfirm={() => runPurgeUnexpected(true)}
      title={t('purge_ungated.confirm_title')}
      message={t('purge_ungated.confirm_message')}
      confirmLabel={t('actions.apply')}
      confirmColor="danger"
      isLoading={purgeLoading}
    />
    </>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'default' | 'primary' | 'warning' | 'danger';
}) {
  const toneClass = tone === 'warning' ? 'text-warning'
    : tone === 'danger' ? 'text-danger'
    : tone === 'primary' ? 'text-accent'
    : '';
  return (
    <Card className="p-2">
      <CardBody className="py-3">
        <p className="text-xs text-muted uppercase tracking-wide">{label}</p>
        <div className={`text-2xl font-semibold ${toneClass} break-words`}>{value}</div>
        {hint && <p className="text-xs text-muted mt-1 break-all">{hint}</p>}
      </CardBody>
    </Card>
  );
}

// ─── Inventory ─────────────────────────────────────────────────────────────

function InventoryTab({ presetTenant, onPresetConsumed }: { presetTenant: string | null; onPresetConsumed: () => void }) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.inventory' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = isPlatformSuperAdminUser(user);
  const [items, setItems] = useState<PrerenderInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [hardCap, setHardCap] = useState(0);
  const [filter, setFilter] = useState('');
  const [stalenessFilter, setStalenessFilter] = useState<string>('all');
  const [issueFilter, setIssueFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [tenant, setTenant] = useState(() => presetTenant ?? '');
  const [appliedTenant, setAppliedTenant] = useState(() => presetTenant ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  // Coverage tab may have deep-linked here with a tenant preset; consume once.
  useEffect(() => {
    if (presetTenant) {
      setTenant(presetTenant);
      setAppliedTenant(presetTenant);
      onPresetConsumed();
    }
  }, [presetTenant, onPresetConsumed]);
  const [inspecting, setInspecting] = useState<PrerenderInspect | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState(false);
  const inspectModal = useDisclosure();
  const inventoryRequest = useRef(0);
  const inspectRequest = useRef(0);

  const load = useCallback(() => {
    const requestId = ++inventoryRequest.current;
    setLoading(true);
    setLoadError(false);
    // A tenant switch must never leave the previous tenant's actionable rows
    // visible while the replacement request is in flight.
    setItems([]);
    setSelected(new Set());
    setTruncated(false);
    setHardCap(0);
    adminPrerender.getInventory(appliedTenant || undefined)
      .then((res) => {
        if (requestId !== inventoryRequest.current || !res.data) return;
        setItems(res.data.items);
        setTruncated(res.data.truncated);
        setHardCap(res.data.hard_cap);
        setSelected(new Set());
      })
      .catch(() => {
        if (requestId === inventoryRequest.current) {
          setItems([]);
          setSelected(new Set());
          setTruncated(false);
          setHardCap(0);
          setLoadError(true);
          toast.error(t('errors.load'));
        }
      })
      .finally(() => {
        if (requestId === inventoryRequest.current) setLoading(false);
      });
  }, [t, appliedTenant, toast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    let out = items;
    if (stalenessFilter !== 'all') {
      out = out.filter((i) => i.staleness === stalenessFilter);
    }
    if (issueFilter === 'content_stale') out = out.filter((i) => i.content_stale);
    if (issueFilter === 'asset_invalid') out = out.filter((i) => i.asset_issues.length > 0);
    if (statusFilter === '200')      out = out.filter((i) => i.http_status === 200);
    else if (statusFilter === 'non-200') out = out.filter((i) => i.http_status !== 200);
    if (filter.trim()) {
      const needle = filter.trim().toLowerCase();
      out = out.filter(
        (i) => i.route.toLowerCase().includes(needle) || i.host.toLowerCase().includes(needle),
      );
    }
    return out;
  }, [items, filter, stalenessFilter, issueFilter, statusFilter]);

  /**
   * Bulk-recache the currently-selected rows. Groups by host → tenant so each
   * tenant gets a single enqueue with a comma-joined route list at NORMAL
   * priority (user-initiated, not background).
   */
  const bulkRecache = async () => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      const byTenant = new Map<number, string[]>();
      // Selection may span filter changes; resolve against the authoritative
      // loaded inventory so hidden selections are not silently skipped.
      const itemMap = new Map(items.map((i) => [i.cache_path, i] as const));

      for (const cachePath of selected) {
        const it = itemMap.get(cachePath);
        if (!it) continue;
        if (it.tenant_id == null) continue;
        const routes = byTenant.get(it.tenant_id) ?? [];
        routes.push(it.tenant_route || it.route);
        byTenant.set(it.tenant_id, routes);
      }

      let invalidated = 0;
      for (const [tenantId, routes] of byTenant) {
        const uniqueRoutes = Array.from(new Set(routes));
        if (uniqueRoutes.length === 0) continue;
        const res = await adminPrerender.invalidate({
          tenant_id: tenantId,
          routes: uniqueRoutes,
          recache: true,
        });
        invalidated += res.data?.invalidated ?? 0;
      }

      toast.success(t('messages.bulk_recache', { count: invalidated }));
      setSelected(new Set());
      load();
    } catch {
      toast.error(t('errors.bulk_recache'));
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleSelect = (cachePath: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cachePath)) next.delete(cachePath);
      else next.add(cachePath);
      return next;
    });
  };
  const toggleAllVisible = () => {
    setSelected((prev) => {
      const visible = filtered.slice(0, 500).map((r) => r.cache_path);
      const allSelected = visible.every((p) => prev.has(p));
      if (allSelected) {
        const next = new Set(prev);
        for (const p of visible) next.delete(p);
        return next;
      }
      const next = new Set(prev);
      for (const p of visible) next.add(p);
      return next;
    });
  };

  const openInspect = async (item: PrerenderInventoryItem) => {
    const requestId = ++inspectRequest.current;
    setInspecting(null);
    setInspectError(false);
    setInspectLoading(true);
    inspectModal.onOpen();
    try {
      const res = await adminPrerender.inspect(item.cache_path);
      if (requestId === inspectRequest.current && res.data) setInspecting(res.data as PrerenderInspect);
    } catch {
      if (requestId === inspectRequest.current) {
        setInspecting(null);
        setInspectError(true);
        toast.error(t('errors.inspect'));
      }
    } finally {
      if (requestId === inspectRequest.current) setInspectLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="gap-3 flex-row flex-wrap items-end">
          <Input
            label={t('filters.filter')}
            placeholder={t('filters.filter_placeholder')}
            variant="secondary"
            value={filter}
            onValueChange={setFilter}
            startContent={<Search size={14} />}
            className="max-w-xs"
          />
          <Select
            label={t('filters.staleness')}
            variant="secondary"
            selectedKeys={[stalenessFilter]}
            onSelectionChange={(s) => setStalenessFilter(Array.from(s)[0] as string)}
            className="max-w-[180px]"
          >
            <SelectItem key="all" id="all">{t('filters.all')}</SelectItem>
            <SelectItem key="fresh" id="fresh">{t('filters.fresh')}</SelectItem>
            <SelectItem key="warn" id="warn">{t('filters.aging')}</SelectItem>
            <SelectItem key="stale" id="stale">{t('filters.stale')}</SelectItem>
          </Select>
          <Select
            label={t('filters.issue')}
            variant="secondary"
            selectedKeys={[issueFilter]}
            onSelectionChange={(s) => setIssueFilter(Array.from(s)[0] as string)}
            className="max-w-[180px]"
          >
            <SelectItem key="all" id="all">{t('filters.all')}</SelectItem>
            <SelectItem key="content_stale" id="content_stale">{t('filters.content_drifted')}</SelectItem>
            <SelectItem key="asset_invalid" id="asset_invalid">{t('filters.asset_broken')}</SelectItem>
          </Select>
          <Select
            label={t('filters.status')}
            variant="secondary"
            selectedKeys={[statusFilter]}
            onSelectionChange={(s) => setStatusFilter(Array.from(s)[0] as string)}
            className="max-w-[150px]"
          >
            <SelectItem key="all" id="all">{t('filters.all')}</SelectItem>
            <SelectItem key="200" id="200">{t('filters.status_200')}</SelectItem>
            <SelectItem key="non-200" id="non-200">{t('filters.status_non_200')}</SelectItem>
          </Select>
          <Input
            label={t('filters.tenant_slug')}
            placeholder={t('filters.tenant_placeholder')}
            variant="secondary"
            value={tenant}
            onValueChange={setTenant}
            className="max-w-xs"
          />
          <Button
            variant="tertiary"
            onPress={() => {
              const nextTenant = tenant.trim();
              if (nextTenant === appliedTenant) load();
              else setAppliedTenant(nextTenant);
            }}
            startContent={<RefreshCw size={14} />}
          >
            {t('actions.reload')}
          </Button>
          <span className="text-sm text-muted ml-auto self-center">
            {t('summary', { filtered: filtered.length, total: items.length })}
            {selected.size > 0 && (
              <>
                {' '}
                <span aria-hidden="true">&middot;</span>{' '}
                <span className="text-accent">{t('selected', { count: selected.size })}</span>
              </>
            )}
          </span>
          {selected.size > 0 && isSuperAdmin && (
            <Button
              startContent={<Play size={14} />}
              onPress={bulkRecache}
              isLoading={bulkLoading}
            >
              {t('actions.recache_selected', { count: selected.size })}
            </Button>
          )}
        </CardBody>
      </Card>

      {truncated && (
        <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          {t('truncated', { count: hardCap })}
        </div>
      )}

      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger-soft-foreground">
          <span>{t('errors.load')}</span>
          <Button size="sm" variant="tertiary" onPress={load}>{t('actions.reload')}</Button>
        </div>
      ) : loading ? (
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Table aria-label={t('table_aria')} removeWrapper isStriped>
          <TableHeader>
            <TableColumn aria-label={t('actions.select_all_visible')}>
              {isSuperAdmin ? (
                <Checkbox
                  size="sm"
                  isSelected={
                    filtered.length > 0 &&
                    filtered.slice(0, 500).every((r) => selected.has(r.cache_path))
                  }
                  onValueChange={toggleAllVisible}
                  aria-label={t('actions.select_all_visible')}
                />
              ) : ''}
            </TableColumn>
            <TableColumn>{t('columns.host')}</TableColumn>
            <TableColumn>{t('columns.route')}</TableColumn>
            <TableColumn>{t('columns.http')}</TableColumn>
            <TableColumn>{t('columns.size')}</TableColumn>
            <TableColumn>{t('columns.age')}</TableColumn>
            <TableColumn>{t('columns.status')}</TableColumn>
            <TableColumn>{t('columns.actions')}</TableColumn>
          </TableHeader>
          <TableBody emptyContent={t('empty')}>
            {filtered.slice(0, 500).map((it) => (
              <TableRow key={it.cache_path}>
                <TableCell>
                  {isSuperAdmin ? (
                    <Checkbox
                      size="sm"
                      isSelected={selected.has(it.cache_path)}
                      onValueChange={() => toggleSelect(it.cache_path)}
                      aria-label={t('actions.select_snapshot', { path: it.cache_path })}
                    />
                  ) : null}
                </TableCell>
                <TableCell className="text-xs">
                  <span className="block">{it.host}</span>
                  <span className="block text-muted">{it.tenant_slug ?? t('unknown_tenant')}</span>
                </TableCell>
                <TableCell className="text-xs font-mono">{it.route}</TableCell>
                <TableCell>
                  <Chip color={httpStatusColor(it.http_status)} variant="soft" size="sm">
                    {it.http_status}
                  </Chip>
                </TableCell>
                <TableCell className="text-xs">{formatBytes(it.size_bytes)}</TableCell>
                <TableCell className="text-xs">{formatAge(it.age_s)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    <Chip color={stalenessColor(it.staleness)} variant="soft" size="sm">
                      {t(it.staleness === 'warn' ? 'filters.aging' : `filters.${it.staleness}`)}
                    </Chip>
                    {it.content_stale && (
                      <Tooltip content={it.content_stale_reason ?? t('status.content_drifted')}>
                        <Chip color="warning" variant="soft" size="sm">{t('status.content')}</Chip>
                      </Tooltip>
                    )}
                    {it.asset_issues.length > 0 && (
                      <Tooltip content={it.asset_issues.join(', ')}>
                        <Chip color="danger" variant="soft" size="sm">{t('status.asset')}</Chip>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Tooltip content={t('actions.inspect')}>
                      <Button isIconOnly size="sm" variant="tertiary" onPress={() => openInspect(it)} aria-label={t('actions.inspect_snapshot', { path: it.cache_path })}>
                        <Search size={14} />
                      </Button>
                    </Tooltip>
                    <Tooltip content={t('actions.open_live_url')}>
                      <Button
                        isIconOnly
                        size="sm"
                        variant="tertiary"
                        aria-label={t('actions.open_live_url')}
                        as="a"
                        href={`https://${it.host}${it.route === '/' ? '' : it.route}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink size={14} />
                      </Button>
                    </Tooltip>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Modal isOpen={inspectModal.isOpen} onOpenChange={inspectModal.onOpenChange} size="3xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('inspect.modal_title')}</ModalHeader>
              <ModalBody>
                {inspectLoading ? (
                  <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>
                ) : inspectError ? (
                  <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 p-4 text-danger">
                    {t('inspect.load_failed')}
                  </div>
                ) : !inspecting ? (
                  <p className="text-sm text-muted">{t('inspect.no_snapshot')}</p>
                ) : (
                  <div className="space-y-3 text-sm">
                    {/* SEO score header — at the top so it's the first thing reviewers see. */}
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-surface border border-border">
                      <div className={`text-4xl font-bold ${SEO_GRADE_TEXT_CLASSES[seoGradeColor(inspecting.seo.grade)]}`}>
                        {inspecting.seo.grade}
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-muted">{t('inspect.seo_score')}</p>
                        <p className="text-2xl font-semibold">{inspecting.seo.score}<span className="text-base text-muted">/100</span></p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Chip color={httpStatusColor(inspecting.http_status)} size="sm" variant="soft">
                          HTTP {inspecting.http_status}
                        </Chip>
                        {inspecting.integrity && (
                          <Tooltip content={
                            inspecting.integrity.status === 'mismatch'
                              ? t('inspect.integrity_mismatch', {
                                  expected: inspecting.integrity.expected?.slice(0, 12),
                                  actual: inspecting.integrity.actual?.slice(0, 12),
                                })
                              : inspecting.integrity.status === 'missing'
                                ? t('inspect.integrity_missing')
                                : inspecting.integrity.status === 'unreadable'
                                  ? t('inspect.integrity_unreadable')
                                  : t('inspect.integrity_ok')
                          }>
                            <Chip
                              size="sm"
                              variant="soft"
                              color={
                                inspecting.integrity.status === 'ok' ? 'success'
                                : inspecting.integrity.status === 'mismatch' ? 'danger'
                                : 'default'
                              }
                            >
                              {t('inspect.integrity_status', { status: inspecting.integrity.status })}
                            </Chip>
                          </Tooltip>
                        )}
                        <span className="text-xs text-muted">{t('inspect.old', { age: formatAge(inspecting.age_s) })}</span>
                      </div>
                    </div>
                    {(inspecting.seo.issues.length > 0 || inspecting.seo.tips.length > 0) && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {inspecting.seo.issues.length > 0 && (
                          <div>
                            <p className="font-semibold mb-1 text-danger flex items-center gap-1">
                              <AlertOctagon size={14} />{t('inspect.must_fix', { count: inspecting.seo.issues.length })}
                            </p>
                            <ul className="text-xs space-y-0.5 list-disc list-inside">
                              {inspecting.seo.issues.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        )}
                        {inspecting.seo.tips.length > 0 && (
                          <div>
                            <p className="font-semibold mb-1 text-warning flex items-center gap-1">
                              <Activity size={14} />{t('inspect.tips', { count: inspecting.seo.tips.length })}
                            </p>
                            <ul className="text-xs space-y-0.5 list-disc list-inside">
                              {inspecting.seo.tips.map((s, i) => <li key={i}>{s}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                    <Separator />
                    <div className="grid grid-cols-2 gap-2">
                      <Info label={t('inspect.path')} value={inspecting.cache_path} mono />
                      <Info label={t('inspect.size')} value={formatBytes(inspecting.size_bytes)} />
                      <Info label={t('inspect.age')} value={formatAge(inspecting.age_s)} />
                      <Info label={t('inspect.modified')} value={formatTs(inspecting.mtime)} />
                      <Info label={t('inspect.title')} value={inspecting.title || t('inspect.missing')} />
                      <Info label={t('inspect.canonical')} value={inspecting.canonical || t('inspect.missing')} mono />
                      <Info label={t('inspect.meta_description')} value={inspecting.meta_description || t('inspect.missing')} />
                      <Info label={t('inspect.h1_count')} value={`${inspecting.h1_texts.length}${inspecting.h1_texts.length > 0 ? ` - "${inspecting.h1_texts[0]}"` : ''}`} />
                    </div>
                    <Separator />
                    <div>
                      <p className="font-semibold mb-1">{t('inspect.flags')}</p>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(inspecting.flags).map(([k, v]) => {
                          const isBad = k === 'multiple_h1';
                          const good = isBad ? !v : v;
                          return (
                            <Chip key={k} size="sm" color={good ? 'success' : 'danger'} variant="soft">
                              {good ? '✓' : '✗'} {k}
                            </Chip>
                          );
                        })}
                      </div>
                    </div>
                    {inspecting.parse_warnings.length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <p className="font-semibold mb-1 text-warning">{t('inspect.html_parse_warnings')}</p>
                          <Code className="text-xs whitespace-pre-wrap block">
                            {inspecting.parse_warnings.join('\n')}
                          </Code>
                        </div>
                      </>
                    )}
                    <Separator />
                    <div>
                      <p className="font-semibold mb-1">
                        {t('inspect.json_ld', {
                          blocks: inspecting.json_ld.blocks_count,
                          status: inspecting.json_ld.all_valid ? t('inspect.all_valid') : t('inspect.invalid_present'),
                        })}
                      </p>
                      {inspecting.json_ld.blocks.length === 0 ? (
                        <p className="text-xs text-muted">{t('inspect.no_structured_data')}</p>
                      ) : (
                        <div className="space-y-1">
                          {inspecting.json_ld.blocks.map((b, i) => (
                            <div key={i} className="text-xs flex gap-2 items-center">
                              <Chip size="sm" color={b.valid ? 'success' : 'danger'} variant="soft">
                                {b.valid ? '✓' : '✗'}
                              </Chip>
                              <span className="font-mono">{b.size}B</span>
                              <span>{b.types.join(', ') || t('inspect.no_type')}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {Object.keys(inspecting.og_tags).length > 0 && (
                      <>
                        <Separator />
                        <div>
                          <p className="font-semibold mb-1">{t('inspect.open_graph')}</p>
                          <div className="text-xs space-y-0.5">
                            {Object.entries(inspecting.og_tags).map(([k, v]) => (
                              <div key={k} className="flex gap-2">
                                <span className="font-mono text-muted">{k}</span>
                                <span className="truncate">{v}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    <Separator />
                    <div>
                      <p className="font-semibold mb-1">
                        {t('inspect.asset_references', { count: inspecting.asset_refs.length })}
                        {inspecting.asset_issues.length > 0 && (
                          <Chip color="danger" variant="soft" size="sm" className="ml-2">
                            {t('inspect.dead_assets', { count: inspecting.asset_issues.length })}
                          </Chip>
                        )}
                      </p>
                      <Code className="text-xs whitespace-pre-wrap block">
                        {inspecting.asset_refs.map((r) => `${inspecting.asset_issues.includes(r) ? 'x ' : '  '}${r}`).join('\n') || t('inspect.none')}
                      </Code>
                    </div>
                    <Separator />
                    <div>
                      <p className="font-semibold mb-1">{t('inspect.html_preview')}</p>
                      <Code className="text-xs whitespace-pre-wrap block max-h-96 overflow-auto">
                        {inspecting.preview}
                      </Code>
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('actions.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

function Info({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-sm ${mono ? 'font-mono' : ''} break-all`}>{value}</p>
    </div>
  );
}

// ─── Coverage ──────────────────────────────────────────────────────────────

function CoverageTab({ isSuperAdmin, toast, onDrillDown }: { isSuperAdmin: boolean; toast: ToastShape; onDrillDown: (slug: string) => void }) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.coverage' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const [rows, setRows] = useState<PrerenderCoverageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [enqueuingFor, setEnqueuingFor] = useState<string | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [confirmRecacheOpen, setConfirmRecacheOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    setRows([]);
    adminPrerender.getCoverage()
      .then((r) => {
        if (r.data) setRows(r.data.rows);
        else setLoadError(true);
      })
      .catch(() => {
        setRows([]);
        setLoadError(true);
        toast.error(t('errors.load'));
      })
      .finally(() => setLoading(false));
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  const refreshTenant = async (slug: string) => {
    setEnqueuingFor(slug);
    try {
      const res = await adminPrerender.enqueueJob({ tenant_slug: slug, force: true });
      if (res.data) toast.success(t('messages.tenant_queued', { id: res.data.job_id, slug }));
    } catch {
      toast.error(t('errors.enqueue'));
    } finally {
      setEnqueuingFor(null);
    }
  };

  /**
   * Bulk-enqueue recache for every tenant that has missing or stale routes.
   * Uses one tenant-wide force job per affected tenant. This avoids route-list
   * truncation and guarantees newly discovered custom pages are included.
   */
  const refreshAllStale = async () => {
    const needsWork = rows.filter(
      (r) => Boolean(r.plan_error) || r.missing_routes.length > 0 || r.stale_routes.length > 0 || r.asset_invalid_routes.length > 0,
    );
    if (needsWork.length === 0) {
      toast.success(t('messages.no_stale'));
      setConfirmRecacheOpen(false);
      return;
    }
    setBulkLoading(true);
    let queued = 0;
    try {
      for (const r of needsWork) {
        await adminPrerender.enqueueJob({
          tenant_slug: r.slug,
          force: true,
        });
        queued++;
      }
      toast.success(t('messages.bulk_queued', { count: queued }));
      load();
    } catch {
      toast.error(t('errors.bulk_enqueue'));
    } finally {
      setBulkLoading(false);
      setConfirmRecacheOpen(false);
    }
  };

  if (loadError) return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger-soft-foreground">
      <span>{t('errors.load')}</span>
      <Button size="sm" variant="tertiary" onPress={load}>{tAdmin('common.retry')}</Button>
    </div>
  );
  if (loading) return <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>;

  const totalNeedingWork = rows.filter(
    (r) => Boolean(r.plan_error) || r.missing_routes.length > 0 || r.stale_routes.length > 0 || r.asset_invalid_routes.length > 0,
  ).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {totalNeedingWork === 0
            ? t('summary.healthy', { count: rows.length })
            : t('summary.needs_work', { needing: totalNeedingWork, total: rows.length })}
        </p>
        <Button
          variant="tertiary"
          startContent={<Zap size={14} />}
          onPress={() => setConfirmRecacheOpen(true)}
          isLoading={bulkLoading}
          isDisabled={!isSuperAdmin || totalNeedingWork === 0}
        >
          {t('actions.refresh_all_stale', { count: totalNeedingWork })}
        </Button>
      </div>
      <ConfirmModal
        isOpen={confirmRecacheOpen}
        onClose={() => setConfirmRecacheOpen(false)}
        onConfirm={refreshAllStale}
        title={tAdmin('common.confirm')}
        message={t('confirm.queue_recache', { count: totalNeedingWork })}
        confirmLabel={tAdmin('common.confirm')}
        confirmColor="primary"
        isLoading={bulkLoading}
      />
    <Table aria-label={t('table_aria')} removeWrapper isStriped>
      <TableHeader>
        <TableColumn>{t('columns.tenant')}</TableColumn>
        <TableColumn>{t('columns.host')}</TableColumn>
        <TableColumn>{t('columns.coverage')}</TableColumn>
        <TableColumn>{t('columns.stale')}</TableColumn>
        <TableColumn>{t('columns.asset')}</TableColumn>
        <TableColumn>{t('columns.missing')}</TableColumn>
        <TableColumn>{t('columns.actions')}</TableColumn>
      </TableHeader>
      <TableBody emptyContent={t('empty')}>
        {rows.map((r) => {
          const pct = r.expected > 0 ? Math.round((r.rendered / r.expected) * 100) : 0;
          const color = pct === 100 ? 'success' : pct >= 70 ? 'warning' : 'danger';
          return (
            <TableRow key={r.slug}>
              <TableCell>
                <Button
                  size="sm"
                  variant="tertiary"
                  className="min-h-8 justify-start px-0 font-medium"
                  onPress={() => onDrillDown(r.slug)}
                  title={t('actions.open_in_inventory')}
                >
                  {r.slug}
                </Button>
              </TableCell>
              <TableCell className="text-xs">{r.host}</TableCell>
              <TableCell>
                {r.plan_error ? (
                  <Tooltip content={r.plan_error}>
                    <Chip color="danger" variant="soft" size="sm">
                      {tAdmin('advanced.prerender.sitemap_explorer.error')}
                    </Chip>
                  </Tooltip>
                ) : (
                  <Chip color={color} variant="soft" size="sm">
                    {r.rendered}/{r.expected} ({formatPercentValue(pct)})
                  </Chip>
                )}
              </TableCell>
              <TableCell>
                {r.stale_routes.length > 0 ? (
                  <Tooltip content={r.stale_routes.join(', ')}>
                    <Button size="sm" variant="secondary" onPress={() => onDrillDown(r.slug)}>
                      {r.stale_routes.length}
                    </Button>
                  </Tooltip>
                ) : <span className="text-muted text-xs">—</span>}
              </TableCell>
              <TableCell>
                {r.asset_invalid_routes.length > 0 ? (
                  <Tooltip content={r.asset_invalid_routes.join(', ')}>
                    <Button size="sm" variant="danger" onPress={() => onDrillDown(r.slug)}>
                      {r.asset_invalid_routes.length}
                    </Button>
                  </Tooltip>
                ) : <span className="text-muted text-xs">—</span>}
              </TableCell>
              <TableCell>
                {r.missing_routes.length > 0 ? (
                  <Tooltip content={r.missing_routes.join(', ')}>
                    <Button size="sm" variant="danger" onPress={() => onDrillDown(r.slug)}>
                      {r.missing_routes.length}
                    </Button>
                  </Tooltip>
                ) : <span className="text-muted text-xs">—</span>}
              </TableCell>
              <TableCell>
                <Button
                  size="sm"
                  variant="tertiary"
                  startContent={<Play size={14} />}
                  onPress={() => refreshTenant(r.slug)}
                  isLoading={enqueuingFor === r.slug}
                  isDisabled={!isSuperAdmin}
                >
                  {t('actions.refresh')}
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
    </div>
  );
}

// ─── Analytics ─────────────────────────────────────────────────────────────

/**
 * Bot-only access analytics. Sourced from the nginx JSONL log written for
 * every search engine / social / AI crawler hit. Shows the breakdown by
 * crawler, host, status code, and which "claimed Googlebot" hits failed
 * IP-range verification — the spoofing signal.
 */
function AnalyticsTab() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.analytics' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const toast = useToast();
  const [data, setData] = useState<PrerenderAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<string>('7');

  const load = useCallback(() => {
    setLoading(true);
    const sinceIso = new Date(Date.now() - parseInt(windowDays, 10) * 86400_000).toISOString();
    adminPrerender.getAnalytics({ since: sinceIso, limit: 300 })
      .then((res) => {
        if (!res.data) return;
        // Defend against a malformed/partial payload: every collection field
        // is read unconditionally via Object.entries/values/.length/.map below,
        // and a null/undefined there throws "Cannot convert undefined or null
        // to object" and white-screens the whole admin.
        setData({
          ...res.data,
          total_hits: res.data.total_hits ?? 0,
          verified_hits: res.data.verified_hits ?? 0,
          spoofed_by_crawler: res.data.spoofed_by_crawler ?? {},
          hits_by_status: res.data.hits_by_status ?? {},
          hits_by_crawler: res.data.hits_by_crawler ?? {},
          hits_by_host: res.data.hits_by_host ?? {},
          top_uris: res.data.top_uris ?? [],
          recent: res.data.recent ?? [],
        });
      })
      .catch(() => toast.error(t('errors.load')))
      .finally(() => setLoading(false));
  }, [t, toast, windowDays]);

  useEffect(() => { load(); }, [load]);

  if (loading && !data) return <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>;
  if (!data) return <p className="text-muted">{t('empty')}</p>;

  const verifiedPct = data.total_hits > 0 ? Math.round((data.verified_hits / data.total_hits) * 100) : 0;
  const totalSpoofed = Object.values(data.spoofed_by_crawler).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select
          label={t('filters.window')}
          variant="secondary"
          selectedKeys={[windowDays]}
          onSelectionChange={(s) => setWindowDays(Array.from(s)[0] as string)}
          className="max-w-[150px]"
        >
          <SelectItem key="1" id="1">{t('windows.1')}</SelectItem>
          <SelectItem key="7" id="7">{t('windows.7')}</SelectItem>
          <SelectItem key="30" id="30">{t('windows.30')}</SelectItem>
        </Select>
        <Button variant="tertiary" onPress={load} startContent={<RefreshCw size={14} />} className="self-end">{t('actions.reload')}</Button>
        <span className="text-sm text-muted ml-auto self-end">
          {t('log_summary', { size: formatBytes(data.log_size_bytes), time: formatTs(data.window_started_at) })}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label={t('kpi.total_bot_hits')} value={data.total_hits} />
        <KpiCard
          label={t('kpi.ip_verified')}
          value={formatPercentValue(verifiedPct)}
          hint={t('hints.verified_of_total', { verified: data.verified_hits, total: data.total_hits })}
          tone={verifiedPct >= 80 ? 'default' : 'warning'}
        />
        <KpiCard
          label={t('kpi.spoofed')}
          value={totalSpoofed}
          hint={t('hints.spoofed')}
          tone={totalSpoofed > 0 ? 'danger' : 'default'}
        />
        <KpiCard
          label={t('kpi.unique_uris')}
          value={data.top_uris.length}
          hint={t('hints.top_50_cap')}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><h3 className="font-semibold">{t('sections.hits_by_crawler')}</h3></CardHeader>
          <CardBody className="text-xs space-y-1">
            {Object.entries(data.hits_by_crawler).map(([k, n]) => (
              <div key={k} className="flex items-center gap-2">
                <Chip size="sm" variant="soft">{k}</Chip>
                <span className="font-mono ml-auto">{n}</span>
                {data.spoofed_by_crawler[k] && (
                  <Chip size="sm" variant="soft" color="danger">{t('labels.spoofed_count', { count: data.spoofed_by_crawler[k] })}</Chip>
                )}
              </div>
            ))}
            {Object.keys(data.hits_by_crawler).length === 0 && <p className="text-muted">{t('empty_no_data')}</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><h3 className="font-semibold">{t('sections.hits_by_status')}</h3></CardHeader>
          <CardBody className="text-xs space-y-1">
            {Object.entries(data.hits_by_status).map(([k, n]) => (
              <div key={k} className="flex items-center gap-2">
                <Chip size="sm" variant="soft" color={httpStatusColor(Number(k))}>{k}</Chip>
                <span className="font-mono ml-auto">{n}</span>
              </div>
            ))}
            {Object.keys(data.hits_by_status).length === 0 && <p className="text-muted">{t('empty_no_data')}</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader><h3 className="font-semibold">{t('sections.top_uris')}</h3></CardHeader>
        <CardBody className="p-0">
          <Table aria-label={t('tables.top_uris_aria')} removeWrapper isStriped>
            <TableHeader>
              <TableColumn>{t('columns.url')}</TableColumn>
              <TableColumn>{t('columns.hits')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('empty_bot_traffic')}>
              {data.top_uris.map((u) => (
                <TableRow key={u.url}>
                  <TableCell className="text-xs font-mono">{u.url}</TableCell>
                  <TableCell className="text-xs">{u.hits}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><h3 className="font-semibold">{t('sections.recent_activity', { count: data.recent.length })}</h3></CardHeader>
        <CardBody className="p-0">
          <Table aria-label={t('tables.recent_hits_aria')} removeWrapper isStriped>
            <TableHeader>
              <TableColumn>{t('columns.time')}</TableColumn>
              <TableColumn>{t('columns.crawler')}</TableColumn>
              <TableColumn>{t('columns.host')}</TableColumn>
              <TableColumn>{t('columns.uri')}</TableColumn>
              <TableColumn>{t('columns.status')}</TableColumn>
              <TableColumn>{t('columns.ip')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('empty_recent_hits')}>
              {data.recent.map((r, i) => (
                <TableRow key={i}>
                  <TableCell className="text-xs">{formatTs(r.ts ?? null)}</TableCell>
                  <TableCell className="text-xs">
                    <Chip size="sm" variant="soft">{r.crawler}</Chip>
                  </TableCell>
                  <TableCell className="text-xs">{r.host}</TableCell>
                  <TableCell className="text-xs font-mono">{r.uri}</TableCell>
                  <TableCell>
                    <Chip size="sm" variant="soft" color={httpStatusColor(r.status)}>
                      {new Intl.NumberFormat(getFormattingLocale(), { useGrouping: false }).format(r.status)}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{r.ip}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Jobs ──────────────────────────────────────────────────────────────────

function JobsTab({ isSuperAdmin, toast, lastUpdate, live }: { isSuperAdmin: boolean; toast: ToastShape; lastUpdate: number; live: boolean }) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.jobs' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const [jobs, setJobs] = useState<PrerenderJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>('all');
  const [expanded, setExpanded] = useState<PrerenderJob | null>(null);
  const detailModal = useDisclosure();

  const load = useCallback(() => {
    setLoading(true);
    adminPrerender.listJobs({ status: status === 'all' ? undefined : status, limit: 100 })
      .then((r) => { if (r.data) setJobs(r.data.items); })
      .catch(() => toast.error(t('errors.load')))
      .finally(() => setLoading(false));
  }, [status, t, toast]);

  useEffect(() => { load(); }, [load]);
  // Realtime reload on Pusher event. Polling fallback kicks in only when
  // the channel never connected — keeps live runs responsive without
  // hammering the API on quiescent days.
  useEffect(() => { if (lastUpdate > 0) load(); }, [lastUpdate, load]);
  useEffect(() => {
    if (live) return;
    const hasActive = jobs.some((j) => j.status === 'pending_fence' || j.status === 'queued' || j.status === 'claimed' || j.status === 'running');
    if (!hasActive) return;
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [jobs, load, live]);

  const cancelJob = async (id: number) => {
    try {
      await adminPrerender.cancelJob(id);
      toast.success(t('messages.cancelled', { id }));
      load();
    } catch {
      toast.error(t('errors.cancel'));
    }
  };

  const retryJob = async (id: number) => {
    try {
      const res = await adminPrerender.retryJob(id);
      if (res.data) toast.success(t('messages.retry_queued', { retryId: res.data.job_id, id }));
      load();
    } catch {
      toast.error(t('errors.retry'));
    }
  };

  const openDetail = (j: PrerenderJob) => {
    setExpanded(j);
    detailModal.onOpen();
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="flex-row gap-3 items-end">
          <Select
            label={t('filters.status')}
            variant="secondary"
            selectedKeys={[status]}
            onSelectionChange={(s) => setStatus(Array.from(s)[0] as string)}
            className="max-w-[180px]"
          >
            <SelectItem key="all" id="all">{t('filters.all')}</SelectItem>
            <SelectItem key="pending_fence" id="pending_fence">{t('filters.pending_fence')}</SelectItem>
            <SelectItem key="queued" id="queued">{t('filters.queued')}</SelectItem>
            <SelectItem key="claimed" id="claimed">{t('statuses.claimed')}</SelectItem>
            <SelectItem key="running" id="running">{t('filters.running')}</SelectItem>
            <SelectItem key="succeeded" id="succeeded">{t('filters.succeeded')}</SelectItem>
            <SelectItem key="partial" id="partial">{t('filters.partial')}</SelectItem>
            <SelectItem key="failed" id="failed">{t('filters.failed')}</SelectItem>
            <SelectItem key="cancelled" id="cancelled">{t('filters.cancelled')}</SelectItem>
          </Select>
          <Button variant="tertiary" startContent={<RefreshCw size={14} />} onPress={load}>
            {t('actions.reload')}
          </Button>
        </CardBody>
      </Card>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Table aria-label={t('table_aria')} removeWrapper isStriped>
          <TableHeader>
            <TableColumn>{t('columns.id')}</TableColumn>
            <TableColumn>{t('columns.status')}</TableColumn>
            <TableColumn>{t('columns.priority')}</TableColumn>
            <TableColumn>{t('columns.scope')}</TableColumn>
            <TableColumn>{t('columns.flags')}</TableColumn>
            <TableColumn>{t('columns.result')}</TableColumn>
            <TableColumn>{t('columns.queued')}</TableColumn>
            <TableColumn>{t('columns.by')}</TableColumn>
            <TableColumn>{t('columns.actions')}</TableColumn>
          </TableHeader>
          <TableBody emptyContent={t('empty')}>
            {jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="text-xs font-mono">{j.id}</TableCell>
                <TableCell>
                  <Chip color={jobStatusColor(j.status)} variant="soft" size="sm">
                    {t(`statuses.${j.status}`)}
                  </Chip>
                </TableCell>
                <TableCell>
                  {(() => {
                    const p = j.priority ?? 5;
                    // Match service constants: 3=HIGH, 5=NORMAL, 7=LOW.
                    const label = p <= 3 ? t('priority.high') : p >= 7 ? t('priority.low') : t('priority.normal');
                    const color: 'danger' | 'accent' | 'default' = p <= 3 ? 'danger' : p >= 7 ? 'default' : 'accent';
                    return (
                      <Tooltip content={t('priority.tooltip', { priority: p })}>
                        <Chip size="sm" variant="soft" color={color}>{label}</Chip>
                      </Tooltip>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-xs">
                  {j.tenant_slug ? <Chip size="sm" variant="soft">{j.tenant_slug}</Chip> : <span className="text-muted">{t('scope.all_tenants')}</span>}
                  {j.routes && <div className="font-mono mt-1">{j.routes}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    {j.force && <Chip size="sm" color="warning" variant="soft">{t('flags.force')}</Chip>}
                    {j.dry_run && <Chip size="sm" variant="soft">{t('flags.dry_run')}</Chip>}
                  </div>
                </TableCell>
                <TableCell className="text-xs">
                  {j.rendered_count != null
                    ? `${j.rendered_count}/${j.planned_count ?? '?'}${j.invalid_count ? ` (${t('result.invalid', { count: j.invalid_count })})` : ''}${j.duration_s != null ? ` | ${new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'second', unitDisplay: 'short' }).format(j.duration_s)}` : ''}`
                    : '—'}
                </TableCell>
                <TableCell className="text-xs">{formatTs(j.queued_at)}</TableCell>
                <TableCell className="text-xs">{j.requested_by?.name || '—'}</TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button size="sm" variant="tertiary" isIconOnly onPress={() => openDetail(j)} aria-label={t('actions.view_details', { id: j.id })}>
                      <Search size={14} />
                    </Button>
                    {(j.status === 'pending_fence' || (j.status === 'queued' && !j.authoritative_reset)) && (
                      <Button
                        size="sm"
                        variant="danger"
                        isIconOnly
                        aria-label={t('actions.cancel_job', { id: j.id })}
                        onPress={() => cancelJob(j.id)}
                        isDisabled={!isSuperAdmin}
                      >
                        <StopCircle size={14} />
                      </Button>
                    )}
                    {(j.status === 'failed' || j.status === 'partial' || j.status === 'cancelled') && (
                      <Tooltip content={t('actions.retry_same_parameters')}>
                        <Button
                          size="sm"
                          variant="tertiary"
                          isIconOnly
                          aria-label={t('actions.retry_job', { id: j.id })}
                          onPress={() => retryJob(j.id)}
                          isDisabled={!isSuperAdmin}
                        >
                          <RefreshCw size={14} />
                        </Button>
                      </Tooltip>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Modal isOpen={detailModal.isOpen} onOpenChange={detailModal.onOpenChange} size="3xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('detail.title', { id: expanded?.id })}</ModalHeader>
              <ModalBody>
                {expanded && (
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <Info label={t('detail.status')} value={t(`statuses.${expanded.status}`)} />
                      <Info label={t('detail.tenant')} value={expanded.tenant_slug || t('detail.all')} />
                      <Info label={t('detail.routes')} value={expanded.routes || t('detail.all')} mono />
                      <Info label={t('detail.exit_code')} value={String(expanded.exit_code ?? '—')} />
                      <Info label={t('detail.duration')} value={expanded.duration_s != null ? formatUnit(expanded.duration_s, 'second') : '—'} />
                      <Info label={t('detail.claimed_by')} value={expanded.claimed_by || '—'} />
                      <Info label={t('detail.queued_at')} value={formatTs(expanded.queued_at)} />
                      <Info label={t('detail.fence_ready_at')} value={formatTs(expanded.fence_ready_at ?? null)} />
                      <Info label={t('detail.started_at')} value={formatTs(expanded.started_at)} />
                      <Info label={t('detail.finished_at')} value={formatTs(expanded.finished_at)} />
                      <Info label={t('detail.requested_by')} value={expanded.requested_by?.name || '—'} />
                    </div>
                    {expanded.error_message && (
                      <>
                        <Separator />
                        <p className="font-semibold text-danger">{t('detail.error')}</p>
                        <Code className="text-xs whitespace-pre-wrap block">{expanded.error_message}</Code>
                      </>
                    )}
                    {expanded.log_excerpt && (
                      <>
                        <Separator />
                        <p className="font-semibold">{t('detail.log_tail')}</p>
                        <Code className="text-xs whitespace-pre-wrap block max-h-96 overflow-auto">
                          {expanded.log_excerpt}
                        </Code>
                      </>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('actions.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─── Events ────────────────────────────────────────────────────────────────

function EventsTab() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.events' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const toast = useToast();
  const [events, setEvents] = useState<PrerenderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(200);

  const load = useCallback(() => {
    setLoading(true);
    adminPrerender.getEvents(limit)
      .then((r) => { if (r.data) setEvents(r.data.events); })
      .catch(() => toast.error(t('errors.load')))
      .finally(() => setLoading(false));
  }, [limit, t, toast]);

  const eventTypeLabel = useCallback(
    (event: string) => (
      ['success', 'partial', 'fail', 'supersede'].includes(event)
        ? t(`types.${event}`)
        : t('types.unknown', { event })
    ),
    [t],
  );

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <Card>
        <CardBody className="flex-row gap-3 items-end">
          <Select
            label={t('filters.limit')}
            variant="secondary"
            selectedKeys={[String(limit)]}
            onSelectionChange={(s) => setLimit(parseInt(Array.from(s)[0] as string, 10))}
            className="max-w-[140px]"
          >
            <SelectItem key="50" id="50">50</SelectItem>
            <SelectItem key="200" id="200">200</SelectItem>
            <SelectItem key="500" id="500">500</SelectItem>
            <SelectItem key="2000" id="2000">2000</SelectItem>
          </Select>
          <Button variant="tertiary" startContent={<RefreshCw size={14} />} onPress={load}>
            {t('actions.reload')}
          </Button>
          <span className="text-sm text-muted ml-auto self-center">
            {t('summary', { count: events.length })}
          </span>
        </CardBody>
      </Card>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <Table aria-label={t('table_aria')} removeWrapper isStriped>
          <TableHeader>
            <TableColumn>{t('columns.time')}</TableColumn>
            <TableColumn>{t('columns.event')}</TableColumn>
            <TableColumn>{t('columns.commit')}</TableColumn>
            <TableColumn>{t('columns.details')}</TableColumn>
          </TableHeader>
          <TableBody emptyContent={t('empty')}>
            {events.map((e, idx) => {
              const ev = String(e.event ?? '');
              const color =
                ev === 'success' ? 'success' :
                ev === 'partial' ? 'warning' :
                ev === 'fail' ? 'danger' :
                ev === 'supersede' ? 'warning' : 'default';
              const { ts, commit, pid, host, ...rest } = e;
              return (
                <TableRow key={idx}>
                  <TableCell className="text-xs">{ts ? formatTs(ts) : '—'}</TableCell>
                  <TableCell>
                    <Chip color={color} variant="soft" size="sm">
                      {ev ? eventTypeLabel(ev) : '—'}
                    </Chip>
                  </TableCell>
                  <TableCell className="text-xs font-mono">{commit || '—'}</TableCell>
                  <TableCell className="text-xs">
                    <Code className="text-xs">{JSON.stringify({ pid, host, ...rest })}</Code>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Failures ──────────────────────────────────────────────────────────────

function FailuresTab() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.failures' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const toast = useToast();
  const [items, setItems] = useState<PrerenderFailure[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    setItems([]);
    adminPrerender.getFailures()
      .then((r) => {
        if (r.data) setItems(r.data.items);
        else setLoadError(true);
      })
      .catch(() => {
        setItems([]);
        setLoadError(true);
        toast.error(t('errors.load'));
      })
      .finally(() => setLoading(false));
  }, [t, toast]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <Card>
        <CardBody>
          <p className="text-sm text-muted">
            {t('description_prefix')}{' '}
            {t('description_middle')}{' '}
            <strong>{t('description_action')}</strong>{' '}
            {t('description_suffix')}
          </p>
        </CardBody>
      </Card>
      {loadError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger-soft-foreground">
          <span>{t('errors.load')}</span>
          <Button size="sm" variant="tertiary" onPress={load}>{tAdmin('common.retry')}</Button>
        </div>
      ) : loading ? (
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody className="text-center py-8 flex flex-col items-center gap-2">
            <CheckCircle className="text-success" size={32} />
            <p className="font-medium">{t('empty')}</p>
          </CardBody>
        </Card>
      ) : (
        <Table aria-label={t('table_aria')} removeWrapper isStriped>
          <TableHeader>
            <TableColumn>{t('columns.cache_path')}</TableColumn>
            <TableColumn>{t('columns.failed_at')}</TableColumn>
            <TableColumn>{t('columns.age')}</TableColumn>
          </TableHeader>
          <TableBody>
            {items.map((it) => (
              <TableRow key={it.cache_path}>
                <TableCell className="text-xs font-mono">{it.cache_path}</TableCell>
                <TableCell className="text-xs">{formatTs(it.failed_at)}</TableCell>
                <TableCell className="text-xs flex items-center gap-1">
                  <Clock size={12} />{formatAge(it.age_s)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── Health banner ─────────────────────────────────────────────────────────

function statusToColor(s: 'green' | 'yellow' | 'red'): 'success' | 'warning' | 'danger' {
  return s === 'green' ? 'success' : s === 'yellow' ? 'warning' : 'danger';
}

const HEALTH_BANNER_CLASSES: Record<ReturnType<typeof statusToColor>, string> = {
  success: 'border-success/30 bg-success/10 text-success-soft-foreground',
  warning: 'border-warning/30 bg-warning/10 text-warning-soft-foreground',
  danger: 'border-danger/30 bg-danger/10 text-danger-soft-foreground',
};

const HEALTH_DOT_CLASSES: Record<ReturnType<typeof statusToColor>, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

function readableHealthCheckName(t: (key: string, options?: Record<string, unknown>) => string, name: string): string {
  return t(`checks.${name}`, { defaultValue: t('checks.unknown') });
}

function HealthCheckList({
  health,
  isSuperAdmin,
  onResetBreaker,
  busy,
  t,
}: {
  health: PrerenderHealth;
  isSuperAdmin: boolean;
  onResetBreaker: () => void;
  busy: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <ul className="mt-2 ml-2 space-y-1 list-disc list-inside">
      {health.checks.map((c) => (
        <li key={c.name}>
          <span className={`inline-block w-2 h-2 rounded-full mr-2 align-middle ${HEALTH_DOT_CLASSES[statusToColor(c.status)]}`} />
          <strong>{readableHealthCheckName(t, c.name)}:</strong> {c.detail}
          {c.action && (
            <span className="block ml-4 text-xs opacity-80">
              → {t('health.remediation', { detail: c.action })}
            </span>
          )}
        </li>
      ))}
      {health.breaker_until && isSuperAdmin && (
        <li className="pt-1">
          <Button size="sm" variant="tertiary" onPress={onResetBreaker} isDisabled={busy}>
            {t('actions.close_breaker_now')}
          </Button>
        </li>
      )}
    </ul>
  );
}

function HealthBanner({ isSuperAdmin, toast, lastUpdate }: { isSuperAdmin: boolean; toast: ToastShape; lastUpdate: number }) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.health_banner' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const [health, setHealth] = useState<PrerenderHealth | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const { isOpen, onOpen, onClose } = useDisclosure();

  const load = useCallback(() => {
    adminPrerender.getHealth()
      .then((res) => {
        if (res.data) {
          setHealth(res.data as PrerenderHealth);
          setLoadError(false);
        } else {
          setHealth(null);
          setLoadError(true);
        }
      })
      .catch(() => {
        setHealth(null);
        setLoadError(true);
      });
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (lastUpdate > 0) load(); }, [lastUpdate, load]);
  useEffect(() => {
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  const resetBreaker = async () => {
    setBusy(true);
    try {
      await adminPrerender.resetBreaker();
      toast.success(t('toasts.breaker_reset'));
      load();
    } catch { toast.error(t('toasts.reset_failed')); }
    finally { setBusy(false); }
  };

  const resetQueue = async () => {
    setBusy(true);
    try {
      const res = await adminPrerender.resetQueue();
      if (res.data) toast.success(t('toasts.queue_reset', { count: res.data.rows_reset }));
      load();
      onClose();
    } catch { toast.error(t('toasts.queue_reset_failed')); }
    finally { setBusy(false); }
  };

  if (loadError) return (
    <div role="alert" className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger-soft-foreground">
      <span>{tAdmin('common.error_loading_data')}</span>
      <Button size="sm" variant="tertiary" onPress={load}>{tAdmin('common.retry')}</Button>
    </div>
  );
  if (!health) return (
    <div role="status" aria-live="polite" className="mb-3 text-sm text-muted">
      {tAdmin('common.loading')}
    </div>
  );
  if (health.status === 'green') {
    return (
      <div role="status" aria-live="polite" className="mb-3 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-soft-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle size={14} className="text-success" />
          {t('engine_healthy')}
          <Button size="sm" variant="tertiary" className="ml-auto h-7 text-xs" onPress={() => setExpanded((v) => !v)}>
            {expanded ? t('actions.hide_details') : t('actions.details')}
          </Button>
        </div>
        {expanded && (
          <HealthCheckList
            health={health}
            isSuperAdmin={isSuperAdmin}
            onResetBreaker={resetBreaker}
            busy={busy}
            t={t}
          />
        )}
      </div>
    );
  }

  const tone = statusToColor(health.status);
  const failing = health.checks.filter((c) => c.status !== 'green');

  return (
    <div role="alert" className={`mb-3 rounded-md border px-3 py-2 text-sm ${HEALTH_BANNER_CLASSES[tone]}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Chip size="sm" color={tone} variant="soft">
          {t(`statuses.${health.status}`, { defaultValue: t('statuses.unknown') })}
        </Chip>
        <span className="font-medium">{t('issue_count', { count: failing.length })}</span>
        <Button size="sm" variant="tertiary" className="ml-auto h-7 text-xs" onPress={() => setExpanded((v) => !v)}>
          {expanded ? t('actions.hide') : t('actions.details')}
        </Button>
        {isSuperAdmin && (
          <Button
            size="sm"
            variant="danger"
            isDisabled={busy}
            startContent={<StopCircle size={14} />}
            onPress={onOpen}
          >
            {t('actions.emergency_reset')}
          </Button>
        )}
      </div>
      {expanded && (
        <HealthCheckList
          health={health}
          isSuperAdmin={isSuperAdmin}
          onResetBreaker={resetBreaker}
          busy={busy}
          t={t}
        />
      )}

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalContent>
          <ModalHeader>{t('modal.title')}</ModalHeader>
          <ModalBody>
            <p>
              {t('modal.body_prefix')}{' '}
              {/* eslint-disable-next-line i18next/no-literal-string -- Queue state identifier must remain verbatim. */}
              <code>claimed</code> {t('modal.body_middle')}{' '}
              {/* eslint-disable-next-line i18next/no-literal-string -- Queue state identifier must remain verbatim. */}
              <code>running</code> {t('modal.body_suffix')}
            </p>
            <p className="text-warning-soft-foreground text-sm">
              {t('modal.warning')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose} isDisabled={busy}>{t('actions.cancel')}</Button>
            <Button variant="danger" onPress={resetQueue} isDisabled={busy}>
              {t('actions.reset_queue')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─── Audit history tab ─────────────────────────────────────────────────────

function AuditTab() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.audit' });
  const { t: tAdmin } = useTranslation('admin_advanced');
  const toast = useToast();
  const [items, setItems] = useState<PrerenderAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    adminPrerender.getAudit(filter || undefined, 200)
      .then((res) => { if (res.data) setItems(res.data.items); })
      .catch(() => toast.error(t('errors.load')))
      .finally(() => setLoading(false));
  }, [filter, t, toast]);

  useEffect(() => { load(); }, [load]);

  const actionLabel = (action: string) => t(`actions.${action}`, { defaultValue: t('actions.unknown') });
  const outcomeLabel = (outcome: string) => t(`outcomes.${outcome}`, { defaultValue: t('outcomes.unknown') });
  const exportAudit = async () => {
    setExporting(true);
    try {
      await adminPrerender.exportCsv('audit', filter || undefined);
    } catch {
      toast.error(t('errors.export'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Select
          size="sm"
          label={t('filters.action')}
          className="max-w-xs"
          selectedKeys={filter ? [filter] : []}
          onChange={(e) => setFilter(e.target.value || '')}
        >
          <SelectItem key="" id="">{t('filters.all')}</SelectItem>
          <SelectItem key="enqueue" id="enqueue">{t('actions.enqueue')}</SelectItem>
          <SelectItem key="cancel" id="cancel">{t('actions.cancel')}</SelectItem>
          <SelectItem key="purge" id="purge">{t('actions.purge')}</SelectItem>
          <SelectItem key="purge_unexpected" id="purge_unexpected">{t('actions.purge_unexpected')}</SelectItem>
          <SelectItem key="invalidate" id="invalidate">{t('actions.invalidate')}</SelectItem>
          <SelectItem key="auto_recache" id="auto_recache">{t('actions.auto_recache')}</SelectItem>
          <SelectItem key="detect_drift" id="detect_drift">{t('actions.detect_drift')}</SelectItem>
          <SelectItem key="reset_breaker" id="reset_breaker">{t('actions.reset_breaker')}</SelectItem>
          <SelectItem key="reset_queue" id="reset_queue">{t('actions.reset_queue')}</SelectItem>
          <SelectItem key="reset_all" id="reset_all">{t('actions.reset_all')}</SelectItem>
        </Select>
        <Button size="sm" variant="tertiary" onPress={load} isDisabled={loading} startContent={<RefreshCw size={14} />}>
          {t('buttons.refresh')}
        </Button>
        <Button
          size="sm"
          variant="tertiary"
          onPress={exportAudit}
          isLoading={exporting}
          startContent={<ExternalLink size={14} />}
        >
          {t('buttons.export_csv')}
        </Button>
      </div>
      {loading && items.length === 0 ? (
        <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8"><Spinner /></div>
      ) : items.length === 0 ? (
        <p className="text-muted">{t('empty')}</p>
      ) : (
        <Table aria-label={t('table_aria')} removeWrapper>
          <TableHeader>
            <TableColumn>{t('columns.when')}</TableColumn>
            <TableColumn>{t('columns.actor')}</TableColumn>
            <TableColumn>{t('columns.action')}</TableColumn>
            <TableColumn>{t('columns.outcome')}</TableColumn>
            <TableColumn>{t('columns.tenant')}</TableColumn>
            <TableColumn>{t('columns.job')}</TableColumn>
            <TableColumn>{t('columns.details')}</TableColumn>
          </TableHeader>
          <TableBody>
            {items.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatTs(row.created_at)}</TableCell>
                <TableCell>
                  {row.actor_email
                    ? <Tooltip content={`#${row.actor_user_id ?? '?'}`}><span>{row.actor_first} {row.actor_last}</span></Tooltip>
                    : <span className="text-muted">{t('fallbacks.system')}</span>}
                </TableCell>
                <TableCell>{actionLabel(row.action)}</TableCell>
                <TableCell>
                  <Chip
                    size="sm"
                    variant="soft"
                    color={row.outcome === 'ok' ? 'success' : row.outcome === 'denied' ? 'warning' : 'danger'}
                  >
                    {outcomeLabel(row.outcome)}
                  </Chip>
                </TableCell>
                <TableCell>{row.tenant_slug ?? <span className="text-muted">{t('fallbacks.all')}</span>}</TableCell>
                <TableCell>{row.job_id ?? '—'}</TableCell>
                <TableCell className="max-w-md">
                  {row.details ? (
                    <Code size="sm" className="text-xs whitespace-pre-wrap block max-h-20 overflow-auto">
                      {JSON.stringify(row.details, null, 2)}
                    </Code>
                  ) : <span className="text-muted">{t('details_empty')}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// ─── TTL inspector (Overview tab card) ─────────────────────────────────────

function TtlInspector() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.ttl_inspector' });
  const [route, setRoute] = useState('/');
  const [result, setResult] = useState<PrerenderTtlInspect | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminPrerender.ttlInspector(route);
      if (res.data) setResult(res.data as PrerenderTtlInspect);
    } catch {
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  };

  const fmt = (s: number): string => {
    if (s < 3600) return t('units.minutes', { count: Math.round(s / 60) });
    if (s < 86400) return t('units.hours', { count: Math.round(s / 3600) });
    return t('units.days', { count: Math.round(s / 86400) });
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Clock size={18} />{t('title')}
        </h3>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-muted">
          {t('description_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string -- Configuration path must remain verbatim. */}
          <code>config/prerender.php</code> {t('description_suffix')}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label={t('fields.route')}
            placeholder={t('placeholders.route')}
            variant="secondary"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            className="max-w-sm"
            description={t('path_only')}
          />
          <Button onPress={submit} isLoading={loading}>
            {t('actions.inspect')}
          </Button>
        </div>
        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
        {result && (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <Chip color="accent" variant="soft" size="sm">
                {t('result.ttl', { ttl: fmt(result.ttl_seconds), seconds: result.ttl_seconds })}
              </Chip>
              <Chip variant="soft" size="sm" color={result.source === 'pattern' ? 'success' : 'default'}>
                {t(`result.sources.${result.source}`, { defaultValue: t('result.sources.unknown') })}
              </Chip>
              {result.matched_pattern && (
                <Code size="sm">{t('result.match', { pattern: result.matched_pattern })}</Code>
              )}
            </div>
            {result.all_matches.length > 1 && (
              <div>
                <p className="text-xs font-medium mb-1">{t('result.other_patterns')}</p>
                <ul className="text-xs space-y-1 ml-2">
                  {result.all_matches.slice(1).map((m) => (
                    <li key={m.pattern} className="font-mono text-muted">
                      {t('result.other_pattern_item', { pattern: m.pattern, ttl: fmt(m.ttl), specificity: m.specificity })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

// ─── Sitemap explorer (Overview tab card) ──────────────────────────────────

function SitemapExplorer() {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.sitemap_explorer' });
  const [slug, setSlug] = useState('');
  const [data, setData] = useState<{
    tenant_slug: string;
    tenant_id: number;
    static_routes: string[];
    dynamic_routes: string[];
    total_count: number;
    truncated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!slug.trim()) return;
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await adminPrerender.sitemapExplorer(slug.trim());
      if (res.data) setData(res.data);
    } catch {
      setData(null);
      setError(t('error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Search size={18} />{t('title')}
        </h3>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-muted">
          {t('description_prefix')}{' '}
          {/* eslint-disable-next-line i18next/no-literal-string -- PHP service class name must remain verbatim. */}
          <code>SitemapService</code>. {t('description_suffix')}
        </p>
        <div className="flex gap-2 items-end">
          <Input
            label={t('fields.tenant_slug')}
            placeholder={t('placeholders.tenant_slug')}
            variant="secondary"
            value={slug}
            onValueChange={(value) => {
              setSlug(value);
              setData(null);
              setError(null);
            }}
            className="max-w-sm"
          />
          <Button onPress={submit} isLoading={loading}>
            {t('actions.explore')}
          </Button>
        </div>
        {error && <p className="text-danger text-sm" role="alert">{error}</p>}
        {data && (
          <div className="space-y-3">
            <p className="text-sm font-medium">{t('tenant', { slug: data.tenant_slug, id: data.tenant_id })}</p>
            <div className="flex gap-2">
              <Chip color="accent" variant="soft" size="sm">{t('counts.static', { count: data.static_routes.length })}</Chip>
              <Chip color="default" variant="soft" size="sm">{t('counts.dynamic', { count: data.dynamic_routes.length })}</Chip>
              <Chip variant="soft" size="sm">{t('counts.total', { count: data.total_count })}</Chip>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium mb-1">{t('sections.static_routes')}</p>
                <Code className="text-xs whitespace-pre-wrap block max-h-64 overflow-auto">
                  {data.static_routes.join('\n')}
                </Code>
              </div>
              <div>
                <p className="text-xs font-medium mb-1">{t('sections.dynamic_routes')}</p>
                <Code className="text-xs whitespace-pre-wrap block max-h-64 overflow-auto">
                  {data.dynamic_routes.length > 0 ? data.dynamic_routes.join('\n') : t('none')}
                </Code>
              </div>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
