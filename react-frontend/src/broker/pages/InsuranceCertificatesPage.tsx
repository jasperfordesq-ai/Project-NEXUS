// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Insurance Certificates Management
 * Manage insurance certificates for compliance.
 * Parity: PHP AdminInsuranceCertificateApiController
 *
 * Broker design language: BrokerPageShell frame (compliance = success),
 * deep-linked BrokerStatCard KPI header, expiry-urgency countdown chips
 * (danger expired / warning inside the configurable warning window),
 * panel-wide BrokerStatusChip statuses, BrokerSkeleton first load and
 * BrokerEmptyState empties. The `?status=` and `?user_id=` params are
 * preserved exactly so dashboard tiles and User Edit deep-links keep working.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Select,
  SelectItem,
  Button,
  Spinner,
  Input,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Avatar,
  Tabs,
  Tab,
  Chip,
} from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import Clock from 'lucide-react/icons/clock';
import Plus from 'lucide-react/icons/plus';
import Check from 'lucide-react/icons/check';
import X from 'lucide-react/icons/x';
import Search from 'lucide-react/icons/search';
import FileText from 'lucide-react/icons/file-text';
import Trash2 from 'lucide-react/icons/trash-2';
import Eye from 'lucide-react/icons/eye';
import FileCheck from 'lucide-react/icons/file-check';
import Pencil from 'lucide-react/icons/pencil';
import ExternalLink from 'lucide-react/icons/external-link';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { getFormattingLocale, resolveAssetUrl, resolveAvatarUrl, resolveUserDisplayName, resolveUserDisplayNameFromPrefix } from '@/lib/helpers';
import { parseServerTimestamp, formatServerDate, formatServerDateTime } from '@/lib/serverTime';
import { adminInsurance, adminUsers, adminBroker } from '@/admin/api/adminApi';
import { DataTable, ConfirmModal, type Column } from '@/admin/components';
import type { InsuranceCertificate, InsuranceStats, BrokerConfig } from '@/admin/api/types';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';

const INSURANCE_TYPE_KEYS = [
  'public_liability',
  'professional_indemnity',
  'employers_liability',
  'product_liability',
  'personal_accident',
  'other',
] as const;

const INSURANCE_TYPE_LABEL_KEYS: Record<(typeof INSURANCE_TYPE_KEYS)[number], string> = {
  public_liability: 'insurance.type_public_liability',
  professional_indemnity: 'insurance.type_professional_indemnity',
  employers_liability: 'insurance.type_employers_liability',
  product_liability: 'insurance.type_product_liability',
  personal_accident: 'insurance.type_personal_accident',
  other: 'insurance.type_other',
};

const SEARCH_DEBOUNCE_MS = 300;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

// Status filter is mirrored to `?status=` so stat-card deep-links and
// browser back/forward work correctly.
// 'pending_review' is the union of literal-pending + submitted — both
// are pre-verification states the broker still owns. Mirrors the
// Vetting page's filter shape so the UX is consistent across the
// two compliance modules.
const INSURANCE_STATUSES = [
  'all', 'pending_review', 'pending', 'submitted', 'verified', 'expired', 'expiring_soon', 'rejected',
] as const;
type InsuranceStatus = (typeof INSURANCE_STATUSES)[number];

// Pre-verification queues where "empty" means the broker is all caught up.
const REVIEW_QUEUE_STATUSES: ReadonlySet<InsuranceStatus> = new Set([
  'pending_review', 'pending', 'submitted',
]);

interface UserSearchResult {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export function InsuranceCertificates() {
  const { t } = useTranslation('broker');
  usePageTitle(t('insurance.title'));
  const { tenantPath } = useTenant();
  const toast = useToast();

  // Stash the latest `t`/`toast` in refs so the fetch callbacks don't churn
  // identity on language switches (which would refetch for no reason) — same
  // pattern as BrokerDashboardPage.
  const tRef = useRef(t);
  const toastRef = useRef(toast);
  tRef.current = t;
  toastRef.current = toast;

  const formatInsuranceType = (type: string | null | undefined): string => {
    if (!type) return '—';
    const key = INSURANCE_TYPE_LABEL_KEYS[type as keyof typeof INSURANCE_TYPE_LABEL_KEYS];
    return key ? t(key) : type;
  };

  // List state
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStatus = searchParams.get('status') as InsuranceStatus | null;
  const statusFilter: InsuranceStatus =
    urlStatus && INSURANCE_STATUSES.includes(urlStatus) ? urlStatus : 'all';
  const setStatusFilter = useCallback(
    (next: InsuranceStatus) => {
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

  // `?user_id=` is set by the "Manage Insurance" link from User Edit so the
  // page lands pre-filtered to that member's certificates.
  const userIdFilter = searchParams.get('user_id');

  const [items, setItems] = useState<InsuranceCertificate[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [listError, setListError] = useState(false);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stats
  const [stats, setStats] = useState<InsuranceStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);

  // Broker config (for expiry warning days)
  const [expiryWarningDays, setExpiryWarningDays] = useState(30);

  // Create modal
  const [createOpen, setCreateOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createForm, setCreateForm] = useState({
    user_id: '',
    insurance_type: 'public_liability' as InsuranceCertificate['insurance_type'],
    provider_name: '',
    policy_number: '',
    coverage_amount: '',
    start_date: '',
    expiry_date: '',
    notes: '',
  });

  // User search for create modal (#9)
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<UserSearchResult[]>([]);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const userSearchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit modal (#10)
  const [editItem, setEditItem] = useState<InsuranceCertificate | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [editForm, setEditForm] = useState({
    insurance_type: 'public_liability' as InsuranceCertificate['insurance_type'],
    provider_name: '',
    policy_number: '',
    coverage_amount: '',
    start_date: '',
    expiry_date: '',
    notes: '',
  });

  // Reject modal
  const [rejectModal, setRejectModal] = useState<InsuranceCertificate | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  // View modal
  const [viewItem, setViewItem] = useState<InsuranceCertificate | null>(null);

  // Delete confirm
  const [deleteItem, setDeleteItem] = useState<InsuranceCertificate | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Verify loading tracker
  const [verifyingId, setVerifyingId] = useState<number | null>(null);

  // #6: Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Load broker config for expiry warning days (#12)
  useEffect(() => {
    (async () => {
      try {
        const res = await adminBroker.getConfiguration();
        if (res.success && res.data) {
          const cfg = res.data as BrokerConfig;
          if (cfg.insurance_expiry_warning_days) {
            setExpiryWarningDays(cfg.insurance_expiry_warning_days);
          }
        }
      } catch {
        // Use default 30 days
      }
    })();
  }, []);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    setStatsError(false);
    try {
      const res = await adminInsurance.stats();
      if (res.success && res.data) {
        setStats(res.data as InsuranceStats);
      } else {
        // Same lesson as the dashboard / safeguarding / vetting fixes:
        // a silently-zero "Pending" tile during a DB hiccup hides
        // certificates that need attention. Surface the failure.
        setStatsError(true);
      }
    } catch {
      setStatsError(true);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setListError(false);
    try {
      const params: Record<string, unknown> = { page };
      if (statusFilter === 'expiring_soon') {
        params.expiring_soon = true;
      } else if (statusFilter !== 'all') {
        params.status = statusFilter;
      }
      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim();
      }
      if (userIdFilter) {
        params.user_id = userIdFilter;
      }

      const res = await adminInsurance.list(params as Parameters<typeof adminInsurance.list>[0]);
      if (res.success && Array.isArray(res.data)) {
        setItems(res.data as InsuranceCertificate[]);
        const meta = res.meta as Record<string, unknown> | undefined;
        setTotal(Number(meta?.total ?? meta?.total_items ?? res.data.length));
      } else {
        setListError(true);
      }
    } catch {
      setListError(true);
      toastRef.current.error(tRef.current('insurance.load_failed'));
    } finally {
      setLoading(false);
      setHasLoadedOnce(true);
    }
  }, [page, statusFilter, debouncedSearch, userIdFilter]);

  useEffect(() => { loadStats(); }, [loadStats]);
  useEffect(() => { loadItems(); }, [loadItems]);

  // #9: User search for create modal
  useEffect(() => {
    if (!userSearchQuery.trim() || userSearchQuery.trim().length < 2) {
      setUserSearchResults([]);
      return;
    }
    if (userSearchTimeoutRef.current) {
      clearTimeout(userSearchTimeoutRef.current);
    }
    userSearchTimeoutRef.current = setTimeout(async () => {
      setUserSearchLoading(true);
      try {
        const res = await adminUsers.list({ search: userSearchQuery.trim(), limit: 8 });
        if (res.success && Array.isArray(res.data)) {
          setUserSearchResults(res.data.map((u: Record<string, unknown>) => ({
            id: u.id as number,
            first_name: u.first_name as string,
            last_name: u.last_name as string,
            email: u.email as string,
          })));
        }
      } catch {
        // Non-critical
      } finally {
        setUserSearchLoading(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (userSearchTimeoutRef.current) {
        clearTimeout(userSearchTimeoutRef.current);
      }
    };
  }, [userSearchQuery]);

  const handleVerify = async (item: InsuranceCertificate) => {
    setVerifyingId(item.id);
    try {
      const res = await adminInsurance.verify(item.id);
      if (res?.success) {
        toast.success(t('insurance.verify_success'));
        loadItems();
        loadStats();
      } else {
        toast.error(res?.error || t('insurance.verify_failed'));
      }
    } catch {
      toast.error(t('insurance.verify_failed'));
    } finally {
      setVerifyingId(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal || !rejectReason.trim()) {
      toast.error(t('insurance.reject_reason_required'));
      return;
    }
    setRejectLoading(true);
    try {
      const res = await adminInsurance.reject(rejectModal.id, rejectReason);
      if (res?.success) {
        toast.success(t('insurance.reject_success'));
        loadItems();
        loadStats();
      } else {
        toast.error(res?.error || t('insurance.reject_failed'));
      }
    } catch {
      toast.error(t('insurance.reject_failed'));
    } finally {
      setRejectLoading(false);
      setRejectModal(null);
      setRejectReason('');
    }
  };

  const handleDelete = async () => {
    if (!deleteItem) return;
    setDeleteLoading(true);
    try {
      const res = await adminInsurance.destroy(deleteItem.id);
      if (res?.success) {
        toast.success(t('insurance.delete_success'));
        loadItems();
        loadStats();
      } else {
        toast.error(res?.error || t('insurance.delete_failed'));
      }
    } catch {
      toast.error(t('insurance.delete_failed'));
    } finally {
      setDeleteLoading(false);
      setDeleteItem(null);
    }
  };

  const handleCreate = async () => {
    if (!createForm.user_id) {
      toast.error(t('insurance.select_member_required'));
      return;
    }
    setCreateLoading(true);
    try {
      const payload: Record<string, unknown> = {
        user_id: Number(createForm.user_id),
        insurance_type: createForm.insurance_type,
      };
      if (createForm.provider_name) payload.provider_name = createForm.provider_name;
      if (createForm.policy_number) payload.policy_number = createForm.policy_number;
      if (createForm.coverage_amount) payload.coverage_amount = Number(createForm.coverage_amount);
      if (createForm.start_date) payload.start_date = createForm.start_date;
      if (createForm.expiry_date) payload.expiry_date = createForm.expiry_date;
      if (createForm.notes) payload.notes = createForm.notes;

      const res = await adminInsurance.create(payload as Partial<InsuranceCertificate>);
      if (res?.success || res?.data) {
        toast.success(t('insurance.create_success'));
        setCreateOpen(false);
        resetCreateForm();
        loadItems();
        loadStats();
      } else {
        toast.error(res?.error || t('insurance.create_failed'));
      }
    } catch {
      toast.error(t('insurance.create_failed'));
    } finally {
      setCreateLoading(false);
    }
  };

  // #10: Edit handler
  const handleEdit = async () => {
    if (!editItem) return;
    setEditLoading(true);
    try {
      const payload: Record<string, unknown> = {
        insurance_type: editForm.insurance_type,
        provider_name: editForm.provider_name || null,
        policy_number: editForm.policy_number || null,
        coverage_amount: editForm.coverage_amount ? Number(editForm.coverage_amount) : null,
        start_date: editForm.start_date || null,
        expiry_date: editForm.expiry_date || null,
        notes: editForm.notes || null,
      };

      const res = await adminInsurance.update(editItem.id, payload as Partial<InsuranceCertificate>);
      if (res?.success) {
        toast.success(t('insurance.update_success'));
        setEditItem(null);
        loadItems();
        loadStats();
      } else {
        toast.error(res?.error || t('insurance.update_failed'));
      }
    } catch {
      toast.error(t('insurance.update_failed'));
    } finally {
      setEditLoading(false);
    }
  };

  const openEditModal = (item: InsuranceCertificate) => {
    setEditForm({
      insurance_type: item.insurance_type,
      provider_name: item.provider_name || '',
      policy_number: item.policy_number || '',
      coverage_amount: item.coverage_amount ? String(item.coverage_amount) : '',
      start_date: item.start_date || '',
      expiry_date: item.expiry_date || '',
      notes: item.notes || '',
    });
    setEditItem(item);
  };

  const resetCreateForm = () => {
    setCreateForm({
      user_id: '',
      insurance_type: 'public_liability',
      provider_name: '',
      policy_number: '',
      coverage_amount: '',
      start_date: '',
      expiry_date: '',
      notes: '',
    });
    setSelectedUser(null);
    setUserSearchQuery('');
    setUserSearchResults([]);
  };

  // Expiry-urgency countdown chip — danger once expired, warning inside the
  // configurable warning window. Rendered next to the raw date so the broker
  // can scan the column without doing date arithmetic.
  const renderExpiryCell = (item: InsuranceCertificate) => {
    const expiry = parseServerTimestamp(item.expiry_date);
    if (!expiry) return <span className="text-sm text-muted">{'—'}</span>;
    const daysUntilExpiry = Math.ceil((expiry.getTime() - Date.now()) / MS_PER_DAY);
    // #12: Use configurable expiry warning days
    const isExpired = daysUntilExpiry <= 0;
    const isExpiringSoon = daysUntilExpiry > 0 && daysUntilExpiry <= expiryWarningDays;

    return (
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`text-sm tabular-nums ${
            isExpired ? 'font-medium text-danger' : isExpiringSoon ? 'font-medium text-warning' : 'text-muted'
          }`}
        >
          {expiry.toLocaleDateString(getFormattingLocale())}
        </span>
        {isExpired && (
          <Chip size="sm" variant="soft" color="danger" className="shrink-0 tabular-nums">
            {daysUntilExpiry === 0
              ? t('insurance.expiry_expired_today')
              : t('insurance.expiry_expired_days_ago', { days: Math.abs(daysUntilExpiry) })}
          </Chip>
        )}
        {isExpiringSoon && (
          <Chip size="sm" variant="soft" color="warning" className="shrink-0 tabular-nums">
            {t('insurance.expiry_days_left', { days: daysUntilExpiry })}
          </Chip>
        )}
      </div>
    );
  };

  const columns: Column<InsuranceCertificate>[] = [
    {
      key: 'member',
      label: t('insurance.col_member'),
      sortable: true,
      render: (item) => (
        <div className="flex items-center gap-2">
          <Avatar
            src={resolveAvatarUrl(item.avatar_url) || undefined}
            name={resolveUserDisplayName(item)}
            size="sm"
            className="shrink-0"
          />
          <div className="min-w-0">
            <p className="truncate font-medium text-foreground">
              {item.first_name} {item.last_name}
            </p>
            <p className="truncate text-xs text-muted">{item.email}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'insurance_type',
      label: t('insurance.col_type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft" color="accent">
          {formatInsuranceType(item.insurance_type)}
        </Chip>
      ),
    },
    {
      key: 'status',
      label: t('insurance.col_status'),
      sortable: true,
      render: (item) => <BrokerStatusChip status={item.status} />,
    },
    {
      key: 'provider_name',
      label: t('insurance.col_provider'),
      render: (item) => (
        <span className="block max-w-[160px] truncate text-sm text-muted">
          {item.provider_name || '—'}
        </span>
      ),
    },
    {
      key: 'policy_number',
      label: t('insurance.col_policy'),
      render: (item) => (
        <span className="font-mono text-sm tabular-nums text-muted">
          {item.policy_number || '—'}
        </span>
      ),
    },
    {
      key: 'expiry_date',
      label: t('insurance.col_expiry'),
      sortable: true,
      render: renderExpiryCell,
    },
    {
      key: 'actions',
      label: t('insurance.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => setViewItem(item)}
            aria-label={t('insurance.view_details_aria')}
          >
            <Eye size={14} />
          </Button>
          {/* #10: Edit button */}
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => openEditModal(item)}
            aria-label={t('insurance.edit_certificate_aria')}
          >
            <Pencil size={14} />
          </Button>
          {(item.status === 'pending' || item.status === 'submitted') && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                isPending={verifyingId === item.id}
                onPress={() => handleVerify(item)}
                aria-label={t('insurance.verify_certificate_aria')}
              >
                <Check size={14} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger-soft"
                onPress={() => { setRejectModal(item); setRejectReason(''); }}
                aria-label={t('insurance.reject_certificate_aria')}
              >
                <X size={14} />
              </Button>
            </>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="danger-soft"
            onPress={() => setDeleteItem(item)}
            aria-label={t('insurance.delete_certificate_aria')}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ),
    },
  ];

  const isReviewQueue = REVIEW_QUEUE_STATUSES.has(statusFilter);
  const hasActiveNarrowing = Boolean(debouncedSearch.trim()) || statusFilter !== 'all' || Boolean(userIdFilter);
  const pendingReviewCount = stats?.pending_review ?? stats?.pending ?? 0;

  const emptyState = isReviewQueue && !debouncedSearch.trim() ? (
    <BrokerEmptyState
      bare
      icon={ShieldCheck}
      color="success"
      title={t('insurance.empty_queue_title')}
      hint={t('insurance.empty_queue_hint')}
    />
  ) : hasActiveNarrowing ? (
    <BrokerEmptyState
      bare
      icon={Search}
      color="neutral"
      title={t('insurance.empty_title')}
      hint={t('insurance.empty_try_filter')}
    />
  ) : (
    <BrokerEmptyState
      bare
      icon={FileText}
      color="neutral"
      title={t('insurance.empty_title')}
      hint={t('insurance.empty_add_to_start')}
      action={
        <Button
          size="sm"
          variant="primary"
          startContent={<Plus size={14} />}
          onPress={() => { resetCreateForm(); setCreateOpen(true); }}
        >
          {t('insurance.add_certificate')}
        </Button>
      }
    />
  );

  return (
    <BrokerPageShell
      title={t('insurance.page_title')}
      description={t('insurance.page_description')}
      icon={ShieldCheck}
      color="success"
      actions={
        <>
          <Button
            variant="primary"
            startContent={<Plus size={16} />}
            size="sm"
            onPress={() => { resetCreateForm(); setCreateOpen(true); }}
          >
            {t('insurance.add_certificate')}
          </Button>
          <Button
            as={Link}
            to={tenantPath('/broker')}
            variant="secondary"
            startContent={<ArrowLeft size={16} />}
            size="sm"
          >
            {t('insurance.back')}
          </Button>
        </>
      }
    >
      {statsError && (
        <div className="mb-4 flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-foreground">{t('insurance.stats_error_title')}</p>
            <p className="text-muted">{t('insurance.stats_error_body')}</p>
          </div>
          <Button size="sm" variant="tertiary" onPress={loadStats}>
            {t('insurance.retry')}
          </Button>
        </div>
      )}

      {/* KPI header — cards deep-link into the matching filtered view */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <BrokerStatCard
          label={t('insurance.stat_total')}
          value={stats?.total ?? 0}
          icon={FileText}
          color="neutral"
          loading={statsLoading}
        />
        <BrokerStatCard
          label={t('insurance.stat_pending_review')}
          // pending_review = pending + submitted (pre-verification states
          // the broker still owns). Falls back to legacy `pending` for
          // backwards compat with API responses that pre-date the field.
          value={pendingReviewCount}
          icon={Clock}
          color="warning"
          loading={statsLoading}
          to={tenantPath('/broker/insurance?status=pending_review')}
        />
        <BrokerStatCard
          label={t('insurance.stat_verified')}
          value={stats?.verified ?? 0}
          icon={ShieldCheck}
          color="success"
          loading={statsLoading}
          to={tenantPath('/broker/insurance?status=verified')}
        />
        <BrokerStatCard
          label={t('insurance.stat_expiring_soon')}
          value={stats?.expiring_soon ?? 0}
          icon={ShieldAlert}
          color="danger"
          loading={statsLoading}
          to={tenantPath('/broker/insurance?status=expiring_soon')}
        />
      </div>

      {/* Search + status tabs — deep-linkable via ?status= */}
      <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <div className="flex flex-col gap-2">
          <Input
            placeholder={t('insurance.search_placeholder')}
            aria-label={t('insurance.search_aria')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
            variant="secondary"
            size="sm"
            className="max-w-md"
            isClearable
            onClear={() => setSearchQuery('')}
          />
          <Tabs
            aria-label={t('insurance.tabs_aria')}
            selectedKey={statusFilter}
            onSelectionChange={(key) => { setStatusFilter(key as InsuranceStatus); setPage(1); }}
            variant="underlined"
            size="sm"
          >
            <Tab key="all" title={t('insurance.tab_all')} />
            <Tab
              key="pending_review"
              title={
                <div className="flex items-center gap-2">
                  <span>{t('insurance.tab_pending_review')}</span>
                  {!statsLoading && pendingReviewCount > 0 && (
                    <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                      {pendingReviewCount}
                    </Chip>
                  )}
                </div>
              }
            />
            <Tab key="pending" title={t('insurance.tab_pending')} />
            <Tab key="submitted" title={t('insurance.tab_submitted')} />
            <Tab key="verified" title={t('insurance.tab_verified')} />
            <Tab key="expired" title={t('insurance.tab_expired')} />
            <Tab key="expiring_soon" title={t('insurance.tab_expiring_soon')} />
            <Tab key="rejected" title={t('insurance.tab_rejected')} />
          </Tabs>
        </div>
      </div>

      {/* First load: shaped skeleton. Refreshes keep DataTable's own isLoading. */}
      {!hasLoadedOnce && loading ? (
        <BrokerSkeleton variant="table" />
      ) : listError && !loading && items.length === 0 ? (
        <BrokerEmptyState
          icon={ShieldAlert}
          color="danger"
          title={t('insurance.load_failed')}
          hint={t('insurance.load_error_hint')}
          action={
            <Button size="sm" variant="tertiary" onPress={loadItems}>
              {t('insurance.retry')}
            </Button>
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={items}
          isLoading={loading}
          searchable={false}
          onRefresh={loadItems}
          totalItems={total}
          page={page}
          pageSize={20}
          onPageChange={setPage}
          emptyContent={emptyState}
        />
      )}

      {/* Create Modal — #9: User search instead of raw ID */}
      <Modal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        size="lg"
        scrollBehavior="inside"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Plus size={20} className="text-accent" aria-hidden="true" />
            {t('insurance.modal_create_title')}
          </ModalHeader>
          <ModalBody className="gap-4">
            {/* #9: Member search autocomplete */}
            {selectedUser ? (
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface-secondary p-3">
                <div className="flex items-center gap-2">
                  <Avatar name={resolveUserDisplayName(selectedUser)} size="sm" />
                  <div>
                    <p className="text-sm font-medium">{selectedUser.first_name} {selectedUser.last_name}</p>
                    <p className="text-xs text-muted">{selectedUser.email}</p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={() => {
                    setSelectedUser(null);
                    setCreateForm(prev => ({ ...prev, user_id: '' }));
                    setUserSearchQuery('');
                  }}
                >
                  {t('insurance.change')}
                </Button>
              </div>
            ) : (
              <div>
                <Input
                  label={t('insurance.search_member_label')}
                  placeholder={t('insurance.search_member_placeholder')}
                  value={userSearchQuery}
                  onValueChange={setUserSearchQuery}
                  variant="secondary"
                  isRequired
                  startContent={<Search size={14} className="text-muted" aria-hidden="true" />}
                  endContent={userSearchLoading ? <Spinner size="sm" /> : undefined}
                />
                {userSearchResults.length > 0 && (
                  <div className="mt-1 max-h-48 overflow-hidden overflow-y-auto rounded-lg border border-border">
                    {userSearchResults.map((u) => (
                      <Button
                        key={u.id}
                        variant="tertiary"
                        className="flex min-h-12 w-full items-center justify-start gap-2 rounded-none p-2"
                        onPress={() => {
                          setSelectedUser(u);
                          setCreateForm(prev => ({ ...prev, user_id: String(u.id) }));
                          setUserSearchQuery('');
                          setUserSearchResults([]);
                        }}
                      >
                        <Avatar name={resolveUserDisplayName(u)} size="sm" className="shrink-0" />
                        <div className="min-w-0 text-left">
                          <p className="truncate text-sm font-medium">{u.first_name} {u.last_name}</p>
                          <p className="truncate text-xs text-muted">{u.email}</p>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
                {userSearchQuery.trim().length >= 2 && !userSearchLoading && userSearchResults.length === 0 && (
                  <p className="mt-1 text-xs text-muted">{t('insurance.no_members_found')}</p>
                )}
              </div>
            )}
            <Select
              label={t('insurance.field_insurance_type')}
              selectedKeys={[createForm.insurance_type]}
              onSelectionChange={(keys) => {
                const val = Array.from(keys)[0] as InsuranceCertificate['insurance_type'];
                if (val) setCreateForm(prev => ({ ...prev, insurance_type: val }));
              }}
              variant="secondary"
              isRequired
            >
              {INSURANCE_TYPE_KEYS.map((key) => (
                <SelectItem key={key} id={key}>{t(INSURANCE_TYPE_LABEL_KEYS[key])}</SelectItem>
              ))}
            </Select>
            <Input
              label={t('insurance.field_provider_name')}
              placeholder={t('insurance.field_provider_name_placeholder')}
              value={createForm.provider_name}
              onValueChange={(val) => setCreateForm(prev => ({ ...prev, provider_name: val }))}
              variant="secondary"
            />
            <Input
              label={t('insurance.field_policy_number')}
              placeholder={t('insurance.field_policy_number_placeholder')}
              value={createForm.policy_number}
              onValueChange={(val) => setCreateForm(prev => ({ ...prev, policy_number: val }))}
              variant="secondary"
            />
            {/* #11: EUR instead of GBP */}
            <Input
              label={t('insurance.field_coverage_amount')}
              placeholder={t('insurance.field_coverage_amount_placeholder')}
              value={createForm.coverage_amount}
              onValueChange={(val) => setCreateForm(prev => ({ ...prev, coverage_amount: val }))}
              variant="secondary"
              type="number"
              startContent={<span className="text-sm text-muted">&euro;</span>}
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label={t('insurance.field_start_date')}
                type="date"
                value={createForm.start_date}
                onValueChange={(val) => setCreateForm(prev => ({ ...prev, start_date: val }))}
                variant="secondary"
              />
              <Input
                label={t('insurance.field_expiry_date')}
                type="date"
                value={createForm.expiry_date}
                onValueChange={(val) => setCreateForm(prev => ({ ...prev, expiry_date: val }))}
                variant="secondary"
              />
            </div>
            <Textarea
              label={t('insurance.field_notes')}
              placeholder={t('insurance.field_notes_placeholder')}
              value={createForm.notes}
              onValueChange={(val) => setCreateForm(prev => ({ ...prev, notes: val }))}
              variant="secondary"
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => setCreateOpen(false)}
              isDisabled={createLoading}
            >
              {t('insurance.cancel')}
            </Button>
            <Button
              variant="primary"
              onPress={handleCreate}
              isPending={createLoading}
            >
              {t('insurance.add_certificate')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* #10: Edit Modal */}
      {editItem && (
        <Modal
          isOpen={!!editItem}
          onClose={() => setEditItem(null)}
          size="lg"
          scrollBehavior="inside"
        >
          <ModalContent>
            <ModalHeader className="flex items-center gap-2">
              <Pencil size={20} className="text-accent" aria-hidden="true" />
              {t('insurance.modal_edit_title')}
            </ModalHeader>
            <ModalBody className="gap-4">
              <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-secondary p-3">
                <Avatar
                  src={resolveAvatarUrl(editItem.avatar_url) || undefined}
                  name={resolveUserDisplayName(editItem)}
                  size="sm"
                />
                <div>
                  <p className="text-sm font-medium">{editItem.first_name} {editItem.last_name}</p>
                  <p className="text-xs text-muted">{editItem.email}</p>
                </div>
              </div>
              <Select
                label={t('insurance.field_insurance_type')}
                selectedKeys={[editForm.insurance_type]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as InsuranceCertificate['insurance_type'];
                  if (val) setEditForm(prev => ({ ...prev, insurance_type: val }));
                }}
                variant="secondary"
                isRequired
              >
                {INSURANCE_TYPE_KEYS.map((key) => (
                  <SelectItem key={key} id={key}>{t(INSURANCE_TYPE_LABEL_KEYS[key])}</SelectItem>
                ))}
              </Select>
              <Input
                label={t('insurance.field_provider_name')}
                placeholder={t('insurance.field_provider_name_placeholder')}
                value={editForm.provider_name}
                onValueChange={(val) => setEditForm(prev => ({ ...prev, provider_name: val }))}
                variant="secondary"
              />
              <Input
                label={t('insurance.field_policy_number')}
                placeholder={t('insurance.field_policy_number_placeholder')}
                value={editForm.policy_number}
                onValueChange={(val) => setEditForm(prev => ({ ...prev, policy_number: val }))}
                variant="secondary"
              />
              <Input
                label={t('insurance.field_coverage_amount')}
                placeholder={t('insurance.field_coverage_amount_placeholder')}
                value={editForm.coverage_amount}
                onValueChange={(val) => setEditForm(prev => ({ ...prev, coverage_amount: val }))}
                variant="secondary"
                type="number"
                startContent={<span className="text-sm text-muted">&euro;</span>}
              />
              <div className="grid grid-cols-2 gap-4">
                <Input
                  label={t('insurance.field_start_date')}
                  type="date"
                  value={editForm.start_date}
                  onValueChange={(val) => setEditForm(prev => ({ ...prev, start_date: val }))}
                  variant="secondary"
                />
                <Input
                  label={t('insurance.field_expiry_date')}
                  type="date"
                  value={editForm.expiry_date}
                  onValueChange={(val) => setEditForm(prev => ({ ...prev, expiry_date: val }))}
                  variant="secondary"
                />
              </div>
              <Textarea
                label={t('insurance.field_notes')}
                placeholder={t('insurance.field_notes_placeholder')}
                value={editForm.notes}
                onValueChange={(val) => setEditForm(prev => ({ ...prev, notes: val }))}
                variant="secondary"
                minRows={3}
              />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="tertiary"
                onPress={() => setEditItem(null)}
                isDisabled={editLoading}
              >
                {t('insurance.cancel')}
              </Button>
              <Button
                variant="primary"
                onPress={handleEdit}
                isPending={editLoading}
              >
                {t('insurance.save_changes')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {/* Reject Modal */}
      {rejectModal && (
        <Modal
          isOpen={!!rejectModal}
          onClose={() => { setRejectModal(null); setRejectReason(''); }}
          size="md"
        >
          <ModalContent>
            <ModalHeader className="flex items-center gap-2">
              <X size={20} className="text-danger" aria-hidden="true" />
              {t('insurance.modal_reject_title')}
            </ModalHeader>
            <ModalBody>
              <p className="mb-3 text-muted">
                {t('insurance.confirm_reject')}
              </p>
              <Textarea
                label={t('insurance.field_reason')}
                placeholder={t('insurance.field_reason_placeholder')}
                value={rejectReason}
                onValueChange={setRejectReason}
                minRows={3}
                variant="secondary"
                isRequired
              />
            </ModalBody>
            <ModalFooter>
              <Button
                variant="tertiary"
                onPress={() => { setRejectModal(null); setRejectReason(''); }}
                isDisabled={rejectLoading}
              >
                {t('insurance.cancel')}
              </Button>
              <Button
                variant="danger"
                onPress={handleReject}
                isPending={rejectLoading}
              >
                {t('insurance.reject')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {/* View Detail Modal — #1: Added certificate file display */}
      {viewItem && (
        <Modal
          isOpen={!!viewItem}
          onClose={() => setViewItem(null)}
          size="lg"
        >
          <ModalContent>
            <ModalHeader className="flex items-center gap-2">
              <FileCheck size={20} className="text-accent" aria-hidden="true" />
              {t('insurance.modal_view_title')}
            </ModalHeader>
            <ModalBody>
              <div className="mb-4 flex items-center gap-3">
                <Avatar
                  src={resolveAvatarUrl(viewItem.avatar_url) || undefined}
                  name={resolveUserDisplayName(viewItem)}
                  size="lg"
                />
                <div>
                  <p className="text-lg font-semibold tracking-tight">{viewItem.first_name} {viewItem.last_name}</p>
                  <p className="text-sm text-muted">{viewItem.email}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <p className="text-muted">{t('insurance.label_type')}</p>
                  <p className="font-medium">{formatInsuranceType(viewItem.insurance_type)}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_status')}</p>
                  <BrokerStatusChip status={viewItem.status} />
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_provider')}</p>
                  <p className="font-medium">{viewItem.provider_name || '—'}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_policy_number')}</p>
                  <p className="font-mono font-medium tabular-nums">{viewItem.policy_number || '—'}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_coverage_amount')}</p>
                  {/* #11: EUR instead of GBP */}
                  <p className="font-medium tabular-nums">{viewItem.coverage_amount ? `€${Number(viewItem.coverage_amount).toLocaleString(getFormattingLocale())}` : '—'}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_start_date')}</p>
                  <p className="font-medium tabular-nums">{viewItem.start_date ? formatServerDate(viewItem.start_date) : '—'}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_expiry_date')}</p>
                  <p className="font-medium tabular-nums">{viewItem.expiry_date ? formatServerDate(viewItem.expiry_date) : '—'}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_verified_by')}</p>
                  <p className="font-medium">
                    {viewItem.verifier_first_name
                      ? resolveUserDisplayNameFromPrefix(
                          viewItem as unknown as Record<string, unknown>,
                          'verifier_',
                        )
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_verified_at')}</p>
                  <p className="font-medium tabular-nums">{viewItem.verified_at ? formatServerDateTime(viewItem.verified_at) : '—'}</p>
                </div>
                <div>
                  <p className="text-muted">{t('insurance.label_created')}</p>
                  <p className="font-medium tabular-nums">{formatServerDateTime(viewItem.created_at)}</p>
                </div>
              </div>
              {/* #1: Certificate file display/download */}
              {viewItem.certificate_file_path && (
                <div className="mt-4">
                  <p className="mb-1 text-sm text-muted">{t('insurance.label_certificate_file')}</p>
                  <a
                    href={resolveAssetUrl(viewItem.certificate_file_path)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent hover:underline dark:bg-accent-soft"
                  >
                    <FileText size={16} aria-hidden="true" />
                    {t('insurance.view_certificate_file')}
                    <ExternalLink size={14} aria-hidden="true" />
                  </a>
                </div>
              )}
              {viewItem.notes && (
                <div className="mt-4">
                  <p className="mb-1 text-sm text-muted">{t('insurance.label_notes')}</p>
                  <p className="rounded-lg bg-surface-secondary p-3 text-sm">{viewItem.notes}</p>
                </div>
              )}
            </ModalBody>
            <ModalFooter>
              <Button variant="tertiary" onPress={() => setViewItem(null)}>
                {t('insurance.close')}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        isOpen={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        onConfirm={handleDelete}
        title={t('insurance.confirm_delete_title')}
        message={deleteItem
          ? t('insurance.confirm_delete_message')
          : ''}
        confirmLabel={t('insurance.delete')}
        confirmColor="danger"
        isLoading={deleteLoading}
      />
    </BrokerPageShell>
  );
}

export default InsuranceCertificates;
