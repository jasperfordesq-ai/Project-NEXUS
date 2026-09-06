// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@/components/ui/Icon';
import { Alert, Button, Card, Chip, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  acceptRegistrationInvitation,
  amendRegistrationSubmission,
  cancelRegistrationGuest,
  captureRegistrationGuest,
  getAttendeeRegistrationProduct,
  getOwnRegistrationAnswers,
  saveRegistrationSubmission,
  submitRegistrationSubmission,
  type RegistrationQuestion,
  type RegistrationSubmission,
} from '@/lib/api/eventRegistration';
import {
  type RegistrationAnswerValidationError,
  validateRegistrationAnswers,
  visibleRegistrationAnswers,
  visibleRegistrationQuestions,
} from '@/lib/events/eventRegistrationFormRules';
import { useApi } from '@/lib/hooks/useApi';
import type { Theme } from '@/lib/hooks/useTheme';

interface EventRegistrationPanelProps {
  eventId: number;
  primary: string;
  theme: Theme;
  refreshSignal?: number;
}

function mutationKey(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function EventRegistrationPanel({
  eventId,
  primary,
  theme,
  refreshSignal = 0,
}: EventRegistrationPanelProps) {
  const { t, i18n } = useTranslation('eventRegistration');
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const registrationApi = useApi(
    () => getAttendeeRegistrationProduct(eventId),
    [eventId],
    { enabled: eventId > 0 },
  );
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, RegistrationAnswerValidationError>>({});
  const [submissionOverride, setSubmissionOverride] = useState<RegistrationSubmission | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestConsent, setGuestConsent] = useState(false);
  const [guestNotificationConsent, setGuestNotificationConsent] = useState(false);

  useEffect(() => {
    setAnswers({});
    setValidationErrors({});
    setSubmissionOverride(null);
  }, [eventId]);

  useEffect(() => {
    if (refreshSignal > 0) registrationApi.refresh();
    // refresh is stable; refreshSignal is the deliberate trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  const state = registrationApi.data?.data ?? null;
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
  const visibleQuestions = useMemo(
    () => state?.form ? visibleRegistrationQuestions(state.form.questions, answers) : [],
    [answers, state?.form],
  );

  useEffect(() => {
    if (!submission || submission.status !== 'draft') return;
    let active = true;
    void getOwnRegistrationAnswers(eventId, submission.id, mutationKey('registration-answers-read'))
      .then((loaded) => { if (active) setAnswers(loaded); })
      .catch(() => {
        if (active) showToast({ title: t('messages.review_error'), variant: 'danger' });
      });
    return () => { active = false; };
  }, [eventId, showToast, submission, t]);

  async function acceptInvitation(invitationId: number) {
    setPendingAction(`invitation-${invitationId}`);
    try {
      await acceptRegistrationInvitation(eventId, invitationId, mutationKey('event-invitation-accept'));
      showToast({ title: t('messages.invitation_accepted'), variant: 'success' });
      registrationApi.refresh();
    } catch {
      showToast({ title: t('messages.invitation_accept_error'), variant: 'danger' });
    } finally {
      setPendingAction(null);
    }
  }

  async function saveAnswers(shouldSubmit: boolean) {
    if (!state?.form || !activeRegistration) return;
    const nextErrors = validateRegistrationAnswers(state.form.questions, answers, shouldSubmit);
    setValidationErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      showToast({ title: t('accessible.validation_error'), variant: 'danger' });
      return;
    }
    setPendingAction(shouldSubmit ? 'submit' : 'save');
    try {
      const visibleAnswers = visibleRegistrationAnswers(state.form.questions, answers);
      const saved = await saveRegistrationSubmission(eventId, {
        registrationId: activeRegistration.id,
        formVersionId: state.form.id,
        expectedRevision: submission?.status === 'draft' ? submission.revision : null,
        answers: visibleAnswers,
      }, mutationKey('event-registration-save'));
      setSubmissionOverride(saved.data.submission);
      if (shouldSubmit) {
        const submitted = await submitRegistrationSubmission(
          eventId,
          saved.data.submission.id,
          saved.data.submission.revision,
          mutationKey('event-registration-submit'),
        );
        setSubmissionOverride(submitted.data.submission);
        showToast({ title: t('messages.answers_submitted'), variant: 'success' });
        registrationApi.refresh();
      } else {
        showToast({ title: t('messages.draft_saved'), variant: 'success' });
      }
    } catch {
      showToast({ title: t('messages.form_save_error'), variant: 'danger' });
    } finally {
      setPendingAction(null);
    }
  }

  async function amendAnswers() {
    if (!submission || submission.status !== 'submitted') return;
    setPendingAction('amend');
    try {
      const result = await amendRegistrationSubmission(
        eventId,
        submission.id,
        submission.revision,
        mutationKey('event-registration-amend'),
      );
      setSubmissionOverride(result.data.submission);
      setAnswers({});
      showToast({ title: t('messages.amendment_started'), variant: 'success' });
    } catch {
      showToast({ title: t('messages.amendment_error'), variant: 'danger' });
    } finally {
      setPendingAction(null);
    }
  }

  async function addGuest() {
    if (!activeRegistration || !guestName.trim() || !guestConsent) return;
    if (guestNotificationConsent && !guestEmail.trim()) return;
    setPendingAction('guest-add');
    try {
      await captureRegistrationGuest(eventId, activeRegistration.id, {
        expectedRegistrationVersion: activeRegistration.registration_version,
        displayName: guestName.trim(),
        email: guestEmail.trim() || undefined,
        phone: guestPhone.trim() || undefined,
        locale: i18n.resolvedLanguage ?? i18n.language ?? 'en',
        consentAccepted: guestConsent,
        consentText: t('accessible.privacy_consent_text'),
        consentVersion: '2026-07-12',
        notificationConsent: guestNotificationConsent,
        notificationConsentText: guestNotificationConsent
          ? t('accessible.notification_consent_text')
          : undefined,
        notificationConsentVersion: guestNotificationConsent ? '2026-07-12' : undefined,
      });
      setGuestName('');
      setGuestEmail('');
      setGuestPhone('');
      setGuestConsent(false);
      setGuestNotificationConsent(false);
      showToast({ title: t('messages.guest_added'), variant: 'success' });
      registrationApi.refresh();
    } catch {
      showToast({ title: t('messages.guest_add_error'), variant: 'danger' });
    } finally {
      setPendingAction(null);
    }
  }

  async function cancelGuest(guestId: number, revision: number) {
    setPendingAction(`guest-${guestId}`);
    try {
      await cancelRegistrationGuest(
        eventId,
        guestId,
        revision,
        t('guests.cancel_reason_default'),
      );
      showToast({ title: t('messages.guest_cancelled'), variant: 'success' });
      registrationApi.refresh();
    } catch {
      showToast({ title: t('messages.guest_cancel_error'), variant: 'danger' });
    } finally {
      setPendingAction(null);
    }
  }

  function updateAnswer(question: RegistrationQuestion, value: unknown) {
    setAnswers((current) => ({ ...current, [question.stable_key]: value }));
    setValidationErrors((current) => {
      if (!current[question.stable_key]) return current;
      const next = { ...current };
      delete next[question.stable_key];
      return next;
    });
  }

  function requestGuestCancellation(guestId: number, revision: number, displayName: string) {
    confirm({
      title: t('guests.cancel_confirm_title'),
      message: t('guests.cancel_confirm_body', { name: displayName }),
      confirmLabel: t('guests.cancel'),
      cancelLabel: t('guests.keep'),
      variant: 'danger',
      onConfirm: () => cancelGuest(guestId, revision),
    });
  }

  function validationMessage(error: RegistrationAnswerValidationError | undefined): string | undefined {
    if (!error) return undefined;
    return t(`answers.validation.${error.code}`, { count: error.limit, limit: error.limit });
  }

  function renderQuestion(question: RegistrationQuestion) {
    const value = answers[question.stable_key];
    const choices = question.choice_options ?? [];
    const error = validationMessage(validationErrors[question.stable_key]);
    if (question.question_type === 'single_choice') {
      return (
        <View key={question.id} className="gap-2">
          <Text className="font-semibold" style={{ color: theme.text }}>{question.prompt}</Text>
          {question.help_text ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{question.help_text}</Text> : null}
          <View className="flex-row flex-wrap gap-2">
            {choices.map((choice) => (
              <Button
                key={choice}
                size="sm"
                variant={value === choice ? 'primary' : 'secondary'}
                onPress={() => updateAnswer(question, choice)}
              >
                {choice}
              </Button>
            ))}
          </View>
          {error ? <Text className="text-sm" style={{ color: theme.error }} accessibilityRole="alert">{error}</Text> : null}
        </View>
      );
    }
    if (question.question_type === 'multiple_choice') {
      const selected = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
      return (
        <View key={question.id} className="gap-2">
          <Text className="font-semibold" style={{ color: theme.text }}>{question.prompt}</Text>
          {choices.map((choice) => (
            <Checkbox
              key={choice}
              checked={selected.includes(choice)}
              onPress={() => updateAnswer(
                question,
                selected.includes(choice) ? selected.filter((item) => item !== choice) : [...selected, choice],
              )}
              label={choice}
            />
          ))}
          {error ? <Text className="text-sm" style={{ color: theme.error }} accessibilityRole="alert">{error}</Text> : null}
        </View>
      );
    }
    if (['consent', 'waiver'].includes(question.question_type)) {
      return (
        <View key={question.id} className="gap-2">
          <Checkbox
            checked={value === true}
            onPress={() => updateAnswer(question, value !== true)}
            label={question.prompt}
          />
          {question.displayed_text ? (
            <Text className="text-xs leading-4" style={{ color: theme.textSecondary }}>
              {question.displayed_text}
            </Text>
          ) : null}
          {error ? <Text className="text-sm" style={{ color: theme.error }} accessibilityRole="alert">{error}</Text> : null}
        </View>
      );
    }
    if (question.question_type === 'short_text') {
      return (
        <Input
          key={question.id}
          label={question.prompt}
          error={error}
          value={typeof value === 'string' ? value : ''}
          onChangeText={(text) => updateAnswer(question, text)}
          maxLength={Math.min(
            Number((question.validation_rules as { max_length?: number } | null)?.max_length ?? 500),
            500,
          )}
        />
      );
    }
    return (
      <View key={question.id} className="gap-1">
        <Text className="font-semibold" style={{ color: theme.text }}>{question.prompt}</Text>
        {question.help_text ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{question.help_text}</Text> : null}
        <TextInput
          className="min-h-28 rounded-xl border px-3 py-3 text-base"
          style={{ color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }}
          multiline
          textAlignVertical="top"
          value={typeof value === 'string' ? value : ''}
          onChangeText={(text) => updateAnswer(question, text)}
          maxLength={Math.min(
            Number((question.validation_rules as { max_length?: number } | null)?.max_length ?? 10000),
            10000,
          )}
          accessibilityLabel={question.prompt}
          accessibilityHint={error ?? question.help_text ?? undefined}
        />
        {error ? <Text className="text-sm" style={{ color: theme.error }} accessibilityRole="alert">{error}</Text> : null}
      </View>
    );
  }

  if (registrationApi.isLoading && !state) {
    return (
      <Card variant="secondary">
        <Card.Body className="min-h-28 items-center justify-center p-4">
          <Spinner accessibilityLabel={t('common.loading')} />
        </Card.Body>
      </Card>
    );
  }

  if (registrationApi.error && !state) {
    return (
      <Card variant="secondary">
        <Card.Body className="gap-3 p-4">
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{t('load_error.title')}</Alert.Title>
              <Alert.Description>{t('load_error.description')}</Alert.Description>
            </Alert.Content>
          </Alert>
          <Button variant="secondary" onPress={registrationApi.refresh}>{t('common.retry')}</Button>
        </Card.Body>
      </Card>
    );
  }

  if (!state || (!state.settings && state.invitations.length === 0)) return null;

  return (
    <>
    <Card variant="secondary" testID="event-registration-panel">
      <Card.Body className="gap-5 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row items-center gap-2">
              <Ionicons name="clipboard-outline" size={20} color={primary} />
              <Card.Title>{t('title')}</Card.Title>
            </View>
            <Card.Description>{t('description')}</Card.Description>
          </View>
          <Button size="sm" variant="ghost" onPress={registrationApi.refresh} accessibilityLabel={t('common.refresh')}>
            <Ionicons name="refresh-outline" size={18} color={primary} />
          </Button>
        </View>

        {state.invitations.filter((invitation) => invitation.status === 'issued').map((invitation) => (
          <View key={invitation.id} className="gap-3 rounded-xl border border-border p-3">
            <View className="flex-row items-center justify-between gap-2">
              <Text className="font-semibold" style={{ color: theme.text }}>{t('accessible.your_invitations')}</Text>
              <Chip size="sm" variant="soft" color="accent"><Chip.Label>{t('statuses.issued')}</Chip.Label></Chip>
            </View>
            <Button
              variant="primary"
              isDisabled={pendingAction !== null}
              onPress={() => void acceptInvitation(invitation.id)}
              style={{ backgroundColor: primary }}
            >
              {pendingAction === `invitation-${invitation.id}` ? <Spinner size="sm" /> : null}
              <Button.Label>{t('accessible.accept_invitation')}</Button.Label>
            </Button>
          </View>
        ))}

        {state.form && activeRegistration ? (
          <View className="gap-4 border-t border-border pt-4">
            <View className="flex-row items-center justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-base font-semibold" style={{ color: theme.text }}>{state.form.name}</Text>
                {state.form.description ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{state.form.description}</Text> : null}
              </View>
              {submission ? (
                <Chip size="sm" variant="soft" color={submission.status === 'submitted' ? 'success' : 'warning'}>
                  <Chip.Label>{t(`statuses.${submission.status}`)}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            {submission?.status === 'submitted' ? (
              <Button variant="secondary" isDisabled={pendingAction !== null} onPress={() => void amendAnswers()}>
                {pendingAction === 'amend' ? <Spinner size="sm" /> : null}
                <Button.Label>{t('submissions.amend')}</Button.Label>
              </Button>
            ) : (
              <>
                {visibleQuestions.map(renderQuestion)}
                <View className="flex-row flex-wrap gap-2">
                  <Button variant="secondary" isDisabled={pendingAction !== null} onPress={() => void saveAnswers(false)}>
                    {pendingAction === 'save' ? <Spinner size="sm" /> : null}
                    <Button.Label>{t('submissions.save_draft')}</Button.Label>
                  </Button>
                  <Button
                    variant="primary"
                    isDisabled={pendingAction !== null}
                    onPress={() => void saveAnswers(true)}
                    style={{ backgroundColor: primary }}
                  >
                    {pendingAction === 'submit' ? <Spinner size="sm" /> : null}
                    <Button.Label>{t('accessible.submit_answers')}</Button.Label>
                  </Button>
                </View>
              </>
            )}
          </View>
        ) : null}

        {state.guests.length > 0 ? (
          <View className="gap-3 border-t border-border pt-4">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('guests.title')}</Text>
            {state.guests.map((guest) => (
              <View key={guest.id} className="flex-row items-center justify-between gap-3 rounded-xl border border-border p-3">
                <View className="min-w-0 flex-1">
                  <Text className="font-semibold" style={{ color: theme.text }}>{guest.display_name ?? t('guests.name_hidden')}</Text>
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t(`statuses.${guest.status}`)}</Text>
                </View>
                {guest.status === 'captured' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    isDisabled={pendingAction !== null}
                    onPress={() => requestGuestCancellation(
                      guest.id,
                      guest.revision,
                      guest.display_name ?? t('guests.name_hidden'),
                    )}
                  >
                    {pendingAction === `guest-${guest.id}` ? <Spinner size="sm" /> : null}
                    <Button.Label>{t('guests.cancel')}</Button.Label>
                  </Button>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {state.settings?.guests_enabled && activeRegistration ? (
          <View className="gap-3 border-t border-border pt-4">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('accessible.add_guest')}</Text>
            <Input label={t('accessible.guest_name')} value={guestName} onChangeText={setGuestName} maxLength={191} />
            <Input label={t('accessible.guest_email')} value={guestEmail} onChangeText={setGuestEmail} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
            <Input label={t('accessible.guest_phone')} value={guestPhone} onChangeText={setGuestPhone} keyboardType="phone-pad" maxLength={64} />
            <Checkbox checked={guestConsent} onPress={() => setGuestConsent((value) => !value)} label={t('accessible.privacy_consent_label')} />
            <Checkbox checked={guestNotificationConsent} onPress={() => setGuestNotificationConsent((value) => !value)} label={t('accessible.notification_consent_label')} />
            <Button
              variant="primary"
              isDisabled={!guestName.trim() || !guestConsent || (guestNotificationConsent && !guestEmail.trim()) || pendingAction !== null}
              onPress={() => void addGuest()}
              style={{ backgroundColor: primary }}
            >
              {pendingAction === 'guest-add' ? <Spinner size="sm" /> : null}
              <Button.Label>{t('accessible.add_guest')}</Button.Label>
            </Button>
          </View>
        ) : null}
      </Card.Body>
    </Card>
    {confirmDialog}
    </>
  );
}
