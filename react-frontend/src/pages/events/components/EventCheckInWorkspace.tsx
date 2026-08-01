// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Label } from '@heroui/react/label';
import { SearchField } from '@heroui/react/search-field';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import LogOut from 'lucide-react/icons/log-out';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Search from 'lucide-react/icons/search';
import UserX from 'lucide-react/icons/user-x';
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
  type EventAttendanceTransitionPayload,
  type EventPeopleMeta,
  type EventPeoplePerson,
  type EventPeopleQueryParams,
} from '@/lib/events-api';
import { resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const PAGE_SIZE = 25;

interface UndoTarget {
  person: EventPeoplePerson;
}
function createIdempotencyKey(action: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `event-attendance-${action}-${globalThis.crypto.randomUUID()}`;
  }

  return `event-attendance-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function EventCheckInWorkspace({ eventId }: { eventId: number }) {
  const { t } = useTranslation('events');
  const toast = useToast();
  const [people, setPeople] = useState<EventPeoplePerson[]>([]);
  const [meta, setMeta] = useState<EventPeopleMeta | null>(null);
  const [search, setSearch] = useState('');
  const [attendanceState, setAttendanceState] = useState('all');
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutatingUserId, setMutatingUserId] = useState<number | null>(null);
  const [undoTarget, setUndoTarget] = useState<UndoTarget | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const requestRef = useRef<AbortController | null>(null);

  const params = useMemo<EventPeopleQueryParams>(() => ({
    page,
    per_page: PAGE_SIZE,
    search: search.trim() || undefined,
    attendance_state: attendanceState === 'all' ? undefined : attendanceState,
    sort: attendanceState === 'all' ? 'name' : 'attendance_changed',
    direction: attendanceState === 'all' ? 'asc' : 'desc',
  }), [attendanceState, page, search]);

  const loadPeople = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await eventsApi.people(eventId, params, signal ? { signal } : undefined);
      if (signal?.aborted) return;
      if (!response.success || !response.data || !response.meta) {
        setLoadError(true);
        return;
      }
      setPeople(response.data);
      setMeta(response.meta);
    } catch (caught) {
      if (signal?.aborted) return;
      logError('Failed to load Event check-in roster', caught);
      setLoadError(true);
    } finally {
      if (!signal?.aborted) setIsLoading(false);
    }
  }, [eventId, params]);

  useEffect(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timer = window.setTimeout(() => void loadPeople(controller.signal), 200);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadPeople]);

  const transition = async (
    person: EventPeoplePerson,
    action: EventAttendanceTransitionPayload['action'],
    reason?: string,
  ) => {
    if (mutatingUserId !== null) return;
    setMutatingUserId(person.member.id);
    const idempotencyKey = createIdempotencyKey(action);
    try {
      const response = await eventsApi.transitionAttendance(eventId, person.member.id, {
        action,
        expected_version: person.attendance.version ?? 0,
        idempotency_key: idempotencyKey,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      if (!response.success || !response.data) {
        await loadPeople();
        if (response.code === 'EVENT_REGISTRATION_CONFLICT') {
          toast.warning(t('manage.check_in.version_conflict'));
        } else {
          toast.error(response.errors?.[0]?.message ?? t('manage.check_in.action_error'));
        }
        return;
      }
      // A re-check-in after an undo is financially a no-op (the reward was
      // already granted); tell staff instead of showing the identical
      // success toast and leaving them to wonder.
      const creditStatus = response.data.mutation.credit_status ?? null;
      if (action === 'check_in' && creditStatus === 'already_settled') {
        toast.info(t('manage.check_in.success.check_in_reward_already_granted'));
      } else {
        toast.success(t(`manage.check_in.success.${action}`));
      }
      setUndoTarget(null);
      setUndoReason('');
      await loadPeople();
    } catch (caught) {
      logError('Failed to transition Event attendance', caught);
      toast.error(t('manage.check_in.action_error'));
      await loadPeople();
    } finally {
      setMutatingUserId(null);
    }
  };

  const memberName = (person: EventPeoplePerson): string => person.member.display_name?.trim()
    || t('manage.people.member_fallback', { id: person.member.id });

  const metrics = meta?.metrics;

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label={t('manage.check_in.metrics_aria')}>
        {(['confirmed', 'checked_in', 'checked_out', 'no_show', 'attended'] as const).map((metric) => (
          <div key={metric} className="rounded-xl border border-theme-default bg-theme-surface p-4">
            <p className="text-sm text-theme-muted">{t(`manage.people.metrics.${metric}`)}</p>
            <p className="mt-1 text-2xl font-bold text-theme-primary">{metrics?.[metric] ?? 0}</p>
          </div>
        ))}
      </section>

      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-4 p-4 sm:p-6">
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">{t('manage.check_in.title')}</h2>
            <p className="mt-1 text-sm text-theme-muted">{t('manage.check_in.description')}</p>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_18rem]">
            <SearchField
              className="w-full"
              value={search}
              onChange={(value) => {
                setPage(1);
                setSearch(value);
              }}
            >
              <Label>{t('manage.check_in.search_label')}</Label>
              <SearchField.Group>
                <SearchField.SearchIcon><Search className="h-4 w-4" aria-hidden="true" /></SearchField.SearchIcon>
                <SearchField.Input placeholder={t('manage.check_in.search_placeholder')} />
                {search && <SearchField.ClearButton aria-label={t('manage.check_in.clear_search')} />}
              </SearchField.Group>
            </SearchField>
            <Select
              label={t('manage.people.attendance_filter')}
              selectedKeys={new Set([attendanceState])}
              onSelectionChange={(keys) => {
                setPage(1);
                setAttendanceState(String(Array.from(keys as Iterable<string | number>)[0] ?? 'all'));
              }}
            >
              {['all', 'not_checked_in', 'checked_in', 'checked_out', 'attended', 'no_show'].map((state) => (
                <SelectItem key={state} id={state} textValue={t(`manage.people.filter_options.${state}`)}>
                  {t(`manage.people.filter_options.${state}`)}
                </SelectItem>
              ))}
            </Select>
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {isLoading
              ? t('manage.check_in.loading')
              : t('manage.check_in.results_count', { count: meta?.total ?? 0 })}
          </p>

          {loadError ? (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-5" role="alert">
              <p className="font-semibold text-danger">{t('manage.check_in.load_error_title')}</p>
              <p className="mt-1 text-sm text-theme-muted">{t('manage.check_in.load_error_desc')}</p>
              <Button className="mt-3" size="sm" variant="outline" onPress={() => void loadPeople()}>
                {t('manage.try_again')}
              </Button>
            </div>
          ) : (
            <Table aria-label={t('manage.check_in.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn isRowHeader>{t('manage.people.columns.member')}</TableColumn>
                <TableColumn>{t('manage.people.columns.registration')}</TableColumn>
                <TableColumn>{t('manage.people.columns.attendance')}</TableColumn>
                <TableColumn>{t('manage.people.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody
                isLoading={isLoading}
                loadingContent={<Spinner label={t('manage.check_in.loading')} />}
                emptyContent={t('manage.check_in.empty')}
              >
                {people.map((person) => {
                  const name = memberName(person);
                  const busy = mutatingUserId === person.member.id;
                  return (
                    <TableRow key={person.member.id}>
                      <TableCell>
                        <div className="flex min-w-44 items-center gap-3">
                          <Avatar size="sm" name={name} src={resolveAvatarUrl(person.member.avatar_url)} />
                          <span className="font-medium text-theme-primary">{name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat">
                          {t(`manage.people.states.registration.${person.registration.state ?? 'none'}`)}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="flat">
                          {t(`manage.people.states.attendance.${person.attendance.state}`)}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-72 flex-wrap gap-2">
                          {person.management_actions.check_in && (
                            <Button size="sm" isLoading={busy} onPress={() => void transition(person, 'check_in')}>
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              {t('manage.check_in.actions.check_in')}
                            </Button>
                          )}
                          {person.management_actions.check_out && (
                            <Button size="sm" variant="outline" isLoading={busy} onPress={() => void transition(person, 'check_out')}>
                              <LogOut className="h-4 w-4" aria-hidden="true" />
                              {t('manage.check_in.actions.check_out')}
                            </Button>
                          )}
                          {person.management_actions.no_show && (
                            <Button size="sm" variant="danger" isLoading={busy} onPress={() => void transition(person, 'no_show')}>
                              <UserX className="h-4 w-4" aria-hidden="true" />
                              {t('manage.check_in.actions.no_show')}
                            </Button>
                          )}
                          {person.management_actions.undo_attendance && (
                            <Button size="sm" variant="ghost" isDisabled={busy} onPress={() => setUndoTarget({ person })}>
                              <RotateCcw className="h-4 w-4" aria-hidden="true" />
                              {t('manage.check_in.actions.undo')}
                            </Button>
                          )}
                          {!person.management_actions.check_in
                            && !person.management_actions.check_out
                            && !person.management_actions.no_show
                            && !person.management_actions.undo_attendance && (
                              <span className="text-sm text-theme-muted">{t('manage.check_in.no_actions')}</span>
                            )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {meta && meta.total_pages > 1 && (
            <div className="flex justify-end border-t border-theme-default pt-4">
              <Pagination
                page={meta.current_page}
                total={meta.total_pages}
                showControls
                aria-label={t('manage.check_in.pagination_aria')}
                onChange={setPage}
              />
            </div>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={undoTarget !== null} onClose={() => setUndoTarget(null)} size="md">
        <ModalContent>
          <ModalHeader>{t('manage.check_in.undo_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted">
              {t('manage.check_in.undo_description', {
                name: undoTarget ? memberName(undoTarget.person) : '',
              })}
            </p>
            <Textarea
              label={t('manage.check_in.undo_reason_label')}
              value={undoReason}
              onValueChange={setUndoReason}
              minRows={3}
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" isDisabled={mutatingUserId !== null} onPress={() => setUndoTarget(null)}>
              {t('manage.check_in.keep_record')}
            </Button>
            <Button
              isLoading={mutatingUserId !== null}
              isDisabled={!undoTarget || !undoReason.trim()}
              onPress={() => undoTarget && void transition(undoTarget.person, 'undo', undoReason)}
            >
              {t('manage.check_in.confirm_undo')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
