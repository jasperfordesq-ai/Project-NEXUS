// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Attendance-reward claims ledger.
 *
 * The tenant-wide view over event_attendance_credit_claims: every reward and
 * reversal, filterable by status/type/date, with the two remediation actions
 * the ledger supports — retry a failed mint, reverse a completed one. Reversal
 * requires a reason because it takes credits BACK off a member.
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Gift from 'lucide-react/icons/gift';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import Undo2 from 'lucide-react/icons/undo-2';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState } from '../../components/EmptyState';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import {
  adminEventRewards,
  type AdminAttendanceClaim,
} from '../../api/adminApi';
import {
  Button,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Textarea,
} from '@/components/ui';

const PAGE_SIZE = 25;

const STATUS_COLORS: Record<AdminAttendanceClaim['status'], 'success' | 'danger' | 'warning' | 'default'> = {
  completed: 'success',
  failed: 'danger',
  pending: 'warning',
  reversed: 'default',
};

export default function EventRewardClaimsAdmin() {
  const { t } = useTranslation('admin_event_settings');
  useAdminPageMeta({ title: t('claims_title') });
  const toast = useToast();
  const confirm = useConfirm();

  const [claims, setClaims] = useState<AdminAttendanceClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<'all' | AdminAttendanceClaim['status']>('all');
  const [claimType, setClaimType] = useState<'all' | AdminAttendanceClaim['claim_type']>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busyClaimId, setBusyClaimId] = useState<number | null>(null);
  const [reverseTarget, setReverseTarget] = useState<AdminAttendanceClaim | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEventRewards.listClaims({
        page,
        per_page: PAGE_SIZE,
        ...(status !== 'all' ? { status } : {}),
        ...(claimType !== 'all' ? { claim_type: claimType } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      if (res.success && res.data) {
        setClaims(res.data.claims);
        setTotal(res.data.pagination.total);
      } else {
        toast.error(t('claims_load_failed'));
      }
    } finally {
      setLoading(false);
    }
  }, [page, status, claimType, from, to, t, toast]);

  useEffect(() => { void load(); }, [load]);

  const retry = async (claim: AdminAttendanceClaim) => {
    const approved = await confirm({
      title: t('claims_retry_confirm_title'),
      body: t('claims_retry_confirm_body', { member: claim.member_name ?? `#${claim.user_id}`, amount: claim.amount }),
      confirmLabel: t('claims_retry'),
    });
    if (!approved) return;

    setBusyClaimId(claim.id);
    try {
      const res = await adminEventRewards.retryClaim(claim.id);
      if (res.success && res.data?.status === 'settled') {
        toast.success(t('claims_retry_success'));
      } else {
        toast.error(t('claims_retry_failed'));
      }
      await load();
    } finally {
      setBusyClaimId(null);
    }
  };

  const submitReverse = async () => {
    if (!reverseTarget || reverseReason.trim().length < 3) return;

    setBusyClaimId(reverseTarget.id);
    try {
      const res = await adminEventRewards.reverseClaim(reverseTarget.id, reverseReason.trim());
      if (res.success && res.data?.status === 'reversed') {
        toast.success(t('claims_reverse_success'));
      } else {
        toast.error(t('claims_reverse_failed'));
      }
      setReverseTarget(null);
      setReverseReason('');
      await load();
    } finally {
      setBusyClaimId(null);
    }
  };

  const columns: Column<AdminAttendanceClaim>[] = [
    {
      key: 'created_at',
      label: t('claims_col_created'),
      render: (item) => (
        <time className="text-sm text-muted" dateTime={item.created_at}>
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.created_at))}
        </time>
      ),
    },
    {
      key: 'event_title',
      label: t('claims_col_event'),
      render: (item) => (
        <span className="text-sm font-medium">{item.event_title ?? t('claims_event_deleted')}</span>
      ),
    },
    {
      key: 'member_name',
      label: t('claims_col_member'),
      render: (item) => <span className="text-sm">{item.member_name ?? `#${item.user_id}`}</span>,
    },
    {
      key: 'claim_type',
      label: t('claims_col_type'),
      render: (item) => (
        <Chip size="sm" variant="soft" color={item.claim_type === 'attendance_reward' ? 'default' : 'warning'}>
          {t(item.claim_type === 'attendance_reward' ? 'claims_type_reward' : 'claims_type_reversal')}
        </Chip>
      ),
    },
    {
      key: 'amount',
      label: t('claims_col_amount'),
      render: (item) => <span className="text-sm tabular-nums">{item.amount.toFixed(2)}</span>,
    },
    {
      key: 'status',
      label: t('claims_col_status'),
      render: (item) => (
        <div className="flex flex-col items-start gap-1">
          <Chip size="sm" variant="soft" color={STATUS_COLORS[item.status]}>
            {t(`claims_status_${item.status}`)}
          </Chip>
          {(item.failure_code || item.reversal_code) && (
            <span className="text-xs text-muted">{item.failure_code ?? item.reversal_code}</span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: t('claims_col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {item.claim_type === 'attendance_reward' && item.status === 'failed' && (
            <Button
              size="sm"
              variant="secondary"
              startContent={<RotateCcw size={13} aria-hidden="true" />}
              isPending={busyClaimId === item.id}
              onPress={() => void retry(item)}
            >
              {t('claims_retry')}
            </Button>
          )}
          {item.claim_type === 'attendance_reward' && item.status === 'completed' && (
            <Button
              size="sm"
              variant="tertiary"
              className="text-danger"
              startContent={<Undo2 size={13} aria-hidden="true" />}
              isPending={busyClaimId === item.id}
              onPress={() => { setReverseTarget(item); setReverseReason(''); }}
            >
              {t('claims_reverse')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('claims_title')}
        description={t('claims_desc')}
        icon={<Gift size={22} />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label={t('claims_filter_status')}
          aria-label={t('claims_filter_status')}
          selectedKeys={[status]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0];
            if (value) { setStatus(value as typeof status); setPage(1); }
          }}
        >
          <SelectItem id="all">{t('claims_filter_all')}</SelectItem>
          <SelectItem id="pending">{t('claims_status_pending')}</SelectItem>
          <SelectItem id="completed">{t('claims_status_completed')}</SelectItem>
          <SelectItem id="failed">{t('claims_status_failed')}</SelectItem>
          <SelectItem id="reversed">{t('claims_status_reversed')}</SelectItem>
        </Select>
        <Select
          label={t('claims_filter_type')}
          aria-label={t('claims_filter_type')}
          selectedKeys={[claimType]}
          onSelectionChange={(keys) => {
            const value = Array.from(keys)[0];
            if (value) { setClaimType(value as typeof claimType); setPage(1); }
          }}
        >
          <SelectItem id="all">{t('claims_filter_all')}</SelectItem>
          <SelectItem id="attendance_reward">{t('claims_type_reward')}</SelectItem>
          <SelectItem id="attendance_reward_reversal">{t('claims_type_reversal')}</SelectItem>
        </Select>
        <Input
          type="date"
          label={t('claims_filter_from')}
          value={from}
          onValueChange={(value) => { setFrom(value); setPage(1); }}
          aria-label={t('claims_filter_from')}
        />
        <Input
          type="date"
          label={t('claims_filter_to')}
          value={to}
          onValueChange={(value) => { setTo(value); setPage(1); }}
          aria-label={t('claims_filter_to')}
        />
      </div>

      {!loading && claims.length === 0 ? (
        <EmptyState icon={Gift} title={t('claims_empty_title')} description={t('claims_empty_desc')} />
      ) : (
        <DataTable
          columns={columns}
          data={claims}
          isLoading={loading}
          searchable={false}
          totalItems={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onRefresh={() => void load()}
        />
      )}

      <Modal isOpen={reverseTarget !== null} onOpenChange={(open) => { if (!open) setReverseTarget(null); }}>
        <ModalContent>
          <ModalHeader>{t('claims_reverse_title')}</ModalHeader>
          <ModalBody className="space-y-3">
            <p className="text-sm text-muted">
              {t('claims_reverse_body', {
                member: reverseTarget?.member_name ?? `#${reverseTarget?.user_id ?? ''}`,
                amount: reverseTarget?.amount ?? 0,
              })}
            </p>
            <Textarea
              label={t('claims_reverse_reason')}
              value={reverseReason}
              onValueChange={setReverseReason}
              minRows={2}
              isRequired
              aria-label={t('claims_reverse_reason')}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setReverseTarget(null)}>{t('claims_cancel')}</Button>
            <Button
              color="danger"
              data-testid="reverse-claim-confirm"
              isDisabled={reverseReason.trim().length < 3}
              isPending={busyClaimId === reverseTarget?.id}
              onPress={() => void submitReverse()}
            >
              {t('claims_reverse')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
