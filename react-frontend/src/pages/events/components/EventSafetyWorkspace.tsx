// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Archive from 'lucide-react/icons/archive';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import FileCheck2 from 'lucide-react/icons/file-check-2';
import History from 'lucide-react/icons/history';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import Search from 'lucide-react/icons/search';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Undo2 from 'lucide-react/icons/undo-2';
import UserRoundX from 'lucide-react/icons/user-round-x';
import { Alert } from '@/components/ui/Alert';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Checkbox } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/Pagination';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventSafetyApi,
  type EventSafety,
  type EventSafetyRequirementDraft,
  type EventSafetyReviews,
  type ParticipationReviewRequest,
} from '@/lib/event-safety-api';
import { eventsApi, type EventMemberSearchResult } from '@/lib/events-api';
import { getFormattingLocale, resolveAvatarUrl, resolveUserDisplayName } from '@/lib/helpers';
import { logError } from '@/lib/logger';

const REVIEW_PAGE_SIZE = 25;
const REVIEW_DECISIONS = ['deny', 'remove'] as const;
const REVIEW_REASONS = [
  'safeguarding_policy',
  'minimum_age',
  'guardian_consent',
  'code_of_conduct',
  'conduct_violation',
  'safety_review',
  'user_block',
] as const;

type ReviewDecision = ParticipationReviewRequest['decision'];
type ReviewReason = ParticipationReviewRequest['reason_code'];

interface RequirementForm {
  minimumAge: string;
  guardianConsentRequired: boolean;
  minorAgeThreshold: string;
  codeRequired: boolean;
  codeText: string;
  codeTextVersion: string;
}

function mutationKey(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function memberName(member: EventMemberSearchResult): string {
  return member.name?.trim()
    || resolveUserDisplayName(member)
    || `#${member.id}`;
}

function localDateTime(value?: string | null): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function draftFromSafety(safety: EventSafety): RequirementForm {
  const version = safety.requirements?.version;
  return {
    minimumAge: version?.minimum_age === null || version?.minimum_age === undefined
      ? ''
      : String(version.minimum_age),
    guardianConsentRequired: version?.guardian_consent_required ?? false,
    minorAgeThreshold: version?.minor_age_threshold === null || version?.minor_age_threshold === undefined
      ? ''
      : String(version.minor_age_threshold),
    codeRequired: version?.code_of_conduct.required ?? false,
    codeText: version?.code_of_conduct.text ?? '',
    codeTextVersion: version?.code_of_conduct.text_version ?? '',
  };
}

function optionalInteger(value: string): number | null {
  const normalized = value.trim();
  return normalized === '' ? null : Number.parseInt(normalized, 10);
}

export function EventSafetyWorkspace({ eventId }: { eventId: number }) {
  const { t } = useTranslation('event_safety');
  const toast = useToast();
  const confirm = useConfirm();
  const [safety, setSafety] = useState<EventSafety | null>(null);
  const [requirements, setRequirements] = useState<RequirementForm | null>(null);
  const [reviews, setReviews] = useState<EventSafetyReviews | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [archiveConfirmation, setArchiveConfirmation] = useState(false);

  const [memberQuery, setMemberQuery] = useState('');
  const [memberResults, setMemberResults] = useState<EventMemberSearchResult[]>([]);
  const [selectedMember, setSelectedMember] = useState<EventMemberSearchResult | null>(null);
  const [memberSearchState, setMemberSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [decision, setDecision] = useState<ReviewDecision>('deny');
  const [reason, setReason] = useState<ReviewReason>('safety_review');
  const [effectiveFrom, setEffectiveFrom] = useState(localDateTime());
  const [effectiveUntil, setEffectiveUntil] = useState('');
  const [expectedReviewVersion, setExpectedReviewVersion] = useState<number | null>(null);

  const applySafety = useCallback((next: EventSafety) => {
    setSafety(next);
    setRequirements(draftFromSafety(next));
    setArchiveConfirmation(false);
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const safetyResponse = await eventSafetyApi.get(eventId);
      if (!safetyResponse.success || !safetyResponse.data) {
        setLoadError(true);
        return;
      }
      applySafety(safetyResponse.data);

      if (safetyResponse.data.permissions.review_participation) {
        const reviewResponse = await eventSafetyApi.reviews(eventId, reviewPage, REVIEW_PAGE_SIZE);
        if (!reviewResponse.success || !reviewResponse.data) {
          setLoadError(true);
          return;
        }
        setReviews(reviewResponse.data);
      } else {
        setReviews(null);
      }
    } catch (caught) {
      logError('Failed to load Event Safety workspace', caught);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [applySafety, eventId, reviewPage]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedMember || memberQuery.trim().length < 2) {
      setMemberResults([]);
      setMemberSearchState('idle');
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setMemberSearchState('loading');
      void eventsApi.searchMembers(memberQuery, { signal: controller.signal })
        .then((response) => {
          if (controller.signal.aborted) return;
          if (!response.success || !response.data) {
            setMemberResults([]);
            setMemberSearchState('error');
            return;
          }
          setMemberResults(response.data);
          setMemberSearchState('ready');
        })
        .catch((caught: unknown) => {
          if (controller.signal.aborted) return;
          logError('Failed to search Event Safety review subjects', caught);
          setMemberResults([]);
          setMemberSearchState('error');
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [memberQuery, selectedMember]);

  const runSafetyMutation = async (
    action: string,
    request: () => Promise<{ success: boolean; data?: EventSafety }>,
  ) => {
    setPendingAction(action);
    try {
      const response = await request();
      if (!response.success || !response.data) {
        toast.error(t('safety.organizer.action_error'));
        return;
      }
      applySafety(response.data);
      toast.success(t(`safety.organizer.success.${action}`));
    } catch (caught) {
      logError('Event Safety mutation failed', { action, caught });
      toast.error(t('safety.organizer.action_error'));
    } finally {
      setPendingAction(null);
    }
  };

  const saveRequirements = async () => {
    if (!requirements || !safety) return;
    const draft: EventSafetyRequirementDraft = {
      minimum_age: optionalInteger(requirements.minimumAge),
      guardian_consent_required: requirements.guardianConsentRequired,
      minor_age_threshold: requirements.guardianConsentRequired
        ? optionalInteger(requirements.minorAgeThreshold)
        : null,
      code_of_conduct_required: requirements.codeRequired,
      code_of_conduct_text: requirements.codeRequired ? requirements.codeText.trim() : null,
      code_of_conduct_text_version: requirements.codeRequired
        ? requirements.codeTextVersion.trim()
        : null,
    };
    await runSafetyMutation('saved', () => eventSafetyApi.saveDraft(
      eventId,
      draft,
      safety.requirements?.revision ?? null,
      mutationKey('event-safety-requirements-save'),
    ));
  };

  const publishRequirements = async () => {
    const current = safety?.requirements;
    if (!current) return;
    await runSafetyMutation('published', () => eventSafetyApi.publish(
      eventId,
      current.revision,
      current.current_version,
      mutationKey('event-safety-requirements-publish'),
    ));
  };

  const archiveRequirements = async () => {
    const current = safety?.requirements;
    if (!current || !archiveConfirmation) return;
    await runSafetyMutation('archived', () => eventSafetyApi.archive(
      eventId,
      current.revision,
      current.current_version,
      mutationKey('event-safety-requirements-archive'),
    ));
  };

  const clearReviewForm = () => {
    setSelectedMember(null);
    setMemberQuery('');
    setDecision('deny');
    setReason('safety_review');
    setEffectiveFrom(localDateTime());
    setEffectiveUntil('');
    setExpectedReviewVersion(null);
  };

  const recordReview = async () => {
    if (!selectedMember || !effectiveFrom) return;
    const from = new Date(effectiveFrom);
    const until = effectiveUntil ? new Date(effectiveUntil) : null;
    if (Number.isNaN(from.getTime()) || (until && Number.isNaN(until.getTime()))) return;

    setPendingAction('review');
    try {
      const response = await eventSafetyApi.recordReview(eventId, {
        user_id: selectedMember.id,
        decision,
        reason_code: reason,
        effective_from: from.toISOString(),
        effective_until: until?.toISOString() ?? null,
        expected_version: expectedReviewVersion,
      }, mutationKey('event-safety-review'));
      if (!response.success || !response.data) {
        toast.error(t('safety.reviews.action_error'));
        return;
      }
      setReviews(response.data);
      setReviewPage(response.data.page);
      clearReviewForm();
      toast.success(t('safety.reviews.saved'));
    } catch (caught) {
      logError('Failed to record Event Safety review', caught);
      toast.error(t('safety.reviews.action_error'));
    } finally {
      setPendingAction(null);
    }
  };

  const editReview = (item: EventSafetyReviews['items'][number]) => {
    setSelectedMember({
      id: item.member.id,
      name: item.member.display_name,
      avatar_url: item.member.avatar_url,
    });
    setMemberQuery(item.member.display_name);
    setDecision(item.denial.decision);
    setReason(item.denial.reason_code);
    setEffectiveFrom(localDateTime(item.denial.effective_from));
    setEffectiveUntil(localDateTime(item.denial.effective_until));
    setExpectedReviewVersion(item.denial.decision_version);
  };

  const withdrawReview = async (denialId: number, version: number, displayName: string) => {
    const accepted = await confirm({
      title: t('safety.confirmations.withdraw_review_title'),
      body: t('safety.confirmations.withdraw_review_body', { name: displayName }),
      confirmLabel: t('safety.actions.withdraw_review'),
      cancelLabel: t('safety.actions.cancel'),
      status: 'danger',
    });
    if (!accepted) return;
    setPendingAction(`withdraw-${denialId}`);
    try {
      const response = await eventSafetyApi.withdrawReview(
        eventId,
        denialId,
        version,
        mutationKey('event-safety-review-withdraw'),
      );
      if (!response.success || !response.data) {
        toast.error(t('safety.reviews.action_error'));
        return;
      }
      setReviews(response.data);
      toast.success(t('safety.reviews.withdrawn'));
    } catch (caught) {
      logError('Failed to withdraw Event Safety review', caught);
      toast.error(t('safety.reviews.action_error'));
    } finally {
      setPendingAction(null);
    }
  };

  const totalReviewPages = useMemo(() => reviews
    ? Math.max(1, Math.ceil(reviews.total / reviews.per_page))
    : 1, [reviews]);

  if (isLoading && !safety) {
    return (
      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="flex min-h-48 items-center justify-center p-6">
          <Spinner label={t('safety.organizer.loading')} />
        </CardBody>
      </Card>
    );
  }

  if (loadError || !safety || !requirements) {
    return (
      <Card className="border border-danger/30 bg-theme-surface">
        <CardBody className="space-y-4 p-5">
          <Alert
            color="danger"
            title={t('safety.organizer.load_error_title')}
            description={t('safety.organizer.load_error_description')}
          />
          <Button
            variant="flat"
            startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onPress={() => void load()}
          >
            {t('safety.actions.retry')}
          </Button>
        </CardBody>
      </Card>
    );
  }

  const current = safety.requirements;
  const formInvalid = (requirements.minimumAge !== '' && Number.isNaN(optionalInteger(requirements.minimumAge)))
    || (requirements.guardianConsentRequired && (!requirements.minorAgeThreshold
      || Number.isNaN(optionalInteger(requirements.minorAgeThreshold))))
    || (requirements.codeRequired && (!requirements.codeText.trim() || !requirements.codeTextVersion.trim()));

  return (
    <div className="space-y-5" data-testid="event-safety-workspace">
      <Card className="border border-theme-default bg-theme-surface">
        <CardBody className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
                <ShieldCheck className="h-5 w-5 text-accent" aria-hidden="true" />
                {t('safety.organizer.title')}
              </h2>
              <p className="mt-1 max-w-3xl text-sm text-theme-muted">{t('safety.organizer.description')}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Chip variant="flat">{t(`safety.rollout.${safety.rollout.mode}`)}</Chip>
              {current && <Chip variant="flat">{t(`safety.requirements.status.${current.status}`)}</Chip>}
            </div>
          </div>

          {!safety.rollout.configuration_valid && (
            <Alert color="danger" title={t('safety.organizer.configuration_invalid')} />
          )}
          {safety.rollout.mode === 'shadow' && (
            <Alert color="warning" title={t('safety.organizer.shadow_title')} description={t('safety.organizer.shadow_description')} />
          )}

          {safety.permissions.manage_requirements ? (
            <form
              className="space-y-5 border-t border-theme-default pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                void saveRequirements();
              }}
            >
              <div>
                <h3 className="text-lg font-semibold text-theme-primary">{t('safety.requirements.title')}</h3>
                <p className="mt-1 text-sm text-theme-muted">{t('safety.requirements.description')}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  type="number"
                  min={0}
                  max={150}
                  label={t('safety.requirements.minimum_age')}
                  description={t('safety.requirements.minimum_age_hint')}
                  value={requirements.minimumAge}
                  onValueChange={(value) => setRequirements((state) => state && ({ ...state, minimumAge: value }))}
                />
                <div className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                  <Checkbox
                    isSelected={requirements.guardianConsentRequired}
                    onValueChange={(value) => setRequirements((state) => state && ({ ...state, guardianConsentRequired: value }))}
                  >
                    {t('safety.requirements.guardian_required')}
                  </Checkbox>
                  <p className="mt-2 text-xs text-theme-muted">{t('safety.requirements.guardian_required_hint')}</p>
                </div>
                {requirements.guardianConsentRequired && (
                  <Input
                    type="number"
                    min={1}
                    max={150}
                    isRequired
                    label={t('safety.requirements.minor_threshold')}
                    description={t('safety.requirements.minor_threshold_hint')}
                    value={requirements.minorAgeThreshold}
                    onValueChange={(value) => setRequirements((state) => state && ({ ...state, minorAgeThreshold: value }))}
                  />
                )}
                <div className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                  <Checkbox
                    isSelected={requirements.codeRequired}
                    onValueChange={(value) => setRequirements((state) => state && ({ ...state, codeRequired: value }))}
                  >
                    {t('safety.requirements.code_required')}
                  </Checkbox>
                  <p className="mt-2 text-xs text-theme-muted">{t('safety.requirements.code_required_hint')}</p>
                </div>
              </div>

              {requirements.codeRequired && (
                <div className="grid gap-4">
                  <Input
                    isRequired
                    maxLength={191}
                    label={t('safety.requirements.code_version')}
                    description={t('safety.requirements.code_version_hint')}
                    value={requirements.codeTextVersion}
                    onValueChange={(value) => setRequirements((state) => state && ({ ...state, codeTextVersion: value }))}
                  />
                  <Textarea
                    isRequired
                    minRows={8}
                    maxRows={20}
                    label={t('safety.requirements.code_text')}
                    description={t('safety.requirements.code_text_hint')}
                    value={requirements.codeText}
                    onValueChange={(value) => setRequirements((state) => state && ({ ...state, codeText: value }))}
                  />
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  color="primary"
                  isDisabled={formInvalid || pendingAction !== null}
                  isLoading={pendingAction === 'saved'}
                  startContent={<Save className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('safety.actions.save_draft')}
                </Button>
                {current?.status === 'draft' && (
                  <Button
                    color="success"
                    variant="flat"
                    isDisabled={pendingAction !== null}
                    isLoading={pendingAction === 'published'}
                    startContent={<FileCheck2 className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => void publishRequirements()}
                  >
                    {t('safety.actions.publish')}
                  </Button>
                )}
                {current && current.status !== 'archived' && (
                  <Button
                    color="danger"
                    variant="flat"
                    isDisabled={pendingAction !== null}
                    startContent={<Archive className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => setArchiveConfirmation(true)}
                  >
                    {t('safety.actions.archive')}
                  </Button>
                )}
              </div>

              {archiveConfirmation && current?.status !== 'archived' && (
                <Alert
                  color="danger"
                  title={t('safety.requirements.archive_title')}
                  description={t('safety.requirements.archive_description')}
                  endContent={(
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="flat" onPress={() => setArchiveConfirmation(false)}>
                        {t('safety.actions.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        color="danger"
                        isLoading={pendingAction === 'archived'}
                        onPress={() => void archiveRequirements()}
                      >
                        {t('safety.actions.confirm_archive')}
                      </Button>
                    </div>
                  )}
                />
              )}
            </form>
          ) : (
            <Alert color="warning" title={t('safety.organizer.read_only')} />
          )}
        </CardBody>
      </Card>

      {safety.permissions.review_participation && (
        <Card className="border border-theme-default bg-theme-surface">
          <CardBody className="space-y-5 p-5 sm:p-6">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-theme-primary">
                <UserRoundX className="h-5 w-5 text-accent" aria-hidden="true" />
                {t('safety.reviews.title')}
              </h2>
              <p className="mt-1 text-sm text-theme-muted">{t('safety.reviews.description')}</p>
            </div>

            <form
              className="space-y-4 rounded-xl border border-theme-default bg-theme-elevated p-4"
              onSubmit={(event) => {
                event.preventDefault();
                void recordReview();
              }}
            >
              <h3 className="font-semibold text-theme-primary">
                {expectedReviewVersion === null ? t('safety.reviews.new_title') : t('safety.reviews.edit_title')}
              </h3>
              {selectedMember ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-theme-default bg-theme-surface p-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar src={resolveAvatarUrl(selectedMember.avatar_url ?? selectedMember.avatar)} name={memberName(selectedMember)} size="sm" />
                    <span className="truncate font-medium text-theme-primary">{memberName(selectedMember)}</span>
                  </div>
                  <Button size="sm" variant="light" onPress={() => { setSelectedMember(null); setMemberQuery(''); }}>
                    {t('safety.actions.change_member')}
                  </Button>
                </div>
              ) : (
                <div className="relative">
                  <Input
                    label={t('safety.reviews.member_label')}
                    description={t('safety.reviews.member_hint')}
                    value={memberQuery}
                    startContent={<Search className="h-4 w-4 text-theme-muted" aria-hidden="true" />}
                    onValueChange={setMemberQuery}
                  />
                  {memberSearchState === 'loading' && <Spinner size="sm" className="mt-2" />}
                  {memberSearchState === 'error' && <p className="mt-2 text-sm text-danger">{t('safety.reviews.member_search_error')}</p>}
                  {memberResults.length > 0 && (
                    <div className="mt-2 divide-y divide-theme-default overflow-hidden rounded-xl border border-theme-default bg-theme-surface">
                      {memberResults.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          className="flex w-full items-center gap-3 p-3 text-left hover:bg-theme-hover focus-visible:outline-2 focus-visible:outline-accent"
                          onClick={() => { setSelectedMember(member); setMemberQuery(memberName(member)); }}
                        >
                          <Avatar src={resolveAvatarUrl(member.avatar_url ?? member.avatar)} name={memberName(member)} size="sm" />
                          <span className="font-medium text-theme-primary">{memberName(member)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label={t('safety.reviews.decision_label')}
                  selectedKeys={new Set([decision])}
                  disallowEmptySelection
                  onSelectionChange={(keys) => {
                    const value = String(Array.from(keys as Iterable<string | number>)[0] ?? '');
                    if (REVIEW_DECISIONS.includes(value as ReviewDecision)) setDecision(value as ReviewDecision);
                  }}
                >
                  {REVIEW_DECISIONS.map((value) => <SelectItem key={value} id={value}>{t(`safety.decisions.${value}`)}</SelectItem>)}
                </Select>
                <Select
                  label={t('safety.reviews.reason_label')}
                  selectedKeys={new Set([reason])}
                  disallowEmptySelection
                  onSelectionChange={(keys) => {
                    const value = String(Array.from(keys as Iterable<string | number>)[0] ?? '');
                    if (REVIEW_REASONS.includes(value as ReviewReason)) setReason(value as ReviewReason);
                  }}
                >
                  {REVIEW_REASONS.map((value) => <SelectItem key={value} id={value}>{t(`safety.reasons.${value}`)}</SelectItem>)}
                </Select>
                <Input
                  type="datetime-local"
                  isRequired
                  label={t('safety.reviews.effective_from')}
                  value={effectiveFrom}
                  onValueChange={setEffectiveFrom}
                />
                <Input
                  type="datetime-local"
                  label={t('safety.reviews.effective_until')}
                  description={t('safety.reviews.effective_until_hint')}
                  value={effectiveUntil}
                  onValueChange={setEffectiveUntil}
                />
              </div>
              <p className="text-xs text-theme-muted">{t('safety.reviews.no_notes_notice')}</p>
              <div className="flex flex-wrap gap-3">
                <Button
                  type="submit"
                  color="primary"
                  isDisabled={!selectedMember || !effectiveFrom || pendingAction !== null}
                  isLoading={pendingAction === 'review'}
                  startContent={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                >
                  {t('safety.actions.save_review')}
                </Button>
                {expectedReviewVersion !== null && (
                  <Button variant="flat" onPress={clearReviewForm}>{t('safety.actions.cancel_edit')}</Button>
                )}
              </div>
            </form>

            <section aria-labelledby={`event-safety-${eventId}-review-history`} className="space-y-3 border-t border-theme-default pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 id={`event-safety-${eventId}-review-history`} className="flex items-center gap-2 font-semibold text-theme-primary">
                  <History className="h-4 w-4" aria-hidden="true" />
                  {t('safety.reviews.history_title')}
                </h3>
                <span className="text-sm text-theme-muted">{t('safety.reviews.total', { count: reviews?.total ?? 0 })}</span>
              </div>

              {!reviews || reviews.items.length === 0 ? (
                <p className="rounded-xl border border-theme-default bg-theme-elevated p-4 text-sm text-theme-muted">
                  {t('safety.reviews.empty')}
                </p>
              ) : reviews.items.map((item) => (
                <article key={item.denial.id} className="rounded-xl border border-theme-default bg-theme-elevated p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar src={resolveAvatarUrl(item.member.avatar_url)} name={item.member.display_name} size="sm" />
                      <div className="min-w-0">
                        <h4 className="truncate font-semibold text-theme-primary">{item.member.display_name}</h4>
                        <p className="text-sm text-theme-muted">
                          {t(`safety.decisions.${item.denial.decision}`)} · {t(`safety.reasons.${item.denial.reason_code}`)}
                        </p>
                      </div>
                    </div>
                    <Chip color={item.denial.status === 'active' ? 'danger' : 'default'} size="sm" variant="flat">
                      {t(`safety.review_status.${item.denial.status}`)}
                    </Chip>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-theme-muted">{t('safety.reviews.reviewed_by')}</dt><dd className="text-theme-primary">{item.reviewer.display_name}</dd></div>
                    <div><dt className="text-theme-muted">{t('safety.reviews.version')}</dt><dd className="text-theme-primary">{item.denial.decision_version}</dd></div>
                    <div><dt className="text-theme-muted">{t('safety.reviews.effective_from')}</dt><dd className="text-theme-primary">{new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.denial.effective_from))}</dd></div>
                    {item.denial.effective_until && <div><dt className="text-theme-muted">{t('safety.reviews.effective_until')}</dt><dd className="text-theme-primary">{new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.denial.effective_until))}</dd></div>}
                  </dl>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer font-medium text-accent">{t('safety.reviews.audit_history', { count: item.history.length })}</summary>
                    <ol className="mt-2 space-y-2 border-l border-theme-default pl-4 text-theme-muted">
                      {item.history.map((history) => (
                        <li key={`${item.denial.id}-${history.decision_version}-${history.action}`}>
                          {t(`safety.review_actions.${history.action}`)} · {t(`safety.reasons.${history.reason_code}`)} · {history.reviewer.display_name}
                        </li>
                      ))}
                    </ol>
                  </details>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="flat" onPress={() => editReview(item)}>{t('safety.actions.edit_review')}</Button>
                    {item.denial.status === 'active' && (
                      <Button
                        size="sm"
                        color="danger"
                        variant="flat"
                        isDisabled={pendingAction !== null}
                        isLoading={pendingAction === `withdraw-${item.denial.id}`}
                        startContent={<Undo2 className="h-4 w-4" aria-hidden="true" />}
                        onPress={() => void withdrawReview(
                          item.denial.id,
                          item.denial.decision_version,
                          item.member.display_name,
                        )}
                      >
                        {t('safety.actions.withdraw_review')}
                      </Button>
                    )}
                  </div>
                </article>
              ))}

              {totalReviewPages > 1 && (
                <Pagination
                  page={reviewPage}
                  total={totalReviewPages}
                  onChange={setReviewPage}
                  showControls
                  aria-label={t('safety.reviews.pagination')}
                />
              )}
            </section>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
