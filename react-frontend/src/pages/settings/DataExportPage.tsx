// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from '@/lib/motion';

import Download from 'lucide-react/icons/download';
import ShieldCheck from 'lucide-react/icons/shield-check';
import History from 'lucide-react/icons/history';
import AlertTriangle from 'lucide-react/icons/alert-triangle';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { RadioGroup, Radio } from '@/components/ui/Radio';
import { Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui/Table';
import { PageMeta } from '@/components/seo';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api, tokenManager, API_BASE } from '@/lib/api';
import { logError } from '@/lib/logger';

type ExportFormat = 'json' | 'zip';

interface ExportHistoryRow {
  id: number;
  format: string;
  requested_at: string | null;
  completed_at: string | null;
  file_size_bytes: number | null;
}

interface HistoryResponse {
  exports: ExportHistoryRow[];
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString(getFormattingLocale());
  } catch {
    return value;
  }
}

export function DataExportPage(): ReactNode {
  const { t } = useTranslation('common');
  usePageTitle(t('data_export.meta.title'));
  const toast = useToast();

  const [format, setFormat] = useState<ExportFormat>('json');
  const [isDownloading, setIsDownloading] = useState(false);
  const [history, setHistory] = useState<ExportHistoryRow[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    try {
      setIsLoadingHistory(true);
      const response = await api.get<HistoryResponse>('/v2/me/data-export/history');
      if (response.success && response.data?.exports) {
        setHistory(response.data.exports);
      }
    } catch (err) {
      logError('Failed to load export history', err);
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      // Use raw fetch (api.download is GET-only); we need POST with auth + tenant.
      const apiBase = API_BASE;
      const tenantId = tokenManager.getTenantId();
      const accessToken = tokenManager.getAccessToken();

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json, application/zip, application/octet-stream',
      };
      if (tenantId) headers['X-Tenant-ID'] = String(tenantId);
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const response = await fetch(`${apiBase}/v2/me/data-export`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify({ format }),
      });

      if (response.status === 429) {
        toast.error(t('data_export.errors.rate_limit'));
        return;
      }
      if (!response.ok) {
        toast.error(t('data_export.errors.build_failed'));
        return;
      }

      const blob = await response.blob();

      // Resolve filename from Content-Disposition or fall back to a sensible default
      let filename = format === 'zip' ? 'personal-data.zip' : 'personal-data.json';
      const disposition = response.headers.get('Content-Disposition');
      if (disposition) {
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match?.[1]) {
          filename = match[1].replace(/['"]/g, '').trim();
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      // Refresh history so the new row appears
      void loadHistory();
    } catch (err) {
      logError('Failed to download data export', err);
      toast.error(t('data_export.errors.build_failed'));
    } finally {
      setIsDownloading(false);
    }
  }, [format, t, toast, loadHistory]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto max-w-5xl space-y-6 p-4"
    >
      <PageMeta title={t('data_export.meta.title')} noIndex />

      {/* Hero */}
      <header className="overflow-hidden rounded-2xl border border-theme-default bg-theme-surface">
        <div className="flex flex-col gap-5 p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex max-w-2xl items-start gap-4">
            <div className="rounded-2xl bg-accent/15 p-3">
              <ShieldCheck className="h-7 w-7 text-accent" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <Chip size="sm" variant="soft" color="accent" className="font-medium">
                {t('data_export.format.label')}
              </Chip>
              <h1 className="text-3xl font-bold leading-tight text-theme-primary sm:text-4xl">{t('data_export.title')}</h1>
              <p className="text-sm leading-6 text-theme-muted sm:text-base">{t('data_export.subtitle')}</p>
              <p className="text-sm leading-6 text-theme-muted">{t('data_export.intro')}</p>
            </div>
          </div>
          <div className="rounded-xl border border-theme-default bg-theme-elevated px-4 py-3 lg:min-w-72">
            <span className="block text-xs font-medium uppercase tracking-wide text-theme-subtle">{t('data_export.history.title')}</span>
            <span className="mt-1 block font-semibold text-theme-primary">
              {isLoadingHistory ? t('data_export.downloading') : t('data_export.history.count', { count: history.length })}
            </span>
          </div>
        </div>
      </header>

      {/* Format + download */}
      <GlassCard className="space-y-6 p-5 sm:p-6">
        <RadioGroup
          label={t('data_export.format.label')}
          value={format}
          onValueChange={(v) => setFormat(v as ExportFormat)}
        >
          <Radio value="json" description={t('data_export.format.json_help')}>
            {t('data_export.format.json')}
          </Radio>
          <Radio value="zip" description={t('data_export.format.zip_help')}>
            {t('data_export.format.zip')}
          </Radio>
        </RadioGroup>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2 text-sm text-theme-muted">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-500 flex-shrink-0" aria-hidden="true" />
            <span>{t('data_export.warning')}</span>
          </div>
          <Button
            size="lg"
            onPress={handleDownload}
            isLoading={isDownloading}
            startContent={!isDownloading ? <Download className="w-4 h-4" aria-hidden="true" /> : null}
            className="w-full bg-gradient-to-r from-accent-strong to-accent-strong-end text-white sm:w-auto"
          >
            {isDownloading ? t('data_export.downloading') : t('data_export.download_button')}
          </Button>
        </div>
      </GlassCard>

      {/* History */}
      <GlassCard className="p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <History className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-theme-primary">{t('data_export.history.title')}</h2>
        </div>

        {isLoadingHistory ? (
          <p className="text-theme-muted text-sm">{t('data_export.downloading')}</p>
        ) : history.length === 0 ? (
          <p className="text-theme-muted text-sm">{t('data_export.history.empty')}</p>
        ) : (
          <div className="responsive-table-wrap">
            <Table aria-label={t('data_export.history.title')} mobileCards removeWrapper classNames={{ table: 'min-w-max' }}>
              <TableHeader>
                <TableColumn>{t('data_export.history.date')}</TableColumn>
                <TableColumn>{t('data_export.history.format')}</TableColumn>
                <TableColumn>{t('data_export.history.size')}</TableColumn>
              </TableHeader>
              <TableBody>
                {history.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDate(row.requested_at)}</TableCell>
                    <TableCell className="uppercase whitespace-nowrap">{row.format}</TableCell>
                    <TableCell className="whitespace-nowrap">{formatBytes(row.file_size_bytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </GlassCard>
    </motion.div>
  );
}

export default DataExportPage;
