// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Exchange Management
 * List and manage exchange requests with approve/reject actions,
 * restyled to the broker design language: KPI header, deep-linkable
 * status tabs, party avatars, BrokerStatusChip statuses.
 * Parity: PHP BrokerControlsController::exchanges()
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import ArrowRight from 'lucide-react/icons/arrow-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import CheckCheck from 'lucide-react/icons/check-check';
import XCircle from 'lucide-react/icons/circle-x';
import AlertCircle from 'lucide-react/icons/circle-alert';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Ban from 'lucide-react/icons/ban';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import Hourglass from 'lucide-react/icons/hourglass';
import Inbox from 'lucide-react/icons/inbox';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import Users from 'lucide-react/icons/users';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { ExchangeRequest } from '@/admin/api/types';
import {
  Button,
  Chip,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Tabs,
  Tab,
  Avatar,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';

type ActionType = 'approve' | 'reject';

// Status filter is mirrored to `?status=` so stat-card deep-links and
// browser back/forward work as expected. `needs_action` is not a real status:
// the API expands it to pending_broker + disputed, the same set the broker
// dashboard's "Pending Exchanges" card counts and links here with.
const EXCHANGE_STATUSES = [
  'all', 'needs_action', 'pending_broker', 'accepted', 'in_progress', 'completed', 'cancelled', 'disputed',
] as const;

/** Reads the paginated total out of a getExchanges response (same meta shape the list load uses). */
function readTotal(res: Awaited<ReturnType<typeof adminBroker.getExchanges>>): number | null {
  if (!res.success || !Array.isArray(res.data)) return null;
  const meta = res.meta as Record<string, unknown> | undefined;
  const value = Number(meta?.total ?? meta?.total_items ?? res.data.length);
  return Number.isFinite(value) ? value : null;
}

export function ExchangeManagement() {
  const { t } = useTranslation('broker');
  usePageTitle(t('exchanges.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') as ExchangeStatus | null;
  const status: ExchangeStatus =
    urlStatus && EXCHANGE_STATUSES.includes(urlStatus) ? urlStatus : 'all';
  const setStatus = useCallback(
    (next: ExchangeStatus) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') {
            params.delete('status');
          } else {
            params.set('status', next);
          }
          return params;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const [items, setItems] = useState<ExchangeRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);

  // KPI header state. There is no dedicated exchange-stats endpoint, so the
  // header reuses the page's own list endpoint: one unfiltered probe for the
  // grand total, one pending_broker probe for the review queue and one
  // needs_action probe for the tab badge, reading only meta.total from each.
  const [stats, setStats] = useState<{
    total: number | null;
    pending: number | null;
    needsAction: number | null;
  }>({
    total: null,
    pending: null,
    needsAction: null,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Action modal state
  const [actionModal, setActionModal] = useState<{
    type: ActionType;
    item: ExchangeRequest;
  } | null>(null);
  const [actionText, setActionText] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Stash the latest `t`/`toast` in refs so the fetch callbacks key on the
  // page/status params only — otherwise a language switch (or an unstable
  // toast identity) would refetch the whole list for no reason.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getExchanges({
        page,
        status: status === 'all' ? undefined : status,
      });
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data as ExchangeRequest[]);
        const meta = res.meta as Record<string, unknown> | undefined;
        setTotal(Number(meta?.total ?? meta?.total_items ?? res.data.length));
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      toastRef.current.error(tRef.current('exchanges.load_failed'));
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [page, status]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [allRes, pendingRes, needsActionRes] = await Promise.all([
        adminBroker.getExchanges({ page: 1 }),
        adminBroker.getExchanges({ page: 1, status: 'pending_broker' }),
        adminBroker.getExchanges({ page: 1, status: 'needs_action' }),
      ]);
      setStats({
        total: readTotal(allRes),
        pending: readTotal(pendingRes),
        needsAction: readTotal(needsActionRes),
      });
    } catch {
      // KPI header degrades to em-dashes; the list load owns error messaging.
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const refreshAll = () => {
    loadItems();
    loadStats();
  };

  const handleAction = async () => {
    if (!actionModal) return;
    const { type, item } = actionModal;

    if (type === 'reject' && !actionText.trim()) {
      toast.error(t('exchanges.reason_required_error'));
      return;
    }

    setActionLoading(true);
    try {
      const res = type === 'approve'
        ? await adminBroker.approveExchange(item.id, actionText || undefined)
        : await adminBroker.rejectExchange(item.id, actionText);

      if (res?.success) {
        toast.success(t('exchanges.action_succeeded'));
        refreshAll();
      } else {
        toast.error(res?.error || t('exchanges.action_failed'));
      }
    } catch {
      toast.error(t('exchanges.action_failed'));
    } finally {
      setActionLoading(false);
      setActionModal(null);
      setActionText('');
    }
  };

  const openActionModal = (type: ActionType, item: ExchangeRequest) => {
    setActionModal({ type, item });
    setActionText('');
  };

  const columns: Column<ExchangeRequest>[] = [
    {
      key: 'parties',
      label: t('exchanges.col_parties'),
      render: (item) => (
        <div className="flex min-w-0 items-center gap-2">
          <Avatar name={item.requester_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{item.requester_name}</p>
            <p className="truncate text-xs text-muted">{t('exchanges.col_requester')}</p>
          </div>
          <ArrowRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
          <Avatar name={item.provider_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{item.provider_name}</p>
            <p className="truncate text-xs text-muted">{t('exchanges.col_provider')}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'listing_title',
      label: t('exchanges.col_listing'),
      sortable: true,
      render: (item) => (
        <span className="block max-w-[220px] truncate text-sm text-foreground/70">
          {item.listing_title || '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('exchanges.col_status'),
      sortable: true,
      render: (item) => <BrokerStatusChip status={item.status} />,
    },
    {
      key: 'final_hours',
      label: t('exchanges.col_hours'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-foreground">
          {item.final_hours != null ? `${item.final_hours}h` : '—'}
        </span>
      ),
    },
    {
      key: 'created_at',
      label: t('exchanges.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {formatServerDate(item.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('exchanges.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            as={Link}
            to={tenantPath(`/broker/exchanges/${item.id}`)}
            aria-label={t('exchanges.view_details_aria')}
          >
            <Eye size={14} />
          </Button>
          {item.status === 'pending_broker' && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                onPress={() => openActionModal('approve', item)}
                aria-label={t('exchanges.approve_aria')}
              >
                <CheckCircle size={14} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger"
                onPress={() => openActionModal('reject', item)}
                aria-label={t('exchanges.reject_aria')}
              >
                <XCircle size={14} />
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_exchanges', articleId: 'broker_exchange_list' }}
      title={t('exchanges.title')}
      description={t('exchanges.description')}
      icon={ArrowLeftRight}
      color="accent"
      actions={
        <>
          <Button
            variant="tertiary"
            size="sm"
            startContent={<RefreshCw size={16} />}
            onPress={refreshAll}
            isLoading={loading && statsLoading}
          >
            {t('common.refresh')}
          </Button>
        </>
      }
    >
      {/* KPI header — deep-links into the matching filtered view */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('exchanges.stat_total')}
          value={stats.total}
          icon={ArrowLeftRight}
          color="accent"
          loading={statsLoading}
          description={t('exchanges.stat_total_hint')}
          to={tenantPath('/broker/exchanges')}
        />
        <BrokerStatCard
          label={t('exchanges.stat_pending')}
          value={stats.pending}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          description={t('exchanges.stat_pending_hint')}
          to={tenantPath('/broker/exchanges?status=pending_broker')}
        />
      </div>

      {/* Status tabs — deep-linkable via ?status= */}
      <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <Tabs
          aria-label={t('exchanges.tabs_aria')}
          selectedKey={status}
          onSelectionChange={(key) => { setStatus(key as ExchangeStatus); setPage(1); }}
          variant="underlined"
          size="sm"
        >
          <Tab
            key="all"
            title={
              <div className="flex items-center gap-2">
                <Users size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_all')}</span>
              </div>
            }
          />
          <Tab
            key="needs_action"
            title={
              <div className="flex items-center gap-2">
                <AlertCircle size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_needs_action')}</span>
                {stats.needsAction != null && stats.needsAction > 0 && (
                  <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                    {stats.needsAction}
                  </Chip>
                )}
              </div>
            }
          />
          <Tab
            key="pending_broker"
            title={
              <div className="flex items-center gap-2">
                <Clock size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_pending_broker')}</span>
                {stats.pending != null && stats.pending > 0 && (
                  <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                    {stats.pending}
                  </Chip>
                )}
              </div>
            }
          />
          <Tab
            key="accepted"
            title={
              <div className="flex items-center gap-2">
                <CheckCircle size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_accepted')}</span>
              </div>
            }
          />
          <Tab
            key="in_progress"
            title={
              <div className="flex items-center gap-2">
                <Hourglass size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_in_progress')}</span>
              </div>
            }
          />
          <Tab
            key="completed"
            title={
              <div className="flex items-center gap-2">
                <CheckCheck size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_completed')}</span>
              </div>
            }
          />
          <Tab
            key="cancelled"
            title={
              <div className="flex items-center gap-2">
                <Ban size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_cancelled')}</span>
              </div>
            }
          />
          <Tab
            key="disputed"
            title={
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} aria-hidden="true" />
                <span>{t('exchanges.tab_disputed')}</span>
              </div>
            }
          />
        </Tabs>
      </div>

      {initialLoad ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && items.length === 0 ? (
        // Honest failure state — an errored load must never masquerade as an
        // empty-but-healthy queue.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('exchanges.load_error_title')}
          hint={t('exchanges.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={refreshAll}>
              {t('common.refresh')}
            </Button>
          }
        />
      ) : (
        <DataTable
          stickyActions
          mobileCards
          columns={columns}
          data={items}
          isLoading={loading}
          searchable={false}
          onRefresh={refreshAll}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          emptyContent={
            <BrokerEmptyState
              bare
              icon={status === 'pending_broker' || status === 'needs_action' ? Sparkles : Inbox}
              color={status === 'pending_broker' || status === 'needs_action' ? 'success' : 'neutral'}
              title={
                status === 'needs_action'
                  ? t('exchanges.empty_needs_action_title')
                  : status === 'pending_broker'
                    ? t('exchanges.empty_pending_title')
                    : t('exchanges.no_exchanges')
              }
              hint={
                status === 'needs_action'
                  ? t('exchanges.empty_needs_action_hint')
                  : status === 'pending_broker'
                    ? t('exchanges.empty_pending_hint')
                    : t('exchanges.empty_hint')
              }
            />
          }
        />
      )}

      {/* Approve/Reject Modal */}
      {actionModal && (
        <Modal isOpen={!!actionModal} onClose={() => { setActionModal(null); setActionText(''); }} size="md">
          <ModalContent>
            <ModalHeader className="flex items-center gap-2">
              {actionModal.type === 'approve' ? (
                <>
                  <CheckCircle size={20} className="text-success" aria-hidden="true" />
                  {t('exchanges.approve_modal_title')}
                </>
              ) : (
                <>
                  <XCircle size={20} className="text-danger" aria-hidden="true" />
                  {t('exchanges.reject_modal_title')}
                </>
              )}
            </ModalHeader>
            <ModalBody>
              <p className="text-foreground/70 mb-3">
                {actionModal.type === 'approve'
                  ? t('exchanges.approve_confirm_text')
                  : t('exchanges.reject_confirm_text')
                }
              </p>
              <Textarea
                label={actionModal.type === 'approve' ? t('exchanges.notes_optional_label') : t('exchanges.reason_required_label')}
                placeholder={actionModal.type === 'approve'
                  ? t('exchanges.approval_notes_placeholder')
                  : t('exchanges.rejection_reason_placeholder')
                }
                value={actionText}
                onValueChange={setActionText}
                minRows={3}
                variant="secondary"
                isRequired={actionModal.type === 'reject'}
              />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="tertiary"
                onPress={() => { setActionModal(null); setActionText(''); }}
                isDisabled={actionLoading}
              >
                {t('common.cancel')}
              </Button>
              {actionModal.type === 'approve' ? (
                <Button color="success" onPress={handleAction} isLoading={actionLoading}>
                  {t('exchanges.approve')}
                </Button>
              ) : (
                <Button variant="danger" onPress={handleAction} isLoading={actionLoading}>
                  {t('exchanges.reject')}
                </Button>
              )}
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}
    </BrokerPageShell>
  );
}

export default ExchangeManagement;
