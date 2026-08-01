// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Challenges Admin
 *
 * Full CRUD over admin-defined challenges. Members could always view and claim
 * these (on both frontends); this page is the first place an admin can create
 * one without a database console. The action_type choices come from the server
 * (ChallengeService::SUPPORTED_ACTION_TYPES) because only actions wired through
 * EngagementService ever advance progress — offering any other XP action would
 * create challenges stuck at zero.
 */

import { useState, useCallback, useEffect } from 'react';
import Trophy from 'lucide-react/icons/trophy';
import Plus from 'lucide-react/icons/plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminGamification, type AdminChallenge, type AdminChallengePayload } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { EmptyState } from '../../components/EmptyState';
import {
  Button,
  Chip,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Textarea,
} from '@/components/ui';

interface ChallengeFormData {
  title: string;
  description: string;
  challenge_type: AdminChallenge['challenge_type'];
  action_type: string;
  target_count: string;
  xp_reward: string;
  start_date: string;
  end_date: string;
  is_active: boolean;
}

const emptyForm = (): ChallengeFormData => ({
  title: '',
  description: '',
  challenge_type: 'weekly',
  action_type: '',
  target_count: '1',
  xp_reward: '50',
  start_date: '',
  end_date: '',
  is_active: true,
});

function ChallengeActionsMenu({ item, t, onEdit, onDelete }: {
  item: AdminChallenge;
  t: (key: string, options?: Record<string, unknown>) => string;
  onEdit: (item: AdminChallenge) => void;
  onDelete: (item: AdminChallenge) => void;
}) {
  return (
    <Dropdown>
      <DropdownTrigger>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('challenges.label_actions', { title: item.title })}>
          <MoreVertical size={16} />
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t('challenges.label_actions', { title: item.title })}
        onAction={(key) => {
          if (key === 'edit') onEdit(item);
          if (key === 'delete') onDelete(item);
        }}
      >
        <DropdownItem key="edit" id="edit" startContent={<Edit size={14} />}>
          {t('challenges.edit')}
        </DropdownItem>
        <DropdownItem key="delete" id="delete" startContent={<Trash2 size={14} />} className="text-danger" variant="danger">
          {t('challenges.delete')}
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}

export function ChallengesAdmin() {
  const { t } = useTranslation('admin_gamification');
  usePageTitle(t('challenges.page_title'));
  const toast = useToast();

  const [items, setItems] = useState<AdminChallenge[]>([]);
  const [actionTypes, setActionTypes] = useState<string[]>([]);
  const [challengeTypes, setChallengeTypes] = useState<string[]>(['daily', 'weekly', 'monthly', 'special']);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<AdminChallenge | null>(null);
  const [formData, setFormData] = useState<ChallengeFormData>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<AdminChallenge | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminGamification.listChallenges({ limit: 100 });
      if (res.success && res.data) {
        setItems(res.data.challenges);
        setActionTypes(res.data.supported_action_types);
        if (res.data.challenge_types?.length) setChallengeTypes(res.data.challenge_types);
      } else {
        setItems([]);
      }
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  const openCreateModal = () => {
    setEditingItem(null);
    setFormData(emptyForm());
    setModalOpen(true);
  };

  const openEditModal = (item: AdminChallenge) => {
    setEditingItem(item);
    setFormData({
      title: item.title,
      description: item.description ?? '',
      challenge_type: item.challenge_type,
      action_type: item.action_type,
      target_count: String(item.target_count),
      xp_reward: String(item.xp_reward),
      start_date: item.start_date?.slice(0, 10) ?? '',
      end_date: item.end_date?.slice(0, 10) ?? '',
      is_active: Boolean(item.is_active),
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    setFormData(emptyForm());
  };

  const formValid = formData.title.trim() !== ''
    && formData.action_type !== ''
    && formData.start_date !== ''
    && formData.end_date !== ''
    && formData.end_date >= formData.start_date
    && Number(formData.target_count) >= 1;

  const handleSave = async () => {
    if (!formValid) {
      toast.error(t('challenges.form_invalid'));
      return;
    }

    const payload: AdminChallengePayload = {
      title: formData.title.trim(),
      description: formData.description.trim() !== '' ? formData.description.trim() : null,
      challenge_type: formData.challenge_type,
      action_type: formData.action_type,
      target_count: Math.max(1, Number(formData.target_count) || 1),
      xp_reward: Math.min(1000, Math.max(0, Number(formData.xp_reward) || 0)),
      start_date: formData.start_date,
      end_date: formData.end_date,
      is_active: formData.is_active,
    };

    setSaving(true);
    const res = editingItem
      ? await adminGamification.updateChallenge(editingItem.id, payload)
      : await adminGamification.createChallenge(payload);

    if (res.success) {
      toast.success(t(editingItem ? 'challenges.updated' : 'challenges.created'));
      closeModal();
      await loadData();
    } else {
      toast.error(t('challenges.save_failed'));
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);

    const res = await adminGamification.deleteChallenge(deleteTarget.id);
    if (res.success) {
      toast.success(t('challenges.deleted'));
      setDeleteTarget(null);
      await loadData();
    } else {
      toast.error(t('challenges.delete_failed'));
    }
    setDeleting(false);
  };

  const columns: Column<AdminChallenge>[] = [
    {
      key: 'title',
      label: t('challenges.col_title'),
      sortable: true,
      render: (item) => <span className="font-medium text-foreground">{item.title}</span>,
    },
    {
      key: 'action_type',
      label: t('challenges.col_action'),
      render: (item) => (
        <Chip size="sm" variant="soft">{t(`challenges.action_${item.action_type}`)}</Chip>
      ),
    },
    {
      key: 'challenge_type',
      label: t('challenges.col_cadence'),
      sortable: true,
      render: (item) => <span className="text-sm text-muted">{t(`challenges.type_${item.challenge_type}`)}</span>,
    },
    {
      key: 'target_count',
      label: t('challenges.col_target'),
      render: (item) => <span className="text-sm tabular-nums">{item.target_count}</span>,
    },
    {
      key: 'xp_reward',
      label: t('challenges.col_reward'),
      render: (item) => <span className="text-sm tabular-nums">{item.xp_reward} XP</span>,
    },
    {
      key: 'end_date',
      label: t('challenges.col_window'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.start_date?.slice(0, 10)} → {item.end_date?.slice(0, 10)}
        </span>
      ),
    },
    {
      key: 'is_active',
      label: t('challenges.col_status'),
      render: (item) => (
        <Chip size="sm" variant="soft" color={item.is_active ? 'success' : 'default'}>
          {item.is_active ? t('challenges.active') : t('challenges.inactive')}
        </Chip>
      ),
    },
    {
      key: 'actions',
      label: t('challenges.col_actions'),
      render: (item) => (
        <ChallengeActionsMenu item={item} t={t} onEdit={openEditModal} onDelete={setDeleteTarget} />
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('challenges.title')}
        description={t('challenges.desc')}
        icon={<Trophy size={22} />}
        actions={
          <div className="flex gap-2">
            <Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={() => void loadData()} isLoading={loading}>
              {t('challenges.refresh')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openCreateModal}>{t('challenges.create')}</Button>
          </div>
        }
      />

      {items.length === 0 && !loading ? (
        <EmptyState
          icon={Trophy}
          title={t('challenges.empty_title')}
          description={t('challenges.empty_desc')}
          actionLabel={t('challenges.create')}
          onAction={openCreateModal}
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={loading}
          searchPlaceholder={t('challenges.search')}
          onRefresh={() => void loadData()}
          emptyContent={t('challenges.empty_title')}
        />
      )}

      <Modal isOpen={modalOpen} onClose={closeModal} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Trophy size={20} aria-hidden="true" />
            {editingItem ? t('challenges.edit_title') : t('challenges.create')}
          </ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label={t('challenges.form_title')}
              value={formData.title}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, title: v }))}
              isRequired
              variant="secondary"
              autoFocus
            />
            <Textarea
              label={t('challenges.form_description')}
              value={formData.description}
              onValueChange={(v) => setFormData((prev) => ({ ...prev, description: v }))}
              minRows={2}
              variant="secondary"
            />
            <Select
              label={t('challenges.form_action')}
              description={t('challenges.form_action_desc')}
              selectedKeys={formData.action_type ? new Set([formData.action_type]) : new Set()}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0] as string | undefined;
                if (selected) setFormData((prev) => ({ ...prev, action_type: selected }));
              }}
              isRequired
              variant="secondary"
            >
              {actionTypes.map((action) => (
                <SelectItem key={action} id={action}>
                  {t(`challenges.action_${action}`)}
                </SelectItem>
              ))}
            </Select>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Select
                label={t('challenges.form_cadence')}
                selectedKeys={new Set([formData.challenge_type])}
                onSelectionChange={(keys) => {
                  const selected = Array.from(keys)[0] as AdminChallenge['challenge_type'] | undefined;
                  if (selected) setFormData((prev) => ({ ...prev, challenge_type: selected }));
                }}
                variant="secondary"
              >
                {challengeTypes.map((type) => (
                  <SelectItem key={type} id={type}>{t(`challenges.type_${type}`)}</SelectItem>
                ))}
              </Select>
              <Input
                label={t('challenges.form_target')}
                type="number"
                min={1}
                value={formData.target_count}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, target_count: v }))}
                variant="secondary"
              />
              <Input
                label={t('challenges.form_xp')}
                type="number"
                min={0}
                max={1000}
                value={formData.xp_reward}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, xp_reward: v }))}
                variant="secondary"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label={t('challenges.form_start')}
                type="date"
                value={formData.start_date}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, start_date: v }))}
                isRequired
                variant="secondary"
              />
              <Input
                label={t('challenges.form_end')}
                type="date"
                value={formData.end_date}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, end_date: v }))}
                isRequired
                variant="secondary"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{t('challenges.active')}</p>
                <p className="text-sm text-muted">{t('challenges.form_active_desc')}</p>
              </div>
              <Switch
                isSelected={formData.is_active}
                onValueChange={(v) => setFormData((prev) => ({ ...prev, is_active: v }))}
                aria-label={t('challenges.active')}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeModal} isDisabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="save-challenge"
              onPress={() => void handleSave()}
              isLoading={saving}
              isDisabled={saving || !formValid}
            >
              {editingItem ? t('challenges.save') : t('challenges.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {deleteTarget && (
        <ConfirmModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title={t('challenges.delete_title')}
          message={t('challenges.delete_confirm', { title: deleteTarget.title })}
          confirmLabel={t('challenges.delete')}
          confirmColor="danger"
          isLoading={deleting}
        />
      )}
    </div>
  );
}

export default ChallengesAdmin;
