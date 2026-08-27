import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui/Table';
import { Textarea } from '@/components/ui/Textarea';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VereinMembersImportPage — AG30
 *
 * Verein admin uploads a CSV (email, first_name, last_name, phone, role)
 * and gets a row-level preview before confirming the import.
 *
 * API:
 *   POST /api/v2/caring-community/vereine/{organizationId}/members/import/preview
 *   POST /api/v2/caring-community/vereine/{organizationId}/members/import
 *
 * Access is enforced server-side (verein_admin scoped to this organization).
 * If the caller does not have permission, the preview/import endpoint returns 403.
 */

import { ChangeEvent, useCallback, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { Separator } from '@/components/ui/Separator';
import Upload from 'lucide-react/icons/upload';
import FileText from 'lucide-react/icons/file-text';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { PageMeta } from '@/components/seo';
import { useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveUserDisplayName } from '@/lib/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface PreviewItem {
  row: number;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  role: string;
  action: 'create' | 'link_existing' | 'already_member' | 'invalid' | string;
  existing_user_id: number | null;
  errors: string[];
}

interface PreviewSummary {
  total_rows: number;
  ready_to_create: number;
  ready_to_link: number;
  duplicates: number;
  invalid: number;
}

interface PreviewResponse {
  organization: { id: number; name: string; org_type: string };
  summary: PreviewSummary;
  items: PreviewItem[];
}

interface ImportResultMember {
  user_id: number;
  email: string;
  created: boolean;
  temporary_password: string | null;
}

interface ImportResponse {
  organization: { id: number; name: string };
  created: number;
  linked: number;
  skipped: number;
  members: ImportResultMember[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export default function VereinMembersImportPage() {
  const { id } = useParams<{ id: string }>();
  const orgId = parseInt(id ?? '0', 10);
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  const toast = useToast();
  usePageTitle(t('verein_import.title'));

  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);

  const handleFile = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ''));
    reader.onerror = () => toast.error(t('verein_import.errors.read_failed'));
    reader.readAsText(file);
  }, [toast, t]);

  const runPreview = useCallback(async () => {
    if (!csv.trim()) {
      toast.error(t('verein_import.errors.empty_csv'));
      return;
    }
    setLoadingPreview(true);
    setImportResult(null);
    try {
      const res = await api.post<PreviewResponse>(
        `/v2/caring-community/vereine/${orgId}/members/import/preview`,
        { csv },
      );
      if (res.success && res.data) {
        setPreview(res.data);
      } else {
        toast.error(res.error || t('verein_import.errors.preview_failed'));
        setPreview(null);
      }
    } catch (err) {
      logError('VereinMembersImportPage: preview failed', err);
      toast.error(t('verein_import.errors.preview_failed'));
    } finally {
      setLoadingPreview(false);
    }
  }, [csv, orgId, toast, t]);

  const runImport = useCallback(async () => {
    if (!preview) return;
    if (preview.summary.invalid > 0) {
      toast.error(t('verein_import.errors.has_invalid'));
      return;
    }
    setImporting(true);
    try {
      const res = await api.post<ImportResponse>(
        `/v2/caring-community/vereine/${orgId}/members/import`,
        { csv },
      );
      if (res.success && res.data) {
        setImportResult(res.data);
        toast.success(
          t('verein_import.success', {
            created: res.data.created,
            linked: res.data.linked,
          }),
        );
        setPreview(null);
      } else {
        toast.error(res.error || t('verein_import.errors.import_failed'));
      }
    } catch (err) {
      logError('VereinMembersImportPage: import failed', err);
      toast.error(t('verein_import.errors.import_failed'));
    } finally {
      setImporting(false);
    }
  }, [csv, orgId, preview, toast, t]);

  const actionChip = (action: string) => {
    if (action === 'create') return <Chip size="sm" color="success" variant="flat">{t('verein_import.actions.create')}</Chip>;
    if (action === 'link_existing') return <Chip size="sm" color="primary" variant="flat">{t('verein_import.actions.link')}</Chip>;
    if (action === 'already_member') return <Chip size="sm" color="warning" variant="flat">{t('verein_import.actions.already')}</Chip>;
    return <Chip size="sm" color="danger" variant="flat">{t('verein_import.actions.invalid')}</Chip>;
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <PageMeta
        title={t('verein_import.title')}
        description={t('verein_import.subtitle')}
        noIndex
      />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-bold text-foreground">{t('verein_import.title')}</h1>
          <p className="mt-2 text-sm leading-6 text-foreground/70">
            {t('verein_import.subtitle')}
          </p>
        </div>
        <Button
          as={Link}
          to={tenantPath('/clubs')}
          size="sm"
          variant="flat"
          className="self-start"
          startContent={<ArrowLeft className="w-4 h-4" aria-hidden="true" />}
        >
          {t('back')}
        </Button>
      </div>

      {/* Step 1: upload */}
      <Card className="border border-border shadow-sm">
        <CardHeader className="flex items-center gap-2">
          <Upload className="w-5 h-5 text-accent" aria-hidden="true" />
          <h2 className="text-base font-semibold">
            {t('verein_import.step1')}
          </h2>
        </CardHeader>
        <Separator />
        <CardBody className="space-y-4">
          <p className="rounded-md border border-border bg-surface-secondary px-3 py-2 text-sm text-foreground/70">
            {t('verein_import.csv_format')}
          </p>
          <Input
            type="file"
            accept=".csv,text/csv"
            onChange={handleFile}
            label={t('verein_import.file_label')}
          />
          <Textarea
            label={t('verein_import.csv_label')}
            value={csv}
            onValueChange={setCsv}
            minRows={4}
            maxRows={10}
            classNames={{ input: 'font-mono text-sm' }}
            placeholder={t('verein_import.csv_placeholder')}
          />
          <div className="flex justify-end">
            <Button
              color="primary"
              startContent={<FileText className="w-4 h-4" aria-hidden="true" />}
              onPress={() => void runPreview()}
              isLoading={loadingPreview}
            >
              {t('verein_import.preview')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Step 2: preview */}
      {loadingPreview && (
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex items-center justify-center py-8">
          <Spinner size="lg" />
        </div>
      )}

      {preview && (
        <Card className="border border-border shadow-sm">
          <CardHeader className="flex items-center gap-2 flex-wrap">
            <FileText className="w-5 h-5 text-accent" aria-hidden="true" />
            <h2 className="text-base font-semibold">
              {t('verein_import.step2')}
            </h2>
            <span className="text-sm text-muted ml-2">{preview.organization.name}</span>
          </CardHeader>
          <Separator />
          <CardBody className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div className="rounded-lg border border-border bg-surface-secondary p-3 text-center">
                <p className="text-xs uppercase text-muted">{t('verein_import.summary.total')}</p>
                <p className="text-2xl font-bold">{preview.summary.total_rows}</p>
              </div>
              <div className="rounded-lg border border-success-200 bg-success-50 p-3 text-center">
                <p className="text-xs uppercase text-success-700">{t('verein_import.summary.create')}</p>
                <p className="text-2xl font-bold text-success">{preview.summary.ready_to_create}</p>
              </div>
              <div className="rounded-lg border border-accent bg-accent-soft p-3 text-center">
                <p className="text-xs uppercase text-accent">{t('verein_import.summary.link')}</p>
                <p className="text-2xl font-bold text-accent">{preview.summary.ready_to_link}</p>
              </div>
              <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-center">
                <p className="text-xs uppercase text-warning-700">{t('verein_import.summary.duplicates')}</p>
                <p className="text-2xl font-bold text-warning">{preview.summary.duplicates}</p>
              </div>
              <div className="rounded-lg border border-danger-200 bg-danger-50 p-3 text-center">
                <p className="text-xs uppercase text-danger-700">{t('verein_import.summary.invalid')}</p>
                <p className="text-2xl font-bold text-danger">{preview.summary.invalid}</p>
              </div>
            </div>

            {preview.summary.invalid > 0 && (
              <div role="alert" className="flex items-center gap-2 p-3 bg-danger-50 border border-danger-200 rounded-lg text-sm text-danger-800">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>
                  {t('verein_import.errors.has_invalid_summary')}
                </span>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border">
              <Table
                aria-label={t('verein_import.row.table_aria')}
                removeWrapper
                isStriped
                className="min-w-[720px]"
              >
                <TableHeader>
                  <TableColumn>{t('verein_import.row.row')}</TableColumn>
                  <TableColumn>{t('verein_import.row.action')}</TableColumn>
                  <TableColumn>{t('verein_import.row.email')}</TableColumn>
                  <TableColumn className="hidden md:table-cell">{t('verein_import.row.name')}</TableColumn>
                  <TableColumn className="hidden md:table-cell">{t('verein_import.row.role')}</TableColumn>
                  <TableColumn>{t('verein_import.row.errors')}</TableColumn>
                </TableHeader>
                <TableBody>
                  {preview.items.map((row) => (
                    <TableRow key={row.row} className={row.errors.length ? 'bg-danger-50/40' : ''}>
                      <TableCell className="text-muted tabular-nums">{row.row}</TableCell>
                      <TableCell>{actionChip(row.action)}</TableCell>
                      <TableCell>{row.email || t('empty_dash')}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {resolveUserDisplayName(row) || t('empty_dash')}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">{row.role}</TableCell>
                      <TableCell className="text-danger-700">
                        {row.errors.length > 0 ? row.errors.join('; ') : ''}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="flat" onPress={() => setPreview(null)}>
                {t('cancel')}
              </Button>
              <Button
                color="primary"
                startContent={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
                onPress={() => void runImport()}
                isLoading={importing}
                isDisabled={preview.summary.invalid > 0}
              >
                {t('verein_import.confirm')}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Step 3: result */}
      {importResult && (
        <Card className="border border-border shadow-sm">
          <CardHeader className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-success" aria-hidden="true" />
            <h2 className="text-base font-semibold">
              {t('verein_import.result.title')}
            </h2>
          </CardHeader>
          <Separator />
          <CardBody className="space-y-3">
            <p className="text-sm">
              {t('verein_import.result.summary', {
                created: importResult.created,
                linked: importResult.linked,
                skipped: importResult.skipped,
              })}
            </p>
            {importResult.members.some((m) => m.temporary_password) && (
              <div className="p-3 bg-warning-50 border border-warning-200 rounded-lg text-sm space-y-2">
                <p className="font-medium">
                  {t('verein_import.result.passwords_title')}
                </p>
                <ul className="list-disc list-inside space-y-1 font-mono text-xs">
                  {importResult.members
                    .filter((m) => m.temporary_password)
                    .map((m) => (
                      <li key={m.user_id}>
                        {m.email} — <span className="select-all">{m.temporary_password}</span>
                      </li>
                    ))}
                </ul>
                <p className="text-xs text-warning-700">
                  {t('verein_import.result.passwords_warning')}
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
