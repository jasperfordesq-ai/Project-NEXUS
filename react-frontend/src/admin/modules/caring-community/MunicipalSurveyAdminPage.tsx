import { formatNumber, formatPercentValue, getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, useDisclosure, Progress, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Switch, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useState } from 'react';

import { Separator } from '@/components/ui';
import BarChart3 from 'lucide-react/icons/bar-chart-3';
import CheckCircle from 'lucide-react/icons/check-circle';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import Info from 'lucide-react/icons/info';
import Plus from 'lucide-react/icons/plus';
import Users from 'lucide-react/icons/users';
import XCircle from 'lucide-react/icons/x-circle';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import api from '@/lib/api';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MunicipalSurveyAdminPage — AG62 Municipality Survey & Feedback Tool
 *
 * Admin management console for Gemeinde-grade surveys.
 * Features:
 *  - Survey list table with status, question count, response count, actions
 *  - 2-step create modal (survey details → question builder)
 *  - Publish / Close actions
 *  - View Analytics modal (response count, per-question breakdown with % bars)
 *  - Export CSV download
 */


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SurveyStatus = 'draft' | 'active' | 'closed';
type QuestionType = 'single_choice' | 'multi_choice' | 'likert' | 'open_text' | 'yes_no';

interface SurveyRow {
  id: number;
  title: string;
  status: SurveyStatus;
  is_anonymous: number | boolean;
  question_count: number;
  response_count: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

interface SurveyQuestion {
  id: number;
  question_text: string;
  question_type: QuestionType;
  options: string[] | null;
  is_required: number | boolean;
  sort_order: number;
}

interface QuestionDraft {
  question_text: string;
  question_type: QuestionType;
  options: string;      // newline-separated raw input
  is_required: boolean;
  sort_order: number;
}

interface AnalyticsQuestion {
  question_id: number;
  question_text: string;
  question_type: QuestionType;
  answer_count: number;
  breakdown?: Array<{ option: string; count: number; percentage: number }>;
  verbatims?: string[];
}

interface Analytics {
  survey_id: number;
  response_count: number;
  daily_chart: Array<{ day: string; count: number }>;
  questions: AnalyticsQuestion[];
}

interface SurveyDetail {
  id: number;
  title: string;
  status: SurveyStatus;
  is_anonymous: number | boolean;
  response_count: number;
  starts_at: string | null;
  ends_at: string | null;
  questions: SurveyQuestion[];
  analytics?: Analytics | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUESTION_TYPES: QuestionType[] = ['single_choice', 'multi_choice', 'likert', 'yes_no', 'open_text'];
const STATUS_FILTERS: Array<SurveyStatus | ''> = ['', 'draft', 'active', 'closed'];

function statusChip(status: SurveyStatus, label: string) {
  const map: Record<SurveyStatus, { color: 'default' | 'success' | 'secondary' }> = {
    draft:  { color: 'default' },
    active: { color: 'success' },
    closed: { color: 'secondary' },
  };
  const { color } = map[status] ?? { color: 'default' };
  return <Chip size="sm" color={color} variant="soft">{label}</Chip>;
}

function formatDate(ts: string | null, fallback: string): string {
  if (!ts) return fallback;
  return new Date(ts).toLocaleDateString(getFormattingLocale());
}

function emptyQuestion(idx: number): QuestionDraft {
  return {
    question_text: '',
    question_type: 'single_choice',
    options: '',
    is_required: true,
    sort_order: idx,
  };
}

// ---------------------------------------------------------------------------
// Analytics Modal Content
// ---------------------------------------------------------------------------

function AnalyticsView({ analytics, t }: { analytics: Analytics; t: TFunction<'caring_community'> }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Users size={14} />
        <span>{t('admin.surveys.analytics.total_responses')}: <strong>{analytics.response_count}</strong></span>
      </div>

      {analytics.questions.map((q) => (
        <div key={q.question_id} className="flex flex-col gap-2">
          <p className="font-medium text-sm">{q.question_text}</p>
          <p className="text-xs text-muted">
            {t(`admin.surveys.question_types.${q.question_type}`)} - {t('admin.surveys.analytics.answer_count', { count: q.answer_count })}
          </p>

          {q.question_type === 'open_text' && q.verbatims && (
            <ul className="list-disc list-inside flex flex-col gap-1">
              {q.verbatims.map((v, i) => (
                <li key={i} className="text-sm text-foreground">{v}</li>
              ))}
              {q.verbatims.length === 0 && (
                <li className="text-sm text-muted">{t('admin.surveys.analytics.no_open_text')}</li>
              )}
            </ul>
          )}

          {q.breakdown && q.breakdown.map((b) => (
            <div key={b.option} className="grid gap-2 sm:grid-cols-[minmax(0,10rem)_1fr_5rem] sm:items-center">
              <span className="min-w-0 truncate text-xs">{b.option}</span>
              <Progress
                aria-label={t('admin.surveys.analytics.option_percentage_aria', {
                  option: b.option,
                  percentage: formatPercentValue(b.percentage),
                })}
                value={b.percentage}
                className="min-w-0"
                classNames={{ indicator: 'bg-accent' }}
              />
              <span className="text-xs text-muted sm:text-right">
                {formatNumber(b.percentage / 100, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                })}
                {' · '}
                {t('admin.surveys.analytics.answer_count', { count: b.count })}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function MunicipalSurveyAdminPage() {
  const { t } = useTranslation('caring_community');
  const { t: tAdmin } = useTranslation('admin_caring_community');
  const { showToast } = useToast();
  usePageTitle(t('admin.surveys.meta_title'));
  const createModal    = useDisclosure();
  const analyticsModal = useDisclosure();

  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  // Create form state
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [title, setTitle]           = useState('');
  const [description, setDescription] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [startsAt, setStartsAt]     = useState('');
  const [endsAt, setEndsAt]         = useState('');
  const [questions, setQuestions]   = useState<QuestionDraft[]>([emptyQuestion(0)]);
  const [creating, setCreating]     = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Analytics state
  const [analyticsData, setAnalyticsData]   = useState<Analytics | null>(null);
  const [analyticsTitle, setAnalyticsTitle] = useState('');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Per-row action state
  const [actionId, setActionId] = useState<number | null>(null);

  // Fetch surveys

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = statusFilter
        ? `/v2/admin/caring-community/surveys?status=${statusFilter}`
        : '/v2/admin/caring-community/surveys';
      const res = await api.get<{ data: SurveyRow[] } | SurveyRow[]>(url);
      if (!res.success) {
        // The API client returns a failed response instead of throwing, so the
        // catch block below never saw a failed load: the page silently showed
        // an empty list and the server's own message was dropped.
        // admin-i18n-ignore: localized server message — MunicipalityFeedbackService
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        setError(res.error || t('admin.surveys.errors.load'));
        return;
      }
      const raw = res.data;
      const list: SurveyRow[] = Array.isArray(raw)
        ? raw
        : (Array.isArray((raw as { data?: SurveyRow[] }).data)
            ? (raw as { data: SurveyRow[] }).data
            : []);
      setSurveys(list);
    } catch {
      setError(t('admin.surveys.errors.load'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, t]);

  useEffect(() => { void fetchSurveys(); }, [fetchSurveys]);

  // Create survey

  const openCreate = () => {
    setCreateStep(1);
    setTitle('');
    setDescription('');
    setIsAnonymous(false);
    setStartsAt('');
    setEndsAt('');
    setQuestions([emptyQuestion(0)]);
    setCreateError(null);
    createModal.onOpen();
  };

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        is_anonymous: isAnonymous,
        starts_at: startsAt || null,
        ends_at: endsAt || null,
        questions: questions
          .filter((q) => q.question_text.trim())
          .map((q, i) => ({
            question_text: q.question_text.trim(),
            question_type: q.question_type,
            options: ['single_choice', 'multi_choice'].includes(q.question_type)
              ? q.options.split('\n').map((o) => o.trim()).filter(Boolean)
              : null,
            is_required: q.is_required,
            sort_order: i,
          })),
      };
      const res = await api.post('/v2/admin/caring-community/surveys', payload);
      if (res.success) {
        createModal.onClose();
        await fetchSurveys();
      } else {
        // admin-i18n-ignore: localized server message — MunicipalityFeedbackService
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        setCreateError(res.error || t('admin.surveys.errors.create'));
      }
    } catch {
      setCreateError(t('admin.surveys.errors.create'));
    } finally {
      setCreating(false);
    }
  };

  // Question builder helpers

  const addQuestion = () =>
    setQuestions((prev) => [...prev, emptyQuestion(prev.length)]);

  const removeQuestion = (idx: number) =>
    setQuestions((prev) => prev.filter((_, i) => i !== idx));

  const updateQuestion = <K extends keyof QuestionDraft>(
    idx: number,
    key: K,
    value: QuestionDraft[K]
  ) =>
    setQuestions((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, [key]: value } : q))
    );

  // Publish and close

  const handlePublish = async (id: number) => {
    setActionId(id);
    try {
      const res = await api.post(`/v2/admin/caring-community/surveys/${id}/publish`);
      if (res.success) {
        showToast(t('admin.surveys.toasts.published'), 'success');
        await fetchSurveys();
      } else {
        showToast(tAdmin('common.an_unexpected_error'), 'error');
      }
    } finally {
      setActionId(null);
    }
  };

  const handleClose = async (id: number) => {
    setActionId(id);
    try {
      const res = await api.post(`/v2/admin/caring-community/surveys/${id}/close`);
      if (res.success) {
        showToast(t('admin.surveys.toasts.closed'), 'success');
        await fetchSurveys();
      } else {
        showToast(tAdmin('common.an_unexpected_error'), 'error');
      }
    } finally {
      setActionId(null);
    }
  };

  // Analytics

  const openAnalytics = async (survey: SurveyRow) => {
    setAnalyticsTitle(survey.title);
    setAnalyticsData(null);
    setAnalyticsLoading(true);
    analyticsModal.onOpen();
    try {
      const res = await api.get<{ data: SurveyDetail } | SurveyDetail>(
        `/v2/admin/caring-community/surveys/${survey.id}`
      );
      const raw = res.data;
      if (!raw) return;
      const detail: SurveyDetail = 'data' in raw ? (raw as { data: SurveyDetail }).data : raw;
      if (detail.analytics) {
        setAnalyticsData(detail.analytics);
      }
    } finally {
      setAnalyticsLoading(false);
    }
  };

  // CSV export

  const handleExport = async (id: number, surveyTitle: string) => {
    try {
      await api.download(
        `/v2/admin/caring-community/surveys/${id}/export`,
        { filename: `survey-${id}-${surveyTitle.replace(/\s+/g, '-').toLowerCase()}.csv` },
      );
    } catch {
      showToast(t('admin.surveys.errors.export_failed'), 'error');
    }
  };
  // Render

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.surveys.title')}
        subtitle={t('admin.surveys.subtitle')}
        icon={<ClipboardList size={20} />}
        actions={(
          <Button
            startContent={<Plus size={16} aria-hidden="true" />}
            onPress={openCreate}
          >
            {t('admin.surveys.actions.create')}
          </Button>
        )}
      />
      {/* Intro card */}
      <Card className="border border-accent/30 bg-accent-soft shadow-sm shadow-accent/10 dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('admin.surveys.about.title')}</p>
              <p className="text-muted">{t('admin.surveys.about.body')}</p>
              <div className="space-y-0.5 pt-1 text-muted">
                <p><strong>{t('admin.surveys.status.draft')}:</strong> {t('admin.surveys.about.draft')}</p>
                <p><strong>{t('admin.surveys.status.active')}:</strong> {t('admin.surveys.about.active')}</p>
                <p><strong>{t('admin.surveys.status.closed')}:</strong> {t('admin.surveys.about.closed')}</p>
              </div>
              <p className="text-muted pt-1">{t('admin.surveys.about.export_note')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card  className="border border-divider/70 shadow-sm shadow-black/[0.03]">
        <CardHeader className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <ClipboardList size={20} className="text-accent" aria-hidden="true" />
            <div>
              <h2 className="text-lg font-semibold">{t('admin.surveys.list.title')}</h2>
              <p className="text-sm text-muted">{t('admin.surveys.list.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <Select
              size="sm"
              aria-label={t('admin.surveys.filters.status')}
              label={t('admin.surveys.filters.status')}
              placeholder={t('admin.surveys.filters.all_statuses')}
              selectedKeys={[statusFilter]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as string ?? '';
                setStatusFilter(val);
              }}
              className="w-48"
              variant="secondary"
            >
              {STATUS_FILTERS.map((f) => (
                <SelectItem key={f} id={f} textValue={f === '' ? t('admin.surveys.filters.all_statuses') : t(`admin.surveys.status.${f}`)}>
                  {f === '' ? t('admin.surveys.filters.all_statuses') : t(`admin.surveys.status.${f}`)}
                </SelectItem>
              ))}
            </Select>
          </div>
        </CardHeader>
        <Separator />
        <CardBody>
          {loading && (
            <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-10">
              <Spinner size="lg" />
            </div>
          )}
          {!loading && error && (
            <p className="text-danger text-sm">{error}</p>
          )}
          {!loading && !error && surveys.length === 0 && (
            <EmptyState
              icon={ClipboardList}
              title={t('admin.surveys.empty')}
              actionLabel={t('admin.surveys.actions.create')}
              onAction={openCreate}
            />
          )}
          {!loading && !error && surveys.length > 0 && (
            <Table aria-label={t('admin.surveys.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('admin.surveys.table.title')}</TableColumn>
                <TableColumn>{t('admin.surveys.table.status')}</TableColumn>
                <TableColumn>{t('admin.surveys.table.questions')}</TableColumn>
                <TableColumn>{t('admin.surveys.table.responses')}</TableColumn>
                <TableColumn>{t('admin.surveys.table.anonymous')}</TableColumn>
                <TableColumn>{t('admin.surveys.table.ends')}</TableColumn>
                <TableColumn>{t('admin.surveys.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {surveys.map((survey) => (
                  <TableRow key={survey.id}>
                    <TableCell>
                      <p className="font-medium text-sm">{survey.title}</p>
                      <p className="text-xs text-muted">{formatDate(survey.created_at, t('admin.surveys.common.date_unknown'))}</p>
                    </TableCell>
                    <TableCell>{statusChip(survey.status, t(`admin.surveys.status.${survey.status}`))}</TableCell>
                    <TableCell>
                      <span className="text-sm">{survey.question_count}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Users size={12} className="text-muted" />
                        <span className="text-sm">{survey.response_count}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {survey.is_anonymous ? (
                        <Chip size="sm" color="default" variant="soft">{t('admin.surveys.common.yes')}</Chip>
                      ) : (
                        <span className="text-xs text-muted">{t('admin.surveys.common.no')}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs">{formatDate(survey.ends_at, t('admin.surveys.common.date_unknown'))}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 flex-wrap">
                        {survey.status === 'draft' && (
                          <Button
                            size="sm"
                            color="success"
                            variant="tertiary"
                            startContent={<CheckCircle size={12} />}
                            isLoading={actionId === survey.id}
                            onPress={() => void handlePublish(survey.id)}
                          >
                            {t('admin.surveys.actions.publish')}
                          </Button>
                        )}
                        {survey.status === 'active' && (
                          <Button
                            size="sm"
                            color="warning"
                            variant="tertiary"
                            startContent={<XCircle size={12} />}
                            isLoading={actionId === survey.id}
                            onPress={() => void handleClose(survey.id)}
                          >
                            {t('admin.surveys.actions.close')}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="tertiary"
                          startContent={<Eye size={12} />}
                          onPress={() => void openAnalytics(survey)}
                        >
                          {t('admin.surveys.actions.analytics')}
                        </Button>
                        <Button
                          size="sm"
                          variant="tertiary"
                          startContent={<Download size={12} />}
                          onPress={() => void handleExport(survey.id, survey.title)}
                        >
                          {t('admin.surveys.actions.csv')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Create survey modal */}
      <Modal
        isOpen={createModal.isOpen}
        onClose={createModal.onClose}
        size="2xl"
        isDismissable={!creating}
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <ClipboardList size={18} className="text-accent" />
            {t('admin.surveys.create_modal.title', { step: createStep })}
          </ModalHeader>
          <ModalBody>
            {createStep === 1 && (
              <div className="flex flex-col gap-4">
                <Input
                  label={t('admin.surveys.fields.title')}
                  placeholder={t('admin.surveys.fields.title_placeholder')}
                  value={title}
                  onValueChange={setTitle}
                  isRequired
                  variant="secondary"
                  maxLength={255}
                />
                <Textarea
                  label={t('admin.surveys.fields.description')}
                  placeholder={t('admin.surveys.fields.description_placeholder')}
                  value={description}
                  onValueChange={setDescription}
                  variant="secondary"
                  minRows={2}
                  maxRows={6}
                />
                <div className="flex items-center gap-3">
                  <Switch
                    isSelected={isAnonymous}
                    onValueChange={setIsAnonymous}
                    size="sm"
                  />
                  <div>
                    <p className="text-sm font-medium">{t('admin.surveys.fields.anonymous')}</p>
                    <p className="text-xs text-muted">
                      {t('admin.surveys.fields.anonymous_help')}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label={t('admin.surveys.fields.starts_at')}
                    type="datetime-local"
                    value={startsAt}
                    onValueChange={setStartsAt}
                    variant="secondary"
                  />
                  <Input
                    label={t('admin.surveys.fields.ends_at')}
                    type="datetime-local"
                    value={endsAt}
                    onValueChange={setEndsAt}
                    variant="secondary"
                  />
                </div>
              </div>
            )}

            {createStep === 2 && (
              <div className="flex flex-col gap-6">
                <p className="text-sm text-muted">
                  {t('admin.surveys.create_modal.questions_intro')}
                </p>
                {questions.map((q, idx) => (
                  <Card key={idx} className="border border-border" >
                    <CardBody className="flex flex-col gap-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-muted uppercase tracking-wide">
                          {t('admin.surveys.create_modal.question_number', { number: idx + 1 })}
                        </span>
                        {questions.length > 1 && (
                          <Button
                            size="sm"
                            color="danger"
                            variant="tertiary"
                            onPress={() => removeQuestion(idx)}
                          >
                            {t('admin.surveys.actions.remove')}
                          </Button>
                        )}
                      </div>
                      <Input
                        label={t('admin.surveys.fields.question_text')}
                        value={q.question_text}
                        onValueChange={(v) => updateQuestion(idx, 'question_text', v)}
                        variant="secondary"
                        maxLength={500}
                        isRequired
                      />
                      <Select
                        label={t('admin.surveys.fields.question_type')}
                        selectedKeys={[q.question_type]}
                        onSelectionChange={(keys) => {
                          const val = Array.from(keys)[0] as QuestionType;
                          if (val) updateQuestion(idx, 'question_type', val);
                        }}
                        variant="secondary"
                      >
                        {QUESTION_TYPES.map((qt) => (
                          <SelectItem key={qt} id={qt} textValue={t(`admin.surveys.question_types.${qt}`)}>
                            {t(`admin.surveys.question_types.${qt}`)}
                          </SelectItem>
                        ))}
                      </Select>
                      {['single_choice', 'multi_choice'].includes(q.question_type) && (
                        <Textarea
                          label={t('admin.surveys.fields.options')}
                          placeholder={t('admin.surveys.fields.options_placeholder')}
                          value={q.options}
                          onValueChange={(v) => updateQuestion(idx, 'options', v)}
                          variant="secondary"
                          minRows={3}
                          description={t('admin.surveys.fields.options_help')}
                        />
                      )}
                      {q.question_type === 'likert' && (
                        <p className="text-xs text-muted">
                          {t('admin.surveys.fields.likert_help')}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <Switch
                          isSelected={q.is_required}
                          onValueChange={(v) => updateQuestion(idx, 'is_required', v)}
                          size="sm"
                        />
                        <span className="text-sm">{t('admin.surveys.fields.required')}</span>
                      </div>
                    </CardBody>
                  </Card>
                ))}
                <Button
                  variant="secondary"
                  startContent={<Plus size={14} />}
                  onPress={addQuestion}
                  className="w-full"
                >
                  {t('admin.surveys.actions.add_question')}
                </Button>
                {createError && <p className="text-danger text-sm">{createError}</p>}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            {createStep === 2 && (
              <Button
                variant="tertiary"
                onPress={() => setCreateStep(1)}
                isDisabled={creating}
              >
                {t('admin.surveys.actions.back')}
              </Button>
            )}
            <Button
              variant="tertiary"
              onPress={createModal.onClose}
              isDisabled={creating}
            >
              {t('admin.surveys.actions.cancel')}
            </Button>
            {createStep === 1 && (
              <Button
                onPress={() => setCreateStep(2)}
                isDisabled={!title.trim()}
              >
                {t('admin.surveys.actions.next_questions')}
              </Button>
            )}
            {createStep === 2 && (
              <Button
                startContent={<BarChart3 size={16} />}
                onPress={() => void handleCreate()}
                isLoading={creating}
                isDisabled={creating}
              >
                {t('admin.surveys.actions.create')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Analytics modal */}
      <Modal
        isOpen={analyticsModal.isOpen}
        onClose={analyticsModal.onClose}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <BarChart3 size={18} className="text-accent" />
            {t('admin.surveys.analytics.modal_title', { title: analyticsTitle })}
          </ModalHeader>
          <ModalBody>
            {analyticsLoading && (
              <div role="status" aria-busy="true" aria-label={tAdmin('common.loading')} className="flex justify-center py-8">
                <Spinner size="lg" />
              </div>
            )}
            {!analyticsLoading && analyticsData && (
              <AnalyticsView analytics={analyticsData} t={t} />
            )}
            {!analyticsLoading && !analyticsData && (
              <p className="text-muted text-sm py-4">{t('admin.surveys.analytics.empty')}</p>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={analyticsModal.onClose}>{t('admin.surveys.actions.close_modal')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
