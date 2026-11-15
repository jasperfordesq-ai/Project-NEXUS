// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter List
 *
 * Every newsletter the community has written, with how each one did.
 *
 * The status tabs, the search box and the column sorting are all answered by
 * the server (`GET /v2/admin/newsletters`), so they work across every page of
 * the list, not just the twenty rows on screen. Open and click rates arrive
 * worked out by the server, and are `null` until a newsletter has gone out.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import Mail from 'lucide-react/icons/mail';
import Plus from 'lucide-react/icons/plus';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import Edit from 'lucide-react/icons/square-pen';
import Trash2 from 'lucide-react/icons/trash-2';
import Copy from 'lucide-react/icons/copy';
import Send from 'lucide-react/icons/send';
import BarChart3 from 'lucide-react/icons/chart-column';
import Activity from 'lucide-react/icons/activity';
import SearchX from 'lucide-react/icons/search-x';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatDateTime, formatDateValue, formatNumber, formatPercentValue } from '@/lib/helpers';
import { LoadError } from '@/components/feedback/LoadError';
import { Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, Button, Chip, Tab, Tabs } from '@/components/ui';
import { adminNewsletters } from '../../api/adminApi';
import type { Newsletter, NewsletterStatusCounts } from '../../api/types';
import { DataTable, type Column, type DataTableSort } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { ConfirmModal } from '../../components/ConfirmModal';
import { NewsletterResend } from './NewsletterResend';
import { PolicyEmailActivity } from './PolicyEmailActivity';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const STATUS_TABS = ['all', 'draft', 'scheduled', 'sending', 'sent', 'failed'] as const;
type StatusTab = (typeof STATUS_TABS)[number];

/**
 * Shown only while they hold something (or are the open tab): a newsletter is
 * mid-send for a few minutes at most, and a failed one should be rare.
 */
const OCCASIONAL_TABS: readonly StatusTab[] = ['sending', 'failed'];

// Scheduled is amber (waiting) rather than the accent colour: on a community
// whose accent is red or pink, an accent chip is hard to tell from "Failed".
const STATUS_COLOR: Record<Newsletter['status'], 'default' | 'primary' | 'warning' | 'success' | 'danger'> = {
  draft: 'default',
  scheduled: 'warning',
  sending: 'primary',
  sent: 'success',
  failed: 'danger',
};

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const SHORT_DATE_TIME: Intl.DateTimeFormatOptions = { ...SHORT_DATE, hour: '2-digit', minute: '2-digit' };

/** A sent (or part-sent) newsletter opens on its results; anything else opens for editing. */
function hasResults(item: Newsletter): boolean {
  return item.status === 'sent' || item.status === 'sending';
}

export function NewsletterList() {
  const { t } = useTranslation('admin_newsletters');
  const { t: tNav } = useTranslation('admin_nav');
  usePageTitle(t('newsletters.page_title'));
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [items, setItems] = useState<Newsletter[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<NewsletterStatusCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusTab>('all');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DataTableSort | undefined>(undefined);

  const [deleteTarget, setDeleteTarget] = useState<Newsletter | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resendTarget, setResendTarget] = useState<number | null>(null);
  const [sendTarget, setSendTarget] = useState<Newsletter | null>(null);
  const [sendingId, setSendingId] = useState<number | null>(null);

  // Typing searches after a short pause rather than on every keystroke.
  useEffect(() => {
    const next = searchText.trim();
    if (next === search) return undefined;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText, search]);

  // Only the newest request may fill the table: a slow answer to an earlier
  // search must not overwrite the results of the one typed after it.
  const latestRequest = useRef(0);

  const loadData = useCallback(async () => {
    const request = ++latestRequest.current;
    setLoading(true);
    let ok = false;
    try {
      const res = await adminNewsletters.list({
        page,
        status: status === 'all' ? undefined : status,
        search: search || undefined,
        sort: sort?.column,
        direction: sort?.direction,
      });
      if (request !== latestRequest.current) return;
      // The shared api client unwraps the `{ data, meta }` envelope: `res.data`
      // is the bare row array and the total and tab counts arrive on `res.meta`.
      const rows = res.data as unknown;
      if (res.success && Array.isArray(rows)) {
        const meta = res.meta as { total?: unknown; status_counts?: NewsletterStatusCounts } | undefined;
        setItems(rows as Newsletter[]);
        setTotal(typeof meta?.total === 'number' ? meta.total : rows.length);
        setCounts(meta?.status_counts ?? null);
        ok = true;
      }
    } catch {
      // Falls through to the "couldn't load" card below.
    }
    if (request !== latestRequest.current) return;
    if (!ok) setItems([]);
    setLoadFailed(!ok);
    setLoading(false);
  }, [page, status, search, sort]);

  useEffect(() => { void loadData(); }, [loadData]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await adminNewsletters.delete(deleteTarget.id);
      if (res.success) {
        toast.success(t('newsletters.newsletter_deleted'));
        setDeleteTarget(null);
        void loadData();
      } else {
        toast.error(t('newsletters.failed_to_delete_newsletter'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_delete_newsletter'));
    }
    setDeleting(false);
  };

  const handleDuplicate = useCallback(async (item: Newsletter) => {
    try {
      const res = await adminNewsletters.duplicateNewsletter(item.id);
      if (res.success) {
        toast.success(t('newsletters.newsletter_duplicated_as_draft'));
        void loadData();
      } else {
        toast.error(t('newsletters.failed_to_duplicate_newsletter'));
      }
    } catch {
      toast.error(t('newsletters.failed_to_duplicate_newsletter'));
    }
  }, [loadData, t, toast]);

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
        void loadData();
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

  const openNewsletter = useCallback((item: Newsletter) => {
    navigate(tenantPath(hasResults(item)
      ? `/admin/newsletters/${item.id}/stats`
      : `/admin/newsletters/edit/${item.id}`));
  }, [navigate, tenantPath]);

  const statusLabels = useMemo<Record<Newsletter['status'], string>>(() => ({
    draft: tNav('shared.statuses.draft'),
    scheduled: tNav('shared.statuses.scheduled'),
    sending: t('newsletter_list.status_sending'),
    sent: tNav('shared.statuses.sent'),
    failed: tNav('shared.statuses.failed'),
  }), [t, tNav]);

  const columns = useMemo<Column<Newsletter>[]>(() => {
    const notSent = (
      <span className="text-muted">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{t('newsletter_list.not_sent_yet')}</span>
      </span>
    );

    const rate = (value: number | null, people: number, sent: number) => {
      if (value === null || value === undefined) return notSent;
      return (
        <div className="tabular-nums">
          <p className="font-medium">{formatPercentValue(value)}</p>
          <p className="text-xs text-muted">
            {t('newsletter_list.part_of_whole', { part: formatNumber(people), whole: formatNumber(sent) })}
          </p>
        </div>
      );
    };

    const when = (item: Newsletter) => (item.sent_at
      ? t('newsletter_list.date_sent', { date: formatDateValue(item.sent_at, SHORT_DATE) })
      : item.status === 'scheduled' && item.scheduled_at
        ? t('newsletter_list.date_scheduled', { date: formatDateTime(item.scheduled_at, SHORT_DATE_TIME) })
        : t('newsletter_list.date_created', { date: formatDateValue(item.created_at, SHORT_DATE) }));

    return [
      {
        key: 'subject', label: t('newsletters.col_subject'), sortable: true, isRowHeader: true,
        render: (item) => (
          <div className="min-w-0 max-w-[12rem] xl:max-w-[14rem] 2xl:max-w-[22rem]">
            <p className="truncate font-medium">{item.subject || item.name}</p>
            {item.preview_text ? <p className="truncate text-xs text-muted">{item.preview_text}</p> : null}
            {/* Between a phone (cards, which list the date) and a wide screen (its own column) the date rides here, so the two rates stay on screen. */}
            <p className="hidden text-xs text-muted md:block xl:hidden">{when(item)}</p>
            {item.ab_test_enabled || item.is_recurring ? (
              <div className="mt-1 flex gap-1">
                {item.ab_test_enabled ? <Chip size="sm" color="warning" variant="soft">{t('newsletter_form.ab_test_short')}</Chip> : null}
                {item.is_recurring ? <Chip size="sm" variant="soft">{t('newsletter_form.recurring_label')}</Chip> : null}
              </div>
            ) : null}
          </div>
        ),
      },
      {
        key: 'status', label: t('newsletters.col_status'), sortable: true,
        render: (item) => (
          <Chip size="sm" variant="soft" color={STATUS_COLOR[item.status] ?? 'default'}>
            {statusLabels[item.status] ?? tNav('shared.statuses.unknown')}
          </Chip>
        ),
      },
      {
        key: 'total_sent', label: t('newsletters.col_recipients'), sortable: true,
        render: (item) => {
          if (item.total_sent === 0 && item.total_failed === 0 && item.status !== 'sending') return notSent;
          return (
            <div className="tabular-nums">
              {/* Still going out: how far it has got, e.g. "180 of 412". */}
              <p>
                {item.status === 'sending' && item.total_recipients > 0
                  ? t('newsletter_list.part_of_whole', {
                    part: formatNumber(item.total_sent),
                    whole: formatNumber(item.total_recipients),
                  })
                  : formatNumber(item.total_sent)}
              </p>
              {item.total_failed > 0 ? (
                <p className="text-xs text-danger">
                  {t('newsletter_list.failed_count', { number: formatNumber(item.total_failed) })}
                </p>
              ) : null}
            </div>
          );
        },
      },
      {
        key: 'open_rate', label: t('newsletters.col_open_rate'), sortable: true,
        render: (item) => rate(item.open_rate, item.unique_opens, item.total_sent),
      },
      {
        key: 'click_rate', label: t('newsletters.col_click_rate'), sortable: true,
        render: (item) => rate(item.click_rate, item.unique_clicks, item.total_sent),
      },
      {
        key: 'date', label: t('newsletters.col_date'), sortable: true, hideBelow: 'xl',
        render: (item) => <span className="whitespace-nowrap text-sm text-muted">{when(item)}</span>,
      },
      {
        key: 'actions', label: t('newsletters.col_actions'),
        render: (item) => {
          const unsent = item.status === 'draft' || item.status === 'scheduled';
          const sent = item.status === 'sent';
          return (
            <Dropdown>
              <DropdownTrigger>
                <Button isIconOnly size="sm" variant="tertiary" aria-label={t('newsletters.col_actions')}><MoreVertical size={16} /></Button>
              </DropdownTrigger>
              <DropdownMenu aria-label={t('newsletters.col_actions')} onAction={(key) => {
                if (key === 'edit') navigate(tenantPath(`/admin/newsletters/edit/${item.id}`));
                else if (key === 'stats') navigate(tenantPath(`/admin/newsletters/${item.id}/stats`));
                else if (key === 'activity') navigate(tenantPath(`/admin/newsletters/${item.id}/activity`));
                else if (key === 'duplicate') void handleDuplicate(item);
                else if (key === 'send') setSendTarget(item);
                else if (key === 'resend') setResendTarget(item.id);
                else if (key === 'delete') setDeleteTarget(item);
              }}>
                <DropdownItem key="edit" id="edit" startContent={<Edit aria-hidden="true" size={14} />}>{t('newsletters.edit')}</DropdownItem>
                {unsent
                  ? <DropdownItem key="send" id="send" startContent={<Send aria-hidden="true" size={14} />}>{t('newsletters.send_now')}</DropdownItem>
                  : null}
                {hasResults(item)
                  ? <DropdownItem key="stats" id="stats" startContent={<BarChart3 aria-hidden="true" size={14} />}>{t('newsletters.stats')}</DropdownItem>
                  : null}
                {sent
                  ? <DropdownItem key="activity" id="activity" startContent={<Activity aria-hidden="true" size={14} />}>{t('newsletters.activity_log')}</DropdownItem>
                  : null}
                <DropdownItem key="duplicate" id="duplicate" startContent={<Copy aria-hidden="true" size={14} />}>{t('newsletters.duplicate')}</DropdownItem>
                {sent
                  ? <DropdownItem key="resend" id="resend" startContent={<Send aria-hidden="true" size={14} />}>{t('newsletters.resend_to_non_openers')}</DropdownItem>
                  : null}
                <DropdownItem key="delete" id="delete" startContent={<Trash2 aria-hidden="true" size={14} />} className="text-danger" variant="danger">{t('newsletters.delete')}</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          );
        },
      },
    ];
  }, [t, tNav, statusLabels, navigate, tenantPath, handleDuplicate]);

  const createNewsletter = () => navigate(tenantPath('/admin/newsletters/create'));
  const filtered = search !== '' || status !== 'all';
  const anyRate = items.some((item) => item.open_rate !== null && item.open_rate !== undefined);
  const visibleTabs = STATUS_TABS.filter(
    (key) => !OCCASIONAL_TABS.includes(key) || key === status || (counts?.[key] ?? 0) > 0,
  );

  return (
    <div>
      <PageHeader
        title={t('newsletters.page_title')}
        description={t('newsletter_list.description')}
        actions={
          <Button startContent={<Plus aria-hidden="true" size={16} />} onPress={createNewsletter}>
            {t('newsletters.create_newsletter')}
          </Button>
        }
      />

      <Tabs
        aria-label={t('newsletter_list.tabs_aria')}
        selectedKey={status}
        onSelectionChange={(key) => { setStatus(key as StatusTab); setPage(1); }}
        variant="underlined"
        size="sm"
        className="mb-4"
        // The tabs only choose what the table below shows; they have no panels
        // of their own, and an empty panel is just a gap above the table.
        classNames={{ panel: 'hidden' }}
      >
        {visibleTabs.map((key) => (
          <Tab
            key={key}
            title={
              <div className="flex items-center gap-2">
                <span>{key === 'all' ? t('common.all') : statusLabels[key]}</span>
                {counts ? (
                  <Chip
                    size="sm"
                    variant="soft"
                    color={key === 'failed' ? 'danger' : 'default'}
                    className="tabular-nums"
                  >
                    {formatNumber(counts[key] ?? 0)}
                  </Chip>
                ) : null}
              </div>
            }
          />
        ))}
      </Tabs>

      {loadFailed ? (
        <LoadError title={t('newsletter_list.load_error_title')} onRetry={() => void loadData()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={items}
            isLoading={loading}
            searchPlaceholder={t('newsletters.search_newsletters_placeholder')}
            searchValue={searchText}
            onSearch={setSearchText}
            totalItems={total}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={setPage}
            onRefresh={() => void loadData()}
            sortDescriptor={sort}
            onSortChange={(column, direction) => { setSort({ column, direction }); setPage(1); }}
            onRowClick={openNewsletter}
            stickyActions
            mobileCards
            emptyContent={
              filtered ? (
                <div className="flex flex-col items-center gap-1 py-8 text-muted">
                  <SearchX aria-hidden="true" size={36} />
                  <p className="mt-1 font-medium text-foreground">{t('newsletter_list.no_match_title')}</p>
                  <p className="text-sm">{t('newsletter_list.no_match_text')}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-1 py-8 text-muted">
                  <Mail aria-hidden="true" size={36} />
                  <p className="mt-1 font-medium text-foreground">{t('newsletter_list.empty_title')}</p>
                  <p className="text-sm">{t('newsletter_list.empty_text')}</p>
                  <Button size="sm" className="mt-3" startContent={<Plus aria-hidden="true" size={14} />} onPress={createNewsletter}>
                    {t('newsletters.create_newsletter')}
                  </Button>
                </div>
              )
            }
          />
          {anyRate ? <p className="mt-3 max-w-3xl text-xs text-muted">{t('newsletter_list.opens_hint')}</p> : null}
        </>
      )}

      {/* Automatic policy notices are a different kind of email, so they sit under the newsletters, not above them. */}
      <div className="mt-10">
        <PolicyEmailActivity />
      </div>

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
