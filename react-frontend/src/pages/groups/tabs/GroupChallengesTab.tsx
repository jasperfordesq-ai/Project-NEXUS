// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { AlertDialog } from '@/components/ui/AlertDialog';
/**
 * Group Challenges Tab
 * Active and completed challenges with progress tracking, countdown timers, * and admin challenge creation.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';

import Trophy from 'lucide-react/icons/trophy';
import Target from 'lucide-react/icons/target';
import Clock from 'lucide-react/icons/clock';
import Plus from 'lucide-react/icons/plus';
import Award from 'lucide-react/icons/award';
import Flame from 'lucide-react/icons/flame';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import CircleX from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { SafeHtml } from '@/components/ui/SafeHtml';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import {
  createGroupChallenge,
  deleteGroupChallenge,
  GROUP_CHALLENGE_LIMITS,
  GROUP_CHALLENGE_METRICS,
  GROUP_CHALLENGE_REWARD_BANDS,
  listGroupChallenges,
  type GroupChallenge,
  type GroupChallengeMetric,
  type GroupChallengeReward,
} from '../api/challenges';
import { GroupApiError } from '../api/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupChallengesTabProps {
  groupId: number;
  isAdmin: boolean;
  isMember?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

type ChallengeFormField = 'title' | 'description' | 'metric' | 'target' | 'reward' | 'endsAt';
type ChallengeFormErrors = Partial<Record<ChallengeFormField, string>>;

/** Colour class based on progress percentage */
function getProgressColor(percent: number): 'success' | 'warning' | 'danger' {
  if (percent > 75) return 'success';
  if (percent >= 25) return 'warning';
  return 'danger';
}

/** Human-readable countdown string */
function getTimeRemaining(endsAt: string, t: TFunction): string {
  const now = Date.now();
  const end = new Date(endsAt).getTime();
  const diff = end - now;
  if (diff <= 0) return t('challenges.time_ended');
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return t('challenges.time_remaining_days_hours', { days, hours });
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return t('challenges.time_remaining_hours_minutes', { hours, minutes });
}

function getMinimumEndDate(): string {
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const year = tomorrow.getFullYear();
  const month = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const day = String(tomorrow.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupChallengesTab({ groupId, isAdmin }: GroupChallengesTabProps) {
  const { t } = useTranslation('groups');
  const { t: tCommon } = useTranslation('common');
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  // ─── State ───
  const [challenges, setChallenges] = useState<GroupChallenge[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [creating, setCreating] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<GroupChallenge | null>(null);
  const [cancellingChallengeId, setCancellingChallengeId] = useState<number | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const loadSequenceRef = useRef(0);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formMetric, setFormMetric] = useState<GroupChallengeMetric>('posts');
  const [formTarget, setFormTarget] = useState('');
  const [formRewardXp, setFormRewardXp] = useState<GroupChallengeReward>(0);
  const [formEndsAt, setFormEndsAt] = useState('');
  const [formErrors, setFormErrors] = useState<ChallengeFormErrors>({});
  const minimumEndDate = getMinimumEndDate();

  // ─── Derived lists ───
  const activeChallenges = useMemo(
    () => challenges.filter((challenge) => challenge.status === 'active'),
    [challenges],
  );
  const historicalChallenges = useMemo(
    () => challenges.filter((challenge) => challenge.status !== 'active'),
    [challenges],
  );

  // ─── Load challenges ───
  const loadChallenges = useCallback(async (signal: AbortSignal) => {
    const requestId = ++loadSequenceRef.current;
    setLoading(true);
    setLoadFailed(false);
    try {
      const items = await listGroupChallenges(groupId, { signal });
      if (signal.aborted || requestId !== loadSequenceRef.current) return;

      // Sort active first (by end date ascending), completed by completed_at desc.
      const sorted = [...items].sort((a, b) => {
        const aCompleted = a.status === 'completed';
        const bCompleted = b.status === 'completed';
        if (aCompleted !== bCompleted) return aCompleted ? 1 : -1;
        if (!aCompleted) {
          return new Date(a.ends_at).getTime() - new Date(b.ends_at).getTime();
        }
        return new Date(b.completed_at ?? b.created_at).getTime() -
          new Date(a.completed_at ?? a.created_at).getTime();
      });
      setChallenges(sorted);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupChallengesTab.load', err);
      if (!signal.aborted && requestId === loadSequenceRef.current) {
        setLoadFailed(true);
        toast.error(t('challenges.load_failed'));
      }
    } finally {
      if (!signal.aborted && requestId === loadSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [groupId, toast, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadChallenges(controller.signal);
    return () => controller.abort();
  }, [loadAttempt, loadChallenges]);

  // ─── Reset form ───
  const resetForm = useCallback(() => {
    setFormTitle('');
    setFormDescription('');
    setFormMetric('posts');
    setFormTarget('');
    setFormRewardXp(0);
    setFormEndsAt('');
    setFormErrors({});
  }, []);

  const clearFormError = useCallback((field: ChallengeFormField) => {
    setFormErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }, []);

  const validateForm = useCallback((): ChallengeFormErrors => {
    const errors: ChallengeFormErrors = {};
    const titleLength = formTitle.trim().length;
    const descriptionLength = formDescription.trim().length;
    const target = Number(formTarget);
    const required = tCommon('enterprise.validation_required');
    const invalidFormat = tCommon('enterprise.validation_format');

    if (titleLength === 0) {
      errors.title = required;
    } else if (
      titleLength < GROUP_CHALLENGE_LIMITS.titleMin
      || titleLength > GROUP_CHALLENGE_LIMITS.titleMax
    ) {
      errors.title = invalidFormat;
    }

    if (
      descriptionLength > 0
      && (
        descriptionLength < GROUP_CHALLENGE_LIMITS.descriptionMin
        || descriptionLength > GROUP_CHALLENGE_LIMITS.descriptionMax
      )
    ) {
      errors.description = invalidFormat;
    }

    if (!formTarget.trim()) {
      errors.target = required;
    } else if (!Number.isSafeInteger(target)) {
      errors.target = tCommon('enterprise.validation_number');
    } else if (target < GROUP_CHALLENGE_LIMITS.targetMin) {
      errors.target = tCommon('enterprise.validation_min', { value: GROUP_CHALLENGE_LIMITS.targetMin });
    } else if (target > GROUP_CHALLENGE_LIMITS.targetMax) {
      errors.target = tCommon('enterprise.validation_max', { value: GROUP_CHALLENGE_LIMITS.targetMax });
    }

    const endsAtTimestamp = Date.parse(formEndsAt);
    if (!formEndsAt) {
      errors.endsAt = required;
    } else if (!Number.isFinite(endsAtTimestamp) || endsAtTimestamp <= Date.now()) {
      errors.endsAt = invalidFormat;
    }

    return errors;
  }, [formDescription, formEndsAt, formTarget, formTitle, tCommon]);

  // ─── Create challenge ───
  const handleCreate = useCallback(async () => {
    const trimmedTitle = formTitle.trim();
    const trimmedDesc = formDescription.trim();
    const targetVal = Number(formTarget);
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setFormErrors({});
    setCreating(true);
    try {
      await createGroupChallenge(groupId, {
        title: trimmedTitle,
        description: trimmedDesc,
        metric: formMetric,
        target_value: targetVal,
        reward_xp: formRewardXp,
        ends_at: formEndsAt,
      });
      toast.success(t('challenges.created'));
      resetForm();
      onClose();
      setLoadAttempt((attempt) => attempt + 1);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupChallengesTab.create', err);
      if (err instanceof GroupApiError) {
        if (err.code === 'VALIDATION_FAILED' && err.fieldErrors) {
          const validationMessage = tCommon(err.messageKey, err.messageParams);
          const fieldMap: Record<string, ChallengeFormField> = {
            title: 'title',
            description: 'description',
            metric: 'metric',
            target_value: 'target',
            reward_xp: 'reward',
            ends_at: 'endsAt',
          };
          const nextErrors: ChallengeFormErrors = {};
          for (const field of Object.keys(err.fieldErrors)) {
            const formField = fieldMap[field];
            if (formField) nextErrors[formField] = validationMessage;
          }
          setFormErrors(nextErrors);
        }
        toast.error(tCommon(err.messageKey, err.messageParams));
      } else {
        toast.error(t('challenges.create_failed'));
      }
    } finally {
      setCreating(false);
    }
  }, [groupId, formTitle, formDescription, formMetric, formTarget, formRewardXp, formEndsAt, toast, onClose, resetForm, t, tCommon, validateForm]);

  const handleCancelChallenge = useCallback(async () => {
    if (!cancelTarget || cancellingChallengeId !== null) return;

    setCancellingChallengeId(cancelTarget.id);
    try {
      const result = await deleteGroupChallenge(groupId, cancelTarget.id);
      setChallenges((current) => current.map((challenge) => (
        challenge.id === result.challenge.id ? result.challenge : challenge
      )));
      setShowCompleted(true);
      setCancelTarget(null);
      toast.success(t('challenges.cancel_success'));
    } catch (err) {
      logError('GroupChallengesTab.cancel', err);
      if (err instanceof GroupApiError && err.code === 'CONFLICT') {
        setCancelTarget(null);
        toast.error(t('challenges.cancel_conflict'));
        setLoadAttempt((attempt) => attempt + 1);
      } else {
        toast.error(t('challenges.cancel_failed'));
      }
    } finally {
      setCancellingChallengeId(null);
    }
  }, [cancelTarget, cancellingChallengeId, groupId, t, toast]);

  // ─── Render challenge card ───
  const renderChallengeCard = (challenge: GroupChallenge) => {
    const percent = Math.round(challenge.progress_percentage);
    const color = getProgressColor(percent);
    const completed = challenge.status === 'completed';
    const ended = challenge.status !== 'active' || new Date(challenge.ends_at).getTime() <= Date.now();
    const statusLabel = completed
      ? t('challenges.completed_chip')
      : challenge.status === 'cancelled'
        ? t('challenges.cancelled_chip')
        : challenge.status === 'expired'
          ? t('challenges.expired_chip')
          : ended
            ? t('challenges.ended_chip')
            : t(`challenges.metric_${challenge.metric}`);

    return (
      <div
        key={challenge.id}
        role="listitem"
        className={`p-4 rounded-lg border transition-colors ${
          completed
            ? 'border-success/30 bg-success/5'
            : 'border-theme-default bg-theme-elevated'
        }`}
      >
        {/* Header row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              {completed ? (
                <Trophy className="w-4 h-4 text-warning flex-shrink-0" aria-hidden="true" />
              ) : (
                <Target className="w-4 h-4 text-accent flex-shrink-0" aria-hidden="true" />
              )}
              <h3 className="font-semibold text-theme-primary truncate">
                {challenge.title}
              </h3>
              <Chip
                size="sm"
                variant="flat"
                className="flex-shrink-0 capitalize"
                color={completed ? 'success' : ended ? 'danger' : 'primary'}
              >
                {statusLabel}
              </Chip>
            </div>
            <SafeHtml content={challenge.description} className="text-sm text-theme-secondary line-clamp-2" as="p" />
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {/* XP reward badge */}
            <div className="flex w-fit flex-shrink-0 items-center gap-1 rounded-lg bg-warning/10 px-2 py-1">
              <Flame className="w-3.5 h-3.5 text-[var(--color-warning)]" aria-hidden="true" />
              <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                {t('challenges.xp_reward', { xp: challenge.reward_xp })}
              </span>
            </div>
            {isAdmin && challenge.status === 'active' && (
              <Button
                variant="danger"
                size="sm"
                className="min-h-11"
                startContent={<CircleX className="h-4 w-4" aria-hidden="true" />}
                aria-label={t('challenges.cancel_aria', { title: challenge.title })}
                isDisabled={cancellingChallengeId !== null}
                isLoading={cancellingChallengeId === challenge.id}
                onPress={() => setCancelTarget(challenge)}
              >
                {t('challenges.cancel_challenge')}
              </Button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-theme-subtle">
              {t('challenges.progress_value', {
                current: challenge.current_value,
                target: challenge.target_value,
                metric: t(`challenges.metric_${challenge.metric}`),
              })}
            </span>
            <span className="text-xs font-medium text-theme-secondary">
              {percent}%
            </span>
          </div>
          <Progress
            aria-label={t('challenges.progress_aria', { percent })}
            value={percent}
            color={color}
            size="sm"
            className="w-full"
          />
        </div>

        {/* Footer: time remaining + creator */}
        <div className="mt-3 flex flex-col gap-2 text-xs text-theme-subtle sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1">
            {completed ? (
              <>
                <CheckCircle2 className="w-3 h-3 text-success" aria-hidden="true" />
                <span>
                  {challenge.completed_at
                    ? t('challenges.completed_on', { date: formatRelativeTime(challenge.completed_at) })
                    : t('challenges.completed_chip')}
                </span>
              </>
            ) : (
              <>
                <Clock className="w-3 h-3" aria-hidden="true" />
                <span>{getTimeRemaining(challenge.ends_at, t)}</span>
              </>
            )}
          </div>
          <span className="break-words sm:text-right">
            {challenge.creator.name && (
              <>
                {t('challenges.created_by', { name: challenge.creator.name })}
                {' · '}
              </>
            )}
            {formatRelativeTime(challenge.created_at)}
          </span>
        </div>
      </div>
    );
  };

  // ─── Render ───
  return (
    <div className="space-y-4">
      {/* Active Challenges */}
      <GlassCard className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <Target className="w-5 h-5" aria-hidden="true" />
            {t('challenges.heading')}
          </h2>
          {isAdmin && (
            <Button
              color="primary"
              size="sm"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={onOpen}
            >
              {t('challenges.create')}
            </Button>
          )}
        </div>

        {loading ? (
          <div role="status" aria-busy="true" aria-label={t('detail.loading')} className="flex justify-center py-8">
            <Spinner size="lg" />
          </div>
        ) : loadFailed ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-danger">{t('challenges.load_failed')}</p>
            <Button variant="flat" onPress={() => setLoadAttempt((attempt) => attempt + 1)}>
              {t('try_again')}
            </Button>
          </div>
        ) : activeChallenges.length === 0 && historicalChallenges.length === 0 ? (
          <EmptyState
            icon={<Trophy className="w-12 h-12" aria-hidden="true" />}
            title={t('challenges.no_challenges_title')}
            description={
              isAdmin
                ? t('challenges.no_challenges_admin_desc')
                : t('challenges.no_challenges_desc')
            }
            action={
              isAdmin
                ? {
                    label: t('challenges.create'),
                    onClick: onOpen,
                  }
                : undefined
            }
          />
        ) : (
          <>
            {/* Active list */}
            {activeChallenges.length > 0 ? (
              <div className="space-y-3" role="list" aria-label={t('challenges.active_list_aria')}>
                {activeChallenges.map(renderChallengeCard)}
              </div>
            ) : (
              <p className="text-sm text-theme-subtle text-center py-4">
                {t('challenges.no_active')}
              </p>
            )}

            {/* Completed section (collapsed by default) */}
            {historicalChallenges.length > 0 && (
              <div className="mt-6">
                <Button
                  type="button"
                  variant="light"
                  size="sm"
                  className="flex items-center gap-2 text-sm font-medium text-theme-secondary hover:text-theme-primary"
                  onPress={() => setShowCompleted(!showCompleted)}
                  aria-expanded={showCompleted}
                  aria-controls="completed-challenges-list"
                >
                  <Award className="w-4 h-4 text-warning" aria-hidden="true" />
                  {t('challenges.history_section')}
                  <Chip size="sm" variant="flat" color="success">
                    {historicalChallenges.length}
                  </Chip>
                </Button>

                {showCompleted && (
                  <div
                    id="completed-challenges-list"
                    className="space-y-3 mt-3"
                    role="list"
                    aria-label={t('challenges.history_list_aria')}
                  >
                    {historicalChallenges.map(renderChallengeCard)}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </GlassCard>

      {/* Create Challenge Modal */}
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            resetForm();
            onClose();
          }
        }}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onModalClose) => (
            <>
              <ModalHeader className="text-theme-primary flex items-center gap-2">
                <Target className="w-5 h-5 text-accent" aria-hidden="true" />
                {t('challenges.create_modal_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('challenges.title_label')}
                  placeholder={t('challenges.title_placeholder')}
                  value={formTitle}
                  onChange={(e) => {
                    setFormTitle(e.target.value);
                    clearFormError('title');
                  }}
                  minLength={GROUP_CHALLENGE_LIMITS.titleMin}
                  maxLength={GROUP_CHALLENGE_LIMITS.titleMax}
                  isRequired
                  isInvalid={Boolean(formErrors.title)}
                  errorMessage={formErrors.title}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                    errorMessage: 'text-danger',
                  }}
                />
                <Textarea
                  label={t('challenges.description_label')}
                  placeholder={t('challenges.description_placeholder')}
                  value={formDescription}
                  onChange={(e) => {
                    setFormDescription(e.target.value);
                    clearFormError('description');
                  }}
                  maxLength={GROUP_CHALLENGE_LIMITS.descriptionMax}
                  minRows={3}
                  isInvalid={Boolean(formErrors.description)}
                  errorMessage={formErrors.description}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                    errorMessage: 'text-danger',
                  }}
                />
                <Select
                  label={t('challenges.metric_label')}
                  selectedKeys={[formMetric]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0] as GroupChallengeMetric;
                    if (GROUP_CHALLENGE_METRICS.includes(selected)) {
                      setFormMetric(selected);
                      clearFormError('metric');
                    }
                  }}
                  isInvalid={Boolean(formErrors.metric)}
                  errorMessage={formErrors.metric}
                  classNames={{
                    trigger: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                    value: 'text-theme-primary',
                    errorMessage: 'text-danger',
                  }}
                >
                  {GROUP_CHALLENGE_METRICS.map((metric) => (
                    <SelectItem key={metric} id={metric}>
                      {t(`challenges.metric_${metric}`)}
                    </SelectItem>
                  ))}
                </Select>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label={t('challenges.target_label')}
                    placeholder={t('challenges.target_placeholder')}
                    type="number"
                    min={GROUP_CHALLENGE_LIMITS.targetMin}
                    max={GROUP_CHALLENGE_LIMITS.targetMax}
                    step={1}
                    value={formTarget}
                    onChange={(e) => {
                      setFormTarget(e.target.value);
                      clearFormError('target');
                    }}
                    isRequired
                    isInvalid={Boolean(formErrors.target)}
                    errorMessage={formErrors.target}
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default',
                      label: 'text-theme-muted',
                      errorMessage: 'text-danger',
                    }}
                  />
                  <Select
                    label={t('challenges.reward_xp_label')}
                    selectedKeys={[String(formRewardXp)]}
                    onSelectionChange={(keys) => {
                      const selected = Number(Array.from(keys)[0]);
                      if (GROUP_CHALLENGE_REWARD_BANDS.includes(selected as GroupChallengeReward)) {
                        setFormRewardXp(selected as GroupChallengeReward);
                        clearFormError('reward');
                      }
                    }}
                    isInvalid={Boolean(formErrors.reward)}
                    errorMessage={formErrors.reward}
                    classNames={{
                      trigger: 'bg-theme-elevated border-theme-default',
                      label: 'text-theme-muted',
                      value: 'text-theme-primary',
                      errorMessage: 'text-danger',
                    }}
                  >
                    {GROUP_CHALLENGE_REWARD_BANDS.map((reward) => (
                      <SelectItem key={reward} id={String(reward)}>
                        {t('challenges.xp_reward', { xp: reward })}
                      </SelectItem>
                    ))}
                  </Select>
                </div>
                <Input
                  label={t('challenges.end_date_label')}
                  type="date"
                  min={minimumEndDate}
                  value={formEndsAt}
                  onChange={(e) => {
                    setFormEndsAt(e.target.value);
                    clearFormError('endsAt');
                  }}
                  isRequired
                  isInvalid={Boolean(formErrors.endsAt)}
                  errorMessage={formErrors.endsAt}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                    errorMessage: 'text-danger',
                  }}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onModalClose}>
                  {t('challenges.cancel')}
                </Button>
                <Button
                  color="primary"
                  isLoading={creating}
                  onPress={handleCreate}
                >
                  {t('challenges.create_submit')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <AlertDialog.Backdrop
        isOpen={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && cancellingChallengeId === null) setCancelTarget(null);
        }}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog className="sm:max-w-[440px]">
            <AlertDialog.CloseTrigger
              isDisabled={cancellingChallengeId !== null}
              aria-label={tCommon('accessibility.close')}
            />
            <AlertDialog.Header>
              <AlertDialog.Icon status="danger" />
              <AlertDialog.Heading>{t('challenges.cancel_title')}</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>{t('challenges.cancel_confirm', { title: cancelTarget?.title ?? '' })}</p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="tertiary"
                isDisabled={cancellingChallengeId !== null}
                onPress={() => setCancelTarget(null)}
              >
                {t('challenges.cancel')}
              </Button>
              <Button
                variant="danger"
                isDisabled={cancelTarget === null || cancellingChallengeId !== null}
                isLoading={cancellingChallengeId !== null}
                startContent={<CircleX className="h-4 w-4" aria-hidden="true" />}
                onPress={() => void handleCancelChallenge()}
              >
                {t('challenges.cancel_challenge')}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </div>
  );
}

export default GroupChallengesTab;
