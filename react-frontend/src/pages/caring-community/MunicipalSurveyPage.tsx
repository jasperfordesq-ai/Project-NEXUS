// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MunicipalSurveyPage — AG62 Municipality Survey & Feedback Tool (member-facing)
 *
 * Lists active Gemeinde surveys and allows members to fill them out.
 * All user-facing text is translated via t('municipality_survey.*').
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import CheckCircle from 'lucide-react/icons/check-circle';
import ClipboardList from 'lucide-react/icons/clipboard-list';
import { Button } from '@/components/ui/Button';
import { CheckboxGroup, Checkbox } from '@/components/ui/Checkbox';
import { GlassCard } from '@/components/ui/GlassCard';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { PageMeta } from '@/components/seo';
import { useAuth } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SurveyStatus = 'draft' | 'active' | 'closed';
type QuestionType = 'single_choice' | 'multi_choice' | 'likert' | 'open_text' | 'yes_no';

interface SurveyQuestion {
  id: number;
  question_text: string;
  question_type: QuestionType;
  options: string[] | string | null;
  is_required: number | boolean;
  sort_order: number;
}

interface Survey {
  id: number;
  title: string;
  description: string | null;
  status: SurveyStatus;
  is_anonymous: number | boolean;
  ends_at: string | null;
  response_count: number;
  questions?: SurveyQuestion[];
}

type AnswerValue = string | string[];
type AnswerMap = Record<string, AnswerValue>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOptions(raw: string[] | string | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw as string);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Question renderer
// ---------------------------------------------------------------------------

interface QuestionProps {
  question: SurveyQuestion;
  value: AnswerValue | undefined;
  onChange: (val: AnswerValue) => void;
  t: (key: string) => string;
}

function QuestionInput({ question, value, onChange, t }: QuestionProps) {
  const options = parseOptions(question.options);
  const isRequired = Boolean(question.is_required);

  const labelSuffix = isRequired ? (
    <span className="text-danger text-xs ml-1">{t('question_required')}</span>
  ) : null;

  switch (question.question_type) {
    case 'single_choice':
      return (
        <RadioGroup
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v)}
          label={
            <span className="text-sm font-medium">
              {question.question_text}{labelSuffix}
            </span>
          }
          isRequired={isRequired}
        >
          {options.map((opt) => (
            <Radio key={opt} value={opt}>
              {opt}
            </Radio>
          ))}
        </RadioGroup>
      );

    case 'yes_no':
      return (
        <RadioGroup
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v)}
          label={
            <span className="text-sm font-medium">
              {question.question_text}{labelSuffix}
            </span>
          }
          isRequired={isRequired}
          orientation="horizontal"
        >
          <Radio value="yes">{t('yes')}</Radio>
          <Radio value="no">{t('no')}</Radio>
        </RadioGroup>
      );

    case 'multi_choice':
      return (
        <CheckboxGroup
          value={Array.isArray(value) ? value : []}
          onValueChange={(v) => onChange(v)}
          label={
            <span className="text-sm font-medium">
              {question.question_text}{labelSuffix}
            </span>
          }
          isRequired={isRequired}
        >
          {options.map((opt) => (
            <Checkbox key={opt} value={opt}>
              {opt}
            </Checkbox>
          ))}
        </CheckboxGroup>
      );

    case 'likert': {
      const likertLabels: Record<string, string> = {
        '1': t('likert_options.1'),
        '2': t('likert_options.2'),
        '3': t('likert_options.3'),
        '4': t('likert_options.4'),
        '5': t('likert_options.5'),
      };
      return (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            {question.question_text}{labelSuffix}
          </p>
          <RadioGroup
            value={typeof value === 'string' ? value : ''}
            onValueChange={(v) => onChange(v)}
            orientation="horizontal"
            isRequired={isRequired}
            classNames={{ wrapper: 'flex-wrap justify-between gap-2' }}
          >
            {['1', '2', '3', '4', '5'].map((v) => (
              <Radio key={v} value={v} classNames={{ wrapper: 'flex-col items-center' }}>
                <span className="text-xs text-center max-w-16 block leading-tight">
                  {likertLabels[v]}
                </span>
              </Radio>
            ))}
          </RadioGroup>
        </div>
      );
    }

    case 'open_text':
      return (
        <Textarea
          label={
            <span className="text-sm font-medium">
              {question.question_text}{labelSuffix}
            </span>
          }
          value={typeof value === 'string' ? value : ''}
          onValueChange={(v) => onChange(v)}
          variant="bordered"
          minRows={3}
          isRequired={isRequired}
        />
      );

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Survey form view
// ---------------------------------------------------------------------------

interface SurveyFormProps {
  survey: Survey;
  onBack: () => void;
  onSuccess: () => void;
  t: (key: string) => string;
}

function SurveyForm({ survey, onBack, onSuccess, t }: SurveyFormProps) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alreadyResponded, setAlreadyResponded] = useState(false);

  const questions = survey.questions ?? [];

  const setAnswer = (qId: number, val: AnswerValue) =>
    setAnswers((prev) => ({ ...prev, [String(qId)]: val }));

  const handleSubmit = async () => {
    // Validate required questions
    for (const q of questions) {
      if (!q.is_required) continue;
      const val = answers[String(q.id)];
      if (val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
        setError(t('required_error'));
        return;
      }
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post(`/v2/caring-community/surveys/${survey.id}/respond`, {
        answers,
      });
      if (!res.success) {
        const message = res.error ?? '';
        if (message.toLowerCase().includes('already')) {
          setAlreadyResponded(true);
          return;
        }
        setError(message || t('submit_error'));
        return;
      }
      onSuccess();
    } catch (e: unknown) {
      // Check for "already responded" server error
      const msg = e instanceof Error ? e.message : '';
      if (msg.toLowerCase().includes('already')) {
        setAlreadyResponded(true);
      } else {
        setError(t('submit_error'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (alreadyResponded) {
    return (
      <GlassCard className="p-6 flex flex-col items-center gap-4 text-center">
        <CheckCircle size={48} className="text-success" aria-hidden="true" />
        <p className="text-foreground">{t('already_responded')}</p>
        <Button variant="flat" onPress={onBack}>
          {t('back')}
        </Button>
      </GlassCard>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <GlassCard className="p-6">
        <h2 className="text-xl font-bold mb-1">{survey.title}</h2>
        {survey.description && (
          <p className="text-foreground text-sm">{survey.description}</p>
        )}
      </GlassCard>

      {questions.map((q) => (
        <GlassCard key={q.id} className="p-6">
          <QuestionInput
            question={q}
            value={answers[String(q.id)]}
            onChange={(val) => setAnswer(q.id, val)}
            t={t}
          />
        </GlassCard>
      ))}

      {error && (
        <p className="text-danger text-sm px-1" role="alert">{error}</p>
      )}

      <div className="flex gap-3 justify-end">
        <Button variant="flat" onPress={onBack} isDisabled={submitting}>
          {t('back')}
        </Button>
        <Button
          color="primary"
          isLoading={submitting}
          isDisabled={submitting}
          onPress={() => void handleSubmit()}
        >
          {submitting ? t('submitting') : t('submit')}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MunicipalSurveyPage() {
  const { t } = useTranslation('municipality_survey');
  const { isAuthenticated } = useAuth();
  usePageTitle(t('meta.title'));

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Current survey being filled
  const [activeSurvey, setActiveSurvey] = useState<Survey | null>(null);
  const [loadingSurvey, setLoadingSurvey] = useState(false);
  const [succeeded, setSucceeded] = useState(false);

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ data: Survey[] } | Survey[]>(
        '/v2/caring-community/surveys'
      );
      if (!res.success) {
        setError(res.error ?? t('load_error'));
        setSurveys([]);
        return;
      }
      const raw = res.data;
      const list: Survey[] = Array.isArray(raw)
        ? raw
        : (Array.isArray((raw as { data?: Survey[] }).data)
            ? (raw as { data: Survey[] }).data
            : []);
      setSurveys(list);
    } catch (e: unknown) {
      logError('MunicipalSurveyPage.fetchSurveys', e);
      setError(t('load_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchSurveys(); }, [fetchSurveys]);

  const openSurvey = async (survey: Survey) => {
    setLoadingSurvey(true);
    setSucceeded(false);
    try {
      const res = await api.get<{ data: Survey } | Survey>(
        `/v2/caring-community/surveys/${survey.id}`
      );
      if (!res.success) {
        setError(res.error ?? t('load_error'));
        return;
      }
      const raw = res.data;
      if (!raw) return;
      const detail: Survey = 'data' in raw ? (raw as { data: Survey }).data : raw;
      setActiveSurvey(detail);
    } catch (e: unknown) {
      logError('MunicipalSurveyPage.openSurvey', e);
    } finally {
      setLoadingSurvey(false);
    }
  };

  const handleBack = () => {
    setActiveSurvey(null);
    setSucceeded(false);
  };

  const handleSuccess = () => {
    setSucceeded(true);
    // Refetch to update counts
    void fetchSurveys();
  };

  const formatSurveyDate = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(getFormattingLocale(), {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  };

  // ── Success state ──────────────────────────────────────────────────────────
  if (succeeded) {
    return (
      <>
        <PageMeta
          title={t('meta.title')}
          description={t('meta.description')}
        />
        <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col items-center gap-6 text-center">
          <CheckCircle size={64} className="text-success" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{t('success_title')}</h1>
          <p className="text-foreground">{t('success_body')}</p>
          <Button color="primary" variant="flat" onPress={handleBack}>
            {t('back')}
          </Button>
        </div>
      </>
    );
  }

  // ── Survey form ────────────────────────────────────────────────────────────
  if (activeSurvey) {
    return (
      <>
        <PageMeta
          title={t('meta.title')}
          description={t('meta.description')}
        />
        <div className="max-w-2xl mx-auto px-4 py-8">
          <SurveyForm
            survey={activeSurvey}
            onBack={handleBack}
            onSuccess={handleSuccess}
            t={t}
          />
        </div>
      </>
    );
  }

  // ── Survey list ────────────────────────────────────────────────────────────
  return (
    <>
      <PageMeta
        title={t('meta.title')}
        description={t('meta.description')}
      />
      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <ClipboardList size={24} className="text-accent" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{t('meta.title')}</h1>
        </div>
        <p className="text-foreground text-sm">{t('meta.description')}</p>

        {loading && (
          <div role="status" aria-busy="true" aria-label={t('meta.title')} className="flex justify-center py-10">
            <Spinner size="lg" />
          </div>
        )}

        {!loading && error && (
          <p role="alert" className="text-danger text-sm">{error}</p>
        )}

        {!loading && !error && surveys.length === 0 && (
          <GlassCard className="p-8 text-center">
            <p className="text-muted">{t('empty')}</p>
          </GlassCard>
        )}

        {!loading && !error && surveys.length > 0 && surveys.map((survey) => (
          <GlassCard key={survey.id} className="p-6 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <h2 className="text-lg font-semibold leading-tight">{survey.title}</h2>
                {survey.description && (
                  <p className="text-foreground text-sm line-clamp-2">{survey.description}</p>
                )}
                {survey.ends_at && (
                  <p className="text-xs text-muted">
                    {t('closes_on', { date: formatSurveyDate(survey.ends_at) })}
                  </p>
                )}
              </div>
              {isAuthenticated && (
                <Button
                  color="primary"
                  size="sm"
                  isLoading={loadingSurvey}
                  onPress={() => void openSurvey(survey)}
                  className="shrink-0"
                >
                  {t('take_survey')}
                </Button>
              )}
            </div>
          </GlassCard>
        ))}
      </div>
    </>
  );
}
