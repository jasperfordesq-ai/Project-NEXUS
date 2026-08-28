import { Card, CardBody, CardHeader, Input, Button, Spinner, Chip, Select, SelectItem, DynamicIcon, Switch } from '@/components/ui';
import { useState, useEffect, useCallback, useMemo } from 'react';

import { Separator } from '@/components/ui';
import Menu from 'lucide-react/icons/menu';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import GripVertical from 'lucide-react/icons/grip-vertical';
import Pencil from 'lucide-react/icons/pencil';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminMenus, adminPages } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { IconPicker } from '../../components/IconPicker';
import { VisibilityRulesEditor } from '../../components/VisibilityRulesEditor';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { MenuItemType, MenuLocation, VisibilityRules } from '@/types/menu';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Menu Builder
 * Visual menu builder with drag-drop reordering, drag-to-nest, live preview, * icon picker, visibility rules editor, page/route pickers, and nested item support.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NEST_THRESHOLD = 40;

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface MenuItemData {
  id: number;
  label: string;
  url: string | null;
  type: MenuItemType;
  icon: string | null;
  css_class: string | null;
  target: '_self' | '_blank';
  sort_order: number;
  parent_id: number | null;
  visibility_rules: VisibilityRules | null;
  is_active: number;
  route_name?: string | null;
  page_id?: number | null;
  children?: MenuItemData[];
}

interface MenuFormData {
  name: string;
  location: string;
  description: string;
  is_active: boolean;
}

interface PageOption {
  id: number;
  title: string;
  slug: string;
}

type TFunction = (key: string, options?: Record<string, unknown>) => string;

/** Route picker — labels from existing nav.* keys via cross-namespace lookup */
const getAppRoutes = (t: TFunction): { value: string; label: string; group: string }[] => [
  { value: '/dashboard', label: t('config.module_name_dashboard'), group: t('menu_builder.group_core') },
  { value: '/feed', label: t('config.module_name_feed'), group: t('menu_builder.group_core') },
  { value: '/listings', label: t('config.module_name_listings'), group: t('menu_builder.group_core') },
  { value: '/messages', label: t('config.module_name_messages'), group: t('menu_builder.group_core') },
  { value: '/wallet', label: t('config.module_name_wallet'), group: t('menu_builder.group_core') },
  { value: '/members', label: t('config.module_name_members'), group: t('menu_builder.group_community') },
  { value: '/groups', label: t('config.module_name_groups'), group: t('menu_builder.group_community') },
  { value: '/events', label: t('config.module_name_events'), group: t('menu_builder.group_community') },
  { value: '/connections', label: t('config.module_name_connections'), group: t('menu_builder.group_community') },
  { value: '/volunteering', label: t('config.module_name_volunteering'), group: t('menu_builder.group_features') },
  { value: '/organisations', label: t('config.module_name_organisations'), group: t('menu_builder.group_features') },
  { value: '/goals', label: t('config.module_name_goals'), group: t('menu_builder.group_features') },
  { value: '/blog', label: t('config.module_name_blog'), group: t('menu_builder.group_features') },
  { value: '/resources', label: t('config.module_name_resources'), group: t('menu_builder.group_features') },
  { value: '/courses', label: t('config.module_name_courses'), group: t('menu_builder.group_features') },
  { value: '/podcasts', label: t('config.module_name_podcasts'), group: t('menu_builder.group_features') },
  { value: '/jobs', label: t('config.module_name_job_vacancies'), group: t('menu_builder.group_features') },
  { value: '/marketplace', label: t('config.module_name_marketplace'), group: t('menu_builder.group_features') },
  { value: '/leaderboard', label: t('config.module_name_leaderboard'), group: t('menu_builder.group_gamification') },
  { value: '/achievements', label: t('config.module_name_achievements'), group: t('menu_builder.group_gamification') },
  { value: '/about', label: t('menu_builder.route_about'), group: t('menu_builder.group_info') },
  { value: '/faq', label: t('menu_builder.route_faq'), group: t('menu_builder.group_info') },
  { value: '/explore', label: t('menu_builder.route_explore'), group: t('menu_builder.group_info') },
];

/**
 * Returns a starter set of menu items mirroring the hardcoded fallback nav.
 * Used to pre-populate a new menu so admins can edit from a known baseline.
 */
function getDefaultItems(t: TFunction): MenuItemData[] {
  let seq = Date.now();
  const next = () => seq++;

  const communityId = next();
  return [
    {
      id: next(), label: t('config.module_name_feed'), url: '/feed', type: 'link',
      icon: 'Newspaper', target: '_self', sort_order: 0, parent_id: null,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('menu_builder.route_explore'), url: '/explore', type: 'link',
      icon: 'Compass', target: '_self', sort_order: 1, parent_id: null,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_listings'), url: '/listings', type: 'link',
      icon: 'ListTodo', target: '_self', sort_order: 2, parent_id: null,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: communityId, label: t('menu_builder.group_community'), url: null, type: 'dropdown',
      icon: 'Users', target: '_self', sort_order: 3, parent_id: null,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_members'), url: '/members', type: 'link',
      icon: 'Users', target: '_self', sort_order: 4, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_events'), url: '/events', type: 'link',
      icon: 'Calendar', target: '_self', sort_order: 5, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_groups'), url: '/groups', type: 'link',
      icon: 'Users', target: '_self', sort_order: 6, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_volunteering'), url: '/volunteering', type: 'link',
      icon: 'Heart', target: '_self', sort_order: 7, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_resources'), url: '/resources', type: 'link',
      icon: 'FolderOpen', target: '_self', sort_order: 8, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_courses'), url: '/courses', type: 'link',
      icon: 'BookOpen', target: '_self', sort_order: 9, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
    {
      id: next(), label: t('config.module_name_podcasts'), url: '/podcasts', type: 'link',
      icon: 'Podcast', target: '_self', sort_order: 10, parent_id: communityId,
      visibility_rules: null, is_active: 1, css_class: null,
    },
  ];
}

const getLocationOptions = (t: TFunction): { key: MenuLocation; label: string }[] => [
  { key: 'header-main', label: t('menu_builder.location_header_main') },
  { key: 'header-secondary', label: t('menu_builder.location_header_secondary') },
  { key: 'footer', label: t('menu_builder.location_footer') },
  { key: 'sidebar', label: t('menu_builder.location_sidebar') },
  { key: 'mobile', label: t('menu_builder.location_mobile') },
];

const getTypeOptions = (t: TFunction): { key: MenuItemType; label: string; description: string }[] => [
  { key: 'link', label: t('menu_builder.type_link_label'), description: t('menu_builder.type_link_desc') },
  { key: 'external', label: t('menu_builder.type_external_label'), description: t('menu_builder.type_external_desc') },
  { key: 'dropdown', label: t('menu_builder.type_dropdown_label'), description: t('menu_builder.type_dropdown_desc') },
  { key: 'page', label: t('menu_builder.type_page_label'), description: t('menu_builder.type_page_desc') },
  { key: 'route', label: t('menu_builder.type_route_label'), description: t('menu_builder.type_route_desc') },
  { key: 'divider', label: t('menu_builder.type_divider_label'), description: t('menu_builder.type_divider_desc') },
];

const getTypeLabel = (type: MenuItemType, t: TFunction): string => {
  const option = getTypeOptions(t).find((item) => item.key === type);
  return option?.label ?? type;
};

// ─────────────────────────────────────────────────────────────────────────────
// Live Preview Component
// ─────────────────────────────────────────────────────────────────────────────

function LivePreview({ items, t }: { items: MenuItemData[]; t: TFunction }) {
  const topLevel = items.filter((i) => !i.parent_id && i.is_active);

  return (
    <Card className="mb-4 border border-border bg-surface">
      <CardHeader className="pb-2">
        <h3 className="text-sm font-semibold flex items-center gap-2 text-accent">
          <Eye size={15} aria-hidden="true" />
          {t('menu_builder.live_preview')}
          <Chip size="sm" variant="soft" className="text-[10px]">
            {t('menu_builder.preview')}
          </Chip>
        </h3>
      </CardHeader>
      <CardBody className="pt-0">
        <div className="flex min-h-10 flex-wrap items-center gap-1 rounded-lg border border-dashed border-border bg-surface-secondary px-3 py-2">
          {topLevel.length === 0 ? (
            <p className="text-xs text-muted">{t('menu_builder.no_data')}</p>
          ) : (
            topLevel.map((item) => {
              const children = items.filter((i) => i.parent_id === item.id && i.is_active);

              if (item.type === 'divider') {
                return <div key={item.id} className="mx-1 h-5 w-px shrink-0 bg-border" />;
              }

              if (item.type === 'dropdown' || children.length > 0) {
                return (
                  <div key={item.id} className="relative group/preview">
                    <Button
                      size="sm"
                      variant="tertiary"
                      className="min-h-8 min-w-0 gap-1.5 px-3 text-xs font-medium text-foreground"
                    >
                      <DynamicIcon name={item.icon} className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{item.label}</span>
                      <ChevronDown size={11} aria-hidden="true" />
                    </Button>
                    {children.length > 0 && (
                      <div className="absolute left-0 top-full z-20 hidden min-w-[150px] rounded-lg border border-border bg-overlay p-1 shadow-overlay group-hover/preview:block">
                        {children.map((child) => (
                          <div key={child.id} className="flex items-center gap-2 rounded px-3 py-1.5 text-xs hover:bg-surface-secondary">
                            <DynamicIcon name={child.icon} className="h-3 w-3 shrink-0 text-muted" aria-hidden="true" />
                            <span>{child.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <div key={item.id} className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-foreground">
                  <DynamicIcon name={item.icon} className="w-3.5 h-3.5 shrink-0" />
                  <span>{item.label}</span>
                </div>
              );
            })
          )}
        </div>
        <p className="mt-1.5 text-[10px] text-muted">{t('menu_builder.drag_hint')}</p>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sortable Item Component
// ─────────────────────────────────────────────────────────────────────────────

interface SortableItemProps {
  item: MenuItemData;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  t: TFunction;
  depth?: number;
}

function SortableItem({ item, isSelected, onSelect, onDelete, t, depth = 0 }: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    marginLeft: depth * 24,
  };

  return (
    // The row's own onClick only widens the pointer hit area. The keyboard path
    // to the same action already exists inside the row: the "Edit item" icon
    // Button below calls the identical `onSelect`, and the drag handle Button
    // handles reordering. Giving this wrapper role="button" + tabIndex would put
    // a focusable control around two focusable controls, which is the nested-
    // interactive pattern scripts/check-nested-interactive.mjs exists to stop.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-lg border p-2.5 transition-colors cursor-pointer ${
        isSelected
          ? 'border-accent bg-accent/5'
          : 'border-border hover:border-border-secondary'
      } ${!item.is_active ? 'opacity-50' : ''}`}
      onClick={onSelect}
    >
      <Button
        isIconOnly
        variant="tertiary"
        size="sm"
        className="min-h-8 min-w-8 shrink-0 cursor-grab p-0.5 text-muted hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={t('menu_builder.drag_to_reorder')}
      >
        <GripVertical size={16} aria-hidden="true" />
      </Button>

      <DynamicIcon name={item.icon} className="w-4 h-4 text-theme-muted shrink-0" aria-hidden="true" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium truncate">{item.label}</p>
          <Chip size="sm" variant="soft" className="h-4 shrink-0 text-[10px]">
            {getTypeLabel(item.type, t)}
          </Chip>
          {!item.is_active && <EyeOff size={12} className="shrink-0 text-muted" aria-hidden="true" />}
        </div>
        {item.url && (
          <p className="truncate text-[11px] text-muted">{item.url}</p>
        )}
      </div>

      {item.children && item.children.length > 0 && (
        <Chip size="sm" variant="soft" className="shrink-0 text-[10px]">
          {t('menu_builder.sub_items', { count: item.children.length })}
        </Chip>
      )}

      <Button
        isIconOnly
        size="sm"
        variant="tertiary"
        onPress={onSelect}
        aria-label={t('menu_builder.edit_item')}
      >
        <Pencil size={13} aria-hidden="true" />
      </Button>

      <Button
        isIconOnly
        size="sm"
        variant="danger-soft"
        onPress={() => onDelete()}
        aria-label={t('menu_builder.delete_item')}
      >
        <Trash2 size={13} aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Static card used in DragOverlay — no DnD hooks */
function DragItemCard({ item, t }: { item: MenuItemData; t: TFunction }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft p-2.5 opacity-90 shadow-overlay">
      <GripVertical size={16} className="shrink-0 text-accent" aria-hidden="true" />
      <DynamicIcon name={item.icon} className="h-4 w-4 shrink-0 text-accent" />
      <p className="truncate text-sm font-medium text-accent-soft-foreground">{item.label}</p>
      <Chip size="sm" variant="soft" className="h-4 shrink-0 text-[10px]">
        {getTypeLabel(item.type, t)}
      </Chip>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MenuBuilder() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined && id !== 'new';
  const { t } = useTranslation('admin_content');
  usePageTitle(t('menu_builder.menu_builder_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [formData, setFormData] = useState<MenuFormData>({
    name: '',
    location: 'header-main',
    description: '',
    is_active: true,
  });

  const [menuItems, setMenuItems] = useState<MenuItemData[]>([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // Item editor state
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<MenuItemData>>({});
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Live preview toggle
  const [showPreview, setShowPreview] = useState(false);

  // Drag state
  const [activeItem, setActiveItem] = useState<MenuItemData | null>(null);

  // Pages for page-type picker
  const [pages, setPages] = useState<PageOption[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(false);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ─── Data Loading ────────────────────────────────────────────────────────

  const flattenItems = useCallback((items: MenuItemData[], _depth = 0): MenuItemData[] => {
    const result: MenuItemData[] = [];
    for (const item of items) {
      result.push(item);
      if (item.children && item.children.length > 0) {
        result.push(...flattenItems(item.children, _depth + 1));
      }
    }
    return result;
  }, []);

  const loadMenu = useCallback(async () => {
    if (!isEdit) return;
    setLoading(true);
    try {
      const [menuRes, itemsRes] = await Promise.all([
        adminMenus.get(Number(id)),
        adminMenus.getItems(Number(id)),
      ]);

      if (menuRes.success && menuRes.data) {
        const menu = menuRes.data as Record<string, unknown>;
        setFormData({
          name: (menu.name as string) || '',
          location: (menu.location as string) || 'header-main',
          description: (menu.description as string) || '',
          is_active: Boolean(menu.is_active),
        });
      }

      if (itemsRes.success && itemsRes.data) {
        const raw = itemsRes.data as unknown;
        const items = Array.isArray(raw) ? raw : (raw as { data?: MenuItemData[] })?.data || [];
        setMenuItems(flattenItems(items as MenuItemData[]));
      }
    } catch {
      toast.error(t('menu_builder.failed_to_load_menu'));
    } finally {
      setLoading(false);
    }
  }, [id, isEdit, flattenItems, t, toast]);


  useEffect(() => { loadMenu(); }, [loadMenu]);

  const loadPages = useCallback(async () => {
    if (pagesLoaded) return;
    try {
      const res = await adminPages.list();
      if (res.success && res.data) {
        const raw = Array.isArray(res.data) ? res.data : (res.data as { data?: PageOption[] })?.data ?? [];
        setPages(raw.map((p: { id: number; title: string; slug: string }) => ({
          id: p.id,
          title: p.title,
          slug: p.slug,
        })));
      }
    } catch {
      // non-fatal
    } finally {
      setPagesLoaded(true);
    }
  }, [pagesLoaded]);

  // ─── Menu Settings ───────────────────────────────────────────────────────

  const handleChange = (field: keyof MenuFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.warning(t('menu_builder.menu_name_required'));
      return;
    }
    if (!formData.location) {
      toast.warning(t('menu_builder.menu_location_required'));
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        const res = await adminMenus.update(Number(id), {
          name: formData.name,
          location: formData.location,
          description: formData.description,
          is_active: formData.is_active ? 1 : 0,
        });
        if (res?.success) {
          toast.success(t('menu_builder.menu_updated'));
        } else {
          toast.error(t('menu_builder.failed_to_update_menu'));
        }
      } else {
        const res = await adminMenus.create({
          name: formData.name,
          location: formData.location,
          description: formData.description,
        });
        if (res?.success) {
          const newMenu = res.data as { id?: number } | undefined;
          const newMenuId = newMenu?.id;
          let itemFailures = 0;
          if (newMenuId && menuItems.length > 0) {
            for (const item of menuItems) {
              const itemRes = await adminMenus.createItem(newMenuId, {
                label: item.label,
                url: item.url,
                type: item.type,
                icon: item.icon,
                target: item.target,
                sort_order: item.sort_order,
                visibility_rules: item.visibility_rules,
                is_active: item.is_active,
              });
              if (!itemRes?.success) itemFailures++;
            }
          }
          if (itemFailures > 0) {
            toast.error(t('menu_builder.failed_to_add_item'));
          } else {
            toast.success(t('menu_builder.menu_created'));
          }
          navigate(tenantPath('/admin/menus'));
          return;
        } else {
          toast.error(t('menu_builder.failed_to_create_menu'));
        }
      }
    } catch {
      toast.error(t('menu_builder.unexpected_error'));
    } finally {
      setSaving(false);
    }
  };

  // ─── Item CRUD ───────────────────────────────────────────────────────────

  const selectItem = (item: MenuItemData) => {
    setSelectedItemId(item.id);
    setEditForm({
      label: item.label,
      url: item.url,
      type: item.type,
      icon: item.icon,
      css_class: item.css_class,
      target: item.target,
      sort_order: item.sort_order,
      parent_id: item.parent_id,
      visibility_rules: item.visibility_rules,
      is_active: item.is_active,
      route_name: item.route_name,
      page_id: item.page_id,
    });
    setShowAdvanced(Boolean(item.css_class || item.visibility_rules));
    if (item.type === 'page') loadPages();
  };

  const clearSelection = () => {
    setSelectedItemId(null);
    setEditForm({});
    setShowAdvanced(false);
  };

  const handleAddItem = async () => {
    const newItem: Partial<MenuItemData> = {
      label: t('menu_builder.new_item_default'),
      url: '/',
      type: 'link',
      icon: null,
      css_class: null,
      target: '_self',
      sort_order: menuItems.length,
      parent_id: null,
      visibility_rules: null,
      is_active: 1,
    };

    if (isEdit) {
      try {
        const res = await adminMenus.createItem(Number(id), newItem);
        if (res?.success) {
          toast.success(t('menu_builder.item_added'));
          await loadMenu();
          const created = res.data as MenuItemData | undefined;
          if (created?.id) selectItem(created);
        } else {
          toast.error(t('menu_builder.failed_to_add_item'));
        }
      } catch {
        toast.error(t('menu_builder.unexpected_error'));
      }
    } else {
      const localItem: MenuItemData = { ...newItem as MenuItemData, id: Date.now() };
      setMenuItems((prev) => [...prev, localItem]);
      selectItem(localItem);
    }
  };

  const handleUpdateItem = async () => {
    if (!selectedItemId) return;

    if (isEdit) {
      try {
        const payload: Record<string, unknown> = { ...editForm };
        if (payload.visibility_rules) {
          payload.visibility_rules = JSON.stringify(payload.visibility_rules);
        }
        const res = await adminMenus.updateItem(selectedItemId, payload);
        if (res?.success) {
          toast.success(t('menu_builder.item_updated'));
          await loadMenu();
        } else {
          toast.error(t('menu_builder.failed_to_update_item'));
        }
      } catch {
        toast.error(t('menu_builder.unexpected_error'));
      }
    } else {
      setMenuItems((prev) =>
        prev.map((item) =>
          item.id === selectedItemId ? { ...item, ...editForm } as MenuItemData : item
        )
      );
      toast.success(t('menu_builder.item_updated'));
    }
  };

  const handleDeleteItem = async (itemId: number) => {
    if (isEdit) {
      try {
        const res = await adminMenus.deleteItem(itemId);
        if (res?.success) {
          toast.success(t('menu_builder.item_deleted'));
          if (selectedItemId === itemId) clearSelection();
          await loadMenu();
        } else {
          toast.error(t('menu_builder.failed_to_delete_item'));
        }
      } catch {
        toast.error(t('menu_builder.unexpected_error'));
      }
    } else {
      setMenuItems((prev) => prev.filter((i) => i.id !== itemId));
      if (selectedItemId === itemId) clearSelection();
    }
  };

  // ─── Drag & Drop (with nest/un-nest via horizontal delta) ─────────────────

  const handleDragStart = (event: DragStartEvent) => {
    const item = menuItems.find((i) => i.id === event.active.id);
    setActiveItem(item ?? null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over, delta } = event;
    setActiveItem(null);

    if (!over || active.id === over.id) return;

    const oldIndex = menuItems.findIndex((i) => i.id === active.id);
    const newIndex = menuItems.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const moved = menuItems[oldIndex];
    if (!moved) return;

    const reordered = arrayMove([...menuItems], oldIndex, newIndex);

    // Determine nesting change from horizontal drag displacement
    let newParentId = moved.parent_id;
    if (delta.x > NEST_THRESHOLD) {
      // Indent: nest under the item immediately before the new position
      const movedIdx = reordered.findIndex((i) => i.id === moved.id);
      const prevItem = movedIdx > 0 ? reordered[movedIdx - 1] : null;
      if (prevItem && prevItem.id !== moved.id && prevItem.type === 'dropdown') {
        newParentId = prevItem.id;
      }
    } else if (delta.x < -NEST_THRESHOLD) {
      // Outdent: remove from any parent
      newParentId = null;
    }

    const final = reordered.map((item, idx) => ({
      ...item,
      sort_order: idx,
      ...(item.id === moved.id ? { parent_id: newParentId } : {}),
    }));

    setMenuItems(final);

    // Update edit form parent if this item is selected
    if (selectedItemId === moved.id && newParentId !== moved.parent_id) {
      setEditForm((f) => ({ ...f, parent_id: newParentId }));
    }

    if (isEdit) {
      try {
        const res = await adminMenus.reorderItems(
          Number(id),
          final.map((item) => ({
            id: item.id,
            sort_order: item.sort_order,
            parent_id: item.parent_id,
          })),
        );
        if (!res?.success) {
          toast.error(t('menu_builder.failed_to_save_reorder'));
          // Revert the optimistic reorder to the server's saved order
          await loadMenu();
        }
      } catch {
        toast.error(t('menu_builder.failed_to_save_reorder'));
        await loadMenu();
      }
    }
  };

  // ─── Depth (for visual indentation) ──────────────────────────────────────

  const getItemDepth = (item: MenuItemData): number => {
    if (!item.parent_id) return 0;
    const parent = menuItems.find((i) => i.id === item.parent_id);
    return parent ? 1 + getItemDepth(parent) : 0;
  };

  // ─── Translated option arrays ─────────────────────────────────────────────

  const LOCATION_OPTIONS = getLocationOptions(t as TFunction);
  const TYPE_OPTIONS = getTypeOptions(t as TFunction);
  const APP_ROUTES = useMemo(() => getAppRoutes(t as TFunction), [t]);

  const parentOptions = menuItems
    .filter((i) => i.type === 'dropdown' && i.id !== selectedItemId)
    .map((i) => ({ key: String(i.id), label: i.label }));

  // ─── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div>
        <PageHeader title={t('menu_builder.menu_builder_title')} description={t('menu_builder.menu_builder_desc')} />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-12"><Spinner size="lg" /></div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={isEdit ? t('menu_builder.edit_menu') : t('menu_builder.create_menu')}
        description={t('menu_builder.menu_builder_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              startContent={showPreview ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
              onPress={() => setShowPreview((v) => !v)}
            >
              {showPreview ? t('menu_builder.hide_preview') : t('menu_builder.live_preview')}
            </Button>
            <Button
              variant="secondary"
              startContent={<ArrowLeft size={16} aria-hidden="true" />}
              onPress={() => navigate(tenantPath('/admin/menus'))}
            >
              {t('menu_builder.back')}
            </Button>
            <Button
              startContent={<Save size={16} aria-hidden="true" />}
              onPress={handleSave}
              isLoading={saving}
            >
              {isEdit ? t('menu_builder.save_changes') : t('menu_builder.create_menu')}
            </Button>
          </div>
        }
      />

      {/* Menu Settings */}
      <Card className="mb-4 border border-border bg-surface">
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Input
              label={t('menu_builder.menu_name')}
              placeholder={t('menu_builder.menu_item_text_placeholder')}
              isRequired
              variant="secondary"
              value={formData.name}
              onValueChange={(v) => handleChange('name', v)}
            />
            <Select
              label={t('menu_builder.location')}
              isRequired
              variant="secondary"
              selectedKeys={formData.location ? [formData.location] : []}
              onSelectionChange={(keys) => {
                const sel = Array.from(keys)[0] as string;
                if (sel) handleChange('location', sel);
              }}
            >
              {LOCATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
              ))}
            </Select>
            <div className="flex items-end gap-4">
              <Input
                label={t('menu_builder.description')}
                placeholder={t('menu_builder.optional_placeholder')}
                variant="secondary"
                value={formData.description}
                onValueChange={(v) => handleChange('description', v)}
                className="flex-1"
              />
              <Switch
                isSelected={formData.is_active}
                onValueChange={(v) => handleChange('is_active', v)}
                size="sm"
              >
                <span className="text-sm">{t('active')}</span>
              </Switch>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Live Preview */}
      {showPreview && <LivePreview items={menuItems} t={t as TFunction} />}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Left: Item Tree */}
        <div className="lg:col-span-3">
          <Card className="border border-border bg-surface">
            <CardHeader className="flex items-center justify-between">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Menu size={20} aria-hidden="true" /> {t('menu_builder.menu_builder_title')}
                <Chip size="sm" variant="soft">{menuItems.length}</Chip>
              </h3>
              <Button
                size="sm"
                variant="secondary"
                startContent={<Plus size={14} aria-hidden="true" />}
                onPress={handleAddItem}
              >
                {t('menu_builder.add')}
              </Button>
            </CardHeader>
            <CardBody>
              {menuItems.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-muted">
                  <Menu size={40} aria-hidden="true" />
                  <p className="text-sm">{t('menu_builder.no_data')}</p>
                  <div className="flex gap-2 flex-wrap justify-center">
                    <Button
                      size="sm"
                      startContent={<Plus size={14} aria-hidden="true" />}
                      onPress={handleAddItem}
                    >
                      {t('menu_builder.add')}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      startContent={<Eye size={14} aria-hidden="true" />}
                      onPress={() => setMenuItems(getDefaultItems(t as TFunction))}
                    >
                      {t('menu_builder.load_defaults')}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted">{t('menu_builder.load_defaults_hint')}</p>
                </div>
              ) : (
                <>
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                  >
                    <SortableContext
                      items={menuItems.map((i) => i.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <div className="space-y-1.5">
                        {menuItems.map((item) => (
                          <SortableItem
                            key={item.id}
                            item={item}
                            isSelected={selectedItemId === item.id}
                            onSelect={() => selectItem(item)}
                            onDelete={() => setDeleteTarget(item.id)}
                            t={t as TFunction}
                            depth={getItemDepth(item)}
                          />
                        ))}
                      </div>
                    </SortableContext>
                    <DragOverlay>
                      {activeItem ? <DragItemCard item={activeItem} t={t as TFunction} /> : null}
                    </DragOverlay>
                  </DndContext>
                  <p className="mt-3 text-center text-[11px] text-muted">
                    {t('menu_builder.drag_hint')}
                  </p>
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Right: Item Editor */}
        <div className="lg:col-span-2">
          <Card className="sticky top-20 border border-border bg-surface">
            <CardHeader>
              <h3 className="text-lg font-semibold">
                {selectedItemId ? t('menu_builder.edit_item') : t('menu_builder.menu_builder_title')}
              </h3>
            </CardHeader>
            <CardBody className="gap-3">
              {!selectedItemId ? (
                <div className="flex flex-col items-center py-8 text-muted">
                  <Pencil size={32} className="mb-3" />
                  <p className="text-sm">{t('menu_builder.menu_builder_desc')}</p>
                </div>
              ) : (
                <>
                  {/* Label */}
                  <Input
                    label={t('menu_builder.label')}
                    placeholder={t('menu_builder.menu_item_text_placeholder')}
                    isRequired
                    variant="secondary"
                    size="sm"
                    value={editForm.label || ''}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, label: v }))}
                  />

                  {/* Type */}
                  <Select
                    label={t('menu_builder.type')}
                    variant="secondary"
                    size="sm"
                    selectedKeys={editForm.type ? [editForm.type] : ['link']}
                    onSelectionChange={(keys) => {
                      const sel = Array.from(keys)[0] as MenuItemType;
                      if (sel) {
                        const updates: Partial<MenuItemData> = { type: sel };
                        if (sel === 'external') updates.target = '_blank';
                        if (sel === 'dropdown') updates.url = null;
                        if (sel === 'divider') { updates.url = null; updates.icon = null; }
                        if (sel === 'page') loadPages();
                        setEditForm((f) => ({ ...f, ...updates }));
                      }
                    }}
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} id={opt.key} textValue={opt.label}>
                        <div>
                          <p className="text-sm font-medium">{opt.label}</p>
                          <p className="text-xs text-muted">{opt.description}</p>
                        </div>
                      </SelectItem>
                    ))}
                  </Select>

                  {/* URL field for link / external */}
                  {(editForm.type === 'link' || editForm.type === 'external' || !editForm.type) && (
                    <Input
                      label={t('menu_builder.url')}
                      placeholder={editForm.type === 'external'
                        ? t('menu_builder.placeholder_external_url')
                        : t('menu_builder.placeholder_internal_route')}
                      variant="secondary"
                      size="sm"
                      value={editForm.url || ''}
                      onValueChange={(v) => setEditForm((f) => ({ ...f, url: v }))}
                    />
                  )}

                  {/* Page picker */}
                  {editForm.type === 'page' && (
                    <Select
                      label={t('menu_builder.select_page')}
                      variant="secondary"
                      size="sm"
                      isLoading={!pagesLoaded}
                      selectedKeys={editForm.page_id ? [String(editForm.page_id)] : []}
                      onSelectionChange={(keys) => {
                        const sel = Array.from(keys)[0] as string;
                        const page = pages.find((p) => p.id === Number(sel));
                        if (page) {
                          setEditForm((f) => ({
                            ...f,
                            page_id: page.id,
                            url: `/page/${page.slug}`,
                          }));
                        }
                      }}
                    >
                      {pages.map((page) => (
                        <SelectItem key={String(page.id)} id={String(page.id)} textValue={page.title}>
                          <div>
                            <p className="text-sm font-medium">{page.title}</p>
                            {/* eslint-disable-next-line i18next/no-literal-string -- Route preview must preserve its path syntax. */}
                            <p className="text-xs text-muted">/page/{page.slug}</p>
                          </div>
                        </SelectItem>
                      ))}
                    </Select>
                  )}

                  {/* Route picker */}
                  {editForm.type === 'route' && (
                    <Select
                      label={t('menu_builder.select_route')}
                      variant="secondary"
                      size="sm"
                      selectedKeys={editForm.url ? [editForm.url] : []}
                      onSelectionChange={(keys) => {
                        const sel = Array.from(keys)[0] as string;
                        if (sel) {
                          const route = APP_ROUTES.find((r) => r.value === sel);
                          setEditForm((f) => ({
                            ...f,
                            url: sel,
                            route_name: route?.label ?? sel,
                          }));
                        }
                      }}
                    >
                      {APP_ROUTES.map((route) => (
                        <SelectItem key={route.value} id={route.value} textValue={route.label}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium">{route.label}</span>
                            <span className="font-mono text-xs text-muted">{route.value}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </Select>
                  )}

                  {/* Icon picker (not for divider) */}
                  {editForm.type !== 'divider' && (
                    <IconPicker
                      value={editForm.icon || null}
                      onChange={(icon) => setEditForm((f) => ({ ...f, icon }))}
                    />
                  )}

                  {/* Target */}
                  {editForm.type !== 'divider' && editForm.type !== 'dropdown' && (
                    <Select
                      label={t('menu_builder.open_in')}
                      variant="secondary"
                      size="sm"
                      selectedKeys={[editForm.target || '_self']}
                      onSelectionChange={(keys) => {
                        const sel = Array.from(keys)[0] as '_self' | '_blank';
                        if (sel) setEditForm((f) => ({ ...f, target: sel }));
                      }}
                    >
                      <SelectItem key="_self" id="_self">{t('menu_builder.same_window')}</SelectItem>
                      <SelectItem key="_blank" id="_blank">{t('menu_builder.new_tab')}</SelectItem>
                    </Select>
                  )}

                  {/* Parent (nest under dropdown) */}
                  {editForm.type !== 'dropdown' && parentOptions.length > 0 && (
                    <Select
                      label={t('menu_builder.parent_item')}
                      variant="secondary"
                      size="sm"
                      selectedKeys={editForm.parent_id ? [String(editForm.parent_id)] : ['']}
                      onSelectionChange={(keys) => {
                        const sel = Array.from(keys)[0] as string;
                        setEditForm((f) => ({ ...f, parent_id: sel ? Number(sel) : null }));
                      }}
                    >
                      {[
                        { key: '', label: t('menu_builder.no_parent') },
                        ...parentOptions,
                      ].map((opt) => (
                        <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
                      ))}
                    </Select>
                  )}

                  {/* Active toggle */}
                  <Switch
                    isSelected={Boolean(editForm.is_active)}
                    onValueChange={(v) => setEditForm((f) => ({ ...f, is_active: v ? 1 : 0 }))}
                    size="sm"
                  >
                    <span className="text-sm flex items-center gap-1.5">
                      {editForm.is_active ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
                      {editForm.is_active ? t('menu_builder.visible') : t('menu_builder.hidden')}
                    </span>
                  </Switch>

                  <Separator />

                  {/* Advanced (collapsible) */}
                  <Button
                    variant="ghost"
                    className="min-h-8 justify-start gap-1.5 p-0 text-sm text-muted hover:text-accent"
                    onPress={() => setShowAdvanced(!showAdvanced)}
                  >
                    {showAdvanced ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                    {t('menu_builder.advanced_options')}
                  </Button>

                  {showAdvanced && (
                    <div className="space-y-3 border-l-2 border-border pl-2">
                      <Input
                        label={t('menu_builder.css_class')}
                        placeholder={t('menu_builder.placeholder_css')}
                        variant="secondary"
                        size="sm"
                        value={editForm.css_class || ''}
                        onValueChange={(v) => setEditForm((f) => ({ ...f, css_class: v || null }))}
                      />
                      <VisibilityRulesEditor
                        value={editForm.visibility_rules || null}
                        onChange={(rules) => setEditForm((f) => ({ ...f, visibility_rules: rules }))}
                      />
                    </div>
                  )}

                  <Separator />

                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onPress={handleUpdateItem}
                    >
                      {t('menu_builder.save_changes')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={clearSelection}
                    >
                      {t('menu_builder.cancel')}
                    </Button>
                  </div>
                </>
              )}
            </CardBody>
          </Card>
        </div>
      </div>

      <ConfirmModal
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget !== null) {
            handleDeleteItem(deleteTarget);
            setDeleteTarget(null);
          }
        }}
        title={t('menu_builder.delete_item')}
        message={t('menu_builder.delete_item_message')}
        confirmLabel={t('menu_builder.delete')}
        confirmColor="danger"
      />
    </div>
  );
}

export default MenuBuilder;
