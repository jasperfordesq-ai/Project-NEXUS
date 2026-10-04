import { getFormattingLocale } from '@/lib/helpers';
import { Button, Input, Card, CardBody, Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter, RadioGroup, Radio } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Resend Modal
 * Resend workflow - modal component for re-sending newsletters to targeted recipients
 */

import { useState, useEffect } from 'react';

import Mail from 'lucide-react/icons/mail';
import Users from 'lucide-react/icons/users';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts';
import { adminNewsletters } from '../../api/adminApi';
import type { ResendInfo } from '../../api/types';

interface NewsletterResendProps {
  isOpen: boolean;
  onClose: () => void;
  newsletterId: number;
  onSuccess?: () => void;
}

export function NewsletterResend({ isOpen, onClose, newsletterId, onSuccess }: NewsletterResendProps) {
  const { t } = useTranslation('admin_newsletters');
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [info, setInfo] = useState<ResendInfo | null>(null);
  const [target, setTarget] = useState<'non_openers' | 'non_clickers' | 'segment'>('non_openers');
  const [subjectOverride, setSubjectOverride] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    const loadInfo = async () => {
      setLoading(true);
      try {
        const res = await adminNewsletters.getResendInfo(newsletterId);
        if (res.success && res.data) {
          setInfo(res.data as ResendInfo);
        }
      } catch {
        toast.error(t('newsletters.failed_to_load_resend_info'));
      }
      setLoading(false);
    };

    loadInfo();
  }, [isOpen, newsletterId, toast, t])

  const handleResend = async () => {
    if (!info) return;

    setSending(true);
    try {
      const res = await adminNewsletters.resend(newsletterId, {
        target,
        subject_override: subjectOverride || undefined,
      });

      if (res.success) {
        const data = res.data as { queued_count?: number };
        toast.success(t('newsletters.resend_queued_count', { count: data.queued_count ?? 0 }));
        onSuccess?.();
        onClose();
      } else {
        toast.error(t('newsletters.failed_to_queue_resend'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_queue_resend'));
    }
    setSending(false);
  };

  const getRecipientCount = () => {
    if (!info) return 0;
    switch (target) {
      case 'non_openers': return info.non_openers_count;
      case 'non_clickers': return info.non_clickers_count;
      default: return 0;
    }
  };

  const recipientCount = getRecipientCount();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      scrollBehavior="inside"
    >
      <ModalContent>
        {(onModalClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <ModalHeading className="flex items-center gap-2">
                <Mail size={20} />
                <span>{t('newsletter_resend.resend_newsletter')}</span>
              </ModalHeading>
              <p className="text-sm font-normal text-muted">
                {t('newsletter_resend.subtitle')}
              </p>
            </ModalHeader>
            <ModalBody>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-muted">{t('newsletter_resend.loading')}</div>
                </div>
              ) : info ? (
                <div className="space-y-4">
                  <Card>
                    <CardBody className="gap-2">
                      <div className="grid grid-cols-3 gap-4 text-center">
                        <div>
                          <p className="text-sm text-muted">{t('newsletter_resend.total_sent')}</p>
                          <p className="text-2xl font-bold">{info.total_sent.toLocaleString(getFormattingLocale())}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted">{t('newsletter_resend.opened')}</p>
                          <p className="text-2xl font-bold text-success">{info.total_opened.toLocaleString(getFormattingLocale())}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted">{t('newsletter_resend.clicked')}</p>
                          <p className="text-2xl font-bold text-accent">{info.total_clicked.toLocaleString(getFormattingLocale())}</p>
                        </div>
                      </div>
                    </CardBody>
                  </Card>

                  <RadioGroup
                    label={t('newsletter_resend.resend_to')}
                    value={target}
                    onValueChange={(v) => setTarget(v as typeof target)}
                  >
                    <Radio value="non_openers">
                      <div className="flex flex-col gap-1">
                        <span>{t('newsletter_resend.non_openers')}</span>
                        <span className="text-xs text-muted">
                          {t('newsletter_resend.non_openers_count', { count: info.non_openers_count })}
                        </span>
                      </div>
                    </Radio>
                    <Radio value="non_clickers">
                      <div className="flex flex-col gap-1">
                        <span>{t('newsletter_resend.non_clickers')}</span>
                        <span className="text-xs text-muted">
                          {t('newsletter_resend.non_clickers_count', { count: info.non_clickers_count })}
                        </span>
                      </div>
                    </Radio>
                  </RadioGroup>

                  <Input
                    label={t('newsletter_resend.subject_override')}
                    placeholder={t('newsletter_resend.subject_override_placeholder')}
                    value={subjectOverride}
                    onValueChange={setSubjectOverride}
                    description={t('newsletter_resend.subject_override_desc')}
                  />

                  <Card className="bg-surface-secondary">
                    <CardBody className="flex-row items-center gap-3">
                      <Users size={20} className="text-accent" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{t('newsletter_resend.preview_recipient_count')}</p>
                        <p className="text-xs text-muted">
                          {t('newsletter_resend.preview_recipient_count_desc', { count: recipientCount })}
                        </p>
                      </div>
                    </CardBody>
                  </Card>

                  {recipientCount === 0 && (
                    <Card className="bg-warning/10">
                      <CardBody className="flex-row items-center gap-3">
                        <AlertCircle size={20} className="text-warning" />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-warning">{t('newsletter_resend.no_recipients')}</p>
                          <p className="text-xs text-warning-soft-foreground">
                            {t('newsletter_resend.no_recipients_desc')}
                          </p>
                        </div>
                      </CardBody>
                    </Card>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-8">
                  <div className="text-danger">{t('newsletter_resend.failed_to_load')}</div>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={onModalClose}>
                {t('newsletter_resend.cancel')}
              </Button>
              <Button
                onPress={handleResend}
                isLoading={sending}
                isDisabled={!info || recipientCount === 0 || loading}
              >
                {t('newsletter_resend.queue_resend')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default NewsletterResend;
