import { Card, CardBody, CardHeader, Button, Chip, Code, Tabs, Tab } from '@/components/ui';
import { useState } from 'react';

import Server from 'lucide-react/icons/server';
import Copy from 'lucide-react/icons/copy';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import PlayCircle from 'lucide-react/icons/circle-play';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Info from 'lucide-react/icons/info';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { PageHeader } from '../../components/PageHeader';
import { adminSystem } from '../../api/adminApi';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cron Job Setup
 * Platform setup guide for configuring the Laravel scheduler.
 *
 * All cron jobs run via `artisan schedule:run` which calls CronJobRunner::runAll().
 * HTTP-based cron endpoints (/cron/*) were removed (2026-04-02) to prevent
 * duplicate email sends. This page reflects the single-trigger model.
 */


// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CronJobSetup() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.cron_job_setup_title'));
  const toast = useToast();
  const [testing, setTesting] = useState(false);
  const cronRunnerMethod = 'CronJobRunner::runAll()';

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success(t('system.copied_to_clipboard'));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await adminSystem.getCronJobs();
      if (res.success && Array.isArray(res.data)) {
        toast.success(t('system.cron_connection_ok', { count: res.data.length }));
      } else {
        toast.error(t('system.cron_api_unexpected_data'));
      }
    } catch {
      toast.error(t('system.failed_to_connect_cron_api'));
    }
    setTesting(false);
  };

  return (
    <div>
      <PageHeader
        title={t('system.cron_job_setup_title')}
        description={t('system.cron_job_setup_desc')}
      />

      {/* Important Notice */}
      <Card className="mb-6">
        <CardBody>
          <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start gap-2">
            <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
            <div className="text-sm text-foreground">
              <p className="font-medium mb-1">
                {t('system.cron_notice_title')}
              </p>
              <p className="text-xs text-muted">
                {t('system.cron_notice_body_prefix')}{' '}
                {/* eslint-disable-next-line i18next/no-literal-string -- Scheduler command must remain verbatim. */}
                <Code className="text-xs">artisan schedule:run</Code>{' '}
                {t('system.cron_notice_body_middle')}{' '}
                {/* eslint-disable-next-line i18next/no-literal-string -- Cron route glob must remain verbatim. */}
                <Code className="text-xs">/cron/*</Code>{' '}
                {t('system.cron_notice_body_suffix')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Test Connection */}
      <Card className="mb-6">
        <CardBody className="flex flex-row items-center justify-between gap-4">
          <div>
            <p className="font-medium">{t('system.test_cron_api')}</p>
            <p className="text-sm text-muted">
              {t('system.test_cron_api_desc')}
            </p>
          </div>
          <Button
            variant="secondary"
            startContent={<PlayCircle size={16} />}
            onPress={handleTestConnection}
            isLoading={testing}
          >
            {t('system.test_connection')}
          </Button>
        </CardBody>
      </Card>

      {/* Platform-specific instructions */}
      <Card>
        <CardBody className="p-0">
          <Tabs
            aria-label={t('system.label_platform_setup_instructions')}
            variant="underlined"
            classNames={{
              base: 'w-full',
              tabList: 'px-4',
              panel: 'px-4 pb-4',
            }}
          >
            {/* Docker (Primary) */}
            <Tab key="docker" title={<div className="flex items-center gap-1.5"><Server size={14} /> {t('system.platform_docker')} <Chip size="sm" color="success" variant="soft">{t('system.recommended')}</Chip></div>}>
              <div className="space-y-4 pt-4">
                <div>
                  <h3 className="text-base font-semibold mb-2">
                    {t('system.cron_docker_step_1_title')}
                  </h3>
                  <p className="text-sm text-muted mb-2">
                    {t('system.cron_docker_step_1_desc')}
                  </p>
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line i18next/no-literal-string -- Crontab command must remain verbatim. */}
                    <Code className="flex-1 text-xs break-all">* * * * * docker exec nexus-php-app php /var/www/html/artisan schedule:run {'>'}{'>'}  /var/log/nexus-scheduler.log 2{'>'}&1</Code>
                    <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label={t('system.label_copy_crontab_entry')}
                        onPress={() =>
                          copyToClipboard('* * * * * docker exec nexus-php-app php /var/www/html/artisan schedule:run >> /var/log/nexus-scheduler.log 2>&1')
                        }
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.verify')}</h3>
                  {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                  <Code className="block text-xs">sudo crontab -l</Code>
                </div>

                <div className="bg-success/10 border border-success/20 rounded-lg p-3 flex items-start gap-2">
                  <CheckCircle size={16} className="text-success mt-0.5 shrink-0" />
                  <p className="text-xs text-muted">
                    <strong>{t('system.cron_success_title')}</strong> {t('system.cron_success_body_prefix')}{' '}
                    <Code className="text-xs">{cronRunnerMethod}</Code> {t('system.cron_success_body_suffix')}
                  </p>
                </div>
              </div>
            </Tab>

            {/* Linux */}
            <Tab key="linux" title={t('system.platform_linux_vps')}>
              <div className="space-y-4 pt-4">
                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_linux_step_1_title')}</h3>
                  {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                  <Code className="block text-xs">crontab -e</Code>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_linux_step_2_title')}</h3>
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line i18next/no-literal-string -- Crontab command must remain verbatim. */}
                    <Code className="flex-1 text-xs break-all">* * * * * cd /path/to/your/project && php artisan schedule:run {'>'}{'>'}  /dev/null 2{'>'}&1</Code>
                    <Button
                        size="sm"
                        variant="ghost"
                        isIconOnly
                        aria-label={t('system.label_copy_crontab_entry')}
                        onPress={() =>
                          copyToClipboard('* * * * * cd /path/to/your/project && php artisan schedule:run >> /dev/null 2>&1')
                        }
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {t('system.replace')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Filesystem path placeholder must remain verbatim. */}
                    <Code className="text-xs">/path/to/your/project</Code>{' '}
                    {t('system.with_actual_project_root')}
                  </p>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.verify')}</h3>
                  {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                  <Code className="block text-xs">crontab -l</Code>
                </div>
              </div>
            </Tab>

            {/* cPanel */}
            <Tab key="cpanel" title={t('system.platform_cpanel')}>
              <div className="space-y-4 pt-4">
                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_cpanel_step_1_title')}</h3>
                  <p className="text-sm text-muted">
                    {t('system.cron_cpanel_step_1_desc')}
                  </p>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_cpanel_step_2_title')}</h3>
                  <p className="text-sm text-muted mb-2">
                    {t('system.cron_cpanel_step_2_desc_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Cron expression must remain verbatim. */}
                    <Code className="text-xs">* * * * *</Code>{' '}
                    {t('system.cron_cpanel_step_2_desc_suffix')}
                  </p>
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line i18next/no-literal-string -- Crontab command must remain verbatim. */}
                    <Code className="flex-1 text-xs break-all">cd /home/username/public_html && php artisan schedule:run {'>'}{'>'}  /dev/null 2{'>'}&1</Code>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={t('system.label_copy_code')}
                      onPress={() =>
                        copyToClipboard('cd /home/username/public_html && php artisan schedule:run >> /dev/null 2>&1')
                      }
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                  <p className="text-xs text-muted mt-1">
                    {t('system.replace')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Filesystem path placeholder must remain verbatim. */}
                    <Code className="text-xs">/home/username/public_html</Code>{' '}
                    {t('system.with_absolute_project_path')}
                  </p>
                </div>
              </div>
            </Tab>

            {/* Azure */}
            <Tab key="azure" title={t('system.platform_azure_vm')}>
              <div className="space-y-4 pt-4">
                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_azure_step_1_title')}</h3>
                  {/* eslint-disable-next-line i18next/no-literal-string -- SSH command must remain verbatim. */}
                  <Code className="block text-xs">ssh azureuser@your-vm-ip</Code>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_azure_step_2_title')}</h3>
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line i18next/no-literal-string -- Crontab command must remain verbatim. */}
                    <Code className="flex-1 text-xs break-all">* * * * * docker exec nexus-php-app php /var/www/html/artisan schedule:run {'>'}{'>'}  /var/log/nexus-scheduler.log 2{'>'}&1</Code>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={t('system.label_copy_crontab_entry')}
                      onPress={() =>
                        copyToClipboard('* * * * * docker exec nexus-php-app php /var/www/html/artisan schedule:run >> /var/log/nexus-scheduler.log 2>&1')
                      }
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>

                <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
                  <p className="text-xs text-warning-soft-foreground">
                    {t('system.do_word')} <strong>{t('system.not_word')}</strong>{' '}
                    {t('system.cron_http_warning_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Scheduler command must remain verbatim. */}
                    <Code className="text-xs">artisan schedule:run</Code>{' '}
                    {t('system.only_word')}
                  </p>
                </div>
              </div>
            </Tab>

            {/* GCP */}
            <Tab key="gcp" title={t('system.platform_gcp')}>
              <div className="space-y-4 pt-4">
                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_gcp_step_1_title')}</h3>
                  {/* eslint-disable-next-line i18next/no-literal-string -- Cloud CLI command must remain verbatim. */}
                  <Code className="block text-xs">gcloud compute ssh your-instance-name</Code>
                </div>

                <div>
                  <h3 className="text-base font-semibold mb-2">{t('system.cron_gcp_step_2_title')}</h3>
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line i18next/no-literal-string -- Crontab command must remain verbatim. */}
                    <Code className="flex-1 text-xs break-all">* * * * * docker exec nexus-php-app php /var/www/html/artisan schedule:run {'>'}{'>'}  /var/log/nexus-scheduler.log 2{'>'}&1</Code>
                    <Button
                      size="sm"
                      variant="ghost"
                      isIconOnly
                      aria-label={t('system.label_copy_crontab_entry')}
                      onPress={() =>
                        copyToClipboard('* * * * * docker exec nexus-php-app php /var/www/html/artisan schedule:run >> /var/log/nexus-scheduler.log 2>&1')
                      }
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                </div>

                <div className="bg-warning/10 border border-warning/20 rounded-lg p-3 flex items-start gap-2">
                  <AlertTriangle size={16} className="text-warning mt-0.5 shrink-0" />
                  <p className="text-xs text-warning-soft-foreground">
                    {t('system.do_word')} <strong>{t('system.not_word')}</strong>{' '}
                    {t('system.cron_cloud_scheduler_warning_prefix')}{' '}
                    {/* eslint-disable-next-line i18next/no-literal-string -- Scheduler command must remain verbatim. */}
                    <Code className="text-xs">artisan schedule:run</Code>{' '}
                    {t('system.only_word')}
                  </p>
                </div>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      {/* Verification Checklist */}
      <Card className="mt-6">
        <CardHeader className="flex items-center gap-2">
          <Info size={18} className="text-accent" />
          <h3 className="text-lg font-semibold">{t('system.verification_checklist')}</h3>
        </CardHeader>
        <CardBody className="space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="text-sm">
              {/* eslint-disable-next-line i18next/no-literal-string -- Scheduler command must remain verbatim. */}
              <Code className="text-xs">artisan schedule:run</Code> {t('system.check_schedule_runs')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="text-sm">{t('system.check_first_run_logged')}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="text-sm">{t('system.check_logs_success')}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="text-sm">{t('system.check_test_connection')}</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle size={16} className="text-success" />
            <span className="text-sm">{t('system.check_no_http_triggers')}</span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default CronJobSetup;
