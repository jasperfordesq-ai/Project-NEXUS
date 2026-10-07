// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Certificates
 * Admin page listing the volunteer certificates issued in the community. A
 * certificate is shown to employers and anyone the volunteer gives the code
 * to, so staff can view the printable copy and revoke one issued in error.
 * A revoked certificate fails the public check exactly as an unknown code does.
 *
 * The filters live in the address (?status=&q=&page=) so a reload, the back
 * button or a shared link keeps them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import Award from 'lucide-react/icons/award';
import Ban from 'lucide-react/icons/ban';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';

import { formatDateValue, getFormattingLocale } from '@/lib/helpers';
import {
  Alert, Avatar, Button, Card, CardBody, Chip, Input, Pagination, Spinner, Textarea,
  ToggleButton, ToggleButtonGroup,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminVolunteering } from '../../api/adminApi';
import type {
  AdminVolunteerCertificate,
  AdminVolunteerCertificatesParams,
  AdminVolunteerCertificatesResponse,
} from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { StatCard } from '../../components/StatCard';

// ── Filters ──────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'revoked';
const STATUS_FILTERS: readonly StatusFilter[] = ['all', 'active', 'revoked'];
const DEFAULT_STATUS: StatusFilter = 'all';
const isStatusFilter = (value: string | null | undefined): value is StatusFilter =>
  typeof value === 'string' && (STATUS_FILTERS as readonly string[]).includes(value);

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;
const REASON_MAX = 500;

type Counts = AdminVolunteerCertificatesResponse['counts'];
const EMPTY_COUNTS: Counts = { active: 0, revoked: 0 };

/** Dates arrive as `YYYY-MM-DD`; parse them as local calendar days, not UTC midnight. */
const calendarDate = (value: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  return formatDateValue(m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value));
};

// ── Component ────────────────────────────────────────────────────────────────

export function VolunteerCertificates() {
  const { t } = useTranslation('admin_volunteering');
  const { t: tNav } = useTranslation('admin_nav');
  useAdminPageMeta({ title: tNav('volunteering_nav.certificates') });
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
  const [items, setItems] = useState<AdminVolunteerCertificate[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ----- Revoke dialog -----
  const [revokeTarget, setRevokeTarget] = useState<AdminVolunteerCertificate | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: AdminVolunteerCertificatesParams = { page, per_page: ITEMS_PER_PAGE };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (searchQuery.length >= MIN_SEARCH_LENGTH) params.q = searchQuery;

      const res = await adminVolunteering.listCertificates(params);
      if (res.success && res.data) {
        const rows = Array.isArray(res.data.items) ? res.data.items : [];
        setItems(rows);
        setTotal(Number(res.data.total ?? rows.length) || 0);
        setCounts({ ...EMPTY_COUNTS, ...(res.data.counts ?? {}) });
        setHasLoaded(true);
      } else {
        setError(t('certificates.load_error'));
      }
    } catch {
      setError(t('certificates.load_error'));
    }
    setLoading(false);
  }, [page, statusFilter, searchQuery, t]);

  useEffect(() => { void load(); }, [load]);

  // ----- Actions -----
  const handleDownload = async (item: AdminVolunteerCertificate) => {
    setDownloadingId(item.id);
    try {
      await adminVolunteering.downloadCertificate(item.id, item.verification_code);
    } catch {
      toast.error(t('certificates.download_failed'));
    }
    setDownloadingId(null);
  };

  const openRevoke = (item: AdminVolunteerCertificate) => {
    setRevokeReason('');
    setRevokeTarget(item);
  };

  const handleRevoke = async () => {
    if (!revokeTarget || revokeReason.trim() === '') return;
    setSubmitting(true);
    try {
      const res = await adminVolunteering.revokeCertificate(revokeTarget.id, revokeReason.trim());
      if (res.success) {
        toast.success(t('certificates.revoke.done'));
        setRevokeTarget(null);
        await load();
      } else {
        toast.error(t('certificates.revoke.failed'));
      }
    } catch {
      toast.error(t('certificates.revoke.failed'));
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
      {t('certificates.retry')}
    </Button>
  );

  if (!hasLoaded) {
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title={t('certificates.page_title')} description={t('certificates.page_desc')} icon={<Award size={20} />} />
        <Alert color="danger" title={error || t('certificates.load_error')} endContent={retryButton} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('certificates.page_title')} description={t('certificates.page_desc')} icon={<Award size={20} />} />

      <div
        className={`flex flex-col gap-6 pb-10 transition-opacity ${loading ? 'pointer-events-none opacity-60' : ''}`}
        aria-busy={loading || undefined}
      >
        <div className="grid grid-cols-2 gap-4">
          <StatCard label={t('certificates.tiles.active')} value={counts.active} icon={CheckCircle} color="success" />
          <StatCard label={t('certificates.tiles.revoked')} value={counts.revoked} icon={Ban} color="danger" />
        </div>

        {error && <Alert color="danger" title={error} endContent={retryButton} />}

        {/* Filters */}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <ToggleButtonGroup
            aria-label={t('certificates.filters.label')}
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
              <ToggleButton key={key} id={key}>{t(`certificates.filters.${key}`)}</ToggleButton>
            ))}
          </ToggleButtonGroup>

          <Input
            type="search"
            name="admin-search"
            autoComplete="off"
            label={t('certificates.search_label')}
            placeholder={t('certificates.search_placeholder')}
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
              {t('certificates.clear_filters')}
            </Button>
          )}
        </div>

        {/* List */}
        {items.length === 0 ? (
          <EmptyState
            icon={Award}
            title={t('certificates.empty_title')}
            description={t('certificates.empty_body')}
            actionLabel={hasFilters ? t('certificates.clear_filters') : undefined}
            onAction={hasFilters ? clearFilters : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted" aria-live="polite">
              {t('certificates.results', { number: numberFmt(total) })}
            </p>

            {items.map((item) => {
              const revoked = item.revoked_at !== null;
              return (
                <Card
                  key={item.id}
                  className={`border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${revoked ? 'border-l-4 border-l-danger opacity-80' : ''}`}
                >
                  <CardBody className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
                      <Link
                        to={tenantPath(`/admin/users/${item.volunteer.id}/edit`)}
                        className="flex min-w-0 items-center gap-3 transition-colors hover:text-accent lg:w-56 lg:shrink-0"
                      >
                        <Avatar src={item.volunteer.avatar_url || undefined} name={item.volunteer.name} size="md" className="shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-foreground">{item.volunteer.name}</span>
                          <span className="block text-xs text-muted">{t('certificates.volunteer')}</span>
                        </span>
                      </Link>

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-foreground">
                            {t('certificates.hours', { number: numberFmt(item.total_hours) })}
                          </h3>
                          <Chip size="sm" color={revoked ? 'danger' : 'success'} variant="soft">
                            {revoked ? t('certificates.status.revoked') : t('certificates.status.active')}
                          </Chip>
                        </div>
                        <p className="text-xs text-muted">
                          {[
                            t('certificates.period', { start: calendarDate(item.date_range.start), end: calendarDate(item.date_range.end) }),
                            t('certificates.issued_on', { date: formatDateValue(new Date(item.generated_at)) }),
                            t('certificates.code', { code: item.verification_code }),
                          ].join(' · ')}
                        </p>
                        {item.organizations.length > 0 && (
                          <p className="text-xs text-muted [overflow-wrap:anywhere]">
                            {item.organizations.map((org) => org.name).join(', ')}
                          </p>
                        )}
                        {revoked && item.revoked_at && (
                          <p className="text-xs font-semibold text-danger [overflow-wrap:anywhere]">
                            {t('certificates.revoked_line', { date: formatDateValue(new Date(item.revoked_at)) })}
                            {item.revoke_reason ? ` — ${item.revoke_reason}` : ''}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
                        <Button
                          size="sm"
                          variant="secondary"
                          startContent={<Download size={14} aria-hidden="true" />}
                          isLoading={downloadingId === item.id}
                          onPress={() => void handleDownload(item)}
                        >
                          {t('certificates.actions.download')}
                        </Button>
                        {!revoked && (
                          <Button size="sm" variant="tertiary" onPress={() => openRevoke(item)}>
                            {t('certificates.actions.revoke')}
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

      <ConfirmModal
        isOpen={!!revokeTarget}
        onClose={() => { if (!submitting) setRevokeTarget(null); }}
        onConfirm={() => void handleRevoke()}
        title={t('certificates.revoke.title')}
        message={t('certificates.revoke.body', { name: revokeTarget?.volunteer.name ?? '', code: revokeTarget?.verification_code ?? '' })}
        confirmLabel={t('certificates.revoke.confirm')}
        confirmColor="danger"
        isLoading={submitting}
        isConfirmDisabled={revokeReason.trim() === ''}
      >
        <Textarea
          label={t('certificates.revoke.reason')}
          description={t('certificates.revoke.reason_help')}
          value={revokeReason}
          onValueChange={(value) => setRevokeReason(value.slice(0, REASON_MAX))}
          maxLength={REASON_MAX}
          isRequired
          variant="secondary"
        />
      </ConfirmModal>
    </div>
  );
}

export default VolunteerCertificates;
