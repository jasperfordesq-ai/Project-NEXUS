import { CardBody, Card, Button, Chip, Spinner, Input, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Category Substitution Coefficients Admin Page
 *
 * Per-category coefficients used by the Pflege-CHF computation: each
 * category has a multiplier (0.00 – 9.99) representing how much one hour
 * of that activity substitutes for one hour of formal Spitex/Pflege care.
 *
 * Backed by the `substitution_coefficient` column on the `categories` table.
 */

import { useCallback, useEffect, useState } from 'react';

import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Info from 'lucide-react/icons/info';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Save from 'lucide-react/icons/save';
import Sliders from 'lucide-react/icons/sliders';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { Abbr } from '../../components/Abbr';
import { PageHeader } from '../../components/PageHeader';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CategoryCoefficient {
  id: number;
  name: string;
  substitution_coefficient: number;
  source_table: string;
}

interface ListResponse {
  categories: CategoryCoefficient[];
  migration_pending: boolean;
}

interface UpdateResponse {
  id: number;
  substitution_coefficient: number;
  source_table: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COEFFICIENT_MIN = 0;
const COEFFICIENT_MAX = 9.99;

function clampCoefficient(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < COEFFICIENT_MIN) return COEFFICIENT_MIN;
  if (value > COEFFICIENT_MAX) return COEFFICIENT_MAX;
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function CategoryCoefficientsAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('category_coefficients.meta.page_title'));
  const { showToast } = useToast();

  const [rows, setRows] = useState<CategoryCoefficient[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrationPending, setMigrationPending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<ListResponse>(
        '/v2/admin/caring-community/category-coefficients',
      );
      const payload = res.data;
      const list = payload?.categories ?? [];
      setRows(list);
      setMigrationPending(payload?.migration_pending === true);

      // Reset drafts to current saved values.
      const next: Record<number, string> = {};
      for (const r of list) {
        next[r.id] = r.substitution_coefficient.toFixed(2);
      }
      setDrafts(next);
    } catch {
      showToast(t('category_coefficients.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDraftChange = (id: number, value: string) => {
    setDrafts((prev) => ({ ...prev, [id]: value }));
  };

  const handleSave = async (row: CategoryCoefficient) => {
    const draft = drafts[row.id] ?? '';
    const parsed = Number.parseFloat(draft);
    if (Number.isNaN(parsed)) {
      showToast(t('category_coefficients.toasts.invalid_number'), 'error');
      return;
    }
    const value = clampCoefficient(parsed);

    setSavingId(row.id);
    try {
      const res = await api.put<UpdateResponse>(
        `/v2/admin/caring-community/category-coefficients/${row.id}`,
        {
          substitution_coefficient: value,
          source_table: row.source_table,
        },
      );
      const updated = res.data;
      const newCoeff = updated?.substitution_coefficient ?? value;

      setRows((prev) =>
        prev.map((r) =>
          r.id === row.id ? { ...r, substitution_coefficient: newCoeff } : r,
        ),
      );
      setDrafts((prev) => ({ ...prev, [row.id]: newCoeff.toFixed(2) }));
      showToast(t('category_coefficients.toasts.saved', { name: row.name }), 'success');
    } catch {
      showToast(t('category_coefficients.toasts.save_failed', { name: row.name }), 'error');
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('category_coefficients.meta.title')}
        subtitle={t('category_coefficients.meta.subtitle')}
        icon={<Sliders size={20} />}
        actions={
          <Button
            isIconOnly
            size="sm"
            variant="tertiary"
            onPress={load}
            isLoading={loading}
            aria-label={t('category_coefficients.actions.refresh_aria')}
          >
            <RefreshCw size={15} />
          </Button>
        }
      />

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft" >
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('category_coefficients.about.title')}</p>
              <p className="text-muted">
                {t('category_coefficients.about.body_prefix')}{' '}
                <Abbr term="CHF">{t('category_coefficients.about.chf_amount')}</Abbr>
                {t('category_coefficients.about.body_middle')}{' '}
                {t('common:nav.caring_community')} {t('category_coefficients.about.body_suffix')}
              </p>
              <p className="text-muted">
                {t('category_coefficients.about.range_prefix')} <Abbr term="ROI" /> {t('category_coefficients.about.range_suffix')}
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Migration pending warning */}
      {migrationPending && (
        <Card className="border border-warning/30 bg-warning/10">
          <CardBody className="flex flex-row items-start gap-3 py-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning-soft-foreground" />
            <div className="text-sm text-warning-soft-foreground">
              <p className="font-semibold">{t('category_coefficients.migration.title')}</p>
              <p className="mt-1">
                {t('category_coefficients.migration.body_prefix')}{' '}
                {/* eslint-disable-next-line i18next/no-literal-string -- Database column name must remain verbatim. */}
                <code className="rounded bg-warning/10 px-1">substitution_coefficient</code>{' '}
                {t('category_coefficients.migration.body_middle')}{' '}
                {/* eslint-disable-next-line i18next/no-literal-string -- CLI command must remain verbatim. */}
                <code className="rounded bg-warning/10 px-1">
                  docker exec nexus-php-app php artisan migrate
                </code>{' '}
                {t('category_coefficients.migration.body_suffix')}
              </p>
              <p className="mt-1">
                {t('category_coefficients.migration.warning')}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center py-16">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" /></div>
        </div>
      )}

      {/* Table */}
      {!loading && !migrationPending && (
        <Card>
          <CardBody className="p-0">
            <Table aria-label={t('category_coefficients.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('category_coefficients.table.category')}</TableColumn>
                <TableColumn>{t('category_coefficients.table.source')}</TableColumn>
                <TableColumn>{t('category_coefficients.table.coefficient')}</TableColumn>
                <TableColumn align="end">{t('category_coefficients.table.action')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('category_coefficients.empty.categories')}>
                {rows.map((row) => {
                  const draft = drafts[row.id] ?? row.substitution_coefficient.toFixed(2);
                  const isSaving = savingId === row.id;
                  const dirty = Number.parseFloat(draft) !== row.substitution_coefficient;
                  return (
                    <TableRow key={`${row.source_table}-${row.id}`}>
                      <TableCell>
                        <span className="font-medium">{row.name}</span>
                      </TableCell>
                      <TableCell>
                        <Chip size="sm" variant="soft">
                          {row.source_table}
                        </Chip>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          size="sm"
                          step="0.05"
                          min={COEFFICIENT_MIN}
                          max={COEFFICIENT_MAX}
                          value={draft}
                          onValueChange={(v) => handleDraftChange(row.id, v)}
                          aria-label={t('category_coefficients.fields.coefficient_aria', { name: row.name })}
                          className="max-w-[140px]"
                          isInvalid={Number.parseFloat(draft) < COEFFICIENT_MIN || Number.parseFloat(draft) > COEFFICIENT_MAX}
                          errorMessage={t('category_coefficients.fields.coefficient_error')}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant={dirty ? 'solid' : 'flat'}
                          startContent={!isSaving && <Save size={14} />}
                          onPress={() => handleSave(row)}
                          isLoading={isSaving}
                          isDisabled={!dirty || isSaving}
                        >
                          {t('category_coefficients.actions.save')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
