import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui/Dropdown';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { useDisclosure } from '@/components/ui/useDisclosure';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BookmarksPage — View and manage saved/bookmarked items.
 * Tabs for content types, collection management, grid/list view.
 */

import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';

import Bookmark from 'lucide-react/icons/bookmark';
import BookmarkCheck from 'lucide-react/icons/bookmark-check';
import FolderPlus from 'lucide-react/icons/folder-plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import MoreHorizontal from 'lucide-react/icons/ellipsis';
import BookOpen from 'lucide-react/icons/book-open';
import Calendar from 'lucide-react/icons/calendar';
import Briefcase from 'lucide-react/icons/briefcase';
import MessageSquare from 'lucide-react/icons/message-square';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Inbox from 'lucide-react/icons/inbox';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime } from '@/lib/helpers';

interface BookmarkItem {
  id: number;
  bookmarkable_type: string;
  bookmarkable_id: number;
  collection_id: number | null;
  created_at: string;
  title: string | null;
}

interface BookmarkCollectionData {
  id: number;
  name: string;
  description: string | null;
  is_default: boolean;
  bookmarks_count?: number;
}

type ContentTab = 'all' | 'post' | 'listing' | 'event' | 'job' | 'blog' | 'discussion';

const TAB_ICONS: Record<ContentTab, React.ElementType> = {
  all: BookmarkCheck,
  post: MessageSquare,
  listing: ShoppingBag,
  event: Calendar,
  job: Briefcase,
  blog: BookOpen,
  discussion: MessageSquare,
};

const getDetailPath = (bookmark: BookmarkItem): string => {
  const { bookmarkable_type: type, bookmarkable_id: id } = bookmark;
  switch (type) {
    case 'post': return `/feed/posts/${id}`;
    case 'listing': return `/listings/${id}`;
    case 'event': return `/events/${id}`;
    case 'job': return `/jobs/${id}`;
    case 'blog': return `/blog/${id}`;
    case 'discussion': return `/feed/posts/${id}`;
    default: return `/feed/posts/${id}`;
  }
};

const getTypeColor = (type: string) => {
  const colors: Record<string, 'primary' | 'success' | 'warning' | 'secondary' | 'default'> = {
    post: 'default',
    listing: 'primary',
    event: 'success',
    job: 'primary',
    blog: 'secondary',
    discussion: 'secondary',
  };
  return colors[type] || 'default';
};

export default function BookmarksPage() {
  const { t } = useTranslation('social');
  const { tenantPath } = useTenant();
  const toast = useToast();
  usePageTitle(t('bookmarks.page_title'));

  const [activeTab, setActiveTab] = useState<ContentTab>('all');
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [collections, setCollections] = useState<BookmarkCollectionData[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);

  // Collection modal state
  const { isOpen: isCreateOpen, onOpen: onCreateOpen, onClose: onCreateClose } = useDisclosure();
  const [newCollName, setNewCollName] = useState('');
  const [newCollDesc, setNewCollDesc] = useState('');
  const [editingColl, setEditingColl] = useState<BookmarkCollectionData | null>(null);
  const [collSaving, setCollSaving] = useState(false);
  const [deletingColl, setDeletingColl] = useState<BookmarkCollectionData | null>(null);
  const [collDeleting, setCollDeleting] = useState(false);
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onClose: onDeleteClose,
  } = useDisclosure();

  const loadBookmarks = useCallback(async (p = 1, type?: ContentTab, collId?: number | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), per_page: '20' });
      if (type && type !== 'all') params.set('type', type);
      if (collId) params.set('collection_id', String(collId));

      const res = await api.get<BookmarkItem[]>(`/v2/bookmarks?${params}`);
      if (res.success && res.data) {
        setBookmarks(p === 1 ? res.data : (prev) => [...prev, ...res.data!]);
        setTotal(res.meta?.total ?? 0);
        setHasMore(res.meta?.has_more ?? false);
        setPage(p);
      }
    } catch (err) {
      logError('Failed to load bookmarks', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCollections = useCallback(async () => {
    try {
      const res = await api.get<BookmarkCollectionData[]>('/v2/bookmark-collections');
      if (res.success && res.data) {
        setCollections(res.data);
      }
    } catch (err) {
      logError('Failed to load collections', err);
    }
  }, []);

  useEffect(() => {
    loadBookmarks(1, activeTab, selectedCollection);
    loadCollections();
  }, [activeTab, selectedCollection, loadBookmarks, loadCollections]);

  const handleRemoveBookmark = async (bookmark: BookmarkItem) => {
    try {
      const res = await api.post('/v2/bookmarks', {
        type: bookmark.bookmarkable_type,
        id: bookmark.bookmarkable_id,
      });
      if (res.success) {
        setBookmarks((prev) => prev.filter((b) => b.id !== bookmark.id));
        setTotal((prev) => prev - 1);
        toast.success(t('bookmarks.removed'));
      }
    } catch (err) {
      logError('Failed to remove bookmark', err);
      toast.error(t('bookmarks.remove_failed'));
    }
  };

  const handleSaveCollection = async () => {
    if (!newCollName.trim()) return;
    setCollSaving(true);

    try {
      const payload = {
        name: newCollName.trim(),
        description: newCollDesc.trim() || null,
      };
      const response = editingColl
        ? await api.patch(`/v2/bookmark-collections/${editingColl.id}`, payload)
        : await api.post('/v2/bookmark-collections', payload);

      if (response.success) {
        toast.success(editingColl ? t('bookmarks.collection_updated') : t('bookmarks.collection_created'));
        onCreateClose();
        setNewCollName('');
        setNewCollDesc('');
        setEditingColl(null);
        loadCollections();
      } else {
        // A failed request resolves to { success: false } without throwing — the
        // unconditional success toast + form reset used to fake a saved collection.
        toast.error(response.error || t('bookmarks.collection_save_failed'));
      }
    } catch (err) {
      logError('Failed to save collection', err);
      toast.error(t('bookmarks.collection_save_failed'));
    } finally {
      setCollSaving(false);
    }
  };

  const openDeleteCollection = (coll: BookmarkCollectionData) => {
    setDeletingColl(coll);
    onDeleteOpen();
  };

  const handleDeleteCollection = async () => {
    if (!deletingColl) return;
    setCollDeleting(true);
    try {
      const response = await api.delete(`/v2/bookmark-collections/${deletingColl.id}`);
      if (response.success) {
        toast.success(t('bookmarks.collection_deleted'));
        if (selectedCollection === deletingColl.id) setSelectedCollection(null);
        onDeleteClose();
        setDeletingColl(null);
        loadCollections();
      } else {
        toast.error(response.error || t('bookmarks.collection_delete_failed'));
      }
    } catch (err) {
      logError('Failed to delete collection', err);
      toast.error(t('bookmarks.collection_delete_failed'));
    } finally {
      setCollDeleting(false);
    }
  };

  const getTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      post: t('bookmarks.type_post'),
      listing: t('bookmarks.type_listing'),
      event: t('bookmarks.type_event'),
      job: t('bookmarks.type_job'),
      blog: t('bookmarks.type_blog'),
      discussion: t('bookmarks.type_discussion'),
    };
    return labels[type] || type;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <PageMeta
        title={t('bookmarks.page_title')}
        description={t('bookmarks.meta_description')}
        noIndex
      />
      {/* The same soft panel in the community colour that opens the offers,
          events and groups pages (AWID: warmer, more inviting). */}
      <div className="mb-6">
      <PublicPageHero
        size="compact"
        title={t('bookmarks.title')}
        description={t('bookmarks.subtitle')}
        icon={<Bookmark className="h-6 w-6" aria-hidden="true" />}
        accent="amber"
        action={
        <Button
          color="primary"
          variant="flat"
          size="sm"
          className="w-full sm:w-auto"
          startContent={<FolderPlus className="w-4 h-4" aria-hidden="true" />}
          onPress={onCreateOpen}
        >
          {t('bookmarks.new_collection')}
        </Button>
        }
      />
      </div>

      {/* Collections Bar */}
      {collections.length > 0 && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Autocomplete
            label={t('bookmarks.collection_filter_label')}
            aria-label={t('bookmarks.collection_filter_label')}
            placeholder={t('bookmarks.all_items')}
            searchPlaceholder={t('bookmarks.collection_search')}
            value={selectedCollection === null ? null : String(selectedCollection)}
            onChange={(key) => setSelectedCollection(key && !Array.isArray(key) ? Number(key) : null)}
            className="w-full sm:max-w-xs"
          >
            {collections.map((coll) => (
              <AutocompleteItem key={String(coll.id)} id={String(coll.id)} textValue={coll.name}>
                {coll.name} {coll.bookmarks_count != null && `(${coll.bookmarks_count})`}
              </AutocompleteItem>
            ))}
          </Autocomplete>
          {collections.map((coll) => (
            <div key={coll.id} className="flex items-center gap-1 shrink-0">
              <Dropdown placement="bottom-end">
                <DropdownTrigger>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    className="min-w-0 w-6 h-6"
                    aria-label={t('bookmarks.collection_actions_named', { name: coll.name })}
                  >
                    <MoreHorizontal className="w-3 h-3" aria-hidden="true" />
                  </Button>
                </DropdownTrigger>
                <DropdownMenu>
                  <DropdownItem
                    key="edit" id="edit"
                    startContent={<Pencil className="w-3.5 h-3.5" aria-hidden="true" />}
                    onPress={() => {
                      setEditingColl(coll);
                      setNewCollName(coll.name);
                      setNewCollDesc(coll.description || '');
                      onCreateOpen();
                    }}
                  >
                    {t('bookmarks.edit_collection')}
                  </DropdownItem>
                  <DropdownItem
                    key="delete" id="delete"
                    startContent={<Trash2 className="w-3.5 h-3.5" aria-hidden="true" />}
                    className="text-danger"
                    color="danger"
                    onPress={() => openDeleteCollection(coll)}
                  >
                    {t('bookmarks.delete_collection')}
                  </DropdownItem>
                </DropdownMenu>
              </Dropdown>
            </div>
          ))}
        </div>
      )}

      {/* Content Type Tabs */}
      <Tabs
        aria-label={t('content_type_tabs_aria')}
        selectedKey={activeTab}
        onSelectionChange={(key) => { setActiveTab(key as ContentTab); setPage(1); }}
        variant="underlined"
        classNames={{ tabList: 'gap-1', tab: 'text-sm' }}
        className="mb-6"
      >
        {(['all', 'post', 'listing', 'event', 'job', 'blog', 'discussion'] as ContentTab[]).map((tab) => {
          const Icon = TAB_ICONS[tab];
          return (
            <Tab
              key={tab}
              title={
                <div className="flex items-center gap-1.5">
                  <Icon className="w-4 h-4" aria-hidden="true" />
                  {tab === 'all' ? t('bookmarks.tab_all') : getTypeLabel(tab)}
                </div>
              }
            />
          );
        })}
      </Tabs>

      {/* Count */}
      {!loading && (
        <p className="text-xs text-[var(--text-muted)] mb-4">
          {t('bookmarks.count', { count: total })}
        </p>
      )}

      {/* Bookmarks List */}
      {loading && bookmarks.length === 0 ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true" aria-label={t('bookmarks.loading')}>
          <Spinner size="lg" />
        </div>
      ) : bookmarks.length === 0 ? (
        <GlassCard className="text-center py-16">
          <Inbox className="w-12 h-12 mx-auto text-[var(--text-subtle)] mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
            {t('bookmarks.empty_title')}
          </h3>
          <p className="text-sm text-[var(--text-muted)] max-w-sm mx-auto">
            {t('bookmarks.empty_desc')}
          </p>
        </GlassCard>
      ) : (
        <div className="space-y-3">
          {bookmarks.map((bookmark) => (
            <Card key={bookmark.id} shadow="none" className="border border-[var(--border-default)] hover:border-[var(--color-primary)]/30 transition-colors">
              <CardBody className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <Chip size="sm" variant="flat" color={getTypeColor(bookmark.bookmarkable_type)} className="shrink-0">
                      {getTypeLabel(bookmark.bookmarkable_type)}
                    </Chip>
                    <Link
                      to={tenantPath(getDetailPath(bookmark))}
                      className="text-sm font-medium text-[var(--text-primary)] hover:text-[var(--color-primary)] transition-colors truncate"
                    >
                      {bookmark.title ?? `${getTypeLabel(bookmark.bookmarkable_type)} #${bookmark.bookmarkable_id}`}
                    </Link>
                    <span className="text-xs text-[var(--text-subtle)] shrink-0">
                      {formatRelativeTime(bookmark.created_at)}
                    </span>
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="light"
                    className="text-[var(--text-muted)] hover:text-danger shrink-0"
                    onPress={() => handleRemoveBookmark(bookmark)}
                    aria-label={t('bookmarks.remove')}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                  </Button>
                </div>
              </CardBody>
            </Card>
          ))}

          {/* Load More */}
          {hasMore && (
            <div className="text-center pt-4">
              <Button
                variant="bordered"
                onPress={() => loadBookmarks(page + 1, activeTab, selectedCollection)}
                isLoading={loading}
              >
                {t('bookmarks.load_more')}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Create/Edit Collection Modal */}
      <Modal isOpen={isCreateOpen} onClose={() => { onCreateClose(); setEditingColl(null); setNewCollName(''); setNewCollDesc(''); }}>
        <ModalContent>
          <ModalHeader>
            {editingColl
              ? t('bookmarks.edit_collection_title')
              : t('bookmarks.create_collection_title')
            }
          </ModalHeader>
          <ModalBody>
            <Input
              label={t('bookmarks.collection_name')}
              value={newCollName}
              onChange={(e) => setNewCollName(e.target.value)}
              maxLength={100}
              isRequired
              variant="bordered"
            />
            <Input
              label={t('bookmarks.collection_description')}
              value={newCollDesc}
              onChange={(e) => setNewCollDesc(e.target.value)}
              variant="bordered"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => { onCreateClose(); setEditingColl(null); }}>
              {t('bookmarks.cancel')}
            </Button>
            <Button
              color="primary"
              onPress={handleSaveCollection}
              isLoading={collSaving}
              isDisabled={!newCollName.trim()}
            >
              {editingColl ? t('bookmarks.save') : t('bookmarks.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Collection Modal */}
      <Modal
        isOpen={isDeleteOpen}
        onClose={() => {
          onDeleteClose();
          setDeletingColl(null);
        }}
        size="sm"
      >
        <ModalContent>
          <ModalHeader>{t('bookmarks.delete_collection_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-[var(--text-secondary)]">
              {t('bookmarks.delete_collection_body', { name: deletingColl?.name ?? '' })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="light"
              onPress={() => {
                onDeleteClose();
                setDeletingColl(null);
              }}
              isDisabled={collDeleting}
            >
              {t('bookmarks.cancel')}
            </Button>
            <Button color="danger" onPress={handleDeleteCollection} isLoading={collDeleting}>
              {t('bookmarks.delete_collection_action')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
