// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Safeguarding
 * Admin page listing safeguarding incidents and DLP assignments. Each incident
 * opens its own case file (incidents/VolunteerIncidentCase.tsx), where staff
 * act on it; this list only finds and filters them.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Search from 'lucide-react/icons/search';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Users from 'lucide-react/icons/users';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { adminVolunteering } from '../../api/adminApi';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { MemberSearchPicker, type MemberSearchMember } from '../../components/MemberSearchPicker';
import { EmptyState } from '../../components/EmptyState';
import { AdminEmbedAutoRefresh, useAdminEmbed } from '../../components/AdminEmbedContext';
import { BrokerSkeleton } from '@/broker/components/BrokerSkeleton';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
} from '@/components/ui';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Incident {
  id: number;
  title?: string | null;
  type: 'concern' | 'allegation' | 'disclosure' | 'near_miss' | 'other';
  severity: 'low' | 'medium' | 'high' | 'critical';
  reporter_name: string;
  subject_name: string;
  organization_name: string;
  status: 'open' | 'investigating' | 'resolved' | 'escalated' | 'closed';
  date: string;
  description?: string;
  opportunity_title?: string | null;
  assigned_to?: number | null;
  assigned_to_name?: string | null;
  subject_user_id?: number | null;
  involved_user_id?: number | null;
  incident_date?: string | null;
  created_at?: string | null;
  organization_id?: number | null;
  opportunity_id?: number | null;
  authority_notified?: number | boolean | null;
  authority_reference?: string | null;
}

/** Sentinel for "every status" in the status filter. */
const ALL_STATUSES = 'all';
const INCIDENT_STATUSES = ['open', 'investigating', 'resolved', 'escalated', 'closed'] as const;

/** Rows per page. The API caps a page at 50. */
const PAGE_SIZE = 20;

interface IncidentStats {
  total_incidents: number;
  open: number;
  under_investigation: number;
  resolved: number;
}

interface DlpAssignment {
  organization_id: number;
  organization_name: string;
  dlp_user_id: number | null;
  dlp_user_name: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, 'warning' | 'success' | 'danger' | 'accent' | 'default'> = {
  open: 'warning',
  investigating: 'accent',
  resolved: 'success',
  escalated: 'danger',
  closed: 'default',
};

const SEVERITY_COLORS: Record<string, 'success' | 'warning' | 'danger'> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

function parsePayload<T>(raw: unknown): T {
  if (raw && typeof raw === 'object' && 'data' in raw) {
    return (raw as { data: T }).data;
  }
  return raw as T;
}

// ── Component ──────────────────────────────────────────────────────────────────

interface VolunteerSafeguardingProps {
  /**
   * Whether the viewer may assign an organisation's designated liaison person.
   * The broker safeguarding page embeds this screen with `false`: brokers and
   * coordinators handle incidents (F-536) but DLP assignment stays admin-only.
   */
  canAssignDlp?: boolean;
  /** Where each incident's case file lives: `${caseBasePath}/${id}` (tenant-relative). */
  caseBasePath?: string;
}

export function VolunteerSafeguarding({
  canAssignDlp = true,
  caseBasePath = '/admin/volunteering/safeguarding',
}: VolunteerSafeguardingProps = {}) {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.safeguarding_page_title'));
  const { embedded } = useAdminEmbed();
  const toast = useToast();
  const { tenantPath } = useTenant();
  const navigate = useNavigate();
  const casePath = (id: number) => tenantPath(`${caseBasePath}/${id}`);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [stats, setStats] = useState<IncidentStats | null>(null);
  const [loading, setLoading] = useState(true);

  // Paging, search and status filter all run on the server. This screen asked
  // for one page of 20 and had no way to ask for more, so incident 21 onwards
  // could not be reached at all.
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);
  // Only incidents nobody has taken on yet.
  const [unhandledOnly, setUnhandledOnly] = useState(false);
  // Whether the rows on screen came from a filtered request. Decided when the
  // rows arrive, not from the inputs: clearing a search that matched nothing
  // must not flash the "no incidents yet" screen before the full list loads.
  const [shownFiltered, setShownFiltered] = useState(false);
  // DLP assignments
  const [dlpAssignments, setDlpAssignments] = useState<DlpAssignment[]>([]);
  const [dlpLoading, setDlpLoading] = useState(false);
  const [dlpModal, setDlpModal] = useState(false);
  const [selectedOrg, setSelectedOrg] = useState<DlpAssignment | null>(null);
  const [dlpUserId, setDlpUserId] = useState('');
  const [dlpMember, setDlpMember] = useState<MemberSearchMember | null>(null);
  // Why the last attempt was refused, shown in the dialog beside the field.
  const [dlpError, setDlpError] = useState<string | null>(null);

  // ── Data loading ───────────────────────────────────────────────────────────

  // `quiet` keeps the current rows on screen while fresh ones load — used by
  // the broker panel's auto-refresh so the table never flashes empty.
  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const res = await adminVolunteering.getIncidents({
        page,
        per_page: PAGE_SIZE,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter !== ALL_STATUSES ? { status: statusFilter } : {}),
        ...(unhandledOnly ? { handler: 'none' as const } : {}),
      });
      if (res.success && res.data) {
        const payload = parsePayload<{
          incidents?: Incident[];
          stats?: IncidentStats;
          dlp_assignments?: DlpAssignment[];
          total?: number;
        }>(res.data);
        const rows = payload.incidents || [];
        setIncidents(rows);
        setShownFiltered(debouncedSearch !== '' || statusFilter !== ALL_STATUSES || unhandledOnly);
        setTotal(typeof payload.total === 'number' ? payload.total : rows.length);
        setStats(payload.stats || null);
        setDlpAssignments(payload.dlp_assignments || []);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_incidents'));
      setIncidents([]);
      setTotal(0);
      setStats(null);
    }
    setLoading(false);
  }, [toast, t, page, debouncedSearch, statusFilter, unhandledOnly]);


  useEffect(() => { loadData(); }, [loadData]);

  // Search as the coordinator types, without a request per keystroke. A new
  // search or filter always starts again from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next !== debouncedSearch) {
        setDebouncedSearch(next);
        setPage(1);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, debouncedSearch]);

  const clearFilters = () => {
    setSearch('');
    setDebouncedSearch('');
    setStatusFilter(ALL_STATUSES);
    setUnhandledOnly(false);
    setPage(1);
  };

  /** The stat tiles double as quick filters. */
  const filterByStatus = (status: string) => {
    setStatusFilter(status);
    setPage(1);
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const openDlpAssign = (assignment: DlpAssignment) => {
    setSelectedOrg(assignment);
    // Start empty: the picker is a search box, and the current DLP is named
    // under it. Pre-filling the id would make the picker look the person up.
    setDlpUserId('');
    setDlpMember(null);
    setDlpError(null);
    setDlpModal(true);
  };

  const handleDlpAssign = async () => {
    if (!selectedOrg) return;
    const userId = parseInt(dlpUserId, 10);
    if (isNaN(userId) || userId <= 0) {
      setDlpError(t('volunteering.dlp_choose_person'));
      return;
    }
    setDlpLoading(true);
    setDlpError(null);
    try {
      const res = await adminVolunteering.assignDlp(selectedOrg.organization_id, userId);
      if (res.success) {
        toast.success(t('volunteering.dlp_assigned'));
        setDlpModal(false);
        loadData();
      } else {
        // The server says which rule was broken (not a member of this
        // community, account not active…) in the community's language.
        // admin-i18n-ignore: localized server message — VolunteerWellbeingController::assignDlp
        // renders every refusal through __('api.vol_dlp_*') in the caller's locale.
        setDlpError(res.error || t('volunteering.failed_to_assign_dlp'));
      }
    } catch {
      setDlpError(t('volunteering.failed_to_assign_dlp'));
    }
    setDlpLoading(false);
  };

  // ── Columns ────────────────────────────────────────────────────────────────

  const columns: Column<Incident>[] = [
    {
      key: 'title',
      label: t('volunteering.col_title'),
      sortable: true,
      render: (item) => (
        <span className="font-medium">
          <span className="mr-1 text-muted">#{item.id}</span>
          {item.title || '--'}
        </span>
      ),
    },
    {
      key: 'type',
      label: t('volunteering.col_incident_type'),
      sortable: true,
      render: (item) => (
        <Chip size="sm" variant="soft">
          {t(`volunteering.incident_type_${item.type}`)}
        </Chip>
      ),
    },
    {
      key: 'severity',
      label: t('volunteering.col_severity'),
      sortable: true,
      render: (item) => (
        <Chip
          size="sm"
          color={SEVERITY_COLORS[item.severity] || 'default'}
          variant="soft"
          className={item.severity === 'critical' ? 'font-bold' : ''}
        >
          {t(`volunteering.severity_${item.severity}`)}
        </Chip>
      ),
    },
    {
      key: 'reporter_name',
      label: t('volunteering.col_reporter'),
      sortable: true,
    },
    {
      key: 'subject_name',
      label: t('volunteering.col_subject'),
      sortable: true,
    },
    {
      key: 'organization_name',
      label: t('volunteering.col_organization'),
      sortable: true,
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
      key: 'assigned_to_name',
      label: t('volunteering.col_handled_by'),
      sortable: true,
      render: (item) => item.assigned_to_name
        ? <span className="text-sm">{item.assigned_to_name}</span>
        : <span className="text-sm text-warning">{t('volunteering.handled_by_nobody')}</span>,
    },
    {
      key: 'date',
      label: t('volunteering.col_date'),
      sortable: true,
      render: (item) => (
        <span className="text-sm text-muted">
          {item.date ? new Date(item.date).toLocaleDateString(getFormattingLocale()) : '--'}
        </span>
      ),
    },
    {
      key: 'actions',
      label: t('volunteering.col_actions'),
      render: (item) => (
        <Link
          to={casePath(item.id)}
          className="text-sm font-medium text-accent hover:underline"
          aria-label={t('volunteering.open_case_for', { id: item.id })}
        >
          {t('volunteering.open_case')}
        </Link>
      ),
    },
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <AdminEmbedAutoRefresh reload={() => void loadData(true)} />
      <PageHeader
        title={t('volunteering.safeguarding_title')}
        description={t('volunteering.safeguarding_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={() => void loadData()}
            isLoading={loading}
          >
            {t('volunteering.refresh')}
          </Button>
        }
      />

      {/* Stats Row — each tile also filters the list */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {([
          [ALL_STATUSES, t('volunteering.stat_total_incidents'), stats?.total_incidents, ShieldAlert, 'default'],
          ['open', t('volunteering.stat_open'), stats?.open, AlertTriangle, 'warning'],
          ['investigating', t('volunteering.stat_under_investigation'), stats?.under_investigation, Search, 'default'],
          ['resolved', t('volunteering.stat_resolved'), stats?.resolved, CheckCircle, 'success'],
        ] as const).map(([key, label, value, icon, color]) => (
          <button
            key={key}
            type="button"
            className="rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-pressed={statusFilter === key}
            aria-label={t('volunteering.stat_filter_label', { label })}
            onClick={() => filterByStatus(key)}
          >
            <StatCard label={label} value={value ?? 0} icon={icon} color={color} loading={loading} />
          </button>
        ))}
      </div>

      {/* Incidents Table — embedded, the first load is a shaped skeleton */}
      {embedded && loading && incidents.length === 0 && !shownFiltered ? (
        <BrokerSkeleton variant="table" />
      ) : !loading && incidents.length === 0 && !shownFiltered ? (
        <EmptyState
          icon={ShieldAlert}
          title={t('volunteering.no_incidents')}
          description={t('volunteering.no_incidents_desc')}
        />
      ) : (
        <DataTable
          columns={columns}
          data={incidents}
          isLoading={loading && !embedded}
          onRefresh={() => void loadData()}
          searchPlaceholder={t('volunteering.incidents_search_placeholder')}
          searchValue={search}
          onSearch={setSearch}
          totalItems={total}
          page={page}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          onRowClick={(item) => navigate(casePath(item.id))}
          topContent={
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Select
              aria-label={t('volunteering.incidents_status_filter')}
              className="w-full sm:w-48"
              size="sm"
              selectedKeys={[statusFilter]}
              onSelectionChange={(keys) => {
                setStatusFilter((Array.from(keys)[0] as string) || ALL_STATUSES);
                setPage(1);
              }}
            >
              {[
                <SelectItem key={ALL_STATUSES} id={ALL_STATUSES}>{t('volunteering.incidents_status_all')}</SelectItem>,
                ...INCIDENT_STATUSES.map((status) => (
                  <SelectItem key={status} id={status}>{t(`volunteering.status_${status}`)}</SelectItem>
                )),
              ]}
            </Select>
            <Switch
              size="sm"
              isSelected={unhandledOnly}
              onValueChange={(v) => { setUnhandledOnly(v); setPage(1); }}
            >
              {t('volunteering.filter_nobody_handling')}
            </Switch>
            </div>
          }
          emptyContent={
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <p className="text-sm text-muted">{t('volunteering.incidents_no_match')}</p>
              <Button size="sm" variant="tertiary" onPress={clearFilters}>
                {t('volunteering.incidents_clear_filters')}
              </Button>
            </div>
          }
        />
      )}

      {/* DLP Assignments Section */}
      <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users size={18} />
            <span className="font-semibold">
              {t('volunteering.dlp_assignments_title')}
            </span>
          </div>
        </CardHeader>
        <CardBody>
          {dlpAssignments.length === 0 ? (
            <p className="text-muted text-sm">
              {t('volunteering.no_dlp_assignments')}
            </p>
          ) : (
            <div className="space-y-3">
              {dlpAssignments.map((assignment) => (
                <div
                  key={assignment.organization_id}
                  className="flex items-center justify-between rounded-2xl border border-divider/70 bg-surface-secondary/50 p-3"
                >
                  <div>
                    <p className="font-medium">{assignment.organization_name}</p>
                    <p className="text-sm text-muted">
                      {t('volunteering.dlp_label')}:{' '}
                      {assignment.dlp_user_name ? (
                        <span className="text-success font-medium">{assignment.dlp_user_name}</span>
                      ) : (
                        <span className="text-warning">{t('volunteering.not_assigned')}</span>
                      )}
                    </p>
                  </div>
                  {canAssignDlp && (
                    <Button
                      size="sm"
                      variant="tertiary"
                      onPress={() => openDlpAssign(assignment)}
                    >
                      {assignment.dlp_user_id
                        ? t('volunteering.change_dlp')
                        : t('volunteering.assign_dlp')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* DLP Assignment Modal */}
      <Modal isOpen={dlpModal} onClose={() => setDlpModal(false)} size="md">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.assign_dlp_title')}
            {selectedOrg && ` — ${selectedOrg.organization_name}`}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              <p className="text-sm text-muted">
                {t('volunteering.dlp_explanation')}
              </p>
              {selectedOrg?.dlp_user_name && (
                <p className="text-sm text-muted">
                  {t('volunteering.current_dlp')}: <span className="font-medium text-foreground/80">{selectedOrg.dlp_user_name}</span>
                </p>
              )}
              <MemberSearchPicker
                value={dlpUserId}
                onValueChange={(next) => {
                  setDlpUserId(next);
                  setDlpError(null);
                }}
                selectedMember={dlpMember}
                onSelectedMemberChange={setDlpMember}
                label={t('volunteering.dlp_person_label')}
                // Any active member may be an organisation's DLP — no broker or
                // admin role needed (owner decision, 4 Oct 2026).
                description={t('volunteering.dlp_person_help_any_member')}
                placeholder={t('volunteering.dlp_person_placeholder')}
                noResultsText={t('volunteering.dlp_person_no_results')}
                clearText={t('volunteering.dlp_person_clear')}
                isRequired
              />
              {dlpError && (
                <p role="alert" className="text-sm text-danger">
                  {dlpError}
                </p>
              )}
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setDlpModal(false)}>
              {t('volunteering.cancel')}
            </Button>
            <Button
              variant="primary"
              onPress={handleDlpAssign}
              isLoading={dlpLoading}
            >
              {t('volunteering.assign')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default VolunteerSafeguarding;
