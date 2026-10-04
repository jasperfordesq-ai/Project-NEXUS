import { getFormattingLocale } from '@/lib/helpers';
import { CardBody, Card, Button, Chip, Spinner, Input } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Log Files
 * Browse server log files with filtering and download.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import FileText from 'lucide-react/icons/file-text';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Clock from 'lucide-react/icons/clock';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Download from 'lucide-react/icons/download';
import Search from 'lucide-react/icons/search';
import HardDrive from 'lucide-react/icons/hard-drive';
import Files from 'lucide-react/icons/files';
import { usePageTitle } from '@/hooks';
import { useToast, useTenant } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { LogFile } from '../../api/types';

type FilterType = 'all' | 'errors' | 'application' | 'cron';

function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal')) return AlertTriangle;
  if (lower.includes('cron') || lower.includes('schedule')) return Clock;
  return FileText;
}

function getFileIconColor(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes('error') || lower.includes('fatal')) return 'text-danger';
  if (lower.includes('cron') || lower.includes('schedule')) return 'text-warning';
  return 'text-accent';
}

function matchesFilter(name: string, filter: FilterType): boolean {
  if (filter === 'all') return true;
  const lower = name.toLowerCase();
  if (filter === 'errors') return lower.includes('error') || lower.includes('fatal');
  if (filter === 'cron') return lower.includes('cron') || lower.includes('schedule');
  if (filter === 'application') return !lower.includes('error') && !lower.includes('fatal') && !lower.includes('cron') && !lower.includes('schedule');
  return true;
}

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export function LogFiles() {
  const { t } = useTranslation('admin_enterprise');
  usePageTitle(t('enterprise.page_title'));
  const toast = useToast();
  const { tenantPath } = useTenant();

  const [files, setFiles] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getLogFiles();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setFiles(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error(t('enterprise.failed_to_load_log_files'));
    } finally {
      setLoading(false);
    }
  }, [toast, t])


  useEffect(() => {
    loadData();
  }, [loadData]);

  const filtered = files.filter((f) => {
    if (search && !f.name.toLowerCase().includes(search.toLowerCase())) return false;
    return matchesFilter(f.name, filter);
  });

  const totalSize = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);

  const filters: { key: FilterType; label: string }[] = [
    { key: 'all', label: t('log_files_labels.filter_all') },
    { key: 'errors', label: t('log_files_labels.filter_errors') },
    { key: 'application', label: t('log_files_labels.filter_application') },
    { key: 'cron', label: t('log_files_labels.filter_cron') },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.log_files_title')}
        description={t('enterprise.log_files_desc')}
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

      {/* Stats Row */}
      <div className="flex gap-4 mb-6">
        <Card  className="flex-1">
          <CardBody className="flex flex-row items-center gap-3 p-4">
            <Files size={20} className="text-accent" />
            <div>
              <p className="text-xs text-muted">{t('log_files_labels.total_files')}</p>
              <p className="text-lg font-bold text-foreground">{files.length}</p>
            </div>
          </CardBody>
        </Card>
        <Card  className="flex-1">
          <CardBody className="flex flex-row items-center gap-3 p-4">
            <HardDrive size={20} className="text-warning" />
            <div>
              <p className="text-xs text-muted">{t('log_files_labels.total_size')}</p>
              <p className="text-lg font-bold text-foreground">{formatBytes(totalSize)}</p>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Input type="search" name="admin-search" autoComplete="off"
          placeholder={t('log_files_labels.search_placeholder')}
          aria-label={t('log_files_labels.search_placeholder')}
          startContent={<Search size={16} className="text-muted" />}
          value={search}
          onValueChange={setSearch}
          variant="secondary"
          size="sm"
          className="w-64"
        />
        <div className="flex gap-2">
          {filters.map((f) => (
            <Button
              key={f.key}
              size="sm"
              variant={filter === f.key ? 'solid' : 'flat'}
              color={filter === f.key ? 'primary' : 'default'}
              onPress={() => setFilter(f.key)}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-16">
          <Spinner size="lg" />
        </div>
      ) : filtered.length === 0 ? (
        <Card >
          <CardBody className="py-16 text-center">
            <p className="text-muted">{t('enterprise.no_log_files')}</p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((file) => {
            const Icon = getFileIcon(file.name);
            const iconColor = getFileIconColor(file.name);

            return (
              <Card key={file.name}  isPressable as={Link} to={tenantPath(`/admin/enterprise/monitoring/log-files/${file.name}`)}>
                <CardBody className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-secondary">
                      <Icon size={20} className={iconColor} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-bold text-foreground truncate">
                        {file.name}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <Chip size="sm" variant="soft">
                          {file.size}
                        </Chip>
                        <span className="text-xs text-muted">
                          {t('log_files_labels.lines_count', { count: file.line_count })}
                        </span>
                      </div>
                      <p className="text-xs text-muted mt-1">
                        {new Date(file.modified_at).toLocaleString(getFormattingLocale())}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="tertiary"
                      isIconOnly
                      aria-label={t('log_files_labels.download')}
                      onPress={() => {
                        adminEnterprise.downloadLogFile(file.name).catch(() => {
                          toast.error(t('common:errors.download_failed'));
                        });
                      }}
                    >
                      <Download size={14} />
                    </Button>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LogFiles;
