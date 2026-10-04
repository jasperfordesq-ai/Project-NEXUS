import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Spinner, Progress, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip } from '@/components/ui';
import {
  useCallback,
  useEffect,
  useState } from 'react';
import { Link } from 'react-router-dom';

import { Separator } from '@/components/ui';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ShieldAlert from 'lucide-react/icons/shield-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Rocket from 'lucide-react/icons/rocket';
import ClipboardCheck from 'lucide-react/icons/clipboard-check';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type SectionStatus = 'ready' | 'needs_review' | 'not_started' | 'blocked';

interface ReadinessSection {
  key: string;
  label_code: string;
  status: SectionStatus;
  summary_code: string;
  summary_params: Record<string, string | number>;
  admin_path: string;
  last_updated_at: string | null;
  missing: string[];
  extra?: Record<string, unknown>;
}

interface ReadinessLaunchedState {
  launched_at: string;
  launched_by_id: number;
}

interface ReadinessBlocker {
  key: string;
  status: string;
}

interface ReadinessReport {
  generated_at: string;
  overall: {
    status: SectionStatus;
    ready_section_count: number;
    total_section_count: number;
    summary_code: string;
    summary_params: Record<string, string | number>;
  };
  sections: ReadinessSection[];
  isolated_node_required: boolean;
  can_launch: boolean;
  blockers: ReadinessBlocker[];
  launched: ReadinessLaunchedState | null;
}

const STATUS_COLORS: Record<SectionStatus, 'success' | 'warning' | 'default' | 'danger'> = {
  ready: 'success',
  needs_review: 'warning',
  not_started: 'default',
  blocked: 'danger',
};

const MISSING_LABEL_KEYS: Record<string, string> = {
  'controller.name': 'controller_name',
  'controller.contact_email': 'controller_contact_email',
  'controller.data_protection_officer': 'controller_data_protection_officer',
  'incident_response.contact_email': 'incident_response_contact_email',
  workshop_not_run: 'workshop_not_run',
  policy_appendix_url: 'policy_appendix_url',
  safeguarding_escalation_user_id: 'safeguarding_escalation_user_id',
  acknowledgement: 'acknowledgement',
  pre_pilot_baseline: 'pre_pilot_baseline',
  danger_checks: 'danger_checks',
  warning_checks: 'warning_checks',
  quarterly_review: 'quarterly_review',
  blocked_integrations: 'blocked_integrations',
  undecided_items: 'undecided_items',
  backlog_empty: 'backlog_empty',
};

type AdminT = (key: string, options?: Record<string, unknown>) => string;

function missingLabel(t: AdminT, slug: string): string {
  const key = MISSING_LABEL_KEYS[slug];
  return key ? t(`pilot_launch_readiness.missing.${key}`) : t('pilot_launch_readiness.missing.unknown');
}

function localizedParams(params: Record<string, string | number>): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      typeof value === 'number' ? value.toLocaleString(getFormattingLocale()) : value,
    ]),
  );
}

function sectionLabel(t: AdminT, code: string): string {
  return t(`pilot_launch_readiness.section_labels.${code}`);
}

function sectionSummary(
  t: AdminT,
  code: string,
  params: Record<string, string | number>,
): string {
  return t(`pilot_launch_readiness.section_summaries.${code}`, localizedParams(params));
}

function statusIcon(status: SectionStatus) {
  if (status === 'ready') return <CheckCircle2 size={20} className="text-success" />;
  if (status === 'blocked') return <ShieldAlert size={20} className="text-danger" />;
  return <AlertTriangle size={20} className="text-warning" />;
}

function isReadinessReport(value: unknown): value is ReadinessReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReadinessReport>;

  return (
    !!candidate.overall &&
    typeof candidate.overall === 'object' &&
    typeof candidate.overall.status === 'string' &&
    typeof candidate.overall.summary_code === 'string' &&
    typeof candidate.overall.summary_params === 'object' &&
    typeof candidate.overall.ready_section_count === 'number' &&
    typeof candidate.overall.total_section_count === 'number' &&
    Array.isArray(candidate.sections)
  );
}

export default function PilotLaunchReadinessAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('pilot_launch_readiness.meta.page_title'));
  const { showToast } = useToast();

  const [report, setReport] = useState<ReadinessReport | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [acknowledging, setAcknowledging] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchModalOpen, setLaunchModalOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<ReadinessReport>('/v2/admin/caring-community/launch-readiness');
      if (!res.success) {
        setReport(null);
        setLoadError(t('pilot_launch_readiness.errors.load_failed'));
        return;
      }

      if (!isReadinessReport(res.data)) {
        setReport(null);
        setLoadError(t('pilot_launch_readiness.errors.unexpected_response'));
        return;
      }

      setReport(res.data);
    } catch {
      setReport(null);
      setLoadError(t('pilot_launch_readiness.errors.load_failed'));
      showToast(t('pilot_launch_readiness.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const acknowledgeBoundary = async () => {
    setAcknowledging(true);
    try {
      const res = await api.post<{ acknowledged: boolean; report: ReadinessReport }>(
        '/v2/admin/caring-community/launch-readiness/acknowledge-boundary',
        {},
      );
      if (isReadinessReport(res.data?.report)) setReport(res.data.report);
      showToast(t('pilot_launch_readiness.toasts.boundary_acknowledged'), 'success');
    } catch {
      showToast(t('pilot_launch_readiness.toasts.boundary_acknowledge_failed'), 'error');
    } finally {
      setAcknowledging(false);
    }
  };

  const launchPilot = async () => {
    setLaunching(true);
    try {
      const res = await api.post<{
        launched_at: string;
        launched_by_id: number;
        report: ReadinessReport;
      }>('/v2/admin/caring-community/launch-readiness/launch', {});
      if (res.success) {
        if (isReadinessReport(res.data?.report)) {
          setReport(res.data.report);
        } else {
          await load();
        }
        showToast(t('pilot_launch_readiness.toasts.launch_success'), 'success');
        setLaunchModalOpen(false);
      } else {
        const code = res.code ?? '';
        const msg =
          code === 'CANNOT_LAUNCH'
            ? t('pilot_launch_readiness.toasts.cannot_launch')
            : code === 'ALREADY_LAUNCHED'
            ? t('pilot_launch_readiness.toasts.already_launched')
            : t('pilot_launch_readiness.toasts.launch_failed');
        showToast(msg, 'error');
        await load();
      }
    } catch {
      showToast(t('pilot_launch_readiness.toasts.launch_failed'), 'error');
    } finally {
      setLaunching(false);
    }
  };

  const overall = report?.overall;
  const progressValue =
    overall && overall.total_section_count > 0
      ? Math.round((overall.ready_section_count / overall.total_section_count) * 100)
      : 0;
  const isLaunched = !!report?.launched;
  const canLaunch = !!report?.can_launch && !!overall && (report?.sections?.length ?? 0) > 0;
  const blockerCount = report?.blockers?.length ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pilot_launch_readiness.meta.title')}
        subtitle={t('pilot_launch_readiness.meta.subtitle')}
        icon={<Rocket size={20} />}
        actions={
          <div className="flex items-center gap-2">
            {!isLaunched && (
              <Button
                color="success"
                size="lg"
                startContent={<Rocket size={16} />}
                onPress={() => setLaunchModalOpen(true)}
                isDisabled={!canLaunch || loading}
              >
                {t('pilot_launch_readiness.actions.launch_pilot')}
              </Button>
            )}
            <Tooltip content={t('pilot_launch_readiness.actions.refresh')}>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                onPress={load}
                isLoading={loading}
                aria-label={t('pilot_launch_readiness.actions.refresh_aria')}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
          </div>
        }
      />

      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('pilot_launch_readiness.about.title')}</p>
              <p className="text-muted">
                {t('pilot_launch_readiness.about.body')}
              </p>
              <p className="text-muted mt-1">
                {t('pilot_launch_readiness.about.review_help')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {!loading && report && (
        isLaunched ? (
          <Card className="border border-success/30 bg-success/10">
            <CardBody className="space-y-1 py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={22} className="text-success" />
                <div>
                  <p className="text-base font-semibold">{t('pilot_launch_readiness.states.launched_title')}</p>
                  <p className="text-sm text-muted">
                    {t('pilot_launch_readiness.states.launched_body', {
                      date: report.launched
                        ? new Date(report.launched.launched_at).toLocaleString(getFormattingLocale())
                        : t('pilot_launch_readiness.empty.value'),
                      user: report.launched?.launched_by_id
                        ? t('pilot_launch_readiness.states.launched_by_user', {
                            id: report.launched.launched_by_id,
                          })
                        : '',
                    })}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : canLaunch ? (
          <Card className="border border-success/30 bg-success/10">
            <CardBody className="flex flex-row items-center justify-between gap-3 py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 size={22} className="text-success" />
                <div>
                  <p className="text-base font-semibold">{t('pilot_launch_readiness.states.ready_title')}</p>
                  <p className="text-sm text-muted">
                    {t('pilot_launch_readiness.states.ready_body_prefix')} <em>{t('pilot_launch_readiness.actions.launch_pilot')}</em> {t('pilot_launch_readiness.states.ready_body_suffix')}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card className="border border-danger/30 bg-danger/10">
            <CardBody className="space-y-1 py-4">
              <div className="flex items-center gap-3">
                <ShieldAlert size={22} className="text-danger" />
                <div>
                  <p className="text-base font-semibold">
                    {t('pilot_launch_readiness.states.blocked_title', { count: blockerCount })}
                  </p>
                  <p className="text-sm text-muted">
                    {t('pilot_launch_readiness.states.blocked_body')}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>
        )
      )}

      {loading && (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      )}

      {!loading && loadError && (
        <Card className="border border-danger/30 bg-danger/10">
          <CardBody className="space-y-3 py-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={22} className="mt-0.5 shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold">{t('pilot_launch_readiness.errors.unavailable_title')}</p>
                <p className="mt-1 text-sm text-muted">{loadError}</p>
              </div>
              <Button
                size="sm"
                variant="tertiary"
                startContent={<RefreshCw size={14} />}
                onPress={load}
              >
                {t('pilot_launch_readiness.actions.retry')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {!loading && report && overall && (
        <>
          <Card
            className={
              overall.status === 'ready'
                ? 'border border-success/30 bg-success/10'
                : overall.status === 'blocked'
                ? 'border border-danger/30 bg-danger/10'
                : 'border border-warning/30 bg-warning/10'
            }
          >
            <CardBody className="space-y-4 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  {statusIcon(overall.status)}
                  <div>
                    <p className="text-lg font-semibold">
                      {overall.status === 'ready'
                        ? t('pilot_launch_readiness.overall.ready')
                        : overall.status === 'blocked'
                        ? t('pilot_launch_readiness.overall.blocked')
                        : overall.status === 'not_started'
                        ? t('pilot_launch_readiness.overall.not_started')
                        : t('pilot_launch_readiness.overall.needs_review')}
                    </p>
                    <p className="text-sm text-muted">
                      {t(
                        `pilot_launch_readiness.overall_summaries.${overall.summary_code}`,
                        localizedParams(overall.summary_params),
                      )}
                    </p>
                  </div>
                </div>
                <Chip color={STATUS_COLORS[overall.status]} variant="soft" size="lg">
                  {t('pilot_launch_readiness.progress.ready_count', {
                    ready: overall.ready_section_count,
                    total: overall.total_section_count,
                  })}
                </Chip>
              </div>
              <Progress
                aria-label={t('pilot_launch_readiness.progress.aria')}
                value={progressValue}
                color={STATUS_COLORS[overall.status]}
                className="max-w-full"
              />
              <p className="text-xs text-muted italic">
                {report.isolated_node_required
                  ? t('pilot_launch_readiness.isolated_node.required')
                  : t('pilot_launch_readiness.isolated_node.informational')}
              </p>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4">
            {report.sections.map((section) => (
              <Card key={section.key} className="border border-[var(--color-border)]">
                <CardHeader className="flex flex-wrap items-start justify-between gap-3 pb-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold">{sectionLabel(t, section.label_code)}</p>
                    <p className="text-xs text-muted mt-0.5">
                      {sectionSummary(t, section.summary_code, section.summary_params)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Chip size="sm" variant="soft" color={STATUS_COLORS[section.status]}>
                      {t(`pilot_launch_readiness.status.${section.status}`)}
                    </Chip>
                    <Button
                      as={Link}
                      to={section.admin_path}
                      size="sm"
                      variant="tertiary"
                      endContent={<ChevronRight size={14} />}
                    >
                      {t('pilot_launch_readiness.actions.open')}
                    </Button>
                  </div>
                </CardHeader>
                <CardBody className="pt-0 space-y-2">
                  {section.missing.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {section.missing.slice(0, 8).map((item) => (
                        <Chip
                          key={item}
                          size="sm"
                          variant="dot"
                          color={section.status === 'blocked' ? 'danger' : 'warning'}
                        >
                          {missingLabel(t, item)}
                        </Chip>
                      ))}
                      {section.missing.length > 8 && (
                        <Chip size="sm" variant="soft" color="default">
                          {t('pilot_launch_readiness.more_count', { count: section.missing.length - 8 })}
                        </Chip>
                      )}
                    </div>
                  )}

                  {section.key === 'commercial_boundary' && section.status === 'needs_review' && (
                    <div>
                      <Button
                        size="sm"
                        variant="tertiary"
                        startContent={<ClipboardCheck size={14} />}
                        onPress={acknowledgeBoundary}
                        isLoading={acknowledging}
                      >
                        {t('pilot_launch_readiness.actions.acknowledge_default_matrix')}
                      </Button>
                    </div>
                  )}

                  {section.last_updated_at && (
                    <p className="text-[11px] text-muted">
                      {t('pilot_launch_readiness.timestamps.last_updated', {
                        date: new Date(section.last_updated_at).toLocaleString(getFormattingLocale()),
                      })}
                    </p>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>

          <Separator />
          <p className="text-xs text-muted">
            {t('pilot_launch_readiness.timestamps.report_generated', {
              date: new Date(report.generated_at).toLocaleString(getFormattingLocale()),
            })}
          </p>
        </>
      )}

      <Modal
        isOpen={launchModalOpen}
        onOpenChange={(open) => {
          if (!launching) setLaunchModalOpen(open);
        }}
        size="xl"
        backdrop="blur"
      >
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <Rocket size={20} className="text-success" />
            {t('pilot_launch_readiness.modal.title')}
          </ModalHeader>
          <ModalBody className="space-y-3">
            <p>
              {t('pilot_launch_readiness.modal.body_prefix')} <strong>{t('pilot_launch_readiness.modal.one_way_action')}</strong>. {t('pilot_launch_readiness.modal.body_suffix')}
            </p>
            <p>
              {t('pilot_launch_readiness.modal.confirm_intro')}
            </p>
            <ul className="list-disc pl-6 text-sm text-foreground space-y-1">
              <li>{t('pilot_launch_readiness.modal.check_disclosure')}</li>
              <li>{t('pilot_launch_readiness.modal.check_baseline')}</li>
              <li>{t('pilot_launch_readiness.modal.check_data_quality')}</li>
              <li>{t('pilot_launch_readiness.modal.check_residents')}</li>
            </ul>
            {report && (
              <div className="rounded-lg border border-border bg-surface-secondary p-3 text-xs text-foreground dark:bg-surface-secondary/30">
                <p className="font-semibold mb-1">{t('pilot_launch_readiness.modal.section_summary')}</p>
                <ul className="space-y-0.5">
                  {report.sections.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-2">
                      <span>{sectionLabel(t, s.label_code)}</span>
                      <Chip size="sm" variant="soft" color={STATUS_COLORS[s.status]}>
                        {t(`pilot_launch_readiness.status.${s.status}`)}
                      </Chip>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button
              variant="tertiary"
              onPress={() => setLaunchModalOpen(false)}
              isDisabled={launching}
            >
              {t('pilot_launch_readiness.actions.cancel')}
            </Button>
            <Button
              color="success"
              startContent={<Rocket size={16} />}
              onPress={launchPilot}
              isLoading={launching}
              isDisabled={!canLaunch}
            >
              {t('pilot_launch_readiness.actions.confirm_launch')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
