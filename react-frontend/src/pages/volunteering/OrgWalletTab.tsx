// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OrgWalletTab - Organisation credit record: balance, deposits, and history.
 *
 * Note: under the auto-mint model, approving a volunteer's hours ALWAYS credits
 * them automatically — the org does not need to fund a wallet first. This tab is
 * therefore a record/ledger, not a spending account, and there is no auto-pay
 * toggle (approval is always "on").
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from '@/lib/motion';

import Wallet from 'lucide-react/icons/wallet';
import ArrowDownToLine from 'lucide-react/icons/arrow-down-to-line';
import ArrowUpFromLine from 'lucide-react/icons/arrow-up-from-line';
import Clock from 'lucide-react/icons/clock';
import ChevronDown from 'lucide-react/icons/chevron-down';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import User from 'lucide-react/icons/user';
import CheckCircle from 'lucide-react/icons/circle-check-big';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';

/* ───────────────────────── Types ───────────────────────── */

interface OrgWalletTabProps {
  orgId: number;
  balance: number;
  autoPay: boolean;
  onBalanceChange: () => void;
}

interface WalletTransaction {
  id: number;
  type: 'deposit' | 'withdrawal' | 'volunteer_payment' | 'admin_adjustment';
  amount: number;
  balance_after: number;
  description: string | null;
  created_at: string;
  vol_log_id: number | null;
  user: { id: number; name: string; avatar_url: string | null } | null;
}

interface TransactionsResponse {
  items: WalletTransaction[];
  cursor: string | null;
  has_more: boolean;
}

/* ───────────────────────── Constants ───────────────────────── */

const TYPE_COLOR: Record<WalletTransaction['type'], 'success' | 'warning' | 'danger' | 'primary'> = {
  deposit: 'success',
  volunteer_payment: 'warning',
  withdrawal: 'danger',
  admin_adjustment: 'primary',
};

/* ───────────────────────── Animation variants ───────────────────────── */

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

/* ───────────────────────── Component ───────────────────────── */

const formatAmount = (amount: number) => {
  if (amount > 0) return `+${amount}`;
  return `${amount}`;
};

const getAmountColor = (amount: number) => {
  return amount >= 0 ? 'text-emerald-500' : 'text-[var(--color-error)]';
};

export function OrgWalletTab({ orgId, balance, onBalanceChange }: OrgWalletTabProps) {
  const { t } = useTranslation('volunteering');
  const toast = useToast();
  const { isOpen, onOpen, onOpenChange } = useDisclosure();

  // Transaction state
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Deposit form state
  const [depositAmount, setDepositAmount] = useState('');
  const [depositNote, setDepositNote] = useState('');
  const [isDepositing, setIsDepositing] = useState(false);

  // Stable refs
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const abortRef = useRef<AbortController | null>(null);

  /* ───────────────────────── Data fetching ───────────────────────── */

  const loadTransactions = useCallback(async (nextCursor: string | null = null) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isAppend = nextCursor !== null;

    try {
      if (isAppend) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
        setError(null);
      }

      const params = new URLSearchParams();
      if (nextCursor) params.set('cursor', nextCursor);

      const url = `/v2/volunteering/organisations/${orgId}/wallet/transactions${params.toString() ? `?${params.toString()}` : ''}`;
      const response = await api.get<TransactionsResponse>(url);

      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        // api.get() already unwraps { data: [...], meta: {...} } → response.data = [...], response.meta = {...}
        const items = Array.isArray(response.data) ? response.data : [];
        const newCursor = response.meta?.cursor ?? null;
        const hasMoreData = response.meta?.has_more ?? false;

        if (isAppend) {
          setTransactions((prev) => [...prev, ...items]);
        } else {
          setTransactions(items);
        }
        setCursor(newCursor);
        setHasMore(hasMoreData);
      } else {
        setError(tRef.current('org_wallet.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load transactions', err);
      setError(tRef.current('org_wallet.load_error'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [orgId]);

  const loadRef = useRef(loadTransactions);
  loadRef.current = loadTransactions;

  // Reload when orgId changes so switching between org dashboards never shows a
  // stale org's wallet transactions under the new org's header.
  useEffect(() => {
    loadRef.current();
    return () => { abortRef.current?.abort(); };
  }, [orgId]);

  /* ───────────────────────── Deposit ───────────────────────── */

  const resetDepositForm = () => {
    setDepositAmount('');
    setDepositNote('');
  };

  const handleDeposit = async (onClose: () => void) => {
    if (isDepositing) return;

    const amount = parseFloat(depositAmount);
    if (!depositAmount || isNaN(amount) || amount <= 0) {
      toastRef.current.error(tRef.current('org_wallet.invalid_amount'));
      return;
    }
    if (!Number.isInteger(amount)) {
      // The backend accepts whole credits only (VolOrgWalletService rejects
      // fractional deposits) — give clear field-level guidance up front.
      toastRef.current.error(tRef.current('org_wallet.deposit_whole_credits_only'));
      return;
    }
    if (amount > 1000) {
      // Mirror the backend per-deposit cap (VolOrgWalletService::depositFromUser
      // rejects amounts > 1000) so the user gets clear field-level guidance
      // instead of a generic server rejection.
      toastRef.current.error(tRef.current('org_wallet.deposit_amount_too_large'));
      return;
    }

    try {
      setIsDepositing(true);

      const response = await api.post(`/v2/volunteering/organisations/${orgId}/wallet/deposit`, {
        amount,
        note: depositNote || null,
      });

      if (response.success) {
        toastRef.current.success(tRef.current('org_wallet.deposit_success'));
        resetDepositForm();
        onClose();
        onBalanceChange();
        loadTransactions();
      } else {
        toastRef.current.error(response.error || tRef.current('org_wallet.deposit_error'));
      }
    } catch (err) {
      logError('Failed to deposit credits', err);
      toastRef.current.error(tRef.current('org_wallet.deposit_error'));
    } finally {
      setIsDepositing(false);
    }
  };

  /* ───────────────────────── Helpers ───────────────────────── */

  const getBalanceColor = () => {
    if (balance <= 0) return 'text-[var(--color-error)]';
    if (balance < 5) return 'text-[var(--color-warning)]';
    return 'text-emerald-500';
  };

  return (
    <div className="space-y-6">
      {/* Balance Card */}
      <GlassCard className="p-6 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            <h2 className="text-lg font-semibold text-theme-primary">
              {t('org_wallet.heading')}
            </h2>
          </div>
          <Button
            size="sm"
            variant="tertiary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => {
              onBalanceChange();
              loadTransactions();
            }}
            isDisabled={isLoading}
            className="bg-theme-elevated text-theme-muted sm:shrink-0"
          >
            {t('org_wallet.refresh')}
          </Button>
        </div>

        <div className="text-center py-4">
          <p className={`text-5xl font-bold ${getBalanceColor()}`}>{balance}</p>
          <p className="text-sm text-theme-muted mt-1">
            {t('org_wallet.hours_label')}
          </p>
          <p className="text-xs text-theme-subtle mt-2 max-w-sm mx-auto">
            {t('org_wallet.balance_helper')}
          </p>
        </div>

        <Button
          className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white w-full"
          startContent={<ArrowDownToLine className="w-4 h-4" aria-hidden="true" />}
          onPress={onOpen}
        >
          {t('org_wallet.deposit')}
        </Button>
      </GlassCard>

      {/* How volunteers get paid — replaces the old auto-pay toggle. Approving a
          volunteer's hours always credits them automatically, so there is nothing
          to switch on/off and no balance to keep topped up. */}
      <GlassCard className="p-5 border border-emerald-500/20">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-600 dark:text-emerald-400 shrink-0">
            <CheckCircle className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-theme-primary">
              {t('org_wallet.autocredit_title')}
            </h3>
            <p className="text-sm text-theme-muted mt-1">
              {t('org_wallet.autocredit_description')}
            </p>
          </div>
        </div>
      </GlassCard>

      {/* Transaction History */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="w-5 h-5 text-theme-muted" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-theme-secondary uppercase tracking-wide">
            {t('org_wallet.transaction_history')}
          </h3>
        </div>

        {/* Error */}
        {error && !isLoading && (
          <GlassCard className="p-8 text-center" role="alert">
            <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
            <p className="text-theme-muted mb-4">{error}</p>
            <Button
              className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
              onPress={() => loadTransactions()}
            >
              {t('org_wallet.try_again')}
            </Button>
          </GlassCard>
        )}

        {/* Loading */}
        {!error && isLoading && (
          <div className="space-y-4" role="status" aria-busy="true" aria-label={t('loading')}>
            {[1, 2, 3].map((i) => (
              <CardRowsSkeleton key={i} />
            ))}
          </div>
        )}

        {/* Empty */}
        {!error && !isLoading && transactions.length === 0 && (
          <EmptyState
            icon={<Wallet className="w-12 h-12" aria-hidden="true" />}
            title={t('org_wallet.empty_title')}
            description={t('org_wallet.empty_description')}
          />
        )}

        {/* Transaction List */}
        {!error && !isLoading && transactions.length > 0 && (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {transactions.map((tx) => (
              <motion.div key={tx.id} variants={itemVariants}>
                <GlassCard className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <Chip size="sm" variant="soft" color={TYPE_COLOR[tx.type]}>
                          {t(`org_wallet.types.${tx.type}`)}
                        </Chip>
                        <span className={`font-bold text-lg ${getAmountColor(tx.amount)}`}>
                          {formatAmount(tx.amount)}
                        </span>
                      </div>
                      {tx.description && (
                        <p className="text-sm text-theme-secondary mb-1">{tx.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-3 text-xs text-theme-subtle">
                        {tx.user && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" aria-hidden="true" />
                            {tx.user.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" aria-hidden="true" />
                          {new Date(tx.created_at).toLocaleDateString(getFormattingLocale())}
                        </span>
                        <span className="text-theme-muted">
                          {t('org_wallet.balance_after', {
                            balance: tx.balance_after,
                          })}
                        </span>
                      </div>
                    </div>
                    <div className="flex-shrink-0">
                      {tx.amount >= 0 ? (
                        <ArrowDownToLine className="w-5 h-5 text-emerald-500" aria-hidden="true" />
                      ) : (
                        <ArrowUpFromLine className="w-5 h-5 text-[var(--color-error)]" aria-hidden="true" />
                      )}
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}

            {/* Load More */}
            {hasMore && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="tertiary"
                  startContent={
                    isLoadingMore ? (
                      <div role="status" aria-busy="true" aria-label={t('loading')} className="flex justify-center py-4"><Spinner size="sm" /></div>
                    ) : (
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    )
                  }
                  onPress={() => loadTransactions(cursor)}
                  isDisabled={isLoadingMore}
                >
                  {isLoadingMore
                    ? t('org_wallet.loading_more')
                    : t('org_wallet.load_more')}
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </div>

      {/* Deposit Modal */}
      <Modal
        isOpen={isOpen}
        onOpenChange={(open) => {
          // Don't wipe the form mid-submit if the modal is dismissed (e.g. backdrop
          // click) while a deposit request is still in flight.
          if (!open && !isDepositing) resetDepositForm();
          onOpenChange();
        }}
        classNames={{
          base: 'border border-theme-default bg-theme-surface',
          header: 'border-b border-theme-default',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="text-theme-primary">
                {t('org_wallet.deposit_modal_title')}
              </ModalHeader>
              <ModalBody className="gap-4">
                <Input
                  label={t('org_wallet.form.amount')}
                  type="number"
                  min="1"
                  max="1000"
                  step="1"
                  value={depositAmount}
                  onValueChange={setDepositAmount}
                  variant="secondary"
                  classNames={{ inputWrapper: 'bg-theme-elevated' }}
                  startContent={<Wallet className="w-4 h-4 text-theme-subtle" />}
                  description={t('org_wallet.form.amount_whole_credits_hint')}
                  isRequired
                />
                <Textarea
                  label={t('org_wallet.form.note')}
                  value={depositNote}
                  onValueChange={setDepositNote}
                  variant="secondary"
                  classNames={{ inputWrapper: 'bg-theme-elevated' }}
                  minRows={2}
                  maxRows={4}
                />
              </ModalBody>
              <ModalFooter>
                <Button variant="tertiary" onPress={onClose}>
                  {t('org_wallet.cancel')}
                </Button>
                <Button
                  className="bg-gradient-to-r from-accent-strong to-accent-strong-end text-white"
                  onPress={() => handleDeposit(onClose)}
                  isLoading={isDepositing}
                >
                  {t('org_wallet.deposit_button')}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

export default OrgWalletTab;
