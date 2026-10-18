// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Outbound webhooks — the platform Integrations page.
 *
 * Moved here from the volunteering Settings page on 2026-10-18 (owner
 * decision). Only a god account that is also a platform super admin reaches
 * this page (GodPlatformRoute; the API enforces the same rule), so it can
 * manage any community's webhooks: the community picker at the top defaults
 * to the one the admin is in.
 *
 * What changed from the old tab, each for a reason:
 * - Events are a checklist of the six events the platform really sends, with
 *   plain-English labels, instead of a free-text box an admin could fill with
 *   names nothing fires (one community's webhook sat subscribed to twelve
 *   such names for seven months).
 * - The signing secret is shown ONCE, when the webhook is created or its
 *   secret is regenerated — the moment the receiving system is being set up.
 *   It was never shown before, so no receiver could verify a signature.
 * - "Send test" says what it does. The old failure-row "Retry" button only
 *   sent a test too; real failed deliveries are retried by the server with a
 *   cap, so the button is gone.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Plus from 'lucide-react/icons/plus';
import Edit2 from 'lucide-react/icons/pen';
import Trash2 from 'lucide-react/icons/trash-2';
import Webhook from 'lucide-react/icons/webhook';
import Play from 'lucide-react/icons/play';
import FileText from 'lucide-react/icons/file-text';
import KeyRound from 'lucide-react/icons/key-round';
import Search from 'lucide-react/icons/search';
import {
  Button,
  Card,
  CardBody,
  Checkbox,
  CheckboxGroup,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Snippet,
  Switch,
  useDisclosure,
} from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { adminIntegrations, adminSuper, type OutboundWebhook, type OutboundWebhookDelivery } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';

interface WebhookForm {
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
}

const emptyForm: WebhookForm = { name: '', url: '', events: [], is_active: true };

/**
 * The server names the rule a refused webhook broke with a code; the page shows
 * its own translated wording for it, never the server's text. An unknown code
 * falls back to the general "could not save" message.
 */
const REFUSAL_KEYS: Record<string, string> = {
  WEBHOOK_NAME_REQUIRED: 'name_url_required',
  WEBHOOK_URL_INVALID: 'error_url_invalid',
  WEBHOOK_URL_NOT_ALLOWED: 'error_url_not_allowed',
  WEBHOOK_EVENTS_REQUIRED: 'events_required',
  WEBHOOK_UNKNOWN_EVENT: 'error_unknown_event',
  WEBHOOK_FIELD_TOO_LONG: 'error_too_long',
};

/** `shift.completed` → `shift_completed`, the locale key token. */
const eventToken = (event: string) => event.replace(/[^a-zA-Z0-9]+/g, '_');

export default function OutboundWebhooks() {
  const { t } = useTranslation('admin_integrations');
  usePageTitle(t('page_title'));
  const toast = useToast();
  const { tenant } = useTenant();

  const [communities, setCommunities] = useState<Array<{ id: number; name: string }>>([]);
  const [communityId, setCommunityId] = useState<number | undefined>(tenant?.id);
  const [events, setEvents] = useState<string[]>([]);
  const [webhooks, setWebhooks] = useState<OutboundWebhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<WebhookForm>(emptyForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [rotateId, setRotateId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<OutboundWebhookDelivery[]>([]);
  const [deliveryFilter, setDeliveryFilter] = useState('');

  const { isOpen: isFormOpen, onOpen: onFormOpen, onClose: onFormClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const { isOpen: isRotateOpen, onOpen: onRotateOpen, onClose: onRotateClose } = useDisclosure();
  const { isOpen: isSecretOpen, onOpen: onSecretOpen, onClose: onSecretClose } = useDisclosure();
  const { isOpen: isDeliveriesOpen, onOpen: onDeliveriesOpen, onClose: onDeliveriesClose } = useDisclosure();

  const eventLabel = useCallback((event: string) => t(`events.${eventToken(event)}.label`, { defaultValue: event }), [t]);

  const loadWebhooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminIntegrations.getWebhooks(communityId);
      if (res.success && Array.isArray(res.data)) {
        setWebhooks(res.data);
      } else {
        setWebhooks([]);
      }
    } catch {
      toast.error(t('failed_to_load_webhooks'));
      setWebhooks([]);
    }
    setLoading(false);
  }, [communityId, toast, t]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [eventsRes, tenantsRes] = await Promise.all([
          adminIntegrations.getWebhookEvents(),
          adminSuper.listTenants(),
        ]);
        if (cancelled) return;
        if (eventsRes.success && Array.isArray(eventsRes.data)) setEvents(eventsRes.data);
        if (tenantsRes.success && Array.isArray(tenantsRes.data)) {
          setCommunities(tenantsRes.data.map((row) => ({ id: row.id, name: row.name })));
        }
      } catch {
        if (!cancelled) toast.error(t('failed_to_load_communities'));
      }
    })();
    return () => { cancelled = true; };
  }, [toast, t]);

  useEffect(() => { void loadWebhooks(); }, [loadWebhooks]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    onFormOpen();
  };

  const openEdit = (row: OutboundWebhook) => {
    setEditingId(row.id);
    setForm({ name: row.name, url: row.url, events: row.events ?? [], is_active: Boolean(row.is_active) });
    onFormOpen();
  };

  const showSecret = (secret: string) => {
    setRevealedSecret(secret);
    onSecretOpen();
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error(t('name_url_required'));
      return;
    }
    if (form.events.length === 0) {
      toast.error(t('events_required'));
      return;
    }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), url: form.url.trim(), events: form.events, is_active: form.is_active };
      if (editingId) {
        const res = await adminIntegrations.updateWebhook(editingId, payload, communityId);
        if (!res.success) {
          toast.error(t(REFUSAL_KEYS[res.errors?.[0]?.code ?? ''] ?? 'failed_to_save_webhook'));
          setSaving(false);
          return;
        }
        toast.success(t('webhook_updated'));
        onFormClose();
      } else {
        const res = await adminIntegrations.createWebhook(payload, communityId);
        if (!res.success || !res.data) {
          toast.error(t(REFUSAL_KEYS[res.errors?.[0]?.code ?? ''] ?? 'failed_to_save_webhook'));
          setSaving(false);
          return;
        }
        toast.success(t('webhook_created'));
        onFormClose();
        showSecret(res.data.secret);
      }
      void loadWebhooks();
    } catch {
      toast.error(t('failed_to_save_webhook'));
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await adminIntegrations.deleteWebhook(deleteId, communityId);
      if (!res.success) throw new Error();
      toast.success(t('webhook_deleted'));
      onDeleteClose();
      void loadWebhooks();
    } catch {
      toast.error(t('failed_to_delete_webhook'));
    }
  };

  const handleRotate = async () => {
    if (!rotateId) return;
    try {
      const res = await adminIntegrations.rotateWebhookSecret(rotateId, communityId);
      if (!res.success || !res.data) throw new Error();
      onRotateClose();
      showSecret(res.data.secret);
    } catch {
      toast.error(t('failed_to_rotate_secret'));
    }
  };

  // The request succeeding only means the server tried. Whether the receiving
  // system accepted the test is in the result, so report that.
  const handleTest = async (id: number) => {
    setTestingId(id);
    try {
      const res = await adminIntegrations.testWebhook(id, communityId);
      if (res.success && res.data?.success) {
        toast.success(t('test_sent'));
      } else {
        toast.error(t('test_failed'));
      }
    } catch {
      toast.error(t('test_failed'));
    }
    setTestingId(null);
  };

  const handleViewDeliveries = async (id: number) => {
    setDeliveryFilter('');
    try {
      const res = await adminIntegrations.getWebhookDeliveries(id, communityId);
      setDeliveries(res.success && Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error(t('failed_to_load_deliveries'));
      setDeliveries([]);
    }
    onDeliveriesOpen();
  };

  const filteredDeliveries = useMemo(() => {
    const needle = deliveryFilter.trim().toLowerCase();
    if (!needle) return deliveries;
    return deliveries.filter(
      (row) => row.event_type.toLowerCase().includes(needle) || String(row.response_code ?? '').includes(needle),
    );
  }, [deliveries, deliveryFilter]);

  const columns: Column<OutboundWebhook>[] = [
    { key: 'name', label: t('col_name'), sortable: true },
    {
      key: 'url',
      label: t('col_url'),
      render: (row) => <span className="block max-w-[250px] truncate font-mono text-sm">{row.url}</span>,
    },
    {
      key: 'events',
      label: t('col_events'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.events?.map((event) => (
            <Chip key={event} size="sm" variant="soft">{eventLabel(event)}</Chip>
          ))}
        </div>
      ),
    },
    {
      key: 'is_active',
      label: t('col_active'),
      render: (row) => (
        <Chip size="sm" color={row.is_active ? 'success' : 'default'} variant="soft">
          {row.is_active ? t('active') : t('inactive')}
        </Chip>
      ),
    },
    {
      key: 'failure_count',
      label: t('col_failures'),
      render: (row) => (
        <Chip size="sm" color={row.failure_count > 0 ? 'danger' : 'default'} variant="soft">
          {row.failure_count}
        </Chip>
      ),
    },
    {
      key: 'actions' as keyof OutboundWebhook,
      label: t('col_actions'),
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" isIconOnly onPress={() => openEdit(row)} aria-label={t('edit')}>
            <Edit2 size={14} />
          </Button>
          <Button size="sm" variant="secondary" isIconOnly isLoading={testingId === row.id} onPress={() => handleTest(row.id)} aria-label={t('send_test')}>
            <Play size={14} />
          </Button>
          <Button size="sm" variant="secondary" isIconOnly onPress={() => handleViewDeliveries(row.id)} aria-label={t('view_deliveries')}>
            <FileText size={14} />
          </Button>
          <Button size="sm" variant="secondary" isIconOnly onPress={() => { setRotateId(row.id); onRotateOpen(); }} aria-label={t('generate_secret')}>
            <KeyRound size={14} />
          </Button>
          <Button size="sm" variant="danger" isIconOnly onPress={() => { setDeleteId(row.id); onDeleteOpen(); }} aria-label={t('delete')}>
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('page_title')}
        description={t('page_desc')}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" startContent={<RefreshCw size={16} />} onPress={loadWebhooks} isLoading={loading}>
              {t('refresh')}
            </Button>
            <Button startContent={<Plus size={16} />} onPress={openCreate}>
              {t('add_webhook')}
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
        <Select
          label={t('community')}
          description={t('community_help')}
          size="sm"
          className="max-w-xs"
          selectedKeys={communityId ? [String(communityId)] : []}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0];
            setCommunityId(value ? Number(value) : undefined);
          }}
        >
          {communities.map((community) => (
            <SelectItem key={String(community.id)} id={String(community.id)}>{community.name}</SelectItem>
          ))}
        </Select>
      </div>

      {webhooks.length === 0 && !loading ? (
        <EmptyState icon={Webhook} title={t('no_webhooks')} description={t('no_webhooks_desc')} />
      ) : (
        <DataTable columns={columns} data={webhooks} isLoading={loading} />
      )}

      {/* Add / edit */}
      <Modal isOpen={isFormOpen} onClose={onFormClose} size="lg">
        <ModalContent>
          <ModalHeader>{editingId ? t('edit_webhook') : t('add_webhook')}</ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                label={t('webhook_name')}
                description={t('webhook_name_help')}
                value={form.name}
                onValueChange={(value) => setForm((current) => ({ ...current, name: value }))}
                isRequired
                variant="secondary"
              />
              <Input
                label={t('webhook_url')}
                value={form.url}
                onValueChange={(value) => setForm((current) => ({ ...current, url: value }))}
                isRequired
                variant="secondary"
                type="url"
                placeholder={t('webhook_url_placeholder')}
              />
              <CheckboxGroup
                label={t('events_heading')}
                description={t('events_help')}
                value={form.events}
                onValueChange={(value) => setForm((current) => ({ ...current, events: value }))}
              >
                {events.map((event) => (
                  <Checkbox key={event} value={event} description={t(`events.${eventToken(event)}.desc`, { defaultValue: '' })}>
                    {eventLabel(event)}
                  </Checkbox>
                ))}
              </CheckboxGroup>
              <Switch isSelected={form.is_active} onValueChange={(value) => setForm((current) => ({ ...current, is_active: value }))}>
                {t('webhook_active')}
              </Switch>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={onFormClose}>{t('cancel')}</Button>
            <Button onPress={handleSave} isLoading={saving}>
              {editingId ? t('save') : t('create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* The secret, shown once */}
      <Modal isOpen={isSecretOpen} onClose={onSecretClose} size="lg" isDismissable={false}>
        <ModalContent>
          <ModalHeader>{t('secret_title')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground">{t('secret_desc')}</p>
            {revealedSecret && (
              <Snippet codeString={revealedSecret} symbol="" size="sm">
                {revealedSecret}
              </Snippet>
            )}
          </ModalBody>
          <ModalFooter>
            <Button onPress={() => { setRevealedSecret(null); onSecretClose(); }}>{t('secret_copied_done')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={isRotateOpen}
        onClose={onRotateClose}
        onConfirm={handleRotate}
        title={t('generate_secret_title')}
        message={t('generate_secret_confirm')}
        confirmLabel={t('generate_secret_action')}
      />

      <ConfirmModal
        isOpen={isDeleteOpen}
        onClose={onDeleteClose}
        onConfirm={handleDelete}
        title={t('delete_webhook_title')}
        message={t('delete_webhook_confirm')}
        confirmLabel={t('delete')}
        confirmColor="danger"
      />

      {/* Deliveries */}
      <Modal isOpen={isDeliveriesOpen} onClose={onDeliveriesClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>{t('deliveries_title')}</ModalHeader>
          <ModalBody>
            {deliveries.length > 0 && (
              <Input
                placeholder={t('filter_deliveries')}
                aria-label={t('filter_deliveries')}
                value={deliveryFilter}
                onValueChange={setDeliveryFilter}
                variant="secondary"
                size="sm"
                startContent={<Search size={14} className="text-muted" />}
                className="mb-3"
                isClearable
                onClear={() => setDeliveryFilter('')}
              />
            )}
            {filteredDeliveries.length === 0 ? (
              <p className="py-8 text-center text-muted">
                {deliveries.length === 0 ? t('no_deliveries') : t('no_matching_deliveries')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredDeliveries.map((row) => (
                  <Card key={row.id} className="p-0">
                    <CardBody className="p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Chip size="sm" variant="soft">{eventLabel(row.event_type)}</Chip>
                          <Chip size="sm" color={row.status === 'success' ? 'success' : 'danger'} variant="soft">
                            {row.response_code || '-'}
                          </Chip>
                        </div>
                        <span className="text-xs text-muted">
                          {row.created_at ? new Date(row.created_at).toLocaleString(getFormattingLocale()) : '-'}
                        </span>
                      </div>
                      {row.response_body && (
                        <pre className="max-h-32 overflow-auto rounded bg-surface-secondary p-2 text-xs">{row.response_body}</pre>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={onDeliveriesClose}>{t('close')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
