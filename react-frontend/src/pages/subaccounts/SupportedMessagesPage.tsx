// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * SupportedMessagesPage — a supporter's READ-ONLY window onto a supported
 * member's conversations. One component serves both the conversation list
 * (/linked-accounts/:childId/messages) and a thread (…/messages/:partnerId).
 *
 * Deliberately NOT a retrofit of ConversationPage: that page carries fifteen
 * api call sites, a composer, reactions, mark-read and delete paths — every
 * one of which must NOT exist here. A read-only page that cannot grow a send
 * box by accident is worth the duplication.
 *
 * The purpose dialog is the front door: nothing is fetched until the
 * supporter states why they are looking (kept for the browser session per
 * supported member), and that reason travels on every request into the
 * immutable audit the member can see ("last viewed") in their settings.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalHeading,
  Select,
  SelectItem,
  Spinner,
  TextArea,
  Avatar,
} from '@/components/ui';
import Eye from 'lucide-react/icons/eye';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { GlassCard } from '@/components/ui/GlassCard';
import { Breadcrumbs } from '@/components/navigation';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';
import { useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';

/** One row from MessageService::getConversations — the latest message per
 *  partner, with `other_user` and `last_message` sub-objects. */
interface ConversationRow {
  partner_id?: number;
  other_user?: {
    id: number;
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    avatar_url?: string | null;
  } | null;
  last_message?: {
    body?: string | null;
    created_at?: string | null;
  } | null;
  created_at?: string | null;
}

interface MessageRow {
  id: number;
  sender_id: number;
  receiver_id: number;
  body?: string | null;
  is_voice?: boolean;
  created_at?: string | null;
  sender?: { id: number; first_name?: string | null; last_name?: string | null; avatar_url?: string | null } | null;
}

const PURPOSE_REASONS = ['wellbeing', 'safety', 'helping_reply', 'other'] as const;

function purposeStorageKey(childId: string): string {
  return `nexus_msg_view_purpose_${childId}`;
}

export function SupportedMessagesPage() {
  const { t } = useTranslation('settings');
  const { childId = '', partnerId } = useParams<{ childId: string; partnerId?: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  usePageTitle(t('supported_messages.page_title'));

  // Purpose: session-scoped per supported member. Nothing fetches without it.
  const [purpose, setPurpose] = useState<string>(() => sessionStorage.getItem(purposeStorageKey(childId)) ?? '');
  const [reasonKey, setReasonKey] = useState<string>('wellbeing');
  const [reasonText, setReasonText] = useState('');

  const [conversations, setConversations] = useState<ConversationRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [messages, setMessages] = useState<MessageRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deniedMessage, setDeniedMessage] = useState<string | null>(null);

  const inThread = Boolean(partnerId);

  const load = useCallback(async () => {
    if (purpose.trim() === '') return;
    setLoading(true);
    setDeniedMessage(null);
    try {
      const purposeQuery = `purpose=${encodeURIComponent(purpose)}`;
      if (inThread) {
        const res = await api.get<{ items: MessageRow[] }>(
          `/v2/users/me/sub-accounts/${childId}/messages/${partnerId}?${purposeQuery}`,
        );
        if (res.success && res.data) {
          setMessages(res.data.items ?? []);
        } else {
          setDeniedMessage(res.error || t('supported_messages.denied'));
        }
      } else {
        const res = await api.get<{ conversations: ConversationRow[]; cursor?: string | null; has_more?: boolean }>(
          `/v2/users/me/sub-accounts/${childId}/messages?${purposeQuery}`,
        );
        if (res.success && res.data) {
          setConversations(res.data.conversations ?? []);
          setNextCursor(res.data.cursor ?? null);
          setHasMore(Boolean(res.data.has_more));
        } else {
          setDeniedMessage(res.error || t('supported_messages.denied'));
        }
      }
    } catch (error) {
      logError('Failed to load supported member messages', error);
      setDeniedMessage(t('supported_messages.denied'));
    } finally {
      setLoading(false);
    }
  }, [childId, partnerId, inThread, purpose, t]);

  const loadMoreConversations = async () => {
    if (!nextCursor || loading) return;
    setLoading(true);
    try {
      const res = await api.get<{ conversations: ConversationRow[]; cursor?: string | null; has_more?: boolean }>(
        `/v2/users/me/sub-accounts/${childId}/messages?purpose=${encodeURIComponent(purpose)}&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (res.success && res.data) {
        setConversations((current) => [...(current ?? []), ...(res.data?.conversations ?? [])]);
        setNextCursor(res.data.cursor ?? null);
        setHasMore(Boolean(res.data.has_more));
      } else {
        setDeniedMessage(res.error || t('supported_messages.denied'));
      }
    } catch (error) {
      logError('Failed to load more supported member conversations', error);
      setDeniedMessage(t('supported_messages.denied'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  const submitPurpose = () => {
    const reasonLabel = t(`supported_messages.reason_${reasonKey}`);
    const combined = reasonText.trim() !== '' ? `${reasonLabel} — ${reasonText.trim()}` : reasonLabel;
    sessionStorage.setItem(purposeStorageKey(childId), combined);
    setPurpose(combined);
  };

  const partnerName = useMemo(() => {
    if (!inThread || !messages || messages.length === 0) return '';
    const sample = messages.find((m) => m.sender && m.sender.id !== Number(childId))?.sender;
    return sample ? `${sample.first_name ?? ''} ${sample.last_name ?? ''}`.trim() : '';
  }, [inThread, messages, childId]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Breadcrumbs items={[
        { label: t('tabs.linked'), href: tenantPath('/settings?tab=linked-accounts') },
        { label: t('supported_messages.page_title') },
      ]} />

      {/* The standing disclosure: read-only, recorded, visible to the member. */}
      <GlassCard className="p-4">
        <div className="flex items-start gap-2">
          <Eye className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-warning)]" aria-hidden="true" />
          <p className="text-sm text-theme-muted" data-testid="supported-messages-banner">
            {t('supported_messages.read_only_banner')}
          </p>
        </div>
      </GlassCard>

      {/* Purpose dialog — the front door. Blocks all fetching until answered. */}
      <Modal isOpen={purpose.trim() === ''} onOpenChange={() => { /* deliberately not dismissible */ }}>
        <ModalContent>
          <ModalHeader>
            <ModalHeading>{t('supported_messages.purpose_title')}</ModalHeading>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-theme-muted">{t('supported_messages.purpose_explainer')}</p>
            <Select
              label={t('supported_messages.purpose_reason_label')}
              selectedKeys={[reasonKey]}
              onSelectionChange={(keys) => {
                const value = String(Array.from(keys)[0] ?? 'wellbeing');
                setReasonKey(value);
              }}
            >
              {PURPOSE_REASONS.map((key) => (
                <SelectItem key={key} id={key}>{t(`supported_messages.reason_${key}`)}</SelectItem>
              ))}
            </Select>
            <TextArea
              label={t('supported_messages.purpose_detail_label')}
              value={reasonText}
              onValueChange={setReasonText}
              maxLength={400}
              minRows={2}
              maxRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => navigate(tenantPath('/settings?tab=linked-accounts'))}>
              {t('supported_messages.purpose_cancel')}
            </Button>
            <Button color="primary" onPress={submitPurpose}>
              {t('supported_messages.purpose_submit')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {purpose.trim() !== '' && (
        <GlassCard className="p-4 sm:p-6 space-y-4">
          {inThread && (
            <Button
              size="sm"
              variant="tertiary"
              startContent={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              onPress={() => navigate(tenantPath(`/linked-accounts/${childId}/messages`))}
            >
              {t('supported_messages.back_to_conversations')}
            </Button>
          )}

          {loading && (
            <div className="flex justify-center py-8">
              <Spinner aria-label={t('supported_messages.loading')} />
            </div>
          )}

          {!loading && deniedMessage && (
            <p className="text-sm text-danger" data-testid="supported-messages-denied">{deniedMessage}</p>
          )}

          {!loading && !deniedMessage && !inThread && conversations && (
            conversations.length === 0 ? (
              <p className="text-sm text-theme-muted">{t('supported_messages.empty_list')}</p>
            ) : (
              <>
                <ul className="space-y-2" aria-label={t('supported_messages.list_aria')}>
                  {conversations.map((conversation, index) => {
                    const partnerUserId = conversation.partner_id ?? conversation.other_user?.id;
                    const partner = conversation.other_user;
                    const name = partner?.name
                      ?? `${partner?.first_name ?? ''} ${partner?.last_name ?? ''}`.trim();
                    const preview = conversation.last_message?.body;
                    const previewAt = conversation.last_message?.created_at ?? conversation.created_at;
                    return (
                      <li key={`${partnerUserId}-${index}`}>
                        <Button variant="tertiary" className="w-full justify-start text-left" onPress={() => partnerUserId && navigate(tenantPath(`/linked-accounts/${childId}/messages/${partnerUserId}`))}>
                          <span className="flex w-full min-w-0 items-center gap-3">
                            <Avatar aria-hidden="true" src={resolveAvatarUrl(partner?.avatar_url)} name={name} size="sm" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-theme-primary">{name}</span>
                              {preview && <span className="block truncate text-xs text-theme-muted">{preview}</span>}
                            </span>
                            {previewAt && <span className="shrink-0 text-xs text-theme-subtle">{formatRelativeTime(previewAt)}</span>}
                          </span>
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                {hasMore && nextCursor && (
                  <div className="flex justify-center pt-3">
                    <Button variant="secondary" onPress={() => void loadMoreConversations()}>
                      {t('common:members.load_more')}
                    </Button>
                  </div>
                )}
              </>
            )
          )}

          {!loading && !deniedMessage && inThread && messages && (
            messages.length === 0 ? (
              <p className="text-sm text-theme-muted">{t('supported_messages.empty_thread')}</p>
            ) : (
              <div className="space-y-2" aria-label={t('supported_messages.thread_aria', { name: partnerName })}>
                {messages.map((message) => {
                  const fromMember = message.sender_id === Number(childId);
                  return (
                    <div key={message.id} className={`flex ${fromMember ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-xl border border-theme-default p-3 ${fromMember ? 'bg-theme-elevated/70' : 'bg-theme-elevated/30'}`}>
                        <p className="text-xs font-medium text-theme-muted">
                          {/* Prefer the sender's real name on BOTH sides — "Them"
                              is ambiguous when the reader is a third party. */}
                          {`${message.sender?.first_name ?? ''} ${message.sender?.last_name ?? ''}`.trim()
                            || (fromMember ? t('supported_messages.from_member') : '')}
                          {message.created_at ? ` · ${formatRelativeTime(message.created_at)}` : ''}
                        </p>
                        {message.is_voice ? (
                          <Chip size="sm" variant="flat" className="mt-1">{t('supported_messages.voice_message')}</Chip>
                        ) : (
                          <p className="mt-1 break-words text-sm text-theme-primary">{message.body}</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}
          {/* No composer, no reactions, no mark-read — read-only IS the page. */}
        </GlassCard>
      )}
    </div>
  );
}

export default SupportedMessagesPage;
