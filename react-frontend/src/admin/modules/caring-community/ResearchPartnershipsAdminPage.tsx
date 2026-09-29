import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea, Select, SelectItem, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tooltip, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Database from 'lucide-react/icons/database';
import FileCheck2 from 'lucide-react/icons/file-check-2';
import FileText from 'lucide-react/icons/file-text';
import FlaskConical from 'lucide-react/icons/flask-conical';
import Info from 'lucide-react/icons/info';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import ShieldOff from 'lucide-react/icons/shield-off';
import { useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';
import { safeHref } from '@/lib/safeHref';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.


type PartnerStatus = 'draft' | 'active' | 'paused' | 'ended';

interface ResearchPartner {
  id: number;
  name: string;
  institution: string;
  contact_email: string | null;
  agreement_reference: string | null;
  methodology_url: string | null;
  status: PartnerStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

interface AgreementTemplateSummary {
  key: string;
  title: string;
  summary: string;
  suitable_for: string[];
  placeholders: string[];
}

interface AgreementTemplateRender {
  key: string;
  title: string;
  markdown: string;
  placeholders_used: string[];
  placeholders_missing: string[];
}

interface ResearchExport {
  id: number;
  partner_id: number;
  partner_name: string | null;
  partner_institution: string | null;
  dataset_key: string;
  period_start: string;
  period_end: string;
  status: 'generated' | 'superseded' | 'revoked';
  row_count: number;
  anonymization_version: string;
  data_hash: string;
  generated_at: string;
}

const statusColors: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'secondary'> = {
  active: 'success',
  draft: 'default',
  paused: 'warning',
  ended: 'secondary',
  generated: 'success',
  revoked: 'danger',
  superseded: 'warning',
};

function formatDate(value: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleDateString(getFormattingLocale());
}

export default function ResearchPartnershipsAdminPage() {
  const { t } = useTranslation('admin_caring_community');
  usePageTitle(t('research_partnerships.meta.title'));
  const { showToast } = useToast();

  const [partners, setPartners] = useState<ResearchPartner[]>([]);
  const [exports, setExports] = useState<ResearchExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerModalOpen, setPartnerModalOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [selectedPartnerId, setSelectedPartnerId] = useState<number | null>(null);
  const [workingId, setWorkingId] = useState<number | null>(null);

  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [agreementReference, setAgreementReference] = useState('');
  const [methodologyUrl, setMethodologyUrl] = useState('');
  const [status, setStatus] = useState<PartnerStatus>('draft');
  const [scope, setScope] = useState('caring_community_aggregate_v1');
  const [periodStart, setPeriodStart] = useState('2026-01-01');
  const [periodEnd, setPeriodEnd] = useState('2026-12-31');

  // AG65 — agreement templates
  const [templates, setTemplates] = useState<AgreementTemplateSummary[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [activeTemplate, setActiveTemplate] = useState<AgreementTemplateSummary | null>(null);
  const [templateValues, setTemplateValues] = useState<Record<string, string>>({});
  const [renderedTemplate, setRenderedTemplate] = useState<AgreementTemplateRender | null>(null);
  const [renderingTemplate, setRenderingTemplate] = useState(false);

  const activePartners = useMemo(
    () => partners.filter((partner) => partner.status === 'active'),
    [partners],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [partnerResponse, exportResponse, templatesResponse] = await Promise.all([
        api.get<{ partners: ResearchPartner[] }>('/v2/admin/caring-community/research/partners'),
        api.get<{ exports: ResearchExport[] }>('/v2/admin/caring-community/research/dataset-exports'),
        api.get<{ templates: AgreementTemplateSummary[] }>('/v2/admin/caring-community/research/agreement-templates'),
      ]);

      if (partnerResponse.success) {
        setPartners(partnerResponse.data?.partners ?? []);
      }
      if (exportResponse.success) {
        setExports(exportResponse.data?.exports ?? []);
      }
      if (templatesResponse.success) {
        setTemplates(templatesResponse.data?.templates ?? []);
      }
    } catch {
      showToast(t('research_partnerships.toasts.load_failed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  const openTemplate = useCallback((template: AgreementTemplateSummary) => {
    setActiveTemplate(template);
    const initialValues: Record<string, string> = {};
    template.placeholders.forEach((p) => {
      initialValues[p] = '';
    });
    setTemplateValues(initialValues);
    setRenderedTemplate(null);
    setTemplateModalOpen(true);
  }, []);

  const renderTemplate = useCallback(async () => {
    if (!activeTemplate) return;
    setRenderingTemplate(true);
    try {
      const response = await api.post<AgreementTemplateRender>(
        `/v2/admin/caring-community/research/agreement-templates/${encodeURIComponent(activeTemplate.key)}/render`,
        { values: templateValues },
      );
      if (response.success && response.data) {
        setRenderedTemplate(response.data);
      } else {
        showToast(t('research_partnerships.toasts.render_template_failed'), 'error');
      }
    } catch {
      showToast(t('research_partnerships.toasts.render_template_failed'), 'error');
    } finally {
      setRenderingTemplate(false);
    }
  }, [activeTemplate, templateValues, showToast, t]);

  const downloadRendered = useCallback(() => {
    if (!renderedTemplate) return;
    const blob = new Blob([renderedTemplate.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${renderedTemplate.key}-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [renderedTemplate]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetPartnerForm = () => {
    setName('');
    setInstitution('');
    setContactEmail('');
    setAgreementReference('');
    setMethodologyUrl('');
    setStatus('draft');
    setScope('caring_community_aggregate_v1');
  };

  const createPartner = useCallback(async () => {
    const response = await api.post<ResearchPartner>('/v2/admin/caring-community/research/partners', {
      name,
      institution,
      contact_email: contactEmail || null,
      agreement_reference: agreementReference || null,
      methodology_url: methodologyUrl || null,
      status,
      data_scope: { datasets: scope.split(',').map((item) => item.trim()).filter(Boolean) },
    });

    if (!response.success) {
      showToast(t('research_partnerships.toasts.create_partner_failed'), 'error');
      return;
    }

    showToast(t('research_partnerships.toasts.partner_created'), 'success');
    setPartnerModalOpen(false);
    resetPartnerForm();
    await load();
  }, [agreementReference, contactEmail, institution, load, methodologyUrl, name, scope, showToast, status, t]);

  const generateExport = useCallback(async () => {
    if (!selectedPartnerId) return;

    setWorkingId(selectedPartnerId);
    const response = await api.post(
      `/v2/admin/caring-community/research/partners/${selectedPartnerId}/dataset-exports`,
      {
        period_start: periodStart,
        period_end: periodEnd,
      },
    );
    setWorkingId(null);

    if (!response.success) {
      showToast(t('research_partnerships.toasts.generate_export_failed'), 'error');
      return;
    }

    showToast(t('research_partnerships.toasts.export_generated'), 'success');
    setExportModalOpen(false);
    await load();
  }, [load, periodEnd, periodStart, selectedPartnerId, showToast, t]);

  const revokeExport = useCallback(async (exportId: number) => {
    setWorkingId(exportId);
    const response = await api.post(`/v2/admin/caring-community/research/dataset-exports/${exportId}/revoke`);
    setWorkingId(null);

    if (!response.success) {
      showToast(t('research_partnerships.toasts.revoke_export_failed'), 'error');
      return;
    }

    showToast(t('research_partnerships.toasts.export_revoked'), 'success');
    await load();
  }, [load, showToast, t]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('research_partnerships.meta.title')}
        subtitle={t('research_partnerships.meta.subtitle')}
        icon={<FlaskConical size={20} />}
        actions={
          <div className="flex items-center gap-2">
            <Tooltip content={t('research_partnerships.actions.refresh')}>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                onPress={() => void load()}
                isLoading={loading}
                aria-label={t('research_partnerships.actions.refresh_aria')}
              >
                <RefreshCw size={15} />
              </Button>
            </Tooltip>
            <Button size="sm" variant="secondary" startContent={<Database size={15} />} onPress={() => setExportModalOpen(true)}>
              {t('research_partnerships.actions.generate_export')}
            </Button>
            <Button size="sm" startContent={<Plus size={15} />} onPress={() => setPartnerModalOpen(true)}>
              {t('research_partnerships.actions.add_partner')}
            </Button>
          </div>
        }
      />

      {/* Intro card */}
      <Card className="border-l-4 border-l-accent bg-accent-soft dark:bg-accent-soft">
        <CardBody className="px-4 py-3">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-accent dark:text-accent">{t('research_partnerships.about.title')}</p>
              <p className="text-foreground">
                {t('research_partnerships.about.body')}
              </p>
              <div className="space-y-0.5 pt-1 text-muted">
                <p>
                  <strong>{t('research_partnerships.about.data_scope_label')}</strong>{' '}
                  {t('research_partnerships.about.data_scope_body')}
                </p>
                <p>
                  <strong>{t('research_partnerships.about.download_history_label')}</strong>{' '}
                  {t('research_partnerships.about.download_history_body')}
                </p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <FlaskConical size={18} className="text-accent" />
          <span className="font-semibold">{t('research_partnerships.partners.title')}</span>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-10"><Spinner /></div>
          ) : (
            <Table aria-label={t('research_partnerships.partners.table_aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('research_partnerships.columns.partner')}</TableColumn>
                <TableColumn>{t('research_partnerships.columns.status')}</TableColumn>
                <TableColumn>{t('research_partnerships.columns.agreement')}</TableColumn>
                <TableColumn>{t('research_partnerships.columns.methodology')}</TableColumn>
                <TableColumn>{t('research_partnerships.columns.created')}</TableColumn>
              </TableHeader>
              <TableBody emptyContent={t('research_partnerships.partners.empty')}>
                {partners.map((partner) => (
                  <TableRow key={partner.id}>
                    <TableCell>
                      <div className="font-medium">{partner.name}</div>
                      <div className="text-xs text-muted">{partner.institution}</div>
                      {partner.contact_email && <div className="text-xs text-muted">{partner.contact_email}</div>}
                    </TableCell>
                    <TableCell>
                      <Chip size="sm" color={statusColors[partner.status] ?? 'default'} variant="soft">
                        {t(`research_partnerships.statuses.${partner.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>{partner.agreement_reference || '-'}</TableCell>
                    <TableCell>
                      {partner.methodology_url ? (
                        <a className="text-accent text-sm" href={safeHref(partner.methodology_url)} target="_blank" rel="noreferrer">
                          {t('research_partnerships.actions.view')}
                        </a>
                      ) : '-'}
                    </TableCell>
                    <TableCell>{formatDate(partner.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <FileText size={18} className="text-accent" />
          <span className="font-semibold">{t('research_partnerships.templates.title')}</span>
          <span className="text-xs text-muted font-normal ml-2">
            {t('research_partnerships.templates.subtitle')}
          </span>
        </CardHeader>
        <CardBody>
          {templates.length === 0 ? (
            <p className="text-sm text-muted">{t('research_partnerships.templates.empty')}</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((template) => (
                <div
                  key={template.key}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm">{template.title}</p>
                      <p className="text-xs text-muted mt-1">{template.summary}</p>
                    </div>
                  </div>
                  {template.suitable_for.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {template.suitable_for.map((s) => (
                        <Chip key={s} size="sm" variant="soft" color="default">
                          {s}
                        </Chip>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between mt-2.5">
                    <span className="text-xs text-muted">
                      {t('research_partnerships.templates.placeholder_count', { count: template.placeholders.length })}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => openTemplate(template)}
                    >
                      {t('research_partnerships.actions.open')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center gap-2">
          <FileCheck2 size={18} className="text-accent" />
          <span className="font-semibold">{t('research_partnerships.exports.title')}</span>
        </CardHeader>
        <CardBody className="p-0">
          <Table aria-label={t('research_partnerships.exports.table_aria')} removeWrapper>
            <TableHeader>
              <TableColumn>{t('research_partnerships.columns.partner')}</TableColumn>
              <TableColumn>{t('research_partnerships.columns.period')}</TableColumn>
              <TableColumn>{t('research_partnerships.columns.status')}</TableColumn>
              <TableColumn>{t('research_partnerships.columns.rows')}</TableColumn>
              <TableColumn>{t('research_partnerships.columns.hash')}</TableColumn>
              <TableColumn>{t('research_partnerships.columns.actions')}</TableColumn>
            </TableHeader>
            <TableBody emptyContent={t('research_partnerships.exports.empty')}>
              {exports.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <div className="font-medium">
                      {item.partner_name || t('research_partnerships.exports.partner_fallback', { id: item.partner_id })}
                    </div>
                    <div className="text-xs text-muted">{item.partner_institution || item.dataset_key}</div>
                  </TableCell>
                  <TableCell>{formatDate(item.period_start)} - {formatDate(item.period_end)}</TableCell>
                  <TableCell>
                    <Chip size="sm" color={statusColors[item.status] ?? 'default'} variant="soft">
                      {t(`research_partnerships.statuses.${item.status}`)}
                    </Chip>
                  </TableCell>
                  <TableCell>{item.row_count}</TableCell>
                  <TableCell>
                    <code className="text-xs">{item.data_hash.slice(0, 12)}...</code>
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="danger"
                      startContent={<ShieldOff size={13} />}
                      isDisabled={item.status === 'revoked'}
                      isLoading={workingId === item.id}
                      onPress={() => void revokeExport(item.id)}
                    >
                      {t('research_partnerships.actions.revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardBody>
      </Card>

      <Modal isOpen={partnerModalOpen} onOpenChange={setPartnerModalOpen} size="2xl">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('research_partnerships.partner_modal.title')}</ModalHeader>
              <ModalBody>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input label={t('research_partnerships.fields.name')} value={name} onValueChange={setName} isRequired />
                  <Input
                    label={t('research_partnerships.fields.institution')}
                    value={institution}
                    onValueChange={setInstitution}
                    isRequired
                  />
                  <Input
                    label={t('research_partnerships.fields.contact_email')}
                    value={contactEmail}
                    onValueChange={setContactEmail}
                    type="email"
                  />
                  <Input
                    label={t('research_partnerships.fields.agreement_reference')}
                    value={agreementReference}
                    onValueChange={setAgreementReference}
                  />
                  <Input
                    label={t('research_partnerships.fields.methodology_url')}
                    value={methodologyUrl}
                    onValueChange={setMethodologyUrl}
                    className="md:col-span-2"
                  />
                  <Select
                    label={t('research_partnerships.fields.status')}
                    selectedKeys={[status]}
                    onChange={(event) => setStatus(event.target.value as PartnerStatus)}
                  >
                    {['draft', 'active', 'paused', 'ended'].map((item) => (
                      <SelectItem key={item} id={item}>{t(`research_partnerships.statuses.${item}`)}</SelectItem>
                    ))}
                  </Select>
                  <Textarea
                    label={t('research_partnerships.fields.dataset_scope')}
                    value={scope}
                    onValueChange={setScope}
                    className="md:col-span-2"
                    description={t('research_partnerships.fields.dataset_scope_description')}
                  />
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close}>{t('research_partnerships.actions.cancel')}</Button>
                <Button onPress={() => void createPartner()} isDisabled={!name.trim() || !institution.trim()}>
                  {t('research_partnerships.actions.create')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal isOpen={templateModalOpen} onOpenChange={setTemplateModalOpen} size="3xl" scrollBehavior="inside">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>
                {activeTemplate?.title ?? t('research_partnerships.templates.fallback_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                {activeTemplate && (
                  <>
                    <p className="text-sm text-muted">{activeTemplate.summary}</p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {activeTemplate.placeholders.map((p) => (
                        <Input
                          key={p}
                          label={t(`research_partnerships.templates.placeholders.${p}`, {
                            defaultValue: t('research_partnerships.templates.placeholders.unknown'),
                          })}
                          size="sm"
                          value={templateValues[p] ?? ''}
                          onValueChange={(v) =>
                            setTemplateValues((prev) => ({ ...prev, [p]: v }))
                          }
                        />
                      ))}
                    </div>
                    {renderedTemplate && (
                      <div className="rounded-lg border border-border bg-surface-secondary p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold">
                            {t('research_partnerships.templates.rendered_markdown', { count: renderedTemplate.markdown.length })}
                          </span>
                          {renderedTemplate.placeholders_missing.length > 0 && (
                            <Chip size="sm" color="warning" variant="soft">
                              {t('research_partnerships.templates.missing_placeholder_count', {
                                count: renderedTemplate.placeholders_missing.length,
                              })}
                            </Chip>
                          )}
                        </div>
                        <pre className="text-xs whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">
                          {renderedTemplate.markdown}
                        </pre>
                      </div>
                    )}
                  </>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close}>{t('research_partnerships.actions.close')}</Button>
                {renderedTemplate && (
                  <Button variant="secondary" onPress={downloadRendered}>
                    {t('research_partnerships.actions.download_markdown')}
                  </Button>
                )}
                <Button onPress={() => void renderTemplate()} isLoading={renderingTemplate}>
                  {renderedTemplate ? t('research_partnerships.actions.rerender') : t('research_partnerships.actions.render')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal isOpen={exportModalOpen} onOpenChange={setExportModalOpen} size="md">
        <ModalContent>
          {(close) => (
            <>
              <ModalHeader>{t('research_partnerships.export_modal.title')}</ModalHeader>
              <ModalBody>
                <Select
                  label={t('research_partnerships.export_modal.active_partner')}
                  selectedKeys={selectedPartnerId ? [String(selectedPartnerId)] : []}
                  onChange={(event) => setSelectedPartnerId(Number(event.target.value) || null)}
                >
                  {activePartners.map((partner) => (
                    <SelectItem key={String(partner.id)} id={String(partner.id)}>{partner.name}</SelectItem>
                  ))}
                </Select>
                <div className="grid grid-cols-2 gap-3">
                  <Input
                    label={t('research_partnerships.fields.period_start')}
                    type="date"
                    value={periodStart}
                    onValueChange={setPeriodStart}
                  />
                  <Input
                    label={t('research_partnerships.fields.period_end')}
                    type="date"
                    value={periodEnd}
                    onValueChange={setPeriodEnd}
                  />
                </div>
                <p className="text-xs text-muted">
                  {t('research_partnerships.export_modal.privacy_note')}
                </p>
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={close}>{t('research_partnerships.actions.cancel')}</Button>
                <Button onPress={() => void generateExport()} isDisabled={!selectedPartnerId} isLoading={workingId === selectedPartnerId}>
                  {t('research_partnerships.actions.generate')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
