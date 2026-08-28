import { getFormattingLocale } from '@/lib/helpers';
import { Chip, Card, CardBody, Spinner, Select, SelectItem, Tabs, Tab } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Job Pipeline Overview
 *
 * Interview and offer oversight for admins, with filterable DataTables
 * and status-coded chips for each pipeline stage.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';

import CalendarClock from 'lucide-react/icons/calendar-clock';
import Handshake from 'lucide-react/icons/handshake';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { DataTable, type Column } from '../../components/DataTable';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Interview {
  id: number;
  vacancy_id: number;
  application_id: number;
  interview_type: string;
  scheduled_at: string;
  duration_mins: number;
  location_notes?: string;
  status: string;
  candidate_notes?: string;
  candidate_name: string | null;
  candidate_email: string | null;
  job_title: string | null;
  created_at: string;
}

interface Offer {
  id: number;
  vacancy_id: number;
  application_id: number;
  salary_offered?: number;
  start_date?: string;
  details?: string;
  status: string;
  expires_at?: string;
  responded_at?: string;
  candidate_name: string | null;
  candidate_email: string | null;
  job_title: string | null;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Status color map
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLOR_MAP: Record<string, 'warning' | 'success' | 'danger' | 'default'> = {
  proposed: 'warning',
  pending: 'warning',
  accepted: 'success',
  declined: 'danger',
  rejected: 'danger',
  cancelled: 'default',
  withdrawn: 'default',
};

function getStatusColor(status: string): 'warning' | 'success' | 'danger' | 'default' {
  return STATUS_COLOR_MAP[status.toLowerCase()] ?? 'default';
}

function getStatusKey(status: string) {
  return `jobs.pipeline_status_${status.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;
}

const salaryFormatter = () =>
  new Intl.NumberFormat(getFormattingLocale(), {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Filter options
// ─────────────────────────────────────────────────────────────────────────────

const INTERVIEW_STATUSES = ['all', 'proposed', 'accepted', 'declined', 'cancelled'] as const;
const OFFER_STATUSES = ['all', 'pending', 'accepted', 'rejected', 'withdrawn'] as const;

const PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function JobPipelineOverview() {
  const { t } = useTranslation('admin_jobs');
  usePageTitle(t('jobs.pipeline_title'));
  const toast = useToast();

  // Tab
  const [activeTab, setActiveTab] = useState<string>('interviews');

  // ── Interviews state ────────────────────────────────────────────────────
  const [interviews, setInterviews] = useState<Interview[]>([]);
  const [interviewsTotal, setInterviewsTotal] = useState(0);
  const [interviewsPage, setInterviewsPage] = useState(1);
  const [interviewsStatus, setInterviewsStatus] = useState('all');
  const [interviewsLoading, setInterviewsLoading] = useState(true);

  // ── Offers state ────────────────────────────────────────────────────────
  const [offers, setOffers] = useState<Offer[]>([]);
  const [offersTotal, setOffersTotal] = useState(0);
  const [offersPage, setOffersPage] = useState(1);
  const [offersStatus, setOffersStatus] = useState('all');
  const [offersLoading, setOffersLoading] = useState(true);

  // ── Fetch interviews ───────────────────────────────────────────────────
  const loadInterviews = useCallback(async () => {
    setInterviewsLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(interviewsPage),
        limit: String(PAGE_SIZE),
      });
      if (interviewsStatus !== 'all') {
        params.set('status', interviewsStatus);
      }
      const res = await api.get<Interview[]>(
        `/v2/admin/jobs/interviews?${params.toString()}`
      );
      if (res.success && Array.isArray(res.data)) {
        setInterviews(res.data);
        setInterviewsTotal(res.meta?.total ?? res.data.length);
      } else {
        setInterviews([]);
        setInterviewsTotal(0);
        toast.error(t('jobs.pipeline_load_error'));
      }
    } catch {
      toast.error(t('jobs.pipeline_load_error'));
    } finally {
      setInterviewsLoading(false);
    }
  }, [interviewsPage, interviewsStatus, t, toast]);

  // ── Fetch offers ────────────────────────────────────────────────────────
  const loadOffers = useCallback(async () => {
    setOffersLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(offersPage),
        limit: String(PAGE_SIZE),
      });
      if (offersStatus !== 'all') {
        params.set('status', offersStatus);
      }
      const res = await api.get<Offer[]>(
        `/v2/admin/jobs/offers?${params.toString()}`
      );
      if (res.success && Array.isArray(res.data)) {
        setOffers(res.data);
        setOffersTotal(res.meta?.total ?? res.data.length);
      } else {
        setOffers([]);
        setOffersTotal(0);
        toast.error(t('jobs.pipeline_load_error_offers'));
      }
    } catch {
      toast.error(t('jobs.pipeline_load_error_offers'));
    } finally {
      setOffersLoading(false);
    }
  }, [offersPage, offersStatus, t, toast]);

  // ── Effects ─────────────────────────────────────────────────────────────
  useEffect(() => {
    loadInterviews();
  }, [loadInterviews]);

  useEffect(() => {
    loadOffers();
  }, [loadOffers]);

  // Reset page when filter changes
  useEffect(() => {
    setInterviewsPage(1);
  }, [interviewsStatus]);

  useEffect(() => {
    setOffersPage(1);
  }, [offersStatus]);

  // ── Interview columns ──────────────────────────────────────────────────
  const interviewColumns: Column<Interview>[] = useMemo(
    () => [
      {
        key: 'job_title',
        label: t('jobs.pipeline_job_title'),
        sortable: true,
        render: (item) => item.job_title ?? '—',
      },
      {
        key: 'candidate_name',
        label: t('jobs.pipeline_candidate'),
        sortable: true,
        render: (item) => (
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {item.candidate_name ?? '—'}
            </p>
            {item.candidate_email && (
              <p className="text-xs text-muted truncate">
                {item.candidate_email}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'interview_type',
        label: t('jobs.pipeline_type'),
        render: (item) => (
          <Chip size="sm" variant="soft" className="capitalize">
            {item.interview_type}
          </Chip>
        ),
      },
      {
        key: 'scheduled_at',
        label: t('jobs.pipeline_scheduled_at'),
        sortable: true,
        render: (item) =>
          new Date(item.scheduled_at).toLocaleDateString(getFormattingLocale(), {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          }),
      },
      {
        key: 'duration_mins',
        label: t('jobs.pipeline_duration'),
        render: (item) =>
          t('jobs.pipeline_minutes', { count: item.duration_mins }),
      },
      {
        key: 'status',
        label: t('jobs.pipeline_status'),
        render: (item) => (
          <Chip size="sm" variant="soft" color={getStatusColor(item.status)} className="capitalize">
            {t(getStatusKey(item.status))}
          </Chip>
        ),
      },
    ],
    [t]
  );

  // ── Offer columns ─────────────────────────────────────────────────────
  const offerColumns: Column<Offer>[] = useMemo(
    () => [
      {
        key: 'job_title',
        label: t('jobs.pipeline_job_title'),
        sortable: true,
        render: (item) => item.job_title ?? '—',
      },
      {
        key: 'candidate_name',
        label: t('jobs.pipeline_candidate'),
        sortable: true,
        render: (item) => (
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {item.candidate_name ?? '—'}
            </p>
            {item.candidate_email && (
              <p className="text-xs text-muted truncate">
                {item.candidate_email}
              </p>
            )}
          </div>
        ),
      },
      {
        key: 'salary_offered',
        label: t('jobs.pipeline_salary'),
        sortable: true,
        render: (item) =>
          item.salary_offered != null
            ? salaryFormatter().format(item.salary_offered)
            : '—',
      },
      {
        key: 'start_date',
        label: t('jobs.pipeline_start_date'),
        sortable: true,
        render: (item) =>
          item.start_date
            ? new Date(item.start_date).toLocaleDateString(getFormattingLocale(), {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : '—',
      },
      {
        key: 'status',
        label: t('jobs.pipeline_status'),
        render: (item) => (
          <Chip size="sm" variant="soft" color={getStatusColor(item.status)} className="capitalize">
            {t(getStatusKey(item.status))}
          </Chip>
        ),
      },
      {
        key: 'expires_at',
        label: t('jobs.pipeline_expires_at'),
        sortable: true,
        render: (item) =>
          item.expires_at
            ? new Date(item.expires_at).toLocaleDateString(getFormattingLocale(), {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : '—',
      },
    ],
    [t]
  );

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title={t('jobs.pipeline_title')}
        description={t('jobs.pipeline_description')}
      />

      <Tabs
        aria-label={t('jobs.pipeline_tabs')}
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(String(key))}
        variant="underlined"
        classNames={{ tabList: 'mb-4' }}
      >
        {/* ── Interviews Tab ─────────────────────────────────────────────── */}
        <Tab
          key="interviews"
          title={
            <div className="flex items-center gap-2">
              <CalendarClock size={16} />
              {t('jobs.pipeline_interviews')}
              {interviewsTotal > 0 && (
                <Chip size="sm" variant="soft">
                  {interviewsTotal}
                </Chip>
              )}
            </div>
          }
        >
          <Card >
            <CardBody>
              <div className="mb-4">
                <Select
                  label={t('jobs.pipeline_filter_status')}
                  selectedKeys={new Set([interviewsStatus])}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (selected) setInterviewsStatus(String(selected));
                  }}
                  size="sm"
                  variant="secondary"
                  className="max-w-xs"
                >
                  {INTERVIEW_STATUSES.map((s) => (
                    <SelectItem key={s} id={s}>
                      {s === 'all' ? t('jobs.pipeline_all') : t(getStatusKey(s))}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              {interviewsLoading && interviews.length === 0 ? (
                <div className="flex justify-center py-16">
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner label={t('jobs.pipeline_loading')} /></div>
                </div>
              ) : interviews.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title={t('jobs.pipeline_no_interviews')}
                  description={t('jobs.pipeline_no_interviews_desc')}
                />
              ) : (
                <DataTable<Interview>
                  columns={interviewColumns}
                  data={interviews}
                  keyField="id"
                  isLoading={interviewsLoading}
                  searchable={false}
                  totalItems={interviewsTotal}
                  page={interviewsPage}
                  pageSize={PAGE_SIZE}
                  onPageChange={setInterviewsPage}
                />
              )}
            </CardBody>
          </Card>
        </Tab>

        {/* ── Offers Tab ─────────────────────────────────────────────────── */}
        <Tab
          key="offers"
          title={
            <div className="flex items-center gap-2">
              <Handshake size={16} />
              {t('jobs.pipeline_offers')}
              {offersTotal > 0 && (
                <Chip size="sm" variant="soft">
                  {offersTotal}
                </Chip>
              )}
            </div>
          }
        >
          <Card >
            <CardBody>
              <div className="mb-4">
                <Select
                  label={t('jobs.pipeline_filter_status')}
                  selectedKeys={new Set([offersStatus])}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (selected) setOffersStatus(String(selected));
                  }}
                  size="sm"
                  variant="secondary"
                  className="max-w-xs"
                >
                  {OFFER_STATUSES.map((s) => (
                    <SelectItem key={s} id={s}>
                      {s === 'all' ? t('jobs.pipeline_all') : t(getStatusKey(s))}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              {offersLoading && offers.length === 0 ? (
                <div className="flex justify-center py-16">
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner label={t('jobs.pipeline_loading')} /></div>
                </div>
              ) : offers.length === 0 ? (
                <EmptyState
                  icon={Handshake}
                  title={t('jobs.pipeline_no_offers')}
                  description={t('jobs.pipeline_no_offers_desc')}
                />
              ) : (
                <DataTable<Offer>
                  columns={offerColumns}
                  data={offers}
                  keyField="id"
                  isLoading={offersLoading}
                  searchable={false}
                  totalItems={offersTotal}
                  page={offersPage}
                  pageSize={PAGE_SIZE}
                  onPageChange={setOffersPage}
                />
              )}
            </CardBody>
          </Card>
        </Tab>
      </Tabs>
    </div>
  );
}

export default JobPipelineOverview;
