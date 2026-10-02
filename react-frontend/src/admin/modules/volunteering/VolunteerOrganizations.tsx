// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, useDisclosure, Button, Chip, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tabs, Tab, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@/components/ui';

/**
 * Volunteer Organizations — Full CRUD management page.
 * Lists organizations with search/filter, wallet adjustments, transaction
 * history, and status changes.
 *
 * 🔴 Layout (reworked 2026-10-02 after an owner report). Approve and Decline
 * used to sit in the last column of an eight-column table, off-screen behind a
 * horizontal scrollbar that many people never noticed, beside a column of red
 * Suspend buttons. Now:
 *  - every pending organisation is listed in a "Waiting for your approval"
 *    panel ABOVE the table, with full-size Approve / Decline buttons;
 *  - the table has five columns, so it fits without scrolling sideways;
 *  - the rarer actions (edit, members, wallet, suspend) are in one Manage menu
 *    per row;
 *  - a status tab bar with counts replaces the cramped status dropdown.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

import Building2 from 'lucide-react/icons/building-2';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Wallet from 'lucide-react/icons/wallet';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldOff from 'lucide-react/icons/shield-off';
import Search from 'lucide-react/icons/search';
import Pencil from 'lucide-react/icons/pencil';
import Users from 'lucide-react/icons/users';
import Plus from 'lucide-react/icons/plus';
import ChevronDown from 'lucide-react/icons/chevron-down';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import Mail from 'lucide-react/icons/mail';
import Hourglass from 'lucide-react/icons/hourglass';
import { usePageTitle } from '@/hooks';
import { useAuth, useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { EmptyState } from '../../components/EmptyState';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useTranslation } from 'react-i18next';

interface VolOrg {
  id: number;
  org_id: number;
  org_name: string;
  description?: string | null;
  contact_email?: string | null;
  website?: string | null;
  org_type?: 'organisation' | 'club' | null;
  meeting_schedule?: string | null;
  status: string;
  balance: number;
  total_in: number;
  total_out: number;
  member_count: number;
  opportunity_count: number;
  total_hours: number;
  created_at: string;
}

interface Transaction {
  id: number;
  amount: number;
  type: string;
  description: string;
  created_at: string;
  admin_name?: string;
}

interface OrgMember {
  id: number;
  user_id: number;
  first_name: string;
  last_name: string;
  role: string;
  total_hours: number;
}

interface OrgFormData {
  name: string;
  description: string;
  contact_email: string;
  website: string;
  org_type: 'organisation' | 'club';
  meeting_schedule: string;
}

const EMPTY_ORG_FORM: OrgFormData = { name: '', description: '', contact_email: '', website: '', org_type: 'organisation', meeting_schedule: '' };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_COLORS: Record<string, 'success' | 'danger' | 'warning' | 'default'> = {
  active: 'success',
  approved: 'success',
  suspended: 'danger',
  pending: 'warning',
  declined: 'default',
};

type StatusFilter = 'all' | 'pending' | 'active' | 'suspended' | 'declined';

// The server accepts 'approved' as a synonym of 'active' and both spellings are
// in the data (AdminVolunteerController::updateOrgStatus), so the Active tab
// and the Suspend action must treat them as one.
const isActiveStatus = (status: string) => status === 'active' || status === 'approved';

function matchesFilter(status: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return isActiveStatus(status);
  return status === filter;
}

export function VolunteerOrganizations() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.volunteer_organizations_title'));
  const toast = useToast();
  const { user } = useAuth();
  const canManageOrgWallet = Boolean(
    user?.is_super_admin ||
    user?.is_god ||
    user?.is_tenant_super_admin ||
    user?.role === 'super_admin',
  );

  // Data state
  const [items, setItems] = useState<VolOrg[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Adjust balance modal
  const adjustModal = useDisclosure();
  const [adjustOrg, setAdjustOrg] = useState<VolOrg | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  // Transactions modal
  const txModal = useDisclosure();
  const [txOrg, setTxOrg] = useState<VolOrg | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txCursor, setTxCursor] = useState<string | null>(null);
  const [txHasMore, setTxHasMore] = useState(false);

  // Edit org modal
  const editModal = useDisclosure();
  const [editOrg, setEditOrg] = useState<VolOrg | null>(null);
  const [editForm, setEditForm] = useState<OrgFormData>(EMPTY_ORG_FORM);
  const [editSubmitting, setEditSubmitting] = useState(false);

  // Members modal
  const membersModal = useDisclosure();
  const [membersOrg, setMembersOrg] = useState<VolOrg | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Create org modal
  const createModal = useDisclosure();
  const [createForm, setCreateForm] = useState<OrgFormData>(EMPTY_ORG_FORM);
  const [createSubmitting, setCreateSubmitting] = useState(false);

  // Status toggle (suspend requires confirmation; activate is direct)
  const [suspendTarget, setSuspendTarget] = useState<VolOrg | null>(null);
  // A pending organisation needs a real decision, not just an on/off toggle:
  // before 2026-08-28 an admin had no way to refuse one at all.
  const [declineTarget, setDeclineTarget] = useState<VolOrg | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [statusToggleId, setStatusToggleId] = useState<number | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getOrganizations();
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setItems(payload);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setItems((payload as { data: VolOrg[] }).data || []);
        }
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_organizations'));
      setItems([]);
    }
    setLoading(false);
  }, [toast, t]);


  useEffect(() => { loadData(); }, [loadData]);

  // Filtered data
  const filteredItems = useMemo(() => {
    let result = items;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((item) => item.org_name?.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      result = result.filter((item) => matchesFilter(item.status, statusFilter));
    }
    return result;
  }, [items, searchQuery, statusFilter]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: items.length, pending: 0, active: 0, suspended: 0, declined: 0 };
    for (const item of items) {
      for (const key of ['pending', 'active', 'suspended', 'declined'] as const) {
        if (matchesFilter(item.status, key)) counts[key] += 1;
      }
    }
    return counts;
  }, [items]);

  // Every pending organisation, whatever the search or tab: this panel is the
  // admin's to-do list, so narrowing the table must never hide it.
  const pendingItems = useMemo(() => items.filter((item) => item.status === 'pending'), [items]);

  const formatDate = useCallback((value: string | null | undefined) => (
    // dateStyle 'medium' gives "8 Jan 2026" rather than the ambiguous 8/1/2026.
    value ? new Date(value).toLocaleDateString(getFormattingLocale(), { dateStyle: 'medium' }) : '--'
  ), []);

  // --- Adjust Balance ---
  const openAdjustModal = useCallback((org: VolOrg) => {
    setAdjustOrg(org);
    setAdjustAmount('');
    setAdjustReason('');
    adjustModal.onOpen();
  }, [adjustModal]);

  const handleAdjustSubmit = useCallback(async () => {
    if (!adjustOrg) return;
    const amount = parseFloat(adjustAmount);
    if (isNaN(amount) || amount === 0) {
      toast.error(t('volunteering.amount_nonzero'));
      return;
    }
    if (!adjustReason.trim()) {
      toast.error(t('volunteering.reason_required'));
      return;
    }
    setAdjustSubmitting(true);
    try {
      const res = await adminVolunteering.adjustOrgWallet(adjustOrg.id, amount, adjustReason.trim());
      if (res.success) {
        toast.success(t('volunteering.balance_adjusted'));
        adjustModal.onClose();
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.adjust_failed'));
      }
    } catch {
      toast.error(t('volunteering.adjust_failed'));
    }
    setAdjustSubmitting(false);
  }, [adjustOrg, adjustAmount, adjustReason, toast, t, adjustModal, loadData]);

  // --- View Transactions ---
  const openTxModal = useCallback(async (org: VolOrg) => {
    setTxOrg(org);
    setTransactions([]);
    setTxCursor(null);
    setTxHasMore(false);
    txModal.onOpen();
    setTxLoading(true);
    try {
      const res = await adminVolunteering.getOrgTransactions(org.id);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setTransactions(payload as Transaction[]);
          setTxCursor((res.meta as { cursor?: string; next_cursor?: string } | undefined)?.cursor || (res.meta as { next_cursor?: string } | undefined)?.next_cursor || null);
          setTxHasMore(Boolean((res.meta as { has_more?: boolean } | undefined)?.has_more));
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          const p = payload as { data: Transaction[]; meta?: { next_cursor?: string; has_more?: boolean } };
          setTransactions(p.data || []);
          setTxCursor(p.meta?.next_cursor || null);
          setTxHasMore(p.meta?.has_more || false);
        }
      }
      if (!res.success) {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.failed_load_transactions'));
      }
    } catch {
      toast.error(t('volunteering.failed_load_transactions'));
    }
    setTxLoading(false);
  }, [txModal, toast, t]);


  const loadMoreTx = useCallback(async () => {
    if (!txOrg || !txCursor) return;
    setTxLoading(true);
    try {
      const res = await adminVolunteering.getOrgTransactions(txOrg.id, txCursor);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setTransactions((prev) => [...prev, ...(payload as Transaction[])]);
          setTxCursor((res.meta as { cursor?: string; next_cursor?: string } | undefined)?.cursor || (res.meta as { next_cursor?: string } | undefined)?.next_cursor || null);
          setTxHasMore(Boolean((res.meta as { has_more?: boolean } | undefined)?.has_more));
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          const p = payload as { data: Transaction[]; meta?: { next_cursor?: string; has_more?: boolean } };
          setTransactions((prev) => [...prev, ...(p.data || [])]);
          setTxCursor(p.meta?.next_cursor || null);
          setTxHasMore(p.meta?.has_more || false);
        }
      }
      if (!res.success) {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.failed_load_transactions'));
      }
    } catch {
      toast.error(t('volunteering.failed_load_transactions'));
    }
    setTxLoading(false);
  }, [txOrg, txCursor, toast, t]);


  // --- Status Toggle ---
  const applyStatus = useCallback(async (
    org: VolOrg,
    newStatus: 'active' | 'suspended' | 'declined',
    reason?: string,
  ) => {
    if (statusToggleId !== null) return;
    setStatusToggleId(org.id);
    try {
      // Only pass the reason when there is one: an explicit trailing
      // `undefined` changes the observable call signature for no benefit, and
      // suspend/activate genuinely have no reason to send.
      const res = reason
        ? await adminVolunteering.updateOrgStatus(org.id, newStatus, reason)
        : await adminVolunteering.updateOrgStatus(org.id, newStatus);
      if (res.success) {
        toast.success(t('volunteering.status_updated', { status: t(`volunteering.status_${newStatus}`) }));
        setSuspendTarget(null);
        setDeclineTarget(null);
        setDeclineReason('');
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.status_update_failed'));
      }
    } catch {
      toast.error(t('volunteering.status_update_failed'));
    } finally {
      setStatusToggleId(null);
    }
  }, [statusToggleId, toast, t, loadData]);

  // --- Edit Organization ---
  const openEditModal = useCallback((org: VolOrg) => {
    setEditOrg(org);
    setEditForm({
      name: org.org_name || '',
      description: org.description || '',
      contact_email: org.contact_email || '',
      website: org.website || '',
      org_type: org.org_type || 'organisation',
      meeting_schedule: org.meeting_schedule || '',
    });
    editModal.onOpen();
  }, [editModal]);

  const handleEditSubmit = useCallback(async () => {
    if (!editOrg) return;
    if (!editForm.name.trim()) {
      toast.error(t('volunteering.name_required'));
      return;
    }
    if (editForm.description.trim().length < 20) {
      toast.error(t('volunteering.description_min_length'));
      return;
    }
    if (!EMAIL_PATTERN.test(editForm.contact_email.trim())) {
      toast.error(t('volunteering.contact_email_required'));
      return;
    }
    setEditSubmitting(true);
    try {
      const res = await adminVolunteering.updateOrganization(editOrg.org_id || editOrg.id, {
        name: editForm.name.trim(),
        description: editForm.description.trim(),
        contact_email: editForm.contact_email.trim(),
        website: editForm.website.trim(),
        org_type: editForm.org_type,
        meeting_schedule: editForm.meeting_schedule.trim() || undefined,
      });
      if (res.success) {
        toast.success(t('volunteering.org_updated'));
        editModal.onClose();
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.org_update_failed'));
      }
    } catch {
      toast.error(t('volunteering.org_update_failed'));
    }
    setEditSubmitting(false);
  }, [editOrg, editForm, toast, t, editModal, loadData]);

  // --- View Members ---
  const openMembersModal = useCallback(async (org: VolOrg) => {
    setMembersOrg(org);
    setMembers([]);
    membersModal.onOpen();
    setMembersLoading(true);
    try {
      const res = await adminVolunteering.getOrgMembers(org.org_id || org.id);
      if (res.success && res.data) {
        const payload = res.data as unknown;
        if (Array.isArray(payload)) {
          setMembers(payload as OrgMember[]);
        } else if (payload && typeof payload === 'object' && 'data' in payload) {
          setMembers((payload as { data: OrgMember[] }).data || []);
        }
      }
    } catch {
      toast.error(t('volunteering.failed_load_members'));
    }
    setMembersLoading(false);
  }, [membersModal, toast, t]);


  // --- Create Organization ---
  const openCreateModal = useCallback(() => {
    setCreateForm(EMPTY_ORG_FORM);
    createModal.onOpen();
  }, [createModal]);

  const handleCreateSubmit = useCallback(async () => {
    if (!createForm.name.trim()) {
      toast.error(t('volunteering.name_required'));
      return;
    }
    if (createForm.description.trim().length < 20) {
      toast.error(t('volunteering.description_min_length'));
      return;
    }
    if (!EMAIL_PATTERN.test(createForm.contact_email.trim())) {
      toast.error(t('volunteering.contact_email_required'));
      return;
    }
    setCreateSubmitting(true);
    try {
      const res = await adminVolunteering.createOrganization({
        name: createForm.name.trim(),
        description: createForm.description.trim(),
        contact_email: createForm.contact_email.trim(),
        website: createForm.website.trim(),
        org_type: createForm.org_type,
        meeting_schedule: createForm.meeting_schedule.trim() || undefined,
      });
      if (res.success) {
        toast.success(t('volunteering.org_created'));
        createModal.onClose();
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — a failed ApiResponse
        // carries `error`, never `message`; the old `.message` read was dead.
        toast.error(res.error || t('volunteering.org_create_failed'));
      }
    } catch {
      toast.error(t('volunteering.org_create_failed'));
    }
    setCreateSubmitting(false);
  }, [createForm, toast, t, createModal, loadData]);

  const openDecline = useCallback((org: VolOrg) => {
    setDeclineReason('');
    setDeclineTarget(org);
  }, []);

  const handleManageAction = useCallback((org: VolOrg, action: string) => {
    switch (action) {
      case 'edit': openEditModal(org); break;
      case 'members': openMembersModal(org); break;
      case 'adjust': openAdjustModal(org); break;
      case 'transactions': openTxModal(org); break;
      case 'suspend': setSuspendTarget(org); break;
      case 'activate':
      case 'approve': applyStatus(org, 'active'); break;
      case 'decline': openDecline(org); break;
    }
  }, [openEditModal, openMembersModal, openAdjustModal, openTxModal, applyStatus, openDecline]);

  // Approve / Decline pair for the approval panel. The accessible name carries the organisation's name: a screen-reader user
  // tabbing through several pending organisations otherwise hears "Approve"
  // with no way to tell which one it applies to.
  const renderDecisionButtons = (org: VolOrg, size: 'sm' | 'md') => (
    <>
      <Button
        size={size}
        variant="primary"
        startContent={<Check size={size === 'md' ? 16 : 14} />}
        aria-label={t('volunteering.orgs_approve_aria', { name: org.org_name })}
        onPress={() => applyStatus(org, 'active')}
        isLoading={statusToggleId === org.id}
        isDisabled={statusToggleId !== null && statusToggleId !== org.id}
      >
        {t('volunteering.approve')}
      </Button>
      <Button
        size={size}
        variant="danger"
        startContent={<X size={size === 'md' ? 16 : 14} />}
        aria-label={t('volunteering.orgs_decline_aria', { name: org.org_name })}
        onPress={() => openDecline(org)}
        isDisabled={statusToggleId !== null}
      >
        {t('volunteering.decline')}
      </Button>
    </>
  );

  const renderManageMenu = (org: VolOrg) => (
    <Dropdown placement="bottom end">
      <DropdownTrigger>
        <Button
          size="sm"
          variant="secondary"
          endContent={<ChevronDown size={14} />}
          aria-label={t('volunteering.orgs_manage_aria', { name: org.org_name })}
          isDisabled={statusToggleId === org.id}
        >
          {t('volunteering.orgs_manage')}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t('volunteering.orgs_manage_aria', { name: org.org_name })}
        onAction={(key) => handleManageAction(org, String(key))}
      >
        {/* The approval panel above the table is the main place to decide a
            pending organisation; these repeat it for someone working from the
            table. They are menu items, not buttons, so the column stays narrow
            enough that the table never needs a sideways scrollbar. */}
        {org.status === 'pending' ? (
          <DropdownItem key="approve" id="approve" startContent={<Check size={14} />}>
            {t('volunteering.approve')}
          </DropdownItem>
        ) : null}
        {org.status === 'pending' ? (
          <DropdownItem key="decline" id="decline" color="danger" startContent={<X size={14} />}>
            {t('volunteering.decline')}
          </DropdownItem>
        ) : null}
        <DropdownItem key="edit" id="edit" startContent={<Pencil size={14} />}>
          {t('volunteering.edit')}
        </DropdownItem>
        <DropdownItem key="members" id="members" startContent={<Users size={14} />}>
          {t('volunteering.members')}
        </DropdownItem>
        {canManageOrgWallet ? (
          <DropdownItem key="adjust" id="adjust" startContent={<Wallet size={14} />}>
            {t('volunteering.orgs_adjust_wallet')}
          </DropdownItem>
        ) : null}
        {canManageOrgWallet ? (
          <DropdownItem key="transactions" id="transactions" startContent={<ArrowLeftRight size={14} />}>
            {t('volunteering.transactions')}
          </DropdownItem>
        ) : null}
        {isActiveStatus(org.status) ? (
          <DropdownItem key="suspend" id="suspend" color="danger" startContent={<ShieldOff size={14} />}>
            {t('volunteering.suspend')}
          </DropdownItem>
        ) : null}
        {/* A pending organisation is decided with Approve / Decline above;
            "Activate" would be a second, unlabelled way of approving it. */}
        {!isActiveStatus(org.status) && org.status !== 'pending' ? (
          <DropdownItem key="activate" id="activate" startContent={<ShieldCheck size={14} />}>
            {t('volunteering.activate')}
          </DropdownItem>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  );

  const columns: Column<VolOrg>[] = [
    {
      key: 'org_name',
      label: t('volunteering.col_organization'),
      sortable: true,
      render: (item) => (
        // Bounded width so long names wrap instead of widening the table.
        <div className="min-w-[11rem] max-w-[18rem] whitespace-normal">
          <p className="font-semibold text-foreground">{item.org_name}</p>
          {item.contact_email ? (
            <p className="truncate text-xs text-muted">{item.contact_email}</p>
          ) : null}
          <p className="text-xs text-muted">{t('volunteering.orgs_registered', { date: formatDate(item.created_at) })}</p>
        </div>
      ),
    },
    {
      key: 'status',
      label: t('volunteering.col_status'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status] || 'default'}>
          {t(`volunteering.status_${item.status || 'unknown'}`)}
        </Chip>
      ),
    },
    {
      key: 'activity',
      label: t('volunteering.col_activity'),
      render: (item) => (
        <ul className="space-y-0.5 text-xs text-muted">
          <li>{t('volunteering.orgs_stat_volunteers', { value: formatNumber(item.member_count ?? 0) })}</li>
          <li>{t('volunteering.orgs_stat_opportunities', { value: formatNumber(item.opportunity_count ?? 0) })}</li>
          <li>{t('volunteering.orgs_stat_hours', { value: formatNumber(item.total_hours ?? 0) })}</li>
        </ul>
      ),
    },
    {
      key: 'balance',
      label: t('volunteering.col_wallet_balance'),
      sortable: true,
      render: (item) => <span className="whitespace-nowrap">{t('volunteering.hours_value', { value: (item.balance ?? 0).toLocaleString(getFormattingLocale()) })}</span>,
    },
    {
      key: 'actions',
      label: t('volunteering.col_actions'),
      render: (item) => renderManageMenu(item),
    },
  ];

  const filterTabs: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: t('volunteering.tab_all') },
    { key: 'pending', label: t('volunteering.orgs_tab_waiting') },
    { key: 'active', label: t('volunteering.status_active') },
    { key: 'suspended', label: t('volunteering.status_suspended') },
    { key: 'declined', label: t('volunteering.status_declined') },
  ];

  if (!loading && items.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          title={t('volunteering.volunteer_organizations_title')}
          description={t('volunteering.volunteer_organizations_desc')}
        />
        <EmptyState
          icon={Building2}
          title={t('volunteering.no_organizations')}
          description={t('volunteering.desc_no_volunteer_organizations_have_cre')}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.volunteer_organizations_title')}
        description={t('volunteering.volunteer_organizations_desc')}
        actions={
          <div className="flex gap-2">
            <Button startContent={<Plus size={16} />} onPress={openCreateModal}>
              {t('volunteering.create_organization')}
            </Button>
            <Button variant="secondary" startContent={<RefreshCw size={16} />} onPress={loadData} isLoading={loading}>
              {t('volunteering.refresh')}
            </Button>
          </div>
        }
      />

      {pendingItems.length > 0 && (
        <section
          aria-labelledby="orgs-awaiting-title"
          className="rounded-2xl border border-warning/40 bg-warning/5 p-4 shadow-sm sm:p-5"
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning">
              <Hourglass size={20} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="orgs-awaiting-title" className="text-lg font-semibold text-foreground">
                  {t('volunteering.orgs_awaiting_title')}
                </h2>
                <Chip size="sm" color="warning" variant="primary">{formatNumber(pendingItems.length)}</Chip>
              </div>
              <p className="mt-1 text-sm text-muted">{t('volunteering.orgs_awaiting_intro')}</p>
            </div>
          </div>

          <ul className="mt-4 space-y-3">
            {pendingItems.map((org) => (
              <li
                key={org.id}
                className="flex flex-col gap-4 rounded-xl border border-divider/70 bg-surface p-4 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-base font-semibold text-foreground">{org.org_name}</p>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                    <span>{t(`volunteering.org_type_${org.org_type === 'club' ? 'club' : 'organisation'}`)}</span>
                    {org.contact_email ? (
                      <a href={`mailto:${org.contact_email}`} className="inline-flex items-center gap-1 text-accent hover:underline">
                        <Mail size={14} aria-hidden="true" />
                        {org.contact_email}
                      </a>
                    ) : null}
                    <span>{t('volunteering.orgs_registered', { date: formatDate(org.created_at) })}</span>
                  </p>
                  {org.description ? (
                    <p className="line-clamp-2 text-sm text-foreground/80">{org.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  {renderDecisionButtons(org, 'md')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03] lg:flex-row lg:items-center lg:justify-between">
        <Tabs
          aria-label={t('volunteering.orgs_filter_aria')}
          selectedKey={statusFilter}
          onSelectionChange={(key) => setStatusFilter(String(key) as StatusFilter)}
          variant="underlined"
          size="sm"
        >
          {filterTabs.map((tab) => (
            <Tab key={tab.key} title={`${tab.label} (${formatNumber(statusCounts[tab.key])})`} />
          ))}
        </Tabs>
        <Input type="search" name="admin-search" autoComplete="off"
          className="w-full lg:max-w-xs"
          placeholder={t('volunteering.search_organizations')}
          aria-label={t('volunteering.search_organizations')}
          startContent={<Search size={16} className="text-muted" />}
          value={searchQuery}
          onValueChange={setSearchQuery}
          isClearable
          onClear={() => setSearchQuery('')}
        />
      </div>

      <DataTable
        columns={columns}
        data={filteredItems}
        isLoading={loading}
        searchable={false}
        emptyContent={<span className="text-muted">{t('volunteering.orgs_no_match')}</span>}
      />

      {/* Adjust Balance Modal */}
      <Modal isOpen={adjustModal.isOpen} onOpenChange={adjustModal.onOpenChange} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('volunteering.adjust_wallet_title')}
                {adjustOrg && (
                  <span className="mt-1 block text-sm font-normal text-muted">
                    {adjustOrg.org_name} - {t('volunteering.current_balance')}: {t('volunteering.hours_value', { value: adjustOrg.balance ?? 0 })}
                  </span>
                )}
              </ModalHeader>
              <ModalBody>
                <Input
                  label={t('volunteering.amount_label')}
                  type="number"
                  value={adjustAmount}
                  onValueChange={setAdjustAmount}
                  placeholder={t('volunteering.amount_placeholder')}
                  variant="secondary"
                />
                <Textarea
                  label={t('volunteering.reason_label')}
                  value={adjustReason}
                  onValueChange={setAdjustReason}
                  placeholder={t('volunteering.reason_placeholder')}
                  variant="secondary"
                  minRows={2}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('volunteering.cancel')}
                </Button>
                <Button onPress={handleAdjustSubmit} isLoading={adjustSubmitting}>
                  {t('volunteering.submit_adjustment')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Transactions Modal */}
      <Modal isOpen={txModal.isOpen} onOpenChange={txModal.onOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('volunteering.transaction_history')}
                {txOrg && (
                  <span className="mt-1 block text-sm font-normal text-muted">{txOrg.org_name}</span>
                )}
              </ModalHeader>
              <ModalBody>
                {txLoading && transactions.length === 0 ? (
                  <div className="flex justify-center py-8">
                    <span className="text-muted">{t('volunteering.loading')}</span>
                  </div>
                ) : transactions.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted">
                    <ArrowLeftRight size={40} className="mb-2" />
                    <p>{t('volunteering.no_transactions')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className="flex items-center justify-between rounded-xl border border-divider/70 bg-surface-secondary/30 p-3"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {tx.description || t(`volunteering.transaction_type_${tx.type}`, { defaultValue: t('volunteering.transaction_type_unknown') })}
                          </p>
                          <p className="text-xs text-muted">
                            {tx.created_at ? new Date(tx.created_at).toLocaleString(getFormattingLocale()) : '--'}
                            {tx.admin_name && t('volunteering.transaction_by_admin', { name: tx.admin_name })}
                          </p>
                        </div>
                        <span
                          className={`font-mono text-sm font-semibold ${
                            tx.amount > 0 ? 'text-success' : 'text-danger'
                          }`}
                        >
                          {formatNumber(tx.amount, { signDisplay: tx.amount > 0 ? 'always' : 'auto' })}
                        </span>
                      </div>
                    ))}
                    {txHasMore && (
                      <div className="flex justify-center pt-2">
                        <Button size="sm" variant="secondary" onPress={loadMoreTx} isLoading={txLoading}>
                          {t('volunteering.load_more')}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('volunteering.close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Edit Organization Modal */}
      <Modal isOpen={editModal.isOpen} onOpenChange={editModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('volunteering.edit_organization')}
                {editOrg && (
                  <span className="mt-1 block text-sm font-normal text-muted">{editOrg.org_name}</span>
                )}
              </ModalHeader>
              <ModalBody className="flex flex-col gap-3">
                <Input
                  label={t('volunteering.org_name_label')}
                  value={editForm.name}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, name: v }))}
                  variant="secondary"
                  isRequired
                />
                <Textarea
                  label={t('volunteering.org_description_label')}
                  value={editForm.description}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, description: v }))}
                  variant="secondary"
                  minRows={3}
                />
                <Input
                  label={t('volunteering.org_email_label')}
                  type="email"
                  value={editForm.contact_email}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, contact_email: v }))}
                  variant="secondary"
                />
                <Input
                  label={t('volunteering.org_website_label')}
                  type="url"
                  value={editForm.website}
                  onValueChange={(v) => setEditForm(prev => ({ ...prev, website: v }))}
                  variant="secondary"
                  placeholder={t('volunteering.website_placeholder')}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('volunteering.cancel')}
                </Button>
                <Button onPress={handleEditSubmit} isLoading={editSubmitting}>
                  {t('volunteering.save')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Members Modal */}
      <Modal isOpen={membersModal.isOpen} onOpenChange={membersModal.onOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('volunteering.organization_members')}
                {membersOrg && (
                  <span className="mt-1 block text-sm font-normal text-muted">
                    {membersOrg.org_name} - {t('volunteering.members_count', { count: membersOrg.member_count ?? 0 })}
                  </span>
                )}
              </ModalHeader>
              <ModalBody>
                {membersLoading ? (
                  <div className="flex justify-center py-8">
                    <span className="text-muted">{t('volunteering.loading')}</span>
                  </div>
                ) : members.length === 0 ? (
                  <div className="flex flex-col items-center py-8 text-muted">
                    <Users size={40} className="mb-2" />
                    <p>{t('volunteering.no_members')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {members.map((m) => (
                      <div
                        key={m.id || m.user_id}
                        className="flex items-center justify-between rounded-xl border border-divider/70 bg-surface-secondary/30 p-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-secondary text-xs font-semibold text-foreground">
                            {(m.first_name?.[0] || '').toUpperCase()}{(m.last_name?.[0] || '').toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium">{m.first_name} {m.last_name}</p>
                            <p className="text-xs text-muted capitalize">{m.role || t('volunteering.volunteer')}</p>
                          </div>
                        </div>
                        <span className="font-mono text-sm text-muted">
                          {t('volunteering.hours_value', { value: (m.total_hours ?? 0).toLocaleString(getFormattingLocale()) })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('volunteering.close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Create Organization Modal */}
      <Modal isOpen={createModal.isOpen} onOpenChange={createModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('volunteering.create_organization')}
              </ModalHeader>
              <ModalBody className="flex flex-col gap-3">
                <Input
                  label={t('volunteering.org_name_label')}
                  value={createForm.name}
                  onValueChange={(v) => setCreateForm(prev => ({ ...prev, name: v }))}
                  variant="secondary"
                  isRequired
                />
                <Textarea
                  label={t('volunteering.org_description_label')}
                  value={createForm.description}
                  onValueChange={(v) => setCreateForm(prev => ({ ...prev, description: v }))}
                  variant="secondary"
                  minRows={3}
                />
                <Input
                  label={t('volunteering.org_email_label')}
                  type="email"
                  value={createForm.contact_email}
                  onValueChange={(v) => setCreateForm(prev => ({ ...prev, contact_email: v }))}
                  variant="secondary"
                />
                <Input
                  label={t('volunteering.org_website_label')}
                  type="url"
                  value={createForm.website}
                  onValueChange={(v) => setCreateForm(prev => ({ ...prev, website: v }))}
                  variant="secondary"
                  placeholder={t('volunteering.website_placeholder')}
                />
                <Select
                  label={t('volunteering.org_type_label')}
                  selectedKeys={new Set([createForm.org_type])}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0] as 'organisation' | 'club';
                    setCreateForm(prev => ({ ...prev, org_type: val || 'organisation' }));
                  }}
                  variant="secondary"
                >
                  <SelectItem key="organisation" id="organisation">{t('volunteering.org_type_organisation')}</SelectItem>
                  <SelectItem key="club" id="club">{t('volunteering.org_type_club')}</SelectItem>
                </Select>
                {createForm.org_type === 'club' && (
                  <Input
                    label={t('volunteering.meeting_schedule_label')}
                    value={createForm.meeting_schedule}
                    onValueChange={(v) => setCreateForm(prev => ({ ...prev, meeting_schedule: v }))}
                    variant="secondary"
                    placeholder={t('volunteering.meeting_schedule_placeholder')}
                  />
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('volunteering.cancel')}
                </Button>
                <Button onPress={handleCreateSubmit} isLoading={createSubmitting}>
                  {t('volunteering.create')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Decline a pending registration. A reason is optional but is passed to
          the registrant, so a refusal does not arrive unexplained. */}
      <Modal isOpen={declineTarget !== null} onOpenChange={(open) => { if (!open && statusToggleId === null) setDeclineTarget(null); }} size="md">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {t('volunteering.decline_org_title')}
                {declineTarget && (
                  <span className="mt-1 block text-sm font-normal text-muted">{declineTarget.org_name}</span>
                )}
              </ModalHeader>
              <ModalBody className="flex flex-col gap-3">
                <p className="text-sm text-muted">
                  {t('volunteering.decline_org_confirm', { name: declineTarget?.org_name ?? '' })}
                </p>
                <Textarea
                  label={t('volunteering.decline_reason_label')}
                  placeholder={t('volunteering.decline_reason_placeholder')}
                  value={declineReason}
                  onValueChange={setDeclineReason}
                  variant="secondary"
                  minRows={3}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose} isDisabled={statusToggleId !== null}>
                  {t('volunteering.cancel')}
                </Button>
                <Button
                  variant="danger"
                  onPress={() => { if (declineTarget) applyStatus(declineTarget, 'declined', declineReason.trim() || undefined); }}
                  isLoading={statusToggleId !== null}
                >
                  {t('volunteering.decline')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Suspend Confirmation */}
      <ConfirmModal
        isOpen={suspendTarget !== null}
        onClose={() => { if (statusToggleId === null) setSuspendTarget(null); }}
        onConfirm={() => { if (suspendTarget) applyStatus(suspendTarget, 'suspended'); }}
        title={t('volunteering.suspend_org_title')}
        message={t('volunteering.suspend_org_confirm', { name: suspendTarget?.org_name ?? '' })}
        confirmLabel={t('volunteering.suspend')}
        cancelLabel={t('volunteering.cancel')}
        confirmColor="danger"
        isLoading={statusToggleId !== null}
      />
    </div>
  );
}

export default VolunteerOrganizations;
