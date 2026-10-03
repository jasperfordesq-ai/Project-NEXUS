// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Group Files Tab (GR1)
 * File upload, download, folder organization within a group.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';

import FolderOpen from 'lucide-react/icons/folder-open';
import Upload from 'lucide-react/icons/upload';
import Download from 'lucide-react/icons/download';
import Trash2 from 'lucide-react/icons/trash-2';
import File from 'lucide-react/icons/file';
import FileText from 'lucide-react/icons/file-text';
import FileImage from 'lucide-react/icons/file-image';
import FileVideo from 'lucide-react/icons/file-video';
import FileAudio from 'lucide-react/icons/file-audio';
import FileArchive from 'lucide-react/icons/file-archive';
import FolderPlus from 'lucide-react/icons/folder-plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import X from 'lucide-react/icons/x';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import {
  deleteGroupFile,
  downloadGroupFile,
  listGroupFileFolders,
  listGroupFiles,
  uploadGroupFile,
  type GroupFile,
  type GroupFileFolder,
} from '../api/files';
import { GroupApiError } from '../api/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupFilesTabProps {
  groupId: number;
  isAdmin: boolean;
  isMember?: boolean;
  currentUserId?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getFileSizeParts(bytes: number): { value: string; unitKey: string } {
  if (bytes === 0) return { value: '0', unitKey: 'files.size_b' };
  const unitKeys = ['files.size_b', 'files.size_kb', 'files.size_mb', 'files.size_gb'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return {
    value: (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1),
    unitKey: unitKeys[i] ?? 'files.size_gb',
  };
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage;
  if (mimeType.startsWith('video/')) return FileVideo;
  if (mimeType.startsWith('audio/')) return FileAudio;
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text'))
    return FileText;
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive'))
    return FileArchive;
  return File;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupFilesTab({ groupId, isMember = true }: GroupFilesTabProps) {
  const { t } = useTranslation(['groups', 'common']);
  const confirm = useConfirm();
  const toast = useToast();
  const uploadModal = useDisclosure();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<GroupFile[]>([]);
  const [folders, setFolders] = useState<GroupFileFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoadFailed, setFilesLoadFailed] = useState(false);
  const [foldersLoadFailed, setFoldersLoadFailed] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadFolder, setUploadFolder] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);
  const filesControllerRef = useRef<AbortController | null>(null);
  const foldersControllerRef = useRef<AbortController | null>(null);
  const filesSequenceRef = useRef(0);
  const foldersSequenceRef = useRef(0);

  const formatFileSize = useCallback((bytes: number) => {
    const { value, unitKey } = getFileSizeParts(bytes);
    return t('files.size_value', { value, unit: t(unitKey) });
  }, [t]);

  const loadFiles = useCallback(async ({
    reset,
    requestedCursor = null,
    folder = null,
    query = '',
  }: {
    reset: boolean;
    requestedCursor?: string | null;
    folder?: string | null;
    query?: string;
  }) => {
    filesControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++filesSequenceRef.current;
    filesControllerRef.current = controller;
    setLoading(true);
    setFilesLoadFailed(false);

    try {
      const page = await listGroupFiles(groupId, {
        cursor: reset ? null : requestedCursor,
        folder,
        query,
        signal: controller.signal,
      });
      if (controller.signal.aborted || requestId !== filesSequenceRef.current) return;

      setFiles((previous) => reset ? page.items : [...previous, ...page.items]);
      setCursor(page.cursor);
      setHasMore(page.hasMore);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupFilesTab.loadFiles', err);
      if (!controller.signal.aborted && requestId === filesSequenceRef.current) {
        setFilesLoadFailed(true);
      }
    } finally {
      if (!controller.signal.aborted && requestId === filesSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [groupId]);

  const loadFolders = useCallback(async () => {
    foldersControllerRef.current?.abort();
    const controller = new AbortController();
    const requestId = ++foldersSequenceRef.current;
    foldersControllerRef.current = controller;
    setFoldersLoadFailed(false);

    try {
      const nextFolders = await listGroupFileFolders(groupId, { signal: controller.signal });
      if (controller.signal.aborted || requestId !== foldersSequenceRef.current) return;
      setFolders(nextFolders);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupFilesTab.loadFolders', err);
      if (!controller.signal.aborted && requestId === foldersSequenceRef.current) {
        setFoldersLoadFailed(true);
      }
    }
  }, [groupId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFiles({ reset: true, folder: activeFolder, query: search });
    }, search.trim() ? 300 : 0);

    return () => {
      window.clearTimeout(timeout);
      filesControllerRef.current?.abort();
    };
  }, [activeFolder, groupId, loadFiles, search]);

  useEffect(() => {
    void loadFolders();
    return () => foldersControllerRef.current?.abort();
  }, [groupId, loadFolders]);

  const closeUploadModal = () => {
    setSelectedFile(null);
    setUploadFolder('');
    setUploadDescription('');
    uploadModal.onClose();
  };

  const handleUpload = async () => {
    if (!selectedFile) return;
    setUploading(true);

    try {
      await uploadGroupFile(groupId, {
        file: selectedFile,
        folder: uploadFolder,
        description: uploadDescription,
      });

      toast.success(t('files.upload_success'));
      closeUploadModal();
      void loadFiles({ reset: true, folder: activeFolder, query: search });
      void loadFolders();
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupFilesTab.upload', err);
      // F-551: tell the member why a PDF was refused and what to do about it.
      const sourceCode = err instanceof GroupApiError ? err.sourceCode : '';
      toast.error(
        sourceCode === 'PDF_ACTIVE_CONTENT' ? t('files.upload_pdf_active_content')
          : sourceCode === 'PDF_NOT_INSPECTABLE' ? t('files.upload_pdf_not_inspectable')
            : t('files.upload_error'),
      );
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (file: GroupFile) => {
    try {
      await downloadGroupFile(groupId, file.id, file.file_name);
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupFilesTab.download', err);
      toast.error(t('files.download_error'));
    }
  };

  const handleDelete = async (file: GroupFile) => {
    const ok = await confirm({
      title: t('files.delete_confirm', { name: file.file_name }),
      status: 'danger',
      confirmLabel: t('common:delete'),
    });
    if (!ok) return;
    setDeleting(file.id);
    try {
      await deleteGroupFile(groupId, file.id);
      setFiles((prev) => prev.filter((item) => item.id !== file.id));
      toast.success(t('files.delete_success'));
      void loadFolders();
    } catch (err) {
      if (err instanceof GroupApiError && err.isCancellation) return;
      logError('GroupFilesTab.delete', err);
      toast.error(t('files.delete_error'));
    } finally {
      setDeleting(null);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) {
      if (file.size > 25 * 1024 * 1024) {
        toast.error(t('files.too_large'));
        return;
      }
      setSelectedFile(file);
      uploadModal.onOpen();
    }
  };

  // ─────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────

  if (loading && files.length === 0) {
    return (
      <div role="status" className="flex justify-center py-12" aria-label={t('files.loading')} aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  if (filesLoadFailed) {
    return (
      <GlassCard className="p-6">
        <div role="alert" className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-danger">{t('files.load_failed')}</p>
          <Button
            variant="flat"
            onPress={() => void loadFiles({ reset: true, folder: activeFolder, query: search })}
          >
            {t('try_again')}
          </Button>
        </div>
      </GlassCard>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <SearchField
          placeholder={t('files.search_placeholder')}
          value={search}
          onValueChange={setSearch}
          className="flex-1"
          size="sm"
          aria-label={t('files.search_aria')}
        />
        {isMember && (
          <Button
            color="primary"
            size="sm"
            className="w-full sm:w-auto"
            startContent={<Upload className="w-4 h-4" aria-hidden="true" />}
            onPress={() => fileInputRef.current?.click()}
          >
            {t('files.upload_file')}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.markdown,.zip,.rar,.mp4,.m4v,.webm,.mp3,.wav,.ogg,.oga"
          className="hidden"
          onChange={handleFileSelect}
        />
      </div>

      {foldersLoadFailed && (
        <GlassCard className="p-4">
          <div role="alert" className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <p className="text-sm text-danger">{t('files.load_failed')}</p>
            <Button variant="flat" size="sm" onPress={() => void loadFolders()}>
              {t('try_again')}
            </Button>
          </div>
        </GlassCard>
      )}

      {/* Folder filter — single-select ToggleButtonGroup ("__all__" sentinel = no folder filter) */}
      {folders.length > 0 && (
        <ToggleButtonGroup
          aria-label={t('filters_aria')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={new Set([activeFolder ?? '__all__'])}
          onSelectionChange={(keys) => { const [k] = Array.from(keys); setActiveFolder(!k || k === '__all__' ? null : String(k)); }}
          className="flex flex-wrap gap-2"
        >
          <ToggleButton
            id="__all__"
            variant="ghost"
            className="data-[selected=true]:bg-[var(--color-primary)] data-[selected=true]:text-white"
          >
            {t('files.all_files')}
          </ToggleButton>
          {folders.map((folder) => (
            <ToggleButton
              key={folder.folder}
              id={folder.folder}
              variant="ghost"
              className="data-[selected=true]:bg-[var(--color-primary)] data-[selected=true]:text-white"
            >
              <FolderOpen className="w-3 h-3" aria-hidden="true" />
              {t('files.folder_chip', { name: folder.folder, count: folder.file_count })}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      )}

      {/* File list */}
      {files.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="w-12 h-12" aria-hidden="true" />}
          title={t('files.empty_title')}
          description={
            search
              ? t('files.no_results')
              : t('files.empty_description')
          }
        />
      ) : (
        <div className="space-y-2">
          {files.map((file) => {
            const FileIcon = getFileIcon(file.file_type);
            return (
              <GlassCard key={file.id} className="p-3 transition-colors hover:bg-surface-secondary/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0">
                    <FileIcon className="w-5 h-5 text-accent" aria-hidden="true" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-theme-primary truncate">
                      {file.file_name}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-theme-subtle">
                      <span>{formatFileSize(file.file_size)}</span>
                      <span aria-hidden="true">&#183;</span>
                      <span>{file.uploader_name}</span>
                      <span aria-hidden="true">&#183;</span>
                      <span>{formatRelativeTime(file.created_at)}</span>
                      {file.folder && (
                        <>
                          <span aria-hidden="true">&#183;</span>
                          <Chip size="sm" variant="flat" className="text-xs h-5">
                            {file.folder}
                          </Chip>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      isIconOnly
                      variant="light"
                      size="sm"
                      onPress={() => handleDownload(file)}
                      isDisabled={!file.capabilities.can_download}
                      aria-label={t('files.download_aria', { name: file.file_name })}
                    >
                      <Download className="w-4 h-4" />
                    </Button>

                    {file.capabilities.can_delete && (
                      <Dropdown>
                        <DropdownTrigger>
                          <Button
                            isIconOnly
                            variant="light"
                            size="sm"
                            aria-label={t('files.actions_aria')}
                          >
                            <MoreVertical className="w-4 h-4" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu>
                          <DropdownItem
                            key="delete" id="delete"
                            className="text-danger"
                            color="danger"
                            startContent={<Trash2 className="w-4 h-4" />}
                            onPress={() => handleDelete(file)}
                            isDisabled={deleting === file.id}
                          >
                            {deleting === file.id
                              ? t('files.deleting')
                              : t('files.delete')}
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    )}
                  </div>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}

      {/* Load more */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="flat"
            size="sm"
            onPress={() => void loadFiles({
              reset: false,
              requestedCursor: cursor,
              folder: activeFolder,
              query: search,
            })}
            isLoading={loading}
          >
            {t('files.load_more')}
          </Button>
        </div>
      )}

      {/* Upload modal */}
      <Modal isOpen={uploadModal.isOpen} onClose={closeUploadModal} size="md">
        <ModalContent>
          <ModalHeader>{t('files.upload_title')}</ModalHeader>
          <ModalBody>
            {selectedFile && (
              <div className="space-y-4">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-secondary p-3">
                  <File className="w-8 h-8 text-accent" aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                    <p className="text-xs text-theme-subtle">{formatFileSize(selectedFile.size)}</p>
                  </div>
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    onPress={closeUploadModal}
                    aria-label={t('files.remove_file')}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>

                <Input
                  label={t('files.folder_label')}
                  placeholder={t('files.folder_placeholder')}
                  value={uploadFolder}
                  onValueChange={setUploadFolder}
                  maxLength={100}
                  startContent={<FolderPlus className="w-4 h-4 text-muted" aria-hidden="true" />}
                  size="sm"
                />

                <Textarea
                  label={t('files.description_label')}
                  placeholder={t('files.description_placeholder')}
                  value={uploadDescription}
                  onValueChange={setUploadDescription}
                  maxLength={2000}
                  minRows={2}
                  size="sm"
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={closeUploadModal}>
              {t('files.cancel')}
            </Button>
            <Button
              color="primary"
              onPress={handleUpload}
              isLoading={uploading}
              isDisabled={!selectedFile}
            >
              {t('files.upload_btn')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GroupFilesTab;
