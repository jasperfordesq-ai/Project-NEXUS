// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Archive from 'lucide-react/icons/archive';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import CopyPlus from 'lucide-react/icons/copy-plus';
import History from 'lucide-react/icons/history';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts/ToastContext';
import {
  eventTemplatesApi,
  type EventTemplate,
  type EventTemplateAudit,
  type EventTemplateCapturePreview,
} from '@/lib/event-templates-api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { EventTemplateMaterializationModal } from './EventTemplateMaterializationModal';

interface EventTemplatesWorkspaceProps {
  sourceEventId: number;
  sourceEventTitle?: string;
  onDraftCreated?: (editPath: string) => void;
}

type StatusFilter = 'active' | 'archived' | 'all';
type CaptureTarget =
  | { kind: 'new'; sourceEventId: number }
  | { kind: 'revision'; sourceEventId: number; template: EventTemplate };

function idempotencyKey(action: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `event-template-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function EventTemplatesWorkspace({
  sourceEventId,
  sourceEventTitle,
  onDraftCreated,
}: EventTemplatesWorkspaceProps) {
  const { t } = useTranslation('event_templates');
  const navigate = useNavigate();
  const toast = useToast();
  const loadGeneration = useRef(0);
  const [templates, setTemplates] = useState<EventTemplate[]>([]);
  const [status, setStatus] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [submittedSearch, setSubmittedSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [captureTarget, setCaptureTarget] = useState<CaptureTarget | null>(null);
  const [capturePreview, setCapturePreview] = useState<EventTemplateCapturePreview | null>(null);
  const [isPreviewingCapture, setIsPreviewingCapture] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  const [materializeTemplate, setMaterializeTemplate] = useState<EventTemplate | null>(null);
  const [archiveTemplate, setArchiveTemplate] = useState<EventTemplate | null>(null);
  const [archiveReason, setArchiveReason] = useState('');
  const [isArchiving, setIsArchiving] = useState(false);

  const [auditTemplate, setAuditTemplate] = useState<EventTemplate | null>(null);
  const [audits, setAudits] = useState<EventTemplateAudit[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [isLoadingMoreAudit, setIsLoadingMoreAudit] = useState(false);
  const [auditNextCursor, setAuditNextCursor] = useState<string | null>(null);
  const [auditError, setAuditError] = useState(false);
  const auditGeneration = useRef(0);

  const loadTemplates = useCallback(async (cursor?: string, append = false) => {
    const generation = ++loadGeneration.current;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    if (!append) setLoadError(false);
    try {
      const response = await eventTemplatesApi.list({
        status,
        search: submittedSearch || undefined,
        cursor,
        per_page: 20,
      });
      if (generation !== loadGeneration.current) return;
      if (!response.success || !response.data) {
        if (!append) setLoadError(true);
        else toast.error(t('manage.templates.load_more_error'));
        return;
      }
      setTemplates((current) => append ? [...current, ...response.data!] : response.data!);
      setNextCursor(response.meta?.next_cursor ?? null);
    } catch (error) {
      if (generation !== loadGeneration.current) return;
      logError('Failed to load event templates', error);
      if (!append) setLoadError(true);
      else toast.error(t('manage.templates.load_more_error'));
    } finally {
      if (generation === loadGeneration.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [status, submittedSearch, t, toast]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  async function openCapturePreview(target: CaptureTarget) {
    setCaptureTarget(target);
    setCapturePreview(null);
    setIsPreviewingCapture(true);
    try {
      const response = await eventTemplatesApi.previewCapture(target.sourceEventId);
      if (!response.success || !response.data) {
        toast.error(t('manage.templates.capture.preview_error'));
        setCaptureTarget(null);
        return;
      }
      setCapturePreview(response.data);
    } catch (error) {
      logError('Failed to preview event template capture', error);
      toast.error(t('manage.templates.capture.preview_error'));
      setCaptureTarget(null);
    } finally {
      setIsPreviewingCapture(false);
    }
  }

  async function confirmCapture() {
    if (!captureTarget || !capturePreview) return;
    setIsCapturing(true);
    try {
      const response = captureTarget.kind === 'new'
        ? await eventTemplatesApi.capture(
          captureTarget.sourceEventId,
          idempotencyKey('capture'),
        )
        : await eventTemplatesApi.revise(
          captureTarget.template.id,
          captureTarget.template.current_version,
          idempotencyKey('revise'),
        );
      if (!response.success || !response.data) {
        toast.error(t('manage.templates.capture.save_error'));
        return;
      }
      const saved = response.data.template;
      setTemplates((current) => {
        const exists = current.some((item) => item.id === saved.id);
        if (exists) return current.map((item) => item.id === saved.id ? saved : item);
        return status === 'archived' ? current : [saved, ...current];
      });
      toast.success(t(captureTarget.kind === 'new'
        ? 'manage.templates.capture.created'
        : 'manage.templates.capture.revised'));
      setCaptureTarget(null);
      setCapturePreview(null);
    } catch (error) {
      logError('Failed to save event template capture', error);
      toast.error(t('manage.templates.capture.save_error'));
    } finally {
      setIsCapturing(false);
    }
  }

  async function confirmArchive() {
    if (!archiveTemplate || !archiveReason.trim()) return;
    setIsArchiving(true);
    try {
      const response = await eventTemplatesApi.archive(
        archiveTemplate.id,
        archiveTemplate.current_version,
        archiveReason.trim(),
        idempotencyKey('archive'),
      );
      if (!response.success || !response.data) {
        toast.error(t('manage.templates.archive.error'));
        return;
      }
      setTemplates((current) => status === 'active'
        ? current.filter((item) => item.id !== archiveTemplate.id)
        : current.map((item) => item.id === archiveTemplate.id
          ? response.data!.template
          : item));
      toast.success(t('manage.templates.archive.success'));
      setArchiveTemplate(null);
      setArchiveReason('');
    } catch (error) {
      logError('Failed to archive event template', error);
      toast.error(t('manage.templates.archive.error'));
    } finally {
      setIsArchiving(false);
    }
  }

  async function openAudit(template: EventTemplate) {
    const generation = ++auditGeneration.current;
    setAuditTemplate(template);
    setAudits([]);
    setAuditNextCursor(null);
    setAuditError(false);
    setIsLoadingAudit(true);
    try {
      const response = await eventTemplatesApi.history(template.id);
      if (generation !== auditGeneration.current) return;
      if (!response.success || !response.data) {
        setAuditError(true);
        return;
      }
      setAudits(response.data);
      setAuditNextCursor(response.meta?.next_cursor ?? null);
    } catch (error) {
      if (generation !== auditGeneration.current) return;
      logError('Failed to load event template audit history', error);
      setAuditError(true);
    } finally {
      if (generation === auditGeneration.current) setIsLoadingAudit(false);
    }
  }

  async function loadMoreAudit() {
    if (!auditTemplate || !auditNextCursor || isLoadingMoreAudit) return;
    const generation = auditGeneration.current;
    const templateId = auditTemplate.id;
    const cursor = auditNextCursor;
    setIsLoadingMoreAudit(true);
    try {
      const response = await eventTemplatesApi.history(templateId, cursor);
      if (generation !== auditGeneration.current) return;
      const entries = response.data;
      if (!response.success || !entries) {
        toast.error(t('manage.templates.load_more_error'));
        return;
      }
      setAudits((current) => [...current, ...entries]);
      setAuditNextCursor(response.meta?.next_cursor ?? null);
    } catch (error) {
      if (generation !== auditGeneration.current) return;
      logError('Failed to load more event template audit history', error);
      toast.error(t('manage.templates.load_more_error'));
    } finally {
      if (generation === auditGeneration.current) setIsLoadingMoreAudit(false);
    }
  }

  function closeAudit() {
    auditGeneration.current += 1;
    setAuditTemplate(null);
    setAuditNextCursor(null);
    setIsLoadingAudit(false);
    setIsLoadingMoreAudit(false);
  }

  function dateLabel(value: string | null): string {
    if (!value) return t('manage.templates.not_recorded');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('manage.templates.not_recorded');
    return new Intl.DateTimeFormat(getFormattingLocale(), {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  }

  function handleDraftCreated(editPath: string) {
    if (onDraftCreated) onDraftCreated(editPath);
    else navigate(editPath);
  }

  return (
    <section aria-labelledby="event-templates-heading" className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 id="event-templates-heading" className="text-xl font-semibold text-theme-primary">
            {t('manage.templates.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-theme-muted">
            {t('manage.templates.description')}
          </p>
        </div>
        <Button
          startContent={<CopyPlus className="h-4 w-4" aria-hidden="true" />}
          isPending={isPreviewingCapture && captureTarget?.kind === 'new'}
          onPress={() => void openCapturePreview({ kind: 'new', sourceEventId })}
        >
          {t('manage.templates.capture_from_event', {
            title: sourceEventTitle ?? t('manage.templates.this_event'),
          })}
        </Button>
      </div>

      <Alert
        color="primary"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title={t('manage.templates.safety_title')}
        description={t('manage.templates.safety_description')}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-theme-default bg-theme-elevated p-4 lg:flex-row lg:items-end">
        <form
          className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(search.trim());
          }}
        >
          <Input
            className="flex-1"
            label={t('manage.templates.search_label')}
            placeholder={t('manage.templates.search_placeholder')}
            value={search}
            maxLength={255}
            onValueChange={setSearch}
          />
          <Button
            type="submit"
            variant="secondary"
            startContent={<Search className="h-4 w-4" aria-hidden="true" />}
          >
            {t('manage.templates.search')}
          </Button>
        </form>
        <div className="flex flex-wrap gap-2" aria-label={t('manage.templates.status_filter')}>
          {(['active', 'archived', 'all'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={status === value ? 'primary' : 'secondary'}
              aria-pressed={status === value}
              onPress={() => setStatus(value)}
            >
              {t(`manage.templates.status.${value}`)}
            </Button>
          ))}
        </div>
      </div>

      {loadError ? (
        <Alert
          color="danger"
          title={t('manage.templates.load_error_title')}
          description={t('manage.templates.load_error_description')}
          endContent={(
            <Button size="sm" variant="danger-soft" onPress={() => void loadTemplates()}>
              {t('manage.templates.retry')}
            </Button>
          )}
        />
      ) : isLoading ? (
        <div className="flex min-h-48 items-center justify-center" aria-label={t('manage.templates.loading')}>
          <Spinner />
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-theme-default p-8 text-center">
          <ClipboardCheck className="mx-auto h-10 w-10 text-theme-subtle" aria-hidden="true" />
          <h3 className="mt-3 font-semibold text-theme-primary">{t('manage.templates.empty_title')}</h3>
          <p className="mt-1 text-sm text-theme-muted">{t('manage.templates.empty_description')}</p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2" aria-live="polite">
          {templates.map((template) => (
            <Card key={template.id} className="border border-theme-default">
              <CardHeader className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-theme-primary">
                    {template.version.configuration.title || t('manage.templates.untitled')}
                  </h3>
                  <p className="mt-1 text-xs text-theme-subtle">
                    {t('manage.templates.source_label', { title: template.source_event.title })}
                  </p>
                </div>
                <Chip color={template.status === 'active' ? 'success' : 'default'} variant="flat" size="sm">
                  {t(`manage.templates.status.${template.status}`)}
                </Chip>
              </CardHeader>
              <CardBody className="space-y-3">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-theme-subtle">{t('manage.templates.version')}</dt>
                    <dd className="font-medium text-theme-primary">{template.current_version}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-subtle">{t('manage.templates.used')}</dt>
                    <dd className="font-medium text-theme-primary">
                      {t('manage.templates.use_count', { count: template.usage.materialization_count })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-theme-subtle">{t('manage.templates.timezone')}</dt>
                    <dd className="font-medium text-theme-primary">{template.version.configuration.timezone}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-subtle">{t('manage.templates.updated')}</dt>
                    <dd className="font-medium text-theme-primary">{dateLabel(template.updated_at)}</dd>
                  </div>
                </dl>
                {template.status === 'archived' && template.archive.reason && (
                  <p className="rounded-lg bg-theme-elevated p-3 text-sm text-theme-muted">
                    {t('manage.templates.archive.reason_recorded')}
                  </p>
                )}
              </CardBody>
              <CardFooter className="flex flex-wrap gap-2">
                {template.capabilities.materialize && (
                  <Button size="sm" onPress={() => setMaterializeTemplate(template)}>
                    {t('manage.templates.use_template')}
                  </Button>
                )}
                {template.capabilities.revise && (
                  <Button
                    size="sm"
                    variant="secondary"
                    startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
                    isPending={isPreviewingCapture
                      && captureTarget?.kind === 'revision'
                      && captureTarget.template.id === template.id}
                    onPress={() => void openCapturePreview({
                      kind: 'revision',
                      sourceEventId: template.source_event.id,
                      template,
                    })}
                  >
                    {t('manage.templates.refresh')}
                  </Button>
                )}
                {template.capabilities.view_audit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    startContent={<History className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => void openAudit(template)}
                  >
                    {t('manage.templates.audit')}
                  </Button>
                )}
                {template.capabilities.archive && (
                  <Button
                    size="sm"
                    variant="danger-soft"
                    startContent={<Archive className="h-4 w-4" aria-hidden="true" />}
                    onPress={() => {
                      setArchiveTemplate(template);
                      setArchiveReason('');
                    }}
                  >
                    {t('manage.templates.archive.action')}
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {nextCursor && !isLoading && (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            isPending={isLoadingMore}
            onPress={() => void loadTemplates(nextCursor, true)}
          >
            {t('manage.templates.load_more')}
          </Button>
        </div>
      )}

      <Modal
        isOpen={captureTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isCapturing) {
            setCaptureTarget(null);
            setCapturePreview(null);
          }
        }}
        size="2xl"
        scrollBehavior="inside"
        isDismissable={!isCapturing}
        isKeyboardDismissDisabled={isCapturing}
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                {t(captureTarget?.kind === 'revision'
                  ? 'manage.templates.capture.review_revision_title'
                  : 'manage.templates.capture.review_title')}
              </ModalHeader>
              <ModalBody className="space-y-5">
                {isPreviewingCapture || !capturePreview ? (
                  <div className="flex min-h-40 items-center justify-center">
                    <Spinner />
                  </div>
                ) : (
                  <>
                    <Alert
                      color="success"
                      icon={<CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
                      title={t('manage.templates.capture.safe_title')}
                      description={t('manage.templates.capture.safe_description')}
                    />
                    <div className="rounded-xl border border-theme-default p-4">
                      <p className="text-xs font-medium uppercase tracking-wide text-theme-subtle">
                        {t('manage.templates.capture.snapshot_title')}
                      </p>
                      <p className="mt-1 font-semibold text-theme-primary">
                        {capturePreview.configuration.title}
                      </p>
                    </div>
                    <section aria-labelledby="copied-fields-heading">
                      <h3 id="copied-fields-heading" className="font-semibold text-theme-primary">
                        {t('manage.templates.copied_title')}
                      </h3>
                      <ul className="mt-3 grid list-disc gap-x-6 gap-y-1 pl-5 text-sm text-theme-primary sm:grid-cols-2">
                        {capturePreview.copied_fields.map((field) => (
                          <li key={field}>{t(`manage.templates.fields.${field}`)}</li>
                        ))}
                      </ul>
                    </section>
                    <section className="rounded-xl border border-theme-default bg-theme-elevated p-4" aria-labelledby="capture-never-copied-heading">
                      <h3 id="capture-never-copied-heading" className="font-semibold text-theme-primary">
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
                <Button variant="secondary" isDisabled={isCapturing} onPress={close}>
                  {t('manage.templates.cancel')}
                </Button>
                <Button
                  isPending={isCapturing}
                  isDisabled={!capturePreview}
                  onPress={() => void confirmCapture()}
                >
                  {t(captureTarget?.kind === 'revision'
                    ? 'manage.templates.capture.confirm_revision'
                    : 'manage.templates.capture.confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={archiveTemplate !== null}
        onOpenChange={(open) => {
          if (!open && !isArchiving) setArchiveTemplate(null);
        }}
        size="md"
        isDismissable={!isArchiving}
        isKeyboardDismissDisabled={isArchiving}
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('manage.templates.archive.title')}</ModalHeader>
              <ModalBody className="space-y-4">
                <p className="text-sm text-theme-muted">
                  {t('manage.templates.archive.description', {
                    title: archiveTemplate?.version.configuration.title ?? '',
                  })}
                </p>
                <Textarea
                  label={t('manage.templates.archive.reason_label')}
                  value={archiveReason}
                  maxLength={500}
                  minRows={3}
                  isRequired
                  onValueChange={setArchiveReason}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" isDisabled={isArchiving} onPress={close}>
                  {t('manage.templates.cancel')}
                </Button>
                <Button
                  variant="danger"
                  isPending={isArchiving}
                  isDisabled={!archiveReason.trim()}
                  onPress={() => void confirmArchive()}
                >
                  {t('manage.templates.archive.confirm')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={auditTemplate !== null}
        onOpenChange={(open) => {
          if (!open) closeAudit();
        }}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('manage.templates.audit_title')}</ModalHeader>
              <ModalBody>
                {isLoadingAudit ? (
                  <div className="flex min-h-40 items-center justify-center"><Spinner /></div>
                ) : auditError ? (
                  <Alert
                    color="danger"
                    title={t('manage.templates.audit_error_title')}
                    description={t('manage.templates.audit_error_description')}
                  />
                ) : audits.length === 0 ? (
                  <p className="py-8 text-center text-sm text-theme-muted">
                    {t('manage.templates.audit_empty')}
                  </p>
                ) : (
                  <div className="space-y-4">
                    <ol className="space-y-3">
                      {audits.map((audit) => (
                        <li key={audit.id} className="rounded-xl border border-theme-default p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium text-theme-primary">
                              {t(`manage.templates.audit_actions.${audit.action}`)}
                            </p>
                            <Chip size="sm" variant="flat">
                              {t('manage.templates.version_value', { version: audit.template_version })}
                            </Chip>
                          </div>
                          <p className="mt-2 text-sm text-theme-muted">{dateLabel(audit.created_at)}</p>
                          {audit.materialized_event_id && (
                            <p className="mt-1 text-sm text-theme-muted">
                              {t('manage.templates.materialized_event', { id: audit.materialized_event_id })}
                            </p>
                          )}
                          <p className="mt-2 flex items-center gap-2 text-xs text-theme-subtle">
                            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                            {t('manage.templates.immutable_audit')}
                          </p>
                        </li>
                      ))}
                    </ol>
                    {auditNextCursor && (
                      <div className="flex justify-center">
                        <Button
                          variant="secondary"
                          isPending={isLoadingMoreAudit}
                          onPress={() => void loadMoreAudit()}
                        >
                          {t('manage.templates.audit_load_more')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onPress={close}>{t('manage.templates.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <EventTemplateMaterializationModal
        template={materializeTemplate}
        isOpen={materializeTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setMaterializeTemplate(null);
        }}
        onCreated={handleDraftCreated}
      />
    </section>
  );
}
