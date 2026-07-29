import { formatUnit, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Chip, Button, Spinner, Textarea, Progress } from '@/components/ui';
import {
  useEffect,
  useState,
  useCallback,
  useMemo } from 'react';
import { useParams,
  useNavigate } from 'react-router-dom';
import { Separator } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Save from 'lucide-react/icons/save';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Shield from 'lucide-react/icons/shield';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import Search from 'lucide-react/icons/search';
import Ban from 'lucide-react/icons/ban';
import ArrowUpCircle from 'lucide-react/icons/circle-arrow-up';
import Bell from 'lucide-react/icons/bell';
import { useTenant, useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/DataTable';
import type { GdprBreachDetail as GdprBreachDetailType } from '../../api/types';
import { useTranslation } from 'react-i18next';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Breach Detail
 * Detail page for viewing and managing a single data breach.
 * Route: /admin/enterprise/gdpr/breaches/:id
 */


const severityColorMap: Record<string, 'default' | 'primary' | 'warning' | 'danger'> = {
  low: 'default',
  medium: 'primary',
  high: 'warning',
  critical: 'danger',
};

const TIMELINE_STEP_KEYS: { labelKey: string; dateField: keyof GdprBreachDetailType; icon: typeof CheckCircle }[] = [
  { labelKey: 'enterprise.gdpr_timeline_detected', dateField: 'detected_at', icon: Search },
  { labelKey: 'enterprise.gdpr_timeline_investigating', dateField: 'reported_at', icon: Search },
  { labelKey: 'enterprise.gdpr_timeline_contained', dateField: 'contained_at', icon: Shield },
  { labelKey: 'enterprise.gdpr_timeline_resolved', dateField: 'resolved_at', icon: CheckCircle },
  { labelKey: 'enterprise.gdpr_timeline_dpa_notified', dateField: 'dpa_notified_at', icon: Bell },
];

const formatCountdown = (ms: number): string => {
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / (1000 * 60 * 60));
  const minutes = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
  return `${formatUnit(hours, 'hour')} ${formatUnit(minutes, 'minute')}`;
};

export function GdprBreachDetail() {
  const { t } = useTranslation('admin_enterprise');
  const { id } = useParams();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  useAdminPageMeta({ title: t('enterprise.gdpr_breach_detail_title') });

  const [breach, setBreach] = useState<GdprBreachDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  // Editable response fields
  const [rootCause, setRootCause] = useState('');
  const [remediationActions, setRemediationActions] = useState('');
  const [lessonsLearned, setLessonsLearned] = useState('');
  const [preventionMeasures, setPreventionMeasures] = useState('');

  // Live countdown timer for DPA 72-hour deadline
  const [now, setNow] = useState(() => Date.now());

  const breachId = useMemo(() => (id ? parseInt(id, 10) : 0), [id]);

  const loadData = useCallback(async () => {
    if (!breachId) return;
    setLoading(true);
    try {
      const res = await adminEnterprise.getGdprBreach(breachId);
      if (res.success && res.data) {
        const data = res.data as unknown as GdprBreachDetailType;
        setBreach(data);
        setRootCause(data.root_cause || '');
        setRemediationActions(data.remediation_actions || '');
        setLessonsLearned(data.lessons_learned || '');
        setPreventionMeasures(data.prevention_measures || '');
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_load_breach'));
    } finally {
      setLoading(false);
    }
  }, [breachId, t, toast])


  useEffect(() => {
    loadData();
  }, [loadData]);

  // Tick the countdown every minute while DPA notification is pending
  useEffect(() => {
    if (breach?.dpa_notified_at || !breach?.detected_at) return;
    const interval = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(interval);
  }, [breach?.dpa_notified_at, breach?.detected_at]);

  const handleStatusUpdate = async (updates: Partial<GdprBreachDetailType>) => {
    setActionLoading(true);
    try {
      const res = await adminEnterprise.updateGdprBreach(breachId, updates);
      if (res.success) {
        toast.success(t('enterprise.gdpr_breach_updated'));
        loadData();
      } else {
        toast.error(t('enterprise.gdpr_failed_update_breach'));
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_update_breach'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveResponse = async () => {
    setSaveLoading(true);
    try {
      const res = await adminEnterprise.updateGdprBreach(breachId, {
        root_cause: rootCause.trim() || null,
        remediation_actions: remediationActions.trim() || null,
        lessons_learned: lessonsLearned.trim() || null,
        prevention_measures: preventionMeasures.trim() || null,
      });
      if (res.success) {
        toast.success(t('enterprise.gdpr_response_saved'));
        loadData();
      } else {
        toast.error(t('enterprise.gdpr_failed_save_response'));
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_save_response'));
    } finally {
      setSaveLoading(false);
    }
  };

  const handleNotifyDpa = async () => {
    setActionLoading(true);
    try {
      const res = await adminEnterprise.notifyDpa(breachId);
      if (res.success) {
        toast.success(t('enterprise.gdpr_dpa_notification_sent'));
        loadData();
      } else {
        toast.error(t('enterprise.gdpr_failed_notify_dpa'));
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_notify_dpa'));
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!breach) {
    return (
      <div className="text-center py-16">
        <p className="text-muted">{t('enterprise.gdpr_breach_not_found')}</p>
        <Button
          variant="tertiary"
          className="mt-4"
          onPress={() => navigate(tenantPath('/admin/enterprise/gdpr/breaches'))}
        >
          {t('enterprise.gdpr_back_to_breaches')}
        </Button>
      </div>
    );
  }

  // Compute live 72-hour countdown for DPA notification
  const detectedAt = breach.detected_at ? new Date(breach.detected_at) : null;
  const deadlineMs = detectedAt ? detectedAt.getTime() + 72 * 60 * 60 * 1000 : 0;
  const remainingMs = deadlineMs - now;
  const hoursRemaining = remainingMs / (1000 * 60 * 60);
  const isOverdue = remainingMs < 0;
  const dpaUrgent = !breach.dpa_notified_at && hoursRemaining < 24;

  return (
    <div>
      <PageHeader
        title={t('enterprise.gdpr_breach_detail_title')}
        description={t('enterprise.gdpr_breach_detail_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<ArrowLeft size={16} />}
            onPress={() => navigate(tenantPath('/admin/enterprise/gdpr/breaches'))}
            size="sm"
          >
            {t('enterprise.gdpr_back_to_breaches')}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Overview Card */}
          <Card >
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="text-lg font-semibold">{t('enterprise.gdpr_overview')}</h3>
            </CardHeader>
            <CardBody className="p-4 space-y-4">
              <p className="text-foreground">{breach.description}</p>

              <div className="flex flex-wrap gap-2">
                <Chip
                  size="sm"
                  variant="soft"
                  color={severityColorMap[breach.severity] || 'default'}
                  className="capitalize"
                >
                  {t('enterprise.gdpr_severity_label')}
                </Chip>
                <StatusBadge status={breach.status} />
              </div>

              {breach.data_categories_affected && breach.data_categories_affected.length > 0 && (
                <div>
                  <p className="text-sm text-muted mb-2">{t('enterprise.gdpr_data_categories_affected')}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {breach.data_categories_affected.map((cat) => (
                      <Chip
                        key={cat}
                        size="sm"
                        variant="soft"
                        data-testid="data-category-chip"
                        data-category={cat}
                      >
                        {t(`enterprise.gdpr_data_category_${cat}`, { defaultValue: t('enterprise.gdpr_data_category_unknown') })}
                      </Chip>
                    ))}
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* Impact Card */}
          <Card >
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="text-lg font-semibold">{t('enterprise.gdpr_impact_assessment')}</h3>
            </CardHeader>
            <CardBody className="p-4">
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <p className="text-sm text-muted">{t('enterprise.gdpr_records_affected')}</p>
                  <p className="text-xl font-bold">{breach.number_of_records_affected ?? t('enterprise.not_available')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">{t('enterprise.gdpr_users_affected')}</p>
                  <p className="text-xl font-bold">{breach.number_of_users_affected ?? t('enterprise.not_available')}</p>
                </div>
                <div>
                  <p className="text-sm text-muted">{t('enterprise.gdpr_detected')}</p>
                  <p className="font-medium text-sm">
                    {breach.detected_at ? new Date(breach.detected_at).toLocaleString(getFormattingLocale()) : t('enterprise.not_available')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted">{t('enterprise.gdpr_occurred')}</p>
                  <p className="font-medium text-sm">
                    {breach.occurred_at ? new Date(breach.occurred_at).toLocaleString(getFormattingLocale()) : t('enterprise.not_available')}
                  </p>
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Response Card */}
          <Card >
            <CardHeader className="px-4 pt-4 pb-0 flex justify-between items-center">
              <h3 className="text-lg font-semibold">{t('enterprise.gdpr_response_analysis')}</h3>
              <Button
                size="sm"
                startContent={<Save size={14} />}
                onPress={handleSaveResponse}
                isLoading={saveLoading}
              >
                {t('enterprise.gdpr_save')}
              </Button>
            </CardHeader>
            <CardBody className="p-4 space-y-4">
              <Textarea
                label={t('enterprise.gdpr_root_cause')}
                placeholder={t('enterprise.gdpr_root_cause_placeholder')}
                value={rootCause}
                onValueChange={setRootCause}
                variant="secondary"
                minRows={2}
              />
              <Textarea
                label={t('enterprise.gdpr_remediation_actions')}
                placeholder={t('enterprise.gdpr_remediation_actions_placeholder')}
                value={remediationActions}
                onValueChange={setRemediationActions}
                variant="secondary"
                minRows={2}
              />
              <Textarea
                label={t('enterprise.gdpr_lessons_learned')}
                placeholder={t('enterprise.gdpr_lessons_learned_placeholder')}
                value={lessonsLearned}
                onValueChange={setLessonsLearned}
                variant="secondary"
                minRows={2}
              />
              <Textarea
                label={t('enterprise.gdpr_prevention_measures')}
                placeholder={t('enterprise.gdpr_prevention_measures_placeholder')}
                value={preventionMeasures}
                onValueChange={setPreventionMeasures}
                variant="secondary"
                minRows={2}
              />
            </CardBody>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Timeline Card */}
          <Card >
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="text-lg font-semibold">{t('enterprise.gdpr_timeline')}</h3>
            </CardHeader>
            <CardBody className="p-4">
              <div className="relative pl-6">
                <div className="absolute left-2 top-1 bottom-1 w-0.5 bg-border" />

                <div className="space-y-5">
                  {TIMELINE_STEP_KEYS.map((step) => {
                    const dateValue = breach[step.dateField] as string | null;
                    const completed = !!dateValue;
                    const Icon = step.icon;

                    return (
                      <div key={step.dateField} className="relative">
                        <div className={`
                          absolute -left-4 top-0.5 h-3 w-3 rounded-full border-2
                          ${completed
                            ? 'border-success bg-success'
                            : 'border-border bg-background'
                          }
                        `} />
                        <div className="flex items-center gap-2">
                          <Icon size={14} className={completed ? 'text-success' : 'text-muted'} />
                          <span className={`text-sm font-medium ${completed ? 'text-foreground' : 'text-muted'}`}>
                            {t(step.labelKey)}
                          </span>
                        </div>
                        {completed && (
                          <p className="text-xs text-muted mt-0.5 ml-6">
                            {new Date(dateValue!).toLocaleString(getFormattingLocale())}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardBody>
          </Card>

          {/* DPA Notification Card */}
          <Card >
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <Bell size={18} />
                {t('enterprise.gdpr_dpa_notification')}
              </h3>
            </CardHeader>
            <CardBody className="p-4 space-y-3">
              {breach.dpa_notified_at ? (
                <>
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle size={16} />
                    <span className="text-sm font-medium">{t('enterprise.gdpr_notified')}</span>
                  </div>
                  <div>
                    <p className="text-sm text-muted">{t('enterprise.gdpr_date')}</p>
                    <p className="font-medium text-sm">
                      {new Date(breach.dpa_notified_at).toLocaleString(getFormattingLocale())}
                    </p>
                  </div>
                  {breach.authority_reference && (
                    <div>
                      <p className="text-sm text-muted">{t('enterprise.gdpr_reference')}</p>
                      <p className="font-medium text-sm">{breach.authority_reference}</p>
                    </div>
                  )}
                </>
              ) : (
                <>
                  {detectedAt && (
                    <Card  className={`border-2 ${isOverdue ? 'border-danger' : hoursRemaining < 24 ? 'border-warning' : 'border-success'}`}>
                      <CardBody className="p-4 text-center">
                        <p className="text-xs text-muted mb-1">{t('enterprise.gdpr_dpa_deadline')}</p>
                        <p className={`text-2xl font-bold ${isOverdue ? 'text-danger' : hoursRemaining < 24 ? 'text-warning' : 'text-success'}`}>
                          {isOverdue ? '\u2212' : ''}{formatCountdown(remainingMs)}
                        </p>
                        <p className={`text-xs mt-1 ${isOverdue ? 'text-danger' : 'text-muted'}`}>
                          {isOverdue ? t('enterprise.gdpr_dpa_overdue') : hoursRemaining < 24 ? t('enterprise.gdpr_dpa_less_than_24h') : t('enterprise.gdpr_dpa_remaining')}
                        </p>
                        <Progress
                          value={isOverdue ? 100 : Math.min(100, ((72 - hoursRemaining) / 72) * 100)}
                          color={isOverdue ? 'danger' : hoursRemaining < 24 ? 'warning' : 'success'}
                          size="sm"
                          className="mt-3"
                          aria-label={t('enterprise.gdpr_dpa_deadline')}
                        />
                      </CardBody>
                    </Card>
                  )}
                  {dpaUrgent && (
                    <div className="p-3 rounded-lg bg-danger-50 border border-danger-200">
                      <div className="flex items-center gap-2 text-danger">
                        <AlertTriangle size={16} />
                        <span className="text-sm font-semibold">
                          {isOverdue ? t('enterprise.gdpr_deadline_exceeded') : t('enterprise.gdpr_deadline_approaching')}
                        </span>
                      </div>
                      <p className="text-xs text-danger-600 mt-1">
                        {t('enterprise.gdpr_dpa_72h_requirement')}
                      </p>
                    </div>
                  )}
                  <Button
                    color="warning"
                    variant="tertiary"
                    startContent={<Bell size={14} />}
                    onPress={handleNotifyDpa}
                    isLoading={actionLoading}
                    className="w-full"
                    size="sm"
                  >
                    {t('enterprise.gdpr_notify_dpa')}
                  </Button>
                </>
              )}
            </CardBody>
          </Card>

          {/* Actions Card */}
          <Card >
            <CardHeader className="px-4 pt-4 pb-0">
              <h3 className="text-lg font-semibold">{t('enterprise.gdpr_actions')}</h3>
            </CardHeader>
            <CardBody className="p-4 space-y-2">
              {breach.status === 'open' && (
                <Button
                  variant="tertiary"
                  startContent={<Search size={14} />}
                  onPress={() => handleStatusUpdate({ status: 'investigating' })}
                  isLoading={actionLoading}
                  className="w-full"
                  size="sm"
                >
                  {t('enterprise.gdpr_mark_investigating')}
                </Button>
              )}
              {(breach.status === 'open' || breach.status === 'investigating') && (
                <Button
                  color="warning"
                  variant="tertiary"
                  startContent={<Ban size={14} />}
                  onPress={() => handleStatusUpdate({ contained_at: new Date().toISOString(), status: 'contained' })}
                  isLoading={actionLoading}
                  className="w-full"
                  size="sm"
                >
                  {t('enterprise.gdpr_mark_contained')}
                </Button>
              )}
              {breach.status !== 'resolved' && (
                <Button
                  color="success"
                  variant="tertiary"
                  startContent={<CheckCircle size={14} />}
                  onPress={() => handleStatusUpdate({ resolved_at: new Date().toISOString(), status: 'resolved' })}
                  isLoading={actionLoading}
                  className="w-full"
                  size="sm"
                >
                  {t('enterprise.gdpr_mark_resolved')}
                </Button>
              )}
              <Separator />
              <Button
                color="danger"
                variant="tertiary"
                startContent={<ArrowUpCircle size={14} />}
                onPress={() => handleStatusUpdate({ escalated_at: new Date().toISOString() })}
                isLoading={actionLoading}
                className="w-full"
                size="sm"
              >
                {t('enterprise.gdpr_escalate')}
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default GdprBreachDetail;
