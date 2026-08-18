// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ClipboardList from 'lucide-react/icons/clipboard-list';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import MessageSquare from 'lucide-react/icons/message-square';
import Clock from 'lucide-react/icons/clock';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Users from 'lucide-react/icons/users';
import Plus from 'lucide-react/icons/plus';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { formatDateValue, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface OrgApplicationsTabProps {
  orgId: number;
}

interface OrgApplication {
  id: number;
  status: 'pending' | 'approved' | 'declined';
  message: string | null;
  org_note: string | null;
  created_at: string;
  user: { id: number; name: string; avatar_url: string | null; email: string };
  opportunity: { id: number; title: string };
  shift: { start_time: string; end_time: string } | null;
}

interface ApplicationsResponse {
  items: OrgApplication[];
  cursor: string | null;
  has_more: boolean;
}

type StatusFilter = 'all' | 'pending' | 'approved' | 'declined';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function statusColor(status: string): 'warning' | 'success' | 'danger' | 'default' {
  switch (status) {
    case 'pending': return 'warning';
    case 'approved': return 'success';
    case 'declined': return 'danger';
    default: return 'default';
  }
}

function formatDate(d: string) { return formatDateValue(d); }

// Bulk approve/decline runs one PUT per id, and the endpoint is rate-limited to
// ~30/min. Cap a batch at 25 so a single "select all + approve" never trips the
// limiter mid-run and leaves the selection half-processed.
const MAX_BULK = 25;

// A 429 surfaces as code 'HTTP_429' (see lib/api.ts) or a backend throttle code.
function isRateLimited(code?: string): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return c === 'HTTP_429' || c.includes('RATE') || c.includes('THROTTLE') || c.includes('TOO_MANY');
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

function OrgApplicationsTab({ orgId }: OrgApplicationsTabProps) {
  const toast = useToast();
  const { t } = useTranslation('volunteering');
  const { tenantPath, volunteeringConfig } = useTenant();

  const [applications, setApplications] = useState<OrgApplication[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionLoading, setActionLoading] = useState<Record<number, 'approve' | 'decline' | undefined>>({});
  const [nameSearch, setNameSearch] = useState('');
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [isBulkRunning, setIsBulkRunning] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const declineModal = useDisclosure();
  const [pendingDeclineIds, setPendingDeclineIds] = useState<number[]>([]);
  const [declineNote, setDeclineNote] = useState('');
  const declineNoteRequired = Boolean(volunteeringConfig?.['volunteering.require_org_note_on_decline']);

  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const abortRef = useRef<AbortController | null>(null);

  /* ---- Data fetching ---- */

  const loadApplications = useCallback(
    async (filter: StatusFilter, nextCursor: string | null = null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        if (nextCursor) setIsLoadingMore(true);
        else setIsLoading(true);

        const params = new URLSearchParams({ per_page: '20' });
        if (filter !== 'all') params.set('status', filter);
        if (nextCursor) params.set('cursor', nextCursor);

        const response = await api.get<ApplicationsResponse>(
          `/v2/volunteering/organisations/${orgId}/applications?${params}`,
        );

        if (controller.signal.aborted) return;

        if (response.success && response.data) {
          // api.get() already unwraps { data: [...], meta: {...} } → response.data = [...], response.meta = {...}
          const items = Array.isArray(response.data) ? response.data : [];
          const newCursor = response.meta?.cursor ?? null;
          const has_more = response.meta?.has_more ?? false;
          setApplications((prev) => (nextCursor ? [...prev, ...items] : items));
          setCursor(newCursor);
          setHasMore(has_more);
        } else {
          toastRef.current.error(
            response.error || tRef.current('applications.load_failed'),
          );
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        logError('Failed to load org applications', err);
        toastRef.current.error(tRef.current('applications.load_failed'));
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
          setIsLoadingMore(false);
        }
      }
    },
    [orgId],
  );

  const loadRef = useRef(loadApplications);
  loadRef.current = loadApplications;

  // Name search filters only the applications already loaded into memory. When
  // more pages exist server-side, this pulls every remaining page (bounded) so
  // the search covers all volunteers, not just the first page.
  const loadAllPages = useCallback(async () => {
    if (isLoadingAll) return;
    setIsLoadingAll(true);
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let nextCursor = cursor;
      let more = hasMore;
      let pages = 0;
      const MAX_PAGES = 50;
      while (more && pages < MAX_PAGES) {
        const params = new URLSearchParams({ per_page: '20' });
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (nextCursor) params.set('cursor', nextCursor);
        const response = await api.get<ApplicationsResponse>(
          `/v2/volunteering/organisations/${orgId}/applications?${params}`,
        );
        if (controller.signal.aborted) return;
        if (!response.success || !response.data) {
          toastRef.current.error(tRef.current('applications.load_failed'));
          break;
        }
        const items = Array.isArray(response.data) ? response.data : [];
        nextCursor = response.meta?.cursor ?? null;
        more = response.meta?.has_more ?? false;
        setApplications((prev) => [...prev, ...items]);
        pages++;
      }
      if (!controller.signal.aborted) {
        setCursor(nextCursor);
        setHasMore(more);
        if (more && pages >= MAX_PAGES) {
          toastRef.current.error(tRef.current('applications.load_all_capped'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load all org applications', err);
      toastRef.current.error(tRef.current('applications.load_failed'));
    } finally {
      if (!controller.signal.aborted) setIsLoadingAll(false);
    }
  }, [cursor, hasMore, statusFilter, orgId, isLoadingAll]);

  useEffect(() => {
    setApplications([]);
    setCursor(null);
    setSelected(new Set());
    loadRef.current(statusFilter);
    return () => { abortRef.current?.abort(); };
  }, [statusFilter]);

  /* ---- Single action ---- */

  // Returns the outcome so bulk callers can tally successes / rate-limit hits.
  // `silent` suppresses per-item toasts during a batch (the batch shows one
  // consolidated summary instead).
  async function handleAction(
    applicationId: number,
    action: 'approve' | 'decline',
    orgNote = '',
    silent = false,
  ): Promise<{ ok: boolean; rateLimited: boolean }> {
    setActionLoading((prev) => ({ ...prev, [applicationId]: action }));

    // Optimistic update
    const newStatus = action === 'approve' ? 'approved' : 'declined';
    setApplications((prev) =>
      prev.map((a) => (a.id === applicationId ? { ...a, status: newStatus as OrgApplication['status'], org_note: action === 'decline' ? orgNote || a.org_note : a.org_note } : a)),
    );

    try {
      const body: { action: 'approve' | 'decline'; org_note?: string } = { action };
      if (orgNote.trim()) body.org_note = orgNote.trim();
      const response = await api.put(`/v2/volunteering/applications/${applicationId}`, body);
      if (response.success) {
        if (!silent) {
          toast.success(
            action === 'approve'
              ? t('applications.approved')
              : t('applications.declined'),
          );
        }
        return { ok: true, rateLimited: false };
      }
      // Revert optimistic update
      setApplications((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, status: 'pending' } : a)),
      );
      if (!silent) toast.error(response.error || t('applications.action_failed'));
      return { ok: false, rateLimited: isRateLimited(response.code) };
    } catch (err) {
      // Revert optimistic update
      setApplications((prev) =>
        prev.map((a) => (a.id === applicationId ? { ...a, status: 'pending' } : a)),
      );
      logError(`Failed to ${action} application`, err);
      if (!silent) toast.error(t('something_wrong'));
      return { ok: false, rateLimited: false };
    } finally {
      setActionLoading((prev) => ({ ...prev, [applicationId]: undefined }));
    }
  }

  /* ---- Bulk action ---- */

  // Consolidated summary after a batch: successes, plus a DISTINCT message when
  // failures were rate-limit (429) so the owner knows to slow down and retry.
  function reportBatchOutcome(ok: number, failed: number, rate: number) {
    if (ok > 0) toastRef.current.success(tRef.current('applications.bulk_success', { count: ok }));
    if (rate > 0) {
      toastRef.current.error(tRef.current('applications.bulk_rate_limited', { count: rate }));
    } else if (failed > 0) {
      toastRef.current.error(tRef.current('applications.bulk_failed', { count: failed }));
    }
  }

  async function handleBulkAction(action: 'approve' | 'decline') {
    if (isBulkRunning) return; // prevent a second click re-submitting in-flight ids
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (ids.length > MAX_BULK) {
      toastRef.current.error(tRef.current('applications.bulk_limit', { max: MAX_BULK }));
      return;
    }
    setIsBulkRunning(true);
    try {
      let ok = 0, failed = 0, rate = 0;
      for (const id of ids) {
        const r = await handleAction(id, action, '', true);
        if (r.ok) ok++;
        else { failed++; if (r.rateLimited) rate++; }
      }
      setSelected(new Set());
      reportBatchOutcome(ok, failed, rate);
      loadApplications(statusFilter);
    } finally {
      setIsBulkRunning(false);
    }
  }

  function openDeclineModal(ids: number[]) {
    setPendingDeclineIds(ids);
    setDeclineNote('');
    declineModal.onOpen();
  }

  async function confirmDecline() {
    if (isBulkRunning) return; // guard double-submit (applies to single decline too)
    if (declineNoteRequired && !declineNote.trim()) return;
    const ids = pendingDeclineIds;
    if (ids.length === 0) return;
    if (ids.length > MAX_BULK) {
      toastRef.current.error(tRef.current('applications.bulk_limit', { max: MAX_BULK }));
      return;
    }

    const isBulk = ids.length > 1;
    setIsBulkRunning(true);
    try {
      let ok = 0, failed = 0, rate = 0;
      for (const id of ids) {
        const r = await handleAction(id, 'decline', declineNote.trim(), isBulk);
        if (r.ok) ok++;
        else { failed++; if (r.rateLimited) rate++; }
      }
      setSelected(new Set());
      declineModal.onClose();
      setPendingDeclineIds([]);
      setDeclineNote('');
      if (isBulk) {
        reportBatchOutcome(ok, failed, rate);
        loadApplications(statusFilter);
      }
    } finally {
      setIsBulkRunning(false);
    }
  }

  /* ---- Derived state ---- */

  const filters: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('applications.filter_all') },
    { key: 'pending', label: t('applications.filter_pending') },
    { key: 'approved', label: t('applications.filter_approved') },
    { key: 'declined', label: t('applications.filter_declined') },
  ];

  const pendingCount = applications.filter((a) => a.status === 'pending').length;

  const filteredApplications = nameSearch.trim()
    ? applications.filter((a) => a.user.name.toLowerCase().includes(nameSearch.toLowerCase()))
    : applications;

  const pendingFiltered = filteredApplications.filter((a) => a.status === 'pending');
  const allPendingSelected =
    pendingFiltered.length > 0 && pendingFiltered.every((a) => selected.has(a.id));
  const somePendingSelected =
    pendingFiltered.some((a) => selected.has(a.id)) && !allPendingSelected;

  /* ---- Render ---- */

  return (
    <GlassCard className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('applications.heading')}
          {pendingCount > 0 && (
            <Chip size="sm" color="warning" variant="soft">
              {t('applications.pending_count', { count: pendingCount })}
            </Chip>
          )}
        </h2>
        {pendingFiltered.length > 0 && (
          <Checkbox
            size="sm"
            isIndeterminate={somePendingSelected}
            isSelected={allPendingSelected}
            onValueChange={(checked) => {
              if (checked) {
                // Cap at MAX_BULK so a batch can't exceed the endpoint's limiter.
                setSelected(new Set(pendingFiltered.slice(0, MAX_BULK).map((a) => a.id)));
                if (pendingFiltered.length > MAX_BULK) {
                  toastRef.current.error(tRef.current('applications.select_all_capped', { max: MAX_BULK }));
                }
              } else {
                setSelected(new Set());
              }
            }}
            aria-label={t('applications.aria_select_all')}
          >
            <span className="text-xs text-theme-muted">{t('applications.select_all')}</span>
          </Checkbox>
        )}
      </div>

      {/* Status filter buttons */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => (
          <Button
            key={f.key}
            size="sm"
            variant={statusFilter === f.key ? 'primary' : 'tertiary'}
            className={
              statusFilter === f.key
                ? 'bg-gradient-to-r from-accent to-violet-600 text-white'
                : 'bg-theme-elevated text-theme-muted'
            }
            onPress={() => setStatusFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Search by name */}
      <SearchField
        size="sm"
        placeholder={t('applications.search_placeholder')}
        value={nameSearch}
        onValueChange={setNameSearch}
        aria-label={t('applications.aria_search_volunteers')}
        classNames={{ base: 'w-full sm:max-w-xs', inputWrapper: 'bg-theme-elevated' }}
      />

      {/* Search only covers loaded applications — offer to pull the rest. */}
      {nameSearch.trim() && hasMore && (
        <div className="flex flex-col gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-theme-warning">
            {t('applications.search_partial_hint')}
          </p>
          <Button
            size="sm"
            variant="tertiary"
            isLoading={isLoadingAll}
            onPress={loadAllPages}
          >
            {t('applications.load_all')}
          </Button>
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex flex-col gap-3 p-3 rounded-xl bg-accent/10 border border-accent/30 sm:flex-row sm:items-center">
          <span className="text-sm text-accent dark:text-accent font-medium">
            {t('applications.selected_count', { count: selected.size })}
          </span>
          <Button
            size="sm"
            variant="secondary"
            className="bg-success-soft text-success hover:bg-success-soft/80"
            startContent={<CheckCircle className="w-3.5 h-3.5" />}
            onPress={() => handleBulkAction('approve')}
            isDisabled={isBulkRunning}
            isLoading={isBulkRunning}
          >
            {t('applications.approve_all')}
          </Button>
          <Button
            size="sm"
            variant="danger-soft"
            startContent={<XCircle className="w-3.5 h-3.5" />}
            onPress={() => openDeclineModal(Array.from(selected))}
            isDisabled={isBulkRunning}
          >
            {t('applications.decline_all')}
          </Button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-8">
          <Spinner size="lg" />
        </div>
      )}

      {/* Empty state — action-led: tell the owner what to do next. */}
      {!isLoading && filteredApplications.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 flex items-center justify-center">
            <Users className="w-7 h-7 text-accent" aria-hidden="true" />
          </div>
          <div>
            <p className="text-theme-primary font-semibold">{t('applications.empty_title')}</p>
            <p className="text-sm text-theme-muted max-w-sm mx-auto">{t('applications.empty_desc')}</p>
          </div>
          <Button
            as={Link}
            to={tenantPath('/volunteering/create')}
            variant="secondary"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          >
            {t('applications.empty_cta')}
          </Button>
        </div>
      )}

      {/* Application list */}
      {!isLoading && filteredApplications.length > 0 && (
        <div className="space-y-3">
          {filteredApplications.map((app) => (
            <div
              key={app.id}
              className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-xl bg-theme-elevated border border-theme-default"
            >
              {/* Checkbox for pending */}
              {app.status === 'pending' && (
                <Checkbox
                  size="sm"
                  isSelected={selected.has(app.id)}
                  onValueChange={(checked) => {
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (checked) {
                        if (next.size >= MAX_BULK) {
                          toastRef.current.error(tRef.current('applications.select_limit', { max: MAX_BULK }));
                          return prev;
                        }
                        next.add(app.id);
                      } else next.delete(app.id);
                      return next;
                    });
                  }}
                  aria-label={t('applications.aria_select_application', {
                    name: app.user.name,
                  })}
                  className="mt-1"
                />
              )}

              {/* Avatar */}
              <Avatar
                src={resolveAvatarUrl(app.user.avatar_url)}
                name={app.user.name}
                size="md"
                className="shrink-0"
              />

              {/* Info */}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-theme-primary">{app.user.name}</span>
                  <span className="text-xs text-theme-muted">{app.user.email}</span>
                  <Chip size="sm" color={statusColor(app.status)} variant="soft">
                    {app.status === 'approved'
                      ? t('status_approved')
                      : app.status === 'declined'
                        ? t('status_declined')
                        : t('status_pending')}
                  </Chip>
                </div>

                {/* Opportunity title */}
                <p className="text-sm text-theme-secondary">
                  {t('applications.for_opportunity', { title: app.opportunity.title })}
                </p>

                {/* Application message */}
                {app.message && (
                  <div className="flex items-start gap-1.5 text-sm text-theme-muted">
                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="line-clamp-2">{app.message}</span>
                  </div>
                )}

                {/* Shift info */}
                {app.shift && (
                  <div className="flex items-center gap-1.5 text-xs text-theme-muted">
                    <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {formatDate(app.shift.start_time)} &ndash; {formatDate(app.shift.end_time)}
                    </span>
                  </div>
                )}

                {/* Applied date */}
                <p className="text-xs text-theme-subtle">
                  {t('applications.applied_on', { date: formatDate(app.created_at) })}
                </p>
              </div>

              {/* Actions */}
              {app.status === 'pending' && (
                <div className="flex gap-2 sm:flex-col sm:items-end sm:shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    className="bg-success-soft text-success hover:bg-success-soft/80"
                    isLoading={actionLoading[app.id] === 'approve'}
                    isDisabled={!!actionLoading[app.id]}
                    startContent={actionLoading[app.id] !== 'approve' ? <CheckCircle className="w-3.5 h-3.5" /> : undefined}
                    onPress={() => handleAction(app.id, 'approve')}
                  >
                    {t('applications.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger-soft"
                    isLoading={actionLoading[app.id] === 'decline'}
                    isDisabled={!!actionLoading[app.id]}
                    startContent={actionLoading[app.id] !== 'decline' ? <XCircle className="w-3.5 h-3.5" /> : undefined}
                    onPress={() => openDeclineModal([app.id])}
                  >
                    {t('applications.decline')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !isLoading && (
        <div className="flex justify-center pt-2">
          <Button
            size="sm"
            variant="tertiary"
            isLoading={isLoadingMore}
            startContent={!isLoadingMore ? <ChevronDown className="w-4 h-4" /> : undefined}
            onPress={() => loadApplications(statusFilter, cursor)}
          >
            {t('applications.load_more')}
          </Button>
        </div>
      )}

      <Modal isOpen={declineModal.isOpen} onClose={declineModal.onClose} size="md" classNames={{
        base: 'bg-overlay border border-theme-default',
      }}>
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('applications.decline_modal_title')}</ModalHeader>
          <ModalBody className="space-y-4">
            <p className="text-sm text-theme-muted">
              {t('applications.decline_modal_description', { count: pendingDeclineIds.length })}
            </p>
            <Textarea
              label={t('applications.decline_note_label')}
              placeholder={t('applications.decline_note_placeholder')}
              value={declineNote}
              onValueChange={setDeclineNote}
              minRows={3}
              isRequired={declineNoteRequired}
              classNames={{
                input: 'bg-transparent text-theme-primary',
                inputWrapper: 'bg-theme-elevated border-theme-default',
              }}
            />
            {declineNoteRequired && !declineNote.trim() && (
              <p className="text-xs text-danger">{t('applications.decline_note_required')}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={declineModal.onClose}>{t('applications.cancel')}</Button>
            <Button
              variant="danger-soft"
              onPress={confirmDecline}
              isLoading={isBulkRunning}
              isDisabled={isBulkRunning || (declineNoteRequired && !declineNote.trim())}
            >
              {t('applications.decline_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </GlassCard>
  );
}

export default OrgApplicationsTab;
