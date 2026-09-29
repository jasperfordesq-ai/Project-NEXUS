import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Select, SelectItem, useDisclosure, Button, Chip, Spinner, Input, Textarea, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Separator } from '@/components/ui';
import Info from 'lucide-react/icons/info';
import PlugZap from 'lucide-react/icons/plug-zap';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import Plus from 'lucide-react/icons/plus';
import Sparkles from 'lucide-react/icons/sparkles';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { safeHref } from '@/lib/safeHref';

type IntegrationStatus =
  | 'proposed'
  | 'scoping'
  | 'blocked'
  | 'sandbox'
  | 'live'
  | 'deprecated';

type DsaStatus = 'not_required' | 'drafting' | 'in_review' | 'signed';

type IntegrationCategory =
  | 'banking'
  | 'payment'
  | 'identity_verification'
  | 'professional_care'
  | 'municipal_data'
  | 'postal'
  | 'ahv'
  | 'healthcare'
  | 'other';

interface Integration {
  id: string;
  copy_code?: string | null;
  name: string;
  category: IntegrationCategory;
  owner_name: string;
  owner_email: string;
  status: IntegrationStatus;
  interface_spec_url: string;
  dsa_status: DsaStatus;
  sandbox_url: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  items: Integration[];
  last_updated_at: string | null;
}

interface ItemResponse {
  item: Integration;
}

const STATUSES: IntegrationStatus[] = [
  'proposed',
  'scoping',
  'blocked',
  'sandbox',
  'live',
  'deprecated',
];

const DSA_STATUSES: DsaStatus[] = ['not_required', 'drafting', 'in_review', 'signed'];

const CATEGORIES: IntegrationCategory[] = [
  'banking',
  'payment',
  'identity_verification',
  'professional_care',
  'municipal_data',
  'postal',
  'ahv',
  'healthcare',
  'other',
];

const STATUS_COLOR: Record<
  IntegrationStatus,
  'default' | 'primary' | 'danger' | 'warning' | 'success' | 'secondary'
> = {
  proposed: 'default',
  scoping: 'primary',
  blocked: 'danger',
  sandbox: 'warning',
  live: 'success',
  deprecated: 'secondary',
};

const DSA_COLOR: Record<DsaStatus, 'default' | 'primary' | 'warning' | 'success'> = {
  not_required: 'default',
  drafting: 'primary',
  in_review: 'warning',
  signed: 'success',
};

interface FormState {
  name: string;
  category: IntegrationCategory;
  owner_name: string;
  owner_email: string;
  status: IntegrationStatus;
  interface_spec_url: string;
  dsa_status: DsaStatus;
  sandbox_url: string;
  notes: string;
}

function emptyForm(): FormState {
  return {
    name: '',
    category: 'other',
    owner_name: '',
    owner_email: '',
    status: 'proposed',
    interface_spec_url: '',
    dsa_status: 'not_required',
    sandbox_url: '',
    notes: '',
  };
}

function integrationCopy(
  item: Integration,
  field: 'name' | 'notes',
  t: TFunction,
): string {
  if (!item.copy_code) return item[field];

  return t(`external_integrations.default_items.${item.copy_code}.${field}`, {
    defaultValue: item[field],
  });
}

function fromIntegration(item: Integration, t: TFunction): FormState {
  return {
    name: integrationCopy(item, 'name', t),
    category: item.category,
    owner_name: item.owner_name,
    owner_email: item.owner_email,
    status: item.status,
    interface_spec_url: item.interface_spec_url,
    dsa_status: item.dsa_status,
    sandbox_url: item.sandbox_url,
    notes: integrationCopy(item, 'notes', t),
  };
}

export default function ExternalIntegrationsAdminPage(): ReactNode {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('external_integrations.meta.title'));
  const { showToast } = useToast();

  const [items, setItems] = useState<Integration[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const editModal = useDisclosure();
  const deleteModal = useDisclosure();

  const [editing, setEditing] = useState<Integration | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [target, setTarget] = useState<Integration | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListResponse>(
        '/v2/admin/caring-community/external-integrations',
      );
      if (res.success && res.data) {
        setItems(res.data.items ?? []);
        setLastUpdatedAt(res.data.last_updated_at ?? null);
      } else {
        setItems([]);
        setLastUpdatedAt(null);
      }
    } catch {
      showToast(t('external_integrations.toasts.load_failed'), 'error');
      setItems([]);
      setLastUpdatedAt(null);
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    editModal.onOpen();
  };

  const openEdit = (item: Integration) => {
    setEditing(item);
    setForm(fromIntegration(item, t));
    editModal.onOpen();
  };

  const openDelete = (item: Integration) => {
    setTarget(item);
    deleteModal.onOpen();
  };

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await api.post<ListResponse>(
        '/v2/admin/caring-community/external-integrations/seed-defaults',
        {},
      );
      if (res.success && res.data) {
        setItems(res.data.items ?? []);
        setLastUpdatedAt(res.data.last_updated_at ?? null);
        showToast(t('external_integrations.toasts.seeded'), 'success');
      } else {
        showToast(t('external_integrations.toasts.seed_failed'), 'error');
      }
    } catch {
      showToast(t('external_integrations.toasts.seed_failed'), 'error');
    } finally {
      setSeeding(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editing) {
        const res = await api.put<ItemResponse>(
          `/v2/admin/caring-community/external-integrations/${editing.id}`,
          form,
        );
        if (res.success && res.data?.item) {
          showToast(t('external_integrations.toasts.updated'), 'success');
          editModal.onClose();
          await load();
        } else {
          showToast(t('external_integrations.toasts.update_failed'), 'error');
        }
      } else {
        const res = await api.post<ItemResponse>(
          '/v2/admin/caring-community/external-integrations',
          form,
        );
        if (res.success && res.data?.item) {
          showToast(t('external_integrations.toasts.created'), 'success');
          editModal.onClose();
          await load();
        } else {
          showToast(t('external_integrations.toasts.create_failed'), 'error');
        }
      }
    } catch {
      showToast(editing ? t('external_integrations.toasts.update_failed') : t('external_integrations.toasts.create_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!target) return;
    setDeleting(true);
    try {
      const res = await api.delete(
        `/v2/admin/caring-community/external-integrations/${target.id}`,
      );
      if (res.success) {
        showToast(t('external_integrations.toasts.removed'), 'success');
        deleteModal.onClose();
        setTarget(null);
        await load();
      } else {
        showToast(t('external_integrations.toasts.delete_failed'), 'error');
      }
    } catch {
      showToast(t('external_integrations.toasts.delete_failed'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  const isFormValid = form.name.trim() !== '';

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('external_integrations.meta.title')}
        subtitle={t('external_integrations.meta.subtitle')}
        icon={<PlugZap size={24} />}
        actions={
          <>
            <Button
              size="sm"
              variant="secondary"
              startContent={<RefreshCw size={14} />}
              onPress={() => void load()}
              isLoading={loading}
            >
              {t('external_integrations.actions.refresh')}
            </Button>
            <Button
              size="sm"
              startContent={<Plus size={14} />}
              onPress={openCreate}
            >
              {t('external_integrations.actions.add')}
            </Button>
          </>
        }
      />

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('external_integrations.about.title')}</p>
              <p className="text-foreground">
                {t('external_integrations.about.body')}
              </p>
              <div className="space-y-0.5 pt-1 text-muted">
                <p><strong>{t('external_integrations.about.dsa_label')}</strong> {t('external_integrations.about.dsa_body')}</p>
                <p><strong>{t('external_integrations.about.sandbox_label')}</strong> {t('external_integrations.about.sandbox_body')}</p>
                <p><strong>{t('external_integrations.about.statuses_label')}</strong> {t('external_integrations.about.statuses_body')}</p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <Card>
          <CardBody>
            <div className="flex justify-center py-12">
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
            </div>
          </CardBody>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="rounded-full bg-surface-secondary p-4 text-muted">
                <PlugZap size={32} />
              </div>
              <div className="max-w-md space-y-1">
                <h3 className="text-base font-semibold">{t('external_integrations.empty.title')}</h3>
                <p className="text-sm text-muted">
                  {t('external_integrations.empty.body')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  startContent={<Sparkles size={14} />}
                  onPress={() => void handleSeed()}
                  isLoading={seeding}
                >
                  {t('external_integrations.actions.seed')}
                </Button>
                <Button
                  variant="secondary"
                  startContent={<Plus size={14} />}
                  onPress={openCreate}
                >
                  {t('external_integrations.actions.add')}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody>
            {lastUpdatedAt && (
              <p className="mb-3 text-xs text-muted">
                {t('external_integrations.last_updated', { date: new Date(lastUpdatedAt).toLocaleString(getFormattingLocale()) })}
              </p>
            )}
            <Table aria-label={t('external_integrations.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('external_integrations.table.name')}</TableColumn>
                <TableColumn>{t('external_integrations.table.category')}</TableColumn>
                <TableColumn>{t('external_integrations.table.owner')}</TableColumn>
                <TableColumn>{t('external_integrations.table.status')}</TableColumn>
                <TableColumn>{t('external_integrations.table.dsa')}</TableColumn>
                <TableColumn>{t('external_integrations.table.sandbox')}</TableColumn>
                <TableColumn>{t('external_integrations.table.updated')}</TableColumn>
                <TableColumn aria-label={t('external_integrations.table.row_actions')}>
                  {t('external_integrations.table.actions')}
                </TableColumn>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{integrationCopy(item, 'name', t)}</span>
                        {integrationCopy(item, 'notes', t) && (
                          <span className="line-clamp-1 max-w-md text-xs text-muted">
                            {integrationCopy(item, 'notes', t)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{t(`external_integrations.categories.${item.category}`)}</span>
                    </TableCell>
                    <TableCell>
                      {item.owner_name ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{item.owner_name}</span>
                          {item.owner_email && (
                            <span className="text-xs text-muted">
                              {item.owner_email}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={STATUS_COLOR[item.status]}
                        variant="soft"
                      >
                        {t(`external_integrations.statuses.${item.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="sm"
                        color={DSA_COLOR[item.dsa_status]}
                        variant="soft"
                      >
                        {t(`external_integrations.dsa_statuses.${item.dsa_status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {item.sandbox_url ? (
                        <a
                          href={safeHref(item.sandbox_url)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm text-accent underline"
                        >
                          {t('external_integrations.actions.open')}
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted">
                        {new Date(item.updated_at).toLocaleDateString(getFormattingLocale())}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={t('external_integrations.actions.edit')}
                          onPress={() => openEdit(item)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          isIconOnly
                          aria-label={t('external_integrations.actions.delete')}
                          onPress={() => openDelete(item)}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Modal
        isOpen={editModal.isOpen}
        onClose={editModal.onClose}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader>
            {editing
              ? t('external_integrations.editor.edit_title', { name: integrationCopy(editing, 'name', t) })
              : t('external_integrations.editor.add_title')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={t('external_integrations.editor.name')}
                placeholder={t('external_integrations.editor.name_placeholder')}
                variant="secondary"
                isRequired
                value={form.name}
                onValueChange={(v) => setForm({ ...form, name: v })}
              />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select
                  label={t('external_integrations.editor.category')}
                  variant="secondary"
                  selectedKeys={[form.category]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      category: (e.target.value || 'other') as IntegrationCategory,
                    })
                  }
                >
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c} id={c}>{t(`external_integrations.categories.${c}`)}</SelectItem>
                  ))}
                </Select>

                <Select
                  label={t('external_integrations.editor.status')}
                  variant="secondary"
                  selectedKeys={[form.status]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: (e.target.value || 'proposed') as IntegrationStatus,
                    })
                  }
                >
                  {STATUSES.map((s) => (
                    <SelectItem key={s} id={s}>{t(`external_integrations.statuses.${s}`)}</SelectItem>
                  ))}
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Input
                  label={t('external_integrations.editor.owner_name')}
                  placeholder={t('external_integrations.editor.owner_name_placeholder')}
                  variant="secondary"
                  value={form.owner_name}
                  onValueChange={(v) => setForm({ ...form, owner_name: v })}
                />
                <Input
                  label={t('external_integrations.editor.owner_email')}
                  type="email"
                  placeholder={t('external_integrations.editor.owner_email_placeholder')}
                  variant="secondary"
                  value={form.owner_email}
                  onValueChange={(v) => setForm({ ...form, owner_email: v })}
                />
              </div>

              <Input
                label={t('external_integrations.editor.interface_spec_url')}
                placeholder={t('external_integrations.editor.interface_spec_placeholder')}
                variant="secondary"
                value={form.interface_spec_url}
                onValueChange={(v) => setForm({ ...form, interface_spec_url: v })}
              />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Select
                  label={t('external_integrations.editor.dsa_status')}
                  variant="secondary"
                  selectedKeys={[form.dsa_status]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      dsa_status: (e.target.value || 'not_required') as DsaStatus,
                    })
                  }
                >
                  {DSA_STATUSES.map((d) => (
                    <SelectItem key={d} id={d}>{t(`external_integrations.dsa_statuses.${d}`)}</SelectItem>
                  ))}
                </Select>

                <Input
                  label={t('external_integrations.editor.sandbox_url')}
                  placeholder={t('external_integrations.editor.sandbox_placeholder')}
                  variant="secondary"
                  value={form.sandbox_url}
                  onValueChange={(v) => setForm({ ...form, sandbox_url: v })}
                />
              </div>

              <Textarea
                label={t('external_integrations.editor.notes')}
                placeholder={t('external_integrations.editor.notes_placeholder')}
                variant="secondary"
                minRows={3}
                value={form.notes}
                onValueChange={(v) => setForm({ ...form, notes: v })}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={editModal.onClose}>
              {t('external_integrations.actions.cancel')}
            </Button>
            <Button
              onPress={() => void handleSave()}
              isDisabled={!isFormValid}
              isLoading={saving}
            >
              {editing ? t('external_integrations.actions.save_changes') : t('external_integrations.actions.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={deleteModal.isOpen} onClose={deleteModal.onClose} size="md">
        <ModalContent>
          <ModalHeader>{t('external_integrations.delete_modal.title')}</ModalHeader>
          <ModalBody>
            {target ? (
              <div className="space-y-3">
                <p className="text-sm">
                  {t('external_integrations.delete_modal.body_prefix')}{' '}
                  <span className="font-semibold">{integrationCopy(target, 'name', t)}</span>.{' '}
                  {t('external_integrations.delete_modal.body_suffix')}
                </p>
                <Separator />
                <p className="text-xs text-muted">
                  {t('external_integrations.delete_modal.warning')}
                </p>
              </div>
            ) : null}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={deleteModal.onClose}>
              {t('external_integrations.actions.cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={() => void handleDelete()}
              isLoading={deleting}
            >
              {t('external_integrations.actions.remove')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
