// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button, Chip, Card, CardBody, Select, SelectItem, Checkbox, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Textarea } from '@/components/ui';

/**
 * Volunteer Training
 * Admin page for verifying volunteer training certifications and compliance.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';

import GraduationCap from 'lucide-react/icons/graduation-cap';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Clock from 'lucide-react/icons/clock';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ShieldCheck from 'lucide-react/icons/shield-check';
import ListChecks from 'lucide-react/icons/list-checks';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { EmptyState } from '../../components/EmptyState';
import { useTranslation } from 'react-i18next';

// ── Types ──────────────────────────────────────────────────────────────────────

interface TrainingRecord {
  id: number;
  volunteer_name: string;
  user_id: number;
  training_type: 'children_first' | 'vulnerable_adults' | 'first_aid' | 'manual_handling' | 'other';
  completed_date: string;
  expires_date: string | null;
  certificate_ref: string;
  status: 'pending' | 'verified' | 'expired' | 'rejected';
  description?: string;
}

interface TrainingStats {
  total_submissions: number;
  pending_verification: number;
  verified: number;
  expired: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'danger' | 'default'> = {
  pending: 'warning',
  verified: 'success',
  expired: 'danger',
  rejected: 'default',
};

function parsePayload<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

/**
 * Normalize a raw training row to the component's shape. The backend selects
 * `st.*` from vol_safeguarding_training (columns user_name, completed_at,
 * expires_at, certificate_reference), which does NOT match the field names this
 * component reads — previously the volunteer name, dates and certificate all
 * rendered blank. Accept both spellings so either envelope works.
 */
function normalizeTraining(row: Record<string, unknown>): TrainingRecord {
  const val = (...keys: string[]): unknown => {
    for (const k of keys) {
      if (row[k] !== undefined && row[k] !== null) return row[k];
    }
    return undefined;
  };
  return {
    id: Number(val('id') ?? 0),
    user_id: Number(val('user_id') ?? 0),
    volunteer_name: String(val('volunteer_name', 'user_name') ?? ''),
    training_type: (val('training_type') as TrainingRecord['training_type']) ?? 'other',
    completed_date: String(val('completed_date', 'completed_at') ?? ''),
    expires_date: (val('expires_date', 'expires_at') as string | null) ?? null,
    certificate_ref: String(val('certificate_ref', 'certificate_reference') ?? ''),
    status: (val('status') as TrainingRecord['status']) ?? 'pending',
    description: (val('description', 'notes') as string | undefined) ?? undefined,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

export function VolunteerTraining() {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.training_page_title'));
  const toast = useToast();

  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<number | null>(null);

  // Bulk verify
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkVerifying, setBulkVerifying] = useState(false);

  // Reject modal (replaces window.prompt — matches the review-modal pattern)
  const [rejectTarget, setRejectTarget] = useState<TrainingRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminVolunteering.getTraining();
      if (res.success && res.data) {
        const payload = parsePayload<{ items?: Record<string, unknown>[]; records?: Record<string, unknown>[]; stats?: TrainingStats } | Record<string, unknown>[]>(res.data);
        const rawRows = Array.isArray(payload) ? payload : payload.items || payload.records || [];
        const rows = rawRows.map(normalizeTraining);
        setRecords(rows);
        setStats(Array.isArray(payload) ? null : payload.stats || null);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_training'));
      setRecords([]);
      setStats(null);
    }
    setLoading(false);
  }, [toast, t]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleVerify = async (id: number) => {
    setActionId(id);
    try {
      const res = await adminVolunteering.verifyTraining(id);
      if (res.success) {
        toast.success(t('volunteering.training_verified'));
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_verify_training'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_verify_training'));
    }
    setActionId(null);
  };

  const openReject = (item: TrainingRecord) => {
    setRejectTarget(item);
    setRejectReason('');
  };

  const closeReject = () => {
    if (actionId !== null) return;
    setRejectTarget(null);
    setRejectReason('');
  };

  const handleReject = async () => {
    if (!rejectTarget) return;
    const reason = rejectReason.trim();
    if (!reason) return;

    setActionId(rejectTarget.id);
    try {
      const res = await adminVolunteering.rejectTraining(rejectTarget.id, reason);
      if (res.success) {
        toast.success(t('volunteering.training_rejected'));
        setRejectTarget(null);
        setRejectReason('');
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_reject_training'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_reject_training'));
    }
    setActionId(null);
  };

  // ── Bulk verify ────────────────────────────────────────────────────────────

  const handleBulkVerify = async () => {
    if (selectedIds.size === 0) return;
    setBulkVerifying(true);
    let successCount = 0;
    let failCount = 0;
    for (const id of selectedIds) {
      try {
        const res = await adminVolunteering.verifyTraining(id);
        if (res.success) successCount++;
        else failCount++;
      } catch {
        failCount++;
      }
    }
    if (successCount > 0) {
      toast.success(
        t('volunteering.bulk_verify_success', { count: successCount })
      );
    }
    if (failCount > 0) {
      toast.error(
        t('volunteering.bulk_verify_fail', { count: failCount })
      );
    }
    setSelectedIds(new Set());
    setBulkVerifying(false);
    loadData();
  };

  const toggleSelection = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Expiry alerts (within 30 days) ────────────────────────────────────────

  const expiringRecords = useMemo(() => {
    const now = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(now.getDate() + 30);
    return records.filter((r) => {
      if (!r.expires_date) return false;
      if (r.status === 'expired' || r.status === 'rejected') return false;
      const expiryDate = new Date(r.expires_date);
      return expiryDate > now && expiryDate <= thirtyDaysFromNow;
    });
  }, [records]);

  // ── Filtered data ──────────────────────────────────────────────────────────

  const filteredRecords = records.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    if (typeFilter !== 'all' && r.training_type !== typeFilter) return false;
    return true;
  });

  // ── Pending records for bulk select ────────────────────────────────────────

  const pendingRecords = useMemo(() => {
    return filteredRecords.filter((r) => r.status === 'pending');
  }, [filteredRecords]);

  const allPendingSelected = pendingRecords.length > 0 && pendingRecords.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (allPendingSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingRecords.map((r) => r.id)));
    }
  };

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: Column<TrainingRecord>[] = [
    {
      key: 'select',
      label: pendingRecords.length > 0 ? (
        <Checkbox
          isSelected={allPendingSelected}
          onValueChange={toggleSelectAll}
          size="sm"
          aria-label={t('volunteering.select_all')}
        />
      ) : '',
      render: (item) => {
        if (item.status !== 'pending') return null;
        return (
          <Checkbox
            isSelected={selectedIds.has(item.id)}
            onValueChange={() => toggleSelection(item.id)}
            size="sm"
            aria-label={t('volunteering.select_record', { name: item.volunteer_name })}
          />
        );
      },
    },
    {
      key: 'volunteer_name',
      label: t('volunteering.col_volunteer'),
      sortable: true,
    },
    {
      key: 'training_type',
      label: t('volunteering.col_training_type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft">
          {t(`volunteering.type_${item.training_type}`)}
        </Chip>
      ),
    },
    {
      key: 'completed_date',
      label: t('volunteering.col_completed'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.completed_date ? new Date(item.completed_date).toLocaleDateString(getFormattingLocale()) : '--'}
        </span>
      ),
    },
    {
      key: 'expires_date',
      label: t('volunteering.col_expires'),
      sortable: true,
      render: (item) => {
        if (!item.expires_date) return <span className="text-sm text-muted">--</span>;
        const isExpired = new Date(item.expires_date) < new Date();
        return (
          <span className={`text-sm ${isExpired ? 'text-danger font-medium' : 'text-muted'}`}>
            {new Date(item.expires_date).toLocaleDateString(getFormattingLocale())}
          </span>
        );
      },
    },
    {
      key: 'certificate_ref',
      label: t('volunteering.col_certificate_ref'),
      render: (item) => (
        <span className="text-sm font-mono text-muted">
          {item.certificate_ref || '--'}
        </span>
      ),
    },
    {
      key: 'status',
      label: t('volunteering.col_status'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" color={STATUS_COLORS[item.status] || 'default'} variant="soft">
          {t(`volunteering.status_${item.status}`)}
        </Chip>
      ),
    },
    {
      key: 'actions',
      label: t('volunteering.col_actions'),
      render: (item) => (
        <div className="flex gap-1">
          {(item.status === 'pending') && (
            <>
              <Button
                size="sm"
                variant="tertiary"
                color="success"
                startContent={<CheckCircle size={14} />}
                onPress={() => handleVerify(item.id)}
                isLoading={actionId === item.id}
                isDisabled={bulkVerifying || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.verify')}
              </Button>
              <Button
                size="sm"
                variant="danger"
                startContent={<XCircle size={14} />}
                onPress={() => openReject(item)}
                isLoading={actionId === item.id}
                isDisabled={bulkVerifying || (actionId !== null && actionId !== item.id)}
              >
                {t('volunteering.reject')}
              </Button>
            </>
          )}
          {item.status === 'verified' && (
            <Chip size="sm" color="success" variant="soft" startContent={<ShieldCheck size={12} />}>
              {t('volunteering.verified')}
            </Chip>
          )}
          {item.status === 'expired' && (
            <Chip size="sm" color="danger" variant="soft" startContent={<AlertTriangle size={12} />}>
              {t('volunteering.expired')}
            </Chip>
          )}
          {item.status === 'rejected' && (
            <Chip size="sm" variant="soft">
              {t('volunteering.rejected')}
            </Chip>
          )}
        </div>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('volunteering.training_title')}
        description={t('volunteering.training_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={loadData}
            isLoading={loading}
          >
            {t('volunteering.refresh')}
          </Button>
        }
      />

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('volunteering.stat_total_submissions')}
          value={stats?.total_submissions ?? 0}
          icon={GraduationCap}
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_pending_verification')}
          value={stats?.pending_verification ?? 0}
          icon={Clock}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_verified')}
          value={stats?.verified ?? 0}
          icon={CheckCircle}
          color="success"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_expired')}
          value={stats?.expired ?? 0}
          icon={AlertTriangle}
          color="danger"
          loading={loading}
        />
      </div>

      {/* Expiry alerts */}
      {expiringRecords.length > 0 && (
        <Card className="border border-warning/40 bg-warning/10 shadow-sm shadow-warning/10">
          <CardBody className="py-3 px-4">
            <div className="flex items-start gap-2">
              <AlertTriangle size={18} className="text-warning mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-sm text-warning-soft-foreground">
                  {t('volunteering.expiry_alert_title', { count: expiringRecords.length })}
                </p>
                <ul className="mt-1.5 space-y-0.5">
                  {expiringRecords.map((r) => (
                    <li key={r.id} className="text-xs text-warning-soft-foreground">
                      <span className="font-medium">{r.volunteer_name}</span>
                      {' — '}
                      {t(`volunteering.type_${r.training_type}`)}
                      {' — '}
                      {t('volunteering.expires_on', {
                        date: new Date(r.expires_date!).toLocaleDateString(getFormattingLocale()),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Bulk verify bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 rounded-2xl border border-accent/20 bg-accent-soft p-3 shadow-sm shadow-accent/10">
          <ListChecks size={18} className="text-accent" />
          <span className="text-sm font-medium text-accent">
            {t('volunteering.bulk_selected', { count: selectedIds.size })}
          </span>
          <Button
            size="sm"
            color="success"
            variant="tertiary"
            startContent={<CheckCircle size={14} />}
            onPress={handleBulkVerify}
            isLoading={bulkVerifying}
          >
            {t('volunteering.bulk_verify')}
          </Button>
          <Button
            size="sm"
            variant="tertiary"
            onPress={() => setSelectedIds(new Set())}
          >
            {t('volunteering.clear_selection')}
          </Button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 rounded-2xl border border-divider/70 bg-surface p-3 shadow-sm shadow-black/[0.03]">
        <Select
          label={t('volunteering.filter_status')}
          size="sm"
          className="w-48"
          selectedKeys={[statusFilter]}
          onSelectionChange={(keys) => setStatusFilter(Array.from(keys)[0] as string)}
        >
          <SelectItem key="all" id="all">{t('volunteering.tab_all')}</SelectItem>
          <SelectItem key="pending" id="pending">{t('volunteering.status_pending')}</SelectItem>
          <SelectItem key="verified" id="verified">{t('volunteering.status_verified')}</SelectItem>
          <SelectItem key="expired" id="expired">{t('volunteering.status_expired')}</SelectItem>
          <SelectItem key="rejected" id="rejected">{t('volunteering.status_rejected')}</SelectItem>
        </Select>
        <Select
          label={t('volunteering.filter_type')}
          size="sm"
          className="w-48"
          selectedKeys={[typeFilter]}
          onSelectionChange={(keys) => setTypeFilter(Array.from(keys)[0] as string)}
        >
          <SelectItem key="all" id="all">{t('volunteering.tab_all')}</SelectItem>
          <SelectItem key="children_first" id="children_first">{t('volunteering.type_children_first')}</SelectItem>
          <SelectItem key="vulnerable_adults" id="vulnerable_adults">{t('volunteering.type_vulnerable_adults')}</SelectItem>
          <SelectItem key="first_aid" id="first_aid">{t('volunteering.type_first_aid')}</SelectItem>
          <SelectItem key="manual_handling" id="manual_handling">{t('volunteering.type_manual_handling')}</SelectItem>
          <SelectItem key="other" id="other">{t('volunteering.type_other')}</SelectItem>
        </Select>
      </div>

      {/* Training Table */}
      {!loading && filteredRecords.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title={t('volunteering.no_training')}
          description={t('volunteering.no_training_desc')}
        />
      ) : (
        <DataTable columns={columns} data={filteredRecords} isLoading={loading} onRefresh={loadData} />
      )}

      {/* Reject Modal */}
      <Modal isOpen={rejectTarget !== null} onClose={closeReject} size="md">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.reject_training_title')}
            {rejectTarget && (
              <span className="mt-1 block text-sm font-normal text-muted">{rejectTarget.volunteer_name}</span>
            )}
          </ModalHeader>
          <ModalBody>
            <Textarea
              label={t('volunteering.reason_label')}
              placeholder={t('volunteering.reject_training_reason_prompt')}
              value={rejectReason}
              onValueChange={setRejectReason}
              minRows={2}
              isRequired
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={closeReject} isDisabled={actionId !== null}>
              {t('volunteering.cancel')}
            </Button>
            <Button
              variant="danger"
              startContent={<XCircle size={16} />}
              onPress={handleReject}
              isLoading={rejectTarget !== null && actionId === rejectTarget.id}
              isDisabled={!rejectReason.trim() || actionId !== null}
            >
              {t('volunteering.reject')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default VolunteerTraining;
