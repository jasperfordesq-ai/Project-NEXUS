// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ShiftSwapRequestModal — the website's "ask to swap" flow.
 *
 * Mirrors the phone app (2026-08-24): the volunteer picks the SHIFT they would
 * rather do, and the server works out who holds it and asks them. The requester
 * never sees a name unless the other person agrees. Nothing new is exposed —
 * `signup_count` per shift is already public on the opportunity's shift list,
 * so "someone is on that shift" is information the member already has.
 *
 * Until this existed, answering a swap worked on the website but asking for one
 * did not, and the swaps tab's own empty state pointed at a page that was never
 * built.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Calendar from 'lucide-react/icons/calendar';
import { Button } from '@/components/ui/Button';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

/** The volunteer's own confirmed shift — the one they want to give up. */
export interface SwapSourceShift {
  id: number;
  opportunity_id: number;
  opportunity_title: string;
  start_time: string;
  end_time: string;
}

/** A shift on the same opportunity, as `GET /v2/volunteering/opportunities/{id}/shifts` returns it. */
interface CandidateShift {
  id: number;
  start_time: string;
  end_time: string;
  signup_count?: number;
}

interface ShiftSwapRequestModalProps {
  /** The shift being swapped away, or null when the modal is closed. */
  shift: SwapSourceShift | null;
  onClose: () => void;
  /** Called after the request has been accepted by the server. */
  onSent?: () => void;
}

/* ───────────────────────── Helpers ───────────────────────── */

const newIdempotencyKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `swap-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
};

const formatDate = (iso: string) => new Date(iso).toLocaleDateString(getFormattingLocale());

const formatTimeRange = (startIso: string, endIso: string) => {
  const locale = getFormattingLocale();
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  return `${new Date(startIso).toLocaleTimeString(locale, opts)} – ${new Date(endIso).toLocaleTimeString(locale, opts)}`;
};

/** Only shifts the member could actually swap onto: in the future, not their own, with someone on them. */
const swappableOptions = (candidates: CandidateShift[], ownShiftId: number): CandidateShift[] => {
  const now = Date.now();
  return candidates.filter((candidate) => (
    candidate.id !== ownShiftId
    && (candidate.signup_count ?? 0) > 0
    && new Date(candidate.start_time).getTime() > now
  ));
};

const isNetworkFailure = (err: unknown): boolean => err instanceof Error && !('status' in err);

/* ───────────────────────── Component ───────────────────────── */

export function ShiftSwapRequestModal({ shift, onClose, onSent }: ShiftSwapRequestModalProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [options, setOptions] = useState<CandidateShift[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sendingFor, setSendingFor] = useState<number | null>(null);

  // Stable refs so the load effect does not re-run when i18n or the toast provider re-renders.
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const sendingRef = useRef(false);
  const loadRequest = useRef(0);

  const shiftId = shift?.id ?? null;
  const opportunityId = shift?.opportunity_id ?? null;

  useEffect(() => {
    if (shiftId === null || opportunityId === null) {
      setOptions(null);
      setLoadError(null);
      return;
    }
    const request = ++loadRequest.current;
    setOptions(null);
    setLoadError(null);

    (async () => {
      try {
        const response = await api.get<CandidateShift[]>(`/v2/volunteering/opportunities/${opportunityId}/shifts`);
        if (request !== loadRequest.current) return;
        if (!response.success) {
          setLoadError(tRef.current('swaps.options_error'));
          setOptions([]);
          return;
        }
        const raw: unknown = response.data;
        const wrapped = (raw as { shifts?: unknown } | null | undefined)?.shifts;
        const list = Array.isArray(raw)
          ? (raw as CandidateShift[])
          : Array.isArray(wrapped)
            ? (wrapped as CandidateShift[])
            : [];
        setOptions(swappableOptions(list, shiftId));
      } catch (err) {
        if (request !== loadRequest.current) return;
        logError('Failed to load shifts for swap', err);
        setLoadError(tRef.current('swaps.options_error'));
        setOptions([]);
      }
    })();
  }, [shiftId, opportunityId]);

  const handleClose = () => {
    if (sendingRef.current) return;
    loadRequest.current += 1;
    onClose();
  };

  const handleRequest = async (target: CandidateShift) => {
    if (!shift || sendingRef.current) return;
    sendingRef.current = true;
    setSendingFor(target.id);

    // One key per attempt: the server binds it to this exact (from, to) pair, so a
    // retry after a lost response replays the same request instead of creating a second.
    const payload = {
      from_shift_id: shift.id,
      to_shift_id: target.id,
      idempotency_key: newIdempotencyKey(),
    };
    const send = () => api.post<{ id: number }>('/v2/volunteering/swaps', payload);

    try {
      let response: Awaited<ReturnType<typeof send>>;
      try {
        response = await send();
      } catch (err) {
        if (!isNetworkFailure(err)) throw err;
        response = await send();
      }

      if (response.success) {
        toastRef.current.success(tRef.current('swaps.request_sent'));
        onSent?.();
        onClose();
      } else {
        const reason = response.errors?.[0]?.message || response.error || tRef.current('swaps.request_error');
        toastRef.current.error(reason);
      }
    } catch (err) {
      logError('Failed to request shift swap', err);
      toastRef.current.error(tRef.current('swaps.request_error'));
    } finally {
      sendingRef.current = false;
      setSendingFor(null);
    }
  };

  return (
    <Modal
      isOpen={shift !== null}
      onOpenChange={(open) => { if (!open) handleClose(); }}
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        footer: 'border-t border-theme-default',
      }}
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="text-theme-primary">
              <span className="flex items-center gap-2">
                <ArrowLeftRight className="w-5 h-5 text-accent" aria-hidden="true" />
                {t('swaps.ask_title')}
              </span>
            </ModalHeader>
            <ModalBody>
              {shift && (
                <div className="rounded-lg bg-theme-hover/50 p-3" data-testid="shift-swap-own">
                  <p className="text-xs font-medium text-theme-muted mb-1">{t('swaps.your_shift')}</p>
                  <p className="text-sm font-semibold text-theme-primary">{shift.opportunity_title}</p>
                  <p className="flex items-center gap-1 text-xs text-theme-subtle mt-1">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {formatDate(shift.start_time)} · {formatTimeRange(shift.start_time, shift.end_time)}
                  </p>
                </div>
              )}

              <p className="text-sm text-theme-secondary">{t('swaps.ask_body')}</p>

              {options === null && !loadError && (
                <div className="flex justify-center py-6" role="status" aria-busy="true">
                  <Spinner size="sm" />
                </div>
              )}

              {loadError && (
                <p className="flex items-start gap-2 text-sm text-[var(--color-warning)]" role="alert">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
                  {loadError}
                </p>
              )}

              {options !== null && !loadError && options.length === 0 && (
                <p className="text-sm text-theme-muted" data-testid="shift-swap-no-options">
                  {t('swaps.ask_empty')}
                </p>
              )}

              {options !== null && !loadError && options.length > 0 && (
                <div className="flex flex-col gap-2" role="list">
                  {options.map((option) => {
                    const date = formatDate(option.start_time);
                    return (
                      <div key={option.id} role="listitem">
                        <Button
                          variant="secondary"
                          fullWidth
                          className="justify-start"
                          isDisabled={sendingFor !== null && sendingFor !== option.id}
                          isLoading={sendingFor === option.id}
                          onPress={() => { void handleRequest(option); }}
                          aria-label={t('swaps.ask_option_label', { date })}
                          data-testid={`shift-swap-option-${option.id}`}
                          startContent={<Calendar className="w-4 h-4" aria-hidden="true" />}
                        >
                          {date} · {formatTimeRange(option.start_time, option.end_time)}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={close} isDisabled={sendingFor !== null}>
                {t('cancel')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default ShiftSwapRequestModal;
