// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The two audit sections of a fundraising campaign on the admin
 * Fundraising campaigns page: its permanent history, and the money passed
 * on to the organisation it raises for (record / cancel hand-overs).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Spinner, Textarea,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { formatCurrency } from '@/lib/helpers';
import { FundraisingHistoryList } from '@/components/fundraising/FundraisingHistoryList';
import { HandoverList } from '@/components/fundraising/HandoverList';
import type { Handover, HandoverListData, HandoverMethod, HistoryItem } from '@/lib/fundraisingTypes';
import { adminFundraising } from '../../api/fundraisingApi';

const METHODS: HandoverMethod[] = ['bank_transfer', 'cheque', 'cash', 'other'];

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation('fundraising');
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      <p className="text-sm text-muted">{t('load_failed')}</p>
      <Button size="sm" variant="tertiary" onPress={onRetry}>{t('retry')}</Button>
    </div>
  );
}

function Loading() {
  return (
    <div role="status" aria-busy="true" className="flex justify-center py-8">
      <Spinner size="lg" />
    </div>
  );
}

export function CampaignHistoryPanel({ givingDayId }: { givingDayId: number }) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    setItems(null);
    try {
      const res = await adminFundraising.history(givingDayId);
      if (res.success && res.data) {
        setItems(res.data.items);
      } else {
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load campaign history', err);
      setFailed(true);
    }
  }, [givingDayId]);

  useEffect(() => { void load(); }, [load]);

  if (failed) return <LoadFailed onRetry={() => void load()} />;
  if (items === null) return <Loading />;
  return <FundraisingHistoryList items={items} showStripe />;
}

interface HandoversPanelProps {
  givingDayId: number;
  /** A community-wide campaign has nobody to hand money over to. */
  hasOrganisation: boolean;
}

export function CampaignHandoversPanel({ givingDayId, hasOrganisation }: HandoversPanelProps) {
  const { t } = useTranslation('fundraising');
  const { t: tc } = useTranslation('common');
  const toast = useToast();
  const [data, setData] = useState<HandoverListData | null>(null);
  const [failed, setFailed] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [method, setMethod] = useState<HandoverMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [cancelTarget, setCancelTarget] = useState<Handover | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await adminFundraising.handovers(givingDayId);
      if (res.success && res.data) {
        setData(res.data);
      } else {
        setFailed(true);
      }
    } catch (err) {
      logError('Failed to load campaign hand-overs', err);
      setFailed(true);
    }
  }, [givingDayId]);

  useEffect(() => {
    if (hasOrganisation) void load();
  }, [hasOrganisation, load]);

  if (!hasOrganisation) {
    return <p className="py-6 text-center text-sm text-muted">{t('handovers.community_wide')}</p>;
  }
  if (failed) return <LoadFailed onRetry={() => void load()} />;
  if (data === null) return <Loading />;

  const openForm = () => {
    setAmount('');
    setDate(today());
    setMethod('bank_transfer');
    setReference('');
    setNote('');
    setFormError(null);
    setFormOpen(true);
  };

  const save = async () => {
    const value = Number(amount);
    if (value > data.summary.still_held) {
      setFormError(t('handovers.over_held', { held: formatCurrency(data.summary.still_held, data.summary.currency) }));
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const res = await adminFundraising.recordHandover(givingDayId, {
        amount: value,
        handed_over_on: date,
        method,
        reference: reference.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (res.success) {
        toast.success(t('handovers.saved'));
        setFormOpen(false);
        await load();
      } else {
        setFormError(res.error || res.errors?.[0]?.message || t('load_failed'));
      }
    } catch (err) {
      logError('Failed to record hand-over', err);
      setFormError(t('load_failed'));
    } finally {
      setSaving(false);
    }
  };

  const confirmCancel = async () => {
    if (!cancelTarget) return;
    setBusyId(cancelTarget.id);
    try {
      const res = await adminFundraising.cancelHandover(cancelTarget.id, cancelReason.trim());
      if (res.success) {
        toast.success(t('handovers.cancelled'));
        setCancelTarget(null);
        await load();
      } else {
        toast.error(res.error || res.errors?.[0]?.message || t('load_failed'));
      }
    } catch (err) {
      logError('Failed to cancel hand-over', err);
      toast.error(t('load_failed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button size="sm" onPress={openForm}>{t('handovers.record')}</Button>
      </div>

      <HandoverList
        data={data}
        busyId={busyId}
        onCancel={(handover) => { setCancelReason(''); setCancelTarget(handover); }}
      />

      <Modal isOpen={formOpen} onClose={() => { if (!saving) setFormOpen(false); }} size="md">
        <ModalContent>
          <ModalHeader>{t('handovers.record')}</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                label={t('handovers.amount')}
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onValueChange={setAmount}
                isRequired
                variant="secondary"
                endContent={<span className="text-xs font-semibold text-muted">{data.summary.currency}</span>}
              />
              <Input
                label={t('handovers.date')}
                type="date"
                max={today()}
                value={date}
                onValueChange={setDate}
                isRequired
                variant="secondary"
              />
              <Select
                label={t('handovers.method')}
                variant="secondary"
                selectedKeys={[method]}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0];
                  if (selected !== undefined) setMethod(String(selected) as HandoverMethod);
                }}
              >
                {METHODS.map((m) => (
                  <SelectItem key={m} id={m}>{t(`handovers.methods.${m}`)}</SelectItem>
                ))}
              </Select>
              <Input
                label={t('handovers.reference')}
                value={reference}
                onValueChange={setReference}
                isRequired
                variant="secondary"
              />
              <Textarea
                label={t('handovers.note')}
                value={note}
                onValueChange={setNote}
                variant="secondary"
              />
              <p className="text-xs text-muted">{t('handovers.permanent_note')}</p>
              {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setFormOpen(false)} isDisabled={saving}>{tc('cancel')}</Button>
            <Button
              onPress={() => void save()}
              isLoading={saving}
              isDisabled={!(Number(amount) > 0) || reference.trim() === '' || date === ''}
            >
              {t('handovers.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={cancelTarget !== null} onClose={() => { if (busyId === null) setCancelTarget(null); }} size="md">
        <ModalContent>
          <ModalHeader>{t('handovers.cancel_action')}</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-3">
              {cancelTarget && (
                <p className="text-sm text-foreground">
                  {formatCurrency(cancelTarget.amount, cancelTarget.currency)} · {cancelTarget.reference}
                </p>
              )}
              <Textarea
                label={t('handovers.cancel_reason')}
                value={cancelReason}
                onValueChange={setCancelReason}
                isRequired
                variant="secondary"
              />
              <p className="text-xs text-muted">{t('handovers.permanent_note')}</p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setCancelTarget(null)} isDisabled={busyId !== null}>{tc('cancel')}</Button>
            <Button
              variant="danger"
              onPress={() => void confirmCancel()}
              isLoading={busyId !== null}
              isDisabled={cancelReason.trim() === ''}
            >
              {t('handovers.cancel_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
