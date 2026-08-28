// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Clock3 from 'lucide-react/icons/clock-3';
import Network from 'lucide-react/icons/network';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

type EventFederationHealth =
  | 'healthy'
  | 'delivering'
  | 'degraded'
  | 'withdrawn'
  | 'not_configured';

type EventFederationDeliveryStatus =
  | 'pending'
  | 'retry'
  | 'processing'
  | 'delivered'
  | 'dead_letter';

export interface EventFederationPartnerStatus {
  partner_id: number;
  partner_name: string | null;
  partner_status: string;
  events_enabled: boolean;
  action: 'upsert' | 'tombstone' | null;
  delivery_status: EventFederationDeliveryStatus | null;
  attempts: number;
  max_attempts: number;
  aggregate_version: number;
  calendar_version: number;
  available_at: string | null;
  next_attempt_at: string | null;
  last_attempt_at: string | null;
  delivered_at: string | null;
  dead_lettered_at: string | null;
  error_code: string | null;
}

const HEALTH_VALUES: readonly EventFederationHealth[] = [
  'healthy',
  'delivering',
  'degraded',
  'withdrawn',
  'not_configured',
];

const DELIVERY_STATUS_VALUES: readonly EventFederationDeliveryStatus[] = [
  'pending',
  'retry',
  'processing',
  'delivered',
  'dead_letter',
];

const VISIBILITY_VALUES: readonly EventFederationStatus['visibility'][] = [
  'none',
  'listed',
  'joinable',
];

const PARTNER_STATUS_VALUES = ['active', 'pending', 'suspended', 'failed', 'removed'] as const;

export interface EventFederationStatus {
  contract_version: 1;
  event_id: number;
  federation_version: number;
  visibility: 'none' | 'listed' | 'joinable';
  configured_partners: number;
  recipient_partners: number;
  health: EventFederationHealth;
  counts: Record<EventFederationDeliveryStatus, number>;
  partners: EventFederationPartnerStatus[];
  generated_at: string | null;
}

interface EventFederationStatusPanelProps {
  eventId: number;
}

const HEALTH_COLORS: Record<EventFederationHealth, 'default' | 'success' | 'warning' | 'danger'> = {
  healthy: 'success',
  delivering: 'warning',
  degraded: 'danger',
  withdrawn: 'default',
  not_configured: 'default',
};

const DELIVERY_COLORS: Record<EventFederationDeliveryStatus, 'default' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  retry: 'warning',
  processing: 'warning',
  delivered: 'success',
  dead_letter: 'danger',
};

const COUNT_ORDER: EventFederationDeliveryStatus[] = [
  'pending',
  'retry',
  'processing',
  'delivered',
  'dead_letter',
];

function isFederationStatus(value: unknown): value is EventFederationStatus {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<EventFederationStatus>;

  return candidate.contract_version === 1
    && typeof candidate.event_id === 'number'
    && typeof candidate.federation_version === 'number'
    && VISIBILITY_VALUES.includes(candidate.visibility as EventFederationStatus['visibility'])
    && typeof candidate.configured_partners === 'number'
    && typeof candidate.recipient_partners === 'number'
    && HEALTH_VALUES.includes(candidate.health as EventFederationHealth)
    && typeof candidate.counts === 'object'
    && candidate.counts !== null
    && DELIVERY_STATUS_VALUES.every((status) => (
      typeof candidate.counts?.[status] === 'number'
      && Number.isInteger(candidate.counts[status])
      && candidate.counts[status] >= 0
    ))
    && Array.isArray(candidate.partners)
    && candidate.partners.every(isFederationPartnerStatus);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isFederationPartnerStatus(value: unknown): value is EventFederationPartnerStatus {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<EventFederationPartnerStatus>;

  return typeof candidate.partner_id === 'number'
    && isNullableString(candidate.partner_name)
    && typeof candidate.partner_status === 'string'
    && typeof candidate.events_enabled === 'boolean'
    && (candidate.action === null || candidate.action === 'upsert' || candidate.action === 'tombstone')
    && (candidate.delivery_status === null
      || (typeof candidate.delivery_status === 'string'
        && DELIVERY_STATUS_VALUES.includes(candidate.delivery_status)))
    && typeof candidate.attempts === 'number'
    && typeof candidate.max_attempts === 'number'
    && typeof candidate.aggregate_version === 'number'
    && typeof candidate.calendar_version === 'number'
    && isNullableString(candidate.available_at)
    && isNullableString(candidate.next_attempt_at)
    && isNullableString(candidate.last_attempt_at)
    && isNullableString(candidate.delivered_at)
    && isNullableString(candidate.dead_lettered_at)
    && isNullableString(candidate.error_code);
}

function safeDiagnosticCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();

  return /^[A-Z0-9_-]{1,64}$/.test(normalized) ? normalized : null;
}

function safePartnerStatus(value: string): typeof PARTNER_STATUS_VALUES[number] | 'unknown' {
  return PARTNER_STATUS_VALUES.includes(value as typeof PARTNER_STATUS_VALUES[number])
    ? value as typeof PARTNER_STATUS_VALUES[number]
    : 'unknown';
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'name' in error
    && error.name === 'AbortError';
}

export function EventFederationStatusPanel({ eventId }: EventFederationStatusPanelProps) {
  const { t } = useTranslation('event_federation');
  const requestGeneration = useRef(0);
  const [status, setStatus] = useState<EventFederationStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const generation = ++requestGeneration.current;
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await api.get<EventFederationStatus>(
        `/v2/events/${eventId}/federation-status`,
        { signal },
      );
      if (generation !== requestGeneration.current || signal?.aborted) return;
      if (!response.success || !isFederationStatus(response.data)) {
        setStatus(null);
        setLoadError(true);
        return;
      }
      setStatus(response.data);
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) return;
      logError('Failed to load Event federation status', error);
      if (generation === requestGeneration.current) {
        setStatus(null);
        setLoadError(true);
      }
    } finally {
      if (generation === requestGeneration.current && !signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [eventId]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);

    return () => controller.abort();
  }, [load]);

  const formatTimestamp = (value: string | null): string => {
    if (!value) return t('manage.federation.not_available');
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t('manage.federation.not_available');

    return new Intl.DateTimeFormat(getFormattingLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  };

  const partnerActivity = (partner: EventFederationPartnerStatus): string | null => (
    partner.delivered_at
    ?? partner.dead_lettered_at
    ?? partner.last_attempt_at
    ?? partner.next_attempt_at
    ?? partner.available_at
  );

  return (
    <Card className="border border-theme-default bg-theme-surface">
      <CardBody className="space-y-5 p-5 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl bg-accent-soft p-2.5 text-accent">
              <Network className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-theme-primary">
                  {t('manage.federation.title')}
                </h2>
                {status && (
                  <Chip color={HEALTH_COLORS[status.health]} size="sm" variant="soft">
                    {t(`manage.federation.health.${status.health}`)}
                  </Chip>
                )}
              </div>
              <p className="mt-1 text-sm text-theme-muted">
                {t('manage.federation.description')}
              </p>
            </div>
          </div>
          <Button
            className="self-start"
            isLoading={isLoading && status !== null}
            size="sm"
            startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            variant="outline"
            onPress={() => void load()}
          >
            {t('manage.federation.refresh')}
          </Button>
        </div>

        {isLoading && status === null ? (
          <div className="flex min-h-32 items-center justify-center" role="status">
            <Spinner label={t('manage.federation.loading')} />
          </div>
        ) : loadError || status === null ? (
          <Alert
            color="danger"
            description={t('manage.federation.load_error_description')}
            endContent={(
              <Button size="sm" variant="danger" onPress={() => void load()}>
                {t('manage.federation.try_again')}
              </Button>
            )}
            title={t('manage.federation.load_error_title')}
          />
        ) : (
          <>
            {status.configured_partners === 0 && (
              <Alert
                color="warning"
                description={t('manage.federation.not_configured_description')}
                title={t('manage.federation.not_configured_title')}
              />
            )}
            {status.health === 'degraded' && (
              <Alert
                color="danger"
                description={t('manage.federation.degraded_description')}
                icon={<TriangleAlert className="h-5 w-5" aria-hidden="true" />}
                title={t('manage.federation.degraded_title')}
              />
            )}

            <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {([
                ['configured_partners', status.configured_partners],
                ['recipient_partners', status.recipient_partners],
                ['federation_version', status.federation_version],
                ['visibility', t(`manage.federation.visibility.${status.visibility}`)],
              ] as const).map(([key, value]) => (
                <div key={key} className="rounded-xl border border-theme-default bg-theme-subtle p-3">
                  <dt className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                    {t(`manage.federation.metrics.${key}`)}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold text-theme-primary">{value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <h3 className="text-sm font-semibold text-theme-primary">
                {t('manage.federation.delivery_summary')}
              </h3>
              <div className="mt-2 flex flex-wrap gap-2">
                {COUNT_ORDER.map((deliveryStatus) => (
                  <Chip
                    key={deliveryStatus}
                    color={DELIVERY_COLORS[deliveryStatus]}
                    size="sm"
                    variant="soft"
                  >
                    {t(`manage.federation.delivery_status.${deliveryStatus}`)}: {status.counts[deliveryStatus]}
                  </Chip>
                ))}
              </div>
            </div>

            <Table aria-label={t('manage.federation.partners_table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn id="partner" isRowHeader>{t('manage.federation.columns.partner')}</TableColumn>
                <TableColumn id="action">{t('manage.federation.columns.action')}</TableColumn>
                <TableColumn id="delivery">{t('manage.federation.columns.delivery')}</TableColumn>
                <TableColumn id="attempts">{t('manage.federation.columns.attempts')}</TableColumn>
                <TableColumn id="activity">{t('manage.federation.columns.activity')}</TableColumn>
              </TableHeader>
              <TableBody
                emptyContent={t('manage.federation.no_deliveries')}
                items={status.partners.map((partner) => ({ ...partner, id: partner.partner_id }))}
              >
                {(partner) => (
                  <TableRow id={partner.partner_id}>
                    <TableCell>
                      <div className="min-w-40">
                        <p className="font-medium text-theme-primary">
                          {partner.partner_name ?? t('manage.federation.removed_partner')}
                        </p>
                        <p className="text-xs text-theme-subtle">
                          {t(`manage.federation.partner_status.${safePartnerStatus(partner.partner_status)}`)}
                          {!partner.events_enabled && ` · ${t('manage.federation.events_disabled')}`}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {partner.action
                        ? t(`manage.federation.action.${partner.action}`)
                        : t('manage.federation.not_available')}
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-36 flex-col items-start gap-1">
                        {partner.delivery_status ? (
                          <Chip
                            color={DELIVERY_COLORS[partner.delivery_status]}
                            size="sm"
                            variant="soft"
                          >
                            {t(`manage.federation.delivery_status.${partner.delivery_status}`)}
                          </Chip>
                        ) : t('manage.federation.not_available')}
                        {partner.error_code && (
                          <span className="text-xs text-danger">
                            {safeDiagnosticCode(partner.error_code)
                              ? t('manage.federation.error_code', {
                                code: safeDiagnosticCode(partner.error_code),
                              })
                              : t('manage.federation.error_code_unknown')}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {t('manage.federation.attempt_count', {
                        count: partner.attempts,
                        max: partner.max_attempts,
                      })}
                    </TableCell>
                    <TableCell>
                      <span className="flex min-w-44 items-center gap-1.5 text-sm text-theme-muted">
                        <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatTimestamp(partnerActivity(partner))}
                      </span>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>

            <p className="text-xs text-theme-subtle">
              {t('manage.federation.generated_at', {
                time: formatTimestamp(status.generated_at),
              })}
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
