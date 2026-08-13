import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Input, Chip, Spinner, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar } from '@/components/ui';
import { useState, useCallback, useEffect, useMemo } from 'react';

import Tag from 'lucide-react/icons/tag';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useTenant, useToast } from '@/contexts';
import { adminCrm } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Member Tags
 * Admin CRM page for managing member tags.
 * Supports tag summary view, per-tag member drill-down, add/remove tags, * and autocomplete from existing tags.
 */


interface MemberTag {
  id: number;
  tenant_id: number;
  user_id: number;
  tag: string;
  created_by: number;
  created_at: string;
  user_name?: string;
  user_avatar?: string | null;
}

interface TagSummary {
  tag: string;
  member_count: number;
}

type ViewMode = 'summary' | 'members';

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

export function MemberTags() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_crm');
  useAdminPageMeta({ title: tNav('crm') });
  const { tenantPath } = useTenant();
  const toast = useToast();

  // View state
  const [viewMode, setViewMode] = useState<ViewMode>('summary');
  const [activeTag, setActiveTag] = useState<string>('');

  // Summary state
  const [tagSummaries, setTagSummaries] = useState<TagSummary[]>([]);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summarySearch, setSummarySearch] = useState('');

  // Members state (when viewing a specific tag)
  const [memberTags, setMemberTags] = useState<MemberTag[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Add tag modal state
  const addModal = useDisclosure();
  const [formUserId, setFormUserId] = useState('');
  const [formMember, setFormMember] = useState<MemberSearchMember | null>(null);
  const [formTag, setFormTag] = useState('');
  const [formTagSearch, setFormTagSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<MemberTag | null>(null);
  const [deleteSummaryTarget, setDeleteSummaryTarget] = useState<TagSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ----- Data loading -----

  const loadTagSummaries = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const res = await adminCrm.getTags();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setTagSummaries(payload as TagSummary[]);
        }
      }
    } catch {
      setTagSummaries([]);
    }
    setSummaryLoading(false);
  }, []);

  const loadMembersByTag = useCallback(async (tag: string) => {
    setMembersLoading(true);
    try {
      const res = await adminCrm.getTags({ tag });
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setMemberTags(payload as MemberTag[]);
        }
      }
    } catch {
      setMemberTags([]);
    }
    setMembersLoading(false);
  }, []);

  useEffect(() => {
    loadTagSummaries();
  }, [loadTagSummaries]);

  // ----- Navigation -----

  const openTagMembers = (tag: string) => {
    setActiveTag(tag);
    setViewMode('members');
    loadMembersByTag(tag);
  };

  const backToSummary = () => {
    setViewMode('summary');
    setActiveTag('');
    setMemberTags([]);
    loadTagSummaries();
  };

  // ----- Add Tag -----

  const openAddModal = () => {
    setFormUserId('');
    setFormMember(null);
    setFormTag('');
    setFormTagSearch('');
    addModal.onOpen();
  };

  const handleAddTag = async () => {
    if (!formUserId || isNaN(Number(formUserId))) {
      toast.error(t('crm.valid_user_id_required'));
      return;
    }
    const tagValue = formTag.trim() || formTagSearch.trim();
    if (!tagValue) {
      toast.error(t('crm.tag_name_is_required'));
      return;
    }
    setSaving(true);
    try {
      const res = await adminCrm.addTag({
        user_id: Number(formUserId),
        tag: tagValue,
      });
      if (res.success) {
        toast.success(t('crm.tag_added'));
        addModal.onClose();
        if (viewMode === 'members' && tagValue === activeTag) {
          loadMembersByTag(activeTag);
        } else {
          loadTagSummaries();
        }
      } else {
        toast.error(t('crm.failed_to_add_tag'));
      }
    } catch {
      toast.error(t('crm.failed_to_add_tag'));
    }
    setSaving(false);
  };

  // ----- Delete Member Tag -----

  const handleDeleteMemberTag = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminCrm.removeTag(deleteTarget.id);
      if (res.success) {
        toast.success(t('crm.tag_removed_from_member'));
        setDeleteTarget(null);
        if (viewMode === 'members') {
          loadMembersByTag(activeTag);
        }
        loadTagSummaries();
      } else {
        toast.error(t('crm.failed_to_remove_tag'));
      }
    } catch {
      toast.error(t('crm.failed_to_remove_tag'));
    }
    setDeleting(false);
  };

  // ----- Delete entire tag (all members) -----

  const handleDeleteSummaryTag = async () => {
    if (!deleteSummaryTarget) return;
    setDeleting(true);
    try {
      const res = await adminCrm.bulkRemoveTag(deleteSummaryTarget.tag);
      if (res.success) {
        toast.success(t('crm.tag_removed_all'));
        setDeleteSummaryTarget(null);
        loadTagSummaries();
      } else {
        toast.error(t('crm.failed_to_remove_tag'));
      }
    } catch {
      toast.error(t('crm.failed_to_remove_tag'));
    }
    setDeleting(false);
  };

  // ----- Filtered data -----

  const filteredSummaries = useMemo(() => {
    if (!summarySearch.trim()) return tagSummaries;
    const query = summarySearch.toLowerCase().trim();
    return tagSummaries.filter(ts => ts.tag.toLowerCase().includes(query));
  }, [tagSummaries, summarySearch]);

  // Autocomplete suggestions for the add modal
  const tagSuggestions = useMemo(() => {
    if (!formTagSearch.trim()) return [];
    const query = formTagSearch.toLowerCase().trim();
    return tagSummaries
      .filter(ts => ts.tag.toLowerCase().includes(query))
      .slice(0, 8);
  }, [tagSummaries, formTagSearch]);

  // ----- Render: Summary View -----

  const renderSummaryView = () => (
    <>
      {/* Search */}
      <div className="flex flex-wrap items-end gap-3 mb-6">
        <Input
          label={t('crm.label_search_tags')}
          placeholder={t('crm.placeholder_filter_by_tag_name')}
          className="w-64"
          size="sm"
          startContent={<Search size={14} />}
          value={summarySearch}
          onValueChange={setSummarySearch}
        />
        {summarySearch && (
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => setSummarySearch('')}
          >
            {t('crm.clear')}
          </Button>
        )}
      </div>

      {/* Tag Grid */}
      {summaryLoading ? (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('crm.loading_tags')} /></div>
        </div>
      ) : filteredSummaries.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center py-16 text-center">
            <Tag size={48} className="text-muted mb-4" />
            <p className="text-muted text-lg font-medium">{t('crm.no_tags_found')}</p>
            <p className="text-muted text-sm mt-1">
              {summarySearch
                ? t('crm.no_tags_hint_search')
                : t('crm.no_tags_hint_default')}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filteredSummaries.map(ts => (
            <Card
              key={ts.tag}
              isPressable
              onPress={() => openTagMembers(ts.tag)}
              className="hover:border-accent transition-colors"
            >
              <CardHeader className="flex items-center justify-between pb-1">
                <div className="flex items-center gap-2 min-w-0">
                  <Tag size={16} className="text-accent shrink-0" />
                  <span className="font-semibold text-foreground truncate">{ts.tag}</span>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  color="danger"
                  onPress={() => {
                    setDeleteSummaryTarget(ts);
                  }}
                  aria-label={t('crm.delete_tag_aria', { tag: ts.tag })}
                >
                  <Trash2 size={14} />
                </Button>
              </CardHeader>
              <CardBody className="pt-0">
                <div className="flex items-center gap-2">
                  <Users size={14} className="text-muted" />
                  <Chip size="sm" variant="soft">
                    {ts.member_count === 1 ? t('crm.member_count') : t('crm.members_count')}
                  </Chip>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );

  // ----- Render: Members View -----

  const renderMembersView = () => (
    <>
      {/* Back button */}
      <div className="mb-4">
        <Button
          variant="tertiary"
          startContent={<ArrowLeft size={16} />}
          onPress={backToSummary}
        >
          {t('crm.back_to_all_tags')}
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <Tag size={20} className="text-accent" />
        <h2 className="text-xl font-semibold">
          {t('crm.members_tagged')} &ldquo;{activeTag}&rdquo;
        </h2>
      </div>

      {membersLoading ? (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('crm.loading_members')} /></div>
        </div>
      ) : memberTags.length === 0 ? (
        <Card>
          <CardBody className="flex flex-col items-center py-16 text-center">
            <Users size={48} className="text-muted mb-4" />
            <p className="text-muted text-lg font-medium">{t('crm.no_members_with_tag')}</p>
            <p className="text-muted text-sm mt-1">
              {t('crm.no_members_hint')}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {memberTags.map(mt => (
            <Card key={mt.id}>
              <CardBody className="flex flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar
                    src={mt.user_avatar || undefined}
                    name={mt.user_name || t('crm.user_with_id', { id: mt.user_id })}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <Link
                      to={tenantPath(`/admin/users/${mt.user_id}/edit`)}
                      className="font-semibold text-foreground hover:text-accent transition-colors truncate block"
                    >
                      {mt.user_name || t('crm.user_with_id', { id: mt.user_id })}
                    </Link>
                    <p className="text-xs text-muted">
                      {t('crm.user_with_id', { id: mt.user_id })}
                    </p>
                  </div>
                  <Chip size="sm" variant="soft">
                    <Tag size={12} />
                    {mt.tag}
                  </Chip>
                  <span className="text-xs text-muted hidden sm:inline">
                    {formatDate(mt.created_at)}
                  </span>
                </div>
                <Button
                  isIconOnly
                  size="sm"
                  variant="tertiary"
                  color="danger"
                  onPress={() => setDeleteTarget(mt)}
                  aria-label={t('crm.remove_tag_from_member_aria', {
                    name: mt.user_name || t('crm.user_with_id', { id: mt.user_id }),
                  })}
                >
                  <Trash2 size={16} />
                </Button>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );

  // ----- Main Render -----

  return (
    <div className="max-w-6xl mx-auto">
      <PageHeader
        title={t('crm.member_tags_title')}
        description={t('crm.member_tags_desc')}
        actions={
          <Button startContent={<Plus size={16} />} onPress={openAddModal}>
            {t('crm.add_tag')}
          </Button>
        }
      />

      {viewMode === 'summary' ? renderSummaryView() : renderMembersView()}

      {/* Add Tag Modal */}
      <Modal isOpen={addModal.isOpen} onClose={addModal.onClose} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Tag size={20} />
            {t('crm.add_tag')}
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
            <div className="flex flex-col gap-2">
              <Input
                label={t('crm.label_tag')}
                placeholder={t('crm.placeholder_type_a_tag_name_or_select_from_suggestions')}
                isRequired
                value={formTag || formTagSearch}
                onValueChange={(val) => {
                  setFormTag('');
                  setFormTagSearch(val);
                }}
              />
              {tagSuggestions.length > 0 && !formTag && (
                <div className="flex flex-wrap gap-2">
                  {tagSuggestions.map(ts => (
                    <Chip
                      key={ts.tag}
                      variant="soft"
                      className="cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => {
                        setFormTag(ts.tag);
                        setFormTagSearch('');
                      }}
                    >
                      {ts.tag} ({ts.member_count})
                    </Chip>
                  ))}
                </div>
              )}
            </div>
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

      {/* Delete Member Tag Confirmation */}
      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteMemberTag}
        title={t('crm.remove_tag_title')}
        message={t('crm.remove_tag_confirm')}
        confirmLabel={t('crm.remove_button')}
        confirmColor="danger"
        isLoading={deleting}
      />

      {/* Delete Summary Tag Confirmation */}
      <ConfirmModal
        isOpen={!!deleteSummaryTarget}
        onClose={() => setDeleteSummaryTarget(null)}
        onConfirm={handleDeleteSummaryTag}
        title={t('crm.remove_tag_all_title')}
        message={t('crm.remove_tag_all_confirm')}
        confirmLabel={t('crm.remove_all_button')}
        confirmColor="danger"
        isLoading={deleting}
      />
    </div>
  );
}

export default MemberTags;
