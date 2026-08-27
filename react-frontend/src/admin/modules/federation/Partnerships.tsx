// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Partnerships
 * Lists and manages federation partnerships with other communities.
 * Features: Counter-proposals, detail drawer, permissions matrix, audit timeline, * incoming requests tab, partnership statistics.
 */

import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Ban from 'lucide-react/icons/ban';
import BarChart3 from 'lucide-react/icons/chart-column';
import Calendar from 'lucide-react/icons/calendar';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Eye from 'lucide-react/icons/eye';
import Handshake from 'lucide-react/icons/handshake';
import Inbox from 'lucide-react/icons/inbox';
import Mail from 'lucide-react/icons/mail';
import MessageSquare from 'lucide-react/icons/message-square';
import MoreVertical from 'lucide-react/icons/ellipsis-vertical';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Users from 'lucide-react/icons/users';
import UsersRound from 'lucide-react/icons/users-round';
import XCircle from 'lucide-react/icons/circle-x';
import { useTranslation } from 'react-i18next';

import { BrokerEmptyState } from '@/broker/components';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { logError } from '@/lib/logger';
import { Button, Card, CardBody, CardHeader, Chip, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Select, SelectItem, Spinner, Textarea, useDisclosure, Switch, Tab, Tabs } from '@/components/ui';
import { adminFederation } from '../../api/adminApi';
import { ConfirmModal } from '../../components/ConfirmModal';
import { DataTable, StatusBadge, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { PageHeader } from '../../components/PageHeader';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Partnership {
  id: number;
  tenant_id: number;
  partner_tenant_id: number;
  partner_name: string;
  partner_slug: string;
  status: string;
  federation_level?: number;
  profiles_enabled?: number;
  messaging_enabled?: number;
  transactions_enabled?: number;
  listings_enabled?: number;
  events_enabled?: number;
  groups_enabled?: number;
  counter_proposed_at?: string;
  counter_proposed_by?: number;
  counter_proposal_message?: string;
  counter_proposed_level?: number;
  counter_proposed_permissions?: string;
  created_at: string;
  updated_at?: string;
  requested_at?: string;
  notes?: string;
}

interface PartnershipDetail extends Partnership {
  is_initiator: boolean;
  resolved_partner_tenant_id: number;
  resolved_partner_name: string;
  tenant_name?: string;
  partner_domain?: string;
  tenant_domain?: string;
  approved_at?: string;
}

interface AuditLogEntry {
  id: number;
  action: string;
  category: string;
  level: string;
  actor_user_id: number | null;
  first_name: string | null;
  last_name: string | null;
  source_tenant_id: number | null;
  target_tenant_id: number | null;
  details: string | null;
  created_at: string;
}

interface PartnershipStats {
  messages_exchanged: number;
  transactions_completed: number;
  connections_made: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const LEVEL_LABEL_KEYS: Record<number, string> = {
  1: 'federation.level_discovery',
  2: 'federation.level_social',
  3: 'federation.level_economic',
  4: 'federation.level_integrated',
};

const LEVEL_DESCRIPTION_KEYS: Record<number, string> = {
  1: 'federation.level_desc_discovery',
  2: 'federation.level_desc_social',
  3: 'federation.level_desc_economic',
  4: 'federation.level_desc_integrated',
};

const PERMISSION_KEYS = ['profiles', 'messaging', 'transactions', 'listings', 'events', 'groups'] as const;

const PERMISSION_ICONS: Record<string, typeof Users> = {
  profiles: Users,
  messaging: Mail,
  transactions: ArrowLeftRight,
  listings: ShoppingBag,
  events: Calendar,
  groups: UsersRound,
};

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function Partnerships() {
  const { t } = useTranslation('admin_federation');
  usePageTitle(t('federation.page_title'));
  const toast = useToast();

  const [items, setItems] = useState<Partnership[]>([]);
  const [loading, setLoading] = useState(true);
  const [terminateTarget, setTerminateTarget] = useState<Partnership | null>(null);
  const [approveTarget, setApproveTarget] = useState<Partnership | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Partnership | null>(null);
  const [reactivateTarget, setReactivateTarget] = useState<Partnership | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<string>('all');

  // Detail modal
  const detailModal = useDisclosure();
  const [detailPartnership, setDetailPartnership] = useState<PartnershipDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<string>('info');
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [stats, setStats] = useState<PartnershipStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [permissionsLoading, setPermissionsLoading] = useState(false);

  // Bulk selection
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  // Counter-proposal modal
  const counterModal = useDisclosure();
  const [counterTarget, setCounterTarget] = useState<Partnership | null>(null);
  const [counterLevel, setCounterLevel] = useState('1');
  const [counterPermissions, setCounterPermissions] = useState<Record<string, boolean>>({
    profiles: true, messaging: false, transactions: false, listings: false, events: false, groups: false,
  });
  const [counterMessage, setCounterMessage] = useState('');
  const [counterLoading, setCounterLoading] = useState(false);

  // AbortController for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Load data ───
  const loadData = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const res = await adminFederation.getPartnerships();
      if (controller.signal.aborted) return;
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setItems(payload);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setItems((payload as { data: Partnership[] }).data || []);
        }
      }
    } catch {
      if (!controller.signal.aborted) {
        setItems([]);
      }
    }
    if (!controller.signal.aborted) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    return () => { abortControllerRef.current?.abort(); };
  }, [loadData]);

  // ─── Filtered items ───
  const incomingRequests = useMemo(() =>
    items.filter(p => p.status === 'pending'),
    [items]
  );

  const filteredItems = useMemo(() => {
    if (activeTab === 'incoming') return incomingRequests;
    if (activeTab === 'active') return items.filter(p => p.status === 'active');
    return items;
  }, [items, activeTab, incomingRequests]);

  // ─── Actions ───
  const confirmApprove = async () => {
    if (!approveTarget) return;
    setActionLoading(true);
    try {
      const res = await adminFederation.approvePartnership(approveTarget.id);
      if (res.success) {
        toast.success(t('federation.partnership_approved'));
        loadData();
      } else {
        toast.error(t('federation.failed_to_approve_partnership'));
      }
    } catch {
      toast.error(t('federation.failed_to_approve_partnership'));
    } finally {
      setActionLoading(false);
      setApproveTarget(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    setActionLoading(true);
    try {
      const res = await adminFederation.rejectPartnership(rejectTarget.id);
      if (res.success) {
        toast.success(t('federation.partnership_rejected'));
        loadData();
      } else {
        toast.error(t('federation.failed_to_reject_partnership'));
      }
    } catch {
      toast.error(t('federation.failed_to_reject_partnership'));
    } finally {
      setActionLoading(false);
      setRejectTarget(null);
    }
  };

  const handleTerminate = async () => {
    if (!terminateTarget) return;
    setActionLoading(true);
    try {
      const res = await adminFederation.terminatePartnership(terminateTarget.id);
      if (res.success) {
        toast.success(t('federation.partnership_terminated'));
        setTerminateTarget(null);
        loadData();
      } else {
        toast.error(t('federation.failed_to_terminate_partnership'));
      }
    } catch {
      toast.error(t('federation.failed_to_terminate_partnership'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async () => {
    if (!reactivateTarget) return;
    setActionLoading(true);
    try {
      const res = await adminFederation.reactivatePartnership(reactivateTarget.id);
      if (res.success) {
        toast.success(t('federation.partnership_reactivated'));
        setReactivateTarget(null);
        loadData();
      } else {
        toast.error(t('federation.failed_to_reactivate_partnership'));
      }
    } catch {
      toast.error(t('federation.failed_to_reactivate_partnership'));
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Bulk actions ───
  const selectedPendingItems = useMemo(() => {
    if (selectedKeys.size === 0) return [];
    return filteredItems.filter(p => selectedKeys.has(String(p.id)) && p.status === 'pending');
  }, [selectedKeys, filteredItems]);

  const handleBulkApprove = async () => {
    if (selectedPendingItems.length === 0) return;
    setActionLoading(true);
    let successCount = 0;
    for (const item of selectedPendingItems) {
      try {
        const res = await adminFederation.approvePartnership(item.id);
        if (res.success) successCount++;
      } catch { /* continue */ }
    }
    toast.success(t('federation.partnerships.bulk_approved_count', { count: successCount }));
    setSelectedKeys(new Set());
    loadData();
    setActionLoading(false);
  };

  const handleBulkReject = async () => {
    if (selectedPendingItems.length === 0) return;
    setActionLoading(true);
    let successCount = 0;
    for (const item of selectedPendingItems) {
      try {
        const res = await adminFederation.rejectPartnership(item.id);
        if (res.success) successCount++;
      } catch { /* continue */ }
    }
    toast.success(t('federation.partnerships.bulk_rejected_count', { count: successCount }));
    setSelectedKeys(new Set());
    loadData();
    setActionLoading(false);
  };

  // ─── Counter-propose ───
  const openCounterProposal = (item: Partnership) => {
    setCounterTarget(item);
    setCounterLevel(String(item.federation_level || 1));
    setCounterPermissions({
      profiles: true, messaging: false, transactions: false,
      listings: false, events: false, groups: false,
    });
    setCounterMessage('');
    counterModal.onOpen();
  };

  const handleCounterPropose = async () => {
    if (!counterTarget) return;
    setCounterLoading(true);
    try {
      const res = await adminFederation.counterProposePartnership(counterTarget.id, {
        level: parseInt(counterLevel),
        permissions: counterPermissions,
        message: counterMessage || undefined,
      });
      if (res.success) {
        toast.success(t('federation.counter_proposal_sent'));
        counterModal.onClose();
        loadData();
      } else {
        toast.error(t('federation.failed_to_counter_propose'));
      }
    } catch {
      toast.error(t('federation.failed_to_counter_propose'));
    } finally {
      setCounterLoading(false);
    }
  };

  // ─── Detail modal ───
  const openDetail = async (item: Partnership) => {
    setDetailPartnership(null);
    setDetailTab('info');
    setAuditLog([]);
    setStats(null);
    detailModal.onOpen();
    setDetailLoading(true);

    try {
      const res = await adminFederation.getPartnershipDetail(item.id);
      if (res.success && res.data) {
        setDetailPartnership(res.data as unknown as PartnershipDetail);
      }
    } catch (err) {
      logError('Partnerships.loadDetail', err);
      toast.error(t('federation.failed_to_load_partnership_detail'));
    } finally {
      setDetailLoading(false);
    }
  };

  const loadAuditLog = async (partnershipId: number) => {
    setAuditLoading(true);
    try {
      const res = await adminFederation.getPartnershipAuditLog(partnershipId);
      if (res.success && res.data) {
        const payload = res.data;
        setAuditLog(Array.isArray(payload) ? (payload as unknown as AuditLogEntry[]) : []);
      }
    } catch (err) {
      logError('Partnerships.loadAuditLog', err);
    } finally {
      setAuditLoading(false);
    }
  };

  const loadStats = async (partnershipId: number) => {
    setStatsLoading(true);
    try {
      const res = await adminFederation.getPartnershipStats(partnershipId);
      if (res.success && res.data) {
        setStats(res.data as unknown as PartnershipStats);
      }
    } catch (err) {
      logError('Partnerships.loadStats', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // Load audit/stats when detail tab changes
  useEffect(() => {
    if (!detailPartnership) return;
    if (detailTab === 'history' && auditLog.length === 0) {
      loadAuditLog(detailPartnership.id);
    }
    if (detailTab === 'stats' && !stats) {
      loadStats(detailPartnership.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lazy load stats tab; loadStats excluded to avoid loop
  }, [detailTab, detailPartnership]);

  // ─── Update permissions ───
  const handlePermissionToggle = async (key: string, value: boolean) => {
    if (!detailPartnership) return;
    setPermissionsLoading(true);
    try {
      const res = await adminFederation.updatePartnershipPermissions(detailPartnership.id, { [key]: value });
      if (res.success) {
        setDetailPartnership(prev => prev ? { ...prev, [`${key}_enabled`]: value ? 1 : 0 } : null);
        toast.success(t('federation.permissions_updated'));
      } else {
        toast.error(t('federation.failed_to_update_permissions'));
      }
    } catch {
      toast.error(t('federation.failed_to_update_permissions'));
    } finally {
      setPermissionsLoading(false);
    }
  };

  // ─── Columns ───
  const columns: Column<Partnership>[] = [
    { key: 'partner_name', label: t('federation.label_partner_community'), sortable: true },
    { key: 'partner_slug', label: t('federation.label_slug') },
    {
      key: 'federation_level', label: t('federation.col_level'),
      render: (item) => (
        <Chip size="sm" variant="soft" color="accent">
          {t(LEVEL_LABEL_KEYS[item.federation_level || 1] || 'federation.level_discovery')}
        </Chip>
      ),
    },
    {
      key: 'status', label: t('federation.label_status'),
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: 'created_at', label: t('federation.col_since'), sortable: true,
      render: (item) => <span className="text-sm text-muted">{item.created_at ? new Date(item.created_at).toLocaleDateString(getFormattingLocale()) : '--'}</span>,
    },
    {
      key: 'actions', label: t('federation.label_actions'),
      render: (item) => (
        <div className="flex items-center gap-1">
          <Button
            isIconOnly size="sm" variant="ghost"
            aria-label={t('federation.label_view_detail')}
            onPress={() => openDetail(item)}
          >
            <Eye size={16} />
          </Button>
          <Dropdown>
            <DropdownTrigger>
              <Button isIconOnly size="sm" variant="ghost" aria-label={t('federation.label_actions')} isDisabled={actionLoading}>
                <MoreVertical size={16} />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label={t('federation.label_partnership_actions')}
              onAction={(key) => {
                if (key === 'approve') setApproveTarget(item);
                else if (key === 'reject') setRejectTarget(item);
                else if (key === 'terminate') setTerminateTarget(item);
                else if (key === 'counter') openCounterProposal(item);
                else if (key === 'reactivate') setReactivateTarget(item);
              }}
              items={[
                ...(item.status === 'pending' ? [{ key: 'approve' }, { key: 'reject' }, { key: 'counter' }] : []),
                ...(item.status === 'active' ? [{ key: 'terminate' }] : []),
                ...(item.status === 'suspended' ? [{ key: 'reactivate' }] : []),
              ]}
            >
              {(action) => {
                if (action.key === 'approve') return (
                  <DropdownItem key="approve" id="approve" startContent={<CheckCircle size={14} />} className="text-success">
                    {t('federation.label_approve')}
                  </DropdownItem>
                );
                if (action.key === 'reject') return (
                  <DropdownItem key="reject" id="reject" startContent={<XCircle size={14} />} className="text-danger" color="danger">
                    {t('federation.reject')}
                  </DropdownItem>
                );
                if (action.key === 'counter') return (
                  <DropdownItem key="counter" id="counter" startContent={<MessageSquare size={14} />} className="text-warning">
                    {t('federation.counter_propose')}
                  </DropdownItem>
                );
                if (action.key === 'terminate') return (
                  <DropdownItem key="terminate" id="terminate" startContent={<Ban size={14} />} className="text-danger" color="danger">
                    {t('federation.terminate')}
                  </DropdownItem>
                );
                return (
                  <DropdownItem key="reactivate" id="reactivate" startContent={<CheckCircle size={14} />} className="text-success">
                    {t('federation.reactivate')}
                  </DropdownItem>
                );
              }}
            </DropdownMenu>
          </Dropdown>
        </div>
      ),
    },
  ];

  // ─── Render ───
  if (!loading && items.length === 0) {
    return (
      <div>
        <PageHeader title={t('federation.partnerships_title')} description={t('federation.partnerships_desc')} />
        <PartnerTimebankGuidance page="partnerships" />
        <EmptyState icon={Handshake} title={t('federation.no_partnerships')} description={t('federation.desc_no_federation_partnerships_have_been_est')} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('federation.partnerships_title')}
        description={t('federation.partnerships_desc')}
        actions={<Button variant="tertiary" startContent={<RefreshCw size={16} />} onPress={loadData} isLoading={loading}>{t('federation.refresh')}</Button>}
      />

      <PartnerTimebankGuidance page="partnerships" />

      {/* Tabs: All / Incoming / Active */}
      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(String(key))}
        variant="underlined"
        aria-label={t('federation.label_partnership_tabs')}
      >
        <Tab
          key="all"
          title={
            <div className="flex items-center gap-2">
              <Handshake size={16} />
              <span>{t('federation.tab_all')}</span>
              <Chip size="sm" variant="soft">{items.length}</Chip>
            </div>
          }
        />
        <Tab
          key="incoming"
          title={
            <div className="flex items-center gap-2">
              <Inbox size={16} />
              <span>{t('federation.tab_incoming_requests')}</span>
              {incomingRequests.length > 0 && (
                <Chip size="sm" variant="soft" color="warning">{incomingRequests.length}</Chip>
              )}
            </div>
          }
        />
        <Tab
          key="active"
          title={
            <div className="flex items-center gap-2">
              <CheckCircle size={16} />
              <span>{t('federation.status_active')}</span>
              <Chip size="sm" variant="soft" color="success">
                {items.filter(p => p.status === 'active').length}
              </Chip>
            </div>
          }
        />
      </Tabs>

      {/* Bulk action bar */}
      {selectedPendingItems.length > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-accent-soft dark:bg-accent-soft border border-accent dark:border-accent">
          <span className="text-sm font-medium">
            {t('federation.bulk_selected', { count: selectedPendingItems.length })}
          </span>
          <Button
            size="sm"
            variant="tertiary"
            className="text-success"
            startContent={<CheckCircle size={14} />}
            onPress={handleBulkApprove}
            isLoading={actionLoading}
          >
            {t('federation.bulk_approve')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            startContent={<XCircle size={14} />}
            onPress={handleBulkReject}
            isLoading={actionLoading}
          >
            {t('federation.bulk_reject')}
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={loading}
        onRefresh={loadData}
        selectable
        onSelectionChange={setSelectedKeys}
      />

      {/* Approve confirmation */}
      {approveTarget && (
        <ConfirmModal
          isOpen={!!approveTarget}
          onClose={() => setApproveTarget(null)}
          onConfirm={confirmApprove}
          title={t('federation.approve_partnership')}
          message={t('federation.confirm_approve_partnership')}
          confirmLabel={t('federation.approve')}
          confirmColor="warning"
          isLoading={actionLoading}
        />
      )}

      {/* Reject confirmation */}
      {rejectTarget && (
        <ConfirmModal
          isOpen={!!rejectTarget}
          onClose={() => setRejectTarget(null)}
          onConfirm={confirmReject}
          title={t('federation.reject_partnership')}
          message={t('federation.confirm_reject_partnership')}
          confirmLabel={t('federation.reject')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}

      {/* Terminate confirmation */}
      {terminateTarget && (
        <ConfirmModal
          isOpen={!!terminateTarget}
          onClose={() => setTerminateTarget(null)}
          onConfirm={handleTerminate}
          title={t('federation.terminate_partnership')}
          message={t('federation.terminate_partnership_confirm')}
          confirmLabel={t('federation.terminate')}
          confirmColor="danger"
          isLoading={actionLoading}
        />
      )}

      {/* Reactivate confirmation */}
      {reactivateTarget && (
        <ConfirmModal
          isOpen={!!reactivateTarget}
          onClose={() => setReactivateTarget(null)}
          onConfirm={handleReactivate}
          title={t('federation.reactivate_partnership')}
          message={t('federation.reactivate_partnership_confirm')}
          confirmLabel={t('federation.reactivate')}
          confirmColor="warning"
          isLoading={actionLoading}
        />
      )}

      {/* Counter-Proposal Modal */}
      <Modal isOpen={counterModal.isOpen} onOpenChange={counterModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <MessageSquare size={20} />
                {t('federation.counter_propose_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {counterTarget && (
                  <p className="text-sm text-muted">
                    {t('federation.counter_propose_desc')}
                  </p>
                )}

                <Select
                  label={t('federation.label_federation_level')}
                  selectedKeys={[counterLevel]}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (selected) setCounterLevel(String(selected));
                  }}
                >
                  {[1, 2, 3, 4].map((level) => (
                    <SelectItem key={String(level)} id={String(level)} textValue={t(LEVEL_LABEL_KEYS[level] || 'federation.level_discovery')}>
                      <div>
                        <p className="font-medium">{t(LEVEL_LABEL_KEYS[level] || 'federation.level_discovery')}</p>
                        <p className="text-xs text-muted">{t(LEVEL_DESCRIPTION_KEYS[level] || 'federation.level_desc_discovery')}</p>
                      </div>
                    </SelectItem>
                  ))}
                </Select>

                <div className="space-y-3">
                  <p className="text-sm font-medium">{t('federation.label_feature_permissions')}</p>
                  {PERMISSION_KEYS.map((key) => {
                    const Icon = PERMISSION_ICONS[key] ?? Users;
                    return (
                      <div key={key} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Icon size={16} className="text-muted shrink-0" />
                          <div>
                            <span className="text-sm">{t(`federation.permission_${key}`)}</span>
                            <p className="text-xs text-muted">{t(`federation.permission_desc_${key}`)}</p>
                          </div>
                        </div>
                        <Switch
                          size="sm"
                          isSelected={counterPermissions[key] ?? false}
                          onValueChange={(val) => setCounterPermissions(prev => ({ ...prev, [key]: val }))}
                        />
                      </div>
                    );
                  })}
                </div>

                <Textarea
                  label={t('federation.label_message')}
                  placeholder={t('federation.placeholder_counter_message')}
                  value={counterMessage}
                  onValueChange={setCounterMessage}
                  maxLength={1000}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
                <Button
                  variant="secondary"
                  isLoading={counterLoading}
                  onPress={handleCounterPropose}
                >
                  {t('federation.send_counter_proposal')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Partnership Detail Modal */}
      <Modal isOpen={detailModal.isOpen} onOpenChange={detailModal.onOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Handshake size={20} />
                {detailPartnership
                  ? t('federation.partnership_with')
                  : t('federation.partnership_detail')
                }
              </ModalHeader>
              <ModalBody>
                {detailLoading ? (
                  <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-40 items-center justify-center">
                    <Spinner size="lg" />
                  </div>
                ) : detailPartnership ? (
                  <div className="space-y-4">
                    <Tabs
                      aria-label={t('federation.partnership_detail_tabs_aria')}
                      selectedKey={detailTab}
                      onSelectionChange={(key) => setDetailTab(String(key))}
                      variant="underlined"
                      size="sm"
                    >
                      <Tab key="info" title={
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck size={14} />
                          <span>{t('federation.tab_info')}</span>
                        </div>
                      } />
                      <Tab key="permissions" title={
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck size={14} />
                          <span>{t('federation.tab_permissions')}</span>
                        </div>
                      } />
                      <Tab key="history" title={
                        <div className="flex items-center gap-1.5">
                          <Clock size={14} />
                          <span>{t('federation.tab_history')}</span>
                        </div>
                      } />
                      <Tab key="stats" title={
                        <div className="flex items-center gap-1.5">
                          <BarChart3 size={14} />
                          <span>{t('federation.tab_statistics')}</span>
                        </div>
                      } />
                    </Tabs>

                    {/* Info Tab */}
                    {detailTab === 'info' && (
                      <Card className="border border-border">
                        <CardBody className="gap-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                            <div>
                              <p className="text-muted">{t('federation.label_partner')}</p>
                              <p className="font-medium">{detailPartnership.resolved_partner_name || detailPartnership.partner_name}</p>
                            </div>
                            <div>
                              <p className="text-muted">{t('federation.label_status')}</p>
                              <StatusBadge status={detailPartnership.status} />
                            </div>
                            <div>
                              <p className="text-muted">{t('federation.col_level')}</p>
                              <Chip size="sm" variant="soft" color="accent">
                                {t(LEVEL_LABEL_KEYS[detailPartnership.federation_level || 1] || 'federation.level_discovery')}
                              </Chip>
                              <p className="text-xs text-muted mt-1">
                                {t(LEVEL_DESCRIPTION_KEYS[detailPartnership.federation_level || 1] || 'federation.level_desc_discovery')}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted">{t('federation.label_direction')}</p>
                              <p className="font-medium">
                                {detailPartnership.is_initiator
                                  ? t('federation.outgoing_request')
                                  : t('federation.incoming_request')
                                }
                              </p>
                            </div>
                            <div>
                              <p className="text-muted">{t('federation.label_created')}</p>
                              <p>{detailPartnership.created_at ? new Date(detailPartnership.created_at).toLocaleDateString(getFormattingLocale()) : '--'}</p>
                            </div>
                            {detailPartnership.approved_at && (
                              <div>
                                <p className="text-muted">{t('federation.label_approved')}</p>
                                <p>{new Date(detailPartnership.approved_at).toLocaleDateString(getFormattingLocale())}</p>
                              </div>
                            )}
                          </div>
                          {detailPartnership.notes && (
                            <div className="mt-2">
                              <p className="text-sm text-muted">{t('federation.label_notes')}</p>
                              <p className="text-sm mt-1 rounded-lg bg-surface-secondary p-3">{detailPartnership.notes}</p>
                            </div>
                          )}
                          {detailPartnership.counter_proposal_message && (
                            <div className="mt-2">
                              <p className="text-sm text-muted">{t('federation.label_counter_proposal')}</p>
                              <p className="text-sm mt-1 rounded-lg bg-warning-50 p-3">{detailPartnership.counter_proposal_message}</p>
                            </div>
                          )}
                        </CardBody>
                      </Card>
                    )}

                    {/* Permissions Tab */}
                    {detailTab === 'permissions' && (
                      <Card className="border border-border">
                        <CardHeader>
                          <p className="text-sm font-semibold">{t('federation.label_feature_permissions')}</p>
                        </CardHeader>
                        <CardBody className="gap-4">
                          {PERMISSION_KEYS.map((key) => {
                            const Icon = PERMISSION_ICONS[key] ?? Users;
                            const isEnabled = detailPartnership[`${key}_enabled` as keyof PartnershipDetail] === 1;
                            const canEdit = detailPartnership.status === 'active';
                            return (
                              <div key={key} className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <Icon size={18} className={isEnabled ? 'text-success' : 'text-muted'} />
                                  <div>
                                    <p className="text-sm font-medium">{t(`federation.permission_${key}`)}</p>
                                    <p className="text-xs text-muted">
                                      {t(`federation.permission_desc_${key}`)}
                                    </p>
                                  </div>
                                </div>
                                <Switch
                                  size="sm"
                                  isSelected={isEnabled}
                                  isDisabled={!canEdit || permissionsLoading}
                                  onValueChange={(val) => handlePermissionToggle(key, val)}
                                />
                              </div>
                            );
                          })}
                          {detailPartnership.status !== 'active' && (
                            <p className="text-xs text-muted italic">
                              {t('federation.permissions_editable_when_active')}
                            </p>
                          )}
                        </CardBody>
                      </Card>
                    )}

                    {/* History/Audit Tab */}
                    {detailTab === 'history' && (
                      <Card className="border border-border">
                        <CardHeader>
                          <p className="text-sm font-semibold">{t('federation.label_timeline')}</p>
                        </CardHeader>
                        <CardBody>
                          {auditLoading ? (
                            <div className="flex h-24 items-center justify-center">
                              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
                            </div>
                          ) : auditLog.length === 0 ? (
                            <BrokerEmptyState bare icon={Clock} title={t('federation.no_audit_log_entries')} />
                          ) : (
                            <div className="space-y-3">
                              {auditLog.map((entry) => (
                                <div key={entry.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0">
                                  <div className="mt-1 h-2 w-2 rounded-full bg-accent shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium">
                                      {t(`federation.audit_actions.${entry.action}`, {
                                        defaultValue: t('federation.audit_actions.unknown'),
                                      })}
                                    </p>
                                    <p className="text-xs text-muted">
                                      {entry.first_name && entry.last_name
                                        ? resolveUserDisplayName(entry)
                                        : t('federation.system')
                                      }
                                      {' — '}
                                      {new Date(entry.created_at).toLocaleString(getFormattingLocale())}
                                    </p>
                                    {entry.details && (() => {
                                      try {
                                        const parsed = JSON.parse(entry.details);
                                        if (parsed.reason) return <p className="text-xs text-muted mt-1">{parsed.reason}</p>;
                                        if (parsed.message) return <p className="text-xs text-muted mt-1">{parsed.message}</p>;
                                      } catch { /* not JSON */ }
                                      return null;
                                    })()}
                                  </div>
                                  <Chip size="sm" variant="soft" color={
                                    entry.level === 'warning' ? 'warning'
                                      : entry.level === 'critical' ? 'danger'
                                        : 'default'
                                  }>
                                    {t(`federation.audit_level_${entry.level}`)}
                                  </Chip>
                                </div>
                              ))}
                            </div>
                          )}
                        </CardBody>
                      </Card>
                    )}

                    {/* Statistics Tab */}
                    {detailTab === 'stats' && (
                      <Card className="border border-border">
                        <CardHeader>
                          <p className="text-sm font-semibold">{t('federation.label_partnership_statistics')}</p>
                        </CardHeader>
                        <CardBody>
                          {statsLoading ? (
                            <div className="flex h-24 items-center justify-center">
                              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
                            </div>
                          ) : stats ? (
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                              <div className="text-center p-4 rounded-lg bg-surface-secondary">
                                <Mail size={24} className="mx-auto mb-2 text-accent" />
                                <p className="text-2xl font-bold">{stats.messages_exchanged}</p>
                                <p className="text-xs text-muted">{t('federation.stat_messages')}</p>
                              </div>
                              <div className="text-center p-4 rounded-lg bg-surface-secondary">
                                <ArrowLeftRight size={24} className="mx-auto mb-2 text-success" />
                                <p className="text-2xl font-bold">{stats.transactions_completed}</p>
                                <p className="text-xs text-muted">{t('federation.stat_transactions')}</p>
                              </div>
                              <div className="text-center p-4 rounded-lg bg-surface-secondary">
                                <Users size={24} className="mx-auto mb-2 text-accent" />
                                <p className="text-2xl font-bold">{stats.connections_made}</p>
                                <p className="text-xs text-muted">{t('federation.stat_connections')}</p>
                              </div>
                            </div>
                          ) : (
                            <BrokerEmptyState bare icon={BarChart3} title={t('federation.no_stats_available')} />
                          )}
                        </CardBody>
                      </Card>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted text-center py-8">
                    {t('federation.partnership_not_found')}
                  </p>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('common.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default Partnerships;
