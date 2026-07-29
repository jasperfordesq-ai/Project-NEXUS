// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter List
 * Displays all newsletters with status filtering, send, duplicate, and CRUD actions.
 * Parity: PHP Admin\NewsletterController::index()
 */

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';import Mail from 'lucide-react/icons/mail';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import Copy from 'lucide-react/icons/copy';
import Send from 'lucide-react/icons/send';
import BarChart3 from 'lucide-react/icons/chart-column';
import Activity from 'lucide-react/icons/activity';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant,
  useToast } from '@/contexts';
import { adminNewsletters } from '../../api/adminApi';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { NewsletterResend } from './NewsletterResend';

import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip } from '@/components/ui';
interface NewsletterItem {
  id: number;
  name: string;
  subject: string;
  status: string;
  recipients_count: number;
  total_recipients: number;
  open_rate: number;
  click_rate: number;
  sent_at: string | null;
  created_at: string;
  is_recurring: boolean;
  ab_test_enabled: boolean;
}

export function NewsletterList() {
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [items, setItems] = useState<NewsletterItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [deleteTarget, setDeleteTarget] = useState<NewsletterItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resendTarget, setResendTarget] = useState<number | null>(null);
  const [sendTarget, setSendTarget] = useState<NewsletterItem | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNewsletters.list({ page });
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setItems(payload);
          setTotal(payload.length);
        } else if (payload && typeof payload === 'object') {
          const p = payload as { data?: NewsletterItem[]; meta?: { total?: number } };
          setItems(p.data || []);
          setTotal(p.meta?.total || 0);
        }
      }
    } catch {
      setItems([]);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminNewsletters.delete(deleteTarget.id);
      if (res.success) {
        toast.success(t('newsletters.newsletter_deleted'));
        setDeleteTarget(null);
        loadData();
      } else {
        toast.error(t('newsletters.failed_to_delete_newsletter'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_delete_newsletter'));
    }
    setDeleting(false);
  };

  const handleDuplicate = async (item: NewsletterItem) => {
    try {
      const res = await adminNewsletters.duplicateNewsletter(item.id);
      if (res.success) {
        toast.success(t('newsletters.newsletter_duplicated_as_draft'));
        loadData();
      } else {
        toast.error(t('newsletters.failed_to_duplicate_newsletter'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_duplicate_newsletter'));
    }
  };

  const handleSendNow = async () => {
    if (!sendTarget) return;
    setSendingId(sendTarget.id);
    try {
      const res = await adminNewsletters.sendNewsletter(sendTarget.id);
      if (res.success) {
        // admin-i18n-ignore: localized server message — the queued count comes
        // from api_controllers_1.admin_newsletter.newsletter_queued.
        toast.success(res.data?.message || t('newsletters.newsletter_queued_for_sending'));
        setSendTarget(null);
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — AdminNewsletterController
        // refusals are __() keys, guarded by ApiErrorLocalisationTest.
        toast.error(res.error || t('newsletters.failed_to_send_newsletter'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_send_newsletter'));
    }
    setSendingId(null);
  };

  const columns: Column<NewsletterItem>[] = [
    {
      key: 'subject', label: t('newsletters.col_subject'), sortable: true,
      render: (item) => (
        <div className="min-w-0">
          <p className="font-medium truncate">{item.subject || item.name}</p>
          <div className="flex gap-1 mt-1">
            {item.ab_test_enabled && <Chip size="sm" color="warning" variant="soft">{t('newsletter_form.ab_test_short')}</Chip>}
            {item.is_recurring && <Chip size="sm" variant="soft">{t('newsletter_form.recurring_label')}</Chip>}
          </div>
        </div>
      ),
    },
    {
      key: 'status', label: t('newsletters.col_status'), sortable: true,
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'recipients_count', label: t('newsletters.col_recipients'),
      render: (item) => <span>{((item.total_recipients || item.recipients_count) || 0).toLocaleString(getFormattingLocale())}</span>,
    },
    {
      key: 'open_rate', label: t('newsletters.col_open_rate'),
      render: (item) => <span>{item.open_rate !== null && item.open_rate !== undefined ? formatNumber(item.open_rate / 100, { style: 'percent', maximumFractionDigits: 2 }) : '--'}</span>,
    },
    {
      key: 'click_rate', label: t('newsletters.col_click_rate'),
      render: (item) => <span>{item.click_rate !== null && item.click_rate !== undefined ? formatNumber(item.click_rate / 100, { style: 'percent', maximumFractionDigits: 2 }) : '--'}</span>,
    },
    {
      key: 'created_at', label: t('newsletters.col_date'), sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.sent_at
            ? new Date(item.sent_at).toLocaleDateString(getFormattingLocale())
            : item.created_at
              ? new Date(item.created_at).toLocaleDateString(getFormattingLocale())
              : '--'}
        </span>
      ),
    },
    {
      key: 'actions' as keyof NewsletterItem, label: t('newsletters.col_actions'),
      render: (item) => (
        <Dropdown>
          <DropdownTrigger>
            <Button isIconOnly size="sm" variant="tertiary" aria-label={t('newsletters.col_actions')}><MoreVertical size={16} /></Button>
          </DropdownTrigger>
          <DropdownMenu aria-label={t('newsletters.col_actions')} onAction={(key) => {
            if (key === 'edit') navigate(tenantPath(`/admin/newsletters/edit/${item.id}`));
            else if (key === 'stats') navigate(tenantPath(`/admin/newsletters/${item.id}/stats`));
            else if (key === 'activity') navigate(tenantPath(`/admin/newsletters/${item.id}/activity`));
            else if (key === 'duplicate') handleDuplicate(item);
            else if (key === 'send') setSendTarget(item);
            else if (key === 'resend') setResendTarget(item.id);
            else if (key === 'delete') setDeleteTarget(item);
          }}>
            <DropdownItem key="edit" id="edit" startContent={<Edit aria-hidden="true" size={14} />}>{t('newsletters.edit')}</DropdownItem>
            <DropdownItem
              key="send" id="send"
              startContent={<Send aria-hidden="true" size={14} />}
              className={item.status === 'draft' || item.status === 'scheduled' ? '' : 'hidden'}
            >
              {t('newsletters.send_now')}
            </DropdownItem>
            <DropdownItem
              key="stats" id="stats"
              startContent={<BarChart3 aria-hidden="true" size={14} />}
              className={item.status === 'sent' || item.status === 'sending' ? '' : 'hidden'}
            >
              {t('newsletters.stats')}
            </DropdownItem>
            <DropdownItem
              key="activity" id="activity"
              startContent={<Activity aria-hidden="true" size={14} />}
              className={item.status === 'sent' ? '' : 'hidden'}
            >
              {t('newsletters.activity_log')}
            </DropdownItem>
            <DropdownItem key="duplicate" id="duplicate" startContent={<Copy aria-hidden="true" size={14} />}>{t('newsletters.duplicate')}</DropdownItem>
            <DropdownItem
              key="resend" id="resend"
              startContent={<Send aria-hidden="true" size={14} />}
              className={item.status === 'sent' ? '' : 'hidden'}
            >
              {t('newsletters.resend_to_non_openers')}
            </DropdownItem>
            <DropdownItem key="delete" id="delete" startContent={<Trash2 aria-hidden="true" size={14} />} className="text-danger" variant="danger">{t('newsletters.delete')}</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('newsletters.newsletter_list_title')}
        description={t('newsletters.newsletter_list_desc')}
        actions={
          <div className="flex gap-2">
            <Button variant="tertiary" startContent={<RefreshCw aria-hidden="true" size={16} />} onPress={loadData} isLoading={loading}>{t('newsletters.refresh')}</Button>
            <Button startContent={<Plus aria-hidden="true" size={16} />} onPress={() => navigate(tenantPath('/admin/newsletters/create'))}>{t('newsletters.create_newsletter')}</Button>
          </div>
        }
      />
      <DataTable
        columns={columns}
        data={items}
        isLoading={loading}
        searchPlaceholder={t('newsletters.search_newsletters_placeholder')}
        totalItems={total}
        page={page}
        pageSize={20}
        onPageChange={setPage}
        onRefresh={loadData}
        emptyContent={
          <div className="flex flex-col items-center gap-2 py-8 text-muted">
            <Mail aria-hidden="true" size={40} />
            <p>{t('newsletters.no_newsletters_found')}</p>
            <p className="text-xs">{t('newsletters.create_first_newsletter')}</p>
          </div>
        }
      />

      {deleteTarget && (
        <ConfirmModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
          title={t('newsletters.delete_newsletter')}
          message={t('newsletters.confirm_delete_newsletter')}
          confirmLabel={t('newsletters.delete')}
          confirmColor="danger"
          isLoading={deleting}
        />
      )}

      {sendTarget && (
        <ConfirmModal
          isOpen={!!sendTarget}
          onClose={() => setSendTarget(null)}
          onConfirm={handleSendNow}
          title={t('newsletters.send_newsletter_now')}
          message={t('newsletters.confirm_send_newsletter')}
          confirmLabel={t('newsletters.send_now')}
          confirmColor="primary"
          isLoading={sendingId === sendTarget.id}
        />
      )}

      {resendTarget && (
        <NewsletterResend
          isOpen={!!resendTarget}
          onClose={() => setResendTarget(null)}
          newsletterId={resendTarget}
          onSuccess={loadData}
        />
      )}
    </div>
  );
}

export default NewsletterList;
