import { CardBody, Card, Button, Chip, Spinner, Input, Textarea, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Switch, Tabs, Tab, Table, TableBody, TableCell, TableColumn, TableHeader, TableRow, useConfirm } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AG60 — Admin: API Partners management.
 *
 * Tenant admins use this page to provision Partner API integrations
 * (banks, payment processors, municipal admin systems), suspend or
 * activate them, regenerate client credentials, and inspect the
 * recent call log per partner.
 *
 * Backed by `/api/v2/admin/api-partners/*` (ApiPartnerAdminController).
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import Eye from 'lucide-react/icons/eye';
import Copy from 'lucide-react/icons/copy';
import Key from 'lucide-react/icons/key';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { BrokerEmptyState } from '@/broker/components';
import { PageHeader } from '../../components/PageHeader';
import { PartnerTimebankGuidance } from '../federation/PartnerTimebankGuidance';

// ─── Types ────────────────────────────────────────────────────────────────

interface ApiPartner {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  contact_email: string | null;
  status: 'pending' | 'active' | 'suspended';
  is_sandbox: boolean;
  allowed_scopes: string[];
  allowed_ip_cidrs: string[];
  rate_limit_per_minute: number;
  created_at: string | null;
  updated_at: string | null;
}

interface IssuedCredentials {
  client_id: string;
  client_secret: string;
}

interface CallLogEntry {
  id: number;
  method: string;
  path: string;
  status_code: number;
  response_time_ms: number;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

const ALL_SCOPES = [
  'users.read',
  'users.pii',
  'listings.read',
  'wallet.read',
  'wallet.write',
  'aggregates.read',
  'webhooks.manage',
];

const statusColor = (s: ApiPartner['status']): 'success' | 'warning' | 'danger' => {
  if (s === 'active') return 'success';
  if (s === 'suspended') return 'danger';
  return 'warning';
};

// ─── Component ────────────────────────────────────────────────────────────

export default function ApiPartnersAdminPage() {
  const { t } = useTranslation(['admin_api_partners', 'common']);
  usePageTitle(t('api_partners.meta.title'));
  const toast = useToast();
  const confirm = useConfirm();

  const [partners, setPartners] = useState<ApiPartner[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [credsModal, setCredsModal] = useState<IssuedCredentials | null>(null);
  const [detailPartner, setDetailPartner] = useState<ApiPartner | null>(null);
  const [callLog, setCallLog] = useState<CallLogEntry[]>([]);
  const [callLogLoading, setCallLogLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ partners: ApiPartner[] }>('/v2/admin/api-partners');
      setPartners(res.data?.partners ?? []);
    } catch {
      toast.error(t('api_partners.toasts.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSuspend = async (id: number) => {
    try {
      const res = await api.post(`/v2/admin/api-partners/${id}/suspend`);
      if (res.success) {
        toast.success(t('api_partners.toasts.suspended'));
        void load();
      } else {
        toast.error(t('api_partners.toasts.suspend_failed'));
      }
    } catch {
      toast.error(t('api_partners.toasts.suspend_failed'));
    }
  };

  const handleActivate = async (id: number) => {
    try {
      const res = await api.post(`/v2/admin/api-partners/${id}/activate`);
      if (res.success) {
        toast.success(t('api_partners.toasts.activated'));
        void load();
      } else {
        toast.error(t('api_partners.toasts.activate_failed'));
      }
    } catch {
      toast.error(t('api_partners.toasts.activate_failed'));
    }
  };

  const handleRegenerate = async (id: number) => {
    const ok = await confirm({
      title: t('api_partners.confirm.regenerate_credentials'),
      status: 'warning',
      confirmLabel: t('common:confirm'),
    });
    if (!ok) return;
    try {
      const res = await api.post<{ credentials: IssuedCredentials }>(
        `/v2/admin/api-partners/${id}/regenerate-credentials`,
      );
      if (res.data?.credentials) setCredsModal(res.data.credentials);
    } catch {
      toast.error(t('api_partners.toasts.regenerate_failed'));
    }
  };

  const openDetail = async (partner: ApiPartner) => {
    setDetailPartner(partner);
    setCallLogLoading(true);
    try {
      const res = await api.get<{ items: CallLogEntry[] }>(
        `/v2/admin/api-partners/${partner.id}/call-log?per_page=50`,
      );
      setCallLog(res.data?.items ?? []);
    } catch {
      setCallLog([]);
    } finally {
      setCallLogLoading(false);
    }
  };

  return (
    <div className="p-6">
      <PageHeader
        title={t('api_partners.header.title')}
        description={t('api_partners.header.description')}
        actions={
          <Button startContent={<Plus size={16} />} onPress={() => setCreateOpen(true)}>
            {t('api_partners.actions.new_partner')}
          </Button>
        }
      />

      <PartnerTimebankGuidance page="apiPartners" />

      <Card >
        <CardBody className="p-0">
          {loading ? (
            <div className="p-10 flex justify-center">
              <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
            </div>
          ) : partners.length === 0 ? (
            <BrokerEmptyState bare icon={Key} title={t('api_partners.empty.no_partners')} />
          ) : (
            <Table aria-label={t('api_partners.table.aria')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('api_partners.columns.name')}</TableColumn>
                <TableColumn>{t('api_partners.columns.slug')}</TableColumn>
                <TableColumn>{t('api_partners.columns.status')}</TableColumn>
                <TableColumn>{t('api_partners.columns.sandbox')}</TableColumn>
                <TableColumn>{t('api_partners.columns.rate_limit')}</TableColumn>
                <TableColumn>{t('api_partners.columns.scopes')}</TableColumn>
                <TableColumn>{t('api_partners.columns.actions')}</TableColumn>
              </TableHeader>
              <TableBody>
                {partners.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="font-mono text-xs">{p.slug}</TableCell>
                    <TableCell>
                      <Chip size="sm" color={statusColor(p.status)} variant="soft">
                        {t(`api_partners.status.${p.status}`)}
                      </Chip>
                    </TableCell>
                    <TableCell>{p.is_sandbox ? t('api_partners.common.yes') : t('api_partners.common.no')}</TableCell>
                    <TableCell>{t('api_partners.common.per_minute', { value: p.rate_limit_per_minute })}</TableCell>
                    <TableCell className="text-xs">{p.allowed_scopes.join(', ') || t('api_partners.common.empty_dash')}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="tertiary"
                          isIconOnly
                          aria-label={t('api_partners.actions.view_call_log')}
                          onPress={() => openDetail(p)}
                        >
                          <Eye size={16} />
                        </Button>
                        <Button
                          size="sm"
                          variant="tertiary"
                          isIconOnly
                          aria-label={t('api_partners.actions.regenerate_credentials')}
                          onPress={() => handleRegenerate(p.id)}
                        >
                          <RefreshCw size={16} />
                        </Button>
                        {p.status === 'active' ? (
                          <Button
                            size="sm"
                            variant="tertiary"
                            isIconOnly
                            aria-label={t('api_partners.actions.suspend')}
                            onPress={() => handleSuspend(p.id)}
                          >
                            <Pause size={16} />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="tertiary"
                            isIconOnly
                            aria-label={t('api_partners.actions.activate')}
                            onPress={() => handleActivate(p.id)}
                          >
                            <Play size={16} />
                          </Button>
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

      <CreatePartnerModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(creds) => {
          setCreateOpen(false);
          setCredsModal(creds);
          void load();
        }}
      />

      <CredentialsModal credentials={credsModal} onClose={() => setCredsModal(null)} />

      <Modal isOpen={detailPartner !== null} onClose={() => setDetailPartner(null)} size="3xl">
        <ModalContent>
          <ModalHeader>
            {detailPartner?.name} <span className="text-sm text-[var(--color-text-muted)] ml-2">{detailPartner?.slug}</span>
          </ModalHeader>
          <ModalBody>
            <Tabs aria-label={t('api_partners.detail.tabs_aria')}>
              <Tab key="info" title={t('api_partners.detail.info_tab')}>
                <div className="text-sm space-y-2">
                  <div><strong>{t('api_partners.detail.status')}</strong> {detailPartner ? t(`api_partners.status.${detailPartner.status}`) : t('api_partners.common.empty_dash')}</div>
                  <div><strong>{t('api_partners.detail.sandbox')}</strong> {detailPartner?.is_sandbox ? t('api_partners.common.yes') : t('api_partners.common.no')}</div>
                  <div><strong>{t('api_partners.detail.rate_limit')}</strong> {t('api_partners.common.per_minute', { value: detailPartner?.rate_limit_per_minute ?? 0 })}</div>
                  <div><strong>{t('api_partners.detail.scopes')}</strong> {detailPartner?.allowed_scopes.join(', ') || t('api_partners.common.empty_dash')}</div>
                  <div><strong>{t('api_partners.detail.ip_allowlist')}</strong> {detailPartner?.allowed_ip_cidrs.join(', ') || t('api_partners.common.any')}</div>
                  <div><strong>{t('api_partners.detail.contact')}</strong> {detailPartner?.contact_email || t('api_partners.common.empty_dash')}</div>
                </div>
              </Tab>
              <Tab key="log" title={t('api_partners.detail.call_log_tab')}>
                {callLogLoading ? (
                  <div className="p-6 flex justify-center">
                    <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner /></div>
                  </div>
                ) : callLog.length === 0 ? (
                  <BrokerEmptyState bare icon={Eye} title={t('api_partners.empty.no_calls')} />
                ) : (
                  <Table aria-label={t('api_partners.call_log.table_aria')} removeWrapper>
                    <TableHeader>
                      <TableColumn>{t('api_partners.call_log.columns.when')}</TableColumn>
                      <TableColumn>{t('api_partners.call_log.columns.method')}</TableColumn>
                      <TableColumn>{t('api_partners.call_log.columns.path')}</TableColumn>
                      <TableColumn>{t('api_partners.call_log.columns.status')}</TableColumn>
                      <TableColumn>{t('api_partners.call_log.columns.duration')}</TableColumn>
                    </TableHeader>
                    <TableBody>
                      {callLog.map((c) => (
                        <TableRow key={c.id}>
                          <TableCell className="text-xs">{c.created_at}</TableCell>
                          <TableCell>
                            <Chip size="sm" variant="soft">{c.method}</Chip>
                          </TableCell>
                          <TableCell className="font-mono text-xs">{c.path}</TableCell>
                          <TableCell>{c.status_code}</TableCell>
                          <TableCell>{t('api_partners.common.milliseconds', { value: c.response_time_ms })}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Tab>
            </Tabs>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setDetailPartner(null)}>
              {t('api_partners.actions.close')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

// ─── Create modal ─────────────────────────────────────────────────────────

function CreatePartnerModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (creds: IssuedCredentials) => void;
}) {
  const { t } = useTranslation('admin_api_partners');
  const toast = useToast();
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [description, setDescription] = useState('');
  const [scopes, setScopes] = useState<string[]>(['users.read']);
  const [rateLimit, setRateLimit] = useState('60');
  const [sandbox, setSandbox] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setName('');
    setContactEmail('');
    setDescription('');
    setScopes(['users.read']);
    setRateLimit('60');
    setSandbox(true);
  }, []);

  const handleSubmit = async () => {
    if (!name.trim()) {
      toast.error(t('api_partners.toasts.name_required'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await api.post<{ partner_id: number; credentials: IssuedCredentials }>(
        '/v2/admin/api-partners',
        {
          name: name.trim(),
          contact_email: contactEmail.trim() || null,
          description: description.trim() || null,
          allowed_scopes: scopes,
          rate_limit_per_minute: Number(rateLimit) || 60,
          is_sandbox: sandbox,
        },
      );
      if (!res.data?.credentials) {
        toast.error(t('api_partners.toasts.create_failed'));
        return;
      }
      reset();
      onCreated(res.data.credentials);
    } catch {
      toast.error(t('api_partners.toasts.create_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      <ModalContent>
        <ModalHeader>{t('api_partners.create_modal.title')}</ModalHeader>
        <ModalBody>
          <div className="space-y-4">
            <Input
              label={t('api_partners.create_modal.name')}
              value={name}
              onValueChange={setName}
              placeholder={t('api_partners.create_modal.name_placeholder')}
              isRequired
            />
            <Input
              label={t('api_partners.create_modal.contact_email')}
              value={contactEmail}
              onValueChange={setContactEmail}
              placeholder={t('api_partners.create_modal.contact_email_placeholder')}
              type="email"
            />
            <Textarea
              label={t('api_partners.create_modal.description')}
              value={description}
              onValueChange={setDescription}
              minRows={2}
            />
            <div>
              <label className="text-sm font-medium block mb-2">{t('api_partners.create_modal.allowed_scopes')}</label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map((s) => (
                  <Chip
                    key={s}
                    variant={scopes.includes(s) ? 'solid' : 'flat'}
                    color={scopes.includes(s) ? 'primary' : 'default'}
                    onClick={() => toggleScope(s)}
                    className="cursor-pointer"
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            </div>
            <Input
              label={t('api_partners.create_modal.rate_limit')}
              value={rateLimit}
              onValueChange={setRateLimit}
              type="number"
              min={1}
              max={6000}
            />
            <Switch isSelected={sandbox} onValueChange={setSandbox}>
              {t('api_partners.create_modal.sandbox_mode')}
            </Switch>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="tertiary" onPress={onClose} isDisabled={submitting}>
            {t('api_partners.actions.cancel')}
          </Button>
          <Button onPress={handleSubmit} isLoading={submitting}>
            {t('api_partners.create_modal.submit')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

// ─── Credentials reveal modal ─────────────────────────────────────────────

function CredentialsModal({
  credentials,
  onClose,
}: {
  credentials: IssuedCredentials | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('admin_api_partners');
  const toast = useToast();

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('api_partners.toasts.copied', { label }));
    } catch {
      toast.error(t('api_partners.toasts.copy_failed'));
    }
  };

  return (
    <Modal isOpen={credentials !== null} onClose={onClose} size="2xl" isDismissable={false}>
      <ModalContent>
        <ModalHeader className="flex items-center gap-2">
          <Key size={18} /> {t('api_partners.credentials_modal.title')}
        </ModalHeader>
        <ModalBody>
          <div className="bg-warning/10 border border-warning/30 rounded p-3 text-sm mb-4">
            <strong>{t('api_partners.credentials_modal.warning_title')}</strong> {t('api_partners.credentials_modal.warning_body')}
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-[var(--color-text-muted)] block mb-1">{t('api_partners.credentials_modal.client_id')}</label>
              <div className="flex gap-2">
                <Input value={credentials?.client_id ?? ''} readOnly className="font-mono" aria-label={t('api_partners.credentials_modal.client_id')} />
                <Button
                  isIconOnly
                  variant="tertiary"
                  aria-label={t('api_partners.credentials_modal.copy_client_id')}
                  onPress={() => credentials && copy(credentials.client_id, t('api_partners.credentials_modal.client_id'))}
                >
                  <Copy size={16} />
                </Button>
              </div>
            </div>
            <div>
              <label className="text-xs text-[var(--color-text-muted)] block mb-1">{t('api_partners.credentials_modal.client_secret')}</label>
              <div className="flex gap-2">
                <Input value={credentials?.client_secret ?? ''} readOnly className="font-mono" aria-label={t('api_partners.credentials_modal.client_secret')} />
                <Button
                  isIconOnly
                  variant="tertiary"
                  aria-label={t('api_partners.credentials_modal.copy_client_secret')}
                  onPress={() => credentials && copy(credentials.client_secret, t('api_partners.credentials_modal.client_secret'))}
                >
                  <Copy size={16} />
                </Button>
              </div>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button onPress={onClose}>
            {t('api_partners.credentials_modal.saved_button')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
