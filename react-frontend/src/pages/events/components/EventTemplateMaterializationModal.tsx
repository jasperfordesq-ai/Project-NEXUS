// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import CopyPlus from 'lucide-react/icons/copy-plus';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts/ToastContext';
import {
  eventTemplatesApi,
  type EventTemplate,
  type EventTemplateMaterializationInput,
  type EventTemplateMaterializationPreview,
  type EventTemplateOverrides,
} from '@/lib/event-templates-api';
import { explainedApiError } from '@/lib/explained-api-error';
import { logError } from '@/lib/logger';

interface EventTemplateMaterializationModalProps {
  template: EventTemplate | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (editPath: string) => void;
}

interface MaterializationDraft {
  startTime: string;
  endTime: string;
  title: string;
  description: string;
  location: string;
  maxAttendees: string;
  timezone: string;
  allDay: boolean;
  isOnline: boolean;
  allowRemoteAttendance: boolean;
}

function idempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `event-template-materialize-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function draftFromTemplate(template: EventTemplate | null): MaterializationDraft {
  const configuration = template?.version.configuration;
  return {
    startTime: '',
    endTime: '',
    title: configuration?.title ?? '',
    description: configuration?.description ?? '',
    location: configuration?.location ?? '',
    maxAttendees: configuration?.max_attendees === null || configuration?.max_attendees === undefined
      ? ''
      : String(configuration.max_attendees),
    timezone: configuration?.timezone ?? 'UTC',
    allDay: configuration?.all_day ?? false,
    isOnline: configuration?.is_online ?? false,
    allowRemoteAttendance: configuration?.allow_remote_attendance ?? false,
  };
}

function buildInput(
  template: EventTemplate,
  draft: MaterializationDraft,
): EventTemplateMaterializationInput | null {
  if (!draft.startTime.trim() || !draft.timezone.trim()) return null;
  if (draft.allDay && !draft.endTime.trim()) return null;
  if (draft.endTime && draft.endTime <= draft.startTime) return null;

  const base = template.version.configuration;
  const overrides: EventTemplateOverrides = {};
  if (draft.title.trim() !== base.title) overrides.title = draft.title.trim();
  if (draft.description.trim() !== base.description) overrides.description = draft.description.trim();
  const location = draft.location.trim() || null;
  if (location !== base.location) overrides.location = location;
  const maxAttendees = draft.maxAttendees.trim() === ''
    ? null
    : Number(draft.maxAttendees);
  if (maxAttendees !== null && (!Number.isInteger(maxAttendees) || maxAttendees <= 0)) return null;
  if (maxAttendees !== base.max_attendees) overrides.max_attendees = maxAttendees;
  if (draft.timezone.trim() !== base.timezone) overrides.timezone = draft.timezone.trim();
  if (draft.allDay !== base.all_day) overrides.all_day = draft.allDay;
  if (draft.isOnline !== base.is_online) overrides.is_online = draft.isOnline;
  if (draft.allowRemoteAttendance !== base.allow_remote_attendance) {
    overrides.allow_remote_attendance = draft.allowRemoteAttendance;
  }

  return {
    template_version: template.current_version,
    start_time: draft.startTime.trim(),
    end_time: draft.endTime.trim() || null,
    overrides,
  };
}

export function EventTemplateMaterializationModal({
  template,
  isOpen,
  onOpenChange,
  onCreated,
}: EventTemplateMaterializationModalProps) {
  const { t } = useTranslation('event_templates');
  const toast = useToast();
  const [draft, setDraft] = useState<MaterializationDraft>(() => draftFromTemplate(template));
  const [preview, setPreview] = useState<EventTemplateMaterializationPreview | null>(null);
  const [confirmedInput, setConfirmedInput] = useState<EventTemplateMaterializationInput | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [validationError, setValidationError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setDraft(draftFromTemplate(template));
    setPreview(null);
    setConfirmedInput(null);
    setValidationError(false);
  }, [isOpen, template]);

  const dateInputType = draft.allDay ? 'date' : 'datetime-local';
  const title = useMemo(
    () => template?.version.configuration.title ?? t('manage.templates.untitled'),
    [t, template],
  );

  const update = <K extends keyof MaterializationDraft>(
    field: K,
    value: MaterializationDraft[K],
  ) => setDraft((current) => ({ ...current, [field]: value }));

  async function handlePreview() {
    if (!template) return;
    const input = buildInput(template, draft);
    if (!input) {
      setValidationError(true);
      return;
    }
    setValidationError(false);
    setIsPreviewing(true);
    try {
      const response = await eventTemplatesApi.previewMaterialization(template.id, input);
      if (!response.success || !response.data) {
        toast.error(explainedApiError(response) ?? t('manage.templates.materialize.preview_error'));
        return;
      }
      setConfirmedInput(input);
      setPreview(response.data);
    } catch (error) {
      logError('Failed to preview event template materialization', error);
      toast.error(t('manage.templates.materialize.preview_error'));
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleCreate() {
    if (!template || !confirmedInput) return;
    setIsCreating(true);
    try {
      const response = await eventTemplatesApi.materialize(
        template.id,
        confirmedInput,
        idempotencyKey(),
      );
      if (!response.success || !response.data) {
        toast.error(explainedApiError(response) ?? t('manage.templates.materialize.create_error'));
        return;
      }
      toast.success(t('manage.templates.materialize.created'));
      onOpenChange(false);
      onCreated(response.data.created_event.edit_path);
    } catch (error) {
      logError('Failed to materialize event template', error);
      toast.error(t('manage.templates.materialize.create_error'));
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="3xl"
      scrollBehavior="inside"
      isDismissable={!isCreating}
      isKeyboardDismissDisabled={isCreating}
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              {preview
                ? t('manage.templates.materialize.review_title')
                : t('manage.templates.materialize.title', { title })}
            </ModalHeader>
            <ModalBody className="space-y-5">
              {!preview ? (
                <>
                  <Alert
                    color="primary"
                    icon={<CopyPlus className="h-5 w-5" aria-hidden="true" />}
                    title={t('manage.templates.materialize.draft_only_title')}
                    description={t('manage.templates.materialize.draft_only_description')}
                  />

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label={t('manage.templates.materialize.start_label')}
                      description={t('manage.templates.materialize.timezone_hint', { timezone: draft.timezone })}
                      type={dateInputType}
                      value={draft.startTime}
                      isRequired
                      onValueChange={(value) => update('startTime', value)}
                    />
                    <Input
                      label={t('manage.templates.materialize.end_label')}
                      type={dateInputType}
                      value={draft.endTime}
                      isRequired={draft.allDay}
                      onValueChange={(value) => update('endTime', value)}
                    />
                  </div>

                  <section className="space-y-4 rounded-xl border border-theme-default bg-theme-elevated p-4" aria-labelledby="template-overrides-heading">
                    <div>
                      <h3 id="template-overrides-heading" className="font-semibold text-theme-primary">
                        {t('manage.templates.materialize.overrides_title')}
                      </h3>
                      <p className="mt-1 text-sm text-theme-muted">
                        {t('manage.templates.materialize.overrides_description')}
                      </p>
                    </div>
                    <Input
                      label={t('manage.templates.fields.title')}
                      value={draft.title}
                      maxLength={255}
                      isRequired
                      onValueChange={(value) => update('title', value)}
                    />
                    <Textarea
                      label={t('manage.templates.fields.description')}
                      value={draft.description}
                      maxLength={20000}
                      minRows={3}
                      onValueChange={(value) => update('description', value)}
                    />
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Input
                        label={t('manage.templates.fields.location')}
                        value={draft.location}
                        maxLength={255}
                        onValueChange={(value) => update('location', value)}
                      />
                      <Input
                        label={t('manage.templates.fields.max_attendees')}
                        type="number"
                        min={1}
                        value={draft.maxAttendees}
                        onValueChange={(value) => update('maxAttendees', value)}
                      />
                      <Input
                        label={t('manage.templates.fields.timezone')}
                        value={draft.timezone}
                        maxLength={64}
                        isRequired
                        onValueChange={(value) => update('timezone', value)}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Checkbox
                        isSelected={draft.allDay}
                        onValueChange={(value) => {
                          update('allDay', value);
                          update('startTime', '');
                          update('endTime', '');
                        }}
                      >
                        {t('manage.templates.fields.all_day')}
                      </Checkbox>
                      <Checkbox
                        isSelected={draft.isOnline}
                        onValueChange={(value) => update('isOnline', value)}
                      >
                        {t('manage.templates.fields.is_online')}
                      </Checkbox>
                      <Checkbox
                        isSelected={draft.allowRemoteAttendance}
                        onValueChange={(value) => update('allowRemoteAttendance', value)}
                      >
                        {t('manage.templates.fields.allow_remote_attendance')}
                      </Checkbox>
                    </div>
                  </section>

                  {validationError && (
                    <Alert
                      color="danger"
                      title={t('manage.templates.materialize.validation_title')}
                      description={t('manage.templates.materialize.validation_description')}
                    />
                  )}
                </>
              ) : (
                <>
                  <Alert
                    color="success"
                    icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
                    title={t('manage.templates.materialize.ready_title')}
                    description={t('manage.templates.materialize.ready_description')}
                  />

                  <dl className="grid gap-3 rounded-xl border border-theme-default p-4 sm:grid-cols-2">
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                        {t('manage.templates.materialize.preview_event')}
                      </dt>
                      <dd className="mt-1 font-semibold text-theme-primary">{preview.configuration.title}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                        {t('manage.templates.fields.timezone')}
                      </dt>
                      <dd className="mt-1 text-theme-primary">{preview.schedule.timezone}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                        {t('manage.templates.materialize.publication_state')}
                      </dt>
                      <dd className="mt-1 text-theme-primary">{t('manage.templates.materialize.draft')}</dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                        {t('manage.templates.materialize.overrides_applied')}
                      </dt>
                      <dd className="mt-1 text-theme-primary">
                        {t('manage.templates.materialize.override_count', { count: preview.override_fields.length })}
                      </dd>
                    </div>
                  </dl>

                  <section aria-labelledby="template-checklist-heading">
                    <h3 id="template-checklist-heading" className="font-semibold text-theme-primary">
                      {t('manage.templates.checklist_title')}
                    </h3>
                    <ul className="mt-3 space-y-2">
                      {preview.checklist.map((item) => (
                        <li key={item.code} className="flex items-start gap-2 text-sm text-theme-primary">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                          {t(`manage.templates.checks.${item.code}`)}
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className="rounded-xl border border-theme-default bg-theme-elevated p-4" aria-labelledby="never-copied-heading">
                    <h3 id="never-copied-heading" className="font-semibold text-theme-primary">
                      {t('manage.templates.never_copied_title')}
                    </h3>
                    <p className="mt-1 text-sm text-theme-muted">
                      {t('manage.templates.never_copied_description')}
                    </p>
                    <ul className="mt-3 grid list-disc gap-x-6 gap-y-1 pl-5 text-sm text-theme-primary sm:grid-cols-2">
                      {['people', 'invitations', 'forms', 'attendance', 'tickets', 'notifications', 'federation', 'lifecycle'].map((item) => (
                        <li key={item}>{t(`manage.templates.never_copied.${item}`)}</li>
                      ))}
                    </ul>
                  </section>
                </>
              )}
            </ModalBody>
            <ModalFooter>
              {preview ? (
                <>
                  <Button
                    variant="secondary"
                    isDisabled={isCreating}
                    onPress={() => {
                      setPreview(null);
                      setConfirmedInput(null);
                    }}
                  >
                    {t('manage.templates.materialize.back')}
                  </Button>
                  <Button isPending={isCreating} onPress={() => void handleCreate()}>
                    {t('manage.templates.materialize.create_draft')}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" isDisabled={isPreviewing} onPress={close}>
                    {t('manage.templates.cancel')}
                  </Button>
                  <Button isPending={isPreviewing} onPress={() => void handlePreview()}>
                    {t('manage.templates.materialize.review')}
                  </Button>
                </>
              )}
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
