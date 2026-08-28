// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Tabs } from '@heroui/react/tabs';
import ArrowDown from 'lucide-react/icons/arrow-down';
import ArrowUp from 'lucide-react/icons/arrow-up';
import CalendarClock from 'lucide-react/icons/calendar-clock';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import FilePlus2 from 'lucide-react/icons/file-plus-2';
import MailPlus from 'lucide-react/icons/mail-plus';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Send from 'lucide-react/icons/send';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Trash2 from 'lucide-react/icons/trash-2';
import UserRoundCheck from 'lucide-react/icons/user-round-check';
import Users from 'lucide-react/icons/users';
import { useTranslation } from 'react-i18next';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Textarea } from '@/components/ui/Textarea';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useToast } from '@/contexts/ToastContext';
import {
  eventRegistrationApi,
  type EventRegistrationOverview,
  type InvitationCampaign,
  type RegistrationAnswerReview,
  type RegistrationClassification,
  type RegistrationForm,
  type RegistrationQuestion,
  type RegistrationQuestionType,
  type RegistrationRetentionRun,
  type RegistrationSettings,
  type RegistrationSubmission,
} from '@/lib/event-registration-api';
import { logError } from '@/lib/logger';
import { getFormattingLocale } from '@/lib/helpers';

interface EventRegistrationWorkspaceProps {
  eventId: number;
}

interface FormDraft {
  id?: number;
  revision?: number;
  name: string;
  description: string;
  questions: RegistrationQuestion[];
}

interface SettingsDraft {
  approvalMode: RegistrationSettings['approval_mode'];
  opensAt: string;
  closesAt: string;
  cancellationCutoff: string;
  perMemberLimit: string;
  guestsEnabled: boolean;
  maxGuests: string;
  guestRetentionDays: string;
}

type OverviewCollection = 'submissions' | 'campaigns' | 'guests';

const QUESTION_TYPES: RegistrationQuestionType[] = [
  'short_text',
  'long_text',
  'single_choice',
  'multiple_choice',
  'dietary',
  'accessibility',
  'consent',
  'waiver',
];

const CLASSIFICATIONS: RegistrationClassification[] = [
  'public',
  'internal',
  'confidential',
  'sensitive',
];

const CAMPAIGN_TYPES: InvitationCampaign['campaign_type'][] = [
  'member',
  'email',
  'group',
  'audience',
  'csv',
];

const SUPPORTED_LOCALES = ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];

function createQuestion(index: number): RegistrationQuestion {
  return {
    stable_key: `question_${Date.now().toString(36)}_${index + 1}`,
    question_type: 'short_text',
    prompt: '',
    help_text: null,
    is_required: false,
    data_classification: 'internal',
    purpose: '',
    retention_days: 365,
    choice_options: null,
    validation_rules: null,
    visibility_rules: null,
    displayed_text: null,
    displayed_text_version: null,
  };
}

function blankForm(): FormDraft {
  return { name: '', description: '', questions: [createQuestion(0)] };
}

function toLocalDateTime(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toUtc(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function storedInstantToLocal(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : toLocalDateTime(date);
}

function settingsDraft(settings: RegistrationSettings | null): SettingsDraft {
  return {
    approvalMode: settings?.approval_mode ?? 'auto',
    opensAt: storedInstantToLocal(settings?.opens_at_utc),
    closesAt: storedInstantToLocal(settings?.closes_at_utc),
    cancellationCutoff: storedInstantToLocal(settings?.cancellation_cutoff_at_utc),
    perMemberLimit: String(settings?.per_member_limit ?? 1),
    guestsEnabled: settings?.guests_enabled ?? false,
    maxGuests: String(settings?.max_guests_per_registration ?? 1),
    guestRetentionDays: String(settings?.guest_retention_days ?? 30),
  };
}

function parsePositiveIds(value: string): number[] {
  return value
    .split(/[\s,]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function reviewCorrelationId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `review-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function appendUniqueById<T extends { id: number }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  const additions: T[] = [];
  incoming.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    additions.push(item);
  });

  return [...current, ...additions];
}

export function EventRegistrationWorkspace({ eventId }: EventRegistrationWorkspaceProps) {
  const { t, i18n } = useTranslation(['event_registration', 'events']);
  const toast = useToast();
  const confirm = useConfirm();
  const overviewGeneration = useRef(0);
  const loadMoreGeneration = useRef(0);
  const [overview, setOverview] = useState<EventRegistrationOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadingMore, setLoadingMore] = useState<OverviewCollection | null>(null);
  const [activeTab, setActiveTab] = useState('forms');

  const [formDraft, setFormDraft] = useState<FormDraft | null>(null);
  const [isSavingForm, setIsSavingForm] = useState(false);
  const [publishingFormId, setPublishingFormId] = useState<number | null>(null);
  const [registrationSettings, setRegistrationSettings] = useState<SettingsDraft>(() => settingsDraft(null));
  const [settingsAction, setSettingsAction] = useState<'save' | 'publish' | null>(null);

  const [reviewSubmission, setReviewSubmission] = useState<RegistrationSubmission | null>(null);
  const [reviewPurpose, setReviewPurpose] = useState('');
  const [reviewCorrelation, setReviewCorrelation] = useState(reviewCorrelationId());
  const [includeSensitive, setIncludeSensitive] = useState(false);
  const [review, setReview] = useState<RegistrationAnswerReview | null>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [campaignType, setCampaignType] = useState<InvitationCampaign['campaign_type']>('member');
  const [campaignSource, setCampaignSource] = useState('');
  const [campaignLocale, setCampaignLocale] = useState(i18n.language.split('-')[0] || 'en');
  const [previewCampaign, setPreviewCampaign] = useState<InvitationCampaign | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [expiresAt, setExpiresAt] = useState(toLocalDateTime(new Date(Date.now() + 7 * 86_400_000)));
  const [scheduledFor, setScheduledFor] = useState(toLocalDateTime(new Date(Date.now() + 3_600_000)));
  const [campaignBusyId, setCampaignBusyId] = useState<number | null>(null);
  const [cancelCampaign, setCancelCampaign] = useState<InvitationCampaign | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const [retentionAsOf, setRetentionAsOf] = useState(new Date().toISOString().slice(0, 10));
  const [retentionRun, setRetentionRun] = useState<RegistrationRetentionRun | null>(null);
  const [isRetentionBusy, setIsRetentionBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    const requestGeneration = ++overviewGeneration.current;
    loadMoreGeneration.current += 1;
    setIsLoading(true);
    setLoadError(false);
    setLoadingMore(null);
    try {
      const response = await eventRegistrationApi.organizerOverview(eventId);
      if (requestGeneration !== overviewGeneration.current) return;
      if (!response.success || !response.data) {
        setLoadError(true);
        return;
      }
      setOverview(response.data);
      setRegistrationSettings(settingsDraft(response.data.settings));
    } catch (error) {
      if (requestGeneration !== overviewGeneration.current) return;
      logError('Failed to load event registration workspace', error);
      setLoadError(true);
    } finally {
      if (requestGeneration === overviewGeneration.current) setIsLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void loadOverview();

    return () => {
      overviewGeneration.current += 1;
      loadMoreGeneration.current += 1;
    };
  }, [loadOverview]);

  async function loadMore(collection: OverviewCollection) {
    const page = overview?.pagination?.[collection];
    if (!page?.next_page || loadingMore !== null) return;

    const query = collection === 'submissions'
      ? { submissions_page: page.next_page, submissions_per_page: page.per_page }
      : collection === 'campaigns'
        ? { campaigns_page: page.next_page, campaigns_per_page: page.per_page }
        : { guests_page: page.next_page, guests_per_page: page.per_page };
    const requestOverviewGeneration = overviewGeneration.current;
    const requestLoadMoreGeneration = ++loadMoreGeneration.current;
    setLoadingMore(collection);
    try {
      const response = await eventRegistrationApi.organizerOverview(eventId, query);
      if (requestOverviewGeneration !== overviewGeneration.current
        || requestLoadMoreGeneration !== loadMoreGeneration.current) return;
      if (!response.success || !response.data?.pagination) {
        throw new Error(response.message);
      }
      const next = response.data;
      setOverview((current) => {
        if (!current) return current;
        if (collection === 'submissions') {
          return {
            ...current,
            submissions: appendUniqueById(current.submissions, next.submissions),
            pagination: { ...current.pagination!, submissions: next.pagination!.submissions },
            summary: next.summary ?? current.summary,
          };
        }
        if (collection === 'campaigns') {
          return {
            ...current,
            campaigns: appendUniqueById(current.campaigns, next.campaigns),
            pagination: { ...current.pagination!, campaigns: next.pagination!.campaigns },
            summary: next.summary ?? current.summary,
          };
        }

        return {
          ...current,
          guests: appendUniqueById(current.guests, next.guests),
          pagination: { ...current.pagination!, guests: next.pagination!.guests },
          summary: next.summary ?? current.summary,
        };
      });
    } catch (error) {
      if (requestOverviewGeneration !== overviewGeneration.current
        || requestLoadMoreGeneration !== loadMoreGeneration.current) return;
      logError(`Failed to load more event registration ${collection}`, error);
      toast.error(t('load_error.title'));
    } finally {
      if (requestOverviewGeneration === overviewGeneration.current
        && requestLoadMoreGeneration === loadMoreGeneration.current) {
        setLoadingMore(null);
      }
    }
  }

  const publishedForm = useMemo(
    () => overview?.forms.find((form) => form.status === 'published') ?? null,
    [overview?.forms],
  );

  async function saveRegistrationSettings() {
    const opens = registrationSettings.opensAt ? toUtc(registrationSettings.opensAt) : null;
    const closes = registrationSettings.closesAt ? toUtc(registrationSettings.closesAt) : null;
    const cutoff = registrationSettings.cancellationCutoff
      ? toUtc(registrationSettings.cancellationCutoff)
      : null;
    if ((registrationSettings.opensAt !== '' && opens === null)
      || (registrationSettings.closesAt !== '' && closes === null)
      || (registrationSettings.cancellationCutoff !== '' && cutoff === null)
      || (opens === null) !== (closes === null)) {
      toast.error(t('messages.settings_save_error'));
      return;
    }
    const perMemberLimit = Number.parseInt(registrationSettings.perMemberLimit, 10);
    const maxGuests = Number.parseInt(registrationSettings.maxGuests, 10);
    const retentionDays = Number.parseInt(registrationSettings.guestRetentionDays, 10);
    if (!Number.isInteger(perMemberLimit) || perMemberLimit < 1 || perMemberLimit > 10
      || (registrationSettings.guestsEnabled
        && (!Number.isInteger(maxGuests) || maxGuests < 1 || maxGuests > 10))
      || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 36500) {
      toast.error(t('messages.settings_save_error'));
      return;
    }
    setSettingsAction('save');
    try {
      const response = await eventRegistrationApi.saveSettings(eventId, {
        approval_mode: registrationSettings.approvalMode,
        opens_at_utc: opens,
        closes_at_utc: closes,
        cancellation_cutoff_at_utc: cutoff,
        per_member_limit: perMemberLimit,
        guests_enabled: registrationSettings.guestsEnabled,
        max_guests_per_registration: registrationSettings.guestsEnabled ? maxGuests : 0,
        guest_retention_days: retentionDays,
        expected_revision: overview?.settings?.revision ?? 0,
      });
      if (!response.success) throw new Error(response.message);
      toast.success(t('messages.settings_saved'));
      await loadOverview();
    } catch (error) {
      logError('Failed to save event registration settings', error);
      toast.error(t('messages.settings_save_error'));
    } finally {
      setSettingsAction(null);
    }
  }

  async function publishRegistrationSettings() {
    if (!overview?.settings || overview.settings.status !== 'draft') return;
    setSettingsAction('publish');
    try {
      const response = await eventRegistrationApi.publishSettings(
        eventId,
        overview.settings.revision,
      );
      if (!response.success) throw new Error(response.message);
      toast.success(t('messages.settings_published'));
      await loadOverview();
    } catch (error) {
      logError('Failed to publish event registration settings', error);
      toast.error(t('messages.settings_publish_error'));
    } finally {
      setSettingsAction(null);
    }
  }

  function updateQuestion(index: number, patch: Partial<RegistrationQuestion>) {
    setFormDraft((current) => current ? {
      ...current,
      questions: current.questions.map((question, questionIndex) => (
        questionIndex === index ? { ...question, ...patch } : question
      )),
    } : current);
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    setFormDraft((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.questions.length) return current;
      const questions = [...current.questions];
      const sourceQuestion = questions[index];
      const targetQuestion = questions[target];
      if (!sourceQuestion || !targetQuestion) return current;
      questions[index] = targetQuestion;
      questions[target] = sourceQuestion;
      return { ...current, questions };
    });
  }

  function startEditing(form?: RegistrationForm) {
    setFormDraft(form ? {
      id: form.id,
      revision: form.revision,
      name: form.name,
      description: form.description ?? '',
      questions: form.questions.map((question) => ({ ...question })),
    } : blankForm());
  }

  async function saveForm() {
    if (!formDraft || !overview?.settings) return;
    setIsSavingForm(true);
    try {
      const response = formDraft.id
        ? await eventRegistrationApi.updateForm(eventId, formDraft.id, {
          name: formDraft.name.trim(),
          description: formDraft.description.trim(),
          questions: formDraft.questions,
          expected_form_revision: formDraft.revision ?? 1,
          expected_settings_revision: overview.settings.revision,
        })
        : await eventRegistrationApi.createForm(eventId, {
          name: formDraft.name.trim(),
          description: formDraft.description.trim(),
          questions: formDraft.questions,
          expected_settings_revision: overview.settings.revision,
        });
      if (!response.success || !response.data) {
        toast.error(t('messages.form_save_error'));
        return;
      }
      toast.success(t('messages.form_saved'));
      setFormDraft(null);
      await loadOverview();
    } catch (error) {
      logError('Failed to save event registration form', error);
      toast.error(t('messages.form_save_error'));
    } finally {
      setIsSavingForm(false);
    }
  }

  async function publishForm(form: RegistrationForm) {
    if (!overview?.settings) return;
    setPublishingFormId(form.id);
    try {
      const response = await eventRegistrationApi.publishForm(
        eventId,
        form.id,
        form.revision,
        overview.settings.revision,
      );
      if (!response.success) {
        toast.error(t('messages.form_publish_error'));
        return;
      }
      toast.success(t('messages.form_published'));
      await loadOverview();
    } catch (error) {
      logError('Failed to publish event registration form', error);
      toast.error(t('messages.form_publish_error'));
    } finally {
      setPublishingFormId(null);
    }
  }

  async function forkForm(form: RegistrationForm) {
    if (!overview?.settings) return;
    setPublishingFormId(form.id);
    try {
      const response = await eventRegistrationApi.forkForm(eventId, form.id, overview.settings.revision);
      if (!response.success) {
        toast.error(t('messages.form_fork_error'));
        return;
      }
      toast.success(t('messages.form_forked'));
      await loadOverview();
    } catch (error) {
      logError('Failed to create a new registration form version', error);
      toast.error(t('messages.form_fork_error'));
    } finally {
      setPublishingFormId(null);
    }
  }

  async function loadAnswers() {
    if (!reviewSubmission || !reviewPurpose.trim() || !reviewCorrelation.trim()) return;
    setIsReviewing(true);
    setReview(null);
    try {
      const response = await eventRegistrationApi.reviewAnswers(eventId, reviewSubmission.id, {
        purpose: reviewPurpose.trim(),
        correlation_id: reviewCorrelation.trim(),
        include_sensitive: includeSensitive,
      });
      if (!response.success || !response.data) {
        toast.error(t('messages.review_error'));
        return;
      }
      setReview(response.data);
    } catch (error) {
      logError('Failed to review event registration answers', error);
      toast.error(t('messages.review_error'));
    } finally {
      setIsReviewing(false);
    }
  }

  async function exportAnswers() {
    if (!reviewPurpose.trim() || !reviewCorrelation.trim()) return;
    setIsExporting(true);
    try {
      await eventRegistrationApi.exportAnswers(
        eventId,
        reviewPurpose.trim(),
        reviewCorrelation.trim(),
        includeSensitive,
      );
      toast.success(t('messages.export_started'));
      setIsExportOpen(false);
    } catch (error) {
      logError('Failed to export event registration answers', error);
      toast.error(t('messages.export_error'));
    } finally {
      setIsExporting(false);
    }
  }

  function buildCampaignSource(): Record<string, unknown> | null {
    if (campaignType === 'member') return { member_ids: parsePositiveIds(campaignSource) };
    if (campaignType === 'email') {
      return { emails: campaignSource.split(/[\n,;]+/).map((value) => value.trim()).filter(Boolean) };
    }
    if (campaignType === 'group') {
      const [groupId] = parsePositiveIds(campaignSource);
      return groupId ? { group_id: groupId } : null;
    }
    if (campaignType === 'csv') return campaignSource.trim() ? { csv: campaignSource } : null;
    const criteria: Record<string, unknown> = { all_active: true };
    const roles = campaignSource.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
    if (roles.length > 0) criteria.roles = roles;
    return { criteria };
  }

  async function previewInvitationCampaign() {
    const source = buildCampaignSource();
    if (!source) return;
    setIsPreviewing(true);
    setPreviewCampaign(null);
    try {
      const response = await eventRegistrationApi.previewCampaign(eventId, campaignType, source, campaignLocale);
      if (!response.success || !response.data) {
        toast.error(t('messages.preview_error'));
        return;
      }
      setPreviewCampaign(response.data.value);
      toast.success(t('messages.preview_ready'));
    } catch (error) {
      logError('Failed to preview event invitation campaign', error);
      toast.error(t('messages.preview_error'));
    } finally {
      setIsPreviewing(false);
    }
  }

  async function issueCampaign(campaign: InvitationCampaign) {
    const expiry = toUtc(expiresAt);
    if (!expiry) return;
    setCampaignBusyId(campaign.id);
    try {
      const response = await eventRegistrationApi.issueCampaign(eventId, campaign.id, campaign.revision, expiry);
      if (!response.success) {
        toast.error(t('messages.issue_error'));
        return;
      }
      setPreviewCampaign(null);
      toast.success(t('messages.campaign_issued'));
      await loadOverview();
    } catch (error) {
      logError('Failed to issue event invitation campaign', error);
      toast.error(t('messages.issue_error'));
    } finally {
      setCampaignBusyId(null);
    }
  }

  async function scheduleCampaign(campaign: InvitationCampaign) {
    const scheduled = toUtc(scheduledFor);
    if (!scheduled) return;
    setCampaignBusyId(campaign.id);
    try {
      const response = await eventRegistrationApi.scheduleCampaign(eventId, campaign.id, campaign.revision, scheduled);
      if (!response.success) {
        toast.error(t('messages.schedule_error'));
        return;
      }
      setPreviewCampaign(null);
      toast.success(t('messages.campaign_scheduled'));
      await loadOverview();
    } catch (error) {
      logError('Failed to schedule event invitation campaign', error);
      toast.error(t('messages.schedule_error'));
    } finally {
      setCampaignBusyId(null);
    }
  }

  async function confirmCampaignCancellation() {
    if (!cancelCampaign || !cancelReason.trim()) return;
    setCampaignBusyId(cancelCampaign.id);
    try {
      const response = await eventRegistrationApi.cancelCampaign(
        eventId,
        cancelCampaign.id,
        cancelCampaign.revision,
        cancelReason.trim(),
      );
      if (!response.success) {
        toast.error(t('messages.cancel_error'));
        return;
      }
      toast.success(t('messages.campaign_cancelled'));
      setCancelCampaign(null);
      setCancelReason('');
      await loadOverview();
    } catch (error) {
      logError('Failed to cancel event invitation campaign', error);
      toast.error(t('messages.cancel_error'));
    } finally {
      setCampaignBusyId(null);
    }
  }

  async function transitionGuest(
    guestId: number,
    action: 'check_in' | 'check_out' | 'no_show' | 'undo',
    version: number,
  ) {
    setCampaignBusyId(-guestId);
    try {
      const response = await eventRegistrationApi.transitionGuestAttendance(eventId, guestId, action, version);
      if (!response.success) {
        toast.error(t('messages.attendance_error'));
        return;
      }
      toast.success(t('messages.attendance_updated'));
      await loadOverview();
    } catch (error) {
      logError('Failed to update guest attendance', error);
      toast.error(t('messages.attendance_error'));
    } finally {
      setCampaignBusyId(null);
    }
  }

  async function previewRetention() {
    setIsRetentionBusy(true);
    try {
      const response = await eventRegistrationApi.retentionDryRun(eventId, `${retentionAsOf}T23:59:59Z`);
      if (!response.success || !response.data) {
        toast.error(t('messages.retention_preview_error'));
        return;
      }
      setRetentionRun(response.data.value);
      toast.success(t('messages.retention_preview_ready'));
    } catch (error) {
      logError('Failed to preview event registration retention', error);
      toast.error(t('messages.retention_preview_error'));
    } finally {
      setIsRetentionBusy(false);
    }
  }

  async function applyRetention() {
    if (!retentionRun || isRetentionBusy) return;
    const accepted = await confirm({
      title: t('retention.warning_title'),
      body: (
        <span>
          {t('retention.warning_description')}{' '}
          <strong>{t('retention.eligible')}: {retentionRun.eligible_count}</strong>
        </span>
      ),
      confirmLabel: t('retention.apply'),
      cancelLabel: t('common.cancel'),
      status: 'danger',
    });
    if (!accepted) return;
    setIsRetentionBusy(true);
    try {
      const response = await eventRegistrationApi.retentionApply(eventId, retentionRun.id);
      if (!response.success || !response.data) {
        toast.error(t('messages.retention_apply_error'));
        return;
      }
      setRetentionRun(response.data.value);
      toast.success(t('messages.retention_applied'));
      await loadOverview();
    } catch (error) {
      logError('Failed to apply event registration retention', error);
      toast.error(t('messages.retention_apply_error'));
    } finally {
      setIsRetentionBusy(false);
    }
  }

  function formatDate(value?: string | null): string {
    if (!value) return t('common.not_recorded');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('common.not_recorded');
    return new Intl.DateTimeFormat(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }

  if (isLoading) {
    return <div className="flex min-h-64 items-center justify-center" aria-label={t('common.loading')}><Spinner /></div>;
  }

  if (loadError || !overview) {
    return (
      <Alert
        color="danger"
        title={t('load_error.title')}
        description={t('load_error.description')}
        endContent={<Button size="sm" variant="danger-soft" onPress={() => void loadOverview()}>{t('common.retry')}</Button>}
      />
    );
  }

  return (
    <section className="space-y-5" aria-labelledby="registration-workspace-heading">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 id="registration-workspace-heading" className="text-xl font-semibold text-theme-primary">
            {t('title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-theme-muted">{t('description')}</p>
        </div>
        <Button
          variant="secondary"
          startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
          onPress={() => void loadOverview()}
        >
          {t('common.refresh')}
        </Button>
      </div>

      <Alert
        color="primary"
        icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
        title={t('privacy.title')}
        description={t('privacy.description')}
      />

      <Tabs selectedKey={activeTab} onSelectionChange={(key) => setActiveTab(String(key))}>
        <Tabs.ListContainer className="max-w-full overflow-x-auto rounded-xl border border-theme-default bg-theme-surface p-1">
          <Tabs.List aria-label={t('tabs.aria')} className="min-w-max gap-1">
            <Tabs.Tab id="forms"><ClipboardList className="h-4 w-4" aria-hidden="true" />{t('tabs.forms')}</Tabs.Tab>
            <Tabs.Tab id="submissions"><Eye className="h-4 w-4" aria-hidden="true" />{t('tabs.submissions')}</Tabs.Tab>
            <Tabs.Tab id="invitations"><MailPlus className="h-4 w-4" aria-hidden="true" />{t('tabs.invitations')}</Tabs.Tab>
            <Tabs.Tab id="guests"><Users className="h-4 w-4" aria-hidden="true" />{t('tabs.guests')}</Tabs.Tab>
            {overview.permissions.manage_retention && (
              <Tabs.Tab id="retention"><ShieldCheck className="h-4 w-4" aria-hidden="true" />{t('tabs.retention')}</Tabs.Tab>
            )}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="forms" className="space-y-4 pt-5 outline-none">
          <Card className="border border-theme-default">
            <CardHeader className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-theme-primary">{t('settings.title')}</h3>
                <p className="text-sm text-theme-muted">{t('settings.description')}</p>
              </div>
              <div className="flex items-center gap-2">
                <Chip size="sm" color={overview.settings?.status === 'published' ? 'success' : 'warning'} variant="flat">
                  {overview.settings ? t(`statuses.${overview.settings.status}`) : t('settings.not_created')}
                </Chip>
                {overview.settings ? (
                  <span className="text-xs text-theme-subtle">{t('settings.revision', { revision: overview.settings.revision })}</span>
                ) : null}
              </div>
            </CardHeader>
            <CardBody className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              <Select
                label={t('settings.approval_mode')}
                selectedKeys={[registrationSettings.approvalMode]}
                onSelectionChange={(keys) => {
                  const [approvalMode] = Array.from(keys);
                  if (approvalMode === 'auto' || approvalMode === 'manual') {
                    setRegistrationSettings((current) => ({ ...current, approvalMode }));
                  }
                }}
              >
                <SelectItem key="auto" id="auto">{t('settings.approval_modes.auto')}</SelectItem>
                <SelectItem key="manual" id="manual">{t('settings.approval_modes.manual')}</SelectItem>
              </Select>
              <Input
                type="number"
                min={1}
                max={10}
                label={t('settings.per_member_limit')}
                value={registrationSettings.perMemberLimit}
                onValueChange={(perMemberLimit) => setRegistrationSettings((current) => ({ ...current, perMemberLimit }))}
              />
              <Switch
                isSelected={registrationSettings.guestsEnabled}
                onValueChange={(guestsEnabled) => setRegistrationSettings((current) => ({
                  ...current,
                  guestsEnabled,
                }))}
              >
                {t('settings.guests_enabled')}
              </Switch>
              <Input
                type="datetime-local"
                label={t('settings.opens_at')}
                description={t('settings.window_hint')}
                value={registrationSettings.opensAt}
                onValueChange={(opensAt) => setRegistrationSettings((current) => ({ ...current, opensAt }))}
              />
              <Input
                type="datetime-local"
                label={t('settings.closes_at')}
                value={registrationSettings.closesAt}
                onValueChange={(closesAt) => setRegistrationSettings((current) => ({ ...current, closesAt }))}
              />
              <Input
                type="datetime-local"
                label={t('settings.cancellation_cutoff')}
                value={registrationSettings.cancellationCutoff}
                onValueChange={(cancellationCutoff) => setRegistrationSettings((current) => ({
                  ...current,
                  cancellationCutoff,
                }))}
              />
              {registrationSettings.guestsEnabled ? (
                <Input
                  type="number"
                  min={1}
                  max={10}
                  label={t('settings.max_guests')}
                  value={registrationSettings.maxGuests}
                  onValueChange={(maxGuests) => setRegistrationSettings((current) => ({ ...current, maxGuests }))}
                />
              ) : null}
              <Input
                type="number"
                min={1}
                max={36500}
                label={t('settings.guest_retention')}
                value={registrationSettings.guestRetentionDays}
                onValueChange={(guestRetentionDays) => setRegistrationSettings((current) => ({
                  ...current,
                  guestRetentionDays,
                }))}
              />
            </CardBody>
            <CardFooter className="flex flex-wrap gap-3">
              <Button
                variant="secondary"
                isPending={settingsAction === 'save'}
                isDisabled={settingsAction !== null}
                onPress={() => void saveRegistrationSettings()}
              >
                {t('settings.save')}
              </Button>
              {overview.settings?.status === 'draft' ? (
                <Button
                  isPending={settingsAction === 'publish'}
                  isDisabled={settingsAction !== null}
                  onPress={() => void publishRegistrationSettings()}
                >
                  {t('settings.publish')}
                </Button>
              ) : null}
            </CardFooter>
          </Card>

          {!overview.settings ? (
            <Alert color="warning" title={t('forms.settings_missing_title')} description={t('forms.settings_missing_description')} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-theme-primary">{t('forms.title')}</h3>
                <p className="text-sm text-theme-muted">
                  {publishedForm
                    ? t('forms.published_version', { version: publishedForm.version_number })
                    : t('forms.not_published')}
                </p>
              </div>
              <Button startContent={<FilePlus2 className="h-4 w-4" aria-hidden="true" />} onPress={() => startEditing()}>
                {t('forms.new')}
              </Button>
            </div>
          )}

          {overview.forms.length === 0 ? (
            <div className="rounded-xl border border-dashed border-theme-default p-8 text-center text-sm text-theme-muted">
              {t('forms.empty')}
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {overview.forms.map((form) => (
                <Card key={form.id} className="border border-theme-default">
                  <CardHeader className="flex items-start justify-between gap-3">
                    <div>
                      <h4 className="font-semibold text-theme-primary">{form.name}</h4>
                      <p className="text-xs text-theme-subtle">{t('forms.version', { version: form.version_number })}</p>
                    </div>
                    <Chip color={form.status === 'published' ? 'success' : 'warning'} variant="flat" size="sm">
                      {t(`statuses.${form.status}`)}
                    </Chip>
                  </CardHeader>
                  <CardBody className="space-y-2 text-sm text-theme-muted">
                    <p>{form.description || t('forms.no_description')}</p>
                    <p>{t('forms.question_count', { count: form.questions.length })}</p>
                    {form.published_at && <p>{t('forms.published_at', { date: formatDate(form.published_at) })}</p>}
                  </CardBody>
                  <CardFooter className="flex flex-wrap gap-2">
                    {form.status === 'draft' ? (
                      <>
                        <Button size="sm" variant="secondary" onPress={() => startEditing(form)}>{t('forms.edit')}</Button>
                        <Button
                          size="sm"
                          isPending={publishingFormId === form.id}
                          onPress={() => void publishForm(form)}
                        >
                          {t('forms.publish')}
                        </Button>
                      </>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        isPending={publishingFormId === form.id}
                        onPress={() => void forkForm(form)}
                      >
                        {t('forms.create_revision')}
                      </Button>
                    )}
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel id="submissions" className="space-y-4 pt-5 outline-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-semibold text-theme-primary">{t('submissions.title')}</h3>
              <p className="text-sm text-theme-muted">{t('submissions.description')}</p>
            </div>
            {overview.permissions.export_answers && (
              <Button
                variant="secondary"
                startContent={<Download className="h-4 w-4" aria-hidden="true" />}
                onPress={() => {
                  setReviewPurpose('');
                  setReviewCorrelation(reviewCorrelationId());
                  setIncludeSensitive(false);
                  setIsExportOpen(true);
                }}
              >
                {t('submissions.export')}
              </Button>
            )}
          </div>
          {overview.submissions.length === 0 ? (
            <p className="rounded-xl border border-dashed border-theme-default p-8 text-center text-sm text-theme-muted">
              {t('submissions.empty')}
            </p>
          ) : (
            <div className="space-y-3">
              {overview.submissions.map((submission) => (
                <Card key={submission.id} className="border border-theme-default">
                  <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-theme-primary">
                          {submission.member_name ?? t('submissions.member_hidden')}
                        </p>
                        <Chip size="sm" variant="flat">{t(`statuses.${submission.status}`)}</Chip>
                        <Chip size="sm" color={submission.effective_slot === 1 ? 'success' : 'default'} variant="flat">
                          {submission.effective_slot === 1 ? t('submissions.effective') : t('submissions.superseded')}
                        </Chip>
                      </div>
                      <p className="mt-1 text-xs text-theme-subtle">
                        {t('submissions.attempt', { attempt: submission.attempt_number ?? 1 })}
                        {' · '}
                        {formatDate(submission.submitted_at ?? submission.updated_at)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      startContent={<Eye className="h-4 w-4" aria-hidden="true" />}
                      onPress={() => {
                        setReviewSubmission(submission);
                        setReviewPurpose('');
                        setReviewCorrelation(reviewCorrelationId());
                        setIncludeSensitive(false);
                        setReview(null);
                      }}
                    >
                      {t('submissions.review')}
                    </Button>
                  </CardBody>
                </Card>
              ))}
              {overview.pagination?.submissions.has_more && (
                <div className="flex justify-center pt-1">
                  <Button
                    variant="secondary"
                    isPending={loadingMore === 'submissions'}
                    onPress={() => void loadMore('submissions')}
                  >
                    {t('events:load_more_count', {
                      remaining: Math.max(
                        0,
                        overview.pagination.submissions.total - overview.submissions.length,
                      ).toLocaleString(getFormattingLocale()),
                    })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Tabs.Panel>

        <Tabs.Panel id="invitations" className="space-y-5 pt-5 outline-none">
          <Card className="border border-theme-default">
            <CardHeader>
              <div>
                <h3 className="font-semibold text-theme-primary">{t('invitations.builder_title')}</h3>
                <p className="mt-1 text-sm text-theme-muted">{t('invitations.builder_description')}</p>
              </div>
            </CardHeader>
            <CardBody className="grid gap-4 lg:grid-cols-2">
              <Select
                label={t('invitations.type_label')}
                selectedKeys={new Set([campaignType])}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys === 'all' ? [] : keys)[0];
                  if (value) {
                    setCampaignType(String(value) as InvitationCampaign['campaign_type']);
                    setCampaignSource('');
                    setPreviewCampaign(null);
                  }
                }}
              >
                {CAMPAIGN_TYPES.map((type) => <SelectItem key={type} id={type}>{t(`invitations.types.${type}`)}</SelectItem>)}
              </Select>
              <Select
                label={t('invitations.locale_label')}
                selectedKeys={new Set([campaignLocale])}
                onSelectionChange={(keys) => {
                  const value = Array.from(keys === 'all' ? [] : keys)[0];
                  if (value) setCampaignLocale(String(value));
                }}
              >
                {SUPPORTED_LOCALES.map((locale) => <SelectItem key={locale} id={locale}>{t(`locales.${locale}`)}</SelectItem>)}
              </Select>
              <Textarea
                className="lg:col-span-2"
                label={t(`invitations.sources.${campaignType}.label`)}
                description={t(`invitations.sources.${campaignType}.description`)}
                value={campaignSource}
                minRows={campaignType === 'csv' ? 8 : 4}
                maxLength={campaignType === 'csv' ? 5_000_000 : 20_000}
                onValueChange={setCampaignSource}
              />
            </CardBody>
            <CardFooter>
              <Button isPending={isPreviewing} isDisabled={!buildCampaignSource()} onPress={() => void previewInvitationCampaign()}>
                {t('invitations.preview')}
              </Button>
            </CardFooter>
          </Card>

          {previewCampaign && (
            <Card className="border border-theme-default">
              <CardHeader className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-theme-primary">{t('invitations.preview_title')}</h3>
                  <p className="text-sm text-theme-muted">{t('invitations.snapshot_notice')}</p>
                </div>
                <Chip color={previewCampaign.error_count > 0 ? 'warning' : 'success'} variant="flat">
                  {t('invitations.valid_count', { count: previewCampaign.valid_count })}
                </Chip>
              </CardHeader>
              <CardBody className="space-y-4">
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div><dt className="text-theme-subtle">{t('invitations.previewed')}</dt><dd className="font-semibold text-theme-primary">{previewCampaign.preview_count}</dd></div>
                  <div><dt className="text-theme-subtle">{t('invitations.valid')}</dt><dd className="font-semibold text-theme-primary">{previewCampaign.valid_count}</dd></div>
                  <div><dt className="text-theme-subtle">{t('invitations.errors')}</dt><dd className="font-semibold text-theme-primary">{previewCampaign.error_count}</dd></div>
                </dl>
                {previewCampaign.preview_errors.length > 0 && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg bg-theme-elevated p-3 text-sm text-theme-muted">
                    {previewCampaign.preview_errors.map((error, index) => (
                      <li key={`${error.row}-${error.code}-${index}`}>
                        {t('invitations.row_error', { row: error.row, code: t(`invitations.error_codes.${error.code}`, { defaultValue: error.code }) })}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-4 lg:grid-cols-2">
                  <Input type="datetime-local" label={t('invitations.expires_at')} value={expiresAt} onValueChange={setExpiresAt} />
                  <Input type="datetime-local" label={t('invitations.scheduled_for')} value={scheduledFor} onValueChange={setScheduledFor} />
                </div>
              </CardBody>
              <CardFooter className="flex flex-wrap gap-2">
                <Button
                  startContent={<Send className="h-4 w-4" aria-hidden="true" />}
                  isPending={campaignBusyId === previewCampaign.id}
                  isDisabled={previewCampaign.valid_count === 0 || !toUtc(expiresAt)}
                  onPress={() => void issueCampaign(previewCampaign)}
                >
                  {t('invitations.send_now')}
                </Button>
                <Button
                  variant="secondary"
                  startContent={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
                  isPending={campaignBusyId === previewCampaign.id}
                  isDisabled={previewCampaign.valid_count === 0 || !toUtc(scheduledFor)}
                  onPress={() => void scheduleCampaign(previewCampaign)}
                >
                  {t('invitations.schedule')}
                </Button>
              </CardFooter>
            </Card>
          )}

          <div>
            <h3 className="font-semibold text-theme-primary">{t('invitations.history_title')}</h3>
            <div className="mt-3 space-y-3">
              {overview.campaigns.length === 0 ? (
                <p className="rounded-xl border border-dashed border-theme-default p-8 text-center text-sm text-theme-muted">{t('invitations.empty')}</p>
              ) : overview.campaigns.map((campaign) => (
                <Card key={campaign.id} className="border border-theme-default">
                  <CardBody className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-theme-primary">{t(`invitations.types.${campaign.campaign_type}`)}</p>
                        <Chip size="sm" variant="flat">{t(`statuses.${campaign.status}`)}</Chip>
                      </div>
                      <p className="mt-1 text-xs text-theme-subtle">
                        {t('invitations.delivery_summary', {
                          invitations: campaign.invitations_count ?? 0,
                          delivered: campaign.delivery_counts?.delivered ?? 0,
                          failed: campaign.delivery_counts?.failed ?? 0,
                        })}
                      </p>
                    </div>
                    {['previewed', 'scheduled'].includes(campaign.status) && (
                      <Button size="sm" variant="danger-soft" onPress={() => setCancelCampaign(campaign)}>
                        {t('invitations.cancel')}
                      </Button>
                    )}
                  </CardBody>
                </Card>
              ))}
              {overview.pagination?.campaigns.has_more && (
                <div className="flex justify-center pt-1">
                  <Button
                    variant="secondary"
                    isPending={loadingMore === 'campaigns'}
                    onPress={() => void loadMore('campaigns')}
                  >
                    {t('events:load_more_count', {
                      remaining: Math.max(
                        0,
                        overview.pagination.campaigns.total - overview.campaigns.length,
                      ).toLocaleString(getFormattingLocale()),
                    })}
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Tabs.Panel>

        <Tabs.Panel id="guests" className="space-y-4 pt-5 outline-none">
          <div>
            <h3 className="font-semibold text-theme-primary">{t('guests.title')}</h3>
            <p className="text-sm text-theme-muted">{t('guests.description')}</p>
          </div>
          {overview.guests.length === 0 ? (
            <p className="rounded-xl border border-dashed border-theme-default p-8 text-center text-sm text-theme-muted">{t('guests.empty')}</p>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {overview.guests.map((guest) => {
                const attendanceStatus = guest.attendance?.status ?? 'not_checked_in';
                const attendanceVersion = guest.attendance?.version ?? 0;
                return (
                  <Card key={guest.id} className="border border-theme-default">
                    <CardHeader className="flex items-start justify-between gap-3">
                      <div>
                        <h4 className="font-semibold text-theme-primary">{guest.display_name ?? t('guests.name_hidden')}</h4>
                        <p className="text-xs text-theme-subtle">{t('guests.guest_number', { number: guest.guest_number })}</p>
                      </div>
                      <Chip color={attendanceStatus === 'checked_in' ? 'success' : 'default'} size="sm" variant="flat">
                        {t(`attendance.${attendanceStatus}`)}
                      </Chip>
                    </CardHeader>
                    <CardBody className="space-y-2 text-sm text-theme-muted">
                      {guest.email && <p>{guest.email}</p>}
                      {guest.phone && <p>{guest.phone}</p>}
                      <p>{guest.ticket_entitlement_id ? t('guests.ticket_linked') : t('guests.no_ticket')}</p>
                      <p>{guest.notification_consent ? t('guests.notifications_allowed') : t('guests.notifications_not_allowed')}</p>
                    </CardBody>
                    {overview.permissions.manage_attendance && guest.status === 'captured' && (
                      <CardFooter className="flex flex-wrap gap-2">
                        {attendanceStatus !== 'checked_in' && (
                          <Button
                            size="sm"
                            startContent={<UserRoundCheck className="h-4 w-4" aria-hidden="true" />}
                            isPending={campaignBusyId === -guest.id}
                            onPress={() => void transitionGuest(guest.id, 'check_in', attendanceVersion)}
                          >
                            {t('guests.check_in')}
                          </Button>
                        )}
                        {attendanceStatus === 'checked_in' && (
                          <Button size="sm" variant="secondary" onPress={() => void transitionGuest(guest.id, 'check_out', attendanceVersion)}>
                            {t('guests.check_out')}
                          </Button>
                        )}
                        {!['checked_in', 'checked_out', 'attended'].includes(attendanceStatus) && (
                          <Button size="sm" variant="secondary" onPress={() => void transitionGuest(guest.id, 'no_show', attendanceVersion)}>
                            {t('guests.no_show')}
                          </Button>
                        )}
                        {attendanceVersion > 0 && (
                          <Button size="sm" variant="danger-soft" onPress={() => void transitionGuest(guest.id, 'undo', attendanceVersion)}>
                            {t('guests.undo')}
                          </Button>
                        )}
                      </CardFooter>
                    )}
                  </Card>
                );
              })}
              {overview.pagination?.guests.has_more && (
                <div className="flex items-center justify-center lg:col-span-2">
                  <Button
                    variant="secondary"
                    isPending={loadingMore === 'guests'}
                    onPress={() => void loadMore('guests')}
                  >
                    {t('events:load_more_count', {
                      remaining: Math.max(
                        0,
                        overview.pagination.guests.total - overview.guests.length,
                      ).toLocaleString(getFormattingLocale()),
                    })}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Tabs.Panel>

        {overview.permissions.manage_retention && (
          <Tabs.Panel id="retention" className="space-y-4 pt-5 outline-none">
            <Alert color="warning" title={t('retention.warning_title')} description={t('retention.warning_description')} />
            <Card className="border border-theme-default">
              <CardHeader>
                <div>
                  <h3 className="font-semibold text-theme-primary">{t('retention.title')}</h3>
                  <p className="mt-1 text-sm text-theme-muted">{t('retention.description')}</p>
                </div>
              </CardHeader>
              <CardBody className="space-y-4">
                <Input type="date" label={t('retention.as_of')} value={retentionAsOf} onValueChange={setRetentionAsOf} />
                {retentionRun && (
                  <dl className="grid gap-3 rounded-xl border border-theme-default p-4 text-sm sm:grid-cols-3">
                    <div><dt className="text-theme-subtle">{t('retention.status')}</dt><dd className="font-semibold text-theme-primary">{t(`retention.modes.${retentionRun.mode}`)}</dd></div>
                    <div><dt className="text-theme-subtle">{t('retention.eligible')}</dt><dd className="font-semibold text-theme-primary">{retentionRun.eligible_count}</dd></div>
                    <div><dt className="text-theme-subtle">{t('retention.affected')}</dt><dd className="font-semibold text-theme-primary">{retentionRun.affected_count}</dd></div>
                  </dl>
                )}
              </CardBody>
              <CardFooter className="flex flex-wrap gap-2">
                <Button variant="secondary" isPending={isRetentionBusy} onPress={() => void previewRetention()}>{t('retention.preview')}</Button>
                {retentionRun?.mode === 'dry_run' && (
                  <Button variant="danger" isPending={isRetentionBusy} onPress={() => void applyRetention()}>{t('retention.apply')}</Button>
                )}
              </CardFooter>
            </Card>
          </Tabs.Panel>
        )}
      </Tabs>

      <Modal
        isOpen={formDraft !== null}
        onOpenChange={(open) => { if (!open && !isSavingForm) setFormDraft(null); }}
        size="5xl"
        scrollBehavior="inside"
        isDismissable={!isSavingForm}
        isKeyboardDismissDisabled={isSavingForm}
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t(formDraft?.id ? 'forms.editor.edit_title' : 'forms.editor.create_title')}</ModalHeader>
              <ModalBody className="space-y-5">
                {formDraft && (
                  <>
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Input label={t('forms.editor.name')} value={formDraft.name} maxLength={255} isRequired onValueChange={(name) => setFormDraft({ ...formDraft, name })} />
                      <Input label={t('forms.editor.description')} value={formDraft.description} maxLength={2000} onValueChange={(description) => setFormDraft({ ...formDraft, description })} />
                    </div>
                    <Alert color="primary" title={t('forms.editor.rules_title')} description={t('forms.editor.rules_description')} />
                    <div className="space-y-4">
                      {formDraft.questions.map((question, index) => {
                        const isChoice = ['single_choice', 'multiple_choice'].includes(question.question_type);
                        const isConsent = ['consent', 'waiver'].includes(question.question_type);
                        const isText = ['short_text', 'long_text', 'dietary', 'accessibility'].includes(question.question_type);
                        const condition = (question.visibility_rules as { conditions?: Array<{ question_key?: string; operator?: string; value?: unknown }> } | null)?.conditions?.[0];
                        const hasVisibility = Boolean(condition);
                        const defaultConditionKey = formDraft.questions[0]?.stable_key ?? question.stable_key;
                        return (
                          <Card key={question.stable_key} className="border border-theme-default">
                            <CardHeader className="flex items-center justify-between gap-3">
                              <h4 className="font-semibold text-theme-primary">{t('forms.editor.question', { number: index + 1 })}</h4>
                              <div className="flex gap-1">
                                <Button isIconOnly size="sm" variant="secondary" isDisabled={index === 0} aria-label={t('forms.editor.move_up')} onPress={() => moveQuestion(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                                <Button isIconOnly size="sm" variant="secondary" isDisabled={index === formDraft.questions.length - 1} aria-label={t('forms.editor.move_down')} onPress={() => moveQuestion(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="danger-soft"
                                  isDisabled={formDraft.questions.length === 1}
                                  aria-label={t('forms.editor.remove')}
                                  onPress={() => setFormDraft({ ...formDraft, questions: formDraft.questions.filter((_, questionIndex) => questionIndex !== index) })}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </CardHeader>
                            <CardBody className="grid gap-4 lg:grid-cols-2">
                              <Select
                                label={t('forms.editor.type')}
                                selectedKeys={new Set([question.question_type])}
                                onSelectionChange={(keys) => {
                                  const value = Array.from(keys === 'all' ? [] : keys)[0] as RegistrationQuestionType | undefined;
                                  if (!value) return;
                                  const classification = ['dietary', 'accessibility'].includes(value)
                                    && !['confidential', 'sensitive'].includes(question.data_classification)
                                    ? 'confidential'
                                    : question.data_classification;
                                  updateQuestion(index, {
                                    question_type: value,
                                    data_classification: classification,
                                    choice_options: ['single_choice', 'multiple_choice'].includes(value) ? (question.choice_options ?? ['', '']) : null,
                                    displayed_text: ['consent', 'waiver'].includes(value) ? (question.displayed_text ?? '') : null,
                                    displayed_text_version: ['consent', 'waiver'].includes(value) ? (question.displayed_text_version ?? '1') : null,
                                    validation_rules: null,
                                  });
                                }}
                              >
                                {QUESTION_TYPES.map((type) => <SelectItem key={type} id={type}>{t(`question_types.${type}`)}</SelectItem>)}
                              </Select>
                              <Select
                                label={t('forms.editor.classification')}
                                selectedKeys={new Set([question.data_classification])}
                                onSelectionChange={(keys) => {
                                  const value = Array.from(keys === 'all' ? [] : keys)[0] as RegistrationClassification | undefined;
                                  if (value) updateQuestion(index, { data_classification: value });
                                }}
                              >
                                {CLASSIFICATIONS.map((classification) => <SelectItem key={classification} id={classification}>{t(`classifications.${classification}`)}</SelectItem>)}
                              </Select>
                              <Input className="lg:col-span-2" label={t('forms.editor.prompt')} value={question.prompt} maxLength={2000} isRequired onValueChange={(prompt) => updateQuestion(index, { prompt })} />
                              <Input label={t('forms.editor.help_text')} value={question.help_text ?? ''} maxLength={4000} onValueChange={(help_text) => updateQuestion(index, { help_text: help_text || null })} />
                              <Input label={t('forms.editor.purpose')} value={question.purpose} maxLength={500} isRequired onValueChange={(purpose) => updateQuestion(index, { purpose })} />
                              <Input
                                type="number"
                                min={1}
                                max={36500}
                                label={t('forms.editor.retention_days')}
                                value={String(question.retention_days)}
                                onValueChange={(value) => updateQuestion(index, { retention_days: Math.max(1, Number.parseInt(value, 10) || 1) })}
                              />
                              <div className="flex items-end pb-2">
                                <Switch isSelected={question.is_required} onChange={(is_required) => updateQuestion(index, { is_required })}>
                                  {t('forms.editor.required')}
                                </Switch>
                              </div>
                              {isChoice && (
                                <Textarea
                                  className="lg:col-span-2"
                                  label={t('forms.editor.choices')}
                                  description={t('forms.editor.choices_description')}
                                  value={(question.choice_options ?? []).join('\n')}
                                  minRows={3}
                                  onValueChange={(value) => updateQuestion(index, { choice_options: value.split('\n').map((choice) => choice.trim()).filter(Boolean) })}
                                />
                              )}
                              {isText && (
                                <>
                                  <Input
                                    type="number"
                                    min={0}
                                    label={t('forms.editor.min_length')}
                                    value={String((question.validation_rules as { min_length?: number } | null)?.min_length ?? '')}
                                    onValueChange={(value) => {
                                      const current = (question.validation_rules ?? {}) as Record<string, unknown>;
                                      const next = value ? { ...current, min_length: Number.parseInt(value, 10) } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'min_length'));
                                      updateQuestion(index, { validation_rules: Object.keys(next).length ? next : null });
                                    }}
                                  />
                                  <Input
                                    type="number"
                                    min={0}
                                    label={t('forms.editor.max_length')}
                                    value={String((question.validation_rules as { max_length?: number } | null)?.max_length ?? '')}
                                    onValueChange={(value) => {
                                      const current = (question.validation_rules ?? {}) as Record<string, unknown>;
                                      const next = value ? { ...current, max_length: Number.parseInt(value, 10) } : Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'max_length'));
                                      updateQuestion(index, { validation_rules: Object.keys(next).length ? next : null });
                                    }}
                                  />
                                </>
                              )}
                              {isConsent && (
                                <>
                                  <Textarea className="lg:col-span-2" label={t('forms.editor.displayed_text')} value={question.displayed_text ?? ''} maxLength={20000} isRequired onValueChange={(displayed_text) => updateQuestion(index, { displayed_text })} />
                                  <Input label={t('forms.editor.displayed_version')} value={question.displayed_text_version ?? ''} maxLength={64} isRequired onValueChange={(displayed_text_version) => updateQuestion(index, { displayed_text_version })} />
                                </>
                              )}
                              {index > 0 && (
                                <div className="lg:col-span-2 space-y-3 rounded-xl border border-theme-default p-3">
                                  <Switch
                                    isSelected={hasVisibility}
                                    onChange={(enabled) => updateQuestion(index, {
                                      visibility_rules: enabled ? {
                                        match: 'all',
                                        conditions: [{ question_key: defaultConditionKey, operator: 'equals', value: '' }],
                                      } : null,
                                    })}
                                  >
                                    {t('forms.editor.conditional')}
                                  </Switch>
                                  {hasVisibility && (
                                    <div className="grid gap-3 lg:grid-cols-3">
                                      <Select
                                        label={t('forms.editor.condition_question')}
                                        selectedKeys={new Set([condition?.question_key ?? defaultConditionKey])}
                                        onSelectionChange={(keys) => {
                                          const value = Array.from(keys === 'all' ? [] : keys)[0];
                                          if (value) updateQuestion(index, { visibility_rules: { match: 'all', conditions: [{ ...condition, question_key: String(value), operator: condition?.operator ?? 'equals', value: condition?.value ?? '' }] } });
                                        }}
                                      >
                                        {formDraft.questions.slice(0, index).map((earlier, earlierIndex) => <SelectItem key={earlier.stable_key} id={earlier.stable_key}>{earlier.prompt || t('forms.editor.question', { number: earlierIndex + 1 })}</SelectItem>)}
                                      </Select>
                                      <Select
                                        label={t('forms.editor.condition_operator')}
                                        selectedKeys={new Set([condition?.operator ?? 'equals'])}
                                        onSelectionChange={(keys) => {
                                          const value = Array.from(keys === 'all' ? [] : keys)[0];
                                          if (value) updateQuestion(index, { visibility_rules: { match: 'all', conditions: [{ ...condition, question_key: condition?.question_key ?? defaultConditionKey, operator: String(value), value: condition?.value ?? '' }] } });
                                        }}
                                      >
                                        {['equals', 'not_equals', 'contains', 'not_contains'].map((operator) => <SelectItem key={operator} id={operator}>{t(`operators.${operator}`)}</SelectItem>)}
                                      </Select>
                                      <Input
                                        label={t('forms.editor.condition_value')}
                                        value={String(condition?.value ?? '')}
                                        onValueChange={(value) => updateQuestion(index, { visibility_rules: { match: 'all', conditions: [{ ...condition, question_key: condition?.question_key ?? defaultConditionKey, operator: condition?.operator ?? 'equals', value }] } })}
                                      />
                                    </div>
                                  )}
                                </div>
                              )}
                            </CardBody>
                          </Card>
                        );
                      })}
                    </div>
                    <Button
                      variant="secondary"
                      startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                      isDisabled={formDraft.questions.length >= 100}
                      onPress={() => setFormDraft({ ...formDraft, questions: [...formDraft.questions, createQuestion(formDraft.questions.length)] })}
                    >
                      {t('forms.editor.add_question')}
                    </Button>
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" isDisabled={isSavingForm} onPress={close}>{t('common.cancel')}</Button>
                <Button
                  isPending={isSavingForm}
                  isDisabled={!formDraft?.name.trim() || formDraft.questions.some((question) => !question.prompt.trim() || !question.purpose.trim())}
                  onPress={() => void saveForm()}
                >
                  {t('common.save')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={reviewSubmission !== null}
        onOpenChange={(open) => { if (!open && !isReviewing) setReviewSubmission(null); }}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('submissions.review_title')}</ModalHeader>
              <ModalBody className="space-y-4">
                <Alert color="warning" title={t('submissions.audit_title')} description={t('submissions.audit_description')} />
                <Textarea label={t('submissions.purpose')} value={reviewPurpose} maxLength={500} isRequired onValueChange={setReviewPurpose} />
                <Input label={t('submissions.correlation')} value={reviewCorrelation} maxLength={191} isRequired onValueChange={setReviewCorrelation} />
                {overview.permissions.view_sensitive_answers && (
                  <Switch isSelected={includeSensitive} onChange={setIncludeSensitive}>{t('submissions.include_sensitive')}</Switch>
                )}
                {review && (
                  <dl className="space-y-3">
                    {Object.entries(review.answers).map(([key, answer]) => (
                      <div key={key} className="rounded-xl border border-theme-default p-3">
                        <dt className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-theme-primary">
                          <span>{key}</span>
                          <Chip size="sm" variant="flat">{t(`classifications.${answer.classification}`)}</Chip>
                        </dt>
                        <dd className="mt-2 whitespace-pre-wrap break-words text-sm text-theme-muted">
                          {answer.purged ? t('submissions.purged') : JSON.stringify(answer.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" onPress={close}>{t('common.close')}</Button>
                <Button isPending={isReviewing} isDisabled={!reviewPurpose.trim() || !reviewCorrelation.trim()} onPress={() => void loadAnswers()}>{t('submissions.open_answers')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal isOpen={isExportOpen} onOpenChange={(open) => { if (!isExporting) setIsExportOpen(open); }} size="lg">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('submissions.export_title')}</ModalHeader>
              <ModalBody className="space-y-4">
                <Alert color="warning" title={t('submissions.audit_title')} description={t('submissions.export_description')} />
                <Textarea label={t('submissions.purpose')} value={reviewPurpose} maxLength={500} isRequired onValueChange={setReviewPurpose} />
                <Input label={t('submissions.correlation')} value={reviewCorrelation} maxLength={191} isRequired onValueChange={setReviewCorrelation} />
                {overview.permissions.view_sensitive_answers && <Switch isSelected={includeSensitive} onChange={setIncludeSensitive}>{t('submissions.include_sensitive')}</Switch>}
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" isDisabled={isExporting} onPress={close}>{t('common.cancel')}</Button>
                <Button isPending={isExporting} isDisabled={!reviewPurpose.trim() || !reviewCorrelation.trim()} onPress={() => void exportAnswers()}>{t('submissions.download_csv')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal isOpen={cancelCampaign !== null} onOpenChange={(open) => { if (!open && campaignBusyId === null) setCancelCampaign(null); }} size="lg">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('invitations.cancel_title')}</ModalHeader>
              <ModalBody>
                <Textarea label={t('invitations.cancel_reason')} value={cancelReason} maxLength={500} isRequired onValueChange={setCancelReason} />
              </ModalBody>
              <ModalFooter>
                <Button variant="secondary" isDisabled={campaignBusyId !== null} onPress={close}>{t('common.cancel')}</Button>
                <Button variant="danger" isPending={campaignBusyId === cancelCampaign?.id} isDisabled={!cancelReason.trim()} onPress={() => void confirmCampaignCancellation()}>{t('invitations.confirm_cancel')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </section>
  );
}
