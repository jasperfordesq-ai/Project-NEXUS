// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import ArrowDown from 'lucide-react/icons/arrow-down';
import ArrowUp from 'lucide-react/icons/arrow-up';
import CalendarDays from 'lucide-react/icons/calendar-days';
import Clock from 'lucide-react/icons/clock';
import ExternalLink from 'lucide-react/icons/external-link';
import MapPin from 'lucide-react/icons/map-pin';
import Mic2 from 'lucide-react/icons/mic-2';
import Pencil from 'lucide-react/icons/pencil';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Users from 'lucide-react/icons/users';
import XCircle from 'lucide-react/icons/x-circle';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventIsoToLocalInput as isoToLocalInput,
  eventLocalInputToIso as localInputToIso,
} from '@/lib/eventLocalDateTime';
import {
  eventsApi,
  type Event,
  type EventAgenda,
  type EventAgendaSession,
  type EventAgendaSessionPayload,
  type EventAgendaSpeakerInput,
  type EventAgendaResourceInput,
} from '@/lib/events-api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const SESSION_TYPES = [
  'session',
  'keynote',
  'workshop',
  'panel',
  'break',
  'networking',
  'other',
] as const satisfies readonly EventAgendaSession['type'][];

const VISIBILITIES = [
  'public',
  'registered',
  'staff',
] as const satisfies readonly EventAgendaSession['visibility'][];

const RESOURCE_TYPES = [
  'link',
  'document',
  'slides',
  'download',
  'stream',
  'recording',
] as const satisfies readonly EventAgendaResourceInput['type'][];

interface SpeakerDraft {
  memberId: number | null;
  displayName: string;
  role: string;
}

interface ResourceDraft {
  type: EventAgendaResourceInput['type'];
  title: string;
  url: string;
  visibility: EventAgendaResourceInput['visibility'];
}

interface SessionDraft {
  title: string;
  description: string;
  type: EventAgendaSession['type'];
  visibility: EventAgendaSession['visibility'];
  startAt: string;
  endAt: string;
  track: string;
  room: string;
  capacity: string;
  speakers: SpeakerDraft[];
  resources: ResourceDraft[];
}

interface EventAgendaWorkspaceProps {
  event: Event;
}

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return `event-agenda-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function defaultDraft(event: Event): SessionDraft {
  const timeZone = event.schedule.timezone;
  const start = isoToLocalInput(event.schedule.start_at, timeZone);
  const eventEnd = isoToLocalInput(event.schedule.end_at, timeZone);
  let end = eventEnd;
  if (start) {
    const startIso = localInputToIso(start, timeZone);
    if (startIso) {
      const oneHourLater = isoToLocalInput(
        new Date(new Date(startIso).getTime() + 60 * 60 * 1000).toISOString(),
        timeZone,
      );
      const eventEndIso = localInputToIso(end, timeZone);
      const oneHourLaterIso = localInputToIso(oneHourLater, timeZone);
      if (!eventEndIso || (oneHourLaterIso && Date.parse(eventEndIso) > Date.parse(oneHourLaterIso))) {
        end = oneHourLater;
      }
    }
  }

  return {
    title: '',
    description: '',
    type: 'session',
    visibility: 'public',
    startAt: start,
    endAt: end,
    track: '',
    room: '',
    capacity: '',
    speakers: [],
    resources: [],
  };
}

function draftFromSession(session: EventAgendaSession): SessionDraft {
  return {
    title: session.title,
    description: session.description ?? '',
    type: session.type,
    visibility: session.visibility,
    startAt: isoToLocalInput(session.start_at, session.timezone),
    endAt: isoToLocalInput(session.end_at, session.timezone),
    track: session.track ?? '',
    room: session.room ?? '',
    capacity: session.capacity.limit === null ? '' : String(session.capacity.limit),
    speakers: session.speakers.map((speaker) => ({
      memberId: speaker.member_id,
      displayName: speaker.display_name ?? '',
      role: speaker.role ?? '',
    })),
    resources: session.resources
      .filter((resource) => resource.url !== null)
      .map((resource) => ({
        type: resource.type,
        title: resource.title,
        url: resource.url ?? '',
        visibility: resource.visibility,
      })),
  };
}

export function EventAgendaWorkspace({ event }: EventAgendaWorkspaceProps) {
  const { t } = useTranslation(['events', 'event_agenda']);
  const toast = useToast();
  const confirm = useConfirm();
  const [agenda, setAgenda] = useState<EventAgenda | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<EventAgendaSession | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [draft, setDraft] = useState<SessionDraft>(() => defaultDraft(event));
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<EventAgendaSession | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [isCancelling, setIsCancelling] = useState(false);
  const [reorderingId, setReorderingId] = useState<number | null>(null);
  const [registrationPendingId, setRegistrationPendingId] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadAgenda = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setIsLoading(true);
    setLoadError(false);
    try {
      const response = await eventsApi.agenda(
        event.id,
        event.permissions.manage_agenda,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!response.success || !response.data) {
        setLoadError(true);
        setAgenda(null);
        return;
      }
      setAgenda(response.data);
    } catch (caught) {
      if (controller.signal.aborted) return;
      logError('Failed to load event agenda', caught);
      setLoadError(true);
      setAgenda(null);
    } finally {
      if (!controller.signal.aborted) setIsLoading(false);
    }
  }, [event.id, event.permissions.manage_agenda]);

  useEffect(() => {
    void loadAgenda();

    return () => abortRef.current?.abort();
  }, [loadAgenda]);

  const scheduled = useMemo(
    () => agenda?.sessions.filter((session) => session.status === 'scheduled') ?? [],
    [agenda],
  );
  const cancelled = useMemo(
    () => agenda?.sessions.filter((session) => session.status === 'cancelled') ?? [],
    [agenda],
  );
  const canManage = Boolean(agenda?.permissions.manage && event.permissions.manage_agenda);

  const formatDateTime = (value: string, timeZone: string): string => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat(getFormattingLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone,
    }).format(date);
  };

  const openCreate = () => {
    setEditing(null);
    setDraft(defaultDraft(event));
    setFormError(null);
    setIsEditorOpen(true);
  };

  const openEdit = (session: EventAgendaSession) => {
    setEditing(session);
    setDraft(draftFromSession(session));
    setFormError(null);
    setIsEditorOpen(true);
  };

  const payloadFromDraft = (): EventAgendaSessionPayload | null => {
    const title = draft.title.trim();
    const startAt = localInputToIso(draft.startAt, event.schedule.timezone);
    const endAt = localInputToIso(draft.endAt, event.schedule.timezone);
    if (!title || !startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) return null;

    const speakers: EventAgendaSpeakerInput[] = [];
    for (const speaker of draft.speakers) {
      const displayName = speaker.displayName.trim();
      const role = speaker.role.trim();
      if (speaker.memberId !== null) {
        speakers.push({ user_id: speaker.memberId, role_label: role || null });
      } else if (displayName) {
        speakers.push({ display_name: displayName, role_label: role || null });
      }
    }
    const capacityText = draft.capacity.trim();
    const capacity = capacityText === '' ? null : Number(capacityText);
    if (capacity !== null
      && (!Number.isInteger(capacity) || capacity < 1 || capacity > 100000)) return null;
    const resources: EventAgendaResourceInput[] = [];
    for (const resource of draft.resources) {
      const title = resource.title.trim();
      const url = resource.url.trim();
      if (!title || !url) return null;
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !parsed.hostname) return null;
      } catch {
        return null;
      }
      if ((resource.type === 'stream' || resource.type === 'recording')
        && resource.visibility === 'public') return null;
      resources.push({
        type: resource.type,
        title,
        url,
        visibility: resource.visibility,
      });
    }

    return {
      title,
      description: draft.description.trim() || null,
      session_type: draft.type,
      visibility: draft.visibility,
      start_at: startAt,
      end_at: endAt,
      timezone: event.schedule.timezone,
      track_name: draft.track.trim() || null,
      room_name: draft.room.trim() || null,
      capacity,
      speakers,
      resources,
    };
  };

  const saveSession = async () => {
    if (isSaving) return;
    const payload = payloadFromDraft();
    if (!payload) {
      setFormError(t('manage.agenda.validation_error'));
      return;
    }

    setIsSaving(true);
    setFormError(null);
    try {
      const response = editing
        ? await eventsApi.updateAgendaSession(
            event.id,
            editing.id,
            editing.version,
            payload,
            idempotencyKey(),
          )
        : await eventsApi.createAgendaSession(event.id, payload, idempotencyKey());
      if (!response.success || !response.data) {
        setFormError(t('manage.agenda.save_error'));
        await loadAgenda();
        return;
      }
      toast.success(t(editing ? 'manage.agenda.update_success' : 'manage.agenda.create_success'));
      setIsEditorOpen(false);
      await loadAgenda();
    } catch (caught) {
      logError('Failed to save event agenda session', caught);
      setFormError(t('manage.agenda.save_error'));
    } finally {
      setIsSaving(false);
    }
  };

  const cancelSession = async () => {
    if (!cancelTarget || isCancelling || !cancelReason.trim()) return;
    setIsCancelling(true);
    try {
      const response = await eventsApi.cancelAgendaSession(
        event.id,
        cancelTarget.id,
        cancelTarget.version,
        cancelReason.trim(),
        idempotencyKey(),
      );
      if (!response.success || !response.data) {
        toast.error(t('manage.agenda.cancel_error'));
        await loadAgenda();
        return;
      }
      toast.success(t('manage.agenda.cancel_success'));
      setCancelTarget(null);
      setCancelReason('');
      await loadAgenda();
    } catch (caught) {
      logError('Failed to cancel event agenda session', caught);
      toast.error(t('manage.agenda.cancel_error'));
    } finally {
      setIsCancelling(false);
    }
  };

  const moveSession = async (sessionId: number, direction: -1 | 1) => {
    if (!agenda || reorderingId !== null) return;
    const ids = scheduled.map((session) => session.id);
    const index = ids.indexOf(sessionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    const currentId = ids[index];
    const targetId = ids[target];
    if (currentId === undefined || targetId === undefined) return;
    ids[index] = targetId;
    ids[target] = currentId;
    setReorderingId(sessionId);
    try {
      const response = await eventsApi.reorderAgendaSessions(
        event.id,
        ids,
        agenda.agenda_version,
        idempotencyKey(),
      );
      if (!response.success || !response.data) {
        toast.error(t('manage.agenda.reorder_error'));
      }
      await loadAgenda();
    } catch (caught) {
      logError('Failed to reorder event agenda', caught);
      toast.error(t('manage.agenda.reorder_error'));
    } finally {
      setReorderingId(null);
    }
  };

  const mutateRegistration = async (
    session: EventAgendaSession,
    action: 'register' | 'withdraw',
  ) => {
    if (registrationPendingId !== null) return;
    if (action === 'withdraw') {
      const accepted = await confirm({
        title: t('event_agenda:withdraw_confirm_title'),
        body: t('event_agenda:withdraw_confirm_body', { title: session.title }),
        confirmLabel: t('event_agenda:withdraw_action'),
        cancelLabel: t('event_agenda:keep_registration'),
        status: 'danger',
      });
      if (!accepted) return;
    }
    setRegistrationPendingId(session.id);
    try {
      const response = action === 'register'
        ? await eventsApi.registerAgendaSession(
            event.id,
            session.id,
            session.registration.version,
            idempotencyKey(),
          )
        : await eventsApi.withdrawAgendaSession(
            event.id,
            session.id,
            session.registration.version,
            idempotencyKey(),
          );
      if (!response.success || !response.data) {
        toast.error(t(`event_agenda:${action}_error`));
        await loadAgenda();
        return;
      }
      const updatedSession = response.data.session;
      if (updatedSession === null) {
        await loadAgenda();
        toast.success(t(`event_agenda:${action}_success`));
        return;
      }
      setAgenda((current) => current === null ? current : ({
        ...current,
        sessions: current.sessions.map((candidate) => (
          candidate.id === updatedSession.id ? updatedSession : candidate
        )),
      }));
      toast.success(t(`event_agenda:${action}_success`));
    } catch (caught) {
      logError(`Failed to ${action} event agenda session`, caught);
      toast.error(t(`event_agenda:${action}_error`));
      await loadAgenda();
    } finally {
      setRegistrationPendingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-56 items-center justify-center rounded-xl border border-theme-default bg-theme-surface" aria-busy="true">
        <Spinner size="lg" aria-label={t('manage.agenda.loading')} />
      </div>
    );
  }

  if (loadError || !agenda) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/5 p-5" role="alert">
        <h2 className="font-semibold text-danger">{t('manage.agenda.load_error_title')}</h2>
        <p className="mt-1 text-sm text-theme-muted">{t('manage.agenda.load_error_desc')}</p>
        <Button className="mt-4" variant="outline" onPress={() => void loadAgenda()}>
          {t('manage.try_again')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-theme-primary">{t('manage.agenda.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-theme-muted">
            {t(canManage ? 'manage.agenda.description' : 'manage.agenda.viewer_description')}
          </p>
        </div>
        {canManage && (
          <Button variant="primary" onPress={openCreate} startContent={<Plus className="h-4 w-4" aria-hidden="true" />}>
            {t('manage.agenda.add_session')}
          </Button>
        )}
      </div>

      {agenda?.event_status?.is_cancelled && (
        <div
          role="status"
          className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700 dark:border-danger-800 dark:bg-danger-950/40 dark:text-danger-200"
        >
          {/* Sessions keep their own 'scheduled' status when the event is
              cancelled — the agenda is deliberately preserved as a record —
              so without this the whole programme reads as though it is
              still going ahead. */}
          {t('manage.agenda.event_cancelled_notice')}
        </div>
      )}

      {scheduled.length === 0 ? (
        <div className="rounded-xl border border-dashed border-theme-default bg-theme-surface px-5 py-12 text-center">
          <CalendarDays className="mx-auto h-10 w-10 text-theme-subtle" aria-hidden="true" />
          <h3 className="mt-4 font-semibold text-theme-primary">{t('manage.agenda.empty_title')}</h3>
          <p className="mx-auto mt-2 max-w-xl text-sm text-theme-muted">
            {t(canManage ? 'manage.agenda.empty_desc' : 'manage.agenda.viewer_empty_desc')}
          </p>
        </div>
      ) : (
        <ol className="space-y-3" aria-label={t('manage.agenda.sessions_aria')}>
          {scheduled.map((session, index) => (
            <li key={session.id}>
              <SessionCard
                session={session}
                dateTime={formatDateTime(session.start_at, agenda.timezone)}
                canManage={canManage}
                canMoveUp={index > 0}
                canMoveDown={index < scheduled.length - 1}
                isReordering={reorderingId !== null}
                isRegistrationPending={registrationPendingId === session.id}
                onEdit={() => openEdit(session)}
                onCancel={() => {
                  setCancelTarget(session);
                  setCancelReason('');
                }}
                onMoveUp={() => void moveSession(session.id, -1)}
                onMoveDown={() => void moveSession(session.id, 1)}
                onRegister={() => void mutateRegistration(session, 'register')}
                onWithdraw={() => void mutateRegistration(session, 'withdraw')}
              />
            </li>
          ))}
        </ol>
      )}

      {canManage && cancelled.length > 0 && (
        <section className="space-y-3" aria-labelledby="cancelled-agenda-heading">
          <h3 id="cancelled-agenda-heading" className="text-lg font-semibold text-theme-primary">
            {t('manage.agenda.cancelled_title')}
          </h3>
          {cancelled.map((session) => (
            <SessionCard
              key={session.id}
              session={session}
              dateTime={formatDateTime(session.start_at, agenda.timezone)}
              canManage={false}
              canMoveUp={false}
              canMoveDown={false}
              isReordering={false}
              isRegistrationPending={false}
              onEdit={() => undefined}
              onCancel={() => undefined}
              onMoveUp={() => undefined}
              onMoveDown={() => undefined}
              onRegister={() => undefined}
              onWithdraw={() => undefined}
            />
          ))}
        </section>
      )}

      <SessionEditor
        isOpen={isEditorOpen}
        editing={editing}
        draft={draft}
        setDraft={setDraft}
        event={event}
        formError={formError}
        isSaving={isSaving}
        onClose={() => {
          if (!isSaving) setIsEditorOpen(false);
        }}
        onSave={() => void saveSession()}
      />

      <Modal
        isOpen={cancelTarget !== null}
        onClose={() => {
          if (!isCancelling) setCancelTarget(null);
        }}
        size="md"
      >
        <ModalContent>
          <ModalHeader>{t('manage.agenda.cancel_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted">
              {t('manage.agenda.cancel_desc', { title: cancelTarget?.title ?? '' })}
            </p>
            <Textarea
              label={t('manage.agenda.cancel_reason')}
              value={cancelReason}
              onChange={(changeEvent) => setCancelReason(changeEvent.target.value)}
              maxLength={500}
              isRequired
              isDisabled={isCancelling}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="outline" isDisabled={isCancelling} onPress={() => setCancelTarget(null)}>
              {t('manage.agenda.keep_session')}
            </Button>
            <Button
              variant="danger"
              isDisabled={!cancelReason.trim() || isCancelling}
              isLoading={isCancelling}
              onPress={() => void cancelSession()}
            >
              {t('manage.agenda.confirm_cancel')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

interface SessionCardProps {
  session: EventAgendaSession;
  dateTime: string;
  canManage: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  isReordering: boolean;
  isRegistrationPending: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRegister: () => void;
  onWithdraw: () => void;
}

function SessionCard({
  session,
  dateTime,
  canManage,
  canMoveUp,
  canMoveDown,
  isReordering,
  isRegistrationPending,
  onEdit,
  onCancel,
  onMoveUp,
  onMoveDown,
  onRegister,
  onWithdraw,
}: SessionCardProps) {
  const { t } = useTranslation(['events', 'event_agenda']);

  return (
    <Card className={`border bg-theme-surface ${session.status === 'cancelled' ? 'border-danger/25 opacity-75' : 'border-theme-default'}`}>
      <CardBody className="space-y-3 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-theme-primary">{session.title}</h3>
              <Chip size="sm" variant="flat">{t(`manage.agenda.types.${session.type}`)}</Chip>
              <Chip size="sm" variant="flat">{t(`manage.agenda.visibilities.${session.visibility}`)}</Chip>
              {session.status === 'cancelled' && <Chip size="sm" color="danger" variant="flat">{t('manage.agenda.cancelled')}</Chip>}
            </div>
            {session.description && <p className="mt-2 whitespace-pre-line text-sm text-theme-muted">{session.description}</p>}
          </div>
          {canManage && (
            <div className="flex shrink-0 flex-wrap gap-1">
              <Button isIconOnly variant="ghost" aria-label={t('manage.agenda.move_up', { title: session.title })} isDisabled={!canMoveUp || isReordering} onPress={onMoveUp}>
                <ArrowUp className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button isIconOnly variant="ghost" aria-label={t('manage.agenda.move_down', { title: session.title })} isDisabled={!canMoveDown || isReordering} onPress={onMoveDown}>
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button isIconOnly variant="ghost" aria-label={t('manage.agenda.edit_session', { title: session.title })} onPress={onEdit}>
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </Button>
              <Button isIconOnly variant="ghost" aria-label={t('manage.agenda.cancel_session', { title: session.title })} onPress={onCancel}>
                <XCircle className="h-4 w-4 text-danger" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        <dl className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-theme-muted">
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" aria-hidden="true" />
            <dt className="sr-only">{t('manage.agenda.start')}</dt>
            <dd>{dateTime}</dd>
          </div>
          {session.room && (
            <div className="flex items-center gap-1.5">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              <dt className="sr-only">{t('manage.agenda.room')}</dt>
              <dd>{session.room}</dd>
            </div>
          )}
          {session.track && (
            <div>
              <dt className="sr-only">{t('manage.agenda.track')}</dt>
              <dd>{session.track}</dd>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4" aria-hidden="true" />
            <dt className="sr-only">{t('event_agenda:capacity_label')}</dt>
            <dd>
              {session.capacity.limit === null
                ? t('event_agenda:capacity_unlimited', { registered: session.capacity.registered })
                : t('event_agenda:capacity_limited', {
                    registered: session.capacity.registered,
                    limit: session.capacity.limit,
                  })}
            </dd>
          </div>
        </dl>
        {session.speakers.length > 0 && (
          <div className="flex items-start gap-2 text-sm text-theme-muted">
            <Mic2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{session.speakers.map((speaker) => speaker.role
              ? t('manage.agenda.speaker_with_role', { name: speaker.display_name, role: speaker.role })
              : speaker.display_name).join(', ')}</span>
          </div>
        )}
        {session.resources.length > 0 && (
          <section className="space-y-2" aria-label={t('event_agenda:resources_title')}>
            <h4 className="text-sm font-semibold text-theme-primary">{t('event_agenda:resources_title')}</h4>
            <ul className="space-y-2">
              {session.resources.map((resource) => (
                <li key={resource.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Chip size="sm" variant="flat">
                    {t(`event_agenda:resource_types.${resource.type}`)}
                  </Chip>
                  {resource.url && resource.available ? (
                    <a
                      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {resource.title}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      <span className="sr-only">{t('event_agenda:opens_new_window')}</span>
                    </a>
                  ) : (
                    <span className="text-theme-muted">
                      {resource.title} — {t('event_agenda:resource_unavailable')}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {(session.registration.can_register || session.registration.can_withdraw) && (
          <div className="flex flex-wrap items-center gap-3 border-t border-theme-default pt-3">
            {session.registration.can_register && (
              <Button
                size="sm"
                variant="primary"
                isLoading={isRegistrationPending}
                isDisabled={isRegistrationPending}
                onPress={onRegister}
              >
                {t('event_agenda:register_action')}
              </Button>
            )}
            {session.registration.can_withdraw && (
              <Button
                size="sm"
                variant="outline"
                isLoading={isRegistrationPending}
                isDisabled={isRegistrationPending}
                onPress={onWithdraw}
              >
                {t('event_agenda:withdraw_action')}
              </Button>
            )}
            {session.registration.state === 'registered' && (
              <span className="text-sm font-medium text-success">{t('event_agenda:registered_state')}</span>
            )}
            {session.registration.state === 'ineligible' && (
              <span className="text-sm text-theme-muted">{t('event_agenda:ineligible_state')}</span>
            )}
          </div>
        )}
        {!session.registration.can_register
          && !session.registration.can_withdraw
          && session.capacity.is_full
          && session.registration.state !== 'registered' && (
          <p className="text-sm text-theme-muted">{t('event_agenda:full_state')}</p>
        )}
        {session.cancellation_reason && (
          <p className="rounded-lg bg-danger/5 p-3 text-sm text-danger">
            {t('manage.agenda.cancelled_reason', { reason: session.cancellation_reason })}
          </p>
        )}
      </CardBody>
    </Card>
  );
}

interface SessionEditorProps {
  isOpen: boolean;
  editing: EventAgendaSession | null;
  draft: SessionDraft;
  setDraft: Dispatch<SetStateAction<SessionDraft>>;
  event: Event;
  formError: string | null;
  isSaving: boolean;
  onClose: () => void;
  onSave: () => void;
}

function SessionEditor({
  isOpen,
  editing,
  draft,
  setDraft,
  event,
  formError,
  isSaving,
  onClose,
  onSave,
}: SessionEditorProps) {
  const { t } = useTranslation(['events', 'event_agenda']);

  const updateSpeaker = (index: number, field: 'displayName' | 'role', value: string) => {
    setDraft((current) => ({
      ...current,
      speakers: current.speakers.map((speaker, speakerIndex) => (
        speakerIndex === index ? { ...speaker, [field]: value } : speaker
      )),
    }));
  };

  const updateResource = <Field extends keyof ResourceDraft>(
    index: number,
    field: Field,
    value: ResourceDraft[Field],
  ) => {
    setDraft((current) => ({
      ...current,
      resources: current.resources.map((resource, resourceIndex) => (
        resourceIndex === index ? { ...resource, [field]: value } : resource
      )),
    }));
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader>{t(editing ? 'manage.agenda.edit_title' : 'manage.agenda.create_title')}</ModalHeader>
        <ModalBody className="space-y-4">
          {formError && <p className="rounded-lg border border-danger/30 bg-danger/5 p-3 text-sm text-danger" role="alert">{formError}</p>}
          <Input
            label={t('manage.agenda.title_label')}
            value={draft.title}
            onChange={(changeEvent) => setDraft((current) => ({ ...current, title: changeEvent.target.value }))}
            maxLength={255}
            isRequired
            isDisabled={isSaving}
          />
          <Textarea
            label={t('manage.agenda.description_label')}
            value={draft.description}
            onChange={(changeEvent) => setDraft((current) => ({ ...current, description: changeEvent.target.value }))}
            maxLength={4000}
            isDisabled={isSaving}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label={t('manage.agenda.type_label')}
              selectedKeys={new Set([draft.type])}
              isDisabled={isSaving}
              onSelectionChange={(keys) => {
                const value = String(Array.from(keys as Iterable<string | number>)[0] ?? '');
                if (SESSION_TYPES.includes(value as EventAgendaSession['type'])) {
                  setDraft((current) => ({ ...current, type: value as EventAgendaSession['type'] }));
                }
              }}
            >
              {SESSION_TYPES.map((type) => <SelectItem key={type} id={type}>{t(`manage.agenda.types.${type}`)}</SelectItem>)}
            </Select>
            <Select
              label={t('manage.agenda.visibility_label')}
              description={t('manage.agenda.visibility_hint')}
              selectedKeys={new Set([draft.visibility])}
              isDisabled={isSaving}
              onSelectionChange={(keys) => {
                const value = String(Array.from(keys as Iterable<string | number>)[0] ?? '');
                if (VISIBILITIES.includes(value as EventAgendaSession['visibility'])) {
                  setDraft((current) => ({ ...current, visibility: value as EventAgendaSession['visibility'] }));
                }
              }}
            >
              {VISIBILITIES.map((visibility) => <SelectItem key={visibility} id={visibility}>{t(`manage.agenda.visibilities.${visibility}`)}</SelectItem>)}
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              type="datetime-local"
              label={t('manage.agenda.start_label')}
              value={draft.startAt}
              onChange={(changeEvent) => setDraft((current) => ({ ...current, startAt: changeEvent.target.value }))}
              isRequired
              isDisabled={isSaving}
            />
            <Input
              type="datetime-local"
              label={t('manage.agenda.end_label')}
              value={draft.endAt}
              onChange={(changeEvent) => setDraft((current) => ({ ...current, endAt: changeEvent.target.value }))}
              isRequired
              isDisabled={isSaving}
            />
          </div>
          <p className="text-xs text-theme-subtle">{t('manage.agenda.timezone_hint', { timezone: event.schedule.timezone })}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('manage.agenda.track_label')} value={draft.track} maxLength={160} isDisabled={isSaving} onChange={(changeEvent) => setDraft((current) => ({ ...current, track: changeEvent.target.value }))} />
            <Input label={t('manage.agenda.room_label')} value={draft.room} maxLength={160} isDisabled={isSaving} onChange={(changeEvent) => setDraft((current) => ({ ...current, room: changeEvent.target.value }))} />
          </div>
          <Input
            type="number"
            min={1}
            max={100000}
            label={t('event_agenda:capacity_label')}
            description={t('event_agenda:capacity_hint')}
            value={draft.capacity}
            isDisabled={isSaving}
            onChange={(changeEvent) => setDraft((current) => ({
              ...current,
              capacity: changeEvent.target.value,
            }))}
          />

          <fieldset className="space-y-3 rounded-xl border border-theme-default p-4">
            <legend className="px-1 font-semibold text-theme-primary">{t('manage.agenda.speakers_title')}</legend>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-theme-muted">{t('manage.agenda.speakers_hint')}</p>
              <Button
                size="sm"
                variant="outline"
                isDisabled={isSaving || draft.speakers.length >= 50}
                onPress={() => setDraft((current) => ({
                  ...current,
                  speakers: [...current.speakers, { memberId: null, displayName: '', role: '' }],
                }))}
                startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t('manage.agenda.add_speaker')}
              </Button>
            </div>
            {draft.speakers.length === 0 && <p className="text-sm text-theme-subtle">{t('manage.agenda.no_speakers')}</p>}
            {draft.speakers.map((speaker, index) => (
              <div key={`${speaker.memberId ?? 'external'}-${index}`} className="grid gap-2 rounded-lg bg-theme-elevated p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto]">
                <Input
                  label={t('manage.agenda.speaker_name')}
                  value={speaker.displayName}
                  isReadOnly={speaker.memberId !== null}
                  isDisabled={isSaving}
                  maxLength={160}
                  onChange={(changeEvent) => updateSpeaker(index, 'displayName', changeEvent.target.value)}
                />
                <Input
                  label={t('manage.agenda.speaker_role')}
                  value={speaker.role}
                  isDisabled={isSaving}
                  maxLength={120}
                  onChange={(changeEvent) => updateSpeaker(index, 'role', changeEvent.target.value)}
                />
                <Button
                  isIconOnly
                  variant="ghost"
                  className="self-end"
                  aria-label={t('manage.agenda.remove_speaker', { name: speaker.displayName || index + 1 })}
                  isDisabled={isSaving}
                  onPress={() => setDraft((current) => ({
                    ...current,
                    speakers: current.speakers.filter((_, speakerIndex) => speakerIndex !== index),
                  }))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </fieldset>

          <fieldset className="space-y-3 rounded-xl border border-theme-default p-4">
            <legend className="px-1 font-semibold text-theme-primary">{t('event_agenda:resources_title')}</legend>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-theme-muted">{t('event_agenda:resources_hint')}</p>
              <Button
                size="sm"
                variant="outline"
                isDisabled={isSaving || draft.resources.length >= 50}
                onPress={() => setDraft((current) => ({
                  ...current,
                  resources: [...current.resources, {
                    type: 'link',
                    title: '',
                    url: '',
                    visibility: 'public',
                  }],
                }))}
                startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t('event_agenda:add_resource')}
              </Button>
            </div>
            {draft.resources.length === 0 && (
              <p className="text-sm text-theme-subtle">{t('event_agenda:no_resources')}</p>
            )}
            {draft.resources.map((resource, index) => (
              <div key={`${resource.type}-${index}`} className="space-y-3 rounded-lg bg-theme-elevated p-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select
                    label={t('event_agenda:resource_type')}
                    selectedKeys={new Set([resource.type])}
                    isDisabled={isSaving}
                    onSelectionChange={(keys) => {
                      const value = String(Array.from(keys as Iterable<string | number>)[0] ?? '');
                      if (!RESOURCE_TYPES.includes(value as EventAgendaResourceInput['type'])) return;
                      const type = value as EventAgendaResourceInput['type'];
                      updateResource(index, 'type', type);
                      if ((type === 'stream' || type === 'recording') && resource.visibility === 'public') {
                        updateResource(index, 'visibility', 'registered');
                      }
                    }}
                  >
                    {RESOURCE_TYPES.map((type) => (
                      <SelectItem key={type} id={type}>{t(`event_agenda:resource_types.${type}`)}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    label={t('event_agenda:resource_visibility')}
                    selectedKeys={new Set([resource.visibility])}
                    isDisabled={isSaving}
                    onSelectionChange={(keys) => {
                      const value = String(Array.from(keys as Iterable<string | number>)[0] ?? '');
                      if (!VISIBILITIES.includes(value as EventAgendaResourceInput['visibility'])) return;
                      if ((resource.type === 'stream' || resource.type === 'recording') && value === 'public') return;
                      updateResource(index, 'visibility', value as EventAgendaResourceInput['visibility']);
                    }}
                  >
                    {VISIBILITIES.map((visibility) => (
                      <SelectItem key={visibility} id={visibility}>{t(`manage.agenda.visibilities.${visibility}`)}</SelectItem>
                    ))}
                  </Select>
                </div>
                <Input
                  label={t('event_agenda:resource_title')}
                  value={resource.title}
                  maxLength={191}
                  isRequired
                  isDisabled={isSaving}
                  onChange={(changeEvent) => updateResource(index, 'title', changeEvent.target.value)}
                />
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    type="url"
                    label={t('event_agenda:resource_url')}
                    description={t('event_agenda:resource_url_hint')}
                    value={resource.url}
                    maxLength={2048}
                    isRequired
                    isDisabled={isSaving}
                    onChange={(changeEvent) => updateResource(index, 'url', changeEvent.target.value)}
                  />
                  <Button
                    isIconOnly
                    variant="ghost"
                    className="self-end"
                    aria-label={t('event_agenda:remove_resource', { title: resource.title || index + 1 })}
                    isDisabled={isSaving}
                    onPress={() => setDraft((current) => ({
                      ...current,
                      resources: current.resources.filter((_, resourceIndex) => resourceIndex !== index),
                    }))}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            ))}
          </fieldset>
        </ModalBody>
        <ModalFooter>
          <Button variant="outline" isDisabled={isSaving} onPress={onClose}>{t('manage.agenda.close_editor')}</Button>
          <Button variant="primary" isLoading={isSaving} isDisabled={isSaving} onPress={onSave}>
            {t(editing ? 'manage.agenda.save_changes' : 'manage.agenda.create_session')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
