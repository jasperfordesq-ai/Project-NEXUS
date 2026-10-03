import { getFormattingLocale } from '@/lib/helpers';
import { Button, Input, Chip, Spinner, Card, CardBody, Select, SelectItem, Avatar, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination, Drawer, DrawerContent, DrawerHeader, DrawerBody, DrawerFooter } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React, { useState, useEffect } from 'react';

import { Link, useLocation, useSearchParams } from 'react-router-dom';
import Search from 'lucide-react/icons/search';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import XCircle from 'lucide-react/icons/circle-x';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Flag from 'lucide-react/icons/flag';
import Eye from 'lucide-react/icons/eye';
import { useTranslation } from 'react-i18next';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useApi } from '@/hooks/useApi';
import { useAuth } from '@/contexts/AuthContext';
import { useTenant } from '@/contexts';
import { useToast } from '@/contexts/ToastContext';
import PageHeader from '@/admin/components/PageHeader';
import ConfirmModal from '@/admin/components/ConfirmModal';
import { adminModeration } from '@/admin/api/adminApi';
import { adminSuper } from '@/admin/api/adminApi';
import type { AdminReport, ModerationStats } from '@/admin/api/types';

export default function ReportsManagement() {
  const { t } = useTranslation('admin_moderation');
  usePageTitle(t('moderation.page_title'));
  useAdminPageMeta({
    title: t('moderation.reports_management_title'),
    description: t('moderation.reports_meta_description'),
  });

  const CONTENT_TYPES = [
    { label: t('moderation.filter_all_types'), value: '' },
    { label: t('moderation.content_type_post'), value: 'post' },
    { label: t('moderation.content_type_comment'), value: 'comment' },
    { label: t('moderation.content_type_review'), value: 'review' },
    { label: t('moderation.content_type_user'), value: 'user' },
    { label: t('moderation.content_type_listing'), value: 'listing' },
  ];

  const STATUS_FILTERS = [
    { label: t('moderation.filter_all_status'), value: '' },
    { label: t('moderation.status_pending'), value: 'pending' },
    { label: t('moderation.status_resolved'), value: 'resolved' },
    { label: t('moderation.status_dismissed'), value: 'dismissed' },
  ];

  const toast = useToast();
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const location = useLocation();
  // Keep navigation inside whichever panel we're rendered in (broker vs admin).
  const panelBase = location.pathname.includes('/broker/') ? '/broker' : '/admin';
  const userRecord = user as Record<string, unknown> | null;
  const isSuperAdmin =
    (user?.role as string) === 'super_admin' ||
    userRecord?.is_super_admin === true ||
    userRecord?.is_tenant_super_admin === true;

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  // ?status= opens the queue pre-filtered — the broker dashboard's
  // open-reports tile links to ?status=pending, the number it counts.
  const [searchParams] = useSearchParams();
  const initialStatus = ['pending', 'resolved', 'dismissed'].includes(searchParams.get('status') ?? '')
    ? (searchParams.get('status') as string)
    : '';
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [tenantFilter, setTenantFilter] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [activeType, setActiveType] = useState('');
  const [activeStatus, setActiveStatus] = useState(initialStatus);
  const [activeTenant, setActiveTenant] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [detailReport, setDetailReport] = useState<AdminReport | null>(null);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'resolve' | 'dismiss';
    report: AdminReport;
  } | null>(null);
  const [tenants, setTenants] = useState<Array<{ id: number; name: string }>>([]);

  // Load tenants list for super admin filter
  useEffect(() => {
    if (!isSuperAdmin) return;
    adminSuper.listTenants().then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setTenants(res.data.map((tenant) => ({
          id: Number(tenant.id),
          name: String(tenant.name || t('moderation.unknown_tenant')),
        })));
      }
    }).catch(() => {
      // Tenant list is optional; silently fail
    });
  }, [isSuperAdmin, t]);

  const { data: stats, execute: refetchStats } = useApi<ModerationStats>(
    '/v2/admin/reports/stats',
    { immediate: true, deps: [] }
  );

  // Build query params for the endpoint
  const buildQueryString = () => {
    const params = new URLSearchParams();
    params.append('page', page.toString());
    params.append('limit', '20');
    if (activeSearch) params.append('search', activeSearch);
    if (activeType) params.append('type', activeType);
    if (activeStatus) params.append('status', activeStatus);
    if (activeTenant && activeTenant !== 'all') params.append('tenant_id', activeTenant);
    return params.toString();
  };

  const { data, isLoading, error, execute, meta } = useApi<AdminReport[]>(
    `/v2/admin/reports?${buildQueryString()}`,
    { immediate: true, deps: [page, activeSearch, activeType, activeStatus, activeTenant] }
  );

  const handleSearch = () => {
    setActiveSearch(search);
    setActiveType(typeFilter);
    setActiveStatus(statusFilter);
    setActiveTenant(tenantFilter);
    setPage(1);
  };

  const handleClear = () => {
    setSearch('');
    setTypeFilter('');
    setStatusFilter('');
    setTenantFilter('');
    setActiveSearch('');
    setActiveType('');
    setActiveStatus('');
    setActiveTenant('');
    setPage(1);
  };

  const handleAction = async () => {
    if (!confirmAction) return;

    setActionLoading(true);
    try {
      const response = confirmAction.type === 'resolve'
        ? await adminModeration.resolveReport(confirmAction.report.id)
        : await adminModeration.dismissReport(confirmAction.report.id);

      if (response.success) {
        toast.success(
          confirmAction.type === 'resolve'
            ? t('moderation.report_resolved_successfully')
            : t('moderation.report_dismissed_successfully')
        );
        setConfirmAction(null);
        setDetailReport(null);
        execute();
        refetchStats();
      } else {
        toast.error(t('moderation.action_failed'));
      }
    } catch {
      toast.error(t('moderation.an_error_occurred'));
    } finally {
      setActionLoading(false);
    }
  };

  const reports = data || [];
  const totalPages = meta?.total_pages || 1;

  // Known content types get a translated label; unknown enum values remain
  // human-readable without leaking a backend identifier into the UI.
  const CONTENT_TYPE_LABELS: Record<string, string> = {
    post: t('moderation.content_type_post'),
    comment: t('moderation.content_type_comment'),
    review: t('moderation.content_type_review'),
    user: t('moderation.content_type_user'),
    listing: t('moderation.content_type_listing'),
    event: t('moderation.content_type_event'),
  };
  const typeLabel = (type: string) => CONTENT_TYPE_LABELS[type] ?? t('moderation.content_type_unknown');

  // Compact "Reported" cell: the member or piece of content a report targets.
  const renderTargetSummary = (report: AdminReport) => {
    if (report.target_exists === false) {
      return (
        <div className="flex flex-col">
          <span className="text-sm italic text-muted">{t('moderation.target_removed')}</span>
          <span className="text-xs text-muted">
            {typeLabel(report.content_type)} · {t('moderation.member_id', { id: report.target_id })}
          </span>
        </div>
      );
    }

    if (report.content_type === 'user') {
      return (
        <div className="flex items-center gap-3">
          <Avatar
            src={report.target_avatar || undefined}
            name={report.target_label || undefined}
            size="sm"
            className="flex-shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">
              {report.target_label || t('moderation.content_type_user')}
            </span>
            <span className="text-xs text-muted">
              {t('moderation.member_id', { id: report.target_id })}
            </span>
          </div>
        </div>
      );
    }

    const primary = report.target_preview || report.target_label;
    return (
      <div className="flex max-w-xs flex-col gap-0.5">
        {primary ? (
          <span className="text-sm text-foreground line-clamp-2">{primary}</span>
        ) : (
          <span className="text-sm text-muted">{typeLabel(report.content_type)} #{report.target_id}</span>
        )}
        {report.target_author_name && (
          <span className="text-xs text-muted">
            {t('moderation.target_by', { name: report.target_author_name })}
          </span>
        )}
      </div>
    );
  };

  // Build cell content for a report row
  const renderCells = (report: AdminReport): React.ReactElement<React.ComponentProps<typeof TableCell>>[] => {
    const cells: React.ReactElement<React.ComponentProps<typeof TableCell>>[] = [
      <TableCell key="reporter">
        <div className="flex items-center gap-3">
          <Avatar
            src={report.reporter_avatar || undefined}
            name={report.reporter_name}
            size="sm"
            className="flex-shrink-0"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{report.reporter_name}</span>
            <span className="text-xs text-muted">
              {t('moderation.member_id', { id: report.reporter_id })}
            </span>
          </div>
        </div>
      </TableCell>,
    ];

    if (isSuperAdmin) {
      cells.push(
        <TableCell key="tenant">
          <Chip size="sm" variant="soft" color="default">
            {report.tenant_name}
          </Chip>
        </TableCell>
      );
    }

    cells.push(
      <TableCell key="contentType">
        <Chip size="sm" variant="soft">
          {typeLabel(report.content_type)}
        </Chip>
      </TableCell>,
      <TableCell key="target">
        {renderTargetSummary(report)}
      </TableCell>,
      <TableCell key="reason">
        <span className="text-sm font-medium text-foreground">{report.reason}</span>
      </TableCell>,
      <TableCell key="status">
        {(report.status === 'open' || report.status === 'pending') && (
          <Chip size="sm" color="warning" variant="soft">{t('moderation.status_pending')}</Chip>
        )}
        {report.status === 'resolved' && (
          <Chip size="sm" color="success" variant="soft">{t('moderation.status_resolved')}</Chip>
        )}
        {report.status === 'dismissed' && (
          <Chip size="sm" color="default" variant="soft">{t('moderation.status_dismissed')}</Chip>
        )}
      </TableCell>,
      <TableCell key="created">
        <span className="whitespace-nowrap text-sm tabular-nums text-muted">
          {new Date(report.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      </TableCell>,
      <TableCell key="actions">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            startContent={<Eye aria-hidden="true" className="w-4 h-4" />}
            onPress={() => setDetailReport(report)}
          >
            {t('moderation.view_details')}
          </Button>
          {(report.status === 'open' || report.status === 'pending') && (
            <>
              <Button
                size="sm"
                variant="tertiary"
                color="success"
                startContent={<CheckCircle2 aria-hidden="true" className="w-4 h-4" />}
                onPress={() => setConfirmAction({ type: 'resolve', report })}
              >
                {t('moderation.resolve')}
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                color="default"
                startContent={<XCircle aria-hidden="true" className="w-4 h-4" />}
                onPress={() => setConfirmAction({ type: 'dismiss', report })}
              >
                {t('moderation.dismiss')}
              </Button>
            </>
          )}
        </div>
      </TableCell>
    );

    return cells;
  };

  // Determine columns based on super admin status
  const columns = isSuperAdmin
    ? [
      t('moderation.col_reporter'),
      t('moderation.col_tenant'),
      t('moderation.col_content_type'),
      t('moderation.col_target'),
      t('moderation.col_reason'),
      t('moderation.col_status'),
      t('moderation.col_created'),
      t('moderation.col_actions'),
    ]
    : [
      t('moderation.col_reporter'),
      t('moderation.col_content_type'),
      t('moderation.col_target'),
      t('moderation.col_reason'),
      t('moderation.col_status'),
      t('moderation.col_created'),
      t('moderation.col_actions'),
    ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('moderation.reports_management_title')}
        description={isSuperAdmin ? t('moderation.reports_desc_super') : t('moderation.reports_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw aria-hidden="true" className="w-4 h-4" />}
            onPress={() => {
              execute();
              refetchStats();
            }}
            isLoading={isLoading}
          >
            {t('moderation.refresh')}
          </Button>
        }
      />

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card  className="border border-border">
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-accent-soft dark:bg-accent-soft">
                <Flag aria-hidden="true" className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.total ?? ((stats.reports_pending ?? 0) + (stats.reports_resolved ?? 0) + (stats.reports_dismissed ?? 0))}</p>
                <p className="text-sm text-muted">{t('moderation.total_reports')}</p>
              </div>
            </CardBody>
          </Card>
          <Card  className="border border-border">
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-warning-100 dark:bg-warning-900/30">
                <AlertCircle aria-hidden="true" className="w-6 h-6 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.pending ?? stats.reports_pending ?? 0}</p>
                <p className="text-sm text-muted">{t('moderation.status_pending')}</p>
              </div>
            </CardBody>
          </Card>
          <Card  className="border border-border">
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-success-100 dark:bg-success-900/30">
                <CheckCircle2 aria-hidden="true" className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.resolved ?? stats.reports_resolved ?? 0}</p>
                <p className="text-sm text-muted">{t('moderation.status_resolved')}</p>
              </div>
            </CardBody>
          </Card>
          <Card  className="border border-border">
            <CardBody className="flex flex-row items-center gap-3 p-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-surface-secondary">
                <XCircle aria-hidden="true" className="w-6 h-6 text-muted" />
              </div>
              <div>
                <p className="text-2xl font-bold">{stats.dismissed ?? stats.reports_dismissed ?? 0}</p>
                <p className="text-sm text-muted">{t('moderation.status_dismissed')}</p>
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Filter Bar */}
      <Card  className="border border-border">
        <CardBody className="flex flex-col gap-3 p-4 lg:flex-row lg:items-end">
          <Input type="search" name="admin-search" autoComplete="off"
            placeholder={t('moderation.placeholder_search_reports')}
            aria-label={t('moderation.label_search_reports')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            startContent={<Search aria-hidden="true" className="w-4 h-4 text-muted" />}
            className="w-full lg:flex-1"
          />
          <Select
            label={t('moderation.label_content_type')}
            selectedKeys={typeFilter ? [typeFilter] : []}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="w-full lg:w-48"
          >
            {CONTENT_TYPES.map((type) => (
              <SelectItem key={type.value} id={type.value}>
                {type.label}
              </SelectItem>
            ))}
          </Select>
          <Select
            label={t('moderation.label_status')}
            selectedKeys={statusFilter ? [statusFilter] : []}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full lg:w-48"
          >
            {STATUS_FILTERS.map((status) => (
              <SelectItem key={status.value} id={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </Select>
          {isSuperAdmin && (
            <Select
              label={t('moderation.label_tenant')}
              selectedKeys={tenantFilter ? [tenantFilter] : []}
              onChange={(e) => setTenantFilter(e.target.value)}
              className="w-full lg:w-56"
            >
              {[
                <SelectItem key="all" id="all">{t('moderation.filter_all_tenants')}</SelectItem>,
                ...tenants.map((tenant) => (
                  <SelectItem key={tenant.id.toString()} id={tenant.id.toString()}>
                    {tenant.name}
                  </SelectItem>
                )),
              ]}
            </Select>
          )}
          <div className="flex gap-2 lg:pb-0.5">
            <Button onPress={handleSearch}>
              {t('moderation.apply')}
            </Button>
            <Button variant="tertiary" onPress={handleClear}>
              {t('moderation.clear')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Results Count */}
      {meta && (
        <div className="text-sm text-muted">
          {t('moderation.showing_count', { shown: data?.length ?? 0, total: meta.total ?? meta.total_items ?? data?.length ?? 0 })}
          {isSuperAdmin && !activeTenant && ` (${t('moderation.all_tenants')})`}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div role="alert" className="bg-danger-50 dark:bg-danger-950 text-danger border border-danger rounded-lg p-4">
          {t('moderation.failed_to_load_reports')}
        </div>
      )}

      {/* Table */}
      <Table aria-label={t('moderation.label_reports_table')}  isStriped>
        <TableHeader>
          {columns.map((col) => (
            <TableColumn key={col}>{col}</TableColumn>
          ))}
        </TableHeader>
        <TableBody
          items={reports}
          isLoading={isLoading}
          loadingContent={<Spinner />}
          emptyContent={
            <div className="text-center py-8 text-muted">
              {activeSearch || activeType || activeStatus
                ? t('moderation.no_reports_match_filters')
                : t('moderation.no_reports_to_review')}
            </div>
          }
        >
          {(report) => (
            <TableRow key={report.id}>
              {renderCells(report)}
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center">
          <Pagination
            total={totalPages}
            page={page}
            onChange={setPage}
            showControls
            color="accent"
          />
        </div>
      )}

      {/* Confirm Modal */}
      <ConfirmModal
        isOpen={!!confirmAction}
        onClose={() => setConfirmAction(null)}
        onConfirm={handleAction}
        title={confirmAction?.type === 'resolve' ? t('moderation.resolve_report') : t('moderation.dismiss_report')}
        message={
          confirmAction?.type === 'resolve'
            ? t('moderation.confirm_resolve_report')
            : t('moderation.confirm_dismiss_report')
        }
        confirmLabel={confirmAction?.type === 'resolve' ? t('moderation.resolve_report') : t('moderation.dismiss_report')}
        confirmColor={confirmAction?.type === 'resolve' ? 'primary' : 'warning'}
        isLoading={actionLoading}
      />

      {/* Report detail drawer */}
      <Drawer
        isOpen={!!detailReport}
        onOpenChange={(open) => { if (!open) setDetailReport(null); }}
        size="md"
      >
        <DrawerContent aria-label={t('moderation.report_details')}>
          {detailReport && (
            <>
              <DrawerHeader className="flex items-center gap-3">
                <span>{t('moderation.report_details')}</span>
                {(detailReport.status === 'open' || detailReport.status === 'pending') && (
                  <Chip size="sm" color="warning" variant="soft">{t('moderation.status_pending')}</Chip>
                )}
                {detailReport.status === 'resolved' && (
                  <Chip size="sm" color="success" variant="soft">{t('moderation.status_resolved')}</Chip>
                )}
                {detailReport.status === 'dismissed' && (
                  <Chip size="sm" color="default" variant="soft">{t('moderation.status_dismissed')}</Chip>
                )}
              </DrawerHeader>

              <DrawerBody className="space-y-6">
                {/* Reported by */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('moderation.drawer_reported_by')}
                  </h3>
                  <div className="flex items-center gap-3">
                    <Avatar
                      src={detailReport.reporter_avatar || undefined}
                      name={detailReport.reporter_name}
                      size="sm"
                      className="flex-shrink-0"
                    />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{detailReport.reporter_name}</span>
                      <span className="text-xs text-muted">
                        {t('moderation.member_id', { id: detailReport.reporter_id })}
                      </span>
                    </div>
                  </div>
                </section>

                {/* Reported item / member */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('moderation.drawer_reported_item')}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Chip size="sm" variant="soft">{typeLabel(detailReport.content_type)}</Chip>
                    <span className="text-xs text-muted">
                      {t('moderation.member_id', { id: detailReport.target_id })}
                    </span>
                  </div>

                  {detailReport.target_exists === false ? (
                    <p className="text-sm italic text-muted">{t('moderation.target_removed')}</p>
                  ) : detailReport.content_type === 'user' ? (
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={detailReport.target_avatar || undefined}
                        name={detailReport.target_label || undefined}
                        size="sm"
                        className="flex-shrink-0"
                      />
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">
                          {detailReport.target_label || t('moderation.content_type_user')}
                        </span>
                        <Link
                          to={tenantPath(`${panelBase}/members?search=${encodeURIComponent(detailReport.target_label || '')}`)}
                          className="text-xs text-accent hover:underline"
                        >
                          {t('moderation.view_member')}
                        </Link>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(detailReport.target_preview || detailReport.target_label) && (
                        <p className="whitespace-pre-line rounded-lg bg-surface-secondary p-3 text-sm text-foreground">
                          {detailReport.target_preview || detailReport.target_label}
                        </p>
                      )}
                      {detailReport.target_author_name && (
                        <div className="flex items-center gap-3">
                          <Avatar
                            src={detailReport.target_avatar || undefined}
                            name={detailReport.target_author_name}
                            size="sm"
                            className="flex-shrink-0"
                          />
                          <div className="flex flex-col">
                            <span className="text-xs text-muted">{t('moderation.drawer_author')}</span>
                            <span className="text-sm font-medium">{detailReport.target_author_name}</span>
                          </div>
                          {detailReport.target_author_id && (
                            <Link
                              to={tenantPath(`${panelBase}/members?search=${encodeURIComponent(detailReport.target_author_name)}`)}
                              className="ml-auto text-xs text-accent hover:underline"
                            >
                              {t('moderation.view_member')}
                            </Link>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* Reason */}
                <section className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {t('moderation.drawer_reason')}
                  </h3>
                  <p className="whitespace-pre-line text-sm text-foreground">{detailReport.reason}</p>
                </section>

                {/* Meta */}
                <section className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted">{t('moderation.col_created')}</span>
                    <span>{new Date(detailReport.created_at).toLocaleString(getFormattingLocale())}</span>
                  </div>
                  {detailReport.updated_at && (
                    <div className="flex flex-col">
                      <span className="text-xs text-muted">{t('moderation.label_updated')}</span>
                      <span>{new Date(detailReport.updated_at).toLocaleString(getFormattingLocale())}</span>
                    </div>
                  )}
                </section>
              </DrawerBody>

              {(detailReport.status === 'open' || detailReport.status === 'pending') && (
                <DrawerFooter className="flex items-center gap-2">
                  <Button
                    color="success"
                    startContent={<CheckCircle2 aria-hidden="true" className="w-4 h-4" />}
                    onPress={() => setConfirmAction({ type: 'resolve', report: detailReport })}
                  >
                    {t('moderation.resolve')}
                  </Button>
                  <Button
                    variant="tertiary"
                    startContent={<XCircle aria-hidden="true" className="w-4 h-4" />}
                    onPress={() => setConfirmAction({ type: 'dismiss', report: detailReport })}
                  >
                    {t('moderation.dismiss')}
                  </Button>
                </DrawerFooter>
              )}
            </>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
