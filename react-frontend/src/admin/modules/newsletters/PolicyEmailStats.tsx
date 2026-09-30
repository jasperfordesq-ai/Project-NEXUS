// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
import { PageHeader } from '../../components/PageHeader';
import { adminLegalDocs } from '../../api/adminApi';

type Stats = NonNullable<Awaited<ReturnType<typeof adminLegalDocs.emailStats>>['data']>;
type Filter = 'all' | 'opened' | 'clicked' | 'not_opened';

export function PolicyEmailStats() {
  const { versionId } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.policy_email_stats_title'));
  const [data, setData] = useState<Stats | null>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<Filter>('all');
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    adminLegalDocs.emailStats(Number(versionId), page, filter).then((response) => {
      if (!active) return;
      if (response.success && response.data) {
        setData(response.data);
        setError(false);
      } else setError(true);
    }).catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [versionId, page, filter]);

  const filters: Filter[] = ['all', 'opened', 'clicked', 'not_opened'];
  const date = (value: string | null) => value
    ? new Date(value).toLocaleString(getFormattingLocale()) : '—';

  return (
    <div>
      <PageHeader
        title={t('newsletters.policy_email_stats_title')}
        description={data ? t('newsletters.policy_email_version', { title: data.version.title, version: data.version.version_number }) : undefined}
        actions={<Button variant="tertiary" onPress={() => navigate(tenantPath('/admin/newsletters'))}>{t('common.back')}</Button>}
      />
      <p className="mb-4 text-sm text-muted">{t('newsletters.policy_email_stats_note')}</p>
      {error && <p role="alert" className="text-danger">{t('newsletters.policy_email_error')}</p>}
      {data && <>
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Card><CardBody><p className="text-sm text-muted">{t('newsletters.policy_email_recipients', { count: Number(data.totals.recipients) })}</p><p className="text-2xl font-semibold">{Number(data.totals.submitted)}</p><p className="text-xs text-muted">{t('newsletters.policy_email_submitted')}</p></CardBody></Card>
          <Card><CardBody><p className="text-sm text-muted">{t('newsletters.policy_email_unique_opens')}</p><p className="text-2xl font-semibold">{Number(data.totals.unique_opens)}</p><p className="text-sm">{t('newsletters.policy_email_total_opens', { count: Number(data.totals.total_opens) })}</p></CardBody></Card>
          <Card><CardBody><p className="text-sm text-muted">{t('newsletters.policy_email_unique_clicks')}</p><p className="text-2xl font-semibold">{Number(data.totals.unique_clicks)}</p><p className="text-sm">{t('newsletters.policy_email_total_clicks', { count: Number(data.totals.total_clicks) })}</p></CardBody></Card>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">
          {filters.map((option) => <Button key={option} size="sm" variant={filter === option ? 'primary' : 'tertiary'} onPress={() => { setFilter(option); setPage(1); }}>
            {t(`newsletters.policy_email_filter_${option}`)}
          </Button>)}
        </div>
        <Table aria-label={t('newsletters.policy_email_stats_title')}>
          <TableHeader>
            <TableColumn>{t('newsletters.policy_email_col_recipient')}</TableColumn>
            <TableColumn>{t('newsletters.policy_email_col_status')}</TableColumn>
            <TableColumn>{t('newsletters.policy_email_col_opens')}</TableColumn>
            <TableColumn>{t('newsletters.policy_email_col_clicks')}</TableColumn>
            <TableColumn>{t('newsletters.policy_email_col_first_open')}</TableColumn>
            <TableColumn>{t('newsletters.policy_email_col_first_click')}</TableColumn>
          </TableHeader>
          <TableBody items={data.recipients} isLoading={loading} emptyContent={t('newsletters.policy_email_empty')}>
            {(row) => <TableRow key={row.id}>
              <TableCell>{row.email ?? row.first_name ?? '—'}</TableCell>
              <TableCell>{row.status}</TableCell>
              <TableCell>{Number(row.opens ?? 0)}</TableCell>
              <TableCell>{Number(row.clicks ?? 0)}</TableCell>
              <TableCell>{date(row.first_opened)}</TableCell>
              <TableCell>{date(row.first_clicked)}</TableCell>
            </TableRow>}
          </TableBody>
        </Table>
        {data.meta.total_pages > 1 && <div className="mt-4 flex justify-center"><Pagination page={page} total={data.meta.total_pages} onChange={setPage} /></div>}
      </>}
    </div>
  );
}

export default PolicyEmailStats;
