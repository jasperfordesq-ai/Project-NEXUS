import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Progress, Skeleton, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useCallback, useEffect, useMemo, type CSSProperties } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { Separator } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Eye from 'lucide-react/icons/eye';
import MousePointer from 'lucide-react/icons/mouse-pointer';
import BarChart3 from 'lucide-react/icons/chart-column';
import Trophy from 'lucide-react/icons/trophy';
import Send from 'lucide-react/icons/send';
import Mail from 'lucide-react/icons/mail';
import ExternalLink from 'lucide-react/icons/external-link';
import Clock from 'lucide-react/icons/clock';
import Monitor from 'lucide-react/icons/monitor';
import Smartphone from 'lucide-react/icons/smartphone';
import Tablet from 'lucide-react/icons/tablet';
import HelpCircle from 'lucide-react/icons/circle-help';
import Copy from 'lucide-react/icons/copy';
import TrendingUp from 'lucide-react/icons/trending-up';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { NewsletterResend } from './NewsletterResend';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Stats
 * Detailed per-campaign statistics page for a single newsletter.
 * Shows delivery funnel, engagement metrics, device breakdown, * A/B test results, timeline, top links, recent activity, and quick actions.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

interface NewsletterInfo {
  id: number;
  name: string;
  subject: string;
  subject_b: string | null;
  status: string;
  ab_test_enabled: boolean;
  ab_winner: string | null;
  ab_winner_metric: string;
  created_by: number;
  author_name: string | null;
  sent_at: string | null;
  created_at: string | null;
}

interface DeliveryStats {
  total_sent: number;
  delivered: number;
  failed: number;
  bounced: number;
  pending: number;
}

interface EngagementStats {
  unique_opens: number;
  total_opens: number;
  unique_clicks: number;
  total_clicks: number;
  open_rate: number;
  click_rate: number;
  click_to_open_rate: number;
  success_rate: number;
}

interface AbTestData {
  subject_a: string;
  subject_b: string;
  subject_a_opens: number;
  subject_a_clicks: number;
  subject_b_opens: number;
  subject_b_clicks: number;
  subject_a_sent: number;
  subject_b_sent: number;
  subject_a_open_rate: number;
  subject_b_open_rate: number;
  subject_a_click_rate: number;
  subject_b_click_rate: number;
  split_percentage: number;
  winner_metric: string;
  winner: string | null;
  winning_margin: number;
}

interface TimelinePoint {
  hour: number;
  opens: number;
  clicks: number;
}

interface TopLink {
  url: string;
  clicks: number;
  unique_clicks: number;
}

interface DeviceStats {
  desktop: number;
  mobile: number;
  tablet: number;
  unknown: number;
}

interface RecentActivityItem {
  action_type: 'open' | 'click';
  email: string;
  action_at: string;
  url: string | null;
}

interface PeakEngagement {
  max_opens_per_hour: number;
  peak_hour: number | null;
}

interface StatsData {
  newsletter: NewsletterInfo;
  delivery: DeliveryStats;
  engagement: EngagementStats;
  ab_test: AbTestData | null;
  timeline: TimelinePoint[];
  top_links: TopLink[];
  device_stats: DeviceStats;
  recent_activity: RecentActivityItem[];
  peak_engagement: PeakEngagement;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const DEVICE_COLORS: Record<string, string> = {
  desktop: CHART_TOKEN_COLORS.primary,
  mobile: CHART_TOKEN_COLORS.success,
  tablet: CHART_TOKEN_COLORS.warning,
  unknown: CHART_TOKEN_COLORS.muted,
};

const DEVICE_ICONS: Record<string, typeof Monitor> = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  unknown: HelpCircle,
};

function formatRate(rate: number, maximumFractionDigits = 2): string {
  return formatNumber(rate / 100, { style: 'percent', maximumFractionDigits });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NewsletterStats() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.page_title'));

  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectingWinner, setSelectingWinner] = useState(false);
  const [resendOpen, setResendOpen] = useState(false);
  const [emailClients, setEmailClients] = useState<Array<{ client: string; count: number }>>([]);

  const loadStats = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!id) return;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const nid = Number(id);
      const [statsRes, clientsRes] = await Promise.all([
        adminNewsletters.getStats(nid),
        adminNewsletters.getEmailClients(nid),
      ]);
      if (statsRes.success && statsRes.data) {
        setData(statsRes.data as unknown as StatsData);
      } else {
        setError(t('newsletters.error_not_found'));
      }
      if (clientsRes.success && clientsRes.data) {
        const raw = clientsRes.data as unknown as { email_clients?: Array<{ client: string; count: number }> };
        setEmailClients(raw?.email_clients ?? []);
      }
    } catch {
      setError(t('newsletters.error_failed_to_load_stats'));
    }
    if (!silent) setLoading(false);
  }, [id, t])


  useEffect(() => { loadStats(); }, [loadStats]);

  // A send is delivered over several minutes: the request hands off a first batch
  // and the every-minute cron drainer finishes the rest. Refresh quietly while the
  // newsletter is still sending so the admin watches the count climb instead of
  // staring at a part-finished total and assuming the send failed.
  const isSending = data?.newsletter?.status === 'sending';
  useEffect(() => {
    if (!isSending) return;
    const timer = setInterval(() => { void loadStats({ silent: true }); }, 10000);
    return () => clearInterval(timer);
  }, [isSending, loadStats]);

  const handleSelectWinner = async (winner: 'a' | 'b') => {
    if (!id) return;
    setSelectingWinner(true);
    try {
      const res = await adminNewsletters.selectAbWinner(Number(id), winner);
      if (res.success) {
        toast.success(t('newsletters.winner_selected'));
        loadStats();
      } else {
        toast.error(t('newsletters.failed_to_select_winner'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_select_winner'));
    }
    setSelectingWinner(false);
  };

  // Device chart data
  const deviceChartData = useMemo(() => {
    if (!data?.device_stats) return [];
    return Object.entries(data.device_stats)
      .filter(([, count]) => count > 0)
      .map(([device, count]) => ({
        name: t(`newsletters.device_${device}`),
        value: count,
        color: DEVICE_COLORS[device] || DEVICE_COLORS.unknown,
      }));
  }, [data?.device_stats, t]);

  const deviceTotal = useMemo(() => {
    if (!data?.device_stats) return 0;
    return Object.values(data.device_stats).reduce((sum, c) => sum + c, 0);
  }, [data?.device_stats]);

  // ── Loading State ──
  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('newsletters.newsletter_stats_title')}
          actions={
            <Button
              variant="secondary"
              startContent={<ArrowLeft aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath('/admin/newsletters'))}
            >
              {t('newsletters.back')}
            </Button>
          }
        />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-64 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // ── Error State ──
  if (error || !data) {
    return (
      <div>
        <PageHeader
          title={t('newsletters.newsletter_stats_title')}
          actions={
            <Button
              variant="secondary"
              startContent={<ArrowLeft aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath('/admin/newsletters'))}
            >
              {t('newsletters.back')}
            </Button>
          }
        />
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-12 text-center">
            <Mail aria-hidden="true" size={48} className="text-muted" />
            <p className="text-lg font-semibold text-foreground">{error || t('newsletters.error_not_found')}</p>
            <Button
              variant="primary"
              onPress={() => navigate(tenantPath('/admin/newsletters'))}
            >
              {t('newsletters.back_to_newsletters')}
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const { newsletter, delivery, engagement, ab_test, timeline, top_links, device_stats, recent_activity, peak_engagement } = data;
  const nonOpenerCount = delivery.delivered - engagement.unique_opens;

  return (
    <div>
      {/* ── Header ── */}
      <PageHeader
        title={newsletter.subject || newsletter.name}
        description={t('newsletters.newsletter_stats_desc')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              startContent={<ArrowLeft aria-hidden="true" size={16} />}
              onPress={() => navigate(tenantPath('/admin/newsletters'))}
            >
              {t('newsletters.back')}
            </Button>
            {newsletter.status === 'sent' && (
              <Button
                variant="secondary"
                startContent={<BarChart3 aria-hidden="true" size={16} />}
                onPress={() => navigate(tenantPath(`/admin/newsletters/${id}/activity`))}
              >
                {t('newsletters.activity_log')}
              </Button>
            )}
            {nonOpenerCount > 0 && newsletter.status === 'sent' && (
            <Button
                variant="secondary"
                startContent={<Send aria-hidden="true" size={16} />}
                onPress={() => setResendOpen(true)}
              >
                {t('newsletters.resend_to_non_openers_count')}
              </Button>
            )}
          </div>
        }
      />

      {/* ── Newsletter Info Card ── */}
      <Card  className="mb-6">
        <CardBody className="flex flex-row flex-wrap items-center justify-between gap-4 p-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold text-foreground">{newsletter.subject}</h2>
            <p className="mt-1 text-sm text-muted">
              {newsletter.sent_at
                ? t('newsletters.sent_on')
                : t('newsletters.created_on')}
              {newsletter.author_name ? ` ${t('newsletters.by_author')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Chip
              size="sm"
              color={newsletter.status === 'sent' ? 'success' : newsletter.status === 'draft' ? 'default' : 'warning'}
              variant="soft"
            >
              {t(`newsletters.status_${newsletter.status}`, { defaultValue: t('common.unknown') })}
            </Chip>
            {newsletter.ab_test_enabled && (
              <Chip size="sm" color="warning" variant="soft">
                {t('newsletters.ab_test')}
              </Chip>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Metrics Row (with unique counts) ── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('newsletters.label_success_rate')}
          value={formatNumber(engagement.success_rate / 100, { style: 'percent', maximumFractionDigits: 2 })}
          icon={CheckCircle}
          color="success"
          description={`${delivery.delivered.toLocaleString(getFormattingLocale())} ${t('newsletters.delivered_label')}`}
        />
        <StatCard
          label={t('newsletters.label_open_rate')}
          value={formatNumber(engagement.open_rate / 100, { style: 'percent', maximumFractionDigits: 2 })}
          icon={Eye}
          description={`${engagement.unique_opens.toLocaleString(getFormattingLocale())} ${t('newsletters.unique_opens_label')}`}
        />
        <StatCard
          label={t('newsletters.label_click_rate')}
          value={formatNumber(engagement.click_rate / 100, { style: 'percent', maximumFractionDigits: 2 })}
          icon={MousePointer}
          color="warning"
          description={`${engagement.unique_clicks.toLocaleString(getFormattingLocale())} ${t('newsletters.unique_clicks_label')}`}
        />
        <StatCard
          label={t('newsletters.label_click_to_open_rate')}
          value={formatNumber(engagement.click_to_open_rate / 100, { style: 'percent', maximumFractionDigits: 2 })}
          icon={BarChart3}
          description={`${engagement.total_clicks.toLocaleString(getFormattingLocale())} ${t('newsletters.total_clicks_desc')}`}
        />
      </div>

      {/* ── Engagement Funnel ── */}
      <Card  className="mb-6">
        <CardHeader className="flex flex-row items-center gap-2 px-5 pb-0 pt-5">
          <TrendingUp aria-hidden="true" size={18} className="text-muted" />
          <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_engagement_funnel')}</h3>
        </CardHeader>
        <CardBody className="space-y-4 px-5 pb-5">
          <FunnelBar
            label={t('newsletters.delivered_label')}
            value={delivery.delivered}
            total={delivery.delivered}
            color="default"
          />
          <FunnelBar
            label={t('newsletters.label_opened')}
            value={engagement.unique_opens}
            total={delivery.delivered}
            color="default"
            rate={engagement.open_rate}
          />
          <FunnelBar
            label={t('newsletters.label_clicked')}
            value={engagement.unique_clicks}
            total={delivery.delivered}
            color="success"
            rate={engagement.click_rate}
          />
        </CardBody>
      </Card>

      {/* ── Delivery Stats Card ── */}
      <Card  className="mb-6">
        <CardHeader className="px-5 pb-0 pt-5">
          <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_delivery_stats')}</h3>
        </CardHeader>
        <CardBody className="space-y-4 px-5 pb-5">
          <DeliveryBar label={t('newsletters.label_delivered')} value={delivery.delivered} total={delivery.total_sent + delivery.pending} color="success" />
          <DeliveryBar label={t('newsletters.label_failed')} value={delivery.failed} total={delivery.total_sent + delivery.pending} color="danger" />
          <DeliveryBar label={t('newsletters.label_bounced')} value={delivery.bounced} total={delivery.total_sent + delivery.pending} color="warning" />
          <DeliveryBar label={t('newsletters.label_pending')} value={delivery.pending} total={delivery.total_sent + delivery.pending} color="default" />
        </CardBody>
      </Card>

      {/* ── A/B Test Results (conditional) ── */}
      {ab_test && (
        <Card  className="mb-6 border-2 border-warning-200">
          <CardHeader className="flex flex-row items-center gap-3 px-5 pb-0 pt-5">
            <Chip size="sm" color="warning" variant="soft">{t('newsletters.ab_label')}</Chip>
            <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_ab_test_results')}</h3>
          </CardHeader>
          <CardBody className="space-y-5 px-5 pb-5">
            {/* Winner Announcement */}
            {ab_test.winner && (
              <div className="flex items-center gap-3 rounded-lg bg-success-50 p-4 dark:bg-success-50/10">
                <Trophy aria-hidden="true" size={24} className="text-success" />
                <div>
                  <p className="font-semibold text-success-700 dark:text-success">
                    {t('newsletters.winner_subject')}
                  </p>
                  <p className="text-sm text-success-600 dark:text-success-400">
                    &quot;{ab_test.winner === 'a' ? ab_test.subject_a : ab_test.subject_b}&quot;
                  </p>
                </div>
              </div>
            )}

            {/* Variant Comparison */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <AbVariantCard
                label={t('newsletters.label_subject_a')}
                subject={ab_test.subject_a}
                opens={ab_test.subject_a_opens}
                clicks={ab_test.subject_a_clicks}
                sent={ab_test.subject_a_sent}
                openRate={ab_test.subject_a_open_rate}
                clickRate={ab_test.subject_a_click_rate}
                isWinner={ab_test.winner === 'a'}
                isLeading={!ab_test.winner && ab_test.subject_a_opens > ab_test.subject_b_opens}
                chipColor="accent"
              />
              <AbVariantCard
                label={t('newsletters.label_subject_b')}
                subject={ab_test.subject_b}
                opens={ab_test.subject_b_opens}
                clicks={ab_test.subject_b_clicks}
                sent={ab_test.subject_b_sent}
                openRate={ab_test.subject_b_open_rate}
                clickRate={ab_test.subject_b_click_rate}
                isWinner={ab_test.winner === 'b'}
                isLeading={!ab_test.winner && ab_test.subject_b_opens > ab_test.subject_a_opens}
                chipColor="warning"
              />
            </div>

            {/* Split info + Select Winner Buttons */}
            <div className="flex flex-wrap items-center gap-3 border-t border-divider pt-4">
              <span className="text-sm text-muted">
                {t('newsletters.ab_split_info')}
                &bull; {t('newsletters.winning_metric')}: {ab_test.winner_metric === 'clicks' ? t('newsletters.label_click_rate') : t('newsletters.label_open_rate')}
                {ab_test.winning_margin > 0 && (
                  <> &bull; {t('newsletters.margin')}: {formatRate(ab_test.winning_margin)}</>
                )}
              </span>
              {!ab_test.winner && (
                <div className="ml-auto flex gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    isLoading={selectingWinner}
                    onPress={() => handleSelectWinner('a')}
                  >
                    {t('newsletters.select_a_as_winner')}
                  </Button>
                  <Button
                    size="sm"
                    color="warning"
                    variant="secondary"
                    isLoading={selectingWinner}
                    onPress={() => handleSelectWinner('b')}
                  >
                    {t('newsletters.select_b_as_winner')}
                  </Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Device Breakdown + Engagement Timeline side by side ── */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Device Breakdown */}
        {deviceTotal > 0 && (
          <Card  className="lg:col-span-1">
            <CardHeader className="flex flex-row items-center gap-2 px-5 pb-0 pt-5">
              <Monitor aria-hidden="true" size={18} className="text-muted" />
              <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_devices')}</h3>
            </CardHeader>
            <CardBody className="px-5 pb-5">
              <div className="mx-auto h-48 w-48">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <PieChart>
                    <Pie
                      data={deviceChartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={40}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {deviceChartData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value, name) => {
                        const v = Number(value ?? 0);
                        return [
                          `${v.toLocaleString(getFormattingLocale())} (${formatNumber(deviceTotal > 0 ? v / deviceTotal : 0, { style: 'percent', maximumFractionDigits: 0 })})`,
                          String(name ?? ''),
                        ] as [string, string];
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                {Object.entries(device_stats || {}).map(([device, count]) => {
                  if (count === 0) return null;
                  const Icon = DEVICE_ICONS[device] || HelpCircle;
                  const share = deviceTotal > 0 ? count / deviceTotal : 0;
                  return (
                    <div key={device} className="flex items-center gap-2 text-sm">
                      <Icon aria-hidden="true" size={14} style={{ '--device-color': DEVICE_COLORS[device], color: 'var(--device-color)' } as CSSProperties} />
                      <span className="capitalize text-foreground">{t(`newsletters.device_${device}`)}</span>
                      <span className="ml-auto font-semibold">{formatNumber(share, { style: 'percent', maximumFractionDigits: 0 })}</span>
                    </div>
                  );
                })}
              </div>
            </CardBody>
          </Card>
        )}

        {/* Engagement Timeline */}
        {timeline.length > 0 && (
          <Card  className={deviceTotal > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}>
            <CardHeader className="flex flex-row items-center gap-2 px-5 pb-0 pt-5">
              <Clock aria-hidden="true" size={18} className="text-muted" />
              <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_engagement_timeline')}</h3>
              <span className="ml-auto text-xs text-muted">{t('newsletters.first_48_hours')}</span>
            </CardHeader>
            <CardBody className="px-5 pb-5">
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={0}>
                  <LineChart data={timeline} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-default-200" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(h: number) => `${h}h`}
                      fontSize={12}
                      className="fill-default-500"
                    />
                    <YAxis fontSize={12} className="fill-default-500" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: CHART_TOKEN_COLORS.surface,
                        borderColor: CHART_TOKEN_COLORS.border,
                        borderRadius: '8px',
                        fontSize: '13px',
                      }}
                      labelFormatter={() => t('newsletters.hour_label')}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="opens"
                      name={t('newsletters.chart_opens')}
                      stroke={CHART_TOKEN_COLORS.primary}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="clicks"
                      name={t('newsletters.chart_clicks')}
                      stroke={CHART_TOKEN_COLORS.success}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <Separator className="my-3" />
              <p className="text-center text-sm text-muted">
                {t('newsletters.total_opens_label')}: {engagement.total_opens.toLocaleString(getFormattingLocale())} | {t('newsletters.total_clicks_label')}: {engagement.total_clicks.toLocaleString(getFormattingLocale())}
                {peak_engagement && peak_engagement.max_opens_per_hour > 0 && (
                  <> | {t('newsletters.peak_label')}</>
                )}
              </p>
            </CardBody>
          </Card>
        )}
      </div>

      {/* ── Email Client Breakdown ── */}
      {emailClients.length > 0 && (
        <Card  className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2 px-5 pb-0 pt-5">
            <Mail aria-hidden="true" size={18} className="text-muted" />
            <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_email_clients')}</h3>
          </CardHeader>
          <CardBody className="px-5 pb-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
              {emailClients.map((ec) => {
                const ecTotal = emailClients.reduce((s, c) => s + c.count, 0);
                const share = ecTotal > 0 ? ec.count / ecTotal : 0;
                return (
                  <div key={ec.client} className="text-center">
                    <p className="text-2xl font-bold text-foreground">{formatNumber(share, { style: 'percent', maximumFractionDigits: 0 })}</p>
                    <p className="text-sm text-muted">{ec.client}</p>
                    <p className="text-xs text-muted">{ec.count.toLocaleString(getFormattingLocale())} {t('newsletters.opens_label')}</p>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Top Links ── */}
      {top_links.length > 0 && (
        <Card  className="mb-6">
          <CardHeader className="flex flex-row items-center gap-2 px-5 pb-0 pt-5">
            <ExternalLink aria-hidden="true" size={18} className="text-muted" />
            <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_top_clicked_links')}</h3>
          </CardHeader>
          <CardBody className="px-5 pb-5">
            <Table
              aria-label={t('newsletters.section_top_clicked_links')}
              removeWrapper
              classNames={{ th: 'text-muted text-xs uppercase' }}
            >
              <TableHeader>
                <TableColumn>{t('newsletters.col_url')}</TableColumn>
                <TableColumn align="end">{t('newsletters.col_clicks')}</TableColumn>
                <TableColumn align="end">{t('newsletters.col_unique')}</TableColumn>
              </TableHeader>
              <TableBody>
                {top_links.map((link) => (
                  <TableRow key={link.url}>
                    <TableCell>
                      <a
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-sm text-accent hover:underline"
                      >
                        {link.url.length > 80 ? link.url.substring(0, 80) + '...' : link.url}
                      </a>
                    </TableCell>
                    <TableCell>
                      <span className="font-semibold">{link.clicks.toLocaleString(getFormattingLocale())}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted">{link.unique_clicks.toLocaleString(getFormattingLocale())}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* ── Recent Activity (inline) ── */}
      {recent_activity && recent_activity.length > 0 && (
        <Card  className="mb-6">
          <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-5">
            <div className="flex items-center gap-2">
              <BarChart3 aria-hidden="true" size={18} className="text-muted" />
              <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_recent_activity')}</h3>
            </div>
            {newsletter.status === 'sent' && (
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => navigate(tenantPath(`/admin/newsletters/${id}/activity`))}
              >
                {t('newsletters.view_all')}
              </Button>
            )}
          </CardHeader>
          <CardBody className="px-5 pb-5">
            <div className="max-h-80 overflow-y-auto">
              <Table
                aria-label={t('newsletters.section_recent_activity')}
                removeWrapper
                classNames={{ th: 'text-muted text-xs uppercase', td: 'py-2' }}
              >
                <TableHeader>
                  <TableColumn>{t('newsletters.col_event')}</TableColumn>
                  <TableColumn>{t('newsletters.col_email')}</TableColumn>
                  <TableColumn>{t('newsletters.col_time')}</TableColumn>
                </TableHeader>
                <TableBody>
                  {recent_activity.map((item) => (
                    <TableRow key={`${item.email}-${item.action_at}`}>
                      <TableCell>
                        <Chip
                          size="sm"
                          variant="soft"
                          color={item.action_type === 'open' ? 'primary' : 'success'}
                        >
                          {item.action_type === 'open' ? t('newsletters.action_opened') : t('newsletters.action_clicked')}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <div>
                          <span className="text-sm">{item.email}</span>
                          {item.action_type === 'click' && item.url && (
                            <div className="mt-0.5 max-w-xs truncate text-xs text-muted">
                              {item.url}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-muted">
                          {new Date(item.action_at).toLocaleString(getFormattingLocale(), {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ── Quick Actions ── */}
      <Card  className="mb-6">
        <CardHeader className="px-5 pb-0 pt-5">
          <h3 className="text-lg font-semibold text-foreground">{t('newsletters.section_actions')}</h3>
        </CardHeader>
        <CardBody className="px-5 pb-5">
          <div className="flex flex-wrap gap-3">
            <Button
              variant="secondary"
              startContent={<Copy aria-hidden="true" size={16} />}
              onPress={async () => {
                try {
                  const res = await adminNewsletters.duplicateNewsletter(Number(id));
                  if (res.success) {
                    toast.success(t('newsletters.newsletter_duplicated_as_draft'));
                    navigate(tenantPath('/admin/newsletters'));
                  } else {
                    toast.error(t('newsletters.failed_to_duplicate'));
                  }
                } catch {
                  toast.error(t('newsletters.failed_to_duplicate'));
                }
              }}
            >
              {t('newsletters.btn_duplicate_newsletter')}
            </Button>
            {newsletter.status === 'sent' && (
              <Button
                variant="secondary"
                startContent={<BarChart3 aria-hidden="true" size={16} />}
                onPress={() => navigate(tenantPath(`/admin/newsletters/${id}/activity`))}
              >
                {t('newsletters.btn_full_activity_log')}
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      {/* ── Resend Modal ── */}
      {resendOpen && (
        <NewsletterResend
          isOpen={resendOpen}
          onClose={() => setResendOpen(false)}
          newsletterId={Number(id)}
          onSuccess={() => { void loadStats(); }}
        />
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function FunnelBar({
  label,
  value,
  total,
  color,
  rate,
}: {
  label: string;
  value: number;
  total: number;
  color: 'default' | 'success';
  rate?: number;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-semibold text-foreground">
          {value.toLocaleString(getFormattingLocale())}
          {rate !== undefined && <span className="ml-1 text-muted">({formatRate(rate)})</span>}
        </span>
      </div>
      <Progress
        value={pct}
        color={color}
        size="md"
        aria-label={`${label}: ${value}`}
        className="h-3"
      />
    </div>
  );
}

function DeliveryBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: 'success' | 'danger' | 'warning' | 'default';
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="text-foreground">{label}</span>
        <span className="font-semibold text-foreground">{value.toLocaleString(getFormattingLocale())}</span>
      </div>
      <Progress
        value={pct}
        color={color}
        size="sm"
        aria-label={`${label}: ${value}`}
      />
    </div>
  );
}

function AbVariantCard({
  label,
  subject,
  opens,
  clicks,
  sent,
  openRate,
  clickRate,
  isWinner,
  isLeading,
  chipColor,
}: {
  label: string;
  subject: string;
  opens: number;
  clicks: number;
  sent: number;
  openRate: number;
  clickRate: number;
  isWinner: boolean;
  isLeading: boolean;
  chipColor: 'accent' | 'warning';
}) {
  const { t: tLocal } = useTranslation('admin_newsletters');
  return (
    <Card
      className={`border-2 ${isWinner ? 'border-success bg-success-50/50 dark:bg-success-50/5' : 'border-border'}`}
    >
      <CardBody className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <Chip size="sm" color={chipColor} variant="soft">{label}</Chip>
          {isWinner && (
            <div className="flex items-center gap-1 text-success">
              <Trophy aria-hidden="true" size={14} />
              <span className="text-xs font-semibold">{tLocal('newsletters.winner')}</span>
            </div>
          )}
          {isLeading && !isWinner && (
            <span className="text-xs font-medium text-success">{tLocal('newsletters.leading')}</span>
          )}
        </div>
        <p className="text-sm italic text-foreground">&quot;{subject}&quot;</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-bold text-accent">{formatRate(openRate)}</p>
            <p className="text-xs text-muted">{tLocal('newsletters.label_open_rate')}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-success">{formatRate(clickRate)}</p>
            <p className="text-xs text-muted">{tLocal('newsletters.label_click_rate')}</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{sent.toLocaleString(getFormattingLocale())}</p>
            <p className="text-xs text-muted">{tLocal('newsletters.col_sent')}</p>
          </div>
        </div>
        <div className="flex justify-center gap-4 border-t border-divider pt-2 text-xs text-muted">
          <span>{opens.toLocaleString(getFormattingLocale())} {tLocal('newsletters.opens_label')}</span>
          <span>{clicks.toLocaleString(getFormattingLocale())} {tLocal('newsletters.clicks_label')}</span>
        </div>
      </CardBody>
    </Card>
  );
}

export default NewsletterStats;
