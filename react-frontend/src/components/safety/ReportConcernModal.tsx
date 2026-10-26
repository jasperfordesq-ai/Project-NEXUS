// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * ReportConcernModal — lets a member report another member, or a direct
 * message they received, to their community's coordinators.
 *
 * POST /v2/users/{id}/report    { category, details? }
 * POST /v2/messages/{id}/report { category, details? }
 *
 * The server translates its own refusal messages, so they are shown as sent.
 * An existing open report (409 ALREADY_REPORTED) is information, not an error.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Flag from 'lucide-react/icons/flag';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Textarea } from '@/components/ui/Textarea';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

export const REPORT_CONCERN_CATEGORIES = [
  'safeguarding_concern',
  'harassment',
  'inappropriate',
  'scam_or_fraud',
  'spam',
  'other',
] as const;

export type ReportConcernCategory = (typeof REPORT_CONCERN_CATEGORIES)[number];
export type ReportConcernTargetKind = 'member' | 'message';

export const REPORT_DETAILS_MAX = 2000;

export interface ReportConcernModalProps {
  targetKind: ReportConcernTargetKind;
  targetId: number;
  /** Display name of the member being reported (used in the member heading). */
  targetName?: string | null;
  isOpen: boolean;
  onClose: () => void;
  /** Called after the report is accepted (or was already on file). */
  onReported?: () => void;
}

type Outcome =
  | { kind: 'none' }
  | { kind: 'sent' }
  | { kind: 'already'; message: string }
  | { kind: 'error'; message: string };

export function ReportConcernModal({
  targetKind,
  targetId,
  targetName,
  isOpen,
  onClose,
  onReported,
}: ReportConcernModalProps) {
  const { t } = useTranslation('common');
  const toast = useToast();
  const [category, setCategory] = useState<string>('');
  const [details, setDetails] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [categoryError, setCategoryError] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' });

  // Start fresh every time the dialog opens.
  useEffect(() => {
    if (isOpen) {
      setCategory('');
      setDetails('');
      setIsSubmitting(false);
      setCategoryError(false);
      setDetailsError(false);
      setOutcome({ kind: 'none' });
    }
  }, [isOpen, targetId, targetKind]);

  const detailsRequired = category === 'other';
  const isFinished = outcome.kind === 'sent' || outcome.kind === 'already';

  const handleSubmit = async () => {
    if (isSubmitting) return;
    const trimmed = details.trim();
    const missingCategory = !category;
    const missingDetails = category === 'other' && trimmed === '';
    setCategoryError(missingCategory);
    setDetailsError(missingDetails);
    if (missingCategory || missingDetails) return;

    setIsSubmitting(true);
    setOutcome({ kind: 'none' });
    try {
      const endpoint = targetKind === 'member'
        ? `/v2/users/${targetId}/report`
        : `/v2/messages/${targetId}/report`;
      const payload: { category: string; details?: string } = { category };
      if (trimmed) payload.details = trimmed;

      const response = await api.post<{ reported: boolean; report_id: number }>(endpoint, payload);
      if (response.success) {
        setOutcome({ kind: 'sent' });
        onReported?.();
      } else if (response.code === 'ALREADY_REPORTED') {
        setOutcome({ kind: 'already', message: response.error || t('member_report.already_reported') });
        onReported?.();
      } else {
        setOutcome({ kind: 'error', message: response.error || t('member_report.error_generic') });
      }
    } catch (err) {
      logError('Failed to send member concern report', err);
      const message = t('member_report.error_generic');
      setOutcome({ kind: 'error', message });
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const heading = targetKind === 'member'
    ? t('member_report.title_member', { name: targetName || t('member_report.member_fallback') })
    : t('member_report.title_message');

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2 text-theme-primary">
          <Flag className="h-5 w-5 text-[var(--color-danger)]" aria-hidden="true" />
          {heading}
        </ModalHeader>
        <ModalBody className="gap-4">
          {outcome.kind === 'sent' ? (
            <div role="status">
              <Alert color="success" description={t('member_report.success')} />
            </div>
          ) : outcome.kind === 'already' ? (
            <div role="status">
              <Alert color="primary" description={outcome.message} />
            </div>
          ) : (
            <>
              <p className="text-sm text-theme-muted">{t('member_report.reassurance')}</p>
              <RadioGroup
                label={t('member_report.reason_label')}
                value={category}
                onValueChange={(value) => {
                  setCategory(value);
                  setCategoryError(false);
                  if (value !== 'other') setDetailsError(false);
                }}
                isInvalid={categoryError}
                errorMessage={categoryError ? t('member_report.reason_required_error') : undefined}
                classNames={{ label: 'text-theme-secondary' }}
              >
                {REPORT_CONCERN_CATEGORIES.map((code) => (
                  <Radio
                    key={code}
                    value={code}
                    description={t(`member_report.categories.${code}.help`)}
                    color={code === 'safeguarding_concern' ? 'danger' : undefined}
                  >
                    {t(`member_report.categories.${code}.label`)}
                  </Radio>
                ))}
              </RadioGroup>
              <Textarea
                label={detailsRequired ? t('member_report.details_label_required') : t('member_report.details_label')}
                placeholder={t('member_report.details_placeholder')}
                value={details}
                onValueChange={(value) => {
                  setDetails(value);
                  if (value.trim()) setDetailsError(false);
                }}
                maxLength={REPORT_DETAILS_MAX}
                isRequired={detailsRequired}
                isInvalid={detailsError}
                errorMessage={detailsError ? t('member_report.details_required_error') : undefined}
                description={`${details.length}/${REPORT_DETAILS_MAX}`}
                variant="secondary"
                minRows={3}
                classNames={{ label: 'text-theme-secondary' }}
              />
              {outcome.kind === 'error' ? (
                <div role="alert">
                  <Alert color="danger" description={outcome.message} />
                </div>
              ) : null}
            </>
          )}
          <p className="text-sm font-medium text-theme-secondary">{t('member_report.emergency')}</p>
        </ModalBody>
        <ModalFooter>
          {isFinished ? (
            <Button variant="primary" onPress={onClose}>
              {t('member_report.close')}
            </Button>
          ) : (
            <>
              <Button variant="tertiary" onPress={onClose} isDisabled={isSubmitting}>
                {t('member_report.cancel')}
              </Button>
              <Button
                variant="danger"
                onPress={() => void handleSubmit()}
                isLoading={isSubmitting}
                isDisabled={isSubmitting}
              >
                {t('member_report.submit')}
              </Button>
            </>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default ReportConcernModal;
