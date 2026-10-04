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
  Textarea,
} from '@/components/ui';

// ── Types ──────────────────────────────────────────────────────────────────────

interface Incident {
  id: number;
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
}

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
  const [actionLoading, setActionLoading] = useState(false);

  // Update modal
  const [updateModal, setUpdateModal] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [updateStatus, setUpdateStatus] = useState<string>('open');
  const [actionTaken, setActionTaken] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');

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
      const res = await adminVolunteering.getIncidents();
      if (res.success && res.data) {
        const payload = parsePayload<{
          incidents?: Incident[];
          stats?: IncidentStats;
          dlp_assignments?: DlpAssignment[];
        }>(res.data);
        setIncidents(payload.incidents || []);
        setStats(payload.stats || null);
        setDlpAssignments(payload.dlp_assignments || []);
      }
    } catch {
      toast.error(t('volunteering.failed_to_load_incidents'));
      setIncidents([]);
      setStats(null);
    }
    setLoading(false);
  }, [toast, t]);


  useEffect(() => { loadData(); }, [loadData]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const openUpdate = (incident: Incident) => {
    setSelectedIncident(incident);
    setUpdateStatus(incident.status);
    setActionTaken(incident.action_taken || '');
    setResolutionNotes(incident.resolution_notes || '');
    setUpdateModal(true);
  };

  const handleUpdate = async () => {
    if (!selectedIncident) return;
    setActionLoading(true);
    try {
      const data: { status: string; action_taken?: string; resolution_notes?: string } = {
        status: updateStatus,
      };
      if (actionTaken.trim()) data.action_taken = actionTaken.trim();
      if (resolutionNotes.trim()) data.resolution_notes = resolutionNotes.trim();

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
        // The server says which rule was broken (not a member, not active, not
        // broker-level…) in the community's language, so show that.
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
      {embedded && loading && incidents.length === 0 ? (
        <BrokerSkeleton variant="table" />
      ) : !loading && incidents.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={t('volunteering.no_incidents')}
          description={t('volunteering.no_incidents_desc')}
        />
      ) : (
        <DataTable columns={columns} data={incidents} isLoading={loading && !embedded} onRefresh={() => void loadData()} />
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
                          {incident.subject_name}
                          {incident.organization_name && ` — ${incident.organization_name}`}
                          {' | '}
                          {t('volunteering.reported_by', { name: incident.reporter_name })}
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
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted">{t('volunteering.col_incident_type')}:</span>
                    <p className="font-medium">{t(`volunteering.incident_type_${selectedIncident.type}`)}</p>
                  </div>
                  <div>
                    <span className="text-muted">{t('volunteering.col_severity')}:</span>
                    <p>
                      <Chip
                        size="sm"
                        color={SEVERITY_COLORS[selectedIncident.severity] || 'default'}
                        variant="soft"
                        className={selectedIncident.severity === 'critical' ? 'font-bold' : ''}
                      >
                        {t(`volunteering.severity_${selectedIncident.severity}`)}
                      </Chip>
                    </p>
                  </div>
                  <div>
                    <span className="text-muted">{t('volunteering.col_reporter')}:</span>
                    <p className="font-medium">{selectedIncident.reporter_name}</p>
                  </div>
                  <div>
                    <span className="text-muted">{t('volunteering.col_subject')}:</span>
                    <p className="font-medium">{selectedIncident.subject_name}</p>
                  </div>
                </div>

                {selectedIncident.description && (
                  <div>
                    <span className="text-muted text-sm">{t('volunteering.description')}:</span>
                    <p className="text-sm mt-1">{selectedIncident.description}</p>
                  </div>
                )}

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
                description={t('volunteering.dlp_person_help')}
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
