// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import Clock3 from 'lucide-react/icons/clock-3';
import History from 'lucide-react/icons/history';
import Layers3 from 'lucide-react/icons/layers-3';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import {
  eventsApi,
  type EventRecurrenceDefinitionCommit,
  type EventRecurrenceDefinitionHistoryItem,
  type EventRecurrenceDefinitionPreview,
  type EventRecurrenceDefinitionSection,
  type EventRecurrenceDefinitionSections,
} from '@/lib/events-api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const SECTION_KEYS: readonly EventRecurrenceDefinitionSection[] = [
  'agenda',
  'ticket_types',
  'registration',
  'safety',
  'staff',
];

const COUNT_KEYS = [
  'sessions',
  'speakers',
  'resources',
  'ticket_types',
  'registration_settings',
  'published_forms',
  'form_questions',
  'safety_requirements',
  'staff_assignments',
] as const;

interface EventRecurrenceDefinitionBlueprintManagerProps {
  eventId: number;
  recurrenceId: string;
  allowedSections: EventRecurrenceDefinitionSections;
  onUnavailable: () => void;
}

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `event-recurrence-definition-${globalThis.crypto.randomUUID()}`;
  }

  return `event-recurrence-definition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function unavailable(code?: string): boolean {
  return code === 'SERVICE_UNAVAILABLE'
    || code === 'EVENT_RECURRENCE_DEFINITION_UNAVAILABLE';
}

function previewInvalid(code?: string): boolean {
  return code === 'EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID';
}

function selectedKeys(sections: EventRecurrenceDefinitionSections): EventRecurrenceDefinitionSection[] {
  return SECTION_KEYS.filter((section) => sections[section]);
}

function appendUnique(
  current: EventRecurrenceDefinitionHistoryItem[],
  incoming: EventRecurrenceDefinitionHistoryItem[],
): EventRecurrenceDefinitionHistoryItem[] {
  const seen = new Set(current.map((item) => item.blueprint_id));
  return [...current, ...incoming.filter((item) => !seen.has(item.blueprint_id))];
}

export function EventRecurrenceDefinitionBlueprintManager({
  eventId,
  recurrenceId,
  allowedSections,
  onUnavailable,
}: EventRecurrenceDefinitionBlueprintManagerProps) {
  const { t } = useTranslation('event_recurrence_blueprints');
  const initialAbortRef = useRef<AbortController | null>(null);
  const moreAbortRef = useRef<AbortController | null>(null);
  const workflowAbortRef = useRef<AbortController | null>(null);
  const requestGenerationRef = useRef(0);
  const workflowGenerationRef = useRef(0);
  const defaultSections = useMemo<EventRecurrenceDefinitionSections>(() => ({
    agenda: allowedSections.agenda,
    ticket_types: allowedSections.ticket_types,
    registration: allowedSections.registration,
    safety: allowedSections.safety,
    staff: false,
  }), [
    allowedSections.agenda,
    allowedSections.registration,
    allowedSections.safety,
    allowedSections.ticket_types,
  ]);
  const [sections, setSections] = useState<EventRecurrenceDefinitionSections>(() => ({
    agenda: allowedSections.agenda,
    ticket_types: allowedSections.ticket_types,
    registration: allowedSections.registration,
    safety: allowedSections.safety,
    staff: false,
  }));
  const [preview, setPreview] = useState<EventRecurrenceDefinitionPreview | null>(null);
  const [commitResult, setCommitResult] = useState<EventRecurrenceDefinitionCommit | null>(null);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [, setExpiryTick] = useState(0);
  const [historyItems, setHistoryItems] = useState<EventRecurrenceDefinitionHistoryItem[]>([]);
  const [nextBeforeVersion, setNextBeforeVersion] = useState<number | null>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState(false);

  const chosenSections = useMemo(() => selectedKeys(sections), [sections]);
  const previewIsExpired = (() => {
    if (!preview) return false;
    const expiry = Date.parse(preview.preview_expires_at);
    return Number.isNaN(expiry) || expiry <= Date.now();
  })();

  const dateLabel = useCallback((value: string): string => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return t('time_unknown');

    return new Intl.DateTimeFormat(getFormattingLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parsed);
  }, [t]);

  const loadInitialHistory = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const generation = ++requestGenerationRef.current;
    setHistoryError(false);
    setLoadMoreError(false);
    setIsLoadingHistory(true);
    try {
      const response = await eventsApi.recurrenceDefinitionHistory(
        eventId,
        10,
        undefined,
        signal ? { signal } : undefined,
      );
      if (signal?.aborted || generation !== requestGenerationRef.current) return;
      if (unavailable(response.code)) {
        onUnavailable();
        return;
      }
      if (!response.success || !response.data) {
        setHistoryError(true);
        return;
      }
      setHistoryItems(response.data.items);
      setNextBeforeVersion(response.data.next_before_version);
    } catch (error) {
      if (signal?.aborted || generation !== requestGenerationRef.current) return;
      logError('Failed to load recurring event definition blueprint history', error);
      setHistoryError(true);
    } finally {
      if (!signal?.aborted && generation === requestGenerationRef.current) {
        setIsLoadingHistory(false);
      }
    }
  }, [eventId, onUnavailable]);

  useEffect(() => {
    initialAbortRef.current?.abort();
    moreAbortRef.current?.abort();
    workflowAbortRef.current?.abort();
    workflowGenerationRef.current += 1;
    const controller = new AbortController();
    initialAbortRef.current = controller;
    setSections(defaultSections);
    setHistoryItems([]);
    setNextBeforeVersion(null);
    setPreview(null);
    setCommitResult(null);
    setPendingIdempotencyKey(null);
    setWorkflowError(null);
    setIsPreviewing(false);
    setIsCommitting(false);
    setIsConfirmOpen(false);
    setIsConfirmed(false);
    void loadInitialHistory(controller.signal);

    return () => {
      controller.abort();
      moreAbortRef.current?.abort();
      workflowAbortRef.current?.abort();
      requestGenerationRef.current += 1;
      workflowGenerationRef.current += 1;
    };
  }, [defaultSections, loadInitialHistory, recurrenceId]);

  useEffect(() => {
    if (!preview) return undefined;
    const expiry = Date.parse(preview.preview_expires_at);
    if (Number.isNaN(expiry) || expiry <= Date.now()) {
      setExpiryTick((value) => value + 1);
      return undefined;
    }
    const timeout = globalThis.setTimeout(
      () => setExpiryTick((value) => value + 1),
      Math.min(expiry - Date.now(), 2_147_000_000),
    );

    return () => globalThis.clearTimeout(timeout);
  }, [preview]);

  function changeSection(section: EventRecurrenceDefinitionSection, selected: boolean): void {
    if (!allowedSections[section]) return;
    workflowAbortRef.current?.abort();
    workflowGenerationRef.current += 1;
    setIsPreviewing(false);
    setIsCommitting(false);
    setSections((current) => ({ ...current, [section]: selected }));
    setPreview(null);
    setCommitResult(null);
    setPendingIdempotencyKey(null);
    setWorkflowError(null);
    setIsConfirmOpen(false);
    setIsConfirmed(false);
  }

  async function handlePreview(): Promise<void> {
    if (chosenSections.length === 0 || isPreviewing) return;
    workflowAbortRef.current?.abort();
    const controller = new AbortController();
    workflowAbortRef.current = controller;
    const generation = ++workflowGenerationRef.current;
    setWorkflowError(null);
    setCommitResult(null);
    setIsPreviewing(true);
    try {
      const response = await eventsApi.previewRecurrenceDefinitions(
        eventId,
        recurrenceId,
        sections,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || generation !== workflowGenerationRef.current) return;
      if (unavailable(response.code)) {
        onUnavailable();
        return;
      }
      if (!response.success || !response.data) {
        setWorkflowError('preview_error');
        return;
      }
      setPreview(response.data);
      setPendingIdempotencyKey(idempotencyKey());
      setIsConfirmed(false);
    } catch (error) {
      if (controller.signal.aborted || generation !== workflowGenerationRef.current) return;
      logError('Failed to preview recurring event definition blueprint', error);
      setWorkflowError('preview_error');
    } finally {
      if (!controller.signal.aborted && generation === workflowGenerationRef.current) {
        setIsPreviewing(false);
      }
    }
  }

  async function handleCommit(): Promise<void> {
    if (!preview || !pendingIdempotencyKey || !isConfirmed || isCommitting) return;
    if (previewIsExpired) {
      setWorkflowError('preview_expired');
      setIsConfirmOpen(false);
      return;
    }
    workflowAbortRef.current?.abort();
    const controller = new AbortController();
    workflowAbortRef.current = controller;
    const generation = ++workflowGenerationRef.current;
    setWorkflowError(null);
    setIsCommitting(true);
    try {
      const response = await eventsApi.commitRecurrenceDefinitions(
        eventId,
        recurrenceId,
        sections,
        preview.preview_token,
        pendingIdempotencyKey,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || generation !== workflowGenerationRef.current) return;
      if (unavailable(response.code)) {
        setIsConfirmOpen(false);
        onUnavailable();
        return;
      }
      if (previewInvalid(response.code)) {
        setPreview(null);
        setPendingIdempotencyKey(null);
        setIsConfirmOpen(false);
        setWorkflowError('preview_stale');
        return;
      }
      if (!response.success || !response.data) {
        setWorkflowError(
          response.code === 'EVENT_RECURRENCE_DEFINITION_CONFLICT'
            ? 'commit_conflict'
            : 'commit_error',
        );
        return;
      }
      setCommitResult(response.data);
      setPreview(null);
      setPendingIdempotencyKey(null);
      setIsConfirmOpen(false);
      setIsConfirmed(false);
      await loadInitialHistory();
    } catch (error) {
      if (controller.signal.aborted || generation !== workflowGenerationRef.current) return;
      logError('Failed to commit recurring event definition blueprint', error);
      setWorkflowError('commit_error');
    } finally {
      if (!controller.signal.aborted && generation === workflowGenerationRef.current) {
        setIsCommitting(false);
      }
    }
  }

  async function loadMoreHistory(): Promise<void> {
    if (!nextBeforeVersion || isLoadingMore) return;
    moreAbortRef.current?.abort();
    const controller = new AbortController();
    moreAbortRef.current = controller;
    const generation = requestGenerationRef.current;
    setLoadMoreError(false);
    setIsLoadingMore(true);
    try {
      const response = await eventsApi.recurrenceDefinitionHistory(
        eventId,
        10,
        nextBeforeVersion,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      if (unavailable(response.code)) {
        onUnavailable();
        return;
      }
      if (!response.success || !response.data) {
        setLoadMoreError(true);
        return;
      }
      setHistoryItems((current) => appendUnique(current, response.data!.items));
      setNextBeforeVersion(response.data.next_before_version);
    } catch (error) {
      if (controller.signal.aborted || generation !== requestGenerationRef.current) return;
      logError('Failed to load more recurring event definition blueprint history', error);
      setLoadMoreError(true);
    } finally {
      if (!controller.signal.aborted && generation === requestGenerationRef.current) {
        setIsLoadingMore(false);
      }
    }
  }

  return (
    <div className="space-y-5" aria-labelledby="recurrence-definition-blueprints-heading">
      <Card className="border border-theme-default bg-theme-surface">
        <Card.Header className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
          <Layers3 className="mt-0.5 h-5 w-5 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <h2 id="recurrence-definition-blueprints-heading" className="text-xl font-semibold text-theme-primary">
              {t('title')}
            </h2>
            <p className="mt-1 text-sm text-theme-muted">{t('description')}</p>
          </div>
        </Card.Header>
        <Card.Content className="space-y-5 px-5 pb-5 sm:px-6 sm:pb-6">
          <Alert
            color="primary"
            icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
            title={t('definition_only_title')}
            description={t('definition_only_description')}
          />

          <div className="rounded-xl border border-theme-default bg-theme-elevated p-4">
            <p className="text-sm font-medium text-theme-muted">{t('effective_from_label')}</p>
            <code className="mt-2 block break-all rounded-lg bg-theme-surface px-3 py-2 text-sm font-semibold text-theme-primary">
              {recurrenceId}
            </code>
            <p className="mt-2 text-xs text-theme-subtle">{t('effective_from_help')}</p>
          </div>

          <fieldset className="space-y-3">
            <legend className="text-base font-semibold text-theme-primary">{t('sections_title')}</legend>
            <p className="text-sm text-theme-muted">{t('sections_description')}</p>
            <div className="grid gap-3 lg:grid-cols-2">
              {SECTION_KEYS.map((section) => (
                <div
                  key={section}
                  className={section === 'staff'
                    ? 'rounded-xl border border-warning/40 bg-warning/5 p-4'
                    : 'rounded-xl border border-theme-default bg-theme-elevated p-4'}
                >
                  <Checkbox
                    isSelected={sections[section]}
                    isDisabled={!allowedSections[section]}
                    onValueChange={(selected) => changeSection(section, selected)}
                    description={t(`sections.${section}.description`)}
                  >
                    {t(`sections.${section}.label`)}
                  </Checkbox>
                  {!allowedSections[section] && (
                    <p className="mt-2 ps-7 text-xs text-theme-subtle">{t('section_not_permitted')}</p>
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          {chosenSections.length === 0 && (
            <Alert color="warning" title={t('no_sections_title')} description={t('no_sections_description')} />
          )}

          {workflowError && (
            <Alert
              color={workflowError === 'preview_expired' || workflowError === 'preview_stale' ? 'warning' : 'danger'}
              title={t(`errors.${workflowError}.title`)}
              description={t(`errors.${workflowError}.description`)}
            />
          )}

          {commitResult && (
            <Alert
              color="success"
              icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
              title={t(commitResult.idempotent_replay ? 'success_replay_title' : 'success_created_title')}
              description={t(
                commitResult.idempotent_replay ? 'success_replay_description' : 'success_created_description',
                { version: commitResult.blueprint_version },
              )}
            />
          )}

          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              isPending={isPreviewing}
              isDisabled={chosenSections.length === 0 || isCommitting}
              onPress={() => void handlePreview()}
            >
              {isPreviewing ? t('previewing') : t('preview_button')}
            </Button>
          </div>
        </Card.Content>
      </Card>

      {preview && (
        <Card className="border border-theme-default bg-theme-surface" aria-live="polite">
          <Card.Header className="px-5 pt-5 sm:px-6 sm:pt-6">
            <div>
              <h2 className="text-lg font-semibold text-theme-primary">{t('preview_title')}</h2>
              <p className="mt-1 text-sm text-theme-muted">{t('preview_description')}</p>
            </div>
          </Card.Header>
          <Card.Content className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
            <div className="flex flex-wrap gap-2">
              {selectedKeys(preview.selected_sections).map((section) => (
                <Chip key={section} size="sm" variant="flat">{t(`sections.${section}.label`)}</Chip>
              ))}
            </div>
            <CountGrid counts={preview.counts} />
            <p className="flex items-center gap-2 text-sm text-theme-muted">
              <Clock3 className="h-4 w-4" aria-hidden="true" />
              {t('preview_expires', { date: dateLabel(preview.preview_expires_at) })}
            </p>

            {preview.conflicts.length > 0 && (
              <div className="rounded-xl border border-danger/30 bg-danger/5 p-4" role="alert">
                <h3 className="flex items-center gap-2 font-semibold text-danger">
                  <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  {t('conflicts_title')}
                </h3>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-theme-primary">
                  {preview.conflicts.map((conflict, index) => (
                    <li key={`${conflict.section}-${conflict.code}-${index}`}>
                      {t(`conflicts.${conflict.code}`, {
                        count: conflict.count,
                        section: t(`sections.${conflict.section}.label`),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {previewIsExpired && (
              <Alert
                color="warning"
                title={t('errors.preview_expired.title')}
                description={t('errors.preview_expired.description')}
              />
            )}

            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                isDisabled={!preview.can_commit || previewIsExpired}
                onPress={() => {
                  setIsConfirmed(false);
                  setIsConfirmOpen(true);
                }}
              >
                {t('review_button')}
              </Button>
              <Button variant="secondary" onPress={() => void handlePreview()} isPending={isPreviewing}>
                {t('refresh_preview')}
              </Button>
            </div>
          </Card.Content>
        </Card>
      )}

      <Card className="border border-theme-default bg-theme-surface">
        <Card.Header className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
          <History className="mt-0.5 h-5 w-5 shrink-0 text-theme-secondary" aria-hidden="true" />
          <div>
            <h2 className="text-lg font-semibold text-theme-primary">{t('history_title')}</h2>
            <p className="mt-1 text-sm text-theme-muted">{t('history_description')}</p>
          </div>
        </Card.Header>
        <Card.Content className="space-y-4 px-5 pb-5 sm:px-6 sm:pb-6">
          {isLoadingHistory ? (
            <div className="flex min-h-28 items-center justify-center gap-3" role="status">
              <Spinner size="sm" />
              <span className="text-sm text-theme-muted">{t('history_loading')}</span>
            </div>
          ) : historyError ? (
            <Alert
              color="danger"
              title={t('history_error_title')}
              description={t('history_error_description')}
              endContent={(
                <Button size="sm" variant="secondary" onPress={() => void loadInitialHistory()}>
                  {t('retry')}
                </Button>
              )}
            />
          ) : historyItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-theme-default bg-theme-elevated p-5 text-center">
              <p className="font-medium text-theme-primary">{t('history_empty_title')}</p>
              <p className="mt-1 text-sm text-theme-muted">{t('history_empty_description')}</p>
            </div>
          ) : (
            <>
              <ol className="space-y-3" aria-label={t('history_list_label')}>
                {historyItems.map((item) => (
                  <li key={item.blueprint_id} className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-semibold text-theme-primary">
                          {t('history_version', { version: item.blueprint_version })}
                        </h3>
                        <p className="mt-0.5 text-xs text-theme-subtle">{dateLabel(item.created_at)}</p>
                      </div>
                      <Chip size="sm" color="success" variant="flat">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('immutable')}
                      </Chip>
                    </div>
                    <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-medium text-theme-muted">{t('effective_from_label')}</dt>
                        <dd className="mt-1 break-all font-mono text-xs text-theme-primary">
                          {item.effective_from_recurrence_id}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-theme-muted">{t('history_sections')}</dt>
                        <dd className="mt-1 flex flex-wrap gap-1.5">
                          {selectedKeys(item.selected_sections).map((section) => (
                            <Chip key={section} size="sm" variant="flat">{t(`sections.${section}.label`)}</Chip>
                          ))}
                        </dd>
                      </div>
                    </dl>
                    <div className="mt-3"><CountGrid counts={item.counts} compact /></div>
                  </li>
                ))}
              </ol>
              {loadMoreError && (
                <Alert color="danger" title={t('load_more_error_title')} description={t('load_more_error_description')} />
              )}
              {nextBeforeVersion && (
                <div className="flex justify-center">
                  <Button variant="secondary" isPending={isLoadingMore} onPress={() => void loadMoreHistory()}>
                    {isLoadingMore ? t('history_loading_more') : t('history_load_more')}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card.Content>
      </Card>

      <Modal
        isOpen={isConfirmOpen}
        onOpenChange={(open) => {
          if (isCommitting) return;
          setIsConfirmOpen(open);
          if (!open) setIsConfirmed(false);
        }}
        size="lg"
        scrollBehavior="inside"
        isDismissable={!isCommitting}
        isKeyboardDismissDisabled={isCommitting}
      >
        <ModalContent>
          <>
            <ModalHeader>{t('confirm_title')}</ModalHeader>
            <ModalBody className="space-y-4">
              <Alert
                color="warning"
                icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
                title={t('confirm_scope_title')}
                description={t('confirm_scope_description')}
              />
              <div className="flex flex-wrap gap-2">
                {chosenSections.map((section) => (
                  <Chip key={section} size="sm" variant="flat">{t(`sections.${section}.label`)}</Chip>
                ))}
              </div>
              {sections.staff && (
                <Alert color="danger" title={t('staff_risk_title')} description={t('staff_risk_description')} />
              )}
              {preview && <CountGrid counts={preview.counts} />}
              <Checkbox
                isSelected={isConfirmed}
                onValueChange={setIsConfirmed}
                description={t('confirm_ack_description')}
              >
                {t('confirm_ack')}
              </Checkbox>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="secondary"
                isDisabled={isCommitting}
                onPress={() => setIsConfirmOpen(false)}
              >
                {t('cancel')}
              </Button>
              <Button
                variant="primary"
                isPending={isCommitting}
                isDisabled={!isConfirmed || previewIsExpired}
                onPress={() => void handleCommit()}
              >
                {isCommitting ? t('committing') : t('commit_button')}
              </Button>
            </ModalFooter>
          </>
        </ModalContent>
      </Modal>
    </div>
  );

  function CountGrid({ counts, compact = false }: { counts: Record<string, number>; compact?: boolean }) {
    const visible = COUNT_KEYS.filter((key) => typeof counts[key] === 'number' && counts[key] > 0);
    if (visible.length === 0) {
      return <p className="text-sm text-theme-muted">{t('counts.none')}</p>;
    }

    return (
      <dl className={compact ? 'flex flex-wrap gap-2' : 'grid gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
        {visible.map((key) => (
          <div key={key} className="rounded-lg border border-theme-default bg-theme-surface px-3 py-2">
            <dt className="text-xs text-theme-muted">{t(`counts.${key}`, { count: counts[key] })}</dt>
            <dd className="text-lg font-semibold text-theme-primary">{counts[key]}</dd>
          </div>
        ))}
      </dl>
    );
  }
}
