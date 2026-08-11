import { formatPercentValue, getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Spinner, Input, Progress, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import {
  useState,
  useEffect,
  useCallback } from 'react';

import Users from 'lucide-react/icons/users';
import CheckCircle2 from 'lucide-react/icons/circle-check';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Download from 'lucide-react/icons/download';
import Eye from 'lucide-react/icons/eye';
import TrendingUp from 'lucide-react/icons/trending-up';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
import { adminLegalDocs } from '@/admin/api/adminApi';
import type { ComplianceStats, UserAcceptance } from '@/admin/api/types';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { EnforcementModeCard } from './EnforcementModeCard';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


const getComplianceColor = (rate: number): 'success' | 'warning' | 'danger' => {
  if (rate >= 90) return 'success';
  if (rate >= 70) return 'warning';
  return 'danger';
};

export default function LegalDocComplianceDashboard() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.legal_compliance_dashboard') });

  const { success, error } = useToast();

  const [stats, setStats] = useState<ComplianceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAcceptancesModal, setShowAcceptancesModal] = useState(false);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [acceptances, setAcceptances] = useState<UserAcceptance[]>([]);
  const [loadingAcceptances, setLoadingAcceptances] = useState(false);
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [exportingDocId, setExportingDocId] = useState<number | null>(null);

  const loadStats = useCallback(async () => {
    try {
      setLoading(true);
      const response = await adminLegalDocs.getComplianceStats();

      if (response.success && response.data) {
        setStats(response.data);
      } else {
        error(t('enterprise.failed_to_load_compliance_stats'));
      }
    } catch {
      error(t('enterprise.failed_to_load_compliance_stats'));
    } finally {
      setLoading(false);
    }
  }, [error, t])


  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const loadAcceptances = async (docId: number, versionId: number) => {
    try {
      setLoadingAcceptances(true);
      const response = await adminLegalDocs.getAcceptances(versionId, 100, 0);

      if (response.success && response.data) {
        setAcceptances(response.data);
        setSelectedDocId(docId);
        setShowAcceptancesModal(true);
      } else {
        error(t('enterprise.failed_to_load_acceptances'));
      }
    } catch {
      error(t('enterprise.failed_to_load_acceptances'));
    } finally {
      setLoadingAcceptances(false);
    }
  };

  const handleExport = async (docId: number) => {
    try {
      setExportingDocId(docId);
      const response = await adminLegalDocs.exportAcceptances(
        docId,
        dateRange.start || undefined,
        dateRange.end || undefined
      );

      if (response.success && response.data) {
        // Convert API response data to a downloadable CSV blob
        const exportData = response.data;
        const csvContent = typeof exportData === 'string'
          ? exportData
          : JSON.stringify(exportData);
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `acceptances_${docId}_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        success(t('enterprise.export_downloaded_successfully'));
      } else {
        error(t('enterprise.failed_to_export_acceptances'));
      }
    } catch {
      error(t('enterprise.failed_to_export_acceptances'));
    } finally {
      setExportingDocId(null);
    }
  };

  if (loading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="text-center py-12">
        <AlertCircle size={48} className="mx-auto text-[var(--color-text-tertiary)] mb-4" />
        <p className="text-[var(--color-text-secondary)]">{t('enterprise.failed_to_load_compliance_data')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">{t('enterprise.legal_compliance_dashboard')}</h1>
        <p className="text-[var(--color-text-secondary)] mt-1">
          {t('enterprise.track_compliance_description')}
        </p>
      </div>

      <EnforcementModeCard enforcement={stats.enforcement} />

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-accent-soft dark:bg-accent-soft rounded-lg">
                <Users size={24} className="text-accent" />
              </div>
              <div>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('enterprise.label_total_users')}</p>
                <p className="text-2xl font-bold">{stats.total_users.toLocaleString(getFormattingLocale())}</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-success-100 dark:bg-success-900/30 rounded-lg">
                <CheckCircle2 size={24} className="text-success" />
              </div>
              <div>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('enterprise.fully_compliant')}</p>
                <p className="text-2xl font-bold">
                  {(stats.total_users - stats.users_pending_acceptance).toLocaleString(getFormattingLocale())}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-warning-100 dark:bg-warning-900/30 rounded-lg">
                <AlertCircle size={24} className="text-warning" />
              </div>
              <div>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('enterprise.stat_pending')}</p>
                <p className="text-2xl font-bold">
                  {stats.users_pending_acceptance.toLocaleString(getFormattingLocale())}
                </p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-accent-soft dark:bg-accent-soft rounded-lg">
                <TrendingUp size={24} className="text-accent" />
              </div>
              <div>
                <p className="text-sm text-[var(--color-text-secondary)]">{t('enterprise.overall_compliance')}</p>
                <p className="text-2xl font-bold">{formatPercentValue(stats.overall_compliance_rate)}</p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Per-Document Breakdown */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">{t('enterprise.document_acceptance_rates')}</h2>
        </CardHeader>
        <CardBody>
          {stats.documents.length === 0 ? (
            <div className="text-center py-8">
              <AlertCircle size={40} className="mx-auto text-[var(--color-text-tertiary)] mb-3" />
              <p className="text-[var(--color-text-secondary)]">{t('enterprise.no_legal_documents')}</p>
            </div>
          ) : (
            <Table aria-label={t('enterprise.label_document_compliance_table')}>
              <TableHeader>
                <TableColumn>{t('enterprise.col_document')}</TableColumn>
                <TableColumn>{t('enterprise.label_version')}</TableColumn>
                <TableColumn>{t('enterprise.col_effective_date')}</TableColumn>
                <TableColumn>{t('enterprise.col_acceptance_rate')}</TableColumn>
                <TableColumn>{t('enterprise.col_users_accepted')}</TableColumn>
                <TableColumn>{t('enterprise.col_users_pending')}</TableColumn>
                <TableColumn>{t('enterprise.label_actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {stats.documents.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{doc.title}</p>
                        <p className="text-sm text-[var(--color-text-secondary)]">
                          {doc.document_type}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{doc.version_number || t('enterprise.not_available')}</TableCell>
                    <TableCell>
                      {doc.effective_date
                        ? new Date(doc.effective_date).toLocaleDateString(getFormattingLocale())
                        : t('enterprise.not_available')}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Progress
                            value={doc.acceptance_rate}
                            color={getComplianceColor(doc.acceptance_rate)}
                            className="flex-1"
                            size="sm"
                            aria-label={t('enterprise.col_acceptance_rate')}
                          />
                          <span className="text-sm font-medium w-12 text-right">
                            {formatPercentValue(doc.acceptance_rate)}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-success font-medium">
                        {doc.users_accepted.toLocaleString(getFormattingLocale())}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-warning font-medium">
                        {doc.users_not_accepted.toLocaleString(getFormattingLocale())}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="tertiary"
                          startContent={<Eye size={16} />}
                          onPress={() => {
                            if (doc.current_version_id) {
                              loadAcceptances(doc.id, doc.current_version_id);
                            }
                          }}
                          isDisabled={!doc.current_version_id}
                          isLoading={loadingAcceptances && selectedDocId === doc.id}
                        >
                          {t('enterprise.btn_view')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          startContent={<Download size={16} />}
                          onPress={() => handleExport(doc.id)}
                          isLoading={exportingDocId === doc.id}
                        >
                          {t('enterprise.btn_export')}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Date Range Filter */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">{t('enterprise.export_options_title')}</h2>
        </CardHeader>
        <CardBody>
          <div className="flex items-end gap-4">
            <Input
              type="date"
              label={t('enterprise.label_start_date')}
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="flex-1"
            />
            <Input
              type="date"
              label={t('enterprise.label_end_date')}
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="flex-1"
            />
            <Button
              variant="tertiary"
              onPress={() => setDateRange({ start: '', end: '' })}
            >
              {t('enterprise.btn_clear')}
            </Button>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)] mt-2">
            {t('enterprise.export_filter_description')}
          </p>
        </CardBody>
      </Card>

      {/* Acceptances Modal */}
      <Modal
        isOpen={showAcceptancesModal}
        onClose={() => setShowAcceptancesModal(false)}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{t('enterprise.modal_user_acceptances')}</ModalHeader>
              <ModalBody>
                {acceptances.length === 0 ? (
                  <div className="text-center py-8">
                    <AlertCircle size={40} className="mx-auto text-[var(--color-text-tertiary)] mb-3" />
                    <p className="text-[var(--color-text-secondary)]">{t('enterprise.no_acceptances_found')}</p>
                  </div>
                ) : (
                  <Table aria-label={t('enterprise.label_user_acceptances')}>
                    <TableHeader>
                      <TableColumn>{t('enterprise.col_user_name')}</TableColumn>
                      <TableColumn>{t('enterprise.col_email')}</TableColumn>
                      <TableColumn>{t('enterprise.col_version_number')}</TableColumn>
                      <TableColumn>{t('enterprise.col_accepted_at')}</TableColumn>
                      <TableColumn>{t('enterprise.col_acceptance_method')}</TableColumn>
                      <TableColumn>{t('enterprise.col_ip_address')}</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {acceptances.map((acceptance) => (
                        <TableRow key={`${acceptance.user_id}-${acceptance.version_id}`}>
                          <TableCell>{acceptance.user_name}</TableCell>
                          <TableCell>{acceptance.user_email}</TableCell>
                          <TableCell>{acceptance.version_number}</TableCell>
                          <TableCell>
                            {new Date(acceptance.accepted_at).toLocaleString(getFormattingLocale())}
                          </TableCell>
                          <TableCell>{acceptance.acceptance_method}</TableCell>
                          <TableCell>
                            <span className="font-mono text-xs">
                              {acceptance.ip_address || t('enterprise.not_available')}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </ModalBody>
              <ModalFooter>
                <Button onPress={onClose}>
                  {t('enterprise.btn_close')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
