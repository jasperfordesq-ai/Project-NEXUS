// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { formatDateTime, getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import Bug from 'lucide-react/icons/bug';
import Copy from 'lucide-react/icons/copy';
import ExternalLink from 'lucide-react/icons/external-link';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';

import PageHeader from '@/admin/components/PageHeader';
import { useAdminPageMeta } from '@/admin/AdminMetaContext';
import { adminSupportReports } from '@/admin/api/adminApi';
import type {
  AdminSupportReport,
  AdminSupportReportImpact,
  AdminSupportReportStats,
  AdminSupportReportStatus,
  AdminSupportReportUser,
  AdminSupportRequestType,
} from '@/admin/api/types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  Chip,
  Input,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pagination,
  Select,
  SelectItem,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
  Textarea,
} from '@/components/ui';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { openSafeUrl } from '@/lib/safeHref';

type StatusFilter = 'all' | AdminSupportReportStatus;
type ImpactFilter = 'all' | AdminSupportReportImpact;

const STATUS_FILTERS: StatusFilter[] = ['all', 'open', 'triaged', 'resolved', 'closed'];
const IMPACT_FILTERS: ImpactFilter[] = ['all', 'blocked', 'major', 'minor', 'cosmetic'];
const PAGE_SIZE = 20;

interface DraftState {
  status: AdminSupportReportStatus;
  assignedUserId: string;
  triageNotes: string;
  sentryIssueUrl: string;
}

export function buildSupportReportHandoff(report: AdminSupportReport, t: TFunction<'admin_support'>): string {
  const reporter = report.reporter
    ? report.reporter.email
      ? t('support_reports.handoff.reporter_with_email', {
          name: report.reporter.name,
          email: report.reporter.email,
          id: report.reporter.id,
        })
      : t('support_reports.handoff.reporter_without_email', {
          name: report.reporter.name,
          id: report.reporter.id,
        })
    : t('support_reports.handoff.unknown_reporter');
  const diagnostics = report.diagnostics
    ? JSON.stringify(report.diagnostics, null, 2)
    : t('support_reports.handoff.no_diagnostics');
  const field = (label: string, value: string | number) => t('support_reports.handoff.field', { label, value });
  const notProvided = t('support_reports.handoff.not_provided');
  const impact = t(`support_reports.impact.${report.impact}`, {
    defaultValue: t('common.unknown'),
  });
  const status = t(`support_reports.status.${report.status}`, {
    defaultValue: t('common.unknown'),
  });

  return [
    t('support_reports.handoff.title', { reference: report.reference }),
    '',
    field(t('support_reports.handoff.labels.tenant'), report.tenant_name ?? report.tenant_id),
    field(t('support_reports.handoff.labels.request_type'), t(`support_reports.request_type.${requestTypeOf(report)}`)),
    field(t('support_reports.handoff.labels.impact'), impact),
    field(t('support_reports.handoff.labels.status'), status),
    field(t('support_reports.handoff.labels.created'), formatDateTime(report.created_at)),
    field(t('support_reports.handoff.labels.reporter'), reporter),
    field(t('support_reports.handoff.labels.route'), report.route ?? notProvided),
    field(t('support_reports.handoff.labels.page_url'), report.page_url ?? notProvided),
    field(t('support_reports.handoff.labels.user_agent'), report.user_agent ?? notProvided),
    field(t('support_reports.handoff.labels.sentry_event'), report.sentry_event_id ?? notProvided),
    field(t('support_reports.handoff.labels.sentry_issue'), report.sentry_issue_url ?? notProvided),
    field(t('support_reports.handoff.labels.jira'), report.jira_issue_key ?? notProvided),
    '',
    t('support_reports.handoff.headings.summary'),
    report.summary,
    '',
    t('support_reports.handoff.headings.user_description'),
    report.description,
    '',
    t('support_reports.handoff.headings.triage_notes'),
    report.triage_notes ?? t('support_reports.handoff.none_yet'),
    '',
    t('support_reports.handoff.headings.diagnostics'),
    diagnostics,
  ].join('\n');
}

export default function SupportReportsPage() {
  const { t } = useTranslation('admin_support');
  const toast = useToast();
  const { search: locationSearch } = useLocation();

  usePageTitle(t('support_reports.meta_title'));
  useAdminPageMeta({
    title: t('support_reports.title'),
    description: t('support_reports.subtitle'),
  });

  const [reports, setReports] = useState<AdminSupportReport[]>([]);
  const [stats, setStats] = useState<AdminSupportReportStats | null>(null);
  const [assignees, setAssignees] = useState<AdminSupportReportUser[]>([]);
  const [selectedReport, setSelectedReport] = useState<AdminSupportReport | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('all');
  const [search, setSearch] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const openedFromQueryRef = useRef<string | null>(null);

  const loadStats = useCallback(async () => {
    const response = await adminSupportReports.stats();
    if (response.success && response.data) {
      setStats(response.data);
    }
  }, []);

  const loadAssignees = useCallback(async () => {
    const response = await adminSupportReports.assignees();
    if (response.success && response.data?.assignees) {
      setAssignees(response.data.assignees);
    }
  }, []);

  const loadReports = useCallback(async () => {
    setIsLoading(true);
    const response = await adminSupportReports.list({
      page,
      limit: PAGE_SIZE,
      status: statusFilter === 'all' ? undefined : statusFilter,
      impact: impactFilter === 'all' ? undefined : impactFilter,
      search: activeSearch || undefined,
    });
    setIsLoading(false);

    if (!response.success || !response.data) {
      toast.error(t('support_reports.errors.load'));
      return;
    }

    setReports(response.data);
    setTotalPages(response.meta?.total_pages || 1);
  }, [activeSearch, impactFilter, page, statusFilter, t, toast]);

  useEffect(() => {
    loadStats();
    loadAssignees();
  }, [loadAssignees, loadStats]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const openReport = useCallback(async (id: number) => {
    setIsDetailLoading(true);
    const response = await adminSupportReports.get(id);
    setIsDetailLoading(false);

    if (!response.success || !response.data) {
      toast.error(t('support_reports.errors.load_detail'));
      return;
    }

    setSelectedReport(response.data);
    setDraft({
      status: response.data.status,
      assignedUserId: response.data.assigned_user_id ? String(response.data.assigned_user_id) : 'none',
      triageNotes: response.data.triage_notes ?? '',
      sentryIssueUrl: response.data.sentry_issue_url ?? '',
    });
  }, [t, toast]);

  useEffect(() => {
    const reportId = new URLSearchParams(locationSearch).get('report');
    if (!reportId || openedFromQueryRef.current === reportId) {
      return;
    }

    const numericReportId = Number(reportId);
    if (!Number.isFinite(numericReportId) || numericReportId <= 0) {
      return;
    }

    openedFromQueryRef.current = reportId;
    openReport(numericReportId);
  }, [locationSearch, openReport]);

  const refreshAll = async () => {
    await Promise.all([loadReports(), loadStats()]);
  };

  const applySearch = () => {
    setActiveSearch(search.trim());
    setPage(1);
  };

  const clearFilters = () => {
    setSearch('');
    setActiveSearch('');
    setStatusFilter('open');
    setImpactFilter('all');
    setPage(1);
  };

  const saveReport = async () => {
    if (!selectedReport || !draft) {
      return;
    }

    setIsSaving(true);
    const response = await adminSupportReports.update(selectedReport.id, {
      status: draft.status,
      assigned_user_id: draft.assignedUserId === 'none' ? null : Number(draft.assignedUserId),
      triage_notes: draft.triageNotes.trim() || null,
      sentry_issue_url: draft.sentryIssueUrl.trim() || null,
    });
    setIsSaving(false);

    if (!response.success || !response.data) {
      toast.error(t('support_reports.errors.save'));
      return;
    }

    setSelectedReport(response.data);
    toast.success(t('support_reports.messages.saved'));
    await refreshAll();
  };

  const copyDiagnostics = async () => {
    if (!selectedReport?.diagnostics) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(selectedReport.diagnostics, null, 2));
      toast.success(t('support_reports.messages.copied'));
    } catch {
      toast.error(t('support_reports.errors.copy'));
    }
  };

  const copyEngineeringHandoff = async () => {
    if (!selectedReport) {
      return;
    }

    try {
      await navigator.clipboard.writeText(buildSupportReportHandoff(selectedReport, t));
      toast.success(t('support_reports.messages.handoff_copied'));
    } catch {
      toast.error(t('support_reports.errors.copy_handoff'));
    }
  };

  const statsCards = useMemo(() => [
    { key: 'open', value: stats?.open ?? 0, label: t('support_reports.stats.open') },
    { key: 'triaged', value: stats?.triaged ?? 0, label: t('support_reports.stats.triaged') },
    { key: 'blocked', value: stats?.blocked ?? 0, label: t('support_reports.stats.blocked') },
    { key: 'unassigned', value: stats?.unassigned ?? 0, label: t('support_reports.stats.unassigned') },
  ], [stats, t]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('support_reports.title')}
        description={t('support_reports.subtitle')}
        icon={<Bug className="h-5 w-5" aria-hidden="true" />}
        actions={(
          <Button
            variant="secondary"
            startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onPress={refreshAll}
          >
            {t('support_reports.actions.refresh')}
          </Button>
        )}
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statsCards.map((item) => (
          <Card key={item.key}>
            <CardBody>
              <p className="text-sm text-muted">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{item.value}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto_auto]">
        <Input
          label={t('support_reports.filters.search')}
          value={search}
          onValueChange={setSearch}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              applySearch();
            }
          }}
        />
        <Select
          label={t('support_reports.filters.status')}
          value={statusFilter}
          onValueChange={(value) => {
            setStatusFilter((value || 'all') as StatusFilter);
            setPage(1);
          }}
        >
          {STATUS_FILTERS.map((status) => (
            <SelectItem key={status} id={status}>
              {t(`support_reports.status.${status}`)}
            </SelectItem>
          ))}
        </Select>
        <Select
          label={t('support_reports.filters.impact')}
          value={impactFilter}
          onValueChange={(value) => {
            setImpactFilter((value || 'all') as ImpactFilter);
            setPage(1);
          }}
        >
          {IMPACT_FILTERS.map((impact) => (
            <SelectItem key={impact} id={impact}>
              {t(`support_reports.impact.${impact}`)}
            </SelectItem>
          ))}
        </Select>
        <Button className="self-end" onPress={applySearch}>
          {t('support_reports.actions.search')}
        </Button>
        <Button className="self-end" variant="tertiary" onPress={clearFilters}>
          {t('support_reports.actions.clear')}
        </Button>
      </div>

      <Card>
        <CardBody>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Spinner label={t('support_reports.loading')} />
            </div>
          ) : (
            <Table aria-label={t('support_reports.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('support_reports.table.reference')}</TableColumn>
                <TableColumn>{t('support_reports.table.summary')}</TableColumn>
                <TableColumn>{t('support_reports.table.impact')}</TableColumn>
                <TableColumn>{t('support_reports.table.status')}</TableColumn>
                <TableColumn>{t('support_reports.table.reporter')}</TableColumn>
                <TableColumn>{t('support_reports.table.assignee')}</TableColumn>
                <TableColumn>{t('support_reports.table.created')}</TableColumn>
                <TableColumn>{t('support_reports.table.actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('support_reports.empty')}>
                {reports.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>
                      <span className="font-mono text-xs font-semibold">{report.reference}</span>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-sm">
                        <p className="truncate text-sm font-medium text-foreground">{report.summary}</p>
                        <p className="truncate text-xs text-muted">
                          {t(`support_reports.request_type.${requestTypeOf(report)}`)}
                          {' · '}
                          {report.route || t('support_reports.empty_value')}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" variant="soft" color={impactColor(report.impact)}>
                        {t(`support_reports.impact.${report.impact}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Chip size="sm" variant="soft" color={statusColor(report.status)}>
                          {t(`support_reports.status.${report.status}`)}
                        </Chip>
                        {report.jira_issue_key ? (
                          <Chip size="sm" variant="soft">{report.jira_issue_key}</Chip>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>{report.reporter?.name ?? t('support_reports.empty_value')}</TableCell>
                    <TableCell>{report.assignee?.name ?? t('support_reports.unassigned')}</TableCell>
                    <TableCell>{formatDate(report.created_at)}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="secondary" onPress={() => openReport(report.id)}>
                        {t('support_reports.actions.review')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {totalPages > 1 ? (
            <div className="mt-4 flex justify-end">
              <Pagination page={page} total={totalPages} onChange={setPage} />
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Modal isOpen={Boolean(selectedReport)} onClose={() => setSelectedReport(null)} size="4xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader>
            {selectedReport ? t('support_reports.detail.title', { reference: selectedReport.reference }) : t('support_reports.detail.loading')}
          </ModalHeader>
          <ModalBody>
            {isDetailLoading || !selectedReport || !draft ? (
              <div className="flex justify-center py-12">
                <Spinner label={t('support_reports.detail.loading')} />
              </div>
            ) : (
              <div className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                  <section className="space-y-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted">{t('support_reports.detail.summary')}</p>
                      <p className="mt-1 text-base font-semibold text-foreground">{selectedReport.summary}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase text-muted">{t('support_reports.detail.description')}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-foreground">{selectedReport.description}</p>
                    </div>
                  </section>

                  <section className="space-y-2 text-sm">
                    <DetailRow label={t('support_reports.detail.request_type')} value={t(`support_reports.request_type.${requestTypeOf(selectedReport)}`)} />
                    <DetailRow label={t('support_reports.detail.reporter')} value={selectedReport.reporter?.name ?? t('support_reports.empty_value')} />
                    <DetailRow label={t('support_reports.detail.page')} value={selectedReport.route ?? t('support_reports.empty_value')} />
                    <DetailRow label={t('support_reports.detail.created')} value={formatDate(selectedReport.created_at)} />
                    <DetailRow label={t('support_reports.detail.user_agent')} value={selectedReport.user_agent ?? t('support_reports.empty_value')} />
                    <DetailRow label={t('support_reports.detail.sentry_event')} value={selectedReport.sentry_event_id ?? t('support_reports.empty_value')} />
                  </section>
                </div>

                {selectedReport.jira_issue_key ? (
                  <section className="space-y-2 rounded-md border border-divider p-3" data-testid="support-report-jira">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip size="sm" variant="soft" color="primary">{t('support_reports.jira.handled')}</Chip>
                      <span className="font-mono text-sm font-semibold">{selectedReport.jira_issue_key}</span>
                      <span className="text-sm text-muted">
                        {t('support_reports.jira.status', {
                          status: selectedReport.jira_status ?? t('support_reports.jira.status_unknown'),
                        })}
                      </span>
                      {selectedReport.jira_issue_url ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          startContent={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
                          onPress={() => openSafeUrl(selectedReport.jira_issue_url)}
                        >
                          {t('support_reports.jira.open')}
                        </Button>
                      ) : null}
                    </div>
                    <p className="text-sm text-muted">{t('support_reports.jira.status_hint')}</p>
                  </section>
                ) : null}

                {selectedReport.jira_last_error ? (
                  <Alert
                    color="warning"
                    title={t('support_reports.jira.error_title')}
                    description={selectedReport.jira_last_error}
                  />
                ) : null}

                <div className="grid gap-4 lg:grid-cols-3">
                  <Select
                    label={t('support_reports.fields.status')}
                    value={draft.status}
                    onValueChange={(value) => setDraft({ ...draft, status: value as AdminSupportReportStatus })}
                  >
                    {editableStatuses(selectedReport).map((status) => (
                      <SelectItem key={status} id={status}>
                        {t(`support_reports.status.${status}`)}
                      </SelectItem>
                    ))}
                  </Select>
                  <Select
                    label={t('support_reports.fields.assignee')}
                    value={draft.assignedUserId}
                    onValueChange={(value) => setDraft({ ...draft, assignedUserId: value || 'none' })}
                  >
                    <SelectItem key="none" id="none">{t('support_reports.unassigned')}</SelectItem>
                    {assignees.map((user) => (
                      <SelectItem key={user.id} id={String(user.id)}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </Select>
                  <Input
                    label={t('support_reports.fields.sentry_issue_url')}
                    value={draft.sentryIssueUrl}
                    onValueChange={(value) => setDraft({ ...draft, sentryIssueUrl: value })}
                  />
                </div>

                <Textarea
                  label={t('support_reports.fields.triage_notes')}
                  minRows={4}
                  value={draft.triageNotes}
                  onValueChange={(value) => setDraft({ ...draft, triageNotes: value })}
                />

                <div className="flex flex-wrap gap-2">
                  {selectedReport.page_url ? (
                    <Button
                      variant="secondary"
                      startContent={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
                      onPress={() => openSafeUrl(selectedReport.page_url)}
                    >
                      {t('support_reports.actions.open_page')}
                    </Button>
                  ) : null}
                  {selectedReport.sentry_issue_url ? (
                    <Button
                      variant="secondary"
                      startContent={<ExternalLink className="h-4 w-4" aria-hidden="true" />}
                      // F-358: route this through the shared scheme guard, as the
                      // page address beside it already is. The server now refuses
                      // a non-http(s) sentry_issue_url, but rows stored before
                      // that fix are still in the database.
                      onPress={() => openSafeUrl(selectedReport.sentry_issue_url)}
                    >
                      {t('support_reports.actions.open_sentry')}
                    </Button>
                  ) : null}
                  {selectedReport.diagnostics ? (
                    <Button
                      variant="tertiary"
                      startContent={<Copy className="h-4 w-4" aria-hidden="true" />}
                      onPress={copyDiagnostics}
                    >
                      {t('support_reports.actions.copy_diagnostics')}
                    </Button>
                  ) : null}
                  <Button
                    variant="tertiary"
                    startContent={<Copy className="h-4 w-4" aria-hidden="true" />}
                    onPress={copyEngineeringHandoff}
                  >
                    {t('support_reports.actions.copy_handoff')}
                  </Button>
                </div>

                {selectedReport.diagnostics ? (
                  <section>
                    <p className="mb-2 text-xs font-semibold uppercase text-muted">{t('support_reports.detail.diagnostics')}</p>
                    <pre className="max-h-80 overflow-auto rounded-md border border-divider bg-surface-secondary p-3 text-xs leading-5 text-foreground">
                      {JSON.stringify(selectedReport.diagnostics, null, 2)}
                    </pre>
                  </section>
                ) : null}
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setSelectedReport(null)}>
              {t('support_reports.actions.close')}
            </Button>
            <Button
              startContent={<Save className="h-4 w-4" aria-hidden="true" />}
              isLoading={isSaving}
              onPress={saveReport}
            >
              {t('support_reports.actions.save')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-muted">{label}</p>
      <p className="mt-0.5 break-words text-foreground">{value}</p>
    </div>
  );
}

function requestTypeOf(report: AdminSupportReport): AdminSupportRequestType {
  return report.request_type ?? 'broken';
}

/**
 * A report copied to Jira is answered there and its status mirrored back
 * every 15 minutes, so here it can only keep its status or be closed (the
 * server enforces the same rule: SUPPORT_REPORT_HANDLED_IN_JIRA).
 */
function editableStatuses(report: AdminSupportReport): AdminSupportReportStatus[] {
  const all: AdminSupportReportStatus[] = ['open', 'triaged', 'resolved', 'closed'];
  if (!report.jira_issue_key) {
    return all;
  }

  return all.filter((status) => status === report.status || status === 'closed');
}

function impactColor(impact: AdminSupportReportImpact) {
  if (impact === 'blocked') return 'danger';
  if (impact === 'major') return 'warning';
  if (impact === 'cosmetic') return 'default';
  return 'primary';
}

function statusColor(status: AdminSupportReportStatus) {
  if (status === 'open') return 'warning';
  if (status === 'triaged') return 'primary';
  if (status === 'resolved') return 'success';
  return 'default';
}

function formatDate(value?: string | null) {
  if (!value) {
    return '';
  }

  return new Date(value).toLocaleString(getFormattingLocale());
}
