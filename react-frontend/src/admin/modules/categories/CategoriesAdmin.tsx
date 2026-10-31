import { getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Input, Card, CardBody, Select, SelectItem, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tabs, Tab } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Categories Management
 * Full CRUD for content categories with type filtering.
 * Parity: PHP Admin\CategoryController
 */

import { useState, type CSSProperties, useCallback, useEffect } from 'react';

import Plus from 'lucide-react/icons/plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import FolderOpen from 'lucide-react/icons/folder-open';
import Tag from 'lucide-react/icons/tag';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useTenant, useToast } from '@/contexts';
import { adminCategories } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import type { AdminCategory } from '../../api/types';

import { useTranslation } from 'react-i18next';
// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_TYPE_KEYS = ['listing', 'event', 'blog', 'resource', 'vol_opportunity'] as const;

const TYPE_COLORS: Record<string, 'primary' | 'success' | 'warning' | 'secondary'> = {
  listing: 'primary',
  event: 'success',
  blog: 'warning',
  resource: 'primary',
  vol_opportunity: 'secondary',
};

/** The platform languages a category name is translated into (SetLocale::SUPPORTED_LOCALES). */
const TRANSLATION_LANGUAGES = ['en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'] as const;

/** A language's name in the admin's own language, from the browser (no strings to translate). */
function languageName(code: string, displayLocale: string): string {
  try {
    const names = new Intl.DisplayNames([displayLocale, 'en'], { type: 'language' });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The API sends name_translations as JSON text; tolerate an object or nothing. */
function parseTranslations(value: AdminCategory['name_translations']): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object') return { ...value };
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? { ...(parsed as Record<string, string>) } : {};
  } catch {
    return {};
  }
}

const COLOR_OPTIONS = [
  'blue', 'red', 'green', 'orange', 'purple', 'pink',
  'yellow', 'teal', 'indigo', 'cyan', 'fuchsia', 'gray', 'slate',
];

// ─────────────────────────────────────────────────────────────────────────────
// Actions menu
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryActionsMenuProps {
  category: AdminCategory;
  t: (key: string, options?: Record<string, unknown>) => string;
  openEditModal: (category: AdminCategory) => void;
  setDeleteTarget: React.Dispatch<React.SetStateAction<AdminCategory | null>>;
}

function CategoryActionsMenu({ category, t, openEditModal, setDeleteTarget }: CategoryActionsMenuProps) {
  type ActionKey = 'edit' | 'delete';

  const handleMenuAction = (key: React.Key) => {
    const action = key as ActionKey;
    if (action === 'edit') {
      openEditModal(category);
    } else if (action === 'delete') {
      setDeleteTarget(category);
    }
  };

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('categories.label_category_actions')}>
          <MoreVertical size={16} />
        </Button>
      </DropdownTrigger>
      <DropdownMenu aria-label={t('categories.label_category_actions')} onAction={handleMenuAction}>
        <DropdownItem key="edit" id="edit" startContent={<Edit size={14} />}>
          {t('common.edit')}
        </DropdownItem>
        <DropdownItem key="delete" id="delete" startContent={<Trash2 size={14} />} className="text-danger" variant="danger">
          {t('common.delete')}
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CategoriesAdmin() {
  const { t, i18n } = useTranslation('admin_categories');
  // The community's own language is the name itself, so it is not listed below.
  const { defaultLanguage } = useTenant();
  useAdminPageMeta({ title: t('categories.page_title') });
  const toast = useToast();

  // Translated category type labels (derived from i18n)
  const TYPE_LABELS: Record<string, string> = {
    listing: t('categories.type_listing'),
    event: t('categories.type_event'),
    blog: t('categories.type_blog'),
    resource: t('categories.type_resource'),
    vol_opportunity: t('categories.type_vol_opportunity'),
  };
  const CATEGORY_TYPES = CATEGORY_TYPE_KEYS.map((key) => ({ key, label: TYPE_LABELS[key] }));

  // Data state
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('all');

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<AdminCategory | null>(null);
  const [formData, setFormData] = useState({ name: '', color: 'blue', type: 'listing' });
  // The name in other languages, for the admin to check and correct (AWID
  // feedback, 30 Oct 2026). Filled automatically; an edit here is kept.
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Delete confirm state
  const [deleteTarget, setDeleteTarget] = useState<AdminCategory | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Data loading ───

  const loadCategories = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const params = typeFilter !== 'all' ? { type: typeFilter } : {};
      const res = await adminCategories.list(params);
      if (res.success && res.data) {
        // The API returns { data: [...] } envelope; the api client unwraps it
        const data = res.data as unknown;
        if (Array.isArray(data)) {
          setCategories(data);
        } else if (data && typeof data === 'object' && 'data' in data) {
          setCategories((data as { data: AdminCategory[] }).data || []);
        }
      } else {
        setLoadError(t('categories.failed_to_load_categories'));
        toast.error(t('categories.failed_to_load_categories'));
      }
    } catch {
      setLoadError(t('categories.failed_to_load_categories'));
      toast.error(t('categories.failed_to_load_categories'));
    } finally {
      setLoading(false);
    }
  }, [typeFilter, toast, t]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  // ─── Create / Edit ───

  const openCreateModal = () => {
    setEditingCategory(null);
    setFormData({ name: '', color: 'blue', type: 'listing' });
    setModalOpen(true);
  };

  const openEditModal = (category: AdminCategory) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      color: category.color || 'blue',
      type: category.type || 'listing',
    });
    setTranslations(parseTranslations(category.name_translations));
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingCategory(null);
    setFormData({ name: '', color: 'blue', type: 'listing' });
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error(t('categories.category_name_is_required'));
      return;
    }

    setSaving(true);

    if (editingCategory) {
      // Update
      const renamed = formData.name.trim() !== editingCategory.name;
      const res = await adminCategories.update(editingCategory.id, {
        name: formData.name.trim(),
        color: formData.color,
        type: formData.type,
        // A rename translates the new name afresh, so edits to the old one are not sent.
        ...(renamed ? {} : { name_translations: translations }),
      });

      if (res.success) {
        toast.success(t('categories.item_updated'));
        closeModal();
        loadCategories();
      } else {
        const errorMsg = t('categories.failed_to_save_category');
        toast.error(errorMsg);
      }
    } else {
      // Create
      const res = await adminCategories.create({
        name: formData.name.trim(),
        color: formData.color,
        type: formData.type,
      });

      if (res.success) {
        toast.success(t('categories.item_added'));
        closeModal();
        loadCategories();
      } else {
        const errorMsg = t('categories.failed_to_save_category');
        toast.error(errorMsg);
      }
    }

    setSaving(false);
  };

  // ─── Delete ───

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    const res = await adminCategories.delete(deleteTarget.id);
    if (res.success) {
      toast.success(t('categories.item_deleted'));
      setDeleteTarget(null);
      loadCategories();
    } else {
      toast.error(t('categories.failed_to_delete_category'));
    }

    setDeleting(false);
  };

  // ─── Table columns ───

  const columns: Column<AdminCategory>[] = [
    {
      key: 'name',
      label: t('categories.label_name'),
      sortable: true,
      render: (cat) => (
        <div className="flex items-center gap-3">
          <div
            className="h-3 w-3 rounded-full shrink-0"
            style={{ '--category-color': cat.color || 'var(--color-primary)', backgroundColor: 'var(--category-color)' } as CSSProperties}
          />
          <span className="font-medium text-foreground">{cat.name}</span>
        </div>
      ),
    },
    {
      key: 'slug',
      label: t('categories.label_slug'),
      render: (cat) => (
        <span className="text-sm text-muted font-mono">{cat.slug}</span>
      ),
    },
    {
      key: 'type',
      label: t('categories.label_type'),
      sortable: true,
      render: (cat) => (
        <Chip size="sm" variant="soft" color={TYPE_COLORS[cat.type] || 'default'}>
          {TYPE_LABELS[cat.type] || cat.type}
        </Chip>
      ),
    },
    {
      key: 'listing_count',
      label: t('categories.label_listings'),
      sortable: true,
      render: (cat) => (
        <Chip size="sm" variant="soft" color={cat.listing_count > 0 ? 'primary' : 'default'}>
          {cat.listing_count}
        </Chip>
      ),
    },
    {
      key: 'created_at',
      label: t('categories.label_created'),
      sortable: true,
      render: (cat) => (
        <span className="text-sm text-muted">
          {new Date(cat.created_at).toLocaleDateString(getFormattingLocale())}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('common.actions'),
      render: (cat) => (
        <CategoryActionsMenu
          category={cat}
          t={t}
          openEditModal={openEditModal}
          setDeleteTarget={setDeleteTarget}
        />
      ),
    },
  ];

  // ─── Render ───

  return (
    <div>
      <PageHeader
        title={t('categories.categories_admin_title')}
        description={t('categories.categories_admin_desc')}
        actions={
          <Button
            startContent={<Plus aria-hidden="true" size={16} />}
            onPress={openCreateModal}
          >
            {t('categories.add_category')}
          </Button>
        }
      />

      {/* Type Filter Tabs */}
      <div className="mb-4">
        <Tabs
          aria-label={t('categories.tabs_aria')}
          selectedKey={typeFilter}
          onSelectionChange={(key) => setTypeFilter(key as string)}
          variant="underlined"
          size="sm"
        >
          <Tab key="all" title={t('common.all')} />
          <Tab key="listing" title={t('categories.listings')} />
          <Tab key="event" title={t('categories.events')} />
          <Tab key="blog" title={t('categories.type_blog')} />
          <Tab key="vol_opportunity" title={t('categories.volunteering')} />
        </Tabs>
      </div>

      {loadError && !loading ? (
        <Card role="alert">
          <CardBody className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle aria-hidden="true" size={32} className="text-danger" />
            <div className="text-base font-semibold">{t('common.error_loading_data')}</div>
            <div className="text-sm text-muted">{loadError}</div>
            <Button variant="tertiary" onPress={loadCategories}>{t('common.retry')}</Button>
          </CardBody>
        </Card>
      ) : categories.length === 0 && !loading ? (
        <EmptyState
          icon={FolderOpen}
          title={t('categories.empty_title')}
          description={t('categories.categories_admin_desc')}
          actionLabel={t('categories.add_category')}
          onAction={openCreateModal}
        />
      ) : (
        <DataTable
          columns={columns}
          data={categories}
          isLoading={loading}
          searchPlaceholder={t('categories.search_placeholder')}
          onRefresh={loadCategories}
          emptyContent={t('categories.empty_title')}
        />
      )}

      {/* ─── Create / Edit Modal ─── */}
      <Modal isOpen={modalOpen} onClose={closeModal} size="md">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Tag aria-hidden="true" size={20} />
            {editingCategory ? t('categories.edit_category') : t('categories.create_category')}
          </ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label={t('categories.label_name')}
              placeholder={t('categories.placeholder_name')}
              value={formData.name}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, name: v }))}
              isRequired
              variant="secondary"
              autoFocus
            />

            <Select
              label={t('categories.label_type')}
              selectedKeys={new Set([formData.type])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) setFormData((prev) => ({ ...prev, type: selected }));
              }}
              variant="secondary"
            >
              {CATEGORY_TYPES.map((t) => (
                <SelectItem key={t.key} id={t.key}>{t.label}</SelectItem>
              ))}
            </Select>

            <Select
              label={t('categories.label_colour')}
              selectedKeys={new Set([formData.color])}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string;
                if (selected) setFormData((prev) => ({ ...prev, color: selected }));
              }}
              variant="secondary"
              renderValue={(items) => {
                return items.map((item) => (
                  <div key={item.key} className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ '--swatch-color': String(item.key), backgroundColor: 'var(--swatch-color)' } as CSSProperties}
                    />
                    <span>{t(`categories.color_${String(item.key)}`, { defaultValue: t('categories.color_unknown') })}</span>
                  </div>
                ));
              }}
            >
              {COLOR_OPTIONS.map((color) => (
                <SelectItem key={color} id={color} textValue={t(`categories.color_${color}`)}>
                  <div className="flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full"
                      style={{ '--swatch-color': color, backgroundColor: 'var(--swatch-color)' } as CSSProperties}
                    />
                    <span>{t(`categories.color_${color}`)}</span>
                  </div>
                </SelectItem>
              ))}
            </Select>
            {editingCategory && (
              <fieldset className="space-y-3 rounded-lg border border-theme-default p-3">
                <legend className="px-1 text-sm font-medium text-theme-primary">{t('categories.translations_heading')}</legend>
                {formData.name.trim() !== editingCategory.name ? (
                  <p className="text-sm text-theme-muted">{t('categories.translations_after_rename')}</p>
                ) : (
                  <>
                    <p className="text-sm text-theme-muted">{t('categories.translations_hint')}</p>
                    {TRANSLATION_LANGUAGES.filter((code) => code !== (defaultLanguage || 'en').slice(0, 2)).map((code) => (
                      <Input
                        key={code}
                        label={languageName(code, i18n.language)}
                        value={translations[code] ?? ''}
                        onValueChange={(v) => setTranslations((prev) => ({ ...prev, [code]: v }))}
                        maxLength={255}
                        variant="secondary"
                        lang={code}
                        dir={code === 'ar' ? 'rtl' : undefined}
                      />
                    ))}
                  </>
                )}
              </fieldset>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeModal} isDisabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onPress={handleSave} isLoading={saving} isDisabled={saving}>
              {editingCategory ? t('categories.save_changes') : t('categories.create_category')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── Delete Confirmation ─── */}
      {deleteTarget && (
        <ConfirmModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title={t('categories.delete_category')}
          message={t('categories.delete_confirm_message', { name: deleteTarget.name })}
          confirmLabel={t('common.delete')}
          confirmColor="danger"
          isLoading={deleting}
        />
      )}
    </div>
  );
}

export default CategoriesAdmin;
