// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Card, CardBody, CardHeader, Input, Textarea, Spinner, Progress, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Tab, Tabs } from '@/components/ui';
import { useState, useCallback, useEffect, useMemo } from 'react';

import Gift from 'lucide-react/icons/gift';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Plus from 'lucide-react/icons/plus';
import Edit2 from 'lucide-react/icons/pen';
import XCircle from 'lucide-react/icons/circle-x';
import Download from 'lucide-react/icons/download';
import DollarSign from 'lucide-react/icons/dollar-sign';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import BarChart3 from 'lucide-react/icons/chart-column';
import EyeOff from 'lucide-react/icons/eye-off';
import TrendingUp from 'lucide-react/icons/trending-up';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, } from 'recharts';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';
import { CHART_TOKEN_COLORS } from '@/lib/chartColors';

/**
 * Volunteer Giving Days & Donations
 * Admin page to manage giving day campaigns and view donation summaries.
 */


interface GivingDay {
  id: number;
  name: string;
  description?: string;
  target_amount: number;
  target_hours: number;
  raised_amount?: number;
  donation_count?: number;
  donor_count?: number;
  completed_hours?: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  created_at: string;
}

interface DonationStats {
  total_donations: number;
  total_amount: number;
}

interface Donor {
  id: number;
  user_id: number | null;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  amount: number;
  is_anonymous: boolean;
  donated_at: string;
}

interface DonorResponse {
  data: Donor[];
  stats: { total_donors: number; anonymous_count: number; total_raised: number };
  meta: { has_more: boolean; cursor: string | null };
}

interface TrendPoint {
  period: string;
  donors: number;
  amount: number;
  cumulative: number;
}

const emptyForm = {
  name: '',
  description: '',
  target_amount: '',
  target_hours: '',
  start_date: '',
  end_date: '',
};

const getProgressColor = (pct: number): 'success' | 'warning' | 'danger' | 'default' => {
  if (pct >= 100) return 'success';
  if (pct >= 60) return 'default';
  if (pct >= 30) return 'warning';
  return 'danger';
};

export default function VolunteerGivingDays() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.giving_days_title'));
  const toast = useToast();

  const formatTrendPeriod = (period: string): string => {
    const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
    if (dayMatch) {
      const date = new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]));
      return date.toLocaleDateString(getFormattingLocale(), { month: 'short', day: 'numeric' });
    }

    const weekMatch = /^(\d{4})-W(\d{1,2})$/.exec(period);
    if (weekMatch) {
      return t('volunteering.week_period', { year: Number(weekMatch[1]), week: Number(weekMatch[2]) });
    }

    return t('volunteering.chart_period_unknown');
  };

  const [givingDays, setGivingDays] = useState<GivingDay[]>([]);
  const [donationStats, setDonationStats] = useState<DonationStats>({ total_donations: 0, total_amount: 0 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [selectedDayId, setSelectedDayId] = useState<number | null>(null);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [donorStats, setDonorStats] = useState<DonorResponse['stats']>({ total_donors: 0, anonymous_count: 0, total_raised: 0 });
  const [donorCursor, setDonorCursor] = useState<string | null>(null);
  const [donorHasMore, setDonorHasMore] = useState(false);
  const [donorsLoading, setDonorsLoading] = useState(false);
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // Deactivation requires confirmation; activation is direct. Both share the in-flight guard.
  const [deactivateTarget, setDeactivateTarget] = useState<GivingDay | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isDonorOpen, onOpen: onDonorOpen, onClose: onDonorClose } = useDisclosure();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getGivingDays();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        let d: { giving_days?: GivingDay[]; donation_stats?: DonationStats };
        if (payload && typeof payload === 'object' && 'data' in payload) {
          d = (payload as { data: typeof d }).data;
        } else {
          d = payload as typeof d;
        }
        setGivingDays(d.giving_days || (Array.isArray(d) ? d as unknown as GivingDay[] : []));
        if (d.donation_stats) setDonationStats(d.donation_stats);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_giving_days'));
      setGivingDays([]);
    }
    setLoading(false);
  }, [toast, t]);


  useEffect(() => { loadData(); }, [loadData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    onOpen();
  };

  const openEdit = (day: GivingDay) => {
    setEditingId(day.id);
    setForm({
      name: day.name,
      description: day.description || '',
      target_amount: String(day.target_amount),
      target_hours: String(day.target_hours),
      start_date: day.start_date?.slice(0, 10) || '',
      end_date: day.end_date?.slice(0, 10) || '',
    });
    onOpen();
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error(t('volunteering.name_required'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim(),
        target_amount: Number(form.target_amount) || 0,
        target_hours: Number(form.target_hours) || 0,
        start_date: form.start_date,
        end_date: form.end_date,
      };
      const res = editingId
        ? await adminVolunteering.updateGivingDay(editingId, payload)
        : await adminVolunteering.createGivingDay(payload);

      if (res.success) {
        toast.success(editingId ? t('volunteering.giving_day_updated') : t('volunteering.giving_day_created'));
        onClose();
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_save'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_save'));
    }
    setSaving(false);
  };

  const handleDeactivate = async (day: GivingDay) => {
    if (togglingId !== null) return;
    setTogglingId(day.id);
    try {
      const res = await adminVolunteering.updateGivingDay(day.id, { is_active: !day.is_active });
      if (res.success) {
        toast.success(day.is_active
          ? t('volunteering.giving_day_deactivated')
          : t('volunteering.giving_day_activated'));
        setDeactivateTarget(null);
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_update_status'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_update_status'));
    } finally {
      setTogglingId(null);
    }
  };

  const handleExport = async () => {
    try {
      await adminVolunteering.exportDonations('volunteer-donations.csv');
      toast.success(t('volunteering.export_started'));
    } catch {
      toast.error(t('volunteering.export_failed'));
    }
  };

  const chartData = useMemo(() =>
    givingDays.map((day) => ({
      name: day.name.length > 20 ? day.name.slice(0, 18) + '...' : day.name,
      raised_amount: day.raised_amount || 0,
      target_amount: day.target_amount || 0,
      donor_count: day.donor_count || 0,
    })),
    [givingDays],
  );

  const loadDonors = useCallback(async (givingDayId: number, cursor?: string) => {
    setDonorsLoading(true);
    try {
      const res = await adminVolunteering.getGivingDayDonors(givingDayId, cursor);
      if (res.success && res.data) {
        const newDonors = Array.isArray(res.data) ? res.data as Donor[] : [];
        if (cursor) {
          setDonors((prev) => [...prev, ...newDonors]);
        } else {
          setDonors(newDonors);
        }
        const meta = res.meta as (DonorResponse['meta'] & { stats?: DonorResponse['stats'] }) | undefined;
        if (meta?.stats) setDonorStats(meta.stats);
        setDonorCursor(meta?.cursor || null);
        setDonorHasMore(meta?.has_more || false);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_donors'));
    }
    setDonorsLoading(false);
  }, [toast, t]);


  const loadTrends = useCallback(async (givingDayId: number) => {
    setTrendsLoading(true);
    try {
      const res = await adminVolunteering.getGivingDayTrends(givingDayId);
      if (res.success && res.data) {
        const payload = res.data as unknown as { data?: { trends?: TrendPoint[] }; trends?: TrendPoint[] };
        const trendData = payload.data?.trends || payload.trends || [];
        setTrends(trendData);
      }
    } catch {
      // Silently fail — trends are supplementary
      setTrends([]);
    }
    setTrendsLoading(false);
  }, []);

  const handleRowClick = (day: GivingDay) => {
    setSelectedDayId(day.id);
    setDonors([]);
    setTrends([]);
    setDonorCursor(null);
    setDonorHasMore(false);
    loadDonors(day.id);
    loadTrends(day.id);
    onDonorOpen();
  };

  const selectedDay = givingDays.find((d) => d.id === selectedDayId);

  const columns: Column<GivingDay>[] = [
    { key: 'name', label: t('volunteering.col_name'), sortable: true },
    {
      key: 'target_amount',
      label: t('volunteering.col_target_amount'),
      sortable: true,
      render: (row) => {
        const target = row.target_amount || 0;
        const raised = row.raised_amount || 0;
        const pct = target > 0 ? Math.round((raised / target) * 100) : 0;
        return (
          <div className="min-w-[120px]">
            <div className="flex justify-between text-xs mb-1">
              <span>{raised.toLocaleString(getFormattingLocale())}</span>
              <span className="text-muted/80">/ {target.toLocaleString(getFormattingLocale())}</span>
            </div>
            <Progress size="sm" value={Math.min(pct, 100)} color={getProgressColor(pct)} aria-label={t('volunteering.amount_progress_aria')} />
          </div>
        );
      },
    },
    {
      key: 'target_hours',
      label: t('volunteering.col_target_hours'),
      sortable: true,
      render: (row) => {
        const target = row.target_hours || 0;
        const logged = row.completed_hours || 0;
        const pct = target > 0 ? Math.round((logged / target) * 100) : 0;
        return (
          <div className="min-w-[120px]">
            <div className="flex justify-between text-xs mb-1">
              <span>{formatNumber(logged, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' })}</span>
              <span className="text-muted/80">
                {t('giving_days.hours_target', {
                  target: formatNumber(target, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }),
                })}
              </span>
            </div>
            <Progress size="sm" value={Math.min(pct, 100)} color={getProgressColor(pct)} aria-label={t('volunteering.hours_progress_aria')} />
          </div>
        );
      },
    },
    {
      key: 'start_date',
      label: t('volunteering.col_start_date'),
      sortable: true,
      render: (row) => <span>{row.start_date ? new Date(row.start_date).toLocaleDateString(getFormattingLocale()) : '-'}</span>,
    },
    {
      key: 'end_date',
      label: t('volunteering.col_end_date'),
      sortable: true,
      render: (row) => <span>{row.end_date ? new Date(row.end_date).toLocaleDateString(getFormattingLocale()) : '-'}</span>,
    },
    {
      key: 'is_active',
      label: t('volunteering.col_status'),
      render: (row) => (
        <Chip size="sm" color={row.is_active ? 'success' : 'default'} variant="soft">
          {row.is_active ? t('volunteering.active') : t('volunteering.inactive')}
        </Chip>
      ),
    },
    {
      key: 'actions' as keyof GivingDay,
      label: t('volunteering.col_actions'),
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="tertiary" isIconOnly onPress={() => openEdit(row)} aria-label={t('volunteering.edit')}>
            <Edit2 size={14} />
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            isIconOnly
            onPress={() => handleRowClick(row)}
            aria-label={t('volunteering.view_donors')}
          >
            <Users size={14} />
          </Button>
          <Button
            size="sm"
            variant={row.is_active ? 'danger-soft' : 'tertiary'}
            isIconOnly
            onPress={() => {
              if (row.is_active) {
                setDeactivateTarget(row);
              } else {
                handleDeactivate(row);
              }
            }}
            isLoading={togglingId === row.id}
            isDisabled={togglingId !== null && togglingId !== row.id}
            aria-label={row.is_active ? t('volunteering.deactivate') : t('volunteering.activate')}
          >
            <XCircle size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.giving_days_title')}
        description={t('volunteering.giving_days_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={loadData} isLoading={loading}>
              {t('volunteering.refresh')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openCreate}>
              {t('volunteering.create_giving_day')}
            </Button>
          </div>
        }
      />

      {/* Campaign Analytics Chart */}
      {givingDays.length > 0 && (
        <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
          <CardHeader className="pb-0">
            <div className="flex items-center gap-2">
              <BarChart3 size={18} className="text-accent" />
              <h3 className="text-lg font-semibold">
                {t('volunteering.campaign_analytics')}
              </h3>
            </div>
          </CardHeader>
          <CardBody>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis dataKey="name" fontSize={12} />
                  <YAxis fontSize={12} />
                  <Tooltip />
                  <Bar
                    dataKey="raised_amount"
                    name={t('volunteering.raised_amount')}
                    fill={CHART_TOKEN_COLORS.accent}
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="donor_count"
                    name={t('volunteering.donor_count')}
                    fill={CHART_TOKEN_COLORS.success}
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardBody>
        </Card>
      )}

      {givingDays.length === 0 && !loading ? (
        <EmptyState
          icon={Gift}
          title={t('volunteering.no_giving_days')}
          description={t('volunteering.no_giving_days_desc')}
        />
      ) : (
        <DataTable columns={columns} data={givingDays} isLoading={loading} />
      )}

      {/* Donations Summary */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">{t('volunteering.donations_summary')}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            label={t('volunteering.total_donations')}
            value={donationStats.total_donations}
            icon={Gift}
            color="default"
            loading={loading}
          />
          <StatCard
            label={t('volunteering.total_amount')}
            value={donationStats.total_amount}
            icon={DollarSign}
            color="success"
            loading={loading}
          />
        </div>
        <Button variant="tertiary" startContent={<Download size={16} />} onPress={handleExport}>
          {t('volunteering.export_donations')}
        </Button>
      </div>

      {/* Donor List Modal */}
      <Modal isOpen={isDonorOpen} onClose={onDonorClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.donors_for')}: {selectedDay?.name || ''}
          </ModalHeader>
          <ModalBody>
            {/* Stats summary */}
            <div className="grid grid-cols-3 gap-3">
              <Card className="border border-accent/20 bg-accent-soft shadow-sm shadow-accent/10">
                <CardBody className="p-3 text-center">
                  <p className="text-xs text-muted">{t('volunteering.total_donors')}</p>
                  <p className="text-lg font-bold text-accent">{donorStats.total_donors}</p>
                </CardBody>
              </Card>
              <Card className="border border-success/20 bg-success/10 shadow-sm shadow-success/10">
                <CardBody className="p-3 text-center">
                  <p className="text-xs text-muted">{t('volunteering.total_raised')}</p>
                  <p className="text-lg font-bold text-success">{donorStats.total_raised.toLocaleString(getFormattingLocale())}</p>
                </CardBody>
              </Card>
              <Card className="border border-divider/70 bg-surface-secondary/50">
                <CardBody className="p-3 text-center">
                  <p className="text-xs text-muted">{t('volunteering.anonymous_donors')}</p>
                  <p className="text-lg font-bold text-foreground/80">{donorStats.anonymous_count}</p>
                </CardBody>
              </Card>
            </div>

            <Tabs aria-label={t('volunteering.giving_days_tabs_aria')} variant="underlined" classNames={{ tabList: 'mb-3' }}>
              <Tab
                key="donors"
                title={
                  <div className="flex items-center gap-2">
                    <Users size={14} />
                    {t('volunteering.donor_list')}
                  </div>
                }
              >
                {donorsLoading && donors.length === 0 ? (
                  <div role="status" aria-busy="true" aria-label={t('volunteering.loading')} className="flex justify-center py-8">
                    <Spinner size="lg" />
                  </div>
                ) : donors.length === 0 ? (
                  <div className="py-6 text-center">
                    <Users size={32} className="mx-auto mb-2 text-muted/70" />
                    <p className="text-muted text-sm">
                      {t('volunteering.no_donors_yet')}
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {donors.map((donor) => {
                      const donorName = donor.is_anonymous
                        ? t('volunteering.anonymous_donor')
                        : donor.name || t('volunteering.guest_donor');

                      return (
                        <div key={donor.id} className="flex items-center gap-3 rounded-2xl border border-divider/70 bg-surface-secondary/50 p-3 transition-colors hover:bg-surface-tertiary">
                          {donor.is_anonymous ? (
                            <div className="w-9 h-9 rounded-full bg-surface-secondary flex items-center justify-center">
                              <EyeOff size={16} className="text-muted" />
                            </div>
                          ) : (
                            <Avatar
                              src={donor.avatar_url || undefined}
                              name={donorName}
                              size="sm"
                              className="flex-shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">
                              {donorName}
                            </p>
                            {!donor.is_anonymous && donor.email && (
                              <p className="text-xs text-muted/80 truncate">{donor.email}</p>
                            )}
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-semibold text-success">{donor.amount.toLocaleString(getFormattingLocale())}</p>
                            <p className="text-xs text-muted/80">
                              {donor.donated_at ? new Date(donor.donated_at).toLocaleDateString(getFormattingLocale()) : ''}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                    {donorHasMore && (
                      <Button
                        variant="tertiary"
                        size="sm"
                        className="mt-2"
                        isLoading={donorsLoading}
                        onPress={() => selectedDayId && donorCursor && loadDonors(selectedDayId, donorCursor)}
                      >
                        {t('volunteering.load_more')}
                      </Button>
                    )}
                  </div>
                )}
              </Tab>
              <Tab
                key="trends"
                title={
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} />
                    {t('volunteering.donation_trends')}
                  </div>
                }
              >
                {trendsLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('volunteering.loading')} className="flex justify-center py-8">
                    <Spinner size="lg" />
                  </div>
                ) : trends.length === 0 ? (
                  <div className="py-6 text-center">
                    <TrendingUp size={32} className="mx-auto mb-2 text-muted/70" />
                    <p className="text-muted text-sm">
                      {t('volunteering.no_trend_data')}
                    </p>
                  </div>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={trends} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                        <XAxis dataKey="period" fontSize={11} tickFormatter={formatTrendPeriod} />
                        <YAxis fontSize={11} tickFormatter={(value: number) => formatNumber(value)} />
                        <Tooltip
                          labelFormatter={(value) => formatTrendPeriod(String(value))}
                          formatter={(value) => formatNumber(Number(value))}
                        />
                        <Area
                          type="monotone"
                          dataKey="cumulative"
                          name={t('volunteering.cumulative_amount')}
                          stroke={CHART_TOKEN_COLORS.success}
                          fill={CHART_TOKEN_COLORS.success}
                          fillOpacity={0.2}
                        />
                        <Area
                          type="monotone"
                          dataKey="amount"
                          name={t('volunteering.daily_amount')}
                          stroke={CHART_TOKEN_COLORS.accent}
                          fill={CHART_TOKEN_COLORS.accent}
                          fillOpacity={0.1}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Tab>
            </Tabs>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onDonorClose}>{t('volunteering.close')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Create/Edit Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>
            {editingId
              ? t('volunteering.edit_giving_day')
              : t('volunteering.create_giving_day')}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                label={t('volunteering.field_name')}
                value={form.name}
                onValueChange={(v) => setForm((f) => ({ ...f, name: v }))}
                isRequired
                variant="secondary"
              />
              <Textarea
                label={t('volunteering.field_description')}
                value={form.description}
                onValueChange={(v) => setForm((f) => ({ ...f, description: v }))}
                variant="secondary"
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('volunteering.field_target_amount')}
                  type="number"
                  value={form.target_amount}
                  onValueChange={(v) => setForm((f) => ({ ...f, target_amount: v }))}
                  variant="secondary"
                  startContent={<DollarSign size={14} className="text-muted" />}
                />
                <Input
                  label={t('volunteering.field_target_hours')}
                  type="number"
                  value={form.target_hours}
                  onValueChange={(v) => setForm((f) => ({ ...f, target_hours: v }))}
                  variant="secondary"
                  startContent={<Calendar size={14} className="text-muted" />}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('volunteering.field_start_date')}
                  type="date"
                  value={form.start_date}
                  onValueChange={(v) => setForm((f) => ({ ...f, start_date: v }))}
                  variant="secondary"
                />
                <Input
                  label={t('volunteering.field_end_date')}
                  type="date"
                  value={form.end_date}
                  onValueChange={(v) => setForm((f) => ({ ...f, end_date: v }))}
                  variant="secondary"
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onClose}>{t('volunteering.cancel')}</Button>
            <Button onPress={handleSave} isLoading={saving}>
              {editingId ? t('volunteering.save') : t('volunteering.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Deactivate Confirmation */}
      <ConfirmModal
        isOpen={deactivateTarget !== null}
        onClose={() => { if (togglingId === null) setDeactivateTarget(null); }}
        onConfirm={() => { if (deactivateTarget) handleDeactivate(deactivateTarget); }}
        title={t('volunteering.deactivate_giving_day_title')}
        message={t('volunteering.deactivate_giving_day_confirm', { name: deactivateTarget?.name ?? '' })}
        confirmLabel={t('volunteering.deactivate')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor="danger"
        isLoading={togglingId !== null}
      />
    </div>
  );
}
