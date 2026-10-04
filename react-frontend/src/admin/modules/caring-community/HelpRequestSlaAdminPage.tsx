import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Spinner, Tab, Tabs, Tooltip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { Separator } from '@/components/ui';
import AlarmClock from 'lucide-react/icons/alarm-clock';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Settings from 'lucide-react/icons/settings';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { Abbr } from '../../components/Abbr';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type Bucket = 'breached' | 'at_risk' | 'on_track';
type SlaDimension = 'first_response' | 'resolution';

interface OpenRequest {
  id: number;
  user_id: number;
  what: string;
  when_needed: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  age_hours: number;
  sla_dimension: SlaDimension;
  sla_target_hours: number;
  sla_remaining_hours: number;
  sla_overage_hours: number;
  bucket: Bucket;
}

interface ResolvedRequest {
  id: number;
  user_id: number;
  what: string;
  status: string;
  created_at: string;
  updated_at: string | null;
  age_hours: number;
  turnaround_hours?: number;
  within_resolution_sla?: boolean;
}

interface SlaDashboard {
  policy: {
    first_response_hours: number;
    resolution_hours: number;
    source: 'platform_defaults' | 'tenant_policy';
  };
  summary: {
    pending: number;
    in_progress: number;
    first_response_breached: number;
    first_response_at_risk: number;
    resolution_breached: number;
    resolution_at_risk: number;
    resolved_within_window_24h: number;
  };
  open_requests: OpenRequest[];
  recently_resolved: ResolvedRequest[];
  generated_at: string;
}

const BUCKET_COLORS: Record<Bucket, 'danger' | 'warning' | 'success'> = {
  breached: 'danger',
  at_risk: 'warning',
  on_track: 'success',
};

function fmtHours(h: number): string {
  if (h < 1) {
    return new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'minute', unitDisplay: 'short' }).format(Math.round(h * 60));
  }
  if (h < 24) {
    return new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'hour', unitDisplay: 'short', maximumFractionDigits: 1 }).format(h);
  }
  const days = Math.floor(h / 24);
  const remHours = Math.round(h - days * 24);
  const dayLabel = new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'day', unitDisplay: 'short' }).format(days);
  return remHours === 0
    ? dayLabel
    : `${dayLabel} ${new Intl.NumberFormat(getFormattingLocale(), { style: 'unit', unit: 'hour', unitDisplay: 'short' }).format(remHours)}`;
}

export default function HelpRequestSlaAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('help_request_sla.meta.page_title'));
  const { showToast } = useToast();
  const { tenantPath } = useTenant();

  const [data, setData] = useState<SlaDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [bucketFilter, setBucketFilter] = useState<'all' | Bucket>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<SlaDashboard>('/v2/admin/caring-community/sla-dashboard');
      setData(res.data ?? null);
    } catch {
      showToast(t('help_request_sla.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const bucketLabel = useCallback((bucket: Bucket) => t(`help_request_sla.buckets.${bucket}`), [t]);
  const dimensionLabel = useCallback((dimension: SlaDimension) => t(`help_request_sla.dimensions.${dimension}`), [t]);
  const emptyValue = t('help_request_sla.empty.value');

  useEffect(() => {
    load();
  }, [load]);

  const filteredOpen = useMemo(() => {
    if (!data) return [];
    if (bucketFilter === 'all') return data.open_requests;
    return data.open_requests.filter((r) => r.bucket === bucketFilter);
  }, [data, bucketFilter]);

  const summary = data?.summary;
  const policy = data?.policy;

  const bucketCounts = useMemo(() => {
    if (!data) return { breached: 0, at_risk: 0, on_track: 0 };
    return data.open_requests.reduce<Record<Bucket, number>>(
      (acc, r) => {
        acc[r.bucket] = (acc[r.bucket] ?? 0) + 1;
        return acc;
      },
      { breached: 0, at_risk: 0, on_track: 0 },
    );
  }, [data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('help_request_sla.meta.title')}
        subtitle={<>{t('help_request_sla.meta.subtitle_prefix')} <Abbr term="SLA" /> {t('help_request_sla.meta.subtitle_suffix')}</>}
        icon={<AlarmClock size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              as={Link}
              to={tenantPath('/caring/operating-policy')}
              size="sm"
              variant="secondary"
              startContent={<Settings size={14} />}
            >
              {t('help_request_sla.actions.edit_policy')}
            </Button>
            <Tooltip content={t('help_request_sla.actions.refresh')}>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={load}
                isLoading={loading}
                aria-label={t('help_request_sla.actions.refresh_aria')}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
          </div>
        }
      />

      {/* About card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('help_request_sla.about.title')}</p>
              <p className="text-foreground">
                {t('help_request_sla.about.body')}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2 text-foreground">
                <p>
                  <span className="font-medium">{t('help_request_sla.about.first_response_label')}:</span>{' '}
                  {t('help_request_sla.about.first_response_prefix')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Workflow state identifier must remain verbatim. */}
                  <code className="text-xs bg-surface-secondary px-1 rounded">pending</code>
                  {t('help_request_sla.about.first_response_suffix')}
                </p>
                <p>
                  <span className="font-medium">{t('help_request_sla.about.resolution_label')}:</span>{' '}
                  {t('help_request_sla.about.resolution_prefix')}{' '}
                  {/* eslint-disable-next-line i18next/no-literal-string -- Workflow state identifier must remain verbatim. */}
                  <code className="text-xs bg-surface-secondary px-1 rounded">closed</code>
                  {t('help_request_sla.about.resolution_suffix')}
                </p>
              </div>
              <p className="text-muted text-xs mt-1">
                {t('help_request_sla.about.note')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading && (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      )}

      {!loading && data && summary && policy && (
        <>
          <Card className="border border-[var(--color-border)]">
            <CardBody className="py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-1 text-sm">
                  <div>
                    <span className="font-semibold">{t('help_request_sla.about.first_response_label')}:</span>{' '}
                    <Chip size="sm" variant="soft" color="accent">
                      {formatNumber(policy.first_response_hours, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}
                    </Chip>{' '}
                    <span className="text-muted">{t('help_request_sla.policy.first_response_description')}</span>
                  </div>
                  <div>
                    <span className="font-semibold">{t('help_request_sla.about.resolution_label')}:</span>{' '}
                    <Chip size="sm" variant="soft" color="accent">
                      {formatNumber(policy.resolution_hours, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}
                    </Chip>{' '}
                    <span className="text-muted">{t('help_request_sla.policy.resolution_description')}</span>
                  </div>
                </div>
                <div>
                  {policy.source === 'platform_defaults' ? (
                    <Chip size="sm" variant="dot" color="warning">
                      {t('help_request_sla.policy.platform_defaults')}
                    </Chip>
                  ) : (
                    <Chip size="sm" variant="dot" color="success">
                      {t('help_request_sla.policy.tenant_policy')}
                    </Chip>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card className="border border-danger/30 bg-danger/10">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.first_response_breached')}</p>
                <p className="text-2xl font-bold text-danger">{summary.first_response_breached}</p>
              </CardBody>
            </Card>
            <Card className="border border-warning/30 bg-warning/10">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.first_response_at_risk')}</p>
                <p className="text-2xl font-bold text-warning">{summary.first_response_at_risk}</p>
              </CardBody>
            </Card>
            <Card className="border border-danger/30 bg-danger/10">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.resolution_breached')}</p>
                <p className="text-2xl font-bold text-danger">{summary.resolution_breached}</p>
              </CardBody>
            </Card>
            <Card className="border border-warning/30 bg-warning/10">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.resolution_at_risk')}</p>
                <p className="text-2xl font-bold text-warning">{summary.resolution_at_risk}</p>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Card className="border border-[var(--color-border)]">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.pending')}</p>
                <p className="text-xl font-semibold">{summary.pending}</p>
              </CardBody>
            </Card>
            <Card className="border border-[var(--color-border)]">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.in_progress')}</p>
                <p className="text-xl font-semibold">{summary.in_progress}</p>
              </CardBody>
            </Card>
            <Card className="border border-success/30 bg-success/10">
              <CardBody className="py-3 text-center">
                <p className="text-xs text-muted">{t('help_request_sla.metrics.resolved_24h')}</p>
                <p className="text-xl font-semibold text-success">
                  {summary.resolved_within_window_24h}
                </p>
              </CardBody>
            </Card>
          </div>

          <Card className="border border-[var(--color-border)]">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2 pb-2">
              <div>
                <p className="text-sm font-semibold">{t('help_request_sla.open.title')}</p>
                <p className="text-xs text-muted">
                  {t('help_request_sla.open.subtitle', { count: data.open_requests.length })}
                </p>
              </div>
              <Tabs
                size="sm"
                aria-label={t('help_request_sla.open.bucket_filter_aria')}
                selectedKey={bucketFilter}
                onSelectionChange={(key) => setBucketFilter(key as 'all' | Bucket)}
              >
                <Tab key="all" title={t('help_request_sla.open.all_count', { count: data.open_requests.length })} />
                <Tab key="breached" title={t('help_request_sla.open.breached_count', { count: bucketCounts.breached })} />
                <Tab key="at_risk" title={t('help_request_sla.open.at_risk_count', { count: bucketCounts.at_risk })} />
                <Tab key="on_track" title={t('help_request_sla.open.on_track_count', { count: bucketCounts.on_track })} />
              </Tabs>
            </CardHeader>
            <CardBody className="pt-0">
              {filteredOpen.length === 0 ? (
                <div className="flex items-center gap-2 py-6 text-muted text-sm">
                  <CheckCircle2 size={16} className="text-success" />
                  {t('help_request_sla.open.empty_bucket')}
                </div>
              ) : (
                <Table aria-label={t('help_request_sla.open.table_aria')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('help_request_sla.table.request')}</TableColumn>
                    <TableColumn><Abbr term="SLA" /></TableColumn>
                    <TableColumn>{t('help_request_sla.table.bucket')}</TableColumn>
                    <TableColumn>{t('help_request_sla.table.status')}</TableColumn>
                    <TableColumn>{t('help_request_sla.table.created')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {filteredOpen.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell>
                          <div className="max-w-md">
                            <p className="text-sm line-clamp-2">{req.what}</p>
                            <p className="text-xs text-muted mt-0.5">
                              {t('help_request_sla.open.request_meta', {
                                when: req.when_needed,
                                userId: req.user_id,
                                age: fmtHours(req.age_hours),
                              })}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs space-y-0.5">
                            <div className="font-medium">{dimensionLabel(req.sla_dimension)}</div>
                            <div className="text-muted">
                              {t('help_request_sla.open.target_hours', { hours: req.sla_target_hours })}
                            </div>
                            {req.bucket === 'breached' ? (
                              <div className="text-danger font-medium">
                                {t('help_request_sla.open.over_by', { duration: fmtHours(req.sla_overage_hours) })}
                              </div>
                            ) : (
                              <div className="text-muted">
                                {t('help_request_sla.open.left', { duration: fmtHours(req.sla_remaining_hours) })}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Chip size="sm" variant="soft" color={BUCKET_COLORS[req.bucket]}>
                            {bucketLabel(req.bucket)}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          <Chip size="sm" variant="dot">
                            {t(`help_request_sla.status.${req.status}`, { defaultValue: t('help_request_sla.status.unknown') })}
                          </Chip>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted">
                            {new Date(req.created_at).toLocaleDateString(getFormattingLocale())}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardBody>
          </Card>

          {data.recently_resolved.length > 0 && (
            <Card className="border border-[var(--color-border)]">
              <CardHeader className="pb-2">
                <p className="text-sm font-semibold">{t('help_request_sla.resolved.title')}</p>
              </CardHeader>
              <CardBody className="pt-0">
                <Table aria-label={t('help_request_sla.resolved.table_aria')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('help_request_sla.table.request')}</TableColumn>
                    <TableColumn>{t('help_request_sla.table.turnaround')}</TableColumn>
                    <TableColumn>{t('help_request_sla.table.within')} <Abbr term="SLA" /></TableColumn>
                    <TableColumn>{t('help_request_sla.table.resolved')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {data.recently_resolved.map((req) => (
                      <TableRow key={req.id}>
                        <TableCell>
                          <p className="text-sm line-clamp-1 max-w-md">{req.what}</p>
                          <p className="text-xs text-muted mt-0.5">{t('help_request_sla.resolved.user_id', { userId: req.user_id })}</p>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">
                            {req.turnaround_hours !== undefined
                              ? fmtHours(req.turnaround_hours)
                              : emptyValue}
                          </span>
                        </TableCell>
                        <TableCell>
                          {req.within_resolution_sla === undefined ? (
                            <span className="text-muted">{emptyValue}</span>
                          ) : req.within_resolution_sla ? (
                            <Chip size="sm" variant="soft" color="success">
                              {t('help_request_sla.answers.yes')}
                            </Chip>
                          ) : (
                            <Chip size="sm" variant="soft" color="danger">
                              {t('help_request_sla.answers.no')}
                            </Chip>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted">
                            {req.updated_at ? new Date(req.updated_at).toLocaleString(getFormattingLocale()) : emptyValue}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          )}

          <Separator />
          <p className="text-xs text-muted">
            {t('help_request_sla.footer.generated', { date: new Date(data.generated_at).toLocaleString(getFormattingLocale()) })}{' '}
            <Abbr term="SLA" /> {t('help_request_sla.footer.proxy_prefix')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string -- Workflow state identifier must remain verbatim. */}
            <code>pending</code>; {t('help_request_sla.footer.proxy_middle')}{' '}
            {/* eslint-disable-next-line i18next/no-literal-string -- Workflow state identifier must remain verbatim. */}
            <code>closed</code>. {t('help_request_sla.footer.proxy_suffix')} <Abbr term="SLA" />{' '}
            {t('help_request_sla.footer.proxy_end')}
          </p>
        </>
      )}
    </div>
  );
}
