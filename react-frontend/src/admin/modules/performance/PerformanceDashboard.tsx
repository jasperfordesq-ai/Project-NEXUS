// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback } from 'react';

import Activity from 'lucide-react/icons/activity';
import Database from 'lucide-react/icons/database';
import Zap from 'lucide-react/icons/zap';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Clock from 'lucide-react/icons/clock';
import MemoryStick from 'lucide-react/icons/memory-stick';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { usePageTitle } from '@/hooks/usePageTitle';
import { Button, Chip, Spinner, Card, Tabs, Tab } from '@/components/ui';

interface PerformanceSummary {
  slowest_requests: Array<{
    timestamp: string;
    endpoint: string;
    method: string;
    duration_ms: number;
    query_count: number;
    memory_mb: number;
    warnings?: string[];
  }>;
  slowest_queries: Array<{
    timestamp: string;
    duration_ms: number;
    sql: string;
    caller?: {
      class: string;
      function: string;
      file: string;
      line: number;
    };
  }>;
  memory_spikes: Array<{
    timestamp: string;
    endpoint: string;
    memory_mb: number;
    peak_memory_mb: number;
  }>;
  request_volume: Record<string, number>;
  n_plus_one_warnings: number;
  total_requests: number;
  total_slow_queries: number;
}

/**
 * 🔴 Nothing about the shape above is guaranteed at runtime, and this page has
 * already been broken once by assuming otherwise: it used to read
 * /v2/metrics/summary — the unrelated event-counter endpoint — and crashed on
 * the first key that endpoint does not return. The guard stays even now that
 * /v2/admin/performance/summary exists and is contract-tested, because a
 * dashboard of zeroes reads as "your site is fast" and that must never be
 * something the page can invent.
 */
const isPerformancePayload = (value: unknown): value is Partial<PerformanceSummary> => {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<PerformanceSummary>;

  return Array.isArray(candidate.slowest_requests)
    || Array.isArray(candidate.slowest_queries)
    || Array.isArray(candidate.memory_spikes);
};

const normalizeSummary = (raw: Partial<PerformanceSummary>): PerformanceSummary => ({
  slowest_requests: Array.isArray(raw.slowest_requests) ? raw.slowest_requests : [],
  slowest_queries: Array.isArray(raw.slowest_queries) ? raw.slowest_queries : [],
  memory_spikes: Array.isArray(raw.memory_spikes) ? raw.memory_spikes : [],
  request_volume: raw.request_volume && typeof raw.request_volume === 'object' ? raw.request_volume : {},
  n_plus_one_warnings: Number(raw.n_plus_one_warnings ?? 0) || 0,
  total_requests: Number(raw.total_requests ?? 0) || 0,
  total_slow_queries: Number(raw.total_slow_queries ?? 0) || 0,
});

const formatDuration = (ms: number) => {
  if (ms < 1000) {
    return formatNumber(ms, {
      style: 'unit',
      unit: 'millisecond',
      unitDisplay: 'short',
      maximumFractionDigits: 0,
    });
  }

  return formatNumber(ms / 1000, {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'short',
    maximumFractionDigits: 2,
  });
};

const formatMemory = (megabytes: number) => formatNumber(megabytes, {
  style: 'unit',
  unit: 'megabyte',
  unitDisplay: 'short',
  maximumFractionDigits: 2,
});

const getDurationColor = (ms: number) => {
  if (ms < 100) return 'success';
  if (ms < 500) return 'warning';
  return 'danger';
};

const formatTimestamp = (timestamp: string) => {
  return new Date(timestamp).toLocaleString(getFormattingLocale());
};

/**
 * "GroupService::members (GroupService.php:214)" — the file is shortened to its
 * basename because the stored path is absolute inside the container and the
 * leading directories are the same for every row.
 */
const formatCaller = (caller: NonNullable<PerformanceSummary['slowest_queries'][number]['caller']>) => {
  const symbol = [caller.class, caller.function].filter(Boolean).join('::');
  const basename = caller.file ? caller.file.split('/').pop() : '';
  const location = basename && caller.line ? `${basename}:${caller.line}` : basename;

  if (symbol && location) return `${symbol} (${location})`;

  return symbol || location || '';
};

export default function PerformanceDashboard() {
  const { t } = useTranslation('admin_performance');
  usePageTitle(t('performance.page_title'));

  const [summary, setSummary] = useState<PerformanceSummary | null>(null);
  // 'ok' — real figures. 'recording_off' — the platform is not recording, so
  // there is nothing to show and nothing is wrong. 'load_failed' — the request
  // itself did not answer usefully. Three genuinely different things to say.
  const [status, setStatus] = useState<'ok' | 'recording_off' | 'load_failed'>('ok');
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [selectedTab, setSelectedTab] = useState('requests');

  const loadSummary = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<unknown>(`/v2/admin/performance/summary?hours=${hours}`);

      if (response.success && isPerformancePayload(response.data)) {
        setSummary(normalizeSummary(response.data));
        setStatus(response.meta?.recording_enabled === false ? 'recording_off' : 'ok');
      } else {
        setSummary(null);
        setStatus('load_failed');
      }
    } catch (error) {
      console.error('Failed to load performance summary:', error);
      setSummary(null);
      setStatus('load_failed');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    loadSummary();
  }, [hours, loadSummary]);

  const renderStats = () => {
    if (!summary) return null;

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent/10 rounded-lg">
              <Activity className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm text-muted">{t('performance.label_total_requests')}</div>
              <div className="text-2xl font-bold">{summary.total_requests}</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-warning/10 rounded-lg">
              <Clock className="w-5 h-5 text-warning" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm text-muted">{t('performance.label_slow_queries')}</div>
              <div className="text-2xl font-bold">{summary.total_slow_queries}</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-danger/10 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-danger" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm text-muted">{t('performance.label_n_plus_one_warnings')}</div>
              <div className="text-2xl font-bold">{summary.n_plus_one_warnings}</div>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-accent-soft rounded-lg">
              <MemoryStick className="w-5 h-5 text-accent" aria-hidden="true" />
            </div>
            <div>
              <div className="text-sm text-muted">{t('performance.label_memory_spikes')}</div>
              <div className="text-2xl font-bold">{summary.memory_spikes.length}</div>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const renderSlowRequests = () => {
    if (!summary || summary.slowest_requests.length === 0) {
      return (
        <div className="text-center py-8 text-muted">
          {t('performance.no_slow_requests')}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {summary.slowest_requests.map((request) => (
          <Card key={`${request.timestamp}-${request.endpoint}`} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Chip size="sm" variant="soft">{request.method}</Chip>
                  <code className="text-sm truncate">{request.endpoint}</code>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted">
                  <span>{formatTimestamp(request.timestamp)}</span>
                  <span>
                    {t('performance.query_count_value', { queries: formatNumber(request.query_count) })}
                  </span>
                  <span>{formatMemory(request.memory_mb)}</span>
                </div>
                {request.warnings && request.warnings.length > 0 && (
                  <div className="flex gap-2 mt-2">
                    {request.warnings.map((warning) => (
                      <Chip key={warning} size="sm" color="warning" variant="soft">
                        {t(`performance.warning_${warning}`, { defaultValue: t('performance.warning_unknown') })}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
              <Chip
                color={getDurationColor(request.duration_ms)}
                variant="soft"
                size="lg"
              >
                {formatDuration(request.duration_ms)}
              </Chip>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  const renderSlowQueries = () => {
    if (!summary || summary.slowest_queries.length === 0) {
      return (
        <div className="text-center py-8 text-muted">
          {t('performance.no_slow_queries')}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {summary.slowest_queries.map((query) => (
          <Card key={`${query.timestamp}-${query.duration_ms}`} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <Database className="w-4 h-4 text-accent" aria-hidden="true" />
                  <span className="text-sm text-muted">{formatTimestamp(query.timestamp)}</span>
                </div>
                <code className="text-sm bg-surface-secondary dark:bg-surface-secondary p-2 rounded block overflow-x-auto">
                  {query.sql}
                </code>
                {query.caller && (
                  <div className="mt-2 text-xs text-muted">
                    {t('performance.called_from_value', { location: formatCaller(query.caller) })}
                  </div>
                )}
              </div>
              <Chip
                color={getDurationColor(query.duration_ms)}
                variant="soft"
                size="lg"
              >
                {formatDuration(query.duration_ms)}
              </Chip>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  const renderMemorySpikes = () => {
    if (!summary || summary.memory_spikes.length === 0) {
      return (
        <div className="text-center py-8 text-muted">
          {t('performance.no_memory_spikes')}
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {summary.memory_spikes.map((spike) => (
          <Card key={`${spike.timestamp}-${spike.endpoint}`} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <MemoryStick className="w-4 h-4 text-accent" aria-hidden="true" />
                  <code className="text-sm truncate">{spike.endpoint}</code>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted">
                  <span>{formatTimestamp(spike.timestamp)}</span>
                  <span>
                    {t('performance.peak_memory_value', { memory: formatMemory(spike.peak_memory_mb) })}
                  </span>
                </div>
              </div>
              <Chip color="default" variant="soft" size="lg">
                {formatMemory(spike.memory_mb)}
              </Chip>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  const renderVolumeChart = () => {
    if (!summary || Object.keys(summary.request_volume).length === 0) {
      return (
        <div className="text-center py-8 text-muted">
          {t('performance.no_volume_data')}
        </div>
      );
    }

    const hours = Object.keys(summary.request_volume).sort();
    const maxVolume = Math.max(...Object.values(summary.request_volume));

    return (
      <div className="space-y-2">
        {hours.map((hour) => {
          const volume = summary.request_volume[hour] ?? 0;
          const percentage = (volume / maxVolume) * 100;

          return (
            <div key={hour} className="flex items-center gap-4">
              <div className="w-32 text-sm text-muted">{hour}</div>
              <div className="flex-1 bg-surface-secondary dark:bg-surface-secondary rounded-full h-8 overflow-hidden">
                <div
                  className="bg-accent h-full flex items-center justify-end px-3 transition-all"
                  style={{ width: `${percentage}%` }}
                >
                  {percentage > 20 && (
                    <span className="text-sm text-white font-medium">{volume}</span>
                  )}
                </div>
              </div>
              {percentage <= 20 && (
                <div className="w-12 text-sm text-muted">{volume}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96" role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="w-7 h-7 text-accent" aria-hidden="true" />
            {t('performance.page_title')}
          </h1>
          <p className="text-muted mt-1">
            {t('performance.page_description')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={hours === 1 ? 'primary' : 'tertiary'}
            onPress={() => setHours(1)}
          >
            {t('performance.filter_1_hour')}
          </Button>
          <Button
            size="sm"
            variant={hours === 24 ? 'primary' : 'tertiary'}
            onPress={() => setHours(24)}
          >
            {t('performance.filter_24_hours')}
          </Button>
          <Button
            size="sm"
            variant={hours === 168 ? 'primary' : 'tertiary'}
            onPress={() => setHours(168)}
          >
            {t('performance.filter_7_days')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onPress={loadSummary}
          >
            {t('performance.refresh')}
          </Button>
        </div>
      </div>

      {status !== 'ok' && (
        <Card className="p-6 border-l-4 border-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5" aria-hidden="true" />
            <div>
              <h2 className="font-semibold mb-1">
                {status === 'recording_off'
                  ? t('performance.unavailable_title')
                  : t('performance.load_failed_title')}
              </h2>
              <p className="text-sm text-muted">
                {status === 'recording_off'
                  ? t('performance.unavailable_body')
                  : t('performance.load_failed_body')}
              </p>
            </div>
          </div>
        </Card>
      )}

      {status === 'ok' && renderStats()}

      {status === 'ok' && (
        <Card className="p-6">
          <Tabs
            selectedKey={selectedTab}
            onSelectionChange={(key) => setSelectedTab(key as string)}
            aria-label={t('performance.label_performance_metrics')}
          >
            <Tab key="requests" title={t('performance.tab_slow_requests')}>
              <div className="py-4">{renderSlowRequests()}</div>
            </Tab>
            <Tab key="queries" title={t('performance.tab_slow_queries')}>
              <div className="py-4">{renderSlowQueries()}</div>
            </Tab>
            <Tab key="memory" title={t('performance.tab_memory_spikes')}>
              <div className="py-4">{renderMemorySpikes()}</div>
            </Tab>
            <Tab key="volume" title={t('performance.tab_request_volume')}>
              <div className="py-4">{renderVolumeChart()}</div>
            </Tab>
          </Tabs>
        </Card>
      )}

      {summary && summary.n_plus_one_warnings > 0 && (
        <Card className="p-4 mt-6 border-l-4 border-warning">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5" aria-hidden="true" />
            <div>
              <h3 className="font-semibold text-warning mb-1">{t('performance.n_plus_one_title')}</h3>
              <p className="text-sm text-muted">
                {t('performance.n_plus_one_body')}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
