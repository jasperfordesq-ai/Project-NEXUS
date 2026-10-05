// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgQualificationsTab — the qualifications register for an organisation.
 *
 * Lists the training and qualifications recorded by volunteers who are linked
 * to this organisation (an approved application on one of its opportunities),
 * so an owner or admin of the organisation can confirm them after checking the
 * original, and see what is about to run out. Nothing is uploaded or stored
 * here: confirming is a statement that a person checked the certificate, an
 * online register, or asked the issuer.
 *
 * API: GET  /v2/volunteering/organizations/{orgId}/qualifications
 *      POST /v2/volunteering/qualifications/{id}/confirm  { method, organization_id }
 *      POST /v2/volunteering/qualifications/{id}/withdraw { reason }
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import BadgeCheck from 'lucide-react/icons/badge-check';
import Building2 from 'lucide-react/icons/building-2';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import ChevronDown from 'lucide-react/icons/chevron-down';
import CircleX from 'lucide-react/icons/circle-x';
import Clock from 'lucide-react/icons/clock';
import Hourglass from 'lucide-react/icons/hourglass';
import Search from 'lucide-react/icons/search';

import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/Spinner';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { Tooltip } from '@/components/ui/Tooltip';
import { EmptyState } from '@/components/feedback';
import { useAuth, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { formatDateValue, getFormattingLocale, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { extractCollectionItems } from './extractCollectionItems';

/* ───────────────────────── Types ───────────────────────── */

export type QualificationStatus = 'recorded' | 'confirmed' | 'expired' | 'withdrawn';
export type ConfirmationMethod = 'saw_original' | 'online_register' | 'issuer_confirmed';
export type WithdrawalReason = 'volunteer_request' | 'no_longer_held' | 'entered_in_error' | 'replaced';

interface NamedRef {
  id: number;
  name: string;
}

export interface OrgQualification {
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
  withdrawal_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  volunteer: { id: number; name: string; avatar_url: string | null };
}

interface Counts {
  expiring: number;
  recorded: number;
  confirmed: number;
  expired: number;
}

interface ListPayload {
  items?: OrgQualification[];
  counts?: Partial<Counts>;
  next_cursor?: string | null;
}

interface OrgQualificationsTabProps {
  orgId: number;
}

/* ───────────────────────── Constants ───────────────────────── */

type StatusFilter = 'attention' | 'confirmed' | 'expired' | 'all';
const STATUS_FILTERS: readonly StatusFilter[] = ['attention', 'confirmed', 'expired', 'all'];
const DEFAULT_FILTER: StatusFilter = 'attention';

export const CONFIRMATION_METHODS: readonly ConfirmationMethod[] = ['saw_original', 'online_register', 'issuer_confirmed'];
export const WITHDRAWAL_REASONS: readonly WithdrawalReason[] = ['volunteer_request', 'no_longer_held', 'entered_in_error', 'replaced'];

const PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const EMPTY_COUNTS: Counts = { expiring: 0, recorded: 0, confirmed: 0, expired: 0 };

type ChipLook = { color: 'default' | 'accent' | 'warning' | 'success' | 'danger'; variant: 'soft' | 'secondary' };

// The neutral soft chip is near-invisible on a white card, so the uncoloured
// values are outlined instead; the theme has no numbered shades.
const STATUS_LOOK: Record<QualificationStatus, ChipLook> = {
  recorded: { color: 'accent', variant: 'soft' },
  confirmed: { color: 'success', variant: 'soft' },
  expired: { color: 'danger', variant: 'soft' },
  withdrawn: { color: 'default', variant: 'secondary' },
};

// Volunteering brand gradient — mirrors VOL_GRADIENT in VolunteeringPage.
const VOL_GRADIENT = 'bg-linear-to-r from-rose-500 to-pink-600 text-white';

/* ───────────────────────── Helpers ───────────────────────── */

/** Dates arrive as `YYYY-MM-DD`; parse them as local calendar days, not UTC midnight. */
function parseCalendarDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

export function calendarDate(iso: string): string {
  return formatDateValue(parseCalendarDate(iso));
}

/** Whole calendar days from today to `iso` (negative when in the past). */
function daysFromToday(iso: string): number {
  const target = parseCalendarDate(iso);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86_400_000);
}

export function relativeDays(iso: string): string {
  try {
    return new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' }).format(daysFromToday(iso), 'day');
  } catch {
    return '';
  }
}

function readPayload(data: unknown): { items: OrgQualification[]; counts: Counts; nextCursor: string | null } {
  const payload = (data && typeof data === 'object' ? data : {}) as ListPayload;
  const items = extractCollectionItems<OrgQualification>(data);
  return {
    items,
    counts: { ...EMPTY_COUNTS, ...(payload.counts ?? {}) },
    nextCursor: payload.next_cursor ?? null,
  };
}

/* ───────────────────────── Component ───────────────────────── */

export default function OrgQualificationsTab({ orgId }: OrgQualificationsTabProps) {
  const { t } = useTranslation('volunteering');
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState<OrgQualification[]>([]);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>(DEFAULT_FILTER);
  const [searchInput, setSearchInput] = useState('');
  const [query, setQuery] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Confirm / withdraw dialogs
  const [confirmTarget, setConfirmTarget] = useState<OrgQualification | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<ConfirmationMethod>('saw_original');
  const [withdrawTarget, setWithdrawTarget] = useState<OrgQualification | null>(null);
  const [withdrawReason, setWithdrawReason] = useState<WithdrawalReason>('volunteer_request');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const cursorRef = useRef<string | null>(null);
  const tRef = useRef(t);
  tRef.current = t;

  // ----- Search: typed freely, reaches the server after a short pause -----
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setQuery(value.trim()), SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // ----- Loading -----
  const load = useCallback(async (append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (append) setIsLoadingMore(true);
    else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const params = new URLSearchParams({ per_page: String(PER_PAGE) });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (query) params.set('q', query);
      if (append && cursorRef.current) params.set('cursor', cursorRef.current);

      const response = await api.get<ListPayload>(`/v2/volunteering/organizations/${orgId}/qualifications?${params}`);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const parsed = readPayload(response.data);
        setItems((prev) => (append ? [...prev, ...parsed.items] : parsed.items));
        setCounts(parsed.counts);
        cursorRef.current = parsed.nextCursor;
        setNextCursor(parsed.nextCursor);
        setHasLoaded(true);
      } else if (!append) {
        setError(tRef.current('org_qualifications.load_error'));
      } else {
        toast.error(tRef.current('org_qualifications.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load organisation qualifications', err);
      if (!append) setError(tRef.current('org_qualifications.load_error'));
      else toast.error(tRef.current('org_qualifications.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [orgId, statusFilter, query, toast]);

  useEffect(() => {
    cursorRef.current = null;
    void load();
    return () => { abortRef.current?.abort(); };
  }, [load]);

  // ----- Actions -----

  const openConfirm = (item: OrgQualification) => {
    setConfirmMethod('saw_original');
    setConfirmTarget(item);
  };

  const openWithdraw = (item: OrgQualification) => {
    setWithdrawReason('volunteer_request');
    setWithdrawTarget(item);
  };

  const actionErrorMessage = (code: string | undefined, fallback: string | undefined): string => {
    if (code === 'SELF_CONFIRMATION') return t('org_qualifications.confirm.self');
    if (code === 'EXPIRED') return t('org_qualifications.confirm.expired_hint');
    return fallback || t('org_qualifications.load_error');
  };

  const submitConfirm = async () => {
    if (!confirmTarget) return;
    setIsSubmitting(true);
    try {
      const response = await api.post(`/v2/volunteering/qualifications/${confirmTarget.id}/confirm`, {
        method: confirmMethod,
        organization_id: orgId,
      });
      if (response.success) {
        toast.success(t('org_qualifications.confirm.done'));
        setConfirmTarget(null);
        cursorRef.current = null;
        void load();
      } else {
        toast.error(actionErrorMessage(response.code, response.error));
      }
    } catch (err) {
      logError('Failed to confirm qualification', err);
      toast.error(t('org_qualifications.load_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitWithdraw = async () => {
    if (!withdrawTarget) return;
    setIsSubmitting(true);
    try {
      const response = await api.post(`/v2/volunteering/qualifications/${withdrawTarget.id}/withdraw`, {
        reason: withdrawReason,
      });
      if (response.success) {
        toast.success(t('org_qualifications.withdraw.done'));
        setWithdrawTarget(null);
        cursorRef.current = null;
        void load();
      } else {
        toast.error(response.error || t('org_qualifications.load_error'));
      }
    } catch (err) {
      logError('Failed to withdraw qualification', err);
      toast.error(t('org_qualifications.load_error'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // ----- Labels -----

  const typeLabel = (item: OrgQualification): string => {
    const key = `qualifications.types.${item.qualification_type}`;
    const label = t(key, { defaultValue: '' });
    return label || item.title || item.qualification_type;
  };

  const expiryLine = (item: OrgQualification): string => {
    if (!item.expires_at) return t('qualifications.no_expiry');
    const date = calendarDate(item.expires_at);
    if (item.status === 'expired') return t('qualifications.expired_on', { date });
    const base = t('qualifications.expires_on', { date });
    return item.is_expiring ? `${base} · ${relativeDays(item.expires_at)}` : base;
  };

  const confirmationLine = (item: OrgQualification): string | null => {
    if (item.status !== 'confirmed' || !item.confirmed_by || !item.confirmed_at) return null;
    const date = formatDateValue(new Date(item.confirmed_at));
    const line = item.confirmed_for_organization
      ? t('qualifications.confirmed_line_org', { name: item.confirmed_by.name, org: item.confirmed_for_organization.name, date })
      : t('qualifications.confirmed_line', { name: item.confirmed_by.name, date });
    const method = item.confirmation_method ? t(`qualifications.method.${item.confirmation_method}`, { defaultValue: '' }) : '';
    return method ? `${line} · ${method}` : line;
  };

  const filterSelection = useMemo(() => new Set<Key>([statusFilter]), [statusFilter]);
  const showSkeleton = isLoading && !hasLoaded;
  const resultsLabel = t('org_qualifications.results', { number: items.length.toLocaleString(getFormattingLocale()) });

  const tiles: Array<{ key: keyof Counts; icon: typeof Clock; tone: string }> = [
    { key: 'expiring', icon: Hourglass, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    { key: 'recorded', icon: Clock, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
    { key: 'confirmed', icon: CheckCircle, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    { key: 'expired', icon: CircleX, tone: 'bg-rose-500/10 text-rose-500' },
  ];

  return (
    <div className="space-y-4">
      {/* Intro */}
      <GlassCard className="p-5">
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${VOL_GRADIENT}`}>
            <BadgeCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-theme-primary">{t('org_qualifications.heading')}</h2>
            <p className="text-sm text-theme-muted">{t('org_qualifications.intro')}</p>
          </div>
        </div>
      </GlassCard>

      {/* Error */}
      {error && !isLoading && (
        <Alert
          color="danger"
          title={error}
          endContent={
            <Button size="sm" variant="secondary" onPress={() => { cursorRef.current = null; void load(); }}>
              {t('try_again')}
            </Button>
          }
        />
      )}

      {/* First load */}
      {showSkeleton && (
        <div className="space-y-4" role="status" aria-busy="true" aria-label={t('loading')}>
          {[1, 2, 3].map((i) => <CardRowsSkeleton key={i} />)}
        </div>
      )}

      {hasLoaded && (
        <div className={`space-y-4 transition-opacity ${isLoading ? 'opacity-60' : ''}`} aria-busy={isLoading || undefined}>
          {/* Tiles */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {tiles.map(({ key, icon: Icon, tone }) => (
              <GlassCard key={key} className="p-4">
                <div className="flex items-center gap-3">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-theme-muted">{t(`org_qualifications.tiles.${key}`)}</p>
                    <p className="text-xl font-bold text-theme-primary tabular-nums">{counts[key].toLocaleString(getFormattingLocale())}</p>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <ToggleButtonGroup
              aria-label={t('org_qualifications.heading')}
              selectionMode="single"
              disallowEmptySelection
              isDetached
              size="sm"
              selectedKeys={filterSelection}
              onSelectionChange={(keys) => {
                const [key] = Array.from(keys);
                const next = key == null ? DEFAULT_FILTER : String(key);
                setStatusFilter((STATUS_FILTERS as readonly string[]).includes(next) ? (next as StatusFilter) : DEFAULT_FILTER);
              }}
              className="flex flex-wrap justify-start gap-2"
            >
              {STATUS_FILTERS.map((key) => (
                <ToggleButton key={key} id={key}>{t(`org_qualifications.filters.${key}`)}</ToggleButton>
              ))}
            </ToggleButtonGroup>

            <Input
              type="search"
              name="org-qualifications-search"
              autoComplete="off"
              aria-label={t('org_qualifications.search_placeholder')}
              placeholder={t('org_qualifications.search_placeholder')}
              className="w-full sm:max-w-[260px]"
              size="sm"
              startContent={<Search className="h-4 w-4 text-theme-subtle" aria-hidden="true" />}
              value={searchInput}
              onValueChange={handleSearchChange}
              isClearable
              onClear={() => { setSearchInput(''); setQuery(''); }}
            />
          </div>

          {/* List */}
          {items.length === 0 ? (
            <EmptyState
              icon={<BadgeCheck className="h-12 w-12" aria-hidden="true" />}
              title={t('org_qualifications.empty_title')}
              description={t('org_qualifications.empty_body')}
            />
          ) : (
            <GlassCard className="p-4 sm:p-6">
              <p className="mb-3 text-sm text-theme-muted" aria-live="polite">{resultsLabel}</p>
              <ul className="space-y-3">
                {items.map((item) => {
                  const look = STATUS_LOOK[item.status] ?? STATUS_LOOK.recorded;
                  const isOwn = user?.id != null && Number(user.id) === Number(item.user_id);
                  // Confirm is offered on anything not yet confirmed, but an expired
                  // record cannot be confirmed (the volunteer updates the expiry
                  // first) and nobody confirms their own record.
                  const confirmBlocked = item.status === 'expired' ? t('org_qualifications.confirm.expired_hint')
                    : isOwn ? t('org_qualifications.confirm.self')
                    : null;
                  const showConfirm = item.status === 'recorded' || item.status === 'expired';
                  const showWithdraw = item.status !== 'withdrawn';
                  const confirmation = confirmationLine(item);
                  const label = typeLabel(item);
                  const showTitle = Boolean(item.title) && item.title !== label;

                  return (
                    <li
                      key={item.id}
                      className={`flex flex-col gap-3 rounded-xl border border-theme-default bg-theme-elevated p-4 ${
                        item.status === 'expired' ? 'border-l-4 border-l-[var(--color-error)]' : item.is_expiring ? 'border-l-4 border-l-[var(--color-warning)]' : ''
                      }`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                        <Link
                          to={tenantPath(`/profile/${item.volunteer.id}`)}
                          className="flex min-w-0 items-center gap-3 sm:w-56 sm:shrink-0"
                        >
                          <Avatar
                            src={resolveAvatarUrl(item.volunteer.avatar_url) || undefined}
                            name={item.volunteer.name}
                            size="md"
                            className="shrink-0"
                          />
                          <span className="truncate text-sm font-medium text-theme-primary hover:underline">{item.volunteer.name}</span>
                        </Link>

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-theme-primary">{label}</p>
                            <Chip size="sm" color={look.color} variant={look.variant}>
                              {t(`qualifications.status.${item.status}`)}
                            </Chip>
                            {item.is_expiring && item.status !== 'expired' && (
                              <Chip size="sm" color="warning" variant="soft" startContent={<Hourglass className="h-3 w-3" aria-hidden="true" />}>
                                {t('qualifications.status.expiring')}
                              </Chip>
                            )}
                          </div>
                          {showTitle && <p className="text-sm text-theme-muted">{item.title}</p>}
                          <p className="text-xs text-theme-subtle">
                            {[
                              item.issuer,
                              item.reference_number ? t('qualifications.reference', { ref: item.reference_number }) : null,
                              item.obtained_at ? t('qualifications.obtained_on', { date: calendarDate(item.obtained_at) }) : null,
                            ].filter(Boolean).join(' · ')}
                          </p>
                          <p className={`text-xs ${item.status === 'expired' ? 'font-semibold text-[var(--color-error)]' : item.is_expiring ? 'font-semibold text-[var(--color-warning)]' : 'text-theme-subtle'}`}>
                            {expiryLine(item)}
                          </p>
                          {confirmation && (
                            <p className="flex items-center gap-1 text-xs text-theme-subtle">
                              <Building2 className="h-3 w-3" aria-hidden="true" />
                              {confirmation}
                            </p>
                          )}
                          {item.status === 'withdrawn' && item.withdrawn_at && (
                            <p className="text-xs text-theme-subtle">
                              {t('qualifications.withdrawn_line', { date: formatDateValue(new Date(item.withdrawn_at)) })}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                          {showConfirm && (
                            <Tooltip content={confirmBlocked ?? undefined} isDisabled={!confirmBlocked}>
                              <span className="inline-flex">
                                <Button
                                  size="sm"
                                  className={VOL_GRADIENT}
                                  startContent={<CheckCircle className="h-4 w-4" aria-hidden="true" />}
                                  isDisabled={Boolean(confirmBlocked)}
                                  onPress={() => openConfirm(item)}
                                >
                                  {t('org_qualifications.actions.confirm')}
                                </Button>
                              </span>
                            </Tooltip>
                          )}
                          {showWithdraw && (
                            <Button size="sm" variant="tertiary" onPress={() => openWithdraw(item)}>
                              {t('org_qualifications.actions.withdraw')}
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>

              {nextCursor && (
                <div className="flex justify-center pt-4">
                  <Button
                    size="sm"
                    variant="tertiary"
                    startContent={isLoadingMore ? <Spinner size="sm" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
                    isDisabled={isLoadingMore}
                    onPress={() => void load(true)}
                  >
                    {t('org_qualifications.load_more')}
                  </Button>
                </div>
              )}
            </GlassCard>
          )}
        </div>
      )}

      {/* Confirm modal */}
      <Modal isOpen={confirmTarget !== null} onOpenChange={(open) => { if (!open && !isSubmitting) setConfirmTarget(null); }} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-[var(--color-success)]" aria-hidden="true" />
                {t('org_qualifications.confirm.title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {confirmTarget && (
                  <p className="text-sm text-theme-muted">
                    {t('org_qualifications.confirm.body', { name: confirmTarget.volunteer.name })}
                  </p>
                )}
                {confirmTarget && (
                  <p className="text-sm font-medium text-theme-primary">
                    {typeLabel(confirmTarget)}{confirmTarget.title && confirmTarget.title !== typeLabel(confirmTarget) ? ` — ${confirmTarget.title}` : ''}
                  </p>
                )}
                <RadioGroup
                  label={t('org_qualifications.confirm.method')}
                  value={confirmMethod}
                  onValueChange={(value) => setConfirmMethod(value as ConfirmationMethod)}
                >
                  {CONFIRMATION_METHODS.map((method) => (
                    <Radio key={method} value={method}>{t(`org_qualifications.confirm.methods.${method}`)}</Radio>
                  ))}
                </RadioGroup>
                <p className="text-xs text-theme-subtle">{t('org_qualifications.intro')}</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={isSubmitting}>
                  {t('cancel')}
                </Button>
                <Button className={VOL_GRADIENT} onPress={() => void submitConfirm()} isLoading={isSubmitting} isDisabled={isSubmitting}>
                  {t('org_qualifications.confirm.submit')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Withdraw modal */}
      <Modal isOpen={withdrawTarget !== null} onOpenChange={(open) => { if (!open && !isSubmitting) setWithdrawTarget(null); }} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <CircleX className="h-5 w-5 text-[var(--color-error)]" aria-hidden="true" />
                {t('org_qualifications.withdraw.title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <p className="text-sm text-theme-muted">{t('org_qualifications.withdraw.body')}</p>
                <RadioGroup
                  label={t('org_qualifications.withdraw.reason')}
                  value={withdrawReason}
                  onValueChange={(value) => setWithdrawReason(value as WithdrawalReason)}
                >
                  {WITHDRAWAL_REASONS.map((reason) => (
                    <Radio key={reason} value={reason}>{t(`org_qualifications.withdraw.reasons.${reason}`)}</Radio>
                  ))}
                </RadioGroup>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={isSubmitting}>
                  {t('cancel')}
                </Button>
                <Button variant="danger" onPress={() => void submitWithdraw()} isLoading={isSubmitting} isDisabled={isSubmitting}>
                  {t('org_qualifications.withdraw.confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
