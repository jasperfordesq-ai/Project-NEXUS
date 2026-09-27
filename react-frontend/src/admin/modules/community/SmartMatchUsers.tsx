// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Smart Match Users
 * View user matching results from the smart matching engine.
 * Wired to adminMatching.getApprovals() API (existing module).
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useRef, useState } from 'react';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Users from 'lucide-react/icons/users';
import { usePageTitle } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { logError } from '@/lib/logger';
import { adminMatching } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import type { MatchApproval } from '../../api/types';
import { Button, Chip, Spinner } from '@/components/ui';

interface ParsedMatchResults {
  items: MatchApproval[];
  total: number;
}

// The shared api client unwraps the `{ data, meta }` envelope: `res.data` is the
// bare row array and the true total arrives on the sibling `res.meta`. Counting
// only this page's rows (as this did) reported one page and hid every match past
// the first 20.
function parseMatchResults(res: { data?: unknown; meta?: unknown }): ParsedMatchResults | null {
  const value = res.data;
  if (Array.isArray(value)) {
    const metaTotal = (res.meta as { total?: unknown } | undefined)?.total;
    return { items: value as MatchApproval[], total: typeof metaTotal === 'number' ? metaTotal : value.length };
  }

  if (typeof value !== 'object' || value === null) return null;

  const page = value as { data?: unknown; meta?: { total?: unknown } };
  if (!Array.isArray(page.data)) return null;

  return {
    items: page.data as MatchApproval[],
    total: typeof page.meta?.total === 'number' ? page.meta.total : page.data.length,
  };
}

export function SmartMatchUsers() {
  const { t } = useTranslation('admin_community');
  usePageTitle(t('community.page_title'));

  const [data, setData] = useState<MatchApproval[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [displayedPage, setDisplayedPage] = useState(1);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const requestedPage = page;
    setLoading(true);

    try {
      const res = await adminMatching.getApprovals({ status: 'all', page: requestedPage });
      if (requestId !== requestIdRef.current) return;

      const parsed = res.success ? parseMatchResults(res) : null;
      if (parsed) {
        setData(parsed.items);
        setTotal(parsed.total);
        setDisplayedPage(requestedPage);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      logError('Failed to load match results', err);
      setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [page]);


  useEffect(() => {
    void fetchData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchData]);

  const columns: Column<MatchApproval>[] = [
    {
      key: 'user_1_name',
      label: t('community.col_user_1'),
      sortable: true,
      render: (item) => (
        <div>
          <p className="font-medium text-sm">{item.user_1_name}</p>
          {item.user_1_email && <p className="text-xs text-muted">{item.user_1_email}</p>}
        </div>
      ),
    },
    {
      key: 'user_2_name',
      label: t('community.col_user_2'),
      sortable: true,
      render: (item) => (
        <div>
          <p className="font-medium text-sm">{item.user_2_name}</p>
          {item.user_2_email && <p className="text-xs text-muted">{item.user_2_email}</p>}
        </div>
      ),
    },
    {
      key: 'listing_title',
      label: t('community.col_listing'),
      render: (item) => (
        <span className="text-sm text-muted">{item.listing_title || '--'}</span>
      ),
    },
    {
      key: 'match_score',
      label: t('community.col_score'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          variant="soft"
          color={item.match_score >= 80 ? 'success' : item.match_score >= 50 ? 'warning' : 'default'}
        >
          {Number(item.match_score).toFixed(0)}%
        </Chip>
      ),
    },
    {
      key: 'status',
      label: t('community.col_status'),
      sortable: true,
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'created_at',
      label: t('community.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {new Date(item.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
  ];

  const refreshAction = (
    <Button variant="secondary" onPress={fetchData} isLoading={loading} startContent={<RefreshCw size={16} aria-hidden="true" />}>
      {t('common.refresh')}
    </Button>
  );

  const staleDataWarning = loadFailed && data !== null ? (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4 text-danger sm:flex-row sm:items-center sm:justify-between" role="alert">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="shrink-0" aria-hidden="true" />
        <p className="text-sm">{t('community.failed_to_load_match_results')}</p>
      </div>
      <Button variant="outline" onPress={fetchData} isLoading={loading}>{t('common.retry')}</Button>
    </div>
  ) : null;

  return (
    <div>
      <PageHeader title={t('community.smart_match_users_title')} description={t('community.smart_match_users_desc')} actions={refreshAction} />

      {loading && data === null ? (
        <div className="flex justify-center py-12" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner size="lg" /></div>
      ) : loadFailed && data === null ? (
        <div role="alert">
          <EmptyState icon={AlertTriangle} title={t('community.failed_to_load_match_results')} actionLabel={t('common.retry')} onAction={fetchData} />
        </div>
      ) : (
        <>
          {staleDataWarning}
          {(data ?? []).length === 0 ? (
            <EmptyState
              icon={Users}
              title={t('community.no_match_results')}
              description={t('community.desc_run_the_smart_matching_engine_to_generat')}
              actionLabel={t('common.refresh')}
              onAction={fetchData}
            />
          ) : (
            <DataTable
              columns={columns}
              data={data ?? []}
              searchPlaceholder={t('community.search_matches_placeholder')}
              onRefresh={fetchData}
              totalItems={total}
              page={displayedPage}
              pageSize={20}
              onPageChange={setPage}
            />
          )}
        </>
      )}
    </div>
  );
}

export default SmartMatchUsers;
