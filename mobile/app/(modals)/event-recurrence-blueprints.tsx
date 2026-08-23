// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Card,
  Chip,
  ControlField,
  Description,
  Dialog,
  Label,
  Spinner,
} from 'heroui-native';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { ApiResponseError } from '@/lib/api/client';
import {
  commitEventRecurrenceDefinitions,
  getEvent,
  getEventRecurrenceCapabilities,
  getEventRecurrenceDefinitionHistory,
  previewEventRecurrenceDefinitions,
  type CanonicalEvent,
  type EventRecurrenceDefinitionCommit,
  type EventRecurrenceDefinitionHistoryItem,
  type EventRecurrenceDefinitionPreview,
  type EventRecurrenceDefinitionSection,
  type EventRecurrenceDefinitionSections,
} from '@/lib/api/events';
import {
  canUseRecurrenceDefinitionBlueprints,
  recurrenceDefinitionPermissions,
} from '@/lib/events/recurrenceBlueprints';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

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

type WorkflowError = 'preview_error' | 'preview_expired' | 'preview_stale' | 'commit_conflict' | 'commit_error';

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `event-recurrence-definition-${globalThis.crypto.randomUUID()}`;
  }
  return `event-recurrence-definition-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function codeOf(error: unknown): string | null {
  return error instanceof ApiResponseError ? error.message : null;
}

function appendUnique(
  current: EventRecurrenceDefinitionHistoryItem[],
  incoming: EventRecurrenceDefinitionHistoryItem[],
): EventRecurrenceDefinitionHistoryItem[] {
  const seen = new Set(current.map((item) => item.blueprint_id));
  return [...current, ...incoming.filter((item) => !seen.has(item.blueprint_id))];
}

export default function EventRecurrenceBlueprintsScreen() {
  return (
    <ModalErrorBoundary>
      <EventRecurrenceBlueprintsScreenInner />
    </ModalErrorBoundary>
  );
}

function EventRecurrenceBlueprintsScreenInner() {
  const { t, i18n } = useTranslation(['event_recurrence_blueprints', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const parsedId = Number(id);
  const eventId = Number.isInteger(parsedId) && parsedId > 0 ? parsedId : 0;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const generationRef = useRef(0);
  const subjectIdentityRef = useRef<string | null>(null);
  const [event, setEvent] = useState<CanonicalEvent | null>(null);
  const [allowedSections, setAllowedSections] = useState<EventRecurrenceDefinitionSections | null>(null);
  const [sections, setSections] = useState<EventRecurrenceDefinitionSections>({
    agenda: false,
    ticket_types: false,
    registration: false,
    safety: false,
    staff: false,
  });
  const [history, setHistory] = useState<EventRecurrenceDefinitionHistoryItem[]>([]);
  const [nextBeforeVersion, setNextBeforeVersion] = useState<number | null>(null);
  const [preview, setPreview] = useState<EventRecurrenceDefinitionPreview | null>(null);
  const [commitResult, setCommitResult] = useState<EventRecurrenceDefinitionCommit | null>(null);
  const [pendingIdempotencyKey, setPendingIdempotencyKey] = useState<string | null>(null);
  const [workflowError, setWorkflowError] = useState<WorkflowError | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  const recurrenceId = event?.series.recurrence?.recurrence_id ?? null;
  const selectedSections = useMemo(
    () => SECTION_KEYS.filter((section) => sections[section]),
    [sections],
  );
  const previewExpired = preview !== null && (
    Number.isNaN(Date.parse(preview.preview_expires_at))
    || Date.parse(preview.preview_expires_at) <= Date.now()
  );

  useEffect(() => {
    const generation = ++generationRef.current;
    setIsLoading(true);
    subjectIdentityRef.current = null;
    setLoadFailed(false);
    setEvent(null);
    setAllowedSections(null);
    setHistory([]);
    setNextBeforeVersion(null);
    setPreview(null);
    setCommitResult(null);
    setPendingIdempotencyKey(null);
    setWorkflowError(null);
    setIsLoadingMore(false);
    setLoadMoreFailed(false);
    setIsPreviewing(false);
    setIsCommitting(false);
    setIsConfirmOpen(false);
    setIsConfirmed(false);
    if (eventId <= 0) {
      setIsLoading(false);
      setLoadFailed(true);
      return () => { generationRef.current += 1; };
    }

    void Promise.all([getEvent(eventId), getEventRecurrenceCapabilities()])
      .then(async ([eventResponse, capabilityResponse]) => {
        if (generation !== generationRef.current) return;
        const nextEvent = eventResponse.data;
        if (!canUseRecurrenceDefinitionBlueprints(nextEvent, capabilityResponse.data)) {
          setLoadFailed(true);
          return;
        }
        const allowed = recurrenceDefinitionPermissions(nextEvent);
        subjectIdentityRef.current = nextEvent.series.recurrence!.recurrence_id;
        setEvent(nextEvent);
        setAllowedSections(allowed);
        setSections({
          agenda: allowed.agenda,
          ticket_types: allowed.ticket_types,
          registration: allowed.registration,
          safety: allowed.safety,
          staff: false,
        });
        const historyResponse = await getEventRecurrenceDefinitionHistory(eventId);
        if (generation !== generationRef.current) return;
        setHistory(historyResponse.data.items);
        setNextBeforeVersion(historyResponse.data.next_before_version);
      })
      .catch(() => {
        if (generation === generationRef.current) setLoadFailed(true);
      })
      .finally(() => {
        if (generation === generationRef.current) setIsLoading(false);
      });

    return () => { generationRef.current += 1; };
  }, [eventId, retryToken]);

  function changeSection(section: EventRecurrenceDefinitionSection, selected: boolean): void {
    if (!allowedSections?.[section]) return;
    setSections((current) => ({ ...current, [section]: selected }));
    setPreview(null);
    setCommitResult(null);
    setPendingIdempotencyKey(null);
    setWorkflowError(null);
    setIsConfirmOpen(false);
    setIsConfirmed(false);
  }

  async function loadMore(): Promise<void> {
    if (!nextBeforeVersion || isLoadingMore) return;
    const generation = generationRef.current;
    const sourceIdentity = subjectIdentityRef.current;
    const beforeVersion = nextBeforeVersion;
    setLoadMoreFailed(false);
    setIsLoadingMore(true);
    try {
      const response = await getEventRecurrenceDefinitionHistory(eventId, beforeVersion);
      if (generation !== generationRef.current || sourceIdentity !== subjectIdentityRef.current) return;
      setHistory((current) => appendUnique(current, response.data.items));
      setNextBeforeVersion(response.data.next_before_version);
    } catch {
      if (generation === generationRef.current) setLoadMoreFailed(true);
    } finally {
      if (generation === generationRef.current && sourceIdentity === subjectIdentityRef.current) {
        setIsLoadingMore(false);
      }
    }
  }

  async function preparePreview(): Promise<void> {
    if (!recurrenceId || selectedSections.length === 0 || isPreviewing) return;
    setWorkflowError(null);
    setCommitResult(null);
    setIsPreviewing(true);
    const generation = generationRef.current;
    const sourceIdentity = recurrenceId;
    const sectionSnapshot = { ...sections };
    try {
      const response = await previewEventRecurrenceDefinitions(eventId, sourceIdentity, sectionSnapshot);
      if (generation !== generationRef.current || sourceIdentity !== subjectIdentityRef.current) return;
      setPreview(response.data);
      setPendingIdempotencyKey(idempotencyKey());
      setIsConfirmed(false);
    } catch (error) {
      if (generation !== generationRef.current || sourceIdentity !== subjectIdentityRef.current) return;
      setWorkflowError(codeOf(error) === 'EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID'
        ? 'preview_stale'
        : 'preview_error');
    } finally {
      if (generation === generationRef.current && sourceIdentity === subjectIdentityRef.current) {
        setIsPreviewing(false);
      }
    }
  }

  async function commitPreview(): Promise<void> {
    if (!preview || !recurrenceId || !pendingIdempotencyKey || !isConfirmed || isCommitting) return;
    if (previewExpired) {
      setIsConfirmOpen(false);
      setWorkflowError('preview_expired');
      return;
    }
    setWorkflowError(null);
    setIsCommitting(true);
    const generation = generationRef.current;
    const sourceIdentity = recurrenceId;
    const sectionSnapshot = { ...sections };
    try {
      const response = await commitEventRecurrenceDefinitions(
        eventId,
        sourceIdentity,
        sectionSnapshot,
        preview.preview_token,
        pendingIdempotencyKey,
      );
      if (generation !== generationRef.current || sourceIdentity !== subjectIdentityRef.current) return;
      setCommitResult(response.data);
      setPreview(null);
      setPendingIdempotencyKey(null);
      setIsConfirmOpen(false);
      setIsConfirmed(false);
      try {
        const refreshed = await getEventRecurrenceDefinitionHistory(eventId);
        if (generation !== generationRef.current || sourceIdentity !== subjectIdentityRef.current) return;
        setHistory(refreshed.data.items);
        setNextBeforeVersion(refreshed.data.next_before_version);
      } catch {
        setLoadFailed(true);
      }
    } catch (error) {
      if (generation !== generationRef.current || sourceIdentity !== subjectIdentityRef.current) return;
      const code = codeOf(error);
      if (code === 'EVENT_RECURRENCE_DEFINITION_PREVIEW_INVALID') {
        setPreview(null);
        setPendingIdempotencyKey(null);
        setIsConfirmOpen(false);
        setWorkflowError('preview_stale');
      } else {
        setWorkflowError(code === 'EVENT_RECURRENCE_DEFINITION_CONFLICT'
          ? 'commit_conflict'
          : 'commit_error');
      }
    } finally {
      if (generation === generationRef.current && sourceIdentity === subjectIdentityRef.current) {
        setIsCommitting(false);
      }
    }
  }

  function dateLabel(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('time_unknown');
    return new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={['top', 'bottom']} style={{ flex: 1 }}>
      <AppTopBar
        title={t('title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/events"
      />
      <ScrollView className="flex-1" contentContainerClassName="gap-4 px-4 pb-8">
        {isLoading ? (
          <View className="min-h-48 items-center justify-center gap-3" accessibilityRole="progressbar">
            <Spinner size="lg" />
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('history_loading')}</Text>
          </View>
        ) : loadFailed || !event || !allowedSections || !recurrenceId ? (
          <Card variant="secondary" testID="event-recurrence-blueprints-unavailable">
            <Card.Body className="gap-3 px-4 py-4">
              <Card.Title>{t('history_error_title')}</Card.Title>
              <Card.Description>{t('history_error_description')}</Card.Description>
              <Button variant="secondary" onPress={() => setRetryToken((value) => value + 1)}>
                <Ionicons name="refresh-outline" size={18} color={primary} />
                <Button.Label>{t('retry')}</Button.Label>
              </Button>
            </Card.Body>
          </Card>
        ) : (
          <>
            <Card variant="secondary">
              <Card.Body className="gap-3 px-4 py-4">
                <Card.Title>{t('title')}</Card.Title>
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>{event.title}</Text>
                <Card.Description>{t('description')}</Card.Description>
                <View className="rounded-xl bg-warning/10 p-3">
                  <Text className="font-semibold" style={{ color: theme.text }}>{t('definition_only_title')}</Text>
                  <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
                    {t('definition_only_description')}
                  </Text>
                </View>
                <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>
                  {t('effective_from_label')}
                </Text>
                <Text selectable className="font-mono text-sm" style={{ color: theme.text }}>{recurrenceId}</Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('effective_from_help')}</Text>
              </Card.Body>
            </Card>

            <Card variant="secondary">
              <Card.Body className="gap-3 px-4 py-4">
                <Card.Title>{t('sections_title')}</Card.Title>
                <Card.Description>{t('sections_description')}</Card.Description>
                {SECTION_KEYS.map((section) => (
                  <ControlField
                    key={section}
                    isSelected={sections[section]}
                    isDisabled={!allowedSections[section]}
                    onSelectedChange={(selected) => changeSection(section, selected)}
                    className="rounded-xl border border-border p-3"
                  >
                    <View className="flex-1 pr-3">
                      <Label>{t(`sections.${section}.label`)}</Label>
                      <Description>{t(`sections.${section}.description`)}</Description>
                      {!allowedSections[section] ? (
                        <Description>{t('section_not_permitted')}</Description>
                      ) : null}
                    </View>
                    <ControlField.Indicator variant="checkbox" />
                  </ControlField>
                ))}
                {selectedSections.length === 0 ? (
                  <Text accessibilityLiveRegion="polite" className="text-sm" style={{ color: theme.error }}>
                    {t('no_sections_description')}
                  </Text>
                ) : null}
                {workflowError ? (
                  <View className="rounded-xl bg-danger/10 p-3" accessibilityRole="alert">
                    <Text className="font-semibold" style={{ color: theme.error }}>
                      {t(`errors.${workflowError}.title`)}
                    </Text>
                    <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
                      {t(`errors.${workflowError}.description`)}
                    </Text>
                  </View>
                ) : null}
                {commitResult ? (
                  <View className="rounded-xl bg-success/10 p-3" accessibilityLiveRegion="polite">
                    <Text className="font-semibold" style={{ color: theme.text }}>
                      {t(commitResult.idempotent_replay ? 'success_replay_title' : 'success_created_title')}
                    </Text>
                    <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
                      {t(
                        commitResult.idempotent_replay
                          ? 'success_replay_description'
                          : 'success_created_description',
                        { version: commitResult.blueprint_version },
                      )}
                    </Text>
                  </View>
                ) : null}
                <Button
                  isDisabled={selectedSections.length === 0 || isPreviewing || isCommitting}
                  onPress={() => void preparePreview()}
                  accessibilityState={{ busy: isPreviewing }}
                >
                  {isPreviewing ? <Spinner size="sm" /> : <Ionicons name="scan-outline" size={18} color="#fff" />}
                  <Button.Label>{isPreviewing ? t('previewing') : t('preview_button')}</Button.Label>
                </Button>
              </Card.Body>
            </Card>

            {preview ? (
              <Card variant="secondary" testID="event-recurrence-blueprint-preview">
                <Card.Body className="gap-3 px-4 py-4">
                  <Card.Title>{t('preview_title')}</Card.Title>
                  <Card.Description>{t('preview_description')}</Card.Description>
                  <SectionChips sections={preview.selected_sections} />
                  <CountList counts={preview.counts} />
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                    {t('preview_expires', { date: dateLabel(preview.preview_expires_at) })}
                  </Text>
                  {preview.conflicts.length > 0 ? (
                    <View className="rounded-xl bg-danger/10 p-3" accessibilityRole="alert">
                      <Text className="font-semibold" style={{ color: theme.error }}>{t('conflicts_title')}</Text>
                      {preview.conflicts.map((conflict, index) => (
                        <Text key={`${conflict.section}-${conflict.code}-${index}`} className="mt-1 text-sm" style={{ color: theme.text }}>
                          {t(`conflicts.${conflict.code}`, {
                            count: conflict.count,
                            section: t(`sections.${conflict.section}.label`),
                          })}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                  <View className="gap-2">
                    <Button
                      isDisabled={!preview.can_commit || previewExpired}
                      onPress={() => {
                        setIsConfirmed(false);
                        setIsConfirmOpen(true);
                      }}
                    >
                      <Button.Label>{t('review_button')}</Button.Label>
                    </Button>
                    <Button variant="secondary" onPress={() => void preparePreview()} isDisabled={isPreviewing}>
                      <Button.Label>{t('refresh_preview')}</Button.Label>
                    </Button>
                  </View>
                </Card.Body>
              </Card>
            ) : null}

            <Card variant="secondary">
              <Card.Body className="gap-3 px-4 py-4">
                <Card.Title>{t('history_title')}</Card.Title>
                <Card.Description>{t('history_description')}</Card.Description>
                {history.length === 0 ? (
                  <View className="rounded-xl border border-dashed border-border p-3">
                    <Text className="font-semibold" style={{ color: theme.text }}>{t('history_empty_title')}</Text>
                    <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>
                      {t('history_empty_description')}
                    </Text>
                  </View>
                ) : history.map((item) => (
                  <View
                    key={item.blueprint_id}
                    className="gap-2 rounded-xl border border-border p-3"
                    testID={`event-recurrence-blueprint-history-${item.blueprint_id}`}
                  >
                    <View className="flex-row items-center justify-between gap-3">
                      <Text className="flex-1 font-semibold" style={{ color: theme.text }}>
                        {t('history_version', { version: item.blueprint_version })}
                      </Text>
                      <Chip color="success" size="sm" variant="soft">
                        <Chip.Label>{t('immutable')}</Chip.Label>
                      </Chip>
                    </View>
                    <Text className="text-xs" style={{ color: theme.textSecondary }}>{dateLabel(item.created_at)}</Text>
                    <Text selectable className="font-mono text-xs" style={{ color: theme.text }}>
                      {item.effective_from_recurrence_id}
                    </Text>
                    <SectionChips sections={item.selected_sections} />
                    <CountList counts={item.counts} compact />
                  </View>
                ))}
                {loadMoreFailed ? (
                  <Text className="text-sm" style={{ color: theme.error }}>{t('load_more_error_description')}</Text>
                ) : null}
                {nextBeforeVersion ? (
                  <Button variant="secondary" isDisabled={isLoadingMore} onPress={() => void loadMore()}>
                    {isLoadingMore ? <Spinner size="sm" /> : null}
                    <Button.Label>{isLoadingMore ? t('history_loading_more') : t('history_load_more')}</Button.Label>
                  </Button>
                ) : null}
              </Card.Body>
            </Card>
          </>
        )}
      </ScrollView>

      <Dialog isOpen={isConfirmOpen} onOpenChange={(open) => {
        if (isCommitting) return;
        setIsConfirmOpen(open);
        if (!open) setIsConfirmed(false);
      }}>
        <Dialog.Portal unstable_accessibilityContainerViewIsModal>
          <Dialog.Overlay className="bg-black/60" isCloseOnPress={!isCommitting} />
          <Dialog.Content isSwipeable={!isCommitting} className="mx-4 gap-4 p-5">
            <Dialog.Close variant="ghost" />
            <Dialog.Title>{t('confirm_title')}</Dialog.Title>
            <Dialog.Description>{t('confirm_scope_description')}</Dialog.Description>
            {sections.staff ? (
              <View className="rounded-xl bg-danger/10 p-3">
                <Text className="font-semibold" style={{ color: theme.error }}>{t('staff_risk_title')}</Text>
                <Text className="mt-1 text-sm" style={{ color: theme.textSecondary }}>{t('staff_risk_description')}</Text>
              </View>
            ) : null}
            {preview ? <CountList counts={preview.counts} /> : null}
            <ControlField
              isSelected={isConfirmed}
              onSelectedChange={setIsConfirmed}
              className="rounded-xl border border-border p-3"
            >
              <View className="flex-1 pr-3">
                <Label>{t('confirm_ack')}</Label>
                <Description>{t('confirm_ack_description')}</Description>
              </View>
              <ControlField.Indicator variant="checkbox" />
            </ControlField>
            <View className="gap-2">
              <Button
                isDisabled={!isConfirmed || previewExpired || isCommitting}
                onPress={() => void commitPreview()}
                accessibilityState={{ busy: isCommitting }}
              >
                {isCommitting ? <Spinner size="sm" /> : null}
                <Button.Label>{isCommitting ? t('committing') : t('commit_button')}</Button.Label>
              </Button>
              <Button variant="secondary" isDisabled={isCommitting} onPress={() => setIsConfirmOpen(false)}>
                <Button.Label>{t('cancel')}</Button.Label>
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
    </SafeAreaView>
  );

  function SectionChips({ sections: values }: { sections: EventRecurrenceDefinitionSections }) {
    return (
      <View className="flex-row flex-wrap gap-2">
        {SECTION_KEYS.filter((section) => values[section]).map((section) => (
          <Chip key={section} size="sm" variant="soft">
            <Chip.Label>{t(`sections.${section}.label`)}</Chip.Label>
          </Chip>
        ))}
      </View>
    );
  }

  function CountList({ counts, compact = false }: { counts: Record<string, number>; compact?: boolean }) {
    const visible = COUNT_KEYS.filter((key) => typeof counts[key] === 'number' && counts[key] > 0);
    if (visible.length === 0) {
      return <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('counts.none')}</Text>;
    }
    return (
      <View className={compact ? 'flex-row flex-wrap gap-2' : 'gap-2'}>
        {visible.map((key) => (
          <View key={key} className="rounded-lg bg-default/10 px-3 py-2">
            <Text className="text-xs" style={{ color: theme.textSecondary }}>{t(`counts.${key}`)}</Text>
            <Text className="font-semibold" style={{ color: theme.text }}>{counts[key]}</Text>
          </View>
        ))}
      </View>
    );
  }
}
