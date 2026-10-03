// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Exchange resolution — the broker actions that close an exchange after the
 * members have finished: settling a DISPUTED exchange (pay the hours the broker
 * decides, or close it with no hours when the work never happened) and
 * reversing a COMPLETED one. The settle and reverse endpoints existed
 * server-side (ExchangeWorkflowService::resolveDispute / ::reverseCompletedExchange)
 * with no screen behind them, so the dashboard counted disputes as "needs
 * action" while the broker had nothing to press.
 *
 * The server stays the authority: it refuses a party to the exchange, refuses
 * credits of staff at or above the broker's level, requires the note, and clamps
 * the hours to `dispute_window` — the same range this form offers.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  CardBody,
  Chip,
  Description,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  NumberField,
  Textarea,
} from '@/components/ui';
import Scale from 'lucide-react/icons/scale';
import Ban from 'lucide-react/icons/ban';
import Undo2 from 'lucide-react/icons/undo-2';
import Info from 'lucide-react/icons/info';
import { adminBroker } from '@/admin/api/adminApi';
import type { ExchangeDetail } from '@/admin/api/types';
import { useToast } from '@/contexts';

type Exchange = ExchangeDetail['exchange'];

const toHours = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** True when a refusal means "a member is staff at or above your level". */
const isRankRefusal = (code?: string) => code === 'AUTH_INSUFFICIENT_PERMISSIONS';

// ─────────────────────────────────────────────────────────────────────────────
// Settle a dispute
// ─────────────────────────────────────────────────────────────────────────────

export function DisputeSettlePanel({
  exchange,
  window: range,
  onDone,
}: {
  exchange: Exchange;
  window: { min_hours: number; max_hours: number };
  onDone: () => void;
}) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const agreed = toHours(exchange.proposed_hours);
  const requesterSays = toHours(exchange.requester_confirmed_hours);
  const providerSays = toHours(exchange.provider_confirmed_hours);

  const [open, setOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [hours, setHours] = useState<number>(clamp(agreed ?? range.min_hours, range.min_hours, range.max_hours));
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const hoursLabel = (count: number) => t('exchanges.settle_hours_value', { count });

  const hoursValid = Number.isFinite(hours) && hours >= range.min_hours && hours <= range.max_hours;
  const canSubmit = hoursValid && notes.trim() !== '' && !saving;

  const quickPicks = [
    { key: 'agreed', label: t('exchanges.settle_pick_agreed'), value: agreed },
    { key: 'requester', label: exchange.requester_name, value: requesterSays },
    { key: 'provider', label: exchange.provider_name, value: providerSays },
  ].filter((p): p is { key: string; label: string; value: number } => p.value !== null);

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const res = await adminBroker.resolveDispute(exchange.id, hours, notes.trim());
      if (res?.success) {
        toast.success(t('exchanges.settle_success', { amount: hoursLabel(res.data?.final_hours ?? hours) }));
        setOpen(false);
        onDone();
      } else {
        toast.error(isRankRefusal(res?.code) ? t('exchanges.resolution_rank_refused') : t('exchanges.settle_failed'));
      }
    } catch {
      toast.error(t('exchanges.settle_failed'));
    } finally {
      setSaving(false);
    }
  };

  const submitCancel = async () => {
    if (!cancelReason.trim() || saving) return;
    setSaving(true);
    try {
      const res = await adminBroker.cancelDispute(exchange.id, cancelReason.trim());
      if (res?.success) {
        toast.success(t('exchanges.settle_cancel_success'));
        setCancelOpen(false);
        onDone();
      } else {
        toast.error(t('exchanges.settle_cancel_failed'));
      }
    } catch {
      toast.error(t('exchanges.settle_cancel_failed'));
    } finally {
      setSaving(false);
    }
  };

  const claim = (who: string, value: number | null) => (
    <div className="min-w-0 rounded-xl bg-surface-secondary px-4 py-3">
      <p className="truncate text-xs text-muted">{who}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">
        {value === null ? t('exchanges.settle_not_confirmed') : hoursLabel(value)}
      </p>
    </div>
  );

  return (
    <>
      <Card className="mb-6 rounded-2xl border border-warning/40 bg-warning/5 shadow-sm shadow-black/[0.03]">
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <Scale size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="font-semibold tracking-tight text-foreground">{t('exchanges.settle_title')}</h3>
              <p className="mt-1 text-sm text-foreground">{t('exchanges.settle_intro')}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {claim(t('exchanges.settle_agreed_label'), agreed)}
            {claim(t('exchanges.settle_claim_label', { name: exchange.requester_name }), requesterSays)}
            {claim(t('exchanges.settle_claim_label', { name: exchange.provider_name }), providerSays)}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="tertiary"
              startContent={<Ban size={16} aria-hidden="true" />}
              onPress={() => { setCancelReason(''); setCancelOpen(true); }}
            >
              {t('exchanges.settle_cancel_button')}
            </Button>
            <Button
              color="warning"
              startContent={<Scale size={16} aria-hidden="true" />}
              onPress={() => setOpen(true)}
            >
              {t('exchanges.settle_button')}
            </Button>
          </div>
        </CardBody>
      </Card>

      <Modal isOpen={open} onClose={() => !saving && setOpen(false)} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Scale size={20} className="text-warning" aria-hidden="true" />
            {t('exchanges.settle_modal_title')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            <NumberField
              fullWidth
              value={hours}
              onChange={(v) => setHours(v === undefined || Number.isNaN(v) ? Number.NaN : v)}
              minValue={range.min_hours}
              maxValue={range.max_hours}
              step={0.25}
              formatOptions={{ maximumFractionDigits: 2 }}
              isInvalid={!hoursValid}
              isRequired
              variant="secondary"
            >
              <Label>{t('exchanges.settle_hours_label')}</Label>
              <NumberField.Group>
                <NumberField.DecrementButton />
                <NumberField.Input className="tabular-nums" />
                <NumberField.IncrementButton />
              </NumberField.Group>
              <Description>
                {t('exchanges.settle_hours_range', { min: range.min_hours, max: range.max_hours })}
              </Description>
            </NumberField>

            {quickPicks.length > 0 && (
              <div className="flex flex-wrap gap-2" role="group" aria-label={t('exchanges.settle_picks_label')}>
                {quickPicks.map((p) => {
                  const v = clamp(p.value, range.min_hours, range.max_hours);
                  return (
                    <Button key={p.key} size="sm" variant="tertiary" onPress={() => setHours(v)}>
                      {t('exchanges.settle_pick', { who: p.label, hours: v })}
                    </Button>
                  );
                })}
              </div>
            )}

            <Textarea
              label={t('exchanges.settle_notes_label')}
              description={t('exchanges.settle_notes_hint')}
              value={notes}
              onValueChange={setNotes}
              minRows={3}
              variant="bordered"
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setOpen(false)} isDisabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button color="warning" onPress={submit} isLoading={saving} isDisabled={!canSubmit}>
              {hoursValid
                ? t('exchanges.settle_confirm', { amount: hoursLabel(hours) })
                : t('exchanges.settle_button')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={cancelOpen} onClose={() => !saving && setCancelOpen(false)} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Ban size={20} className="text-danger" aria-hidden="true" />
            {t('exchanges.settle_cancel_title')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-foreground">{t('exchanges.settle_cancel_explain')}</p>
            <Textarea
              label={t('exchanges.settle_notes_label')}
              description={t('exchanges.settle_notes_hint')}
              value={cancelReason}
              onValueChange={setCancelReason}
              minRows={3}
              variant="bordered"
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setCancelOpen(false)} isDisabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button color="danger" onPress={submitCancel} isLoading={saving} isDisabled={!cancelReason.trim() || saving}>
              {t('exchanges.settle_cancel_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Reverse a completed exchange
// ─────────────────────────────────────────────────────────────────────────────

/** Whether a completed exchange can be reversed: credits moved and not yet put back. */
export function canReverse(exchange: Exchange): boolean {
  return exchange.status === 'completed'
    && exchange.transaction_id !== null && exchange.transaction_id !== undefined
    && (exchange.reversal_transaction_id === null || exchange.reversal_transaction_id === undefined);
}

export function ReverseExchangeButton({ exchange, onDone }: { exchange: Exchange; onDone: () => void }) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!reason.trim() || saving) return;
    setSaving(true);
    try {
      const res = await adminBroker.reverseExchange(exchange.id, reason.trim());
      if (res?.success) {
        toast.success(t('exchanges.reverse_success'));
        setOpen(false);
        onDone();
      } else {
        toast.error(isRankRefusal(res?.code) ? t('exchanges.resolution_rank_refused') : t('exchanges.reverse_failed'));
      }
    } catch {
      toast.error(t('exchanges.reverse_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Button
        variant="danger-soft"
        size="sm"
        startContent={<Undo2 size={16} aria-hidden="true" />}
        onPress={() => { setReason(''); setOpen(true); }}
      >
        {t('exchanges.reverse_button')}
      </Button>
      <Modal isOpen={open} onClose={() => !saving && setOpen(false)} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Undo2 size={20} className="text-danger" aria-hidden="true" />
            {t('exchanges.reverse_modal_title')}
          </ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-foreground">{t('exchanges.reverse_explain')}</p>
            <p className="text-sm text-foreground">{t('exchanges.reverse_negative_note')}</p>
            <Textarea
              label={t('exchanges.reverse_reason_label')}
              description={t('exchanges.reverse_reason_hint')}
              value={reason}
              onValueChange={setReason}
              minRows={3}
              variant="bordered"
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => setOpen(false)} isDisabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button color="danger" onPress={submit} isLoading={saving} isDisabled={!reason.trim() || saving}>
              {t('exchanges.reverse_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export function ReversedNotice() {
  const { t } = useTranslation('broker');
  return (
    <Card className="mb-6 rounded-2xl border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
      <CardBody className="flex flex-row items-start gap-3">
        <Info size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-foreground">
            {t('exchanges.reversed_title')}{' '}
            <Chip size="sm" variant="soft" color="default" className="ml-1 align-middle">
              <Chip.Label>{t('exchanges.reversed_chip')}</Chip.Label>
            </Chip>
          </p>
          <p className="mt-1 text-sm text-foreground">{t('exchanges.reversed_body')}</p>
        </div>
      </CardBody>
    </Card>
  );
}
