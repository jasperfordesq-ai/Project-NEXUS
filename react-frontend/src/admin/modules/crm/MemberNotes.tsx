// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member Notes
 * Admin CRM page for the private notes coordinators keep about members.
 * Supports add, edit, pin, delete, category / member / text filtering and a
 * CSV export. The filters live in the address (?q=&category=&user_id=&page=)
 * so a reload, the back button or a shared link keeps them; the CRM dashboard
 * and the member pages link here with ?user_id=.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import StickyNote from 'lucide-react/icons/sticky-note';
import Plus from 'lucide-react/icons/plus';
import Pin from 'lucide-react/icons/pin';
import Trash2 from 'lucide-react/icons/trash-2';
import Edit3 from 'lucide-react/icons/pen-line';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Search from 'lucide-react/icons/search';
import Download from 'lucide-react/icons/download';

import { getFormattingLocale } from '@/lib/helpers';
import {
  Card, CardBody, Button, Input, Textarea, Chip, Spinner, Select, SelectItem, Switch,
  useDisclosure, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Pagination,
  ToggleButtonGroup, ToggleButton,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

interface Note {
  id: number;
  tenant_id: number;
  user_id: number;
  author_id: number;
  content: string;
  category: string;
  is_pinned: number;
  created_at: string;
  updated_at: string;
  user_name: string;
  user_avatar: string | null;
  author_name: string;
}

interface NotesMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const CATEGORIES = [
  { key: 'general', labelKey: 'crm.category_general' },
  { key: 'outreach', labelKey: 'crm.category_outreach' },
  { key: 'support', labelKey: 'crm.category_support' },
  { key: 'onboarding', labelKey: 'crm.category_onboarding' },
  { key: 'concern', labelKey: 'crm.category_concern' },
  { key: 'follow_up', labelKey: 'crm.category_follow_up' },
] as const;

type CategoryKey = typeof CATEGORIES[number]['key'];

const CATEGORY_KEYS: readonly string[] = CATEGORIES.map((c) => c.key);
const isCategoryKey = (value: string | null | undefined): value is CategoryKey =>
  typeof value === 'string' && CATEGORY_KEYS.includes(value);

// The HeroUI theme has no numbered status shades, so the chips lean on the
// semantic colours. 'general' gets the neutral secondary (outlined) look so it
// still reads as a tag rather than vanishing into plain text.
const CATEGORY_COLORS: Record<CategoryKey, 'default' | 'accent' | 'warning' | 'success' | 'danger'> = {
  general: 'default',
  outreach: 'accent',
  support: 'warning',
  onboarding: 'success',
  concern: 'danger',
  follow_up: 'default',
};

const ITEMS_PER_PAGE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const MIN_SEARCH_LENGTH = 2;

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr);
  return date.toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export function MemberNotes() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_crm');
  const { t: tCommon } = useTranslation('common');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- Filters: the address is the source of truth -----
  const rawCategory = searchParams.get('category');
  const filterCategory: CategoryKey | '' = isCategoryKey(rawCategory) ? rawCategory : '';
  const filterUserId = (searchParams.get('user_id') || '').replace(/\D/g, '');
  const searchQuery = searchParams.get('q') || '';
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  const hasFilters = Boolean(filterCategory || filterUserId || searchQuery);

  const updateParams = useCallback((changes: Record<string, string | null>) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Every filter change starts from page 1 again.
  const setFilter = useCallback((changes: Record<string, string | null>) => {
    updateParams({ ...changes, page: null });
  }, [updateParams]);

  // The search box is typed into freely and only reaches the address (and the
  // server) after a short pause, instead of one request per keystroke.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setSearchInput(searchQuery); }, [searchQuery]);
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const trimmed = value.trim();
      setFilter({ q: trimmed.length >= MIN_SEARCH_LENGTH ? trimmed : null });
    }, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const [filterMember, setFilterMember] = useState<MemberSearchMember | null>(null);

  // ----- List state -----
  const [notes, setNotes] = useState<Note[]>([]);
  const [meta, setMeta] = useState<NotesMeta>({ total: 0, page: 1, limit: ITEMS_PER_PAGE, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  // ----- Form modal state -----
  const formModal = useDisclosure();
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [formUserId, setFormUserId] = useState('');
  const [formMember, setFormMember] = useState<MemberSearchMember | null>(null);
  const [formContent, setFormContent] = useState('');
  const [formCategory, setFormCategory] = useState<CategoryKey>('general');
  const [formPinned, setFormPinned] = useState(false);
  const [saving, setSaving] = useState(false);

  // ----- Delete state -----
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ----- Data loading -----

  const loadNotes = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: ITEMS_PER_PAGE };
      if (filterCategory) params.category = filterCategory;
      if (filterUserId) params.user_id = filterUserId;
      if (searchQuery.length >= MIN_SEARCH_LENGTH) params.search = searchQuery;

      const res = await adminCrm.getNotes(params);
      if (res.success) {
        setNotes(Array.isArray(res.data) ? res.data as Note[] : []);
        setMeta({
          total: res.meta?.total || 0,
          page: res.meta?.current_page || 1,
          limit: res.meta?.per_page || ITEMS_PER_PAGE,
          pages: res.meta?.total_pages || 1,
        });
      }
    } catch {
      setNotes([]);
    }
    setLoading(false);
  }, [page, filterCategory, filterUserId, searchQuery]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  // ----- Form helpers -----

  const openCreateModal = () => {
    setEditingNote(null);
    setFormUserId(filterUserId || '');
    setFormMember(filterMember);
    setFormContent('');
    setFormCategory(filterCategory || 'general');
    setFormPinned(false);
    formModal.onOpen();
  };

  const openEditModal = (note: Note) => {
    setEditingNote(note);
    setFormUserId(String(note.user_id));
    setFormMember({
      id: note.user_id,
      name: note.user_name,
      email: '',
      avatar_url: note.user_avatar,
    });
    setFormContent(note.content);
    setFormCategory(isCategoryKey(note.category) ? note.category : 'general');
    setFormPinned(note.is_pinned === 1);
    formModal.onOpen();
  };

  const handleSave = async () => {
    if (!formContent.trim()) {
      toast.error(t('crm.note_content_is_required'));
      return;
    }
    setSaving(true);
    try {
      if (editingNote) {
        const res = await adminCrm.updateNote(editingNote.id, {
          content: formContent.trim(),
          category: formCategory,
          is_pinned: formPinned,
        });
        if (res.success) {
          toast.success(t('crm.note_updated'));
          formModal.onClose();
          loadNotes();
        } else {
          toast.error(t('crm.failed_to_update_note'));
        }
      } else {
        if (!formUserId || isNaN(Number(formUserId))) {
          toast.error(t('crm.valid_user_id_required'));
          setSaving(false);
          return;
        }
        const res = await adminCrm.createNote({
          user_id: Number(formUserId),
          content: formContent.trim(),
          category: formCategory,
          is_pinned: formPinned,
        });
        if (res.success) {
          toast.success(t('crm.note_created'));
          formModal.onClose();
          loadNotes();
        } else {
          toast.error(t('crm.failed_to_create_note'));
        }
      }
    } catch {
      toast.error(t('crm.failed_to_save_note'));
    }
    setSaving(false);
  };

  // ----- Pin toggle -----

  const handleTogglePin = async (note: Note) => {
    try {
      const res = await adminCrm.updateNote(note.id, { is_pinned: note.is_pinned !== 1 });
      if (res.success) {
        toast.success(note.is_pinned === 1 ? t('crm.note_unpinned') : t('crm.note_pinned'));
        loadNotes();
      } else {
        toast.error(t('crm.failed_to_update_pin_status'));
      }
    } catch {
      toast.error(t('crm.failed_to_update_pin_status'));
    }
  };

  // ----- Delete -----

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminCrm.deleteNote(deleteTarget.id);
      if (res.success) {
        toast.success(t('crm.note_deleted'));
        setDeleteTarget(null);
        loadNotes();
      } else {
        toast.error(t('crm.failed_to_delete_note'));
      }
    } catch {
      toast.error(t('crm.failed_to_delete_note'));
    }
    setDeleting(false);
  };

  // ----- Export -----

  const handleExport = async () => {
    setExporting(true);
    try {
      await adminCrm.exportNotes();
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(tCommon('errors.download_failed'));
    } finally {
      setExporting(false);
    }
  };

  // ----- Formatting -----

  const getCategoryLabel = (key: string) => {
    const cat = CATEGORIES.find(c => c.key === key);
    return cat ? t(cat.labelKey) : key;
  };

  const clearFilters = () => {
    setFilterMember(null);
    setSearchInput('');
    setFilter({ q: null, category: null, user_id: null });
  };

  const categorySelection = useMemo(() => new Set<Key>([filterCategory || 'all']), [filterCategory]);

  const summary = hasFilters
    ? t('crm.notes_summary_filtered', { count: meta.total })
    : t('crm.notes_summary', { count: meta.total });

  // ----- Render -----

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t('crm.member_notes_title')}
        description={t('crm.member_notes_desc')}
        icon={<StickyNote size={20} />}
        actions={
          <>
            <Button
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={handleExport}
              isLoading={exporting}
              isDisabled={exporting}
            >
              {t('crm.export_notes')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openCreateModal}>
              {t('crm.add_note')}
            </Button>
          </>
        }
      />

      {/* Filters */}
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Input type="search" name="admin-search" autoComplete="off"
            label={t('crm.label_search')}
            placeholder={t('crm.placeholder_search_notes')}
            className="w-full sm:max-w-[280px]"
            size="sm"
            startContent={<Search size={14} />}
            value={searchInput}
            onValueChange={handleSearchChange}
            isClearable
            onClear={() => { setSearchInput(''); setFilter({ q: null }); }}
          />

          <MemberSearchPicker
            label={t('crm.label_search_member')}
            placeholder={t('crm.placeholder_type_name_or_email')}
            noResultsText={t('crm.no_members_found')}
            clearText={t('crm.clear')}
            className="w-full sm:max-w-[340px]"
            size="sm"
            value={filterUserId}
            selectedMember={filterMember}
            onSelectedMemberChange={setFilterMember}
            onValueChange={(val) => setFilter({ user_id: val || null })}
          />

          {hasFilters && (
            <Button size="sm" variant="tertiary" onPress={clearFilters} className="self-start sm:self-end">
              {t('crm.clear_filters')}
            </Button>
          )}
        </div>

        <ToggleButtonGroup
          aria-label={t('crm.label_category')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={categorySelection}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            const next = key == null ? '' : String(key);
            setFilter({ category: isCategoryKey(next) ? next : null });
          }}
          className="flex flex-wrap justify-start gap-2"
        >
          <ToggleButton id="all">{t('crm.category_all')}</ToggleButton>
          {CATEGORIES.map((cat) => (
            <ToggleButton key={cat.key} id={cat.key}>{t(cat.labelKey)}</ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>

      {/* Content */}
      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" label={t('crm.loading_notes')} />
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          icon={StickyNote}
          title={t('crm.no_notes_found')}
          description={hasFilters ? t('crm.no_notes_hint_filtered') : t('crm.no_notes_hint_default')}
          actionLabel={hasFilters ? t('crm.clear_filters') : t('crm.add_note')}
          onAction={hasFilters ? clearFilters : openCreateModal}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted" aria-live="polite">{summary}</p>

          {notes.map(note => {
            const pinned = note.is_pinned === 1;
            const edited = note.updated_at !== note.created_at;
            const category = isCategoryKey(note.category) ? note.category : 'general';
            return (
              <Card
                key={note.id}
                className={`border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] ${pinned ? 'border-l-4 border-l-warning' : ''}`}
              >
                <CardBody className="flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={note.user_avatar || undefined}
                      name={note.user_name}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
                      <div className="min-w-0">
                        <Link
                          to={tenantPath(`/admin/users/${note.user_id}/edit`)}
                          className="block truncate font-semibold text-foreground transition-colors hover:text-accent"
                        >
                          {note.user_name}
                        </Link>
                        <p className="text-xs text-muted">
                          {t('crm.member_with_id', { id: note.user_id })}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Chip
                          size="sm"
                          // The neutral soft chip is near-invisible on a white card, so
                          // uncoloured categories are outlined instead.
                          variant={CATEGORY_COLORS[category] === 'default' ? 'secondary' : 'soft'}
                          color={CATEGORY_COLORS[category]}
                        >
                          {getCategoryLabel(category)}
                        </Chip>
                        {pinned && (
                          <Chip size="sm" variant="soft" color="warning" startContent={<Pin size={12} aria-hidden="true" />}>
                            {t('crm.pin_button_pinned')}
                          </Chip>
                        )}
                      </div>
                    </div>
                    <Dropdown>
                      <DropdownTrigger>
                        <Button isIconOnly size="sm" variant="tertiary" className="-mr-2 -mt-1 shrink-0" aria-label={t('crm.label_note_actions')}>
                          <MoreVertical size={16} />
                        </Button>
                      </DropdownTrigger>
                      <DropdownMenu
                        aria-label={t('crm.label_note_actions')}
                        onAction={(key) => {
                          if (key === 'edit') openEditModal(note);
                          else if (key === 'pin') handleTogglePin(note);
                          else if (key === 'delete') setDeleteTarget(note);
                        }}
                      >
                        <DropdownItem key="edit" id="edit" startContent={<Edit3 size={14} />}>
                          {t('crm.note_action_edit')}
                        </DropdownItem>
                        <DropdownItem key="pin" id="pin" startContent={<Pin size={14} />}>
                          {pinned ? t('crm.note_action_unpin') : t('crm.note_action_pin')}
                        </DropdownItem>
                        <DropdownItem
                          key="delete" id="delete"
                          startContent={<Trash2 size={14} />}
                          className="text-danger"
                          variant="danger"
                        >
                          {t('crm.note_action_delete')}
                        </DropdownItem>
                      </DropdownMenu>
                    </Dropdown>
                  </div>

                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground [overflow-wrap:anywhere]">
                    {note.content}
                  </p>

                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                    <span>{t('crm.note_by_name', { name: note.author_name })}</span>
                    <span aria-hidden="true">·</span>
                    <time dateTime={note.created_at}>{formatDate(note.created_at)}</time>
                    {edited && (
                      <>
                        <span aria-hidden="true">·</span>
                        <time dateTime={note.updated_at}>{t('crm.note_edited_on', { date: formatDate(note.updated_at) })}</time>
                      </>
                    )}
                  </p>
                </CardBody>
              </Card>
            );
          })}

          {/* Pagination */}
          {meta.pages > 1 && (
            <div className="mt-4 flex justify-center">
              <Pagination
                total={meta.pages}
                page={page}
                onChange={(next) => updateParams({ page: next > 1 ? String(next) : null })}
                showControls
              />
            </div>
          )}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal isOpen={formModal.isOpen} onClose={formModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <StickyNote size={20} />
            {editingNote ? t('crm.edit_note_title') : t('crm.add_note_title')}
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
            {editingNote ? (
              <div className="flex items-center gap-3 rounded-xl bg-surface-secondary px-3 py-2">
                <Avatar
                  src={editingNote.user_avatar || undefined}
                  name={editingNote.user_name}
                  size="sm"
                  className="shrink-0"
                />
                <p className="min-w-0 truncate text-sm text-foreground">
                  {t('crm.note_about_member', { name: editingNote.user_name })}
                </p>
              </div>
            ) : (
              <MemberSearchPicker
                label={t('crm.label_search_member')}
                placeholder={t('crm.placeholder_type_name_or_email')}
                noResultsText={t('crm.no_members_found')}
                clearText={t('crm.clear')}
                isRequired
                value={formUserId}
                selectedMember={formMember}
                onSelectedMemberChange={setFormMember}
                onValueChange={setFormUserId}
              />
            )}
            <Textarea
              label={t('crm.label_note_text')}
              placeholder={t('crm.placeholder_write_your_note_about_this_member')}
              isRequired
              minRows={4}
              maxRows={10}
              value={formContent}
              onValueChange={setFormContent}
            />
            <Select
              label={t('crm.label_category')}
              selectedKeys={[formCategory]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0];
                if (isCategoryKey(typeof val === 'string' ? val : null)) setFormCategory(val as CategoryKey);
              }}
            >
              {CATEGORIES.map(cat => (
                <SelectItem key={cat.key} id={cat.key}>{t(cat.labelKey)}</SelectItem>
              ))}
            </Select>
            {/* The shared Switch stacks its control above the label and puts the
                description beside them; lay it out as control + label on one
                row with the hint underneath, as the HeroUI anatomy intends. */}
            <Switch
              isSelected={formPinned}
              onValueChange={setFormPinned}
              color="warning"
              description={t('crm.pin_switch_desc')}
              className="flex-col items-start gap-1"
              classNames={{ content: 'flex-row items-center gap-3' }}
            >
              {t('crm.pin_switch_label')}
            </Switch>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={formModal.onClose} isDisabled={saving}>
              {t('crm.action_cancel')}
            </Button>
            <Button onPress={handleSave} isLoading={saving} isDisabled={saving}>
              {editingNote ? t('crm.update_note') : t('crm.create_note')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title={t('crm.delete_note_title')}
        message={t('crm.delete_note_confirm')}
        confirmLabel={t('crm.action_delete')}
        confirmColor="danger"
        isLoading={deleting}
      />
    </div>
  );
}

export default MemberNotes;
