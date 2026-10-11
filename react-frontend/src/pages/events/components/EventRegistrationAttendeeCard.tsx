// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import MailCheck from 'lucide-react/icons/mail-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import UserPlus from 'lucide-react/icons/user-plus';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventRegistrationApi,
  type AttendeeRegistrationState,
  type RegistrationQuestion,
  type RegistrationSubmission,
} from '@/lib/event-registration-api';
import {
  type RegistrationAnswerValidationError,
  validateRegistrationAnswers,
  visibleRegistrationAnswers,
  visibleRegistrationQuestions,
} from '@/lib/event-registration-form-rules';
import { explainedApiError } from '@/lib/explained-api-error';
import { logError } from '@/lib/logger';

interface EventRegistrationAttendeeCardProps {
  eventId: number;
}

function correlation(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function EventRegistrationAttendeeCard({ eventId }: EventRegistrationAttendeeCardProps) {
  const { t, i18n } = useTranslation('event_registration');
  const toast = useToast();
  const confirm = useConfirm();
  const [state, setState] = useState<AttendeeRegistrationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, RegistrationAnswerValidationError>>({});
  const [submissionOverride, setSubmissionOverride] = useState<RegistrationSubmission | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestConsent, setGuestConsent] = useState(false);
  const [guestNotificationConsent, setGuestNotificationConsent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await eventRegistrationApi.attendeeState(eventId);
      if (!response.success || !response.data) throw new Error(response.message);
      setState(response.data);
      setValidationErrors({});
      setSubmissionOverride(null);
      setLoadFailed(false);
    } catch (error) {
      logError('Failed to load attendee event registration state', error);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeRegistration = useMemo(() => state?.registrations.find((registration) => (
    ['invited', 'pending', 'confirmed'].includes(registration.registration_state)
  )) ?? null, [state?.registrations]);
  const serverSubmission = useMemo(() => {
    if (!state?.form || !activeRegistration) return null;
    return state.submissions.find((submission) => (
      submission.registration_id === activeRegistration.id
      && submission.form_version_id === state.form?.id
      && submission.effective_slot === 1
    )) ?? null;
  }, [activeRegistration, state?.form, state?.submissions]);
  const submission = submissionOverride ?? serverSubmission;
  // Required answers bind at check-in: the server refuses to check in a member
  // whose registration has no submitted answers while the published form has
  // required questions. Say so before the member arrives at the door.
  const requiredAnswersOutstanding = useMemo(() => {
    if (!state?.form || !activeRegistration) return false;
    if (!state.form.questions.some((question) => question.is_required)) return false;
    return !state.submissions.some((candidate) => (
      candidate.registration_id === activeRegistration.id
      && (candidate.status === 'submitted' || candidate.status === 'anonymised')
    ));
  }, [activeRegistration, state?.form, state?.submissions]);
  const draftSubmissionId = submission?.status === 'draft' ? submission.id : null;
  const visibleQuestions = useMemo(
    () => state?.form ? visibleRegistrationQuestions(state.form.questions, answers) : [],
    [answers, state?.form],
  );

  useEffect(() => {
    if (draftSubmissionId === null) return undefined;
    let active = true;
    const readCorrelation = correlation('resume-registration-draft');
    void eventRegistrationApi.reviewAnswers(eventId, draftSubmissionId, {
      purpose: 'resume_own_registration_draft',
      correlation_id: readCorrelation,
      include_sensitive: true,
    }).then((response) => {
      if (!active) return;
      if (!response.success || !response.data) throw new Error(response.message);
      setAnswers(Object.fromEntries(Object.entries(response.data.answers).map(([key, answer]) => [
        key,
        answer.value,
      ])));
    }).catch((error) => {
      logError('Failed to reload own event registration answers', error);
      if (active) toast.error(t('messages.review_error'));
    });
    return () => {
      active = false;
    };
  }, [draftSubmissionId, eventId, t, toast]);

  const updateAnswer = useCallback((question: RegistrationQuestion, value: unknown) => {
    setAnswers((current) => ({ ...current, [question.stable_key]: value }));
    setValidationErrors((current) => {
      if (!current[question.stable_key]) return current;
      const next = { ...current };
      delete next[question.stable_key];
      return next;
    });
  }, []);

  const validationMessage = useCallback((error: RegistrationAnswerValidationError | undefined): string | undefined => {
    if (!error) return undefined;
    return t(`answers.validation.${error.code}`, {
      count: error.limit,
      limit: error.limit,
    });
  }, [t]);

  const acceptInvitation = useCallback(async (invitationId: number) => {
    setPendingAction(`invitation-${invitationId}`);
    let explained: string | null = null;
    try {
      const response = await eventRegistrationApi.acceptMemberInvitation(eventId, invitationId);
      if (!response.success) {
        explained = explainedApiError(response);
        throw new Error(response.message);
      }
      toast.success(t('messages.invitation_accepted'));
      await load();
    } catch (error) {
      logError('Failed to accept event invitation', error);
      toast.error(explained ?? t('messages.invitation_accept_error'));
    } finally {
      setPendingAction(null);
    }
  }, [eventId, load, t, toast]);

  const saveAnswers = useCallback(async (submitAfterSave: boolean) => {
    if (!state?.form || !activeRegistration) return;
    const nextErrors = validateRegistrationAnswers(state.form.questions, answers, submitAfterSave);
    setValidationErrors(nextErrors);
    const firstInvalidKey = Object.keys(nextErrors)[0];
    if (firstInvalidKey) {
      toast.error(t('accessible.validation_error'));
      requestAnimationFrame(() => {
        const group = document.getElementById(`registration-question-${firstInvalidKey}`);
        group?.querySelector<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])')?.focus();
      });
      return;
    }
    setPendingAction(submitAfterSave ? 'submit' : 'save');
    try {
      const visibleAnswers = visibleRegistrationAnswers(state.form.questions, answers);
      const saved = await eventRegistrationApi.saveSubmission(eventId, {
        registration_id: activeRegistration.id,
        form_version_id: state.form.id,
        expected_revision: submission?.status === 'draft' ? submission.revision : null,
        answers: visibleAnswers,
      });
      if (!saved.success || !saved.data) throw new Error(saved.message);
      setSubmissionOverride(saved.data.value);
      if (!submitAfterSave) {
        toast.success(t('messages.draft_saved'));
        return;
      }
      const submitted = await eventRegistrationApi.submit(
        eventId,
        saved.data.value.id,
        saved.data.value.revision,
      );
      if (!submitted.success || !submitted.data) throw new Error(submitted.message);
      setSubmissionOverride(submitted.data.value);
      toast.success(t('messages.answers_submitted'));
      await load();
    } catch (error) {
      logError('Failed to save attendee event registration answers', error);
      toast.error(t('messages.form_save_error'));
    } finally {
      setPendingAction(null);
    }
  }, [activeRegistration, answers, eventId, load, state?.form, submission, t, toast]);

  const amendAnswers = useCallback(async () => {
    if (!submission || submission.status !== 'submitted') return;
    setPendingAction('amend');
    try {
      const response = await eventRegistrationApi.amend(eventId, submission.id, submission.revision);
      if (!response.success || !response.data) throw new Error(response.message);
      setSubmissionOverride(response.data.submission);
      setAnswers({});
      toast.success(t('messages.amendment_started'));
    } catch (error) {
      logError('Failed to create event registration amendment', error);
      toast.error(t('messages.amendment_error'));
    } finally {
      setPendingAction(null);
    }
  }, [eventId, submission, t, toast]);

  const addGuest = useCallback(async () => {
    if (!activeRegistration || !guestName.trim() || !guestConsent) return;
    if (guestNotificationConsent && !guestEmail.trim()) return;
    setPendingAction('guest-add');
    try {
      const response = await eventRegistrationApi.captureGuest(eventId, activeRegistration.id, {
        expected_registration_version: activeRegistration.registration_version,
        display_name: guestName.trim(),
        email: guestEmail.trim() || undefined,
        phone: guestPhone.trim() || undefined,
        preferred_locale: i18n.resolvedLanguage ?? i18n.language ?? 'en',
        consent_accepted: guestConsent,
        consent_text: t('accessible.privacy_consent_text'),
        consent_text_version: '2026-07-12',
        notification_consent: guestNotificationConsent,
        notification_consent_text: guestNotificationConsent
          ? t('accessible.notification_consent_text')
          : undefined,
        notification_consent_version: guestNotificationConsent ? '2026-07-12' : undefined,
      });
      if (!response.success) throw new Error(response.message);
      setGuestName('');
      setGuestEmail('');
      setGuestPhone('');
      setGuestConsent(false);
      setGuestNotificationConsent(false);
      toast.success(t('messages.guest_added'));
      await load();
    } catch (error) {
      logError('Failed to add event registration guest', error);
      toast.error(t('messages.guest_add_error'));
    } finally {
      setPendingAction(null);
    }
  }, [
    activeRegistration,
    eventId,
    guestConsent,
    guestEmail,
    guestName,
    guestNotificationConsent,
    guestPhone,
    i18n.language,
    i18n.resolvedLanguage,
    load,
    t,
    toast,
  ]);

  const cancelGuest = useCallback(async (guestId: number, revision: number, displayName: string) => {
    const accepted = await confirm({
      title: t('guests.cancel_confirm_title'),
      body: t('guests.cancel_confirm_body', { name: displayName }),
      confirmLabel: t('guests.cancel'),
      cancelLabel: t('guests.keep'),
      status: 'danger',
    });
    if (!accepted) return;
    setPendingAction(`guest-${guestId}`);
    try {
      const response = await eventRegistrationApi.cancelGuest(
        eventId,
        guestId,
        revision,
        t('guests.cancel_reason_default'),
      );
      if (!response.success) throw new Error(response.message);
      toast.success(t('messages.guest_cancelled'));
      await load();
    } catch (error) {
      logError('Failed to cancel event registration guest', error);
      toast.error(t('messages.guest_cancel_error'));
    } finally {
      setPendingAction(null);
    }
  }, [confirm, eventId, load, t, toast]);

  function renderQuestion(question: RegistrationQuestion) {
    const value = answers[question.stable_key];
    const choices = question.choice_options ?? [];
    const key = question.id ?? question.stable_key;
    const error = validationMessage(validationErrors[question.stable_key]);
    const minLength = Number(question.validation_rules?.min_length ?? 0) || undefined;
    const configuredMaxLength = Number(question.validation_rules?.max_length ?? 0) || undefined;
    const questionId = `registration-question-${question.stable_key}`;

    if (question.question_type === 'single_choice') {
      return (
        <RadioGroup
          key={key}
          id={questionId}
          label={question.prompt}
          description={question.help_text}
          errorMessage={error}
          isInvalid={Boolean(error)}
          isRequired={question.is_required}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => updateAnswer(question, next)}
        >
          {choices.map((choice) => <Radio key={choice} value={choice}>{choice}</Radio>)}
        </RadioGroup>
      );
    }
    if (question.question_type === 'multiple_choice') {
      const selected = Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string')
        : [];
      return (
        <CheckboxGroup
          key={key}
          id={questionId}
          label={question.prompt}
          description={question.help_text}
          errorMessage={error}
          isInvalid={Boolean(error)}
          isRequired={question.is_required}
          value={selected}
          onValueChange={(next) => updateAnswer(question, next)}
        >
          {choices.map((choice) => <Checkbox key={choice} value={choice}>{choice}</Checkbox>)}
        </CheckboxGroup>
      );
    }
    if (question.question_type === 'consent' || question.question_type === 'waiver') {
      return (
        <div key={key} id={questionId} className="space-y-1">
          <Checkbox
            aria-describedby={error ? `${questionId}-error` : undefined}
            isInvalid={Boolean(error)}
            isRequired={question.is_required}
            isSelected={value === true}
            description={question.help_text}
            onValueChange={(next) => updateAnswer(question, next)}
          >
            {question.displayed_text || question.prompt}
          </Checkbox>
          {error ? <p id={`${questionId}-error`} className="text-sm text-danger" role="alert">{error}</p> : null}
        </div>
      );
    }
    if (question.question_type === 'long_text'
      || question.question_type === 'dietary'
      || question.question_type === 'accessibility') {
      return (
        <Textarea
          key={key}
          id={questionId}
          label={question.prompt}
          description={question.help_text}
          errorMessage={error}
          isInvalid={Boolean(error)}
          isRequired={question.is_required}
          minLength={minLength}
          maxLength={Math.min(configuredMaxLength ?? 10000, 10000)}
          value={typeof value === 'string' ? value : ''}
          onValueChange={(next) => updateAnswer(question, next)}
        />
      );
    }
    return (
      <Input
        key={key}
        id={questionId}
        label={question.prompt}
        description={question.help_text}
        errorMessage={error}
        isInvalid={Boolean(error)}
        isRequired={question.is_required}
        minLength={minLength}
        maxLength={Math.min(configuredMaxLength ?? 500, 500)}
        value={typeof value === 'string' ? value : ''}
        onValueChange={(next) => updateAnswer(question, next)}
      />
    );
  }

  if (loading) {
    return (
      <Card className="border border-theme-default">
        <CardBody className="flex min-h-28 items-center justify-center gap-3">
          <Spinner size="sm" />
          <span className="text-sm text-theme-muted">{t('common.loading')}</span>
        </CardBody>
      </Card>
    );
  }
  if (loadFailed) {
    return (
      <Alert color="danger" title={t('load_error.title')} description={t('load_error.description')}>
        <Button size="sm" variant="secondary" onPress={() => void load()}>{t('common.retry')}</Button>
      </Alert>
    );
  }
  if (!state || (!state.form && state.invitations.length === 0 && state.guests.length === 0)) return null;

  return (
    <Card className="border border-theme-default">
      <CardHeader className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="rounded-xl bg-accent-soft p-2 text-accent">
            <ClipboardList className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-theme-primary">{t('accessible.attendee_heading')}</h2>
            <p className="text-sm text-theme-muted">{t('privacy.description')}</p>
          </div>
        </div>
        <Button size="sm" variant="secondary" onPress={() => void load()}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          {t('common.refresh')}
        </Button>
      </CardHeader>
      <CardBody className="space-y-6">
        {state.invitations.filter((invitation) => invitation.status === 'issued').map((invitation) => (
          <div key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-theme-default p-4">
            <div className="flex items-center gap-3">
              <MailCheck className="h-5 w-5 text-accent" aria-hidden="true" />
              <div>
                <p className="font-medium text-theme-primary">{t('accessible.your_invitations')}</p>
                <Chip size="sm" variant="flat">{t('statuses.issued')}</Chip>
              </div>
            </div>
            <Button
              color="primary"
              isDisabled={pendingAction !== null}
              isLoading={pendingAction === `invitation-${invitation.id}`}
              onPress={() => void acceptInvitation(invitation.id)}
            >
              {t('accessible.accept_invitation')}
            </Button>
          </div>
        ))}

        {state.form && activeRegistration ? (
          <section className="space-y-4 border-t border-theme-default pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-theme-primary">{state.form.name}</h3>
                {state.form.description ? <p className="text-sm text-theme-muted">{state.form.description}</p> : null}
              </div>
              {submission ? <Chip size="sm" variant="flat">{t(`statuses.${submission.status}`)}</Chip> : null}
            </div>
            {requiredAnswersOutstanding ? (
              <Alert color="warning" title={t('submissions.required_outstanding')} />
            ) : null}
            {submission?.status === 'submitted' ? (
              <Button
                variant="secondary"
                isDisabled={pendingAction !== null}
                isLoading={pendingAction === 'amend'}
                onPress={() => void amendAnswers()}
              >
                {t('submissions.amend')}
              </Button>
            ) : (
              <>
                <div className="space-y-4">{visibleQuestions.map(renderQuestion)}</div>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    isDisabled={pendingAction !== null}
                    isLoading={pendingAction === 'save'}
                    onPress={() => void saveAnswers(false)}
                  >
                    {t('submissions.save_draft')}
                  </Button>
                  <Button
                    color="primary"
                    isDisabled={pendingAction !== null}
                    isLoading={pendingAction === 'submit'}
                    onPress={() => void saveAnswers(true)}
                  >
                    {t('accessible.submit_answers')}
                  </Button>
                </div>
              </>
            )}
          </section>
        ) : null}

        {state.guests.length > 0 ? (
          <section className="space-y-3 border-t border-theme-default pt-5">
            <h3 className="font-semibold text-theme-primary">{t('guests.title')}</h3>
            {state.guests.map((guest) => (
              <div key={guest.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-theme-default p-4">
                <div>
                  <p className="font-medium text-theme-primary">{guest.display_name ?? t('guests.name_hidden')}</p>
                  <Chip size="sm" variant="flat">{t(`statuses.${guest.status}`)}</Chip>
                </div>
                {guest.status === 'captured' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={pendingAction !== null}
                    isLoading={pendingAction === `guest-${guest.id}`}
                    onPress={() => void cancelGuest(
                      guest.id,
                      guest.revision,
                      guest.display_name ?? t('guests.name_hidden'),
                    )}
                  >
                    {t('guests.cancel')}
                  </Button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {state.settings?.guests_enabled && activeRegistration ? (
          <section className="space-y-4 border-t border-theme-default pt-5">
            <div className="flex items-center gap-3">
              <UserPlus className="h-5 w-5 text-accent" aria-hidden="true" />
              <h3 className="font-semibold text-theme-primary">{t('accessible.add_guest')}</h3>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label={t('accessible.guest_name')} value={guestName} maxLength={191} isRequired onValueChange={setGuestName} />
              <Input type="email" label={t('accessible.guest_email')} value={guestEmail} maxLength={254} onValueChange={setGuestEmail} />
              <Input label={t('accessible.guest_phone')} value={guestPhone} maxLength={64} onValueChange={setGuestPhone} />
            </div>
            <Checkbox isSelected={guestConsent} onValueChange={setGuestConsent}>
              {t('accessible.privacy_consent_label')}
            </Checkbox>
            <Checkbox isSelected={guestNotificationConsent} onValueChange={setGuestNotificationConsent}>
              {t('accessible.notification_consent_label')}
            </Checkbox>
            <Button
              color="primary"
              isDisabled={!guestName.trim() || !guestConsent || (guestNotificationConsent && !guestEmail.trim()) || pendingAction !== null}
              isLoading={pendingAction === 'guest-add'}
              onPress={() => void addGuest()}
            >
              {t('accessible.add_guest')}
            </Button>
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
