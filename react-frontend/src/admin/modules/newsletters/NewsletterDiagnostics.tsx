import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Progress } from '@/components/ui';
import {
  useState,
  useCallback,
  useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertCircle from 'lucide-react/icons/circle-alert';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Mail from 'lucide-react/icons/mail';
import Settings from 'lucide-react/icons/settings';
import Activity from 'lucide-react/icons/activity';
import Wrench from 'lucide-react/icons/wrench';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { useTenant } from '@/contexts';
import { adminNewsletters } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { NewsletterDiagnostics as DiagnosticsData } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Newsletter Diagnostics
 * Email health dashboard - queue status, bounce rate, configuration checks
 */

const getHealthColor = (status: string) => {
  switch (status) {
    case 'healthy': return 'success';
    case 'warning': return 'warning';
    case 'critical': return 'danger';
    default: return 'default';
  }
};

const getHealthIcon = (status: string) => {
  switch (status) {
    case 'healthy': return <CheckCircle size={24} className="text-success" />;
    case 'warning': return <AlertCircle size={24} className="text-warning" />;
    case 'critical': return <XCircle size={24} className="text-danger" />;
    default: return <Activity size={24} className="text-muted" />;
  }
};

const getConfigIcon = (enabled: boolean) => {
  return enabled ? (
    <CheckCircle size={16} className="text-success" />
  ) : (
    <XCircle size={16} className="text-danger" />
  );
};

export function NewsletterDiagnostics() {
  const { t } = useTranslation('admin_newsletters');
  usePageTitle(t('newsletters.newsletter_diagnostics_title'));
  const toast = useToast();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DiagnosticsData | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminNewsletters.getDiagnostics();
      if (res.success && res.data) {
        setData(res.data as DiagnosticsData);
      }
    } catch {
      setData(null);
      toast.error(t('newsletters.failed_to_load_diagnostics'));
    }
    setLoading(false);
  }, [t, toast]);


  const handleRepairQueue = useCallback(() => {
    navigate(tenantPath('/admin/newsletters/bounces'));
  }, [navigate, tenantPath]);

  useEffect(() => { loadData(); }, [loadData]);

  const queueTotal = data?.queue_status?.total || 0;
  const queuePending = data?.queue_status?.pending || 0;
  const queueSending = data?.queue_status?.sending || 0;
  const queueSent = data?.queue_status?.sent || 0;
  const queueFailed = data?.queue_status?.failed || 0;

  const queueHealth = queueTotal > 0
    ? ((queueSent / queueTotal) * 100)
    : 100;

  return (
    <div>
      <PageHeader
        title={t('newsletters.newsletter_diagnostics_title')}
        description={t('newsletters.newsletter_diagnostics_desc')}
        actions={
          <Button
            variant="secondary"
            startContent={<RefreshCw size={16} />}
            onPress={loadData}
            isLoading={loading}
          >
            {t('newsletters.refresh')}
          </Button>
        }
      />

      <div className="grid gap-6">
        {/* Overall Health */}
        <Card>
          <CardBody className="flex-row items-center gap-4">
            {data && getHealthIcon(data.health_status)}
            <div className="flex-1">
              <p className="text-lg font-semibold">{t('newsletter_diagnostics.system_health')}</p>
              <p className="text-sm text-muted">
                {data?.health_status === 'healthy' && t('newsletter_diagnostics.status_healthy')}
                {data?.health_status === 'warning' && t('newsletter_diagnostics.status_warning')}
                {data?.health_status === 'critical' && t('newsletter_diagnostics.status_critical')}
              </p>
            </div>
            {data && (
              <Chip
                color={getHealthColor(data.health_status)}
                variant="soft"
                size="lg"
              >
                {t(`newsletter_diagnostics.status_${data.health_status}`)}
              </Chip>
            )}
          </CardBody>
        </Card>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Queue Status */}
          <Card>
            <CardHeader className="flex gap-2 items-center">
              <Mail size={20} />
              <span>{t('newsletter_diagnostics.queue_status')}</span>
            </CardHeader>
            <CardBody className="gap-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-muted">{t('newsletter_diagnostics.loading')}</div>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.total')}</span>
                      <span className="font-semibold">{queueTotal.toLocaleString(getFormattingLocale())}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.pending')}</span>
                      <Chip size="sm" color="warning" variant="soft">{queuePending}</Chip>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.sending')}</span>
                      <Chip size="sm" color="accent" variant="soft">{queueSending}</Chip>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.sent')}</span>
                      <Chip size="sm" color="success" variant="soft">{queueSent}</Chip>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.failed')}</span>
                      <Chip size="sm" color="danger" variant="soft">{queueFailed}</Chip>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.success_rate')}</span>
                      <span className="text-sm font-semibold">{formatNumber(queueHealth / 100, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
                    </div>
                    <Progress
                      value={queueHealth}
                      color={queueHealth > 90 ? 'success' : queueHealth > 70 ? 'warning' : 'danger'}
                      size="sm"
                      aria-label={t('newsletter_diagnostics.success_rate')}
                    />
                  </div>

                  {queueFailed > 10 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      color="warning"
                      startContent={<Wrench size={16} />}
                      onPress={handleRepairQueue}
                    >
                      {t('newsletter_diagnostics.view_bounces')}
                    </Button>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          {/* Bounce Rate */}
          <Card>
            <CardHeader className="flex gap-2 items-center">
              <Activity size={20} />
              <span>{t('newsletter_diagnostics.delivery_health')}</span>
            </CardHeader>
            <CardBody className="gap-4">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-muted">{t('newsletter_diagnostics.loading')}</div>
                </div>
              ) : (
                <>
                  <div>
                    <p className="text-sm text-foreground mb-2">{t('newsletter_diagnostics.bounce_rate')}</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold">
                        {formatNumber((data?.bounce_rate ?? 0) / 100, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      {data && data.bounce_rate < 5 && (
                        <Chip size="sm" color="success" variant="soft">{t('newsletter_diagnostics.bounce_chip_good')}</Chip>
                      )}
                      {data && data.bounce_rate >= 5 && data.bounce_rate < 10 && (
                        <Chip size="sm" color="warning" variant="soft">{t('newsletter_diagnostics.bounce_chip_warning')}</Chip>
                      )}
                      {data && data.bounce_rate >= 10 && (
                        <Chip size="sm" color="danger" variant="soft">{t('newsletter_diagnostics.bounce_chip_critical')}</Chip>
                      )}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-foreground">{t('newsletter_diagnostics.health')}</span>
                      <span className="text-sm font-semibold">
                        {data && data.bounce_rate < 5
                          ? t('newsletter_diagnostics.health_at_least', {
                              value: formatNumber(0.95, { style: 'percent' }),
                            })
                          : data && data.bounce_rate < 10
                            ? t('newsletter_diagnostics.health_range', {
                                min: formatNumber(0.85, { style: 'percent' }),
                                max: formatNumber(0.95, { style: 'percent' }),
                              })
                            : t('newsletter_diagnostics.health_below', {
                                value: formatNumber(0.85, { style: 'percent' }),
                              })}
                      </span>
                    </div>
                    <Progress
                      value={data ? Math.max(0, 100 - (data.bounce_rate * 2)) : 100}
                      color={data && data.bounce_rate < 5 ? 'success' : data && data.bounce_rate < 10 ? 'warning' : 'danger'}
                      size="sm"
                      aria-label={t('newsletter_diagnostics.health')}
                    />
                  </div>

                  <div>
                    <p className="text-sm text-foreground mb-2">{t('newsletter_diagnostics.sender_score')}</p>
                    <div className="flex items-baseline gap-2">
                      <span className={`text-3xl font-bold ${
                        (data?.sender_score ?? 100) >= 80 ? 'text-success' :
                        (data?.sender_score ?? 100) >= 60 ? 'text-warning' : 'text-danger'
                      }`}>
                        {data?.sender_score ?? 100}
                      </span>
                    <span className="text-sm text-muted">
                      {t('diagnostics.score_out_of', { maximum: 100 })}
                    </span>
                    </div>
                    <Progress
                      value={data?.sender_score ?? 100}
                      color={(data?.sender_score ?? 100) >= 80 ? 'success' : (data?.sender_score ?? 100) >= 60 ? 'warning' : 'danger'}
                      size="sm"
                      className="mt-2"
                      aria-label={t('newsletter_diagnostics.sender_score')}
                    />
                  </div>

                  {data?.sender_score_breakdown && (
                    <div className="space-y-1.5 pt-2 border-t border-border">
                      <p className="text-xs font-medium text-muted mb-1">{t('newsletter_diagnostics.score_breakdown')}</p>
                      {data.sender_score_breakdown.bounce_penalty > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{t('newsletter_diagnostics.bounce_penalty')}</span>
                          <span className="text-danger font-medium">-{data.sender_score_breakdown.bounce_penalty}</span>
                        </div>
                      )}
                      {data.sender_score_breakdown.complaint_penalty > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{t('newsletter_diagnostics.complaint_penalty')}</span>
                          <span className="text-danger font-medium">-{data.sender_score_breakdown.complaint_penalty}</span>
                        </div>
                      )}
                      {data.sender_score_breakdown.failure_penalty > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{t('newsletter_diagnostics.failure_penalty')}</span>
                          <span className="text-danger font-medium">-{data.sender_score_breakdown.failure_penalty}</span>
                        </div>
                      )}
                      {data.sender_score_breakdown.suppression_penalty > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{t('newsletter_diagnostics.suppression_penalty')}</span>
                          <span className="text-danger font-medium">-{data.sender_score_breakdown.suppression_penalty}</span>
                        </div>
                      )}
                      {data.sender_score_breakdown.volume_bonus > 0 && (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-foreground">{t('newsletter_diagnostics.volume_bonus')}</span>
                          <span className="text-success font-medium">+{data.sender_score_breakdown.volume_bonus}</span>
                        </div>
                      )}
                      {data.sender_score_breakdown.bounce_penalty === 0 &&
                       data.sender_score_breakdown.complaint_penalty === 0 &&
                       data.sender_score_breakdown.failure_penalty === 0 &&
                       data.sender_score_breakdown.suppression_penalty === 0 && (
                        <p className="text-xs text-success">{t('newsletter_diagnostics.no_penalties')}</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>
        </div>

        {/* Configuration */}
        <Card>
          <CardHeader className="flex gap-2 items-center">
            <Settings size={20} />
            <span>{t('newsletter_diagnostics.email_configuration')}</span>
          </CardHeader>
          <CardBody>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-muted">{t('newsletter_diagnostics.loading')}</div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-3">
                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-secondary dark:bg-surface">
                  {getConfigIcon(data?.configuration?.smtp_configured || false)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('newsletter_diagnostics.smtp_configured')}</p>
                    <p className="text-xs text-muted">
                      {data?.configuration?.smtp_configured ? t('newsletter_diagnostics.status_active') : t('newsletter_diagnostics.status_not_configured')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-secondary dark:bg-surface">
                  {getConfigIcon(data?.configuration?.api_configured || false)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('newsletter_diagnostics.gmail_api')}</p>
                    <p className="text-xs text-muted">
                      {data?.configuration?.api_configured ? t('newsletter_diagnostics.status_active') : t('newsletter_diagnostics.status_not_configured')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-3 rounded-lg bg-surface-secondary dark:bg-surface">
                  {getConfigIcon(data?.configuration?.tracking_enabled || false)}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{t('newsletter_diagnostics.tracking_enabled')}</p>
                    <p className="text-xs text-muted">
                      {data?.configuration?.tracking_enabled ? t('newsletter_diagnostics.status_active') : t('newsletter_diagnostics.status_disabled')}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Recommendations */}
        {data && (data.health_status !== 'healthy' || (data.sender_score_breakdown?.complaint_penalty ?? 0) > 0 || (!data.configuration.smtp_configured && !data.configuration.api_configured)) && (
          <Card className="bg-warning/10">
            <CardHeader>
              <div className="flex items-center gap-2">
                <AlertCircle size={20} className="text-warning" />
                <span className="font-semibold text-warning">{t('newsletter_diagnostics.recommendations')}</span>
              </div>
            </CardHeader>
            <CardBody>
              <ul className="space-y-2 text-sm text-warning-soft-foreground">
                {data.bounce_rate > 5 && (
                  <li>• {t('newsletter_diagnostics.rec_high_bounce_rate')}</li>
                )}
                {data.sender_score_breakdown?.complaint_penalty > 0 && (
                  <li>• {t('newsletter_diagnostics.rec_spam_complaints')}</li>
                )}
                {data.sender_score_breakdown?.suppression_penalty > 5 && (
                  <li>• {t('newsletter_diagnostics.rec_high_suppression')}</li>
                )}
                {queueFailed > 10 && (
                  <li>• {t('newsletter_diagnostics.rec_failed_sends')}</li>
                )}
                {data.sender_score < 70 && data.sender_score >= 50 && (
                  <li>• {t('newsletter_diagnostics.rec_low_score_warning')}</li>
                )}
                {data.sender_score < 50 && (
                  <li>• {t('newsletter_diagnostics.rec_low_score_critical')}</li>
                )}
                {!data.configuration.smtp_configured && !data.configuration.api_configured && (
                  <li>• {t('newsletter_diagnostics.rec_no_email_service')}</li>
                )}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

export default NewsletterDiagnostics;
