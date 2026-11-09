// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import { useAuth, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl } from '@/lib/helpers';
import type { User } from '@/types/api';

interface CreateGroupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (groupId: number) => void;
}

export function CreateGroupModal({ isOpen, onClose, onCreated }: CreateGroupModalProps) {
  const { t } = useTranslation('messages');
  const { user: currentUser } = useAuth();
  const toast = useToast();

  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<User[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  const searchAbortRef = useRef<AbortController | null>(null);

  const searchUsers = useCallback(async (query: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      setIsSearching(true);
      const response = await api.get<User[]>(`/v2/users?q=${encodeURIComponent(query)}&limit=10`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        // Filter out current user and already selected members
        const selectedIds = new Set(selectedMembers.map((m) => m.id));
        const filtered = response.data.filter(
          (u) => u.id !== currentUser?.id && !selectedIds.has(u.id)
        );
        setSearchResults(filtered);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to search users for group', err);
    } finally {
      setIsSearching(false);
    }
  }, [currentUser?.id, selectedMembers]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => searchUsers(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery, searchUsers]);

  function handleSelectMember(user: User) {
    setSelectedMembers((prev) => [...prev, user]);
    setSearchQuery('');
    setSearchResults([]);
  }

  function handleRemoveMember(userId: number) {
    setSelectedMembers((prev) => prev.filter((m) => m.id !== userId));
  }

  async function handleCreate() {
    if (!groupName.trim() || selectedMembers.length < 2) return;

    setIsCreating(true);
    try {
      const response = await api.post<{ id: number }>('/v2/conversations/groups', {
        name: groupName.trim(),
        member_ids: selectedMembers.map((m) => m.id),
      });

      if (response.success && response.data) {
        toast.success(t('group_created'), t('group_created_desc'));
        onCreated(response.data.id);
        handleClose();
      }
    } catch (err) {
      logError('Failed to create group conversation', err);
      toast.error(t('error_title'), t('create_group_error'));
    } finally {
      setIsCreating(false);
    }
  }

  function handleClose() {
    setGroupName('');
    setSelectedMembers([]);
    setSearchQuery('');
    setSearchResults([]);
    onClose();
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        body: 'py-4',
      }}
    >
      <ModalContent>
        <ModalHeader className="text-theme-primary flex items-center gap-2">
          <Users className="w-5 h-5 text-accent" />
          {t('create_group_title')}
        </ModalHeader>
        <ModalBody>
          {/* Group name */}
          <Input
            label={t('group_name_label')}
            placeholder={t('group_name_placeholder')}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            maxLength={100}
            classNames={{
              input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
              inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
            }}
            autoFocus />

          {/* Selected members */}
          {selectedMembers.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-theme-muted">
                {t('selected_members', { count: selectedMembers.length })}
              </p>
              <div className="flex flex-wrap gap-2">
                {selectedMembers.map((member) => (
                  <Chip
                    key={member.id}
                    onClose={() => handleRemoveMember(member.id)}
                    variant="soft"
                    avatar={
                      <Avatar
                        src={resolveAvatarUrl(member.avatar_url || member.avatar)}
                        name={member.name}
                        size="sm" />
                    }
                  >
                    {member.name}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {/* Member search */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-theme-muted">{t('add_members')}</p>
            <Input
              placeholder={t('member_search_placeholder')}
              aria-label={t('member_search_placeholder')}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              startContent={<Search className="w-4 h-4 text-theme-subtle" />}
              endContent={isSearching && <Spinner size="sm" />}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }} />
            {selectedMembers.length < 2 && (
              <p className="text-xs text-theme-subtle">{t('add_members_hint')}</p>
            )}
          </div>

          {/* Search results */}
          <div className="max-h-48 overflow-y-auto space-y-1">
            {searchResults.map((user) => (
              <Button
                key={user.id}
                variant="secondary"
                className="w-full flex min-h-14 items-center gap-3 p-3 rounded-lg bg-theme-elevated text-left justify-start"
                onPress={() => handleSelectMember(user)}
              >
                <Avatar
                  src={resolveAvatarUrl(user.avatar_url || user.avatar)}
                  name={user.name}
                  size="sm"
                  className="ring-2 ring-theme-default" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-theme-primary truncate">{user.name}</p>
                  {user.tagline && (
                    <p className="text-sm text-theme-subtle truncate">{user.tagline}</p>
                  )}
                </div>
              </Button>
            ))}
            {searchQuery.trim() && !isSearching && searchResults.length === 0 && (
              <p className="text-center text-theme-subtle py-4">{t('member_search_empty')}</p>
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={handleClose}>
            {t('cancel')}
          </Button>
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
            onPress={handleCreate}
            isLoading={isCreating}
            isDisabled={!groupName.trim() || selectedMembers.length < 2}
          >
            {t('create_group')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
