// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One modal for writing, checking and sending a message to attendees (E-106).
 *
 * Steps: compose → confirm (plain sentence of what will happen) → done, plus a
 * "Discard this message?" step when closing with unsent text. Buttons are
 * never disabled for validation: pressing explains what is missing next to
 * the field and moves focus there.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LoaderCircle from 'lucide-react/icons/loader-circle';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Radio, RadioGroup } from '@/components/ui/Radio';
import { Textarea } from '@/components/ui/Textarea';
import type {
  EventBroadcastChannel,
  EventBroadcastSegment,
  EventBroadcastVariant,
} from '@/lib/event-communications-api';
import { eventLocalInputToIso } from '@/lib/eventLocalDateTime';
import { getFormattingLocale } from '@/lib/helpers';
import { formatWhen, timeZoneCity } from './broadcastPresentation';
import { BroadcastScheduleFields, type ScheduleFieldErrors } from './BroadcastScheduleFields';
import { sameValues, type ComposerMode, type ComposerValues } from './composerSession';
import { useAudienceCount } from './useAudienceCount';

// An empty box needs a visible outline on the white dialog (WCAG 1.4.11, 3:1):
// the default control is white with a faint shadow, so unticked choices
// looked like plain text (E-106 browser check).
const VISIBLE_BOX = { wrapper: 'border-2 border-[var(--text-muted)]' } as const;

export type SubmitIntent = 'send' | 'schedule' | 'draft';

export interface SubmitRequest {
  intent: SubmitIntent;
  values: ComposerValues;
  /** The instant to send at, for `schedule`; null for `send` and `draft`. */
  scheduledAt: string | null;
}

export type SubmitResult =
  | { status: 'done' }
  | { status: 'error'; message: string }
  | { status: 'partial'; message: string }
  | { status: 'unknown'; message: string }
  | { status: 'drift' };

export interface SubmitHooks {
  /** Called when the first attempt timed out and the same request is being checked again. */
  onSlow: () => void;
}

interface BroadcastComposerProps {
  isOpen: boolean;
  eventId: number;
  eventTitle?: string;
  eventTimezone: string;
  eventEndsAt?: string | null;
  mode: ComposerMode;
  /** What the form starts with (a restored copy, a draft's content, or the defaults). */
  initialValues: ComposerValues;
  /** What "unchanged" means: closing without changes needs no confirmation. */
  baseline: ComposerValues;
  onValuesChange: (values: ComposerValues) => void;
  onSubmit: (request: SubmitRequest, hooks: SubmitHooks) => Promise<SubmitResult>;
  /** The organiser chose to throw the text away. */
  onDiscard: () => void;
  /** Close the modal (after a discard, a successful submit, or with nothing to lose). */
  onClose: () => void;
}

const SEGMENTS: EventBroadcastSegment[] = [
  'registration_confirmed',
  'waitlist_active',
  'attendance_attended',
  'attendance_no_show',
];
const CHANNELS: EventBroadcastChannel[] = ['email', 'in_app', 'push'];
const VARIANTS: EventBroadcastVariant[] = ['announcement', 'follow_up', 'review_request'];

type Step = 'compose' | 'confirm' | 'discard';

interface FieldErrors extends ScheduleFieldErrors {
  segments?: string;
  channels?: string;
  body?: string;
}

function allowedSegments(variant: EventBroadcastVariant): EventBroadcastSegment[] {
  if (variant === 'review_request') return ['attendance_attended'];
  if (variant === 'follow_up') return ['attendance_attended', 'attendance_no_show'];
  return SEGMENTS;
}

type ListFormatter = { format: (items: string[]) => string };
type ListFormatConstructor = new (locale: string, options: { type: 'conjunction' }) => ListFormatter;

/** "email and a notification in the app", in the reader's language (Intl.ListFormat is not in this TS lib). */
function joinList(items: string[], locale: string): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatConstructor }).ListFormat;
  if (ListFormat) {
    try {
      return new ListFormat(locale, { type: 'conjunction' }).format(items);
    } catch {
      // Fall through to a plain list.
    }
  }
  return items.join(', ');
}

function focusFirstIn(id: string) {
  const container = document.getElementById(id);
  if (!container) return;
  const target = container.matches('input, textarea')
    ? container
    : container.querySelector<HTMLElement>(
      'textarea, input:not([type="hidden"]):not([disabled]), [role="spinbutton"], [tabindex]:not([tabindex="-1"]), button',
    );
  target?.focus();
}

export function BroadcastComposer({
  isOpen,
  eventId,
  eventTitle,
  eventTimezone,
  eventEndsAt,
  mode,
  initialValues,
  baseline,
  onValuesChange,
  onSubmit,
  onDiscard,
  onClose,
}: BroadcastComposerProps) {
  const { t } = useTranslation('event_communications');
  const idPrefix = `broadcast-composer-${useId().replace(/:/g, '')}`;
  const [values, setValues] = useState<ComposerValues>(initialValues);
  const [step, setStep] = useState<Step>('compose');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSlow, setIsSlow] = useState(false);
  const [banner, setBanner] = useState<SubmitResult | null>(null);
  const [pending, setPending] = useState<SubmitRequest | null>(null);
  const lastRequest = useRef<SubmitRequest | null>(null);
  const mounted = useRef(true);
  // Set in the effect body too: React's StrictMode runs effect cleanup once
  // after mounting, and a flag only ever cleared left the composer thinking it
  // had gone, so it never closed after a successful send (E-106 browser check).
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const { state: count, recount } = useAudienceCount(eventId, values, isOpen);
  const dirty = !sameValues(values, baseline);
  const locale = getFormattingLocale();
  const city = timeZoneCity(eventTimezone);
  const whenWithZone = (iso: string | null) => {
    const label = formatWhen(iso, eventTimezone, locale);
    return label ? t('when_with_zone', { when: label, city }) : t('when_unknown');
  };
  const peopleText = count.status === 'ready'
    ? t('people_count', { count: count.recipients })
    : t('composer.everyone_matching');

  function update(next: Partial<ComposerValues>) {
    const merged = { ...values, ...next };
    setValues(merged);
    onValuesChange(merged);
    setBanner((current) => (current?.status === 'partial' ? current : null));
    setErrors((current) => {
      const cleared = { ...current };
      (Object.keys(next) as Array<keyof ComposerValues>).forEach((key) => {
        if (key === 'when' || key === 'date' || key === 'time') {
          delete cleared.when;
          delete cleared.date;
          delete cleared.time;
        } else if (key === 'variant') {
          delete cleared.segments;
        } else {
          delete cleared[key as keyof FieldErrors];
        }
      });
      return cleared;
    });
  }

  function chooseVariant(variant: EventBroadcastVariant) {
    if (variant === values.variant) return;
    const allowed = allowedSegments(variant);
    const segments = variant === 'announcement'
      ? values.segments
      : ['attendance_attended' as EventBroadcastSegment];
    update({ variant, segments: segments.filter((segment) => allowed.includes(segment)) });
  }

  const endsInFuture = useMemo(() => {
    if (!eventEndsAt) return false;
    const end = Date.parse(eventEndsAt);
    return Number.isFinite(end) && end > Date.now();
  }, [eventEndsAt]);
  const postEvent = values.variant !== 'announcement';

  function validate(intent: SubmitIntent): { errors: FieldErrors; firstId: string | null; scheduledAt: string | null } {
    const found: FieldErrors = {};
    const order: Array<[keyof FieldErrors, string]> = [];
    if (values.segments.length === 0) {
      found.segments = t('composer.errors.segments_required');
      order.push(['segments', `${idPrefix}-segments`]);
    }
    if (values.channels.length === 0) {
      found.channels = t('composer.errors.channels_required');
      order.push(['channels', `${idPrefix}-channels`]);
    }
    if (!values.body.trim()) {
      found.body = t('composer.errors.body_required');
      order.push(['body', `${idPrefix}-body`]);
    }
    let scheduledAt: string | null = null;
    if (intent === 'send') {
      if (postEvent && endsInFuture) {
        found.when = t('composer.errors.post_event_too_early', { when: whenWithZone(eventEndsAt ?? null) });
        order.push(['when', `${idPrefix}-when`]);
      } else if (count.status === 'ready' && count.recipients === 0 && values.segments.length > 0) {
        found.segments = t('composer.errors.nobody');
        order.push(['segments', `${idPrefix}-segments`]);
      }
    }
    if (intent === 'schedule') {
      if (!values.date) {
        found.date = t('composer.errors.date_required');
        order.push(['date', `${idPrefix}-date`]);
      }
      if (!values.time) {
        found.time = t('composer.errors.time_required');
        order.push(['time', `${idPrefix}-time`]);
      }
      if (values.date && values.time) {
        scheduledAt = eventLocalInputToIso(`${values.date}T${values.time}`, eventTimezone);
        if (scheduledAt === null) {
          found.time = t('composer.errors.time_invalid_dst');
          order.push(['time', `${idPrefix}-time`]);
        } else if (Date.parse(scheduledAt) <= Date.now()) {
          found.time = t('composer.errors.time_in_past');
          order.push(['time', `${idPrefix}-time`]);
        } else if (postEvent && eventEndsAt && Date.parse(scheduledAt) < Date.parse(eventEndsAt)) {
          found.time = t('composer.errors.post_event_too_early', { when: whenWithZone(eventEndsAt) });
          order.push(['time', `${idPrefix}-time`]);
        }
      }
    }
    return { errors: found, firstId: order[0]?.[1] ?? null, scheduledAt };
  }

  function press(intent: SubmitIntent) {
    if (isSubmitting) return;
    const result = validate(intent);
    setErrors(result.errors);
    if (result.firstId) {
      const id = result.firstId;
      setTimeout(() => focusFirstIn(id), 0);
      return;
    }
    const request: SubmitRequest = { intent, values, scheduledAt: intent === 'schedule' ? result.scheduledAt : null };
    if (intent === 'draft') {
      void submit(request);
      return;
    }
    setPending(request);
    setStep('confirm');
  }

  async function submit(request: SubmitRequest) {
    setIsSubmitting(true);
    setIsSlow(false);
    setBanner(null);
    lastRequest.current = request;
    try {
      const result = await onSubmit(request, { onSlow: () => { if (mounted.current) setIsSlow(true); } });
      if (!mounted.current) return;
      if (result.status === 'done') {
        onClose();
        return;
      }
      setBanner(result);
      setStep('compose');
    } finally {
      if (mounted.current) {
        setIsSubmitting(false);
        setIsSlow(false);
      }
    }
  }

  function requestClose() {
    if (isSubmitting) return;
    if (step === 'discard') {
      setStep('compose');
      return;
    }
    if (dirty) {
      setStep('discard');
      return;
    }
    onClose();
  }

  const title = mode === 'change'
    ? t('composer.title_change')
    : mode === 'edit'
      ? t('composer.title_edit')
      : eventTitle
        ? t('composer.title_new_for', { title: eventTitle })
        : t('composer.title_new');

  const primaryIntent: SubmitIntent = values.when === 'later' ? 'schedule' : 'send';
  const ways = joinList(values.channels.map((channel) => t(`composer.ways.${channel}`)), locale);

  return (
    <Modal
      isOpen={isOpen}
      size="3xl"
      scrollBehavior="inside"
      isDismissable={!dirty && !isSubmitting}
      isKeyboardDismissDisabled={dirty || isSubmitting}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <ModalContent>
        <ModalHeader>{title}</ModalHeader>
        <ModalBody className="space-y-6">
          {step === 'discard' ? (
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-theme-primary">{t('composer.discard_title')}</h3>
              <p className="text-theme-muted">{t('composer.discard_description')}</p>
            </div>
          ) : step === 'confirm' && pending ? (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold text-theme-primary">
                {pending.intent === 'schedule' ? t('composer.confirm_schedule_title') : t('composer.confirm_send_title')}
              </h3>
              <p className="text-theme-primary">
                {pending.intent === 'schedule'
                  ? t('composer.confirm_schedule', { when: whenWithZone(pending.scheduledAt), people: peopleText })
                  : t('composer.confirm_send', { people: peopleText, ways })}
              </p>
              {mode === 'change' && <p className="text-sm text-theme-muted">{t('composer.confirm_replace_note')}</p>}
              <blockquote className="whitespace-pre-wrap rounded-lg border-s-4 border-theme-default bg-theme-elevated p-3 text-sm text-theme-muted">
                {pending.values.body}
              </blockquote>
            </div>
          ) : (
            <>
              <fieldset className="space-y-2">
                <legend className="font-semibold text-theme-primary">{t('composer.type_legend')}</legend>
                <RadioGroup
                  aria-label={t('composer.type_legend')}
                  value={values.variant}
                  isDisabled={isSubmitting}
                  onValueChange={(next) => {
                    const variant = VARIANTS.find((candidate) => candidate === next);
                    if (variant) chooseVariant(variant);
                  }}
                >
                  {VARIANTS.map((variant) => (
                    <Radio key={variant} value={variant} description={t(`composer.types.${variant}_description`)}>
                      {t(`composer.types.${variant}`)}
                    </Radio>
                  ))}
                </RadioGroup>
                {postEvent && (
                  <p className="text-sm text-theme-muted" id={`${idPrefix}-post-event-note`}>
                    {t('composer.post_event_audience_note')}
                  </p>
                )}
              </fieldset>

              <fieldset className="space-y-2" id={`${idPrefix}-segments`}>
                <legend className="font-semibold text-theme-primary">{t('composer.audience_legend')}</legend>
                <CheckboxGroup
                  aria-label={t('composer.audience_legend')}
                  value={values.segments}
                  isDisabled={isSubmitting}
                  isInvalid={!!errors.segments}
                  onValueChange={(next) => update({
                    segments: SEGMENTS.filter((segment) => next.includes(segment)),
                  })}
                >
                  {SEGMENTS.map((segment) => {
                    const unavailable = !allowedSegments(values.variant).includes(segment);
                    return (
                      <Checkbox
                        key={segment}
                        value={segment}
                        isDisabled={unavailable || isSubmitting}
                        description={unavailable ? t('composer.segment_unavailable') : undefined}
                        classNames={VISIBLE_BOX}
                      >
                        {t(`composer.segments.${segment}`)}
                      </Checkbox>
                    );
                  })}
                </CheckboxGroup>
                {errors.segments && <p className="text-sm text-danger" role="alert">{errors.segments}</p>}
              </fieldset>

              <fieldset className="space-y-2" id={`${idPrefix}-channels`}>
                <legend className="font-semibold text-theme-primary">{t('composer.channels_legend')}</legend>
                <p className="text-sm text-theme-muted" id={`${idPrefix}-channels-help`}>
                  {t('composer.channels_description')}
                </p>
                <CheckboxGroup
                  aria-label={t('composer.channels_legend')}
                  aria-describedby={`${idPrefix}-channels-help`}
                  value={values.channels}
                  isDisabled={isSubmitting}
                  isInvalid={!!errors.channels}
                  orientation="horizontal"
                  className="gap-4"
                  onValueChange={(next) => update({
                    channels: CHANNELS.filter((channel) => next.includes(channel)),
                  })}
                >
                  {CHANNELS.map((channel) => (
                    <Checkbox key={channel} value={channel} classNames={VISIBLE_BOX}>{t(`composer.channels.${channel}`)}</Checkbox>
                  ))}
                </CheckboxGroup>
                {errors.channels && <p className="text-sm text-danger" role="alert">{errors.channels}</p>}
              </fieldset>

              <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg bg-theme-elevated p-3 text-sm">
                {count.status === 'loading' && (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>{t('composer.count_loading')}</span>
                  </>
                )}
                {count.status === 'incomplete' && <span>{t('composer.count_incomplete')}</span>}
                {count.status === 'ready' && (
                  <span className={count.recipients === 0 ? 'text-warning' : 'font-medium text-theme-primary'}>
                    {count.recipients === 0
                      ? t('composer.count_zero')
                      : t('composer.count_ready', { people: t('people_count', { count: count.recipients }) })}
                  </span>
                )}
                {count.status === 'error' && (
                  <>
                    <span className="text-danger">{t('composer.count_error')}</span>
                    <Button size="sm" variant="secondary" onPress={recount}>{t('composer.count_again')}</Button>
                  </>
                )}
              </div>

              <Textarea
                id={`${idPrefix}-body`}
                label={t('composer.body_label')}
                description={t('composer.body_description')}
                value={values.body}
                maxLength={20000}
                minRows={6}
                isRequired
                isDisabled={isSubmitting}
                isInvalid={!!errors.body}
                errorMessage={errors.body}
                onValueChange={(body) => update({ body })}
              />

              <BroadcastScheduleFields
                idPrefix={idPrefix}
                values={values}
                errors={errors}
                eventTimezone={eventTimezone}
                isDisabled={isSubmitting}
                onChange={update}
              />
            </>
          )}

          {isSlow && (
            <div role="status" className="flex items-center gap-2 text-sm text-theme-muted">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>{t('composer.working_slow')}</span>
            </div>
          )}

          {banner && banner.status !== 'done' && (
            banner.status === 'drift' ? (
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
            ) : banner.status === 'partial' ? (
              <Alert
                color="warning"
                description={banner.message}
                endContent={(
                  <Button
                    size="sm"
                    variant="secondary"
                    isPending={isSubmitting}
                    onPress={() => {
                      if (lastRequest.current) void submit(lastRequest.current);
                    }}
                  >
                    {t('composer.try_sending_again')}
                  </Button>
                )}
              />
            ) : (
              <Alert color={banner.status === 'unknown' ? 'warning' : 'danger'} description={banner.message} />
            )
          )}
        </ModalBody>
        <ModalFooter className="flex flex-wrap gap-2">
          {step === 'discard' ? (
            <>
              <Button variant="secondary" onPress={() => setStep('compose')}>{t('composer.keep_writing')}</Button>
              <Button
                variant="danger"
                onPress={() => {
                  onDiscard();
                  onClose();
                }}
              >
                {t('composer.discard')}
              </Button>
            </>
          ) : step === 'confirm' && pending ? (
            <>
              <Button variant="secondary" isDisabled={isSubmitting} onPress={() => setStep('compose')}>
                {t('composer.back')}
              </Button>
              <Button isPending={isSubmitting} onPress={() => void submit(pending)}>
                {pending.intent === 'schedule' ? t('composer.yes_schedule') : t('composer.yes_send')}
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" isDisabled={isSubmitting} onPress={requestClose}>{t('close')}</Button>
              {mode !== 'change' && (
                <Button
                  variant="secondary"
                  isPending={isSubmitting && lastRequest.current?.intent === 'draft'}
                  onPress={() => press('draft')}
                >
                  {t('composer.save_draft')}
                </Button>
              )}
              <Button
                isPending={isSubmitting && lastRequest.current?.intent !== 'draft'}
                onPress={() => press(primaryIntent)}
              >
                {primaryIntent === 'schedule' ? t('composer.schedule') : t('composer.send_now')}
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
