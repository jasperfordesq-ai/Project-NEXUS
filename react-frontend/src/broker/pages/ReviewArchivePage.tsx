// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Review Archive
 * Compliance archive of reviewed broker message copies.
 * Read-only listing with filtering by decision status.
 * Parity: PHP BrokerControlsController::archives()
 *
 * Restyled to the broker design language: BrokerPageShell frame ('neutral'
 * records domain), KPI header derived from the rows the page already fetches,
 * deep-linkable decision tabs (?decision=approved|flagged), avatar reviewer
 * cells, tabular timestamps, shaped skeleton loading, filter-aware empty
 * states and an honest error state with retry. This page stays read-only —
 * no mutations, ever.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Archive from 'lucide-react/icons/archive';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Flag from 'lucide-react/icons/flag';
import Inbox from 'lucide-react/icons/inbox';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import SearchX from 'lucide-react/icons/search-x';
import Users from 'lucide-react/icons/users';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { BrokerArchive } from '@/admin/api/types';
import { Avatar, Button, Chip, Input, Tabs, Tab } from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';

// The decision filter is driven by the URL so the KPI cards (and any future
// dashboard tiles) can deep-link straight into a filtered archive view.
const ALLOWED_DECISIONS = ['all', 'approved', 'flagged'] as const;
type DecisionFilter = (typeof ALLOWED_DECISIONS)[number];

// Decision chip — 'approved' is a panel-wide status and routes through
// BrokerStatusChip so its color matches every other broker page; 'flagged'
// is archive-domain vocabulary the shared chip can't cover, so it keeps a
// flag-badged danger chip with its translated label.
function DecisionChip({ decision }: { decision: string }) {
  const { t } = useTranslation('broker');
  if (decision === 'approved') {
    return <BrokerStatusChip status="approved" />;
  }
  return (
    <Chip size="sm" variant="soft" color="danger">
      <Flag size={12} aria-hidden="true" />
      <Chip.Label>
        {t(`archives.decision_${decision}`, {
          defaultValue: decision.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        })}
      </Chip.Label>
    </Chip>
  );
}

export function ReviewArchive() {
  const { t } = useTranslation('broker');
  usePageTitle(t('archives.page_title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  // Deep-linkable decision filter (?decision=approved|flagged) — 'all' keeps
  // the URL clean by dropping the param entirely.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlDecision = searchParams.get('decision') as DecisionFilter | null;
  const filter: DecisionFilter =
    urlDecision && ALLOWED_DECISIONS.includes(urlDecision) ? urlDecision : 'all';
  const setFilter = useCallback(
    (next: DecisionFilter) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') {
            params.delete('decision');
          } else {
            params.set('decision', next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [items, setItems] = useState<BrokerArchive[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  // Stash the latest `t`/`toast` in refs so the fetch effect is keyed on the
  // page/filter/search params only — keeping them in the dep array re-fetches
  // on every language switch and risks a render loop with unstable toast refs.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getArchives({
        page,
        decision: filter === 'all' ? undefined : filter,
        search: search.trim() || undefined,
      });
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data as BrokerArchive[]);
        const meta = res.meta as Record<string, unknown> | undefined;
        setTotal(Number(meta?.total ?? meta?.total_items ?? res.data.length));
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('archives.load_failed'));
    } finally {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [page, filter, search]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const handleFilterChange = (key: string | number) => {
    setFilter(key as DecisionFilter);
    setPage(1);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  // In-view KPI tallies — derived from the rows the page already fetched.
  // This is an immutable record, so there is no live "queue" to count; the
  // cards summarise what the broker is currently looking at.
  const approvedInView = items.filter((i) => i.decision === 'approved').length;
  const flaggedInView = items.filter((i) => i.decision === 'flagged').length;
  const reviewersInView = new Set(items.map((i) => i.decided_by_name)).size;

  const isFiltered = filter !== 'all' || search.trim() !== '';

  const columns: Column<BrokerArchive>[] = [
    {
      key: 'sender_name',
      label: t('archives.col_sender'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.sender_name} size="sm" className="shrink-0" />
          <Link
            to={tenantPath(`/broker/archives/${item.id}`)}
            className="min-w-0 truncate text-sm font-medium text-accent hover:underline"
          >
            {item.sender_name}
          </Link>
        </div>
      ),
    },
    {
      key: 'receiver_name',
      label: t('archives.col_receiver'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.receiver_name} size="sm" className="shrink-0" />
          <span className="min-w-0 truncate text-sm font-medium text-foreground">
            {item.receiver_name}
          </span>
        </div>
      ),
    },
    {
      key: 'listing_title',
      label: t('archives.col_listing'),
      sortable: true,
      render: (item) =>
        item.listing_title ? (
          <span className="line-clamp-1 min-w-0 max-w-[200px] text-sm text-muted">
            {item.listing_title}
          </span>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'copy_reason',
      label: t('archives.col_copy_reason'),
      render: (item) => (
        <Chip size="sm" variant="tertiary" color="default">
          {t(`archives.copy_reason_${item.copy_reason}`, {
            defaultValue: item.copy_reason.replace(/_/g, ' '),
          })}
        </Chip>
      ),
    },
    {
      key: 'decision',
      label: t('archives.col_decision'),
      render: (item) => <DecisionChip decision={item.decision} />,
    },
    {
      key: 'decided_by_name',
      label: t('archives.col_decided_by'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.decided_by_name} size="sm" className="shrink-0" />
          <span className="min-w-0 truncate text-sm text-foreground">{item.decided_by_name}</span>
        </div>
      ),
    },
    {
      key: 'decided_at',
      label: t('archives.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {formatServerDate(item.decided_at)}
        </span>
      ),
    },
  ];

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_review_archive' }}
      title={t('archives.title')}
      description={t('archives.description')}
      icon={Archive}
      color="neutral"
      actions={
        <>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<RefreshCw size={16} />}
            onPress={loadItems}
            isLoading={loading && hasLoaded}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {/* KPI header — derived from the records currently in view */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('archives.stat_records')}
          value={total}
          icon={Archive}
          color="neutral"
          loading={!hasLoaded}
          description={t('archives.stat_records_hint')}
        />
        <BrokerStatCard
          label={t('archives.stat_approved')}
          value={approvedInView}
          icon={CheckCircle}
          color="success"
          loading={!hasLoaded}
          to={tenantPath('/broker/archives?decision=approved')}
          description={t('archives.stat_approved_hint')}
        />
        <BrokerStatCard
          label={t('archives.stat_flagged')}
          value={flaggedInView}
          icon={Flag}
          color="danger"
          loading={!hasLoaded}
          to={tenantPath('/broker/archives?decision=flagged')}
          description={t('archives.stat_flagged_hint')}
        />
        <BrokerStatCard
          label={t('archives.stat_reviewers')}
          value={reviewersInView}
          icon={Users}
          color="accent"
          loading={!hasLoaded}
          description={t('archives.stat_reviewers_hint')}
        />
      </div>

      {/* Toolbar — search + deep-linkable decision tabs */}
      <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <div className="flex flex-col gap-2">
          <Input
            className="w-full sm:max-w-xs"
            placeholder={t('archives.search_placeholder')}
            aria-label={t('archives.search_aria')}
            startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
            value={search}
            onValueChange={handleSearchChange}
            size="sm"
            variant="secondary"
            isClearable
            onClear={() => handleSearchChange('')}
          />
          <Tabs
            aria-label={t('archives.tabs_aria')}
            selectedKey={filter}
            onSelectionChange={handleFilterChange}
            variant="underlined"
            size="sm"
          >
            <Tab
              key="all"
              title={
                <div className="flex items-center gap-2">
                  <Inbox size={14} aria-hidden="true" />
                  <span>{t('archives.tab_all')}</span>
                </div>
              }
            />
            <Tab
              key="approved"
              title={
                <div className="flex items-center gap-2">
                  <CheckCircle size={14} aria-hidden="true" />
                  <span>{t('archives.tab_approved')}</span>
                </div>
              }
            />
            <Tab
              key="flagged"
              title={
                <div className="flex items-center gap-2">
                  <Flag size={14} aria-hidden="true" />
                  <span>{t('archives.tab_flagged')}</span>
                </div>
              }
            />
          </Tabs>
        </div>
      </div>

      {!hasLoaded ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && items.length === 0 ? (
        // Honest error state — a failed load must never masquerade as an
        // empty archive.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('archives.error_title')}
          hint={t('archives.error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={loadItems}>
              {t('archives.retry')}
            </Button>
          }
        />
      ) : (
        <DataTable
          stickyActions
          mobileCards
          columns={columns}
          data={items}
          isLoading={loading}
          searchable={false}
          onRefresh={loadItems}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          emptyContent={
            <BrokerEmptyState
              bare
              icon={isFiltered ? SearchX : Archive}
              color="neutral"
              title={isFiltered ? t('archives.empty_filtered_title') : t('archives.empty')}
              hint={isFiltered ? t('archives.empty_filtered_hint') : t('archives.empty_hint')}
            />
          }
        />
      )}
    </BrokerPageShell>
  );
}

export default ReviewArchive;
