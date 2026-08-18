import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Progress } from '@/components/ui/Progress';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Textarea } from '@/components/ui/Textarea';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { useDisclosure } from '@/components/ui/useDisclosure';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Resources Page - Community shared resources library
 *
 * Uses V2 API: GET /api/v2/resources, GET /api/v2/resources/categories
 * Upload: POST /api/v2/resources (multipart form data)
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion } from '@/lib/motion';

import FolderOpen from 'lucide-react/icons/folder-open';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Download from 'lucide-react/icons/download';
import FileText from 'lucide-react/icons/file-text';
import FileSpreadsheet from 'lucide-react/icons/file-spreadsheet';
import FileImage from 'lucide-react/icons/file-image';
import File from 'lucide-react/icons/file';
import Calendar from 'lucide-react/icons/calendar';
import User from 'lucide-react/icons/user';
import Upload from 'lucide-react/icons/upload';
import X from 'lucide-react/icons/x';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import ChevronRight from 'lucide-react/icons/chevron-right';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Folder from 'lucide-react/icons/folder';
import GripVertical from 'lucide-react/icons/grip-vertical';
import ArrowUp from 'lucide-react/icons/arrow-up';
import ArrowDown from 'lucide-react/icons/arrow-down';
import Trash2 from 'lucide-react/icons/trash-2';
import { useTranslation } from 'react-i18next';
import { SocialInteractionPanel } from '@/components/social/SocialInteractionPanel';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import {
  ResourceFilterSheet,
  type ResourceCategoryOption,
  type ResourceFilterDraft,
} from '@/components/resources/ResourceFilterSheet';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api, API_BASE, tokenManager } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import { usePageTitle } from '@/hooks';
// Direct hook paths on purpose: page tests replace the '@/hooks' barrel with a
// partial stub, so a barrel import would resolve to undefined and crash render.
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { PageMeta } from '@/components/seo/PageMeta';

/* ───────────────────────── Types ───────────────────────── */

interface Resource {
  id: number;
  title: string;
  description: string;
  file_url: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
  downloads: number;
  created_at: string;
  uploader: {
    id: number;
    name: string;
    avatar: string | null;
  };
  category: {
    id: number;
    name: string;
    color: string;
  } | null;
  is_liked?: boolean;
  likes_count?: number;
  comments_count?: number;
}

interface ResourceCategory {
  id: number;
  name: string;
  slug: string;
  color: string;
  resource_count: number;
}

interface CategoryTreeNode {
  id: number;
  name: string;
  slug: string;
  color: string;
  resource_count: number;
  children: CategoryTreeNode[];
}

/* ───────────────────────── Constants ───────────────────────── */

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'jpg', 'png', 'gif', 'svg'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const categoryColorMap: Record<string, string> = {
  blue: 'bg-blue-500/10 text-[var(--color-info)]',
  gray: 'bg-gray-500/10 text-gray-500',
  fuchsia: 'bg-fuchsia-500/10 text-fuchsia-500',
  purple: 'bg-accent/10 text-accent',
  green: 'bg-emerald-500/10 text-emerald-500',
  red: 'bg-rose-500/10 text-rose-500',
  yellow: 'bg-amber-500/10 text-[var(--color-warning)]',
};

const inputClassNames = {
  input: 'bg-transparent text-theme-primary',
  inputWrapper: 'bg-theme-elevated border-theme-default',
  label: 'text-theme-muted',
};

/**
 * What "Clear all" resets inside the phone filter sheet. Category is the page's
 * only data filter, so there is nothing to deliberately preserve here (contrast
 * Listings, which keeps `sort`). `useFilterDraft` merges this over the open draft.
 */
const EMPTY_RESOURCE_FILTER_DRAFT: Partial<ResourceFilterDraft> = {
  category: null,
};

/* ───────────────────────── Helpers ───────────────────────── */

interface ResourceQueryFilters {
  search: string;
  category: number | null;
  /** Only set when appending a page. */
  cursor?: string | undefined;
}

/**
 * Single source of truth for filter → API params.
 *
 * The list fetch is the only consumer: `/v2/resources` reports no total
 * (`respondWithCollection` emits base_url/per_page/has_more/cursor only), so the
 * phone sheet ships no live-count probe that could drift away from this.
 */
function buildResourceQueryParams(f: ResourceQueryFilters): URLSearchParams {
  const params = new URLSearchParams();
  params.set('per_page', '20');
  if (f.cursor) params.set('cursor', f.cursor);
  if (f.search.trim()) params.set('search', f.search.trim());
  if (f.category) params.set('category_id', String(f.category));
  return params;
}

interface FlatCategory {
  id: number;
  name: string;
  /** Parent node's name, or null for a top-level node / the flat fallback list. */
  parentName: string | null;
}

/** Depth-first flatten so a child chip always follows its parent in the row. */
function flattenCategoryTree(
  nodes: CategoryTreeNode[],
  parentName: string | null = null,
  out: FlatCategory[] = [],
): FlatCategory[] {
  for (const node of nodes) {
    out.push({ id: node.id, name: node.name, parentName });
    if (node.children && node.children.length > 0) {
      flattenCategoryTree(node.children, node.name, out);
    }
  }
  return out;
}

function getFileIcon(path: string) {
  const ext = path.split('.').pop()?.toLowerCase() || '';

  if (['pdf'].includes(ext)) return <FileText className="w-5 h-5 text-red-400" aria-hidden="true" />;
  if (['doc', 'docx', 'txt', 'rtf', 'odt'].includes(ext)) return <FileText className="w-5 h-5 text-blue-400" aria-hidden="true" />;
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return <FileSpreadsheet className="w-5 h-5 text-emerald-400" aria-hidden="true" />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return <FileImage className="w-5 h-5 text-accent" aria-hidden="true" />;

  return <File className="w-5 h-5 text-gray-400" aria-hidden="true" />;
}

function getFileExtension(path: string): string {
  return path.split('.').pop()?.toUpperCase() || 'FILE';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ───────────────────────── Main Component ───────────────────────── */

/* ───────────────────────── R1 - Category Tree Component ───────────────────────── */

function CategoryTreeItem({
  node,
  selectedId,
  onSelect,
  depth = 0,
}: {
  node: CategoryTreeNode;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  depth?: number;
}) {
  const { t } = useTranslation('utility');
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children && node.children.length > 0;
  const isSelected = selectedId === node.id;
  // color is available on the node but we use class-based styling via the selected state

  return (
    <div>
      <div
        className={`
          w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors
          ${isSelected ? 'bg-amber-500/10 text-[var(--color-warning)] font-semibold' : 'text-theme-muted hover:bg-theme-hover'}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {hasChildren ? (
          <Button
            isIconOnly
            size="sm"
            variant="light"
            onPress={() => setExpanded(!expanded)}
            aria-label={expanded ? t('resources.collapse_category') : t('resources.expand_category')}
            className="p-0 min-w-0 w-auto min-h-9 flex-shrink-0"
          >
            {expanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-theme-subtle" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-theme-subtle" aria-hidden="true" />
            )}
          </Button>
        ) : (
          <span className="w-3.5" />
        )}
        <Button
          variant="light"
          onPress={() => onSelect(isSelected ? null : node.id)}
          className="flex items-center gap-2 text-left text-sm min-h-9 p-0 min-w-0 flex-1 justify-start"
        >
          <Folder className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-amber-400' : 'text-theme-subtle'}`} aria-hidden="true" />
          <span className="flex-1 truncate">{node.name}</span>
          {node.resource_count > 0 && (
            <span className="text-xs text-theme-subtle">{node.resource_count}</span>
          )}
        </Button>
      </div>
      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <CategoryTreeItem
              key={child.id}
              node={child}
              selectedId={selectedId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Main Component ───────────────────────── */

export function ResourcesPage() {
  const { t } = useTranslation('utility');
  usePageTitle(t('resources.page_title'));
  // On phones the page hides its own hero; the title lives in the app bar.
  useSetAppBarTitle(t('resources.page_title'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const { isAuthenticated, user } = useAuth();
  useTenant(); // ensure tenant context is available
  const toast = useToast();
  const [resources, setResources] = useState<Resource[]>([]);
  const [categories, setCategories] = useState<ResourceCategory[]>([]);
  const [categoryTree, setCategoryTree] = useState<CategoryTreeNode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>();
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [showCategoryTree, setShowCategoryTree] = useState(true);

  // R3 - Admin reorder
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin' || user?.role === 'tenant_admin';
  const [isReordering, setIsReordering] = useState(false);

  // Upload modal state
  const uploadModal = useDisclosure();
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadDescription, setUploadDescription] = useState('');
  const [uploadCategoryId, setUploadCategoryId] = useState<string>('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Delete confirmation state
  const deleteModal = useDisclosure();
  const [deletingResource, setDeletingResource] = useState<Resource | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load categories and category tree on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const [flatRes, treeRes] = await Promise.all([
          api.get<ResourceCategory[]>('/v2/resources/categories'),
          api.get<CategoryTreeNode[]>('/v2/resources/categories/tree'),
        ]);
        if (flatRes.success && flatRes.data) {
          setCategories(Array.isArray(flatRes.data) ? flatRes.data : []);
        }
        if (treeRes.success && treeRes.data) {
          setCategoryTree(Array.isArray(treeRes.data) ? treeRes.data : []);
        }
      } catch (err) {
        logError('Failed to load resource categories', err);
      }
    };
    loadCategories();
  }, []);

  const loadResources = useCallback(async (append = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = buildResourceQueryParams({
        search: searchQuery,
        category: selectedCategory,
        cursor: append ? cursor : undefined,
      });

      const response = await api.get<Resource[]>(
        `/v2/resources?${params}`
      );

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];

        if (append) {
          setResources((prev) => [...prev, ...items]);
        } else {
          setResources(items);
        }
        setHasMore(response.meta?.has_more ?? false);
        setCursor(response.meta?.cursor ?? undefined);
      } else {
        if (!append) setError(tRef.current('resources.error_load'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load resources', err);
      if (!append) setError(tRef.current('resources.error_load_retry'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [cursor, searchQuery, selectedCategory]);

  const loadResourcesRef = useRef(loadResources);
  loadResourcesRef.current = loadResources;

  useEffect(() => {
    setCursor(undefined);
    loadResourcesRef.current();
    return () => {
      abortRef.current?.abort();
    };
  }, [searchQuery, selectedCategory]);

  // ─── Phone filter sheet (draft state — nothing applies until the footer) ───
  // The draft machine (snapshot / patch / apply / clear) lives in useFilterDraft;
  // only the resources-specific pieces stay here.

  /**
   * Chip options for the phone sheet. The desktop sidebar draws the real tree, but
   * a chip row cannot, so flatten depth-first (children follow their parent) and
   * prefix a child with its parent only when the bare name is ambiguous — two
   * parents can each own a "Templates". Tenants whose tree endpoint returns nothing
   * fall back to the flat list the desktop quick-filter uses, so BOTH server shapes
   * keep a working category filter once the desktop controls are hidden.
   */
  const phoneCategoryOptions = useMemo<ResourceCategoryOption[]>(() => {
    const flat: FlatCategory[] = categoryTree.length > 0
      ? flattenCategoryTree(categoryTree)
      : categories.map((cat) => ({ id: cat.id, name: cat.name, parentName: null }));

    const nameCounts = new Map<string, number>();
    for (const cat of flat) nameCounts.set(cat.name, (nameCounts.get(cat.name) ?? 0) + 1);

    return flat.map((cat) => ({
      id: cat.id,
      label: cat.parentName && (nameCounts.get(cat.name) ?? 0) > 1
        ? `${cat.parentName} › ${cat.name}`
        : cat.name,
    }));
  }, [categoryTree, categories]);

  const commitDraftFilters = useCallback((next: ResourceFilterDraft) => {
    setSelectedCategory(next.category);
  }, []);

  const filterSheet = useFilterDraft<ResourceFilterDraft>({
    onApply: commitDraftFilters,
    emptyDraft: EMPTY_RESOURCE_FILTER_DRAFT,
    // No `countFor`: this endpoint reports no total, so the footer stays on the
    // honest "Show results" label rather than probing for a number that
    // does not exist.
  });
  const { open: openDraft } = filterSheet;

  const openFilterSheet = useCallback(() => {
    openDraft({ category: selectedCategory });
  }, [openDraft, selectedCategory]);

  /** Phone: removable chips for every applied filter (search shows in the pill instead). */
  const phoneFilterChips = useMemo(() => {
    if (selectedCategory == null) return [];
    const match = phoneCategoryOptions.find((cat) => cat.id === selectedCategory);
    return [{
      key: 'category',
      label: match?.label ?? String(selectedCategory),
      onRemove: () => setSelectedCategory(null),
    }];
  }, [selectedCategory, phoneCategoryOptions]);

  /** "Clear all" in the sticky bar — clears the search pill too, as on Listings. */
  const resetPhoneFilters = useCallback(() => {
    setSelectedCategory(null);
    setSearchQuery('');
  }, []);

  // ─── Upload Handlers ────────────────────────────────────────────────

  function validateFile(file: File): string | null {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return t('resources.file_type_not_allowed', { ext, supported: ALLOWED_EXTENSIONS.join(', ') });
    }
    if (file.size > MAX_FILE_SIZE) {
      return t('resources.file_too_large', { size: formatFileSize(file.size) });
    }
    return null;
  }

  function handleFileSelect(file: File) {
    const validationError = validateFile(file);
    if (validationError) {
      toast.error(t('resources.invalid_file'), validationError);
      return;
    }
    setUploadFile(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  function resetUploadForm() {
    setUploadTitle('');
    setUploadDescription('');
    setUploadCategoryId('');
    setUploadFile(null);
    setUploadProgress(0);
    setIsUploading(false);
  }

  async function handleUploadSubmit() {
    if (!uploadFile) {
      toast.error(t('resources.no_file_selected'), t('resources.please_select_file'));
      return;
    }
    if (!uploadTitle.trim()) {
      toast.error(t('resources.title_required'), t('resources.please_enter_title'));
      return;
    }

    try {
      setIsUploading(true);
      setUploadProgress(10);

      const formData = new FormData();
      formData.append('title', uploadTitle.trim());
      formData.append('description', uploadDescription.trim());
      if (uploadCategoryId) formData.append('category_id', uploadCategoryId);
      formData.append('file', uploadFile);

      // Simulate progress since the upload method doesn't provide real progress
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 15, 85));
      }, 500);

      const response = await api.upload<Resource>('/v2/resources', formData);

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (response.success) {
        toast.success(t('resources.upload_success'), t('resources.upload_success_description'));
        uploadModal.onClose();
        resetUploadForm();
        // Reload resources list
        setCursor(undefined);
        loadResources();
      } else {
        logError('Resource upload API error', response.error);
        toast.error(t('resources.upload_failed'), t('resources.upload_failed_description'));
      }
    } catch (err) {
      logError('Failed to upload resource', err);
      toast.error(t('resources.upload_failed'), t('resources.upload_failed_description'));
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  }

  // Delete resource handler
  async function handleDeleteResource() {
    if (!deletingResource) return;
    try {
      setIsDeleting(true);
      const response = await api.delete(`/v2/resources/${deletingResource.id}`);
      if (response.success) {
        toast.success(t('resources.delete_success'), t('resources.delete_success_description'));
        setResources((prev) => prev.filter((r) => r.id !== deletingResource.id));
        deleteModal.onClose();
        setDeletingResource(null);
      } else {
        logError('Resource delete API error', response.error);
        toast.error(t('resources.delete_failed'), t('resources.delete_failed_description'));
      }
    } catch (err) {
      logError('Failed to delete resource', err);
      toast.error(t('resources.delete_failed'), t('resources.delete_failed_description'));
    } finally {
      setIsDeleting(false);
    }
  }

  // R3 - Admin reorder resources
  const handleMoveResource = async (resourceId: number, direction: 'up' | 'down') => {
    const currentIndex = resources.findIndex((r) => r.id === resourceId);
    if (currentIndex === -1) return;
    if (direction === 'up' && currentIndex === 0) return;
    if (direction === 'down' && currentIndex === resources.length - 1) return;

    const previousOrder = resources;
    const newResources = [...resources];
    const swapIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    const current = newResources[currentIndex];
    const swap = newResources[swapIndex];
    if (!current || !swap) return;
    [newResources[currentIndex], newResources[swapIndex]] = [swap, current];
    setResources(newResources);

    try {
      const orderedIds = newResources.map((r) => r.id);
      const response = await api.put('/v2/resources/reorder', { order: orderedIds });
      // A failed reorder resolves to { success: false } WITHOUT throwing, so it
      // would skip the catch and leave the optimistic swap on screen as if it
      // saved — a fake-success the admin only notices after a reload reverts it.
      // Roll the list back to the pre-swap order and surface the failure.
      if (!response.success) {
        setResources(previousOrder);
        toast.error(t('resources.save_order_failed'));
      }
    } catch (err) {
      logError('Failed to reorder resources', err);
      setResources(previousOrder);
      toast.error(t('resources.save_order_failed'));
    }
  };

  // Authenticated download handler - fetches with auth headers then triggers browser download
  async function handleDownload(resourceId: number, title: string) {
    try {
      const downloadUrl = `${API_BASE}/v2/resources/${resourceId}/download`;
      const response = await fetch(downloadUrl, {
        headers: {
          'Authorization': `Bearer ${tokenManager.getAccessToken()}`,
          'X-Tenant-ID': tokenManager.getTenantId() || '',
        },
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = title || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      // Optimistically increment local download count
      setResources((prev) =>
        prev.map((r) => r.id === resourceId ? { ...r, downloads: r.downloads + 1 } : r)
      );
    } catch (err) {
      logError('Failed to download resource', err);
      toast.error(t('resources.download_failed'));
    }
  }

  return (
    <div className="space-y-6">
      <PageMeta title={t('resources.page_title')} description={t('resources.page_description')} />
      {/* The hero owns this page's only <h1> and is hidden on phones, where the
          title moves into the app bar as plain text — leaving a phone with no
          heading to orient by. Keep one for screen readers. Mirrors BlogPage. */}
      {isPhone && <h1 className="sr-only">{t('resources.page_title')}</h1>}
      {/* Phones hide the hero entirely — the title lives in the app bar (useSetAppBarTitle). */}
      {!isPhone && (
      <div className="hidden sm:block">
        <PublicPageHero
          eyebrow={t('resources.hero_eyebrow')}
          title={t('resources.heading')}
          description={t('resources.subtitle')}
          accent="amber"
          icon={<FolderOpen className="h-7 w-7" aria-hidden="true" />}
          stats={resources.length > 0 && !isLoading ? [{ label: t('resources.hero_resources_label'), value: resources.length.toLocaleString(getFormattingLocale()) }] : undefined}
          action={
            isAuthenticated ? (
              <Button
                color="primary"
                className="shrink-0"
                startContent={<Upload className="w-4 h-4" aria-hidden="true" />}
                onPress={uploadModal.onOpen}
              >
                {t('resources.upload_resource')}
              </Button>
            ) : undefined
          }
        />
      </div>
      )}

      {/* Phone: slim sticky control bar (feed/listings parity) — auto-hides on scroll down.
          The trailing slot carries the re-homed Upload action: the hidden hero was its
          ONLY entry point on phones. There are no view modes on this page. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="amber"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchQuery}
          onFiltersPress={openFilterSheet}
          chips={phoneFilterChips}
          onClearAll={resetPhoneFilters}
          labels={{ search: t('resources.search_placeholder') }}
          trailing={
            isAuthenticated ? (
              <Button
                isIconOnly
                variant="flat"
                onPress={uploadModal.onOpen}
                aria-label={t('resources.upload_resource')}
                className="size-11 min-h-11 min-w-11 shrink-0 rounded-full border border-theme-default bg-theme-elevated text-amber-600 dark:text-amber-400"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : undefined
          }
        />
      )}

      {/* Phone: admin reorder mode also lived only in the hidden desktop control row.
          Rendered for admins only, so ordinary phone users pay nothing for it. */}
      {isPhone && isAdmin && (
        <div className="flex flex-wrap items-center gap-2 px-1 sm:hidden">
          <ToggleButton
            size="sm"
            variant="ghost"
            isSelected={isReordering}
            onChange={setIsReordering}
            className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-warning data-[selected=true]:text-white"
          >
            <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
            {isReordering ? t('resources.done_reordering') : t('resources.reorder')}
          </ToggleButton>
        </div>
      )}

      {/* Search & Admin Controls (desktop and tablet — phones use the sticky bar + sheet) */}
      {!isPhone && (
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1 max-w-md">
          <SearchField
            placeholder={t('resources.search_placeholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t('resources.search_placeholder')}
            classNames={{
              input: 'bg-transparent text-theme-primary',
              inputWrapper: 'bg-theme-elevated border-theme-default',
            }}
          />
        </div>

        <div className="flex gap-2 flex-wrap items-center">
          {/* R3 - Admin reorder toggle */}
          {/* R3 - Admin reorder toggle (binary ToggleButton) */}
          {isAdmin && (
            <ToggleButton
              size="sm"
              variant="ghost"
              isSelected={isReordering}
              onChange={setIsReordering}
              className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-warning data-[selected=true]:text-white"
            >
              <GripVertical className="w-3.5 h-3.5" aria-hidden="true" />
              {isReordering ? t('resources.done_reordering') : t('resources.reorder')}
            </ToggleButton>
          )}

          {/* Category quick-filter (fallback if tree not available) — single-select ToggleButtonGroup */}
          {categoryTree.length === 0 && categories.length > 0 && (
            <ToggleButtonGroup
              aria-label={t('resources.filter_by_category')}
              selectionMode="single"
              disallowEmptySelection
              isDetached
              size="sm"
              selectedKeys={new Set([selectedCategory == null ? '__all__' : String(selectedCategory)])}
              onSelectionChange={(keys) => { const [k] = Array.from(keys); setSelectedCategory(!k || k === '__all__' ? null : Number(k)); }}
              className="flex flex-wrap gap-2"
            >
              <ToggleButton
                id="__all__"
                variant="ghost"
                className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-warning data-[selected=true]:text-white"
              >
                {t('resources.filter_all')}
              </ToggleButton>
              {categories.map((cat) => (
                <ToggleButton
                  key={cat.id}
                  id={String(cat.id)}
                  variant="ghost"
                  className="bg-theme-elevated text-theme-muted data-[selected=true]:bg-warning data-[selected=true]:text-white"
                >
                  {cat.name}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          )}
        </div>
      </div>
      )}

      {/* R1 - Layout with Category Tree Sidebar */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Category Tree Sidebar (desktop and tablet — phones filter from the sheet) */}
        {!isPhone && categoryTree.length > 0 && (
          <div className="lg:w-64 flex-shrink-0">
            <GlassCard className="p-3 sticky top-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-theme-primary flex items-center gap-2">
                  <Folder className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  {t('common:skills.categories')}
                </h3>
                <Button
                  size="sm"
                  variant="light"
                  isIconOnly
                  className="text-theme-subtle min-w-0 w-6 h-6 lg:hidden"
                  onPress={() => setShowCategoryTree(!showCategoryTree)}
                  aria-label={showCategoryTree ? t('resources.hide_categories') : t('resources.show_categories')}
                >
                  {showCategoryTree ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </Button>
              </div>
              {showCategoryTree && (
                <div className="space-y-0.5">
                  <Button
                    variant="light"
                    onPress={() => setSelectedCategory(null)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm transition-colors justify-start min-h-9 ${
                      !selectedCategory ? 'bg-amber-500/10 text-[var(--color-warning)] font-semibold' : 'text-theme-muted hover:bg-theme-hover'
                    }`}
                    startContent={<FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />}
                  >
                    {t('resources.all_resources')}
                  </Button>
                  {categoryTree.map((node) => (
                    <CategoryTreeItem
                      key={node.id}
                      node={node}
                      selectedId={selectedCategory}
                      onSelect={setSelectedCategory}
                    />
                  ))}
                </div>
              )}
            </GlassCard>
          </div>
        )}

        {/* Main Content */}
        <div className="flex-1 min-w-0 space-y-4">

      {/* Error */}
      {error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('resources.unable_to_load')}</h2>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            color="warning"
            className="text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadResources()}
          >
            {t('resources.try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Resources List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="space-y-3" aria-busy="true" aria-label={t('resources.loading')}>
              {[1, 2, 3, 4, 5].map((i) => (
                <CardRowsSkeleton key={i} className="p-4" />
              ))}
            </div>
          ) : resources.length === 0 ? (
            <PublicEmptyState
              icon={<FolderOpen className="w-12 h-12" aria-hidden="true" />}
              title={t('resources.no_resources_found')}
              description={
                searchQuery || selectedCategory
                  ? t('resources.try_different_search')
                  : t('resources.no_resources_shared')
              }
              accent="amber"
              tips={[t('resources.empty_tip_guides'), t('resources.empty_tip_templates'), t('resources.empty_tip_files')]}
            />
          ) : (
            <div className="space-y-3">
              {resources.map((resource) => (
                <motion.div
                  key={resource.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  <GlassCard className="p-4 hover:bg-theme-hover/30 transition-colors">
                    <div className="flex items-center gap-4">
                      {/* R3 - Reorder controls (admin only) */}
                      {isReordering && isAdmin && (
                        <div className="flex flex-col gap-0.5 flex-shrink-0">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            className="text-theme-subtle min-w-0 w-6 h-6"
                            onPress={() => handleMoveResource(resource.id, 'up')}
                            aria-label={t('resources.aria_move_up')}
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            className="text-theme-subtle min-w-0 w-6 h-6"
                            onPress={() => handleMoveResource(resource.id, 'down')}
                            aria-label={t('resources.aria_move_down')}
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      )}

                      {/* File Icon */}
                      <div className="w-10 h-10 rounded-lg bg-theme-elevated flex items-center justify-center flex-shrink-0">
                        {getFileIcon(resource.file_path)}
                      </div>

                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold text-theme-primary text-sm truncate">
                            {resource.title}
                          </h3>
                          <Chip size="sm" variant="flat" className="text-xs bg-theme-elevated text-theme-subtle">
                            {getFileExtension(resource.file_path)}
                          </Chip>
                          {resource.category && (
                            <Chip
                              size="sm"
                              variant="flat"
                              className={`text-xs ${categoryColorMap[resource.category.color] ?? categoryColorMap.gray}`}
                            >
                              {resource.category.name}
                            </Chip>
                          )}
                        </div>

                        {resource.description && (
                          <p className="text-xs text-theme-muted line-clamp-1 mb-1">
                            {resource.description}
                          </p>
                        )}

                        <div className="flex items-center gap-3 text-xs text-theme-subtle">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" aria-hidden="true" />
                            {resource.uploader.name}
                          </span>
                          {resource.file_size > 0 && (
                            <span>{formatFileSize(resource.file_size)}</span>
                          )}
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" aria-hidden="true" />
                            {formatRelativeTime(resource.created_at)}
                          </span>
                          {resource.downloads > 0 && (
                            <span className="flex items-center gap-1">
                              <Download className="w-3 h-3" aria-hidden="true" />
                              {resource.downloads}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="flat"
                            className="bg-theme-elevated text-theme-muted"
                            startContent={<Download className="w-3.5 h-3.5" aria-hidden="true" />}
                            onPress={() => handleDownload(resource.id, resource.title)}
                          >
                            {t('resources.download')}
                          </Button>
                        {(user?.id === resource.uploader.id || isAdmin) && (
                          <Button
                            isIconOnly
                            size="sm"
                            variant="light"
                            className="text-theme-subtle hover:text-[var(--color-error)]"
                            onPress={() => {
                              setDeletingResource(resource);
                              deleteModal.onOpen();
                            }}
                            aria-label={t('resources.delete')}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                    <SocialInteractionPanel
                      targetType="resource"
                      targetId={resource.id}
                      initialLiked={resource.is_liked ?? false}
                      initialLikesCount={resource.likes_count ?? 0}
                      initialCommentsCount={resource.comments_count ?? 0}
                      title={resource.title}
                      description={resource.description}
                      className="mt-3"
                      compact
                    />
                  </GlassCard>
                </motion.div>
              ))}

              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={() => loadResources(true)}
                    isLoading={isLoadingMore}
                  >
                    {t('resources.load_more')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

        </div>{/* end Main Content */}
      </div>{/* end R1 Layout */}

      {/* Phone: full-screen search overlay behind the sticky bar's search pill.
          `searchQuery` is this page's single (undebounced) search state, so typing
          filters the list live behind the overlay — the component's documented intent. */}
      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder={t('resources.search_placeholder')}
          recentKey="resources"
        />
      )}

      {/* Phone: draft filter sheet — nothing refetches until the footer applies. */}
      {isPhone && filterSheet.draft && (
        <ResourceFilterSheet
          isOpen={filterSheet.isOpen}
          onClose={filterSheet.close}
          categoryOptions={phoneCategoryOptions}
          draft={filterSheet.draft}
          onDraftChange={filterSheet.patch}
          onApply={filterSheet.apply}
          onClearAll={filterSheet.clear}
        />
      )}

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={deleteModal.isOpen}
        onClose={() => {
          if (!isDeleting) {
            deleteModal.onClose();
            setDeletingResource(null);
          }
        }}
        size="sm"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-[var(--color-error)]" aria-hidden="true" />
            {t('resources.delete_confirm_title')}
          </ModalHeader>
          <ModalBody>
            <p className="text-theme-muted text-sm">
              {t('resources.delete_confirm_message', { title: deletingResource?.title })}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              onPress={() => {
                deleteModal.onClose();
                setDeletingResource(null);
              }}
              isDisabled={isDeleting}
            >
              {t('resources.cancel')}
            </Button>
            <Button
              color="danger"
              onPress={handleDeleteResource}
              isLoading={isDeleting}
            >
              {t('resources.delete_confirm')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Upload Resource Modal */}
      <Modal
        isOpen={uploadModal.isOpen}
        onClose={() => {
          if (!isUploading) {
            uploadModal.onClose();
            resetUploadForm();
          }
        }}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-6',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary flex items-center gap-2">
            <Upload className="w-5 h-5 text-[var(--color-warning)]" aria-hidden="true" />
            {t('resources.upload_resource')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {/* Title */}
              <Input
                label={t('resources.title_label')}
                placeholder={t('resources.title_placeholder')}
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                isRequired
                classNames={inputClassNames}
                isDisabled={isUploading}
              />

              {/* Description */}
              <Textarea
                label={t('resources.description_label')}
                placeholder={t('resources.description_placeholder')}
                value={uploadDescription}
                onChange={(e) => setUploadDescription(e.target.value)}
                minRows={2}
                maxRows={4}
                classNames={{
                  input: 'bg-transparent text-theme-primary',
                  inputWrapper: 'bg-theme-elevated border-theme-default',
                  label: 'text-theme-muted',
                }}
                isDisabled={isUploading}
              />

              {/* Category */}
              {categories.length > 0 && (
                <Select
                  label={t('resources.category_label')}
                  placeholder={t('resources.category_placeholder')}
                  selectedKeys={uploadCategoryId ? [uploadCategoryId] : []}
                  onSelectionChange={(keys) => {
                    const value = Array.from(keys)[0] as string;
                    setUploadCategoryId(value || '');
                  }}
                  classNames={{
                    trigger: 'bg-theme-elevated border-theme-default',
                    value: 'text-theme-primary',
                    label: 'text-theme-muted',
                  }}
                  isDisabled={isUploading}
                >
                  {categories.map((cat) => (
                    <SelectItem key={String(cat.id)} id={String(cat.id)}>{cat.name}</SelectItem>
                  ))}
                </Select>
              )}

              {/* File Upload Area */}
              <div>
                <p className="text-sm text-theme-muted mb-2">{t('resources.file_label')}</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
                  onChange={handleFileInputChange}
                  className="hidden"
                  aria-label={t('resources.select_file_aria')}
                />

                {uploadFile ? (
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-theme-elevated border border-theme-default">
                    <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                      <CheckCircle className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-theme-primary truncate">{uploadFile.name}</p>
                      <p className="text-xs text-theme-subtle">{formatFileSize(uploadFile.size)}</p>
                    </div>
                    <Button
                      isIconOnly
                      size="sm"
                      variant="light"
                      className="text-theme-muted hover:text-[var(--color-error)] min-w-0 w-8 h-8"
                      onPress={() => setUploadFile(null)}
                      isDisabled={isUploading}
                      aria-label={t('resources.remove_file_aria')}
                    >
                      <X className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    className={`
                      flex flex-col items-center justify-center p-4 sm:p-8 rounded-xl border-2 border-dashed transition-colors cursor-pointer
                      ${isDragging
                        ? 'border-amber-500 bg-amber-500/10'
                        : 'border-theme-default bg-theme-elevated hover:border-amber-400 hover:bg-amber-500/5'
                      }
                    `}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    aria-label={t('resources.drop_file_aria')}
                  >
                    <Upload className="w-8 h-8 text-theme-subtle mb-3" aria-hidden="true" />
                    <p className="text-sm font-medium text-theme-primary mb-1">
                      {isDragging ? t('resources.drop_file_here') : t('resources.drag_and_drop')}
                    </p>
                    <p className="text-xs text-theme-subtle text-center">
                      {t('resources.allowed_file_types')}
                    </p>
                  </div>
                )}
              </div>

              {/* Upload Progress */}
              {isUploading && (
                <div className="space-y-2">
                  <Progress
                    value={uploadProgress}
                    className="w-full"
                    classNames={{
                      indicator: 'bg-linear-to-r from-amber-500 to-orange-600',
                      track: 'bg-theme-elevated',
                    }}
                    aria-label={t('resources.aria_upload_progress')}
                  />
                  <p className="text-xs text-theme-subtle text-center">
                    {t('resources.uploading_progress', { progress: uploadProgress })}
                  </p>
                </div>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-primary"
              onPress={() => {
                uploadModal.onClose();
                resetUploadForm();
              }}
              isDisabled={isUploading}
            >
              {t('resources.cancel')}
            </Button>
            <Button
              color="warning"
              className="text-white"
              startContent={!isUploading ? <Upload className="w-4 h-4" aria-hidden="true" /> : undefined}
              onPress={handleUploadSubmit}
              isLoading={isUploading}
              isDisabled={!uploadFile || !uploadTitle.trim()}
            >
              {t('resources.upload')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default ResourcesPage;
