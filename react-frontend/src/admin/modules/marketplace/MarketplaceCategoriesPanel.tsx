// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Marketplace & Freecycle — category manager.
 *
 * Rendered inside the marketplace admin dashboard (owner, 17 Oct 2026: "check
 * that there's a place to add categories" — there was none). Two groups:
 *
 *   - Shared platform categories: seeded for every community, shown read-only
 *     so the admin sees the same list a member does.
 *   - This community's own categories: add, inline edit, show/hide, move
 *     up/down, delete. A category still used by a listing cannot be deleted
 *     (server answers 409 CATEGORY_IN_USE); the panel then offers to hide it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Plus from 'lucide-react/icons/plus';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import ArrowUp from 'lucide-react/icons/arrow-up';
import ArrowDown from 'lucide-react/icons/arrow-down';
import Tag from 'lucide-react/icons/tag';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import FolderTree from 'lucide-react/icons/folder-tree';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  DynamicIcon,
  ICON_MAP,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Spinner,
  Textarea,
  Tooltip,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { ConfirmModal } from '../../components/ConfirmModal';
import {
  CATEGORY_IN_USE,
  marketplaceCategoriesApi,
  type MarketplaceAdminCategory,
  type MarketplaceCategoryInput,
} from './marketplaceCategoriesApi';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel key for "no parent" in the parent select. */
const NO_PARENT = 'none';

interface FormState {
  name: string;
  parent: string;
  icon: string;
  description: string;
}

const EMPTY_FORM: FormState = { name: '', parent: NO_PARENT, icon: '', description: '' };

function formFromCategory(category: MarketplaceAdminCategory): FormState {
  return {
    name: category.name,
    parent: category.parent_id === null ? NO_PARENT : String(category.parent_id),
    icon: category.icon ?? '',
    description: category.description ?? '',
  };
}

function toInput(form: FormState): MarketplaceCategoryInput {
  return {
    name: form.name.trim(),
    parent_id: form.parent === NO_PARENT ? null : Number(form.parent),
    icon: form.icon.trim() || null,
    description: form.description.trim() || null,
  };
}

function bySortOrder(a: MarketplaceAdminCategory, b: MarketplaceAdminCategory): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

/**
 * Parent first, then its children, for display. Hidden parents keep their
 * children beneath them so the admin can see what a hide did.
 */
function treeOrder(rows: MarketplaceAdminCategory[]): MarketplaceAdminCategory[] {
  const sorted = [...rows].sort(bySortOrder);
  const ids = new Set(sorted.map((r) => r.id));
  const out: MarketplaceAdminCategory[] = [];
  for (const row of sorted) {
    if (row.parent_id !== null && ids.has(row.parent_id)) continue;
    out.push(row);
    for (const child of sorted) {
      if (child.parent_id === row.id) out.push(child);
    }
  }
  return out;
}

/**
 * Which field the standard error envelope blames, if any. The server's own
 * message is deliberately not shown: it is rendered in the server's locale,
 * so the panel maps the field to its own translated explanation.
 */
function blamedField(errors: Array<{ field?: string }> | undefined, field: string): boolean {
  return Boolean(errors?.some((e) => e.field === field));
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon preview
// ─────────────────────────────────────────────────────────────────────────────

function CategoryIcon({ name }: { name: string | null }) {
  if (name && ICON_MAP[name]) {
    return (
      <span aria-hidden="true" className="shrink-0 text-muted">
        <DynamicIcon name={name} size={18} />
      </span>
    );
  }
  return <Tag size={18} className="shrink-0 text-muted" aria-hidden="true" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceCategoriesPanel() {
  const { t } = useTranslation('admin_marketplace');
  const toast = useToast();

  const [categories, setCategories] = useState<MarketplaceAdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Add form
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<FormState>(EMPTY_FORM);
  const [addErrors, setAddErrors] = useState<{ name?: string; parent?: string }>({});
  const [adding, setAdding] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM);
  const [editErrors, setEditErrors] = useState<{ name?: string; parent?: string }>({});
  const [savingId, setSavingId] = useState<number | null>(null);

  // Row actions
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MarketplaceAdminCategory | null>(null);
  const [inUse, setInUse] = useState<{ category: MarketplaceAdminCategory; message: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await marketplaceCategoriesApi.list();
      if (res.success && Array.isArray(res.data)) {
        setCategories(res.data);
      } else {
        setLoadError(t('marketplace.categories.failed_load'));
      }
    } catch {
      setLoadError(t('marketplace.categories.failed_load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const platformRows = useMemo(() => treeOrder(categories.filter((c) => c.is_platform)), [categories]);
  const ownRows = useMemo(() => treeOrder(categories.filter((c) => !c.is_platform)), [categories]);

  /** Top-level categories a new or edited category may sit under. */
  const parentOptions = useMemo(
    () => categories.filter((c) => c.parent_id === null).sort(bySortOrder),
    [categories],
  );

  const hasChildren = useCallback(
    (id: number) => categories.some((c) => c.parent_id === id),
    [categories],
  );

  // ─── Add ───────────────────────────────────────────────────────────────────

  const handleAdd = async () => {
    const name = addForm.name.trim();
    if (!name) {
      setAddErrors({ name: t('marketplace.categories.name_required') });
      return;
    }
    setAdding(true);
    setAddErrors({});
    try {
      const res = await marketplaceCategoriesApi.create(toInput(addForm));
      if (res.success && res.data) {
        toast.success(t('marketplace.categories.added'));
        setAddForm(EMPTY_FORM);
        setAddOpen(false);
        await load();
        return;
      }
      const nameError = blamedField(res.errors, 'name') ? t('marketplace.categories.name_taken') : null;
      const parentError = blamedField(res.errors, 'parent_id') ? t('marketplace.categories.parent_invalid') : null;
      if (nameError || parentError) {
        setAddErrors({ name: nameError ?? undefined, parent: parentError ?? undefined });
      } else {
        toast.error(t('marketplace.categories.failed_add'));
      }
    } catch {
      toast.error(t('marketplace.categories.failed_add'));
    } finally {
      setAdding(false);
    }
  };

  // ─── Inline edit ───────────────────────────────────────────────────────────

  const startEdit = (category: MarketplaceAdminCategory) => {
    setEditingId(category.id);
    setEditForm(formFromCategory(category));
    setEditErrors({});
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditErrors({});
  };

  const handleSaveEdit = async (category: MarketplaceAdminCategory) => {
    const name = editForm.name.trim();
    if (!name) {
      setEditErrors({ name: t('marketplace.categories.name_required') });
      return;
    }
    setSavingId(category.id);
    setEditErrors({});
    try {
      const res = await marketplaceCategoriesApi.update(category.id, toInput(editForm));
      if (res.success && res.data) {
        toast.success(t('marketplace.categories.saved'));
        setEditingId(null);
        await load();
        return;
      }
      const nameError = blamedField(res.errors, 'name') ? t('marketplace.categories.name_taken') : null;
      const parentError = blamedField(res.errors, 'parent_id') ? t('marketplace.categories.parent_invalid') : null;
      if (nameError || parentError) {
        setEditErrors({ name: nameError ?? undefined, parent: parentError ?? undefined });
      } else {
        toast.error(t('marketplace.categories.failed_save'));
      }
    } catch {
      toast.error(t('marketplace.categories.failed_save'));
    } finally {
      setSavingId(null);
    }
  };

  // ─── Show / hide ───────────────────────────────────────────────────────────

  const handleToggleActive = async (category: MarketplaceAdminCategory) => {
    setBusyId(category.id);
    try {
      const res = await marketplaceCategoriesApi.update(category.id, { is_active: !category.is_active });
      if (res.success) {
        toast.success(category.is_active ? t('marketplace.categories.hidden') : t('marketplace.categories.shown'));
        await load();
      } else {
        toast.error(t('marketplace.categories.failed_save'));
      }
    } catch {
      toast.error(t('marketplace.categories.failed_save'));
    } finally {
      setBusyId(null);
    }
  };

  // ─── Reorder ───────────────────────────────────────────────────────────────

  /** Own categories in a flat display order; reorder swaps a row with its sibling neighbour. */
  const handleMove = async (category: MarketplaceAdminCategory, direction: -1 | 1) => {
    const flat = ownRows.map((c) => c.id);
    const siblings = ownRows.filter((c) => c.parent_id === category.parent_id).map((c) => c.id);
    const at = siblings.indexOf(category.id);
    const swapWith = siblings[at + direction];
    if (swapWith === undefined) return;

    const a = flat.indexOf(category.id);
    const b = flat.indexOf(swapWith);
    const next = [...flat];
    next[a] = swapWith;
    next[b] = category.id;

    setBusyId(category.id);
    try {
      const res = await marketplaceCategoriesApi.reorder(next);
      if (res.success) {
        await load();
      } else {
        toast.error(t('marketplace.categories.failed_reorder'));
      }
    } catch {
      toast.error(t('marketplace.categories.failed_reorder'));
    } finally {
      setBusyId(null);
    }
  };

  // ─── Delete ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const target = confirmDelete;
    setBusyId(target.id);
    try {
      const res = await marketplaceCategoriesApi.remove(target.id);
      if (res.success) {
        toast.success(t('marketplace.categories.deleted'));
        setConfirmDelete(null);
        await load();
        return;
      }
      setConfirmDelete(null);
      if (res.code === CATEGORY_IN_USE) {
        setInUse({ category: target, message: t('marketplace.categories.in_use_message', { name: target.name }) });
      } else {
        toast.error(t('marketplace.categories.failed_delete'));
      }
    } catch {
      setConfirmDelete(null);
      toast.error(t('marketplace.categories.failed_delete'));
    } finally {
      setBusyId(null);
    }
  };

  const handleHideInstead = async () => {
    if (!inUse) return;
    const target = inUse.category;
    setInUse(null);
    if (target.is_active) {
      await handleToggleActive(target);
    }
  };

  // ─── Render helpers ────────────────────────────────────────────────────────

  const parentName = (parentId: number | null): string | null => {
    if (parentId === null) return null;
    return categories.find((c) => c.id === parentId)?.name ?? null;
  };

  const renderParentSelect = (
    form: FormState,
    setForm: (next: FormState) => void,
    error: string | undefined,
    excludeId: number | null,
  ) => {
    // A category that already has children cannot itself become a child.
    const locked = excludeId !== null && hasChildren(excludeId);
    return (
      <Select
        label={t('marketplace.categories.field_parent')}
        description={locked ? t('marketplace.categories.parent_locked') : t('marketplace.categories.field_parent_hint')}
        selectedKeys={[form.parent]}
        onSelectionChange={(keys) => {
          if (keys === 'all') return;
          const [first] = Array.from(keys);
          setForm({ ...form, parent: first === undefined ? NO_PARENT : String(first) });
        }}
        isDisabled={locked}
        isInvalid={Boolean(error)}
        errorMessage={error}
        size="sm"
      >
        {[
          <SelectItem key={NO_PARENT} id={NO_PARENT}>
            {t('marketplace.categories.no_parent')}
          </SelectItem>,
          ...parentOptions
            .filter((c) => c.id !== excludeId)
            .map((c) => (
              <SelectItem key={String(c.id)} id={String(c.id)}>
                {c.is_platform ? t('marketplace.categories.parent_option_shared', { name: c.name }) : c.name}
              </SelectItem>
            )),
        ]}
      </Select>
    );
  };

  const renderForm = (
    form: FormState,
    setForm: (next: FormState) => void,
    errors: { name?: string; parent?: string },
    excludeId: number | null,
  ) => (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <Input
        label={t('marketplace.categories.field_name')}
        value={form.name}
        onValueChange={(v) => setForm({ ...form, name: v })}
        maxLength={100}
        isRequired
        isInvalid={Boolean(errors.name)}
        errorMessage={errors.name}
        size="sm"
      />
      {renderParentSelect(form, setForm, errors.parent, excludeId)}
      <Input
        label={t('marketplace.categories.field_icon')}
        description={t('marketplace.categories.field_icon_hint')}
        value={form.icon}
        onValueChange={(v) => setForm({ ...form, icon: v })}
        maxLength={50}
        startContent={<CategoryIcon name={form.icon} />}
        size="sm"
      />
      <Textarea
        label={t('marketplace.categories.field_description')}
        value={form.description}
        onValueChange={(v) => setForm({ ...form, description: v })}
        maxLength={1000}
        minRows={2}
        size="sm"
      />
    </div>
  );

  const renderRow = (category: MarketplaceAdminCategory) => {
    const isChild = category.parent_id !== null;
    const isEditing = editingId === category.id;
    const busy = busyId === category.id || savingId === category.id;
    const siblings = ownRows.filter((c) => c.parent_id === category.parent_id);
    const index = siblings.findIndex((c) => c.id === category.id);
    const parent = parentName(category.parent_id);

    return (
      <li
        key={category.id}
        className={`flex flex-col gap-3 py-3 ${isChild ? 'pl-8' : ''}`}
        data-testid={`category-row-${category.id}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <CategoryIcon name={category.icon} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{category.name}</span>
              {category.is_platform && (
                <Chip size="sm" variant="soft" color="default">
                  {t('marketplace.categories.chip_shared')}
                </Chip>
              )}
              <Chip size="sm" variant="soft" color={category.is_active ? 'success' : 'warning'}>
                {category.is_active ? t('marketplace.categories.chip_active') : t('marketplace.categories.chip_hidden')}
              </Chip>
              {category.icon && !ICON_MAP[category.icon] && (
                <Chip size="sm" variant="soft" color="default" className="font-mono">
                  {category.icon}
                </Chip>
              )}
            </div>
            <p className="text-xs text-muted">
              {[
                parent ? t('marketplace.categories.under_parent', { name: parent }) : null,
                t('marketplace.categories.listing_count', { count: category.listing_count }),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {category.description && !isEditing && (
              <p className="mt-1 text-sm text-muted">{category.description}</p>
            )}
          </div>

          {!category.is_platform && !isEditing && (
            <div className="flex items-center gap-1">
              <Tooltip content={t('marketplace.categories.move_up')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label={t('marketplace.categories.move_up_aria', { name: category.name })}
                  isDisabled={busy || index <= 0}
                  onPress={() => void handleMove(category, -1)}
                >
                  <ArrowUp size={14} />
                </Button>
              </Tooltip>
              <Tooltip content={t('marketplace.categories.move_down')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label={t('marketplace.categories.move_down_aria', { name: category.name })}
                  isDisabled={busy || index < 0 || index >= siblings.length - 1}
                  onPress={() => void handleMove(category, 1)}
                >
                  <ArrowDown size={14} />
                </Button>
              </Tooltip>
              <Tooltip content={category.is_active ? t('marketplace.categories.hide') : t('marketplace.categories.show')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label={
                    category.is_active
                      ? t('marketplace.categories.hide_aria', { name: category.name })
                      : t('marketplace.categories.show_aria', { name: category.name })
                  }
                  isDisabled={busy}
                  onPress={() => void handleToggleActive(category)}
                >
                  {category.is_active ? <EyeOff size={14} /> : <Eye size={14} />}
                </Button>
              </Tooltip>
              <Tooltip content={t('marketplace.categories.edit')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  aria-label={t('marketplace.categories.edit_aria', { name: category.name })}
                  isDisabled={busy}
                  onPress={() => startEdit(category)}
                >
                  <Pencil size={14} />
                </Button>
              </Tooltip>
              <Tooltip content={t('marketplace.categories.delete')}>
                <Button
                  isIconOnly
                  size="sm"
                  variant="danger"
                  aria-label={t('marketplace.categories.delete_aria', { name: category.name })}
                  isDisabled={busy}
                  onPress={() => setConfirmDelete(category)}
                >
                  <Trash2 size={14} />
                </Button>
              </Tooltip>
            </div>
          )}
        </div>

        {isEditing && (
          <div className="rounded-xl border border-divider/70 bg-surface-secondary p-3">
            {renderForm(editForm, setEditForm, editErrors, category.id)}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="tertiary" onPress={cancelEdit} isDisabled={savingId === category.id}>
                {t('marketplace.categories.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onPress={() => void handleSaveEdit(category)}
                isLoading={savingId === category.id}
                isDisabled={savingId === category.id}
              >
                {t('marketplace.categories.save')}
              </Button>
            </div>
          </div>
        )}
      </li>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <Card id="categories" className="scroll-mt-24 border border-divider/70 bg-surface" data-testid="marketplace-categories-panel">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2">
          <FolderTree size={20} className="text-muted" aria-hidden="true" />
          <div>
            <h3 className="text-lg font-semibold text-foreground">{t('marketplace.categories.title')}</h3>
            <p className="text-sm text-muted">{t('marketplace.categories.description')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="tertiary"
            startContent={<RefreshCw size={14} />}
            onPress={() => void load()}
            isDisabled={loading}
          >
            {t('marketplace.refresh')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            startContent={<Plus size={14} />}
            onPress={() => {
              setAddOpen((open) => !open);
              setAddErrors({});
            }}
            aria-expanded={addOpen}
          >
            {t('marketplace.categories.add')}
          </Button>
        </div>
      </CardHeader>

      <CardBody className="space-y-6 px-4 pb-4">
        {addOpen && (
          <section
            aria-label={t('marketplace.categories.add_form_aria')}
            className="rounded-xl border border-divider/70 bg-surface-secondary p-3"
          >
            {renderForm(addForm, setAddForm, addErrors, null)}
            <div className="mt-3 flex justify-end gap-2">
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => {
                  setAddOpen(false);
                  setAddForm(EMPTY_FORM);
                  setAddErrors({});
                }}
                isDisabled={adding}
              >
                {t('marketplace.categories.cancel')}
              </Button>
              <Button
                size="sm"
                variant="primary"
                onPress={() => void handleAdd()}
                isLoading={adding}
                isDisabled={adding}
              >
                {t('marketplace.categories.add_submit')}
              </Button>
            </div>
          </section>
        )}

        {loading ? (
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-8">
            <Spinner label={t('marketplace.categories.loading')} />
          </div>
        ) : loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-sm text-danger">{loadError}</p>
            <Button size="sm" variant="secondary" onPress={() => void load()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <>
            <section aria-labelledby="marketplace-own-categories-heading">
              <h4 id="marketplace-own-categories-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
                {t('marketplace.categories.own_heading')}
              </h4>
              {ownRows.length === 0 ? (
                <div className="flex flex-col items-center py-6 text-center">
                  <Tag size={28} className="mb-2 text-muted" aria-hidden="true" />
                  <p className="text-sm text-muted">{t('marketplace.categories.own_empty')}</p>
                </div>
              ) : (
                <ul className="divide-y divide-divider/70">{ownRows.map(renderRow)}</ul>
              )}
            </section>

            <section aria-labelledby="marketplace-shared-categories-heading">
              <h4 id="marketplace-shared-categories-heading" className="text-sm font-semibold uppercase tracking-wide text-muted">
                {t('marketplace.categories.shared_heading')}
              </h4>
              <p className="text-xs text-muted">{t('marketplace.categories.shared_hint')}</p>
              {platformRows.length === 0 ? (
                <p className="py-4 text-sm text-muted">{t('marketplace.categories.shared_empty')}</p>
              ) : (
                <ul className="divide-y divide-divider/70">{platformRows.map(renderRow)}</ul>
              )}
            </section>
          </>
        )}
      </CardBody>

      {confirmDelete && (
        <ConfirmModal
          isOpen={Boolean(confirmDelete)}
          onClose={() => setConfirmDelete(null)}
          onConfirm={() => void handleDelete()}
          title={t('marketplace.categories.delete_title')}
          message={
            hasChildren(confirmDelete.id)
              ? t('marketplace.categories.delete_message_with_children', { name: confirmDelete.name })
              : t('marketplace.categories.delete_message', { name: confirmDelete.name })
          }
          confirmLabel={t('marketplace.categories.delete')}
          cancelLabel={t('marketplace.categories.cancel')}
          confirmColor="danger"
          isLoading={busyId === confirmDelete.id}
        />
      )}

      <Modal isOpen={inUse !== null} onClose={() => setInUse(null)} size="md">
        <ModalContent>
          <ModalHeader>{t('marketplace.categories.in_use_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground">{inUse?.message}</p>
            <p className="text-sm text-muted">{t('marketplace.categories.in_use_hint')}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setInUse(null)}>
              {t('marketplace.categories.cancel')}
            </Button>
            {inUse?.category.is_active && (
              <Button variant="primary" onPress={() => void handleHideInstead()}>
                {t('marketplace.categories.hide_instead')}
              </Button>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Card>
  );
}

export default MarketplaceCategoriesPanel;
