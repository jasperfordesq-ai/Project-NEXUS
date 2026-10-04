import { formatNumber, getFormattingLocale } from '@/lib/helpers';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Card, CardBody, CardHeader, Button, Chip, Spinner, Input, Select, SelectItem, useDisclosure, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell, Pagination } from '@/components/ui';
import { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import FileText from 'lucide-react/icons/file-text';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Calendar from 'lucide-react/icons/calendar';
import Trash2 from 'lucide-react/icons/trash-2';
import Download from 'lucide-react/icons/download';
import Filter from 'lucide-react/icons/filter';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { adminCron } from '../../api/adminApi';
import { PageHeader } from '../../components/PageHeader';
import type { CronLog } from '../../api/types';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cron Job Logs
 * View and filter cron job execution logs with detail modal
 * Parity: PHP CronJobController::logs()
 */


// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function CronJobLogs() {
  const { t } = useTranslation('admin_system');
  usePageTitle(t('system.cron_job_logs_title'));
  const toast = useToast();
  const { isOpen, onOpen, onClose } = useDisclosure();

  const [logs, setLogs] = useState<CronLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<CronLog | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [jobIdFilter, setJobIdFilter] = useState<string>('');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 50;

  // Clear logs modal
  const {
    isOpen: isClearOpen,
    onOpen: onClearOpen,
    onClose: onClearClose,
  } = useDisclosure();
  const [clearBeforeDate, setClearBeforeDate] = useState<string>('');

  const loadLogs = useCallback(async () => {
    setLoading(true);
    try {
      const offset = (page - 1) * limit;
      const res = await adminCron.getLogs({
        status: statusFilter || undefined,
        jobId: jobIdFilter || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        limit,
        offset,
      });

      if (res.success && res.data) {
        setLogs(Array.isArray(res.data) ? res.data : []);
        setTotal(res.meta?.total ?? 0);
      }
    } catch {
      setLogs([]);
      setTotal(0);
    }
    setLoading(false);
  }, [page, statusFilter, jobIdFilter, startDate, endDate]);

  const handleViewDetail = async (log: CronLog) => {
    setSelectedLog(log);
    onOpen();
  };

  const handleClearLogs = async () => {
    if (!clearBeforeDate) {
      toast.error(t('system.please_select_a_date'));
      return;
    }

    try {
      const res = await adminCron.clearLogs(clearBeforeDate);
      if (res.success) {
        toast.success(t('system.logs_cleared_successfully'));
        onClearClose();
        setClearBeforeDate('');
        loadLogs();
      } else {
        toast.error(t('system.failed_to_clear_logs'));
      }
    } catch {
      toast.error(t('system.failed_to_clear_logs'));
    }
  };

  const getStatusLabel = (status: string) => {
    if (status === 'success') {
      return t('system.status_success');
    }
    if (status === 'failed') {
      return t('system.status_failed');
    }
    return status;
  };

  const exportToCSV = () => {
    const headers = [
      t('system.csv_header_id'),
      t('system.csv_header_job_name'),
      t('system.csv_header_status'),
      t('system.csv_header_duration'),
      t('system.csv_header_executed_at'),
      t('system.csv_header_executed_by'),
    ];
    const rows = logs.map((log) => [
      log.id,
      log.job_name,
      getStatusLabel(log.status),
      log.duration_seconds,
      log.executed_at,
      log.executed_by,
    ]);

    // Inner quotes were never doubled, so a value containing `"` broke the
    // file; lib/csv quotes and formula-neutralises every cell.
    downloadCsv(`cron-logs-${new Date().toISOString().split('T')[0]}.csv`, toCsv(headers, rows));
  };

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const totalPages = Math.ceil(total / limit);

  return (
    <div>
      <PageHeader
        title={t('system.cron_job_logs_title')}
        description={t('system.cron_job_logs_desc')}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              startContent={<Download size={16} />}
              onPress={exportToCSV}
              isDisabled={logs.length === 0}
            >
              {t('system.btn_export_csv')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              startContent={<Trash2 size={16} />}
              onPress={onClearOpen}
            >
              {t('system.btn_clear_old_logs')}
            </Button>
            <Button
              size="sm"
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadLogs}
              isLoading={loading}
            >
              {t('common.refresh')}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader className="flex items-center justify-start gap-2 px-4 pb-2 pt-4 sm:px-5">
          <Filter size={16} className="text-muted" />
          <span className="text-sm font-medium">{t('system.filter_section_header')}</span>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-4 px-4 pb-4 pt-0 sm:grid-cols-2 sm:px-5 lg:grid-cols-[minmax(12rem,1fr)_minmax(14rem,1.2fr)_minmax(11rem,1fr)_minmax(11rem,1fr)]">
          <Select
            label={t('system.label_status')}
            placeholder={t('system.placeholder_all_statuses')}
            size="sm"
            variant="secondary"
            selectedKeys={statusFilter ? [statusFilter] : []}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <SelectItem key="success" id="success">
              {t('system.status_success')}
            </SelectItem>
            <SelectItem key="failed" id="failed">
              {t('system.status_failed')}
            </SelectItem>
          </Select>

          <Input
            label={t('system.label_job_i_d')}
            placeholder={t('system.placeholder_filter_by_job_i_d')}
            size="sm"
            variant="secondary"
            value={jobIdFilter}
            onChange={(e) => {
              setJobIdFilter(e.target.value);
              setPage(1);
            }}
          />

          <Input
            label={t('system.label_start_date')}
            type="date"
            size="sm"
            variant="secondary"
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              setPage(1);
            }}
          />

          <Input
            label={t('system.label_end_date')}
            type="date"
            size="sm"
            variant="secondary"
            value={endDate}
            onChange={(e) => {
              setEndDate(e.target.value);
              setPage(1);
            }}
          />
        </CardBody>
      </Card>

      {/* Loading state */}
      {loading && logs.length === 0 && (
        <div className="flex items-center justify-center py-20">
          <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="lg" label={t('system.loading_logs')} /></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && logs.length === 0 && (
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-muted">
            <FileText size={48} />
            <p className="text-lg font-medium">{t('system.no_logs_found')}</p>
            <p className="text-sm">{t('system.try_filters_or_run_cron')}</p>
          </CardBody>
        </Card>
      )}

      {/* Logs table */}
      {!loading && logs.length > 0 && (
        <Card className="overflow-hidden">
          <CardBody className="p-0">
            <Table
              aria-label={t('system.cron_job_logs_title')}
              removeWrapper
              onRowAction={(key) => {
                const log = logs.find((item) => String(item.id) === String(key));
                if (log) {
                  void handleViewDetail(log);
                }
              }}
              classNames={{
                base: 'min-w-0',
                wrapper: 'max-w-full overflow-x-auto',
                table: 'min-w-[1180px]',
              }}
            >
              <TableHeader>
                <TableColumn className="w-64 min-w-64 whitespace-nowrap">
                  {t('system.col_job_name')}
                </TableColumn>
                <TableColumn className="w-28 min-w-28 whitespace-nowrap">
                  {t('system.col_status')}
                </TableColumn>
                <TableColumn className="w-28 min-w-28 whitespace-nowrap">
                  {t('system.col_duration')}
                </TableColumn>
                <TableColumn className="w-[34rem] min-w-[34rem]">
                  {t('system.col_output')}
                </TableColumn>
                <TableColumn className="w-52 min-w-52 whitespace-nowrap">
                  {t('system.col_executed_at')}
                </TableColumn>
                <TableColumn className="w-32 min-w-32 whitespace-nowrap">
                  {t('system.col_executed_by')}
                </TableColumn>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow
                    key={log.id}
                    id={log.id}
                    className="cursor-pointer hover:bg-surface-secondary"
                  >
                    <TableCell className="w-64 min-w-64 align-top">
                      <div className="max-w-[13rem]">
                        <div className="truncate font-medium text-foreground">{log.job_name}</div>
                        <div className="truncate font-mono text-xs text-muted">{log.job_id}</div>
                      </div>
                    </TableCell>
                    <TableCell className="w-28 min-w-28 whitespace-nowrap align-top">
                      <div className="flex items-center">
                        <Chip
                          size="sm"
                          variant="soft"
                          color={log.status === 'success' ? 'success' : 'danger'}
                          startContent={
                            log.status === 'success' ? (
                              <CheckCircle size={12} />
                            ) : (
                              <XCircle size={12} />
                            )
                          }
                        >
                          {getStatusLabel(log.status)}
                        </Chip>
                      </div>
                    </TableCell>
                    <TableCell className="w-28 min-w-28 whitespace-nowrap align-top">
                      <span className="text-sm tabular-nums">
                        {formatNumber(Number(log.duration_seconds), {
                          maximumFractionDigits: 2,
                          minimumFractionDigits: 2,
                          style: 'unit',
                          unit: 'second',
                          unitDisplay: 'narrow',
                        })}
                      </span>
                    </TableCell>
                    <TableCell className="w-[34rem] min-w-[34rem] max-w-[34rem] align-top">
                      <span className="line-clamp-2 whitespace-normal break-words text-xs leading-5 text-foreground">
                        {log.output || t('system.table_no_output')}
                      </span>
                    </TableCell>
                    <TableCell className="w-52 min-w-52 whitespace-nowrap align-top">
                      <div className="flex items-center gap-1.5 text-sm">
                        <Calendar size={14} className="flex-none text-muted" />
                        <span>{new Date(log.executed_at).toLocaleString(getFormattingLocale())}</span>
                      </div>
                    </TableCell>
                    <TableCell className="w-32 min-w-32 whitespace-nowrap align-top">
                      <span className="font-mono text-xs text-foreground">
                        {log.executed_by}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex justify-center border-t border-divider p-4">
                <Pagination
                  total={totalPages}
                  page={page}
                  onChange={setPage}
                  size="sm"
                  showControls
                />
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Detail Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="3xl" scrollBehavior="inside">
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">
            <span>{t('system.modal_log_detail')}</span>
            {selectedLog && (
              <span className="text-sm font-normal text-muted">
                {selectedLog.job_name} ({selectedLog.job_id})
              </span>
            )}
          </ModalHeader>
          <ModalBody>
            {selectedLog && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted mb-1">{t('system.modal_label_status')}</p>
                    <Chip
                      size="sm"
                      variant="soft"
                      color={
                        selectedLog.status === 'success' ? 'success' : 'danger'
                      }
                      startContent={
                        selectedLog.status === 'success' ? (
                          <CheckCircle size={12} />
                        ) : (
                          <XCircle size={12} />
                        )
                      }
                    >
                      {getStatusLabel(selectedLog.status)}
                    </Chip>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">{t('system.modal_label_duration')}</p>
                    <p className="text-sm font-medium">
                      {formatNumber(Number(selectedLog.duration_seconds), {
                        maximumFractionDigits: 2,
                        minimumFractionDigits: 2,
                        style: 'unit',
                        unit: 'second',
                        unitDisplay: 'narrow',
                      })}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">{t('system.modal_label_executed_at')}</p>
                    <p className="text-sm font-medium">
                      {new Date(selectedLog.executed_at).toLocaleString(getFormattingLocale())}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted mb-1">{t('system.modal_label_executed_by')}</p>
                    <p className="text-sm font-medium">
                      {selectedLog.executed_by}
                    </p>
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted mb-2">{t('system.modal_label_output')}</p>
                  <pre className="bg-surface-secondary p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap break-all">
                    {selectedLog.output || t('system.table_no_output')}
                  </pre>
                </div>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="tertiary" onPress={onClose}>
              {t('system.btn_close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Clear Logs Modal */}
      <Modal isOpen={isClearOpen} onClose={onClearClose}>
        <ModalContent>
          <ModalHeader>{t('system.clear_old_logs')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-foreground mb-4">
              {t('system.clear_old_logs_warning')}
            </p>
            <Input
              label={t('system.label_delete_logs_before')}
              type="date"
              variant="secondary"
              value={clearBeforeDate}
              onChange={(e) => setClearBeforeDate(e.target.value)}
            />
          </ModalBody>
          <ModalFooter>
            <Button size="sm" variant="tertiary" onPress={onClearClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              variant="danger"
              onPress={handleClearLogs}
              isDisabled={!clearBeforeDate}
            >
              {t('system.clear_logs')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default CronJobLogs;
