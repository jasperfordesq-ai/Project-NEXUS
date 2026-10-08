// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group bookings
 * Admin page listing the places group leaders have reserved on volunteer
 * shifts for their members. Each named member is a real sign-up for the
 * shift. Staff can cancel a booking, which releases its places and every
 * member's sign-up, and tells the group.
 *
 * The filters live in the address (?status=&q=&page=) so a reload, the back
 * button or a shared link keeps them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import Ban from 'lucide-react/icons/ban';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';

import { formatDateValue, getFormattingLocale } from '@/lib/helpers';
import {
  Alert, Avatar, Button, Card, CardBody, Chip, Input, Pagination, Spinner,
  ToggleButton, ToggleButtonGroup,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminVolunteering } from '../../api/adminApi';
import type {
  AdminVolunteerGroupReservation,
  AdminVolunteerGroupReservationsParams,
  AdminVolunteerGroupReservationsResponse,
} from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { StatCard } from '../../components/StatCard';

// ── Filters ──────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'cancelled';
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'cancelled'];
const DEFAULT_STATUS: StatusFilter = 'all';
const isStatusFilter = (value: string | null | undefined): value is StatusFilter =>
  typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value);

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

type Counts = AdminVolunteerGroupReservationsResponse['counts'];
const EMPTY_COUNTS: Counts = { active: 0, cancelled: 0 };

const timeOf = (value: string) =>
  new Date(value).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });

// ── Component ────────────────────────────────────────────────────────────────

export function VolunteerGroupBookings() {
  const { t } = useTranslation('admin_volunteering');
  const { t: tNav } = useTranslation('admin_nav');
  useAdminPageMeta({ title: tNav('volunteering_nav.group_bookings') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- Filters: the address is the source of truth -----
  const rawStatus = searchParams.get('status');
  const statusFilter: StatusFilter = isStatusFilter(rawStatus) ? rawStatus : DEFAULT_STATUS;
  const searchQuery = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const hasFilters = statusFilter !== DEFAULT_STATUS || Boolean(searchQuery);

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
  const [items, setItems] = useState<AdminVolunteerGroupReservation[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- Cancel dialog -----
  const [cancelTarget, setCancelTarget] = useState<AdminVolunteerGroupReservation | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: AdminVolunteerGroupReservationsParams = { page, per_page: ITEMS_PER_PAGE };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (searchQuery.length >= MIN_SEARCH_LENGTH) params.q = searchQuery;

      const res = await adminVolunteering.listGroupReservations(params);
      if (res.success && res.data) {
        const rows = Array.isArray(res.data.items) ? res.data.items : [];
        setItems(rows);
        setTotal(Number(res.data.total ?? rows.length) || 0);
        setCounts({ ...EMPTY_COUNTS, ...(res.data.counts ?? {}) });
        setHasLoaded(true);
      } else {
        setError(t('group_bookings.load_error'));
      }
    } catch {
      setError(t('group_bookings.load_error'));
    }
    setLoading(false);
  }, [page, statusFilter, searchQuery, t]);

  useEffect(() => { void load(); }, [load]);

  // ----- Actions -----
  const handleCancel = async () => {
    if (!cancelTarget) return;
    setSubmitting(true);
    try {
      const res = await adminVolunteering.cancelGroupReservation(cancelTarget.id);
      if (res.success) {
        toast.success(t('group_bookings.cancel.done'));
        setCancelTarget(null);
        await load();
      } else {
        toast.error(t('group_bookings.cancel.failed'));
      }
    } catch {
      toast.error(t('group_bookings.cancel.failed'));
    }
    setSubmitting(false);
  };

  const clearFilters = () => {
    setSearchInput('');
    setFilter({ status: null, q: null });
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

  const retryButton = (
    <Button variant="secondary" size="sm" onPress={() => void load()} startContent={<RefreshCw size={16} aria-hidden="true" />}>
      {t('group_bookings.retry')}
    </Button>
  );

  if (!hasLoaded) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title={t('group_bookings.page_title')} description={t('group_bookings.page_desc')} icon={<Users size={20} />} />
        <Alert color="danger" title={error || t('group_bookings.load_error')} endContent={retryButton} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('group_bookings.page_title')} description={t('group_bookings.page_desc')} icon={<Users size={20} />} />

      <div
        className={`flex flex-col gap-6 pb-10 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={loading || undefined}
      >
        <div className="grid grid-cols-2 gap-4">
          <StatCard label={t('group_bookings.tiles.active')} value={counts.active} icon={CheckCircle} color="success" />
          <StatCard label={t('group_bookings.tiles.cancelled')} value={counts.cancelled} icon={Ban} color="danger" />
        </div>

        {error && <Alert color="danger" title={error} endContent={retryButton} />}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <ToggleButtonGroup
            aria-label={t('group_bookings.filters.label')}
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
              <ToggleButton key={key} id={key}>{t(`group_bookings.filters.${key}`)}</ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input
            type="search"
            name="admin-search"
            autoComplete="off"
            label={t('group_bookings.search_label')}
            placeholder={t('group_bookings.search_placeholder')}
            className="w-full sm:max-w-[320px]"
            size="sm"
            startContent={<Search size={14} />}
            value={searchInput}
            onValueChange={handleSearchChange}
            isClearable
            onClear={() => { setSearchInput(''); setFilter({ q: null }); }}
          />

          {hasFilters && (
            <Button size="sm" variant="tertiary" onPress={clearFilters} className="self-start sm:self-end">
              {t('group_bookings.clear_filters')}
            </Button>
          )}
        </div>

        {/* List */}
        {items.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('group_bookings.empty_title')}
            description={t('group_bookings.empty_body')}
            actionLabel={hasFilters ? t('group_bookings.clear_filters') : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {t('group_bookings.results', { number: numberFmt(total) })}
            </p>

            {items.map((item) => {
              const cancelled = item.status === 'cancelled';
              return (
                <Card
                  key={item.id}
                  className={`border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${cancelled ? 'border-l-4 border-l-danger opacity-80' : ''}`}
                >
                  <CardBody className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      {item.leader ? (
                        <Link
                          to={tenantPath(`/admin/users/${item.leader.id}/edit`)}
                          className="flex min-w-0 items-center gap-3 transition-colors hover:text-accent lg:w-56 lg:shrink-0"
                        >
                          <Avatar src={item.leader.avatar_url || undefined} name={item.leader.name} size="md" className="shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-foreground">{item.leader.name}</span>
                            <span className="block text-xs text-muted">{t('group_bookings.leader')}</span>
                          </span>
                        </Link>
                      ) : (
                        <div className="lg:w-56 lg:shrink-0" />
                      )}

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">{item.group?.name ?? ''}</h3>
                          <Chip size="sm" color={cancelled ? 'danger' : item.status === 'active' ? 'success' : 'default'} variant="soft">
                            {t(`group_bookings.status.${item.status}`)}
                          </Chip>
                        </div>
                        <p className="text-sm text-foreground">
                          {item.opportunity.title}
                          {item.organization ? ` · ${item.organization.name}` : ''}
                        </p>
                        <p className="text-xs text-muted">
                          {[
                            t('group_bookings.shift_line', {
                              date: formatDateValue(new Date(item.shift.start_time)),
                              start: timeOf(item.shift.start_time),
                              end: timeOf(item.shift.end_time),
                            }),
                            t('group_bookings.places', { filled: numberFmt(item.filled_slots), reserved: numberFmt(item.reserved_slots) }),
                            t('group_bookings.booked_on', { date: formatDateValue(new Date(item.created_at)) }),
                          ].join(' · ')}
                        </p>
                        <p className="text-xs text-muted [overflow-wrap:anywhere]">
                          <span className="font-medium">{t('group_bookings.members')}: </span>
                          {item.members.length > 0
                            ? item.members.map((member) => member.name).join(', ')
                            : t('group_bookings.no_members')}
                        </p>
                        {item.notes && (
                          <p className="text-xs text-muted [overflow-wrap:anywhere]">
                            <span className="font-medium">{t('group_bookings.notes')}: </span>{item.notes}
                          </p>
                        )}
                      </div>

                      {!cancelled && (
                        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                          <Button size="sm" variant="tertiary" onPress={() => setCancelTarget(item)}>
                            {t('group_bookings.actions.cancel')}
                          </Button>
                        </div>
                      )}
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

      <ConfirmModal
        isOpen={!!cancelTarget}
        onClose={() => { if (!submitting) setCancelTarget(null); }}
        onConfirm={() => void handleCancel()}
        title={t('group_bookings.cancel.title')}
        message={t('group_bookings.cancel.body', {
          group: cancelTarget?.group?.name ?? '',
          opportunity: cancelTarget?.opportunity.title ?? '',
          reserved: numberFmt(cancelTarget?.reserved_slots ?? 0),
        })}
        confirmLabel={t('group_bookings.cancel.confirm')}
        confirmColor="danger"
        isLoading={submitting}
      />
    </div>
  );
}

export default VolunteerGroupBookings;
