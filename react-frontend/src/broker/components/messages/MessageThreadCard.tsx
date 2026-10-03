// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MessageThreadCard — the conversation a copied message sits in, as chat
 * bubbles: the sender's messages on the left, the other person's on the
 * right, the copied one ringed. Voice messages play through BrokerVoicePlayer
 * (every play is logged server-side). Every name opens the member window.
 */

import { useTranslation } from 'react-i18next';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import MessageCircle from 'lucide-react/icons/message-circle';
import Mic from 'lucide-react/icons/mic';

import { formatServerDateTime } from '@/lib/serverTime';
import type { ConversationMessage } from '@/admin/api/types';
import { Avatar, Card, CardBody, CardHeader, Chip, ScrollShadow } from '@/components/ui';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { BrokerEmptyState } from '../BrokerEmptyState';
import { BrokerVoicePlayer } from '../BrokerVoicePlayer';

interface MessageThreadCardProps {
  /** The broker copy's id (route param), for voice playback. */
  copyId: string;
  thread: ConversationMessage[];
  /** The copied message, so it can be marked, and whose side is "left". */
  originalMessageId: number;
  senderId: number;
  className?: string;
}

export function MessageThreadCard({ copyId, thread, originalMessageId, senderId, className = '' }: MessageThreadCardProps) {
  const { t } = useTranslation('broker');

  return (
    <Card className={className}>
      <CardHeader className="flex items-center gap-2 pb-0">
        <MessageCircle size={18} className="text-warning" aria-hidden="true" />
        <h3 className="font-semibold tracking-tight">{t('messages.detail_conversation_thread')}</h3>
        <Chip size="sm" variant="soft" color="default" className="ml-auto tabular-nums">
          {t('messages.detail_message_count', { count: thread.length })}
        </Chip>
      </CardHeader>
      <CardBody>
        {thread.length === 0 ? (
          <BrokerEmptyState bare icon={MessageCircle} color="neutral" title={t('messages.detail_no_thread_messages')} />
        ) : (
          <ScrollShadow className="max-h-[500px]">
            <div className="space-y-4 pr-1">
              {thread.map((msg) => {
                const isTarget = msg.id === originalMessageId;
                const isFromSender = msg.sender_id === senderId;
                return (
                  <div key={msg.id} className={`flex items-start gap-3 ${isFromSender ? '' : 'flex-row-reverse'}`}>
                    <span aria-hidden="true" className="mt-0.5 shrink-0">
                      <Avatar name={msg.sender_name} size="sm" />
                    </span>
                    <div className={`flex min-w-0 max-w-[85%] flex-col ${isFromSender ? 'items-start' : 'items-end'}`}>
                      <div className={`mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 ${isFromSender ? '' : 'flex-row-reverse'}`}>
                        <MemberName userId={msg.sender_id} name={msg.sender_name} className="text-sm font-semibold" />
                        <span className="text-xs tabular-nums text-muted">{formatServerDateTime(msg.created_at)}</span>
                        {isTarget && (
                          <Chip size="sm" variant="soft" color="warning">
                            <AlertTriangle size={12} aria-hidden="true" />
                            <Chip.Label>{t('messages.detail_copied')}</Chip.Label>
                          </Chip>
                        )}
                        {!!msg.is_edited && <span className="text-xs italic text-muted">{t('messages.detail_edited')}</span>}
                      </div>

                      <div
                        className={`rounded-2xl px-4 py-2.5 ${
                          isFromSender ? 'rounded-tl-md bg-surface-secondary' : 'rounded-tr-md bg-accent/10'
                        } ${isTarget ? 'ring-1 ring-inset ring-warning/60' : ''}`}
                      >
                        {msg.subject && (
                          <p className="mb-1 text-xs font-medium text-muted">
                            {t('messages.detail_subject')}: {msg.subject}
                          </p>
                        )}
                        {msg.is_deleted ? (
                          <p className="text-sm italic text-muted">{t('messages.detail_message_deleted')}</p>
                        ) : msg.is_voice ? (
                          <div className="space-y-1">
                            <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                              <Mic size={14} aria-hidden="true" />
                              {msg.audio_duration
                                ? t('messages.detail_voice_message_length', { seconds: msg.audio_duration })
                                : t('messages.detail_voice_message')}
                            </p>
                            <BrokerVoicePlayer copyId={copyId} messageId={msg.id} />
                            {msg.transcript ? (
                              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                                {t('messages.detail_voice_transcript', { text: msg.transcript })}
                              </p>
                            ) : (
                              <p className="text-xs text-muted">{t('messages.detail_voice_no_transcript')}</p>
                            )}
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{msg.body}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollShadow>
        )}
      </CardBody>
    </Card>
  );
}

export default MessageThreadCard;
