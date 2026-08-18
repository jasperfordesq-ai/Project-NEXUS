// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Opportunity Detail Page — view a single volunteering opportunity, * its shifts, and apply.
 *
 * API: GET /api/v2/volunteering/opportunities/{id}
 *      POST /api/v2/volunteering/opportunities/{id}/apply
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from '@/lib/motion';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { QrCodeImage } from '@/components/volunteering/QrCodeImage';

import MapPin from 'lucide-react/icons/map-pin';
import Calendar from 'lucide-react/icons/calendar';
import Clock from 'lucide-react/icons/clock';
import Briefcase from 'lucide-react/icons/briefcase';
import Users from 'lucide-react/icons/users';
import Building2 from 'lucide-react/icons/building-2';
import Wifi from 'lucide-react/icons/wifi';
import Tag from 'lucide-react/icons/tag';
import ChevronRight from 'lucide-react/icons/chevron-right';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import MessageSquare from 'lucide-react/icons/message-square';
import ChevronDown from 'lucide-react/icons/chevron-down';
import QrCode from 'lucide-react/icons/qr-code';
import Globe from 'lucide-react/icons/globe';
import { Helmet } from 'react-helmet-async';
import { PageMeta } from '@/components/seo';
import { LoadingScreen } from '@/components/feedback';
import { Breadcrumbs } from '@/components/navigation';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { useAuth, useTenant } from '@/contexts';
import { useToast } from '@/contexts';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getOpportunityCategoryName, type OpportunityCategory } from '@/lib/volunteering';

import { useTranslation } from 'react-i18next';
import GuardianConsentModal from '@/components/volunteering/GuardianConsentModal';
/* ───────────────────────── Types ───────────────────────── */

interface Shift {
  id: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  signup_count: number;
  spots_available: number | null;
}

interface Application {
  id: number;
  status: string;
  message: string | null;
  shift_id: number | null;
  created_at: string;
}

interface OpportunityDetail {
  id: number;
  title: string;
  description: string;
  location: string;
  skills_needed: string;
  start_date: string | null;
  end_date: string | null;
  is_active: boolean;
  is_remote: boolean;
  /** String on some endpoints, { id, name, color } object on others — always unwrap via getOpportunityCategoryName(). */
  category: OpportunityCategory;
  organization: { id: number; name: string; logo_url: string | null };
  created_at: string;
  shifts: Shift[];
  has_applied?: boolean;
  application?: Application | null;
  is_owner?: boolean;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
  federated_visibility?: 'none' | 'listed';
}

interface OppApplicationItem {
  id: number;
  status: 'pending' | 'approved' | 'declined';
  message: string | null;
  created_at: string;
  user: {
    id: number;
    name: string;
    email: string;
    avatar_url: string | null;
  };
  shift: {
    id: number;
    start_time: string;
    end_time: string;
  } | null;
}

type AppStatusFilter = 'all' | 'pending' | 'approved' | 'declined';

/* ───────────────────────── Helpers ───────────────────────── */

function formatDate(d: string) {
  return new Date(d).toLocaleDateString(getFormattingLocale(), { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatShortDate(d: string) {
  return new Date(d).toLocaleDateString(getFormattingLocale(), { weekday: 'short', month: 'short', day: 'numeric' });
}

function formatTime(d: string) {
  return new Date(d).toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });
}

function statusColor(status: string): 'warning' | 'success' | 'danger' | 'default' {
  if (status === 'pending') return 'warning';
  if (status === 'approved') return 'success';
  if (status === 'declined') return 'danger';
  return 'default';
}

function statusLabelKey(status: string): string {
  if (status === 'approved') return 'status_approved';
  if (status === 'declined') return 'status_declined';
  if (status === 'pending') return 'status_pending';
  return 'status_unknown';
}

/* ─────────────────── Shift Check-in Panel ─────────────────── */

interface CheckinData {
  qr_token: string;
  qr_url: string;
  status: 'pending' | 'checked_in' | 'checked_out';
  checked_in_at: string | null;
  checked_out_at: string | null;
}

function checkinStatusColor(status: string): 'warning' | 'success' | 'default' {
  if (status === 'checked_in') return 'success';
  if (status === 'checked_out') return 'default';
  return 'warning';
}

interface ShiftCheckinPanelProps {
  shifts: Shift[];
}

function ShiftCheckinPanel({ shifts }: ShiftCheckinPanelProps) {
  const { t } = useTranslation('volunteering');
  const [checkins, setCheckins] = useState<Record<number, CheckinData>>({});
  const [loading, setLoading] = useState(true);
  const [errorShifts, setErrorShifts] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function fetchCheckins() {
      setLoading(true);
      const results: Record<number, CheckinData> = {};
      const errors = new Set<number>();

      await Promise.all(
        shifts.map(async (shift) => {
          try {
            const response = await api.get<CheckinData>(
              `/v2/volunteering/shifts/${shift.id}/checkin`
            );
            if (!cancelled && response.success && response.data) {
              results[shift.id] = response.data;
            } else {
              errors.add(shift.id);
            }
          } catch {
            errors.add(shift.id);
          }
        })
      );

      if (!cancelled) {
        setCheckins(results);
        setErrorShifts(errors);
        setLoading(false);
      }
    }

    if (shifts.length > 0) {
      fetchCheckins();
    } else {
      setLoading(false);
    }

    return () => { cancelled = true; };
  }, [shifts]);

  // Only render if we have at least one successful check-in response
  const checkinEntries = Object.entries(checkins);
  if (loading) {
    return (
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
        <GlassCard className="p-6">
          <div className="flex justify-center py-6">
            <div role="status" aria-label={t('loading')}>
              <Spinner size="md" />
            </div>
          </div>
        </GlassCard>
      </motion.div>
    );
  }

  if (checkinEntries.length === 0) return null;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
      <GlassCard className="p-6 space-y-4">
        <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
          <QrCode className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('check_in.title')}
        </h2>
        <p className="text-sm text-theme-muted">
          {t('check_in.instructions')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {checkinEntries.map(([shiftIdStr, checkin]) => {
            const shiftId = Number(shiftIdStr);
            const shift = shifts.find((s) => s.id === shiftId);
            const statusLabel =
              checkin.status === 'checked_in'
                ? t('check_in.status_checked_in')
                : checkin.status === 'checked_out'
                  ? t('check_in.status_checked_out')
                  : t('check_in.status_pending');

            return (
              <Card key={shiftId} className="p-4">
                {shift && (
                  <p className="text-sm font-medium text-theme-primary mb-2">
                    {formatShortDate(shift.start_time)} &middot; {formatTime(shift.start_time)}–{formatTime(shift.end_time)}
                  </p>
                )}
                <div className="flex flex-col items-center gap-3">
                  <QrCodeImage
                    value={checkin.qr_url}
                    alt={t('check_in.qr_alt')}
                    size={192}
                    className="w-48 h-48 rounded-lg bg-white p-1"
                  />
                  <Chip color={checkinStatusColor(checkin.status)} variant="soft">
                    {statusLabel}
                  </Chip>
                  {checkin.checked_in_at && (
                    <p className="text-sm text-theme-muted">
                      {t('check_in.checked_in_at', { time: formatTime(checkin.checked_in_at) })}
                    </p>
                  )}
                  {checkin.checked_out_at && (
                    <p className="text-sm text-theme-muted">
                      {t('check_in.checked_out_at', { time: formatTime(checkin.checked_out_at) })}
                    </p>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
        {errorShifts.size > 0 && errorShifts.size < shifts.length && (
          <p className="text-xs text-theme-subtle">
            {t('check_in.some_unavailable')}
          </p>
        )}
      </GlassCard>
    </motion.div>
  );
}

/* ─────────────────── Applications Panel ─────────────────── */

interface ApplicationsPanelProps {
  opportunityId: number;
}

function ApplicationsPanel({ opportunityId }: ApplicationsPanelProps) {
  const toast = useToast();
  const { t } = useTranslation('volunteering');
  const { volunteeringConfig } = useTenant();
  const [applications, setApplications] = useState<OppApplicationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AppStatusFilter>('all');
  const [actionLoading, setActionLoading] = useState<Record<number, boolean>>({});
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
  const abortApplicationsRef = useRef<AbortController | null>(null);

  const loadApplications = useCallback(async (filter: AppStatusFilter, nextCursor: string | null = null) => {
    abortApplicationsRef.current?.abort();
    const controller = new AbortController();
    abortApplicationsRef.current = controller;

    try {
      if (nextCursor) setIsLoadingMore(true);
      else setIsLoading(true);

      const params = new URLSearchParams({ per_page: '20' });
      if (filter !== 'all') params.set('status', filter);
      if (nextCursor) params.set('cursor', nextCursor);

      const response = await api.get<{ items: OppApplicationItem[]; cursor: string | null; has_more: boolean }>(
        `/v2/volunteering/opportunities/${opportunityId}/applications?${params}`
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const { items, cursor: newCursor, has_more } = response.data;
        setApplications((prev) => nextCursor ? [...prev, ...items] : items);
        setCursor(newCursor);
        setHasMore(has_more);
      } else {
        toastRef.current.error(response.error || tRef.current('applications.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load applications', err);
      toastRef.current.error(tRef.current('applications.load_failed'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [opportunityId]);

  const loadApplicationsRef = useRef(loadApplications);
  loadApplicationsRef.current = loadApplications;

  // Name search filters only the loaded pages. When more exist server-side, this
  // pulls every remaining page (bounded) so a search can't falsely report "no
  // matching volunteers" when the match is simply on an unloaded page.
  const loadAllPages = useCallback(async () => {
    if (isLoadingAll) return;
    setIsLoadingAll(true);
    abortApplicationsRef.current?.abort();
    const controller = new AbortController();
    abortApplicationsRef.current = controller;
    try {
      let nextCursor = cursor;
      let more = hasMore;
      let pages = 0;
      const MAX_PAGES = 50;
      while (more && pages < MAX_PAGES) {
        const params = new URLSearchParams({ per_page: '20' });
        if (statusFilter !== 'all') params.set('status', statusFilter);
        if (nextCursor) params.set('cursor', nextCursor);
        const response = await api.get<{ items: OppApplicationItem[]; cursor: string | null; has_more: boolean }>(
          `/v2/volunteering/opportunities/${opportunityId}/applications?${params}`,
        );
        if (controller.signal.aborted) return;
        if (!response.success || !response.data) {
          toastRef.current.error(tRef.current('applications.load_failed'));
          break;
        }
        const { items, cursor: newCursor, has_more } = response.data;
        nextCursor = newCursor;
        more = has_more;
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
      logError('Failed to load all applications', err);
      toastRef.current.error(tRef.current('applications.load_failed'));
    } finally {
      if (!controller.signal.aborted) setIsLoadingAll(false);
    }
  }, [cursor, hasMore, statusFilter, opportunityId, isLoadingAll]);

  useEffect(() => {
    setApplications([]);
    setCursor(null);
    loadApplicationsRef.current(statusFilter);
    return () => { abortApplicationsRef.current?.abort(); };
  }, [statusFilter]);

  async function handleAction(applicationId: number, action: 'approve' | 'decline', orgNote = '') {
    setActionLoading((prev) => ({ ...prev, [applicationId]: true }));
    try {
      const body: { action: 'approve' | 'decline'; org_note?: string } = { action };
      if (orgNote.trim()) body.org_note = orgNote.trim();
      const response = await api.put(`/v2/volunteering/applications/${applicationId}`, body);
      if (response.success) {
        toast.success(action === 'approve' ? t('applications.approved') : t('applications.declined'));
        setApplications((prev) =>
          prev.map((a) =>
            a.id === applicationId
              ? { ...a, status: action === 'approve' ? 'approved' : 'declined' }
              : a
          )
        );
      } else {
        toast.error(response.error || t('applications.action_failed'));
      }
    } catch (err) {
      logError(`Failed to ${action} application`, err);
      toast.error(t('something_wrong'));
    } finally {
      setActionLoading((prev) => ({ ...prev, [applicationId]: false }));
    }
  }

  const filters: { key: AppStatusFilter; label: string }[] = [
    { key: 'all', label: t('applications.filter_all') },
    { key: 'pending', label: t('applications.filter_pending') },
    { key: 'approved', label: t('applications.filter_approved') },
    { key: 'declined', label: t('applications.filter_declined') },
  ];

  const pendingCount = applications.filter((a) => a.status === 'pending').length;

  const filteredApplications = nameSearch.trim()
    ? applications.filter((a) =>
        a.user.name.toLowerCase().includes(nameSearch.toLowerCase())
      )
    : applications;

  const pendingFiltered = filteredApplications.filter((a) => a.status === 'pending');
  const allPendingSelected =
    pendingFiltered.length > 0 && pendingFiltered.every((a) => selected.has(a.id));
  const somePendingSelected =
    pendingFiltered.some((a) => selected.has(a.id)) && !allPendingSelected;

  async function handleBulkAction(action: 'approve' | 'decline') {
    if (isBulkRunning) return;
    setIsBulkRunning(true);
    try {
      const ids = Array.from(selected);
      for (const id of ids) {
        await handleAction(id, action);
      }
      setSelected(new Set());
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

    const isBulk = ids.length > 1;
    setIsBulkRunning(true);
    try {
      for (const id of ids) {
        await handleAction(id, 'decline', declineNote.trim());
      }
      setSelected(new Set());
      declineModal.onClose();
      setPendingDeclineIds([]);
      setDeclineNote('');
      if (isBulk) loadApplications(statusFilter);
    } finally {
      setIsBulkRunning(false);
    }
  }

  return (
    <>
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
      <GlassCard className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <ClipboardList className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('applications.heading')}
            {pendingCount > 0 && statusFilter === 'all' && (
            <Chip size="sm" color="warning" variant="soft">{t('applications.pending_count', { count: pendingCount })}</Chip>
            )}
          </h2>
          {pendingFiltered.length > 0 && (
            <Checkbox
              size="sm"
              isIndeterminate={somePendingSelected}
              isSelected={allPendingSelected}
              onValueChange={(checked) => {
                if (checked) {
                  setSelected(new Set(pendingFiltered.map((a) => a.id)));
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

        <ToggleButtonGroup
          selectionMode="single"
          disallowEmptySelection
          selectedKeys={[statusFilter]}
          onSelectionChange={(keys) => {
            const nextFilter = Array.from(keys)[0];
            if (nextFilter) {
              setStatusFilter(String(nextFilter) as AppStatusFilter);
            }
          }}
          isDetached
          size="sm"
          className="flex flex-wrap gap-2"
          aria-label={t('applications.filter_label')}
        >
          {filters.map((f) => (
            <ToggleButton
              key={f.key}
              id={f.key}
              className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-gradient-to-r data-[selected=true]:from-accent data-[selected=true]:to-violet-600 data-[selected=true]:text-white"
            >
              {f.label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>

        <SearchField
          size="sm"
          placeholder={t('opportunity.search_placeholder')}
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

        {selected.size > 0 && (
          <div className="flex flex-col gap-3 p-3 rounded-xl bg-accent/10 border border-accent/30 sm:flex-row sm:items-center">
            <span className="text-sm text-accent dark:text-accent font-medium">{t('applications.selected_count', { count: selected.size })}</span>
            <Button
              size="sm"
              variant="secondary"
              className="bg-success/10 text-success"
              isLoading={isBulkRunning}
              isDisabled={isBulkRunning}
              startContent={!isBulkRunning ? <CheckCircle className="w-3.5 h-3.5" /> : undefined}
              onPress={() => handleBulkAction('approve')}
            >
              {t('applications.approve_all')}
            </Button>
            <Button
              size="sm"
              variant="danger-soft"
              isLoading={isBulkRunning}
              isDisabled={isBulkRunning}
              startContent={!isBulkRunning ? <XCircle className="w-3.5 h-3.5" /> : undefined}
              onPress={() => openDeclineModal(Array.from(selected))}
            >
              {t('applications.decline_all')}
            </Button>
            <Button size="sm" variant="tertiary" isDisabled={isBulkRunning} onPress={() => setSelected(new Set())}>
              {t('applications.clear')}
            </Button>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-8">
            <div role="status" aria-label={t('loading')}>
              <Spinner size="md" />
            </div>
          </div>
        ) : filteredApplications.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-10 h-10 text-theme-subtle mx-auto mb-3" aria-hidden="true" />
            <p className="text-sm text-theme-muted">
              {nameSearch.trim()
                ? t('applications.none_matching_search')
                : statusFilter === 'all'
                  ? t('applications.none_yet')
                  : t('applications.none_filtered', { status: statusFilter })}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredApplications.map((app) => (
              <div
                key={app.id}
                className="flex flex-col sm:flex-row sm:items-start gap-3 p-4 rounded-xl bg-theme-elevated border border-theme-default"
              >
                {app.status === 'pending' && (
                  <Checkbox
                    size="sm"
                    isSelected={selected.has(app.id)}
                    onValueChange={(checked) => {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.add(app.id);
                        else next.delete(app.id);
                        return next;
                      });
                    }}
                    aria-label={t('applications.aria_select_application', { name: app.user.name })}
                    className="flex-shrink-0 self-center"
                  />
                )}
                <Avatar
                  src={resolveAvatarUrl(app.user.avatar_url) || undefined}
                  name={app.user.name}
                  size="md"
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-theme-primary text-sm">{app.user.name}</span>
                    <Chip size="sm" variant="soft" color={statusColor(app.status)}>
                      {app.status === 'approved'
                        ? t('status_approved')
                        : app.status === 'declined'
                          ? t('status_declined')
                          : t('status_pending')}
                    </Chip>
                  </div>
                  {app.message && (
                    <p className="text-xs text-theme-muted flex items-start gap-1">
                      <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <span className="line-clamp-2">{app.message}</span>
                    </p>
                  )}
                  {app.shift && (
                    <p className="text-xs text-theme-subtle flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
                      {formatShortDate(app.shift.start_time)} · {formatTime(app.shift.start_time)}–{formatTime(app.shift.end_time)}
                    </p>
                  )}
                  <p className="text-xs text-theme-subtle">{t('applications.applied_date', { date: formatDate(app.created_at) })}</p>
                </div>

                {app.status === 'pending' && (
                  <div className="flex gap-2 sm:flex-shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="bg-success/10 text-success"
                      startContent={<CheckCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                      isLoading={actionLoading[app.id]}
                      onPress={() => handleAction(app.id, 'approve')}
                    >
                      {t('applications.approve')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger-soft"
                      startContent={<XCircle className="w-3.5 h-3.5" aria-hidden="true" />}
                      isLoading={actionLoading[app.id]}
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

        {hasMore && (
          <div className="flex justify-center pt-2">
            <Button
              size="sm"
              variant="secondary"
              className="bg-theme-elevated text-theme-muted"
              startContent={isLoadingMore ? <Spinner size="sm" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
              isDisabled={isLoadingMore}
              onPress={() => loadApplications(statusFilter, cursor)}
            >
              {t('applications.load_more')}
            </Button>
          </div>
        )}
      </GlassCard>
    </motion.div>
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
    </>
  );
}

/* ───────────────────────── Component ───────────────────────── */

export function OpportunityDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, user } = useAuth();
  const { tenantPath, hasFeature, volunteeringConfig } = useTenant();
  const toast = useToast();
  const { t } = useTranslation('volunteering');

  usePageTitle(t('opportunity.page_title'));

  const [opportunity, setOpportunity] = useState<OpportunityDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdatingShare, setIsUpdatingShare] = useState(false);

  // Apply modal
  const applyModal = useDisclosure();
  const [applyMessage, setApplyMessage] = useState('');
  const [isApplying, setIsApplying] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<number | null>(null);
  const [shiftAction, setShiftAction] = useState<{ id: number; type: 'signup' | 'cancel' | 'waitlist' } | null>(null);
  const qrCheckinEnabled = volunteeringConfig?.['volunteering.enable_qr_checkin'] !== false;

  // Guardian consent modal — opened when the API gates a minor with
  // GUARDIAN_CONSENT_REQUIRED (under-18 member without an active consent).
  const guardianModal = useDisclosure();
  const tRef = useRef(t);
  tRef.current = t;
  const abortLoadRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    abortLoadRef.current?.abort();
    const controller = new AbortController();
    abortLoadRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<OpportunityDetail>(`/v2/volunteering/opportunities/${id}`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setOpportunity(response.data);
      } else {
        setError(tRef.current('opportunity.not_found'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load opportunity', err);
      setError(tRef.current('opportunity.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [id]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    loadRef.current();
    return () => { abortLoadRef.current?.abort(); };
  }, [id]);

  async function handleApply() {
    if (!id) return;
    try {
      setIsApplying(true);
      const body: Record<string, unknown> = { message: applyMessage };
      if (selectedShiftId) body.shift_id = selectedShiftId;

      const response = await api.post(`/v2/volunteering/opportunities/${id}/apply`, body);
      if (response.success) {
        toast.success(t('opportunity.application_submitted'));
        applyModal.onClose();
        setApplyMessage('');
        setSelectedShiftId(null);
        load(); // Refresh to show applied state
      } else if (response.code === 'GUARDIAN_CONSENT_REQUIRED') {
        applyModal.onClose();
        guardianModal.onOpen();
      } else {
        toast.error(response.error || t('opportunity.apply_failed'));
      }
    } catch (err) {
      logError('Failed to apply', err);
      toast.error(t('something_wrong'));
    } finally {
      setIsApplying(false);
    }
  }

  async function handleShiftAction(shiftId: number, type: 'signup' | 'cancel' | 'waitlist') {
    try {
      setShiftAction({ id: shiftId, type });
      const endpoint = type === 'waitlist'
        ? `/v2/volunteering/shifts/${shiftId}/waitlist`
        : `/v2/volunteering/shifts/${shiftId}/signup`;
      const response = type === 'cancel'
        ? await api.delete(endpoint)
        : await api.post(endpoint, {});

      if (response.success) {
        toast.success(t(`opportunity.shift_${type}_success`));
        load();
      } else if (response.code === 'GUARDIAN_CONSENT_REQUIRED') {
        guardianModal.onOpen();
      } else {
        toast.error(response.error || t(`opportunity.shift_${type}_failed`));
      }
    } catch (err) {
      logError(`Failed to ${type} shift`, err);
      toast.error(t(`opportunity.shift_${type}_failed`));
    } finally {
      setShiftAction(null);
    }
  }

  async function handleFederatedShareChange(share: boolean) {
    if (!id) return;
    const visibility = share ? 'listed' : 'none';
    try {
      setIsUpdatingShare(true);
      const response = await api.put(`/v2/volunteering/opportunities/${id}`, {
        federated_visibility: visibility,
      });
      if (response.success) {
        setOpportunity((prev) => (prev ? { ...prev, federated_visibility: visibility } : prev));
        toast.success(t('federation_share_updated'));
      } else {
        toast.error(t('federation_share_update_failed'));
      }
    } catch (err) {
      logError('Failed to update federated visibility', err);
      toast.error(t('federation_share_update_failed'));
    } finally {
      setIsUpdatingShare(false);
    }
  }


  if (isLoading) {
    return (
      <>
        <PageMeta title={t('opportunity.page_title')} noIndex />
        <LoadingScreen />
      </>
    );
  }

  if (error || !opportunity) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <PageMeta title={t('opportunity.not_found')} noIndex />
        <GlassCard className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <p className="text-theme-muted mb-4">{error || t('opportunity.not_found')}</p>
          <Button
            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={load}
          >
            {t('opportunity.try_again')}
          </Button>
        </GlassCard>
      </div>
    );
  }

  const opp = opportunity;
  const upcomingShifts = (opp.shifts || []).filter((s) => new Date(s.start_time) >= new Date());
  const approvedApplication = opp.application?.status === 'approved' ? opp.application : null;
  const currentShiftId = approvedApplication?.shift_id ?? null;
  const cleanDescription = opp.description?.replace(/\s+/g, ' ').trim();
  const seoDescription = cleanDescription?.slice(0, 160)
    || t('opportunity.meta_description_fallback', {
      title: opp.title,
      organization: opp.organization.name,
      location: opp.location || t('opportunity.remote'),
    });
  const structuredDescription = cleanDescription?.slice(0, 300) || seoDescription;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      <PageMeta
        title={opp.title}
        description={seoDescription}
        image={opp.organization?.logo_url || undefined}
        type="article"
        publishedTime={opp.created_at}
      />
      <Helmet>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'VolunteerAction',
            name: opp.title,
            ...(structuredDescription ? { description: structuredDescription } : {}),
            ...(opp.location ? { location: { '@type': 'Place', name: opp.location } } : {}),
            ...(opp.organization ? { agent: { '@type': 'Organization', name: opp.organization.name } } : {}),
            ...(opp.start_date ? { startTime: opp.start_date } : {}),
            ...(opp.end_date ? { endTime: opp.end_date } : {}),
          }).replace(/</g, '\\u003c')}
        </script>
      </Helmet>

      <Breadcrumbs
        items={[
          { label: t('breadcrumb_volunteering'), href: tenantPath('/volunteering') },
          { label: opp.title },
        ]}
      />

      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
        {/* Header Card */}
        <GlassCard className="p-6 space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <Avatar
              src={opp.organization.logo_url || undefined}
              name={opp.organization.name}
              size="lg"
              className="flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-theme-primary">{opp.title}</h1>
              <Link
                to={tenantPath(`/organisations/${opp.organization.id}`)}
                className="text-accent hover:underline text-sm flex items-center gap-1 mt-1"
              >
                <Building2 className="w-3.5 h-3.5" aria-hidden="true" />
                {opp.organization.name}
                <ChevronRight className="w-3 h-3" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* Status Chips */}
          <div className="flex flex-wrap gap-2">
            <Chip
              size="sm"
              variant="soft"
              color={opp.is_active ? 'success' : 'danger'}
            >
              {opp.is_active ? t('opportunity.status_active') : t('opportunity.status_closed')}
            </Chip>
            {opp.is_remote && (
              <Chip size="sm" variant="soft" color="default" startContent={<Wifi className="w-3 h-3" aria-hidden="true" />}>
                {t('opportunity.remote')}
              </Chip>
            )}
            {getOpportunityCategoryName(opp.category) && (
              <Chip size="sm" variant="soft" color="accent" startContent={<Tag className="w-3 h-3" aria-hidden="true" />}>
                {getOpportunityCategoryName(opp.category)}
              </Chip>
            )}
            {opp.has_applied && (
              <Chip size="sm" variant="soft" color="success" startContent={<CheckCircle className="w-3 h-3" aria-hidden="true" />}>
                {t('opportunity.applied')}
              </Chip>
            )}
            {opp.is_owner && (
              <Chip size="sm" variant="soft" color="default" startContent={<ClipboardList className="w-3 h-3" aria-hidden="true" />}>
                {t('opportunity.your_opportunity')}
              </Chip>
            )}
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {opp.location && (
              <div className="flex items-center gap-2 text-sm text-theme-muted">
                <MapPin className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                {opp.location}
              </div>
            )}
            {opp.start_date && (
              <div className="flex items-center gap-2 text-sm text-theme-muted">
                <Calendar className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                {formatDate(opp.start_date)}
                {opp.end_date && `${t('date_range_separator')}${formatDate(opp.end_date)}`}
              </div>
            )}
            {opp.skills_needed && (
              <div className="flex items-center gap-2 text-sm text-theme-muted sm:col-span-2">
                <Briefcase className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                {opp.skills_needed}
              </div>
            )}
          </div>

          {/* Description */}
          {opp.description && (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <p className="text-theme-secondary whitespace-pre-wrap">{opp.description}</p>
            </div>
          )}

          {/* Apply button */}
          {isAuthenticated && opp.is_active && !opp.has_applied && !opp.is_owner && (
            <Button
              className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
              startContent={<Send className="w-4 h-4" aria-hidden="true" />}
              onPress={applyModal.onOpen}
            >
              {t('opportunity.apply_now')}
            </Button>
          )}

          {opp.has_applied && opp.application && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
              <CheckCircle className="w-5 h-5 text-emerald-400" aria-hidden="true" />
              <div>
                <p className="text-sm font-medium text-theme-success">
                  {t('opportunity.you_have_applied')}
                </p>
                <p className="text-xs text-theme-subtle">
                  {t('opportunity.application_status', { status: t(statusLabelKey(opp.application.status)) })} &middot; {t('opportunity.applied_on', { date: formatDate(opp.application.created_at) })}
                </p>
              </div>
            </div>
          )}

          {/* Federation sharing — owner only, when the tenant has federation */}
          {opp.is_owner && hasFeature('federation') && (
            <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-theme-elevated border border-theme-default">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-accent/20">
                  <Globe className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
                </div>
                <div>
                  <p className="font-medium text-theme-primary">
                    {t('federation_share_label')}
                  </p>
                  <p className="text-sm text-theme-subtle">
                    {t('federation_share_description')}
                  </p>
                </div>
              </div>
              <Switch
                aria-label={t('federation_share_label')}
                isSelected={opp.federated_visibility === 'listed'}
                isDisabled={isUpdatingShare}
                onValueChange={handleFederatedShareChange}
                classNames={{
                  wrapper: 'group-data-[selected=true]:bg-accent',
                }}
              />
            </div>
          )}

          <SocialInteractionPanel
            targetType="volunteer"
            targetId={opp.id}
            initialLiked={opp.is_liked ?? false}
            initialLikesCount={opp.likes_count ?? 0}
            initialCommentsCount={opp.comments_count ?? 0}
            title={opp.title}
            description={opp.description}
            targetOwnerId={opp.is_owner ? user?.id : undefined}
          />
        </GlassCard>
      </motion.div>

      {/* Shifts */}
      {upcomingShifts.length > 0 && (
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <GlassCard className="p-6 space-y-4">
            <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
              <Clock className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('opportunity.upcoming_shifts')}
            </h2>
            <div className="space-y-2">
              {upcomingShifts.map((shift) => {
                const isCurrentShift = currentShiftId === shift.id;
                const isOpenShift = shift.spots_available === null || shift.spots_available > 0;
                const activeShiftAction = shiftAction?.id === shift.id ? shiftAction.type : null;
                return (
                <div
                  key={shift.id}
                  className="flex flex-col gap-3 p-3 rounded-xl bg-theme-elevated border border-theme-default sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                    <div>
                      <p className="text-sm font-medium text-theme-primary">
                        {formatShortDate(shift.start_time)}
                      </p>
                      <p className="text-xs text-theme-subtle">
                        {formatTime(shift.start_time)} — {formatTime(shift.end_time)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Users className="w-4 h-4 text-theme-subtle" aria-hidden="true" />
                    <span className="text-xs text-theme-muted">
                      {shift.signup_count}{shift.capacity ? `/${shift.capacity}` : ''}
                    </span>
                    {isCurrentShift ? (
                      <Chip size="sm" variant="soft" color="success">{t('opportunity.shift_signed_up')}</Chip>
                    ) : isOpenShift ? (
                      <Chip size="sm" variant="soft" color="success">{t('opportunity.shift_open')}</Chip>
                    ) : (
                      <Chip size="sm" variant="soft" className="bg-danger/10 text-danger">{t('opportunity.shift_full')}</Chip>
                    )}
                    {isAuthenticated && approvedApplication && (
                      <>
                        {isCurrentShift ? (
                          <Button
                            size="sm"
                            variant="tertiary"
                            className="text-theme-muted"
                            isLoading={activeShiftAction === 'cancel'}
                            isDisabled={!!shiftAction}
                            onPress={() => handleShiftAction(shift.id, 'cancel')}
                          >
                            {t('opportunity.cancel_shift_signup')}
                          </Button>
                        ) : isOpenShift ? (
                          <Button
                            size="sm"
                            className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                            isLoading={activeShiftAction === 'signup'}
                            isDisabled={!!shiftAction}
                            onPress={() => handleShiftAction(shift.id, 'signup')}
                          >
                            {currentShiftId ? t('opportunity.switch_shift') : t('opportunity.sign_up_shift')}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="bg-theme-elevated text-theme-muted"
                            isLoading={activeShiftAction === 'waitlist'}
                            isDisabled={!!shiftAction}
                            onPress={() => handleShiftAction(shift.id, 'waitlist')}
                          >
                            {t('opportunity.join_waitlist')}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* QR Check-in — approved volunteers only */}
      {qrCheckinEnabled && opp.has_applied && opp.application?.status === 'approved' && opp.shifts && opp.shifts.length > 0 && (
        <ShiftCheckinPanel shifts={opp.shifts} />
      )}

      {/* Applications management — owner only */}
      {opp.is_owner && <ApplicationsPanel opportunityId={opp.id} />}

      {/* Apply Modal */}
      <Modal isOpen={applyModal.isOpen} onOpenChange={applyModal.onOpenChange}>
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('opportunity.apply_to', { title: opp.title })}</ModalHeader>
              <ModalBody>
                <Textarea
                  label={t('opportunity.apply_message_label')}
                  placeholder={t('opportunity.apply_message_placeholder')}
                  value={applyMessage}
                  onValueChange={setApplyMessage}
                  minRows={3}
                />
                {upcomingShifts.length > 0 && (
                  <div className="space-y-2">
                    <p id="shift-select-label" className="text-sm font-medium text-theme-muted">{t('opportunity.select_shift')}</p>
                    <div aria-labelledby="shift-select-label">
                    {upcomingShifts.filter((s) => s.spots_available === null || s.spots_available > 0).map((shift) => (
                      <Button
                        key={shift.id}
                        size="sm"
                        variant={selectedShiftId === shift.id ? 'primary' : 'secondary'}
                        className={selectedShiftId === shift.id
                          ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white w-full justify-start'
                          : 'bg-theme-elevated text-theme-muted w-full justify-start'
                        }
                        onPress={() => setSelectedShiftId(
                          selectedShiftId === shift.id ? null : shift.id
                        )}
                      >
                        {formatShortDate(shift.start_time)} &middot; {formatTime(shift.start_time)} — {formatTime(shift.end_time)}
                      </Button>
                    ))}
                    </div>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('opportunity.cancel')}</Button>
                <Button
                  className="bg-gradient-to-r from-rose-500 to-pink-600 text-white"
                  onPress={handleApply}
                  isLoading={isApplying}
                >
                  {t('opportunity.submit_application')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Guardian consent flow for under-18 members */}
      <GuardianConsentModal
        isOpen={guardianModal.isOpen}
        onOpenChange={guardianModal.onOpenChange}
        onClose={guardianModal.onClose}
        opportunityId={id ? Number(id) : undefined}
      />
    </div>
  );
}

export default OpportunityDetailPage;
