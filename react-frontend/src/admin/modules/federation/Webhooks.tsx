// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Webhooks
 * Full CRUD for managing federation webhook subscriptions.
 * Includes test delivery, delivery logs with retry, and expandable log rows.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

import Webhook from 'lucide-react/icons/webhook';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Pencil from 'lucide-react/icons/pencil';
import Trash2 from 'lucide-react/icons/trash-2';
import ScrollText from 'lucide-react/icons/scroll-text';
import Send from 'lucide-react/icons/send';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import ChevronDown from 'lucide-react/icons/chevron-down';
import ChevronRight from 'lucide-react/icons/chevron-right';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { Snippet, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, useDisclosure, Button, Chip, Spinner, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tooltip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Checkbox, CheckboxGroup } from '@/components/ui';
import { BrokerEmptyState } from '@/broker/components';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface WebhookItem {
  id: number;
  url: string;
  secret?: string;
  events: string[];
  status: string;
  description: string | null;
  consecutive_failures: number;
  last_triggered_at: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

interface WebhookLog {
  id: number;
  webhook_id: number;
  event_type: string;
  payload: Record<string, unknown>;
  response_code: number | null;
  response_body: string | null;
  response_time_ms: number | null;
  success: boolean;
  error_message: string | null;
  attempt_number: number;
  created_at: string;
}

interface WebhookFormData {
  url: string;
  description: string;
  events: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, 'success' | 'default' | 'warning' | 'danger'> = {
  active: 'success',
  inactive: 'default',
  failing: 'danger',
};

const ALL_EVENT_KEYS = [
  'partnership.requested',
  'partnership.approved',
  'partnership.rejected',
  'partnership.terminated',
  'member.opted_in',
  'member.opted_out',
  'message.sent',
  'message.received',
  'transaction.created',
  'transaction.completed',
  'connection.requested',
  'connection.accepted',
  'listing.shared',
];

const EMPTY_FORM: WebhookFormData = {
  url: '',
  description: '',
  events: [],
};

const truncateUrl = (url: string, max = 45) => {
  if (url.length <= max) return url;
  return url.substring(0, max) + '...';
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function Webhooks() {
  const { t } = useTranslation('admin_federation');
  usePageTitle(t('federation.webhooks_title'));
  const toast = useToast();

  const ALL_EVENTS = ALL_EVENT_KEYS.map((key) => ({
    key,
    label: t(`federation.webhook_${key.replace('.', '_')}`),
  }));

  const formModal = useDisclosure();
  const logsModal = useDisclosure();

  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<number | null>(null);

  // Form state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<WebhookFormData>({ ...EMPTY_FORM });
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);

  // Delete state
  const [deleteTarget, setDeleteTarget] = useState<WebhookItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Logs state
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsWebhookUrl, setLogsWebhookUrl] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);
  const [retryingLogId, setRetryingLogId] = useState<number | null>(null);

  // AbortController for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Load data ───
  const loadData = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const res = await api.get('/v2/admin/federation/webhooks', { signal: controller.signal });
      if (res.success) {
        const payload = res.data;
        setWebhooks(Array.isArray(payload) ? payload : (payload as { data?: WebhookItem[] })?.data ?? []);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      logError('Webhooks.load', err);
      toast.error(t('federation.webhooks_load_failed'));
    }
    setLoading(false);
  }, [t, toast]);


  useEffect(() => {
    loadData();
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [loadData]);

  // ─── Open create modal ───
  const openCreate = useCallback(() => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
    setCreatedSecret(null);
    formModal.onOpen();
  }, [formModal]);

  // ─── Open edit modal ───
  const openEdit = useCallback((webhook: WebhookItem) => {
    setEditingId(webhook.id);
    setForm({
      url: webhook.url,
      description: webhook.description || '',
      events: webhook.events || [],
    });
    setCreatedSecret(null);
    formModal.onOpen();
  }, [formModal]);

  // ─── Save (create or update) ───
  const handleSave = useCallback(async () => {
    if (!form.url.trim()) {
      toast.error(t('federation.webhooks_url_required'));
      return;
    }
    if (!form.url.startsWith('https://')) {
      toast.error(t('federation.webhooks_https_required'));
      return;
    }
    if (form.events.length === 0) {
      toast.error(t('federation.webhooks_events_required'));
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        url: form.url,
        description: form.description || null,
        events: form.events,
      };

      let res;
      if (editingId) {
        res = await api.put(`/v2/admin/federation/webhooks/${editingId}`, payload);
      } else {
        res = await api.post('/v2/admin/federation/webhooks', payload);
      }

      if (res.success) {
        if (!editingId) {
          // Show the generated secret on create
          const data = res.data as { secret?: string };
          if (data?.secret) {
            setCreatedSecret(data.secret);
            toast.success(t('federation.webhooks_created'));
          } else {
            formModal.onClose();
            toast.success(t('federation.webhooks_created_no_secret'));
          }
        } else {
          formModal.onClose();
          toast.success(t('federation.webhooks_updated'));
        }
        loadData();
      } else {
        const errorMsg = t('federation.webhooks_save_failed');
        toast.error(errorMsg);
      }
    } catch (err) {
      logError('Webhooks.save', err);
      toast.error(t('federation.webhooks_save_failed'));
    }
    setSaving(false);
  }, [form, editingId, toast, t, formModal, loadData]);

  // ─── Delete ───
  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await api.delete(`/v2/admin/federation/webhooks/${deleteTarget.id}`);
      if (res.success) {
        toast.success(t('federation.webhooks_deleted'));
        setDeleteTarget(null);
        loadData();
      } else {
        toast.error(t('federation.webhooks_delete_failed'));
      }
    } catch (err) {
      logError('Webhooks.delete', err);
      toast.error(t('federation.webhooks_delete_failed'));
    }
    setDeleting(false);
  }, [deleteTarget, toast, t, loadData]);

  // ─── Test webhook ───
  const [testPreview, setTestPreview] = useState<WebhookItem | null>(null);

  const SAMPLE_PAYLOAD = {
    event: 'webhook.test',
    timestamp: new Date().toISOString(),
    data: {
      webhook_id: testPreview?.id ?? 0,
      message: t('federation.webhooks_sample_message'),
    },
  };

  const handleTestConfirm = useCallback(async () => {
    if (!testPreview) return;
    const webhook = testPreview;
    setTestPreview(null);
    setTestingId(webhook.id);
    try {
      const res = await api.post(`/v2/admin/federation/webhooks/${webhook.id}/test`, {});
      if (res.success) {
        const data = res.data as { response_time_ms?: number; response_code?: number };
        toast.success(
          t('federation.webhooks_test_success_formatted', {
            code: data?.response_code ?? '?',
            time: data?.response_time_ms == null
              ? t('federation.response_time_unknown')
              : new Intl.NumberFormat(getFormattingLocale(), {
                  style: 'unit',
                  unit: 'millisecond',
                  unitDisplay: 'short',
                }).format(data.response_time_ms),
          })
        );
        loadData();
      } else {
        const errorMsg = t('federation.webhooks_test_failed');
        toast.error(errorMsg);
      }
    } catch (err) {
      logError('Webhooks.test', err);
      toast.error(t('federation.webhooks_test_failed'));
    }
    setTestingId(null);
  }, [testPreview, toast, t, loadData]);

  // ─── View logs ───
  const handleViewLogs = useCallback(async (webhook: WebhookItem) => {
    setLogsWebhookUrl(webhook.url);
    setLogsLoading(true);
    setLogs([]);
    setExpandedLogId(null);
    logsModal.onOpen();

    try {
      const res = await api.get(`/v2/admin/federation/webhooks/${webhook.id}/logs`);
      if (res.success) {
        const payload = res.data;
        setLogs(Array.isArray(payload) ? payload : (payload as { data?: WebhookLog[] })?.data ?? []);
      }
    } catch (err) {
      logError('Webhooks.logs', err);
      toast.error(t('federation.webhooks_logs_failed'));
    }
    setLogsLoading(false);
  }, [toast, t, logsModal]);

  // ─── Retry failed delivery ───
  const handleRetry = useCallback(async (logEntry: WebhookLog) => {
    setRetryingLogId(logEntry.id);
    try {
      const res = await api.post(`/v2/admin/federation/webhook-logs/${logEntry.id}/retry`, {});
      if (res.success) {
        const data = res.data as { success?: boolean; response_code?: number; response_time_ms?: number; error_message?: string };
        if (data?.success) {
          toast.success(t('federation.webhooks_retry_success_formatted', {
            code: data?.response_code ?? '?',
            time: data?.response_time_ms == null
              ? t('federation.response_time_unknown')
              : new Intl.NumberFormat(getFormattingLocale(), {
                  style: 'unit',
                  unit: 'millisecond',
                  unitDisplay: 'short',
                }).format(data.response_time_ms),
          }));
        } else {
          toast.error(t('federation.webhooks_retry_failed'));
        }
        // Reload logs by re-fetching from the webhook
        const webhook = webhooks.find(w => w.id === logEntry.webhook_id);
        if (webhook) {
          const logRes = await api.get(`/v2/admin/federation/webhooks/${webhook.id}/logs`);
          if (logRes.success) {
            const payload = logRes.data;
            setLogs(Array.isArray(payload) ? payload : (payload as { data?: WebhookLog[] })?.data ?? []);
          }
        }
      } else {
        toast.error(t('federation.webhooks_retry_failed'));
      }
    } catch (err) {
      logError('Webhooks.retry', err);
      toast.error(t('federation.webhooks_retry_failed'));
    }
    setRetryingLogId(null);
  }, [toast, t, webhooks]);

  // ─── Render ───
  if (loading) {
    return (
      <div>
        <PageHeader
          title={t('federation.webhooks_title')}
          description={t('federation.webhooks_desc')}
        />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('federation.webhooks_title')}
        description={t('federation.webhooks_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="tertiary" size="sm" startContent={<RefreshCw size={16} />} onPress={() => loadData()} isLoading={loading}>
              {t('federation.refresh')}
            </Button>
            <Button  size="sm" startContent={<Plus size={16} />} onPress={openCreate}>
              {t('federation.webhooks_add')}
            </Button>
          </div>
        }
      />

      <PartnerTimebankGuidance page="webhooks" />

      {/* Webhooks table */}
      <Table aria-label={t('federation.webhooks_title')} removeWrapper>
        <TableHeader>
          <TableColumn>{t('federation.webhooks_col_url')}</TableColumn>
          <TableColumn>{t('federation.webhooks_col_events')}</TableColumn>
          <TableColumn>{t('federation.col_status')}</TableColumn>
          <TableColumn>{t('federation.webhooks_col_last_triggered')}</TableColumn>
          <TableColumn>{t('federation.webhooks_col_failures')}</TableColumn>
          <TableColumn>{t('federation.col_actions')}</TableColumn>
        </TableHeader>
        <TableBody emptyContent={<BrokerEmptyState bare color="neutral" icon={Webhook} title={t('federation.webhooks_empty')} hint={t('federation.webhooks_empty_hint')} />}>
          {webhooks.map((webhook) => (
            <TableRow key={webhook.id}>
              <TableCell>
                <div>
                  <Tooltip content={webhook.url}>
                    <code className="text-xs bg-surface-secondary px-1.5 py-0.5 rounded cursor-help">
                      {truncateUrl(webhook.url)}
                    </code>
                  </Tooltip>
                  {webhook.description && (
                    <p className="text-xs text-muted mt-0.5 truncate max-w-[250px]">{webhook.description}</p>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1 max-w-[200px]">
                  {(webhook.events || []).slice(0, 3).map((evt) => (
                    <Chip key={evt} size="sm" variant="soft" className="text-xs">
                      {t(`federation.webhook_${evt.replace('.', '_')}`)}
                    </Chip>
                  ))}
                  {(webhook.events || []).length > 3 && (
                    <Chip size="sm" variant="soft" className="text-xs">+{webhook.events.length - 3}</Chip>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Chip
                  size="sm"
                  variant="soft"
                  color={STATUS_COLORS[webhook.status] ?? 'default'}
                  className="capitalize"
                >
                  {t(`federation.status_${webhook.status}`)}
                </Chip>
              </TableCell>
              <TableCell>
                <span className="text-sm text-muted">
                  {webhook.last_triggered_at ? formatRelativeTime(webhook.last_triggered_at) : t('federation.never')}
                </span>
              </TableCell>
              <TableCell>
                <span className={`text-sm ${webhook.consecutive_failures > 0 ? 'text-danger font-medium' : 'text-muted'}`}>
                  {webhook.consecutive_failures}
                </span>
              </TableCell>
              <TableCell>
                <Dropdown>
                  <DropdownTrigger>
                    <Button isIconOnly size="sm" variant="ghost" aria-label={t('federation.label_actions')}>
                      <MoreVertical size={16} />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label={t('federation.webhooks_actions')}
                    onAction={(key) => {
                      if (key === 'edit') openEdit(webhook);
                      else if (key === 'test') setTestPreview(webhook);
                      else if (key === 'logs') handleViewLogs(webhook);
                      else if (key === 'delete') setDeleteTarget(webhook);
                    }}
                  >
                    <DropdownItem key="edit" id="edit" startContent={<Pencil size={14} />}>
                      {t('federation.edit')}
                    </DropdownItem>
                    <DropdownItem key="test" id="test" startContent={testingId === webhook.id ? <Spinner size="sm" /> : <Send size={14} />}>
                      {t('federation.webhooks_test')}
                    </DropdownItem>
                    <DropdownItem key="logs" id="logs" startContent={<ScrollText size={14} />}>
                      {t('federation.view_logs')}
                    </DropdownItem>
                    <DropdownItem key="delete" id="delete" startContent={<Trash2 size={14} />} className="text-danger" color="danger">
                      {t('federation.delete')}
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Create/Edit Modal */}
      <Modal isOpen={formModal.isOpen} onOpenChange={formModal.onOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Webhook size={20} />
                {editingId
                  ? t('federation.webhooks_edit')
                  : t('federation.webhooks_add')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {/* Show secret after creation */}
                {createdSecret && (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 space-y-2">
                    <p className="text-sm font-semibold text-warning-soft-foreground">
                      {t('federation.webhooks_secret_warning')}
                    </p>
                    <Snippet
                      symbol=""
                      variant="soft"
                      color="warning"
                      className="w-full"
                    >
                      {createdSecret}
                    </Snippet>
                  </div>
                )}

                <Input
                  label={t('federation.webhooks_label_url')}
                  placeholder="https://example.com/webhooks/nexus"
                  value={form.url}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, url: v }))}
                  isRequired
                  isDisabled={!!createdSecret}
                  description={t('federation.webhooks_url_hint')}
                />

                <Textarea
                  label={t('federation.label_description')}
                  placeholder={t('federation.webhooks_desc_placeholder')}
                  value={form.description}
                  onValueChange={(v) => setForm((prev) => ({ ...prev, description: v }))}
                  minRows={2}
                  isDisabled={!!createdSecret}
                />

                {/* Event checkboxes */}
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    {t('federation.webhooks_events_label')}
                  </p>
                  <CheckboxGroup
                    value={form.events}
                    onValueChange={(v) => setForm((prev) => ({ ...prev, events: v }))}
                    isDisabled={!!createdSecret}
                  >
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {ALL_EVENTS.map((evt) => (
                        <Checkbox key={evt.key} value={evt.key} size="sm">
                          {evt.label}
                        </Checkbox>
                      ))}
                    </div>
                  </CheckboxGroup>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="tertiary"
                      onPress={() => setForm((prev) => ({ ...prev, events: ALL_EVENT_KEYS }))}
                      isDisabled={!!createdSecret}
                    >
                      {t('federation.webhooks_select_all')}
                    </Button>
                    <Button
                      size="sm"
                      variant="tertiary"
                      onPress={() => setForm((prev) => ({ ...prev, events: [] }))}
                      isDisabled={!!createdSecret}
                    >
                      {t('federation.webhooks_clear_all')}
                    </Button>
                  </div>
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {createdSecret ? t('federation.close') : t('federation.cancel')}
                </Button>
                {!createdSecret && (
                  <Button

                    isLoading={saving}
                    isDisabled={!form.url.trim() || form.events.length === 0}
                    onPress={handleSave}
                  >
                    {editingId
                      ? t('federation.save_changes')
                      : t('federation.webhooks_create')}
                  </Button>
                )}
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Logs Modal (Drawer-style) */}
      <Modal isOpen={logsModal.isOpen} onOpenChange={logsModal.onOpenChange} size="4xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <ScrollText size={20} />
                {t('federation.webhooks_logs_title')}
                <code className="text-xs bg-surface-secondary px-1.5 py-0.5 rounded ml-2">{truncateUrl(logsWebhookUrl, 60)}</code>
              </ModalHeader>
              <ModalBody>
                {logsLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-48 items-center justify-center">
                    <Spinner size="lg" />
                  </div>
                ) : logs.length === 0 ? (
                  <BrokerEmptyState bare color="neutral" icon={ScrollText} title={t('federation.webhooks_no_logs')} hint={t('federation.webhooks_no_logs_hint')} />
                ) : (
                  <div className="space-y-0">
                    {logs.map((log) => (
                      <div key={log.id}>
                        {/* Log row — responsive: stacked on mobile, full grid on lg+ */}
                        <div className="flex flex-col gap-1 py-2 border-b border-border text-sm lg:grid lg:grid-cols-[30px_1fr_60px_60px_80px_70px_120px_50px] lg:items-center lg:gap-2">
                          <div className="flex items-center gap-2 lg:contents">
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              onPress={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                              aria-label={t('federation.webhooks_expand')}
                            >
                              {expandedLogId === log.id
                                ? <ChevronDown size={14} className="text-muted" />
                                : <ChevronRight size={14} className="text-muted" />
                              }
                            </Button>
                            <Chip size="sm" variant="soft">{log.event_type}</Chip>
                            <div>
                              {log.success ? (
                                <Check size={16} className="text-success" />
                              ) : (
                                <X size={16} className="text-danger" />
                              )}
                            </div>
                            <span className={`text-sm ${log.response_code && log.response_code >= 200 && log.response_code < 300 ? 'text-success' : log.response_code ? 'text-danger' : 'text-muted'}`}>
                              {log.response_code ?? '--'}
                            </span>
                            <span className="text-sm text-muted">
                              {log.response_time_ms != null
                                ? new Intl.NumberFormat(getFormattingLocale(), {
                                    style: 'unit',
                                    unit: 'millisecond',
                                    unitDisplay: 'short',
                                  }).format(log.response_time_ms)
                                : t('federation.response_time_unknown')}
                            </span>
                            <span className="text-sm text-muted">#{log.attempt_number}</span>
                            <span className="text-sm text-muted">
                              {log.created_at ? formatRelativeTime(log.created_at) : '--'}
                            </span>
                            <div>
                              {!log.success && (
                                <Tooltip content={t('federation.webhooks_retry')}>
                                  <Button
                                    isIconOnly
                                    size="sm"
                                    variant="ghost"
                                    isLoading={retryingLogId === log.id}
                                    onPress={() => handleRetry(log)}
                                    aria-label={t('federation.webhooks_retry')}
                                  >
                                    <RotateCcw size={14} />
                                  </Button>
                                </Tooltip>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Inline expanded detail */}
                        {expandedLogId === log.id && (
                          <div className="rounded-lg border border-border p-4 space-y-3 bg-surface-secondary my-2">
                            {log.error_message && (
                              <div>
                                <p className="text-xs font-semibold text-danger mb-1">{t('federation.webhooks_error')}</p>
                                <p className="text-sm text-danger">{log.error_message}</p>
                              </div>
                            )}
                            <div>
                              <p className="text-xs font-semibold text-muted mb-1">{t('federation.webhooks_payload')}</p>
                              <pre className="text-xs bg-surface-secondary rounded p-2 overflow-x-auto max-h-48">
                                {JSON.stringify(log.payload, null, 2)}
                              </pre>
                            </div>
                            {log.response_body && (
                              <div>
                                <p className="text-xs font-semibold text-muted mb-1">{t('federation.webhooks_response')}</p>
                                <pre className="text-xs bg-surface-secondary rounded p-2 overflow-x-auto max-h-48">
                                  {log.response_body}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('federation.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Delete confirmation */}
      {deleteTarget && (
        <ConfirmModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title={t('federation.webhooks_delete_title')}
          message={t('federation.webhooks_delete_confirm', {
            url: deleteTarget.url,
          })}
          confirmLabel={t('federation.delete')}
          confirmColor="danger"
          isLoading={deleting}
        />
      )}

      {/* Test payload preview */}
      <Modal isOpen={!!testPreview} onOpenChange={(open) => { if (!open) setTestPreview(null); }} size="lg" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Send size={20} />
                {t('federation.webhooks_test_preview_title')}
              </ModalHeader>
              <ModalBody>
                <p className="text-sm text-muted mb-3">
                  {t('federation.webhooks_test_preview_desc')}
                </p>
                {testPreview && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{t('federation.webhooks_endpoint')}:</span>
                      <code className="text-xs bg-surface-secondary px-2 py-1 rounded break-all">{testPreview.url}</code>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground mb-1">{t('federation.webhooks_sample_payload')}</p>
                      <pre className="text-xs bg-surface-secondary rounded p-3 overflow-x-auto max-h-48 border border-border">
                        {JSON.stringify(SAMPLE_PAYLOAD, null, 2)}
                      </pre>
                    </div>
                    <p className="text-xs text-muted">
                      {t('federation.webhooks_test_note')}
                    </p>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('federation.cancel')}</Button>
                <Button

                  startContent={<Send size={16} />}
                  onPress={handleTestConfirm}
                  isLoading={testingId === testPreview?.id}
                >
                  {t('federation.webhooks_send_test')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default Webhooks;
