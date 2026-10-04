import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, useDisclosure, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import TriangleAlert from 'lucide-react/icons/triangle-alert';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { Abbr } from '../../components/Abbr';
import { PageHeader } from '../../components/PageHeader';
import { safeHref } from '@/lib/safeHref';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type Severity = 'low' | 'medium' | 'high' | 'critical';
type Status = 'submitted' | 'triaged' | 'investigating' | 'resolved' | 'dismissed';

type Report = {
  id: number;
  reporter_id: number;
  reporter_name: string;
  subject_user_id: number | null;
  subject_user_name: string | null;
  subject_organisation_id: number | null;
  category: string;
  severity: Severity;
  description: string;
  evidence_url: string | null;
  status: Status;
  assigned_to_user_id: number | null;
  assigned_to_name: string | null;
  review_due_at: string | null;
  is_overdue: boolean;
  escalated: boolean;
  escalated_at: string | null;
  resolution_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

type Action = {
  id: number;
  actor_id: number;
  actor_name: string;
  action: string;
  notes: string | null;
  created_at: string;
};

type ReportDetail = Report & { actions: Action[] };

const SEVERITY_COLOR: Record<Severity, 'danger' | 'warning' | 'default' | 'success'> = {
  critical: 'danger',
  high: 'warning',
  medium: 'default',
  low: 'success',
};

const STATUS_COLOR: Record<Status, 'default' | 'primary' | 'warning' | 'success'> = {
  submitted: 'primary',
  triaged: 'primary',
  investigating: 'warning',
  resolved: 'success',
  dismissed: 'default',
};

const ALL_STATUSES: Status[] = ['submitted', 'triaged', 'investigating', 'resolved', 'dismissed'];
const ALL_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export default function SafeguardingReportsAdminPage(): ReactNode {
  const { t } = useTranslation('caring_community');
  const { t: tAdmin } = useTranslation('admin_caring_community');
  usePageTitle(t('admin.safeguarding_reports.meta_title'));
  useAdminPageMeta({
    title: t('admin.safeguarding_reports.meta_title'),
    description: t('admin.safeguarding_reports.subtitle'),
  });
  const { showToast } = useToast();

  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [severityFilter, setSeverityFilter] = useState<string>('');

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailModal = useDisclosure();

  const [assigneeId, setAssigneeId] = useState('');
  const [escalationNote, setEscalationNote] = useState('');
  const [statusToSet, setStatusToSet] = useState<Status>('triaged');
  const [statusNotes, setStatusNotes] = useState('');
  const [newNote, setNewNote] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (statusFilter) p.set('status', statusFilter);
    if (severityFilter) p.set('severity', severityFilter);
    return p.toString();
  }, [statusFilter, severityFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const url = `/v2/admin/caring-community/safeguarding/reports${params ? `?${params}` : ''}`;
      const res = await api.get<{ items: Report[] }>(url);
      if (res.success && res.data) {
        setReports(res.data.items ?? []);
      } else {
        setReports([]);
      }
    } catch {
      showToast(t('admin.safeguarding_reports.errors.load'), 'error');
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [params, showToast, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = useCallback(
    async (id: number) => {
      setSelectedId(id);
      setDetail(null);
      setDetailLoading(true);
      detailModal.onOpen();
      try {
        const res = await api.get<ReportDetail>(
          `/v2/admin/caring-community/safeguarding/reports/${id}`,
        );
        if (res.success && res.data) {
          setDetail(res.data);
        }
      } catch {
        showToast(t('admin.safeguarding_reports.errors.load_detail'), 'error');
      } finally {
        setDetailLoading(false);
      }
    },
    [detailModal, showToast, t],
  );

  const handleAssign = async () => {
    if (selectedId === null) return;
    const id = Number(assigneeId.trim());
    if (!id) return;
    try {
      const res = await api.post(`/v2/admin/caring-community/safeguarding/reports/${selectedId}/assign`, {
        assignee_user_id: id,
      });
      if (res.success) {
        showToast(t('admin.safeguarding_reports.messages.assigned'), 'success');
        setAssigneeId('');
        await openDetail(selectedId);
        await load();
      } else {
        showToast(t('admin.safeguarding_reports.errors.assign'), 'error');
      }
    } catch {
      showToast(t('admin.safeguarding_reports.errors.assign'), 'error');
    }
  };

  const handleEscalate = async () => {
    if (selectedId === null) return;
    try {
      const res = await api.post(`/v2/admin/caring-community/safeguarding/reports/${selectedId}/escalate`, {
        note: escalationNote.trim() || undefined,
      });
      if (res.success) {
        showToast(t('admin.safeguarding_reports.messages.escalated'), 'success');
        setEscalationNote('');
        await openDetail(selectedId);
        await load();
      } else {
        showToast(t('admin.safeguarding_reports.errors.escalate'), 'error');
      }
    } catch {
      showToast(t('admin.safeguarding_reports.errors.escalate'), 'error');
    }
  };

  const handleStatus = async () => {
    if (selectedId === null) return;
    try {
      const res = await api.post(`/v2/admin/caring-community/safeguarding/reports/${selectedId}/status`, {
        status: statusToSet,
        notes: statusNotes.trim() || undefined,
      });
      if (res.success) {
        showToast(t('admin.safeguarding_reports.messages.status_updated'), 'success');
        setStatusNotes('');
        await openDetail(selectedId);
        await load();
      } else {
        showToast(t('admin.safeguarding_reports.errors.status'), 'error');
      }
    } catch {
      showToast(t('admin.safeguarding_reports.errors.status'), 'error');
    }
  };

  const handleNote = async () => {
    if (selectedId === null) return;
    const note = newNote.trim();
    if (!note) return;
    try {
      const res = await api.post(`/v2/admin/caring-community/safeguarding/reports/${selectedId}/note`, {
        note,
      });
      if (res.success) {
        showToast(t('admin.safeguarding_reports.messages.note_added'), 'success');
        setNewNote('');
        await openDetail(selectedId);
      } else {
        showToast(t('admin.safeguarding_reports.errors.note'), 'error');
      }
    } catch {
      showToast(t('admin.safeguarding_reports.errors.note'), 'error');
    }
  };

  const statusLabel = useCallback(
    (status: Status) => t(`admin.safeguarding_reports.status.${status}`),
    [t],
  );
  const severityLabel = useCallback(
    (severity: Severity) => t(`admin.safeguarding_reports.severity.${severity}`),
    [t],
  );
  const actorLabel = useCallback(
    (id: number) => t('admin.safeguarding_reports.actor_id', { id }),
    [t],
  );
  const subjectLabel = useCallback(
    (report: Pick<Report, 'subject_user_name' | 'subject_organisation_id'>) =>
      report.subject_user_name ??
      (report.subject_organisation_id
        ? t('admin.safeguarding_reports.subject_org', { id: report.subject_organisation_id })
        : t('admin.safeguarding_reports.empty_dash')),
    [t],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin.safeguarding_reports.title')}
        description={t('admin.safeguarding_reports.subtitle')}
        icon={<TriangleAlert size={20} />}
      />

      {/* About card */}
      <Card className="border border-danger/30 bg-danger-soft shadow-sm shadow-danger/10 dark:bg-danger-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-danger-soft-foreground">{t('admin.safeguarding_reports.about.title')}</p>
              <p className="text-muted">{t('admin.safeguarding_reports.about.body')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Severity legend */}
      <Card  className="border border-divider/70 shadow-sm shadow-black/[0.03]">
        <CardHeader>
          <p className="text-sm font-semibold">{t('admin.safeguarding_reports.severity_legend.title')}</p>
        </CardHeader>
        <Separator />
        <CardBody className="py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 text-sm">
            <div className="flex items-start gap-2">
              <Chip size="sm" color="danger" variant="soft" className="shrink-0 mt-0.5">{severityLabel('critical')}</Chip>
              <p className="text-muted">{t('admin.safeguarding_reports.severity_legend.critical')}</p>
            </div>
            <div className="flex items-start gap-2">
              <Chip size="sm" color="warning" variant="soft" className="shrink-0 mt-0.5">{severityLabel('high')}</Chip>
              <p className="text-muted">{t('admin.safeguarding_reports.severity_legend.high')}</p>
            </div>
            <div className="flex items-start gap-2">
              <Chip size="sm" color="default" variant="soft" className="shrink-0 mt-0.5">{severityLabel('medium')}</Chip>
              <p className="text-muted">{t('admin.safeguarding_reports.severity_legend.medium')}</p>
            </div>
            <div className="flex items-start gap-2">
              <Chip size="sm" color="success" variant="soft" className="shrink-0 mt-0.5">{severityLabel('low')}</Chip>
              <p className="text-muted">{t('admin.safeguarding_reports.severity_legend.low')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Status workflow guide */}
      <Card  className="border border-divider/70 shadow-sm shadow-black/[0.03]">
        <CardHeader>
          <p className="text-sm font-semibold">{t('admin.safeguarding_reports.workflow.title')}</p>
        </CardHeader>
        <Separator />
        <CardBody className="py-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5 text-sm">
            <div>
              <Chip size="sm" color="accent" variant="soft" className="mb-1">{statusLabel('submitted')}</Chip>
              <p className="text-xs text-muted">{t('admin.safeguarding_reports.workflow.submitted')}</p>
            </div>
            <div>
              <Chip size="sm" color="accent" variant="soft" className="mb-1">{statusLabel('triaged')}</Chip>
              <p className="text-xs text-muted">{t('admin.safeguarding_reports.workflow.triaged')}</p>
            </div>
            <div>
              <Chip size="sm" color="warning" variant="soft" className="mb-1">{statusLabel('investigating')}</Chip>
              <p className="text-xs text-muted">{t('admin.safeguarding_reports.workflow.investigating')}</p>
            </div>
            <div>
              <Chip size="sm" color="success" variant="soft" className="mb-1">{statusLabel('resolved')}</Chip>
              <p className="text-xs text-muted">{t('admin.safeguarding_reports.workflow.resolved')}</p>
            </div>
            <div>
              <Chip size="sm" color="default" variant="soft" className="mb-1">{statusLabel('dismissed')}</Chip>
              <p className="text-xs text-muted">{t('admin.safeguarding_reports.workflow.dismissed')}</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card  className="border border-divider/70 shadow-sm shadow-black/[0.03]">
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={t('admin.safeguarding_reports.filters.status')}
              size="sm"
              variant="secondary"
              className="w-44"
              selectedKeys={statusFilter ? [statusFilter] : []}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {[
                <SelectItem key="" id="">{t('admin.common.all')}</SelectItem>,
                ...ALL_STATUSES.map((s) => <SelectItem key={s} id={s}>{statusLabel(s)}</SelectItem>),
              ]}
            </Select>
            <Select
              label={t('admin.safeguarding_reports.filters.severity')}
              size="sm"
              variant="secondary"
              className="w-44"
              selectedKeys={severityFilter ? [severityFilter] : []}
              onChange={(e) => setSeverityFilter(e.target.value)}
            >
              {[
                <SelectItem key="" id="">{t('admin.common.all')}</SelectItem>,
                ...ALL_SEVERITIES.map((s) => <SelectItem key={s} id={s}>{severityLabel(s)}</SelectItem>),
              ]}
            </Select>
          </div>
          <Button
            size="sm"
            variant="tertiary"
            startContent={<RefreshCw size={14} />}
            onPress={() => void load()}
            isLoading={loading}
          >
            {t('admin.common.refresh')}
          </Button>
        </CardHeader>
        <Separator />
        <CardBody>
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('admin.safeguarding_reports.loading')} className="flex justify-center py-12">
              <Spinner label={t('admin.safeguarding_reports.loading')} />
            </div>
          ) : reports.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              {t('admin.safeguarding_reports.empty')}
            </p>
          ) : (
            <Table aria-label={t('admin.safeguarding_reports.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('admin.safeguarding_reports.table.severity')}</TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.category')}</TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.reporter')}</TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.subject')}</TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.status')}</TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.assigned')}</TableColumn>
                <TableColumn>
                  <Abbr term="SLA">
                    {t('admin.safeguarding_reports.table.sla_abbr')}
                  </Abbr>
                </TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.created')}</TableColumn>
                <TableColumn>{t('admin.safeguarding_reports.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Chip size="sm" color={SEVERITY_COLOR[r.severity]} variant="soft">
                        {severityLabel(r.severity)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      {tAdmin(`caring_workflow.safeguarding.categories.${r.category}`, {
                        defaultValue: tAdmin('caring_workflow.safeguarding.categories.unknown'),
                      })}
                    </TableCell>
                    <TableCell>{r.reporter_name || actorLabel(r.reporter_id)}</TableCell>
                    <TableCell>{subjectLabel(r)}</TableCell>
                    <TableCell>
                      <Chip size="sm" color={STATUS_COLOR[r.status]} variant="soft">
                        {statusLabel(r.status)}
                      </Chip>
                    </TableCell>
                    <TableCell>{r.assigned_to_name ?? t('admin.safeguarding_reports.empty_dash')}</TableCell>
                    <TableCell>
                      {r.is_overdue ? (
                        <Chip size="sm" color="danger" variant="soft" startContent={<TriangleAlert size={12} />}>
                          {t('admin.safeguarding_reports.overdue')}
                        </Chip>
                      ) : r.review_due_at ? (
                        new Date(r.review_due_at).toLocaleString(getFormattingLocale())
                      ) : (
                        t('admin.safeguarding_reports.empty_dash')
                      )}
                    </TableCell>
                    <TableCell>{new Date(r.created_at).toLocaleDateString(getFormattingLocale())}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="tertiary" onPress={() => void openDetail(r.id)}>
                        {t('admin.safeguarding_reports.open')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal isOpen={detailModal.isOpen} onClose={detailModal.onClose} size="3xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {t('admin.safeguarding_reports.report_title', { id: selectedId })}
          </ModalHeader>
          <ModalBody>
            {detailLoading || !detail ? (
              <div role="status" aria-busy="true" aria-label={t('admin.safeguarding_reports.loading_detail')} className="flex justify-center py-12">
                <Spinner label={t('admin.safeguarding_reports.loading_detail')} />
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip size="sm" color={SEVERITY_COLOR[detail.severity]} variant="soft">
                    {severityLabel(detail.severity)}
                  </Chip>
                  <Chip size="sm" color={STATUS_COLOR[detail.status]} variant="soft">
                    {statusLabel(detail.status)}
                  </Chip>
                  {detail.escalated && (
                    <Chip size="sm" color="danger" variant="soft">
                      {t('admin.safeguarding_reports.escalated')}
                    </Chip>
                  )}
                  {detail.is_overdue && (
                    <Chip size="sm" color="danger" variant="soft">
                      {t('admin.safeguarding_reports.overdue')}
                    </Chip>
                  )}
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('admin.safeguarding_reports.fields.category')}</p>
                  <p className="text-sm">
                    {tAdmin(`caring_workflow.safeguarding.categories.${detail.category}`, {
                      defaultValue: tAdmin('caring_workflow.safeguarding.categories.unknown'),
                    })}
                  </p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('admin.safeguarding_reports.fields.reporter')}</p>
                  <p className="text-sm">{detail.reporter_name || actorLabel(detail.reporter_id)}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('admin.safeguarding_reports.fields.subject')}</p>
                  <p className="text-sm">{subjectLabel(detail)}</p>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-muted">{t('admin.safeguarding_reports.fields.description')}</p>
                  <p className="whitespace-pre-wrap text-sm">{detail.description}</p>
                </div>

                {detail.evidence_url && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted">{t('admin.safeguarding_reports.fields.evidence')}</p>
                    <a
                      href={safeHref(detail.evidence_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-accent underline"
                    >
                      {detail.evidence_url}
                    </a>
                  </div>
                )}

                {detail.resolution_notes && (
                  <div>
                    <p className="text-xs uppercase tracking-wide text-muted">{t('admin.safeguarding_reports.fields.resolution_notes')}</p>
                    <p className="text-sm whitespace-pre-wrap">{detail.resolution_notes}</p>
                  </div>
                )}

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">{t('admin.safeguarding_reports.actions.title')}</h3>

                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      label={t('admin.safeguarding_reports.actions.assignee_user_id')}
                      size="sm"
                      variant="secondary"
                      value={assigneeId}
                      onValueChange={setAssigneeId}
                      className="w-48"
                    />
            <Button size="sm" variant="secondary" onPress={() => void handleAssign()}>
                      {t('admin.safeguarding_reports.actions.assign')}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <Input
                      label={t('admin.safeguarding_reports.actions.escalation_note')}
                      size="sm"
                      variant="secondary"
                      value={escalationNote}
                      onValueChange={setEscalationNote}
                      className="flex-1"
                    />
            <Button size="sm" variant="secondary" onPress={() => void handleEscalate()}>
                      {t('admin.safeguarding_reports.actions.escalate')}
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-end gap-2">
                    <Select
                      label={t('admin.safeguarding_reports.actions.set_status')}
                      size="sm"
                      variant="secondary"
                      selectedKeys={[statusToSet]}
                      onChange={(e) => setStatusToSet((e.target.value as Status) || 'triaged')}
                      className="w-44"
                    >
                      {ALL_STATUSES.map((s) => (
                        <SelectItem key={s} id={s}>{statusLabel(s)}</SelectItem>
                      ))}
                    </Select>
                    <Input
                      label={t('admin.safeguarding_reports.actions.notes')}
                      size="sm"
                      variant="secondary"
                      value={statusNotes}
                      onValueChange={setStatusNotes}
                      className="flex-1"
                    />
            <Button size="sm" onPress={() => void handleStatus()}>
                      {t('admin.safeguarding_reports.actions.update')}
                    </Button>
                  </div>
                  {(statusToSet === 'resolved' || statusToSet === 'dismissed') && (
                    <p className="text-xs text-muted mt-1">
                      {statusToSet === 'resolved'
                        ? t('admin.safeguarding_reports.actions.resolved_hint')
                        : t('admin.safeguarding_reports.actions.dismissed_hint')}
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <Textarea
                      label={t('admin.safeguarding_reports.actions.add_note')}
                      size="sm"
                      variant="secondary"
                      value={newNote}
                      onValueChange={setNewNote}
                      minRows={2}
                    />
                    <div className="flex justify-end">
                      <Button size="sm" variant="tertiary" onPress={() => void handleNote()}>
                        {t('admin.safeguarding_reports.actions.add_note')}
                      </Button>
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">{t('admin.safeguarding_reports.history.title')}</h3>
                  {detail.actions.length === 0 ? (
                    <p className="text-sm text-muted">{t('admin.safeguarding_reports.history.empty')}</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.actions.map((a) => (
                        <li key={a.id} className="rounded-2xl border border-divider/70 bg-surface-secondary/40 p-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium">
                              {tAdmin(`caring_workflow.safeguarding.history_actions.${a.action}`, {
                                defaultValue: tAdmin('caring_workflow.safeguarding.history_actions.unknown'),
                              })}
                            </p>
                            <p className="text-xs text-muted">
                              {new Date(a.created_at).toLocaleString(getFormattingLocale())}
                            </p>
                          </div>
                          <p className="mt-1 text-xs text-muted">
                            {t('admin.safeguarding_reports.history.by_actor', {
                              name: a.actor_name || actorLabel(a.actor_id),
                            })}
                          </p>
                          {a.notes && <p className="mt-1 text-sm whitespace-pre-wrap">{a.notes}</p>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={detailModal.onClose}>
              {t('admin.common.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
