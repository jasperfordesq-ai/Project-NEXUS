// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Group Announcements Tab (GR3)
 * Announcements with pinning, creation for admins.
 */

import { useState, useEffect, useCallback } from 'react';

import Megaphone from 'lucide-react/icons/megaphone';
import Pin from 'lucide-react/icons/pin';
import PinOff from 'lucide-react/icons/pin-off';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Edit from 'lucide-react/icons/square-pen';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { useTranslation } from 'react-i18next';
import { MemberPlainText } from '@/components/ui/MemberPlainText';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import {
  createGroupAnnouncement,
  deleteGroupAnnouncement,
  listGroupAnnouncements,
  notifyGroupAnnouncementsChanged,
  updateGroupAnnouncement,
  type GroupAnnouncement as Announcement,
} from '../api/announcements';
import { GroupApiError } from '../api/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupAnnouncementsTabProps {
  groupId: number;
  isAdmin: boolean;
  isMember?: boolean;
}

function sortAnnouncements(items: Announcement[]): Announcement[] {
  return [...items].sort((a, b) => {
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupAnnouncementsTab({ groupId, isAdmin }: GroupAnnouncementsTabProps) {
  const { t } = useTranslation('groups');
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [isPinned, setIsPinned] = useState(false);
  const [editingTarget, setEditingTarget] = useState<Announcement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Announcement | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Load announcements ───
  const loadAnnouncements = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const items = [...await listGroupAnnouncements(groupId, { signal })];
      if (!signal?.aborted) setAnnouncements(sortAnnouncements(items));
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupAnnouncementsTab.load', err);
      toast.error(t('announcements.load_failed'));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [groupId, toast, t]);

  useEffect(() => {
    const controller = new AbortController();
    void loadAnnouncements(controller.signal);
    return () => controller.abort();
  }, [loadAnnouncements]);

  // ─── Create announcement ───
  const closeComposer = useCallback(() => {
    setEditingTarget(null);
    setTitle('');
    setContent('');
    setIsPinned(false);
    onClose();
  }, [onClose]);

  const openCreate = useCallback(() => {
    setEditingTarget(null);
    setTitle('');
    setContent('');
    setIsPinned(false);
    onOpen();
  }, [onOpen]);

  const openEdit = useCallback((announcement: Announcement) => {
    setEditingTarget(announcement);
    setTitle(announcement.title);
    setContent(announcement.content);
    setIsPinned(Boolean(announcement.is_pinned));
    onOpen();
  }, [onOpen]);

  const handleSubmit = useCallback(async () => {
    if (!title.trim() || !content.trim()) return;
    setCreating(true);
    try {
      const input = { title: title.trim(), content: content.trim(), is_pinned: isPinned };
      if (editingTarget) {
        const updated = await updateGroupAnnouncement(groupId, editingTarget.id, input);
        setAnnouncements((prev) => sortAnnouncements(prev.map((announcement) => (
          announcement.id === editingTarget.id
            ? { ...announcement, ...input, ...(updated ?? {}) }
            : announcement
        ))));
        toast.success(t('announcements.updated'));
      } else {
        await createGroupAnnouncement(groupId, input);
        toast.success(t('announcements.created'));
        void loadAnnouncements();
      }
      notifyGroupAnnouncementsChanged(groupId);
      closeComposer();
    } catch (err) {
      logError(editingTarget ? 'GroupAnnouncementsTab.edit' : 'GroupAnnouncementsTab.create', err);
      toast.error(t(editingTarget ? 'announcements.update_failed' : 'announcements.create_failed'));
    } finally {
      setCreating(false);
    }
  }, [groupId, title, content, isPinned, editingTarget, toast, loadAnnouncements, closeComposer, t]);

  // ─── Toggle pin ───
  const handleTogglePin = useCallback(async (announcement: Announcement) => {
    try {
      const updated = await updateGroupAnnouncement(groupId, announcement.id, {
        is_pinned: !announcement.is_pinned,
      });
      setAnnouncements((prev) => sortAnnouncements(
        prev.map((a) =>
          a.id === announcement.id ? { ...a, is_pinned: !a.is_pinned, ...(updated ?? {}) } : a
        )
      ));
      notifyGroupAnnouncementsChanged(groupId);
      toast.success(announcement.is_pinned ? t('announcements.unpinned') : t('announcements.pinned_success'));
    } catch (err) {
      logError('GroupAnnouncementsTab.togglePin', err);
      toast.error(t('announcements.update_failed'));
    }
  }, [groupId, toast, t]);

  // ─── Delete ───
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteGroupAnnouncement(groupId, deleteTarget.id);
      toast.success(t('announcements.deleted'));
      setAnnouncements((prev) => prev.filter((a) => a.id !== deleteTarget.id));
      notifyGroupAnnouncementsChanged(groupId);
      setDeleteTarget(null);
    } catch (err) {
      logError('GroupAnnouncementsTab.delete', err);
      toast.error(t('announcements.delete_failed'));
    } finally {
      setDeleting(false);
    }
  }, [groupId, deleteTarget, toast, t]);

  // ─── Render ───
  return (
    <div className="space-y-4">
      {/* Header */}
      <GlassCard className="p-4 sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
            <Megaphone className="w-5 h-5" aria-hidden="true" />
            {t('announcements.heading')}
          </h2>
          {isAdmin && (
            <Button
              color="primary"
              className="w-full sm:w-auto"
              size="sm"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={openCreate}
            >
              {t('announcements.new')}
            </Button>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('announcements.loading')}>
            <Spinner size="lg" />
          </div>
        ) : announcements.length === 0 ? (
          <EmptyState
            icon={<Megaphone className="w-12 h-12" aria-hidden="true" />}
            title={t('announcements.no_announcements_title')}
            description={isAdmin ? t('announcements.no_announcements_admin_desc') : t('announcements.no_announcements_desc')}
          />
        ) : (
          <div className="space-y-3">
            {announcements.map((announcement) => (
              <div
                key={announcement.id}
                className={`p-4 rounded-lg border transition-colors ${
                  announcement.is_pinned
                    ? 'border-accent/30 bg-accent/5'
                    : 'border-theme-default bg-theme-elevated'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {announcement.is_pinned && (
                        <Pin className="w-3.5 h-3.5 text-accent flex-shrink-0" aria-hidden="true" />
                      )}
                      <h3 className="font-semibold text-theme-primary truncate">
                        {announcement.title}
                      </h3>
                      {announcement.is_pinned && (
                        <Chip size="sm" variant="flat" color="primary" className="flex-shrink-0">
                          {t('announcements.pinned')}
                        </Chip>
                      )}
                    </div>
                    <MemberPlainText content={announcement.content} className="break-words text-sm text-theme-secondary whitespace-pre-wrap" as="div" />
                    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-subtle">
                      <span className="min-w-0 break-words">{announcement.author.name}</span>
                      <span className="text-theme-muted" aria-hidden="true">&middot;</span>
                      <time dateTime={announcement.created_at}>{formatRelativeTime(announcement.created_at)}</time>
                    </div>
                  </div>

                  {isAdmin && (
                    <Dropdown>
                      <DropdownTrigger>
                        <Button isIconOnly variant="light" size="sm" className="min-h-11 min-w-11" aria-label={t('announcements.actions_aria')}>
                          <MoreVertical className="w-4 h-4" aria-hidden="true" />
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu aria-label={t('announcements.dropdown_aria')}>
                        <DropdownItem
                          key="pin" id="pin"
                          startContent={announcement.is_pinned ? <PinOff className="w-4 h-4" aria-hidden="true" /> : <Pin className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => handleTogglePin(announcement)}
                        >
                          {announcement.is_pinned ? t('announcements.unpin') : t('announcements.pin')}
                        </DropdownItem>
                        <DropdownItem
                          key="edit" id="edit"
                          startContent={<Edit className="w-4 h-4" aria-hidden="true" />}
                          onPress={() => openEdit(announcement)}
                        >
                          {t('announcements.edit')}
                        </DropdownItem>
                        <DropdownItem
                          key="delete" id="delete"
                          startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                          className="text-danger"
                          color="danger"
                          onPress={() => setDeleteTarget(announcement)}
                        >
                          {t('announcements.delete')}
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Create/edit announcement modal */}
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => !open && closeComposer()}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="text-theme-primary flex items-center gap-2">
                <Megaphone className="w-5 h-5 text-accent" aria-hidden="true" />
                {t(editingTarget ? 'announcements.edit_title' : 'announcements.new')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('announcements.title_label')}
                  placeholder={t('announcements.title_placeholder')}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                <Textarea
                  label={t('announcements.content_label')}
                  placeholder={t('announcements.content_placeholder')}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  minRows={4}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                <div className="flex items-center gap-3">
                  <Button
                    size="sm"
                    variant={isPinned ? 'solid' : 'flat'}
                    color={isPinned ? 'primary' : 'default'}
                    startContent={<Pin className="w-4 h-4" />}
                    onPress={() => setIsPinned(!isPinned)}
                    aria-pressed={isPinned}
                  >
                    {isPinned ? t('announcements.pinned') : t('announcements.pin_this')}
                  </Button>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={closeComposer}>{t('announcements.cancel')}</Button>
                <Button
                  color="primary"
                  isLoading={creating}
                  isDisabled={!title.trim() || !content.trim()}
                  onPress={handleSubmit}
                >
                  {t(editingTarget ? 'announcements.save' : 'announcements.post')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        isOpen={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onModalClose) => (
            <>
              <ModalHeader className="text-theme-primary">{t('announcements.delete_title')}</ModalHeader>
              <ModalBody>
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
                  <p className="text-theme-secondary">
                    {t('announcements.delete_confirm', { name: deleteTarget?.title })}
                  </p>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onModalClose}>{t('announcements.cancel')}</Button>
                <Button color="danger" isLoading={deleting} onPress={handleDelete}>{t('announcements.delete')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GroupAnnouncementsTab;
