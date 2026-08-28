// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BarChart3 from 'lucide-react/icons/chart-column';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/contexts/ToastContext';
import { getFormattingLocale } from '@/lib/helpers';
import {
  eventAnalyticsApi,
  type EventAnalyticsSummary,
} from '@/lib/event-analytics-api';
import { logError } from '@/lib/logger';

interface MetricRow {
  label: string;
  value: string;
}

function percentage(basisPoints: number | null): string {
  if (basisPoints === null) return '—';
  return new Intl.NumberFormat(getFormattingLocale(), {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(basisPoints / 10_000);
}

export function EventAnalyticsPanel({ eventId }: { eventId: number }) {
  const { t } = useTranslation('event_analytics');
  const toast = useToast();
  const [summary, setSummary] = useState<EventAnalyticsSummary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [isExporting, setIsExporting] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState('loading');
    try {
      const response = await eventAnalyticsApi.get(eventId, { signal: controller.signal });
      if (!response.success || !response.data) throw new Error(response.code ?? 'analytics_load_failed');
      setSummary(response.data);
      setState('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load Event analytics', error);
      setSummary(null);
      setState('error');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const number = useCallback(
    (value: number) => new Intl.NumberFormat(getFormattingLocale()).format(value),
    [],
  );
  const privacyCount = useCallback(
    (value: { value: number | null; suppressed: boolean }) => (
      value.suppressed ? t('analytics.suppressed') : number(value.value ?? 0)
    ),
    [number, t],
  );

  const sections = useMemo(() => {
    if (!summary) return [];
    const registration: MetricRow[] = [
      { label: t('analytics.metrics.confirmed'), value: number(summary.registration.confirmed) },
      { label: t('analytics.metrics.pending'), value: number(summary.registration.pending) },
      { label: t('analytics.metrics.cancelled'), value: number(summary.registration.cancelled) },
      {
        label: t('analytics.metrics.capacity_remaining'),
        value: summary.registration.remaining === null
          ? t('analytics.not_limited')
          : number(summary.registration.remaining),
      },
    ];
    const acquisition: MetricRow[] = [
      { label: t('analytics.metrics.invitations_issued'), value: number(summary.invitation.issued) },
      { label: t('analytics.metrics.invitations_accepted'), value: number(summary.invitation.accepted) },
      {
        label: t('analytics.metrics.invitation_conversion'),
        value: percentage(summary.invitation.conversion.basis_points),
      },
      { label: t('analytics.metrics.waitlist_joined'), value: number(summary.waitlist.joined) },
      { label: t('analytics.metrics.waitlist_accepted'), value: number(summary.waitlist.accepted) },
      {
        label: t('analytics.metrics.waitlist_conversion'),
        value: percentage(summary.waitlist.conversion.basis_points),
      },
    ];
    const attendance: MetricRow[] = [
      { label: t('analytics.metrics.checked_in'), value: number(summary.attendance.checked_in) },
      { label: t('analytics.metrics.attended'), value: number(summary.attendance.attended) },
      { label: t('analytics.metrics.no_show'), value: number(summary.attendance.no_show) },
      {
        label: t('analytics.metrics.attendance_rate'),
        value: percentage(summary.attendance.attendance_rate.basis_points),
      },
    ];
    const communications: MetricRow[] = [
      { label: t('analytics.metrics.delivered'), value: number(summary.communications.delivered) },
      { label: t('analytics.metrics.suppressed_deliveries'), value: number(summary.communications.suppressed) },
      { label: t('analytics.metrics.failed_deliveries'), value: number(summary.communications.failed) },
      { label: t('analytics.metrics.dead_lettered'), value: number(summary.communications.dead_lettered) },
      {
        label: t('analytics.metrics.delivery_rate'),
        value: percentage(summary.communications.delivery_rate.basis_points),
      },
    ];
    const funnel: MetricRow[] = [
      { label: t('analytics.metrics.event_views'), value: privacyCount(summary.optional_funnel.event_views) },
      {
        label: t('analytics.metrics.registration_starts'),
        value: privacyCount(summary.optional_funnel.registration_starts),
      },
      {
        label: t('analytics.metrics.start_conversion'),
        value: summary.optional_funnel.start_to_registration_conversion.suppressed
          ? t('analytics.suppressed')
          : percentage(summary.optional_funnel.start_to_registration_conversion.basis_points),
      },
      {
        label: t('analytics.metrics.guardian_consents'),
        value: privacyCount(summary.safeguarding.guardian_consents),
      },
    ];
    const finance: MetricRow[] = summary.tickets.redacted
      ? [{ label: t('analytics.metrics.finance'), value: t('analytics.finance_redacted') }]
      : [
        {
          label: t('analytics.metrics.ticket_units'),
          value: number(summary.tickets.confirmed_units ?? 0),
        },
        {
          label: t('analytics.metrics.ticket_credit_value'),
          value: summary.tickets.confirmed_credit_value ?? '0.00',
        },
        {
          label: t('analytics.metrics.completed_credit_claims'),
          value: number(summary.credits.completed_claims),
        },
        {
          label: t('analytics.metrics.failed_credit_claims'),
          value: number(summary.credits.failed_claims),
        },
      ];

    return [
      { key: 'registration', title: t('analytics.sections.registration'), rows: registration },
      { key: 'acquisition', title: t('analytics.sections.acquisition'), rows: acquisition },
      { key: 'attendance', title: t('analytics.sections.attendance'), rows: attendance },
      { key: 'communications', title: t('analytics.sections.communications'), rows: communications },
      { key: 'funnel', title: t('analytics.sections.funnel'), rows: funnel },
      { key: 'finance', title: t('analytics.sections.finance'), rows: finance },
    ];
  }, [number, privacyCount, summary, t]);

  const download = async () => {
    setIsExporting(true);
    try {
      await eventAnalyticsApi.download(eventId);
      toast.success(t('analytics.export_started'));
    } catch (error) {
      logError('Failed to download Event analytics', error);
      toast.error(t('analytics.download_error'));
    } finally {
      setIsExporting(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="flex min-h-48 items-center justify-center" role="status">
        <Spinner label={t('analytics.loading')} />
      </div>
    );
  }

  if (state === 'error' || !summary) {
    return (
      <Card>
        <CardBody className="items-start gap-4 p-6">
          <p className="text-danger">{t('analytics.load_error')}</p>
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {t('analytics.retry')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BarChart3 aria-hidden="true" className="h-5 w-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">{t('analytics.title')}</h2>
          </div>
          <p className="mt-1 text-sm text-default-600">{t('analytics.subtitle')}</p>
          <p className="mt-2 text-xs text-default-500">
            {t('analytics.generated_at', {
              date: new Intl.DateTimeFormat(getFormattingLocale(), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(summary.generated_at)),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onPress={() => void load()}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {t('analytics.refresh')}
          </Button>
          <Button variant="primary" isDisabled={isExporting} onPress={() => void download()}>
            <Download aria-hidden="true" className="h-4 w-4" />
            {isExporting ? t('analytics.exporting') : t('analytics.export')}
          </Button>
        </div>
      </div>

      <Card className="border border-primary/20 bg-primary/5">
        <CardBody className="flex-row items-start gap-3 p-4">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-foreground">{t('analytics.privacy_title')}</p>
            <p className="text-sm text-default-600">
              {t('analytics.privacy_note', { count: summary.privacy_threshold })}
            </p>
          </div>
        </CardBody>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.key}>
            <CardBody className="p-0">
              <div className="flex items-center justify-between border-b border-divider px-5 py-4">
                <h3 className="font-semibold text-foreground">{section.title}</h3>
                {section.key === 'funnel' && (
                  <Chip size="sm" variant="soft">{t('analytics.consent_bound')}</Chip>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{section.title}</caption>
                  <thead>
                    <tr className="text-left text-default-500">
                      <th className="px-5 py-3 font-medium" scope="col">
                        {t('analytics.columns.metric')}
                      </th>
                      <th className="px-5 py-3 text-right font-medium" scope="col">
                        {t('analytics.columns.value')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {section.rows.map((row) => (
                      <tr key={row.label}>
                        <th className="px-5 py-3 text-left font-normal text-default-700" scope="row">
                          {row.label}
                        </th>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-foreground">
                          {row.value}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
