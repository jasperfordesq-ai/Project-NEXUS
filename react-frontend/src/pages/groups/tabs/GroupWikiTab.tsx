// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
/**
 * Group Wiki Tab (GR-WIKI)
 * Collaborative knowledge base with hierarchical pages, revision history,
 * and breadcrumb navigation.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

import BookOpen from 'lucide-react/icons/book-open';
import FileText from 'lucide-react/icons/file-text';
import Plus from 'lucide-react/icons/plus';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import History from 'lucide-react/icons/history';
import ChevronRight from 'lucide-react/icons/chevron-right';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';
import {
  createGroupWikiPage,
  deleteGroupWikiPage,
  getGroupWikiPage,
  listGroupWikiPages,
  listGroupWikiRevisions,
  updateGroupWikiPage,
  type GroupWikiPageDetail as WikiPageDetail,
  type GroupWikiPageSummary as WikiPageSummary,
  type GroupWikiRevision as WikiRevision,
} from '../api/wiki';
import { normalizeGroupApiError, type GroupApiError } from '../api/core';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupWikiTabProps {
  groupId: number;
  isAdmin: boolean;
  isMember?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a tree structure from flat pages by parent_id. */
function buildPageTree(pages: WikiPageSummary[]): (WikiPageSummary & { depth: number })[] {
  const sorted = [...pages].sort((a, b) => a.sort_order - b.sort_order);
  const result: (WikiPageSummary & { depth: number })[] = [];

  function addChildren(parentId: number | null, depth: number) {
    for (const page of sorted) {
      if (page.parent_id === parentId) {
        result.push({ ...page, depth });
        addChildren(page.id, depth + 1);
      }
    }
  }

  addChildren(null, 0);
  return result;
}

/** Build breadcrumb trail from a page up to root. */
function buildBreadcrumbs(
  pages: WikiPageSummary[],
  currentId: number,
): WikiPageSummary[] {
  const trail: WikiPageSummary[] = [];
  let current = pages.find((p) => p.id === currentId);
  while (current) {
    trail.unshift(current);
    current = current.parent_id
      ? pages.find((p) => p.id === current!.parent_id)
      : undefined;
  }
  return trail;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupWikiTab({ groupId, isAdmin, isMember = true }: GroupWikiTabProps) {
  const { t } = useTranslation('groups');
  const { t: tCommon } = useTranslation('common');
  const toast = useToast();
  const createModal = useDisclosure();
  const deleteModal = useDisclosure();

  // ─── Page list state ───
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagesError, setPagesError] = useState<GroupApiError | null>(null);
  const pagesRequestRef = useRef<AbortController | null>(null);

  // ─── Selected page state ───
  const [selectedPage, setSelectedPage] = useState<WikiPageDetail | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<{ error: GroupApiError; slug: string } | null>(null);
  const pageRequestRef = useRef<AbortController | null>(null);

  // ─── Edit mode state ───
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [changeSummary, setChangeSummary] = useState('');
  const [saving, setSaving] = useState(false);

  // ─── Create modal state ───
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newParentId, setNewParentId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  // ─── Delete state ───
  const [deleteTarget, setDeleteTarget] = useState<WikiPageSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Revision history state ───
  const [revisions, setRevisions] = useState<WikiRevision[]>([]);
  const [revisionsOpen, setRevisionsOpen] = useState(false);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [revisionsError, setRevisionsError] = useState<{ error: GroupApiError; pageId: number } | null>(null);
  const revisionsRequestRef = useRef<AbortController | null>(null);

  // ─── Load page list ───
  const loadPages = useCallback(async () => {
    pagesRequestRef.current?.abort();
    const controller = new AbortController();
    pagesRequestRef.current = controller;
    setLoading(true);
    setPagesError(null);
    try {
      const items = await listGroupWikiPages(groupId, { signal: controller.signal });
      if (controller.signal.aborted || pagesRequestRef.current !== controller) return;
      setPages(items);
    } catch (err) {
      const apiError = normalizeGroupApiError(err);
      if (apiError.isCancellation) return;
      if (pagesRequestRef.current !== controller) return;
      logError('GroupWikiTab.loadPages', err);
      setPagesError(apiError);
    } finally {
      if (!controller.signal.aborted && pagesRequestRef.current === controller) {
        setLoading(false);
      }
    }
  }, [groupId]);

  useEffect(() => {
    setPages([]);
    setSelectedPage(null);
    void loadPages();
    return () => pagesRequestRef.current?.abort();
  }, [loadPages]);

  useEffect(() => () => {
    pageRequestRef.current?.abort();
    revisionsRequestRef.current?.abort();
  }, []);

  // ─── Load single page ───
  const loadPage = useCallback(
    async (slug: string) => {
      pageRequestRef.current?.abort();
      revisionsRequestRef.current?.abort();
      const controller = new AbortController();
      pageRequestRef.current = controller;
      setPageLoading(true);
      setPageError(null);
      setSelectedPage(null);
      setEditing(false);
      setRevisionsOpen(false);
      setRevisionsLoading(false);
      setRevisions([]);
      setRevisionsError(null);
      try {
        const page = await getGroupWikiPage(groupId, slug, { signal: controller.signal });
        if (controller.signal.aborted || pageRequestRef.current !== controller) return;
        setSelectedPage(page);
      } catch (err) {
        const apiError = normalizeGroupApiError(err);
        if (apiError.isCancellation) return;
        if (pageRequestRef.current !== controller) return;
        logError('GroupWikiTab.loadPage', err);
        setPageError({ error: apiError, slug });
      } finally {
        if (!controller.signal.aborted && pageRequestRef.current === controller) {
          setPageLoading(false);
        }
      }
    },
    [groupId],
  );

  // ─── Create page ───
  const handleCreate = useCallback(async () => {
    if (!newTitle.trim() || !newContent.trim()) return;
    setCreating(true);
    try {
      const body = {
        title: newTitle.trim(),
        content: newContent.trim(),
        ...(newParentId ? { parent_id: newParentId } : {}),
      };
      const createdPage = await createGroupWikiPage(groupId, body);
      toast.success(t('wiki.created'));
      setNewTitle('');
      setNewContent('');
      setNewParentId(null);
      createModal.onClose();
      await loadPages();
      void loadPage(createdPage.slug);
    } catch (err) {
      logError('GroupWikiTab.create', err);
      toast.error(t('wiki.create_failed'));
    } finally {
      setCreating(false);
    }
  }, [groupId, newTitle, newContent, newParentId, toast, t, createModal, loadPages, loadPage]);

  // ─── Save edit ───
  const handleSave = useCallback(async () => {
    if (!selectedPage || !editContent.trim()) return;
    setSaving(true);
    try {
      const updatedPage = await updateGroupWikiPage(groupId, selectedPage.id, {
        content: editContent.trim(),
        ...(changeSummary.trim() ? { change_summary: changeSummary.trim() } : {}),
      });
      toast.success(t('wiki.saved'));
      setSelectedPage(updatedPage);
      setEditing(false);
      setChangeSummary('');
      void loadPages();
    } catch (err) {
      logError('GroupWikiTab.save', err);
      toast.error(t('wiki.save_failed'));
    } finally {
      setSaving(false);
    }
  }, [groupId, selectedPage, editContent, changeSummary, toast, t, loadPages]);

  // ─── Delete page ───
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteGroupWikiPage(groupId, deleteTarget.id);
      toast.success(t('wiki.deleted'));
      setPages((currentPages) => currentPages.filter((page) => page.id !== deleteTarget.id));
      setDeleteTarget(null);
      deleteModal.onClose();
      if (selectedPage?.id === deleteTarget.id) {
        setSelectedPage(null);
      }
      void loadPages();
    } catch (err) {
      logError('GroupWikiTab.delete', err);
      toast.error(t('wiki.delete_failed'));
    } finally {
      setDeleting(false);
    }
  }, [groupId, deleteTarget, selectedPage, toast, t, deleteModal, loadPages]);

  // ─── Load revisions ───
  const loadRevisions = useCallback(
    async (pageId: number) => {
      revisionsRequestRef.current?.abort();
      const controller = new AbortController();
      revisionsRequestRef.current = controller;
      setRevisionsLoading(true);
      setRevisionsOpen(true);
      setRevisions([]);
      setRevisionsError(null);
      try {
        const items = await listGroupWikiRevisions(groupId, pageId, {
          signal: controller.signal,
        });
        if (controller.signal.aborted || revisionsRequestRef.current !== controller) return;
        setRevisions(items);
      } catch (err) {
        const apiError = normalizeGroupApiError(err);
        if (apiError.isCancellation) return;
        if (revisionsRequestRef.current !== controller) return;
        logError('GroupWikiTab.loadRevisions', err);
        setRevisionsError({ error: apiError, pageId });
      } finally {
        if (!controller.signal.aborted && revisionsRequestRef.current === controller) {
          setRevisionsLoading(false);
        }
      }
    },
    [groupId],
  );

  const closeRevisions = useCallback(() => {
    revisionsRequestRef.current?.abort();
    setRevisionsLoading(false);
    setRevisionsError(null);
    setRevisionsOpen(false);
  }, []);

  // ─── Enter edit mode ───
  const startEditing = useCallback(() => {
    if (selectedPage) {
      setEditContent(selectedPage.content);
      setChangeSummary('');
      setEditing(true);
    }
  }, [selectedPage]);

  // ─── Derived data ───
  const treePages = buildPageTree(pages);
  const breadcrumbs = selectedPage ? buildBreadcrumbs(pages, selectedPage.id) : [];

  // ─── Render: loading spinner ───
  if (loading && pages.length === 0) {
    return (
      <div
        className="flex justify-center py-12"
        role="status"
        aria-label={t('wiki.loading')}
        aria-busy="true"
      >
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
          <BookOpen className="w-5 h-5" aria-hidden="true" />
          {t('wiki.heading')}
        </h2>
        {isMember && (
          <Button
            className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white sm:shrink-0"
            size="sm"
            startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
            onPress={createModal.onOpen}
          >
            {t('wiki.new_page')}
          </Button>
        )}
      </div>

      {pagesError && (
        <GlassCard className="p-4" role="alert">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-danger">{t('wiki.load_failed')}</p>
            {pagesError.retryable && (
              <Button variant="flat" size="sm" onPress={() => void loadPages()}>
                {tCommon('actions.retry')}
              </Button>
            )}
          </div>
        </GlassCard>
      )}

      {(!pagesError || pages.length > 0) && (
        <div className="flex flex-col lg:flex-row gap-4">
        {/* Sidebar: page list */}
        <GlassCard className="p-4 lg:w-72 lg:flex-shrink-0">
          <h3 className="text-sm font-semibold text-theme-secondary mb-3">
            {t('wiki.pages')}
          </h3>
          {treePages.length === 0 ? (
            <p className="text-sm text-theme-subtle py-2">
              {t('wiki.no_pages_sidebar')}
            </p>
          ) : (
            <nav aria-label={t('wiki.page_nav_aria')}>
              <ul className="space-y-1">
                {treePages.map((page) => (
                  <li key={page.id}>
                    <Button
                      variant="light"
                      className={`w-full min-h-[40px] text-start px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 justify-start ${
                        selectedPage?.id === page.id
                          ? 'bg-accent/10 text-accent-soft-foreground font-medium'
                          : 'text-theme-secondary hover:bg-theme-hover'
                      }`}
                      style={{ paddingInlineStart: `${page.depth * 16 + 12}px` }}
                      onPress={() => loadPage(page.slug)}
                      aria-current={selectedPage?.id === page.id ? 'page' : undefined}
                    >
                      <FileText className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{page.title}</span>
                      {!page.is_published && (
                        <Chip size="sm" variant="flat" color="warning" className="ms-auto text-xs">
                          {t('wiki.draft')}
                        </Chip>
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </GlassCard>

        {/* Main content area */}
        <div className="flex-1 min-w-0">
          {pageLoading ? (
            <GlassCard className="p-6">
              <div className="flex justify-center py-8" role="status" aria-busy="true" aria-label={t('wiki.loading_page')}>
                <Spinner size="lg" />
              </div>
            </GlassCard>
          ) : pageError ? (
            <GlassCard className="p-6" role="alert">
              <div className="flex flex-col items-start gap-3">
                <p className="text-sm text-danger">{t('wiki.page_load_failed')}</p>
                {pageError.error.retryable && (
                  <Button
                    variant="flat"
                    size="sm"
                    onPress={() => void loadPage(pageError.slug)}
                  >
                    {tCommon('actions.retry')}
                  </Button>
                )}
              </div>
            </GlassCard>
          ) : selectedPage ? (
            <GlassCard className="p-6">
              {/* Breadcrumbs */}
              {breadcrumbs.length > 1 && (
                <nav
                  className="flex items-center gap-1 text-sm text-theme-subtle mb-4 flex-wrap"
                  aria-label={t('wiki.breadcrumb_aria')}
                >
                  {breadcrumbs.map((crumb, idx) => (
                    <span key={crumb.id} className="flex items-center gap-1">
                      {idx > 0 && (
                        <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 rtl:rotate-180" aria-hidden="true" />
                      )}
                      {idx < breadcrumbs.length - 1 ? (
                        <Button
                          variant="light"
                          className="min-h-[28px] px-0 py-0 hover:text-accent transition-colors underline-offset-2 hover:underline"
                          onPress={() => loadPage(crumb.slug)}
                        >
                          {crumb.title}
                        </Button>
                      ) : (
                        <span className="text-theme-primary font-medium">{crumb.title}</span>
                      )}
                    </span>
                  ))}
                </nav>
              )}

              {/* Page header */}
              <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-xl font-bold text-theme-primary">{selectedPage.title}</h3>
                  <div className="flex items-center gap-2 mt-1 text-xs text-theme-subtle">
                    <span>{selectedPage.author.name}</span>
                    <span aria-hidden="true">&#183;</span>
                    <time dateTime={selectedPage.updated_at}>
                      {formatRelativeTime(selectedPage.updated_at)}
                    </time>
                    {!selectedPage.is_published && (
                      <Chip size="sm" variant="flat" color="warning" className="text-xs">
                        {t('wiki.draft')}
                      </Chip>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex flex-wrap items-center gap-1 sm:flex-shrink-0">
                  {isMember && !editing && (
                    <Button
                      variant="light"
                      size="sm"
                      startContent={<Edit className="w-4 h-4" aria-hidden="true" />}
                      onPress={startEditing}
                      aria-label={t('wiki.edit_aria')}
                    >
                      {t('wiki.edit')}
                    </Button>
                  )}
                  <Button
                    variant="light"
                    size="sm"
                    startContent={<History className="w-4 h-4" aria-hidden="true" />}
                    onPress={() => {
                      if (revisionsOpen) closeRevisions();
                      else void loadRevisions(selectedPage.id);
                    }}
                    isLoading={revisionsLoading}
                    aria-label={revisionsOpen ? t('wiki.history_close_aria') : t('wiki.history_aria')}
                    aria-expanded={revisionsOpen}
                    aria-controls={`wiki-revisions-${selectedPage.id}`}
                  >
                    {t('wiki.history')}
                  </Button>
                  {isAdmin && (
                    <Button
                      variant="light"
                      size="sm"
                      color="danger"
                      startContent={<Trash2 className="w-4 h-4" aria-hidden="true" />}
                      onPress={() => {
                        setDeleteTarget(selectedPage);
                        deleteModal.onOpen();
                      }}
                      aria-label={t('wiki.delete_aria')}
                    >
                      {t('wiki.delete')}
                    </Button>
                  )}
                </div>
              </div>

              {/* Page content or edit mode */}
              {editing ? (
                <div className="space-y-4">
                  <Textarea
                    value={editContent}
                    onValueChange={setEditContent}
                    minRows={10}
                    maxRows={30}
                    placeholder={t('wiki.content_placeholder')}
                    aria-label={t('wiki.edit_content_aria')}
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default',
                    }}
                  />
                  <Input
                    label={t('wiki.change_summary_label')}
                    placeholder={t('wiki.change_summary_placeholder')}
                    value={changeSummary}
                    onValueChange={setChangeSummary}
                    size="sm"
                    classNames={{
                      input: 'bg-transparent text-theme-primary',
                      inputWrapper: 'bg-theme-elevated border-theme-default',
                      label: 'text-theme-muted',
                    }}
                  />
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                    <Button
                      variant="flat"
                      size="sm"
                      className="w-full sm:w-auto"
                      onPress={() => setEditing(false)}
                    >
                      {t('wiki.cancel')}
                    </Button>
                    <Button
                      size="sm"
                      className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white w-full sm:w-auto"
                      onPress={handleSave}
                      isLoading={saving}
                      isDisabled={!editContent.trim()}
                    >
                      {t('wiki.save')}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="typography-prose typography-prose--sm max-w-none text-theme-secondary whitespace-pre-wrap">
                  {selectedPage.content}
                </div>
              )}

              {/* Revision history (expandable) */}
              {revisionsOpen && (
                <div
                  id={`wiki-revisions-${selectedPage.id}`}
                  className="mt-6 border-t border-theme-default pt-4"
                  role="region"
                  aria-labelledby={`wiki-revisions-${selectedPage.id}-heading`}
                >
                  <h4
                    id={`wiki-revisions-${selectedPage.id}-heading`}
                    className="text-sm font-semibold text-theme-primary flex items-center gap-2 mb-3"
                  >
                    <History className="w-4 h-4" aria-hidden="true" />
                    {t('wiki.revision_history')}
                  </h4>
                  {revisionsLoading ? (
                    <div
                      role="status"
                      aria-busy="true"
                      aria-label={t('wiki.revision_history')}
                      className="flex justify-center py-4"
                    >
                      <Spinner size="sm" />
                    </div>
                  ) : revisionsError ? (
                    <div className="flex flex-col items-start gap-3" role="alert">
                      <p className="text-sm text-danger">{t('wiki.revisions_failed')}</p>
                      {revisionsError.error.retryable && (
                        <Button
                          variant="flat"
                          size="sm"
                          onPress={() => void loadRevisions(revisionsError.pageId)}
                        >
                          {tCommon('actions.retry')}
                        </Button>
                      )}
                    </div>
                  ) : revisions.length === 0 ? (
                    <p className="text-sm text-theme-subtle">
                      {t('wiki.no_revisions')}
                    </p>
                  ) : (
                    <ul className="space-y-2" aria-label={t('wiki.revisions_list_aria')}>
                      {revisions.map((rev) => (
                        <li
                          key={rev.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-theme-elevated/50"
                        >
                          <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                            <Edit className="w-4 h-4 text-accent" aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <span className="min-w-0 break-words font-medium text-theme-primary">
                                {rev.editor.name}
                              </span>
                              <time className="text-theme-subtle" dateTime={rev.created_at}>
                                {formatRelativeTime(rev.created_at)}
                              </time>
                            </div>
                            {rev.change_summary && (
                              <p className="mt-0.5 break-words text-xs text-theme-muted">
                                {rev.change_summary}
                              </p>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3">
                    <Button
                      variant="flat"
                      size="sm"
                      onPress={closeRevisions}
                    >
                      {t('wiki.close_history')}
                    </Button>
                  </div>
                </div>
              )}
            </GlassCard>
          ) : (
            <GlassCard className="p-6">
              <EmptyState
                icon={<BookOpen className="w-12 h-12" aria-hidden="true" />}
                title={t('wiki.empty_title')}
                description={
                  pages.length === 0
                    ? t('wiki.empty_no_pages')
                    : t('wiki.empty_select')
                }
                action={
                  isMember &&
                  pages.length === 0 && (
                    <Button
                      className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                      startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                      onPress={createModal.onOpen}
                    >
                      {t('wiki.create_first')}
                    </Button>
                  )
                }
              />
            </GlassCard>
          )}
        </div>
        </div>
      )}

      {/* ─── Create Page Modal ─── */}
      <Modal
        isOpen={createModal.isOpen}
        onOpenChange={(open) => !open && createModal.onClose()}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onModalClose) => (
            <>
              <ModalHeader className="text-theme-primary flex items-center gap-2">
                <FileText className="w-5 h-5 text-accent" aria-hidden="true" />
                {t('wiki.create_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('wiki.title_label')}
                  placeholder={t('wiki.title_placeholder')}
                  value={newTitle}
                  onValueChange={setNewTitle}
                  isRequired
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
                {pages.length > 0 && (
                  <Select
                    label={t('wiki.parent_label')}
                    selectedKeys={new Set([newParentId === null ? '__none__' : String(newParentId)])}
                    disallowEmptySelection
                    onSelectionChange={(keys) => {
                      const k = keys instanceof Set ? (Array.from(keys)[0] as string | undefined) : undefined;
                      setNewParentId(!k || k === '__none__' ? null : Number(k));
                    }}
                    classNames={{
                      trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                      value: 'text-theme-primary',
                    }}
                  >
                    <>
                      <SelectItem key="__none__" id="__none__">{t('wiki.no_parent')}</SelectItem>
                      {pages.map((page) => (
                        <SelectItem key={page.id} id={String(page.id)}>{page.title}</SelectItem>
                      ))}
                    </>
                  </Select>
                )}
                <Textarea
                  label={t('wiki.content_label')}
                  placeholder={t('wiki.content_placeholder')}
                  value={newContent}
                  onValueChange={setNewContent}
                  minRows={6}
                  isRequired
                  classNames={{
                    input: 'bg-transparent text-theme-primary',
                    inputWrapper: 'bg-theme-elevated border-theme-default',
                    label: 'text-theme-muted',
                  }}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onModalClose}>
                  {t('wiki.cancel')}
                </Button>
                <Button
                  className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                  isLoading={creating}
                  isDisabled={!newTitle.trim() || !newContent.trim()}
                  onPress={handleCreate}
                >
                  {t('wiki.create')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* ─── Delete Confirmation Modal ─── */}
      <Modal
        isOpen={deleteModal.isOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            deleteModal.onClose();
          }
        }}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onModalClose) => (
            <>
              <ModalHeader className="text-theme-primary">
                {t('wiki.delete_title')}
              </ModalHeader>
              <ModalBody>
                <div className="flex items-start gap-3">
                  <Trash2 className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-theme-secondary">
                    {t('wiki.delete_confirm', { name: deleteTarget?.title })}
                  </p>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onModalClose}>
                  {t('wiki.cancel')}
                </Button>
                <Button color="danger" isLoading={deleting} onPress={handleDelete}>
                  {t('wiki.delete')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GroupWikiTab;
