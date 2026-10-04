// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Safeguarding vetting confirmations without certificate evidence.
 *
 * Brokers record controlled certification schemes, encrypted operational scope
 * and private notes, and the dates needed to renew the community decision.
 * The policy card and the four modals live in ../components/vetting/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import Check from 'lucide-react/icons/check';
import CircleSlash from 'lucide-react/icons/circle-slash';
import Download from 'lucide-react/icons/download';
import FileText from 'lucide-react/icons/file-text';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import UserCheck from 'lucide-react/icons/user-check';
import Users from 'lucide-react/icons/users';
import Info from 'lucide-react/icons/info';

import { Alert, Avatar, Button, Chip, Tab, Tabs } from '@/components/ui';
import { DataTable, type Column } from '@/admin/components';
import { adminUsers, adminVetting } from '@/admin/api/adminApi';
import type {
  SafeguardingVettingPolicy,
  VettingPolicyResponse,
  VettingRecord,
  VettingStats,
} from '@/admin/api/types';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import { isAdminTierUser } from '@/lib/access';
import {
  BrokerEmptyState,
  BrokerPageShell,
  BrokerStatCard,
  BrokerStatusChip,
} from '../components';
import { VettingPolicyCard } from '../components/vetting/VettingPolicyCard';
import { VettingConfirmModal } from '../components/vetting/VettingConfirmModal';
import { VettingDetailModal } from '../components/vetting/VettingDetailModal';
import { VettingRevokeModal } from '../components/vetting/VettingRevokeModal';
import {
  VettingResolveModal,
  SAFE_REVIEW_RESOLUTION_CODES,
  type ReviewResolutionCode,
} from '../components/vetting/VettingResolveModal';
import { MemberName } from '../BrokerMemberWindow';
import { useBrokerAutoRefresh } from '../useBrokerAutoRefresh';
import { useCsvExport } from '../useCsvExport';

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;
/** Rows per page while exporting — the endpoint's maximum. */
const EXPORT_PAGE_SIZE = 100;

const FILTERS = [
  'all',
  'review_requested',
  'confirmed',
  'expired',
  'revoked',
  'not_confirmed',
] as const;

type VettingFilter = (typeof FILTERS)[number];

interface VettingListMeta {
  total?: number;
  total_items?: number;
  has_more?: boolean;
  pagination?: {
    total?: number;
    current_page?: number;
    last_page?: number;
    per_page?: number;
  };
}

function readMeta(response: Awaited<ReturnType<typeof adminVetting.list>>): VettingListMeta | undefined {
  return response.meta as unknown as VettingListMeta | undefined;
}

function readTotal(meta: VettingListMeta | undefined, fallback: number): number {
  return meta?.pagination?.total ?? meta?.total ?? meta?.total_items ?? fallback;
}

/** True when a further page exists behind `page`. */
function readHasMore(meta: VettingListMeta | undefined, page: number, pageRows: number): boolean {
  if (typeof meta?.has_more === 'boolean') return meta.has_more;
  const lastPage = meta?.pagination?.last_page;
  if (typeof lastPage === 'number') return page < lastPage;
  const total = readTotal(meta, 0);
  return total > 0 ? page * EXPORT_PAGE_SIZE < total : pageRows === EXPORT_PAGE_SIZE;
}

function memberName(item: VettingRecord): string {
  return resolveUserDisplayName(item);
}

function rowStatus(item: VettingRecord): string {
  if (item.review_status === 'pending') return 'review_requested';
  return item.is_expired ? 'expired' : item.decision;
}

function rowTimestamp(item: VettingRecord): string | null {
  if (item.review_status === 'pending') return item.requested_at;
  if (item.decision === 'confirmed') return item.confirmed_at;
  if (item.decision === 'revoked') return item.revoked_at;
  return null;
}

/** The member a `?user_id=` deep link (Members → "Check Vetting") points at. */
interface FilteredMember {
  id: number;
  name: string;
  /** Drives the server-side search — the list endpoint has no user_id filter. */
  email: string | null;
}

export function VettingRecords() {
  const { t } = useTranslation('broker');
  usePageTitle(t('vetting.title'));
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const csv = useCsvExport();
  const [searchParams, setSearchParams] = useSearchParams();

  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const requestedFilter = searchParams.get('status') as VettingFilter | null;
  const filter: VettingFilter = requestedFilter && FILTERS.includes(requestedFilter)
    ? requestedFilter
    : 'all';
  // `?user_id=` narrows the list to one member (set by Members → "Check
  // Vetting"). Anything that is not a positive integer is ignored.
  const memberFilterId = (() => {
    const raw = Number(searchParams.get('user_id'));
    return Number.isInteger(raw) && raw > 0 ? raw : null;
  })();
  const [filteredMember, setFilteredMember] = useState<FilteredMember | null>(null);

  const [items, setItems] = useState<VettingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);

  const [stats, setStats] = useState<VettingStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);

  const [policyData, setPolicyData] = useState<VettingPolicyResponse | null>(null);
  const [policyLoading, setPolicyLoading] = useState(true);
  const [policyError, setPolicyError] = useState(false);

  // One modal at a time; each is mounted fresh per member so its form starts clean.
  const [confirmItem, setConfirmItem] = useState<VettingRecord | null>(null);
  const [detailItem, setDetailItem] = useState<VettingRecord | null>(null);
  const [revokeItem, setRevokeItem] = useState<VettingRecord | null>(null);
  const [resolveItem, setResolveItem] = useState<VettingRecord | null>(null);

  // Only an admin may choose the safeguarding jurisdiction (owner decision,
  // 3 Oct 2026). Everyone else sees it, read-only, marked Admin only.
  const canConfigurePolicy = isAdminTierUser(user);

  const policy = policyData?.policy ?? stats?.policy ?? null;
  const canRecordDecision = Boolean(policy?.configured && policy.contact_policy_available);
  // Coordinators see vetting but make no vetting decisions (the server refuses
  // them: requireVettingDecisionMaker), so they get no decision buttons.
  const isCoordinator = String(user?.role ?? '') === 'coordinator';
  const reviewPending = stats?.review_pending ?? stats?.review_requested ?? 0;
  const certificationLabel = useCallback((code: string, recordPolicy: SafeguardingVettingPolicy | null | undefined = policy) =>
    recordPolicy?.certification_options.find((option) => option.code === code)?.label
      ?? t(`vetting.attestation_${code}`, { defaultValue: code }), [policy, t]);

  // Tab badges read the same stats the KPI cards read, so a tab can never
  // disagree with its card. Null while unknown (no badge).
  const tabCounts: Record<VettingFilter, number | null> = {
    all: stats?.total_members ?? null,
    review_requested: stats ? reviewPending : null,
    confirmed: stats?.confirmed ?? null,
    expired: stats?.expired ?? null,
    revoked: stats?.revoked ?? null,
    not_confirmed: stats?.not_confirmed ?? null,
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const setFilter = useCallback((next: VettingFilter) => {
    setPage(1);
    setSearchParams((previous) => {
      const nextParams = new URLSearchParams(previous);
      if (next === 'all') nextParams.delete('status');
      else nextParams.set('status', next);
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  const clearMemberFilter = useCallback(() => {
    setPage(1);
    setSearchParams((previous) => {
      const nextParams = new URLSearchParams(previous);
      nextParams.delete('user_id');
      return nextParams;
    }, { replace: true });
  }, [setSearchParams]);

  // Resolve the deep-linked member's name and email. The name feeds the
  // banner; the email feeds the list search. A failed lookup still filters
  // (client-side, by id) and names the member by number.
  useEffect(() => {
    if (!memberFilterId) {
      setFilteredMember(null);
      return;
    }
    let cancelled = false;
    (async () => {
      let next: FilteredMember = { id: memberFilterId, name: '', email: null };
      try {
        const response = await adminUsers.get(memberFilterId);
        if (response.success && response.data) {
          const member = response.data as { name?: string; first_name?: string; last_name?: string; email?: string };
          next = {
            id: memberFilterId,
            name: resolveUserDisplayName(member) || member.name || '',
            email: member.email?.trim() || null,
          };
        }
      } catch {
        // Fall through to the id-only filter.
      }
      if (!cancelled) setFilteredMember(next);
    })();
    return () => { cancelled = true; };
  }, [memberFilterId]);

  const loadPolicy = useCallback(async (quiet = false) => {
    if (!quiet) setPolicyLoading(true);
    setPolicyError(false);
    try {
      const response = await adminVetting.policy();
      if (!response.success || !response.data) {
        setPolicyError(true);
        return;
      }
      const data = response.data;
      const reviewResolutionCodes = SAFE_REVIEW_RESOLUTION_CODES.filter((code) =>
        data.review_resolution_codes.includes(code),
      );
      setPolicyData({ ...data, review_resolution_codes: reviewResolutionCodes });
    } catch {
      setPolicyError(true);
    } finally {
      setPolicyLoading(false);
    }
  }, []);

  const loadStats = useCallback(async (quiet = false) => {
    if (!quiet) setStatsLoading(true);
    setStatsError(false);
    try {
      const response = await adminVetting.stats();
      if (response.success && response.data) setStats(response.data);
      else setStatsError(true);
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // With a member filter, wait until that member is resolved so the request
  // can carry their email as the search term.
  const memberFilterPending = memberFilterId !== null && filteredMember?.id !== memberFilterId;
  const searchTerm = memberFilterId ? (filteredMember?.email ?? '') : debouncedSearch;

  // `quiet` loads (auto-refresh after a write, tab focus, interval) keep the
  // current rows on screen instead of flashing a loading state.
  const loadItems = useCallback(async (quiet = false) => {
    if (memberFilterPending) return;
    if (!quiet) setLoading(true);
    setListError(false);
    try {
      const response = await adminVetting.list({
        status: filter,
        page,
        per_page: PAGE_SIZE,
        ...(searchTerm ? { search: searchTerm } : {}),
      });
      if (!response.success || !Array.isArray(response.data)) {
        setListError(true);
        return;
      }
      // The email search can match more than one member (a shared domain),
      // so the deep link narrows the page to the member it names.
      const rows = memberFilterId
        ? response.data.filter((row) => row.user_id === memberFilterId)
        : response.data;
      setItems(rows);
      setTotal(memberFilterId ? rows.length : readTotal(readMeta(response), response.data.length));
    } catch {
      setListError(true);
      if (!quiet) toastRef.current.error(tRef.current('vetting.toast_load_failed'));
    } finally {
      setLoading(false);
    }
  }, [filter, page, memberFilterId, memberFilterPending, searchTerm]);

  const refreshAll = useCallback(() => {
    void Promise.all([loadItems(), loadStats(), loadPolicy()]);
  }, [loadItems, loadPolicy, loadStats]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    void loadStats();
    void loadPolicy();
  }, [loadPolicy, loadStats]);

  useBrokerAutoRefresh(() => {
    void loadItems(true);
    void loadStats(true);
  });

  const exportCsv = () =>
    csv.run<VettingRecord>({
      filename: ['vetting', filter, memberFilterId ? `member-${memberFilterId}` : null].filter(Boolean).join('_'),
      columns: [
        { label: t('vetting.col_member'), value: memberName },
        { label: t('vetting.col_status'), value: (row) => t(`status.${rowStatus(row)}`, { defaultValue: rowStatus(row) }) },
        { label: t('vetting.export_col_confirmed_at'), value: (row) => (row.confirmed_at ? formatServerDateTime(row.confirmed_at) : '') },
        { label: t('vetting.review_due_label'), value: (row) => (row.review_due_at ? formatServerDate(row.review_due_at) : '') },
        // The list carries the handler's id only (no name); the header says so.
        { label: t('vetting.export_col_handled_by'), value: (row) => row.confirmed_by ?? row.revoked_by ?? '' },
      ],
      fetchPage: async (exportPage) => {
        const response = await adminVetting.list({
          status: filter,
          page: exportPage,
          per_page: EXPORT_PAGE_SIZE,
          ...(searchTerm ? { search: searchTerm } : {}),
        });
        if (!response.success || !Array.isArray(response.data)) throw new Error('export page failed');
        const rows = memberFilterId
          ? response.data.filter((row) => row.user_id === memberFilterId)
          : response.data;
        return { rows, hasMore: readHasMore(readMeta(response), exportPage, response.data.length) };
      },
    });

  const columns = useMemo<Column<VettingRecord>[]>(() => [
    {
      key: 'member',
      label: t('vetting.col_member'),
      isRowHeader: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <Avatar
            src={resolveAvatarUrl(item.avatar_url) || undefined}
            name={memberName(item)}
            size="sm"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              <MemberName userId={item.user_id} name={memberName(item)} />
            </p>
            <p className="truncate text-xs text-muted">{item.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'scheme',
      hideBelow: '2xl',
      hideInCard: true,
      label: t('vetting.col_scheme'),
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          {item.certification_codes.length > 0
            ? item.certification_codes.map((code) => (
              <Chip key={code} size="sm" variant="soft" color="accent">
                {certificationLabel(code, item.policy)}
              </Chip>
            ))
            : <span className="text-sm text-muted">{item.policy.attestation_label || t('vetting.scheme_unavailable')}</span>}
        </div>
      ),
    },
    {
      key: 'decision',
      label: t('vetting.col_status'),
      render: (item) => <BrokerStatusChip status={rowStatus(item)} />,
    },
    {
      key: 'updated',
      label: t('vetting.col_updated'),
      render: (item) => (
        <span className="text-sm text-muted">
          {rowTimestamp(item) ? formatServerDateTime(rowTimestamp(item)) : t('vetting.not_recorded')}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('vetting.col_actions'),
      render: (item) => (
        <div className="flex flex-wrap gap-2">
          {isCoordinator ? null : item.decision !== 'confirmed' || item.is_expired ? (
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!canRecordDecision}
              onPress={() => setConfirmItem(item)}
            >
              <Check size={14} aria-hidden="true" />
              {item.is_expired ? t('vetting.action_renew') : t('vetting.action_confirm')}
            </Button>
          ) : (
            <Button
              size="sm"
              variant="danger-soft"
              isDisabled={!canRecordDecision}
              onPress={() => setRevokeItem(item)}
            >
              <CircleSlash size={14} aria-hidden="true" />
              {t('vetting.action_revoke')}
            </Button>
          )}
          {item.attestation_id && (
            <Button size="sm" variant="tertiary" onPress={() => setDetailItem(item)}>
              <FileText size={14} aria-hidden="true" />
              {t('vetting.action_details')}
            </Button>
          )}
          {!isCoordinator && item.review_status === 'pending' && item.review_request_id && (
            <Button size="sm" variant="tertiary" onPress={() => setResolveItem(item)}>
              {t('vetting.action_resolve')}
            </Button>
          )}
        </div>
      ),
    },
  ], [canRecordDecision, certificationLabel, isCoordinator, t]);

  const emptyContent = (
    <BrokerEmptyState
      bare
      icon={filter === 'review_requested' ? ShieldCheck : Users}
      color={filter === 'review_requested' ? 'success' : 'neutral'}
      title={filter === 'review_requested' ? t('vetting.empty_review_title') : t('vetting.empty_title')}
      hint={debouncedSearch || filter !== 'all' ? t('vetting.empty_filtered_hint') : t('vetting.empty_hint')}
    />
  );

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_vetting_confirm' }}
      title={t('vetting.title')}
      description={t('vetting.description')}
      icon={ShieldCheck}
      color="success"
      actions={(
        <>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<Download size={16} aria-hidden="true" />}
            onPress={() => void exportCsv()}
            isLoading={csv.exporting}
            isDisabled={memberFilterPending}
          >
            {csv.exporting ? t('common.exporting') : t('common.export_csv')}
          </Button>
          <Button isIconOnly variant="tertiary" size="sm" onPress={refreshAll} aria-label={t('vetting.refresh')}>
            <RefreshCw size={16} aria-hidden="true" />
          </Button>
        </>
      )}
      toolbar={(
        <Tabs
          aria-label={t('vetting.tabs_aria')}
          selectedKey={filter}
          onSelectionChange={(key) => setFilter(key as VettingFilter)}
          variant="underlined"
          size="sm"
        >
          {FILTERS.map((value) => {
            const count = tabCounts[value];
            return (
              <Tab
                key={value}
                title={(
                  <div className="flex items-center gap-2">
                    <span>{t(`vetting.filter_${value}`)}</span>
                    {count != null && (
                      <Chip
                        size="sm"
                        variant="soft"
                        color={value === 'review_requested' && count > 0 ? 'warning' : 'default'}
                        className="tabular-nums"
                      >
                        {count}
                      </Chip>
                    )}
                  </div>
                )}
              />
            );
          })}
        </Tabs>
      )}
    >
      <div className="space-y-5">
        <VettingPolicyCard
          policyLoading={policyLoading}
          policyError={policyError}
          policy={policy}
          policyData={policyData}
          isCoordinator={isCoordinator}
          canRecordDecision={canRecordDecision}
          canConfigurePolicy={canConfigurePolicy}
        />

        <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-5">
          <BrokerStatCard label={t('vetting.stat_total_members')} value={stats?.total_members} icon={Users} color="neutral" loading={statsLoading} />
          <BrokerStatCard label={t('vetting.stat_review_requested')} value={reviewPending} icon={RefreshCw} color="warning" loading={statsLoading} to={tenantPath('/broker/vetting?status=review_requested')} />
          <BrokerStatCard label={t('vetting.stat_confirmed')} value={stats?.confirmed} icon={UserCheck} color="success" loading={statsLoading} to={tenantPath('/broker/vetting?status=confirmed')} />
          <BrokerStatCard label={t('vetting.stat_expired')} value={stats?.expired} icon={CalendarClock} color="danger" loading={statsLoading} to={tenantPath('/broker/vetting?status=expired')} />
          <BrokerStatCard label={t('vetting.stat_revoked')} value={stats?.revoked} icon={CircleSlash} color="danger" loading={statsLoading} to={tenantPath('/broker/vetting?status=revoked')} />
        </div>

        {statsError && (
          // Same treatment as the dashboard's partial-data notice: foreground
          // text on the card surface with an amber edge.
          <Alert
            role="alert"
            color="warning"
            className="rounded-2xl border border-warning/40 border-l-4 border-l-warning bg-surface p-4 shadow-sm"
            classNames={{
              title: 'text-sm font-semibold text-foreground',
              description: 'text-sm leading-6 text-foreground',
              icon: 'text-warning',
            }}
            icon={<AlertTriangle size={20} aria-hidden="true" />}
            title={t('vetting.stats_error_title')}
            description={t('vetting.list_error_body')}
            endContent={(
              <Button size="sm" variant="secondary" className="shrink-0 self-center" onPress={() => void loadStats()}>
                <RefreshCw size={14} aria-hidden="true" />
                {t('vetting.retry')}
              </Button>
            )}
          />
        )}

        {memberFilterId !== null && (
          <div
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-foreground"
          >
            <Info size={17} className="shrink-0 text-accent" aria-hidden="true" />
            <p className="min-w-0 flex-1">
              {t('vetting.member_filter_banner', {
                name: filteredMember?.name || t('vetting.member_filter_fallback_name', { id: memberFilterId }),
              })}
            </p>
            <Button size="sm" variant="tertiary" onPress={clearMemberFilter}>
              {t('vetting.member_filter_clear')}
            </Button>
          </div>
        )}

        {listError ? (
          <BrokerEmptyState
            icon={AlertTriangle}
            color="danger"
            title={t('vetting.list_error_title')}
            hint={t('vetting.list_error_body')}
            action={<Button size="sm" variant="secondary" onPress={() => void loadItems()}>{t('vetting.retry')}</Button>}
          />
        ) : (
          <DataTable
            stickyActions
            mobileCards
            columns={columns}
            data={items}
            keyField="user_id"
            isLoading={loading || memberFilterPending}
            // The member filter owns the search term; hide the box so a typed
            // term cannot silently fight it.
            searchable={memberFilterId === null}
            searchPlaceholder={t('vetting.search_placeholder')}
            totalItems={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onSearch={setSearch}
            onRefresh={() => void loadItems()}
            emptyContent={emptyContent}
          />
        )}
      </div>

      {confirmItem && (
        <VettingConfirmModal
          key={`confirm-${confirmItem.user_id}`}
          item={confirmItem}
          canRecordDecision={canRecordDecision}
          onClose={() => setConfirmItem(null)}
          onConfirmed={refreshAll}
        />
      )}

      {detailItem && (
        <VettingDetailModal
          key={`detail-${detailItem.user_id}`}
          item={detailItem}
          certificationLabel={certificationLabel}
          onClose={() => setDetailItem(null)}
        />
      )}

      {revokeItem && (
        <VettingRevokeModal
          key={`revoke-${revokeItem.user_id}`}
          item={revokeItem}
          reasonCodes={policyData?.revocation_reason_codes ?? []}
          canRecordDecision={canRecordDecision}
          onClose={() => setRevokeItem(null)}
          onRevoked={refreshAll}
        />
      )}

      {resolveItem && (
        <VettingResolveModal
          key={`resolve-${resolveItem.user_id}`}
          item={resolveItem}
          resolutionCodes={(policyData?.review_resolution_codes ?? []) as ReviewResolutionCode[]}
          onClose={() => setResolveItem(null)}
          onResolved={refreshAll}
        />
      )}
    </BrokerPageShell>
  );
}

export default VettingRecords;
