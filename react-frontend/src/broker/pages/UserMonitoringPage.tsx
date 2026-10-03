// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * User Monitoring
 * View users currently under messaging monitoring restrictions.
 * Parity: PHP BrokerControlsController::monitoring()
 *
 * Broker design language: BrokerPageShell frame, KPI header derived from
 * the loaded list (total / messaging disabled / expiring soon) with each card
 * linking to the matching tab, a search box and tabs over the loaded rows,
 * member names that open the panel-wide member window, expiry countdown
 * chips, an Extend action per row, and honest skeleton / empty / error
 * states. The add/edit modal lives in `components/monitoring/`.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Button, Input, Avatar, Chip, Tabs, Tab, useConfirm } from '@/components/ui';
import Eye from 'lucide-react/icons/eye';
import MessageCircleOff from 'lucide-react/icons/message-circle-off';
import UserPlus from 'lucide-react/icons/user-plus';
import UserMinus from 'lucide-react/icons/user-minus';
import Pencil from 'lucide-react/icons/pencil';
import Search from 'lucide-react/icons/search';
import SearchX from 'lucide-react/icons/search-x';
import Clock from 'lucide-react/icons/clock';
import CalendarPlus from 'lucide-react/icons/calendar-plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import AlertCircle from 'lucide-react/icons/circle-alert';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { getFormattingLocale } from '@/lib/helpers';
import { parseServerTimestamp, formatServerDate } from '@/lib/serverTime';
import { adminBroker } from '@/admin/api/adminApi';
import { DataTable, ConfirmModal, type Column } from '@/admin/components';
import type { MonitoredUser } from '@/admin/api/types';
import { MemberName } from '@/broker/BrokerMemberWindow';
import { useBrokerAutoRefresh } from '@/broker/useBrokerAutoRefresh';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
} from '../components';
import {
  MonitoringFormModal,
  MONITORING_TABS,
  EXTEND_DAYS,
  EXPIRING_SOON_DAYS,
  expiryState,
  isExpiringSoon,
  filterMonitoredUsers,
  type MonitoringTab,
} from '../components/monitoring';

export function UserMonitoring() {
  const { t } = useTranslation('broker');
  usePageTitle(t('monitoring.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();
  const confirm = useConfirm();

  // The tab is mirrored to `?tab=` so the KPI cards can link to it.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab') as MonitoringTab | null;
  const tab: MonitoringTab = urlTab && MONITORING_TABS.includes(urlTab) ? urlTab : 'all';
  const setTab = useCallback(
    (next: MonitoringTab) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next === 'all') params.delete('tab');
          else params.set('tab', next);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const [items, setItems] = useState<MonitoredUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState('');

  const [modal, setModal] = useState<{ open: boolean; editing: MonitoredUser | null }>({ open: false, editing: null });
  const [removingId, setRemovingId] = useState<number | null>(null);
  const [extendingId, setExtendingId] = useState<number | null>(null);
  const [confirmRemoveUserId, setConfirmRemoveUserId] = useState<number | null>(null);

  // Stash the latest `t` and `toast` in refs so loadItems' identity is stable —
  // keying the fetch effect on them would refetch on every language switch.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  // `quiet` is the auto-refresh path: no spinner, no toast.
  const loadItems = useCallback(async (opts: { quiet?: boolean } = {}) => {
    if (!opts.quiet) setLoading(true);
    setLoadError(false);
    try {
      const res = await adminBroker.getMonitoring();
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data);
      } else {
        // A malformed or failed response must not masquerade as "all clear".
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
      if (!opts.quiet) toastRef.current.error(tRef.current('monitoring.load_failed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useBrokerAutoRefresh(() => loadItems({ quiet: true }));

  const handleRemoveMonitoring = async (userId: number) => {
    setRemovingId(userId);
    try {
      const res = await adminBroker.setMonitoring(userId, { under_monitoring: false });
      if (res?.success) {
        toast.success(t('monitoring.remove_success'));
        loadItems();
      } else {
        toast.error(res?.error || t('monitoring.remove_failed'));
      }
    } catch {
      toast.error(t('monitoring.remove_failed'));
    } finally {
      setRemovingId(null);
    }
  };

  // Extend pushes the expiry to EXTEND_DAYS from today, keeping the reason
  // and the messaging setting. `setMonitoring` upserts, so this is the same
  // call the edit modal makes with a new duration.
  const handleExtend = async (item: MonitoredUser) => {
    const ok = await confirm({
      title: t('monitoring.extend_confirm_title'),
      body: t('monitoring.extend_confirm_body', { name: item.user_name, days: EXTEND_DAYS }),
      confirmLabel: t('monitoring.extend_confirm_confirm'),
      status: 'warning',
    });
    if (!ok) return;
    setExtendingId(item.user_id);
    try {
      const res = await adminBroker.setMonitoring(item.user_id, {
        under_monitoring: true,
        reason: item.monitoring_reason || undefined,
        messaging_disabled: !!item.messaging_disabled,
        expires_days: EXTEND_DAYS,
      });
      if (res?.success) {
        toast.success(t('monitoring.extend_success'));
        loadItems({ quiet: true });
      } else {
        toast.error(res?.error || t('monitoring.extend_failed'));
      }
    } catch {
      toast.error(t('monitoring.extend_failed'));
    } finally {
      setExtendingId(null);
    }
  };

  // ── KPI header — derived entirely from the already-loaded list ─────────────
  const initialLoading = loading && items.length === 0;
  const messagingDisabledCount = items.filter((i) => !!i.messaging_disabled).length;
  const expiringSoonCount = items.filter(isExpiringSoon).length;

  const visibleItems = useMemo(() => filterMonitoredUsers(items, tab, search), [items, tab, search]);

  const columns: Column<MonitoredUser>[] = [
    {
      key: 'user_name',
      label: t('monitoring.col_user'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-0 items-center gap-3">
          <Avatar name={item.user_name} size="sm" className="shrink-0" />
          <MemberName userId={item.user_id} name={item.user_name} className="text-sm" />
        </div>
      ),
    },
    {
      key: 'under_monitoring',
      label: t('monitoring.col_status'),
      render: (item) => (
        <div className="flex flex-wrap gap-1">
          <Chip size="sm" variant="soft" color={item.under_monitoring ? 'warning' : 'default'}>
            <Eye size={12} aria-hidden="true" />
            <Chip.Label>{t('monitoring.status_monitored')}</Chip.Label>
          </Chip>
          {item.messaging_disabled && (
            <Chip size="sm" variant="soft" color="danger">
              <MessageCircleOff size={12} aria-hidden="true" />
              <Chip.Label>{t('monitoring.status_messaging_off')}</Chip.Label>
            </Chip>
          )}
        </div>
      ),
    },
    {
      key: 'monitoring_reason',
      label: t('monitoring.col_reason'),
      render: (item) =>
        item.monitoring_reason ? (
          <p
            className="line-clamp-2 min-w-[12rem] max-w-md whitespace-normal break-words text-sm leading-5 text-foreground/80"
            title={item.monitoring_reason}
          >
            {item.monitoring_reason}
          </p>
        ) : (
          <span className="text-sm text-muted">—</span>
        ),
    },
    {
      key: 'monitoring_started_at',
      label: t('monitoring.col_started'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {item.monitoring_started_at ? formatServerDate(item.monitoring_started_at) : '—'}
        </span>
      ),
    },
    {
      key: 'monitoring_expires_at',
      label: t('monitoring.col_expires'),
      sortable: true,
      render: (item) => {
        const expiresAt = parseServerTimestamp(item.monitoring_expires_at);
        if (!expiresAt) {
          return <span className="text-sm text-muted">{t('monitoring.no_expiry')}</span>;
        }
        const { days, state } = expiryState(expiresAt);
        return (
          <div className="flex min-w-[7rem] flex-col items-start gap-1">
            <Chip
              size="sm"
              variant="soft"
              color={state === 'expired' ? 'danger' : state === 'soon' ? 'warning' : 'default'}
              className="tabular-nums"
            >
              <Clock size={12} aria-hidden="true" />
              <Chip.Label>
                {state === 'expired'
                  ? t('status.expired')
                  : t('monitoring.expiry_days_left', { count: days })}
              </Chip.Label>
            </Chip>
            <span className="text-xs tabular-nums text-muted">
              {expiresAt.toLocaleDateString(getFormattingLocale())}
            </span>
          </div>
        );
      },
    },
    {
      key: 'actions',
      label: t('monitoring.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setModal({ open: true, editing: item })}
            aria-label={t('monitoring.edit_aria')}
          >
            <Pencil size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => handleExtend(item)}
            isPending={extendingId === item.user_id}
            aria-label={t('monitoring.extend_aria')}
          >
            <CalendarPlus size={14} />
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            onPress={() => setConfirmRemoveUserId(item.user_id)}
            isPending={removingId === item.user_id}
            aria-label={t('monitoring.remove_aria')}
          >
            <UserMinus size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const openAdd = () => setModal({ open: true, editing: null });

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_safeguarding', articleId: 'broker_user_monitoring' }}
      title={t('monitoring.page_title')}
      description={t('monitoring.page_description')}
      icon={Eye}
      color="warning"
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            startContent={<RefreshCw size={16} aria-hidden="true" />}
            onPress={() => loadItems()}
            isPending={loading && items.length > 0}
          >
            {t('common.refresh')}
          </Button>
          <Button variant="primary" startContent={<UserPlus size={16} />} size="sm" onPress={openAdd}>
            {t('monitoring.add_button')}
          </Button>
        </>
      }
    >
      {loadError && items.length === 0 ? (
        // Honest failure state — a load error must never render as an
        // "all clear" queue.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('monitoring.load_error_title')}
          hint={t('monitoring.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={() => loadItems()}>
              {t('monitoring.retry_button')}
            </Button>
          }
        />
      ) : (
        <>
          {/* KPI header — who is monitored, how tightly, and what lapses next */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <BrokerStatCard
              label={t('monitoring.stat_total')}
              value={items.length}
              icon={Eye}
              color="warning"
              loading={initialLoading}
              to={tenantPath('/broker/monitoring')}
            />
            <BrokerStatCard
              label={t('monitoring.status_messaging_off')}
              value={messagingDisabledCount}
              icon={MessageCircleOff}
              color="danger"
              loading={initialLoading}
              to={tenantPath('/broker/monitoring?tab=messaging_off')}
            />
            <BrokerStatCard
              label={t('monitoring.stat_expiring_soon')}
              value={expiringSoonCount}
              icon={Clock}
              color="warning"
              loading={initialLoading}
              to={tenantPath('/broker/monitoring?tab=expiring_soon')}
            />
          </div>

          {initialLoading ? (
            <BrokerSkeleton variant="table" count={4} />
          ) : items.length === 0 ? (
            <BrokerEmptyState
              icon={ShieldCheck}
              color="success"
              title={t('monitoring.empty_all_clear_title')}
              hint={t('monitoring.empty_all_clear_hint')}
              action={
                <Button size="sm" variant="primary" startContent={<UserPlus size={14} />} onPress={openAdd}>
                  {t('monitoring.add_button')}
                </Button>
              }
            />
          ) : (
            <>
              {/* Search + tabs over the loaded rows */}
              <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
                <div className="flex flex-col gap-2">
                  <Input
                    placeholder={t('monitoring.search_placeholder')}
                    aria-label={t('monitoring.search_aria')}
                    value={search}
                    onValueChange={setSearch}
                    startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
                    variant="secondary"
                    size="sm"
                    className="max-w-md"
                    isClearable
                    onClear={() => setSearch('')}
                  />
                  <Tabs
                    aria-label={t('monitoring.tabs_aria')}
                    selectedKey={tab}
                    onSelectionChange={(key) => setTab(key as MonitoringTab)}
                    variant="underlined"
                    size="sm"
                  >
                    <Tab key="all" title={t('monitoring.tab_all')} />
                    <Tab
                      key="messaging_off"
                      title={
                        <div className="flex items-center gap-2">
                          <span>{t('monitoring.tab_messaging_off')}</span>
                          {messagingDisabledCount > 0 && (
                            <Chip size="sm" variant="soft" color="danger" className="tabular-nums">
                              {messagingDisabledCount}
                            </Chip>
                          )}
                        </div>
                      }
                    />
                    <Tab
                      key="expiring_soon"
                      title={
                        <div className="flex items-center gap-2">
                          <span>{t('monitoring.tab_expiring_soon', { days: EXPIRING_SOON_DAYS })}</span>
                          {expiringSoonCount > 0 && (
                            <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                              {expiringSoonCount}
                            </Chip>
                          )}
                        </div>
                      }
                    />
                  </Tabs>
                </div>
              </div>

              <DataTable
                stickyActions
                mobileCards
                columns={columns}
                data={visibleItems}
                isLoading={loading}
                searchable={false}
                onRefresh={() => loadItems()}
                emptyContent={
                  <BrokerEmptyState
                    bare
                    icon={SearchX}
                    color="neutral"
                    title={t('monitoring.empty_filter_title')}
                    hint={t('monitoring.empty_filter_hint')}
                  />
                }
              />
            </>
          )}
        </>
      )}

      <MonitoringFormModal
        isOpen={modal.open}
        editingItem={modal.editing}
        onClose={() => setModal((prev) => ({ ...prev, open: false }))}
        onSaved={() => loadItems()}
      />

      <ConfirmModal
        isOpen={confirmRemoveUserId !== null}
        onClose={() => setConfirmRemoveUserId(null)}
        onConfirm={() => {
          if (confirmRemoveUserId !== null) {
            handleRemoveMonitoring(confirmRemoveUserId);
          }
          setConfirmRemoveUserId(null);
        }}
        title={t('monitoring.confirm_remove_title')}
        message={t('monitoring.confirm_remove')}
        confirmLabel={t('monitoring.confirm_remove_confirm')}
        cancelLabel={t('common.cancel')}
        isLoading={removingId !== null}
      />
    </BrokerPageShell>
  );
}

export default UserMonitoring;
