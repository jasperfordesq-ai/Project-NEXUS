// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { getFormattingLocale } from '@/lib/helpers';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, Tab } from '@/components/ui/Tabs';
/**
 * Wallet Page - Time credit balance and transactions
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Wallet from 'lucide-react/icons/wallet';
import ArrowUpRight from 'lucide-react/icons/arrow-up-right';
import ArrowDownLeft from 'lucide-react/icons/arrow-down-left';
import Clock from 'lucide-react/icons/clock';
import TrendingUp from 'lucide-react/icons/trending-up';
import Calendar from 'lucide-react/icons/calendar';
import User from 'lucide-react/icons/user';
import Download from 'lucide-react/icons/download';
import Send from 'lucide-react/icons/send';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import QrCode from 'lucide-react/icons/qr-code';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageMeta } from '@/components/seo';
import { EmptyState } from '@/components/feedback';
import { TransferModal, DonateModal, CommunityFundCard } from '@/components/wallet';
import { useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { usePageTitle } from '@/hooks';
import type { WalletBalance, Transaction } from '@/types/api';

type TransactionFilter = 'all' | 'earned' | 'spent' | 'pending';

export function WalletPage() {
  const { t } = useTranslation('wallet');
  const { hasFeature, tenantPath } = useTenant();
  usePageTitle(t('title'));
  const [searchParams, setSearchParams] = useSearchParams();
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreTransactions, setHasMoreTransactions] = useState(true);
  const [txCursor, setTxCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [isDonateModalOpen, setIsDonateModalOpen] = useState(false);
  const toast = useToast();

  const abortRef = useRef<AbortController | null>(null);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  // Check for ?to=userId URL param to auto-open transfer modal
  const [savedRecipientId, setSavedRecipientId] = useState<number | null>(
    searchParams.get('to') ? parseInt(searchParams.get('to')!, 10) : null
  );

  const loadWalletData = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      setTxError(null);
      setTxCursor(null);
      const [balanceRes, transactionsRes] = await Promise.all([
        api.get<WalletBalance>('/v2/wallet/balance'),
        api.get<Transaction[]>('/v2/wallet/transactions?per_page=50'),
      ]);

      if (controller.signal.aborted) return;

      if (balanceRes.success && balanceRes.data) {
        setBalance(balanceRes.data);
      } else {
        setError(balanceRes.code === 'SESSION_EXPIRED'
          ? tRef.current('error.session_expired')
          : tRef.current('error.load_balance'));
        return;
      }
      if (transactionsRes.success && transactionsRes.data) {
        setTransactions(transactionsRes.data);
        setTxCursor(transactionsRes.meta?.cursor ?? null);
        setHasMoreTransactions(transactionsRes.meta?.has_more ?? transactionsRes.data.length >= 50);
      } else {
        // Don't show a fake "No transactions yet" when only the transactions request failed
        setTxError(transactionsRes.error || tRef.current('error.load_wallet'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load wallet data', err);
      setError(tRef.current('error.load_wallet'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, []);

  const loadWalletDataRef = useRef(loadWalletData);
  loadWalletDataRef.current = loadWalletData;

  useEffect(() => {
    loadWalletDataRef.current();
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Auto-open transfer modal when ?to=userId is present and data is loaded
  useEffect(() => {
    if (savedRecipientId && !isLoading && balance && !isTransferModalOpen) {
      setIsTransferModalOpen(true);
      // Clear the URL param so it doesn't reopen on subsequent renders
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('to');
      setSearchParams(newParams, { replace: true });
    }
  }, [savedRecipientId, isLoading, balance]); // eslint-disable-line react-hooks/exhaustive-deps -- sync from URL params; searchParams/setSearchParams excluded to avoid loop

  // Load more transactions (cursor-based pagination)
  const loadMoreTransactions = useCallback(async () => {
    if (isLoadingMore || !hasMoreTransactions || !txCursor) return;

    try {
      setIsLoadingMore(true);
      const response = await api.get<Transaction[]>(`/v2/wallet/transactions?per_page=50&cursor=${encodeURIComponent(txCursor)}`);

      if (response.success && response.data) {
        if (response.data.length > 0) {
          setTransactions((prev) => [...prev, ...response.data!]);
        }
        setTxCursor(response.meta?.cursor ?? null);
        setHasMoreTransactions(response.meta?.has_more ?? false);
      }
    } catch (err) {
      logError('Failed to load more transactions', err);
      toastRef.current.error(tRef.current('toast.load_error'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMoreTransactions, txCursor]);

  // Handle successful transfer
  function handleTransferComplete(transaction: Transaction) {
    // Add the new transaction to the list
    setTransactions((prev) => [transaction, ...prev]);

    // Update balance
    if (balance) {
      setBalance({
        ...balance,
        balance: balance.balance - transaction.amount,
        total_spent: balance.total_spent + transaction.amount,
      });
    }

    toast.success(
      t('toast.transfer_success'),
      t('toast.transfer_desc', { amount: transaction.amount, recipient: transaction.other_user?.name || t('recipient') })
    );
  }

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (filter === 'all') return true;
      if (filter === 'earned') return tx.type === 'credit';
      if (filter === 'spent') return tx.type === 'debit';
      if (filter === 'pending') return tx.status === 'pending';
      return true;
    });
  }, [transactions, filter]);

  const stats = useMemo(() => ({
    earned: balance?.total_earned ?? 0,
    spent: balance?.total_spent ?? 0,
    pending: (balance?.pending_in ?? balance?.pending_incoming ?? 0)
           + (balance?.pending_out ?? balance?.pending_outgoing ?? 0),
  }), [balance]);

  // Export transactions to CSV using papaparse
  async function handleExport() {
    if (transactions.length === 0) {
      toast.info(t('toast.no_data'));
      return;
    }

    const data = transactions.map((tx) => ({
      [t('csv.date')]: new Date(tx.created_at).toLocaleDateString(getFormattingLocale()),
      [t('csv.type')]: tx.type === 'credit' ? t('csv.received') : t('csv.sent'),
      [t('csv.amount')]: tx.amount,
      [t('csv.description')]: tx.description || '',
      [t('csv.other_party')]: tx.other_user?.name || tx.other_party?.name || '',
      [t('csv.status')]: tx.status,
    }));

    const Papa = await import('papaparse');
    const csvContent = Papa.default.unparse(data);

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `transactions_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.success(t('toast.exported'), t('toast.exported_desc'));
  }

  return (
    <>
    <PageMeta
      title={t('title')}
      description={t('subtitle')}
      noIndex
    />
    <div className="mx-auto max-w-5xl space-y-6 px-1 sm:px-0">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-theme-default bg-theme-elevated">
              <Wallet className="h-6 w-6 text-amber-500" aria-hidden="true" />
            </div>
            <h1 className="text-2xl font-bold text-theme-primary sm:text-3xl">
              {t('title')}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-theme-muted sm:text-base">{t('subtitle')}</p>
          </div>
          <Button
            variant="tertiary"
            size="sm"
            className="w-full bg-theme-elevated text-theme-muted sm:w-auto"
            startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onPress={() => loadWalletData()}
            isDisabled={isLoading}
            aria-label={t('aria.refresh_wallet')}
          >
            {t('refresh')}
          </Button>
        </div>
      </motion.div>

      {/* Error State */}
      {error && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <GlassCard className="p-6 text-center sm:p-8" role="alert">
            <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h3>
            <p className="text-theme-muted mb-4">{error}</p>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<RefreshCw aria-hidden="true" className="w-4 h-4" />}
              onPress={() => loadWalletData()}
            >
              {t('try_again')}
            </Button>
          </GlassCard>
        </motion.div>
      )}

      {/* Balance Card */}
      {!error && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <GlassCard className="overflow-hidden p-5 sm:p-7">
          <div className="grid gap-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-theme-subtle">{t('your_balance')}</p>

              {isLoading ? (
                <div className="mt-3" role="status" aria-label={t('aria.loading_balance')} aria-busy="true">
                  <Skeleton className="rounded-xl">
                    <div className="h-16 w-48 rounded-xl bg-surface-tertiary" />
                  </Skeleton>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1" aria-live="polite">
                  <span data-testid="wallet-balance" className="text-5xl font-bold leading-none text-theme-primary sm:text-6xl">
                    {balance?.balance ?? 0}
                  </span>
                  <span className="text-xl font-semibold text-theme-muted">{t('hours')}</span>
                </div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Chip
                  size="sm"
                  variant="tertiary"
                  className="bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  startContent={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}
                >
                  {(balance?.pending_in || balance?.pending_incoming) ? t('pending_in', { count: balance?.pending_in ?? balance?.pending_incoming ?? 0 }) : t('no_pending')}
                </Chip>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row lg:w-56 lg:flex-col">
              <Button
                className="w-full bg-gradient-to-r from-accent to-accent-gradient-end px-8 font-medium text-white"
                size="lg"
                startContent={<Send className="h-5 w-5" aria-hidden="true" />}
                onPress={() => setIsTransferModalOpen(true)}
                isDisabled={isLoading || !balance || balance.balance <= 0}
                aria-label={t('aria.send_credits')}
              >
                {t('send_credits')}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                className="w-full bg-rose-500/10 px-6 font-medium text-theme-danger"
                startContent={<ArrowDownLeft className="h-5 w-5" aria-hidden="true" />}
                onPress={() => setIsDonateModalOpen(true)}
                isDisabled={isLoading || !balance || balance.balance <= 0}
                aria-label={t('aria.donate_credits')}
              >
                {t('donate')}
              </Button>
              {hasFeature('partner_venues') && (
                <Button
                  as={Link}
                  to={tenantPath('/venues/pass')}
                  variant="secondary"
                  size="lg"
                  className="w-full px-6 font-medium"
                  startContent={<QrCode className="h-5 w-5" aria-hidden="true" />}
                >
                  {t('venue_pass')}
                </Button>
              )}
            </div>
          </div>
        </GlassCard>
      </motion.div>
      )}

      {/* Community Fund */}
      {!error && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <CommunityFundCard
          compact
          onDonateClick={() => setIsDonateModalOpen(true)}
        />
      </motion.div>
      )}

      {/* Stats Grid */}
      {!error && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          icon={<ArrowDownLeft className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.earned')}
          value={t('signed_hours_value', { sign: '+', count: stats.earned })}
          color="emerald"
          isLoading={isLoading}
        />
        <StatCard
          icon={<ArrowUpRight className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.spent')}
          value={t('signed_hours_value', { sign: '-', count: stats.spent })}
          color="rose"
          isLoading={isLoading}
        />
        <StatCard
          icon={<Clock className="w-5 h-5" aria-hidden="true" />}
          label={t('stats.pending')}
          value={t('hours_value', { count: stats.pending })}
          color="amber"
          isLoading={isLoading}
        />
      </motion.div>
      )}

      {/* Transactions */}
      {!error && (
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <GlassCard className="p-4 sm:p-6">
          <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold text-theme-primary flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent dark:text-accent" aria-hidden="true" />
              {t('history')}
            </h2>

            <Button
              variant="secondary"
              size="sm"
              className="bg-theme-elevated text-theme-muted"
              startContent={<Download className="w-4 h-4" aria-hidden="true" />}
              onPress={() => { void handleExport(); }}
              isDisabled={transactions.length === 0}
              aria-label={t('aria.export_csv')}
            >
              {t('export')}
            </Button>
          </div>

          {/* Filter Tabs */}
          <Tabs
            aria-label={t('aria.transaction_filters')}
            selectedKey={filter}
            onSelectionChange={(key) => setFilter(key as TransactionFilter)}
            classNames={{
              base: 'w-full max-w-full overflow-x-auto',
              tabList: 'bg-theme-elevated p-1 rounded-lg min-w-max flex-nowrap',
              cursor: 'bg-theme-hover',
              tab: 'shrink-0 text-theme-muted data-[selected=true]:text-theme-primary',
            }}
          >
            <Tab key="all" title={t('filter.all')} />
            <Tab key="earned" title={t('filter.earned')} />
            <Tab key="spent" title={t('filter.spent')} />
            <Tab key="pending" title={t('filter.pending')} />
          </Tabs>

          {/* Transactions List */}
          <div className="mt-6 space-y-3">
            {isLoading ? (
              <div role="status" aria-label={t('aria.loading_transactions')} aria-busy="true" className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="p-4 rounded-lg bg-theme-elevated">
                  <div className="flex items-center gap-4">
                    <Skeleton className="rounded-full flex-shrink-0"><div className="w-10 h-10 rounded-full bg-surface-tertiary" /></Skeleton>
                    <div className="flex-1 space-y-2">
                      <Skeleton className="rounded-lg"><div className="h-4 rounded-lg bg-surface-tertiary w-1/3" /></Skeleton>
                      <Skeleton className="rounded-lg"><div className="h-3 rounded-lg bg-surface-secondary w-1/4" /></Skeleton>
                    </div>
                  </div>
                </div>
                ))}
              </div>
              ) : txError ? (
              <div className="py-8 text-center" role="alert">
                <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-[var(--color-warning)]" aria-hidden="true" />
                <p className="mb-4 text-theme-muted">{txError}</p>
                <Button
                  variant="secondary"
                  className="bg-theme-elevated text-theme-muted"
                  startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
                  onPress={() => loadWalletData()}
                >
                  {t('try_again')}
                </Button>
              </div>
              ) : filteredTransactions.length === 0 ? (
              <EmptyState
                icon={<Wallet className="w-12 h-12" />}
                title={filter === 'all' ? t('no_transactions') : t('no_filtered_transactions')}
                description={filter === 'all' ? t('no_transactions_desc') : t('no_filtered_transactions_desc')}
                action={filter === 'all' ? undefined : { label: t('filter.all'), onClick: () => setFilter('all'), variant: 'secondary' }}
              />
            ) : (
              <>
                {filteredTransactions.map((transaction) => (
                  <TransactionCard key={transaction.id} transaction={transaction} />
                ))}
                {/* Load More Button */}
                {hasMoreTransactions && (
                  <div className="pt-4 text-center">
                    <Button
                      variant="secondary"
                      className="bg-theme-elevated text-theme-muted"
                      onPress={loadMoreTransactions}
                      isLoading={isLoadingMore}
                      aria-label={t('aria.load_more_transactions')}
                    >
                      {t('load_more')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </GlassCard>
      </motion.div>
      )}

      {/* Transfer Modal */}
      <TransferModal
        isOpen={isTransferModalOpen}
        onClose={() => { setIsTransferModalOpen(false); setSavedRecipientId(null); }}
        currentBalance={balance?.balance ?? 0}
        onTransferComplete={handleTransferComplete}
        initialRecipientId={savedRecipientId}
      />

      {/* Donate Modal */}
      <DonateModal
        isOpen={isDonateModalOpen}
        onClose={() => setIsDonateModalOpen(false)}
        currentBalance={balance?.balance ?? 0}
        onDonationComplete={() => loadWalletData()}
      />
    </div>
    </>
  );
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: 'emerald' | 'rose' | 'amber';
  isLoading?: boolean;
}

// 🔴 The light-mode text is the -700 shade, NOT -600, and must stay there. Each
// of these sits on its own colour at 10% over white, and at -600 none of the
// three reaches the 4.5:1 WCAG AA minimum: amber 2.95, rose 3.89, emerald 3.33.
// At -700 they measure 4.67, 5.22 and 4.88. Only amber and rose were reported by
// the accessibility gate — the emerald card did not render in that run, so it
// was a latent failure found by calculation rather than by the test.
const colorClasses = {
  emerald: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  rose: 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
  amber: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

function StatCard({ icon, label, value, color, isLoading }: StatCardProps) {
  return (
    <GlassCard className="min-h-28 p-4">
      <div className={`mb-3 inline-flex rounded-lg p-2 ${colorClasses[color]}`}>
        {icon}
      </div>
      <div className="mb-1 text-xs font-medium text-theme-subtle">{label}</div>
      {isLoading ? (
        <Skeleton className="rounded-lg"><div className="h-7 w-16 rounded-lg bg-surface-tertiary" /></Skeleton>
      ) : (
        <div className="text-2xl font-bold text-theme-primary">{value}</div>
      )}
    </GlassCard>
  );
}

interface TransactionCardProps {
  transaction: Transaction;
}

function TransactionCard({ transaction }: TransactionCardProps) {
  const { t } = useTranslation('wallet');
  const isCredit = transaction.type === 'credit';
  const otherPartyName = transaction.other_user?.name || transaction.other_party?.name;
  const description = transaction.description || t('transaction_fallback');

  return (
    <article
      data-testid="wallet-transaction"
      className="rounded-xl border border-theme-default bg-theme-elevated p-4 transition-colors hover:bg-theme-hover"
      aria-label={t('aria.transaction_detail', { direction: isCredit ? t('csv.received') : t('csv.sent'), amount: transaction.amount, name: otherPartyName || '' })}
    >
      <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
        <div className={`
          p-2.5 rounded-xl self-start shrink-0
          ${isCredit ? 'bg-emerald-500/20' : 'bg-rose-500/20'}
        `}>
          {isCredit ? (
            <ArrowDownLeft className="w-5 h-5 text-emerald-400" aria-hidden="true" />
          ) : (
            <ArrowUpRight className="w-5 h-5 text-rose-400" aria-hidden="true" />
          )}
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <h4 className="min-w-0 flex-1 basis-48 break-words font-semibold text-theme-primary [overflow-wrap:anywhere]">
              {description}
            </h4>
            {transaction.status === 'pending' && (
              <Chip size="sm" variant="soft" color="warning" className="shrink-0">
                {t('filter.pending')}
              </Chip>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-theme-subtle mt-1">
            {otherPartyName && (
              <span className="flex min-w-0 max-w-full items-center gap-1">
                <User className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{otherPartyName}</span>
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3 shrink-0" aria-hidden="true" />
              <time dateTime={transaction.created_at}>
                {new Date(transaction.created_at).toLocaleDateString(getFormattingLocale())}
              </time>
            </span>
          </div>
        </div>

        <div className={`col-span-2 max-w-full justify-self-end break-words text-right text-lg font-bold leading-tight [overflow-wrap:anywhere] sm:col-span-1 sm:text-xl ${isCredit ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
          {t('signed_hours_value', { sign: isCredit ? '+' : '-', count: transaction.amount })}
        </div>
      </div>
    </article>
  );
}

export default WalletPage;
