// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button, Card, CardBody, CardHeader, Chip, Code, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import HardDrive from 'lucide-react/icons/hard-drive';
import RouteIcon from 'lucide-react/icons/route';
import Search from 'lucide-react/icons/search';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { adminPrerender, type PrerenderTenantSafety } from '../../../api/adminApi';
import type { ToastShape } from './prerenderAdminTypes';

function stalenessColor(staleness: 'fresh' | 'warn' | 'stale'): 'success' | 'warning' | 'danger' {
  return staleness === 'fresh' ? 'success' : staleness === 'warn' ? 'warning' : 'danger';
}

function routeReasonText(
  t: ReturnType<typeof useTranslation>['t'],
  reason: PrerenderTenantSafety['snapshots'][number]['reason'],
): string {
  return t(`reasons.${reason.key}`, { value: reason.value ?? '' });
}

export function TenantSafetyTab({
  isSuperAdmin,
  toast,
  onOpenInventory,
}: {
  isSuperAdmin: boolean;
  toast: ToastShape;
  onOpenInventory: (slug: string) => void;
}) {
  const { t } = useTranslation('admin_advanced', { keyPrefix: 'advanced.prerender.tenant_safety' });
  const [tenant, setTenant] = useState('');
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<PrerenderTenantSafety | null>(null);

  const load = async () => {
    const slug = tenant.trim();
    if (!slug) {
      toast.error(t('errors.tenant_required'));
      return;
    }
    setLoading(true);
    try {
      const res = await adminPrerender.getTenantSafety(slug);
      setReport(res.data ?? null);
      if (res.data) toast.success(t('messages.loaded', { slug }));
    } catch {
      setReport(null);
      toast.error(t('errors.load'));
    } finally {
      setLoading(false);
    }
  };

  const attentionSnapshots = report?.snapshots
    .filter((row) => !row.expected || row.staleness !== 'fresh' || row.content_stale || row.asset_issues.length > 0) ?? [];
  const needsAttention = report
    ? new Set([
      ...report.missing_routes,
      ...report.stale_routes,
      ...report.asset_invalid_routes,
      ...report.unexpected_routes,
      ...attentionSnapshots.map((row) => row.route),
    ]).size
    : 0;
  const visibleAttentionSnapshots = attentionSnapshots.slice(0, 100);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card>
        <CardHeader>
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold">
              <ShieldCheck size={18} />{t('title')}
            </h3>
            <p className="text-sm text-muted">{t('description')}</p>
          </div>
        </CardHeader>
        <CardBody className="gap-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              label={t('fields.tenant_slug')}
              placeholder={t('placeholders.tenant_slug')}
              variant="secondary"
              value={tenant}
              onValueChange={setTenant}
            />
            <div className="flex flex-wrap items-end gap-2">
              <Button
                color="primary"
                startContent={<Search size={16} />}
                onPress={load}
                isLoading={loading}
              >
                {t('actions.inspect')}
              </Button>
              {report && (
                <Button
                  variant="secondary"
                  startContent={<HardDrive size={16} />}
                  onPress={() => onOpenInventory(report.tenant.slug)}
                >
                  {t('actions.open_inventory')}
                </Button>
              )}
            </div>
          </div>

          {report ? (
            <>
              <div className="rounded-md border border-divider p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="text-sm font-semibold">{report.tenant.slug}</p>
                    <p className="text-sm text-muted">
                      {report.tenant.host}{report.tenant.prefix || ''}
                    </p>
                  </div>
                  <Chip color={needsAttention === 0 ? 'success' : 'warning'} variant="soft">
                    {needsAttention === 0 ? t('status.clean') : t('status.needs_attention', { count: needsAttention })}
                  </Chip>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  ['expected', report.counts.expected],
                  ['snapshots', report.counts.snapshots],
                  ['missing', report.counts.missing],
                  ['unexpected', report.counts.unexpected],
                  ['stale', report.counts.stale],
                  ['asset_invalid', report.counts.asset_invalid],
                  ['static', report.counts.static],
                  ['sitemap', report.counts.sitemap],
                ].map(([key, value]) => (
                  <div key={key} className="rounded-md border border-divider p-3">
                    <p className="text-xs uppercase text-muted">{t(`counts.${key}`)}</p>
                    <p className="text-2xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>

              <div>
                {report.missing_routes.length > 0 && (
                  <div className="mb-4 rounded-md border border-danger/30 bg-danger/5 p-3">
                    <h4 className="text-sm font-semibold text-danger">
                      {t('sections.missing_routes', { count: report.missing_routes.length })}
                    </h4>
                    <div className="mt-2 max-h-56 space-y-1 overflow-auto">
                      {report.missing_routes.map((route) => (
                        <Code key={route} className="block text-xs">{route}</Code>
                      ))}
                    </div>
                  </div>
                )}
                <h4 className="mb-2 text-sm font-semibold">{t('sections.attention')}</h4>
                {visibleAttentionSnapshots.length === 0 ? (
                  <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-soft-foreground">
                    {t('empty_attention')}
                  </p>
                ) : (
                  <div className="overflow-x-auto rounded-md border border-divider">
                    <Table aria-label={t('tables.attention_aria')}>
                      <TableHeader>
                        <TableColumn>{t('columns.route')}</TableColumn>
                        <TableColumn>{t('columns.source')}</TableColumn>
                        <TableColumn>{t('columns.status')}</TableColumn>
                        <TableColumn>{t('columns.why')}</TableColumn>
                      </TableHeader>
                      <TableBody>
                        {visibleAttentionSnapshots.map((row) => (
                          <TableRow key={row.cache_path}>
                            <TableCell>
                              <Code className="text-xs">{row.route}</Code>
                            </TableCell>
                            <TableCell>
                              <Chip size="sm" variant="soft" color={row.source === 'unexpected' ? 'warning' : 'default'}>
                                {t(`sources.${row.source}`)}
                              </Chip>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-wrap gap-1">
                                {!row.expected && <Chip size="sm" color="warning" variant="soft">{t('badges.unexpected')}</Chip>}
                                {row.staleness !== 'fresh' && (
                                  <Chip size="sm" color={stalenessColor(row.staleness)} variant="soft">
                                    {t(`staleness.${row.staleness}`)}
                                  </Chip>
                                )}
                                {row.asset_issues.length > 0 && <Chip size="sm" color="danger" variant="soft">{t('badges.assets')}</Chip>}
                                {row.content_stale && <Chip size="sm" color="warning" variant="soft">{t('badges.content')}</Chip>}
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted">{routeReasonText(t, row.reason)}</span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
                {attentionSnapshots.length > visibleAttentionSnapshots.length && (
                  <p className="mt-2 text-xs text-muted">
                    {t('sections.attention_limited', {
                      shown: visibleAttentionSnapshots.length,
                      total: attentionSnapshots.length,
                    })}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-md border border-divider px-3 py-6 text-center text-sm text-muted">
              {t('empty')}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="space-y-4">
        <div className="rounded-md border border-divider p-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <RouteIcon size={16} />{t('help.title')}
          </h4>
          <div className="mt-3 space-y-3 text-sm text-muted">
            <p>{t('help.expected')}</p>
            <p>{t('help.unexpected')}</p>
            <p>{t('help.next_step')}</p>
          </div>
        </div>
        {report && report.unexpected_routes.length > 0 && isSuperAdmin && (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-4 text-warning-soft-foreground">
            <h4 className="text-sm font-semibold">{t('cleanup.title')}</h4>
            <p className="mt-1 text-sm">{t('cleanup.body')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
