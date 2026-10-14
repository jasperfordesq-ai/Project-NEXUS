// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Messages to attendees" — the organiser's event messaging screen (E-106).
 *
 * Rebuilt because the old one was hard to use and unreliable: sending took
 * four steps across two modals, nothing refreshed afterwards, a retry after a
 * timeout created a duplicate, and every outcome was a toast. Now: one
 * composer with a live count and ONE Send button, a list that keeps itself
 * current, inline explanations, and idempotency keys that replay instead of
 * duplicating. The pieces live in ./communications/.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import MailPlus from 'lucide-react/icons/mail-plus';
import Send from 'lucide-react/icons/send';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Pagination } from '@/components/ui/Pagination';
import { Spinner } from '@/components/ui/Spinner';
import type { ApiResponse } from '@/lib/api';
import {
  eventCommunicationsApi,
  type EventBroadcast,
  type EventBroadcastContentInput,
} from '@/lib/event-communications-api';
import { eventIsoToLocalInput } from '@/lib/eventLocalDateTime';
import { logError } from '@/lib/logger';
import { BroadcastActivityModal } from './communications/BroadcastActivityModal';
import { BroadcastCard, type CardAction, type CardError } from './communications/BroadcastCard';
import {
  BroadcastComposer,
  type SubmitHooks,
  type SubmitRequest,
  type SubmitResult,
} from './communications/BroadcastComposer';
import { describeFailure, isConflict } from './communications/broadcastErrors';
import { formatWhen, timeZoneCity } from './communications/broadcastPresentation';
import {
  clearComposer,
  contentSignature,
  initialComposerValues,
  keyFor,
  loadComposer,
  saveComposer,
  scheduleSignature,
  valuesToContent,
  versionSignature,
  type ComposerMode,
  type ComposerValues,
  type KeyLedger,
  type PersistedComposer,
} from './communications/composerSession';
import { useBroadcastList } from './communications/useBroadcastList';

interface EventCommunicationsWorkspaceProps {
  eventId: number;
  eventTitle?: string;
  /** "Send at a set time" is a wall clock in the event's zone, not the browser's (B7). */
  eventTimezone: string;
  /** When the event finishes; thank-you and review messages can only go out after it. */
  eventEndsAt?: string | null;
}

interface ComposerState {
  /** Remounts the composer for each new session. */
  session: number;
  mode: ComposerMode;
  source: EventBroadcast | null;
  initial: ComposerValues;
  baseline: ComposerValues;
}

/** What this composer session has already done, so a retry never repeats a finished step. */
interface ComposerProgress {
  /** The draft this session owns: the one it created, or the one being edited. */
  draft: EventBroadcast | null;
  /** The content signature that draft currently holds. */
  draftSignature: string | null;
  /** In "change" mode: the scheduled original has been cancelled. */
  replaced: boolean;
}

const PERSIST_DEBOUNCE_MS = 300;

function contentOf(broadcast: EventBroadcast): EventBroadcastContentInput {
  return {
    variant: broadcast.variant,
    segments: broadcast.audience.segments,
    channels: broadcast.channels,
    body: broadcast.body ?? '',
  };
}

function valuesFrom(broadcast: EventBroadcast, eventTimezone: string, withSchedule: boolean): ComposerValues {
  const local = withSchedule ? eventIsoToLocalInput(broadcast.scheduled_at, eventTimezone) : '';
  return {
    variant: broadcast.variant,
    segments: broadcast.audience.segments,
    channels: broadcast.channels,
    body: broadcast.body ?? '',
    when: local ? 'later' : 'now',
    date: local ? local.slice(0, 10) : null,
    time: local ? local.slice(11, 16) : null,
  };
}

export function EventCommunicationsWorkspace({
  eventId,
  eventTitle,
  eventTimezone,
  eventEndsAt,
}: EventCommunicationsWorkspaceProps) {
  const { t } = useTranslation('event_communications');
  const list = useBroadcastList(eventId);
  const { reload, upsert } = list;

  /** One thing at a time: every action checks and holds this. */
  const busy = useRef(false);
  const [busyCard, setBusyCard] = useState<{ id: number; action: CardAction } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardErrors, setCardErrors] = useState<Record<number, CardError>>({});
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'dont_send' | 'discard'; broadcast: EventBroadcast } | null>(null);
  const [activity, setActivity] = useState<EventBroadcast | null>(null);
  const [restore, setRestore] = useState<PersistedComposer | null>(() => loadComposer(eventId));
  const [showCancelled, setShowCancelled] = useState(false);

  const ledger = useRef<KeyLedger>({});
  const opsLedger = useRef<KeyLedger>({});
  const progress = useRef<ComposerProgress>({ draft: null, draftSignature: null, replaced: false });
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionCounter = useRef(0);

  useEffect(() => () => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
  }, []);

  const city = timeZoneCity(eventTimezone);
  const whenText = useCallback((iso: string | null) => {
    const label = formatWhen(iso, eventTimezone);
    return label ? t('when_with_zone', { when: label, city }) : t('when_unknown');
  }, [city, eventTimezone, t]);

  const failureText = useCallback((response: ApiResponse<unknown>, fallbackKey: string): string => {
    const failure = describeFailure(response);
    switch (failure.kind) {
      case 'explained':
        return failure.message;
      case 'reason':
        return t(`reasons.${failure.reason}`);
      case 'conflict':
        return t('errors.conflict');
      case 'rate_limited':
        return t('errors.rate_limited');
      case 'timeout':
        return t('errors.unknown_outcome');
      default:
        return t(fallbackKey);
    }
  }, [t]);

  /** A timed-out request is checked once more with the SAME key: the server answers with what it already did. */
  async function withReplay<T>(call: () => Promise<ApiResponse<T>>, onSlow?: () => void): Promise<ApiResponse<T>> {
    const first = await call();
    if (first.success || first.code !== 'TIMEOUT') return first;
    onSlow?.();
    return call();
  }

  // ─── Composer ───────────────────────────────────────────────────────────

  function persist(values: ComposerValues, mode: ComposerMode, sourceId: number | null) {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      saveComposer(eventId, { values, mode, sourceId, session: ledger.current });
    }, PERSIST_DEBOUNCE_MS);
  }

  function forgetPersisted() {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = null;
    clearComposer(eventId);
    setRestore(null);
  }

  function startComposer(
    mode: ComposerMode,
    source: EventBroadcast | null,
    initial: ComposerValues,
    baseline: ComposerValues,
    session: KeyLedger = {},
  ) {
    ledger.current = session;
    progress.current = mode === 'edit' && source
      ? { draft: source, draftSignature: contentSignature(contentOf(source)), replaced: false }
      : { draft: null, draftSignature: null, replaced: false };
    sessionCounter.current += 1;
    setNotice(null);
    setComposer({ session: sessionCounter.current, mode, source, initial, baseline });
  }

  function openNew() {
    if (busy.current) return;
    forgetPersisted();
    const values = initialComposerValues();
    startComposer('new', null, values, values);
  }

  async function loadForComposer(broadcast: EventBroadcast): Promise<EventBroadcast | null> {
    const response = await withReplay(() => eventCommunicationsApi.get(broadcast.id, 1, 1, { includeSummary: true }));
    if (!response.success || !response.data || response.data.broadcast.body === null) {
      setCardErrors((current) => ({
        ...current,
        [broadcast.id]: response.code === 'EVENTS_CONTRACT_DRIFT'
          ? { message: '', drift: true }
          : { message: failureText(response, 'errors.open') },
      }));
      return null;
    }
    upsert(response.data.broadcast);
    return response.data.broadcast;
  }

  async function continueRestored() {
    if (!restore || busy.current) return;
    const saved = restore;
    if (saved.mode !== 'new' && saved.sourceId !== null) {
      busy.current = true;
      try {
        const response = await eventCommunicationsApi.get(saved.sourceId, 1, 1, { includeSummary: true });
        const source = response.success ? response.data?.broadcast ?? null : null;
        const stillEditable = source !== null && source.body !== null && (saved.mode === 'edit'
          ? source.status === 'draft' && source.capabilities.edit
          : source.status === 'scheduled' && source.capabilities.cancel);
        if (source && stillEditable) {
          upsert(source);
          const withSchedule = saved.mode === 'change';
          startComposer(saved.mode, source, saved.values, valuesFrom(source, eventTimezone, withSchedule), saved.session);
          return;
        }
      } catch (error) {
        logError('Failed to reload the message being restored', error);
      } finally {
        busy.current = false;
      }
    }
    // The original has moved on (sent, cancelled…): carry on as a new message.
    startComposer('new', null, saved.values, initialComposerValues(), saved.mode === 'new' ? saved.session : {});
  }

  function closeComposer() {
    setComposer(null);
  }

  async function failComposer(
    response: ApiResponse<unknown>,
    fallbackKey: string,
    afterDraftSaved: boolean,
  ): Promise<SubmitResult> {
    if (response.code === 'EVENTS_CONTRACT_DRIFT') return { status: 'drift' };
    if (response.code === 'TIMEOUT') {
      await reload({ silent: true });
      return { status: 'unknown', message: t('errors.unknown_outcome') };
    }
    if (isConflict(response)) {
      // Our idea of the message is out of date. Refresh it, so the next
      // press uses the current version, and let a new key be issued.
      delete ledger.current.revise;
      delete ledger.current.schedule;
      await reload({ silent: true });
      const draft = progress.current.draft;
      if (draft) {
        const fresh = await eventCommunicationsApi.get(draft.id, 1, 1, { includeSummary: true });
        if (fresh.success && fresh.data) {
          progress.current.draft = fresh.data.broadcast;
          progress.current.draftSignature = contentSignature(contentOf(fresh.data.broadcast));
          upsert(fresh.data.broadcast);
        }
      }
    }
    const reason = failureText(response, fallbackKey);
    return afterDraftSaved
      ? { status: 'partial', message: t('composer.partial', { reason }) }
      : { status: 'error', message: reason };
  }

  async function submitComposer(request: SubmitRequest, hooks: SubmitHooks): Promise<SubmitResult> {
    if (!composer || busy.current) return { status: 'error', message: t('errors.action') };
    busy.current = true;
    const { mode, source } = composer;
    const fallback = request.intent === 'draft' ? 'errors.save' : 'errors.send';
    try {
      // 1. Changing a scheduled message replaces it: stop the original first.
      if (mode === 'change' && source && !progress.current.replaced) {
        const cancelled = await withReplay(() => eventCommunicationsApi.cancel(
          source.id,
          source.version,
          'organiser_replaced',
          keyFor(ledger.current, 'cancel', versionSignature(source.id, source.version)),
        ), hooks.onSlow);
        if (!cancelled.success || !cancelled.data) return await failComposer(cancelled, fallback, false);
        progress.current.replaced = true;
        upsert(cancelled.data.broadcast);
      }

      // 2. Make sure a draft with exactly this content exists — once.
      const content = valuesToContent(request.values);
      const signature = contentSignature(content);
      let draft = progress.current.draft;
      if (!draft) {
        const created = await withReplay(() => eventCommunicationsApi.create(
          eventId,
          content,
          keyFor(ledger.current, 'create', signature),
        ), hooks.onSlow);
        if (!created.success || !created.data) return await failComposer(created, fallback, false);
        draft = created.data.broadcast;
      } else if (progress.current.draftSignature !== signature) {
        const current = draft;
        const revised = await withReplay(() => eventCommunicationsApi.revise(
          current.id,
          current.version,
          content,
          keyFor(ledger.current, 'revise', `${current.id}|${current.version}|${signature}`),
        ), hooks.onSlow);
        if (!revised.success || !revised.data) return await failComposer(revised, fallback, false);
        draft = revised.data.broadcast;
      }
      progress.current.draft = draft;
      progress.current.draftSignature = signature;
      upsert(draft);

      if (request.intent === 'draft') {
        forgetPersisted();
        setNotice(t('notice.saved'));
        void reload({ silent: true });
        return { status: 'done' };
      }

      // 3. Send (now or at the chosen time).
      const target = draft;
      const scheduled = await withReplay(() => eventCommunicationsApi.schedule(
        target.id,
        target.version,
        request.scheduledAt,
        keyFor(ledger.current, 'schedule', scheduleSignature(target.id, request.scheduledAt)),
      ), hooks.onSlow);
      if (!scheduled.success || !scheduled.data) return await failComposer(scheduled, fallback, true);

      upsert(scheduled.data.broadcast);
      forgetPersisted();
      setNotice(request.intent === 'schedule'
        ? t('notice.scheduled', { when: whenText(request.scheduledAt) })
        : t('notice.sent'));
      void reload({ silent: true });
      return { status: 'done' };
    } catch (error) {
      logError('Failed to send event communication', error);
      return { status: 'error', message: t(fallback) };
    } finally {
      busy.current = false;
    }
  }

  // ─── Card actions ───────────────────────────────────────────────────────

  async function runCardAction(
    broadcast: EventBroadcast,
    action: CardAction,
    work: () => Promise<void>,
  ) {
    if (busy.current) return;
    busy.current = true;
    setBusyCard({ id: broadcast.id, action });
    setCardErrors((current) => {
      const next = { ...current };
      delete next[broadcast.id];
      return next;
    });
    try {
      await work();
    } catch (error) {
      logError('Event communication action failed', error);
      setCardErrors((current) => ({ ...current, [broadcast.id]: { message: t('errors.action') } }));
    } finally {
      busy.current = false;
      setBusyCard(null);
    }
  }

  async function cardFailure(broadcast: EventBroadcast, response: ApiResponse<unknown>) {
    if (response.code === 'EVENTS_CONTRACT_DRIFT') {
      setCardErrors((current) => ({ ...current, [broadcast.id]: { message: '', drift: true } }));
      return;
    }
    // Out of date, or unsure whether it went through: refresh first, then explain.
    if (isConflict(response) || response.code === 'TIMEOUT') await reload({ silent: true });
    setCardErrors((current) => ({ ...current, [broadcast.id]: { message: failureText(response, 'errors.action') } }));
  }

  function handleCardAction(action: CardAction, broadcast: EventBroadcast) {
    if (action === 'activity') {
      setActivity(broadcast);
      return;
    }
    if (action === 'discard' || action === 'dont_send') {
      if (!busy.current) setConfirm({ kind: action, broadcast });
      return;
    }
    if (action === 'open' || action === 'change') {
      void runCardAction(broadcast, action, async () => {
        const fresh = await loadForComposer(broadcast);
        if (!fresh) return;
        forgetPersisted();
        if (action === 'open') {
          const values = valuesFrom(fresh, eventTimezone, false);
          startComposer('edit', fresh, values, values);
        } else {
          const values = valuesFrom(fresh, eventTimezone, true);
          startComposer('change', fresh, values, values);
        }
      });
      return;
    }
    if (action === 'retry') {
      void runCardAction(broadcast, action, async () => {
        const response = await withReplay(() => eventCommunicationsApi.retry(
          broadcast.id,
          broadcast.version,
          keyFor(opsLedger.current, `retry:${broadcast.id}`, versionSignature(broadcast.id, broadcast.version)),
        ));
        if (!response.success || !response.data) {
          await cardFailure(broadcast, response);
          return;
        }
        upsert(response.data.broadcast);
        setNotice(t('notice.retried'));
        void reload({ silent: true });
      });
    }
  }

  function confirmStop() {
    if (!confirm) return;
    const { kind, broadcast } = confirm;
    setConfirm(null);
    void runCardAction(broadcast, kind, async () => {
      const response = await withReplay(() => eventCommunicationsApi.cancel(
        broadcast.id,
        broadcast.version,
        kind === 'discard' ? 'organiser_discarded' : 'organiser_cancelled',
        keyFor(opsLedger.current, `cancel:${broadcast.id}`, versionSignature(broadcast.id, broadcast.version)),
      ));
      if (!response.success || !response.data) {
        await cardFailure(broadcast, response);
        return;
      }
      upsert(response.data.broadcast);
      setNotice(t(kind === 'discard' ? 'notice.discarded' : 'notice.cancelled'));
      void reload({ silent: true });
    });
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  const cancelledCount = list.broadcasts.filter((broadcast) => broadcast.status === 'cancelled').length;
  const visible = showCancelled
    ? list.broadcasts
    : list.broadcasts.filter((broadcast) => broadcast.status !== 'cancelled');
  const drift = list.loadError === 'EVENTS_CONTRACT_DRIFT';
  const headingId = `event-communications-${eventId}`;

  return (
    <section aria-labelledby={headingId} className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={headingId} className="text-xl font-semibold text-theme-primary">{t('title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-theme-muted">{t('description')}</p>
        </div>
        <Button startContent={<MailPlus className="h-4 w-4" aria-hidden="true" />} onPress={openNew}>
          {t('new_message')}
        </Button>
      </div>

      <Alert
        color="primary"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title={t('privacy_title')}
        description={t('privacy_description')}
      />

      <div role="status">
        {notice && (
          <Alert
            color="success"
            description={notice}
            endContent={(
              <Button size="sm" variant="secondary" onPress={() => setNotice(null)}>{t('dismiss')}</Button>
            )}
          />
        )}
      </div>

      {restore && !composer && (
        <Alert
          color="warning"
          title={t('restore.title')}
          description={t('restore.description')}
          endContent={(
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onPress={() => void continueRestored()}>{t('restore.continue')}</Button>
              <Button size="sm" variant="secondary" onPress={forgetPersisted}>{t('restore.start_again')}</Button>
            </div>
          )}
        />
      )}

      {drift ? (
        <Alert
          color="danger"
          title={t('errors.drift_title')}
          description={t('errors.drift_description')}
          endContent={(
            <Button size="sm" variant="danger-soft" onPress={() => window.location.reload()}>
              {t('errors.reload')}
            </Button>
          )}
        />
      ) : list.loadError ? (
        <Alert
          color="danger"
          title={t('load_error_title')}
          description={t('load_error_description')}
          endContent={<Button size="sm" variant="danger-soft" onPress={() => void reload()}>{t('retry')}</Button>}
        />
      ) : null}

      {list.isLoading ? (
        <div className="flex min-h-48 items-center justify-center"><Spinner aria-label={t('loading')} /></div>
      ) : !list.loadError && list.broadcasts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-theme-default p-8 text-center">
          <Send className="mx-auto h-10 w-10 text-theme-subtle" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-theme-primary">{t('empty_title')}</h3>
          <p className="mt-1 text-sm text-theme-muted">{t('empty_description')}</p>
        </div>
      ) : list.broadcasts.length > 0 ? (
        <>
          {cancelledCount > 0 && (
            <Checkbox isSelected={showCancelled} onValueChange={setShowCancelled}>
              {t('show_cancelled', { n: cancelledCount })}
            </Checkbox>
          )}
          <div className="grid gap-4">
            {visible.map((broadcast) => (
              <BroadcastCard
                key={broadcast.id}
                broadcast={broadcast}
                now={list.now}
                eventTimezone={eventTimezone}
                busyAction={busyCard?.id === broadcast.id ? busyCard.action : null}
                isLocked={busyCard !== null}
                error={cardErrors[broadcast.id] ?? null}
                onAction={handleCardAction}
                onDismissError={() => setCardErrors((current) => {
                  const next = { ...current };
                  delete next[broadcast.id];
                  return next;
                })}
              />
            ))}
          </div>
          {list.pagination && list.pagination.total_pages > 1 && (
            <div className="flex justify-end border-t border-theme-default pt-4">
              <Pagination
                page={list.pagination.current_page}
                total={list.pagination.total_pages}
                showControls
                aria-label={t('pagination_label')}
                onChange={list.setPage}
              />
            </div>
          )}
        </>
      ) : null}

      {composer && (
        <BroadcastComposer
          key={composer.session}
          isOpen
          eventId={eventId}
          eventTitle={eventTitle}
          eventTimezone={eventTimezone}
          eventEndsAt={eventEndsAt}
          mode={composer.mode}
          initialValues={composer.initial}
          baseline={composer.baseline}
          onValuesChange={(values) => persist(values, composer.mode, composer.source?.id ?? null)}
          onSubmit={submitComposer}
          onDiscard={forgetPersisted}
          onClose={closeComposer}
        />
      )}

      <BroadcastActivityModal broadcast={activity} eventTimezone={eventTimezone} onClose={() => setActivity(null)} />

      <Modal isOpen={confirm !== null} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <ModalContent>
          <ModalHeader>
            {confirm?.kind === 'discard' ? t('discard_draft.title') : t('dont_send.title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-primary">
              {confirm?.kind === 'discard'
                ? t('discard_draft.description')
                : t('dont_send.description', { when: whenText(confirm?.broadcast.scheduled_at ?? null) })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setConfirm(null)}>
              {confirm?.kind === 'discard' ? t('discard_draft.keep') : t('dont_send.keep')}
            </Button>
            <Button variant="danger" onPress={confirmStop}>
              {confirm?.kind === 'discard' ? t('discard_draft.confirm') : t('dont_send.confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </section>
  );
}
