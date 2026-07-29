import { getFormattingLocale } from '@/lib/helpers';
import { Select, SelectItem, Button, Chip, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GDPR Breaches
 * DataTable of data breaches with report functionality.
 * Parity: PHP GdprBreachController::index() + create/store
 */

import { useEffect, useState, useCallback } from 'react';

import RefreshCw from 'lucide-react/icons/refresh-cw';
import Plus from 'lucide-react/icons/plus';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useToast } from '@/contexts';
import { adminEnterprise } from '../../api/adminApi';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { PageHeader } from '../../components/PageHeader';
import { DataTable, StatusBadge } from '../../components/DataTable';
import type { Column } from '../../components/DataTable';
import type { GdprBreach } from '../../api/types';

import { useTranslation } from 'react-i18next';
const severityColorMap: Record<string, 'default' | 'primary' | 'warning' | 'danger'> = {
  low: 'default',
  medium: 'primary',
  high: 'warning',
  critical: 'danger',
};

const SEVERITY_KEYS = ['low', 'medium', 'high', 'critical'] as const;

export function GdprBreaches() {
  const { t } = useTranslation('admin_enterprise');
  useAdminPageMeta({ title: t('enterprise.gdpr_breaches_title') });
  const toast = useToast();

  const [breaches, setBreaches] = useState<GdprBreach[]>([]);
  const [loading, setLoading] = useState(true);

  // Report breach modal
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [breachTitle, setBreachTitle] = useState('');
  const [breachDescription, setBreachDescription] = useState('');
  const [breachSeverity, setBreachSeverity] = useState('medium');
  const [affectedUsers, setAffectedUsers] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminEnterprise.getGdprBreaches();
      if (res.success && res.data) {
        const data = res.data as unknown;
        setBreaches(Array.isArray(data) ? data : []);
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_load_breaches'));
    } finally {
      setLoading(false);
    }
  }, [t, toast])


  useEffect(() => {
    loadData();
  }, [loadData]);

  const openReportModal = () => {
    setBreachTitle('');
    setBreachDescription('');
    setBreachSeverity('medium');
    setAffectedUsers('');
    setReportOpen(true);
  };

  const handleReportBreach = async () => {
    if (!breachTitle.trim()) {
      toast.error(t('enterprise.title_required'));
      return;
    }
    setReportLoading(true);
    try {
      const res = await adminEnterprise.createBreach({
        title: breachTitle.trim(),
        description: breachDescription.trim(),
        severity: breachSeverity,
        affected_users: affectedUsers ? parseInt(affectedUsers, 10) : 0,
      });
      if (res.success) {
        toast.success(t('enterprise.gdpr_breach_reported'));
        setReportOpen(false);
        loadData();
      } else {
        toast.error(t('enterprise.gdpr_failed_report_breach'));
      }
    } catch {
      toast.error(t('enterprise.gdpr_failed_report_breach'));
    } finally {
      setReportLoading(false);
    }
  };

  const columns: Column<GdprBreach>[] = [
    { key: 'id', label: t('enterprise.gdpr_id'), sortable: true },
    { key: 'title', label: t('enterprise.gdpr_title'), sortable: true },
    {
      key: 'severity',
      label: t('enterprise.gdpr_severity_label'),
      sortable: true,
      render: (b) => (
        <Chip
          size="sm"
          variant="soft"
          color={severityColorMap[b.severity] || 'default'}
          className="capitalize"
          data-testid="breach-severity-chip"
          data-severity={b.severity}
        >
          {t(`enterprise.gdpr_severity_${b.severity}`, { defaultValue: t('enterprise.gdpr_severity_unknown') })}
        </Chip>
      ),
    },
    {
      key: 'status',
      label: t('enterprise.gdpr_status'),
      sortable: true,
      render: (b) => <StatusBadge status={b.status} />,
    },
    { key: 'description', label: t('enterprise.gdpr_description_label') },
    {
      key: 'reported_at',
      label: t('enterprise.gdpr_reported'),
      sortable: true,
      render: (b) => b.reported_at ? new Date(b.reported_at).toLocaleDateString(getFormattingLocale()) : '---',
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('enterprise.gdpr_breaches_title')}
        description={t('enterprise.gdpr_breaches_desc')}
        actions={
          <div className="flex gap-2">
            <Button
              variant="tertiary"
              startContent={<RefreshCw size={16} />}
              onPress={loadData}
              isLoading={loading}
              size="sm"
            >
              {t('enterprise.refresh')}
            </Button>
            <Button
              variant="danger"
              startContent={<Plus size={16} />}
              onPress={openReportModal}
              size="sm"
            >
              {t('enterprise.gdpr_report_breach')}
            </Button>
          </div>
        }
      />

      <DataTable
        columns={columns}
        data={breaches}
        isLoading={loading}
        searchable={false}
        emptyContent={t('enterprise.gdpr_no_data_breaches')}
      />

      <Modal isOpen={reportOpen} onClose={() => setReportOpen(false)} size="lg">
        <ModalContent>
          <ModalHeader className="flex items-center gap-2">
            <AlertTriangle size={20} className="text-danger" />
            {t('enterprise.gdpr_report_data_breach')}
          </ModalHeader>
          <ModalBody className="gap-4">
            <Input
              label={t('enterprise.gdpr_title')}
              placeholder={t('enterprise.gdpr_breach_title_placeholder')}
              value={breachTitle}
              onValueChange={setBreachTitle}
              variant="secondary"
              isRequired
            />
            <Textarea
              label={t('enterprise.gdpr_description_label')}
              placeholder={t('enterprise.gdpr_breach_description_placeholder')}
              value={breachDescription}
              onValueChange={setBreachDescription}
              variant="secondary"
              minRows={3}
            />
            <div className="grid grid-cols-2 gap-4">
              <Select
                label={t('enterprise.gdpr_severity_label')}
                selectedKeys={[breachSeverity]}
                onSelectionChange={(keys) => {
                  const val = Array.from(keys)[0] as string;
                  if (val) setBreachSeverity(val);
                }}
                variant="secondary"
              >
                {SEVERITY_KEYS.map((key) => (
                  <SelectItem key={key} id={key}>{t(`common.${key}`)}</SelectItem>
                ))}
              </Select>
              <Input
                label={t('enterprise.gdpr_affected_users')}
                placeholder="0"
                type="number"
                value={affectedUsers}
                onValueChange={setAffectedUsers}
                variant="secondary"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setReportOpen(false)} isDisabled={reportLoading}>
              {t('enterprise.gdpr_cancel')}
            </Button>
            <Button variant="danger" onPress={handleReportBreach} isLoading={reportLoading} isDisabled={reportLoading}>
              {t('enterprise.gdpr_report_breach')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default GdprBreaches;
