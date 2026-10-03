// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessageQuickView — read and review a message copy without leaving the list.
 *
 * Opens on a list row, fetches the full copy (body and conversation) and lets
 * the broker mark it reviewed with optional notes. Both people's names open
 * the member window. Extracted from the Messages page in October 2026.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import MessageSquare from 'lucide-react/icons/message-square';

import { useToast } from '@/contexts';
import { formatServerDateTime } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import type { BrokerMessage, BrokerMessageDetail } from '@/admin/api/types';
import {
  Avatar,
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Separator,
  Textarea,
} from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { BrokerStatusChip } from '../BrokerStatusChip';
import { copyReasonLabel } from './messageLabels';

interface MessageQuickViewProps {
  /** The list row to show; null keeps the dialog closed. */
  item: BrokerMessage | null;
  onClose: () => void;
  /** Called after the copy has been marked reviewed. */
  onReviewed: () => void;
}

export function MessageQuickView({ item, onClose, onReviewed }: MessageQuickViewProps) {
  const { t } = useTranslation('broker');
  const toast = useToast();
  const [detail, setDetail] = useState<BrokerMessageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [reviewing, setReviewing] = useState(false);

  const itemId = item?.id ?? null;

  useEffect(() => {
    if (itemId === null) {
      setDetail(null);
      setNotes('');
      return;
    }
    let cancelled = false;
    setDetail(null);
    setNotes('');
    setLoading(true);
    adminBroker
      .showMessage(itemId)
      .then((res) => {
        if (!cancelled && res.success && res.data) setDetail(res.data as BrokerMessageDetail);
      })
      .catch(() => {
        // Fall back to the list row's own fields.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const review = useCallback(async () => {
    if (!item) return;
    setReviewing(true);
    try {
      const res = await adminBroker.reviewMessage(item.id, notes || undefined);
      if (res?.success) {
        toast.success(t('messages.reviewed_success'));
        onClose();
        onReviewed();
      } else {
        toast.error(res?.error || t('messages.review_failed'));
      }
    } catch {
      toast.error(t('messages.review_failed'));
    } finally {
      setReviewing(false);
    }
  }, [item, notes, onClose, onReviewed, toast, t]);

  const isReviewed = !!item?.reviewed_at;

  return (
    <Modal isOpen={!!item} onClose={onClose} size="2xl" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <MessageSquare size={18} className="shrink-0 text-accent" aria-hidden="true" />
          <span>{t('messages.quick_view_title')}</span>
        </ModalHeader>

        <ModalBody className="gap-4">
          {loading && <p className="py-8 text-center text-sm text-muted">{t('messages.loading')}</p>}

          {!loading && item && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium uppercase text-muted">{t('messages.detail_from')}</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={item.sender_name} size="sm" className="shrink-0" />
                    <MemberName userId={item.sender_id} name={item.sender_name} className="truncate" />
                  </div>
                </div>
                <div className="min-w-0">
                  <p className="mb-1 text-xs font-medium uppercase text-muted">{t('messages.detail_to')}</p>
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar name={item.receiver_name} size="sm" className="shrink-0" />
                    <MemberName userId={item.receiver_id} name={item.receiver_name} className="truncate" />
                  </div>
                </div>
                <div>
                  <p className="mb-0.5 text-xs font-medium uppercase text-muted">{t('messages.detail_date')}</p>
                  <p className="tabular-nums text-foreground">{formatServerDateTime(item.sent_at ?? item.created_at)}</p>
                </div>
                {(item.flag_reason || item.copy_reason) && (
                  <div>
                    <p className="mb-0.5 text-xs font-medium uppercase text-muted">{t('messages.detail_reason')}</p>
                    <p className="text-foreground">{item.flag_reason || copyReasonLabel(t, item.copy_reason)}</p>
                  </div>
                )}
                {item.flag_severity && (
                  <div>
                    <p className="mb-0.5 text-xs font-medium uppercase text-muted">{t('messages.detail_severity')}</p>
                    <BrokerStatusChip status={item.flag_severity} />
                  </div>
                )}
              </div>

              <Separator />

              <div>
                <p className="mb-2 text-xs font-medium uppercase text-muted">{t('messages.content_label')}</p>
                <div className="min-h-[80px] whitespace-pre-wrap rounded-lg bg-surface-secondary p-4 text-sm leading-relaxed text-foreground">
                  {detail?.copy?.message_body || item.message_body || '--'}
                </div>
              </div>

              {detail?.thread && detail.thread.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase text-muted">
                      {t('messages.conversation_label')} ({detail.thread.length})
                    </p>
                    <div className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {detail.thread.map((msg) => (
                        <div key={msg.id} className="rounded-md bg-surface-secondary px-3 py-2 text-sm">
                          <MemberName userId={msg.sender_id} name={msg.sender_name} className="mr-2" />
                          <span className="text-xs tabular-nums text-muted">{formatServerDateTime(msg.created_at)}</span>
                          <p className="mt-1 whitespace-pre-wrap text-foreground">{msg.body}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />
              {isReviewed ? (
                <div className="flex items-center gap-2 text-sm">
                  <BrokerStatusChip status="reviewed" />
                  <span className="tabular-nums text-muted">{formatServerDateTime(item.reviewed_at!)}</span>
                </div>
              ) : (
                <Textarea
                  label={t('messages.review_notes_label')}
                  placeholder={t('messages.review_notes_placeholder')}
                  value={notes}
                  onValueChange={setNotes}
                  minRows={2}
                  variant="bordered"
                />
              )}
            </>
          )}
        </ModalBody>

        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={reviewing}>
            {t('messages.close')}
          </Button>
          {!isReviewed && item && (
            <Button
              color="primary"
              startContent={<CheckCircle size={16} aria-hidden="true" />}
              isLoading={reviewing}
              isDisabled={reviewing}
              onPress={review}
            >
              {t('messages.mark_as_reviewed')}
            </Button>
          )}
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default MessageQuickView;
