// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Volunteer Safeguarding
 * Admin page for managing safeguarding incidents and DLP assignments.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useCallback, useEffect } from 'react';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Search from 'lucide-react/icons/search';
import Eye from 'lucide-react/icons/eye';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Clock from 'lucide-react/icons/clock';
import Users from 'lucide-react/icons/users';
import Activity from 'lucide-react/icons/activity';
import ArrowRight from 'lucide-react/icons/arrow-right';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
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
  Autocomplete,
  AutocompleteItem,
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Select,
  SelectItem,
  Switch,
  Textarea,
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
  action_taken?: string;
  resolution_notes?: string;
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

/** What an incident can be filed under: the community's organisations and their opportunities. */
interface FilingOrganisation { id: number; name: string; }
interface FilingOpportunity { id: number; title: string; organization_id: number; organization_name: string; }

const INCIDENT_TYPES = ['concern', 'allegation', 'disclosure', 'near_miss', 'other'] as const;
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

/** Today in the browser's own calendar, for the date field's upper bound. */
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Someone an incident can be handed to — active broker-tier staff. */
interface IncidentHandler {
  id: number;
  name: string;
}

/** Sentinel for "nobody is handling this yet" in the handler picker. */
const NO_HANDLER = 'none';

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
}

export function VolunteerSafeguarding({ canAssignDlp = true }: VolunteerSafeguardingProps = {}) {
  const { t } = useTranslation('admin_volunteering');
  usePageTitle(t('volunteering.safeguarding_page_title'));
  const { embedded } = useAdminEmbed();
  const toast = useToast();

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
  // Whether the rows on screen came from a filtered request. Decided when the
  // rows arrive, not from the inputs: clearing a search that matched nothing
  // must not flash the "no incidents yet" screen before the full list loads.
  const [shownFiltered, setShownFiltered] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Update modal
  const [updateModal, setUpdateModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>('open');
  const [actionTaken, setActionTaken] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [handlerId, setHandlerId] = useState<string>(NO_HANDLER);
  const [handlers, setHandlers] = useState<IncidentHandler[]>([]);

  // How the incident is filed — staff can correct what the reporter chose, or
  // tie it to an organisation and opportunity the reporter did not pick.
  const [filing, setFiling] = useState({
    type: 'concern', severity: 'medium', date: '', organizationId: '', opportunityId: '',
    authorityNotified: false, authorityReference: '',
  });
  const [filingOrganisations, setFilingOrganisations] = useState<FilingOrganisation[]>([]);
  const [filingOpportunities, setFilingOpportunities] = useState<FilingOpportunity[]>([]);
  const [filingOptionsState, setFilingOptionsState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [filingError, setFilingError] = useState<string | null>(null);

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
      });
      if (res.success && res.data) {
        const payload = parsePayload<{
          incidents?: Incident[];
          stats?: IncidentStats;
          dlp_assignments?: DlpAssignment[];
          handlers?: IncidentHandler[];
          total?: number;
        }>(res.data);
        const rows = payload.incidents || [];
        setIncidents(rows);
        setShownFiltered(debouncedSearch !== '' || statusFilter !== ALL_STATUSES);
        setTotal(typeof payload.total === 'number' ? payload.total : rows.length);
        setStats(payload.stats || null);
        setDlpAssignments(payload.dlp_assignments || []);
        setHandlers(payload.handlers || []);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_incidents'));
      setIncidents([]);
      setTotal(0);
      setStats(null);
    }
    setLoading(false);
  }, [toast, t, page, debouncedSearch, statusFilter]);


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
    setPage(1);
  };

  // ── Actions ────────────────────────────────────────────────────────────────

  const loadFilingOptions = useCallback(async () => {
    setFilingOptionsState('loading');
    try {
      const res = await adminVolunteering.getIncidentReportOptions();
      const payload = res?.success && res.data
        ? parsePayload<{ organisations?: FilingOrganisation[]; opportunities?: FilingOpportunity[] }>(res.data)
        : null;
      if (!payload) {
        setFilingOptionsState('failed');
        return;
      }
      setFilingOrganisations(payload.organisations || []);
      setFilingOpportunities(payload.opportunities || []);
      setFilingOptionsState('ready');
    } catch {
      setFilingOptionsState('failed');
    }
  }, []);

  const filingFrom = (incident: Incident) => ({
    type: incident.type,
    severity: incident.severity,
    date: (incident.incident_date || '').slice(0, 10),
    organizationId: incident.organization_id ? String(incident.organization_id) : '',
    opportunityId: incident.opportunity_id ? String(incident.opportunity_id) : '',
    authorityNotified: !!Number(incident.authority_notified ?? 0),
    authorityReference: incident.authority_reference || '',
  });

  const openUpdate = (incident: Incident) => {
    setSelectedIncident(incident);
    setUpdateStatus(incident.status);
    setActionTaken(incident.action_taken || '');
    setResolutionNotes(incident.resolution_notes || '');
    setHandlerId(incident.assigned_to ? String(incident.assigned_to) : NO_HANDLER);
    setFiling(filingFrom(incident));
    setFilingError(null);
    if (filingOptionsState === 'idle' || filingOptionsState === 'failed') void loadFilingOptions();
    setUpdateModal(true);
  };

  // An inactive or removed organisation is not in the community's list, but an
  // incident already filed under it must still show it.
  const organisationChoices: FilingOrganisation[] = (() => {
    const list = [...filingOrganisations];
    const currentId = selectedIncident?.organization_id;
    if (currentId && !list.some((o) => o.id === currentId)) {
      list.unshift({ id: currentId, name: selectedIncident?.organization_name || `#${currentId}` });
    }
    return list;
  })();
  const opportunityChoices: FilingOpportunity[] = (() => {
    const list = filing.organizationId
      ? filingOpportunities.filter((o) => String(o.organization_id) === filing.organizationId)
      : filingOpportunities;
    const currentId = selectedIncident?.opportunity_id;
    if (currentId && String(currentId) === filing.opportunityId && !list.some((o) => o.id === currentId)) {
      return [{ id: currentId, title: selectedIncident?.opportunity_title || `#${currentId}`, organization_id: Number(filing.organizationId) || 0, organization_name: '' }, ...list];
    }
    return list;
  })();

  const chooseFilingOrganisation = (key: string | null) => {
    setFiling((f) => {
      const keep = !!key && filingOpportunities.some((o) => String(o.id) === f.opportunityId && String(o.organization_id) === key);
      return { ...f, organizationId: key ?? '', opportunityId: keep ? f.opportunityId : '' };
    });
  };
  const chooseFilingOpportunity = (key: string | null) => {
    const chosen = key ? filingOpportunities.find((o) => String(o.id) === key) : undefined;
    // Choosing an opportunity also files the incident under its organisation.
    setFiling((f) => ({ ...f, opportunityId: key ?? '', organizationId: chosen ? String(chosen.organization_id) : f.organizationId }));
  };

  const handleUpdate = async () => {
    if (!selectedIncident) return;
    setActionLoading(true);
    try {
      if (filing.date && filing.date > todayIso()) {
        setFilingError(t('volunteering.incident_date_future'));
        setActionLoading(false);
        return;
      }
      const data: Parameters<typeof adminVolunteering.updateIncident>[1] = {
        status: updateStatus,
      };
      // Only what changed is sent: a newly linked organisation is told.
      const before = filingFrom(selectedIncident);
      if (filing.type !== before.type) data.incident_type = filing.type;
      if (filing.severity !== before.severity) data.severity = filing.severity;
      if (filing.date && filing.date !== before.date) data.incident_date = filing.date;
      if (filing.organizationId !== before.organizationId || filing.opportunityId !== before.opportunityId) {
        data.organization_id = filing.organizationId ? Number(filing.organizationId) : null;
        data.opportunity_id = filing.opportunityId ? Number(filing.opportunityId) : null;
      }
      if (filing.authorityNotified !== before.authorityNotified) data.authority_notified = filing.authorityNotified;
      if (filing.authorityReference.trim() !== before.authorityReference) data.authority_reference = filing.authorityReference.trim();
      if (actionTaken.trim()) data.action_taken = actionTaken.trim();
      if (resolutionNotes.trim()) data.resolution_notes = resolutionNotes.trim();
      // Send the handler only when it changed: a new handler is notified.
      const currentHandler = selectedIncident.assigned_to ? String(selectedIncident.assigned_to) : NO_HANDLER;
      if (handlerId !== currentHandler) {
        data.assigned_to = handlerId === NO_HANDLER ? null : Number(handlerId);
      }

      const res = await adminVolunteering.updateIncident(selectedIncident.id, data);
      if (res.success) {
        toast.success(t('volunteering.incident_updated'));
        setUpdateModal(false);
        loadData();
      } else {
        toast.error(t('volunteering.failed_to_update_incident'));
      }
    } catch {
      toast.error(t('volunteering.failed_to_update_incident'));
    }
    setActionLoading(false);
  };

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
      render: (item) => <span className="font-medium">{item.title || '--'}</span>,
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
        <Button
          size="sm"
          variant="tertiary"
          startContent={<Eye size={14} />}
          onPress={() => openUpdate(item)}
        >
          {t('volunteering.update_status')}
        </Button>
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

      {/* Stats Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('volunteering.stat_total_incidents')}
          value={stats?.total_incidents ?? 0}
          icon={ShieldAlert}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_open')}
          value={stats?.open ?? 0}
          icon={AlertTriangle}
          color="warning"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_under_investigation')}
          value={stats?.under_investigation ?? 0}
          icon={Search}
          color="default"
          loading={loading}
        />
        <StatCard
          label={t('volunteering.stat_resolved')}
          value={stats?.resolved ?? 0}
          icon={CheckCircle}
          color="success"
          loading={loading}
        />
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
          topContent={
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

      {/* Recent Actions / Audit Log */}
      {incidents.length > 0 && (
        <Card className="border border-divider/70 shadow-sm shadow-black/[0.03]">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity size={18} />
              <span className="font-semibold">
                {t('volunteering.recent_actions_title')}
              </span>
            </div>
          </CardHeader>
          <CardBody>
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-[15px] top-2 bottom-2 w-0.5 bg-border" />

              <div className="space-y-4">
                {[...incidents]
                  .sort((a, b) => {
                    const dateA = new Date(a.date || 0).getTime();
                    const dateB = new Date(b.date || 0).getTime();
                    return dateB - dateA;
                  })
                  .slice(0, 20)
                  .map((incident) => (
                    <div key={incident.id} className="flex items-start gap-3 relative pl-9">
                      {/* Timeline dot */}
                      <div
                        className={`absolute left-[10px] top-1.5 w-3 h-3 rounded-full border-2 border-background ${
                          incident.status === 'resolved' || incident.status === 'closed'
                            ? 'bg-success'
                            : incident.status === 'escalated'
                              ? 'bg-danger'
                              : incident.status === 'investigating'
                                ? 'bg-accent'
                                : 'bg-warning'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">
                            {t(`volunteering.incident_type_${incident.type}`)}
                          </span>
                          <ArrowRight size={12} className="text-muted" />
                          <Chip
                            size="sm"
                            color={STATUS_COLORS[incident.status] || 'default'}
                            variant="soft"
                          >
                            {t(`volunteering.status_${incident.status}`)}
                          </Chip>
                          <Chip
                            size="sm"
                            color={SEVERITY_COLORS[incident.severity] || 'default'}
                            variant="dot"
                          >
                            {t(`volunteering.severity_${incident.severity}`)}
                          </Chip>
                        </div>
                        <p className="text-xs text-muted mt-0.5">
                          {/* Only the parts an incident has: one with no subject
                              began with a stray "— ". */}
                          {[
                            [incident.subject_name, incident.organization_name].filter(Boolean).join(' — '),
                            t('volunteering.reported_by', { name: incident.reporter_name }),
                          ].filter(Boolean).join(' | ')}
                        </p>
                        {incident.action_taken && (
                          <p className="text-xs text-muted mt-0.5 italic">
                            {incident.action_taken}
                          </p>
                        )}
                        <p className="text-xs text-muted mt-0.5">
                          {incident.date ? new Date(incident.date).toLocaleString(getFormattingLocale()) : '--'}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Update Incident Modal */}
      <Modal isOpen={updateModal} onClose={() => setUpdateModal(false)} size="lg">
        <ModalContent>
          <ModalHeader>
            {t('volunteering.update_incident')}
          </ModalHeader>
          <ModalBody>
            {selectedIncident && (
              <div className="space-y-4">
                {selectedIncident.title && (
                  <p className="text-base font-semibold">{selectedIncident.title}</p>
                )}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted">{t('volunteering.col_reporter')}:</span>
                    <p className="font-medium">{selectedIncident.reporter_name}</p>
                  </div>
                  <div>
                    <span className="text-muted">{t('volunteering.col_subject')}:</span>
                    <p className="font-medium">{selectedIncident.subject_name || '--'}</p>
                  </div>
                  <div>
                    <span className="text-muted">{t('volunteering.reported_on')}:</span>
                    <p className="font-medium">
                      {selectedIncident.created_at ? new Date(selectedIncident.created_at).toLocaleDateString(getFormattingLocale()) : '--'}
                    </p>
                  </div>
                </div>

                {selectedIncident.description && (
                  <div>
                    <span className="text-muted text-sm">{t('volunteering.description')}:</span>
                    <p className="text-sm mt-1">{selectedIncident.description}</p>
                  </div>
                )}

                {/* How it is filed. Staff can correct the reporter's choices and
                    link an organisation they did not pick. */}
                <section aria-labelledby="incident-filing-heading" className="space-y-3 rounded-2xl border border-divider/70 p-3">
                  <h3 id="incident-filing-heading" className="text-sm font-semibold">{t('volunteering.filing_heading')}</h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Select
                      label={t('volunteering.col_incident_type')}
                      selectedKeys={[filing.type]}
                      onSelectionChange={(keys) => setFiling((f) => ({ ...f, type: (Array.from(keys)[0] as string) || f.type }))}
                    >
                      {INCIDENT_TYPES.map((type) => (
                        <SelectItem key={type} id={type}>{t(`volunteering.incident_type_${type}`)}</SelectItem>
                      ))}
                    </Select>
                    <Select
                      label={t('volunteering.col_severity')}
                      selectedKeys={[filing.severity]}
                      onSelectionChange={(keys) => setFiling((f) => ({ ...f, severity: (Array.from(keys)[0] as string) || f.severity }))}
                    >
                      {SEVERITIES.map((sev) => (
                        <SelectItem key={sev} id={sev}>{t(`volunteering.severity_${sev}`)}</SelectItem>
                      ))}
                    </Select>
                  </div>
                  <Input
                    type="date"
                    label={t('volunteering.incident_date_label')}
                    value={filing.date}
                    max={todayIso()}
                    onValueChange={(v) => { setFilingError(null); setFiling((f) => ({ ...f, date: v })); }}
                    isInvalid={!!filingError}
                    errorMessage={filingError ?? undefined}
                  />
                  {filingOptionsState === 'failed' ? (
                    <p className="text-sm text-warning" role="status">{t('volunteering.filing_options_unavailable')}</p>
                  ) : (
                    <>
                      <Autocomplete
                        label={t('volunteering.col_organization')}
                        placeholder={t('volunteering.filing_no_organisation')}
                        searchPlaceholder={t('volunteering.filing_search_organisations')}
                        value={filing.organizationId || null}
                        onChange={(key) => chooseFilingOrganisation(key && !Array.isArray(key) ? String(key) : null)}
                        isDisabled={filingOptionsState !== 'ready' && organisationChoices.length === 0}
                      >
                        {organisationChoices.map((org) => (
                          <AutocompleteItem key={String(org.id)} id={String(org.id)} textValue={org.name}>{org.name}</AutocompleteItem>
                        ))}
                      </Autocomplete>
                      {filing.organizationId && (
                        <Button size="sm" variant="tertiary" onPress={() => chooseFilingOrganisation(null)}>
                          {t('volunteering.filing_clear_organisation')}
                        </Button>
                      )}
                      <Autocomplete
                        label={t('volunteering.col_opportunity')}
                        placeholder={t('volunteering.filing_no_opportunity')}
                        searchPlaceholder={t('volunteering.filing_search_opportunities')}
                        value={filing.opportunityId || null}
                        onChange={(key) => chooseFilingOpportunity(key && !Array.isArray(key) ? String(key) : null)}
                        isDisabled={opportunityChoices.length === 0}
                      >
                        {opportunityChoices.map((opp) => (
                          <AutocompleteItem key={String(opp.id)} id={String(opp.id)} textValue={`${opp.title} ${opp.organization_name}`}>
                            {filing.organizationId || !opp.organization_name ? opp.title : `${opp.title} — ${opp.organization_name}`}
                          </AutocompleteItem>
                        ))}
                      </Autocomplete>
                      {filing.organizationId !== (selectedIncident.organization_id ? String(selectedIncident.organization_id) : '') && filing.organizationId && (
                        <p className="text-xs text-muted" role="note">{t('volunteering.filing_org_notice')}</p>
                      )}
                    </>
                  )}
                  <Switch
                    isSelected={filing.authorityNotified}
                    onValueChange={(v) => setFiling((f) => ({ ...f, authorityNotified: v }))}
                  >
                    {t('volunteering.authority_notified_label')}
                  </Switch>
                  {filing.authorityNotified && (
                    <Input
                      label={t('volunteering.authority_reference_label')}
                      description={t('volunteering.authority_reference_help')}
                      maxLength={100}
                      value={filing.authorityReference}
                      onValueChange={(v) => setFiling((f) => ({ ...f, authorityReference: v }))}
                    />
                  )}
                </section>

                <Select
                  label={t('volunteering.status')}
                  selectedKeys={[updateStatus]}
                  onSelectionChange={(keys) => setUpdateStatus(Array.from(keys)[0] as string)}
                >
                  <SelectItem key="open" id="open">{t('volunteering.status_open')}</SelectItem>
                  <SelectItem key="investigating" id="investigating">{t('volunteering.status_investigating')}</SelectItem>
                  <SelectItem key="resolved" id="resolved">{t('volunteering.status_resolved')}</SelectItem>
                  <SelectItem key="escalated" id="escalated">{t('volunteering.status_escalated')}</SelectItem>
                  <SelectItem key="closed" id="closed">{t('volunteering.status_closed')}</SelectItem>
                </Select>

                <Select
                  label={t('volunteering.handled_by_label')}
                  description={t('volunteering.handled_by_help')}
                  selectedKeys={[handlerId]}
                  onSelectionChange={(keys) => setHandlerId((Array.from(keys)[0] as string) || NO_HANDLER)}
                >
                  {[
                    <SelectItem key={NO_HANDLER} id={NO_HANDLER}>{t('volunteering.handled_by_nobody')}</SelectItem>,
                    // Nobody handles an incident about themselves (F-507).
                    ...handlers
                      .filter((h) => h.id !== selectedIncident.subject_user_id && h.id !== selectedIncident.involved_user_id)
                      .map((h) => <SelectItem key={String(h.id)} id={String(h.id)}>{h.name}</SelectItem>),
                  ]}
                </Select>

                <Textarea
                  label={t('volunteering.action_taken')}
                  placeholder={t('volunteering.action_taken_placeholder')}
                  value={actionTaken}
                  onValueChange={setActionTaken}
                />

                <Textarea
                  label={t('volunteering.resolution_notes')}
                  placeholder={t('volunteering.resolution_notes_placeholder')}
                  value={resolutionNotes}
                  onValueChange={setResolutionNotes}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setUpdateModal(false)}>
              {t('volunteering.cancel')}
            </Button>
            <Button
              variant="primary"
              onPress={handleUpdate}
              isLoading={actionLoading}
              startContent={<Clock size={16} />}
            >
              {t('volunteering.update_incident')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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
