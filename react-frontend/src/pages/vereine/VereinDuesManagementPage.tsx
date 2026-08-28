import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Receipt from 'lucide-react/icons/receipt';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Bell from 'lucide-react/icons/bell';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import { PageMeta } from '@/components/seo/PageMeta';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * VereinDuesManagementPage — AG54
 *
 * Verein-admin (or tenant admin) page to:
 *   - Configure the membership fee
 *   - Generate annual dues for the current year
 *   - View members table with status filter
 *   - Send reminders + waive dues per row
 *   - Bulk send reminders for overdue
 *
 * Access: server-enforced via VereinDuesAdminController::guard()
 *   (tenant admin OR scoped verein_admin role for THIS organization)
 */


interface FeeConfig {
  id: number;
  fee_amount_cents: number;
  currency: string;
  billing_cycle: 'annual' | 'biennial' | 'monthly' | string;
  grace_period_days: number;
  late_fee_cents: number | null;
  is_active: boolean;
}

interface DuesRow {
  id: number;
  user_id: number;
  membership_year: number;
  amount_cents: number;
  currency: string;
  status: string;
  due_date: string | null;
  paid_at: string | null;
  reminder_count: number;
  last_reminder_at: string | null;
  generated_email_sent_at: string | null;
  generated_email_failed_at: string | null;
  paid_email_sent_at: string | null;
  paid_email_failed_at: string | null;
  reminder_email_failed_at: string | null;
  reminder_email_last_error: string | null;
  waived_reason: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface ListResponse {
  items: DuesRow[];
  total: number;
  page: number;
  per_page: number;
  year: number;
}

function statusColor(status: string): 'success' | 'warning' | 'danger' | 'default' {
  if (status === 'paid' || status === 'waived') return 'success';
  if (status === 'pending') return 'warning';
  if (status === 'overdue') return 'danger';
  return 'default';
}

function emailStatusColor(row: DuesRow): 'success' | 'warning' | 'danger' | 'default' {
  if (row.reminder_email_failed_at || row.generated_email_failed_at || row.paid_email_failed_at) return 'danger';
  if (row.generated_email_sent_at || row.paid_email_sent_at || row.last_reminder_at) return 'success';
  return 'default';
}

export function VereinDuesManagementPage() {
  const { id: idParam } = useParams<{ id: string }>();
  const organizationId = Number(idParam);
  const { t } = useTranslation('common');
  usePageTitle(t('verein_dues.admin_page_title'));
  const toast = useToast();

  // Fee config
  const [, setConfig] = useState<FeeConfig | null>(null);
  const [feeAmount, setFeeAmount] = useState<string>('');
  const [currency, setCurrency] = useState<string>('CHF');
  const [billingCycle, setBillingCycle] = useState<string>('annual');
  const [gracePeriod, setGracePeriod] = useState<string>('30');
  const [lateFee, setLateFee] = useState<string>('');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState(false);

  // Members table
  const [rows, setRows] = useState<DuesRow[]>([]);
  const [year, setYear] = useState<number>(() => new Date().getFullYear());
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [overdueCount, setOverdueCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  // Waive modal
  const [waiveDuesId, setWaiveDuesId] = useState<number | null>(null);
  const [waiveReason, setWaiveReason] = useState<string>('');

  const loadConfig = useCallback(async () => {
    try {
      const res = await api.get<{ fee_config: FeeConfig | null }>(`/v2/vereine/${organizationId}/dues/fee-config`);
      if (res.success && res.data?.fee_config) {
        const c = res.data.fee_config;
        setConfig(c);
        setFeeAmount(String(c.fee_amount_cents / 100));
        setCurrency(c.currency || 'CHF');
        setBillingCycle(c.billing_cycle || 'annual');
        setGracePeriod(String(c.grace_period_days ?? 30));
        setLateFee(c.late_fee_cents != null ? String(c.late_fee_cents / 100) : '');
        setIsActive(Boolean(c.is_active));
      }
    } catch (err) {
      logError('VereinDuesManagementPage loadConfig', err);
    }
  }, [organizationId]);

  const loadDues = useCallback(async () => {
    try {
      setIsLoading(true);
      const params = new URLSearchParams();
      params.set('year', String(year));
      if (statusFilter) params.set('status', statusFilter);
      const res = await api.get<ListResponse>(`/v2/vereine/${organizationId}/dues?${params}`);
      if (res.success && res.data) {
        setRows(Array.isArray(res.data.items) ? res.data.items : []);
      }
      // overdue count
      const ov = await api.get<{ items: DuesRow[] }>(`/v2/vereine/${organizationId}/dues/overdue`);
      if (ov.success && ov.data) setOverdueCount(ov.data.items?.length ?? 0);
    } catch (err) {
      logError('VereinDuesManagementPage loadDues', err);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, year, statusFilter]);

  useEffect(() => { void loadConfig(); }, [loadConfig]);
  useEffect(() => { void loadDues(); }, [loadDues]);

  const filteredRows = useMemo(() => {
    if (!searchTerm.trim()) return rows;
    const q = searchTerm.toLowerCase();
    return rows.filter((r) => {
      const name = resolveUserDisplayName(r).toLowerCase();
      return name.includes(q) || (r.email ?? '').toLowerCase().includes(q);
    });
  }, [rows, searchTerm]);

  const onSaveConfig = useCallback(async () => {
    try {
      setIsSaving(true);
      const cents = Math.round(Number(feeAmount) * 100);
      const lateCents = lateFee !== '' ? Math.round(Number(lateFee) * 100) : null;
      const payload = {
        fee_amount_cents: cents,
        currency,
        billing_cycle: billingCycle,
        grace_period_days: Number(gracePeriod),
        late_fee_cents: lateCents,
        is_active: isActive,
      };
      const res = await api.put<{ fee_config: FeeConfig }>(`/v2/vereine/${organizationId}/dues/fee-config`, payload);
      if (res.success) {
        toast.success(t('verein_dues.admin_config_saved'));
        void loadConfig();
      } else {
        toast.error(res.error || t('verein_dues.errors.save_failed'));
      }
    } catch (err) {
      logError('VereinDuesManagementPage save', err);
      toast.error(t('verein_dues.errors.save_failed'));
    } finally {
      setIsSaving(false);
    }
  }, [organizationId, feeAmount, currency, billingCycle, gracePeriod, lateFee, isActive, toast, t, loadConfig]);

  const onGenerate = useCallback(async () => {
    try {
      const res = await api.post<{ generated: number; skipped: number; year: number }>(
        `/v2/vereine/${organizationId}/dues/generate`,
        { year }
      );
      if (res.success && res.data) {
        toast.success(
          t('verein_dues.admin_generated', {
            generated: res.data.generated,
            skipped: res.data.skipped,
          })
        );
        void loadDues();
      } else {
        toast.error(res.error || t('verein_dues.errors.generate_failed'));
      }
    } catch (err) {
      logError('VereinDuesManagementPage generate', err);
      toast.error(t('verein_dues.errors.generate_failed'));
    }
  }, [organizationId, year, toast, t, loadDues]);

  const onSendReminder = useCallback(async (duesId: number) => {
    try {
      const res = await api.post<{ sent: boolean }>(`/v2/vereine/${organizationId}/dues/${duesId}/remind`, {});
      if (res.success) {
        toast.success(t('verein_dues.admin_reminder_sent'));
        void loadDues();
      } else {
        toast.error(res.error || t('verein_dues.errors.reminder_failed'));
      }
    } catch (err) {
      logError('VereinDuesManagementPage reminder', err);
      toast.error(t('verein_dues.errors.reminder_failed'));
    }
  }, [organizationId, toast, t, loadDues]);

  const onBulkRemind = useCallback(async () => {
    try {
      const ov = await api.get<{ items: DuesRow[] }>(`/v2/vereine/${organizationId}/dues/overdue`);
      if (!ov.success || !ov.data) return;
      let sent = 0;
      for (const row of ov.data.items) {
        try {
          await api.post(`/v2/vereine/${organizationId}/dues/${row.id}/remind`, {});
          sent++;
        } catch { /* per-row best-effort */ }
      }
      toast.success(t('verein_dues.admin_bulk_reminder_sent', { count: sent }));
      void loadDues();
    } catch (err) {
      logError('VereinDuesManagementPage bulk reminder', err);
    }
  }, [organizationId, toast, t, loadDues]);

  const onConfirmWaive = useCallback(async () => {
    if (waiveDuesId === null || !waiveReason.trim()) return;
    try {
      const res = await api.post<{ status: string }>(`/v2/vereine/${organizationId}/dues/${waiveDuesId}/waive`, { reason: waiveReason });
      if (res.success) {
        toast.success(t('verein_dues.admin_waived'));
        setWaiveDuesId(null);
        setWaiveReason('');
        void loadDues();
      } else {
        toast.error(res.error || t('verein_dues.errors.waive_failed'));
      }
    } catch (err) {
      logError('VereinDuesManagementPage waive', err);
      toast.error(t('verein_dues.errors.waive_failed'));
    }
  }, [organizationId, waiveDuesId, waiveReason, toast, t, loadDues]);

  return (
    <>
      <PageMeta title={t('verein_dues.admin_page_title')} noIndex />
      <div className="container max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Receipt className="w-7 h-7 text-accent" aria-hidden="true" />
        <h1 className="text-2xl md:text-3xl font-bold text-foreground">
          {t('verein_dues.admin_heading')}
        </h1>
      </div>

      {/* Fee configuration */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-semibold">{t('verein_dues.admin_fee_config')}</h2>
          <Switch isSelected={isActive} onValueChange={setIsActive}>
            {t('verein_dues.admin_active')}
          </Switch>
        </CardHeader>
        <CardBody className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={t('verein_dues.admin_fee_amount')}
            type="number"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            startContent={<span className="text-muted">{currency}</span>}
          />
          <Select
            label={t('verein_dues.admin_currency')}
            selectedKeys={[currency]}
            onChange={(e) => setCurrency(e.target.value || 'CHF')}
          >
            <SelectItem key="CHF" id="CHF">CHF</SelectItem>
            <SelectItem key="EUR" id="EUR">EUR</SelectItem>
            <SelectItem key="USD" id="USD">USD</SelectItem>
            <SelectItem key="GBP" id="GBP">GBP</SelectItem>
          </Select>
          <Select
            label={t('verein_dues.admin_billing_cycle')}
            selectedKeys={[billingCycle]}
            onChange={(e) => setBillingCycle(e.target.value || 'annual')}
          >
            <SelectItem key="annual" id="annual">{t('verein_dues.cycle.annual')}</SelectItem>
            <SelectItem key="biennial" id="biennial">{t('verein_dues.cycle.biennial')}</SelectItem>
            <SelectItem key="monthly" id="monthly">{t('verein_dues.cycle.monthly')}</SelectItem>
          </Select>
          <Input
            label={t('verein_dues.admin_grace_period')}
            type="number"
            value={gracePeriod}
            onChange={(e) => setGracePeriod(e.target.value)}
          />
          <Input
            label={t('verein_dues.admin_late_fee')}
            type="number"
            value={lateFee}
            onChange={(e) => setLateFee(e.target.value)}
            startContent={<span className="text-muted">{currency}</span>}
          />
          <div className="md:col-span-2 flex justify-end">
            <Button color="primary" className="w-full sm:w-auto" isLoading={isSaving} onPress={onSaveConfig}>
              {t('verein_dues.admin_save')}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Overdue dashboard */}
      {overdueCount > 0 && (
        <Card className="bg-danger-50 border border-danger-200">
          <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-danger" aria-hidden="true" />
              <div>
                <div className="font-semibold text-danger">
                  {t('verein_dues.admin_overdue_title')}
                </div>
                <div className="text-sm text-foreground">
                  {t('verein_dues.admin_overdue_count', { count: overdueCount })}
                </div>
              </div>
            </div>
            <Button color="danger" className="w-full sm:w-auto sm:shrink-0" startContent={<Bell className="w-4 h-4" aria-hidden="true" />} onPress={onBulkRemind}>
              {t('verein_dues.admin_bulk_remind')}
            </Button>
          </CardBody>
        </Card>
      )}

      {/* Members table */}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{t('verein_dues.admin_members')}</h2>
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-[110px_180px_minmax(180px,1fr)_auto] sm:items-end">
            <Input
              label={t('verein_dues.admin_year')}
              type="number"
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value || new Date().getFullYear()))}
              size="sm"
              className="w-full"
            />
            <Select
              label={t('verein_dues.admin_filter_status')}
              selectedKeys={[statusFilter || 'all']}
              onChange={(e) => setStatusFilter(e.target.value === 'all' ? '' : e.target.value)}
              size="sm"
              className="w-full"
            >
              <SelectItem key="all" id="all">{t('verein_dues.status_all')}</SelectItem>
              <SelectItem key="pending" id="pending">{t('verein_dues.status.pending')}</SelectItem>
              <SelectItem key="paid" id="paid">{t('verein_dues.status.paid')}</SelectItem>
              <SelectItem key="overdue" id="overdue">{t('verein_dues.status.overdue')}</SelectItem>
              <SelectItem key="waived" id="waived">{t('verein_dues.status.waived')}</SelectItem>
            </Select>
            <Input
              label={t('verein_dues.admin_search')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              size="sm"
            />
            <Button color="primary" className="w-full sm:w-auto" onPress={onGenerate}>
              {t('verein_dues.admin_generate', { year })}
            </Button>
          </div>
        </CardHeader>
        <CardBody className="overflow-x-auto">
          {isLoading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10"><Spinner size="lg" color="primary" /></div>
          ) : (
            <Table aria-label={t('verein_dues.admin_members')}>
              <TableHeader>
                <TableColumn>{t('verein_dues.col_member')}</TableColumn>
                <TableColumn>{t('verein_dues.col_amount')}</TableColumn>
                <TableColumn>{t('verein_dues.col_status')}</TableColumn>
                <TableColumn>{t('verein_dues.col_due')}</TableColumn>
                <TableColumn>{t('verein_dues.col_reminders')}</TableColumn>
                <TableColumn>{t('verein_dues.col_email_delivery')}</TableColumn>
                <TableColumn>{t('verein_dues.col_actions')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('verein_dues.admin_no_rows')}>
                {filteredRows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium">{row.first_name} {row.last_name}</div>
                      <div className="text-xs text-muted">{row.email}</div>
                    </TableCell>
                    <TableCell>
                      {new Intl.NumberFormat(getFormattingLocale(), { style: 'currency', currency: row.currency || 'CHF' }).format(row.amount_cents / 100)}
                    </TableCell>
                    <TableCell>
                      <Chip color={statusColor(row.status)} variant="flat" size="sm">
                        {row.status === 'paid'
                          ? t('verein_dues.status.paid')
                          : row.status === 'waived'
                            ? t('verein_dues.status.waived')
                            : row.status === 'overdue'
                              ? t('verein_dues.status.overdue')
                              : t('verein_dues.status.pending')}
                      </Chip>
                    </TableCell>
                    <TableCell>{row.due_date ?? '—'}</TableCell>
                    <TableCell>{row.reminder_count}</TableCell>
                    <TableCell>
                      <div className="flex max-w-56 flex-col gap-1">
                        <Chip color={emailStatusColor(row)} variant="flat" size="sm">
                          {row.reminder_email_failed_at || row.generated_email_failed_at || row.paid_email_failed_at
                            ? t('verein_dues.email_status.failed')
                            : row.generated_email_sent_at || row.paid_email_sent_at || row.last_reminder_at
                              ? t('verein_dues.email_status.sent')
                              : t('verein_dues.email_status.pending')}
                        </Chip>
                        {row.reminder_email_last_error && (
                          <span className="line-clamp-2 text-xs text-danger">
                            {row.reminder_email_last_error}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {(row.status === 'pending' || row.status === 'overdue') && (
                          <>
                            <Button size="sm" variant="flat" startContent={<Bell className="w-3 h-3" aria-hidden="true" />} onPress={() => onSendReminder(row.id)}>
                              {t('verein_dues.action_remind')}
                            </Button>
                            <Button size="sm" variant="flat" color="warning" startContent={<CheckCircle2 className="w-3 h-3" aria-hidden="true" />} onPress={() => { setWaiveDuesId(row.id); setWaiveReason(''); }}>
                              {t('verein_dues.action_waive')}
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Waive modal */}
      <Modal isOpen={waiveDuesId !== null} onOpenChange={(open) => { if (!open) { setWaiveDuesId(null); setWaiveReason(''); } }}>
        <ModalContent>
          <ModalHeader>{t('verein_dues.admin_waive_title')}</ModalHeader>
          <ModalBody>
            <Textarea
              label={t('verein_dues.admin_waive_reason_label')}
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              minRows={3}
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="flat" onPress={() => { setWaiveDuesId(null); setWaiveReason(''); }}>
              {t('verein_dues.cancel')}
            </Button>
            <Button color="warning" isDisabled={!waiveReason.trim()} onPress={onConfirmWaive}>
              {t('verein_dues.admin_confirm_waive')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
      </div>
    </>
  );
}

export default VereinDuesManagementPage;
