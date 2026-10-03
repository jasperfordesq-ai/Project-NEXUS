// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Insurance Certificates Management
 * Manage insurance certificates for compliance.
 * Parity: PHP AdminInsuranceCertificateApiController
 *
 * Broker design language: BrokerPageShell frame (compliance = success),
 * deep-linked BrokerStatCard KPI header, expiry-urgency countdown chips
 * (danger expired / warning inside the configurable warning window),
 * panel-wide BrokerStatusChip statuses, BrokerSkeleton first load and
 * BrokerEmptyState empties. The `?status=` and `?user_id=` params are
 * preserved exactly so dashboard tiles and User Edit deep-links keep working.
 *
 * Five status tabs. "Pending Review" is the server's own union of pending +
 * submitted. "Rejected / Revoked" has no server filter, so that tab loads
 * both statuses in full and pages them in the browser. Older `?status=`
 * values (pending, submitted, expired, rejected, revoked) still filter and
 * are named in a chip under the tabs. The modals live in
 * `components/insurance/`; member names open the panel-wide member window.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Alert, Button, Input, Tabs, Tab, Chip } from '@/components/ui';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Clock from 'lucide-react/icons/clock';
import Plus from 'lucide-react/icons/plus';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import Search from 'lucide-react/icons/search';
import FileText from 'lucide-react/icons/file-text';
import Trash2 from 'lucide-react/icons/trash-2';
import Eye from 'lucide-react/icons/eye';
import Pencil from 'lucide-react/icons/pencil';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName, resolveUserDisplayNameFromPrefix } from '@/lib/helpers';
import { parseServerTimestamp } from '@/lib/serverTime';
import { adminInsurance, adminUsers, adminBroker } from '@/admin/api/adminApi';
import { DataTable, ConfirmModal, type Column } from '@/admin/components';
import type { InsuranceCertificate, InsuranceStats, BrokerConfig } from '@/admin/api/types';
import { Avatar } from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { collectRows, useCsvExport } from '@/broker/useCsvExport';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';
import {
  InsuranceCertificateFormModal,
  InsuranceCertificateViewModal,
  InsuranceRejectModal,
  fetchInsurancePage,
  isoDateOnly,
  useInsuranceFormatting,
  type InsuranceListParams,
} from '../components/insurance';

const SEARCH_DEBOUNCE_MS = 300;
const MS_PER_DAY = 1000 * 60 * 60 * 24;
const PAGE_SIZE = 20;
/** Rows loaded in full for a tab the server cannot filter (two statuses). */
const MERGED_TAB_CAP = 1000;

// The five tabs. 'pending_review' is the server's union of pending +
// submitted — both pre-verification states the broker still owns.
const INSURANCE_TABS = ['all', 'pending_review', 'verified', 'expiring_soon', 'rejected_revoked'] as const;
type InsuranceTab = (typeof INSURANCE_TABS)[number];

// Older deep links. Each still filters the list (server-side, literally) and
// is named in a chip because no tab says exactly that.
const LEGACY_STATUSES = ['pending', 'submitted', 'expired', 'rejected', 'revoked'] as const;
type LegacyStatus = (typeof LEGACY_STATUSES)[number];
type InsuranceStatus = InsuranceTab | LegacyStatus;

const INSURANCE_STATUSES: readonly string[] = [...INSURANCE_TABS, ...LEGACY_STATUSES];

const LEGACY_LABEL_KEYS: Record<LegacyStatus, string> = {
  pending: 'insurance.tab_pending',
  submitted: 'insurance.tab_submitted',
  expired: 'insurance.tab_expired',
  rejected: 'insurance.tab_rejected',
  revoked: 'insurance.tab_revoked',
};

// Tabs the server has no single filter for: load every status in the set.
const MERGED_TAB_STATUSES: Partial<Record<InsuranceStatus, readonly string[]>> = {
  rejected_revoked: ['rejected', 'revoked'],
};

// Pre-verification queues where "empty" means the broker is all caught up.
const REVIEW_QUEUE_STATUSES: ReadonlySet<InsuranceStatus> = new Set([
  'pending_review', 'pending', 'submitted',
]);

/** The tab that best represents a status filter (legacy values included). */
function tabForStatus(status: InsuranceStatus): InsuranceTab {
  switch (status) {
    case 'pending':
    case 'submitted':
      return 'pending_review';
    case 'rejected':
    case 'revoked':
      return 'rejected_revoked';
    case 'expired':
      return 'all';
    default:
      return status;
  }
}

/** The member a `?user_id=` deep link (User Edit → "Manage Insurance") points at. */
interface FilteredMember {
  id: number;
  name: string;
}

function createdDesc(a: InsuranceCertificate, b: InsuranceCertificate): number {
  return (parseServerTimestamp(b.created_at)?.getTime() ?? 0) - (parseServerTimestamp(a.created_at)?.getTime() ?? 0);
}

export function InsuranceCertificates() {
  const { t } = useTranslation('broker');
  usePageTitle(t('insurance.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const { formatInsuranceType } = useInsuranceFormatting();
  const csv = useCsvExport();

  // Stash the latest `t`/`toast` in refs so the fetch callbacks don't churn
  // identity on language switches (which would refetch for no reason).
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // Status filter is mirrored to `?status=` so stat-card deep-links and
  // browser back/forward work correctly.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status');
  const statusFilter: InsuranceStatus =
    urlStatus && INSURANCE_STATUSES.includes(urlStatus) ? (urlStatus as InsuranceStatus) : 'all';
  const setStatusFilter = useCallback(
    (next: InsuranceStatus) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') {
            params.delete('status');
          } else {
            params.set('status', next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // `?user_id=` is set by the "Manage Insurance" link from User Edit so the
  // page lands pre-filtered to that member's certificates.
  const userIdFilter = searchParams.get('user_id');
  const memberFilterId = (() => {
    const raw = Number(userIdFilter);
    return userIdFilter && Number.isInteger(raw) && raw > 0 ? raw : null;
  })();
  const [filteredMember, setFilteredMember] = useState<FilteredMember | null>(null);
  const clearMemberFilter = useCallback(() => {
    setPage(1);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.delete('user_id');
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  // Name the deep-linked member in the banner. A failed lookup still filters
  // (the API does that by id) and names the member by number.
  useEffect(() => {
    if (!memberFilterId) {
      setFilteredMember(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let name = '';
      try {
        const res = await adminUsers.get(memberFilterId);
        if (res.success && res.data) {
          const member = res.data as { name?: string; first_name?: string; last_name?: string };
          name = resolveUserDisplayName(member) || member.name || '';
        }
      } catch {
        // Fall through to the numbered fallback.
      }
      if (!cancelled) setFilteredMember({ id: memberFilterId, name });
    })();
    return () => { cancelled = true; };
  }, [memberFilterId]);

  const [items, setItems] = useState<InsuranceCertificate[]>([]);
  const [total, setTotal] = useState(0);
  /** True when `items` holds the whole filtered set and the table pages it locally. */
  const [clientPaged, setClientPaged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [listError, setListError] = useState(false);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [stats, setStats] = useState<InsuranceStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);

  // Broker config (for expiry warning days)
  const [expiryWarningDays, setExpiryWarningDays] = useState(30);

  // Modals
  const [formModal, setFormModal] = useState<{ open: boolean; certificate: InsuranceCertificate | null }>({
    open: false,
    certificate: null,
  });
  const [rejectItem, setRejectItem] = useState<InsuranceCertificate | null>(null);
  const [viewItem, setViewItem] = useState<InsuranceCertificate | null>(null);
  const [deleteItem, setDeleteItem] = useState<InsuranceCertificate | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Load broker config for expiry warning days
  useEffect(() => {
    (async () => {
      try {
        const res = await adminBroker.getConfiguration();
        if (res.success && res.data) {
          const cfg = res.data as BrokerConfig;
          if (cfg.insurance_expiry_warning_days) {
            setExpiryWarningDays(cfg.insurance_expiry_warning_days);
          }
        }
      } catch {
        // Use default 30 days
      }
    })();
  }, []);

  // The list query for the active filter — the page and the CSV export use
  // the same one, so an export is exactly what the screen shows.
  const listParams = useMemo<InsuranceListParams>(() => {
    const params: InsuranceListParams = {};
    if (statusFilter === 'expiring_soon') {
      params.expiring_soon = true;
    } else if (statusFilter !== 'all' && !MERGED_TAB_STATUSES[statusFilter]) {
      params.status = statusFilter;
    }
    if (debouncedSearch.trim()) {
      params.search = debouncedSearch.trim();
    }
    if (userIdFilter) {
      params.user_id = userIdFilter;
    }
    return params;
  }, [statusFilter, debouncedSearch, userIdFilter]);
  const mergedStatuses = MERGED_TAB_STATUSES[statusFilter];

  const loadStats = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setStatsLoading(true);
    setStatsError(false);
    try {
      const res = await adminInsurance.stats();
      if (res.success && res.data) {
        setStats(res.data as InsuranceStats);
      } else {
        // A silently-zero "Pending" tile during a DB hiccup hides
        // certificates that need attention. Surface the failure.
        setStatsError(true);
      }
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // `quiet` is the auto-refresh path: no spinner, no error toast — the table
  // keeps its rows and the next visible refresh reports any failure.
  const loadItems = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    setListError(false);
    try {
      if (mergedStatuses) {
        const results = await Promise.all(
          mergedStatuses.map((status) =>
            collectRows((p) => fetchInsurancePage({ ...listParams, status }, p), MERGED_TAB_CAP),
          ),
        );
        const merged = results.flatMap((r) => r.rows).sort(createdDesc);
        setItems(merged);
        setTotal(merged.length);
        setClientPaged(true);
      } else {
        const result = await fetchInsurancePage(listParams, page, PAGE_SIZE);
        setItems(result.rows);
        setTotal(result.total ?? result.rows.length);
        setClientPaged(false);
      }
    } catch {
      setListError(true);
      if (!opts.quiet) toastRef.current.error(tRef.current('insurance.load_failed'));
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [listParams, mergedStatuses, page]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadItems(); }, [loadItems]);

  // Quiet refresh after any broker/admin write, on tab return, and on an interval.
  useBrokerAutoRefresh(() => {
    loadItems({ quiet: true });
    loadStats({ quiet: true });
  });

  const reload = () => {
    loadItems();
    loadStats();
  };

  const handleVerify = async (item: InsuranceCertificate) => {
    setVerifyingId(item.id);
    try {
      const res = await adminInsurance.verify(item.id);
      if (res?.success) {
        toast.success(t('insurance.verify_success'));
        reload();
      } else {
        toast.error(res?.error || t('insurance.verify_failed'));
      }
    } catch {
      toast.error(t('insurance.verify_failed'));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setDeleteLoading(true);
    try {
      const res = await adminInsurance.destroy(deleteItem.id);
      if (res?.success) {
        toast.success(t('insurance.delete_success'));
        reload();
      } else {
        toast.error(res?.error || t('insurance.delete_failed'));
      }
    } catch {
      toast.error(t('insurance.delete_failed'));
    } finally {
      setDeleteLoading(false);
      setDeleteItem(null);
    }
  };

  const handleExport = () =>
    csv.run<InsuranceCertificate>({
      filename: `insurance-certificates_${statusFilter}`,
      columns: [
        { label: t('insurance.col_member'), value: (r) => resolveUserDisplayName(r) },
        { label: t('insurance.csv_member_email'), value: (r) => r.email },
        { label: t('insurance.col_provider'), value: (r) => r.provider_name },
        { label: t('insurance.col_policy'), value: (r) => r.policy_number },
        { label: t('insurance.label_coverage_amount'), value: (r) => r.coverage_amount },
        { label: t('insurance.csv_valid_from'), value: (r) => isoDateOnly(r.start_date) },
        { label: t('insurance.csv_valid_to'), value: (r) => isoDateOnly(r.expiry_date) },
        { label: t('insurance.col_status'), value: (r) => r.status },
        {
          label: t('insurance.label_verified_by'),
          value: (r) => (r.verifier_first_name
            ? resolveUserDisplayNameFromPrefix(r as unknown as Record<string, unknown>, 'verifier_')
            : ''),
        },
        { label: t('insurance.label_verified_at'), value: (r) => r.verified_at },
      ],
      fetchPage: async (p) => {
        if (!mergedStatuses) return fetchInsurancePage(listParams, p);
        const pages = await Promise.all(
          mergedStatuses.map((status) => fetchInsurancePage({ ...listParams, status }, p)),
        );
        return { rows: pages.flatMap((x) => x.rows), hasMore: pages.some((x) => x.hasMore) };
      },
    });

  // Expiry-urgency countdown chip — danger once expired, warning inside the
  // configurable warning window.
  const renderExpiryCell = (item: InsuranceCertificate) => {
    const expiry = parseServerTimestamp(item.expiry_date);
    if (!expiry) return <span className="text-sm text-muted">{'—'}</span>;
    const daysUntilExpiry = Math.ceil((expiry.getTime() - Date.now()) / MS_PER_DAY);
    const isExpired = daysUntilExpiry <= 0;
    const isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= expiryWarningDays;

    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`text-sm tabular-nums ${
            isExpired ? 'font-medium text-danger' : isExpiringSoon ? 'font-medium text-warning' : 'text-muted'
          }`}
        >
          {expiry.toLocaleDateString(getFormattingLocale())}
        </span>
        {isExpired && (
          <Chip size="sm" variant="soft" color="danger" className="shrink-0 tabular-nums">
            {daysUntilExpiry === 0
              ? t('insurance.expiry_expired_today')
              : t('insurance.expiry_expired_days_ago', { days: Math.abs(daysUntilExpiry) })}
          </Chip>
        )}
        {isExpiringSoon && (
          <Chip size="sm" variant="soft" color="warning" className="shrink-0 tabular-nums">
            {t('insurance.expiry_days_left', { days: daysUntilExpiry })}
          </Chip>
        )}
      </div>
    );
  };

  const columns: Column<InsuranceCertificate>[] = [
    {
      // Not sortable: the row has no `member` field, so the shared table's
      // client-side sort had nothing to compare and silently did nothing.
      key: 'member',
      label: t('insurance.col_member'),
      render: (item) => (
        <div className="flex items-center gap-2">
          <Avatar
            src={resolveAvatarUrl(item.avatar_url) || undefined}
            name={resolveUserDisplayName(item)}
            size="sm"
            className="shrink-0"
          />
          <div className="min-w-0">
            <MemberName userId={item.user_id} name={resolveUserDisplayName(item)} className="block truncate" />
            <p className="truncate text-xs text-muted">{item.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'insurance_type',
      label: t('insurance.col_type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color="accent">
          {formatInsuranceType(item.insurance_type)}
        </Chip>
      ),
    },
    {
      key: 'status',
      label: t('insurance.col_status'),
      sortable: true,
      render: (item) => <BrokerStatusChip status={item.status} />,
    },
    {
      key: 'provider_name',
      label: t('insurance.col_provider'),
      render: (item) => (
        <span className="block max-w-[160px] truncate text-sm text-muted">
          {item.provider_name || '—'}
        </span>
      ),
    },
    {
      key: 'policy_number',
      label: t('insurance.col_policy'),
      render: (item) => (
        <span className="font-mono text-sm tabular-nums text-muted">
          {item.policy_number || '—'}
        </span>
      ),
    },
    {
      key: 'expiry_date',
      label: t('insurance.col_expiry'),
      sortable: true,
      render: renderExpiryCell,
    },
    {
      key: 'actions',
      label: t('insurance.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setViewItem(item)}
            aria-label={t('insurance.view_details_aria')}
          >
            <Eye size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setFormModal({ open: true, certificate: item })}
            aria-label={t('insurance.edit_certificate_aria')}
          >
            <Pencil size={14} />
          </Button>
          {(item.status === 'pending' || item.status === 'submitted') && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                isPending={verifyingId === item.id}
                onPress={() => handleVerify(item)}
                aria-label={t('insurance.verify_certificate_aria')}
              >
                <Check size={14} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger-soft"
                onPress={() => setRejectItem(item)}
                aria-label={t('insurance.reject_certificate_aria')}
              >
                <X size={14} />
              </Button>
            </>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            onPress={() => setDeleteItem(item)}
            aria-label={t('insurance.delete_certificate_aria')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const isReviewQueue = REVIEW_QUEUE_STATUSES.has(statusFilter);
  const hasActiveNarrowing = Boolean(debouncedSearch.trim()) || statusFilter !== 'all' || Boolean(userIdFilter);
  const pendingReviewCount = stats?.pending_review ?? stats?.pending ?? 0;
  const legacyStatus = (LEGACY_STATUSES as readonly string[]).includes(statusFilter)
    ? (statusFilter as LegacyStatus)
    : null;
  const visibleItems = clientPaged ? items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE) : items;

  const openCreate = () => setFormModal({ open: true, certificate: null });

  const emptyState = isReviewQueue && !debouncedSearch.trim() ? (
    <BrokerEmptyState
      bare
      icon={ShieldCheck}
      color="success"
      title={t('insurance.empty_queue_title')}
      hint={t('insurance.empty_queue_hint')}
    />
  ) : hasActiveNarrowing ? (
    <BrokerEmptyState
      bare
      icon={Search}
      color="neutral"
      title={t('insurance.empty_title')}
      hint={t('insurance.empty_try_filter')}
    />
  ) : (
    <BrokerEmptyState
      bare
      icon={FileText}
      color="neutral"
      title={t('insurance.empty_title')}
      hint={t('insurance.empty_add_to_start')}
      action={
        <Button size="sm" variant="primary" startContent={<Plus size={14} />} onPress={openCreate}>
          {t('insurance.add_certificate')}
        </Button>
      }
    />
  );

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_exchanges', articleId: 'broker_insurance' }}
      title={t('insurance.page_title')}
      description={t('insurance.page_description')}
      icon={ShieldCheck}
      color="success"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            startContent={<Download size={16} aria-hidden="true" />}
            onPress={handleExport}
            isPending={csv.exporting}
            isDisabled={!hasLoadedOnce}
          >
            {csv.exporting ? t('common.exporting') : t('common.export_csv')}
          </Button>
          <Button variant="primary" startContent={<Plus size={16} />} size="sm" onPress={openCreate}>
            {t('insurance.add_certificate')}
          </Button>
        </>
      }
      toolbar={
        <div className="flex flex-col gap-2">
          <Input
            placeholder={t('insurance.search_placeholder')}
            aria-label={t('insurance.search_aria')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
            variant="secondary"
            size="sm"
            className="max-w-md"
            isClearable
            onClear={() => setSearchQuery('')}
          />
          <Tabs
            aria-label={t('insurance.tabs_aria')}
            selectedKey={tabForStatus(statusFilter)}
            onSelectionChange={(key) => { setStatusFilter(key as InsuranceTab); setPage(1); }}
            variant="underlined"
            size="sm"
          >
            <Tab key="all" title={t('insurance.tab_all')} />
            <Tab
              key="pending_review"
              title={
                <div className="flex items-center gap-2">
                  <span>{t('insurance.tab_pending_review')}</span>
                  {!statsLoading && pendingReviewCount > 0 && (
                    <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                      {pendingReviewCount}
                    </Chip>
                  )}
                </div>
              }
            />
            <Tab key="verified" title={t('insurance.tab_verified')} />
            <Tab key="expiring_soon" title={t('insurance.tab_expiring_soon')} />
            <Tab key="rejected_revoked" title={t('insurance.tab_rejected_revoked')} />
          </Tabs>
          {legacyStatus && (
            // An older link narrowed the list further than any tab says.
            <div role="status" className="flex flex-wrap items-center gap-2 px-1 pb-1 text-xs text-muted">
              <span>{t('insurance.legacy_filter_label')}</span>
              <Chip size="sm" variant="soft" color="default">{t(LEGACY_LABEL_KEYS[legacyStatus])}</Chip>
              <Button size="sm" variant="tertiary" onPress={() => { setStatusFilter('all'); setPage(1); }}>
                {t('insurance.member_filter_clear')}
              </Button>
            </div>
          )}
        </div>
      }
    >
      {statsError && (
        <Alert
          role="alert"
          color="warning"
          className="mb-4 rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface p-4 shadow-sm"
          classNames={{
            title: 'text-sm font-semibold text-foreground',
            description: 'text-sm leading-6 text-foreground',
            icon: 'text-warning',
          }}
          icon={<ShieldAlert size={20} aria-hidden="true" />}
          title={t('insurance.stats_error_title')}
          description={t('insurance.stats_error_body')}
          endContent={(
            <Button size="sm" variant="secondary" className="shrink-0 self-center" onPress={() => loadStats()}>
              <RefreshCw size={14} aria-hidden="true" />
              {t('insurance.retry')}
            </Button>
          )}
        />
      )}

      {memberFilterId !== null && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-foreground"
        >
          <Info size={17} className="shrink-0 text-accent" aria-hidden="true" />
          <p className="min-w-0 flex-1">
            {t('insurance.member_filter_banner', {
              name: filteredMember?.name || t('insurance.member_filter_fallback_name', { id: memberFilterId }),
            })}
          </p>
          <Button size="sm" variant="tertiary" onPress={clearMemberFilter}>
            {t('insurance.member_filter_clear')}
          </Button>
        </div>
      )}

      {/* KPI header — cards deep-link into the matching filtered view */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('insurance.stat_total')}
          value={stats?.total ?? 0}
          icon={FileText}
          color="neutral"
          loading={statsLoading}
        />
        <BrokerStatCard
          label={t('insurance.stat_pending_review')}
          value={pendingReviewCount}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          to={tenantPath('/broker/insurance?status=pending_review')}
        />
        <BrokerStatCard
          label={t('insurance.stat_verified')}
          value={stats?.verified ?? 0}
          icon={ShieldCheck}
          color="success"
          loading={statsLoading}
          to={tenantPath('/broker/insurance?status=verified')}
        />
        <BrokerStatCard
          label={t('insurance.stat_expiring_soon')}
          value={stats?.expiring_soon ?? 0}
          icon={ShieldAlert}
          color="danger"
          loading={statsLoading}
          to={tenantPath('/broker/insurance?status=expiring_soon')}
        />
      </div>

      {/* First load: shaped skeleton. Refreshes keep DataTable's own isLoading. */}
      {!hasLoadedOnce && loading ? (
        <BrokerSkeleton variant="table" />
      ) : listError && !loading && items.length === 0 ? (
        <BrokerEmptyState
          icon={ShieldAlert}
          color="danger"
          title={t('insurance.load_failed')}
          hint={t('insurance.load_error_hint')}
          action={
            <Button size="sm" variant="tertiary" onPress={() => loadItems()}>
              {t('insurance.retry')}
            </Button>
          }
        />
      ) : (
        <DataTable
          stickyActions
          mobileCards
          columns={columns}
          data={visibleItems}
          isLoading={loading}
          searchable={false}
          onRefresh={() => loadItems()}
          totalItems={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          emptyContent={emptyState}
        />
      )}

      <InsuranceCertificateFormModal
        isOpen={formModal.open}
        certificate={formModal.certificate}
        onClose={() => setFormModal((prev) => ({ ...prev, open: false }))}
        onSaved={reload}
      />

      <InsuranceRejectModal
        item={rejectItem}
        onClose={() => setRejectItem(null)}
        onRejected={reload}
      />

      <InsuranceCertificateViewModal item={viewItem} onClose={() => setViewItem(null)} />

      <ConfirmModal
        isOpen={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
        title={t('insurance.confirm_delete_title')}
        message={deleteItem ? t('insurance.confirm_delete_message') : ''}
        confirmLabel={t('insurance.delete')}
        confirmColor="danger"
        isLoading={deleteLoading}
      />
    </BrokerPageShell>
  );
}

export default InsuranceCertificates;
