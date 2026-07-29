import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, Progress, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Separator } from '@/components/ui';
import CheckCircle2 from 'lucide-react/icons/check-circle-2';
import Info from 'lucide-react/icons/info';
import Pencil from 'lucide-react/icons/pencil';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Server from 'lucide-react/icons/server';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { Abbr } from '../../components/Abbr';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type ItemStatus = 'pending' | 'in_progress' | 'decided' | 'blocked';
type ItemType = 'enum' | 'text' | 'url' | 'choice';

interface DecisionItem {
  key: string;
  label_code: string;
  type: ItemType;
  choices: string[] | null;
  help_code: string;
  value: string | null;
  owner: string | null;
  status: ItemStatus;
  notes: string | null;
  updated_at: string | null;
}

interface GateStatus {
  closed: boolean;
  decided_count: number;
  total_count: number;
  blockers: string[];
  status_counts: Record<ItemStatus, number>;
}

interface GateResponse {
  items: DecisionItem[];
  gate: GateStatus;
  last_updated_at: string | null;
}

interface UpdateResponse {
  item: DecisionItem;
  gate: GateStatus;
}

const STATUS_OPTIONS: ItemStatus[] = ['pending', 'in_progress', 'decided', 'blocked'];

const STATUS_COLORS: Record<ItemStatus, 'default' | 'warning' | 'success' | 'danger'> = {
  pending: 'default',
  in_progress: 'warning',
  decided: 'success',
  blocked: 'danger',
};

interface DraftState {
  value: string;
  owner: string;
  status: ItemStatus;
  notes: string;
}

function buildDraft(item: DecisionItem): DraftState {
  return {
    value: item.value ?? '',
    owner: item.owner ?? '',
    status: item.status ?? 'pending',
    notes: item.notes ?? '',
  };
}

type AdminT = (key: string, options?: Record<string, unknown>) => string;

const itemLabel = (item: DecisionItem, t: AdminT) =>
  t(`isolated_node.items.${item.label_code}.label`);

const itemHelp = (item: DecisionItem, t: AdminT) =>
  t(`isolated_node.items.${item.help_code}.help`);

const renderValueChip = (item: DecisionItem, t: AdminT) => {
  if (!item.value) {
    return <span className="text-muted text-sm italic">—</span>;
  }
  if (item.type === 'enum' || item.type === 'choice') {
    return (
      <Chip size="sm" variant="soft">
        {t(`isolated_node.choices.${item.value}`)}
      </Chip>
    );
  }
  if (item.type === 'url') {
    return (
      <a
        href={item.value}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent text-sm underline break-all"
      >
        {item.value}
      </a>
    );
  }
  return <span className="text-sm break-words">{item.value}</span>;
};

export default function IsolatedNodeAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('isolated_node.meta.page_title'));
  const { showToast } = useToast();

  const [data, setData] = useState<GateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<GateResponse>('/v2/admin/caring-community/isolated-node');
      setData(res.data ?? null);
    } catch {
      showToast(t('isolated_node.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const editingItem = useMemo<DecisionItem | null>(() => {
    if (!data || !editingKey) return null;
    return data.items.find((it) => it.key === editingKey) ?? null;
  }, [data, editingKey]);

  const closeModal = () => {
    setEditingKey(null);
    setDraft(null);
  };

  const openEditor = (item: DecisionItem) => {
    setEditingKey(item.key);
    setDraft(buildDraft(item));
  };

  const save = async () => {
    if (!editingKey || !draft || !editingItem) return;
    setSaving(true);
    try {
      const payload: Record<string, string | null> = {
        value: draft.value === '' ? null : draft.value,
        owner: draft.owner === '' ? null : draft.owner,
        status: draft.status,
        notes: draft.notes === '' ? null : draft.notes,
      };
      const res = await api.put<UpdateResponse>(
        `/v2/admin/caring-community/isolated-node/items/${encodeURIComponent(editingKey)}`,
        payload,
      );
      if (!res.success) {
        // The API client returns a failed response instead of throwing, so the
        // catch block below never saw a rejected save: the success toast fired
        // regardless of the outcome, and the server's own refusal was dropped.
        // admin-i18n-ignore: localized server message — IsolatedNodeReadinessService
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        showToast(res.error || t('isolated_node.toasts.save_failed'), 'error');
        return;
      }
      const updatedItem = res.data?.item;
      const updatedGate = res.data?.gate;
      if (updatedItem && updatedGate && data) {
        setData({
          ...data,
          items: data.items.map((it) => (it.key === updatedItem.key ? updatedItem : it)),
          gate: updatedGate,
          last_updated_at: updatedItem.updated_at ?? data.last_updated_at,
        });
      }
      showToast(t('isolated_node.toasts.item_updated'), 'success');
      closeModal();
    } catch {
      showToast(t('isolated_node.toasts.save_failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const renderValueInput = () => {
    if (!editingItem || !draft) return null;
    if (editingItem.type === 'enum' || editingItem.type === 'choice') {
      return (
        <Select
          label={t('isolated_node.fields.value')}
          description={itemHelp(editingItem, t)}
          selectedKeys={draft.value ? [draft.value] : []}
          onSelectionChange={(keys) => {
            const next = Array.from(keys)[0];
            if (typeof next === 'string') {
              setDraft({ ...draft, value: next });
            }
          }}
        >
          {(editingItem.choices ?? []).map((opt) => (
            <SelectItem key={opt} id={opt}>{t(`isolated_node.choices.${opt}`)}</SelectItem>
          ))}
        </Select>
      );
    }

    if (editingItem.type === 'url') {
      return (
        <Input
          label={t('isolated_node.fields.value')}
          description={itemHelp(editingItem, t)}
          type="url"
          placeholder={t('isolated_node.fields.url_placeholder')}
          value={draft.value}
          onValueChange={(v) => setDraft({ ...draft, value: v })}
        />
      );
    }

    return (
      <Input
        label={t('isolated_node.fields.value')}
        description={itemHelp(editingItem, t)}
        value={draft.value}
        onValueChange={(v) => setDraft({ ...draft, value: v })}
      />
    );
  };

  const gate = data?.gate;
  const progressValue = gate && gate.total_count > 0 ? (gate.decided_count / gate.total_count) * 100 : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('isolated_node.meta.title')}
        subtitle={t('isolated_node.meta.subtitle')}
        icon={<Server size={20} />}
        actions={
          <Tooltip content={t('isolated_node.actions.refresh')}>
            <Button
              isIconOnly
              size="sm"
              variant="tertiary"
              onPress={load}
              isLoading={loading}
              aria-label={t('isolated_node.actions.refresh_aria')}
            >
              <RefreshCw size={15} />
            </Button>
          </Tooltip>
        }
      />

      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('isolated_node.about.title')}</p>
              <p className="text-muted">
                {t('isolated_node.about.body_prefix')} <Abbr term="NEXUS" /> {t('isolated_node.about.body_middle')}{' '}
                {t('common:nav.caring_community')} {t('isolated_node.about.body_suffix')}
              </p>
              <p className="text-muted">
                {t('isolated_node.about.workflow')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card className="border border-warning-300 bg-warning-50/50 dark:bg-warning-900/10" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-semibold text-warning-800 dark:text-warning-200">{t('isolated_node.warning.title')}</p>
              <p className="text-muted mt-0.5">
                {t('isolated_node.warning.body_prefix')} <Abbr term="NEXUS" /> {t('isolated_node.warning.body_suffix')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {loading && (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && data && gate && (
        <>
          <Card
            className={
              gate.closed
                ? 'border border-success-300 bg-success-50/50 dark:bg-success-900/10'
                : 'border border-warning-300 bg-warning-50/50 dark:bg-warning-900/10'
            }
          >
            <CardBody className="space-y-3 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {gate.closed ? (
                    <CheckCircle2 size={22} className="text-success" />
                  ) : (
                    <ShieldAlert size={22} className="text-warning" />
                  )}
                  <div>
                    <p className="text-base font-semibold">
                      {gate.closed
                        ? t('isolated_node.gate.closed')
                        : t('isolated_node.gate.open')}
                    </p>
                    <p className="text-sm text-muted">
                      {t('isolated_node.gate.decided_count', {
                        decided: gate.decided_count,
                        total: gate.total_count,
                      })}
                      {gate.blockers.length > 0
                        ? t('isolated_node.gate.blocked_count', { count: gate.blockers.length })
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Chip size="sm" variant="soft" color={STATUS_COLORS.pending}>
                    {t('isolated_node.status_counts.pending', { count: gate.status_counts.pending })}
                  </Chip>
                  <Chip size="sm" variant="soft" color={STATUS_COLORS.in_progress}>
                    {t('isolated_node.status_counts.in_progress', { count: gate.status_counts.in_progress })}
                  </Chip>
                  <Chip size="sm" variant="soft" color={STATUS_COLORS.decided}>
                    {t('isolated_node.status_counts.decided', { count: gate.status_counts.decided })}
                  </Chip>
                  <Chip size="sm" variant="soft" color={STATUS_COLORS.blocked}>
                    {t('isolated_node.status_counts.blocked', { count: gate.status_counts.blocked })}
                  </Chip>
                </div>
              </div>
              <Progress
                aria-label={t('isolated_node.gate.progress_aria')}
                value={progressValue}
                color={gate.closed ? 'success' : 'warning'}
                className="max-w-full"
              />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4">
            {data.items.map((item) => (
              <Card key={item.key} className="border border-[var(--color-border)]">
                <CardHeader className="flex flex-wrap items-start justify-between gap-3 pb-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-sm">{itemLabel(item, t)}</p>
                    <p className="text-xs text-muted mt-0.5">{itemHelp(item, t)}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status]}>
                      {t(`isolated_node.status.${item.status}`)}
                    </Chip>
                    <Button
                      size="sm"
                      variant="tertiary"
                      startContent={<Pencil size={13} />}
                      onPress={() => openEditor(item)}
                    >
                      {t('isolated_node.actions.edit')}
                    </Button>
                  </div>
                </CardHeader>
                <CardBody className="pt-0">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">{t('isolated_node.fields.value')}</p>
                      <div className="mt-1">{renderValueChip(item, t)}</div>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">{t('isolated_node.fields.owner')}</p>
                      <p className="mt-1">
                        {item.owner ? (
                          item.owner
                        ) : (
                          <span className="text-muted italic">{t('isolated_node.empty.unassigned')}</span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-wide text-muted">{t('isolated_node.fields.notes')}</p>
                      <p className="mt-1 whitespace-pre-wrap break-words">
                        {item.notes ? (
                          item.notes
                        ) : (
                          <span className="text-muted italic">{t('isolated_node.empty.none')}</span>
                        )}
                      </p>
                    </div>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          {data.last_updated_at && (
            <>
              <Separator />
              <p className="text-xs text-muted">
                {t('isolated_node.timestamps.last_updated', {
                  date: new Date(data.last_updated_at).toLocaleString(getFormattingLocale()),
                })}
              </p>
            </>
          )}
        </>
      )}

      <Modal isOpen={!!editingItem} onClose={closeModal} size="lg" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>{editingItem ? itemLabel(editingItem, t) : t('isolated_node.modal.edit_decision_item')}</span>
            <span className="text-xs font-normal text-muted">
              {t('isolated_node.modal.subtitle')}
            </span>
          </ModalHeader>
          <ModalBody>
            {editingItem && draft && (
              <div className="space-y-4">
                {renderValueInput()}
                <Input
                  label={t('isolated_node.fields.owner')}
                  description={t('isolated_node.fields.owner_description')}
                  value={draft.owner}
                  onValueChange={(v) => setDraft({ ...draft, owner: v })}
                />
                <Select
                  label={t('isolated_node.fields.status')}
                  selectedKeys={[draft.status]}
                  onSelectionChange={(keys) => {
                    const next = Array.from(keys)[0];
                    if (typeof next === 'string') {
                      setDraft({ ...draft, status: next as ItemStatus });
                    }
                  }}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt} id={opt}>{t(`isolated_node.status.${opt}`)}</SelectItem>
                  ))}
                </Select>
                <Textarea
                  label={t('isolated_node.fields.notes')}
                  description={t('isolated_node.fields.notes_description')}
                  minRows={3}
                  value={draft.notes}
                  onValueChange={(v) => setDraft({ ...draft, notes: v })}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeModal} isDisabled={saving}>
              {t('isolated_node.actions.cancel')}
            </Button>
            <Button onPress={save} isLoading={saving}>
              {t('isolated_node.actions.save_changes')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
