// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Input, Textarea, Card, CardBody, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tab, Tabs } from '@/components/ui';

/**
 * Volunteer Configuration
 * Tabbed page: Reminder emails (what was sent), Webhooks.
 *
 * A Custom Fields tab lived here until 17 Oct 2026 (nothing ever used it).
 * The reminder SETTINGS moved into the Module Configuration window on
 * 18 Oct 2026 so every volunteering setting is edited in one place; the
 * Reminders tab here now shows the delivery log only.
 */

import { useState, useCallback, useEffect } from 'react';

import RefreshCw from 'lucide-react/icons/refresh-cw';
import Plus from 'lucide-react/icons/plus';
import Edit2 from 'lucide-react/icons/pen';
import Trash2 from 'lucide-react/icons/trash-2';
import Webhook from 'lucide-react/icons/webhook';
import Bell from 'lucide-react/icons/bell';
import Play from 'lucide-react/icons/play';
import FileText from 'lucide-react/icons/file-text';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Search from 'lucide-react/icons/search';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';
import { ReminderEmailsPanel } from './ReminderEmailsPanel';

// ─── Webhook types ─────────────────────────────────────────────────────────────

interface WebhookEntry {
  id: number;
  name: string;
  url: string;
  events: string[];
  is_active: boolean;
  failure_count: number;
  created_at: string;
}

// Column names of outbound_webhook_logs, as the server returns them.
interface WebhookLog {
  id: number;
  webhook_id: number;
  event_type: string;
  response_code: number | null;
  response_body: string | null;
  status: string;
  created_at: string;
}

interface WebhookTestResult {
  success: boolean;
  http_code: number;
  response: string;
}

const emptyWebhookForm = {
  name: '',
  url: '',
  events: '',
  is_active: true,
};

// ─── Main component ────────────────────────────────────────────────────────────

export default function VolunteerConfig() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.config_title'));

  const [activeTab, setActiveTab] = useState('reminders');

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.config_title')}
        description={t('volunteering.config_desc')}
      />

      <Tabs
        aria-label={t('volunteering.config_tabs_aria')}
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(String(key))}
        variant="underlined"
        classNames={{
          tabList: 'rounded-2xl border border-divider/70 bg-surface p-1 shadow-sm shadow-black/[0.03]',
          cursor: 'rounded-xl',
        }}
      >
        <Tab
          key="reminders"
          title={
            <div className="flex items-center gap-2">
              <Bell size={16} />
              {t('volunteering.tab_reminders')}
            </div>
          }
        >
          <RemindersTab />
        </Tab>
        <Tab
          key="webhooks"
          title={
            <div className="flex items-center gap-2">
              <Webhook size={16} />
              {t('volunteering.tab_webhooks')}
            </div>
          }
        >
          <WebhooksTab />
        </Tab>
      </Tabs>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 1: Reminder emails
// ─────────────────────────────────────────────────────────────────────────────
//
// The five reminder SETTINGS moved into the Module Configuration window on
// 2026-10-18 (sidebar: Volunteering → Settings), beside every other
// volunteering setting. This tab keeps the operational half: what has been
// sent, and the super-admin "run due reminders now" button.

function RemindersTab() {
  return <ReminderEmailsPanel />;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tab 2: Webhooks
// ─────────────────────────────────────────────────────────────────────────────

function WebhooksTab() {
  const { t } = useTranslation('admin_volunteering');
  const toast = useToast();

  const [webhooks, setWebhooks] = useState<WebhookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState(emptyWebhookForm);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [, setLogsWebhookId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [logFilter, setLogFilter] = useState('');

  const { isOpen, onOpen, onClose } = useDisclosure();
  const { isOpen: isDeleteOpen, onOpen: onDeleteOpen, onClose: onDeleteClose } = useDisclosure();
  const { isOpen: isLogsOpen, onOpen: onLogsOpen, onClose: onLogsClose } = useDisclosure();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getWebhooks();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setWebhooks(payload);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setWebhooks((payload as { data: WebhookEntry[] }).data || []);
        }
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_webhooks'));
      setWebhooks([]);
    }
    setLoading(false);
  }, [toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyWebhookForm);
    onOpen();
  };

  const openEdit = (wh: WebhookEntry) => {
    setEditingId(wh.id);
    setForm({
      name: wh.name,
      url: wh.url,
      events: wh.events?.join(', ') || '',
      is_active: wh.is_active,
    });
    onOpen();
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.url.trim()) {
      toast.error(t('volunteering.webhook_name_url_required'));
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        url: form.url.trim(),
        events: form.events.split(',').map((e) => e.trim()).filter(Boolean),
        is_active: form.is_active,
      };
      if (editingId) {
        const res = await adminVolunteering.updateWebhook(editingId, payload);
        if (!res.success) throw new Error();
        toast.success(t('volunteering.webhook_updated'));
      } else {
        const res = await adminVolunteering.createWebhook(payload);
        if (!res.success) throw new Error();
        toast.success(t('volunteering.webhook_created'));
      }
      onClose();
      loadData();
    } catch {
      toast.error(t('volunteering.failed_to_save_webhook'));
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const res = await adminVolunteering.deleteWebhook(deleteId);
      if (!res.success) throw new Error();
      toast.success(t('volunteering.webhook_deleted'));
      onDeleteClose();
      loadData();
    } catch {
      toast.error(t('volunteering.failed_to_delete_webhook'));
    }
  };

  // The request succeeding only means the server tried. Whether the receiving
  // system accepted the test is in the result, so report that.
  const sendTest = async (id: number) => {
    try {
      const res = await adminVolunteering.testWebhook(id);
      const result = res.data as WebhookTestResult | undefined;
      if (res.success && result?.success) {
        toast.success(t('volunteering.webhook_test_sent'));
      } else {
        toast.error(t('volunteering.webhook_test_failed'));
      }
    } catch {
      toast.error(t('volunteering.webhook_test_failed'));
    }
  };

  const handleTest = async (id: number) => {
    setTestingId(id);
    await sendTest(id);
    setTestingId(null);
  };

  // The failed-webhook button sends a TEST event (the same call as the Test
  // button) — it is NOT a redelivery of the failed events. Real failed events are
  // retried automatically by the */5 cron (WebhookDispatchService::retryFailed),
  // so this is labelled honestly as a test ping rather than "Retry".
  const handleRetry = async (id: number) => {
    setRetryingId(id);
    await sendTest(id);
    loadData();
    setRetryingId(null);
  };

  const filteredLogs = logFilter.trim()
    ? logs.filter(
        (log) =>
          log.event_type.toLowerCase().includes(logFilter.toLowerCase()) ||
          String(log.response_code ?? '').includes(logFilter),
      )
    : logs;

  const handleViewLogs = async (id: number) => {
    setLogFilter('');
    setLogsWebhookId(id);
    try {
      const res = await adminVolunteering.getWebhookLogs(id);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setLogs(payload);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setLogs((payload as { data: WebhookLog[] }).data || []);
        }
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_logs'));
      setLogs([]);
    }
    onLogsOpen();
  };

  const columns: Column<WebhookEntry>[] = [
    { key: 'name', label: t('volunteering.col_name'), sortable: true },
    {
      key: 'url',
      label: t('volunteering.col_url'),
      render: (row) => (
        <span className="text-sm font-mono truncate max-w-[250px] block">{row.url}</span>
      ),
    },
    {
      key: 'events',
      label: t('volunteering.col_events'),
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.events?.map((ev) => (
            <Chip key={ev} size="sm" variant="soft">{ev}</Chip>
          ))}
        </div>
      ),
    },
    {
      key: 'is_active',
      label: t('volunteering.col_active'),
      render: (row) => (
        <Chip size="sm" color={row.is_active ? 'success' : 'default'} variant="soft">
          {row.is_active ? t('volunteering.active') : t('volunteering.inactive')}
        </Chip>
      ),
    },
    {
      key: 'failure_count',
      label: t('volunteering.col_failures'),
      render: (row) => (
        <Chip size="sm" color={row.failure_count > 0 ? 'danger' : 'default'} variant="soft">
          {row.failure_count}
        </Chip>
      ),
    },
    {
      key: 'actions' as keyof WebhookEntry,
      label: t('volunteering.col_actions'),
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" isIconOnly onPress={() => openEdit(row)} aria-label={t('volunteering.edit')}>
            <Edit2 size={14} />
          </Button>
          <Button
            size="sm"
            variant="secondary"
            isIconOnly
            isLoading={testingId === row.id}
            onPress={() => handleTest(row.id)}
            aria-label={t('volunteering.test_webhook')}
          >
            <Play size={14} />
          </Button>
          {row.failure_count > 0 && (
            <Button
              size="sm"
              variant="secondary"
              isIconOnly
              isLoading={retryingId === row.id}
              onPress={() => handleRetry(row.id)}
              aria-label={t('volunteering.test_webhook')}
            >
              <RotateCcw size={14} />
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            isIconOnly
            onPress={() => handleViewLogs(row.id)}
            aria-label={t('volunteering.view_logs')}
          >
            <FileText size={14} />
          </Button>
          <Button
            size="sm"
            variant="danger"
            isIconOnly
            onPress={() => { setDeleteId(row.id); onDeleteOpen(); }}
            aria-label={t('volunteering.delete')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{t('volunteering.webhooks_heading')}</h3>
        <div className="flex gap-2">
          <Button variant="secondary" startContent={<RefreshCw size={16} />} onPress={loadData} isLoading={loading}>
            {t('volunteering.refresh')}
          </Button>
          <Button  startContent={<Plus size={16} />} onPress={openCreate}>
            {t('volunteering.add_webhook')}
          </Button>
        </div>
      </div>

      {webhooks.length === 0 && !loading ? (
        <EmptyState
          icon={Webhook}
          title={t('volunteering.no_webhooks')}
          description={t('volunteering.no_webhooks_desc')}
        />
      ) : (
        <DataTable columns={columns} data={webhooks} isLoading={loading} />
      )}

      {/* Create/Edit Webhook Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg">
        <ModalContent>
          <ModalHeader>
            {editingId
              ? t('volunteering.edit_webhook')
              : t('volunteering.add_webhook')}
          </ModalHeader>
          <ModalBody>
            <div className="flex flex-col gap-4">
              <Input
                label={t('volunteering.webhook_name')}
                value={form.name}
                onValueChange={(v) => setForm((f) => ({ ...f, name: v }))}
                isRequired
                variant="secondary"
              />
              <Input
                label={t('volunteering.webhook_url')}
                value={form.url}
                onValueChange={(v) => setForm((f) => ({ ...f, url: v }))}
                isRequired
                variant="secondary"
                type="url"
                placeholder={t('volunteering.webhook_url_placeholder')}
              />
              <Textarea
                label={t('volunteering.webhook_events')}
                value={form.events}
                onValueChange={(v) => setForm((f) => ({ ...f, events: v }))}
                variant="secondary"
                placeholder={t('volunteering.webhook_events_placeholder')}
                description={t('volunteering.webhook_events_desc')}
              />
              <Switch
                isSelected={form.is_active}
                onValueChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
              >
                {t('volunteering.webhook_active')}
              </Switch>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={onClose}>{t('volunteering.cancel')}</Button>
            <Button  onPress={handleSave} isLoading={saving}>
              {editingId ? t('volunteering.save') : t('volunteering.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmModal
        isOpen={isDeleteOpen}
        onClose={onDeleteClose}
        onConfirm={handleDelete}
        title={t('volunteering.delete_webhook_title')}
        message={t('volunteering.delete_webhook_confirm')}
        confirmLabel={t('volunteering.delete')}
        confirmColor="danger"
      />

      {/* Webhook Logs Modal */}
      <Modal isOpen={isLogsOpen} onClose={onLogsClose} size="2xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.webhook_logs_title')}
          </ModalHeader>
          <ModalBody>
            {logs.length > 0 && (
              <Input
                placeholder={t('volunteering.filter_logs')}
                aria-label={t('volunteering.filter_logs')}
                value={logFilter}
                onValueChange={setLogFilter}
                variant="secondary"
                size="sm"
                startContent={<Search size={14} className="text-muted" />}
                className="mb-3"
                isClearable
                onClear={() => setLogFilter('')}
              />
            )}
            {filteredLogs.length === 0 ? (
              <p className="text-muted text-center py-8">
                {logs.length === 0
                  ? t('volunteering.no_webhook_logs')
                  : t('volunteering.no_matching_logs')}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {filteredLogs.map((log) => (
                  <Card key={log.id} className="p-0">
                    <CardBody className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Chip size="sm" variant="soft">{log.event_type}</Chip>
                          <Chip
                            size="sm"
                            color={log.status === 'success' ? 'success' : 'danger'}
                            variant="soft"
                          >
                            {log.response_code || '-'}
                          </Chip>
                        </div>
                        <span className="text-xs text-muted">
                          {log.created_at ? new Date(log.created_at).toLocaleString(getFormattingLocale()) : '-'}
                        </span>
                      </div>
                      {log.response_body && (
                        <pre className="text-xs bg-surface-secondary p-2 rounded overflow-auto max-h-32">
                          {log.response_body}
                        </pre>
                      )}
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={onLogsClose}>{t('volunteering.close')}</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
