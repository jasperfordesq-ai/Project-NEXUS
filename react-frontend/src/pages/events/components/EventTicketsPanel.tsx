// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Archive from 'lucide-react/icons/archive';
import CirclePause from 'lucide-react/icons/circle-pause';
import CirclePlay from 'lucide-react/icons/circle-play';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Ticket from 'lucide-react/icons/ticket';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts/ToastContext';
import {
  eventTicketsApi,
  type EventTicketCatalogue,
  type EventTicketEntitlement,
  type EventTicketType,
  type EventTicketTypePayload,
} from '@/lib/event-tickets-api';
import { eventIsoToLocalInput, eventLocalInputToIso } from '@/lib/eventLocalDateTime';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

interface TicketDraft {
  name: string;
  description: string;
  kind: 'free' | 'time_credit';
  price: string;
  allocation: string;
  perMember: string;
  salesOpen: string;
  salesClose: string;
  refundCutoff: string;
  approvedOnly: boolean;
  accountAgeDays: string;
  groupIds: string;
  organizerRefundable: boolean;
}

function key(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
}

function defaultDraft(eventStart: string, timeZone: string): TicketDraft {
  const start = new Date(eventStart);
  const closes = new Date(start.getTime() - 5 * 60 * 1000);
  const nowMinusFiveMinutes = Date.now() - 5 * 60 * 1000;
  const opens = new Date(Math.min(nowMinusFiveMinutes, closes.getTime() - 60 * 60 * 1000));
  const refund = new Date(start.getTime() - 24 * 60 * 60 * 1000);

  return {
    name: '',
    description: '',
    kind: 'free',
    price: '0.00',
    allocation: '50',
    perMember: '1',
    salesOpen: eventIsoToLocalInput(opens.toISOString(), timeZone),
    salesClose: eventIsoToLocalInput(closes.toISOString(), timeZone),
    refundCutoff: eventIsoToLocalInput(refund.toISOString(), timeZone),
    approvedOnly: true,
    accountAgeDays: '0',
    groupIds: '',
    organizerRefundable: true,
  };
}

export function EventTicketsPanel({
  eventId,
  eventStart,
  eventTimezone,
}: {
  eventId: number;
  eventStart: string;
  eventTimezone: string;
}) {
  const { t } = useTranslation('event_tickets');
  const toast = useToast();
  const [catalogue, setCatalogue] = useState<EventTicketCatalogue | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingType, setEditingType] = useState<EventTicketType | null>(null);
  const [draft, setDraft] = useState(() => defaultDraft(eventStart, eventTimezone));
  const [formError, setFormError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<EventTicketEntitlement | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [typeAction, setTypeAction] = useState<{
    type: EventTicketType;
    action: 'pause' | 'archive';
  } | null>(null);
  const [typeActionReason, setTypeActionReason] = useState('');
  const [reconciliationWarnings, setReconciliationWarnings] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setState('loading');
    try {
      const response = await eventTicketsApi.get(eventId, { signal: controller.signal });
      if (!response.success || !response.data) throw new Error(response.code ?? 'ticket_load_failed');
      setCatalogue(response.data);
      setState('ready');
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load Event tickets', error);
      setCatalogue(null);
      setState('error');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);

  const names = useMemo(() => new Map(
    catalogue?.ticket_types.map((type) => [type.id, type.name]) ?? [],
  ), [catalogue]);

  const payload = (): EventTicketTypePayload | null => {
    const opens = eventLocalInputToIso(draft.salesOpen, eventTimezone);
    const closes = eventLocalInputToIso(draft.salesClose, eventTimezone);
    const refund = draft.kind === 'time_credit' && draft.refundCutoff
      ? eventLocalInputToIso(draft.refundCutoff, eventTimezone)
      : null;
    const allocation = Number(draft.allocation);
    const perMember = Number(draft.perMember);
    const accountAge = Number(draft.accountAgeDays);
    const groupIds = draft.groupIds.trim() === '' ? [] : draft.groupIds
      .split(',')
      .map((value) => Number(value.trim()));
    if (!draft.name.trim() || !opens || !closes
      || (draft.kind === 'time_credit' && draft.refundCutoff && !refund)
      || !Number.isInteger(allocation) || allocation < 1
      || !Number.isInteger(perMember) || perMember < 1 || perMember > allocation
      || !Number.isInteger(accountAge) || accountAge < 0
      || groupIds.some((id) => !Number.isInteger(id) || id < 1)
      || (draft.kind === 'free' && Number(draft.price) !== 0)
      || (draft.kind === 'time_credit' && Number(draft.price) <= 0)) {
      return null;
    }

    return {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      kind: draft.kind,
      unit_price_credits: draft.kind === 'free' ? '0.00' : Number(draft.price).toFixed(2),
      allocation_limit: allocation,
      sales_opens_at: opens,
      sales_closes_at: closes,
      per_member_limit: perMember,
      eligibility_policy: {
        approved_member_required: draft.approvedOnly,
        minimum_account_age_days: accountAge,
        required_group_ids: groupIds,
      },
      refund_cutoff_at: refund,
      organizer_cancel_refundable: draft.kind === 'time_credit' && draft.organizerRefundable,
    };
  };

  const saveType = async () => {
    const data = payload();
    if (!data) {
      setFormError(t('tickets.validation_error'));
      return;
    }
    setBusy('save-type');
    setFormError(null);
    try {
      const response = editingType
        ? await eventTicketsApi.updateType(
          eventId,
          editingType.id,
          editingType.version,
          data,
          key('ticket-type-update'),
        )
        : await eventTicketsApi.createType(eventId, data, key('ticket-type-create'));
      if (!response.success) throw new Error(response.code ?? 'ticket_create_failed');
      toast.success(t(editingType ? 'tickets.updated' : 'tickets.created'));
      setEditorOpen(false);
      setEditingType(null);
      setDraft(defaultDraft(eventStart, eventTimezone));
      await load();
    } catch (error) {
      logError('Failed to create Event ticket type', error);
      setFormError(t('tickets.save_error'));
    } finally {
      setBusy(null);
    }
  };

  const editType = (type: EventTicketType) => {
    const policy = type.eligibility_policy;
    setEditingType(type);
    setDraft({
      name: type.name,
      description: type.description ?? '',
      kind: type.kind,
      price: type.unit_price_credits,
      allocation: String(type.allocation_limit),
      perMember: String(type.per_member_limit),
      salesOpen: eventIsoToLocalInput(type.sales_opens_at, eventTimezone),
      salesClose: eventIsoToLocalInput(type.sales_closes_at, eventTimezone),
      refundCutoff: eventIsoToLocalInput(type.refund_cutoff_at, eventTimezone),
      approvedOnly: policy?.approved_member_required ?? true,
      accountAgeDays: String(policy?.minimum_account_age_days ?? 0),
      groupIds: policy?.required_group_ids.join(', ') ?? '',
      organizerRefundable: type.organizer_cancel_refundable,
    });
    setFormError(null);
    setEditorOpen(true);
  };

  const transition = async (
    type: EventTicketType,
    action: 'activate' | 'pause' | 'archive',
    suppliedReason: string | null = null,
  ) => {
    const reason = action === 'activate' ? null : suppliedReason?.trim() || null;
    setBusy(`${action}-${type.id}`);
    try {
      const response = await eventTicketsApi.transitionType(
        eventId,
        type.id,
        action,
        type.version,
        reason,
        key(`ticket-type-${action}`),
      );
      if (!response.success) throw new Error(response.code ?? 'ticket_transition_failed');
      toast.success(t(`tickets.${action}d`));
      setTypeAction(null);
      setTypeActionReason('');
      await load();
    } catch (error) {
      logError('Failed to transition Event ticket type', error);
      toast.error(t('tickets.action_error'));
    } finally {
      setBusy(null);
    }
  };

  const allocate = async (type: EventTicketType) => {
    setBusy(`allocate-${type.id}`);
    try {
      const response = await eventTicketsApi.allocateSelf(eventId, type.id, 1, key('ticket-allocate'));
      if (!response.success) throw new Error(response.code ?? 'ticket_allocate_failed');
      toast.success(t('tickets.allocated'));
      await load();
    } catch (error) {
      logError('Failed to allocate Event ticket', error);
      toast.error(t('tickets.allocate_error'));
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    if (!cancelTarget || !cancelReason.trim()) return;
    setBusy(`cancel-${cancelTarget.id}`);
    try {
      const response = await eventTicketsApi.cancel(
        eventId,
        cancelTarget.id,
        cancelTarget.version,
        cancelReason.trim(),
        key('ticket-cancel'),
      );
      if (!response.success) throw new Error(response.code ?? 'ticket_cancel_failed');
      toast.success(t('tickets.cancelled'));
      setCancelTarget(null);
      setCancelReason('');
      await load();
    } catch (error) {
      logError('Failed to cancel Event ticket entitlement', error);
      toast.error(t('tickets.cancel_error'));
    } finally {
      setBusy(null);
    }
  };

  const reconcile = async () => {
    setBusy('reconcile');
    try {
      const response = await eventTicketsApi.reconcile(eventId);
      if (!response.success || !response.data) throw new Error(response.code ?? 'ticket_reconcile_failed');
      const warnings = response.data.ticket_types.filter((row) => (
        row.allocation_overrun
        || row.inventory_mismatch
        || row.registration_mismatches > 0
        || row.price_snapshot_violations > 0
      )).length;
      setReconciliationWarnings(warnings);
      toast.success(t('tickets.reconciliation_complete'));
    } catch (error) {
      logError('Failed to reconcile Event tickets', error);
      toast.error(t('tickets.reconciliation_error'));
    } finally {
      setBusy(null);
    }
  };

  if (state === 'loading') {
    return <div className="flex min-h-40 items-center justify-center" role="status"><Spinner label={t('tickets.loading')} /></div>;
  }
  if (state === 'error' || !catalogue) {
    return (
      <Card><CardBody className="items-start gap-4 p-6">
        <p className="text-danger">{t('tickets.load_error')}</p>
        <Button variant="secondary" onPress={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />{t('tickets.retry')}</Button>
      </CardBody></Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2"><Ticket className="h-5 w-5 text-primary" aria-hidden="true" /><h2 className="text-xl font-semibold">{t('tickets.title')}</h2></div>
          <p className="mt-1 text-sm text-default-600">{t('tickets.subtitle')}</p>
        </div>
        {catalogue.permissions.manage && (
          <div className="flex flex-wrap gap-2">
            {catalogue.permissions.reconcile && <Button variant="secondary" isLoading={busy === 'reconcile'} onPress={() => void reconcile()}>{t('tickets.reconcile')}</Button>}
            <Button variant="primary" onPress={() => { setEditingType(null); setDraft(defaultDraft(eventStart, eventTimezone)); setEditorOpen(true); }}><Plus className="h-4 w-4" aria-hidden="true" />{t('tickets.add_type')}</Button>
          </div>
        )}
      </div>

      {!catalogue.payment_gateway.time_credit_supported && (
        <Card className="border border-warning/30 bg-warning/5"><CardBody className="flex-row items-start gap-3 p-4">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden="true" />
          <div><p className="font-medium">{t('tickets.gateway_title')}</p><p className="text-sm text-default-600">{t('tickets.gateway_notice')}</p></div>
        </CardBody></Card>
      )}

      {reconciliationWarnings !== null && (
        <p className={reconciliationWarnings === 0 ? 'text-sm text-success' : 'text-sm text-warning'} role="status">
          {reconciliationWarnings === 0
            ? t('tickets.reconciliation_clear')
            : t('tickets.reconciliation_warnings', { count: reconciliationWarnings })}
        </p>
      )}

      {catalogue.ticket_types.length === 0 ? (
        <Card><CardBody className="p-6 text-sm text-default-600">{t('tickets.empty')}</CardBody></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {catalogue.ticket_types.map((type) => {
            const available = type.availability.eligibility.eligible
              && type.availability.sales_window_open
              && type.availability.materialization_supported
              && type.availability.allocation_remaining > 0
              && type.availability.member_remaining > 0
              && catalogue.permissions.allocate_self;
            return (
              <Card key={type.id}>
                <CardBody className="gap-4 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div><h3 className="font-semibold">{type.name}</h3>{type.description && <p className="mt-1 text-sm text-default-600">{type.description}</p>}</div>
                    <Chip size="sm" variant="soft">{t(`tickets.status.${type.status}`)}</Chip>
                  </div>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-default-500">{t('tickets.kind_label')}</dt><dd className="font-medium">{t(`tickets.kind.${type.kind}`)}</dd></div>
                    <div><dt className="text-default-500">{t('tickets.remaining')}</dt><dd className="font-medium tabular-nums">{new Intl.NumberFormat(getFormattingLocale()).format(type.availability.allocation_remaining)}</dd></div>
                    <div><dt className="text-default-500">{t('tickets.per_member')}</dt><dd className="font-medium tabular-nums">{type.per_member_limit}</dd></div>
                    <div><dt className="text-default-500">{t('tickets.price')}</dt><dd className="font-medium tabular-nums">{type.kind === 'free' ? t('tickets.free') : t('tickets.credit_price', { value: type.unit_price_credits })}</dd></div>
                  </dl>
                  {!type.availability.materialization_supported && <p className="text-sm text-warning">{t('tickets.not_purchasable')}</p>}
                  {catalogue.permissions.manage ? (
                    <div className="flex flex-wrap gap-2">
                      {(type.status === 'draft' || type.status === 'paused') && <Button size="sm" variant="secondary" onPress={() => editType(type)}><Pencil className="h-4 w-4" aria-hidden="true" />{t('tickets.edit')}</Button>}
                      {(type.status === 'draft' || type.status === 'paused') && <Button size="sm" variant="secondary" isDisabled={type.kind === 'time_credit' && !catalogue.payment_gateway.time_credit_supported} isLoading={busy === `activate-${type.id}`} onPress={() => void transition(type, 'activate')}><CirclePlay className="h-4 w-4" aria-hidden="true" />{t('tickets.activate')}</Button>}
                      {type.status === 'active' && <Button size="sm" variant="secondary" isLoading={busy === `pause-${type.id}`} onPress={() => setTypeAction({ type, action: 'pause' })}><CirclePause className="h-4 w-4" aria-hidden="true" />{t('tickets.pause')}</Button>}
                      {type.status !== 'archived' && <Button size="sm" variant="danger-soft" isLoading={busy === `archive-${type.id}`} onPress={() => setTypeAction({ type, action: 'archive' })}><Archive className="h-4 w-4" aria-hidden="true" />{t('tickets.archive')}</Button>}
                    </div>
                  ) : (
                    <Button variant="primary" isDisabled={!available || busy !== null} isLoading={busy === `allocate-${type.id}`} onPress={() => void allocate(type)}>{t('tickets.reserve')}</Button>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {catalogue.own_entitlements.length > 0 && (
        <section aria-labelledby="event-own-tickets"><h3 id="event-own-tickets" className="mb-3 text-lg font-semibold">{t('tickets.yours')}</h3>
          <div className="space-y-2">{catalogue.own_entitlements.map((entitlement) => (
            <Card key={entitlement.id}><CardBody className="flex-row items-center justify-between gap-4 p-4">
              <div><p className="font-medium">{names.get(entitlement.ticket_type_id) ?? t('tickets.ticket_fallback')}</p><p className="text-sm text-default-600">{t('tickets.units', { count: entitlement.units })}</p></div>
              {entitlement.status === 'confirmed' && entitlement.kind === 'free'
                ? <Button size="sm" variant="danger-soft" onPress={() => setCancelTarget(entitlement)}>{t('tickets.cancel')}</Button>
                : entitlement.status === 'confirmed'
                  ? <p className="max-w-sm text-sm text-default-600">{t('tickets.time_credit_cancel_disabled')}</p>
                  : <Chip size="sm" variant="soft">{t('tickets.cancelled')}</Chip>}
            </CardBody></Card>
          ))}</div>
        </section>
      )}

      <TicketTypeEditor
        isOpen={editorOpen}
        editing={editingType !== null}
        draft={draft}
        setDraft={setDraft}
        error={formError}
        isSaving={busy === 'save-type'}
        timeZone={eventTimezone}
        onClose={() => { setEditorOpen(false); setEditingType(null); setFormError(null); }}
        onSave={() => void saveType()}
        t={t}
      />
      <Modal isOpen={cancelTarget !== null} onClose={() => setCancelTarget(null)}>
        <ModalContent><ModalHeader>{t('tickets.cancel_title')}</ModalHeader><ModalBody><Textarea label={t('tickets.cancel_reason')} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} isRequired maxLength={500} /></ModalBody><ModalFooter><Button variant="secondary" onPress={() => setCancelTarget(null)}>{t('tickets.keep')}</Button><Button variant="danger" isDisabled={!cancelReason.trim()} isLoading={busy?.startsWith('cancel-')} onPress={() => void cancel()}>{t('tickets.confirm_cancel')}</Button></ModalFooter></ModalContent>
      </Modal>
      <Modal isOpen={typeAction !== null} onClose={() => setTypeAction(null)}>
        <ModalContent>
          <ModalHeader>{t(`tickets.${typeAction?.action ?? 'pause'}_title`)}</ModalHeader>
          <ModalBody>
            <Textarea
              label={t('tickets.action_reason')}
              value={typeActionReason}
              onChange={(event) => setTypeActionReason(event.target.value)}
              isRequired
              maxLength={500}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setTypeAction(null)}>{t('tickets.keep')}</Button>
            <Button
              variant={typeAction?.action === 'archive' ? 'danger' : 'primary'}
              isDisabled={!typeActionReason.trim()}
              isLoading={typeAction ? busy === `${typeAction.action}-${typeAction.type.id}` : false}
              onPress={() => {
                if (typeAction) void transition(typeAction.type, typeAction.action, typeActionReason);
              }}
            >
              {t(`tickets.confirm_${typeAction?.action ?? 'pause'}`)}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function TicketTypeEditor({ isOpen, editing, draft, setDraft, error, isSaving, timeZone, onClose, onSave, t }: {
  isOpen: boolean;
  editing: boolean;
  draft: TicketDraft;
  setDraft: React.Dispatch<React.SetStateAction<TicketDraft>>;
  error: string | null;
  isSaving: boolean;
  timeZone: string;
  onClose: () => void;
  onSave: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent><ModalHeader>{t(editing ? 'tickets.editor_edit_title' : 'tickets.editor_title')}</ModalHeader><ModalBody className="space-y-4">
        {error && <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">{error}</p>}
        <Input label={t('tickets.name')} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} isRequired maxLength={191} />
        <Textarea label={t('tickets.description')} value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={10000} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label={t('tickets.kind_label')} selectedKeys={new Set([draft.kind])} onSelectionChange={(keys) => { const value = String(Array.from(keys as Iterable<string | number>)[0] ?? 'free'); if (value === 'free' || value === 'time_credit') setDraft((current) => ({ ...current, kind: value, price: value === 'free' ? '0.00' : current.price === '0.00' ? '1.00' : current.price })); }}>
            <SelectItem id="free">{t('tickets.kind.free')}</SelectItem><SelectItem id="time_credit">{t('tickets.kind.time_credit')}</SelectItem>
          </Select>
          <Input type="number" min="0" step="0.01" label={t('tickets.price')} value={draft.price} isDisabled={draft.kind === 'free'} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} />
          <Input type="number" min="1" label={t('tickets.allocation')} value={draft.allocation} onChange={(event) => setDraft((current) => ({ ...current, allocation: event.target.value }))} />
          <Input type="number" min="1" label={t('tickets.per_member')} value={draft.perMember} onChange={(event) => setDraft((current) => ({ ...current, perMember: event.target.value }))} />
          <Input type="datetime-local" label={t('tickets.sales_open')} value={draft.salesOpen} onChange={(event) => setDraft((current) => ({ ...current, salesOpen: event.target.value }))} isRequired />
          <Input type="datetime-local" label={t('tickets.sales_close')} value={draft.salesClose} onChange={(event) => setDraft((current) => ({ ...current, salesClose: event.target.value }))} isRequired />
          {draft.kind === 'time_credit' && <Input type="datetime-local" label={t('tickets.refund_cutoff')} value={draft.refundCutoff} onChange={(event) => setDraft((current) => ({ ...current, refundCutoff: event.target.value }))} />}
          <Input type="number" min="0" label={t('tickets.account_age')} value={draft.accountAgeDays} onChange={(event) => setDraft((current) => ({ ...current, accountAgeDays: event.target.value }))} />
        </div>
        <p className="text-xs text-default-500">{t('tickets.timezone_hint', { timezone: timeZone })}</p>
        <Input label={t('tickets.group_ids')} description={t('tickets.group_ids_hint')} value={draft.groupIds} onChange={(event) => setDraft((current) => ({ ...current, groupIds: event.target.value }))} />
        <Checkbox isSelected={draft.approvedOnly} onValueChange={(value) => setDraft((current) => ({ ...current, approvedOnly: value }))}>{t('tickets.approved_only')}</Checkbox>
        {draft.kind === 'time_credit' && <Checkbox isSelected={draft.organizerRefundable} onValueChange={(value) => setDraft((current) => ({ ...current, organizerRefundable: value }))}>{t('tickets.organizer_refundable')}</Checkbox>}
        {draft.kind === 'time_credit' && <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">{t('tickets.time_credit_draft_warning')}</p>}
      </ModalBody><ModalFooter><Button variant="secondary" isDisabled={isSaving} onPress={onClose}>{t('tickets.close')}</Button><Button variant="primary" isLoading={isSaving} onPress={onSave}>{t(editing ? 'tickets.save' : 'tickets.create')}</Button></ModalFooter></ModalContent>
    </Modal>
  );
}
