import { formatPercentValue, getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Select, SelectItem, Tooltip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import React, { useCallback, useEffect, useMemo, useState } from 'react';

import { Separator } from '@/components/ui';
import Building2 from 'lucide-react/icons/building-2';
import Clock from 'lucide-react/icons/clock';
import Download from 'lucide-react/icons/download';
import Heart from 'lucide-react/icons/heart';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TrendingDown from 'lucide-react/icons/trending-down';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { Abbr } from '../../components/Abbr';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MunicipalRoiBreakdownRow {
  sub_region_id: number;
  sub_region_name: string;
  hours: number;
  weighted_hours: number;
  formal_care_offset_chf: number;
}

interface MunicipalRoiMethodology {
  hourly_rate_chf: number;
  hourly_rate_source: 'tenant_setting' | 'default' | string;
  prevention_multiplier: number;
  substitution_applied: boolean;
}

interface MunicipalRoi {
  total_hours: number;
  active_members: number;
  active_relationships: number;
  recipient_count: number;
  total_exchanges: number;
  roi: {
    hourly_rate_chf: number;
    formal_care_offset_chf: number;
    prevention_value_chf: number;
    social_isolation_prevented: number;
  };
  trend: {
    hours_yoy_pct: number | null;
  };
  // NEW (optional — backend may or may not have shipped yet)
  period?: { from: string; to: string };
  weighted_hours?: number;
  methodology?: MunicipalRoiMethodology;
  breakdown_by_sub_region?: MunicipalRoiBreakdownRow[];
}

interface SubRegionLite {
  id: number;
  name: string;
}

interface SubRegionListResponse {
  data?: SubRegionLite[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CHF = new Intl.NumberFormat(getFormattingLocale(), {
  style: 'currency',
  currency: 'CHF',
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat(getFormattingLocale(), { maximumFractionDigits: 0 });

function startOfYearISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function todayISO(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MunicipalRoiAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('municipal_roi_page.meta.page_title'));
  const { showToast } = useToast();

  const [data, setData] = useState<MunicipalRoi | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [from, setFrom] = useState<string>(() => startOfYearISO());
  const [to, setTo] = useState<string>(() => todayISO());
  const [subRegionId, setSubRegionId] = useState<string>('');

  // Sub-regions
  const [subRegions, setSubRegions] = useState<SubRegionLite[]>([]);
  const [exporting, setExporting] = useState(false);

  // Build query string for filters
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (from) params.append('from', from);
    if (to) params.append('to', to);
    if (subRegionId) params.append('sub_region_id', subRegionId);
    return params.toString();
  }, [from, to, subRegionId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url =
        '/v2/admin/caring-community/municipal-roi' + (queryParams ? `?${queryParams}` : '');
      const res = await api.get<MunicipalRoi>(url);
      setData(res.data ?? null);
    } catch {
      showToast(t('municipal_roi_page.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [queryParams, showToast, t]);

  // Fetch sub-regions once on mount; silently hide on failure / empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<SubRegionListResponse | SubRegionLite[]>(
          '/v2/admin/caring-community/sub-regions?status=active&per_page=200',
        );
        const payload = res.data;
        const list: SubRegionLite[] = Array.isArray(payload)
          ? payload
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
        if (!cancelled) {
          setSubRegions(list.map((r) => ({ id: r.id, name: r.name })));
        }
      } catch {
        if (!cancelled) setSubRegions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const yoyPct = data?.trend.hours_yoy_pct ?? null;

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      // api.download renews an expired sign-in and retries; a hand-rolled
      // fetch failed once the short-lived access token expired.
      await api.download(
        '/v2/admin/caring-community/municipal-roi/export' + (queryParams ? `?${queryParams}` : ''),
        { filename: `municipal-impact-${from}_to_${to}.csv` },
      );
    } catch {
      showToast(t('municipal_roi_page.toasts.export_failed'), 'error');
    } finally {
      setExporting(false);
    }
  }, [queryParams, from, to, showToast, t]);

  // Sorted breakdown rows (by formal_care_offset_chf desc)
  const sortedBreakdown = useMemo(() => {
    if (!data?.breakdown_by_sub_region?.length) return [];
    return [...data.breakdown_by_sub_region].sort(
      (a, b) => b.formal_care_offset_chf - a.formal_care_offset_chf,
    );
  }, [data?.breakdown_by_sub_region]);

  // Whether weighted hours differ enough from total hours to show annotation
  const showWeightedAnnotation =
    !!data &&
    typeof data.weighted_hours === 'number' &&
    Math.abs(data.weighted_hours - data.total_hours) > 0.5;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('municipal_roi_page.meta.title')}
        subtitle={t('municipal_roi_page.meta.subtitle')}
        icon={<TrendingUp size={20} />}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              startContent={<Download size={15} />}
              onPress={handleExport}
              isLoading={exporting}
            >
              {t('municipal_roi_page.actions.export_csv')}
            </Button>
            <Tooltip content={t('municipal_roi_page.actions.refresh_data')}>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={load}
                isLoading={loading}
                aria-label={t('municipal_roi_page.actions.refresh_aria')}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
          </div>
        }
      />

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('municipal_roi_page.about.title')}</p>
              <p className="text-muted">
                {t('municipal_roi_page.about.body_prefix')} <Abbr term="ROI" /> {t('municipal_roi_page.about.body_middle')}{' '}
                {t('common:nav.caring_community')} {t('municipal_roi_page.about.body_suffix')}
              </p>
              <p className="text-muted">
                {t('municipal_roi_page.about.formula_prefix')} <Abbr term="CHF" /> {t('municipal_roi_page.about.formula_suffix')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Filters */}
      <Card className="border border-[var(--color-border)]">
        <CardBody className="flex flex-row flex-wrap items-end gap-3 py-3">
          <Input
            type="date"
            size="sm"
            label={t('municipal_roi_page.filters.from')}
            labelPlacement="outside"
            value={from}
            onValueChange={setFrom}
            className="w-44"
            variant="secondary"
          />
          <Input
            type="date"
            size="sm"
            label={t('municipal_roi_page.filters.to')}
            labelPlacement="outside"
            value={to}
            onValueChange={setTo}
            className="w-44"
            variant="secondary"
          />
          {subRegions.length > 0 && (
            <Select
              size="sm"
              label={t('municipal_roi_page.filters.sub_region')}
              labelPlacement="outside"
              placeholder={t('municipal_roi_page.filters.all_sub_regions')}
              selectedKeys={subRegionId ? [subRegionId] : []}
              onSelectionChange={(keys) => {
                const arr = Array.from(keys as Set<string | number>);
                setSubRegionId(arr.length ? String(arr[0]) : '');
              }}
              className="w-56"
              variant="secondary"
            >
              <>
                <SelectItem key="" id="">{t('municipal_roi_page.filters.all_sub_regions')}</SelectItem>
                {subRegions.map((sr) => (
                  <SelectItem key={String(sr.id)} id={String(sr.id)}>{sr.name}</SelectItem>
                ))}
              </>
            </Select>
          )}
          <div className="ml-auto text-xs text-muted">
            {data?.period
              ? t('municipal_roi_page.filters.period', { from: data.period.from, to: data.period.to })
              : t('municipal_roi_page.filters.period', { from, to })}
          </div>
        </CardBody>
      </Card>

      {/* Methodology note */}
      <Card className="border border-[var(--color-border)] bg-[var(--color-surface-alt)]">
        <CardBody className="flex flex-row items-start gap-3 py-3">
          <Info size={16} className="mt-0.5 shrink-0 text-muted" />
          <p className="text-sm text-muted">
            {data?.methodology ? (
              <>
                {t('municipal_roi_page.methodology.hours_valued_at')}{' '}
                <Abbr term="CHF">
                  {t('municipal_roi_page.methodology.chf_per_hour', {
                    amount: NUM.format(data.methodology.hourly_rate_chf),
                  })}
                </Abbr>{' '}
                (
                {data.methodology.hourly_rate_source === 'tenant_setting'
                  ? t('municipal_roi_page.methodology.tenant_setting_source')
                  : t('municipal_roi_page.methodology.default_source')}
                ). {t('municipal_roi_page.methodology.prevention_value_prefix', {
                  multiplier: data.methodology.prevention_multiplier,
                })}{' '}
                {t('common:nav.caring_community')} {t('municipal_roi_page.methodology.prevention_value_suffix')}{' '}
                {data.methodology.substitution_applied
                  ? t('municipal_roi_page.methodology.substitution_applied')
                  : t('municipal_roi_page.methodology.substitution_not_applied')}
              </>
            ) : (
              <>
                {t('municipal_roi_page.methodology.hours_are_valued_at')}{' '}
                <Abbr term="CHF">{t('municipal_roi_page.methodology.default_rate')}</Abbr>{' '}
                ({t('municipal_roi_page.methodology.default_source')}).{' '}
                {t('municipal_roi_page.methodology.default_prevention_prefix')}{' '}
                {t('common:nav.caring_community')} {t('municipal_roi_page.methodology.default_prevention_suffix')}
              </>
            )}
          </p>
        </CardBody>
      </Card>

      {/* Loading */}
      {loading && (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {data && !loading && (
        <>
          {/* Top KPI row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <StatCard
                label={t('municipal_roi_page.stats.total_hours')}
                value={data.total_hours.toLocaleString(getFormattingLocale())}
                icon={Clock}
                color="default"
              />
              {showWeightedAnnotation && typeof data.weighted_hours === 'number' && (
                <Tooltip
                  content={t('municipal_roi_page.stats.weighted_hours_tooltip')}
                >
                  <p className="mt-1 text-xs text-muted cursor-help">
                    {t('municipal_roi_page.stats.weighted_hours_note', {
                      hours: NUM.format(data.weighted_hours),
                    })}
                  </p>
                </Tooltip>
              )}
            </div>
            <StatCard
              label={t('municipal_roi_page.stats.active_members')}
              value={data.active_members.toLocaleString(getFormattingLocale())}
              icon={Users}
              color="success"
            />
            <StatCard
              label={t('municipal_roi_page.stats.active_relationships')}
              value={data.active_relationships.toLocaleString(getFormattingLocale())}
              icon={Heart}
              color="default"
            />
            <StatCard
              label={t('municipal_roi_page.stats.care_recipients')}
              value={data.recipient_count.toLocaleString(getFormattingLocale())}
              icon={Building2}
              color="warning"
            />
          </div>

          {/* ROI section */}
          <Card>
            <CardHeader className="pb-2">
              <span className="font-semibold text-sm">{t('municipal_roi_page.roi.title')}</span>
            </CardHeader>
            <CardBody className="pt-0 space-y-4">
              {/* Primary figure */}
              <div className="flex flex-wrap items-end gap-3">
                <span className="text-4xl font-extrabold text-foreground">
                  {CHF.format(data.roi.formal_care_offset_chf)}
                </span>
                {yoyPct !== null && (
                  <Chip
                    color={yoyPct >= 0 ? 'success' : 'danger'}
                    variant="soft"
                    size="sm"
                    startContent={
                      yoyPct >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />
                    }
                  >
                    {t('municipal_roi_page.roi.yoy', {
                      value: formatPercentValue(yoyPct, { signDisplay: yoyPct > 0 ? 'always' : 'auto' }),
                    })}
                  </Chip>
                )}
              </div>
              <p className="text-sm text-muted">{t('municipal_roi_page.roi.prevented_this_period')}</p>

              <Separator />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <p className="text-xs text-muted mb-1">
                    {t('municipal_roi_page.roi.prevention_value')}
                    {data.methodology
                      ? t('municipal_roi_page.roi.multiplier_note', {
                          multiplier: data.methodology.prevention_multiplier,
                        })
                      : t('municipal_roi_page.roi.default_multiplier_note')}
                  </p>
                  <p className="text-2xl font-bold">{CHF.format(data.roi.prevention_value_chf)}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <p className="text-xs text-muted mb-1">
                    {t('municipal_roi_page.roi.social_isolation_supported')}
                  </p>
                  <p className="text-2xl font-bold">
                    {data.roi.social_isolation_prevented.toLocaleString(getFormattingLocale())}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Municipalities context card */}
          <Card>
            <CardHeader className="pb-2">
              <span className="font-semibold text-sm">{t('municipal_roi_page.municipalities.title')}</span>
            </CardHeader>
            <CardBody className="pt-0">
              <ul className="space-y-2">
                {([
                  <>{t('municipal_roi_page.municipalities.point_hour_prefix')} <Abbr term="CHF">{t('municipal_roi_page.methodology.default_rate')}</Abbr> {t('municipal_roi_page.municipalities.point_hour_suffix')}</>,
                  <>{t('municipal_roi_page.municipalities.point_prevention')}</>,
                  <><Abbr term="NEXUS" /> {t('municipal_roi_page.municipalities.point_nexus')}</>,
                  <>{t('municipal_roi_page.municipalities.point_export')}</>,
                ] as React.ReactNode[]).map((point, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-foreground">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    {point}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          {/* Sub-region breakdown */}
          {sortedBreakdown.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <div className="space-y-0.5">
                  <span className="font-semibold text-sm">{t('municipal_roi_page.breakdown.title')}</span>
                  <p className="text-xs text-muted">
                    {t('municipal_roi_page.breakdown.description')}
                  </p>
                </div>
              </CardHeader>
              <CardBody className="pt-0">
                <Table aria-label={t('municipal_roi_page.breakdown.aria')} removeWrapper>
                  <TableHeader>
                    <TableColumn>{t('municipal_roi_page.breakdown.sub_region')}</TableColumn>
                    <TableColumn>{t('municipal_roi_page.breakdown.hours')}</TableColumn>
                    <TableColumn>{t('municipal_roi_page.breakdown.weighted_hours')}</TableColumn>
                    <TableColumn>{t('municipal_roi_page.breakdown.formal_care_offset')}</TableColumn>
                  </TableHeader>
                  <TableBody>
                    {sortedBreakdown.map((row) => (
                      <TableRow key={row.sub_region_id}>
                        <TableCell>{row.sub_region_name}</TableCell>
                        <TableCell>{NUM.format(row.hours)}</TableCell>
                        <TableCell>{NUM.format(row.weighted_hours)}</TableCell>
                        <TableCell>{CHF.format(row.formal_care_offset_chf)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
