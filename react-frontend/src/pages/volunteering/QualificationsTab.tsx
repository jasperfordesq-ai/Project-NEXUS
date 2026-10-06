// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * QualificationsTab — the member's register of training and qualifications.
 *
 * A record, not a document store: nothing is uploaded. The volunteer records
 * what they hold (first aid, safeguarding training, a driving licence…), the
 * organisations they volunteer with and community staff can see it and confirm
 * it after checking the original, and the nightly job reminds everyone before
 * it runs out. Police checks are deliberately NOT recorded here — the server
 * refuses them with VETTING_NOT_A_QUALIFICATION and the intro card points at
 * the member's vetting status instead.
 *
 * Contract: .local-docs-archive/volunteering-credentials/QUALIFICATIONS-BUILD-SPEC-2026-10-05.md §4, §6.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import BadgeCheck from 'lucide-react/icons/badge-check';
import Ban from 'lucide-react/icons/ban';
import Building2 from 'lucide-react/icons/building-2';
import Calendar from 'lucide-react/icons/calendar';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Hash from 'lucide-react/icons/hash';
import Hourglass from 'lucide-react/icons/hourglass';
import Info from 'lucide-react/icons/info';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import XCircle from 'lucide-react/icons/circle-x';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import {
  Disclosure,
  DisclosureBody,
  DisclosureContent,
  DisclosureHeading,
  DisclosureIndicator,
  DisclosureTrigger,
} from '@/components/ui/Disclosure';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatDateValue, getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types (spec §4) ───────────────────────── */

type QualificationStatus = 'recorded' | 'confirmed' | 'expired' | 'withdrawn';
type ConfirmationMethod = 'saw_original' | 'online_register' | 'issuer_confirmed';
type WithdrawalReason = 'volunteer_request' | 'no_longer_held' | 'entered_in_error' | 'replaced';

interface NamedRef {
  id: number;
  name: string;
}

export interface Qualification {
  id: number;
  user_id: number;
  qualification_type: string;
  type_label_key?: string;
  title: string | null;
  issuer: string | null;
  reference_number: string | null;
  obtained_at: string | null;
  expires_at: string | null;
  status: QualificationStatus;
  is_expiring: boolean;
  days_until_expiry: number | null;
  confirmed_by: NamedRef | null;
  confirmed_at: string | null;
  confirmation_method: ConfirmationMethod | null;
  confirmed_for_organization: NamedRef | null;
  withdrawn_at: string | null;
  withdrawal_reason: WithdrawalReason | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface TypeDef {
  code: string;
  label_key: string;
  expiry_hint_years: number | null;
}

interface Counts {
  confirmed: number;
  recorded: number;
  expiring: number;
  expired: number;
}

interface QualificationsPayload {
  items: Qualification[];
  counts: Counts;
  reminder_window_days: number;
  types: TypeDef[];
}

interface QualificationForm {
  qualification_type: string;
  title: string;
  issuer: string;
  reference_number: string;
  obtained_at: string;
  expires_at: string;
  notes: string;
}

interface FormErrors {
  title?: string;
  expires_at?: string;
  form?: string;
}

/* ───────────────────────── Constants ───────────────────────── */

/** Order matches the spec. */
const WITHDRAWAL_REASONS: readonly WithdrawalReason[] = [
  'volunteer_request',
  'no_longer_held',
  'entered_in_error',
  'replaced',
] as const;
/** Pre-selected in the withdraw dialog — the least loaded reason. */
const DEFAULT_WITHDRAWAL_REASON: WithdrawalReason = 'volunteer_request';

const EMPTY_COUNTS: Counts = { confirmed: 0, recorded: 0, expiring: 0, expired: 0 };

const EMPTY_FORM: QualificationForm = {
  qualification_type: '',
  title: '',
  issuer: '',
  reference_number: '',
  obtained_at: '',
  expires_at: '',
  notes: '',
};

// Volunteering brand gradient — mirrors VOL_GRADIENT in VolunteeringPage.
const VOL_GRADIENT = 'bg-linear-to-r from-rose-500 to-pink-600 text-white';

/* ───────────────────────── Helpers ───────────────────────── */

/** Whole calendar days from today to `iso` (negative when in the past). */
function daysFromToday(iso: string): number {
  const target = parseCalendarDate(iso);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86_400_000);
}

function relativeDays(iso: string): string {
  try {
    return new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' }).format(daysFromToday(iso), 'day');
  } catch {
    return '';
  }
}

/** Dates arrive as `YYYY-MM-DD`; parse them as local calendar days, not UTC midnight. */
function parseCalendarDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

function calendarDate(iso: string): string {
  return formatDateValue(parseCalendarDate(iso));
}

/** A live record whose expiry falls inside the reminder window. */
function isExpiring(q: Qualification): boolean {
  return (q.status === 'recorded' || q.status === 'confirmed') && Boolean(q.is_expiring);
}

function needsAttention(q: Qualification): boolean {
  return q.status === 'expired' || isExpiring(q);
}

type ChipColor = 'success' | 'warning' | 'danger' | 'accent' | 'default';

function chipFor(q: Qualification): { color: ChipColor; key: string } {
  if (q.status === 'withdrawn') return { color: 'default', key: 'withdrawn' };
  if (q.status === 'expired') return { color: 'danger', key: 'expired' };
  if (isExpiring(q)) return { color: 'warning', key: 'expiring' };
  if (q.status === 'confirmed') return { color: 'success', key: 'confirmed' };
  return { color: 'accent', key: 'recorded' };
}

function toForm(q: Qualification): QualificationForm {
  return {
    qualification_type: q.qualification_type,
    title: q.title ?? '',
    issuer: q.issuer ?? '',
    reference_number: q.reference_number ?? '',
    obtained_at: q.obtained_at ?? '',
    expires_at: q.expires_at ?? '',
    notes: q.notes ?? '',
  };
}

function trimOrNull(value: string): string | null {
  const v = value.trim();
  return v === '' ? null : v;
}

/* ───────────────────────── Component ───────────────────────── */

export function QualificationsTab() {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [items, setItems] = useState<Qualification[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [types, setTypes] = useState<TypeDef[]>([]);
  const [reminderWindowDays, setReminderWindowDays] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const formModal = useDisclosure();
  const withdrawModal = useDisclosure();
  const [editing, setEditing] = useState<Qualification | null>(null);
  const [form, setForm] = useState<QualificationForm>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [withdrawing, setWithdrawing] = useState<Qualification | null>(null);
  const [withdrawReason, setWithdrawReason] = useState<WithdrawalReason>(DEFAULT_WITHDRAWAL_REASON);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);

      const res = await api.get<QualificationsPayload>('/v2/volunteering/qualifications');
      if (controller.signal.aborted) return;

      // A non-thrown success:false must not render an empty register —
      // surface a retryable error instead.
      if (!res.success || !res.data) {
        setError(tRef.current('qualifications.load_error'));
        return;
      }

      const payload = res.data;
      setItems(Array.isArray(payload.items) ? payload.items : []);
      setCounts({ ...EMPTY_COUNTS, ...(payload.counts ?? {}) });
      setTypes(Array.isArray(payload.types) ? payload.types : []);
      if (Number.isFinite(payload.reminder_window_days)) setReminderWindowDays(payload.reminder_window_days);
      setHasLoaded(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load qualifications', err);
      setError(tRef.current('qualifications.load_error'));
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  /* ── Derived view ── */

  const grouped = useMemo(() => {
    const attention: Qualification[] = [];
    const recorded: Qualification[] = [];
    const confirmed: Qualification[] = [];
    const withdrawn: Qualification[] = [];
    for (const q of items) {
      if (q.status === 'withdrawn') withdrawn.push(q);
      else if (needsAttention(q)) attention.push(q);
      else if (q.status === 'confirmed') confirmed.push(q);
      else recorded.push(q);
    }
    return { attention, recorded, confirmed, withdrawn };
  }, [items]);

  const attentionCount = counts.expiring + counts.expired;

  const typeLabel = (code: string) => t(`qualifications.types.${code}`);

  const selectedType = useMemo(
    () => types.find((d) => d.code === form.qualification_type) ?? null,
    [types, form.qualification_type],
  );

  /* ── Client-side validation (mirrors the server's 422 codes) ── */

  const validate = (f: QualificationForm): FormErrors => {
    const errors: FormErrors = {};
    if (f.qualification_type === 'other' && f.title.trim() === '') {
      errors.title = t('qualifications.errors.title_required');
    }
    if (f.obtained_at && f.expires_at && f.expires_at < f.obtained_at) {
      errors.expires_at = t('qualifications.errors.expiry_before_obtained');
    }
    return errors;
  };

  const mapServerError = (code: string | undefined, message: string | undefined): FormErrors => {
    switch (code) {
      case 'TITLE_REQUIRED_FOR_OTHER':
        return { title: t('qualifications.errors.title_required') };
      case 'EXPIRY_BEFORE_OBTAINED':
        return { expires_at: t('qualifications.errors.expiry_before_obtained') };
      case 'VETTING_NOT_A_QUALIFICATION':
        return { form: t('qualifications.errors.vetting') };
      case 'UNSUPPORTED_QUALIFICATION_TYPE':
        return { form: t('qualifications.errors.unsupported_type') };
      default:
        return { form: message || t('qualifications.form.save_error') };
    }
  };

  /* ── Actions ── */

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    formModal.onOpen();
  };

  const openEdit = (q: Qualification) => {
    setEditing(q);
    setForm(toForm(q));
    setFormErrors({});
    formModal.onOpen();
  };

  const openWithdraw = (q: Qualification) => {
    setWithdrawing(q);
    setWithdrawReason(DEFAULT_WITHDRAWAL_REASON);
    withdrawModal.onOpen();
  };

  const updateForm = (patch: Partial<QualificationForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    // Clear the error that belongs to the field being edited; the rest stay
    // until the next save attempt.
    setFormErrors((e) => {
      const next = { ...e, form: undefined };
      if ('title' in patch || 'qualification_type' in patch) next.title = undefined;
      if ('expires_at' in patch || 'obtained_at' in patch) next.expires_at = undefined;
      return next;
    });
  };

  const submitForm = async (onClose: () => void) => {
    const errors = validate(form);
    if (errors.title || errors.expires_at) {
      setFormErrors(errors);
      return;
    }

    const body = {
      qualification_type: form.qualification_type,
      title: trimOrNull(form.title),
      issuer: trimOrNull(form.issuer),
      reference_number: trimOrNull(form.reference_number),
      obtained_at: form.obtained_at || null,
      expires_at: form.expires_at || null,
      notes: trimOrNull(form.notes),
    };

    try {
      setIsSaving(true);
      const response = editing
        ? await api.put(`/v2/volunteering/qualifications/${editing.id}`, body)
        : await api.post('/v2/volunteering/qualifications', body);

      if (response.success) {
        toastRef.current.success(tRef.current('qualifications.form.saved'));
        onClose();
        void load();
      } else {
        setFormErrors(mapServerError(response.code, response.error));
      }
    } catch (err) {
      logError('Failed to save qualification', err);
      setFormErrors({ form: tRef.current('qualifications.form.save_error') });
    } finally {
      setIsSaving(false);
    }
  };

  const submitWithdraw = async (onClose: () => void) => {
    if (!withdrawing) return;
    try {
      setIsWithdrawing(true);
      const response = await api.post(`/v2/volunteering/qualifications/${withdrawing.id}/withdraw`, {
        reason: withdrawReason,
      });
      if (response.success) {
        toastRef.current.success(tRef.current('qualifications.withdraw.done'));
        onClose();
        void load();
      } else {
        toastRef.current.error(response.error || tRef.current('qualifications.form.save_error'));
      }
    } catch (err) {
      logError('Failed to withdraw qualification', err);
      toastRef.current.error(tRef.current('qualifications.form.save_error'));
    } finally {
      setIsWithdrawing(false);
    }
  };

  /* ── Render helpers ── */

  const renderRow = (q: Qualification) => {
    const chip = chipFor(q);
    const isWithdrawn = q.status === 'withdrawn';
    const isLive = q.status === 'recorded' || q.status === 'confirmed' || q.status === 'expired';

    const expiryLine = q.expires_at
      ? q.status === 'expired' || daysFromToday(q.expires_at) < 0
        ? t('qualifications.expired_on', { date: calendarDate(q.expires_at) })
        : `${t('qualifications.expires_on', { date: calendarDate(q.expires_at) })} · ${relativeDays(q.expires_at)}`
      : t('qualifications.no_expiry');

    const confirmationLine =
      q.confirmed_by && q.confirmed_at
        ? [
            q.confirmed_for_organization
              ? t('qualifications.confirmed_line_org', {
                  name: q.confirmed_by.name,
                  org: q.confirmed_for_organization.name,
                  date: formatDateValue(q.confirmed_at),
                })
              : t('qualifications.confirmed_line', {
                  name: q.confirmed_by.name,
                  date: formatDateValue(q.confirmed_at),
                }),
            q.confirmation_method ? t(`qualifications.method.${q.confirmation_method}`) : null,
          ]
            .filter(Boolean)
            .join(' · ')
        : null;

    return (
      <GlassCard key={q.id} className={`p-4 ${isWithdrawn ? 'opacity-70' : ''}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-base font-semibold text-theme-primary">{typeLabel(q.qualification_type)}</h4>
              <Chip size="sm" color={chip.color} variant="soft">
                {t(`qualifications.status.${chip.key}`)}
              </Chip>
            </div>
            {q.title && <p className="mt-0.5 text-sm text-theme-secondary">{q.title}</p>}

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-theme-subtle">
              {q.issuer && (
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                  {q.issuer}
                </span>
              )}
              {q.reference_number && (
                <span className="inline-flex items-center gap-1">
                  <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('qualifications.reference', { ref: q.reference_number })}
                </span>
              )}
              {q.obtained_at && (
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('qualifications.obtained_on', { date: calendarDate(q.obtained_at) })}
                </span>
              )}
              {!isWithdrawn && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {expiryLine}
                </span>
              )}
            </div>

            {confirmationLine && !isWithdrawn && (
              <p className="mt-2 inline-flex items-start gap-1.5 text-xs text-theme-muted">
                <CheckCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {confirmationLine}
              </p>
            )}
            {isWithdrawn && q.withdrawn_at && (
              <p className="mt-2 text-xs text-theme-muted">
                {t('qualifications.withdrawn_line', { date: formatDateValue(q.withdrawn_at) })}
              </p>
            )}
            {q.notes && <p className="mt-2 text-sm text-theme-muted">{q.notes}</p>}
          </div>

          {isLive && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <Button
                size="sm"
                variant="secondary"
                className="w-full sm:w-auto"
                startContent={<Pencil className="h-4 w-4" aria-hidden="true" />}
                onPress={() => openEdit(q)}
              >
                {t('qualifications.actions.edit')}
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                className="w-full sm:w-auto"
                startContent={<Ban className="h-4 w-4" aria-hidden="true" />}
                onPress={() => openWithdraw(q)}
              >
                {t('qualifications.actions.withdraw')}
              </Button>
            </div>
          )}
        </div>
      </GlassCard>
    );
  };

  const renderSection = (title: string, list: Qualification[]) =>
    list.length > 0 && (
      <section className="space-y-3" aria-label={title}>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-theme-secondary">{title}</h3>
        <div className="space-y-3">{list.map(renderRow)}</div>
      </section>
    );

  const renderTile = (
    icon: ReactNode,
    tone: string,
    label: string,
    value: number,
    hint?: string,
  ) => (
    <GlassCard className="p-4">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-theme-muted">{label}</p>
          <p className="text-xl font-bold text-theme-primary tabular-nums">{value.toLocaleString(getFormattingLocale())}</p>
          {hint && <p className="text-xs text-theme-subtle">{hint}</p>}
        </div>
      </div>
    </GlassCard>
  );

  const showSkeleton = isLoading && !hasLoaded && !error;
  const nothingYet = hasLoaded && items.length === 0;
  const canSave = form.qualification_type !== '' && !isSaving;

  return (
    <div className="space-y-6">
      {/* Header: title left, actions right. On phones the actions become
          equal-width rows instead of a ragged left-aligned stack. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <BadgeCheck className="h-5 w-5 text-rose-500" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('qualifications.heading')}</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center lg:shrink-0">
          <Button
            size="sm"
            variant="tertiary"
            className="w-full sm:w-auto"
            startContent={<RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />}
            onPress={() => void load()}
            isDisabled={isLoading}
          >
            {t('qualifications.refresh')}
          </Button>
          <Button
            size="sm"
            className={`${VOL_GRADIENT} w-full sm:w-auto`}
            startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
            onPress={openAdd}
          >
            {t('qualifications.add')}
          </Button>
        </div>
      </div>

      {/* What this is: a register, no documents, and where police checks live. */}
      <GlassCard className="p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <div className="shrink-0 rounded-lg bg-rose-500/10 p-2 text-rose-600 dark:text-rose-400">
            <Info className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 space-y-1">
            <h3 className="text-base font-semibold text-theme-primary">{t('qualifications.intro_title')}</h3>
            <p className="text-sm text-theme-muted">{t('qualifications.intro_body')}</p>
            <p className="text-sm text-theme-muted">{t('qualifications.intro_show_or_send')}</p>
            <p className="text-xs text-theme-subtle">{t('qualifications.intro_vetting')}</p>
            <Button
              as={Link}
              to={tenantPath('/settings?tab=safeguarding')}
              size="sm"
              variant="tertiary"
              className="mt-1 w-full sm:w-auto"
              startContent={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            >
              {t('qualifications.vetting_link')}
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Error */}
      {error && !isLoading && (
        <Alert
          color="danger"
          title={error}
          endContent={
            <Button size="sm" variant="secondary" onPress={() => void load()}>
              {t('try_again')}
            </Button>
          }
        />
      )}

      {/* Loading (first load only — a refresh dims the content instead) */}
      {showSkeleton && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
          {[1, 2, 3].map((i) => (
            <CardRowsSkeleton key={i} />
          ))}
        </div>
      )}

      {hasLoaded && (
        <div className={`space-y-6 transition-opacity ${isLoading ? 'opacity-60' : ''}`} aria-busy={isLoading || undefined}>
          {/* Summary tiles */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {renderTile(
              <CheckCircle className="h-5 w-5" aria-hidden="true" />,
              'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
              t('qualifications.tiles.confirmed'),
              counts.confirmed,
            )}
            {renderTile(
              <Hourglass className="h-5 w-5" aria-hidden="true" />,
              'bg-sky-500/10 text-sky-600 dark:text-sky-400',
              t('qualifications.tiles.recorded'),
              counts.recorded,
            )}
            {renderTile(
              <Clock className="h-5 w-5" aria-hidden="true" />,
              'bg-amber-500/10 text-amber-600 dark:text-amber-400',
              t('qualifications.tiles.expiring'),
              counts.expiring,
              t('qualifications.tiles.expiring_hint', { days: reminderWindowDays }),
            )}
            {renderTile(
              <XCircle className="h-5 w-5" aria-hidden="true" />,
              'bg-rose-500/10 text-rose-600 dark:text-rose-400',
              t('qualifications.tiles.expired'),
              counts.expired,
            )}
          </div>

          {/* Something has run out or is about to */}
          {attentionCount > 0 && (
            <Alert
              color={counts.expired > 0 ? 'danger' : 'warning'}
              title={t('qualifications.attention_title', { count: attentionCount, number: attentionCount.toLocaleString(getFormattingLocale()) })}
              description={t('qualifications.attention_body')}
            />
          )}

          {/* Nothing at all yet */}
          {nothingYet && (
            <EmptyState
              icon={<BadgeCheck className="h-12 w-12" aria-hidden="true" />}
              title={t('qualifications.empty_title')}
              description={t('qualifications.empty_body')}
              action={
                <Button
                  className={VOL_GRADIENT}
                  startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                  onPress={openAdd}
                >
                  {t('qualifications.add')}
                </Button>
              }
            />
          )}

          {renderSection(t('qualifications.group.attention'), grouped.attention)}
          {renderSection(t('qualifications.group.recorded'), grouped.recorded)}
          {renderSection(t('qualifications.group.confirmed'), grouped.confirmed)}

          {/* Withdrawn records stay in the history, collapsed by default */}
          {grouped.withdrawn.length > 0 && (
            <Disclosure className="rounded-2xl border border-theme-default">
              <DisclosureHeading>
                <DisclosureTrigger className="flex w-full items-center gap-3 rounded-2xl p-4 text-left text-sm font-semibold text-theme-secondary">
                  <span className="min-w-0 flex-1">
                    {t('qualifications.group.withdrawn', { number: grouped.withdrawn.length })}
                  </span>
                  <DisclosureIndicator className="shrink-0 text-theme-muted" />
                </DisclosureTrigger>
              </DisclosureHeading>
              <DisclosureContent>
                <DisclosureBody className="space-y-3 border-t border-theme-default p-4">
                  {grouped.withdrawn.map(renderRow)}
                </DisclosureBody>
              </DisclosureContent>
            </Disclosure>
          )}
        </div>
      )}

      {/* Add / edit modal */}
      <Modal
        isOpen={formModal.isOpen}
        onOpenChange={formModal.onOpenChange}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2 text-theme-primary">
                <BadgeCheck className="h-5 w-5" aria-hidden="true" />
                {editing ? t('qualifications.form.title_edit') : t('qualifications.form.title_add')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {/* The confirmer saw the OLD values, so an edit sends it back for re-confirmation. */}
                {editing?.status === 'confirmed' && (
                  <Alert color="warning" title={t('qualifications.form.edit_clears_confirmation')} />
                )}
                {formErrors.form && <Alert color="danger" title={formErrors.form} />}

                <Select
                  label={t('qualifications.form.type')}
                  placeholder={t('qualifications.form.type_placeholder')}
                  variant="secondary"
                  isRequired
                  selectedKeys={form.qualification_type ? new Set([form.qualification_type]) : new Set()}
                  onSelectionChange={(keys) => {
                    const [key] = Array.from(keys as Set<string | number>);
                    updateForm({ qualification_type: key == null ? '' : String(key) });
                  }}
                  description={
                    selectedType?.expiry_hint_years
                      ? t('qualifications.form.expiry_hint', { years: selectedType.expiry_hint_years })
                      : undefined
                  }
                >
                  {types.map((d) => (
                    <SelectItem key={d.code} id={d.code}>{typeLabel(d.code)}</SelectItem>
                  ))}
                </Select>

                <Input
                  label={form.qualification_type === 'other' ? t('qualifications.form.title_required') : t('qualifications.form.title')}
                  variant="secondary"
                  value={form.title}
                  onValueChange={(v) => updateForm({ title: v })}
                  isRequired={form.qualification_type === 'other'}
                  isInvalid={Boolean(formErrors.title)}
                  errorMessage={formErrors.title}
                  maxLength={160}
                />

                <Input
                  label={t('qualifications.form.issuer')}
                  variant="secondary"
                  value={form.issuer}
                  onValueChange={(v) => updateForm({ issuer: v })}
                  maxLength={160}
                />

                <Input
                  label={t('qualifications.form.reference')}
                  variant="secondary"
                  value={form.reference_number}
                  onValueChange={(v) => updateForm({ reference_number: v })}
                  maxLength={100}
                />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Input
                    type="date"
                    label={t('qualifications.form.obtained')}
                    variant="secondary"
                    value={form.obtained_at}
                    onChange={(e) => updateForm({ obtained_at: e.target.value })}
                  />
                  <Input
                    type="date"
                    label={t('qualifications.form.expires')}
                    variant="secondary"
                    value={form.expires_at}
                    onChange={(e) => updateForm({ expires_at: e.target.value })}
                    description={formErrors.expires_at ? undefined : t('qualifications.form.expires_hint')}
                    isInvalid={Boolean(formErrors.expires_at)}
                    errorMessage={formErrors.expires_at}
                  />
                </div>

                <Textarea
                  label={t('qualifications.form.notes')}
                  variant="secondary"
                  value={form.notes}
                  onValueChange={(v) => updateForm({ notes: v })}
                  maxRows={3}
                  maxLength={500}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('qualifications.form.cancel')}</Button>
                <Button
                  className={VOL_GRADIENT}
                  onPress={() => void submitForm(onClose)}
                  isLoading={isSaving}
                  isDisabled={!canSave}
                >
                  {t('qualifications.form.save')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Withdraw dialog */}
      <Modal
        isOpen={withdrawModal.isOpen}
        onOpenChange={withdrawModal.onOpenChange}
        size="md"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2 text-theme-primary">
                <Ban className="h-5 w-5" aria-hidden="true" />
                {t('qualifications.withdraw.title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {withdrawing && (
                  <p className="text-sm font-medium text-theme-primary">
                    {typeLabel(withdrawing.qualification_type)}
                    {withdrawing.title ? ` · ${withdrawing.title}` : ''}
                  </p>
                )}
                <p className="text-sm text-theme-muted">{t('qualifications.withdraw.body')}</p>
                <RadioGroup
                  label={t('qualifications.withdraw.reason')}
                  value={withdrawReason}
                  onValueChange={(value) => setWithdrawReason(value as WithdrawalReason)}
                >
                  {WITHDRAWAL_REASONS.map((reason) => (
                    <Radio key={reason} value={reason}>
                      {t(`qualifications.withdraw.reasons.${reason}`)}
                    </Radio>
                  ))}
                </RadioGroup>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('qualifications.form.cancel')}</Button>
                <Button
                  color="danger"
                  onPress={() => void submitWithdraw(onClose)}
                  isLoading={isWithdrawing}
                >
                  {t('qualifications.withdraw.confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default QualificationsTab;
