import { Card, CardBody, CardHeader, Button, Spinner, Chip, Input } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Separator } from '@/components/ui';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Search from 'lucide-react/icons/search';
import Server from 'lucide-react/icons/server';
import FolderOpen from 'lucide-react/icons/folder-open';
import Settings from 'lucide-react/icons/settings';
import Puzzle from 'lucide-react/icons/puzzle';
import Code from 'lucide-react/icons/code';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { SystemRequirements as SystemRequirementsType } from '../../api/types';

// Written out in full so Tailwind can find them (a class built at runtime,
// such as `text-${color}`, is never generated and shows no colour).
const STATUS_TEXT = { success: 'text-success', warning: 'text-warning', danger: 'text-danger' } as const;
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * System Requirements
 * Checks PHP version, extensions, writable directories, services, and INI settings.
 */


export function SystemRequirements() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));
  const toast = useToast();

  const [data, setData] = useState<SystemRequirementsType | null>(null);
  const [loading, setLoading] = useState(true);
  const [extSearch, setExtSearch] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getSystemRequirements();
      if (res.success && res.data) {
        setData(res.data as unknown as SystemRequirementsType);
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_system_requirements'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])


  useEffect(() => {
    loadData();
  }, [loadData]);

  // Compute overall status
  const computeStatus = (): 'pass' | 'warning' | 'fail' => {
    if (!data) return 'fail';
    const phpFail = !data.php.meets_minimum;
    const missingRequired = data.extensions.some((ext) => ext.required && !ext.loaded);
    const dirFail = data.writable_directories.some((d) => !d.writable);
    const serviceFail = data.services.some((s) => s.status === 'fail');
    if (phpFail || missingRequired || serviceFail) return 'fail';
    if (dirFail) return 'warning';
    const missingOptional = data.extensions.some((ext) => !ext.required && !ext.loaded);
    if (missingOptional) return 'warning';
    return 'pass';
  };

  const status = computeStatus();
  const statusConfig = {
    pass: { color: 'success' as const, label: t('enterprise.all_checks_passed'), icon: CheckCircle, bg: 'bg-success/10' },
    warning: { color: 'warning' as const, label: t('enterprise.some_warnings_detected'), icon: AlertTriangle, bg: 'bg-warning/10' },
    fail: { color: 'danger' as const, label: t('enterprise.critical_issues_found'), icon: XCircle, bg: 'bg-danger/10' },
  };

  const filteredExtensions = data?.extensions.filter((ext) =>
    !extSearch || ext.name.toLowerCase().includes(extSearch.toLowerCase())
  ) ?? [];

  const loadedCount = data?.extensions.filter((ext) => ext.loaded).length ?? 0;
  const requiredCount = data?.extensions.filter((ext) => ext.required).length ?? 0;

  const iniEntries = data?.ini_settings ? Object.entries(data.ini_settings) : [];

  const iniLabels: Record<string, string> = {
    memory_limit: t('enterprise.ini_memory_limit'),
    max_execution_time: t('enterprise.ini_max_execution_time'),
    max_input_time: t('enterprise.ini_max_input_time'),
    max_input_vars: t('enterprise.ini_max_input_vars'),
    upload_max_filesize: t('enterprise.ini_upload_max_filesize'),
    post_max_size: t('enterprise.ini_post_max_size'),
  };

  return (
    <div>
      <PageHeader
        title={t('enterprise.system_requirements_title')}
        description={t('enterprise.system_requirements_desc')}
        actions={
          <Button
            variant="tertiary"
            startContent={<RefreshCw size={16} />}
            onPress={loadData}
            isLoading={loading}
            size="sm"
          >
            {t('common.refresh')}
          </Button>
        }
      />

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* Overall Status Banner */}
          <Card >
            <CardBody className={`flex flex-row items-center gap-4 p-6 ${statusConfig[status].bg}`}>
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/80 dark:bg-surface-secondary">
                {(() => {
                  const StatusIcon = statusConfig[status].icon;
                  return <StatusIcon size={28} className={STATUS_TEXT[statusConfig[status].color]} />;
                })()}
              </div>
              <div>
                <h3 className="text-lg font-bold text-foreground">{t('enterprise.overall_status')}</h3>
                <Chip size="sm" variant="soft" color={statusConfig[status].color} className="mt-1">
                  {statusConfig[status].label}
                </Chip>
              </div>
            </CardBody>
          </Card>

          {/* PHP Version */}
          <Card >
            <CardHeader className="flex items-center gap-2 px-6 pt-5 pb-0">
              <Code size={18} className="text-accent" />
              <h3 className="text-base font-semibold">{t('enterprise.php_version')}</h3>
            </CardHeader>
            <CardBody className="px-6 pb-5">
              <div className="flex items-center gap-4">
                <span className="text-3xl font-bold font-mono text-foreground">{data.php.version}</span>
                <Chip
                  size="sm"
                  variant="soft"
                  color={data.php.meets_minimum ? 'success' : 'danger'}
                  startContent={data.php.meets_minimum ? <CheckCircle size={12} /> : <XCircle size={12} />}
                >
                  {data.php.meets_minimum ? t('enterprise.meets_minimum_version') : t('enterprise.below_minimum_version')}
                </Chip>
              </div>
            </CardBody>
          </Card>

          {/* PHP Extensions */}
          <Card >
            <CardHeader className="flex items-center justify-between px-6 pt-5 pb-0">
              <div className="flex items-center gap-2">
                <Puzzle size={18} className="text-accent" />
                <h3 className="text-base font-semibold">{t('enterprise.php_extensions')}</h3>
                <Chip size="sm" variant="soft">
                  {t('enterprise.extensions_summary', { loaded: loadedCount, total: data.extensions.length, required: requiredCount })}
                </Chip>
              </div>
              <Input type="search" name="admin-search" autoComplete="off"
                placeholder={t('enterprise.search_extensions_placeholder')}
                aria-label={t('enterprise.search_extensions_placeholder')}
                startContent={<Search size={14} className="text-muted" />}
                value={extSearch}
                onValueChange={setExtSearch}
                variant="secondary"
                size="sm"
                className="w-48"
              />
            </CardHeader>
            <CardBody className="px-6 pb-5">
              <div className="flex flex-wrap gap-2">
                {filteredExtensions.map((ext) => {
                  let color: 'success' | 'danger' | 'warning' = 'success';
                  if (!ext.loaded && ext.required) color = 'danger';
                  else if (!ext.loaded && !ext.required) color = 'warning';

                  return (
                    <Chip
                      key={ext.name}
                      size="sm"
                      variant="soft"
                      color={color}
                      startContent={ext.loaded ? <CheckCircle size={12} /> : <XCircle size={12} />}
                      className={ext.required ? 'font-bold' : ''}
                    >
                      {ext.name}
                    </Chip>
                  );
                })}
              </div>
            </CardBody>
          </Card>

          {/* Writable Directories */}
          <Card >
            <CardHeader className="flex items-center gap-2 px-6 pt-5 pb-0">
              <FolderOpen size={18} className="text-warning" />
              <h3 className="text-base font-semibold">{t('enterprise.writable_directories')}</h3>
            </CardHeader>
            <CardBody className="px-6 pb-5">
              <div className="space-y-2">
                {data.writable_directories.map((dir) => (
                  <div key={dir.path} className="flex items-center gap-3">
                    {dir.writable ? (
                      <CheckCircle size={16} className="text-success shrink-0" />
                    ) : (
                      <XCircle size={16} className="text-danger shrink-0" />
                    )}
                    <span className="font-mono text-sm text-foreground">{dir.path}</span>
                    <Chip size="sm" variant="soft" color={dir.writable ? 'success' : 'danger'}>
                      {dir.writable ? t('enterprise.writable_status') : t('enterprise.not_writable_status')}
                    </Chip>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* Services */}
          <Card >
            <CardHeader className="flex items-center gap-2 px-6 pt-5 pb-0">
              <Server size={18} className="text-success" />
              <h3 className="text-base font-semibold">{t('enterprise.services')}</h3>
            </CardHeader>
            <CardBody className="px-6 pb-5">
              <div className="flex gap-4">
                {data.services.map((svc) => (
                  <div key={svc.name} className="flex items-center gap-2">
                    {svc.status === 'ok' ? (
                      <CheckCircle size={16} className="text-success" />
                    ) : (
                      <XCircle size={16} className="text-danger" />
                    )}
                    <span className="text-sm font-medium text-foreground">{svc.name}</span>
                    <Chip size="sm" variant="soft" color={svc.status === 'ok' ? 'success' : 'danger'}>
                      {svc.status === 'ok' ? t('enterprise.status_ok') : t('enterprise.status_fail')}
                    </Chip>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* INI Settings */}
          {iniEntries.length > 0 && (
            <Card >
              <CardHeader className="flex items-center gap-2 px-6 pt-5 pb-0">
                <Settings size={18} className="text-muted" />
                <h3 className="text-base font-semibold">{t('enterprise.ini_settings')}</h3>
              </CardHeader>
              <CardBody className="px-6 pb-5">
                <div className="divide-y divide-divider">
                  {iniEntries.map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between py-2">
                      <span className="text-sm text-muted">{iniLabels[key] ?? key}</span>
                      <span className="font-mono text-sm text-foreground">{value}</span>
                    </div>
                  ))}
                </div>
                <Separator className="my-0" />
              </CardBody>
            </Card>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default SystemRequirements;
