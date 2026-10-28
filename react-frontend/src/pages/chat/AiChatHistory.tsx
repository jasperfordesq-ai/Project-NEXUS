// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AiChatHistory — the member's past AI assistant conversations.
 *
 * Lists `GET /ai/conversations`, reopens one through
 * `GET /ai/conversations/{id}` (the parent then continues it by sending the
 * same `conversation_id` to `/ai/chat`), and deletes one through
 * `DELETE /ai/conversations/{id}` after an in-place confirmation. Laravel
 * scopes every call to the signed-in member and tenant.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Spinner } from '@/components/ui';
import Trash2 from 'lucide-react/icons/trash-2';
import MessageSquare from 'lucide-react/icons/message-square';
import api from '@/lib/api';
import { getFormattingLocale } from '@/lib/helpers';

export interface AiConversationSummary {
  id: number;
  title: string | null;
  first_message?: string | null;
  message_count?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface AiStoredMessage {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at?: string | null;
}

export interface AiConversationDetail {
  id: number;
  title?: string | null;
  messages?: AiStoredMessage[];
}

interface AiChatHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenConversation: (conversation: AiConversationDetail) => void;
  onConversationDeleted: (conversationId: number) => void;
}

/** MariaDB timestamps arrive as "YYYY-MM-DD HH:MM:SS"; Safari will not parse the space form. */
export function parseServerDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function AiChatHistory({ isOpen, onClose, onOpenConversation, onConversationDeleted }: AiChatHistoryProps) {
  const { t } = useTranslation('chat');
  const [conversations, setConversations] = useState<AiConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<AiConversationSummary[]>('/ai/conversations');
      if (res.success && Array.isArray(res.data)) {
        setConversations(res.data);
      } else {
        setError(t('history_load_error'));
      }
    } catch {
      setError(t('history_load_error'));
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmingId(null);
    void load();
  }, [isOpen, load]);

  const titleOf = (c: AiConversationSummary) =>
    (c.title && c.title.trim()) || (c.first_message && c.first_message.trim()) || t('history_untitled');

  const openConversation = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await api.get<AiConversationDetail>(`/ai/conversations/${id}`);
      if (res.success && res.data) {
        onOpenConversation(res.data);
      } else {
        setError(t('history_open_error'));
      }
    } catch {
      setError(t('history_open_error'));
    } finally {
      setBusyId(null);
    }
  };

  const deleteConversation = async (id: number) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await api.delete(`/ai/conversations/${id}`);
      if (res.success) {
        setConversations((prev) => prev.filter((c) => c.id !== id));
        setConfirmingId(null);
        onConversationDeleted(id);
      } else {
        setError(t('history_delete_error'));
      }
    } catch {
      setError(t('history_delete_error'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="flex items-center gap-2 text-[var(--color-text)]">
          <MessageSquare className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('history_title')}
        </ModalHeader>
        <ModalBody>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          {isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner size="sm" aria-label={t('history_loading')} />
            </div>
          ) : conversations.length === 0 && !error ? (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">{t('history_empty')}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {conversations.map((c) => {
                const title = titleOf(c);
                const date = parseServerDate(c.updated_at ?? c.created_at);
                const isConfirming = confirmingId === c.id;
                return (
                  <li
                    key={c.id}
                    className="rounded-lg border border-[var(--border-default)] bg-[var(--color-surface)] p-3"
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-[var(--color-text)]">{title}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">
                          {date && <>{date.toLocaleDateString(getFormattingLocale(), { day: 'numeric', month: 'short', year: 'numeric' })} · </>}
                          {t('history_message_count', { total: Number(c.message_count ?? 0) })}
                        </p>
                      </div>
                      {!isConfirming && (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            onPress={() => void openConversation(c.id)}
                            isLoading={busyId === c.id}
                            isDisabled={busyId !== null}
                            aria-label={t('history_open_aria', { title })}
                          >
                            {t('history_open')}
                          </Button>
                          <Button
                            size="sm"
                            variant="tertiary"
                            isIconOnly
                            onPress={() => setConfirmingId(c.id)}
                            isDisabled={busyId !== null}
                            aria-label={t('history_delete_aria', { title })}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                    </div>
                    {isConfirming && (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-[var(--color-text)]">{t('history_delete_confirm')}</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            onPress={() => void deleteConversation(c.id)}
                            isLoading={busyId === c.id}
                          >
                            {t('history_delete_confirm_button')}
                          </Button>
                          <Button size="sm" variant="tertiary" onPress={() => setConfirmingId(null)} isDisabled={busyId === c.id}>
                            {t('history_cancel')}
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose}>
            {t('history_close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default AiChatHistory;
