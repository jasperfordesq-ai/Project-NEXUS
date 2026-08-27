import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Button, Chip, Card, CardBody, Input, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Avatar, Tooltip, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Subscribers
 * Full subscriber management: list, add, remove, import CSV, export, sync members.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import Papa from 'papaparse';

import Users from 'lucide-react/icons/users';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import Upload from 'lucide-react/icons/upload';
import UserPlus from 'lucide-react/icons/user-plus';
import Copy from 'lucide-react/icons/copy';
import ExternalLink from 'lucide-react/icons/external-link';
import Trash2 from 'lucide-react/icons/trash-2';
import Search from 'lucide-react/icons/search';
import Mail from 'lucide-react/icons/mail';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import UserX from 'lucide-react/icons/user-x';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { ConfirmModal } from '../../components/ConfirmModal';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Subscriber {
  id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  status: string;
  source: string | null;
  created_at: string;
  confirmed_at: string | null;
  user_id: number | null;
}

interface SubscriberStats {
  total: number;
  active: number;
  pending: number;
  unsubscribed: number;
}

type StatusFilter = '' | 'active' | 'pending' | 'unsubscribed';

const statusColor = (status: string): 'success' | 'warning' | 'danger' | 'default' => {
  switch (status) {
    case 'active': return 'success';
    case 'pending': return 'warning';
    case 'unsubscribed': return 'danger';
    default: return 'default';
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function Subscribers() {
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.page_title'));
  const { tenant } = useTenant();
  const toast = useToast();

  // Data state
  const [items, setItems] = useState<Subscriber[]>([]);
  const [stats, setStats] = useState<SubscriberStats>({ total: 0, active: 0, pending: 0, unsubscribed: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');

  // Modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Subscriber | null>(null);

  // Form state
  const [addForm, setAddForm] = useState({ email: '', first_name: '', last_name: '' });
  const [addLoading, setAddLoading] = useState(false);
  const [importRows, setImportRows] = useState<Array<{ email: string; first_name?: string; last_name?: string }>>([]);
  const [importFileName, setImportFileName] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [removeLoading, setRemoveLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ───────────────────────────────────────────────────────────────────────────
  // Load data
  // ───────────────────────────────────────────────────────────────────────────

  const loadData = useCallback(async (p = page, status = statusFilter, search = searchQuery) => {
    setLoading(true);
    try {
      const res = await adminNewsletters.getSubscribers({
        page: p,
        status: status || undefined,
        search: search || undefined,
      });
      if (res.success) {
        const payload = res.data as unknown;
        if (payload && typeof payload === 'object') {
          const p2 = payload as Record<string, unknown>;
          // Paginated response: { data: [...], meta: {...}, stats: {...} }
          if ('data' in p2 && Array.isArray(p2.data)) {
            setItems(p2.data as Subscriber[]);
          } else if (Array.isArray(payload)) {
            setItems(payload as Subscriber[]);
          }
          if ('meta' in p2 && p2.meta && typeof p2.meta === 'object') {
            const meta = p2.meta as Record<string, unknown>;
            setTotalPages((meta.total_pages as number) || 1);
            setTotal((meta.total as number) || 0);
          }
          if ('stats' in p2 && p2.stats && typeof p2.stats === 'object') {
            const s = p2.stats as SubscriberStats;
            setStats({
              total: s.total || 0,
              active: s.active || 0,
              pending: s.pending || 0,
              unsubscribed: s.unsubscribed || 0,
            });
          }
        }
      }
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, [page, statusFilter, searchQuery]);

  useEffect(() => { loadData(); }, [loadData]);

  // Debounced search
  const handleSearchChange = useCallback((value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(value);
      setPage(1);
    }, 400);
  }, []);

  // Filter by status
  const handleStatusFilter = useCallback((status: StatusFilter) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // Add subscriber
  // ───────────────────────────────────────────────────────────────────────────

  const handleAddSubscriber = useCallback(async () => {
    if (!addForm.email) return;
    setAddLoading(true);
    try {
      const res = await adminNewsletters.addSubscriber({
        email: addForm.email,
        first_name: addForm.first_name || undefined,
        last_name: addForm.last_name || undefined,
      });
      if (res.success) {
        toast.success(t('newsletters.subscriber_added'));
        setAddModalOpen(false);
        setAddForm({ email: '', first_name: '', last_name: '' });
        loadData(1, statusFilter, searchQuery);
      } else {
        toast.error(t('newsletters.failed_to_add_subscriber'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_add_subscriber'));
    }
    setAddLoading(false);
  }, [addForm, loadData, statusFilter, searchQuery, t, toast])

  // ───────────────────────────────────────────────────────────────────────────
  // Remove subscriber
  // ───────────────────────────────────────────────────────────────────────────

  const handleRemoveSubscriber = useCallback(async () => {
    if (!removeTarget) return;
    setRemoveLoading(true);
    try {
      const res = await adminNewsletters.removeSubscriber(removeTarget.id);
      if (res.success) {
        toast.success(t('newsletters.subscriber_removed'));
        setRemoveTarget(null);
        loadData();
      } else {
        toast.error(t('newsletters.failed_to_remove_subscriber'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_remove_subscriber'));
    }
    setRemoveLoading(false);
  }, [removeTarget, loadData, t, toast])

  // ───────────────────────────────────────────────────────────────────────────
  // Import CSV
  // ───────────────────────────────────────────────────────────────────────────

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data, errors, meta }) => {
        if (errors.length > 0) {
          toast.warning(t('newsletters.csv_parse_warning'));
        }

        const fields = (meta.fields ?? []).map((field) => field.trim().toLowerCase());
        if (!fields.includes('email')) {
          toast.warning(t('newsletters.c_s_v_must_have_an_email_column'));
          return;
        }

        const rows = data
          .flatMap((row) => {
            const normalized: Record<string, string> = Object.fromEntries(
              Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value?.trim() ?? '']),
            );
            const email = normalized.email ?? '';
            if (!email) {
              return [];
            }
            return {
              email,
              first_name: normalized.first_name || undefined,
              last_name: normalized.last_name || undefined,
            };
          });

        if (rows.length === 0) {
          toast.warning(t('newsletters.c_s_v_must_have_a_header_row_and_at_least_'));
          return;
        }

        setImportRows(rows);
      },
      error: () => {
        toast.warning(t('newsletters.c_s_v_must_have_an_email_column'));
      },
    });
  }, [t, toast])

  const handleImport = useCallback(async () => {
    if (importRows.length === 0) return;
    setImportLoading(true);
    try {
      const res = await adminNewsletters.importSubscribers(importRows);
      if (res.success) {
        toast.success(t('newsletters.import_result'));
        setImportModalOpen(false);
        setImportRows([]);
        setImportFileName('');
        loadData(1, statusFilter, searchQuery);
      } else {
        toast.error(t('newsletters.failed_to_import_subscribers'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_import_subscribers'));
    }
    setImportLoading(false);
  }, [importRows, loadData, statusFilter, searchQuery, t, toast])

  // ───────────────────────────────────────────────────────────────────────────
  // Export CSV
  // ───────────────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    setExportLoading(true);
    try {
      const res = await adminNewsletters.exportSubscribers();
      if (res.success && Array.isArray(res.data)) {
        const rows = res.data as Array<Record<string, string>>;
        if (rows.length === 0) {
          toast.warning(t('newsletters.no_subscribers_to_export'));
          setExportLoading(false);
          return;
        }
        const headers = ['email', 'first_name', 'last_name', 'status', 'source', 'created_at', 'confirmed_at'];
        const csvLines = [headers.join(',')];
        for (const row of rows) {
          csvLines.push(headers.map((h) => `"${(row[h] || '').replace(/"/g, '""')}"`).join(','));
        }
        const blob = new Blob([csvLines.join('\n')], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast.success(t('newsletters.subscribers_exported'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_export_subscribers'));
    }
    setExportLoading(false);
  }, [t, toast])

  // ───────────────────────────────────────────────────────────────────────────
  // Sync members
  // ───────────────────────────────────────────────────────────────────────────

  const handleSync = useCallback(async () => {
    setSyncLoading(true);
    try {
      const res = await adminNewsletters.syncMembers();
      if (res.success) {
        toast.success(t('newsletters.sync_result'));
        loadData(1, statusFilter, searchQuery);
      } else {
        toast.error(t('newsletters.failed_to_sync_members'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_sync_members'));
    }
    setSyncLoading(false);
  }, [loadData, statusFilter, searchQuery, t, toast])

  // ───────────────────────────────────────────────────────────────────────────
  // Helpers
  // ───────────────────────────────────────────────────────────────────────────

  const showPublicSubscribeLink = false;
  const subscribeUrl = tenant?.slug
    ? `${window.location.origin}/${tenant.slug}/newsletter/subscribe`
    : '';

  const copySubscribeLink = useCallback(() => {
    if (!subscribeUrl) return;
    navigator.clipboard.writeText(subscribeUrl);
    toast.success(t('newsletters.subscribe_link_copied_to_clipboard'));
  }, [subscribeUrl, t, toast])

  const sourceLabel = (source: string | null) => {
    switch (source) {
      case 'signup': return t('newsletters.source_signup');
      case 'import': return t('newsletters.source_import');
      case 'manual': return t('newsletters.source_manual');
      case 'member_sync': return t('newsletters.source_member_sync');
      case 'member': return t('newsletters.source_member');
      default: return source || '--';
    }
  };

  // ───────────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={t('newsletters.subscribers_title')}
        description={t('newsletters.subscribers_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              startContent={<RefreshCw aria-hidden="true" size={14} />}
              onPress={() => loadData()}
              isLoading={loading}
            >
              {t('newsletters.refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              startContent={<Download aria-hidden="true" size={14} />}
              onPress={handleExport}
              isLoading={exportLoading}
            >
              {t('newsletters.export_csv')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              startContent={<Upload aria-hidden="true" size={14} />}
              onPress={() => setImportModalOpen(true)}
            >
              {t('newsletters.import_csv')}
            </Button>
            <Button

              size="sm"
              startContent={<UserPlus aria-hidden="true" size={14} />}
              onPress={() => setAddModalOpen(true)}
            >
              {t('newsletters.add_subscriber')}
            </Button>
          </div>
        }
      />

      {/* Sync Platform Members card */}
      <Card>
        <CardBody className="flex flex-row items-center gap-4 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Users aria-hidden="true" size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-foreground">{t('newsletters.sync_platform_members')}</p>
            <p className="text-sm text-muted">
              {t('newsletters.sync_platform_members_desc')}
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            startContent={<RefreshCw aria-hidden="true" size={14} />}
            onPress={handleSync}
            isLoading={syncLoading}
          >
            {t('newsletters.sync_now')}
          </Button>
        </CardBody>
      </Card>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Button variant="tertiary" className="min-h-12 justify-start p-0 text-left" onPress={() => handleStatusFilter('')}>
          <StatCard label={t('newsletters.label_total_subscribers')} value={stats.total} icon={Mail} color="default" loading={loading} />
        </Button>
        <Button variant="tertiary" className="min-h-12 justify-start p-0 text-left" onPress={() => handleStatusFilter('active')}>
          <StatCard label={t('newsletters.label_active')} value={stats.active} icon={CheckCircle} color="success" loading={loading} />
        </Button>
        <Button variant="tertiary" className="min-h-12 justify-start p-0 text-left" onPress={() => handleStatusFilter('pending')}>
          <StatCard label={t('newsletters.label_pending')} value={stats.pending} icon={Clock} color="warning" loading={loading} />
        </Button>
        <Button variant="tertiary" className="min-h-12 justify-start p-0 text-left" onPress={() => handleStatusFilter('unsubscribed')}>
          <StatCard label={t('newsletters.label_unsubscribed')} value={stats.unsubscribed} icon={UserX} color="danger" loading={loading} />
        </Button>
      </div>

      {/* Filter pills + search */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          {(['', 'active', 'pending', 'unsubscribed'] as StatusFilter[]).map((s) => (
            <Chip
              key={s || 'all'}
              variant={statusFilter === s ? 'solid' : 'flat'}
              color={s === '' ? 'default' : statusColor(s)}
              className="cursor-pointer"
              onClick={() => handleStatusFilter(s)}
            >
              {s === '' ? t('newsletters.tab_all') : t(`newsletters.label_${s}`)}
            </Chip>
          ))}
        </div>
        <div className="ml-auto w-full max-w-xs">
          <Input type="search" name="admin-search" autoComplete="off"
            size="sm"
            placeholder={t('newsletters.placeholder_search_by_name_or_email')}
            aria-label={t('newsletters.label_search_subscribers')}
            startContent={<Search aria-hidden="true" size={14} className="text-muted" />}
            value={searchInput}
            onValueChange={handleSearchChange}
            isClearable
            onClear={() => { setSearchInput(''); setSearchQuery(''); setPage(1); }}
          />
        </div>
      </div>

      {/* Data table */}
      <Table
        aria-label={t('newsletters.label_subscribers')}

        isStriped
        bottomContent={
          totalPages > 1 ? (
            <div className="flex items-center justify-between px-2 py-2">
              <p className="text-sm text-muted">
                {t('newsletters.subscriber_total', { count: total })}
              </p>
              <Pagination
                total={totalPages}
                page={page}
                onChange={setPage}
                showControls
                size="sm"
              />
            </div>
          ) : undefined
        }
      >
        <TableHeader>
          <TableColumn>{t('newsletters.col_subscriber')}</TableColumn>
          <TableColumn>{t('newsletters.col_status')}</TableColumn>
          <TableColumn>{t('newsletters.col_source')}</TableColumn>
          <TableColumn>{t('newsletters.col_date')}</TableColumn>
          <TableColumn className="text-right">{t('newsletters.col_actions')}</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={
            <div className="flex flex-col items-center gap-2 py-8 text-muted">
              <Users aria-hidden="true" size={40} />
              <p className="text-lg font-medium">{t('newsletters.no_subscribers_found')}</p>
              <p className="text-sm">{t('newsletters.no_subscribers_hint')}</p>
            </div>
          }
          isLoading={loading && items.length === 0}
          loadingContent={<RefreshCw aria-hidden="true" size={24} className="animate-spin text-muted" />}
        >
          {items.map((sub) => (
            <TableRow key={sub.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar
                    name={resolveUserDisplayName(sub) || sub.email}
                    size="sm"
                    className="shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {sub.first_name || sub.last_name
                        ? resolveUserDisplayName(sub)
                        : '--'}
                    </p>
                    <p className="truncate text-xs text-muted">{sub.email}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Chip size="sm" variant="soft" color={statusColor(sub.status)}>
                  {t(`newsletters.label_${sub.status}`, { defaultValue: t('common.unknown') })}
                </Chip>
              </TableCell>
              <TableCell className="text-sm text-muted">
                {sourceLabel(sub.source)}
              </TableCell>
              <TableCell className="text-sm text-muted">
                {sub.created_at ? new Date(sub.created_at).toLocaleDateString(getFormattingLocale()) : '--'}
              </TableCell>
              <TableCell className="text-right">
                <Tooltip content={t('newsletters.remove_subscriber')}>
                  <Button
                    isIconOnly
                    variant="danger"
                    size="sm"
                    aria-label={t('newsletters.remove')}
                    onPress={() => setRemoveTarget(sub)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Public subscribe link */}
      {showPublicSubscribeLink && subscribeUrl && (
        <Card>
          <CardBody className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{t('newsletters.public_subscribe_link')}</p>
              <p className="truncate text-xs text-muted">{subscribeUrl}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" startContent={<Copy aria-hidden="true" size={14} />} onPress={copySubscribeLink}>
                {t('newsletters.copy')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                startContent={<ExternalLink aria-hidden="true" size={14} />}
                as="a"
                href={subscribeUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('newsletters.preview')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* ─── Add Subscriber Modal ────────────────────────────────────────────── */}
      <Modal isOpen={addModalOpen} onClose={() => setAddModalOpen(false)} size="md">
        <ModalContent>
          <ModalHeader>{t('newsletters.add_subscriber')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Input
                label={t('newsletters.label_email')}
                type="email"
                placeholder="subscriber@example.com"
                isRequired
                value={addForm.email}
                onValueChange={(v) => setAddForm((f) => ({ ...f, email: v }))}
                autoFocus
              />
              <Input
                label={t('newsletters.label_first_name')}
                placeholder={t('newsletters.placeholder_jane')}
                value={addForm.first_name}
                onValueChange={(v) => setAddForm((f) => ({ ...f, first_name: v }))}
              />
              <Input
                label={t('newsletters.label_last_name')}
                placeholder={t('newsletters.placeholder_doe')}
                value={addForm.last_name}
                onValueChange={(v) => setAddForm((f) => ({ ...f, last_name: v }))}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => setAddModalOpen(false)} isDisabled={addLoading}>
              {t('newsletter_form.cancel')}
            </Button>
            <Button

              onPress={handleAddSubscriber}
              isLoading={addLoading}
              isDisabled={!addForm.email}
            >
              {t('newsletters.add_subscriber')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── Import CSV Modal ────────────────────────────────────────────────── */}
      <Modal isOpen={importModalOpen} onClose={() => { setImportModalOpen(false); setImportRows([]); setImportFileName(''); }} size="lg">
        <ModalContent>
          <ModalHeader>{t('newsletters.import_subscribers_from_csv')}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <Button
                type="button"
                variant="secondary"
                className="min-h-24 w-full flex-col items-center gap-2 border-2 border-dashed border-border p-8 text-center"
                onPress={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file && fileInputRef.current) {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    fileInputRef.current.files = dt.files;
                    fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                  }
                }}
              >
                <Upload aria-hidden="true" size={32} className="text-muted" />
                <p className="font-medium text-foreground">
                  {importFileName || t('newsletters.click_or_drag_csv')}
                </p>
                <p className="text-xs text-muted">
                  {t('newsletters.accepted_format_csv')}
                </p>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
                aria-hidden="true"
                tabIndex={-1}
              />

              {importRows.length > 0 && (
                <div className="rounded-lg bg-success/10 p-3">
                  <p className="text-sm font-medium text-success">
                    {t('newsletters.import_rows_found', { count: importRows.length })}
                  </p>
                </div>
              )}

              <Card className="bg-surface">
                <CardBody className="p-3">
                  <p className="text-xs font-medium text-foreground">{t('newsletters.required_csv_format')}</p>
                  {/* eslint-disable-next-line i18next/no-literal-string -- CSV schema header must remain verbatim. */}
                  <code className="mt-1 block text-xs text-muted">
                    email,first_name,last_name
                  </code>
                  <p className="mt-1 text-xs text-muted">
                    {t('newsletters.csv_email_required_hint')}
                  </p>
                </CardBody>
              </Card>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onPress={() => { setImportModalOpen(false); setImportRows([]); setImportFileName(''); }} isDisabled={importLoading}>
              {t('newsletter_form.cancel')}
            </Button>
            <Button

              onPress={handleImport}
              isLoading={importLoading}
              isDisabled={importRows.length === 0}
            >
              {t('newsletters.import')} {importRows.length > 0 ? `(${importRows.length})` : ''}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* ─── Remove Subscriber Confirm ───────────────────────────────────────── */}
      <ConfirmModal
        isOpen={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemoveSubscriber}
        title={t('newsletters.remove_subscriber')}
        message={t('newsletters.confirm_remove_subscriber')}
        confirmLabel={t('newsletters.remove')}
        confirmColor="danger"
        isLoading={removeLoading}
      />
    </div>
  );
}

export default Subscribers;
