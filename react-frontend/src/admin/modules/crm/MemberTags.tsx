// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member Tags
 * Admin CRM page for the labels coordinators put on members ("Gardening",
 * "Needs a lift") to group them for filtering and outreach. Members never
 * see their tags.
 *
 * Two views, both addressable: the tag list (/admin/crm/tags?q=&sort=) and
 * the members carrying one tag (/admin/crm/tags?tag=Gardening), so a reload,
 * the back button or a shared link lands on the same screen. Supports adding
 * a tag (existing names offered first so spellings stay consistent), removing
 * it from one member or from everyone, and a CSV export.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Key } from '@heroui/react/rac';

import Tag from 'lucide-react/icons/tag';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Download from 'lucide-react/icons/download';

import { getFormattingLocale } from '@/lib/helpers';
import {
  Card, CardBody, Button, Input, Chip, Spinner, useDisclosure,
  Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar,
  ToggleButtonGroup, ToggleButton, ComboBox, ComboBoxItem,
} from '@/components/ui';
import { useTenant, useToast } from '@/contexts';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminCrm } from '../../api/adminApi';
import type { MemberTag, TagSummary } from '../../api/types';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';

type SortKey = 'members' | 'name';

const SEARCH_DEBOUNCE_MS = 300;
const TAG_MAX_LENGTH = 50;

const formatDate = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

const formatDateTime = (dateStr: string) =>
  new Date(dateStr).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function MemberTags() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_crm');
  const { t: tCommon } = useTranslation('common');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // ----- The address is the source of truth -----
  const activeTag = (searchParams.get('tag') || '').trim();
  const searchQuery = searchParams.get('q') || '';
  const sort: SortKey = searchParams.get('sort') === 'name' ? 'name' : 'members';
  const viewMode = activeTag ? 'members' : 'summary';

  const updateParams = useCallback((changes: Record<string, string | null>, replace = true) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  // Typing into the search box only reaches the address after a short pause.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setSearchInput(searchQuery); }, [searchQuery]);
  const handleSearchChange = (value: string) => {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      updateParams({ q: value.trim() || null });
    }, SEARCH_DEBOUNCE_MS);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  // ----- Data -----
  const [tagSummaries, setTagSummaries] = useState<TagSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [memberTags, setMemberTags] = useState<MemberTag[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // ----- Add-tag dialog -----
  const addModal = useDisclosure();
  const [formUserId, setFormUserId] = useState('');
  const [formMember, setFormMember] = useState<MemberSearchMember | null>(null);
  const [formTag, setFormTag] = useState('');
  const [saving, setSaving] = useState(false);

  // ----- Removal -----
  const [removeTarget, setRemoveTarget] = useState<MemberTag | null>(null);
  const [removeAllTarget, setRemoveAllTarget] = useState<{ tag: string; count: number } | null>(null);
  const [removing, setRemoving] = useState(false);

  // ----- Loading -----

  const loadTagSummaries = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await adminCrm.getTags();
      setTagSummaries(res.success && Array.isArray(res.data) ? res.data as TagSummary[] : []);
    } catch {
      setTagSummaries([]);
    }
    setSummaryLoading(false);
  }, []);

  const loadMembersByTag = useCallback(async (tag: string) => {
    setMembersLoading(true);
    try {
      const res = await adminCrm.getTags({ tag });
      setMemberTags(res.success && Array.isArray(res.data) ? res.data as MemberTag[] : []);
    } catch {
      setMemberTags([]);
    }
    setMembersLoading(false);
  }, []);

  // The summary is loaded once and refreshed after every change: it feeds the
  // tag list, the counts shown in the members view, and the suggestions in
  // the add-tag dialog.
  useEffect(() => { loadTagSummaries(); }, [loadTagSummaries]);

  useEffect(() => {
    if (activeTag) loadMembersByTag(activeTag);
    else setMemberTags([]);
  }, [activeTag, loadMembersByTag]);

  // ----- Navigation -----

  // Opening a tag is a real step, so the browser's back button returns to the list.
  const openTagMembers = (tag: string) => updateParams({ tag }, false);
  const backToSummary = () => updateParams({ tag: null }, false);

  // ----- Add tag -----

  const openAddModal = () => {
    setFormUserId('');
    setFormMember(null);
    setFormTag(activeTag);
    addModal.onOpen();
  };

  const handleAddTag = async () => {
    if (!formUserId || isNaN(Number(formUserId))) {
      toast.error(t('crm.valid_user_id_required'));
      return;
    }
    const tagValue = formTag.trim();
    if (!tagValue) {
      toast.error(t('crm.tag_name_is_required'));
      return;
    }
    if (tagValue.length > TAG_MAX_LENGTH) {
      toast.error(t('crm.tag_too_long', { max: TAG_MAX_LENGTH }));
      return;
    }
    const memberName = formMember?.name || t('crm.member_with_id', { id: formUserId });
    setSaving(true);
    try {
      const res = await adminCrm.addTag({ user_id: Number(formUserId), tag: tagValue });
      if (res.success) {
        toast.success(t('crm.tag_added_to_member', { tag: tagValue, name: memberName }));
        addModal.onClose();
        loadTagSummaries();
        if (activeTag && activeTag === tagValue) loadMembersByTag(activeTag);
      } else if (res.code === 'RESOURCE_ALREADY_EXISTS') {
        toast.error(t('crm.tag_already_assigned', { tag: tagValue, name: memberName }));
      } else {
        toast.error(t('crm.failed_to_add_tag'));
      }
    } catch {
      toast.error(t('crm.failed_to_add_tag'));
    }
    setSaving(false);
  };

  // ----- Remove from one member -----

  const handleRemoveFromMember = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      const res = await adminCrm.removeTag(removeTarget.id);
      if (res.success) {
        toast.success(t('crm.tag_removed_from_member'));
        setRemoveTarget(null);
        loadTagSummaries();
        if (activeTag) loadMembersByTag(activeTag);
      } else {
        toast.error(t('crm.failed_to_remove_tag'));
      }
    } catch {
      toast.error(t('crm.failed_to_remove_tag'));
    }
    setRemoving(false);
  };

  // ----- Remove from everyone -----

  const handleRemoveFromAll = async () => {
    if (!removeAllTarget) return;
    setRemoving(true);
    try {
      const res = await adminCrm.bulkRemoveTag(removeAllTarget.tag);
      if (res.success) {
        toast.success(t('crm.tag_removed_all'));
        setRemoveAllTarget(null);
        loadTagSummaries();
        // The tag no longer exists, so its members view has nothing to show.
        if (activeTag === removeAllTarget.tag) backToSummary();
      } else {
        toast.error(t('crm.failed_to_remove_tag'));
      }
    } catch {
      toast.error(t('crm.failed_to_remove_tag'));
    }
    setRemoving(false);
  };

  // ----- Export -----

  const handleExport = async () => {
    setExporting(true);
    try {
      await adminCrm.exportTags();
      toast.success(t('crm.export_success'));
    } catch {
      toast.error(tCommon('errors.download_failed'));
    } finally {
      setExporting(false);
    }
  };

  // ----- Derived -----

  const filteredSummaries = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const list = query
      ? tagSummaries.filter((ts) => ts.tag.toLowerCase().includes(query))
      : tagSummaries;
    if (sort === 'name') {
      return [...list].sort((a, b) => a.tag.localeCompare(b.tag, getFormattingLocale(), { sensitivity: 'base' }));
    }
    return list;
  }, [tagSummaries, searchQuery, sort]);

  const totalTagged = useMemo(
    () => tagSummaries.reduce((sum, ts) => sum + Number(ts.member_count || 0), 0),
    [tagSummaries],
  );

  const sortSelection = useMemo(() => new Set<Key>([sort]), [sort]);

  const clearSearch = () => {
    setSearchInput('');
    updateParams({ q: null });
  };

  const memberName = (mt: MemberTag) => mt.user_name || t('crm.member_with_id', { id: mt.user_id });

  // ----- Render: tag list -----

  const renderSummaryView = () => (
    <>
      {/* Filters */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Input type="search" name="admin-search" autoComplete="off"
          label={t('crm.label_search_tags')}
          placeholder={t('crm.placeholder_filter_by_tag_name')}
          className="w-full sm:max-w-[280px]"
          size="sm"
          startContent={<Search size={14} />}
          value={searchInput}
          onValueChange={handleSearchChange}
          isClearable
          onClear={clearSearch}
        />
        <ToggleButtonGroup
          aria-label={t('crm.label_sort')}
          selectionMode="single"
          disallowEmptySelection
          isDetached
          size="sm"
          selectedKeys={sortSelection}
          onSelectionChange={(keys) => {
            const [key] = Array.from(keys);
            updateParams({ sort: key === 'name' ? 'name' : null });
          }}
          className="flex flex-wrap justify-start gap-2 sm:ms-auto"
        >
          <ToggleButton id="members">{t('crm.sort_most_members')}</ToggleButton>
          <ToggleButton id="name">{t('crm.sort_name')}</ToggleButton>
        </ToggleButtonGroup>
      </div>

      {/* The spinner only replaces the list on the first load; a refresh after
          a change keeps the cards in place instead of blanking the page. */}
      {summaryLoading && tagSummaries.length === 0 ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" label={t('crm.loading_tags')} />
        </div>
      ) : filteredSummaries.length === 0 ? (
        searchQuery ? (
          <EmptyState
            icon={Tag}
            title={t('crm.no_tags_found')}
            description={t('crm.no_tags_hint_search')}
            actionLabel={t('crm.clear')}
            onAction={clearSearch}
          />
        ) : (
          <EmptyState
            icon={Tag}
            title={t('crm.no_tags_yet')}
            description={t('crm.no_tags_hint_default')}
            actionLabel={t('crm.add_tag')}
            onAction={openAddModal}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted" aria-live="polite">
            {searchQuery
              ? t('crm.tags_summary_filtered', { count: filteredSummaries.length })
              : t('crm.tags_summary', { count: tagSummaries.length, members: totalTagged })}
          </p>

          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredSummaries.map((ts) => {
              const count = Number(ts.member_count || 0);
              const next = new URLSearchParams(searchParams);
              next.set('tag', ts.tag);
              return (
                <li key={ts.tag} className="min-w-0">
                  {/* The whole card opens the tag through a stretched link; the
                      remove button sits beside it in the DOM, not inside it, so
                      nothing interactive is nested. */}
                  <Card className="group relative h-full border border-divider/70 bg-surface shadow-sm shadow-black/[0.03] transition-colors hover:border-accent focus-within:border-accent">
                    <CardBody className="flex flex-col gap-3 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                            <Tag size={15} aria-hidden="true" />
                          </span>
                          <Link
                            to={{ search: `?${next.toString()}` }}
                            onClick={(e) => { e.preventDefault(); openTagMembers(ts.tag); }}
                            className="line-clamp-2 min-w-0 break-words font-semibold leading-snug text-foreground outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:rounded-[inherit] after:content-['']"
                          >
                            {ts.tag}
                          </Link>
                        </div>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="tertiary"
                          color="danger"
                          className="relative z-10 -me-2 -mt-1 shrink-0"
                          onPress={() => setRemoveAllTarget({ tag: ts.tag, count })}
                          aria-label={t('crm.remove_tag_all_aria', { tag: ts.tag })}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Chip size="sm" variant="secondary" startContent={<Users size={12} aria-hidden="true" />}>
                          {t('crm.tag_member_count', { count })}
                        </Chip>
                        {ts.last_added_at && (
                          <span className="text-xs text-muted">
                            {t('crm.tag_last_added', { date: formatDate(ts.last_added_at) })}
                          </span>
                        )}
                      </div>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );

  // ----- Render: members carrying one tag -----

  const renderMembersView = () => (
    <>
      <div className="mb-4">
        <Button
          variant="tertiary"
          size="sm"
          startContent={<ArrowLeft size={16} />}
          onPress={backToSummary}
        >
          {t('crm.all_tags')}
        </Button>
      </div>

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Tag size={20} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold text-foreground [overflow-wrap:anywhere]">
              {t('crm.members_tagged_named', { tag: activeTag })}
            </h2>
            {!membersLoading && (
              <p className="text-sm text-muted" aria-live="polite">
                {t('crm.tagged_members_summary', { count: memberTags.length })}
              </p>
            )}
          </div>
        </div>
        {memberTags.length > 0 && (
          <Button
            variant="secondary"
            size="sm"
            startContent={<Trash2 size={14} />}
            className="shrink-0 self-start text-danger"
            onPress={() => setRemoveAllTarget({ tag: activeTag, count: memberTags.length })}
          >
            {t('crm.remove_from_all_members')}
          </Button>
        )}
      </div>

      {membersLoading && memberTags.length === 0 ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" label={t('crm.loading_members')} />
        </div>
      ) : memberTags.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('crm.no_members_with_tag')}
          description={t('crm.no_members_hint')}
          actionLabel={t('crm.all_tags')}
          onAction={backToSummary}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {memberTags.map((mt) => (
            <li key={mt.id}>
              <Card className="border border-divider/70 bg-surface shadow-sm shadow-black/[0.03]">
                <CardBody className="flex flex-row items-center gap-3 p-4 sm:gap-4">
                  <Avatar
                    src={mt.user_avatar || undefined}
                    name={memberName(mt)}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={tenantPath(`/admin/users/${mt.user_id}/edit`)}
                      className="block truncate font-semibold text-foreground transition-colors hover:text-accent"
                    >
                      {memberName(mt)}
                    </Link>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      <span>{t('crm.member_with_id', { id: mt.user_id })}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={mt.created_at}>
                        {mt.created_by_name
                          ? t('crm.tag_added_on_by', { date: formatDateTime(mt.created_at), name: mt.created_by_name })
                          : t('crm.tag_added_on', { date: formatDateTime(mt.created_at) })}
                      </time>
                    </p>
                  </div>
                  <Button
                    isIconOnly
                    size="sm"
                    variant="tertiary"
                    color="danger"
                    className="shrink-0"
                    onPress={() => setRemoveTarget(mt)}
                    aria-label={t('crm.remove_tag_from_member_aria', { name: memberName(mt) })}
                  >
                    <Trash2 size={16} />
                  </Button>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  // ----- Main -----

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t('crm.member_tags_title')}
        description={t('crm.member_tags_desc')}
        icon={<Tag size={20} />}
        actions={
          <>
            <Button
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={handleExport}
              isLoading={exporting}
              isDisabled={exporting}
            >
              {t('crm.export_tags')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openAddModal}>
              {viewMode === 'members' ? t('crm.tag_another_member') : t('crm.add_tag')}
            </Button>
          </>
        }
      />

      {viewMode === 'summary' ? renderSummaryView() : renderMembersView()}

      {/* Add tag */}
      <Modal isOpen={addModal.isOpen} onClose={addModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Tag size={20} />
            {t('crm.add_tag_title')}
          </ModalHeader>
          <ModalBody className="flex flex-col gap-4">
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
            {/* Existing tags are offered first so one idea does not end up
                spelled three ways; any other text becomes a new tag. */}
            <ComboBox<TagSummary>
              label={t('crm.label_tag')}
              placeholder={t('crm.placeholder_type_a_tag_name_or_select_from_suggestions')}
              description={t('crm.label_tag_help', { max: TAG_MAX_LENGTH })}
              isRequired
              allowsCustomValue
              allowsEmptyCollection
              menuTrigger="focus"
              useDefaultFilter
              items={tagSummaries}
              inputValue={formTag}
              onInputChange={setFormTag}
              onSelectionChange={(key) => { if (key != null) setFormTag(String(key)); }}
              renderEmptyState={() => (
                <div className="px-3 py-2 text-sm text-muted">{t('crm.tag_will_be_created')}</div>
              )}
            >
              {(ts: TagSummary) => (
                <ComboBoxItem
                  id={ts.tag}
                  textValue={ts.tag}
                  description={t('crm.tag_member_count', { count: Number(ts.member_count || 0) })}
                >
                  {ts.tag}
                </ComboBoxItem>
              )}
            </ComboBox>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={addModal.onClose} isDisabled={saving}>
              {t('crm.cancel_button')}
            </Button>
            <Button onPress={handleAddTag} isLoading={saving} isDisabled={saving}>
              {t('crm.add_tag')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Remove from one member */}
      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveFromMember}
        title={t('crm.remove_tag_title')}
        message={removeTarget
          ? t('crm.remove_tag_confirm_named', { tag: removeTarget.tag, name: memberName(removeTarget) })
          : ''}
        confirmLabel={t('crm.remove_button')}
        confirmColor="danger"
        isLoading={removing}
      />

      {/* Remove from everyone */}
      <ConfirmModal
        isOpen={!!removeAllTarget}
        onClose={() => setRemoveAllTarget(null)}
        onConfirm={handleRemoveFromAll}
        title={t('crm.remove_tag_all_title')}
        message={removeAllTarget
          ? t('crm.remove_tag_all_confirm_named', { tag: removeAllTarget.tag, count: removeAllTarget.count })
          : ''}
        confirmLabel={t('crm.remove_all_button')}
        confirmColor="danger"
        isLoading={removing}
      />
    </div>
  );
}

export default MemberTags;
