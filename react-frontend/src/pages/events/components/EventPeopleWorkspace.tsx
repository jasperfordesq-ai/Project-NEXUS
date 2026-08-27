// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from '@heroui/react/checkbox';
import { Label } from '@heroui/react/label';
import { SearchField } from '@heroui/react/search-field';
import Check from 'lucide-react/icons/check';
import Download from 'lucide-react/icons/download';
import History from 'lucide-react/icons/history';
import Search from 'lucide-react/icons/search';
import UserPlus from 'lucide-react/icons/user-plus';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts/ToastContext';
import {
  eventsApi,
  type EventMemberSearchResult,
  type EventPeopleBulkAction,
  type EventPeopleFullPerson,
  type EventPeopleHistoryEntry,
  type EventPeopleHistoryMeta,
  type EventPeopleMeta,
  type EventPeoplePerson,
  type EventPeopleQueryParams,
} from '@/lib/events-api';
import { resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const PAGE_SIZE = 25;
const EXPORT_INCLUDED_FIELDS = [
  'member_identity',
  'engagement_registration',
  'waitlist',
  'attendance',
  'timestamps',
] as const;
const EXPORT_EXCLUDED_FIELDS = [
  'contact_details',
  'form_answers',
  'incident_records',
  'support_notes',
  'audit_metadata',
] as const;

type RegistrationBulkAction = 'approve' | 'reject' | 'cancel';

interface PendingAction {
  action: RegistrationBulkAction;
  people: EventPeopleFullPerson[];
}

function createIdempotencyKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isFullPerson(person: EventPeoplePerson): person is EventPeopleFullPerson {
  return 'waitlist' in person && 'engagement' in person;
}

export function EventPeopleWorkspace({ eventId }: { eventId: number }) {
  const { t, i18n } = useTranslation('events');
  const toast = useToast();
  const [people, setPeople] = useState<EventPeoplePerson[]>([]);
  const [meta, setMeta] = useState<EventPeopleMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [registrationState, setRegistrationState] = useState('all');
  const [waitlistState, setWaitlistState] = useState('all');
  const [attendanceState, setAttendanceState] = useState('all');
  const [engagementState, setEngagementState] = useState('all');
  const [sort, setSort] = useState('name:asc');
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [isMutating, setIsMutating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isExportPreviewOpen, setIsExportPreviewOpen] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<EventMemberSearchResult[]>([]);
  const [selectedInvitees, setSelectedInvitees] = useState<Map<number, EventMemberSearchResult>>(
    new Map(),
  );
  const [inviteState, setInviteState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [historyTarget, setHistoryTarget] = useState<EventPeopleFullPerson | null>(null);
  const [history, setHistory] = useState<EventPeopleHistoryEntry[]>([]);
  const [historyMeta, setHistoryMeta] = useState<EventPeopleHistoryMeta | null>(null);
  const [historyState, setHistoryState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [isHistoryLoadingMore, setIsHistoryLoadingMore] = useState(false);
  const [historyLoadMoreError, setHistoryLoadMoreError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const historyTargetIdRef = useRef<number | null>(null);
  const historyGenerationRef = useRef(0);

  const queryParams = useMemo<EventPeopleQueryParams>(() => {
    const [sortField, direction] = sort.split(':') as [
      EventPeopleQueryParams['sort'],
      EventPeopleQueryParams['direction'],
    ];

    return {
      page,
      per_page: PAGE_SIZE,
      search: search.trim() || undefined,
      registration_state: registrationState === 'all' ? undefined : registrationState,
      waitlist_state: waitlistState === 'all' ? undefined : waitlistState,
      attendance_state: attendanceState === 'all' ? undefined : attendanceState,
      engagement_state: engagementState === 'all' ? undefined : engagementState,
      sort: sortField,
      direction,
    };
  }, [attendanceState, engagementState, page, registrationState, search, sort, waitlistState]);

  const loadPeople = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await eventsApi.people(
        eventId,
        queryParams,
        signal ? { signal } : undefined,
      );
      if (signal?.aborted) return;
      if (!response.success || !response.data || !response.meta) {
        setLoadError(true);
        return;
      }
      setPeople(response.data);
      setMeta(response.meta);
      const visible = new Set(response.data.map((person) => person.member.id));
      setSelectedIds((current) => new Set([...current].filter((id) => visible.has(id))));
    } catch (caught) {
      if (signal?.aborted) return;
      logError('Failed to load Event People workspace', caught);
      setLoadError(true);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [eventId, queryParams]);

  useEffect(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => void loadPeople(controller.signal), 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPeople]);

  useEffect(() => {
    const normalized = inviteQuery.trim();
    if (normalized.length < 2) {
      setInviteResults([]);
      setInviteState('idle');
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setInviteState('loading');
      void eventsApi.searchMembers(normalized, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          if (!response.success || !response.data) {
            setInviteResults([]);
            setInviteState('error');
            return;
          }
          setInviteResults(response.data);
          setInviteState('ready');
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          logError('Failed to search Event invite candidates', caught);
          setInviteResults([]);
          setInviteState('error');
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inviteQuery]);

  useEffect(() => {
    if (!historyTarget) {
      setHistory([]);
      setHistoryMeta(null);
      setHistoryState('idle');
      setIsHistoryLoadingMore(false);
      setHistoryLoadMoreError(false);
      return;
    }
    const controller = new AbortController();
    setHistoryState('loading');
    void eventsApi.peopleHistory(eventId, historyTarget.member.id, 1, 100, {
      signal: controller.signal,
    }).then((response) => {
      if (controller.signal.aborted) return;
      if (!response.success || !response.data) {
        setHistoryState('error');
        return;
      }
      setHistory(response.data);
      setHistoryMeta(response.meta ?? null);
      setHistoryState('ready');
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      logError('Failed to load Event People history', caught);
      setHistoryState('error');
    });

    return () => controller.abort();
  }, [eventId, historyTarget]);

  const loadMoreHistory = async () => {
    if (!historyTarget || !historyMeta?.has_more || isHistoryLoadingMore) return;

    const targetMemberId = historyTarget.member.id;
    const generation = historyGenerationRef.current;
    setIsHistoryLoadingMore(true);
    setHistoryLoadMoreError(false);
    try {
      const response = await eventsApi.peopleHistory(
        eventId,
        targetMemberId,
        historyMeta.current_page + 1,
        historyMeta.per_page,
      );
      if (historyTargetIdRef.current !== targetMemberId
        || historyGenerationRef.current !== generation) return;
      const entries = response.data;
      if (!response.success || !entries) {
        setHistoryLoadMoreError(true);
        return;
      }
      setHistory((current) => [...current, ...entries]);
      setHistoryMeta(response.meta ?? null);
    } catch (caught: unknown) {
      logError('Failed to load more Event People history', caught);
      setHistoryLoadMoreError(true);
    } finally {
      setIsHistoryLoadingMore(false);
    }
  };

  const fullPeople = people.filter(isFullPerson);
  const selectedPeople = fullPeople.filter((person) => selectedIds.has(person.member.id));
  const allVisibleSelected = fullPeople.length > 0
    && fullPeople.every((person) => selectedIds.has(person.member.id));
  const someVisibleSelected = fullPeople.some((person) => selectedIds.has(person.member.id));

  const resetPage = (update: () => void) => {
    setPage(1);
    update();
  };

  const memberName = (member: {
    id: number;
    display_name?: string | null;
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  }): string => member.display_name?.trim()
    || member.name?.trim()
    || resolveUserDisplayName(member)
    || t('manage.people.member_fallback', { id: member.id });

  const executeBulk = async (
    action: EventPeopleBulkAction,
    targets: EventPeopleFullPerson[],
    reason?: string,
  ) => {
    if (targets.length === 0 || isMutating) return;
    setIsMutating(true);
    try {
      const response = await eventsApi.bulkPeople(eventId, targets.map((person) => ({
        user_id: person.member.id,
        action,
        expected_version: person.registration.version ?? 0,
        idempotency_key: createIdempotencyKey(`event-people-${action}`),
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      })));
      if (!response.success || !response.data) {
        toast.error(t('manage.people.action_error'));
        return;
      }
      const firstFailure = response.data.results.find((result) => !result.success);
      if (response.data.succeeded > 0) {
        toast.success(t('manage.people.action_success', { count: response.data.succeeded }));
      }
      if (firstFailure && !firstFailure.success) {
        toast.error(firstFailure.error.message);
      }
      setSelectedIds(new Set());
      setPendingAction(null);
      setActionReason('');
      await loadPeople();
    } catch (caught) {
      logError('Failed to mutate Event People records', caught);
      toast.error(t('manage.people.action_error'));
    } finally {
      setIsMutating(false);
    }
  };

  const inviteSelected = async () => {
    const invitees = [...selectedInvitees.values()].slice(0, 100);
    if (invitees.length === 0 || isMutating) return;
    setIsMutating(true);
    try {
      const response = await eventsApi.bulkPeople(eventId, invitees.map((member) => ({
        user_id: member.id,
        action: 'invite',
        expected_version: 0,
        idempotency_key: createIdempotencyKey('event-people-invite'),
      })));
      if (!response.success || !response.data) {
        toast.error(t('manage.people.invite_error'));
        return;
      }
      const firstFailure = response.data.results.find((result) => !result.success);
      if (response.data.succeeded > 0) {
        toast.success(t('manage.people.invite_success', { count: response.data.succeeded }));
      }
      if (firstFailure && !firstFailure.success) toast.error(firstFailure.error.message);
      setSelectedInvitees(new Map());
      setInviteQuery('');
      setInviteResults([]);
      await loadPeople();
    } catch (caught) {
      logError('Failed to invite Event People members', caught);
      toast.error(t('manage.people.invite_error'));
    } finally {
      setIsMutating(false);
    }
  };

  const exportCsv = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const { page: _page, per_page: _perPage, ...filters } = queryParams;
      await eventsApi.downloadPeopleCsv(eventId, filters);
      setIsExportPreviewOpen(false);
      toast.success(t('manage.people.export_success'));
    } catch (caught) {
      logError('Failed to export Event People CSV', caught);
      toast.error(t('manage.people.export_error'));
    } finally {
      setIsExporting(false);
    }
  };

  const formatTimestamp = (value: string | null): string => {
    if (!value) return t('manage.people.not_recorded');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  };

  const stateChip = (axis: string, state: string | null) => (
    <Chip size="sm" variant="flat">
      {t(`manage.people.states.${axis}.${state ?? 'none'}`)}
    </Chip>
  );

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label={t('manage.people.metrics_aria')}>
        {(['confirmed', 'waitlisted', 'checked_in', 'checked_out', 'no_show', 'attended'] as const)
          .map((metric) => (
            <div key={metric} className="rounded-xl border border-theme-default bg-theme-surface p-4">
              <p className="text-sm text-theme-muted">{t(`manage.people.metrics.${metric}`)}</p>
              <p className="mt-1 text-2xl font-bold text-theme-primary">
                {meta?.projection === 'full' ? meta.metrics[metric] : 0}
              </p>
            </div>
          ))}
      </section>

      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-4 p-4 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-accent/10 p-2 text-accent" aria-hidden="true">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">{t('manage.people.invite_title')}</h2>
              <p className="mt-1 text-sm text-theme-muted">{t('manage.people.invite_description')}</p>
            </div>
          </div>

          <div className="relative max-w-2xl">
            <SearchField
              className="w-full"
              value={inviteQuery}
              onChange={setInviteQuery}
              aria-describedby="event-people-invite-hint"
            >
              <Label>{t('manage.people.invite_search_label')}</Label>
              <SearchField.Group>
                <SearchField.SearchIcon><Search className="h-4 w-4" aria-hidden="true" /></SearchField.SearchIcon>
                <SearchField.Input placeholder={t('manage.people.invite_search_placeholder')} />
                {inviteQuery && <SearchField.ClearButton aria-label={t('manage.people.clear_invite_search')} />}
              </SearchField.Group>
            </SearchField>
            <p id="event-people-invite-hint" className="mt-1 text-xs text-theme-subtle">
              {t('manage.people.invite_search_hint')}
            </p>
            {inviteQuery.trim().length >= 2 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-theme-default bg-theme-surface shadow-lg">
                {inviteState === 'loading' ? (
                  <div className="flex items-center gap-2 p-4 text-sm text-theme-muted" role="status">
                    <Spinner size="sm" /> {t('manage.people.searching')}
                  </div>
                ) : inviteState === 'error' ? (
                  <p className="p-4 text-sm text-danger" role="alert">{t('manage.people.invite_search_error')}</p>
                ) : inviteResults.length === 0 ? (
                  <p className="p-4 text-sm text-theme-muted" role="status">{t('manage.people.no_invite_results')}</p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto p-1" aria-label={t('manage.people.invite_results_aria')}>
                    {inviteResults.map((member) => {
                      const name = memberName(member);
                      const selected = selectedInvitees.has(member.id);
                      return (
                        <li key={member.id}>
                          <Button
                            className="h-auto min-h-11 w-full justify-start px-3 py-2 text-left"
                            variant="ghost"
                            onPress={() => setSelectedInvitees((current) => {
                              const next = new Map(current);
                              if (selected) next.delete(member.id);
                              else if (next.size < 100) next.set(member.id, member);
                              return next;
                            })}
                            aria-pressed={selected}
                          >
                            <Avatar
                              size="sm"
                              name={name}
                              src={resolveAvatarUrl(member.avatar_url ?? member.avatar ?? null)}
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                            {selected && <Check className="h-4 w-4" aria-hidden="true" />}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </div>

          {selectedInvitees.size > 0 && (
            <div className="flex flex-wrap items-center gap-2" aria-live="polite">
              {[...selectedInvitees.values()].map((member) => (
                <Chip key={member.id} size="sm" variant="flat" onClose={() => setSelectedInvitees((current) => {
                  const next = new Map(current);
                  next.delete(member.id);
                  return next;
                })}>
                  {memberName(member)}
                </Chip>
              ))}
              <Button size="sm" isLoading={isMutating} onPress={() => void inviteSelected()}>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                {t('manage.people.invite_selected', { count: selectedInvitees.size })}
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">{t('manage.people.title')}</h2>
              <p className="mt-1 text-sm text-theme-muted">{t('manage.people.description')}</p>
            </div>
            {meta?.capabilities.export_people && (
              <Button variant="outline" isLoading={isExporting} onPress={() => setIsExportPreviewOpen(true)}>
                <Download className="h-4 w-4" aria-hidden="true" />
                {t('manage.people.export')}
              </Button>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SearchField
              className="w-full"
              value={search}
              onChange={(value) => resetPage(() => setSearch(value))}
            >
              <Label>{t('manage.people.search_label')}</Label>
              <SearchField.Group>
                <SearchField.SearchIcon><Search className="h-4 w-4" aria-hidden="true" /></SearchField.SearchIcon>
                <SearchField.Input placeholder={t('manage.people.search_placeholder')} />
                {search && <SearchField.ClearButton aria-label={t('manage.people.clear_search')} />}
              </SearchField.Group>
            </SearchField>
            <PeopleFilter
              label={t('manage.people.registration_filter')}
              value={registrationState}
              options={['all', 'none', 'invited', 'pending', 'confirmed', 'declined', 'cancelled']}
              onChange={(value) => resetPage(() => setRegistrationState(value))}
            />
            <PeopleFilter
              label={t('manage.people.waitlist_filter')}
              value={waitlistState}
              options={['all', 'none', 'active', 'waiting', 'offered', 'accepted', 'expired', 'cancelled']}
              onChange={(value) => resetPage(() => setWaitlistState(value))}
            />
            <PeopleFilter
              label={t('manage.people.attendance_filter')}
              value={attendanceState}
              options={['all', 'not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show']}
              onChange={(value) => resetPage(() => setAttendanceState(value))}
            />
            <PeopleFilter
              label={t('manage.people.engagement_filter')}
              value={engagementState}
              options={['all', 'none', 'interested']}
              onChange={(value) => resetPage(() => setEngagementState(value))}
            />
            <Select
              label={t('manage.people.sort_label')}
              selectedKeys={new Set([sort])}
              onSelectionChange={(keys) => {
                const value = String(Array.from(keys as Iterable<string | number>)[0] ?? 'name:asc');
                resetPage(() => setSort(value));
              }}
            >
              {['name:asc', 'name:desc', 'registration_changed:desc', 'queue_rank:asc', 'attendance_changed:desc']
                .map((value) => (
                  <SelectItem key={value} id={value} textValue={t(`manage.people.sorts.${value.replace(':', '_')}`)}>
                    {t(`manage.people.sorts.${value.replace(':', '_')}`)}
                  </SelectItem>
                ))}
            </Select>
          </div>

          {selectedPeople.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-theme-elevated p-3" aria-live="polite">
              <span className="text-sm font-medium text-theme-primary">
                {t('manage.people.selected_count', { count: selectedPeople.length })}
              </span>
              {(['approve', 'reject', 'cancel'] as const).map((action) => (
                <Button
                  key={action}
                  size="sm"
                  variant={action === 'approve' ? 'secondary' : action === 'cancel' ? 'danger' : 'outline'}
                  onPress={() => setPendingAction({ action, people: selectedPeople })}
                >
                  {t(`manage.people.actions.${action}`)}
                </Button>
              ))}
            </div>
          )}

          {loadError ? (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-5" role="alert">
              <p className="font-semibold text-danger">{t('manage.people.load_error_title')}</p>
              <p className="mt-1 text-sm text-theme-muted">{t('manage.people.load_error_desc')}</p>
              <Button className="mt-3" size="sm" variant="outline" onPress={() => void loadPeople()}>
                {t('manage.try_again')}
              </Button>
            </div>
          ) : (
            <Table aria-label={t('manage.people.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn className="w-12">
                  <Checkbox
                    aria-label={t('manage.people.select_page')}
                    slot="selection"
                    isSelected={allVisibleSelected}
                    isIndeterminate={someVisibleSelected && !allVisibleSelected}
                    onChange={(selected) => setSelectedIds(selected
                      ? new Set(fullPeople.map((person) => person.member.id))
                      : new Set())}
                  >
                    <Checkbox.Content>
                      <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                </TableColumn>
                <TableColumn isRowHeader>{t('manage.people.columns.member')}</TableColumn>
                <TableColumn>{t('manage.people.columns.registration')}</TableColumn>
                <TableColumn>{t('manage.people.columns.waitlist')}</TableColumn>
                <TableColumn>{t('manage.people.columns.attendance')}</TableColumn>
                <TableColumn>{t('manage.people.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody
                isLoading={isLoading}
                loadingContent={<Spinner label={t('manage.people.loading')} />}
                emptyContent={t('manage.people.empty')}
              >
                {fullPeople.map((person) => {
                  const name = memberName(person.member);
                  return (
                    <TableRow key={person.member.id}>
                      <TableCell>
                        <Checkbox
                          aria-label={t('manage.people.select_member', { name })}
                          slot="selection"
                          isSelected={selectedIds.has(person.member.id)}
                          onChange={(selected) => setSelectedIds((current) => {
                            const next = new Set(current);
                            if (selected) next.add(person.member.id);
                            else next.delete(person.member.id);
                            return next;
                          })}
                        >
                          <Checkbox.Content>
                            <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-44 items-center gap-3">
                          <Avatar size="sm" name={name} src={resolveAvatarUrl(person.member.avatar_url)} />
                          <span className="font-medium text-theme-primary">{name}</span>
                        </div>
                      </TableCell>
                      <TableCell>{stateChip('registration', person.registration.state)}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          {stateChip('waitlist', person.waitlist.state)}
                          {person.waitlist.position !== null && (
                            <span className="text-xs text-theme-subtle">
                              {t('manage.people.queue_position', { position: person.waitlist.position })}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{stateChip('attendance', person.attendance.state)}</TableCell>
                      <TableCell>
                        <div className="flex min-w-52 flex-wrap gap-1.5">
                          {(['approve', 'reject', 'cancel'] as const).map((action) => person.management_actions[action] && (
                            <Button
                              key={action}
                              size="sm"
                              variant={action === 'cancel' ? 'danger' : 'ghost'}
                              onPress={() => setPendingAction({ action, people: [person] })}
                            >
                              {t(`manage.people.actions.${action}`)}
                            </Button>
                          ))}
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => {
                              historyGenerationRef.current += 1;
                              historyTargetIdRef.current = person.member.id;
                              setHistoryTarget(person);
                            }}
                          >
                            <History className="h-4 w-4" aria-hidden="true" />
                            {t('manage.people.actions.history')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {meta && meta.total_pages > 1 && (
            <div className="flex flex-col items-center justify-between gap-3 border-t border-theme-default pt-4 sm:flex-row">
              <p className="text-sm text-theme-muted">
                {t('manage.people.pagination_summary', {
                  start: (meta.current_page - 1) * meta.per_page + 1,
                  end: Math.min(meta.current_page * meta.per_page, meta.total),
                  total: meta.total,
                })}
              </p>
              <Pagination
                page={meta.current_page}
                total={meta.total_pages}
                showControls
                aria-label={t('manage.people.pagination_aria')}
                onChange={setPage}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={pendingAction !== null} onClose={() => setPendingAction(null)} size="md">
        <ModalContent>
          <ModalHeader>{pendingAction ? t(`manage.people.confirm.${pendingAction.action}_title`) : ''}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted">
              {pendingAction ? t(`manage.people.confirm.${pendingAction.action}_description`, {
                count: pendingAction.people.length,
              }) : ''}
            </p>
            {pendingAction?.action !== 'approve' && (
              <Textarea
                label={t('manage.people.reason_label')}
                value={actionReason}
                onValueChange={setActionReason}
                minRows={3}
                isRequired
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" isDisabled={isMutating} onPress={() => setPendingAction(null)}>
              {t('manage.people.keep_unchanged')}
            </Button>
            <Button
              variant={pendingAction?.action === 'cancel' ? 'danger' : 'primary'}
              isLoading={isMutating}
              isDisabled={!pendingAction || (pendingAction.action !== 'approve' && !actionReason.trim())}
              onPress={() => pendingAction && void executeBulk(
                pendingAction.action,
                pendingAction.people,
                actionReason,
              )}
            >
              {pendingAction ? t(`manage.people.actions.${pendingAction.action}`) : ''}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={isExportPreviewOpen}
        onClose={() => {
          if (!isExporting) setIsExportPreviewOpen(false);
        }}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>{t('manage.people.export_preview_title')}</ModalHeader>
          <ModalBody>
            <div className="space-y-5">
              <p className="text-sm text-theme-muted">
                {t('manage.people.export_preview_description', { count: meta?.total ?? 0 })}
              </p>
              <div className="rounded-xl border border-theme-default bg-theme-subtle p-4">
                <h3 className="font-semibold text-theme-primary">{t('manage.people.export_included_title')}</h3>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-theme-muted">
                  {EXPORT_INCLUDED_FIELDS.map((field) => (
                    <li key={field}>{t(`manage.people.export_included_fields.${field}`)}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                <h3 className="font-semibold text-theme-primary">{t('manage.people.export_excluded_title')}</h3>
                <p className="mt-1 text-sm text-theme-muted">{t('manage.people.export_excluded_description')}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-theme-muted">
                  {EXPORT_EXCLUDED_FIELDS.map((field) => (
                    <li key={field}>{t(`manage.people.export_excluded_fields.${field}`)}</li>
                  ))}
                </ul>
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" isDisabled={isExporting} onPress={() => setIsExportPreviewOpen(false)}>
              {t('manage.people.export_cancel')}
            </Button>
            <Button variant="primary" isLoading={isExporting} onPress={() => void exportCsv()}>
              <Download className="h-4 w-4" aria-hidden="true" />
              {t('manage.people.export_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal
        isOpen={historyTarget !== null}
        onClose={() => {
          historyGenerationRef.current += 1;
          historyTargetIdRef.current = null;
          setHistoryTarget(null);
        }}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            {t('manage.people.history_title', {
              name: historyTarget ? memberName(historyTarget.member) : '',
            })}
          </ModalHeader>
          <ModalBody>
            {historyState === 'loading' ? (
              <div className="flex min-h-40 items-center justify-center" role="status">
                <Spinner label={t('manage.people.history_loading')} />
              </div>
            ) : historyState === 'error' ? (
              <p className="rounded-xl bg-danger/5 p-4 text-danger" role="alert">
                {t('manage.people.history_error')}
              </p>
            ) : history.length === 0 ? (
              <p className="py-8 text-center text-theme-muted">{t('manage.people.history_empty')}</p>
            ) : (
              <div className="space-y-4">
                <ol className="space-y-3">
                  {history.map((entry) => (
                    <li key={`${entry.axis}-${entry.entry_id}`} className="rounded-xl border border-theme-default p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-semibold text-theme-primary">
                            {t(`manage.people.history_axes.${entry.axis}`)} · {t('manage.people.history_change', {
                              from: entry.from_state
                                ? t(`manage.people.states.${entry.axis}.${entry.from_state}`)
                                : t('manage.people.states.none'),
                              to: t(`manage.people.states.${entry.axis}.${entry.to_state}`),
                            })}
                          </p>
                          <p className="mt-1 text-sm text-theme-muted">
                            {entry.actor.display_name || t('manage.people.system_actor')} · {formatTimestamp(entry.created_at)}
                          </p>
                        </div>
                        <Chip size="sm" variant="flat">{t('manage.people.version', { version: entry.version })}</Chip>
                      </div>
                      {entry.reason && <p className="mt-3 text-sm text-theme-primary">{entry.reason}</p>}
                    </li>
                  ))}
                </ol>
                {historyLoadMoreError && (
                  <p className="rounded-xl bg-danger/5 p-4 text-danger" role="alert">
                    {t('manage.people.history_error')}
                  </p>
                )}
                {historyMeta?.has_more && (
                  <div className="flex justify-center">
                    <Button
                      variant="secondary"
                      isLoading={isHistoryLoadingMore}
                      onPress={() => void loadMoreHistory()}
                    >
                      {t('load_more_count', {
                        remaining: Math.max(0, historyMeta.total - history.length),
                      })}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => {
                historyGenerationRef.current += 1;
                historyTargetIdRef.current = null;
                setHistoryTarget(null);
              }}
            >
              {t('manage.people.close_history')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function PeopleFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation('events');

  return (
    <Select
      label={label}
      selectedKeys={new Set([value])}
      onSelectionChange={(keys) => {
        const next = String(Array.from(keys as Iterable<string | number>)[0] ?? 'all');
        onChange(next);
      }}
    >
      {options.map((option) => (
        <SelectItem key={option} id={option} textValue={t(`manage.people.filter_options.${option}`)}>
          {t(`manage.people.filter_options.${option}`)}
        </SelectItem>
      ))}
    </Select>
  );
}
