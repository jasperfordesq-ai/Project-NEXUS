// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import Input from '@/components/ui/Input';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import NativePressable from '@/components/ui/NativePressable';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  createGroupChatroom,
  deleteGroupChatroom,
  deleteGroupChatroomMessage,
  getGroupChatroomMessages,
  getGroupChatrooms,
  getPinnedGroupChatroomMessages,
  pinGroupChatroomMessage,
  postGroupChatroomMessage,
  unpinGroupChatroomMessage,
  type GroupChatroom,
  type GroupChatroomMessage,
} from '@/lib/api/groups';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  completeGroupContentCreationOperation,
  discardGroupContentCreationOperation,
  loadGroupContentCreationOperation,
  reserveGroupContentCreationOperation,
  type GroupContentCreationOperation,
} from '@/lib/groupContentCreationOperation';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { formatRelativeTime } from '@/lib/utils/formatRelativeTime';
import { withAlpha } from '@/lib/utils/color';

type PendingMessage = GroupContentCreationOperation<'chatroom-message'>;

export default function GroupChatroomsPanel({
  groupId,
  initialChatroomId,
  currentUserId,
  canManage,
  canView,
  refreshToken,
}: {
  groupId: number;
  initialChatroomId?: number;
  currentUserId: number;
  canManage: boolean;
  canView: boolean;
  refreshToken: number;
}) {
  const { t } = useTranslation(['groups', 'common']);
  const tRef = useRef(t);
  tRef.current = t;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const mounted = useRef(true);
  const requestVersion = useRef(0);
  const sending = useRef(false);
  const [rooms, setRooms] = useState<GroupChatroom[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<number | null>(
    Number.isInteger(initialChatroomId) && Number(initialChatroomId) > 0 ? Number(initialChatroomId) : null,
  );
  const [messages, setMessages] = useState<GroupChatroomMessage[]>([]);
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [messageBody, setMessageBody] = useState('');
  const [pendingMessage, setPendingMessage] = useState<PendingMessage | null>(null);
  const [messageRecoveryError, setMessageRecoveryError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [channelName, setChannelName] = useState('');
  const [creating, setCreating] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<GroupContentCreationOperation<'chatroom'> | null>(null);
  const [channelRecoveryError, setChannelRecoveryError] = useState<string | null>(null);

  useEffect(() => () => { mounted.current = false; }, []);

  const activeRoom = useMemo(
    () => rooms.find(room => room.id === activeRoomId) ?? null,
    [activeRoomId, rooms],
  );

  const loadRooms = useCallback(async () => {
    if (!canView) return;
    setLoadingRooms(true);
    setLoadError(null);
    try {
      const response = await getGroupChatrooms(groupId);
      const nextRooms = Array.isArray(response.data) ? response.data : [];
      if (!mounted.current) return;
      setRooms(nextRooms);
      setActiveRoomId(current => nextRooms.some(room => room.id === current) ? current : (nextRooms[0]?.id ?? null));
    } catch (error) {
      if (mounted.current) setLoadError(describeApiError(error, tRef.current('detail.chatrooms.loadError')));
    } finally {
      if (mounted.current) setLoadingRooms(false);
    }
  }, [canView, groupId]);

  const loadMessages = useCallback(async (roomId: number, nextCursor: string | null = null) => {
    const version = ++requestVersion.current;
    nextCursor ? setLoadingMore(true) : setLoadingMessages(true);
    setLoadError(null);
    try {
      const [response, pinnedResponse] = await Promise.all([
        getGroupChatroomMessages(roomId, nextCursor),
        nextCursor ? Promise.resolve(null) : getPinnedGroupChatroomMessages(groupId, roomId),
      ]);
      if (!mounted.current || version !== requestVersion.current) return;
      const incoming = Array.isArray(response.data) ? response.data : [];
      setMessages(current => nextCursor ? [...current, ...incoming.filter(item => !current.some(old => old.id === item.id))] : incoming);
      setCursor(response.meta?.cursor ?? null);
      setHasMore(response.meta?.has_more === true);
      if (pinnedResponse) {
        setPinnedIds(new Set((Array.isArray(pinnedResponse.data) ? pinnedResponse.data : []).map(item => item.id)));
      }
    } catch (error) {
      if (mounted.current && version === requestVersion.current) {
        setLoadError(describeApiError(error, tRef.current('detail.chatrooms.messagesLoadError')));
      }
    } finally {
      if (mounted.current && version === requestVersion.current) {
        setLoadingMessages(false);
        setLoadingMore(false);
      }
    }
  }, [groupId]);

  useEffect(() => { void loadRooms(); }, [loadRooms]);
  useEffect(() => {
    if (refreshToken > 0) void loadRooms();
  }, [loadRooms, refreshToken]);
  useEffect(() => {
    setMessages([]);
    setPinnedIds(new Set());
    setCursor(null);
    setHasMore(false);
    if (activeRoomId) void loadMessages(activeRoomId);
  }, [activeRoomId, loadMessages]);

  useEffect(() => {
    let active = true;
    void loadGroupContentCreationOperation(groupId, 'chatroom-message').then(operation => {
      if (!active || !operation) return;
      setPendingMessage(operation);
      setActiveRoomId(operation.payload.chatroomId);
      setMessageBody(operation.payload.body);
    }).catch(() => {
      if (active) setMessageRecoveryError(tRef.current('detail.chatrooms.recoveryError'));
    });
    return () => { active = false; };
  }, [groupId]);

  useEffect(() => {
    let active = true;
    void loadGroupContentCreationOperation(groupId, 'chatroom').then(operation => {
      if (!active || !operation) return;
      setPendingChannel(operation);
      setChannelName(operation.payload.name);
      setShowCreate(true);
    }).catch(() => {
      if (active) setChannelRecoveryError(tRef.current('detail.chatrooms.recoveryError'));
    });
    return () => { active = false; };
  }, [groupId]);

  const sendMessage = async () => {
    if (!activeRoomId || !messageBody.trim() || sending.current) return;
    sending.current = true;
    setIsSending(true);
    try {
      const operation = await reserveGroupContentCreationOperation(groupId, 'chatroom-message', {
        chatroomId: activeRoomId,
        body: messageBody,
      });
      if (mounted.current) setPendingMessage(operation);
      await postGroupChatroomMessage(activeRoomId, operation.payload.body, operation.key);
      await completeGroupContentCreationOperation(operation);
      if (!mounted.current) return;
      setPendingMessage(null);
      setMessageBody('');
      setMessageRecoveryError(null);
      showToast({ title: t('detail.chatrooms.sent'), variant: 'success' });
      await loadMessages(activeRoomId);
    } catch (error) {
      if (mounted.current) showToast({ title: t('detail.chatrooms.sendError'), description: describeApiError(error, t('detail.chatrooms.retryHint')), variant: 'danger' });
    } finally {
      sending.current = false;
      if (mounted.current) setIsSending(false);
    }
  };

  const discardPending = async () => {
    if (!pendingMessage) return;
    try {
      await discardGroupContentCreationOperation(pendingMessage);
      if (!mounted.current) return;
      setPendingMessage(null);
      setMessageBody('');
      setMessageRecoveryError(null);
    } catch {
      if (mounted.current) setMessageRecoveryError(t('detail.chatrooms.recoveryError'));
    }
  };

  const discardPendingChannel = async () => {
    if (!pendingChannel) return;
    try {
      await discardGroupContentCreationOperation(pendingChannel);
      if (!mounted.current) return;
      setPendingChannel(null);
      setChannelName('');
      setChannelRecoveryError(null);
    } catch {
      if (mounted.current) setChannelRecoveryError(t('detail.chatrooms.recoveryError'));
    }
  };

  const createChannel = async () => {
    const name = channelName.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      const operation = await reserveGroupContentCreationOperation(groupId, 'chatroom', { name });
      if (mounted.current) setPendingChannel(operation);
      const response = await createGroupChatroom(groupId, { name: operation.payload.name }, operation.key);
      await completeGroupContentCreationOperation(operation);
      if (!mounted.current) return;
      setPendingChannel(null);
      setChannelRecoveryError(null);
      setChannelName('');
      setShowCreate(false);
      await loadRooms();
      if (mounted.current) setActiveRoomId(response.data.id);
    } catch (error) {
      if (mounted.current) showToast({ title: t('detail.chatrooms.createError'), description: describeApiError(error, t('detail.chatrooms.createError')), variant: 'danger' });
    } finally {
      if (mounted.current) setCreating(false);
    }
  };

  const removeChannel = (room: GroupChatroom) => confirm({
    title: t('detail.chatrooms.deleteChannelTitle'),
    message: t('detail.chatrooms.deleteChannelMessage', { name: room.name }),
    confirmLabel: t('common:buttons.delete'),
    cancelLabel: t('common:buttons.cancel'),
    variant: 'danger',
    onConfirm: async () => {
      try {
        await deleteGroupChatroom(room.id);
        await loadRooms();
      } catch (error) {
        showToast({ title: t('detail.chatrooms.deleteChannelError'), description: describeApiError(error, t('detail.chatrooms.deleteChannelError')), variant: 'danger' });
      }
    },
  });

  const removeMessage = (message: GroupChatroomMessage) => confirm({
    title: t('detail.chatrooms.deleteMessageTitle'),
    message: t('detail.chatrooms.deleteMessageMessage'),
    confirmLabel: t('common:buttons.delete'),
    cancelLabel: t('common:buttons.cancel'),
    variant: 'danger',
    onConfirm: async () => {
      try {
        await deleteGroupChatroomMessage(message.id);
        setMessages(current => current.filter(item => item.id !== message.id));
        setPinnedIds(current => { const next = new Set(current); next.delete(message.id); return next; });
      } catch (error) {
        showToast({ title: t('detail.chatrooms.deleteMessageError'), description: describeApiError(error, t('detail.chatrooms.deleteMessageError')), variant: 'danger' });
      }
    },
  });

  const togglePin = async (message: GroupChatroomMessage) => {
    if (!activeRoomId) return;
    const isPinned = pinnedIds.has(message.id);
    try {
      if (isPinned) await unpinGroupChatroomMessage(groupId, activeRoomId, message.id);
      else await pinGroupChatroomMessage(groupId, activeRoomId, message.id);
      setPinnedIds(current => {
        const next = new Set(current);
        isPinned ? next.delete(message.id) : next.add(message.id);
        return next;
      });
    } catch (error) {
      showToast({ title: t('detail.chatrooms.pinError'), description: describeApiError(error, t('detail.chatrooms.pinError')), variant: 'danger' });
    }
  };

  if (!canView) {
    return <EmptyState icon="lock-closed-outline" title={t('detail.chatrooms.joinTitle')} subtitle={t('detail.chatrooms.joinSubtitle')} />;
  }

  if (loadingRooms && rooms.length === 0) {
    return <HeroCard className="rounded-panel p-0"><HeroCard.Body className="min-h-[180px] items-center justify-center"><Spinner size="md" /></HeroCard.Body></HeroCard>;
  }

  if (loadError && rooms.length === 0) {
    return <ErrorState subtitle={loadError} onRetry={loadRooms} isRetrying={loadingRooms} />;
  }

  return (
    <View className="gap-4" testID="group-chatrooms-panel">
      <HeroCard className="rounded-panel p-0">
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>{t('detail.chatrooms.title')}</Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('detail.chatrooms.subtitle')}</Text>
            </View>
            {canManage ? (
              <HeroButton size="sm" variant="secondary" testID="group-chatroom-create-toggle" onPress={() => setShowCreate(value => !value)}>
                <Ionicons name={showCreate ? 'close-outline' : 'add-outline'} size={17} color={primary} />
                <HeroButton.Label>{showCreate ? t('common:buttons.cancel') : t('detail.chatrooms.create')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
          {showCreate ? (
            <Surface variant="secondary" className="gap-2 rounded-panel-inner p-3">
              <Input label={t('detail.chatrooms.nameLabel')} value={channelName} maxLength={100} onChangeText={setChannelName} />
              <HeroButton testID="group-chatroom-create" isDisabled={!channelName.trim() || creating || Boolean(channelRecoveryError)} onPress={() => void createChannel()}>
                {creating ? <Spinner size="sm" /> : <HeroButton.Label>{t('detail.chatrooms.create')}</HeroButton.Label>}
              </HeroButton>
              {pendingChannel ? (
                <View className="gap-2">
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('detail.chatrooms.channelRecoveryNotice')}</Text>
                  <HeroButton size="sm" variant="ghost" onPress={() => void discardPendingChannel()}>
                    <HeroButton.Label>{t('detail.chatrooms.discardChannel')}</HeroButton.Label>
                  </HeroButton>
                </View>
              ) : null}
              {channelRecoveryError ? <Text accessibilityRole="alert" className="text-xs" style={{ color: theme.error }}>{channelRecoveryError}</Text> : null}
            </Surface>
          ) : null}
          {rooms.length === 0 ? (
            <EmptyState icon="chatbubbles-outline" title={t('detail.chatrooms.emptyChannelsTitle')} subtitle={t('detail.chatrooms.emptyChannelsSubtitle')} />
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {rooms.map(room => {
                const selected = room.id === activeRoomId;
                return (
                  <NativePressable
                    key={room.id}
                    testID={`group-chatroom-${room.id}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: Boolean(pendingMessage && pendingMessage.payload.chatroomId !== room.id) }}
                    accessibilityLabel={t('detail.chatrooms.openChannel', { name: room.name })}
                    className="flex-row items-center gap-2 rounded-full px-3 py-2"
                    style={{ backgroundColor: selected ? withAlpha(primary, 0.18) : theme.surface }}
                    disabled={Boolean(pendingMessage && pendingMessage.payload.chatroomId !== room.id)}
                    onPress={() => setActiveRoomId(room.id)}
                  >
                    <Ionicons name={room.is_private ? 'lock-closed-outline' : 'chatbubble-outline'} size={15} color={selected ? primary : theme.textSecondary} />
                    <Text className="max-w-[180px] text-sm font-semibold" style={{ color: selected ? primary : theme.text }} numberOfLines={1}>{room.name}</Text>
                  </NativePressable>
                );
              })}
            </View>
          )}
        </HeroCard.Body>
      </HeroCard>

      {activeRoom ? (
        <HeroCard className="rounded-panel p-0">
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-semibold" style={{ color: theme.text }}>{activeRoom.name}</Text>
                {activeRoom.description ? <Text className="text-sm" style={{ color: theme.textSecondary }}>{activeRoom.description}</Text> : null}
              </View>
              {canManage && !activeRoom.is_default ? (
                <HeroButton size="sm" variant="ghost" accessibilityLabel={t('detail.chatrooms.deleteChannelTitle')} onPress={() => removeChannel(activeRoom)}>
                  <Ionicons name="trash-outline" size={18} color={theme.error} />
                </HeroButton>
              ) : null}
            </View>

            {loadingMessages && messages.length === 0 ? <Spinner size="md" /> : null}
            {loadError && messages.length === 0 ? <ErrorState subtitle={loadError} onRetry={() => void loadMessages(activeRoom.id)} isRetrying={loadingMessages} /> : null}
            {!loadingMessages && !loadError && messages.length === 0 ? (
              <EmptyState icon="chatbubble-ellipses-outline" title={t('detail.chatrooms.emptyTitle')} subtitle={t('detail.chatrooms.emptySubtitle')} />
            ) : null}
            {[...messages].reverse().map(message => (
              <Surface key={message.id} variant="secondary" className="gap-2 rounded-panel-inner p-3" testID={`group-chatroom-message-${message.id}`}>
                <View className="flex-row items-center gap-2">
                  <Avatar uri={message.author?.avatar_url ?? undefined} name={message.author?.name ?? '?'} size={32} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>{message.author?.name ?? t('common:unknown')}</Text>
                    {message.created_at ? <Text className="text-xs" style={{ color: theme.textSecondary }}>{formatRelativeTime(message.created_at, true)}</Text> : null}
                  </View>
                  {pinnedIds.has(message.id) ? <Ionicons name="pin" size={15} color={primary} accessibilityLabel={t('detail.chatrooms.pinned')} /> : null}
                </View>
                <Text className="text-sm leading-5" style={{ color: theme.text }}>{message.body}</Text>
                {(canManage || message.user_id === currentUserId) ? (
                  <View className="flex-row justify-end gap-2">
                    {canManage ? (
                      <HeroButton size="sm" variant="ghost" onPress={() => void togglePin(message)}>
                        <Ionicons name={pinnedIds.has(message.id) ? 'pin-outline' : 'pin'} size={15} color={primary} />
                        <HeroButton.Label>{pinnedIds.has(message.id) ? t('detail.chatrooms.unpin') : t('detail.chatrooms.pin')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                    <HeroButton size="sm" variant="ghost" onPress={() => removeMessage(message)}>
                      <Ionicons name="trash-outline" size={15} color={theme.error} />
                      <HeroButton.Label style={{ color: theme.error }}>{t('common:buttons.delete')}</HeroButton.Label>
                    </HeroButton>
                  </View>
                ) : null}
              </Surface>
            ))}
            {hasMore ? (
              <HeroButton variant="secondary" isDisabled={loadingMore || !cursor} onPress={() => cursor && void loadMessages(activeRoom.id, cursor)}>
                {loadingMore ? <Spinner size="sm" /> : <HeroButton.Label>{t('common:buttons.loadMore')}</HeroButton.Label>}
              </HeroButton>
            ) : null}
            {loadError && messages.length > 0 ? <ErrorState subtitle={loadError} onRetry={() => void loadMessages(activeRoom.id, cursor)} isRetrying={loadingMore} /> : null}

            {(pendingMessage || messageRecoveryError) ? (
              <Surface variant="secondary" className="gap-2 rounded-panel-inner p-3" testID="group-chatroom-recovery">
                <Text className="text-sm font-semibold" style={{ color: theme.text }}>{t('detail.chatrooms.recoveryTitle')}</Text>
                <Text className="text-sm" style={{ color: theme.textSecondary }}>{messageRecoveryError ?? t('detail.chatrooms.recoveryNotice')}</Text>
                {pendingMessage ? (
                  <HeroButton size="sm" variant="ghost" onPress={() => void discardPending()}>
                    <HeroButton.Label>{t('detail.chatrooms.discard')}</HeroButton.Label>
                  </HeroButton>
                ) : null}
              </Surface>
            ) : null}
            <TextArea
              testID="group-chatroom-message-input"
              label={t('detail.chatrooms.messageLabel')}
              placeholder={t('detail.chatrooms.messagePlaceholder')}
              value={messageBody}
              maxLength={5000}
              editable={!isSending}
              onChangeText={setMessageBody}
            />
            <HeroButton testID="group-chatroom-send" isDisabled={!messageBody.trim() || isSending || Boolean(messageRecoveryError)} onPress={() => void sendMessage()}>
              {isSending ? <Spinner size="sm" /> : <><Ionicons name="send-outline" size={17} color={theme.onPrimary} /><HeroButton.Label>{t('detail.chatrooms.send')}</HeroButton.Label></>}
            </HeroButton>
          </HeroCard.Body>
        </HeroCard>
      ) : null}
      {confirmDialog}
    </View>
  );
}
