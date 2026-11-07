// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { OverlayActionButton } from '@/components/ui/OverlayActionButton';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tooltip } from '@/components/ui/Tooltip';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Team Chatrooms Component (I4)
 *
 * Channel-based messaging within a group/team workspace.
 * - List of channels (sidebar) with category labels & lock icon for private
 * - Create new channel
 * - Message list with post/delete/pin/unpin
 * - Pinned messages section
 * - Real-time-ready structure
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import Hash from 'lucide-react/icons/hash';
import Lock from 'lucide-react/icons/lock';
import Pin from 'lucide-react/icons/pin';
import PinOff from 'lucide-react/icons/pin-off';
import Plus from 'lucide-react/icons/plus';
import Send from 'lucide-react/icons/send';
import Trash2 from 'lucide-react/icons/trash-2';
import MessageSquare from 'lucide-react/icons/message-square';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { TranslateButton } from '@/components/i18n/TranslateButton';
import { useAuth, useToast } from '@/contexts';
import { usePusherOptional } from '@/contexts/PusherContext';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, formatRelativeTime } from '@/lib/helpers';

/* ───────────────────────── Types ───────────────────────── */

interface Chatroom {
  id: number;
  group_id: number;
  name: string;
  description: string | null;
  category: string | null;
  is_default: boolean;
  is_private: boolean;
  messages_count: number;
  created_at: string;
}

interface ChatMessage {
  id: number;
  chatroom_id: number;
  user_id: number;
  body: string;
  created_at: string;
  author: {
    id: number;
    name: string;
    avatar_url: string | null;
  };
}

/**
 * One channel message's text, with Translate under it (AWID report, Oct 2026:
 * "posts inside groups aren't translated"). The translation replaces the text
 * in place, as on comments; TranslateButton hides itself when the text is
 * already in the reader's language.
 */
function ChatroomMessageText({ message }: { message: ChatMessage }) {
  const [displayed, setDisplayed] = useState(message.body);
  useEffect(() => { setDisplayed(message.body); }, [message.body]);

  return (
    <>
      <p className="break-words whitespace-pre-wrap text-sm text-[var(--color-text-secondary)]">
        {displayed}
      </p>
      <TranslateButton
        contentType="group_chatroom_message"
        contentId={message.id}
        sourceText={message.body}
        sourceLocale={null}
        onTextChange={(text) => setDisplayed(text)}
        className="min-h-[24px] px-0 py-0 text-xs"
      />
    </>
  );
}

interface PinnedMessage extends ChatMessage {
  pinned_by: number;
  pinned_at: string;
}

interface TeamChatroomsProps {
  groupId: number;
  isGroupAdmin: boolean;
}

/* ───────────────────────── Main Component ───────────────────────── */

export function TeamChatrooms({ groupId, isGroupAdmin }: TeamChatroomsProps) {
  const { t } = useTranslation(['ideation', 'common']);
  const confirm = useConfirm();
  const { t: tGroups } = useTranslation('groups');
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();
  const pusher = usePusherOptional();

  const [chatrooms, setChatrooms] = useState<Chatroom[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeChatroomId, setActiveChatroomId] = useState<number | null>(null);

  // Messages
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState('');
  const [isSending, setIsSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Pinned messages
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [showPinned, setShowPinned] = useState(false);

  // Create channel modal
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const [newChannelName, setNewChannelName] = useState('');
  const [isCreatingChannel, setIsCreatingChannel] = useState(false);

  // Delete channel
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const [isDeletingChannel, setIsDeletingChannel] = useState(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const isAdmin = isGroupAdmin || (user?.role && ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(user.role));

  const fetchChatrooms = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      const response = await api.get<Chatroom[]>(`/v2/groups/${groupId}/chatrooms`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        const rooms = Array.isArray(response.data) ? response.data : [];
        setChatrooms(rooms);
        if (rooms.length > 0 && !activeChatroomId) {
          setActiveChatroomId(rooms[0]?.id ?? null);
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to fetch chatrooms', err);
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [groupId, activeChatroomId]);

  const fetchMessages = useCallback(async (chatroomId: number) => {
    try {
      setIsLoadingMessages(true);
      const response = await api.get<ChatMessage[]>(`/v2/group-chatrooms/${chatroomId}/messages`);
      if (response.success && response.data) {
        setMessages(Array.isArray(response.data) ? response.data : []);
      }
    } catch (err) {
      logError('Failed to fetch messages', err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  const fetchPinnedMessages = useCallback(async (chatroomId: number) => {
    try {
      const response = await api.get<PinnedMessage[]>(`/v2/groups/${groupId}/chatrooms/${chatroomId}/pinned`);
      if (response.success && response.data) {
        const pinned = Array.isArray(response.data) ? response.data : [];
        setPinnedMessages(pinned);
        setPinnedIds(new Set(pinned.map((p) => p.id)));
      }
    } catch (err) {
      logError('Failed to fetch pinned messages', err);
    }
  }, [groupId]);

  useEffect(() => {
    fetchChatrooms();
  }, [fetchChatrooms]);

  // Collapse the pinned-messages panel when switching chatrooms (or when the
  // fetchers change, mirroring the effect below). Done during render with a
  // prev-value comparison (not useEffect) so the panel never renders open
  // against the new chatroom for a frame.
  const [prevPinnedResetKey, setPrevPinnedResetKey] = useState<{
    activeChatroomId: number | null;
    fetchMessages: typeof fetchMessages;
    fetchPinnedMessages: typeof fetchPinnedMessages;
  }>({ activeChatroomId, fetchMessages, fetchPinnedMessages });
  if (
    prevPinnedResetKey.activeChatroomId !== activeChatroomId ||
    prevPinnedResetKey.fetchMessages !== fetchMessages ||
    prevPinnedResetKey.fetchPinnedMessages !== fetchPinnedMessages
  ) {
    setPrevPinnedResetKey({ activeChatroomId, fetchMessages, fetchPinnedMessages });
    if (activeChatroomId) {
      setShowPinned(false);
    }
  }

  // Fetch messages + pinned messages when the active chatroom changes. Real
  // network calls, so they stay in an effect.
  useEffect(() => {
    if (activeChatroomId) {
      fetchMessages(activeChatroomId);
      fetchPinnedMessages(activeChatroomId);
    }
  }, [activeChatroomId, fetchMessages, fetchPinnedMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Real-time message updates via Pusher
  useEffect(() => {
    if (!pusher?.client || !pusher.tenantId || !groupId || !activeChatroomId) return;

    const channelName = `private-tenant.${pusher.tenantId}.group.${groupId}`;

    try {
      const client = pusher.client;
      const channel = client.subscribe(channelName);

      const handler = (data: { chatroom_id: number; message: ChatMessage }) => {
        if (data.chatroom_id === activeChatroomId && data.message.user_id !== user?.id) {
          setMessages(prev => [...prev, data.message]);
        }
      };

      channel.bind('chatroom.message_posted', handler);

      return () => {
        channel.unbind('chatroom.message_posted', handler);
        // Release the channel subscription too — unbinding the handler alone
        // leaks the subscription across groupId/chatroom/user changes.
        client.unsubscribe(channelName);
      };
    } catch {
      // Pusher not available — fall back to polling
    }
  }, [pusher, groupId, activeChatroomId, user?.id]);

  const handleSendMessage = async () => {
    if (!newMessage.trim() || !activeChatroomId) return;

    setIsSending(true);
    try {
      await api.post(`/v2/group-chatrooms/${activeChatroomId}/messages`, {
        body: newMessage.trim(),
      });
      toastRef.current.success(tRef.current('toast.message_posted'));
      setNewMessage('');
      fetchMessages(activeChatroomId);
    } catch (err) {
      logError('Failed to send message', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsSending(false);
    }
  };

  const handleDeleteMessage = async (messageId: number) => {
    const ok = await confirm({
      title: tRef.current('confirm.delete_message'),
      status: 'danger',
      confirmLabel: tRef.current('common:delete'),
    });
    if (!ok) return;
    try {
      await api.delete(`/v2/group-chatroom-messages/${messageId}`);
      setMessages(prev => prev.filter(m => m.id !== messageId));
      // Also remove from pinned if it was pinned
      if (pinnedIds.has(messageId)) {
        setPinnedMessages(prev => prev.filter(p => p.id !== messageId));
        setPinnedIds(prev => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    } catch (err) {
      logError('Failed to delete message', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    }
  };

  const handlePinMessage = async (messageId: number) => {
    if (!activeChatroomId) return;
    try {
      await api.post(`/v2/groups/${groupId}/chatrooms/${activeChatroomId}/pin/${messageId}`, {});
      toastRef.current.success(tGroups('chatrooms.pinned_success'));
      fetchPinnedMessages(activeChatroomId);
    } catch (err) {
      logError('Failed to pin message', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    }
  };

  const handleUnpinMessage = async (messageId: number) => {
    if (!activeChatroomId) return;
    try {
      await api.delete(`/v2/groups/${groupId}/chatrooms/${activeChatroomId}/pin/${messageId}`);
      toastRef.current.success(tGroups('chatrooms.unpinned_success'));
      setPinnedMessages(prev => prev.filter(p => p.id !== messageId));
      setPinnedIds(prev => {
        const next = new Set(prev);
        next.delete(messageId);
        return next;
      });
    } catch (err) {
      logError('Failed to unpin message', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    }
  };

  const handleCreateChannel = async () => {
    if (!newChannelName.trim()) return;

    setIsCreatingChannel(true);
    try {
      const response = await api.post<Chatroom>(`/v2/groups/${groupId}/chatrooms`, {
        name: newChannelName.trim(),
      });
      if (response.success && response.data) {
        toastRef.current.success(tRef.current('toast.chatroom_created'));
        setNewChannelName('');
        onCreateClose();
        fetchChatrooms();
        setActiveChatroomId(response.data.id);
      }
    } catch (err) {
      logError('Failed to create channel', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsCreatingChannel(false);
    }
  };

  const handleDeleteChannel = async () => {
    if (!activeChatroomId) return;

    setIsDeletingChannel(true);
    try {
      await api.delete(`/v2/group-chatrooms/${activeChatroomId}`);
      toastRef.current.success(tRef.current('toast.chatroom_deleted'));
      onDeleteClose();
      setActiveChatroomId(null);
      setMessages([]);
      setPinnedMessages([]);
      setPinnedIds(new Set());
      fetchChatrooms();
    } catch (err) {
      logError('Failed to delete channel', err);
      toastRef.current.error(tRef.current('toast.error_generic'));
    } finally {
      setIsDeletingChannel(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('common:loading')}>
        <Spinner size="md" />
      </div>
    );
  }

  const activeChatroom = chatrooms.find(c => c.id === activeChatroomId);

  return (
    <div className="flex min-h-[400px] min-w-0 flex-col gap-3 md:flex-row md:gap-4">
      {/* Channel Sidebar */}
      <nav className="w-full min-w-0 md:w-48 md:shrink-0" aria-label={t('chatrooms.title')}>
        <div className="mb-2 flex items-center justify-between md:mb-3">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">
            {t('chatrooms.title')}
          </h3>
          {isAdmin && (
            <Button
              isIconOnly
              variant="light"
              size="sm"
              onPress={onCreateOpen}
              aria-label={t('chatrooms.create')}
              className="h-11 w-11 min-w-11 md:h-8 md:w-8 md:min-w-8"
            >
              <Plus className="w-4 h-4" />
            </Button>
          )}
        </div>

        <div className="flex max-w-full gap-2 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
          {chatrooms.map((room) => (
            <Button
              key={room.id}
              onPress={() => setActiveChatroomId(room.id)}
              variant="light"
              aria-current={activeChatroomId === room.id ? 'page' : undefined}
              className={`min-h-11 min-w-[9rem] flex-none justify-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors md:min-h-9 md:w-full md:min-w-0 ${
                activeChatroomId === room.id
                  ? 'bg-accent/10 text-accent font-medium'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]'
              }`}
            >
              {room.is_private ? (
                <Lock className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Hash className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="truncate flex-1">{room.name}</span>
              {room.category && (
                <Chip size="sm" variant="flat" className="text-[10px] h-4 min-h-0 px-1">
                  {room.category}
                </Chip>
              )}
            </Button>
          ))}
        </div>

        {chatrooms.length === 0 && (
          <p className="text-xs text-[var(--color-text-tertiary)] px-3 py-2">
            {t('chatrooms.empty_title')}
          </p>
        )}
      </nav>

      {/* Message Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {!activeChatroomId ? (
          <EmptyState
            icon={<MessageSquare className="w-10 h-10 text-theme-subtle" />}
            title={t('chatrooms.empty_title')}
            description={t('chatrooms.empty_description')}
          />
        ) : (
          <>
            {/* Channel Header */}
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-[var(--color-border)] pb-3">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                {activeChatroom?.is_private ? (
                  <Lock className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                ) : (
                  <Hash className="w-4 h-4 text-[var(--color-text-tertiary)]" />
                )}
                <span className="min-w-0 truncate font-semibold text-[var(--color-text)]">
                  {activeChatroom?.name}
                </span>
                {activeChatroom?.category && (
                  <Chip size="sm" variant="flat" color="default">
                    {activeChatroom.category}
                  </Chip>
                )}
                {activeChatroom?.is_private && (
                  <Chip size="sm" variant="flat" color="warning">
                    {tGroups('chatrooms.private_label')}
                  </Chip>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {pinnedMessages.length > 0 && (
                  <Tooltip content={tGroups('chatrooms.show_pinned')}>
                    <Button
                      isIconOnly
                      variant="light"
                      size="sm"
                      onPress={() => setShowPinned((visible) => !visible)}
                      aria-label={tGroups('chatrooms.show_pinned')}
                      aria-expanded={showPinned}
                      aria-controls="group-chatroom-pinned-messages"
                      className={`relative h-11 w-11 min-w-11 md:h-8 md:w-8 md:min-w-8 ${showPinned ? 'text-warning' : ''}`}
                    >
                      <Pin className="w-3.5 h-3.5" />
                      <span className="text-[10px] absolute -top-0.5 -right-0.5 bg-warning text-warning-foreground rounded-full w-3.5 h-3.5 flex items-center justify-center">
                        {pinnedMessages.length}
                      </span>
                    </Button>
                  </Tooltip>
                )}
                {isAdmin && (
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    color="danger"
                    onPress={onDeleteOpen}
                    aria-label={t('chatrooms.delete_channel')}
                    className="h-11 w-11 min-w-11 md:h-8 md:w-8 md:min-w-8"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>

            {/* Pinned Messages Section */}
            {showPinned && pinnedMessages.length > 0 && (
              <div
                id="group-chatroom-pinned-messages"
                className="mb-3 rounded-lg border border-warning/20 bg-warning/10 p-3"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Pin className="w-3.5 h-3.5 text-warning" />
                  <span className="text-sm font-semibold text-[var(--color-text)]">
                    {tGroups('chatrooms.pinned_messages')}
                  </span>
                </div>
                <div className="space-y-2">
                  {pinnedMessages.map((msg) => (
                    <div key={msg.id} className="flex items-start gap-2 group">
                      <Avatar
                        src={resolveAvatarUrl(msg.author.avatar_url)}
                        size="sm"
                        className="w-5 h-5 shrink-0 mt-0.5"
                        name={msg.author.name}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span className="text-xs font-medium text-[var(--color-text)]">
                            {msg.author.name}
                          </span>
                          <span className="text-[10px] text-[var(--color-text-tertiary)]">
                            {formatRelativeTime(msg.created_at)}
                          </span>
                          {isAdmin && (
                            <OverlayActionButton
                              variant="ghost"
                              onPress={() => handleUnpinMessage(msg.id)}
                              className="rounded-full transition-opacity"
                              aria-label={tGroups('chatrooms.unpin')}
                            >
                              <PinOff className="size-3 text-[var(--color-text-tertiary)] hover:text-warning" aria-hidden="true" />
                            </OverlayActionButton>
                          )}
                        </div>
                        <p className="line-clamp-2 break-words whitespace-pre-wrap text-xs text-[var(--color-text-secondary)]">
                          {msg.body}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Messages */}
            <div
              className="mb-3 max-h-96 flex-1 space-y-3 overflow-y-auto"
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
            >
              {isLoadingMessages && (
                <div className="flex justify-center py-4" role="status" aria-busy="true" aria-label={t('common:loading')}>
                  <Spinner size="sm" />
                </div>
              )}

              {!isLoadingMessages && messages.length === 0 && (
                <EmptyState
                  icon={<MessageSquare className="w-8 h-8 text-theme-subtle" />}
                  title={t('chatrooms.empty_title')}
                  description={t('chatrooms.empty_description')}
                />
              )}

              {messages.map((msg) => (
                <div key={msg.id} className="flex items-start gap-2.5 group">
                  <Avatar
                    src={resolveAvatarUrl(msg.author.avatar_url)}
                    size="sm"
                    className="w-7 h-7 shrink-0 mt-0.5"
                    name={msg.author.name}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-sm font-medium text-[var(--color-text)]">
                        {msg.author.name}
                      </span>
                      <span className="text-xs text-[var(--color-text-tertiary)]">
                        {formatRelativeTime(msg.created_at)}
                      </span>
                      {pinnedIds.has(msg.id) && (
                        <Pin className="w-3 h-3 text-warning" />
                      )}
                      {isAdmin && (
                        <Tooltip content={pinnedIds.has(msg.id) ? tGroups('chatrooms.unpin') : tGroups('chatrooms.pin')}>
                          <OverlayActionButton
                            variant="ghost"
                            onPress={() =>
                              pinnedIds.has(msg.id)
                                ? handleUnpinMessage(msg.id)
                                : handlePinMessage(msg.id)
                            }
                            className="rounded-full transition-opacity"
                            aria-label={pinnedIds.has(msg.id) ? tGroups('chatrooms.unpin') : tGroups('chatrooms.pin')}
                          >
                            {pinnedIds.has(msg.id) ? (
                              <PinOff className="size-3 text-warning" aria-hidden="true" />
                            ) : (
                              <Pin className="size-3 text-[var(--color-text-tertiary)] hover:text-warning" aria-hidden="true" />
                            )}
                          </OverlayActionButton>
                        </Tooltip>
                      )}
                      {(user?.id === msg.user_id || isAdmin) && (
                        <OverlayActionButton
                          variant="ghost"
                          onPress={() => handleDeleteMessage(msg.id)}
                          className="rounded-full transition-opacity"
                          aria-label={t('comments.delete')}
                        >
                          <Trash2 className="size-3 text-[var(--color-text-tertiary)] hover:text-danger" aria-hidden="true" />
                        </OverlayActionButton>
                      )}
                    </div>
                    <ChatroomMessageText message={msg} />
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            {isAuthenticated && (
              <div className="flex min-w-0 gap-2">
                <Input
                  placeholder={t('chatrooms.message_placeholder')}
                  aria-label={t('chatrooms.message_placeholder')}
                  value={newMessage}
                  onValueChange={setNewMessage}
                  onKeyDown={handleKeyDown}
                  variant="bordered"
                  size="sm"
                  className="flex-1"
                />
                <Button
                  isIconOnly
                  color="primary"
                  size="sm"
                  isLoading={isSending}
                  isDisabled={!newMessage.trim()}
                  onPress={handleSendMessage}
                  aria-label={t('chatrooms.send')}
                  className="h-11 w-11 min-w-11 md:h-8 md:w-8 md:min-w-8"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Create Channel Modal */}
      <Modal isOpen={isCreateOpen} onClose={onCreateClose}>
        <ModalContent>
          <ModalHeader>{t('chatrooms.create')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('categories.name_label')}
              placeholder={t('chatrooms.general')}
              value={newChannelName}
              onValueChange={setNewChannelName}
              variant="bordered"
              isRequired
              startContent={<Hash className="w-4 h-4 text-[var(--color-text-tertiary)]" />}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onCreateClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="primary"
              isLoading={isCreatingChannel}
              isDisabled={!newChannelName.trim()}
              onPress={handleCreateChannel}
            >
              {t('chatrooms.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Channel Modal */}
      <Modal isOpen={isDeleteOpen} onClose={onDeleteClose}>
        <ModalContent>
          <ModalHeader>{t('chatrooms.delete_channel')}</ModalHeader>
          <ModalBody>
            <p className="text-[var(--color-text-secondary)]">
              {t('chatrooms.delete_channel_confirm')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={onDeleteClose}>
              {t('form.cancel')}
            </Button>
            <Button
              color="danger"
              isLoading={isDeletingChannel}
              onPress={handleDeleteChannel}
            >
              {t('chatrooms.delete_channel')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default TeamChatrooms;
