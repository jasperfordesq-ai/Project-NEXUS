// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import LifeBuoy from 'lucide-react/icons/life-buoy';
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
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  Textarea,
} from '@/components/ui';
import { useAuthOptional, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { getSupportDiagnosticsSnapshot, getSupportReportLocation } from '@/lib/supportDiagnostics';

type Impact = 'blocked' | 'major' | 'minor' | 'cosmetic';

/**
 * The four kinds of "Help & support" request. They match the Jira help desk's
 * request types, and the server's SupportReportController::REQUEST_TYPES.
 * Only 'broken' asks for an impact and may carry technical diagnostics.
 */
type RequestType = 'broken' | 'how_to' | 'account' | 'suggestion';

interface ReportProblemResponse {
  report: {
    id: number;
    reference: string;
    request_type?: RequestType;
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
const REQUEST_TYPES: RequestType[] = ['broken', 'how_to', 'account', 'suggestion'];

export function ReportProblemButton({ className, mode = 'button' }: ReportProblemButtonProps) {
  const { t } = useTranslation('common');
  const toast = useToast();
  // Non-throwing: this button renders inside the top-level ErrorBoundary
  // fallback, which sits ABOVE AuthProvider (provided per-route in TenantShell).
  // A throwing useAuth() there re-crashes the fallback and escalates to the bare
  // root boundary. No provider ⇒ treat as unauthenticated (already handled below).
  const isAuthenticated = useAuthOptional()?.isAuthenticated ?? false;
  const [isOpen, setIsOpen] = useState(false);
  const [requestType, setRequestType] = useState<RequestType | null>(null);
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState<Impact>('minor');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const isBroken = requestType === 'broken';

  const canSubmit = useMemo(
    () => isAuthenticated
      && requestType !== null
      && summary.trim().length >= 3
      && description.trim().length >= 10
      && !isSubmitting,
    [description, isAuthenticated, isSubmitting, requestType, summary],
  );

  const resetForm = () => {
    setRequestType(null);
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
    if (!canSubmit || requestType === null) {
      return;
    }

    setIsSubmitting(true);
    const sendDiagnostics = isBroken && includeDiagnostics;
    const diagnostics = sendDiagnostics ? getSupportDiagnosticsSnapshot() : undefined;
    // Path only — never the query string or fragment, which can carry
    // sign-in and reset tokens into a staff-readable record (F-281).
    const location = getSupportReportLocation();
    const pageUrl = location.pageUrl ?? undefined;
    const route = location.route ?? undefined;

    // A Sentry event only makes sense for something that is not working; a
    // question or a suggestion is not an error.
    let sentryEventId: string | undefined;
    if (isBroken) {
      const { captureSentryMessage } = await import('@/lib/sentry');
      sentryEventId = captureSentryMessage('Support report submitted', 'info', {
        impact,
        route,
        page_url: pageUrl,
        has_diagnostics: sendDiagnostics,
      }) ?? undefined;
    }

    const response = await api.post<ReportProblemResponse>('/v2/support/reports', {
      request_type: requestType,
      summary: summary.trim(),
      description: description.trim(),
      ...(isBroken ? { impact } : {}),
      page_url: pageUrl,
      route,
      sentry_event_id: sentryEventId,
      include_diagnostics: sendDiagnostics,
      diagnostics,
    });
    setIsSubmitting(false);

    if (!response.success || !response.data?.report) {
      toast.error(response.error || t('report_problem.submit_failed'));
      return;
    }

    const report = response.data.report;
    setReference(report.reference);
    if (isBroken) {
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
    }
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
        startContent={<LifeBuoy className={mode === 'footer-link' ? 'h-3.5 w-3.5' : 'h-4 w-4'} aria-hidden="true" />}
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

              {reference ? null : (
                <RadioGroup
                  label={t('report_problem.type_label')}
                  value={requestType ?? ''}
                  onValueChange={(value) => {
                    if (REQUEST_TYPES.includes(value as RequestType)) {
                      setRequestType(value as RequestType);
                    }
                  }}
                >
                  {REQUEST_TYPES.map((type) => (
                    <Radio key={type} value={type} description={t(`report_problem.types.${type}.description`)}>
                      {t(`report_problem.types.${type}.label`)}
                    </Radio>
                  ))}
                </RadioGroup>
              )}

              {requestType && !reference ? (
                <>
                  <Input
                    isRequired
                    label={t(`report_problem.fields.${requestType}.summary`)}
                    value={summary}
                    maxLength={180}
                    onValueChange={setSummary}
                  />

                  <Textarea
                    isRequired
                    label={t(`report_problem.fields.${requestType}.description`)}
                    value={description}
                    minRows={5}
                    maxLength={5000}
                    onValueChange={setDescription}
                  />

                  {isBroken ? (
                    <>
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
                    </>
                  ) : null}
                </>
              ) : null}
            </ModalBody>
            <ModalFooter data-testid="report-problem-footer">
              {reference ? (
                // Once sent, only the confirmation (with its reference) is left on screen.
                <Button type="button" onPress={close}>
                  {t('report_problem.close')}
                </Button>
              ) : (
                <>
                  <Button type="button" variant="tertiary" onPress={close}>
                    {t('report_problem.cancel')}
                  </Button>
                  <Button
                    type="submit"
                    isDisabled={!canSubmit}
                    isLoading={isSubmitting}
                    startContent={!isSubmitting ? <Send className="h-4 w-4" aria-hidden="true" /> : undefined}
                  >
                    {t('report_problem.submit')}
                  </Button>
                </>
              )}
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </>
  );
}
