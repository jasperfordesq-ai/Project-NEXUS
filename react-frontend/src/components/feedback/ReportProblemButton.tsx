// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { type ComponentType, type FormEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Bug from 'lucide-react/icons/bug';
import CircleCheckBig from 'lucide-react/icons/circle-check-big';
import CircleHelp from 'lucide-react/icons/circle-help';
import KeyRound from 'lucide-react/icons/key-round';
import LifeBuoy from 'lucide-react/icons/life-buoy';
import Lightbulb from 'lucide-react/icons/lightbulb';
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
  ModalHeading,
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

export interface ReportProblemDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

const IMPACT_OPTIONS: Impact[] = ['blocked', 'major', 'minor', 'cosmetic'];
const REQUEST_TYPES: RequestType[] = ['broken', 'how_to', 'account', 'suggestion'];

const REQUEST_TYPE_ICONS: Record<RequestType, ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' }>> = {
  broken: Bug,
  how_to: CircleHelp,
  account: KeyRound,
  suggestion: Lightbulb,
};

/**
 * Card-style option for the request-type picker. The HeroUI Radio root is the
 * <label>, so the whole card is the hit target (well over 44px tall), and the
 * focus ring is drawn on the card as well as on the radio control.
 */
const TYPE_CARD_CLASS = [
  'mt-0 h-full rounded-xl border border-[var(--border-default)] bg-[var(--surface-dropdown)] p-3',
  'motion-safe:transition-colors motion-safe:duration-150',
  'hover:border-[var(--text-muted)] hover:bg-theme-hover',
  'data-[selected=true]:border-accent data-[selected=true]:bg-accent/10',
  'data-[focus-visible=true]:outline-2 data-[focus-visible=true]:outline-offset-2 data-[focus-visible=true]:outline-accent',
].join(' ');

/**
 * The "Help & support" form on its own, so every entry point (the floating
 * launcher, the phone menu, the user menu, the error screen) can open the same
 * dialog from its own control without duplicating the form.
 */
export function ReportProblemDialog({ isOpen, onClose }: ReportProblemDialogProps) {
  const { t } = useTranslation('common');
  const toast = useToast();
  // Non-throwing: this dialog renders inside the top-level ErrorBoundary
  // fallback, which sits ABOVE AuthProvider (provided per-route in TenantShell).
  // A throwing useAuth() there re-crashes the fallback and escalates to the bare
  // root boundary. No provider ⇒ treat as unauthenticated (already handled below).
  const isAuthenticated = useAuthOptional()?.isAuthenticated ?? false;
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
    onClose();
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
    <Modal
      isOpen={isOpen}
      onClose={close}
      size="lg"
      placement="center"
      scrollBehavior="inside"
      classNames={{
        wrapper: 'items-stretch p-3 sm:items-center sm:p-6',
        base: 'max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl p-0 sm:max-h-[min(780px,calc(100dvh-3rem))] sm:max-w-[40rem]',
        header: 'shrink-0 border-b border-[var(--border-default)] px-4 py-4 pr-12 sm:px-6',
        body: 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6',
        footer: 'shrink-0 flex-col-reverse items-stretch gap-2 border-t border-[var(--border-default)] px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6',
      }}
    >
      <ModalContent>
        <form data-testid="report-problem-form" className="flex max-h-full min-h-0 flex-col" onSubmit={submit}>
          <ModalHeader className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5">
            <span
              aria-hidden="true"
              className="row-span-2 flex size-10 items-center justify-center rounded-full bg-accent/10 text-[var(--color-primary)]"
            >
              <LifeBuoy className="size-5" />
            </span>
            <ModalHeading className="text-lg font-semibold leading-tight text-theme-primary">
              {t('report_problem.title')}
            </ModalHeading>
            {reference ? null : (
              <p className="text-sm font-normal leading-snug text-theme-secondary">
                {t('report_problem.intro')}
              </p>
            )}
          </ModalHeader>
          <ModalBody data-testid="report-problem-body" className="space-y-4">
            {!isAuthenticated ? (
              <Alert color="warning" title={t('report_problem.auth_title')} description={t('report_problem.auth_description')} />
            ) : null}

            {reference ? (
              <div
                role="status"
                data-testid="report-problem-success"
                className="flex flex-col items-center gap-3 px-2 py-6 text-center"
              >
                <span
                  aria-hidden="true"
                  className="flex size-14 items-center justify-center rounded-full bg-[var(--success-soft)] text-[var(--success-soft-foreground)]"
                >
                  <CircleCheckBig className="size-7" />
                </span>
                <h3 className="text-xl font-semibold text-theme-primary">{t('report_problem.success_title')}</h3>
                <div className="flex flex-col items-center gap-1">
                  <span className="text-sm text-theme-secondary">{t('report_problem.reference_label')}</span>
                  <span className="select-all rounded-lg border border-[var(--border-default)] bg-theme-elevated px-3 py-1.5 font-mono text-base font-semibold tracking-wide text-theme-primary">
                    {reference}
                  </span>
                </div>
                <p className="max-w-sm text-sm leading-relaxed text-theme-secondary">
                  {t('report_problem.success_body')}
                </p>
              </div>
            ) : (
              <RadioGroup
                label={t('report_problem.type_label')}
                value={requestType ?? ''}
                classNames={{ label: 'text-sm font-semibold text-theme-primary' }}
                onValueChange={(value) => {
                  if (REQUEST_TYPES.includes(value as RequestType)) {
                    setRequestType(value as RequestType);
                  }
                }}
              >
                <div className="grid gap-2 sm:grid-cols-2" data-testid="report-problem-types">
                  {REQUEST_TYPES.map((type) => {
                    const Icon = REQUEST_TYPE_ICONS[type];
                    return (
                      <Radio
                        key={type}
                        value={type}
                        className={TYPE_CARD_CLASS}
                        classNames={{
                          label: 'font-medium text-theme-primary',
                          description: 'text-sm text-theme-secondary',
                        }}
                        description={t(`report_problem.types.${type}.description`)}
                      >
                        <span className="inline-flex items-center gap-2">
                          <Icon className="size-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                          {t(`report_problem.types.${type}.label`)}
                        </span>
                      </Radio>
                    );
                  })}
                </div>
              </RadioGroup>
            )}

            {requestType && !reference ? (
              <div className="space-y-4">
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
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter data-testid="report-problem-footer">
            {reference ? (
              // Once sent, only the confirmation (with its reference) is left on screen.
              // Footer buttons are full width on phones (a thumb-sized target), inline from `sm`.
              <Button type="button" onPress={close} className="min-h-11 w-full sm:w-auto">
                {t('report_problem.close')}
              </Button>
            ) : (
              <>
                <Button type="button" variant="tertiary" onPress={close} className="min-h-11 w-full sm:w-auto">
                  {t('report_problem.cancel')}
                </Button>
                <Button
                  type="submit"
                  isDisabled={!canSubmit}
                  isLoading={isSubmitting}
                  className="min-h-11 w-full sm:w-auto"
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
  );
}

/** A labelled "Help & support" button that opens the dialog — used on the error screen. */
export function ReportProblemButton({ className, mode = 'button' }: ReportProblemButtonProps) {
  const { t } = useTranslation('common');
  const [isOpen, setIsOpen] = useState(false);

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

      <ReportProblemDialog isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
