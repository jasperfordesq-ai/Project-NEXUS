import { getFormattingLocale } from '@/lib/helpers';
import { Card, CardBody, CardHeader, Button, Chip, Input, Spinner, Textarea, Select, SelectItem, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tabs, Tab, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import RefreshCw from 'lucide-react/icons/refresh-cw';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import Download from 'lucide-react/icons/download';
import ShieldCheck from 'lucide-react/icons/shield-check';
import Globe from 'lucide-react/icons/globe';
import Database from 'lucide-react/icons/database';
import FileText from 'lucide-react/icons/file-text';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import api from '@/lib/api';
import { ConfirmModal } from '../../components/ConfirmModal';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


interface ProcessingActivity {
  id: number;
  tenant_id: number;
  activity_name: string;
  purpose: string;
  data_categories: string[];
  recipients: string[] | null;
  retention_period: string;
  legal_basis: string;
  is_automated_profiling: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface RetentionConfig {
  config: {
    member_data_years: number;
    transaction_data_years: number;
    activity_logs_years: number;
    messages_years: number;
    ai_embeddings_years: number;
  };
  data_residency: 'Switzerland' | 'EU' | 'International';
  dpa_contact_email: string | null;
}

interface ConsentRecord {
  id: number;
  tenant_id: number;
  user_id: number;
  consent_type: string;
  action: string;
  consent_version: string | null;
  ip_address: string | null;
  created_at: string;
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0] ?? {});
  const csvContent = [
    headers.join(','),
    ...rows.map(row =>
      headers
        .map(h => {
          const val = row[h];
          const str = Array.isArray(val) ? val.join(';') : String(val ?? '');
          return `"${str.replace(/"/g, '""')}"`;
        })
        .join(',')
    ),
  ].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const legalBasisColor: Record<string, 'primary' | 'success' | 'warning' | 'secondary'> = {
  consent: 'primary',
  contract: 'success',
  legal_obligation: 'warning',
  legitimate_interest: 'secondary',
};
const consentActionKeys = new Set(['granted', 'withdrawn']);

const emptyActivity = {
  id: undefined as number | undefined,
  activity_name: '',
  purpose: '',
  data_categories: '',
  recipients: '',
  retention_period: '',
  legal_basis: 'contract',
  is_automated_profiling: false,
  sort_order: '0',
};

const retentionFields: Array<{
  key: keyof RetentionConfig['config'];
  labelKey: string;
  hintKey: string;
}> = [
  {
    key: 'member_data_years',
    labelKey: 'fadp.retention.fields.member_data_years',
    hintKey: 'fadp.retention.hints.member_data_years',
  },
  {
    key: 'transaction_data_years',
    labelKey: 'fadp.retention.fields.transaction_data_years',
    hintKey: 'fadp.retention.hints.transaction_data_years',
  },
  {
    key: 'activity_logs_years',
    labelKey: 'fadp.retention.fields.activity_logs_years',
    hintKey: 'fadp.retention.hints.activity_logs_years',
  },
  {
    key: 'messages_years',
    labelKey: 'fadp.retention.fields.messages_years',
    hintKey: 'fadp.retention.hints.messages_years',
  },
  {
    key: 'ai_embeddings_years',
    labelKey: 'fadp.retention.fields.ai_embeddings_years',
    hintKey: 'fadp.retention.hints.ai_embeddings_years',
  },
];

const dataResidencyOptions: RetentionConfig['data_residency'][] = ['Switzerland', 'EU', 'International'];
const legalBasisOptions = ['consent', 'contract', 'legal_obligation', 'legitimate_interest'];

export function FadpAdminPage() {
  const { t } = useTranslation('admin_legal');
  usePageTitle(t('fadp.meta.page_title'));
  const toast = useToast();

  const [activities, setActivities] = useState<ProcessingActivity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [activityModalOpen, setActivityModalOpen] = useState(false);
  const [activityForm, setActivityForm] = useState({ ...emptyActivity });
  const [activitySaving, setActivitySaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProcessingActivity | null>(null);
  const [activityDeleting, setActivityDeleting] = useState(false);

  const [retention, setRetention] = useState<RetentionConfig>({
    config: {
      member_data_years: 7,
      transaction_data_years: 10,
      activity_logs_years: 3,
      messages_years: 2,
      ai_embeddings_years: 1,
    },
    data_residency: 'EU',
    dpa_contact_email: null,
  });
  const [retentionLoading, setRetentionLoading] = useState(true);
  const [retentionSaving, setRetentionSaving] = useState(false);

  const legalBasisLabel = useCallback(
    (basis: string) => (
      Object.prototype.hasOwnProperty.call(legalBasisColor, basis)
        ? t(`fadp.legal_basis.${basis}`)
        : t('fadp.legal_basis.unknown', { basis })
    ),
    [t],
  );

  const consentActionLabel = useCallback(
    (action: string) => (
      consentActionKeys.has(action)
        ? t(`fadp.consent_actions.${action}`)
        : t('fadp.consent_actions.unknown', { action })
    ),
    [t],
  );

  const [consentRecords, setConsentRecords] = useState<ConsentRecord[]>([]);
  const [consentLoading, setConsentLoading] = useState(true);
  const [registerData, setRegisterData] = useState<Record<string, unknown> | null>(null);

  const loadActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await api.get<ProcessingActivity[]>('/v2/admin/fadp/processing-activities');
      setActivities(res.data ?? []);
    } catch {
      toast.showToast(t('fadp.toasts.activities_load_failed'), 'error');
    } finally {
      setActivitiesLoading(false);
    }
  }, [t, toast]);

  const loadRetention = useCallback(async () => {
    setRetentionLoading(true);
    try {
      const res = await api.get<RetentionConfig>('/v2/admin/fadp/retention-config');
      if (res.data) setRetention(res.data);
    } catch {
      toast.showToast(t('fadp.toasts.retention_load_failed'), 'error');
    } finally {
      setRetentionLoading(false);
    }
  }, [t, toast]);

  const loadConsentLedger = useCallback(async () => {
    setConsentLoading(true);
    try {
      const res = await api.get<ConsentRecord[]>('/v2/admin/fadp/consent-ledger');
      setConsentRecords(res.data ?? []);
    } catch {
      toast.showToast(t('fadp.toasts.consent_load_failed'), 'error');
    } finally {
      setConsentLoading(false);
    }
  }, [t, toast]);

  const loadRegister = useCallback(async () => {
    try {
      const res = await api.get<Record<string, unknown>>('/v2/admin/fadp/processing-register');
      setRegisterData(res.data ?? null);
    } catch {
      setRegisterData(null);
    }
  }, []);

  useEffect(() => {
    void loadActivities();
    void loadRetention();
    void loadConsentLedger();
    void loadRegister();
  }, [loadActivities, loadRetention, loadConsentLedger, loadRegister]);

  function openAddActivity() {
    setActivityForm({ ...emptyActivity });
    setActivityModalOpen(true);
  }

  function openEditActivity(activity: ProcessingActivity) {
    setActivityForm({
      id: activity.id,
      activity_name: activity.activity_name,
      purpose: activity.purpose,
      data_categories: (activity.data_categories ?? []).join(', '),
      recipients: (activity.recipients ?? []).join(', '),
      retention_period: activity.retention_period,
      legal_basis: activity.legal_basis,
      is_automated_profiling: activity.is_automated_profiling,
      sort_order: String(activity.sort_order),
    });
    setActivityModalOpen(true);
  }

  async function saveActivity() {
    if (!activityForm.activity_name.trim() || !activityForm.purpose.trim()) {
      toast.showToast(t('fadp.toasts.activity_required'), 'error');
      return;
    }

    setActivitySaving(true);
    try {
      const payload = {
        id: activityForm.id,
        activity_name: activityForm.activity_name,
        purpose: activityForm.purpose,
        data_categories: activityForm.data_categories
          .split(',')
          .map(s => s.trim())
          .filter(Boolean),
        recipients: activityForm.recipients
          ? activityForm.recipients
              .split(',')
              .map(s => s.trim())
              .filter(Boolean)
          : null,
        retention_period: activityForm.retention_period,
        legal_basis: activityForm.legal_basis,
        is_automated_profiling: activityForm.is_automated_profiling,
        sort_order: parseInt(activityForm.sort_order, 10) || 0,
      };
      const res = await api.post('/v2/admin/fadp/processing-activities', payload);
      if (res.success) {
        toast.showToast(t('fadp.toasts.activity_saved'), 'success');
        setActivityModalOpen(false);
        void loadActivities();
        void loadRegister();
      } else {
        toast.showToast(t('fadp.toasts.activity_save_failed'), 'error');
      }
    } catch {
      toast.showToast(t('fadp.toasts.activity_save_failed'), 'error');
    } finally {
      setActivitySaving(false);
    }
  }

  async function deleteActivity() {
    if (!deleteTarget) return;

    setActivityDeleting(true);
    try {
      const res = await api.delete(`/v2/admin/fadp/processing-activities/${deleteTarget.id}`);
      if (res.success) {
        toast.showToast(t('fadp.toasts.activity_deleted'), 'success');
        setDeleteTarget(null);
        void loadActivities();
        void loadRegister();
      } else {
        toast.showToast(t('fadp.toasts.activity_delete_failed'), 'error');
      }
    } catch {
      toast.showToast(t('fadp.toasts.activity_delete_failed'), 'error');
    } finally {
      setActivityDeleting(false);
    }
  }

  async function saveRetention() {
    setRetentionSaving(true);
    try {
      const res = await api.put('/v2/admin/fadp/retention-config', retention);
      if (res.success) {
        toast.showToast(t('fadp.toasts.retention_saved'), 'success');
        void loadRegister();
      } else {
        toast.showToast(t('fadp.toasts.retention_save_failed'), 'error');
      }
    } catch {
      toast.showToast(t('fadp.toasts.retention_save_failed'), 'error');
    } finally {
      setRetentionSaving(false);
    }
  }

  async function exportRegisterCsv() {
    try {
      const res = await api.get<Record<string, unknown>>('/v2/admin/fadp/processing-register');
      const reg = res.data as { processing_activities?: ProcessingActivity[] };
      const rows = (reg.processing_activities ?? []).map(a => ({
        id: a.id,
        activity_name: a.activity_name,
        purpose: a.purpose,
        data_categories: a.data_categories,
        retention_period: a.retention_period,
        legal_basis: a.legal_basis,
        is_automated_profiling: a.is_automated_profiling,
      }));
      downloadCsv(rows as Record<string, unknown>[], 'fadp-processing-register.csv');
    } catch {
      toast.showToast(t('fadp.toasts.register_export_failed'), 'error');
    }
  }

  async function exportConsentCsv() {
    try {
      const res = await api.get<ConsentRecord[]>('/v2/admin/fadp/consent-ledger');
      downloadCsv(res.data as unknown as Record<string, unknown>[], 'fadp-consent-ledger.csv');
    } catch {
      toast.showToast(t('fadp.toasts.consent_export_failed'), 'error');
    }
  }

  const renderedGeneratedAt = (registerData as { generated_at?: string } | null)?.generated_at
    ? new Date((registerData as { generated_at: string }).generated_at).toLocaleString(getFormattingLocale())
    : t('fadp.common.empty_dash');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-[var(--color-text)]">
            <ShieldCheck className="text-danger-soft-foreground" size={24} aria-hidden="true" />
            {t('fadp.header.title')}
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            {t('fadp.header.description')}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          startContent={<RefreshCw size={14} />}
          onPress={() => {
            void loadActivities();
            void loadRetention();
            void loadConsentLedger();
            void loadRegister();
          }}
        >
          {t('fadp.actions.refresh')}
        </Button>
      </div>

      <Tabs aria-label={t('fadp.tabs.aria')} variant="underlined">
        <Tab key="register" title={<span className="flex items-center gap-2"><FileText size={14} aria-hidden="true" />{t('fadp.tabs.register')}</span>}>
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-3xl text-sm text-muted">
                {t('fadp.register.description')}
              </p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" startContent={<Download size={14} />} onPress={() => void exportRegisterCsv()}>
                  {t('fadp.actions.export_csv')}
                </Button>
            <Button size="sm" startContent={<Plus size={14} />} onPress={openAddActivity}>
                  {t('fadp.actions.add_activity')}
                </Button>
              </div>
            </div>

            {activitiesLoading ? (
              <div className="flex justify-center py-12" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner /></div>
            ) : (
              <Card >
                <CardBody className="p-0">
                  <Table aria-label={t('fadp.register.table_aria')} removeWrapper>
                    <TableHeader>
                      <TableColumn>{t('fadp.register.columns.activity')}</TableColumn>
                      <TableColumn>{t('fadp.register.columns.legal_basis')}</TableColumn>
                      <TableColumn>{t('fadp.register.columns.automated_profiling')}</TableColumn>
                      <TableColumn>{t('fadp.register.columns.retention')}</TableColumn>
                      <TableColumn>{t('fadp.register.columns.actions')}</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent={t('fadp.register.empty')}>
                      {activities.map(a => (
                        <TableRow key={a.id}>
                          <TableCell>
                            <div>
                              <p className="text-sm font-medium">{a.activity_name}</p>
                              <p className="line-clamp-2 text-xs text-muted">{a.purpose}</p>
                              {a.data_categories.length > 0 && (
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {a.data_categories.map(c => (
                                    <Chip key={c} size="sm" variant="soft" className="text-xs">{c}</Chip>
                                  ))}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="sm"
                              color={legalBasisColor[a.legal_basis] ?? 'default'}
                              variant="soft"
                            >
                              {legalBasisLabel(a.legal_basis)}
                            </Chip>
                          </TableCell>
                          <TableCell>
                            {a.is_automated_profiling ? (
                              <Chip size="sm" color="danger" variant="soft">{t('fadp.register.profiling_yes')}</Chip>
                            ) : (
                              <Chip size="sm" color="default" variant="soft">{t('fadp.common.no')}</Chip>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted">{a.retention_period}</span>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="tertiary"
                                isIconOnly
                                onPress={() => openEditActivity(a)}
                                aria-label={t('fadp.actions.edit')}
                              >
                                <RefreshCw size={14} />
                              </Button>
                              <Button
                                size="sm"
                                variant="tertiary"
                                color="danger"
                                isIconOnly
                                onPress={() => setDeleteTarget(a)}
                                aria-label={t('fadp.actions.delete')}
                              >
                                <Trash2 size={14} />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardBody>
              </Card>
            )}
          </div>
        </Tab>

        <Tab key="retention" title={<span className="flex items-center gap-2"><Database size={14} aria-hidden="true" />{t('fadp.tabs.retention')}</span>}>
          <div className="max-w-2xl space-y-6 pt-4">
            {retentionLoading ? (
              <div className="flex justify-center py-12" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner /></div>
            ) : (
              <>
                <Card >
                  <CardHeader>
                    <h3 className="text-base font-semibold">{t('fadp.retention.periods_title')}</h3>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    {retentionFields.map(({ key, labelKey, hintKey }) => (
                      <Input
                        key={key}
                        type="number"
                        label={t(labelKey)}
                        description={t(hintKey)}
                        min={1}
                        max={50}
                        value={String(retention.config[key])}
                        onValueChange={v =>
                          setRetention(r => ({
                            ...r,
                            config: { ...r.config, [key]: parseInt(v, 10) || 1 },
                          }))
                        }
                        variant="secondary"
                      />
                    ))}
                  </CardBody>
                </Card>

                <Card >
                  <CardHeader>
                    <h3 className="text-base font-semibold">{t('fadp.retention.residency_title')}</h3>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    <Select
                      label={t('fadp.retention.data_residency_label')}
                      selectedKeys={new Set([retention.data_residency])}
                      onSelectionChange={keys => {
                        const v = Array.from(keys)[0] as RetentionConfig['data_residency'];
                        setRetention(r => ({ ...r, data_residency: v }));
                      }}
                      variant="secondary"
                    >
                      {dataResidencyOptions.map(option => (
                        <SelectItem key={option} id={option}>{t(`fadp.data_residency.${option}`)}</SelectItem>
                      ))}
                    </Select>
                    <Input
                      label={t('fadp.retention.dpa_contact_label')}
                      description={t('fadp.retention.dpa_contact_description')}
                      type="email"
                      value={retention.dpa_contact_email ?? ''}
                      onValueChange={v => setRetention(r => ({ ...r, dpa_contact_email: v || null }))}
                      variant="secondary"
                    />
                  </CardBody>
                </Card>

                <Button
                  isLoading={retentionSaving}
                  onPress={() => void saveRetention()}
                >
                  {t('fadp.actions.save_configuration')}
                </Button>
              </>
            )}
          </div>
        </Tab>

        <Tab key="ledger" title={<span className="flex items-center gap-2"><ShieldCheck size={14} aria-hidden="true" />{t('fadp.tabs.ledger')}</span>}>
          <div className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-3xl text-sm text-muted">
                {t('fadp.ledger.description')}
              </p>
              <Button size="sm" variant="secondary" startContent={<Download size={14} />} onPress={() => void exportConsentCsv()}>
                {t('fadp.actions.export_ledger_csv')}
              </Button>
            </div>

            {consentLoading ? (
              <div className="flex justify-center py-12" role="status" aria-busy="true" aria-label={t('common.loading')}><Spinner /></div>
            ) : (
              <Card >
                <CardBody className="p-0">
                  <Table aria-label={t('fadp.ledger.table_aria')} removeWrapper>
                    <TableHeader>
                      <TableColumn>{t('fadp.ledger.columns.member_id')}</TableColumn>
                      <TableColumn>{t('fadp.ledger.columns.consent_type')}</TableColumn>
                      <TableColumn>{t('fadp.ledger.columns.action')}</TableColumn>
                      <TableColumn>{t('fadp.ledger.columns.ip_address')}</TableColumn>
                      <TableColumn>{t('fadp.ledger.columns.date')}</TableColumn>
                    </TableHeader>
                    <TableBody emptyContent={t('fadp.ledger.empty')}>
                      {consentRecords.slice(0, 200).map(r => (
                        <TableRow key={r.id}>
                          <TableCell>
                            <span className="font-mono text-sm text-muted">{r.user_id}</span>
                          </TableCell>
                          <TableCell>
                            <Chip size="sm" variant="soft">{r.consent_type}</Chip>
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="sm"
                              color={r.action === 'granted' ? 'success' : r.action === 'withdrawn' ? 'danger' : 'warning'}
                              variant="soft"
                            >
                              {consentActionLabel(r.action)}
                            </Chip>
                          </TableCell>
                          <TableCell>
                            <span className="font-mono text-xs text-muted">{r.ip_address ?? t('fadp.common.empty_dash')}</span>
                          </TableCell>
                          <TableCell>
                            <span className="text-sm text-muted">
                              {new Date(r.created_at).toLocaleString(getFormattingLocale())}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardBody>
              </Card>
            )}
            {consentRecords.length > 200 && (
              <p className="text-center text-xs text-muted">
                {t('fadp.ledger.truncated', { count: consentRecords.length })}
              </p>
            )}
          </div>
        </Tab>

        <Tab key="residency" title={<span className="flex items-center gap-2"><Globe size={14} aria-hidden="true" />{t('fadp.tabs.residency')}</span>}>
          <div className="max-w-2xl space-y-4 pt-4">
            <Card >
              <CardBody className="space-y-4 p-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-soft">
                    <Globe size={22} className="text-accent" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-[var(--color-text)]">{t('fadp.residency.title')}</h3>
                    <p className="text-sm text-muted">{t('fadp.residency.description')}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 rounded-lg bg-surface-secondary p-4">
                  <Chip
                    size="lg"
                    color={
                      retention.data_residency === 'Switzerland'
                        ? 'danger'
                        : retention.data_residency === 'EU'
                        ? 'primary'
                        : 'warning'
                    }
                    variant="soft"
                  >
                    {t(`fadp.data_residency.${retention.data_residency}`)}
                  </Chip>
                  <div className="text-sm text-muted">
                    {t(`fadp.residency.copy.${retention.data_residency}`)}
                  </div>
                </div>

                {retention.dpa_contact_email && (
                  <div className="text-sm text-muted">
                    <span className="font-medium">{t('fadp.residency.dpa_contact')}:</span>{' '}
                    <a
                      href={`mailto:${retention.dpa_contact_email}`}
                      className="text-accent hover:underline"
                    >
                      {retention.dpa_contact_email}
                    </a>
                  </div>
                )}

                <div className="space-y-2 border-t border-border pt-4 text-xs text-muted">
                  <p>
                    <span className="font-medium">{t('fadp.residency.article_16_label')}:</span>{' '}
                    {t('fadp.residency.article_16')}
                  </p>
                  <p>
                    <span className="font-medium">{t('fadp.residency.article_17_label')}:</span>{' '}
                    {t('fadp.residency.article_17')}
                  </p>
                  <p>
                    {t('fadp.residency.update_hint_prefix')}{' '}
                    <strong>{t('fadp.tabs.retention')}</strong>{' '}
                    {t('fadp.residency.update_hint_suffix')}
                  </p>
                </div>
              </CardBody>
            </Card>

            {registerData && (
              <Card >
                <CardBody className="space-y-2 p-6">
                  <h4 className="text-sm font-semibold">{t('fadp.summary.title')}</h4>
                  <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                    <div>
                      <span className="text-muted">{t('fadp.summary.total_activities')}:</span>{' '}
                      <span className="font-medium">{(registerData as { total_activities?: number }).total_activities ?? 0}</span>
                    </div>
                    <div>
                      <span className="text-muted">{t('fadp.summary.automated_profiling')}:</span>{' '}
                      <span className="font-medium text-danger-soft-foreground">
                        {(registerData as { automated_profiling_count?: number }).automated_profiling_count ?? 0}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted">{t('fadp.summary.tenant')}:</span>{' '}
                      <span className="font-medium">{(registerData as { tenant_name?: string }).tenant_name ?? t('fadp.common.empty_dash')}</span>
                    </div>
                    <div>
                      <span className="text-muted">{t('fadp.summary.generated')}:</span>{' '}
                      <span className="font-medium">{renderedGeneratedAt}</span>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}
          </div>
        </Tab>
      </Tabs>

      <Modal
        isOpen={activityModalOpen}
        onOpenChange={setActivityModalOpen}
        size="2xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {activityForm.id ? t('fadp.activity_modal.edit_title') : t('fadp.activity_modal.add_title')}
              </ModalHeader>
              <ModalBody className="space-y-4">
                <Input
                  label={t('fadp.activity_modal.fields.activity_name')}
                  isRequired
                  value={activityForm.activity_name}
                  onValueChange={v => setActivityForm(f => ({ ...f, activity_name: v }))}
                  variant="secondary"
                />
                <Textarea
                  label={t('fadp.activity_modal.fields.purpose')}
                  isRequired
                  description={t('fadp.activity_modal.hints.purpose')}
                  value={activityForm.purpose}
                  onValueChange={v => setActivityForm(f => ({ ...f, purpose: v }))}
                  variant="secondary"
                  minRows={2}
                />
                <Input
                  label={t('fadp.activity_modal.fields.data_categories')}
                  description={t('fadp.activity_modal.hints.data_categories')}
                  value={activityForm.data_categories}
                  onValueChange={v => setActivityForm(f => ({ ...f, data_categories: v }))}
                  variant="secondary"
                />
                <Input
                  label={t('fadp.activity_modal.fields.recipients')}
                  description={t('fadp.activity_modal.hints.recipients')}
                  value={activityForm.recipients}
                  onValueChange={v => setActivityForm(f => ({ ...f, recipients: v }))}
                  variant="secondary"
                />
                <Input
                  label={t('fadp.activity_modal.fields.retention_period')}
                  description={t('fadp.activity_modal.hints.retention_period')}
                  value={activityForm.retention_period}
                  onValueChange={v => setActivityForm(f => ({ ...f, retention_period: v }))}
                  variant="secondary"
                />
                <Select
                  label={t('fadp.activity_modal.fields.legal_basis')}
                  isRequired
                  selectedKeys={new Set([activityForm.legal_basis])}
                  onSelectionChange={keys => {
                    const v = Array.from(keys)[0] as string;
                    setActivityForm(f => ({ ...f, legal_basis: v }));
                  }}
                  variant="secondary"
                >
                  {legalBasisOptions.map(option => (
                    <SelectItem key={option} id={option}>{t(`fadp.legal_basis.${option}`)}</SelectItem>
                  ))}
                </Select>
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <div>
                    <p className="text-sm font-medium">{t('fadp.activity_modal.fields.automated_profiling')}</p>
                    <p className="text-xs text-muted">
                      {t('fadp.activity_modal.hints.automated_profiling')}
                    </p>
                  </div>
                  <Switch
                    isSelected={activityForm.is_automated_profiling}
                    onValueChange={v => setActivityForm(f => ({ ...f, is_automated_profiling: v }))}
                    color="danger"
                    aria-label={t('fadp.activity_modal.fields.automated_profiling')}
                  />
                </div>
                <Input
                  label={t('fadp.activity_modal.fields.sort_order')}
                  type="number"
                  value={activityForm.sort_order}
                  onValueChange={v => setActivityForm(f => ({ ...f, sort_order: v }))}
                  variant="secondary"
                  min={0}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('fadp.actions.cancel')}</Button>
                <Button
                  isLoading={activitySaving}
                  onPress={() => void saveActivity()}
                >
                  {activityForm.id ? t('fadp.actions.save_changes') : t('fadp.actions.add_activity')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <ConfirmModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void deleteActivity()}
        title={t('fadp.delete_modal.title')}
        message={t('fadp.delete_modal.message')}
        confirmLabel={t('fadp.actions.delete')}
        cancelLabel={t('fadp.actions.cancel')}
        confirmColor="danger"
        isLoading={activityDeleting}
      />
    </div>
  );
}

export default FadpAdminPage;
