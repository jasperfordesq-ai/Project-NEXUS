import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Select, SelectItem } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';import ArrowLeft from 'lucide-react/icons/arrow-left';
import CheckCircle from 'lucide-react/icons/circle-check';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';

type Category =
  | 'inappropriate_behavior'
  | 'financial_concern'
  | 'exploitation'
  | 'neglect'
  | 'medical_concern'
  | 'other';

type Severity = 'low' | 'medium' | 'high' | 'critical';

const SEVERITY_SLA_HOURS: Record<Severity, number> = {
  critical: 4,
  high: 24,
  medium: 72,
  low: 168,
};

export default function SafeguardingReportPage(): ReactNode {
  const { t } = useTranslation('common');
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();
  usePageTitle(t('safeguarding_reports.submit.meta.title'));

  const [category, setCategory] = useState<Category | ''>('');
  const [severity, setSeverity] = useState<Severity>('medium');
  const [description, setDescription] = useState('');
  const [subjectUserId, setSubjectUserId] = useState('');
  const [subjectOrganisationId, setSubjectOrganisationId] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categories: Category[] = useMemo(
    () => [
      'inappropriate_behavior',
      'financial_concern',
      'exploitation',
      'neglect',
      'medical_concern',
      'other',
    ],
    [],
  );

  const severities: Severity[] = useMemo(
    () => ['critical', 'high', 'medium', 'low'],
    [],
  );

  if (!hasFeature('caring_community')) {
    return <Navigate to={tenantPath('/caring-community')} replace />;
  }

  const charCount = description.length;
  const charLimit = 2000;

  const handleSubmit = async () => {
    setError(null);
    if (!category || !description.trim()) return;

    setSubmitting(true);
    try {
      const response = await api.post('/v2/caring-community/safeguarding/report', {
        category,
        severity,
        description: description.trim(),
        subject_user_id: subjectUserId.trim() ? Number(subjectUserId.trim()) : undefined,
        subject_organisation_id: subjectOrganisationId.trim()
          ? Number(subjectOrganisationId.trim())
          : undefined,
        evidence_url: evidenceUrl.trim() || undefined,
      });
      if (!response.success) {
        setError(response.error || t('safeguarding_reports.submit.errors.submit_failed'));
        return;
      }
      setSubmitted(true);
    } catch {
      setError(t('safeguarding_reports.submit.errors.submit_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <>
        <PageMeta
          title={t('safeguarding_reports.submit.meta.title')}
          description={t('safeguarding_reports.submit.meta.description')}
          noIndex
        />
        <div className="mx-auto max-w-xl">
          <GlassCard className="p-8 text-center">
            <div className="mb-4 flex justify-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
                <CheckCircle className="h-8 w-8 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-theme-primary">
              {t('safeguarding_reports.submit.success.title')}
            </h1>
            <p className="mt-3 text-base leading-7 text-theme-muted">
              {t('safeguarding_reports.submit.success.body', { hours: SEVERITY_SLA_HOURS[severity] })}
            </p>
            <div className="mt-6 flex flex-col items-center gap-2">
              <Button
                color="primary"
                onPress={() => navigate(tenantPath('/caring-community/safeguarding/my-reports'))}
              >
                {t('safeguarding_reports.submit.success.view_my_reports')}
              </Button>
              <Button
                as={Link}
                to={tenantPath('/caring-community')}
                variant="light"
                startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              >
                {t('safeguarding_reports.back')}
              </Button>
            </div>
          </GlassCard>
        </div>
      </>
    );
  }

  return (
    <>
      <PageMeta
        title={t('safeguarding_reports.submit.meta.title')}
        description={t('safeguarding_reports.submit.meta.description')}
        noIndex
      />
      <div className="mx-auto max-w-2xl">
        <div className="mb-4">
          <Button
            as={Link}
            to={tenantPath('/caring-community')}
            variant="light"
            size="sm"
            startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
          >
            {t('safeguarding_reports.back')}
          </Button>
        </div>

        <GlassCard className="p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-4">
            <div className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-rose-500/15">
              <ShieldAlert className="h-6 w-6 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-theme-primary">
                {t('safeguarding_reports.submit.title')}
              </h1>
              <p className="mt-1 text-sm leading-6 text-theme-muted">
                {t('safeguarding_reports.submit.subtitle')}
              </p>
            </div>
          </div>

          <div className="mb-6 flex items-start gap-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            <p className="text-sm leading-6 text-emerald-900 dark:text-emerald-100">
              {t('safeguarding_reports.submit.confidentiality')}
            </p>
          </div>

          <div className="space-y-5">
            <Select
              label={t('safeguarding_reports.submit.form.category_label')}
              variant="bordered"
              selectedKeys={category ? [category] : []}
              onChange={(e) => setCategory((e.target.value as Category) || '')}
              isRequired
            >
              {categories.map((c) => (
                <SelectItem key={c} id={c}>
                  {t(`safeguarding_reports.submit.form.categories.${c}`)}
                </SelectItem>
              ))}
            </Select>

            <Select
              label={t('safeguarding_reports.submit.form.severity_label')}
              variant="bordered"
              selectedKeys={[severity]}
              onChange={(e) => setSeverity((e.target.value as Severity) || 'medium')}
              isRequired
            >
              {severities.map((s) => (
                <SelectItem key={s} id={s}>
                  {t(`safeguarding_reports.submit.form.severities.${s}`)}
                </SelectItem>
              ))}
            </Select>

            <div>
              <Textarea
                label={t('safeguarding_reports.submit.form.description_label')}
                placeholder={t('safeguarding_reports.submit.form.description_placeholder')}
                variant="bordered"
                minRows={5}
                maxRows={12}
                value={description}
                onValueChange={setDescription}
                isRequired
                maxLength={charLimit}
              />
              <p className="mt-1 text-right text-xs text-theme-muted">
                {charCount} / {charLimit}
              </p>
            </div>

            <Input
              label={t('safeguarding_reports.submit.form.subject_user_label')}
              variant="bordered"
              type="number"
              value={subjectUserId}
              onValueChange={setSubjectUserId}
            />

            <Input
              label={t('safeguarding_reports.submit.form.subject_org_label')}
              variant="bordered"
              type="number"
              value={subjectOrganisationId}
              onValueChange={setSubjectOrganisationId}
            />

            <Input
              label={t('safeguarding_reports.submit.form.evidence_label')}
              variant="bordered"
              placeholder={t('safeguarding_reports.submit.form.evidence_placeholder')}
              value={evidenceUrl}
              onValueChange={setEvidenceUrl}
            />

            {error && (
              <div role="alert" className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-theme-danger">
                {error}
              </div>
            )}

            <Button
              color="primary"
              size="lg"
              fullWidth
              onPress={handleSubmit}
              isDisabled={!category || !description.trim() || submitting}
              isLoading={submitting}
            >
              {submitting
                ? t('safeguarding_reports.submit.form.submitting')
                : t('safeguarding_reports.submit.form.submit')}
            </Button>
          </div>
        </GlassCard>
      </div>
    </>
  );
}
