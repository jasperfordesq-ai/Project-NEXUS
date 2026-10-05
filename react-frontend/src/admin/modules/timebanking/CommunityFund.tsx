import { getFormattingLocale } from '@/lib/helpers';
import { Button, Card, CardBody, CardHeader, Chip, Input, Spinner, Textarea } from '@/components/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ArrowDownToLine from 'lucide-react/icons/arrow-down-to-line';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import ArrowUpFromLine from 'lucide-react/icons/arrow-up-from-line';
import HandHeart from 'lucide-react/icons/hand-heart';
import History from 'lucide-react/icons/history';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Search from 'lucide-react/icons/search';
import Users from 'lucide-react/icons/users';
import Wallet from 'lucide-react/icons/wallet';
import { useTranslation } from 'react-i18next';
import { useAdminPageMeta } from '../../AdminMetaContext';
import { adminTimebanking, adminUsers } from '../../api/adminApi';
import type { AdminUser, CommunityFundBalance, CommunityFundTransaction } from '../../api/types';
import { DataTable, type Column } from '../../components/DataTable';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { useTenant, useToast } from '@/contexts';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Community Fund
 * Admin page for viewing the tenant community fund, depositing credits, and
 * granting fund credits to members.
 */


const PAGE_SIZE = 20;

const TRANSACTION_TYPE_COLOR: Record<
  CommunityFundTransaction['type'],
  'success' | 'warning' | 'accent' | 'default'
> = {
  deposit: 'success',
  withdrawal: 'accent',
  donation: 'default',
  starting_balance_grant: 'warning',
  group_exchange: 'success',
};

function unwrapArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const nested = (payload as { data?: unknown }).data;
    return Array.isArray(nested) ? (nested as T[]) : [];
  }
  return [];
}

function CommunityFundDepositForm({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation('admin_timebanking');
  const toast = useToast();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const parsedAmount = Number.parseFloat(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t('timebanking.community_fund_invalid_amount'));
      return;
    }

    if (!description.trim()) {
      toast.error(t('timebanking.community_fund_reason_required'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminTimebanking.depositCommunityFund(parsedAmount, description.trim());
      if (res.success) {
        toast.success(t('timebanking.community_fund_deposit_success'));
        setAmount('');
        setDescription('');
        onComplete();
      } else {
        toast.error(t('timebanking.community_fund_deposit_failed'));
      }
    } catch {
      toast.error(t('timebanking.community_fund_deposit_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
        <ArrowDownToLine size={18} className="text-success" aria-hidden="true" />
        <h3 className="font-semibold">{t('timebanking.community_fund_deposit_title')}</h3>
      </CardHeader>
      <CardBody className="space-y-4 px-4 pb-4">
        <Input
          label={t('timebanking.label_credit_amount')}
          placeholder={t('timebanking.placeholder_credit_amount')}
          type="number"
          min="0.25"
          step="0.25"
          value={amount}
          onValueChange={setAmount}
          size="sm"
          variant="secondary"
          startContent={<Wallet size={16} className="text-muted" aria-hidden="true" />}
        />
        <Textarea
          label={t('timebanking.label_reason')}
          placeholder={t('timebanking.community_fund_deposit_reason_placeholder')}
          value={description}
          onValueChange={setDescription}
          size="sm"
          variant="secondary"
          minRows={2}
          maxRows={4}
          description={t('timebanking.community_fund_audit_reason_desc')}
        />
        <Button
          variant="primary"
          startContent={<ArrowDownToLine size={16} aria-hidden="true" />}
          isLoading={submitting}
          isDisabled={!amount || !description.trim()}
          onPress={handleSubmit}
          className="w-full sm:w-auto"
        >
          {t('timebanking.community_fund_deposit_button')}
        </Button>
      </CardBody>
    </Card>
  );
}

function CommunityFundGrantForm({ fundBalance, onComplete }: { fundBalance: number; onComplete: () => void }) {
  const { t } = useTranslation('admin_timebanking');
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const res = await adminUsers.list({ search: query, limit: 10 });
      if (res.success) {
        setSearchResults(unwrapArray<AdminUser>(res.data));
      }
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSubmit = async () => {
    const parsedAmount = Number.parseFloat(amount);

    if (!selectedUser) {
      toast.error(t('timebanking.please_select_a_member'));
      return;
    }

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      toast.error(t('timebanking.community_fund_invalid_amount'));
      return;
    }

    if (parsedAmount > fundBalance) {
      toast.error(t('timebanking.community_fund_insufficient_balance'));
      return;
    }

    if (!description.trim()) {
      toast.error(t('timebanking.community_fund_reason_required'));
      return;
    }

    setSubmitting(true);
    try {
      const res = await adminTimebanking.withdrawCommunityFund(
        selectedUser.id,
        parsedAmount,
        description.trim()
      );
      if (res.success) {
        toast.success(t('timebanking.community_fund_grant_success'));
        setSelectedUser(null);
        setAmount('');
        setDescription('');
        onComplete();
      } else {
        toast.error(t('timebanking.community_fund_grant_failed'));
      }
    } catch {
      toast.error(t('timebanking.community_fund_grant_failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
        <ArrowUpFromLine size={18} className="text-accent" aria-hidden="true" />
        <h3 className="font-semibold">{t('timebanking.community_fund_grant_title')}</h3>
      </CardHeader>
      <CardBody className="space-y-4 px-4 pb-4">
        {!selectedUser ? (
          <div>
            <Input
              type="search"
              name="community-fund-member-search"
              autoComplete="off"
              label={t('timebanking.label_search_member')}
              placeholder={t('timebanking.placeholder_search_by_name_or_email')}
              startContent={<Search size={16} className="text-muted" aria-hidden="true" />}
              value={searchQuery}
              onValueChange={handleSearch}
              size="sm"
              variant="secondary"
            />
            {searching && (
              <div className="flex items-center justify-center py-4">
                <div role="status" aria-busy="true" aria-label={t('common.loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-divider">
                {searchResults.map((user) => (
                  <Button
                    key={user.id}
                    variant="ghost"
                    className="flex min-h-12 w-full items-center justify-between rounded-none px-3 py-2"
                    onPress={() => {
                      setSelectedUser(user);
                      setSearchQuery('');
                      setSearchResults([]);
                    }}
                  >
                    <div className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-medium text-foreground">{user.name}</p>
                      <p className="truncate text-xs text-muted">{user.email}</p>
                    </div>
                    <div className="ml-3 shrink-0 text-right">
                      <p className="text-xs text-muted">{t('timebanking.col_balance')}</p>
                      <p className="text-sm font-semibold text-foreground">
                        {t('timebanking.hours_value', { count: user.balance })}
                      </p>
                    </div>
                  </Button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && !searching && searchResults.length === 0 && (
              <p className="mt-2 py-2 text-center text-sm text-muted">
                {t('timebanking.no_members_found')}
              </p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-divider p-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10">
                <Users size={16} className="text-accent" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{selectedUser.name}</p>
                <p className="truncate text-xs text-muted">
                  {selectedUser.email} · {t('timebanking.current_balance')}: {t('timebanking.hours_value', { count: selectedUser.balance })}
                </p>
              </div>
            </div>
            <Button size="sm" variant="tertiary" onPress={() => setSelectedUser(null)}>
              {t('timebanking.change')}
            </Button>
          </div>
        )}

        <Input
          label={t('timebanking.label_credit_amount')}
          placeholder={t('timebanking.placeholder_credit_amount')}
          type="number"
          min="0.25"
          step="0.25"
          value={amount}
          onValueChange={setAmount}
          size="sm"
          variant="secondary"
          startContent={<Wallet size={16} className="text-muted" aria-hidden="true" />}
          description={t('timebanking.community_fund_available_balance', {
            amount: t('timebanking.hours_value', { count: fundBalance }),
          })}
        />
        <Textarea
          label={t('timebanking.label_reason')}
          placeholder={t('timebanking.community_fund_grant_reason_placeholder')}
          value={description}
          onValueChange={setDescription}
          size="sm"
          variant="secondary"
          minRows={2}
          maxRows={4}
          description={t('timebanking.community_fund_audit_reason_desc')}
        />
        <Button
          variant="primary"
          startContent={<ArrowUpFromLine size={16} aria-hidden="true" />}
          isLoading={submitting}
          isDisabled={!selectedUser || !amount || !description.trim()}
          onPress={handleSubmit}
          className="w-full sm:w-auto"
        >
          {t('timebanking.community_fund_grant_button')}
        </Button>
      </CardBody>
    </Card>
  );
}

export function CommunityFund() {
  const { t: tNav } = useTranslation('admin_nav');
  const { t } = useTranslation('admin_timebanking');
  useAdminPageMeta({ title: tNav('community_fund') });
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [fund, setFund] = useState<CommunityFundBalance | null>(null);
  const [transactions, setTransactions] = useState<CommunityFundTransaction[]>([]);
  const [totalTransactions, setTotalTransactions] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingFund, setLoadingFund] = useState(true);
  const [loadingTransactions, setLoadingTransactions] = useState(true);

  const loadFund = useCallback(async () => {
    setLoadingFund(true);
    try {
      const res = await adminTimebanking.getCommunityFund();
      if (res.success && res.data) {
        setFund(res.data);
      } else {
        toast.error(t('timebanking.community_fund_load_failed'));
      }
    } catch {
      toast.error(t('timebanking.community_fund_load_failed'));
    } finally {
      setLoadingFund(false);
    }
  }, [t, toast]);

  const loadTransactions = useCallback(async (nextPage: number) => {
    setLoadingTransactions(true);
    try {
      const offset = (nextPage - 1) * PAGE_SIZE;
      const res = await adminTimebanking.getCommunityFundTransactions({
        limit: PAGE_SIZE,
        offset,
      });
      if (res.success) {
        setTransactions(unwrapArray<CommunityFundTransaction>(res.data));
        setTotalTransactions(res.meta?.total ?? unwrapArray<CommunityFundTransaction>(res.data).length);
      } else {
        toast.error(t('timebanking.community_fund_transactions_failed'));
      }
    } catch {
      toast.error(t('timebanking.community_fund_transactions_failed'));
    } finally {
      setLoadingTransactions(false);
    }
  }, [t, toast]);

  const refreshAll = useCallback(() => {
    void loadFund();
    void loadTransactions(page);
  }, [loadFund, loadTransactions, page]);

  useEffect(() => {
    void loadFund();
  }, [loadFund]);

  useEffect(() => {
    void loadTransactions(page);
  }, [loadTransactions, page]);

  const handlePageChange = (nextPage: number) => setPage(nextPage);

  const columns: Column<CommunityFundTransaction>[] = useMemo(
    () => [
      {
        key: 'created_at',
        label: t('timebanking.col_date'),
        sortable: true,
        render: (transaction) => (
          <span className="text-sm text-muted">
            {new Date(transaction.created_at).toLocaleString(getFormattingLocale())}
          </span>
        ),
      },
      {
        key: 'type',
        label: t('timebanking.col_type'),
        sortable: true,
        render: (transaction) => (
          <Chip size="sm" variant="soft" color={TRANSACTION_TYPE_COLOR[transaction.type]}>
            {t(`timebanking.community_fund_type_${transaction.type}`)}
          </Chip>
        ),
      },
      {
        key: 'user_name',
        label: t('timebanking.col_member'),
        sortable: true,
        render: (transaction) => (
          <span className="text-sm">
            {transaction.user_name || t('timebanking.community_fund_system_account')}
          </span>
        ),
      },
      {
        key: 'amount',
        label: t('timebanking.col_amount'),
        sortable: true,
        render: (transaction) => (
          <span className="text-sm font-semibold">
            {t('timebanking.hours_value', { count: transaction.amount })}
          </span>
        ),
      },
      {
        key: 'balance_after',
        label: t('timebanking.community_fund_balance_after'),
        sortable: true,
        render: (transaction) => (
          <span className="text-sm text-muted">
            {t('timebanking.hours_value', { count: transaction.balance_after })}
          </span>
        ),
      },
      {
        key: 'description',
        label: t('timebanking.col_description'),
        render: (transaction) => (
          <span className="text-sm text-foreground">{transaction.description || t('timebanking.no_description')}</span>
        ),
      },
    ],
    [t]
  );

  return (
    <div>
      <PageHeader
        title={t('timebanking.community_fund_title')}
        description={t('timebanking.community_fund_desc')}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              startContent={<RefreshCw size={16} aria-hidden="true" />}
              onPress={refreshAll}
              isLoading={loadingFund || loadingTransactions}
              size="sm"
            >
              {t('common.refresh')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/admin/timebanking')}
              variant="tertiary"
              startContent={<ArrowLeft size={16} aria-hidden="true" />}
              size="sm"
            >
              {t('timebanking.back_to_timebanking')}
            </Button>
          </div>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('timebanking.community_fund_current_balance')}
          value={fund ? t('timebanking.hours_value', { count: fund.balance }) : '—'}
          icon={HandHeart}
          color="default"
          loading={loadingFund}
        />
        <StatCard
          label={t('timebanking.community_fund_total_deposited')}
          value={fund ? t('timebanking.hours_value', { count: fund.total_deposited }) : '—'}
          icon={ArrowDownToLine}
          color="success"
          loading={loadingFund}
        />
        <StatCard
          label={t('timebanking.community_fund_total_withdrawn')}
          value={fund ? t('timebanking.hours_value', { count: fund.total_withdrawn }) : '—'}
          icon={ArrowUpFromLine}
          color="warning"
          loading={loadingFund}
        />
        <StatCard
          label={t('timebanking.community_fund_total_donated')}
          value={fund ? t('timebanking.hours_value', { count: fund.total_donated }) : '—'}
          icon={Users}
          color="default"
          loading={loadingFund}
        />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <CommunityFundDepositForm onComplete={refreshAll} />
        <CommunityFundGrantForm fundBalance={fund?.balance ?? 0} onComplete={refreshAll} />
      </div>

      <Card>
        <CardHeader className="flex items-center gap-2 px-4 pt-4 pb-0">
          <History size={18} className="text-muted" aria-hidden="true" />
          <h3 className="font-semibold">{t('timebanking.community_fund_history_title')}</h3>
        </CardHeader>
        <CardBody className="px-4 pb-4">
          <DataTable<CommunityFundTransaction>
            columns={columns}
            data={transactions}
            isLoading={loadingTransactions}
            searchable={false}
            totalItems={totalTransactions}
            page={page}
            pageSize={PAGE_SIZE}
            onPageChange={handlePageChange}
            onRefresh={() => loadTransactions(page)}
            emptyContent={
              <div className="flex flex-col items-center gap-2 py-8">
                <History size={32} className="text-muted" aria-hidden="true" />
                <p className="text-sm text-muted">{t('timebanking.community_fund_no_transactions')}</p>
              </div>
            }
          />
        </CardBody>
      </Card>
    </div>
  );
}

export default CommunityFund;
