import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Spinner, Button, Input, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Skeleton } from '@/components/ui';
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
} from 'recharts';
import Clock from 'lucide-react/icons/clock';
import TrendingUp from 'lucide-react/icons/trending-up';
import Heart from 'lucide-react/icons/heart';
import Users from 'lucide-react/icons/users';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Activity from 'lucide-react/icons/activity';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Settings from 'lucide-react/icons/settings';
import Sparkles from 'lucide-react/icons/sparkles';
import Lightbulb from 'lucide-react/icons/lightbulb';
import Calendar from 'lucide-react/icons/calendar';
import Award from 'lucide-react/icons/award';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { CHART_COLOR_MAP, CHART_TOKEN_COLORS } from '@/lib/chartColors';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Impact Report - Admin Module
 *
 * Unified SROI + community health + skills/events + impact summary view.
 * Merges the former "Social Value" page into a single Impact Report.
 *
 * Data sources (loaded in parallel):
 *  - GET /api/v2/admin/impact-report        → SROI, health, timeline (primary)
 *  - GET /api/v2/admin/reports/social-value → skills, events, impact summary, currency
 *
 * Config is currently stored in two backends (tenant JSON + social_value_config
 * table). The config modal writes to both endpoints to keep them in sync.
 */




// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SROIData {
  total_hours: number;
  total_transactions: number;
  unique_givers: number;
  unique_receivers: number;
  hourly_value: number;
  monetary_value: number;
  social_multiplier: number;
  social_value: number;
  sroi_ratio: number;
  period_months: number;
}

interface HealthData {
  total_users: number;
  active_users_90d: number;
  new_users_30d: number;
  active_traders_30d: number;
  engagement_rate: number;
  retention_rate: number;
  reciprocity_score: number;
  activation_rate: number;
  network_density: number;
  total_connections: number;
}

interface TimelineEntry {
  month: string;
  hours_exchanged: number;
  transactions: number;
  new_users: number;
}

interface ReportConfig {
  tenant_name: string;
  tenant_slug: string;
  logo_url: string | null;
  hourly_value: number;
  social_multiplier: number;
}

interface ImpactReportData {
  sroi: SROIData;
  health: HealthData;
  timeline: TimelineEntry[];
  config: ReportConfig;
}

interface SroiOutcome {
  id?: number;
  name: string;
  quantity: number;
  proxy_value: number;
  proxy_source?: string | null;
}

interface SroiProjection {
  gross_value: number;
  year_one_net: number;
  yearly: Array<{ year: number; retained: number; present_value: number }>;
  total_present_value: number;
  investment_amount: number | null;
  sroi_ratio: number | null;
  is_configured: boolean;
  coefficients: {
    deadweight_pct: number;
    displacement_pct: number;
    attribution_pct: number;
    dropoff_pct: number;
    discount_rate_pct: number;
    projection_years: number;
  };
}

interface SocialValueExtras {
  period?: { from: string; to: string };
  config: {
    currency: string;
    hour_value: number;
    social_multiplier: number;
    reporting_period: string;
    investment_amount: number | null;
    deadweight_pct: number;
    displacement_pct: number;
    attribution_pct: number;
    dropoff_pct: number;
    discount_rate_pct: number;
    projection_years: number;
  };
  sroi?: SroiProjection;
  outcomes?: SroiOutcome[];
  members?: {
    total_registered: number;
    active_traders: number;
    participation_rate: number;
    new_members: number;
    logged_in: number;
  };
  skills?: {
    unique_categories: number;
    total_listings: number;
    unique_skills: number;
    skills_offered: number;
    skills_requested: number;
  };
  events?: {
    total_events: number;
    unique_organizers: number;
    total_attendees: number;
  };
  summary?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PERIOD_OPTIONS = [
  { key: '3', labelKey: 'impact.period_3_months' },
  { key: '6', labelKey: 'impact.period_6_months' },
  { key: '12', labelKey: 'impact.period_12_months' },
  { key: '24', labelKey: 'impact.period_24_months' },
  { key: '36', labelKey: 'impact.period_36_months' },
];

const CURRENCY_OPTIONS = [
  { key: 'GBP', labelKey: 'impact.currency_gbp' },
  { key: 'EUR', labelKey: 'impact.currency_eur' },
  { key: 'USD', labelKey: 'impact.currency_usd' },
];

const REPORTING_PERIOD_OPTIONS = [
  { key: 'monthly', labelKey: 'impact.reporting_monthly' },
  { key: 'quarterly', labelKey: 'impact.reporting_quarterly' },
  { key: 'annually', labelKey: 'impact.reporting_annually' },
];

const tooltipStyle = {
  borderRadius: '8px',
  border: `1px solid ${CHART_TOKEN_COLORS.border}`,
  backgroundColor: CHART_TOKEN_COLORS.surface,
  color: CHART_TOKEN_COLORS.foreground,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number | null | undefined, currency: string): string {
  if (value == null) return '—';
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat(getFormattingLocale(), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
}

function formatPercent(rate: number): string {
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rate);
}

function getCurrencySymbol(currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0).find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

function formatMonth(monthStr: string): string {
  const [year, month] = monthStr.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString(getFormattingLocale(), { month: 'short', year: '2-digit' });
}

async function exportCsv(dateFrom?: string, dateTo?: string) {
  const params = new URLSearchParams({ format: 'csv' });
  if (dateFrom) params.append('date_from', dateFrom);
  if (dateTo) params.append('date_to', dateTo);

  // api.download renews an expired sign-in and retries; a hand-rolled fetch
  // failed once the short-lived access token expired.
  await api.download(`/v2/admin/reports/social_value/export?${params}`, { filename: 'impact-report.csv' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ImpactReport() {
  const { t } = useTranslation('admin_impact');
  usePageTitle(t('impact.page_title'));
  const toast = useToast();

  const [data, setData] = useState<ImpactReportData | null>(null);
  const [extras, setExtras] = useState<SocialValueExtras | null>(null);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(12);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [saving, setSaving] = useState(false);
  const { isOpen: configOpen, onOpen: openConfig, onClose: closeConfig } = useDisclosure();

  // Config form state
  const [configCurrency, setConfigCurrency] = useState('GBP');
  const [configHourValue, setConfigHourValue] = useState('15.00');
  const [configMultiplier, setConfigMultiplier] = useState('3.5');
  const [configPeriod, setConfigPeriod] = useState('annually');

  // Methodology SROI config state (Social Value International model)
  const [configInvestment, setConfigInvestment] = useState('');
  const [configDeadweight, setConfigDeadweight] = useState('10');
  const [configDisplacement, setConfigDisplacement] = useState('10');
  const [configAttribution, setConfigAttribution] = useState('10');
  const [configDropoff, setConfigDropoff] = useState('70');
  const [configDiscount, setConfigDiscount] = useState('3.5');
  const [configYears, setConfigYears] = useState('2');
  const [configOutcomes, setConfigOutcomes] = useState<SroiOutcome[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const svParams = new URLSearchParams();
      if (dateFrom) svParams.append('date_from', dateFrom);
      if (dateTo) svParams.append('date_to', dateTo);
      const svQs = svParams.toString();

      const [impactRes, svRes] = await Promise.all([
        api.get(`/v2/admin/impact-report?months=${months}`),
        api.get(`/v2/admin/reports/social-value${svQs ? `?${svQs}` : ''}`),
      ]);

      if (impactRes.data) {
        const reportData = impactRes.data as ImpactReportData;
        setData(reportData);
      }

      if (svRes.data) {
        // The API returns config keys as hour_value_currency/hour_value_amount,
        // and summary as a stats object (not a string). Normalise to SocialValueExtras shape.
        const raw = svRes.data as Record<string, unknown>;
        const rawConfig = (raw.config ?? {}) as Record<string, unknown>;
        const rawSummary = (raw.summary ?? {}) as Record<string, unknown>;

        const sv: SocialValueExtras = {
          config: {
            currency: (rawConfig.hour_value_currency as string) ?? 'GBP',
            hour_value: (rawConfig.hour_value_amount as number) ?? 15,
            social_multiplier: (rawConfig.social_multiplier as number) ?? 3.5,
            reporting_period: (rawConfig.reporting_period as string) ?? 'annually',
            investment_amount: (rawConfig.investment_amount as number | null) ?? null,
            deadweight_pct: (rawConfig.deadweight_pct as number) ?? 10,
            displacement_pct: (rawConfig.displacement_pct as number) ?? 10,
            attribution_pct: (rawConfig.attribution_pct as number) ?? 10,
            dropoff_pct: (rawConfig.dropoff_pct as number) ?? 70,
            discount_rate_pct: (rawConfig.discount_rate_pct as number) ?? 3.5,
            projection_years: (rawConfig.projection_years as number) ?? 2,
          },
          sroi: (raw.sroi as SroiProjection | undefined) ?? undefined,
          outcomes: (raw.outcomes as SroiOutcome[] | undefined) ?? undefined,
          members: rawSummary.active_members != null ? {
            total_registered: 0,
            active_traders: rawSummary.active_members as number,
            participation_rate: 0,
            new_members: 0,
            logged_in: 0,
          } : undefined,
          events: rawSummary.total_events != null ? {
            total_events: rawSummary.total_events as number,
            unique_organizers: 0,
            total_attendees: 0,
          } : undefined,
          // summary string (AI-generated) is not provided by this endpoint
          summary: undefined,
        };

        setExtras(sv);
        setConfigCurrency(sv.config.currency);
        setConfigHourValue(String(sv.config.hour_value));
        setConfigMultiplier(String(sv.config.social_multiplier));
        setConfigPeriod(sv.config.reporting_period);
        setConfigInvestment(sv.config.investment_amount != null ? String(sv.config.investment_amount) : '');
        setConfigDeadweight(String(sv.config.deadweight_pct));
        setConfigDisplacement(String(sv.config.displacement_pct));
        setConfigAttribution(String(sv.config.attribution_pct));
        setConfigDropoff(String(sv.config.dropoff_pct));
        setConfigDiscount(String(sv.config.discount_rate_pct));
        setConfigYears(String(sv.config.projection_years));
        setConfigOutcomes(sv.outcomes ?? []);
      }
    } catch {
      // Silently handle — cards will show empty state
    } finally {
      setLoading(false);
    }
  }, [months, dateFrom, dateTo]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const hourValue = parseFloat(configHourValue) || 15;
      const multiplier = parseFloat(configMultiplier) || 3.5;

      // Write to both backends so Impact Report and Social Value stay in sync.
      await Promise.all([
        api.put('/v2/admin/impact-report/config', {
          hourly_value: hourValue,
          social_multiplier: multiplier,
        }),
        api.put('/v2/admin/reports/social-value/config', {
          hour_value_currency: configCurrency,
          hour_value_amount: hourValue,
          social_multiplier: multiplier,
          reporting_period: configPeriod,
          investment_amount: configInvestment.trim() === '' ? null : parseFloat(configInvestment),
          deadweight_pct: parseFloat(configDeadweight) || 0,
          displacement_pct: parseFloat(configDisplacement) || 0,
          attribution_pct: parseFloat(configAttribution) || 0,
          dropoff_pct: parseFloat(configDropoff) || 0,
          discount_rate_pct: parseFloat(configDiscount) || 0,
          projection_years: parseInt(configYears, 10) || 2,
          outcomes: configOutcomes
            .filter((o) => o.name.trim() !== '')
            .map((o) => ({
              name: o.name.trim(),
              quantity: Math.max(0, Math.round(Number(o.quantity) || 0)),
              proxy_value: Math.max(0, Number(o.proxy_value) || 0),
              proxy_source: o.proxy_source || null,
            })),
        }),
      ]);
      closeConfig();
      await loadData();
    } catch {
      toast.error(t('impact.failed_to_save_configuration'));
    } finally {
      setSaving(false);
    }
  };

  const currency = extras?.config.currency || 'GBP';

  // -------------------------------------------------------------------------
  // PDF export
  // -------------------------------------------------------------------------

  const exportPdf = async () => {
    if (!data) return;

    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);

    const doc = new jsPDF();

    doc.setFontSize(22);
    doc.setTextColor(99, 102, 241);
    doc.text(t('impact.pdf_title', { tenant: data.config.tenant_name }), 20, 25);

    doc.setFontSize(11);
    doc.setTextColor(100, 100, 100);
    doc.text(
      t('impact.pdf_period_generated', {
        months: data.sroi.period_months,
        date: new Date().toLocaleDateString(getFormattingLocale()),
      }),
      20,
      33,
    );

    doc.setFontSize(14);
    doc.setTextColor(30, 30, 30);
    doc.text(t('impact.pdf_sroi_heading'), 20, 48);

    const sroiBody: Array<[string, string]> = [
      [t('impact.pdf_total_hours_exchanged'), data.sroi.total_hours.toFixed(1)],
      [t('impact.pdf_total_transactions'), String(data.sroi.total_transactions)],
      [t('impact.pdf_unique_givers'), String(data.sroi.unique_givers)],
      [t('impact.pdf_unique_receivers'), String(data.sroi.unique_receivers)],
      [t('impact.label_monetary_value'), formatCurrency(data.sroi.monetary_value, currency)],
      [t('impact.label_social_value'), formatCurrency(data.sroi.social_value, currency)],
      [t('impact.label_value_multiplier'), `×${data.sroi.social_multiplier}`],
    ];

    if (extras?.sroi?.is_configured) {
      sroiBody.push(
        [t('impact.label_gross_social_value'), formatCurrency(extras.sroi.gross_value, currency)],
        [t('impact.label_total_present_value'), formatCurrency(extras.sroi.total_present_value, currency)],
        [t('impact.label_investment'), formatCurrency(extras.sroi.investment_amount, currency)],
        [t('impact.label_sroi_ratio'), `${extras.sroi.sroi_ratio?.toFixed(2)}:1`],
        [
          t('impact.pdf_coefficients'),
          t('impact.coefficients_line', {
            deadweight: extras.sroi.coefficients.deadweight_pct,
            displacement: extras.sroi.coefficients.displacement_pct,
            attribution: extras.sroi.coefficients.attribution_pct,
            dropoff: extras.sroi.coefficients.dropoff_pct,
            discount: extras.sroi.coefficients.discount_rate_pct,
            years: extras.sroi.coefficients.projection_years,
          }),
        ],
      );
    }

    autoTable(doc, {
      startY: 52,
      head: [[t('impact.pdf_metric'), t('impact.pdf_value')]],
      body: sroiBody,
      theme: 'striped',
      headStyles: { fillColor: [99, 102, 241] },
    });

    const sroiTableEnd =
      (doc as unknown as Record<string, { finalY?: number }>).lastAutoTable?.finalY ?? 120;
    doc.setFontSize(14);
    doc.text(t('impact.pdf_community_health_metrics'), 20, sroiTableEnd + 15);

    autoTable(doc, {
      startY: sroiTableEnd + 19,
      head: [[t('impact.pdf_metric'), t('impact.pdf_value')]],
      body: [
        [t('impact.label_engagement_rate'), formatPercent(data.health.engagement_rate)],
        [t('impact.label_reciprocity_score'), data.health.reciprocity_score.toFixed(2)],
        [t('impact.pdf_retention_rate_90d'), formatPercent(data.health.retention_rate)],
        [t('impact.pdf_new_member_activation'), formatPercent(data.health.activation_rate)],
        [t('impact.label_network_density'), data.health.network_density.toFixed(4)],
        [t('impact.pdf_total_connections'), String(data.health.total_connections)],
      ],
      theme: 'striped',
      headStyles: { fillColor: [16, 185, 129] },
    });

    if (data.timeline.length > 0) {
      const healthTableEnd =
        (doc as unknown as Record<string, { finalY?: number }>).lastAutoTable?.finalY ?? 200;
      const needNewPage = healthTableEnd > 240;
      if (needNewPage) doc.addPage();
      const timelineY = needNewPage ? 20 : healthTableEnd + 15;

      doc.setFontSize(14);
      doc.text(t('impact.pdf_monthly_impact_timeline'), 20, timelineY);

      autoTable(doc, {
        startY: timelineY + 4,
        head: [[t('impact.pdf_month'), t('impact.chart_hours_name'), t('impact.chart_transactions_name'), t('impact.chart_new_users_name')]],
        body: data.timeline.map((r) => [
          r.month,
          r.hours_exchanged.toFixed(1),
          String(r.transactions),
          String(r.new_users),
        ]),
        theme: 'striped',
        headStyles: { fillColor: [245, 158, 11] },
      });
    }

    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text(t('impact.pdf_generated_by'), 20, 285);
      doc.text(t('impact.pdf_page_count', { page: i, pages: pageCount }), 170, 285);
    }

    doc.save(`${data.config.tenant_name.replace(/\s+/g, '_')}_Impact_Report.pdf`);
  };

  // -------------------------------------------------------------------------
  // Chart data
  // -------------------------------------------------------------------------

  const chartData = (data?.timeline ?? []).map((entry) => ({
    ...entry,
    label: formatMonth(entry.month),
  }));

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <PageHeader
        title={t('impact.impact_report_title')}
        description={t('impact.impact_report_desc')}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              size="sm"
              selectedKeys={[String(months)]}
              onSelectionChange={(keys) => {
                const value = Array.from(keys)[0];
                if (value) setMonths(Number(value));
              }}
              className="w-36"
              aria-label={t('impact.label_report_period')}
            >
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{t(opt.labelKey)}</SelectItem>
              ))}
            </Select>
            <Input
              type="date"
              size="sm"
              value={dateFrom}
              onValueChange={setDateFrom}
              aria-label={t('impact.label_from_date')}
              className="w-36"
              variant="secondary"
            />
            <Input
              type="date"
              size="sm"
              value={dateTo}
              onValueChange={setDateTo}
              aria-label={t('impact.label_to_date')}
              className="w-36"
              variant="secondary"
            />
            <Button
              variant="secondary"
              startContent={<Settings size={16} />}
              onPress={openConfig}
              size="sm"
            >
              {t('impact.btn_configure')}
            </Button>
            <Button
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={exportPdf}
              isDisabled={!data || loading}
              size="sm"
            >
              {t('impact.btn_export_pdf')}
            </Button>
            <Button
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={async () => {
                try { await exportCsv(dateFrom, dateTo); } catch { toast.error(t('impact.failed_to_export_csv')); }
              }}
              size="sm"
            >
              {t('impact.btn_export_csv')}
            </Button>
            <Button
              variant="secondary"
              startContent={<RefreshCw size={16} />}
              onPress={loadData}
              isLoading={loading}
              size="sm"
            >
              {t('impact.btn_refresh')}
            </Button>
          </div>
        }
      />

      {/* Methodology SROI (Social Value International model) ------------ */}

      <div className="mb-2">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Award size={20} className="text-success" aria-hidden="true" />
          {t('impact.section_true_sroi')}
        </h2>
        <p className="text-sm text-muted mt-0.5">
          {t('impact.desc_true_sroi')}
        </p>
      </div>

      {extras?.sroi?.is_configured ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-2">
            <StatCard
              label={t('impact.label_sroi_ratio')}
              value={`${extras.sroi.sroi_ratio?.toFixed(2)}:1`}
              icon={Award}
              color="success"
              loading={loading}
            />
            <StatCard
              label={t('impact.label_total_present_value')}
              value={formatCurrency(extras.sroi.total_present_value, currency)}
              icon={Sparkles}
              loading={loading}
            />
            <StatCard
              label={t('impact.label_investment')}
              value={formatCurrency(extras.sroi.investment_amount, currency)}
              icon={TrendingUp}
              color="warning"
              loading={loading}
            />
            <StatCard
              label={t('impact.label_gross_social_value')}
              value={formatCurrency(extras.sroi.gross_value, currency)}
              icon={Heart}
              color="danger"
              loading={loading}
            />
          </div>
          <p className="text-xs text-muted mb-6">
            {t('impact.coefficients_line', {
              deadweight: extras.sroi.coefficients.deadweight_pct,
              displacement: extras.sroi.coefficients.displacement_pct,
              attribution: extras.sroi.coefficients.attribution_pct,
              dropoff: extras.sroi.coefficients.dropoff_pct,
              discount: extras.sroi.coefficients.discount_rate_pct,
              years: extras.sroi.coefficients.projection_years,
            })}
          </p>
        </>
      ) : (
        <Card className="mb-6">
          <CardBody className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-foreground">{t('impact.sroi_not_configured_title')}</p>
              <p className="text-sm text-muted mt-1">{t('impact.sroi_not_configured_desc')}</p>
            </div>
            <Button variant="secondary" size="sm" startContent={<Settings size={16} />} onPress={openConfig}>
              {t('impact.btn_configure')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Exchange Activity Value Section --------------------------------- */}

      <div className="mb-2">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Sparkles size={20} className="text-accent" aria-hidden="true" />
          {t('impact.section_sroi')}
        </h2>
        <p className="text-sm text-muted mt-0.5">
          {t('impact.period_description')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label={t('impact.label_total_hours')}
          value={data ? data.sroi.total_hours.toFixed(1) : '\u2014'}
          icon={Clock}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('impact.label_monetary_value')}
          value={data ? formatCurrency(data.sroi.monetary_value, currency) : '\u2014'}
          icon={TrendingUp}
          loading={loading}
        />
        <StatCard
          label={t('impact.label_social_value')}
          value={data ? formatCurrency(data.sroi.social_value, currency) : '\u2014'}
          icon={Sparkles}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('impact.label_value_multiplier')}
          value={data ? `\u00d7${data.sroi.social_multiplier}` : '\u2014'}
          icon={TrendingUp}
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-8">
        <Card>
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10">
              <ArrowLeftRight size={20} className="text-accent" />
            </div>
            <div>
              <p className="text-sm text-muted">{t('impact.chart_transactions_name')}</p>
              {loading ? (
                <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-6 w-16 rounded bg-surface-tertiary" />
              ) : (
                <p className="text-xl font-bold text-foreground">
                  {data?.sroi.total_transactions.toLocaleString(getFormattingLocale()) ?? '\u2014'}
                </p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-success/10">
              <Users size={20} className="text-success" />
            </div>
            <div>
              <p className="text-sm text-muted">{t('impact.pdf_unique_givers')}</p>
              {loading ? (
                <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-6 w-16 rounded bg-surface-tertiary" />
              ) : (
                <p className="text-xl font-bold text-foreground">
                  {data?.sroi.unique_givers.toLocaleString(getFormattingLocale()) ?? '\u2014'}
                </p>
              )}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex flex-row items-center gap-4 p-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-warning/10">
              <Users size={20} className="text-warning" />
            </div>
            <div>
              <p className="text-sm text-muted">{t('impact.pdf_unique_receivers')}</p>
              {loading ? (
                <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-6 w-16 rounded bg-surface-tertiary" />
              ) : (
                <p className="text-xl font-bold text-foreground">
                  {data?.sroi.unique_receivers.toLocaleString(getFormattingLocale()) ?? '\u2014'}
                </p>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Skills & Events Section --------------------------------------- */}

      {(extras?.skills || extras?.events || extras?.members) && (
        <>
          <Separator className="mb-6" />
          <div className="mb-2">
            <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Lightbulb size={20} className="text-warning" aria-hidden="true" />
              {t('impact.section_skills_events')}
            </h2>
            <p className="text-sm text-muted mt-0.5">
              {t('impact.desc_skills_events')}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 mb-6">
            <StatCard
              label={t('impact.label_active_members')}
              value={extras.members?.active_traders ?? '\u2014'}
              icon={Users}
              loading={loading}
            />
            <StatCard
              label={t('impact.label_skills_shared')}
              value={extras.skills?.unique_skills ?? '\u2014'}
              icon={Lightbulb}
              color="warning"
              loading={loading}
            />
            <StatCard
              label={t('impact.label_events_held')}
              value={extras.events?.total_events ?? '\u2014'}
              icon={Calendar}
              color="success"
              loading={loading}
            />
            <StatCard
              label={t('impact.label_unique_categories')}
              value={extras.skills?.unique_categories ?? '\u2014'}
              icon={Award}
              color="danger"
              loading={loading}
            />
            <StatCard
              label={t('impact.label_active_listings_stat')}
              value={extras.skills?.total_listings ?? '\u2014'}
              icon={Sparkles}
              color="warning"
              loading={loading}
            />
          </div>

          {extras.skills && (
            <Card  className="mb-8">
              <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
                <Lightbulb size={18} className="text-warning" aria-hidden="true" />
                <h3 className="font-semibold">{t('impact.section_skills_overview')}</h3>
              </CardHeader>
              <CardBody className="px-4 pb-4">
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div className="p-4 rounded-lg bg-surface">
                    <p className="text-xs text-muted mb-1">{t('impact.label_skills_offered')}</p>
                    <p className="text-2xl font-bold text-accent">{extras.skills.skills_offered ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-surface">
                    <p className="text-xs text-muted mb-1">{t('impact.label_skills_requested')}</p>
                    <p className="text-2xl font-bold text-accent">{extras.skills.skills_requested ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-surface">
                    <p className="text-xs text-muted mb-1">{t('impact.label_unique_skills')}</p>
                    <p className="text-2xl font-bold text-success">{extras.skills.unique_skills ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-lg bg-surface">
                    <p className="text-xs text-muted mb-1">{t('impact.label_active_listings')}</p>
                    <p className="text-2xl font-bold text-warning">{extras.skills.total_listings ?? 0}</p>
                  </div>
                </div>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* Community Health Section -------------------------------------- */}

      <Separator className="mb-6" />

      <div className="mb-2">
        <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
          <Activity size={20} className="text-success" aria-hidden="true" />
          {t('impact.section_community_health')}
        </h2>
        <p className="text-sm text-muted mt-0.5">
          {t('impact.section_community_health_desc')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <StatCard
          label={t('impact.label_engagement_rate')}
          value={data ? formatPercent(data.health.engagement_rate) : '\u2014'}
          icon={Users}
          loading={loading}
        />
        <StatCard
          label={t('impact.label_reciprocity_score')}
          value={data ? data.health.reciprocity_score.toFixed(2) : '\u2014'}
          icon={ArrowLeftRight}
          loading={loading}
        />
        <StatCard
          label={t('impact.label_retention_rate')}
          value={data ? formatPercent(data.health.retention_rate) : '\u2014'}
          icon={Heart}
          color="danger"
          loading={loading}
        />
        <StatCard
          label={t('impact.label_activation_rate')}
          value={data ? formatPercent(data.health.activation_rate) : '\u2014'}
          icon={TrendingUp}
          color="success"
          loading={loading}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        <Card>
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('impact.label_total_members')}</p>
            {loading ? (
              <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-tertiary" />
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {data?.health.total_users.toLocaleString(getFormattingLocale()) ?? '\u2014'}
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('impact.label_active_90d')}</p>
            {loading ? (
              <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-tertiary" />
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {data?.health.active_users_90d.toLocaleString(getFormattingLocale()) ?? '\u2014'}
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('impact.label_new_30d')}</p>
            {loading ? (
              <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-tertiary" />
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {data?.health.new_users_30d.toLocaleString(getFormattingLocale()) ?? '\u2014'}
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('impact.label_network_density')}</p>
            {loading ? (
              <Skeleton role="status" aria-busy="true" aria-label={t('common.loading')} className="mt-1 h-7 w-20 rounded bg-surface-tertiary" />
            ) : (
              <p className="text-2xl font-bold text-foreground">
                {data?.health.network_density.toFixed(4) ?? '\u2014'}
              </p>
            )}
            <p className="text-xs text-muted mt-1">
              {data?.health.total_connections.toLocaleString(getFormattingLocale()) ?? 0} {t('impact.unit_connections')}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Impact Timeline ----------------------------------------------- */}

      <Separator className="mb-6" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 mb-8">
        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Clock size={18} className="text-accent" aria-hidden="true" />
            <h3 className="font-semibold">{t('impact.chart_hours_exchanged_title')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div className="flex h-[300px] items-center justify-center" role="status" aria-busy="true" aria-label={t('common.loading')}>
                <Spinner />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="hoursGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLOR_MAP.primary} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLOR_MAP.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} />
                  <Area
                    type="monotone"
                    dataKey="hours_exchanged"
                    name={t('impact.chart_hours_name')}
                    stroke={CHART_COLOR_MAP.primary}
                    fill="url(#hoursGradient)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-[300px] items-center justify-center text-sm text-muted">
                {t('impact.empty_timeline')}
              </p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Activity size={18} className="text-success" aria-hidden="true" />
            <h3 className="font-semibold">{t('impact.chart_activity_breakdown_title')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            {loading ? (
              <div className="flex h-[300px] items-center justify-center" role="status" aria-busy="true" aria-label={t('common.loading')}>
                <Spinner />
              </div>
            ) : chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} />
                  <YAxis tick={{ fontSize: 12 }} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} labelStyle={{ fontWeight: 600 }} />
                  <Legend />
                  <Bar dataKey="transactions" name={t('impact.chart_transactions_name')} fill={CHART_COLOR_MAP.primary} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="new_users" name={t('impact.chart_new_users_name')} fill={CHART_COLOR_MAP.success} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-[300px] items-center justify-center text-sm text-muted">
                {t('impact.empty_activity')}
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Impact Summary ------------------------------------------------ */}

      {extras?.summary && (
        <Card  className="mb-8">
          <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
            <Sparkles size={18} className="text-success" aria-hidden="true" />
            <h3 className="font-semibold">{t('impact.section_impact_summary')}</h3>
          </CardHeader>
          <CardBody className="px-4 pb-4">
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-line">
              {extras.summary}
            </p>
            <Separator className="my-4" />
            <div className="text-xs text-muted space-y-1">
              <p>
                <strong>{t('impact.label_hour_value')}:</strong> {formatCurrency(extras.config.hour_value, currency)}/{t('impact.unit_hour_short')}
              </p>
              <p>
                <strong>{t('impact.label_social_multiplier')}:</strong>{' '}
                {t('impact.multiplier_value', { value: extras.config.social_multiplier })}
              </p>
              <p>
                <strong>{t('impact.label_formula')}:</strong> {t('impact.formula_simple')}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Configuration Modal ------------------------------------------- */}

      <Modal isOpen={configOpen} onClose={closeConfig} size="lg">
        <ModalContent>
          <ModalHeader>{t('impact.modal_sroi_config_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted mb-4">
              {t('impact.desc_sroi_config')}
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select
                label={t('impact.label_currency')}
                selectedKeys={[configCurrency]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0];
                  if (v) setConfigCurrency(String(v));
                }}
                variant="secondary"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} id={opt.key}>{t(opt.labelKey)}</SelectItem>
                ))}
              </Select>
              <Input
                label={t('impact.label_hour_value')}
                type="number"
                min={0.01}
                max={10000}
                step={0.5}
                value={configHourValue}
                onValueChange={setConfigHourValue}
                variant="secondary"
                startContent={
                  <span className="text-muted text-sm">
                    {getCurrencySymbol(configCurrency)}
                  </span>
                }
                description={t('impact.desc_hour_value')}
              />
              <Input
                label={t('impact.label_social_multiplier')}
                type="number"
                min={0.1}
                max={100}
                step={0.1}
                value={configMultiplier}
                onValueChange={setConfigMultiplier}
                variant="secondary"
                startContent={<span className="text-muted text-sm">×</span>}
              />
              <Select
                label={t('impact.label_reporting_period')}
                selectedKeys={[configPeriod]}
                onSelectionChange={(keys) => {
                  const v = Array.from(keys)[0];
                  if (v) setConfigPeriod(String(v));
                }}
                variant="secondary"
              >
                {REPORTING_PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} id={opt.key}>{t(opt.labelKey)}</SelectItem>
                ))}
              </Select>
            </div>

            <Separator className="my-4" />

            {/* Methodology SROI parameters ------------------------------- */}
            <h4 className="font-semibold text-sm mb-1">{t('impact.section_true_sroi')}</h4>
            <p className="text-xs text-muted mb-3">{t('impact.desc_sroi_methodology')}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('impact.label_investment')}
                type="number"
                min={0}
                step={100}
                value={configInvestment}
                onValueChange={setConfigInvestment}
                variant="secondary"
                startContent={
                  <span className="text-muted text-sm">
                    {getCurrencySymbol(configCurrency)}
                  </span>
                }
                description={t('impact.desc_investment')}
              />
              <Input
                label={t('impact.label_projection_years')}
                type="number"
                min={1}
                max={10}
                step={1}
                value={configYears}
                onValueChange={setConfigYears}
                variant="secondary"
              />
              <Input
                label={t('impact.label_deadweight')}
                type="number"
                min={0}
                max={100}
                step={1}
                value={configDeadweight}
                onValueChange={setConfigDeadweight}
                variant="secondary"
                endContent={<span className="text-muted text-sm">%</span>}
                description={t('impact.desc_deadweight')}
              />
              <Input
                label={t('impact.label_displacement')}
                type="number"
                min={0}
                max={100}
                step={1}
                value={configDisplacement}
                onValueChange={setConfigDisplacement}
                variant="secondary"
                endContent={<span className="text-muted text-sm">%</span>}
                description={t('impact.desc_displacement')}
              />
              <Input
                label={t('impact.label_attribution')}
                type="number"
                min={0}
                max={100}
                step={1}
                value={configAttribution}
                onValueChange={setConfigAttribution}
                variant="secondary"
                endContent={<span className="text-muted text-sm">%</span>}
                description={t('impact.desc_attribution')}
              />
              <Input
                label={t('impact.label_dropoff')}
                type="number"
                min={0}
                max={100}
                step={1}
                value={configDropoff}
                onValueChange={setConfigDropoff}
                variant="secondary"
                endContent={<span className="text-muted text-sm">%</span>}
                description={t('impact.desc_dropoff')}
              />
              <Input
                label={t('impact.label_discount_rate')}
                type="number"
                min={0}
                max={20}
                step={0.1}
                value={configDiscount}
                onValueChange={setConfigDiscount}
                variant="secondary"
                endContent={<span className="text-muted text-sm">%</span>}
                description={t('impact.desc_discount_rate')}
              />
            </div>

            <Separator className="my-4" />

            {/* Outcome categories ---------------------------------------- */}
            <div className="flex items-center justify-between mb-1">
              <h4 className="font-semibold text-sm">{t('impact.section_outcomes')}</h4>
              <div className="flex gap-2">
                {configOutcomes.length === 0 && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => setConfigOutcomes([
                      { name: t('impact.tbi_outcome_socialisation'), quantity: 0, proxy_value: 3432, proxy_source: t('impact.tbi_proxy_socialisation') },
                      { name: t('impact.tbi_outcome_health'), quantity: 0, proxy_value: 600, proxy_source: t('impact.tbi_proxy_health') },
                      { name: t('impact.tbi_outcome_independence'), quantity: 0, proxy_value: 640, proxy_source: t('impact.tbi_proxy_independence') },
                      { name: t('impact.tbi_outcome_inclusion'), quantity: 0, proxy_value: 4353, proxy_source: t('impact.tbi_proxy_inclusion') },
                    ])}
                  >
                    {t('impact.btn_load_template')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  startContent={<Plus size={14} />}
                  isDisabled={configOutcomes.length >= 25}
                  onPress={() => setConfigOutcomes((prev) => [...prev, { name: '', quantity: 0, proxy_value: 0 }])}
                >
                  {t('impact.btn_add_outcome')}
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted mb-3">{t('impact.desc_outcomes')}</p>
            {configOutcomes.length === 0 ? (
              <p className="text-sm text-muted mb-2">{t('impact.empty_outcomes')}</p>
            ) : (
              <div className="space-y-2">
                {configOutcomes.map((outcome, idx) => (
                  <div key={idx} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Input
                      label={idx === 0 ? t('impact.label_outcome_name') : undefined}
                      aria-label={t('impact.label_outcome_name')}
                      size="sm"
                      value={outcome.name}
                      onValueChange={(v) => setConfigOutcomes((prev) => prev.map((o, i) => (i === idx ? { ...o, name: v } : o)))}
                      variant="secondary"
                      className="flex-1"
                    />
                    <Input
                      label={idx === 0 ? t('impact.label_outcome_quantity') : undefined}
                      aria-label={t('impact.label_outcome_quantity')}
                      size="sm"
                      type="number"
                      min={0}
                      step={1}
                      value={String(outcome.quantity)}
                      onValueChange={(v) => setConfigOutcomes((prev) => prev.map((o, i) => (i === idx ? { ...o, quantity: Number(v) || 0 } : o)))}
                      variant="secondary"
                      className="w-full sm:w-28"
                    />
                    <Input
                      label={idx === 0 ? t('impact.label_outcome_proxy') : undefined}
                      aria-label={t('impact.label_outcome_proxy')}
                      size="sm"
                      type="number"
                      min={0}
                      step={1}
                      value={String(outcome.proxy_value)}
                      onValueChange={(v) => setConfigOutcomes((prev) => prev.map((o, i) => (i === idx ? { ...o, proxy_value: Number(v) || 0 } : o)))}
                      variant="secondary"
                      className="w-full sm:w-32"
                      startContent={
                        <span className="text-muted text-xs">
                          {getCurrencySymbol(configCurrency)}
                        </span>
                      }
                    />
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label={t('impact.btn_remove_outcome')}
                      onPress={() => setConfigOutcomes((prev) => prev.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            <Separator className="my-4" />
            <div className="text-xs text-muted space-y-1">
              <p>
                <strong>{t('impact.label_sroi_formula')}:</strong> {t('impact.formula_detailed', {
                  currency: getCurrencySymbol(configCurrency),
                  hourValue: configHourValue,
                  multiplier: configMultiplier,
                })}
              </p>
              <p>
                <strong>{t('impact.label_value_multiplier')}:</strong> {t('impact.formula_ratio', {
                  currency: getCurrencySymbol(configCurrency),
                  multiplier: configMultiplier,
                })}
              </p>
              <p>
                <strong>{t('impact.label_sroi_ratio')}:</strong> {t('impact.formula_true_sroi')}
              </p>
              <p>
                <strong>{t('impact.label_reciprocity_score')}:</strong> {t('impact.formula_reciprocity')}
              </p>
              <p>
                <strong>{t('impact.label_network_density')}:</strong> {t('impact.formula_density')}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={closeConfig}>{t('common.cancel')}</Button>
            <Button  onPress={handleSaveConfig} isLoading={saving} isDisabled={saving}>
              {t('impact.save_configuration')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ImpactReport;
