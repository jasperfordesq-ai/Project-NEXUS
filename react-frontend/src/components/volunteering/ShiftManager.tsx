// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ShiftManager — the organiser's (and admin's) control panel for an
 * opportunity's shifts: add a one-off shift, set up repeating shifts, change or
 * remove a shift that has not started, and stop a repeating pattern.
 *
 * Until 2026-10-06 nothing on the platform could create a shift, so every
 * feature built on shifts (sign-up, waitlists, group sign-ups, check-in,
 * reminders, swaps) had no way for a real organisation to feed it. This panel
 * is shared by the opportunity page (shown to anyone the server says
 * `can_manage`) and the admin panel's Opportunities & shifts page.
 *
 * Server contract:
 *   GET    /v2/volunteering/opportunities/{id}/shifts
 *   POST   /v2/volunteering/opportunities/{id}/shifts        {start_time, end_time, capacity?}
 *   PUT    /v2/volunteering/shifts/{id}                      {start_time?, end_time?, capacity?}
 *   DELETE /v2/volunteering/shifts/{id}
 *   GET    /v2/volunteering/opportunities/{id}/recurring-patterns
 *   POST   /v2/volunteering/opportunities/{id}/recurring-patterns
 *   DELETE /v2/volunteering/recurring-patterns/{id}          (stops it, removes future shifts)
 *   GET    /v2/volunteering/shifts/{id}/roster               (who is on it, who checked in — ShiftRosterModal)
 * Times are sent and stored as the community's local wall-clock time
 * ("YYYY-MM-DD HH:mm:ss"), the same form every existing shift uses.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseDate, today, getLocalTimeZone, type DateValue } from '@internationalized/date';
import Plus from 'lucide-react/icons/plus';
import Repeat from 'lucide-react/icons/repeat';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Calendar from 'lucide-react/icons/calendar';
import Users from 'lucide-react/icons/users';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { DatePicker } from '@/components/ui/DatePicker';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { ShiftRosterModal } from './ShiftRosterModal';

/* ───────────────────────── Types ───────────────────────── */

export interface ManagedShift {
  id: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  signup_count: number;
  reserved_count?: number;
  spots_available: number | null;
  recurring_pattern_id?: number | null;
}

export type PatternFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface RecurringPattern {
  id: number;
  title: string | null;
  frequency: PatternFrequency;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  capacity: number;
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  occurrences_generated: number;
  is_active: boolean;
}

export interface ShiftManagerProps {
  opportunityId: number;
  /** Called after anything changes, so the page can refresh its own copy of the shifts. */
  onChanged?: () => void;
  className?: string;
}

type ModalState =
  | { kind: 'shift'; shift?: ManagedShift }
  | { kind: 'pattern' }
  | { kind: 'remove'; shift: ManagedShift }
  | { kind: 'stop'; pattern: RecurringPattern }
  | null;

/* ───────────────────────── Helpers ───────────────────────── */

const FREQUENCIES: PatternFrequency[] = ['daily', 'weekly', 'biweekly', 'monthly'];
/** ISO weekday numbers, Monday first, as the server stores them. */
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

/** The server returns naive local times; the browser parses "YYYY-MM-DD HH:mm:ss" as local. */
const toDate = (value: string) => new Date(value.includes('T') ? value : value.replace(' ', 'T'));

const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeKey = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const formatDay = (value: string) =>
  toDate(value).toLocaleDateString(getFormattingLocale(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const formatTimeRange = (start: string, end: string) => {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  return `${toDate(start).toLocaleTimeString(getFormattingLocale(), opts)} – ${toDate(end).toLocaleTimeString(getFormattingLocale(), opts)}`;
};
/** "09:00:00" (a pattern's clock time) → localised "09:00". */
const formatClock = (clock: string) => {
  const [h = '0', m = '0'] = clock.split(':');
  const d = new Date(2024, 0, 1, Number(h), Number(m));
  return d.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });
};
/** Weekday names in the member's language, no translation keys needed. 2024-01-01 was a Monday. */
const weekdayName = (iso: number, style: 'short' | 'long' = 'short') =>
  new Date(2024, 0, iso).toLocaleDateString(getFormattingLocale(), { weekday: style });

const errorMessage = (response: { errors?: Array<{ message?: string }>; error?: string }, fallback: string) =>
  response.errors?.[0]?.message || response.error || fallback;

const unwrapList = <T,>(raw: unknown, key: string): T[] => {
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
};

/* ───────────────────────── Component ───────────────────────── */

export function ShiftManager({ opportunityId, onChanged, className }: ShiftManagerProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [shifts, setShifts] = useState<ManagedShift[] | null>(null);
  const [patterns, setPatterns] = useState<RecurringPattern[]>([]);
  const [repeatingAvailable, setRepeatingAvailable] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const [rosterShift, setRosterShift] = useState<{ shift: ManagedShift; started: boolean } | null>(null);

  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const loadRequest = useRef(0);

  const load = useCallback(async () => {
    const request = ++loadRequest.current;
    setLoadError(null);
    try {
      const [shiftsRes, patternsRes] = await Promise.all([
        api.get<ManagedShift[]>(`/v2/volunteering/opportunities/${opportunityId}/shifts`),
        api.get<{ patterns?: RecurringPattern[] }>(`/v2/volunteering/opportunities/${opportunityId}/recurring-patterns`),
      ]);
      if (request !== loadRequest.current) return;
      if (!shiftsRes.success) {
        setLoadError(tRef.current('shift_manager.load_error'));
        setShifts([]);
        return;
      }
      setShifts(unwrapList<ManagedShift>(shiftsRes.data, 'shifts'));
      if (patternsRes.success) {
        setRepeatingAvailable(true);
        setPatterns(unwrapList<RecurringPattern>(patternsRes.data, 'patterns'));
      } else {
        // The community has repeating shifts switched off: hide that half quietly.
        setRepeatingAvailable(patternsRes.code !== 'FEATURE_DISABLED');
        setPatterns([]);
      }
    } catch (err) {
      if (request !== loadRequest.current) return;
      logError('Failed to load shifts for management', err);
      setLoadError(tRef.current('shift_manager.load_error'));
      setShifts([]);
    }
  }, [opportunityId]);

  useEffect(() => {
    void load();
    return () => { loadRequest.current += 1; };
  }, [load]);

  const changed = useCallback(() => {
    void load();
    onChangedRef.current?.();
  }, [load]);

  const now = Date.now();
  const { upcoming, past } = useMemo(() => {
    const all = [...(shifts ?? [])].sort((a, b) => toDate(a.start_time).getTime() - toDate(b.start_time).getTime());
    return {
      upcoming: all.filter((s) => toDate(s.start_time).getTime() > now),
      past: all.filter((s) => toDate(s.start_time).getTime() <= now).reverse(),
    };
  }, [shifts, now]);

  const activePatterns = patterns.filter((p) => p.is_active);

  /* ───── remove a shift ───── */
  const removeShift = async (shift: ManagedShift) => {
    setBusy(true);
    try {
      const res = await api.delete<{ affected_volunteers?: number }>(`/v2/volunteering/shifts/${shift.id}`);
      if (res.success) {
        toastRef.current.success(tRef.current('shift_manager.shift_removed'));
        setModal(null);
        changed();
      } else {
        toastRef.current.error(errorMessage(res, tRef.current('shift_manager.remove_failed')));
      }
    } catch (err) {
      logError('Failed to remove shift', err);
      toastRef.current.error(tRef.current('shift_manager.remove_failed'));
    } finally {
      setBusy(false);
    }
  };

  /* ───── stop a pattern ───── */
  const stopPattern = async (pattern: RecurringPattern) => {
    setBusy(true);
    try {
      const res = await api.delete<{ future_shifts_removed?: number }>(`/v2/volunteering/recurring-patterns/${pattern.id}`);
      if (res.success) {
        toastRef.current.success(tRef.current('shift_manager.pattern_stopped', { count: res.data?.future_shifts_removed ?? 0 }));
        setModal(null);
        changed();
      } else {
        toastRef.current.error(errorMessage(res, tRef.current('shift_manager.stop_failed')));
      }
    } catch (err) {
      logError('Failed to stop recurring pattern', err);
      toastRef.current.error(tRef.current('shift_manager.stop_failed'));
    } finally {
      setBusy(false);
    }
  };

  const renderShiftRow = (shift: ManagedShift, isPast: boolean) => {
    const taken = shift.signup_count + (shift.reserved_count ?? 0);
    return (
      <div
        key={shift.id}
        data-testid={`managed-shift-${shift.id}`}
        className="flex flex-col gap-3 p-3 rounded-xl bg-theme-elevated border border-theme-default sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Calendar className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-theme-primary">{formatDay(shift.start_time)}</p>
            <p className="text-xs text-theme-subtle">{formatTimeRange(shift.start_time, shift.end_time)}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <span className="flex items-center gap-1 text-xs text-theme-muted">
            <Users className="w-3.5 h-3.5" aria-hidden="true" />
            {shift.capacity
              ? t('shift_manager.places_of', { taken, capacity: shift.capacity })
              : t('shift_manager.signed_up', { count: taken })}
          </span>
          {shift.recurring_pattern_id ? (
            <Chip size="sm" variant="soft" color="accent" startContent={<Repeat className="w-3 h-3" aria-hidden="true" />}>
              {t('shift_manager.repeating_chip')}
            </Chip>
          ) : null}
          <Button
            size="sm"
            variant="tertiary"
            className="bg-theme-elevated text-theme-muted"
            startContent={<Users className="w-3.5 h-3.5" aria-hidden="true" />}
            onPress={() => setRosterShift({ shift, started: isPast })}
            aria-label={`${t('shift_manager.roster_open')}: ${formatDay(shift.start_time)}`}
            data-testid={`managed-shift-roster-${shift.id}`}
          >
            {t('shift_manager.roster_open')}
          </Button>
          {isPast ? (
            <Chip size="sm" variant="soft" color="default">{t('shift_manager.started_chip')}</Chip>
          ) : (
            <>
              <Button
                size="sm"
                variant="tertiary"
                className="bg-theme-elevated text-theme-muted"
                startContent={<Pencil className="w-3.5 h-3.5" aria-hidden="true" />}
                onPress={() => setModal({ kind: 'shift', shift })}
                aria-label={`${t('shift_manager.edit')}: ${formatDay(shift.start_time)}`}
                data-testid={`managed-shift-edit-${shift.id}`}
              >
                {t('shift_manager.edit')}
              </Button>
              <Button
                size="sm"
                variant="danger-soft"
                startContent={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
                onPress={() => setModal({ kind: 'remove', shift })}
                aria-label={`${t('shift_manager.remove')}: ${formatDay(shift.start_time)}`}
                data-testid={`managed-shift-remove-${shift.id}`}
              >
                {t('shift_manager.remove')}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <GlassCard className={`p-6 space-y-4 ${className ?? ''}`} data-testid="shift-manager">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('shift_manager.heading')}
          </h2>
          <p className="text-sm text-theme-muted mt-1">{t('shift_manager.intro')}</p>
        </div>
        <div className="flex flex-wrap gap-2 sm:flex-shrink-0">
          <Button
            size="sm"
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            onPress={() => setModal({ kind: 'shift' })}
            data-testid="shift-manager-add"
          >
            {t('shift_manager.add_shift')}
          </Button>
          {repeatingAvailable && (
            <Button
              size="sm"
              variant="secondary"
              startContent={<Repeat className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setModal({ kind: 'pattern' })}
              data-testid="shift-manager-add-repeating"
            >
              {t('shift_manager.add_repeating')}
            </Button>
          )}
          <Button
            size="sm"
            variant="tertiary"
            className="bg-theme-elevated text-theme-muted"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => { void load(); }}
            isDisabled={shifts === null}
            aria-label={t('shift_manager.refresh')}
          />
        </div>
      </div>

      {loadError && (
        <p className="flex items-start gap-2 text-sm text-[var(--color-warning)]" role="alert">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          {loadError}
        </p>
      )}

      {shifts === null && !loadError && (
        <div className="flex justify-center py-6" role="status" aria-busy="true">
          <Spinner size="sm" />
        </div>
      )}

      {shifts !== null && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-theme-muted">{t('shift_manager.upcoming_heading')}</h3>
          {upcoming.length === 0 ? (
            <p className="text-sm text-theme-subtle" data-testid="shift-manager-empty">{t('shift_manager.no_upcoming')}</p>
          ) : (
            upcoming.map((shift) => renderShiftRow(shift, false))
          )}
        </div>
      )}

      {past.length > 0 && (
        <div className="space-y-2">
          <Button
            size="sm"
            variant="tertiary"
            className="text-theme-muted"
            onPress={() => setShowPast((v) => !v)}
            data-testid="shift-manager-toggle-past"
          >
            {showPast ? t('shift_manager.hide_past') : t('shift_manager.show_past', { count: past.length })}
          </Button>
          {showPast && past.map((shift) => renderShiftRow(shift, true))}
        </div>
      )}

      {repeatingAvailable && activePatterns.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-theme-muted">{t('shift_manager.patterns_heading')}</h3>
          {activePatterns.map((pattern) => (
            <div
              key={pattern.id}
              data-testid={`managed-pattern-${pattern.id}`}
              className="flex flex-col gap-3 p-3 rounded-xl bg-theme-elevated border border-theme-default sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-center gap-3 min-w-0">
                <Repeat className="w-4 h-4 text-theme-subtle flex-shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-theme-primary">
                    {t(`shift_manager.frequency_${pattern.frequency}`)}
                    {pattern.days_of_week.length > 0 && (pattern.frequency === 'weekly' || pattern.frequency === 'biweekly')
                      ? ` · ${pattern.days_of_week.map((d) => weekdayName(d)).join(', ')}`
                      : ''}
                  </p>
                  <p className="text-xs text-theme-subtle">
                    {formatClock(pattern.start_time)} – {formatClock(pattern.end_time)}
                    {' · '}
                    {t('shift_manager.places_per_shift', { count: pattern.capacity })}
                    {pattern.end_date ? ` · ${formatDay(`${pattern.end_date} 00:00:00`)}` : ''}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="danger-soft"
                onPress={() => setModal({ kind: 'stop', pattern })}
                data-testid={`managed-pattern-stop-${pattern.id}`}
              >
                {t('shift_manager.stop_pattern')}
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* ───── one-off shift form ───── */}
      {modal?.kind === 'shift' && (
        <ShiftFormModal
          opportunityId={opportunityId}
          shift={modal.shift}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); changed(); }}
        />
      )}

      {/* ───── repeating shifts form ───── */}
      {modal?.kind === 'pattern' && (
        <PatternFormModal
          opportunityId={opportunityId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); changed(); }}
        />
      )}

      {/* ───── remove confirmation ───── */}
      <Modal
        isOpen={modal?.kind === 'remove'}
        onOpenChange={(open) => { if (!open && !busy) setModal(null); }}
        classNames={{ base: 'bg-overlay border border-theme-default', header: 'border-b border-theme-default', footer: 'border-t border-theme-default' }}
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader className="text-theme-primary">{t('shift_manager.remove_title')}</ModalHeader>
              <ModalBody>
                {modal?.kind === 'remove' && (
                  <>
                    <p className="text-sm font-medium text-theme-primary">
                      {formatDay(modal.shift.start_time)} · {formatTimeRange(modal.shift.start_time, modal.shift.end_time)}
                    </p>
                    <p className="text-sm text-theme-secondary">
                      {modal.shift.signup_count > 0
                        ? t('shift_manager.remove_body', { count: modal.shift.signup_count })
                        : t('shift_manager.remove_body_none')}
                    </p>
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close} isDisabled={busy}>{t('shift_manager.cancel')}</Button>
                <Button
                  variant="danger"
                  isLoading={busy}
                  onPress={() => { if (modal?.kind === 'remove') void removeShift(modal.shift); }}
                  data-testid="shift-manager-remove-confirm"
                >
                  {t('shift_manager.remove_confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* ───── stop pattern confirmation ───── */}
      <Modal
        isOpen={modal?.kind === 'stop'}
        onOpenChange={(open) => { if (!open && !busy) setModal(null); }}
        classNames={{ base: 'bg-overlay border border-theme-default', header: 'border-b border-theme-default', footer: 'border-t border-theme-default' }}
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader className="text-theme-primary">{t('shift_manager.stop_title')}</ModalHeader>
              <ModalBody>
                <p className="text-sm text-theme-secondary">{t('shift_manager.stop_body')}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close} isDisabled={busy}>{t('shift_manager.cancel')}</Button>
                <Button
                  variant="danger"
                  isLoading={busy}
                  onPress={() => { if (modal?.kind === 'stop') void stopPattern(modal.pattern); }}
                  data-testid="shift-manager-stop-confirm"
                >
                  {t('shift_manager.stop_confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <ShiftRosterModal
        shiftId={rosterShift?.shift.id ?? null}
        shiftLabel={rosterShift ? `${formatDay(rosterShift.shift.start_time)}, ${formatTimeRange(rosterShift.shift.start_time, rosterShift.shift.end_time)}` : ''}
        hasStarted={rosterShift?.started ?? false}
        onClose={() => setRosterShift(null)}
      />
    </GlassCard>
  );
}

/* ───────────────────────── One-off shift form ───────────────────────── */

interface ShiftFormModalProps {
  opportunityId: number;
  shift?: ManagedShift;
  onClose: () => void;
  onSaved: () => void;
}

function ShiftFormModal({ opportunityId, shift, onClose, onSaved }: ShiftFormModalProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [date, setDate] = useState<DateValue | null>(() => (shift ? parseDate(dateKey(toDate(shift.start_time))) : null));
  const [start, setStart] = useState(() => (shift ? timeKey(toDate(shift.start_time)) : ''));
  const [end, setEnd] = useState(() => (shift ? timeKey(toDate(shift.end_time)) : ''));
  const [capacity, setCapacity] = useState(() => (shift?.capacity ? String(shift.capacity) : ''));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!date || !start || !end) {
      setError(t('shift_manager.required'));
      return;
    }
    if (end <= start) {
      setError(t('shift_manager.end_before_start'));
      return;
    }
    if (capacity !== '' && (!/^\d+$/.test(capacity) || Number(capacity) < 1)) {
      setError(t('shift_manager.invalid_places'));
      return;
    }
    setError(null);
    setSaving(true);
    const payload = {
      start_time: `${date.toString()} ${start}:00`,
      end_time: `${date.toString()} ${end}:00`,
      capacity: capacity === '' ? null : Number(capacity),
    };
    try {
      const res = shift
        ? await api.put<ManagedShift>(`/v2/volunteering/shifts/${shift.id}`, payload)
        : await api.post<ManagedShift>(`/v2/volunteering/opportunities/${opportunityId}/shifts`, payload);
      if (res.success) {
        toast.success(t(shift ? 'shift_manager.shift_updated' : 'shift_manager.shift_created'));
        onSaved();
      } else {
        setError(errorMessage(res, t('shift_manager.save_failed')));
      }
    } catch (err) {
      logError('Failed to save shift', err);
      setError(t('shift_manager.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onOpenChange={(open) => { if (!open && !saving) onClose(); }}
      classNames={{ base: 'bg-overlay border border-theme-default', header: 'border-b border-theme-default', footer: 'border-t border-theme-default' }}
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="text-theme-primary">
              {t(shift ? 'shift_manager.edit_shift_title' : 'shift_manager.new_shift_title')}
            </ModalHeader>
            <ModalBody>
              <form
                className="space-y-4"
                data-testid="shift-form"
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
              >
                <DatePicker
                  label={t('shift_manager.date_label')}
                  value={date}
                  onChange={setDate}
                  minValue={today(getLocalTimeZone())}
                  isRequired
                  classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default', label: 'text-theme-muted' }}
                />
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="time"
                    label={t('shift_manager.start_label')}
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    isRequired
                    data-testid="shift-form-start"
                    classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                  />
                  <Input
                    type="time"
                    label={t('shift_manager.end_label')}
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    isRequired
                    data-testid="shift-form-end"
                    classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                  />
                </div>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  label={t('shift_manager.places_label')}
                  description={t('shift_manager.places_hint')}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  data-testid="shift-form-capacity"
                  classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                />
                {error && (
                  <p className="text-sm text-danger" role="alert" data-testid="shift-form-error">{error}</p>
                )}
              </form>
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={close} isDisabled={saving}>{t('shift_manager.cancel')}</Button>
              <Button
                className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                isLoading={saving}
                onPress={() => { void submit(); }}
                data-testid="shift-form-save"
              >
                {t('shift_manager.save')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

/* ───────────────────────── Repeating shifts form ───────────────────────── */

interface PatternFormModalProps {
  opportunityId: number;
  onClose: () => void;
  onSaved: () => void;
}

function PatternFormModal({ opportunityId, onClose, onSaved }: PatternFormModalProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const [frequency, setFrequency] = useState<PatternFrequency>('weekly');
  const [days, setDays] = useState<string[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [startDate, setStartDate] = useState<DateValue | null>(() => today(getLocalTimeZone()));
  const [endDate, setEndDate] = useState<DateValue | null>(null);
  const [maxOccurrences, setMaxOccurrences] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const usesDays = frequency === 'weekly' || frequency === 'biweekly';

  const submit = async () => {
    if (!startDate || !start || !end) {
      setError(t('shift_manager.required'));
      return;
    }
    if (end <= start) {
      setError(t('shift_manager.end_before_start'));
      return;
    }
    if (!/^\d+$/.test(capacity) || Number(capacity) < 1) {
      setError(t('shift_manager.invalid_places'));
      return;
    }
    if (maxOccurrences !== '' && (!/^\d+$/.test(maxOccurrences) || Number(maxOccurrences) < 1)) {
      setError(t('shift_manager.invalid_places'));
      return;
    }
    setError(null);
    setSaving(true);
    const payload: Record<string, unknown> = {
      frequency,
      start_time: `${start}:00`,
      end_time: `${end}:00`,
      capacity: Number(capacity),
      start_date: startDate.toString(),
    };
    if (usesDays && days.length > 0) payload.days_of_week = days.map(Number).sort((a, b) => a - b);
    if (endDate) payload.end_date = endDate.toString();
    if (maxOccurrences !== '') payload.max_occurrences = Number(maxOccurrences);
    try {
      const res = await api.post<{ shifts_generated?: number }>(`/v2/volunteering/opportunities/${opportunityId}/recurring-patterns`, payload);
      if (res.success) {
        toast.success(t('shift_manager.pattern_created', { count: res.data?.shifts_generated ?? 0 }));
        onSaved();
      } else {
        setError(errorMessage(res, t('shift_manager.pattern_failed')));
      }
    } catch (err) {
      logError('Failed to create recurring pattern', err);
      setError(t('shift_manager.pattern_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      size="lg"
      onOpenChange={(open) => { if (!open && !saving) onClose(); }}
      classNames={{ base: 'bg-overlay border border-theme-default', header: 'border-b border-theme-default', footer: 'border-t border-theme-default' }}
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader className="text-theme-primary">{t('shift_manager.pattern_title')}</ModalHeader>
            <ModalBody>
              <form
                className="space-y-4"
                data-testid="pattern-form"
                onSubmit={(e) => { e.preventDefault(); void submit(); }}
              >
                <p className="text-sm text-theme-muted">{t('shift_manager.pattern_intro')}</p>
                <Select
                  label={t('shift_manager.frequency_label')}
                  selectedKeys={new Set([frequency])}
                  disallowEmptySelection
                  onChange={(e) => setFrequency((e.target.value || 'weekly') as PatternFrequency)}
                  data-testid="pattern-form-frequency"
                  classNames={{ trigger: 'bg-theme-elevated border-theme-default', label: 'text-theme-muted' }}
                >
                  {FREQUENCIES.map((f) => (
                    <SelectItem key={f} id={f} textValue={t(`shift_manager.frequency_${f}`)}>
                      {t(`shift_manager.frequency_${f}`)}
                    </SelectItem>
                  ))}
                </Select>
                {usesDays && (
                  <CheckboxGroup
                    label={t('shift_manager.days_label')}
                    description={t('shift_manager.days_hint')}
                    size="sm"
                    value={days}
                    onValueChange={setDays}
                  >
                    {/* Own wrapping row: the group's horizontal orientation shares the line with
                        the hint text and pushed the first day onto the far right. */}
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {WEEKDAYS.map((d) => (
                        <Checkbox
                          key={d}
                          value={String(d)}
                          aria-label={weekdayName(d, 'long')}
                          data-testid={`pattern-form-day-${d}`}
                        >
                          {weekdayName(d)}
                        </Checkbox>
                      ))}
                    </div>
                  </CheckboxGroup>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    type="time"
                    label={t('shift_manager.start_label')}
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    isRequired
                    data-testid="pattern-form-start"
                    classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                  />
                  <Input
                    type="time"
                    label={t('shift_manager.end_label')}
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    isRequired
                    data-testid="pattern-form-end"
                    classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                  />
                </div>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  label={t('shift_manager.places_label')}
                  description={t('shift_manager.pattern_places_hint')}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  isRequired
                  data-testid="pattern-form-capacity"
                  classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                />
                <div className="grid sm:grid-cols-2 gap-3">
                  <DatePicker
                    label={t('shift_manager.start_date_label')}
                    value={startDate}
                    onChange={setStartDate}
                    minValue={today(getLocalTimeZone())}
                    isRequired
                    classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default', label: 'text-theme-muted' }}
                  />
                  <DatePicker
                    label={t('shift_manager.end_date_label')}
                    value={endDate}
                    onChange={setEndDate}
                    minValue={startDate ?? today(getLocalTimeZone())}
                    classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default', label: 'text-theme-muted' }}
                  />
                </div>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  label={t('shift_manager.max_label')}
                  value={maxOccurrences}
                  onChange={(e) => setMaxOccurrences(e.target.value)}
                  data-testid="pattern-form-max"
                  classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                />
                {error && (
                  <p className="text-sm text-danger" role="alert" data-testid="pattern-form-error">{error}</p>
                )}
              </form>
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={close} isDisabled={saving}>{t('shift_manager.cancel')}</Button>
              <Button
                className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                isLoading={saving}
                onPress={() => { void submit(); }}
                data-testid="pattern-form-save"
              >
                {t('shift_manager.save')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default ShiftManager;
