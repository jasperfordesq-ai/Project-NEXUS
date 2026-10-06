// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Qualifications
 * Admin page for the qualifications register: the training and qualifications
 * volunteers have recorded across the community. Staff confirm a record after
 * checking the original (or an online register, or with the issuer), withdraw
 * one with a reason, and see what is about to run out. Nothing is uploaded.
 *
 * The filters live in the address (?status=&q=&type=&page=) so a reload, the
 * back button or a shared link keeps them. The default view is what needs
 * attention: expiring soon plus awaiting confirmation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import BadgeCheck from 'lucide-react/icons/badge-check';
import Building2 from 'lucide-react/icons/building-2';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import CircleX from 'lucide-react/icons/circle-x';
import Clock from 'lucide-react/icons/clock';
import Hourglass from 'lucide-react/icons/hourglass';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';

import { formatDateValue, getFormattingLocale } from '@/lib/helpers';
import {
  Alert, Avatar, Button, Card, CardBody, Chip, Input, Pagination, Radio, RadioGroup,
  Select, SelectItem, Spinner, ToggleButton, ToggleButtonGroup, Tooltip,
} from '@/components/ui';
import { useAuth, useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminVolunteering } from '../../api/adminApi';
import type {
  AdminVolunteerQualification,
  AdminVolunteerQualificationsParams,
  AdminVolunteerQualificationsResponse,
  QualificationConfirmationMethod,
  QualificationWithdrawalReason,
} from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { StatCard } from '../../components/StatCard';

// ── Filters ──────────────────────────────────────────────────────────────────

type StatusFilter = 'attention' | 'confirmed' | 'expired' | 'withdrawn' | 'all';
const STATUS_FILTERS: readonly StatusFilter[] = ['attention', 'confirmed', 'expired', 'withdrawn', 'all'];
const DEFAULT_STATUS: StatusFilter = 'attention';
const isStatusFilter = (value: string | null | undefined): value is StatusFilter =>
  typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value);

// Every code the register accepts across jurisdictions (spec §3). Labels come
// from the volunteering namespace so the member, organisation and admin
// screens all name a type the same way.
const TYPE_CODES: readonly string[] = [
  'first_aid', 'safeguarding_training', 'manual_handling', 'food_hygiene', 'driving_licence',
  'professional_registration', 'children_first', 'first_aid_response', 'safeguarding_adults',
  'efaw', 'faw', 'other',
];
const isTypeCode = (value: string | null | undefined): value is string =>
  typeof value === 'string' && TYPE_CODES.includes(value);

const CONFIRMATION_METHODS: readonly QualificationConfirmationMethod[] = ['saw_original', 'online_register', 'issuer_confirmed'];
const WITHDRAWAL_REASONS: readonly QualificationWithdrawalReason[] = ['volunteer_request', 'no_longer_held', 'entered_in_error', 'replaced'];

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

type Counts = AdminVolunteerQualificationsResponse['counts'];
const EMPTY_COUNTS: Counts = { expiring: 0, recorded: 0, confirmed: 0, expired: 0 };

type ChipLook = { color: 'default' | 'accent' | 'warning' | 'success' | 'danger'; variant: 'soft' | 'secondary' };

// The neutral soft chip is near-invisible on a white card, so the uncoloured
// values are outlined ('secondary') instead; the theme has no numbered shades.
const STATUS_LOOK: Record<AdminVolunteerQualification['status'], ChipLook> = {
  recorded: { color: 'accent', variant: 'soft' },
  confirmed: { color: 'success', variant: 'soft' },
  expired: { color: 'danger', variant: 'soft' },
  withdrawn: { color: 'default', variant: 'secondary' },
};

// ── Date helpers ─────────────────────────────────────────────────────────────

/** Dates arrive as `YYYY-MM-DD`; parse them as local calendar days, not UTC midnight. */
const parseCalendarDate = (value: string): Date => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
};

const calendarDate = (value: string): string => formatDateValue(parseCalendarDate(value));

/** Whole calendar days from today to `value` (negative when in the past). */
const daysFromToday = (value: string): number => {
  const target = parseCalendarDate(value);
  if (Number.isNaN(target.getTime())) return 0;
  const today = new Date();
  const a = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const b = Date.UTC(target.getFullYear(), target.getMonth(), target.getDate());
  return Math.round((b - a) / 86_400_000);
};

const relativeDays = (value: string): string => {
  try {
    return new Intl.RelativeTimeFormat(getFormattingLocale(), { numeric: 'auto' }).format(daysFromToday(value), 'day');
  } catch {
    return '';
  }
};

// ── Component ────────────────────────────────────────────────────────────────

export function VolunteerQualifications() {
  const { t } = useTranslation('admin_volunteering');
  const { t: tVol } = useTranslation('volunteering');
  const { t: tNav } = useTranslation('admin_nav');
  useAdminPageMeta({ title: tNav('volunteering_nav.qualifications') });
  const { tenantPath } = useTenant();
  const { user } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- Filters: the address is the source of truth -----
  const rawStatus = searchParams.get('status');
  const statusFilter: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : DEFAULT_STATUS;
  const rawType = searchParams.get('type');
  const typeFilter = isTypeCode(rawType) ? rawType : '';
  const searchQuery = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const hasFilters = statusFilter !== DEFAULT_STATUS || Boolean(typeFilter || searchQuery);

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Every filter change starts from page 1 again.
  const setFilter = useCallback((changes: Record<string, string | null>) => {
    updateParams({ ...changes, page: null });
  }, [updateParams]);

  // The search box is typed into freely and only reaches the address (and the
  // server) after a short pause, instead of one request per keystroke.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setSearchInput(searchQuery); }, [searchQuery]);
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      setFilter({ q: trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : null });
    }, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // ----- List state -----
  const [items, setItems] = useState<AdminVolunteerQualification[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- Dialog state -----
  const [confirmTarget, setConfirmTarget] = useState<AdminVolunteerQualification | null>(null);
  const [confirmMethod, setConfirmMethod] = useState<QualificationConfirmationMethod>('saw_original');
  const [withdrawTarget, setWithdrawTarget] = useState<AdminVolunteerQualification | null>(null);
  const [withdrawReason, setWithdrawReason] = useState<QualificationWithdrawalReason>('volunteer_request');
  const [submitting, setSubmitting] = useState(false);

  // ----- Data loading -----
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: AdminVolunteerQualificationsParams = { page, per_page: ITEMS_PER_PAGE };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (typeFilter) params.type = typeFilter;
      if (searchQuery.length >= MIN_SEARCH_LENGTH) params.q = searchQuery;

      const res = await adminVolunteering.listQualifications(params);
      if (res.success && res.data) {
        const data = res.data;
        const rows = Array.isArray(data.items) ? data.items : [];
        setItems(rows);
        setTotal(Number(data.total ?? rows.length) || 0);
        setCounts({ ...EMPTY_COUNTS, ...(data.counts ?? {}) });
        setHasLoaded(true);
      } else {
        setError(t('qualifications.load_error'));
      }
    } catch {
      setError(t('qualifications.load_error'));
    }
    setLoading(false);
  }, [page, statusFilter, typeFilter, searchQuery, t]);

  useEffect(() => { void load(); }, [load]);

  // ----- Actions -----
  const openConfirm = (item: AdminVolunteerQualification) => {
    setConfirmMethod('saw_original');
    setConfirmTarget(item);
  };

  const openWithdraw = (item: AdminVolunteerQualification) => {
    setWithdrawReason('volunteer_request');
    setWithdrawTarget(item);
  };

  const actionError = (code: string | undefined, fallback: string | undefined): string => {
    if (code === 'SELF_CONFIRMATION') return t('qualifications.confirm.self');
    if (code === 'EXPIRED') return t('qualifications.confirm.expired_hint');
    return fallback || t('qualifications.load_error');
  };

  const handleConfirm = async () => {
    if (!confirmTarget) return;
    setSubmitting(true);
    try {
      const res = await adminVolunteering.confirmQualification(confirmTarget.id, confirmMethod);
      if (res.success) {
        toast.success(t('qualifications.confirm.done'));
        setConfirmTarget(null);
        await load();
      } else {
        toast.error(actionError(res.code, res.error));
      }
    } catch {
      toast.error(t('qualifications.load_error'));
    }
    setSubmitting(false);
  };

  const handleWithdraw = async () => {
    if (!withdrawTarget) return;
    setSubmitting(true);
    try {
      const res = await adminVolunteering.withdrawQualification(withdrawTarget.id, withdrawReason);
      if (res.success) {
        toast.success(t('qualifications.withdraw.done'));
        setWithdrawTarget(null);
        await load();
      } else {
        // The page's own wording for each refusal, not the server's text.
        toast.error(res.code === 'WITHDRAWN' ? t('qualifications.withdraw.already') : t('qualifications.withdraw.failed'));
      }
    } catch {
      toast.error(t('qualifications.load_error'));
    }
    setSubmitting(false);
  };

  // ----- Labels -----
  const typeLabel = (code: string, title: string | null): string => {
    const label = tVol(`qualifications.types.${code}`, { defaultValue: '' });
    return label || title || code;
  };

  const expiryLine = (item: AdminVolunteerQualification): string => {
    if (!item.expires_at) return tVol('qualifications.no_expiry');
    const date = calendarDate(item.expires_at);
    if (item.status === 'expired') return tVol('qualifications.expired_on', { date });
    const base = tVol('qualifications.expires_on', { date });
    return item.is_expiring ? `${base} · ${relativeDays(item.expires_at)}` : base;
  };

  const confirmationLine = (item: AdminVolunteerQualification): string | null => {
    if (item.status !== 'confirmed' || !item.confirmed_by || !item.confirmed_at) return null;
    const date = formatDateValue(new Date(item.confirmed_at));
    const line = item.confirmed_for_organization
      ? tVol('qualifications.confirmed_line_org', { name: item.confirmed_by.name, org: item.confirmed_for_organization.name, date })
      : tVol('qualifications.confirmed_line', { name: item.confirmed_by.name, date });
    const method = item.confirmation_method ? tVol(`qualifications.method.${item.confirmation_method}`, { defaultValue: '' }) : '';
    return method ? `${line} · ${method}` : line;
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilter({ status: null, type: null, q: null });
  };

  const statusSelection = useMemo(() => new Set<Key>([statusFilter]), [statusFilter]);
  const pages = Math.max(1, Math.ceil(total / ITEMS_PER_PAGE));
  const numberFmt = (n: number) => n.toLocaleString(getFormattingLocale());

  // ----- First load / failure -----
  if (loading && !hasLoaded) {
    return (
      <div className="flex min-h-[420px] items-center justify-center" role="status" aria-busy="true" aria-label={t('volunteering.loading')}>
        <Spinner size="lg" label={t('volunteering.loading')} />
      </div>
    );
  }

  if (!hasLoaded) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title={t('qualifications.page_title')} description={t('qualifications.page_desc')} icon={<BadgeCheck size={20} />} />
        <Alert
          color="danger"
          title={error || t('qualifications.load_error')}
          endContent={
            <Button variant="secondary" size="sm" onPress={() => void load()} startContent={<RefreshCw size={16} aria-hidden="true" />}>
              {t('qualifications.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  // ----- Render -----
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('qualifications.page_title')}
        description={t('qualifications.page_desc')}
        icon={<BadgeCheck size={20} />}
      />

      <div
        className={`flex flex-col gap-6 pb-10 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={loading || undefined}
      >
        {/* Tiles */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label={t('qualifications.tiles.expiring')} value={counts.expiring} icon={Hourglass} color="warning" />
          <StatCard label={t('qualifications.tiles.recorded')} value={counts.recorded} icon={Clock} color="primary" />
          <StatCard label={t('qualifications.tiles.confirmed')} value={counts.confirmed} icon={CheckCircle} color="success" />
          <StatCard label={t('qualifications.tiles.expired')} value={counts.expired} icon={CircleX} color="danger" />
        </div>

        {error && (
          <Alert
            color="danger"
            title={error}
            endContent={
              <Button variant="secondary" size="sm" onPress={() => void load()} startContent={<RefreshCw size={16} aria-hidden="true" />}>
                {t('qualifications.retry')}
              </Button>
            }
          />
        )}

        {/* Filters */}
        <div className="flex flex-col gap-4">
          <ToggleButtonGroup
            aria-label={t('qualifications.col.status')}
            selectionMode="single"
            disallowEmptySelection
            isDetached
            size="sm"
            selectedKeys={statusSelection}
            onSelectionChange={(keys) => {
              const [key] = Array.from(keys);
              const next = key == null ? '' : String(key);
              setFilter({ status: isStatusFilter(next) && next !== DEFAULT_STATUS ? next : null });
            }}
            className="flex flex-wrap justify-start gap-2"
          >
            {STATUS_FILTERS.map((key) => (
              <ToggleButton key={key} id={key}>{t(`qualifications.filters.${key}`)}</ToggleButton>
            ))}
          </ToggleButtonGroup>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <Input
              type="search"
              name="admin-search"
              autoComplete="off"
              label={t('qualifications.col.volunteer')}
              placeholder={t('qualifications.search_placeholder')}
              className="w-full sm:max-w-[280px]"
              size="sm"
              startContent={<Search size={14} />}
              value={searchInput}
              onValueChange={handleSearchChange}
              isClearable
              onClear={() => { setSearchInput(''); setFilter({ q: null }); }}
            />

            <Select
              size="sm"
              label={t('qualifications.filters.type')}
              className="w-full sm:max-w-[260px]"
              selectedKeys={[typeFilter || 'all']}
              onChange={(e) => setFilter({ type: isTypeCode(e.target.value) ? e.target.value : null })}
            >
              <SelectItem key="all" id="all">{t('qualifications.filters.all_types')}</SelectItem>
              {TYPE_CODES.map((code) => (
                <SelectItem key={code} id={code}>{typeLabel(code, null)}</SelectItem>
              ))}
            </Select>

            {hasFilters && (
              <Button size="sm" variant="tertiary" onPress={clearFilters} className="self-start sm:self-end">
                {t('qualifications.clear_filters')}
              </Button>
            )}
          </div>
        </div>

        {/* List */}
        {items.length === 0 ? (
          <EmptyState
            icon={BadgeCheck}
            title={t('qualifications.empty_title')}
            description={t('qualifications.empty_body')}
            actionLabel={hasFilters ? t('qualifications.clear_filters') : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {t('qualifications.results', { count: total, number: numberFmt(total) })}
            </p>

            {items.map((item) => {
              const look = STATUS_LOOK[item.status] ?? STATUS_LOOK.recorded;
              const isOwn = user?.id != null && Number(user.id) === Number(item.user_id);
              // Confirm is offered on anything not yet confirmed, but an expired
              // record cannot be confirmed (the volunteer updates the expiry
              // first) and nobody confirms their own record.
              const confirmBlocked = item.status === 'expired' ? t('qualifications.confirm.expired_hint')
                : isOwn ? t('qualifications.confirm.self')
                : null;
              const showConfirm = item.status === 'recorded' || item.status === 'expired';
              const showWithdraw = item.status !== 'withdrawn';
              const label = typeLabel(item.qualification_type, item.title);
              const showTitle = Boolean(item.title) && item.title !== label;
              const confirmation = confirmationLine(item);
              // An organisation's confirmation is already named in the
              // confirmation line; only a community-staff one needs saying.
              const confirmedFor = item.status === 'confirmed' && !item.confirmed_for_organization
                ? t('qualifications.community')
                : null;

              return (
                <Card
                  key={item.id}
                  className={`border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${
                    item.status === 'expired' ? 'border-l-4 border-l-danger' : item.is_expiring ? 'border-l-4 border-l-warning' : ''
                  } ${item.status === 'withdrawn' ? 'opacity-75' : ''}`}
                >
                  <CardBody className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      {/* Volunteer */}
                      <Link
                        to={tenantPath(`/admin/users/${item.user_id}/edit`)}
                        className="flex min-w-0 items-center gap-3 transition-colors hover:text-accent lg:w-56 lg:shrink-0"
                      >
                        <Avatar src={item.volunteer.avatar_url || undefined} name={item.volunteer.name} size="md" className="shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{item.volunteer.name}</span>
                          <span className="block text-xs text-muted">{t('qualifications.col.volunteer')}</span>
                        </span>
                      </Link>

                      {/* Qualification */}
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground [overflow-wrap:anywhere]">{label}</h3>
                          <Chip size="sm" color={look.color} variant={look.variant}>
                            {tVol(`qualifications.status.${item.status}`)}
                          </Chip>
                          {item.is_expiring && item.status !== 'expired' && (
                            <Chip size="sm" color="warning" variant="soft" startContent={<Hourglass size={12} aria-hidden="true" />}>
                              {tVol('qualifications.status.expiring')}
                            </Chip>
                          )}
                        </div>
                        {showTitle && <p className="text-sm text-muted [overflow-wrap:anywhere]">{item.title}</p>}
                        <p className="text-xs text-muted">
                          {[
                            item.issuer,
                            item.reference_number ? tVol('qualifications.reference', { ref: item.reference_number }) : null,
                            item.obtained_at ? tVol('qualifications.obtained_on', { date: calendarDate(item.obtained_at) }) : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                        <p className={`text-xs ${item.status === 'expired' ? 'font-semibold text-danger' : item.is_expiring ? 'font-semibold text-warning' : 'text-muted'}`}>
                          {expiryLine(item)}
                        </p>
                        {confirmedFor && (
                          <p className="flex items-center gap-1 text-xs text-muted">
                            <Building2 size={12} aria-hidden="true" />
                            <span>{t('qualifications.col.confirmed_for')}: {confirmedFor}</span>
                          </p>
                        )}
                        {confirmation && <p className="text-xs text-muted">{confirmation}</p>}
                        {item.status === 'withdrawn' && item.withdrawn_at && (
                          <p className="text-xs text-muted">
                            {tVol('qualifications.withdrawn_line', { date: formatDateValue(new Date(item.withdrawn_at)) })}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                        {showConfirm && (
                          <Tooltip content={confirmBlocked ?? undefined} isDisabled={!confirmBlocked}>
                            <span className="inline-flex">
                              <Button
                                size="sm"
                                startContent={<CheckCircle size={14} aria-hidden="true" />}
                                isDisabled={Boolean(confirmBlocked)}
                                onPress={() => openConfirm(item)}
                              >
                                {t('qualifications.actions.confirm')}
                              </Button>
                            </span>
                          </Tooltip>
                        )}
                        {showWithdraw && (
                          <Button size="sm" variant="tertiary" onPress={() => openWithdraw(item)}>
                            {t('qualifications.actions.withdraw')}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              );
            })}

            {pages > 1 && (
              <div className="mt-4 flex justify-center">
                <Pagination
                  total={pages}
                  page={page}
                  onChange={(next) => updateParams({ page: next > 1 ? String(next) : null })}
                  showControls
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirm */}
      <ConfirmModal
        isOpen={!!confirmTarget}
        onClose={() => { if (!submitting) setConfirmTarget(null); }}
        onConfirm={() => void handleConfirm()}
        title={t('qualifications.confirm.title')}
        message={t('qualifications.confirm.body', { name: confirmTarget?.volunteer.name ?? '' })}
        confirmLabel={t('qualifications.confirm.submit')}
        confirmColor="primary"
        isLoading={submitting}
      >
        {confirmTarget && (
          <p className="text-sm font-medium text-foreground">
            {typeLabel(confirmTarget.qualification_type, confirmTarget.title)}
            {confirmTarget.title && confirmTarget.title !== typeLabel(confirmTarget.qualification_type, confirmTarget.title) ? ` — ${confirmTarget.title}` : ''}
          </p>
        )}
        <RadioGroup
          label={t('qualifications.confirm.method')}
          value={confirmMethod}
          onValueChange={(value) => setConfirmMethod(value as QualificationConfirmationMethod)}
        >
          {CONFIRMATION_METHODS.map((method) => (
            <Radio key={method} value={method}>{t(`qualifications.confirm.methods.${method}`)}</Radio>
          ))}
        </RadioGroup>
      </ConfirmModal>

      {/* Withdraw */}
      <ConfirmModal
        isOpen={!!withdrawTarget}
        onClose={() => { if (!submitting) setWithdrawTarget(null); }}
        onConfirm={() => void handleWithdraw()}
        title={t('qualifications.withdraw.title')}
        message={t('qualifications.withdraw.body')}
        confirmLabel={t('qualifications.withdraw.confirm')}
        confirmColor="danger"
        isLoading={submitting}
      >
        <RadioGroup
          label={t('qualifications.withdraw.reason')}
          value={withdrawReason}
          onValueChange={(value) => setWithdrawReason(value as QualificationWithdrawalReason)}
        >
          {WITHDRAWAL_REASONS.map((reason) => (
            <Radio key={reason} value={reason}>{t(`qualifications.withdraw.reasons.${reason}`)}</Radio>
          ))}
        </RadioGroup>
      </ConfirmModal>
    </div>
  );
}

export default VolunteerQualifications;
