// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupMembersModal — who is in a group conversation, and managing that.
 *
 * Backed by GroupConversationController:
 *   GET    /v2/conversations/{id}/participants          — any active member
 *   POST   /v2/conversations/{id}/participants          — group admin only, max 50
 *   DELETE /v2/conversations/{id}/participants/{userId} — admin removes; anyone leaves (self)
 *
 * The server is the authority for every rule (blocks, safeguarding, limits);
 * the controls here only avoid offering an action the server will refuse, and
 * a refusal shows the server's own (localised) reason.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import UserMinus from 'lucide-react/icons/user-minus';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import type { User } from '@/types/api';

/** Laravel caps a group conversation at 50 active participants. */
export const GROUP_CONVERSATION_MAX_MEMBERS = 50;

export interface GroupParticipant {
  id: number;
  name: string;
  avatar_url?: string | null;
  role: 'admin' | 'member' | string;
  is_online?: boolean;
}

interface GroupMembersModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: number;
  /** Called after the viewer has left the group. */
  onLeft?: () => void;
  /** Called after the member list changed (add / remove). */
  onMembersChanged?: (participants: GroupParticipant[]) => void;
}

type PendingConfirm = { kind: 'remove'; member: GroupParticipant } | { kind: 'leave' } | null;

export function GroupMembersModal({ isOpen, onClose, conversationId, onLeft, onMembersChanged }: GroupMembersModalProps) {
  const { t } = useTranslation('messages');
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingConfirm>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const viewerId = currentUser?.id;
  const viewer = participants.find((p) => p.id === viewerId);
  const isAdmin = viewer?.role === 'admin';
  const isFull = participants.length >= GROUP_CONVERSATION_MAX_MEMBERS;
  const memberIds = useMemo(() => new Set(participants.map((p) => p.id)), [participants]);

  const loadParticipants = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      const res = await api.get<GroupParticipant[]>(`/v2/conversations/${conversationId}/participants`);
      if (res.success && Array.isArray(res.data)) {
        setParticipants(res.data);
        return res.data;
      }
      setLoadError(true);
    } catch (err) {
      logError('Failed to load group participants', err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
    return null;
  }, [conversationId]);

  useEffect(() => {
    if (!isOpen) return;
    setPending(null);
    setSearchQuery('');
    setSearchResults([]);
    void loadParticipants();
  }, [isOpen, loadParticipants]);

  const searchUsers = useCallback(async (query: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;
    try {
      setIsSearching(true);
      const res = await api.get<User[]>(`/v2/users?q=${encodeURIComponent(query)}&limit=10`);
      if (controller.signal.aborted) return;
      if (res.success && Array.isArray(res.data)) {
        setSearchResults(res.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to search users for group', err);
    } finally {
      if (!controller.signal.aborted) setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => void searchUsers(searchQuery.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchUsers]);

  const visibleResults = searchResults.filter((u) => u.id !== viewerId && !memberIds.has(u.id));

  const refreshAfterChange = async () => {
    const next = await loadParticipants();
    if (next) onMembersChanged?.(next);
  };

  const addMember = async (member: User) => {
    setBusyId(member.id);
    try {
      const res = await api.post(`/v2/conversations/${conversationId}/participants`, { user_id: member.id });
      if (res.success) {
        toast.success(t('group_member_added'));
        setSearchQuery('');
        setSearchResults([]);
        await refreshAfterChange();
      } else {
        toast.error(res.error || t('group_action_failed'));
      }
    } catch (err) {
      logError('Failed to add group participant', err);
      toast.error(t('group_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const removeMember = async (member: GroupParticipant) => {
    setBusyId(member.id);
    try {
      const res = await api.delete(`/v2/conversations/${conversationId}/participants/${member.id}`);
      if (res.success) {
        toast.success(t('group_member_removed'));
        setPending(null);
        await refreshAfterChange();
      } else {
        toast.error(res.error || t('group_action_failed'));
      }
    } catch (err) {
      logError('Failed to remove group participant', err);
      toast.error(t('group_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  const leaveGroup = async () => {
    if (!viewerId) return;
    setBusyId(viewerId);
    try {
      const res = await api.delete(`/v2/conversations/${conversationId}/participants/${viewerId}`);
      if (res.success) {
        toast.success(t('group_left'));
        setPending(null);
        onLeft?.();
        onClose();
      } else {
        toast.error(res.error || t('group_action_failed'));
      }
    } catch (err) {
      logError('Failed to leave group conversation', err);
      toast.error(t('group_action_failed'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalContent>
        <ModalHeader className="text-theme-primary flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" aria-hidden="true" />
          {t('group_participants')}
        </ModalHeader>
        <ModalBody>
          {isLoading && participants.length === 0 ? (
            <div className="flex justify-center py-6"><Spinner size="sm" /></div>
          ) : loadError ? (
            <p role="alert" className="text-sm text-danger">{t('group_load_error')}</p>
          ) : (
            <>
              <ul className="flex flex-col gap-1" aria-label={t('group_participants')}>
                {participants.map((member) => {
                  const isSelf = member.id === viewerId;
                  const confirmingRemove = pending?.kind === 'remove' && pending.member.id === member.id;
                  return (
                    <li key={member.id} className="rounded-lg bg-theme-elevated p-2">
                      <div className="flex items-center gap-3">
                        <Avatar src={resolveAvatarUrl(member.avatar_url ?? undefined)} name={member.name} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-theme-primary">
                            {member.name}
                            {isSelf && <span className="ml-1 text-sm text-theme-subtle">{t('group_you')}</span>}
                          </p>
                        </div>
                        <Chip size="sm" variant="soft">
                          {member.role === 'admin' ? t('group_admin') : t('group_member')}
                        </Chip>
                        {isAdmin && !isSelf && !confirmingRemove && (
                          <Button
                            isIconOnly
                            size="sm"
                            variant="tertiary"
                            aria-label={t('group_remove_aria', { name: member.name })}
                            isDisabled={busyId !== null}
                            onPress={() => setPending({ kind: 'remove', member })}
                          >
                            <UserMinus className="w-4 h-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                      {confirmingRemove && (
                        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-sm text-theme-primary">{t('group_remove_confirm', { name: member.name })}</p>
                          <div className="flex gap-2">
                            <Button size="sm" variant="danger" isLoading={busyId === member.id} onPress={() => void removeMember(member)}>
                              {t('group_confirm_remove')}
                            </Button>
                            <Button size="sm" variant="tertiary" isDisabled={busyId === member.id} onPress={() => setPending(null)}>
                              {t('cancel')}
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {viewer && !isAdmin && (
                <p className="text-xs text-theme-subtle">{t('group_only_admins')}</p>
              )}

              {isAdmin && (isFull ? (
                <p className="text-sm text-theme-subtle">{t('group_full', { max: GROUP_CONVERSATION_MAX_MEMBERS })}</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-theme-muted">{t('group_add_member')}</p>
                  <Input
                    placeholder={t('member_search_placeholder')}
                    aria-label={t('member_search_placeholder')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    startContent={<Search className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                    endContent={isSearching && <Spinner size="sm" />}
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {visibleResults.map((u) => (
                      <div key={u.id} className="flex items-center gap-3 rounded-lg bg-theme-elevated p-2">
                        <Avatar src={resolveAvatarUrl(u.avatar_url || u.avatar)} name={u.name} size="sm" />
                        <p className="min-w-0 flex-1 truncate text-theme-primary">{u.name}</p>
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={t('group_add_aria', { name: u.name })}
                          isLoading={busyId === u.id}
                          isDisabled={busyId !== null}
                          onPress={() => void addMember(u)}
                        >
                          {t('group_add_member')}
                        </Button>
                      </div>
                    ))}
                    {searchQuery.trim() && !isSearching && visibleResults.length === 0 && (
                      <p className="py-2 text-center text-sm text-theme-subtle">{t('member_search_empty')}</p>
                    )}
                  </div>
                </div>
              ))}

              {viewer && (pending?.kind === 'leave' ? (
                <div className="flex flex-col gap-2 rounded-lg border border-theme-default p-3">
                  <p className="text-sm text-theme-primary">{t('group_leave_confirm')}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="danger" isLoading={busyId === viewerId} onPress={() => void leaveGroup()}>
                      {t('group_confirm_leave')}
                    </Button>
                    <Button size="sm" variant="tertiary" isDisabled={busyId === viewerId} onPress={() => setPending(null)}>
                      {t('cancel')}
                    </Button>
                  </div>
                </div>
              ) : null)}
            </>
          )}
        </ModalBody>
        <ModalFooter>
          {viewer && pending?.kind !== 'leave' && (
            <Button variant="danger-soft" isDisabled={busyId !== null} onPress={() => setPending({ kind: 'leave' })}>
              {t('group_leave')}
            </Button>
          )}
          <Button variant="tertiary" onPress={onClose}>
            {t('group_close')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export default GroupMembersModal;
