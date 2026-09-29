// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Bug from 'lucide-react/icons/bug';
import Send from 'lucide-react/icons/send';

import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
} from '@/components/ui';
import { useAuthOptional, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getSupportDiagnosticsSnapshot, getSupportReportLocation } from '@/lib/supportDiagnostics';

type Impact = 'blocked' | 'major' | 'minor' | 'cosmetic';

interface ReportProblemResponse {
  report: {
    id: number;
    reference: string;
    status: string;
    impact: Impact;
    summary: string;
    created_at?: string;
  };
}

interface ReportProblemButtonProps {
  className?: string;
  mode?: 'button' | 'footer-link';
}

const IMPACT_OPTIONS: Impact[] = ['blocked', 'major', 'minor', 'cosmetic'];

export function ReportProblemButton({ className, mode = 'button' }: ReportProblemButtonProps) {
  const { t } = useTranslation('common');
  const toast = useToast();
  // Non-throwing: this button renders inside the top-level ErrorBoundary
  // fallback, which sits ABOVE AuthProvider (provided per-route in TenantShell).
  // A throwing useAuth() there re-crashes the fallback and escalates to the bare
  // root boundary. No provider ⇒ treat as unauthenticated (already handled below).
  const isAuthenticated = useAuthOptional()?.isAuthenticated ?? false;
  const [isOpen, setIsOpen] = useState(false);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState<Impact>('minor');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const canSubmit = useMemo(
    () => isAuthenticated && summary.trim().length >= 3 && description.trim().length >= 10 && !isSubmitting,
    [description, isAuthenticated, isSubmitting, summary],
  );

  const resetForm = () => {
    setSummary('');
    setDescription('');
    setImpact('minor');
    setIncludeDiagnostics(true);
    setReference(null);
  };

  const close = () => {
    setIsOpen(false);
    resetForm();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    const diagnostics = includeDiagnostics ? getSupportDiagnosticsSnapshot() : undefined;
    // Path only — never the query string or fragment, which can carry
    // sign-in and reset tokens into a staff-readable record (F-281).
    const location = getSupportReportLocation();
    const pageUrl = location.pageUrl ?? undefined;
    const route = location.route ?? undefined;
    const { captureSentryMessage } = await import('@/lib/sentry');
    const sentryEventId = captureSentryMessage('Support report submitted', 'info', {
      impact,
      route,
      page_url: pageUrl,
      has_diagnostics: includeDiagnostics,
    });
    const response = await api.post<ReportProblemResponse>('/v2/support/reports', {
      summary: summary.trim(),
      description: description.trim(),
      impact,
      page_url: pageUrl,
      route,
      sentry_event_id: sentryEventId ?? undefined,
      include_diagnostics: includeDiagnostics,
      diagnostics,
    });
    setIsSubmitting(false);

    if (!response.success || !response.data?.report) {
      toast.error(response.error || t('report_problem.submit_failed'));
      return;
    }

    const report = response.data.report;
    setReference(report.reference);
    void import('@/lib/sentry').then(({ captureSentryFeedback }) => {
      captureSentryFeedback({
        message: `${report.reference}: ${report.summary}`,
        source: 'support_report',
        associatedEventId: sentryEventId,
        url: pageUrl,
        tags: {
          support_report_reference: report.reference,
          impact: report.impact,
        },
      });
    });
    toast.success(t('report_problem.submit_success'));
  };

  return (
    <>
      <Button
        type="button"
        variant={mode === 'footer-link' ? 'tertiary' : 'secondary'}
        size={mode === 'footer-link' ? 'sm' : 'md'}
        onPress={() => setIsOpen(true)}
        className={className}
        startContent={<Bug className={mode === 'footer-link' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />}
      >
        {t('report_problem.trigger')}
      </Button>

      <Modal
        isOpen={isOpen}
        onClose={close}
        size="lg"
        placement="center"
        scrollBehavior="inside"
        classNames={{
          wrapper: 'items-stretch p-3 sm:items-center sm:p-6',
          base: 'max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-hidden rounded-lg p-0 sm:max-h-[min(760px,calc(100dvh-3rem))]',
          header: 'shrink-0 px-4 py-4 pr-12 sm:px-6',
          body: 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 sm:px-6',
          footer: 'shrink-0 flex-col-reverse items-stretch gap-2 px-4 py-4 sm:flex-row sm:items-center sm:px-6',
        }}
      >
        <ModalContent>
          <form data-testid="report-problem-form" className="flex max-h-full min-h-0 flex-col" onSubmit={submit}>
            <ModalHeader>{t('report_problem.title')}</ModalHeader>
            <ModalBody data-testid="report-problem-body" className="space-y-4">
              {!isAuthenticated ? (
                <Alert color="warning" title={t('report_problem.auth_title')} description={t('report_problem.auth_description')} />
              ) : null}

              {reference ? (
                <Alert
                  color="success"
                  title={t('report_problem.success_title')}
                  description={t('report_problem.success_description', { reference })}
                />
              ) : null}

              <Input
                isRequired
                label={t('report_problem.summary_label')}
                value={summary}
                maxLength={180}
                onValueChange={setSummary}
              />

              <Textarea
                isRequired
                label={t('report_problem.description_label')}
                value={description}
                minRows={5}
                maxLength={5000}
                onValueChange={setDescription}
              />

              <Select
                label={t('report_problem.impact_label')}
                value={impact}
                onValueChange={(value) => {
                  if (IMPACT_OPTIONS.includes(value as Impact)) {
                    setImpact(value as Impact);
                  }
                }}
              >
                {IMPACT_OPTIONS.map((option) => (
                  <SelectItem key={option} id={option}>
                    {t(`report_problem.impact.${option}`)}
                  </SelectItem>
                ))}
              </Select>

              <Checkbox isSelected={includeDiagnostics} onValueChange={setIncludeDiagnostics}>
                {t('report_problem.include_diagnostics')}
              </Checkbox>
            </ModalBody>
            <ModalFooter data-testid="report-problem-footer">
              <Button type="button" variant="tertiary" onPress={close}>
                {t('report_problem.cancel')}
              </Button>
              <Button
                type="submit"
                isDisabled={!canSubmit || Boolean(reference)}
                isLoading={isSubmitting}
                startContent={!isSubmitting ? <Send className="h-4 w-4" aria-hidden="true" /> : undefined}
              >
                {t('report_problem.submit')}
              </Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}
