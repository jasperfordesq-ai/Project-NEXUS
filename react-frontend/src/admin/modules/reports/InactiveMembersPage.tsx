import { CardBody, Card, Select, SelectItem, Button, Chip, Spinner, Avatar, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A4 - Inactive Member Detection
 *
 * - List of inactive members with last activity date
 * - Filter by days inactive (30/60/90/180)
 * - Flag type filter (inactive/dormant/at_risk)
 * - "Run Detection" button
 * - "Mark Notified" bulk action
 * - Stats summary (inactive count, dormant count, inactivity rate)
 *
 * API: GET  /api/v2/admin/members/inactive
 *      POST /api/v2/admin/members/inactive/detect
 *      POST /api/v2/admin/members/inactive/notify
 */

import { useState, useEffect, useCallback } from 'react';

import UserX from 'lucide-react/icons/user-x';
import Download from 'lucide-react/icons/download';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Clock from 'lucide-react/icons/clock';
import Bell from 'lucide-react/icons/bell';
import Scan from 'lucide-react/icons/scan';
import Activity from 'lucide-react/icons/activity';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts/ToastContext';
import { api } from '@/lib/api';
import { formatNumber, resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { StatCard } from '../../components/StatCard';
import { PageHeader } from '../../components/PageHeader';

import { useTranslation } from 'react-i18next';
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InactiveMember {
  id: number;
  user_id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  last_activity: string | null;
  last_login: string | null;
  days_inactive: number;
  flag_type: 'inactive' | 'dormant' | 'at_risk';
  notified_at: string | null;
  flagged_at: string;
}

interface InactiveListResponse {
  members?: InactiveMember[];
  stats?: InactivityStats | null;
  pagination?: { total_pages: number };
}

interface ApiResponseWithMeta {
  data?: unknown;
  meta?: { total_pages?: number };
}

interface InactivityStats {
  total_active_members: number;
  total_flagged: number;
  inactive_count: number;
  dormant_count: number;
  at_risk_count: number;
  notified_count: number;
  inactivity_rate: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// DAYS_OPTIONS and FLAG_TYPE_OPTIONS are defined inside the component to access t()

const FLAG_COLORS: Record<string, 'warning' | 'danger' | 'secondary'> = {
  inactive: 'warning',
  dormant: 'danger',
  at_risk: 'secondary',
};

// ---------------------------------------------------------------------------
// CSV Export helper
// ---------------------------------------------------------------------------

async function exportCsv(days: string) {
  const params = new URLSearchParams({ format: 'csv', days });
  // api.download renews an expired sign-in and retries; a hand-rolled fetch
  // failed once the short-lived access token expired.
  await api.download(`/v2/admin/reports/inactive/export?${params}`, { filename: 'inactive-members.csv' });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function InactiveMembersPage() {
  const { t } = useTranslation('admin_reports');
  usePageTitle(t('reports.page_title'));

  const DAYS_OPTIONS = [
    { key: '30', label: t('reports.period_30_days') },
    { key: '60', label: t('reports.period_60_days') },
    { key: '90', label: t('reports.period_90_days') },
    { key: '180', label: t('reports.period_180_days') },
    { key: '365', label: t('reports.period_365_days') },
  ];

  const FLAG_TYPE_OPTIONS = [
    { key: 'all', label: t('reports.flag_all_types') },
    { key: 'inactive', label: t('reports.flag_inactive') },
    { key: 'dormant', label: t('reports.flag_dormant') },
    { key: 'at_risk', label: t('reports.flag_at_risk') },
  ];

  const toast = useToast();

  const [members, setMembers] = useState<InactiveMember[]>([]);
  const [stats, setStats] = useState<InactivityStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('90');
  const [flagType, setFlagType] = useState('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [detecting, setDetecting] = useState(false);
  const [notifying, setNotifying] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        days,
        page: String(page),
        limit: '20',
      });
      if (flagType && flagType !== 'all') params.append('flag_type', flagType);

      const res = await api.get(`/v2/admin/members/inactive?${params}`);
      if (res.data) {
        const d = res.data as InactiveListResponse;
        setMembers(d.members ?? []);
        setStats(d.stats ?? null);

        // Pagination from meta or data
        const meta = (res as ApiResponseWithMeta).meta;
        const tp = meta?.total_pages ?? d.pagination?.total_pages ?? 1;
        setTotalPages(Math.max(1, tp));
      }
    } catch {
      toast.error(t('reports.failed_to_load_inactive_members'));
    } finally {
      setLoading(false);
    }
  }, [days, flagType, page, t, toast]);


  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [days, flagType]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Run detection
  const handleDetect = async () => {
    setDetecting(true);
    try {
      const res = await api.post('/v2/admin/members/inactive/detect', {
        threshold_days: parseInt(days, 10),
      });
      if (res.success) {
        toast.success(t('reports.detection_complete'));
        await loadData();
      } else {
        toast.error(t('reports.detection_failed'));
      }
    } catch {
      toast.error(t('reports.detection_failed'));
    } finally {
      setDetecting(false);
    }
  };

  // Mark notified
  const handleNotify = async () => {
    if (selectedIds.size === 0) {
      toast.warning(t('reports.select_members_to_mark_as_notified'));
      return;
    }

    setNotifying(true);
    try {
      const userIds = Array.from(selectedIds);
      const res = await api.post('/v2/admin/members/inactive/notify', { user_ids: userIds });
      if (res.success) {
        toast.success(t('reports.members_marked_notified'));
        setSelectedIds(new Set());
        await loadData();
      } else {
        toast.error(t('reports.failed_to_mark_members_as_notified'));
      }
    } catch {
      toast.error(t('reports.failed_to_mark_members_as_notified'));
    } finally {
      setNotifying(false);
    }
  };

  // React Aria Table selection → local Set<number>
  const handleSelectionChange = (keys: 'all' | Set<string | number>) => {
    if (keys === 'all') {
      setSelectedIds(new Set(members.map((m) => m.user_id)));
    } else {
      setSelectedIds(new Set(Array.from(keys).map((k) => Number(k))));
    }
  };

  return (
    <div>
      <PageHeader
        title={t('reports.inactive_members_page_title')}
        description={t('reports.inactive_members_page_desc')}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              size="sm"
              selectedKeys={[days]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                if (v) setDays(String(v));
              }}
              className="w-32"
              aria-label={t('reports.label_days_threshold')}
            >
              {DAYS_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
              ))}
            </Select>
            <Select
              size="sm"
              selectedKeys={[flagType]}
              onSelectionChange={(keys) => {
                const v = Array.from(keys)[0];
                setFlagType(v !== undefined ? String(v) : 'all');
              }}
              className="w-32"
              aria-label={t('reports.label_flag_type')}
            >
              {FLAG_TYPE_OPTIONS.map((opt) => (
                <SelectItem key={opt.key} id={opt.key}>{opt.label}</SelectItem>
              ))}
            </Select>
            <Button
              variant="tertiary"
              startContent={<Scan size={16} />}
              onPress={handleDetect}
              isLoading={detecting}
              isDisabled={detecting}
              size="sm"
            >
              {t('reports.run_detection')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<Download size={16} />}
              onPress={async () => {
                try { await exportCsv(days); } catch { toast.error(t('reports.failed_to_export_c_s_v')); }
              }}
              size="sm"
            >
              {t('reports.export_csv')}
            </Button>
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadData}
              isLoading={loading}
              isDisabled={loading}
              size="sm"
            >
              {t('reports.refresh')}
            </Button>
          </div>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <StatCard
          label={t('reports.label_total_flagged')}
          value={stats?.total_flagged ?? '\u2014'}
          icon={AlertTriangle}
          color="danger"
          loading={!stats}
        />
        <StatCard
          label={t('reports.label_inactive')}
          value={stats?.inactive_count ?? '\u2014'}
          icon={UserX}
          color="warning"
          loading={!stats}
        />
        <StatCard
          label={t('reports.label_dormant')}
          value={stats?.dormant_count ?? '\u2014'}
          icon={Clock}
          color="danger"
          loading={!stats}
        />
        <StatCard
          label={t('reports.label_inactivity_rate')}
          value={stats ? formatNumber(stats.inactivity_rate, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '\u2014'}
          icon={Activity}
          color="default"
          loading={!stats}
        />
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
        <Card >
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('reports.label_active_members')}</p>
            <p className="text-2xl font-bold text-foreground">
              {stats?.total_active_members?.toLocaleString(getFormattingLocale()) ?? '\u2014'}
            </p>
          </CardBody>
        </Card>
        <Card >
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('reports.at_risk')}</p>
            <p className="text-2xl font-bold text-warning">
              {stats?.at_risk_count?.toLocaleString(getFormattingLocale()) ?? '\u2014'}
            </p>
          </CardBody>
        </Card>
        <Card >
          <CardBody className="p-4">
            <p className="text-sm text-muted">{t('reports.already_notified')}</p>
            <p className="text-2xl font-bold text-foreground">
              {stats?.notified_count?.toLocaleString(getFormattingLocale()) ?? '\u2014'}
            </p>
          </CardBody>
        </Card>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <Card  className="mb-4">
          <CardBody className="flex flex-row items-center gap-4 p-3">
            <span className="text-sm font-medium text-foreground">
              {t('reports.members_selected_count', { count: selectedIds.size })}
            </span>
            <Button
              size="sm"
              startContent={<Bell size={14} />}
              onPress={handleNotify}
              isLoading={notifying}
              isDisabled={notifying}
            >
              {t('reports.mark_as_notified')}
            </Button>
            <Button
              variant="tertiary"
              size="sm"
              onPress={() => setSelectedIds(new Set())}
            >
              {t('reports.clear_selection')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Members Table */}
      <Table
        aria-label={t('reports.label_inactive_members')}
        selectionMode="multiple"
        selectedKeys={selectedIds as unknown as Set<string | number>}
        onSelectionChange={handleSelectionChange as unknown as (keys: unknown) => void}
      >
        <TableHeader>
          <TableColumn>{t('reports.col_member')}</TableColumn>
          <TableColumn>{t('reports.col_flag_type')}</TableColumn>
          <TableColumn>{t('reports.col_days_inactive')}</TableColumn>
          <TableColumn>{t('reports.col_last_activity')}</TableColumn>
          <TableColumn>{t('reports.col_last_login')}</TableColumn>
          <TableColumn>{t('reports.col_notified')}</TableColumn>
        </TableHeader>
        <TableBody
          emptyContent={t('reports.no_inactive_members_run_detection')}
          isLoading={loading}
          loadingContent={<Spinner />}
        >
          {members.map((m) => (
            <TableRow key={m.user_id} id={m.user_id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar size="sm" src={resolveAvatarUrl(m.avatar_url) || undefined} name={m.name} />
                  <div>
                    <p className="text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted">{m.email}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Chip
                  size="sm"
                  variant="soft"
                  color={FLAG_COLORS[m.flag_type] ?? 'default'}
                >
                  {t(`reports.flag_${m.flag_type}`)}
                </Chip>
              </TableCell>
              <TableCell>
                <span className={`text-sm font-medium ${m.days_inactive > 180 ? 'text-danger' : m.days_inactive > 90 ? 'text-warning' : 'text-muted'}`}>
                  {t('reports.days_count', { count: m.days_inactive })}
                </span>
              </TableCell>
              <TableCell className="text-sm text-muted">
                {m.last_activity ? new Date(m.last_activity).toLocaleDateString(getFormattingLocale()) : t('reports.never')}
              </TableCell>
              <TableCell className="text-sm text-muted">
                {m.last_login ? new Date(m.last_login).toLocaleDateString(getFormattingLocale()) : t('reports.never')}
              </TableCell>
              <TableCell>
                {m.notified_at ? (
                  <Chip size="sm" variant="soft" color="default">
                    {new Date(m.notified_at).toLocaleDateString(getFormattingLocale())}
                  </Chip>
                ) : (
                  <Chip size="sm" variant="soft" color="default">{t('reports.not_yet')}</Chip>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <div className="flex justify-center mt-4">
          <Pagination total={totalPages} page={page} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

export default InactiveMembersPage;
