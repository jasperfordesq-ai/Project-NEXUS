import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, ChipProps, Input, Spinner, Textarea, Select, SelectItem, useDisclosure, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tab, Tabs, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks/usePageTitle';

import { Separator } from '@/components/ui';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import Bell from 'lucide-react/icons/bell';
import CheckCircle from 'lucide-react/icons/check-circle';
import Clock from 'lucide-react/icons/clock';
import Megaphone from 'lucide-react/icons/megaphone';
import Send from 'lucide-react/icons/send';
import TrendingUp from 'lucide-react/icons/trending-up';
import Users from 'lucide-react/icons/users';
import XCircle from 'lucide-react/icons/x-circle';
import api from '@/lib/api';
import { safeHref } from '@/lib/safeHref';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * PushCampaignAdminPage — AG57 Paid Push Campaign Management
 *
 * Admin console for reviewing, approving, rejecting and dispatching
 * paid push notification campaigns from advertisers (SMEs, Vereins, Gemeinden).
 *
 * User-facing admin copy is routed through translations.
 *
 * Features:
 *  - 4 stat cards: Total Campaigns, Pending Review, Sends This Month, Revenue This Month
 *  - Campaigns table with status chips, open-rate, cost, approve/reject/dispatch actions
 *  - Approve triggers immediate dispatch when no future scheduled_at
 *  - Reject modal with mandatory reason
 *  - Campaign detail modal with analytics bar chart (div-based)
 *  - Create Campaign modal
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type CampaignStatus =
  | 'draft'
  | 'pending_review'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'paused'
  | 'rejected'
  | 'cancelled';

type AdvertiserType = 'sme' | 'verein' | 'gemeinde' | 'private';
type Translate = ReturnType<typeof useTranslation<'admin'>>['t'];

interface Campaign {
  id: number;
  tenant_id: number;
  created_by: number;
  name: string;
  status: CampaignStatus;
  advertiser_type: AdvertiserType;
  title: string;
  body: string;
  cta_url: string | null;
  audience_filter: string | null;
  target_count: number | null;
  actual_send_count: number;
  scheduled_at: string | null;
  sent_at: string | null;
  cost_per_send: number;
  total_cost_cents: number;
  approved_by: number | null;
  approved_at: string | null;
  rejection_reason: string | null;
  open_count: number;
  click_count: number;
  created_at: string;
  updated_at: string;
  advertiser_name: string;
  advertiser_email: string;
  analytics?: CampaignAnalytics;
}

interface CampaignAnalytics {
  send_count: number;
  open_count: number;
  click_count: number;
  open_rate: number;
  daily_breakdown: Array<{ date: string; sends: number; opens: number }>;
}

interface OverviewStats {
  total_campaigns: number;
  by_status: Record<string, number>;
  sends_this_month: number;
  opens_this_month: number;
  revenue_cents_this_month: number;
}

// ---------------------------------------------------------------------------
// Status config
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  CampaignStatus,
  { labelKey: string; color: ChipProps['color'] }
> = {
  draft:          { labelKey: 'advertising.status.draft',          color: 'default' },
  pending_review: { labelKey: 'advertising.status.pending_review', color: 'warning' },
  scheduled:      { labelKey: 'advertising.status.scheduled',      color: 'primary' },
  sending:        { labelKey: 'advertising.status.sending',        color: 'secondary' },
  sent:           { labelKey: 'advertising.status.sent',           color: 'success' },
  paused:         { labelKey: 'advertising.status.paused',         color: 'default' },
  rejected:       { labelKey: 'advertising.status.rejected',       color: 'danger' },
  cancelled:      { labelKey: 'advertising.status.cancelled',      color: 'danger' },
};

const ADVERTISER_LABEL_KEYS: Record<AdvertiserType, string> = {
  sme:      'advertising.advertiser.sme',
  verein:   'advertising.advertiser.verein',
  gemeinde: 'advertising.advertiser.gemeinde',
  private:  'advertising.advertiser.private',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: string | null): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(getFormattingLocale());
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'currency',
    currency: 'EUR',
  }).format(cents / 100);
}

function openRate(campaign: Campaign): string {
  if (campaign.actual_send_count === 0) return '—';
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(campaign.open_count / campaign.actual_send_count);
}

function StatusChip({ status, t }: { status: CampaignStatus; t: Translate }) {
  const cfg = STATUS_CONFIG[status] ?? { labelKey: status, color: 'default' as const };
  return (
    <Chip size="sm" color={cfg.color} variant="soft">
      {t(cfg.labelKey, { defaultValue: t('common.unknown') })}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <Card className="flex-1 min-w-[160px]">
      <CardBody className="flex flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-muted">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <p className="text-2xl font-bold">{value}</p>
        {sub && <p className="text-xs text-muted">{sub}</p>}
      </CardBody>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Analytics Bar Chart (div-based, no Recharts needed)
// ---------------------------------------------------------------------------

function MiniBarChart({
  breakdown,
  t,
}: {
  breakdown: Array<{ date: string; sends: number; opens: number }>;
  t: Translate;
}) {
  if (breakdown.length === 0) {
    return <p className="text-sm text-muted">{t('advertising.push.no_daily_data')}</p>;
  }

  const maxSends = Math.max(...breakdown.map((d) => d.sends), 1);

  return (
    <div className="space-y-1">
      <div className="mb-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-accent" />
          {t('advertising.push.metrics.sends')}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-sm bg-success" />
          {t('advertising.push.metrics.opens')}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex min-h-[60px] min-w-0 items-end gap-1">
          {breakdown.map((d) => {
            const sendPct = (d.sends / maxSends) * 100;
            const openPct = maxSends > 0 ? (d.opens / maxSends) * 100 : 0;
            return (
              <div key={d.date} className="flex flex-col items-center gap-0.5 flex-1 min-w-[28px]">
                <div className="flex h-12 w-full items-end gap-0.5">
                  <div
                    className="flex-1 bg-accent rounded-t opacity-80"
                    style={{ height: `${sendPct}%` }}
                    title={t('advertising.push.chart_sends_title', { count: d.sends })}
                  />
                  <div
                    className="flex-1 bg-success rounded-t opacity-80"
                    style={{ height: `${openPct}%` }}
                    title={t('advertising.push.chart_opens_title', { count: d.opens })}
                  />
                </div>
                <span className="mt-1 origin-top-left rotate-45 whitespace-nowrap text-[10px] text-muted">
                  {d.date.slice(5)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PushCampaignAdminPage() {
  const { t } = useTranslation('admin_advertising');
  usePageTitle(t('advertising.push.page_title'));

  // Modals
  const detailDisc   = useDisclosure();
  const rejectDisc   = useDisclosure();
  const createDisc   = useDisclosure();

  // Data
  const [campaigns, setCampaigns]   = useState<Campaign[]>([]);
  const [stats, setStats]           = useState<OverviewStats | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  // Status filter tab
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Detail modal
  const [detailCampaign, setDetailCampaign] = useState<Campaign | null>(null);
  const [detailLoading, setDetailLoading]   = useState(false);

  // Reject modal
  const [rejectTarget, setRejectTarget]     = useState<Campaign | null>(null);
  const [rejectReason, setRejectReason]     = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  // Action loading states (per campaign id)
  const [approving, setApproving]   = useState<number | null>(null);
  const [dispatching, setDispatching] = useState<number | null>(null);

  // Create form
  const [createName, setCreateName]                 = useState('');
  const [createTitle, setCreateTitle]               = useState('');
  const [createBody, setCreateBody]                 = useState('');
  const [createType, setCreateType]                 = useState<AdvertiserType>('sme');
  const [createCtaUrl, setCreateCtaUrl]             = useState('');
  const [createScheduledAt, setCreateScheduledAt]   = useState('');
  const [createSubmitting, setCreateSubmitting]     = useState(false);
  const [createError, setCreateError]               = useState<string | null>(null);

  // Feedback
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
      const [campRes, statsRes] = await Promise.all([
        api.get<{ data: Campaign[] }>(`/v2/admin/push-campaigns${params}`),
        api.get<{ data: OverviewStats }>('/v2/admin/push-campaigns/stats'),
      ]);

      const campRaw = campRes.data;
      const list: Campaign[] = Array.isArray(campRaw)
        ? campRaw
        : Array.isArray((campRaw as { data?: Campaign[] }).data)
          ? (campRaw as { data: Campaign[] }).data
          : [];
      setCampaigns(list);

      const statsRaw = statsRes.data;
      const statsData = ((statsRaw as unknown as { data?: OverviewStats }).data ?? statsRaw) as OverviewStats;
      setStats(statsData);
    } catch {
      setError(t('advertising.push.toasts.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  const handleApprove = async (campaign: Campaign) => {
    setApproving(campaign.id);
    setActionMsg(null);
    try {
      const res = await api.post(`/v2/admin/push-campaigns/${campaign.id}/approve`);
      if (res.success) {
        setActionMsg(t('advertising.push.toasts.approved', { name: campaign.name }));
        await fetchCampaigns();
      } else {
        setActionMsg(t('advertising.push.toasts.approve_failed'));
      }
    } catch {
      setActionMsg(t('advertising.push.toasts.approve_failed'));
    } finally {
      setApproving(null);
    }
  };

  const handleDispatch = async (campaign: Campaign) => {
    setDispatching(campaign.id);
    setActionMsg(null);
    try {
      const res = await api.post(`/v2/admin/push-campaigns/${campaign.id}/dispatch`);
      if (res.success) {
        setActionMsg(t('advertising.push.toasts.dispatched', { name: campaign.name }));
        await fetchCampaigns();
      } else {
        setActionMsg(t('advertising.push.toasts.dispatch_failed'));
      }
    } catch {
      setActionMsg(t('advertising.push.toasts.dispatch_failed'));
    } finally {
      setDispatching(null);
    }
  };

  const openRejectModal = (campaign: Campaign) => {
    setRejectTarget(campaign);
    setRejectReason('');
    rejectDisc.onOpen();
  };

  const handleReject = async () => {
    if (!rejectTarget || !rejectReason.trim()) return;
    setRejectSubmitting(true);
    try {
      const res = await api.post(`/v2/admin/push-campaigns/${rejectTarget.id}/reject`, {
        reason: rejectReason.trim(),
      });
      if (res.success) {
        rejectDisc.onClose();
        setActionMsg(t('advertising.push.toasts.rejected', { name: rejectTarget.name }));
        await fetchCampaigns();
      } else {
        setActionMsg(t('advertising.push.toasts.reject_failed'));
      }
    } catch {
      setActionMsg(t('advertising.push.toasts.reject_failed'));
    } finally {
      setRejectSubmitting(false);
    }
  };

  const openDetailModal = async (campaign: Campaign) => {
    setDetailCampaign(campaign);
    detailDisc.onOpen();
    setDetailLoading(true);
    try {
      const res = await api.get<{ data: Campaign }>(`/v2/admin/push-campaigns/${campaign.id}`);
      const raw = res.data;
      const full = ((raw as unknown as { data?: Campaign }).data ?? raw) as Campaign;
      setDetailCampaign(full);
    } catch {
      // Keep the partial data already set
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!createName.trim() || !createTitle.trim() || !createBody.trim()) {
      setCreateError(t('advertising.push.toasts.required_fields'));
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      await api.post('/v2/me/push-campaigns', {
        name:            createName.trim(),
        title:           createTitle.trim(),
        body:            createBody.trim(),
        advertiser_type: createType,
        cta_url:         createCtaUrl.trim() || null,
        scheduled_at:    createScheduledAt || null,
      });
      createDisc.onClose();
      setCreateName('');
      setCreateTitle('');
      setCreateBody('');
      setCreateType('sme');
      setCreateCtaUrl('');
      setCreateScheduledAt('');
      await fetchCampaigns();
    } catch {
      setCreateError(t('advertising.push.toasts.create_failed'));
    } finally {
      setCreateSubmitting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------

  const pendingCount = campaigns.filter((c) => c.status === 'pending_review').length;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <>
      {/* ------------------------------------------------------------------ */}
      {/* Stats cards                                                          */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-wrap gap-3 mb-6">
        <StatCard
          icon={<Megaphone size={16} />}
          label={t('advertising.push.stats.total_campaigns')}
          value={stats?.total_campaigns ?? 0}
        />
        <StatCard
          icon={<Clock size={16} />}
          label={t('advertising.push.stats.pending_review')}
          value={pendingCount}
          sub={pendingCount > 0 ? t('advertising.push.stats.needs_attention') : undefined}
        />
        <StatCard
          icon={<Users size={16} />}
          label={t('advertising.push.stats.sends_this_month')}
          value={(stats?.sends_this_month ?? 0).toLocaleString(getFormattingLocale())}
        />
        <StatCard
          icon={<TrendingUp size={16} />}
          label={t('advertising.push.stats.revenue_this_month')}
          value={formatCents(stats?.revenue_cents_this_month ?? 0)}
        />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main card                                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card>
        <CardHeader className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Bell size={20} className="text-accent" />
            <h2 className="text-lg font-semibold">{t('advertising.push.header.title')}</h2>
          </div>
          <Button
            startContent={<Send size={16} />}
            onPress={createDisc.onOpen}
          >
            {t('advertising.shared.actions.new_campaign')}
          </Button>
        </CardHeader>
        <Separator />
        <CardBody>
          {actionMsg && (
            <div className="mb-3 rounded-lg bg-surface-secondary px-3 py-2 text-sm text-foreground">
              {actionMsg}
            </div>
          )}

          {/* Status filter tabs */}
          <Tabs
            aria-label={t('advertising.shared.filter_by_status')}
            selectedKey={statusFilter}
            onSelectionChange={(k) => setStatusFilter(k as string)}
            className="mb-4"
            size="sm"
          >
            <Tab key="all" title={t('advertising.status.all')} />
            <Tab key="pending_review" title={t('advertising.status.pending_review')} />
            <Tab key="scheduled" title={t('advertising.status.scheduled')} />
            <Tab key="sent" title={t('advertising.status.sent')} />
            <Tab key="rejected" title={t('advertising.status.rejected')} />
            <Tab key="draft" title={t('advertising.status.drafts')} />
          </Tabs>

          {loading && (
            <div className="flex justify-center py-10">
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
            </div>
          )}

          {!loading && error && (
            <p className="text-danger text-sm">{error}</p>
          )}

          {!loading && !error && campaigns.length === 0 && (
            <p className="py-4 text-sm text-muted">{t('advertising.shared.empty.no_campaigns')}</p>
          )}

          {!loading && !error && campaigns.length > 0 && (
            <Table aria-label={t('advertising.push.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('advertising.shared.columns.campaign')}</TableColumn>
                <TableColumn>{t('advertising.shared.columns.advertiser')}</TableColumn>
                <TableColumn>{t('advertising.shared.columns.status')}</TableColumn>
                <TableColumn>{t('advertising.push.columns.title_preview')}</TableColumn>
                <TableColumn>{t('advertising.push.columns.targets')}</TableColumn>
                <TableColumn>{t('advertising.push.columns.open_rate')}</TableColumn>
                <TableColumn>{t('advertising.push.columns.cost')}</TableColumn>
                <TableColumn>{t('advertising.push.columns.scheduled')}</TableColumn>
                <TableColumn>{t('advertising.shared.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {campaigns.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="min-h-9 justify-start px-0 text-left font-medium"
                        onPress={() => openDetailModal(c)}
                      >
                        {c.name}
                      </Button>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <p>{c.advertiser_name || '—'}</p>
                        <p className="text-xs text-muted">
                          {t(ADVERTISER_LABEL_KEYS[c.advertiser_type], { defaultValue: t('common.unknown') })}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusChip status={c.status} t={t} />
                    </TableCell>
                    <TableCell>
                      <p className="text-sm max-w-[180px] truncate" title={c.title}>
                        {c.title}
                      </p>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {c.actual_send_count > 0
                          ? c.actual_send_count.toLocaleString(getFormattingLocale())
                          : (c.target_count != null ? `~${c.target_count.toLocaleString(getFormattingLocale())}` : '—')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{openRate(c)}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {c.total_cost_cents > 0
                          ? formatCents(c.total_cost_cents)
                          : t('advertising.push.cost_per_send', { cost: formatCents(c.cost_per_send) })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted">
                        {c.scheduled_at ? formatDate(c.scheduled_at) : t('advertising.push.immediate')}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {c.status === 'pending_review' && (
                          <>
                            <Button
                              size="sm"
                              variant="secondary"
                              startContent={<CheckCircle size={14} />}
                              isLoading={approving === c.id}
                              onPress={() => handleApprove(c)}
                            >
                              {t('advertising.shared.actions.approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              startContent={<XCircle size={14} />}
                              onPress={() => openRejectModal(c)}
                            >
                              {t('advertising.shared.actions.reject')}
                            </Button>
                          </>
                        )}
                        {c.status === 'scheduled' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            startContent={<Send size={14} />}
                            isLoading={dispatching === c.id}
                            onPress={() => handleDispatch(c)}
                          >
                            {t('advertising.push.actions.dispatch_now')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="tertiary"
                          startContent={<BarChart3 size={14} />}
                          onPress={() => openDetailModal(c)}
                        >
                          {t('advertising.shared.actions.details')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Campaign Detail Modal                                                */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        isOpen={detailDisc.isOpen}
        onClose={detailDisc.onClose}
        size="3xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <BarChart3 size={18} />
            {t('advertising.shared.campaign_details')}
          </ModalHeader>
          <ModalBody>
            {detailLoading && (
              <div className="flex justify-center py-8">
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
              </div>
            )}
            {detailCampaign && !detailLoading && (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="mb-0.5 text-xs text-muted">{t('advertising.shared.fields.campaign_name')}</p>
                    <p className="font-medium">{detailCampaign.name}</p>
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs text-muted">{t('advertising.shared.columns.status')}</p>
                    <StatusChip status={detailCampaign.status} t={t} />
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs text-muted">{t('advertising.shared.columns.advertiser')}</p>
                    <p>{detailCampaign.advertiser_name || '—'}</p>
                    <p className="text-xs text-muted">{detailCampaign.advertiser_email}</p>
                  </div>
                  <div>
                    <p className="mb-0.5 text-xs text-muted">{t('advertising.shared.fields.type')}</p>
                    <p>{t(ADVERTISER_LABEL_KEYS[detailCampaign.advertiser_type], { defaultValue: t('common.unknown') })}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="mb-0.5 text-xs text-muted">{t('advertising.push.fields.push_title')}</p>
                    <p className="font-medium">{detailCampaign.title}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="mb-0.5 text-xs text-muted">{t('advertising.push.fields.push_body')}</p>
                    <p>{detailCampaign.body}</p>
                  </div>
                  {detailCampaign.cta_url && (
                    <div className="col-span-2">
                      <p className="mb-0.5 text-xs text-muted">{t('advertising.push.fields.cta_url')}</p>
                      <a
                        href={safeHref(detailCampaign.cta_url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent text-xs break-all"
                      >
                        {detailCampaign.cta_url}
                      </a>
                    </div>
                  )}
                </div>

                <Separator />

                {/* Metrics */}
                <div className="grid grid-cols-4 gap-3 text-center text-sm">
                  <div>
                    <p className="text-2xl font-bold">{detailCampaign.actual_send_count.toLocaleString(getFormattingLocale())}</p>
                    <p className="text-xs text-muted">{t('advertising.push.metrics.sent')}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{detailCampaign.open_count.toLocaleString(getFormattingLocale())}</p>
                    <p className="text-xs text-muted">{t('advertising.push.metrics.opens')}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{openRate(detailCampaign)}</p>
                    <p className="text-xs text-muted">{t('advertising.push.columns.open_rate')}</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{formatCents(detailCampaign.total_cost_cents)}</p>
                    <p className="text-xs text-muted">{t('advertising.push.metrics.revenue')}</p>
                  </div>
                </div>

                {/* Analytics chart */}
                {detailCampaign.analytics && (
                  <>
                    <Separator />
                    <div>
                      <p className="text-sm font-medium mb-3">{t('advertising.push.daily_breakdown')}</p>
                      <MiniBarChart breakdown={detailCampaign.analytics.daily_breakdown} t={t} />
                    </div>
                  </>
                )}

                {/* Rejection reason */}
                {detailCampaign.rejection_reason && (
                  <>
                    <Separator />
                    <div className="rounded-lg bg-danger/10 border border-danger/30 p-3 text-sm">
                      <p className="font-medium text-danger mb-1">{t('advertising.shared.rejection_reason')}</p>
                      <p className="text-danger-soft-foreground">{detailCampaign.rejection_reason}</p>
                    </div>
                  </>
                )}

                {/* Dates */}
                <Separator />
                <div className="grid grid-cols-2 gap-3 text-xs text-muted">
                  <div>
                    <span>{t('advertising.push.dates.created')}: </span>
                    <span>{formatDate(detailCampaign.created_at)}</span>
                  </div>
                  <div>
                    <span>{t('advertising.push.dates.approved')}: </span>
                    <span>{formatDate(detailCampaign.approved_at)}</span>
                  </div>
                  <div>
                    <span>{t('advertising.push.dates.scheduled')}: </span>
                    <span>{detailCampaign.scheduled_at ? formatDate(detailCampaign.scheduled_at) : t('advertising.push.immediate')}</span>
                  </div>
                  <div>
                    <span>{t('advertising.push.dates.sent')}: </span>
                    <span>{formatDate(detailCampaign.sent_at)}</span>
                  </div>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={detailDisc.onClose}>
              {t('advertising.shared.actions.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Reject Modal                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Modal isOpen={rejectDisc.isOpen} onClose={rejectDisc.onClose} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <XCircle size={18} className="text-danger" />
            {t('advertising.shared.actions.reject_campaign')}
          </ModalHeader>
          <ModalBody>
            {rejectTarget && (
              <>
                <p className="text-sm text-muted">
                  {t('advertising.push.reject_intro_prefix')} <strong>{rejectTarget.name}</strong>. {t('advertising.push.reject_intro_suffix')}
                </p>
                <Textarea
                  label={t('advertising.shared.rejection_reason')}
                  placeholder={t('advertising.push.rejection_placeholder')}
                  value={rejectReason}
                  onValueChange={setRejectReason}
                  variant="secondary"
                  minRows={3}
                  isRequired
                />
              </>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={rejectDisc.onClose}>
              {t('advertising.shared.actions.cancel')}
            </Button>
            <Button
              variant="danger"
              isLoading={rejectSubmitting}
              isDisabled={!rejectReason.trim()}
              onPress={handleReject}
            >
              {t('advertising.shared.actions.reject_campaign')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Create Campaign Modal                                                */}
      {/* ------------------------------------------------------------------ */}
      <Modal isOpen={createDisc.isOpen} onClose={createDisc.onClose} size="2xl">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Megaphone size={18} className="text-accent" />
            {t('advertising.push.create_title')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-3">
              {createError && (
                <p className="text-danger text-sm">{createError}</p>
              )}
              <Input
                label={t('advertising.shared.fields.campaign_name')}
                placeholder={t('advertising.push.placeholders.campaign_name')}
                value={createName}
                onValueChange={setCreateName}
                variant="secondary"
                isRequired
              />
              <Select
                label={t('advertising.shared.fields.advertiser_type')}
                selectedKeys={[createType]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as AdvertiserType;
                  if (val) setCreateType(val);
                }}
                variant="secondary"
              >
                <SelectItem key="sme" id="sme">{t('advertising.advertiser.sme')}</SelectItem>
                <SelectItem key="verein" id="verein">{t('advertising.advertiser.verein')}</SelectItem>
                <SelectItem key="gemeinde" id="gemeinde">{t('advertising.advertiser.gemeinde')}</SelectItem>
                <SelectItem key="private" id="private">{t('advertising.advertiser.private')}</SelectItem>
              </Select>
              <Input
                label={t('advertising.push.fields.notification_title')}
                placeholder={t('advertising.push.placeholders.title')}
                value={createTitle}
                onValueChange={setCreateTitle}
                variant="secondary"
                isRequired
                description={`${createTitle.length}/100`}
                maxLength={100}
              />
              <Textarea
                label={t('advertising.push.fields.notification_body')}
                placeholder={t('advertising.push.placeholders.body')}
                value={createBody}
                onValueChange={setCreateBody}
                variant="secondary"
                isRequired
                minRows={2}
                description={`${createBody.length}/400`}
                maxLength={400}
              />
              <Input
                label={t('advertising.push.fields.cta_url_optional')}
                placeholder={t('advertising.push.placeholders.cta_url')}
                value={createCtaUrl}
                onValueChange={setCreateCtaUrl}
                variant="secondary"
              />
              <Input
                type="datetime-local"
                label={t('advertising.push.fields.scheduled_at')}
                value={createScheduledAt}
                onValueChange={setCreateScheduledAt}
                variant="secondary"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={createDisc.onClose}>
              {t('advertising.shared.actions.cancel')}
            </Button>
            <Button
              startContent={<Send size={16} />}
              isLoading={createSubmitting}
              isDisabled={!createName.trim() || !createTitle.trim() || !createBody.trim()}
              onPress={handleCreate}
            >
              {t('advertising.shared.actions.create_campaign')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
