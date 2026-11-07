// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { AlertDialog } from '@/components/ui/AlertDialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalHeading, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
/**
 * GroupModals — all dialog overlays for GroupDetailPage:
 * - NewDiscussionModal
 * - GroupSettingsModal
 * - GroupLeaveModal
 * - GroupDeleteModal
 * - GroupInviteModal
 * - GroupReportModal
 */

import { lazy, Suspense, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import MessageSquare from 'lucide-react/icons/message-square';
import Settings from 'lucide-react/icons/settings';
import UserMinus from 'lucide-react/icons/user-minus';
import UserPlus from 'lucide-react/icons/user-plus';
import Trash2 from 'lucide-react/icons/trash-2';
import FileText from 'lucide-react/icons/file-text';
import Upload from 'lucide-react/icons/upload';
import Image from 'lucide-react/icons/image';
import MapPin from 'lucide-react/icons/map-pin';
import X from 'lucide-react/icons/x';
import Flag from 'lucide-react/icons/flag';
import LinkIcon from 'lucide-react/icons/link';
import Mail from 'lucide-react/icons/mail';
import { ErrorBoundary } from '@/components/feedback';
import type { Group } from '@/types/api';
import { formatDateValue } from '@/lib/helpers';
import type { GroupFormCapabilities, GroupFormDraft, GroupInviteRecord, GroupInviteSendResult } from '../api';
import { GroupBrandingPicker } from './GroupBrandingPicker';

const RichTextEditor = lazy(() => import('@/admin/components/RichTextEditor'));

// ─────────────────────────────────────────────────────────────────────────────
// New Discussion Modal
// ─────────────────────────────────────────────────────────────────────────────

interface NewDiscussionModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  newDiscussionTitle: string;
  newDiscussionContent: string;
  creatingDiscussion: boolean;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  onSubmit: () => void;
}

export function NewDiscussionModal({
  isOpen,
  onOpenChange,
  newDiscussionTitle,
  newDiscussionContent,
  creatingDiscussion,
  onTitleChange,
  onContentChange,
  onSubmit,
}: NewDiscussionModalProps) {
  const { t } = useTranslation('groups');

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        footer: 'border-t border-theme-default',
      }}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="text-theme-primary flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('detail.new_discussion_modal_title')}
            </ModalHeader>
            <ModalBody className="gap-4">
              <div>
                <Input
                  label={t('detail.discussion_title_label')}
                  placeholder={t('detail.discussion_title_placeholder')}
                  value={newDiscussionTitle}
                  maxLength={255}
                  onChange={(e) => onTitleChange(e.target.value)}
                  startContent={<FileText className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                {newDiscussionTitle.length > Math.floor(255 * 0.8) && (
                  <p className={`text-xs mt-0.5 text-right ${newDiscussionTitle.length >= 255 ? 'text-danger' : 'text-muted'}`}>
                    {newDiscussionTitle.length}/255
                  </p>
                )}
              </div>
              <div>
                <label className="text-sm text-theme-muted mb-1 block">
                  {t('detail.discussion_content_label')}
                </label>
                <ErrorBoundary
                  fallback={
                    <Textarea
                      placeholder={t('detail.discussion_content_placeholder')}
                      minRows={4}
                      value={newDiscussionContent}
                      onChange={(e) => onContentChange(e.target.value)}
                      classNames={{ input: 'bg-transparent text-theme-primary', inputWrapper: 'bg-theme-elevated border-theme-default' }}
                    />
                  }
                >
                  <Suspense fallback={<div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-4"><Spinner size="sm" /></div>}>
                    <RichTextEditor
                      value={newDiscussionContent}
                      onChange={onContentChange}
                      placeholder={t('detail.discussion_content_placeholder')}
                    />
                  </Suspense>
                </ErrorBoundary>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" className="bg-theme-elevated text-theme-primary" onPress={onClose}>
                {t('detail.cancel')}
              </Button>
              <Button
                color="primary"
                isLoading={creatingDiscussion}
                isDisabled={!newDiscussionTitle.trim() || !newDiscussionContent.trim()}
                onPress={onSubmit}
              >
                {t('detail.create_discussion_btn')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Modal
// ─────────────────────────────────────────────────────────────────────────────

interface GroupSettingsModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  group: Group;
  draft: GroupFormDraft;
  capabilities: GroupFormCapabilities | null;
  savingSettings: boolean;
  onDraftChange: Dispatch<SetStateAction<GroupFormDraft>>;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'cover') => void;
  onImageRemove: (type: 'avatar' | 'cover') => void;
  onSave: () => void;
}

export function GroupSettingsModal({
  isOpen,
  onOpenChange,
  group,
  draft,
  capabilities,
  savingSettings,
  onDraftChange,
  onImageUpload,
  onImageRemove,
  onSave,
}: GroupSettingsModalProps) {
  const { t } = useTranslation('groups');
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const nameMax = capabilities?.limits.nameMax ?? 255;
  const descriptionMax = capabilities?.limits.descriptionMax ?? 2000;
  const locationMax = capabilities?.limits.locationMax ?? 255;
  const avatarUrl = draft.avatar.action === 'remove'
    ? null
    : draft.avatar.previewUrl ?? draft.avatar.existingUrl;
  const coverUrl = draft.cover.action === 'remove'
    ? null
    : draft.cover.previewUrl ?? draft.cover.existingUrl;

  const updateDraft = (patch: Partial<GroupFormDraft>) => {
    onDraftChange((previous) => ({ ...previous, ...patch }));
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size="lg"
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
              <Settings className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('detail.settings_modal_title')}
            </ModalHeader>
            <ModalBody className="gap-4">
              <div>
                <Input
                  label={t('detail.settings_name_label')}
                  placeholder={t('detail.settings_name_placeholder')}
                  value={draft.name}
                  maxLength={nameMax}
                  onChange={(e) => updateDraft({ name: e.target.value })}
                  startContent={<FileText className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                {draft.name.length > Math.floor(nameMax * 0.8) && (
                  <p className={`text-xs mt-0.5 text-right ${draft.name.length >= nameMax ? 'text-danger' : 'text-muted'}`}>
                    {draft.name.length}/{nameMax}
                  </p>
                )}
              </div>
              <div>
                <Textarea
                  label={t('detail.settings_desc_label')}
                  placeholder={t('detail.settings_desc_placeholder')}
                  value={draft.description}
                  maxLength={descriptionMax}
                  onChange={(e) => updateDraft({ description: e.target.value })}
                  minRows={3}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                {draft.description.length > Math.floor(descriptionMax * 0.8) && (
                  <p className={`text-xs mt-0.5 text-right ${draft.description.length >= descriptionMax ? 'text-danger' : 'text-muted'}`}>
                    {draft.description.length}/{descriptionMax}
                  </p>
                )}
              </div>
              <div>
                <Input
                  label={t('detail.settings_location_label')}
                  placeholder={t('detail.settings_location_placeholder')}
                  value={draft.location.label}
                  maxLength={locationMax}
                  onChange={(e) => {
                    const label = e.target.value;
                    onDraftChange((previous) => ({
                      ...previous,
                      location: label === previous.location.label
                        ? previous.location
                        : { label, latitude: null, longitude: null },
                    }));
                  }}
                  startContent={<MapPin className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                {draft.location.label.length > Math.floor(locationMax * 0.8) && (
                  <p className={`text-xs mt-0.5 text-right ${draft.location.label.length >= locationMax ? 'text-danger' : 'text-muted'}`}>
                    {draft.location.label.length}/{locationMax}
                  </p>
                )}
              </div>
              {/* Images */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-theme-elevated border border-theme-default">
                  <p className="text-sm font-medium text-theme-primary mb-2 flex items-center gap-1.5">
                    <Image className="w-4 h-4" aria-hidden="true" />
                    {t('detail.settings_image_label')}
                  </p>
                  {avatarUrl && (
                    <img src={avatarUrl} alt={t('detail.image_alt_group')} className="mb-2 h-16 w-16 rounded-xl object-cover" />
                  )}
                  <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    startContent={<Upload className="w-3 h-3" aria-hidden="true" />}
                    onPress={() => avatarInputRef.current?.click()}
                  >
                    {avatarUrl ? t('form.change_image') : t('detail.upload_image')}
                  </Button>
                  {avatarUrl && (
                    <Button size="sm" variant="flat" color="danger" startContent={<X className="h-3 w-3" aria-hidden="true" />} onPress={() => onImageRemove('avatar')}>
                      {t('form.remove_image')}
                    </Button>
                  )}
                  </div>
                  <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => onImageUpload(e, 'avatar')} />
                  {avatarUrl && (
                    <Input
                      className="mt-2"
                      size="sm"
                      label={t('form.image_alt_label')}
                      description={t('form.image_alt_hint')}
                      value={draft.avatar.alt}
                      maxLength={255}
                      onChange={(e) => {
                        const value = e.target.value;
                        onDraftChange((previous) => ({ ...previous, avatar: { ...previous.avatar, alt: value } }));
                      }}
                    />
                  )}
                </div>
                <div className="p-3 rounded-lg bg-theme-elevated border border-theme-default">
                  <p className="text-sm font-medium text-theme-primary mb-2 flex items-center gap-1.5">
                    <Image className="w-4 h-4" aria-hidden="true" />
                    {t('detail.settings_cover_label')}
                  </p>
                  {coverUrl && (
                    <img
                      src={coverUrl}
                      alt={t('detail.image_alt_cover')}
                      className="w-full h-10 rounded object-cover mb-2"
                      width={400}
                      height={40}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="flat" color="primary" startContent={<Upload className="w-3 h-3" aria-hidden="true" />} onPress={() => coverInputRef.current?.click()}>
                      {coverUrl ? t('form.change_image') : t('detail.upload_cover')}
                    </Button>
                    {coverUrl && (
                      <Button size="sm" variant="flat" color="danger" startContent={<X className="h-3 w-3" aria-hidden="true" />} onPress={() => onImageRemove('cover')}>
                        {t('form.remove_image')}
                      </Button>
                    )}
                  </div>
                  <input ref={coverInputRef} type="file" accept="image/jpeg,image/png,image/gif,image/webp" className="hidden" onChange={(e) => onImageUpload(e, 'cover')} />
                  {coverUrl && (
                    <Input
                      className="mt-2"
                      size="sm"
                      label={t('form.image_alt_label')}
                      description={t('form.image_alt_hint')}
                      value={draft.cover.alt}
                      maxLength={255}
                      onChange={(e) => {
                        const value = e.target.value;
                        onDraftChange((previous) => ({ ...previous, cover: { ...previous.cover, alt: value } }));
                      }}
                    />
                  )}
                </div>
              </div>
              <Select
                label={t('form.visibility_label')}
                selectedKeys={new Set([draft.visibility])}
                onSelectionChange={(keys) => {
                  const [key] = Array.from(keys);
                  if (key === 'public' || key === 'private' || key === 'secret') updateDraft({ visibility: key });
                }}
              >
                {(capabilities?.allowedVisibility ?? ['public', 'private']).map((option) => (
                  <SelectItem key={option} id={option} textValue={t(`form.visibility_${option}`)}>
                    {t(`form.visibility_${option}`)}
                  </SelectItem>
                ))}
              </Select>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {capabilities?.fields.type && capabilities.groupTypes.length > 0 && (
                  <Select
                    label={t('form.type_label')}
                    selectedKeys={new Set([draft.typeId === null ? '__none__' : String(draft.typeId)])}
                    onSelectionChange={(keys) => {
                      const [key] = Array.from(keys);
                      updateDraft({ typeId: !key || key === '__none__' ? null : Number(key) });
                    }}
                  >
                    <SelectItem id="__none__">{t('form.type_none')}</SelectItem>
                    {capabilities.groupTypes.map((type) => (
                      <SelectItem key={type.id} id={String(type.id)} textValue={type.name}>{type.name}</SelectItem>
                    ))}
                  </Select>
                )}
                {capabilities?.fields.parent && (
                  <Select
                    label={t('form.parent_label')}
                    selectedKeys={new Set([draft.parentId === null ? '__none__' : String(draft.parentId)])}
                    onSelectionChange={(keys) => {
                      const [key] = Array.from(keys);
                      updateDraft({ parentId: !key || key === '__none__' ? null : Number(key) });
                    }}
                  >
                    <SelectItem id="__none__">{t('form.parent_none')}</SelectItem>
                    {capabilities.parentCandidates.filter((parent) => parent.id !== group.id).map((parent) => (
                      <SelectItem key={parent.id} id={String(parent.id)} textValue={parent.name}>{parent.name}</SelectItem>
                    ))}
                  </Select>
                )}
              </div>
              {capabilities?.fields.branding && (
                <GroupBrandingPicker
                  primaryColor={draft.primaryColor}
                  accentColor={draft.accentColor}
                  onChange={(primaryColor, accentColor) => updateDraft({ primaryColor, accentColor })}
                />
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" className="bg-theme-elevated text-theme-primary" onPress={() => onOpenChange(false)}>
                {t('detail.cancel')}
              </Button>
              <Button
                color="primary"
                isLoading={savingSettings}
                isDisabled={draft.name.trim().length < (capabilities?.limits.nameMin ?? 3) || draft.description.trim().length < (capabilities?.limits.descriptionMin ?? 1)}
                onPress={onSave}
              >
                {t('detail.save_changes')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Leave Confirmation Modal
// ─────────────────────────────────────────────────────────────────────────────

interface GroupLeaveModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  mode?: 'leave' | 'cancel_request';
  isLoading: boolean;
  onConfirm: () => void;
}

export function GroupLeaveModal({
  isOpen,
  onOpenChange,
  groupName,
  mode = 'leave',
  isLoading,
  onConfirm,
}: GroupLeaveModalProps) {
  const { t } = useTranslation('groups');
  const cancellingRequest = mode === 'cancel_request';

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        footer: 'border-t border-theme-default',
      }}
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="text-theme-primary flex items-center gap-2">
              <UserMinus className="w-5 h-5" aria-hidden="true" />
              {t(cancellingRequest ? 'detail.cancel_join_request_title' : 'detail.leave_group_title')}
            </ModalHeader>
            <ModalBody>
              <p className="text-theme-secondary">
                {t(
                  cancellingRequest ? 'detail.cancel_join_request_confirm' : 'detail.leave_group_confirm',
                  { name: groupName },
                )}
              </p>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" className="bg-theme-elevated text-theme-primary" onPress={onClose}>
                {t('detail.cancel')}
              </Button>
              <Button
                color="danger"
                isLoading={isLoading}
                onPress={onConfirm}
              >
                {t(cancellingRequest ? 'detail.cancel_join_request' : 'detail.leave_group')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete Confirmation Modal
// ─────────────────────────────────────────────────────────────────────────────

interface GroupDeleteModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  groupName: string;
  isLoading: boolean;
  onConfirm: () => void;
}

export function GroupDeleteModal({
  isOpen,
  onOpenChange,
  groupName,
  isLoading,
  onConfirm,
}: GroupDeleteModalProps) {
  const { t } = useTranslation('groups');
  const [confirmationName, setConfirmationName] = useState('');
  const isConfirmed = confirmationName === groupName;

  useEffect(() => {
    if (!isOpen) setConfirmationName('');
  }, [isOpen]);

  const handleOpenChange = (open: boolean) => {
    if (isLoading && !open) return;
    if (!open) setConfirmationName('');
    onOpenChange(open);
  };

  return (
    <AlertDialog.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialog.Container>
        <AlertDialog.Dialog className="sm:max-w-[480px]">
          <AlertDialog.CloseTrigger isDisabled={isLoading} aria-label={t('detail.cancel')} />
          <AlertDialog.Header>
            <AlertDialog.Icon status="danger" />
            <AlertDialog.Heading>{t('detail.delete_modal_title')}</AlertDialog.Heading>
          </AlertDialog.Header>
          <AlertDialog.Body>
            <div className="space-y-4">
              <p>{t('detail.delete_confirm', { name: groupName })}</p>
              <p className="text-sm text-theme-muted">{t('detail.delete_desc')}</p>
              <Input
                autoComplete="off"
                label={t('detail.delete_name_label')}
                description={t('detail.delete_name_instruction', { name: groupName })}
                value={confirmationName}
                onValueChange={setConfirmationName}
                isDisabled={isLoading}
              />
            </div>
          </AlertDialog.Body>
          <AlertDialog.Footer>
            <Button
              variant="tertiary"
              isDisabled={isLoading}
              onPress={() => handleOpenChange(false)}
            >
              {t('detail.cancel')}
            </Button>
            <Button
              variant="danger"
              isDisabled={!isConfirmed || isLoading}
              isLoading={isLoading}
              onPress={onConfirm}
              startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
            >
              {t('detail.delete_btn')}
            </Button>
          </AlertDialog.Footer>
        </AlertDialog.Dialog>
      </AlertDialog.Container>
    </AlertDialog.Backdrop>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Invite Modal
// ─────────────────────────────────────────────────────────────────────────────

interface GroupInviteModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  inviteLink: string | null;
  inviteEmails: string;
  inviteMessage: string;
  sendingInvites: boolean;
  pendingInvites: GroupInviteRecord[];
  inviteResults: GroupInviteSendResult[];
  invitesLoading: boolean;
  revokingInvite: number | null;
  onGenerateLink: () => void;
  onEmailsChange: (value: string) => void;
  onMessageChange: (value: string) => void;
  onSendInvites: () => void;
  onCopyLink: (link: string) => void;
  onRevokeInvite: (inviteId: number) => void;
}

export function GroupInviteModal({
  isOpen,
  onOpenChange,
  inviteLink,
  inviteEmails,
  inviteMessage,
  sendingInvites,
  pendingInvites,
  inviteResults,
  invitesLoading,
  revokingInvite,
  onGenerateLink,
  onEmailsChange,
  onMessageChange,
  onSendInvites,
  onCopyLink,
  onRevokeInvite,
}: GroupInviteModalProps) {
  const { t } = useTranslation('groups');

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        footer: 'border-t border-theme-default',
      }}
      size="lg"
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="text-theme-primary flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-accent" aria-hidden="true" />
              {t('detail.invite_members')}
            </ModalHeader>
            <ModalBody>
              <div className="space-y-4">
                {/* Invite link */}
                <div>
                  <p className="text-sm text-theme-subtle mb-2">{t('detail.invite_link_desc')}</p>
                  {inviteLink ? (
                    <div className="flex items-center gap-2">
                      <Input value={inviteLink} readOnly size="sm" className="flex-1" aria-label={t('detail.invite_link_desc')} />
                      <Button size="sm" variant="flat" onPress={() => onCopyLink(inviteLink)}>
                        {t('detail.copy')}
                      </Button>
                    </div>
                  ) : (
                    <Button size="sm" variant="bordered" onPress={onGenerateLink}>
                      {t('detail.generate_link')}
                    </Button>
                  )}
                </div>

                <div className="border-t border-theme-default pt-4">
                  <p className="text-sm text-theme-subtle mb-2">{t('detail.invite_email_desc')}</p>
                  <Textarea
                    placeholder={t('detail.invite_email_placeholder')}
                    value={inviteEmails}
                    onValueChange={onEmailsChange}
                    minRows={2}
                    size="sm"
                    aria-label={t('detail.invite_emails_aria')}
                  />
                  <Input
                    label={t('detail.invite_message_label')}
                    placeholder={t('detail.invite_message_placeholder')}
                    value={inviteMessage}
                    onValueChange={onMessageChange}
                    size="sm"
                    className="mt-2"
                  />
                </div>

                {inviteResults.length > 0 && (
                  <div className="border-t border-theme-default pt-4" aria-live="polite">
                    <ul className="space-y-2">
                      {inviteResults.map((result, index) => {
                        const statusKey = result.status === 'sent'
                          ? result.email_delivered === false
                            ? 'detail.invite_result_delivery_failed'
                            : 'detail.invite_result_sent'
                          : result.status === 'already_member'
                            ? 'detail.invite_result_already_member'
                            : result.status === 'already_invited'
                              ? 'detail.invite_result_already_invited'
                              : 'detail.invite_result_failed';
                        return (
                          <li
                            key={`${result.email}-${index}`}
                            className="flex flex-col gap-1 rounded-lg bg-theme-elevated px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                          >
                            <span className="break-all text-theme-primary">{result.email}</span>
                            <span className={result.status === 'sent' && result.email_delivered !== false
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-theme-muted'
                            }>
                              {t(statusKey)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="border-t border-theme-default pt-4">
                  <h3 className="mb-3 text-sm font-semibold text-theme-primary">
                    {t('detail.pending_invites')}
                  </h3>
                  {invitesLoading ? (
                    <div className="flex justify-center py-4" role="status" aria-label={t('detail.pending_invites')}>
                      <Spinner size="sm" />
                    </div>
                  ) : pendingInvites.length === 0 ? (
                    <p className="text-sm text-theme-muted">{t('detail.no_pending_invites')}</p>
                  ) : (
                    <ul className="max-h-64 space-y-2 overflow-y-auto pe-1">
                      {pendingInvites.map((invite) => (
                        <li
                          key={invite.id}
                          className="flex flex-col gap-3 rounded-lg bg-theme-elevated p-3 sm:flex-row sm:items-center sm:justify-between"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            {invite.type === 'link'
                              ? <LinkIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
                              : <Mail className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" aria-hidden="true" />
                            }
                            <div className="min-w-0">
                              <p className="break-all text-sm font-medium text-theme-primary">
                                {invite.email || t(invite.type === 'link' ? 'detail.invite_type_link' : 'detail.invite_type_email')}
                              </p>
                              <p className="text-xs text-theme-muted">
                                {t('detail.invite_expires', { date: formatDateValue(invite.expires_at) })}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 gap-2">
                            {invite.invite_url && (
                              <Button size="sm" variant="flat" onPress={() => onCopyLink(invite.invite_url!)}>
                                {t('detail.copy')}
                              </Button>
                            )}
                            <Button
                              size="sm"
                              color="danger"
                              variant="flat"
                              isLoading={revokingInvite === invite.id}
                              aria-label={t('detail.revoke_invite_aria', { recipient: invite.email || t('detail.invite_type_link') })}
                              onPress={() => onRevokeInvite(invite.id)}
                            >
                              {t('detail.revoke_invite')}
                            </Button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="flat" onPress={onClose}>
                {t('detail.cancel')}
              </Button>
              <Button
                color="primary"
                onPress={onSendInvites}
                isLoading={sendingInvites}
                isDisabled={!inviteEmails.trim()}
              >
                {t('detail.send_invites')}
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Report Post Modal
// ─────────────────────────────────────────────────────────────────────────────

interface GroupReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  reportReason: string;
  isReporting: boolean;
  onReasonChange: (value: string) => void;
  onSubmit: () => void;
}

export function GroupReportModal({
  isOpen,
  onClose,
  reportReason,
  isReporting,
  onReasonChange,
  onSubmit,
}: GroupReportModalProps) {
  const { t } = useTranslation('groups');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      classNames={{
        base: 'bg-overlay border border-theme-default',
        header: 'border-b border-theme-default',
        footer: 'border-t border-theme-default',
        backdrop: 'bg-black/60 backdrop-blur-sm',
      }}
    >
      <ModalContent>
        <ModalHeader className="flex items-center gap-3 text-theme-primary">
          <div className="w-8 h-8 rounded-lg bg-danger/10 flex items-center justify-center">
            <Flag className="w-4 h-4 text-danger" aria-hidden="true" />
          </div>
          <ModalHeading>{t('detail.report_title')}</ModalHeading>
        </ModalHeader>
        <ModalBody>
          <p className="text-sm text-theme-muted mb-3">
            {t('detail.report_description')}
          </p>
          <Textarea
            label={t('detail.report_reason_label')}
            placeholder={t('detail.report_reason_placeholder')}
            value={reportReason}
            onChange={(e) => onReasonChange(e.target.value)}
            minRows={3}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
              label: 'text-theme-muted',
            }}
            autoFocus
          />
        </ModalBody>
        <ModalFooter>
          <Button
            variant="flat"
            onPress={onClose}
            className="text-theme-muted"
          >
            {t('detail.cancel')}
          </Button>
          <Button
            color="danger"
            variant="flat"
            onPress={onSubmit}
            isLoading={isReporting}
            isDisabled={!reportReason.trim()}
            className="font-medium"
          >
            {t('detail.report_submit')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
