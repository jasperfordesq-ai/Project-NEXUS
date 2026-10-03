// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Match Approvals
 *
 * Reviews smart-match proposals (member ↔ listing, 0–100 score + reasons)
 * before the member is notified. Ported from the admin matching module and
 * restyled to the broker design language. The backend endpoints are
 * broker-or-admin with a self-dealing guard: a broker cannot approve or
 * reject a match they are a party to — the API 403s and the toast surfaces
 * the translated message.
 *
 * The status filter is deep-linkable (?status=pending|approved|rejected|all)
 * so dashboard tiles and the sidebar badge can drop the broker directly
 * into the right queue.
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import AlertCircle from 'lucide-react/icons/circle-alert';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import TrendingUp from 'lucide-react/icons/trending-up';
import Eye from 'lucide-react/icons/eye';
import UserCheck from 'lucide-react/icons/user-check';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';

import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { formatServerDate } from '@/lib/serverTime';
import { adminMatching } from '@/admin/api/adminApi';
import { DataTable, type Column } from '@/admin/components';
import type { MatchApproval, MatchApprovalStats } from '@/admin/api/types';
import {
  Progress,
  Button,
  Chip,
  Textarea,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Avatar,
  Tabs,
  Tab,
} from '@/components/ui';
import {
  BrokerPageShell,
  BrokerStatCard,
  BrokerEmptyState,
  BrokerSkeleton,
  BrokerStatusChip,
} from '../components';

// Score color helper — mirrors the semantic scale used platform-wide.
function scoreColor(score: number): 'danger' | 'warning' | 'success' {
  if (score < 50) return 'danger';
  if (score < 75) return 'warning';
  return 'success';
}

const VALID_STATUSES = new Set(['pending', 'approved', 'rejected', 'all']);

export function MatchApprovalsPage() {
  const { t } = useTranslation('broker');
  usePageTitle(t('matching.title'));
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();

  // Deep-linkable status filter (?status=…) — falls back to the pending queue.
  const [searchParams, setSearchParams] = useSearchParams();
  const statusParam = searchParams.get('status') ?? 'pending';
  const status = VALID_STATUSES.has(statusParam) ? statusParam : 'pending';

  // Data state
  const [items, setItems] = useState<MatchApproval[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [page, setPage] = useState(1);
  // null = not loaded or failed; the cards then show a dash, never a false 0.
  const [stats, setStats] = useState<MatchApprovalStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Action state
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [rejectModal, setRejectModal] = useState<{ item: MatchApproval } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectLoading, setRejectLoading] = useState(false);

  // Every request is wrapped: until Oct 2026 a thrown request escaped these
  // loaders and left the spinner on for ever, and a failed stats call left the
  // cards reading "0" as if the queue were empty.
  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await adminMatching.getApprovals({
        status: status === 'all' ? undefined : status,
        page,
      });
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (data && typeof data === 'object' && 'data' in data) {
          const pd = data as { data: MatchApproval[]; meta?: { total: number } };
          setItems(pd.data || []);
          setTotal(pd.meta?.total || 0);
        } else if (Array.isArray(data)) {
          setItems(data);
          const metaTotal = (res.meta as Record<string, unknown> | undefined)?.total;
          setTotal(typeof metaTotal === 'number' ? metaTotal : data.length);
        } else {
          setLoadError(true);
        }
      } else {
        setLoadError(true);
      }
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [page, status]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const res = await adminMatching.getApprovalStats(30);
      if (res.success && res.data) {
        const data = res.data as unknown;
        if (data && typeof data === 'object' && 'data' in data) {
          setStats((data as { data: MatchApprovalStats }).data);
        } else {
          setStats(data as MatchApprovalStats);
        }
      } else {
        setStats(null);
      }
    } catch {
      // Decorative KPI header — degrade to dashes; the list owns the error state.
      setStats(null);
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

  const setStatus = (next: string) => {
    setPage(1);
    setSearchParams(next === 'pending' ? {} : { status: next }, { replace: true });
  };

  const refreshAll = () => {
    loadItems();
    loadStats();
  };

  const handleApprove = async (item: MatchApproval) => {
    setActionLoading(item.id);
    try {
      const res = await adminMatching.approveMatch(item.id);
      if (res.success) {
        toast.success(t('matching.approved_toast'));
        refreshAll();
      } else {
        toast.error(res.error || t('matching.approve_failed'));
      }
    } catch {
      toast.error(t('matching.approve_failed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async () => {
    if (!rejectModal) return;
    if (!rejectReason.trim()) {
      toast.error(t('matching.reject_reason_required'));
      return;
    }

    setRejectLoading(true);
    try {
      const res = await adminMatching.rejectMatch(rejectModal.item.id, rejectReason.trim());
      if (res.success) {
        toast.success(t('matching.rejected_toast'));
        // Close only on success — a failed request keeps the modal and the
        // typed reason on screen so the broker can retry.
        setRejectModal(null);
        setRejectReason('');
        refreshAll();
      } else {
        toast.error(res.error || t('matching.reject_failed'));
      }
    } catch {
      toast.error(t('matching.reject_failed'));
    } finally {
      setRejectLoading(false);
    }
  };

  const columns: Column<MatchApproval>[] = [
    {
      key: 'match',
      label: t('matching.col_match'),
      render: (item) => (
        <div className="flex items-center gap-2">
          <Avatar src={item.user_1_avatar || undefined} name={item.user_1_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{item.user_1_name}</p>
          </div>
          <ArrowLeftRight size={14} className="shrink-0 text-muted" aria-hidden="true" />
          <Avatar src={item.user_2_avatar || undefined} name={item.user_2_name} size="sm" className="shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{item.user_2_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'listing_title',
      label: t('matching.col_listing'),
      render: (item) =>
        item.listing_title ? (
          <span className="text-sm text-foreground">{item.listing_title}</span>
        ) : (
          <span className="text-sm italic text-muted">{t('matching.no_listing')}</span>
        ),
    },
    {
      key: 'match_score',
      label: t('matching.col_score'),
      sortable: true,
      render: (item) => (
        <div className="flex min-w-[100px] items-center gap-2">
          <Progress
            size="sm"
            value={item.match_score}
            color={scoreColor(item.match_score)}
            className="max-w-[60px]"
            aria-label={t('matching.match_score_aria', { score: Math.round(item.match_score) })}
          />
          <Chip size="sm" variant="soft" color={scoreColor(item.match_score)} className="tabular-nums">
            {Math.round(item.match_score)}%
          </Chip>
        </div>
      ),
    },
    {
      key: 'status',
      label: t('matching.col_status'),
      sortable: true,
      render: (item) => <BrokerStatusChip status={item.status} />,
    },
    {
      key: 'created_at',
      label: t('matching.col_submitted'),
      sortable: true,
      render: (item) => (
        <span className="text-sm tabular-nums text-muted">
          {formatServerDate(item.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('matching.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {item.status === 'pending' && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                color="success"
                onPress={() => handleApprove(item)}
                isLoading={actionLoading === item.id}
                aria-label={t('matching.approve')}
              >
                <CheckCircle size={14} />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="danger"
                onPress={() => {
                  setRejectModal({ item });
                  setRejectReason('');
                }}
                aria-label={t('matching.reject')}
              >
                <XCircle size={14} />
              </Button>
            </>
          )}
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={() => navigate(tenantPath(`/broker/match-approvals/${item.id}`))}
            aria-label={t('matching.view_details')}
          >
            <Eye size={14} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <BrokerPageShell
      help={{ sectionId: 'broker_exchanges', articleId: 'broker_match_approvals' }}
      title={t('matching.title')}
      description={t('matching.description')}
      icon={UserCheck}
      color="accent"
      actions={
        <Button
          variant="tertiary"
          size="sm"
          startContent={<RefreshCw size={16} />}
          onPress={refreshAll}
          isLoading={loading && statsLoading}
        >
          {t('matching.refresh')}
        </Button>
      }
    >
      {/* Stats row */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <BrokerStatCard
          label={t('matching.stat_pending')}
          value={stats ? stats.pending_count : null}
          icon={Clock}
          color="warning"
          loading={statsLoading}
        />
        <BrokerStatCard
          label={t('matching.stat_approved')}
          value={stats ? stats.approved_count : null}
          icon={CheckCircle}
          color="success"
          loading={statsLoading}
        />
        <BrokerStatCard
          label={t('matching.stat_rejected')}
          value={stats ? stats.rejected_count : null}
          icon={XCircle}
          color="danger"
          loading={statsLoading}
        />
        <BrokerStatCard
          label={t('matching.stat_approval_rate')}
          value={stats ? `${stats.approval_rate}%` : null}
          icon={TrendingUp}
          color="accent"
          loading={statsLoading}
        />
      </div>

      {/* Status tabs — deep-linkable */}
      <div className="mb-4 rounded-2xl border border-divider/70 bg-surface p-2 shadow-sm shadow-black/[0.03]">
        <Tabs
          aria-label={t('matching.tabs_aria')}
          selectedKey={status}
          onSelectionChange={(key) => setStatus(key as string)}
          variant="underlined"
          size="sm"
        >
          <Tab
            key="pending"
            title={
              <div className="flex items-center gap-2">
                <Clock size={14} />
                <span>{t('matching.tab_pending')}</span>
                {stats && stats.pending_count > 0 && (
                  <Chip size="sm" variant="soft" color="warning" className="tabular-nums">
                    {stats.pending_count}
                  </Chip>
                )}
              </div>
            }
          />
          <Tab
            key="approved"
            title={
              <div className="flex items-center gap-2">
                <CheckCircle size={14} />
                <span>{t('matching.tab_approved')}</span>
              </div>
            }
          />
          <Tab
            key="rejected"
            title={
              <div className="flex items-center gap-2">
                <XCircle size={14} />
                <span>{t('matching.tab_rejected')}</span>
              </div>
            }
          />
          <Tab
            key="all"
            title={
              <div className="flex items-center gap-2">
                <Users size={14} />
                <span>{t('matching.tab_all')}</span>
              </div>
            }
          />
        </Tabs>
      </div>

      {initialLoad ? (
        <BrokerSkeleton variant="table" />
      ) : loadError && items.length === 0 ? (
        // Honest failure state — an errored load must never masquerade as an
        // empty "no matches waiting" queue.
        <BrokerEmptyState
          icon={AlertCircle}
          color="danger"
          title={t('matching.load_error_title')}
          hint={t('matching.load_error_hint')}
          action={
            <Button size="sm" variant="danger-soft" onPress={refreshAll}>
              {t('matching.retry')}
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
              icon={status === 'pending' ? Sparkles : UserCheck}
              color={status === 'pending' ? 'success' : 'neutral'}
              title={status === 'pending' ? t('matching.empty_pending_title') : t('matching.empty_status_title')}
              hint={status === 'pending' ? t('matching.empty_pending_hint') : t('matching.empty_status_hint')}
            />
          }
        />
      )}

      {/* Reject modal with reason */}
      <Modal
        isOpen={!!rejectModal}
        onClose={() => {
          setRejectModal(null);
          setRejectReason('');
        }}
        size="md"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <XCircle size={20} className="text-danger" />
            {t('matching.reject')}
          </ModalHeader>
          <ModalBody>
            {rejectModal && (
              <div className="mb-3">
                <p className="text-sm text-muted">
                  {t('matching.rejecting_between', {
                    user1: rejectModal.item.user_1_name,
                    user2: rejectModal.item.user_2_name,
                  })}
                </p>
              </div>
            )}
            <Textarea
              label={t('matching.reject_reason_label')}
              placeholder={t('matching.reject_reason_placeholder')}
              value={rejectReason}
              onValueChange={setRejectReason}
              variant="secondary"
              minRows={3}
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => {
                setRejectModal(null);
                setRejectReason('');
              }}
              isDisabled={rejectLoading}
            >
              {t('matching.cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={handleReject}
              isLoading={rejectLoading}
              isDisabled={!rejectReason.trim()}
            >
              {t('matching.reject')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </BrokerPageShell>
  );
}

export default MatchApprovalsPage;
