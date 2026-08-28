// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';

import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import CheckCircle from 'lucide-react/icons/circle-check';
import Globe from 'lucide-react/icons/globe';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { PageMeta } from '@/components/seo';
import {
  FederationCommunityPicker,
  type FederationPeer,
} from '@/components/caring-community/FederationCommunityPicker';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

type TransferStatus =
  | 'pending'
  | 'approved_by_source'
  | 'sent'
  | 'received'
  | 'completed'
  | 'rejected';

interface TransferHistoryItem {
  id: number;
  destination_tenant_slug: string;
  destination_member_email: string;
  hours: number;
  status: TransferStatus;
  reason: string;
  created_at: string;
}

interface HistoryResponse {
  items: TransferHistoryItem[];
}

interface InitiateResponse {
  transfer_id: number;
  status: TransferStatus;
  success: boolean;
}

const STATUS_COLOR: Record<TransferStatus, 'default' | 'primary' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  approved_by_source: 'primary',
  sent: 'primary',
  received: 'primary',
  completed: 'success',
  rejected: 'danger',
};

const dateFormatter = () => new Intl.DateTimeFormat(getFormattingLocale(), {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

function formatDate(value: string): string {
  return dateFormatter().format(new Date(value));
}

export function HourTransferPage() {
  const { t } = useTranslation('common');
  const { t: tCaring } = useTranslation('caring_community');
  const { hasFeature, tenantPath } = useTenant();
  usePageTitle(t('hour_transfer.meta.title'));

  const [destinationSlug, setDestinationSlug] = useState('');
  const [selectedPeer, setSelectedPeer] = useState<FederationPeer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [directoryAvailable, setDirectoryAvailable] = useState<boolean | null>(null);
  const [hours, setHours] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<TransferHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      setHistoryLoading(true);
      const res = await api.get<HistoryResponse>('/v2/caring-community/hour-transfer/my-history');
      if (res.success && res.data) {
        setHistory(res.data.items ?? []);
      }
    } catch (err) {
      logError('HourTransferPage: load history failed', err);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  // Probe the federation directory once on mount; if it's unavailable or
  // returns no peers, fall back to the manual slug input.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ peers: unknown[] }>(
          '/v2/caring-community/federation-directory',
        );
        if (cancelled) return;
        const peerCount = Array.isArray(res.data?.peers) ? res.data.peers.length : 0;
        setDirectoryAvailable(res.success && peerCount > 0);
      } catch (err) {
        logError('HourTransferPage: federation directory probe failed', err);
        if (!cancelled) setDirectoryAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePeerSelected = (peer: FederationPeer) => {
    setSelectedPeer(peer);
    setDestinationSlug(peer.slug);
  };

  const handleClearPeer = () => {
    setSelectedPeer(null);
    setDestinationSlug('');
  };

  if (!hasFeature('caring_community')) {
    return <Navigate to={tenantPath('/caring-community')} replace />;
  }

  const hoursValue = parseFloat(hours);
  const canSubmit =
    destinationSlug.trim().length > 0 &&
    !Number.isNaN(hoursValue) &&
    hoursValue > 0 &&
    !submitting;

  const handleSubmit = async () => {
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const res = await api.post<InitiateResponse>('/v2/caring-community/hour-transfer/initiate', {
        destination_tenant_slug: destinationSlug.trim(),
        hours: hoursValue,
        reason: reason.trim(),
      });
      if (res.success) {
        setSuccess(true);
        setDestinationSlug('');
        setHours('');
        setReason('');
        void loadHistory();
      } else {
        const code = res.code;
        if (code === 'NO_MATCHING_EMAIL') {
          setError(t('hour_transfer.errors.no_matching_email'));
        } else if (code === 'DESTINATION_NOT_FOUND') {
          setError(t('hour_transfer.errors.destination_not_found'));
        } else if (code === 'INSUFFICIENT_HOURS') {
          setError(t('hour_transfer.errors.insufficient_hours'));
        } else {
          setError(t('hour_transfer.errors.submit_failed'));
        }
      }
    } catch (err) {
      logError('HourTransferPage: submit failed', err);
      setError(t('hour_transfer.errors.submit_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PageMeta
        title={t('hour_transfer.meta.title')}
        description={t('hour_transfer.meta.description')}
        noIndex
      />
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link
            to={tenantPath('/caring-community')}
            className="inline-flex items-center gap-1 text-sm text-theme-muted hover:text-theme-primary"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('hour_transfer.back')}
          </Link>
        </div>

        <GlassCard className="p-6 sm:p-8">
          <div className="mb-7 flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15">
              <ArrowRightLeft className="h-6 w-6 text-accent" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold leading-tight text-theme-primary">
                {t('hour_transfer.title')}
              </h1>
              <p className="mt-1 text-base leading-7 text-theme-muted">
                {t('hour_transfer.subtitle')}
              </p>
            </div>
          </div>

          {success && (
            <div className="mb-6 flex items-start gap-3 rounded-lg bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <p>{t('hour_transfer.success_message')}</p>
            </div>
          )}

          <div className="space-y-5">
            {directoryAvailable === true ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-theme-primary">
                  {t('hour_transfer.form.destination_label')}
                </p>
                <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-secondary px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    {selectedPeer ? (
                      <>
                        <p className="text-sm font-semibold text-theme-primary">
                          <span className="text-theme-muted font-normal">
                            {tCaring('federation_picker.selected_label')}{' '}
                          </span>
                          {selectedPeer.display_name}
                        </p>
                        <p className="mt-0.5 text-xs text-theme-muted">
                          {[selectedPeer.region, selectedPeer.slug]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </>
                    ) : (
                      <p className="text-sm text-theme-muted">
                        {tCaring('federation_picker.no_selection')}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedPeer && (
                      <Button size="sm" variant="flat" onPress={handleClearPeer}>
                        {tCaring('federation_picker.cancel_button')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      color="primary"
                      variant="bordered"
                      startContent={<Globe className="h-4 w-4" aria-hidden="true" />}
                      onPress={() => setPickerOpen(true)}
                    >
                      {tCaring('federation_picker.browse_button')}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-theme-muted">
                  {t('hour_transfer.form.destination_help')}
                </p>
              </div>
            ) : (
              <Input
                label={
                  directoryAvailable === false
                    ? tCaring('federation_picker.fallback_label')
                    : t('hour_transfer.form.destination_label')
                }
                placeholder={t('hour_transfer.form.destination_placeholder')}
                description={
                  directoryAvailable === false
                    ? tCaring('federation_picker.empty')
                    : t('hour_transfer.form.destination_help')
                }
                value={destinationSlug}
                onValueChange={setDestinationSlug}
                variant="bordered"
                isRequired
              />
            )}
            <Input
              type="number"
              label={t('hour_transfer.form.hours_label')}
              placeholder={t('hour_transfer.form.hours_placeholder')}
              value={hours}
              onValueChange={setHours}
              variant="bordered"
              min="0.01"
              step="0.5"
              isRequired
            />
            <Textarea
              label={t('hour_transfer.form.reason_label')}
              placeholder={t('hour_transfer.form.reason_placeholder')}
              value={reason}
              onValueChange={setReason}
              variant="bordered"
              minRows={2}
              maxRows={5}
            />

            <p className="rounded-lg bg-surface-secondary px-4 py-3 text-sm text-theme-muted">
              {t('hour_transfer.disclaimer')}
            </p>

            {error && (
              <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">{error}</p>
            )}

            <Button
              color="primary"
              size="lg"
              className="w-full text-base"
              isLoading={submitting}
              isDisabled={!canSubmit}
              onPress={() => void handleSubmit()}
            >
              {submitting ? t('hour_transfer.form.submitting') : t('hour_transfer.form.submit')}
            </Button>
          </div>
        </GlassCard>

        <GlassCard className="p-6 sm:p-8">
          <h2 className="mb-4 text-lg font-semibold text-theme-primary">
            {t('hour_transfer.history.title')}
          </h2>

          {historyLoading ? (
            <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-8">
              <Spinner size="md" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-sm text-theme-muted">{t('hour_transfer.history.empty')}</p>
          ) : (
            <Table aria-label={t('hour_transfer.history.aria')} mobileCards removeWrapper>
              <TableHeader>
                <TableColumn>{t('hour_transfer.history.date')}</TableColumn>
                <TableColumn>{t('hour_transfer.history.destination')}</TableColumn>
                <TableColumn align="end">{t('hour_transfer.history.hours')}</TableColumn>
                <TableColumn>{t('hour_transfer.history.status')}</TableColumn>
                <TableColumn>{t('hour_transfer.history.reason')}</TableColumn>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-theme-muted">
                      {formatDate(row.created_at)}
                    </TableCell>
                    <TableCell>{row.destination_tenant_slug}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.hours.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" variant="flat" color={STATUS_COLOR[row.status] ?? 'default'}>
                        {t(`hour_transfer.status.${row.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell className="text-theme-muted">
                      {row.reason ? row.reason : t('empty_dash')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </GlassCard>
      </div>

      <FederationCommunityPicker
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handlePeerSelected}
      />
    </>
  );
}

export default HourTransferPage;
