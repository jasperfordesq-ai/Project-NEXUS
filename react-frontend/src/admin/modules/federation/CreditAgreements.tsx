// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody, CardHeader, Button, Spinner, Chip, Input, Select, SelectItem, useDisclosure, Progress, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Tabs, Tab, Table, TableHeader, TableColumn, TableBody, TableRow, TableCell } from '@/components/ui';
import { useState, useEffect, useCallback, useRef } from 'react';

import Handshake from 'lucide-react/icons/handshake';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import XCircle from 'lucide-react/icons/circle-x';
import Pause from 'lucide-react/icons/pause';
import Play from 'lucide-react/icons/play';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Clock from 'lucide-react/icons/clock';
import TrendingUp from 'lucide-react/icons/trending-up';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Eye from 'lucide-react/icons/eye';
import Wallet from 'lucide-react/icons/wallet';
import BarChart3 from 'lucide-react/icons/chart-column';
import ArrowUpRight from 'lucide-react/icons/arrow-up-right';
import ArrowDownRight from 'lucide-react/icons/arrow-down-right';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { adminFederation } from '../../api/adminApi';
import { logError } from '@/lib/logger';
import { formatPercentRatio, formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { ConfirmModal } from '../../components/ConfirmModal';
import { BrokerEmptyState, BrokerStatusChip } from '@/broker/components';
import { useTranslation } from 'react-i18next';
import { PartnerTimebankGuidance } from './PartnerTimebankGuidance';

/**
 * Federation Credit Agreements (FD1)
 * Admin page for managing inter-tenant credit exchange agreements.
 * Features: Create, approve, suspend, terminate agreements. View balances, * settlement view, transaction history, agreement detail modal.
 */


// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CreditAgreement {
  id: number;
  partner_tenant?: {
    id: number;
    name: string;
    slug: string;
  };
  // Alternate shape from FederationCreditService
  from_tenant_id?: number;
  from_tenant_name?: string;
  from_tenant_slug?: string;
  to_tenant_id?: number;
  to_tenant_name?: string;
  to_tenant_slug?: string;
  exchange_rate: number;
  monthly_limit?: number;
  max_monthly_credits?: number | null;
  /** null = the server could not work the figure out (never shown as 0). */
  current_balance?: number | null;
  status: 'pending' | 'active' | 'suspended' | 'terminated';
  /** For a pending agreement: whose approval it is still waiting for. */
  awaiting?: 'you' | 'partner' | null;
  credits_sent?: number | null;
  credits_received?: number | null;
  created_at: string;
  updated_at?: string;
  approved_at?: string;
}

interface PartnerTenant {
  id: number;
  name: string;
  slug: string;
}

interface CreditBalance {
  agreement_id: number;
  partner_tenant_id: number;
  partner_name: string;
  credits_sent: number;
  credits_received: number;
  net_balance: number;
}

interface AgreementTransaction {
  id: number;
  sender_tenant_id: number;
  receiver_tenant_id: number;
  sender_tenant_name?: string;
  receiver_tenant_name?: string;
  amount: number;
  description?: string;
  status: string;
  created_at: string;
  completed_at?: string;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helpers
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function getPartnerName(agreement: CreditAgreement, unknownLabel: string): string {
  if (agreement.partner_tenant?.name) return agreement.partner_tenant.name;
  return agreement.to_tenant_name || agreement.from_tenant_name || unknownLabel;
}

/** The partner community's id, whichever side of the agreement proposed it. */
function getPartnerId(agreement: CreditAgreement): number | null {
  return agreement.partner_tenant?.id ?? null;
}

/** A credit figure for display; an unknown figure is a dash, never a made-up 0. */
function formatCredits(value: number | null | undefined): string {
  return typeof value === 'number' ? String(value) : '—';
}

function getPartnerSlug(agreement: CreditAgreement): string {
  if (agreement.partner_tenant?.slug) return agreement.partner_tenant.slug;
  return agreement.to_tenant_slug || agreement.from_tenant_slug || '';
}

function getMonthlyLimit(agreement: CreditAgreement): number | null {
  return agreement.monthly_limit ?? agreement.max_monthly_credits ?? null;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Component
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function CreditAgreements() {
  const { t } = useTranslation('admin_federation');
  usePageTitle(t('federation.page_title'));
  const toast = useToast();
  const createModal = useDisclosure();
  const detailModal = useDisclosure();

  const [agreements, setAgreements] = useState<CreditAgreement[]>([]);
  const [partners, setPartners] = useState<PartnerTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('agreements');

  // Create form
  const [selectedPartner, setSelectedPartner] = useState('');
  const [exchangeRate, setExchangeRate] = useState('1.0');
  const [monthlyLimit, setMonthlyLimit] = useState('100');
  const [creating, setCreating] = useState(false);

  // Balances
  const [balances, setBalances] = useState<CreditBalance[]>([]);
  const [netTotal, setNetTotal] = useState(0);
  const [balancesLoading, setBalancesLoading] = useState(false);

  // Confirm modal for destructive actions
  const [pendingAction, setPendingAction] = useState<{
    agreementId: number;
    action: 'suspend' | 'terminate';
    partnerName: string;
  } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // AbortController for cancelling in-flight requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Detail modal state
  const [selectedAgreement, setSelectedAgreement] = useState<CreditAgreement | null>(null);
  const [detailTransactions, setDetailTransactions] = useState<AgreementTransaction[]>([]);
  const [detailMonthUsage, setDetailMonthUsage] = useState(0);
  const [detailMonthlyLimit, setDetailMonthlyLimit] = useState<number | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // â”€â”€â”€ Load data â”€â”€â”€
  const loadData = useCallback(async () => {
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setLoading(true);
    try {
      const [agreementsRes, partnersRes] = await Promise.all([
        api.get('/v2/admin/federation/credit-agreements', { signal: controller.signal }),
        api.get('/v2/admin/federation/partners', { signal: controller.signal }),
      ]);

      if (agreementsRes.success) {
        const payload = agreementsRes.data;
        setAgreements(
          Array.isArray(payload) ? payload : (payload as { agreements?: CreditAgreement[] })?.agreements ?? []
        );
      }

      if (partnersRes.success) {
        const payload = partnersRes.data;
        const rows = (Array.isArray(payload) ? payload : (payload as { partners?: unknown[] })?.partners ?? []) as Array<
          Partial<PartnerTenant> & { partner_tenant_id?: number; partner_name?: string; partner_slug?: string }
        >;
        // `id` must be the partner COMMUNITY's id — it is posted back as
        // partner_tenant_id. Rows without a usable id or name are dropped
        // rather than offered as a blank option.
        setPartners(
          rows
            .map((row) => ({
              id: Number(row.partner_tenant_id ?? row.id),
              name: String(row.name ?? row.partner_name ?? ''),
              slug: String(row.slug ?? row.partner_slug ?? ''),
            }))
            .filter((row) => Number.isFinite(row.id) && row.id > 0 && row.name !== '')
        );
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      logError('CreditAgreements.load', err);
      toast.error(t('federation.failed_to_load_credit_agreements'));
    }
    setLoading(false);
  }, [toast, t]);


  const loadBalances = useCallback(async () => {
    setBalancesLoading(true);
    try {
      const res = await adminFederation.getCreditBalances();
      if (res.success && res.data) {
        const data = res.data as unknown as { balances: CreditBalance[]; net_total: number };
        setBalances(data.balances || []);
        setNetTotal(data.net_total || 0);
      }
    } catch (err) {
      logError('CreditAgreements.loadBalances', err);
    }
    setBalancesLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    return () => { if (abortControllerRef.current) abortControllerRef.current.abort(); };
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'balances' && balances.length === 0) {
      loadBalances();
    }
  }, [activeTab, balances.length, loadBalances]);

  // â”€â”€â”€ Create agreement â”€â”€â”€
  const handleCreate = useCallback(async () => {
    if (!selectedPartner) return;
    const rate = parseFloat(exchangeRate);
    const limit = parseInt(monthlyLimit);
    if (!rate || rate <= 0) {
      toast.error(t('federation.exchange_rate_must_be_positive'));
      return;
    }
    if (!limit || limit <= 0) {
      toast.error(t('federation.monthly_limit_must_be_positive'));
      return;
    }
    setCreating(true);
    try {
      const res = await api.post('/v2/admin/federation/credit-agreements', {
        partner_tenant_id: parseInt(selectedPartner),
        exchange_rate: rate,
        monthly_limit: limit,
      });
      if (res.success) {
        toast.success(t('federation.credit_agreement_created'));
        setSelectedPartner('');
        setExchangeRate('1.0');
        setMonthlyLimit('100');
        createModal.onClose();
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — the controller's
        // refusals (already exists, validation) are __() keys.
        toast.error(res.error || t('federation.failed_to_create_agreement'));
      }
    } catch (err) {
      logError('CreditAgreements.create', err);
      toast.error(t('federation.failed_to_create_agreement'));
    }
    setCreating(false);
  }, [selectedPartner, exchangeRate, monthlyLimit, toast, createModal, loadData, t]);


  // â”€â”€â”€ Status change â”€â”€â”€
  const handleStatusChange = useCallback(async (agreementId: number, action: 'approve' | 'suspend' | 'terminate' | 'reactivate') => {
    try {
      const res = await api.post(`/v2/admin/federation/credit-agreements/${agreementId}/${action}`);
      if (res.success) {
        toast.success(t('federation.agreement_action_success'));
        loadData();
      } else {
        // admin-i18n-ignore: localized server message — the controller's
        // refusals (partnership required, wrong status) are __() keys.
        toast.error(res.error || t('federation.agreement_action_failed'));
      }
    } catch (err) {
      logError('CreditAgreements.statusChange', err);
      toast.error(t('federation.agreement_action_failed'));
    }
  }, [toast, loadData, t]);


  // â”€â”€â”€ Detail modal â”€â”€â”€
  const openDetail = async (agreement: CreditAgreement) => {
    setSelectedAgreement(agreement);
    setDetailTransactions([]);
    setDetailMonthUsage(0);
    setDetailMonthlyLimit(getMonthlyLimit(agreement));
    detailModal.onOpen();
    setDetailLoading(true);

    try {
      const res = await adminFederation.getCreditAgreementTransactions(agreement.id);
      if (res.success && res.data) {
        const data = res.data as unknown as {
          transactions: AgreementTransaction[];
          month_usage: number;
          monthly_limit: number | null;
        };
        setDetailTransactions(data.transactions || []);
        setDetailMonthUsage(data.month_usage || 0);
        setDetailMonthlyLimit(data.monthly_limit);
      }
    } catch (err) {
      logError('CreditAgreements.loadDetail', err);
    } finally {
      setDetailLoading(false);
    }
  };

  // â”€â”€â”€ Stats â”€â”€â”€
  const activeCount = agreements.filter((a) => a.status === 'active').length;
  const pendingCount = agreements.filter((a) => a.status === 'pending').length;
  const totalSent = agreements.reduce((sum, a) => sum + (a.credits_sent || 0), 0);
  const totalReceived = agreements.reduce((sum, a) => sum + (a.credits_received || 0), 0);

  // A transaction came FROM the partner when its sender is the partner
  // community. Compared by id; the display name is only a fallback for rows
  // without partner_tenant (two communities can share a name).
  const partnerIdOfSelected = selectedAgreement ? getPartnerId(selectedAgreement) : null;
  const isFromPartner = (tx: AgreementTransaction): boolean => {
    if (partnerIdOfSelected !== null) return tx.sender_tenant_id === partnerIdOfSelected;
    return !!selectedAgreement && tx.sender_tenant_name === getPartnerName(selectedAgreement, t('federation.unknown_partner'));
  };

  // â”€â”€â”€ Render â”€â”€â”€
  if (loading) {
    return (
      <div>
        <PageHeader title={t('federation.credit_agreements_title')} description={t('federation.credit_agreements_desc')} />
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-64 items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('federation.credit_agreements_title')}
        description={t('federation.credit_agreements_desc')}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="tertiary" size="sm" startContent={<RefreshCw size={16} />} onPress={() => { loadData(); if (activeTab === 'balances') loadBalances(); }}>
              {t('federation.refresh')}
            </Button>
            <Button  size="sm" startContent={<Plus size={16} />} onPress={createModal.onOpen}>
              {t('federation.new_agreement')}
            </Button>
          </div>
        }
      />

      <PartnerTimebankGuidance page="creditAgreements" />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={t('federation.label_active_agreements')} value={activeCount} icon={Handshake} color="success" />
        <StatCard label={t('federation.label_pending_approval')} value={pendingCount} icon={AlertTriangle} color="warning" />
        <StatCard label={t('federation.credits_sent_label')} value={totalSent} icon={ArrowRightLeft}  />
        <StatCard label={t('federation.credits_received_label')} value={totalReceived} icon={TrendingUp} color="default" />
      </div>

      {/* Tabs: Agreements / Balances */}
      <Tabs
        selectedKey={activeTab}
        onSelectionChange={(key) => setActiveTab(String(key))}
        variant="underlined"
        aria-label={t('federation.label_credit_tabs')}
      >
        <Tab
          key="agreements"
          title={
            <div className="flex items-center gap-2">
              <Handshake size={16} />
              <span>{t('federation.tab_agreements')}</span>
            </div>
          }
        />
        <Tab
          key="balances"
          title={
            <div className="flex items-center gap-2">
              <Wallet size={16} />
              <span>{t('federation.tab_balances')}</span>
            </div>
          }
        />
      </Tabs>

      {/* Agreements Table */}
      {activeTab === 'agreements' && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">{t('federation.all_agreements')}</h3>
          </CardHeader>
          <CardBody>
            <Table aria-label={t('federation.credit_agreements_title')} removeWrapper>
              <TableHeader>
                <TableColumn>{t('federation.label_partner')}</TableColumn>
                <TableColumn>{t('federation.label_exchange_rate')}</TableColumn>
                <TableColumn>{t('federation.label_monthly_limit')}</TableColumn>
                <TableColumn>{t('federation.col_balance')}</TableColumn>
                <TableColumn>{t('federation.col_sent_received')}</TableColumn>
                <TableColumn>{t('federation.label_status')}</TableColumn>
                <TableColumn>{t('federation.label_created')}</TableColumn>
                <TableColumn>{t('federation.label_actions')}</TableColumn>
              </TableHeader>
              <TableBody
                emptyContent={
                  <BrokerEmptyState
                    bare
                    icon={Handshake}
                    title={t('federation.no_credit_agreements')}
                    hint={t('federation.no_credit_agreements_hint')}
                    action={
                      <Button size="sm" startContent={<Plus size={14} />} onPress={createModal.onOpen}>
                        {t('federation.new_agreement')}
                      </Button>
                    }
                  />
                }
              >
                {agreements.map((agreement) => (
                  <TableRow key={agreement.id} className="cursor-pointer hover:bg-surface-secondary">
                    <TableCell>
                      <div>
                        <p className="font-medium text-sm">{getPartnerName(agreement, t('federation.unknown_partner'))}</p>
                        <p className="text-xs text-muted">{getPartnerSlug(agreement)}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm font-mono">{agreement.exchange_rate}:1</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {getMonthlyLimit(agreement) !== null
                          ? `${getMonthlyLimit(agreement)} ${t('federation.credits')}`
                          : t('federation.unlimited')
                        }
                      </span>
                    </TableCell>
                    <TableCell>
                      {typeof agreement.current_balance === 'number' ? (
                        <span className={`text-sm font-medium ${agreement.current_balance >= 0 ? 'text-success' : 'text-danger'}`}>
                          {agreement.current_balance >= 0 ? '+' : ''}{agreement.current_balance}
                        </span>
                      ) : (
                        <span className="text-sm text-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">
                        {formatCredits(agreement.credits_sent)} / {formatCredits(agreement.credits_received)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <BrokerStatusChip status={agreement.status} />
                      {agreement.status === 'pending' && agreement.awaiting === 'partner' && (
                        <p className="mt-1 text-xs text-muted">{t('federation.awaiting_partner_approval')}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted">{formatRelativeTime(agreement.created_at)}</span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          size="sm"
                          variant="tertiary"
                          isIconOnly
                          aria-label={t('federation.label_view_detail')}
                          onPress={() => openDetail(agreement)}
                        >
                          <Eye size={14} />
                        </Button>
                        {agreement.status === 'pending' && agreement.awaiting !== 'partner' && (
                          <Button
                            size="sm"
                            variant="tertiary"
                            className="text-success"
                            isIconOnly
                            aria-label={t('federation.label_approve')}
                            onPress={() => handleStatusChange(agreement.id, 'approve')}
                          >
                            <CheckCircle size={14} />
                          </Button>
                        )}
                        {agreement.status === 'active' && (
                          <Button
                            size="sm"
                            variant="tertiary"
                            className="text-warning"
                            isIconOnly
                            aria-label={t('federation.label_suspend')}
                            onPress={() => setPendingAction({ agreementId: agreement.id, action: 'suspend', partnerName: getPartnerName(agreement, t('federation.unknown_partner')) })}
                          >
                            <Pause size={14} />
                          </Button>
                        )}
                        {agreement.status === 'suspended' && (
                          <Button
                            size="sm"
                            variant="tertiary"
                            className="text-success"
                            isIconOnly
                            aria-label={t('federation.label_reactivate')}
                            onPress={() => handleStatusChange(agreement.id, 'reactivate')}
                          >
                            <Play size={14} />
                          </Button>
                        )}
                        {agreement.status !== 'terminated' && (
                          <Button
                            size="sm"
                            variant="danger"
                            isIconOnly
                            aria-label={t('federation.label_terminate')}
                            onPress={() => setPendingAction({ agreementId: agreement.id, action: 'terminate', partnerName: getPartnerName(agreement, t('federation.unknown_partner')) })}
                          >
                            <XCircle size={14} />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Balances / Settlement View */}
      {activeTab === 'balances' && (
        <div className="space-y-4">
          {/* Net balance summary */}
          <Card>
            <CardBody className="flex flex-row items-center justify-between p-6">
              <div>
                <p className="text-sm text-muted">{t('federation.net_balance_all_partners')}</p>
                <p className={`text-3xl font-bold ${netTotal >= 0 ? 'text-success' : 'text-danger'}`}>
                  {netTotal >= 0 ? '+' : ''}{netTotal.toFixed(1)}
                </p>
                <p className="text-xs text-muted mt-1">
                  {netTotal >= 0
                    ? t('federation.balance_positive_desc')
                    : t('federation.balance_negative_desc')
                  }
                </p>
              </div>
              <BarChart3 size={48} className="text-muted" />
            </CardBody>
          </Card>

          {/* Per-partner balances */}
          {balancesLoading ? (
            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex h-32 items-center justify-center">
              <Spinner size="lg" />
            </div>
          ) : balances.length === 0 ? (
            <BrokerEmptyState
              icon={Wallet}
              title={t('federation.no_balances')}
              hint={t('federation.no_balances_hint')}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {balances.map((balance) => (
                <Card key={balance.agreement_id}>
                  <CardBody className="gap-3">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold">{balance.partner_name}</p>
                      <Chip
                        size="sm"
                        variant="soft"
                        color={balance.net_balance >= 0 ? 'success' : 'danger'}
                        startContent={balance.net_balance >= 0 ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                      >
                        {balance.net_balance >= 0 ? '+' : ''}{balance.net_balance.toFixed(1)}
                      </Chip>
                    </div>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted">{t('federation.credits_sent_label')}</p>
                        <p className="font-medium text-danger">{balance.credits_sent.toFixed(1)}</p>
                      </div>
                      <div>
                        <p className="text-muted">{t('federation.credits_received_label')}</p>
                        <p className="font-medium text-success">{balance.credits_received.toFixed(1)}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted">
                      {balance.net_balance >= 0
                        ? t('federation.partner_owes_us')
                        : t('federation.we_owe_partner')
                      }
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Agreement Modal */}
      <Modal isOpen={createModal.isOpen} onOpenChange={createModal.onOpenChange} size="lg">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Handshake size={20} />
                {t('federation.new_credit_agreement')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Select
                  label={t('federation.label_partner_community')}
                  placeholder={t('federation.placeholder_select_a_partner')}
                  selectedKeys={selectedPartner ? [selectedPartner] : []}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    setSelectedPartner(selected ? String(selected) : '');
                  }}
                >
                  {partners.map((p) => (
                    <SelectItem key={String(p.id)} id={String(p.id)}>{p.name}</SelectItem>
                  ))}
                </Select>

                <Input
                  type="number"
                  label={t('federation.label_exchange_rate')}
                  description={t('federation.exchange_rate_description')}
                  value={exchangeRate}
                  onChange={(e) => setExchangeRate(e.target.value)}
                  startContent={<ArrowRightLeft size={14} />}
                  step="0.1"
                  min="0.1"
                />

                <Input
                  type="number"
                  label={t('federation.label_monthly_limit')}
                  description={t('federation.desc_maximum_credits_that_can_be_exchanged_pe')}
                  value={monthlyLimit}
                  onChange={(e) => setMonthlyLimit(e.target.value)}
                  startContent={<Clock size={14} />}
                  min="1"
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('common.cancel')}</Button>
                <Button

                  isLoading={creating}
                  isDisabled={!selectedPartner}
                  onPress={handleCreate}
                >
                  {t('federation.create_agreement')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Agreement Detail Modal */}
      <Modal isOpen={detailModal.isOpen} onOpenChange={detailModal.onOpenChange} size="2xl" scrollBehavior="inside">
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex items-center gap-2">
                <Handshake size={20} />
                {selectedAgreement
                  ? t('federation.agreement_with')
                  : t('federation.agreement_detail')
                }
              </ModalHeader>
              <ModalBody>
                {selectedAgreement && (
                  <div className="space-y-4">
                    {/* Agreement terms */}
                    <Card className="border border-border">
                      <CardHeader>
                        <p className="text-sm font-semibold">{t('federation.agreement_terms')}</p>
                      </CardHeader>
                      <CardBody>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted">{t('federation.label_partner')}</p>
                            <p className="font-medium">{getPartnerName(selectedAgreement, t('federation.unknown_partner'))}</p>
                          </div>
                          <div>
                            <p className="text-muted">{t('federation.label_status')}</p>
                            <BrokerStatusChip status={selectedAgreement.status} />
                          </div>
                          <div>
                            <p className="text-muted">{t('federation.label_exchange_rate')}</p>
                            <p className="font-mono">{selectedAgreement.exchange_rate}:1</p>
                          </div>
                          <div>
                            <p className="text-muted">{t('federation.label_monthly_limit')}</p>
                            <p>
                              {getMonthlyLimit(selectedAgreement) !== null
                                ? `${getMonthlyLimit(selectedAgreement)} ${t('federation.credits')}`
                                : t('federation.unlimited')
                              }
                            </p>
                          </div>
                          <div>
                            <p className="text-muted">{t('federation.label_created')}</p>
                            <p>{new Date(selectedAgreement.created_at).toLocaleDateString(getFormattingLocale())}</p>
                          </div>
                          {selectedAgreement.updated_at && (
                            <div>
                              <p className="text-muted">{t('federation.label_last_updated')}</p>
                              <p>{new Date(selectedAgreement.updated_at).toLocaleDateString(getFormattingLocale())}</p>
                            </div>
                          )}
                        </div>
                      </CardBody>
                    </Card>

                    {/* Monthly usage progress */}
                    {detailMonthlyLimit !== null && detailMonthlyLimit > 0 && (
                      <Card className="border border-border">
                        <CardHeader>
                          <p className="text-sm font-semibold">{t('federation.usage_this_month')}</p>
                        </CardHeader>
                        <CardBody className="gap-2">
                          <div className="flex items-center justify-between text-sm">
                            <span>{detailMonthUsage.toFixed(1)} / {detailMonthlyLimit.toFixed(1)} {t('federation.credits')}</span>
                            <span className="text-muted">
                              {formatPercentRatio(detailMonthUsage / detailMonthlyLimit, { maximumFractionDigits: 0 })}
                            </span>
                          </div>
                          <Progress
                            value={(detailMonthUsage / detailMonthlyLimit) * 100}
                            color={detailMonthUsage / detailMonthlyLimit > 0.9 ? 'danger' : detailMonthUsage / detailMonthlyLimit > 0.7 ? 'warning' : 'primary'}
                            size="md"
                            aria-label={t('federation.label_monthly_usage')}
                          />
                        </CardBody>
                      </Card>
                    )}

                    {/* Transaction history */}
                    <Card className="border border-border">
                      <CardHeader>
                        <p className="text-sm font-semibold">{t('federation.transaction_history')}</p>
                      </CardHeader>
                      <CardBody>
                        {detailLoading ? (
                          <div className="flex h-24 items-center justify-center">
                            <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
                          </div>
                        ) : detailTransactions.length === 0 ? (
                          <p className="text-sm text-muted text-center py-4">
                            {t('federation.no_transactions')}
                          </p>
                        ) : (
                          <Table aria-label={t('federation.label_transactions')} removeWrapper>
                            <TableHeader>
                              <TableColumn>{t('federation.col_date')}</TableColumn>
                              <TableColumn>{t('federation.label_direction')}</TableColumn>
                              <TableColumn>{t('federation.col_amount')}</TableColumn>
                              <TableColumn>{t('federation.col_description')}</TableColumn>
                              <TableColumn>{t('federation.label_status')}</TableColumn>
                            </TableHeader>
                            <TableBody>
                              {detailTransactions.map((tx) => (
                                <TableRow key={tx.id}>
                                  <TableCell>
                                    <span className="text-sm">{new Date(tx.created_at).toLocaleDateString(getFormattingLocale())}</span>
                                  </TableCell>
                                  <TableCell>
                                    <Chip
                                      size="sm"
                                      variant="soft"
                                      color={isFromPartner(tx) ? 'success' : 'danger'}
                                      startContent={
                                        isFromPartner(tx)
                                          ? <ArrowDownRight size={10} />
                                          : <ArrowUpRight size={10} />
                                      }
                                    >
                                      {isFromPartner(tx)
                                        ? t('federation.received')
                                        : t('federation.sent')
                                      }
                                    </Chip>
                                  </TableCell>
                                  <TableCell>
                                    <span className="font-mono text-sm">{tx.amount}</span>
                                  </TableCell>
                                  <TableCell>
                                    <span className="text-sm text-muted truncate max-w-[200px] block">
                                      {tx.description || '--'}
                                    </span>
                                  </TableCell>
                                  <TableCell>
                                    <BrokerStatusChip status={tx.status} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </CardBody>
                    </Card>
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>{t('common.close')}</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Confirm destructive action modal */}
      <ConfirmModal
        isOpen={!!pendingAction}
        onClose={() => setPendingAction(null)}
        isLoading={actionLoading}
        onConfirm={async () => {
          if (pendingAction) {
            setActionLoading(true);
            try {
              await handleStatusChange(pendingAction.agreementId, pendingAction.action);
            } finally {
              setActionLoading(false);
              setPendingAction(null);
            }
          }
        }}
        title={
          pendingAction?.action === 'terminate'
            ? t('federation.terminate_agreement')
            : t('federation.suspend_agreement')
        }
        message={
          pendingAction?.action === 'terminate'
            ? t('federation.terminate_agreement_confirm', {
                name: pendingAction?.partnerName,
              })
            : t('federation.suspend_agreement_confirm', {
                name: pendingAction?.partnerName,
              })
        }
        confirmLabel={
          pendingAction?.action === 'terminate'
            ? t('federation.terminate')
            : t('federation.suspend')
        }
        confirmColor="danger"
      />
    </div>
  );
}

export default CreditAgreements;
