// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { parseDecimalInput , formatDecimal } from '@/lib/utils/decimal';
import { useEffect, useMemo, useState } from 'react';
import { Platform, RefreshControl, ScrollView, Share, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, CloseButton, Spinner, Surface, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';

import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import {
  getCommunityFundBalance,
  getWalletBalance,
  getWalletTransactions,
  donateWalletCredits,
  searchWalletUsers,
  transferWalletCredits,
  type CommunityFundBalance,
  type TransactionItem,
  type WalletBalance,
  type WalletUserSearchResult,
} from '@/lib/api/wallet';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import NativePressable from '@/components/ui/NativePressable';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
type TransactionFilter = 'all' | 'earned' | 'spent' | 'pending';
type WalletAction = 'transfer' | 'donate' | null;
type DonationTarget = 'community_fund' | 'user';

/**
 * How many extra pages an export will fetch (100 rows each) before it stops and says so.
 * A ceiling rather than an unbounded loop: a wallet years deep should not hold the export
 * button for minutes with no way out.
 */
const EXPORT_PAGE_LIMIT = 50;

/**
 * A cursor-paged wallet response. `next_cursor` is accepted alongside `cursor` because the
 * endpoint has used both spellings; taking either is cheaper than a page of history going
 * silently unreachable when one of them changes.
 */
type PagedPayload = {
  data?: TransactionItem[];
  meta?: { cursor?: string | null; next_cursor?: string | null; has_more?: boolean };
};

const filters: TransactionFilter[] = ['all', 'earned', 'spent', 'pending'];

/**
 * 🔴 Pending is offered only when something is actually pending.
 *
 * Measured on 2026-08-24: in a community without external federation switched on, **nothing
 * ever writes a pending credit**. `WalletService` settles both of its insert paths as
 * `completed`; the only producer of `transactions.status = 'pending'` is
 * `FederationController`, which is off by default and has never had a partner connected.
 * `EventCreditService` does write `pending`, but to its own claims table and only for the
 * moment between claiming and settling — a member never sees it.
 *
 * So for practically every member this tab could only ever answer "No matching
 * transactions": a control that exists, looks live, and leads nowhere. It now appears when
 * there is a pending amount to look at — which is exactly when a federated community has
 * one — and stays out of the way otherwise. The balance card still says "No pending
 * credits", so the absence is stated rather than merely implied.
 */
function visibleFilters(pendingIn: number, pendingOut: number): TransactionFilter[] {
  const hasPending = pendingIn > 0 || pendingOut > 0;
  return hasPending ? filters : filters.filter((item) => item !== 'pending');
}

function formatDate(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatHours(value: number | null | undefined): string {
  const amount = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  // Locale-aware: "1,5" for a German member, "1.5" for an Irish one (audit 2026-09-05, F06).
  return formatDecimal(amount, 1);
}

function unwrap<T>(response: { data?: T } | T | null | undefined): T | null {
  if (!response) return null;
  if (typeof response === 'object' && 'data' in response) return (response as { data?: T }).data ?? null;
  return response as T;
}

function getOtherName(transaction: TransactionItem, fallback: string) {
  return transaction.other_user?.name ?? transaction.other_party?.name ?? fallback;
}

function getStatusLabel(transaction: TransactionItem, t: (key: string, opts?: Record<string, unknown>) => string) {
  const knownStatuses = new Set(['completed', 'pending', 'cancelled', 'disputed', 'failed']);
  return knownStatuses.has(transaction.status) ? t(`status.${transaction.status}`) : transaction.status;
}

function normaliseAmount(value: string): number {
  // The shared parser: "1 000", "1.000,5" and "1,5" all resolve the way the member meant.
  return parseDecimalInput(value) ?? Number.NaN;
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function WalletModal() {
  return (
    <ModalErrorBoundary>
      <WalletModalInner />
    </ModalErrorBoundary>
  );
}

function WalletModalInner() {
  const { t } = useTranslation('wallet');
  const params = useLocalSearchParams<{ to?: string; name?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [filter, setFilter] = useState<TransactionFilter>('all');
  const [activeAction, setActiveAction] = useState<WalletAction>(params.to ? 'transfer' : null);
  const [extraTransactions, setExtraTransactions] = useState<TransactionItem[]>([]);
  const [extraCursor, setExtraCursor] = useState<string | null>(null);
  const [extraHasMore, setExtraHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  /*
    Pending rows are their own request (see below), so they need their own paging state.
    🔴 They had none: the screen asked for 50 and consumed neither the cursor nor
    `has_more`, so a member with more than fifty pending rows saw a truncated list presented
    as the whole of it (audit 2026-09-06, F12).
  */
  const [extraPending, setExtraPending] = useState<TransactionItem[]>([]);
  const [extraPendingCursor, setExtraPendingCursor] = useState<string | null>(null);
  const [extraPendingHasMore, setExtraPendingHasMore] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const balanceQuery = useApi(() => getWalletBalance(), []);
  const transactionsQuery = useApi(() => getWalletTransactions(undefined, 50, 'all'), []);
  const fundQuery = useApi(() => getCommunityFundBalance(), []);
  /**
   * 🔴 Pending rows are a separate request on purpose.
   *
   * `GET /v2/wallet/transactions` is completed-only for every other filter, because both
   * frontends compute earned/spent totals from this list as a fallback and a pending amount
   * must never be counted as settled. So the Pending filter asks for them explicitly. Until
   * 2026-08-23 the endpoint had no pending mode at all, and this filter answered "No
   * matching transactions" while the tile beside it read "PENDING 11h".
   */
  const pendingQuery = useApi(
    () => getWalletTransactions(undefined, 50, 'pending'),
    [],
    { enabled: filter === 'pending' },
  );
  const firstPagePending = useMemo(() => {
    // Array-checked rather than `?? []`: a payload that is present but not a list would
    // otherwise reach the list renderer and be spread, taking the whole wallet down with
    // an error boundary instead of showing an empty filter.
    const items = unwrap<TransactionItem[]>(pendingQuery.data);
    return Array.isArray(items) ? items : [];
  }, [pendingQuery.data]);
  const pendingTransactions = useMemo(
    () => [...firstPagePending, ...extraPending],
    [extraPending, firstPagePending],
  );
  const pendingPayload = pendingQuery.data as PagedPayload | TransactionItem[] | null | undefined;
  const initialPendingCursor = !Array.isArray(pendingPayload)
    ? (pendingPayload?.meta?.cursor ?? pendingPayload?.meta?.next_cursor ?? null)
    : null;
  const initialPendingHasMore = !Array.isArray(pendingPayload)
    ? Boolean(pendingPayload?.meta?.has_more)
    : firstPagePending.length >= 50;
  const nextPendingCursor = extraPendingCursor ?? initialPendingCursor;
  const hasMorePending = extraPending.length > 0 ? extraPendingHasMore : initialPendingHasMore;

  const balance = unwrap<WalletBalance>(balanceQuery.data)?.balance ?? null;
  const wallet = unwrap<WalletBalance>(balanceQuery.data);
  const transactionsPayload = transactionsQuery.data as PagedPayload | TransactionItem[] | null | undefined;
  const firstPageTransactions = useMemo(() => unwrap<TransactionItem[]>(transactionsQuery.data) ?? [], [transactionsQuery.data]);
  const initialCursor = !Array.isArray(transactionsPayload) ? (transactionsPayload?.meta?.cursor ?? transactionsPayload?.meta?.next_cursor ?? null) : null;
  const initialHasMore = !Array.isArray(transactionsPayload) ? Boolean(transactionsPayload?.meta?.has_more) : firstPageTransactions.length >= 50;
  const transactions = useMemo(() => [...firstPageTransactions, ...extraTransactions], [extraTransactions, firstPageTransactions]);
  const nextCursor = extraCursor ?? initialCursor;
  const hasMoreTransactions = extraTransactions.length > 0 ? extraHasMore : initialHasMore;
  const fund = unwrap<CommunityFundBalance>(fundQuery.data);
  const isLoading = balanceQuery.isLoading
    || transactionsQuery.isLoading
    || fundQuery.isLoading
    || pendingQuery.isLoading;
  const error = balanceQuery.error || transactionsQuery.error;
  const routeRecipientId = Array.isArray(params.to) ? params.to[0] : params.to;

  useEffect(() => {
    if (routeRecipientId) {
      setActiveAction('transfer');
    }
  }, [routeRecipientId]);

  const stats = useMemo(() => {
    const earned = wallet?.total_earned ?? wallet?.total_credits ?? transactions.filter((tx) => tx.type === 'credit').reduce((total, tx) => total + tx.amount, 0);
    const spent = wallet?.total_spent ?? wallet?.total_debits ?? transactions.filter((tx) => tx.type === 'debit').reduce((total, tx) => total + tx.amount, 0);
    /**
     * 🔴 These two were ADDED TOGETHER and shown as one number.
     *
     * Credits coming in and credits going out are opposite directions, so their sum is
     * neither figure. Measured on a device 2026-08-23 with 7 in and 4 out: the wallet said
     * "11 pending" in the chip and "PENDING 11h" in the tile — beside EARNED "+3h" and
     * SPENT "-5h", which do carry a direction.
     */
    const pendingIn = wallet?.pending_in ?? wallet?.pending_incoming ?? 0;
    const pendingOut = wallet?.pending_out ?? wallet?.pending_outgoing ?? 0;
    return { earned, spent, pendingIn, pendingOut };
  }, [transactions, wallet]);

  const filteredTransactions = useMemo(() => {
    if (filter === 'pending') return pendingTransactions;
    return transactions.filter((tx) => {
      if (filter === 'all') return true;
      if (filter === 'earned') return tx.type === 'credit';
      return tx.type === 'debit';
    });
  }, [filter, pendingTransactions, transactions]);

  function refresh() {
    setExtraTransactions([]);
    setExtraCursor(null);
    setExtraHasMore(false);
    setExtraPending([]);
    setExtraPendingCursor(null);
    setExtraPendingHasMore(false);
    balanceQuery.refresh();
    transactionsQuery.refresh();
    fundQuery.refresh();
    pendingQuery.refresh();
  }

  /*
    🔴 Reachable from EVERY filter, not only "All" (audit 2026-09-06, F12).

    Earned and Spent filter the rows already in memory, and the next-page button used to be
    rendered for "All" alone - so a member whose recent 50 transactions happened to be all
    outgoing saw an empty Earned tab, with no way to reach the credits sitting one page
    back, and nothing on screen to suggest the history went any further. The filtering is
    still done client-side over one shared list; what changes is that every filter can now
    extend that list.
  */
  async function loadMoreTransactions() {
    if (isLoadingMore) return;
    const pending = filter === 'pending';
    const cursor = pending ? nextPendingCursor : nextCursor;
    if (!cursor) return;
    setIsLoadingMore(true);
    try {
      const response = await getWalletTransactions(cursor, 50, pending ? 'pending' : 'all');
      if (pending) {
        setExtraPending((current) => [...current, ...(response.data ?? [])]);
        setExtraPendingCursor(response.meta?.cursor ?? null);
        setExtraPendingHasMore(Boolean(response.meta?.has_more));
      } else {
        setExtraTransactions((current) => [...current, ...(response.data ?? [])]);
        setExtraCursor(response.meta?.cursor ?? null);
        setExtraHasMore(Boolean(response.meta?.has_more));
      }
    } catch (err) {
      showToast({
        title: t('actions.loadMoreFailedTitle'),
        description: describeApiError(err, t('actions.loadMoreFailedMessage')),
        variant: 'danger',
      });
    } finally {
      setIsLoadingMore(false);
    }
  }

  const canLoadMore = filter === 'pending' ? hasMorePending : hasMoreTransactions;

  /**
   * Collect the member's whole completed history, not just the pages they happened to open.
   *
   * 🔴 The export used to serialise `transactions` - literally whatever was in memory -
   * so its contents depended on how many times the member had pressed "Load more". A member
   * who opened the wallet and exported immediately got their most recent fifty rows in a
   * file that said nothing about being partial, and would reasonably treat it as their
   * record. Bounded at EXPORT_PAGE_LIMIT pages so a very long history cannot spin for ever;
   * the caller says plainly when it hit that bound rather than silently truncating.
   */
  async function collectAllTransactions(): Promise<{ rows: TransactionItem[]; complete: boolean }> {
    const collected = [...transactions];
    let cursor = nextCursor;
    let more = hasMoreTransactions;
    let pages = 0;

    while (more && cursor && pages < EXPORT_PAGE_LIMIT) {
      const response = await getWalletTransactions(cursor, 100, 'all');
      const page = response.data ?? [];
      collected.push(...page);
      cursor = response.meta?.cursor ?? null;
      more = Boolean(response.meta?.has_more) && Boolean(cursor);
      pages += 1;
    }

    // De-duplicated by id: the first page in memory and the first page fetched here can
    // overlap when the member has already pressed "Load more".
    const seen = new Set<string>();
    const rows = collected.filter((tx) => {
      const key = String(tx.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return { rows, complete: !more };
  }

  async function handleExport() {
    if (isExporting) return;
    if (transactions.length === 0) {
      showToast({
        title: t('actions.exportNoDataTitle'),
        description: t('actions.exportNoDataMessage'),
        variant: 'default',
      });
      return;
    }

    setIsExporting(true);
    try {
      const { rows: exported, complete } = await collectAllTransactions();

      const rows = [
        ['date', 'type', 'status', 'amount', 'member', 'description'],
        ...exported.map((tx) => [
          formatDate(tx.created_at),
          tx.type,
          tx.status,
          formatHours(tx.type === 'credit' ? tx.amount : -Math.abs(tx.amount)),
          getOtherName(tx, t('system')),
          tx.description ?? '',
        ]),
      ];
      const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
      const filename = `wallet-transactions-${new Date().toISOString().slice(0, 10)}.csv`;

      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        /*
          🔴 A FILE, not a message. The native branch used to call
          `Share.share({ message: csv })`, which hands other apps a wall of comma-separated
          text: it arrives in a chat or a mail body and cannot be saved as a spreadsheet,
          which is the only thing anyone exports a wallet for. Written to the cache
          directory and shared with the CSV mime type so the sheet offers Files, Drive and
          a spreadsheet app.
        */
        const target = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(target, csv, { encoding: FileSystem.EncodingType.UTF8 });
        if (!(await Sharing.isAvailableAsync())) {
          // Nothing on this device can receive a file. Falling back to the old text share is
          // better than telling the member the export failed when the data is ready.
          await Share.share({ message: csv });
        } else {
          await Sharing.shareAsync(target, {
            mimeType: 'text/csv',
            UTI: 'public.comma-separated-values-text',
            dialogTitle: t('export'),
          });
        }
      }

      showToast({
        title: t('actions.exportSuccessTitle'),
        // Says how many rows went in, and says so plainly when the history was too long to
        // fetch in full rather than presenting a truncated file as complete.
        description: complete
          ? t('actions.exportSuccessCount', { count: exported.length })
          : t('actions.exportPartial', { count: exported.length }),
        variant: complete ? 'success' : 'default',
      });
    } catch (err) {
      showToast({
        title: t('actions.exportFailedTitle'),
        description: describeApiError(err, t('actions.exportFailedMessage')),
        variant: 'danger',
      });
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('title')} backLabel={t('back')} />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        // Only a pull-to-refresh shows the indicator. On the initial load it floated over
        // the hero card's eyebrow text (emulator, 2026-09-05); the cards carry their own
        // loading states for that phase.
        refreshControl={<RefreshControl refreshing={isLoading && Boolean(balanceQuery.data)} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        showsVerticalScrollIndicator={false}
      >
        <HeaderCard t={t} theme={theme} primary={primary} onRefresh={refresh} isLoading={isLoading} />

        {error ? (
          <ErrorCard error={error} t={t} theme={theme} primary={primary} onRetry={refresh} />
        ) : (
          <View className="gap-4">
            <BalanceCard
              balance={balance}
              pendingIn={stats.pendingIn}
              pendingOut={stats.pendingOut}
              isLoading={balanceQuery.isLoading}
              primary={primary}
              theme={theme}
              t={t}
              onSend={() => setActiveAction(activeAction === 'transfer' ? null : 'transfer')}
              onDonate={() => setActiveAction(activeAction === 'donate' ? null : 'donate')}
            />

            {activeAction ? (
              <WalletActionPanel
                action={activeAction}
                balance={balance ?? 0}
                theme={theme}
                primary={primary}
                t={t}
                onClose={() => setActiveAction(null)}
                onComplete={() => {
                  setActiveAction(null);
                  refresh();
                }}
                initialRecipientId={params.to}
                initialRecipientName={params.name}
              />
            ) : null}

            <CommunityFundCard fund={fund} isLoading={fundQuery.isLoading} theme={theme} primary={primary} t={t} onDonate={() => setActiveAction('donate')} />

            <View className="flex-row gap-3">
              <StatCard icon="arrow-down-outline" label={t('stats.earned')} value={t('signedHours', { sign: '+', count: stats.earned })} tone="#22c55e" theme={theme} />
              <StatCard icon="arrow-up-outline" label={t('stats.spent')} value={t('signedHours', { sign: '-', count: stats.spent })} tone="#f43f5e" theme={theme} />
              <StatCard
                icon="time-outline"
                label={t('stats.pending')}
                value={`${t('signedHours', { sign: '+', count: stats.pendingIn })} ${t('signedHours', { sign: '-', count: stats.pendingOut })}`}
                tone="#f59e0b"
                theme={theme}
              />
            </View>

            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-center justify-between gap-3">
                  <View className="min-w-0 flex-1">
                    <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('history')}</Text>
                    <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('historySubtitle')}</Text>
                  </View>
                  <HeroButton size="sm" variant="secondary" onPress={handleExport}>
                    <Ionicons name="download-outline" size={14} color={primary} />
                    <HeroButton.Label>{t('export')}</HeroButton.Label>
                  </HeroButton>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                  {visibleFilters(stats.pendingIn, stats.pendingOut).map((item) => (
                    <FilterChip key={item} label={t(`filter.${item}`)} selected={filter === item} onPress={() => setFilter(item)} tone={primary} testID={`wallet-filter-${item}`} />
                  ))}
                </ScrollView>

                {transactionsQuery.isLoading ? (
                  <View className="items-center py-8"><Spinner size="lg" /></View>
                ) : filteredTransactions.length === 0 ? (
                  <Surface variant="secondary" className="rounded-panel-inner p-5">
                    <EmptyState
                      icon="wallet-outline"
                      title={filter === 'all' ? t('noTransactions') : t('noFilteredTransactions')}
                      /*
                        🔴 "None on this filter" and "none in the part of your history we
                        have loaded" are different statements, and the screen used to make
                        the first when only the second was true. Earned and Spent filter the
                        rows already in memory, so a member whose recent fifty happened to be
                        all outgoing was told flatly that they had never earned anything.
                      */
                      subtitle={canLoadMore
                        ? t('noFilteredTransactionsPartial')
                        : filter === 'all' ? t('noTransactionsDesc') : t('noFilteredTransactionsDesc')}
                    />
                    {canLoadMore ? (
                      <View className="mt-4">
                        <HeroButton
                          testID="wallet-load-more"
                          variant="secondary"
                          onPress={loadMoreTransactions}
                          isDisabled={isLoadingMore}
                        >
                          {isLoadingMore ? <Spinner size="sm" /> : <Ionicons name="chevron-down-outline" size={16} color={primary} />}
                          <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
                        </HeroButton>
                      </View>
                    ) : null}
                  </Surface>
                ) : (
                  <View className="gap-3">
                    {filteredTransactions.map((transaction) => (
                      <TransactionCard key={String(transaction.id)} transaction={transaction} theme={theme} primary={primary} t={t} />
                    ))}
                    {canLoadMore ? (
                      <HeroButton
                        testID="wallet-load-more"
                        variant="secondary"
                        onPress={loadMoreTransactions}
                        isDisabled={isLoadingMore}
                      >
                        {isLoadingMore ? <Spinner size="sm" /> : <Ionicons name="chevron-down-outline" size={16} color={primary} />}
                        <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
                      </HeroButton>
                    ) : null}
                  </View>
                )}
              </HeroCard.Body>
            </HeroCard>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function WalletActionPanel({
  action,
  balance,
  theme,
  primary,
  t,
  onClose,
  onComplete,
  initialRecipientId,
  initialRecipientName,
}: {
  action: Exclude<WalletAction, null>;
  balance: number;
  theme: Theme;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onClose: () => void;
  onComplete: () => void;
  initialRecipientId?: string | string[];
  initialRecipientName?: string | string[];
}) {
  const initialRecipient = useMemo<WalletUserSearchResult | null>(() => {
    const id = Array.isArray(initialRecipientId) ? initialRecipientId[0] : initialRecipientId;
    if (!id) return null;
    const name = Array.isArray(initialRecipientName) ? initialRecipientName[0] : initialRecipientName;
    return {
      id,
      name: name || t('actions.memberFallback'),
      avatar_url: null,
    };
  }, [initialRecipientId, initialRecipientName, t]);
  const { show: showToast } = useAppToast();
  const [donationTarget, setDonationTarget] = useState<DonationTarget>('community_fund');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WalletUserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<WalletUserSearchResult | null>(initialRecipient);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const needsRecipient = action === 'transfer' || donationTarget === 'user';

  async function runSearch() {
    if (query.trim().length < 2) return;
    setIsSearching(true);
    try {
      const response = await searchWalletUsers(query.trim(), 10);
      setResults(response.data?.users ?? []);
    } catch (err) {
      showToast({
        title: t('actions.searchFailedTitle'),
        description: describeApiError(err, t('actions.searchFailedMessage')),
        variant: 'danger',
      });
    } finally {
      setIsSearching(false);
    }
  }

  async function submit() {
    const parsedAmount = normaliseAmount(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast({ title: t('actions.validationTitle'), description: t('actions.validationAmount'), variant: 'warning' });
      return;
    }
    if (parsedAmount > balance) {
      showToast({ title: t('actions.validationTitle'), description: t('actions.validationInsufficient'), variant: 'warning' });
      return;
    }
    if (needsRecipient && !selectedUser) {
      showToast({ title: t('actions.validationTitle'), description: t('actions.validationRecipient'), variant: 'warning' });
      return;
    }

    setIsSubmitting(true);
    try {
      if (action === 'transfer') {
        await transferWalletCredits({
          recipient: selectedUser?.id ?? '',
          amount: parsedAmount,
          description: note.trim() || t('actions.defaultTransferDescription'),
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({ title: t('actions.transferSuccessTitle'), description: t('actions.transferSuccessMessage'), variant: 'success' });
      } else {
        await donateWalletCredits({
          recipient_type: donationTarget,
          recipient_id: donationTarget === 'user' ? selectedUser?.id : undefined,
          amount: parsedAmount,
          message: note.trim(),
        });
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast({ title: t('actions.donationSuccessTitle'), description: t('actions.donationSuccessMessage'), variant: 'success' });
      }
      onComplete();
    } catch (error) {
      const message = error instanceof Error ? error.message : t('actions.mutationFailedMessage');
      showToast({ title: t('actions.mutationFailedTitle'), description: message, variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <HeroCard className="overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: action === 'transfer' ? primary : '#ec4899' }} />
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{t(action === 'transfer' ? 'actions.transferTitle' : 'actions.donateTitle')}</Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t(action === 'transfer' ? 'actions.transferSubtitle' : 'actions.donateSubtitle')}</Text>
          </View>
          <CloseButton onPress={onClose} accessibilityLabel={t('actions.closeAction')} iconProps={{ size: 18, color: primary }} />
        </View>

        {action === 'donate' ? (
          <View className="gap-2">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('actions.donateTo')}</Text>
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" variant={donationTarget === 'community_fund' ? 'primary' : 'secondary'} onPress={() => { setDonationTarget('community_fund'); setSelectedUser(null); }}>
                <HeroButton.Label>{t('actions.communityFundOption')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" variant={donationTarget === 'user' ? 'primary' : 'secondary'} onPress={() => setDonationTarget('user')}>
                <HeroButton.Label>{t('actions.memberOption')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        ) : null}

        {needsRecipient ? (
          <View className="gap-3">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('actions.recipientSearch')}</Text>
            {/*
              🔴 `containerClassName="flex-1"`, and it is load-bearing. An `Input` in a
              `flex-row` beside a button takes its INTRINSIC width unless the container is
              told to fill the space — and `components/ui/Input.tsx` sizes from
              `containerClassName`, not `className`. Without it the recipient field rendered
              as a ~275px pill next to a full-size Search button while Amount and
              Description below it were full width; it was hard to hit and showed almost no
              text. Measured on a device on 2026-08-22.

              `flex-wrap` on the row is the 360dp insurance: the button carries an icon and
              a word, so at narrow widths the two go onto separate lines instead of
              squeezing the field back down to nothing.
            */}
            <View className="flex-row flex-wrap items-center gap-2">
              <Input
                containerClassName="mb-0 min-w-[60%] flex-1"
                style={{ color: theme.text }}
                placeholder={t('actions.recipientSearchPlaceholder')}
                placeholderTextColor={theme.textMuted}
                value={query}
                onChangeText={(value) => {
                  setQuery(value);
                  setSelectedUser(null);
                }}
                returnKeyType="search"
                onSubmitEditing={runSearch}
                leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
              />
              <HeroButton variant="secondary" onPress={runSearch} isDisabled={query.trim().length < 2 || isSearching}>
                {isSearching ? <Spinner size="sm" /> : <Ionicons name="search-outline" size={16} color={primary} />}
                <HeroButton.Label>{t('actions.searchMembers')}</HeroButton.Label>
              </HeroButton>
            </View>
            {selectedUser ? (
              <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
                <Avatar uri={selectedUser.avatar_url ?? null} name={selectedUser.name} size={36} />
                <View className="min-w-0 flex-1">
                  <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{selectedUser.name}</Text>
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('actions.selectedRecipient')}</Text>
                </View>
              </Surface>
            ) : null}
            {results.length > 0 ? (
              <View className="gap-2">
                {results.map((user) => (
                  <HeroButton
                    key={String(user.id)}
                    variant="ghost"
                    feedbackVariant="scale"
                    className="w-full p-0"
                    accessibilityLabel={user.name}
                    onPress={() => setSelectedUser(user)}
                  >
                    <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
                      <Avatar uri={user.avatar_url ?? null} name={user.name} size={36} />
                      <View className="min-w-0 flex-1">
                        <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{user.name}</Text>
                        <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{user.location ?? user.email ?? t('actions.memberFallback')}</Text>
                      </View>
                      <Ionicons name={selectedUser?.id === user.id ? 'checkmark-circle' : 'chevron-forward'} size={18} color={primary} />
                    </Surface>
                  </HeroButton>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <View className="gap-2">
          <Input
            label={t('actions.amount')}
            placeholder={t('actions.amountPlaceholder')}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
        </View>

        <View className="gap-2">
          <Input
            label={t(action === 'transfer' ? 'actions.description' : 'actions.message')}
            style={{ minHeight: 80, textAlignVertical: 'top' }}
            placeholder={t(action === 'transfer' ? 'actions.descriptionPlaceholder' : 'actions.messagePlaceholder')}
            value={note}
            onChangeText={setNote}
            multiline
          />
        </View>

        <HeroButton variant="primary" onPress={submit} isDisabled={isSubmitting}>
          {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name={action === 'transfer' ? 'send-outline' : 'heart-outline'} size={16} />}
          <HeroButton.Label>{t(action === 'transfer' ? 'actions.sendNow' : 'actions.donateNow')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function HeaderCard({
  t,
  theme,
  primary,
  onRefresh,
  isLoading,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: Theme;
  primary: string;
  onRefresh: () => void;
  isLoading: boolean;
}) {
  return (
    <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: '#f59e0b' }} />
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.16) }}>
            <Ionicons name="wallet-outline" size={25} color="#f59e0b" />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('eyebrow')}</Text>
            <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('title')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
          </View>
          <HeroButton size="sm" variant="secondary" isIconOnly onPress={onRefresh} isDisabled={isLoading} accessibilityLabel={t('refresh')}>
            <Ionicons name="refresh-outline" size={17} color={primary} />
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function BalanceCard({
  balance,
  pendingIn,
  pendingOut,
  isLoading,
  primary,
  theme,
  t,
  onSend,
  onDonate,
}: {
  balance: number | null;
  pendingIn: number;
  pendingOut: number;
  isLoading: boolean;
  primary: string;
  theme: Theme;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onSend: () => void;
  onDonate: () => void;
}) {
  const canSpend = (balance ?? 0) > 0 && !isLoading;
  // 🔴 Never add the two directions together — see the block comment on the stats memo.
  const hasPending = pendingIn > 0 || pendingOut > 0;
  const pendingLabel = pendingIn > 0 && pendingOut > 0
    ? t('pendingInOut', { in: formatHours(pendingIn), out: formatHours(pendingOut) })
    : pendingIn > 0
      ? t('pendingIn', { hours: formatHours(pendingIn) })
      : pendingOut > 0
        ? t('pendingOut', { hours: formatHours(pendingOut) })
        : t('noPending');
  return (
    <HeroCard className="overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-5 p-5">
        <View className="gap-2">
          <Text className="text-sm font-semibold" style={{ color: theme.textSecondary }}>{t('yourBalance')}</Text>
          {isLoading ? (
            <Spinner size="lg" />
          ) : (
            <View className="flex-row items-baseline gap-2">
              <Text className="text-5xl font-bold leading-[58px]" style={{ color: theme.text }}>{formatHours(balance)}</Text>
              <Text className="text-lg font-semibold" style={{ color: theme.textSecondary }}>{t('hours')}</Text>
            </View>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary" color={hasPending ? 'warning' : 'default'}>
              <Ionicons name="time-outline" size={12} color={hasPending ? '#f59e0b' : primary} />
              <Chip.Label testID="wallet-pending-chip">{pendingLabel}</Chip.Label>
            </Chip>
          </View>
        </View>
        <View className="flex-row gap-3">
          <HeroButton className="flex-1" variant="primary" onPress={onSend} isDisabled={!canSpend}>
            <AccentIcon name="send-outline" size={16} />
            <HeroButton.Label>{t('sendCredits')}</HeroButton.Label>
          </HeroButton>
          <HeroButton className="flex-1" variant="secondary" onPress={onDonate} isDisabled={!canSpend}>
            <Ionicons name="heart-outline" size={16} color={primary} />
            <HeroButton.Label>{t('donate')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function CommunityFundCard({
  fund,
  isLoading,
  theme,
  primary,
  t,
  onDonate,
}: {
  fund: CommunityFundBalance | null;
  isLoading: boolean;
  theme: Theme;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onDonate: () => void;
}) {
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-center gap-3">
          <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.14) }}>
            <Ionicons name="business-outline" size={21} color="#f59e0b" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-bold" style={{ color: theme.text }}>{t('communityFund')}</Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('communityFundDesc')}</Text>
          </View>
          <HeroButton size="sm" variant="secondary" onPress={onDonate}>
            <Ionicons name="heart-outline" size={14} color={primary} />
            <HeroButton.Label>{t('donate')}</HeroButton.Label>
          </HeroButton>
        </View>
        {isLoading ? (
          <View className="items-center py-3"><Spinner size="sm" /></View>
        ) : (
          <View className="flex-row gap-3">
            <MiniMetric label={t('fund.balance')} value={t('hoursValue', { count: fund?.balance ?? 0 })} tone="#f59e0b" theme={theme} />
            <MiniMetric label={t('fund.deposited')} value={t('hoursValue', { count: fund?.total_deposited ?? 0 })} tone="#22c55e" theme={theme} />
            <MiniMetric label={t('fund.donated')} value={t('hoursValue', { count: fund?.total_donated ?? 0 })} tone="#ec4899" theme={theme} />
          </View>
        )}
      </HeroCard.Body>
    </HeroCard>
  );
}

function StatCard({ icon, label, value, tone, theme }: { icon: IoniconName; label: string; value: string; tone: string; theme: Theme }) {
  return (
    <HeroCard className="flex-1 rounded-panel p-0">
      <HeroCard.Body className="gap-2 p-3">
        <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
          <Ionicons name={icon} size={18} color={tone} />
        </View>
        <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={2}>{label}</Text>
        <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{value}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function MiniMetric({ label, value, tone, theme }: { label: string; value: string; tone: string; theme: Theme }) {
  return (
    <Surface variant="secondary" className="flex-1 gap-1 rounded-panel-inner p-3">
      <View className="size-2 rounded-full" style={{ backgroundColor: tone }} />
      <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{value}</Text>
    </Surface>
  );
}

function FilterChip({ label, selected, onPress, tone, testID }: { label: string; selected: boolean; onPress: () => void; tone: string; testID?: string }) {
  return (
    <HeroButton size="sm" variant={selected ? 'primary' : 'secondary'} onPress={onPress} style={selected ? { backgroundColor: tone } : undefined} testID={testID}>
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function TransactionCard({
  transaction,
  theme,
  primary,
  t,
}: {
  transaction: TransactionItem;
  theme: Theme;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const isCredit = transaction.type === 'credit';
  const tone = isCredit ? theme.success : theme.error;
  const name = getOtherName(transaction, t('system'));
  const signedAmount = transaction.amount < 0 ? '-' : (isCredit ? '+' : '-');
  const amount = t('signedHours', { sign: signedAmount, count: Math.abs(transaction.amount) });
  const description = transaction.description?.trim() || t('transactionFallback');
  const isFederated = transaction.source === 'federation' || transaction.transaction_type === 'federation';
  const partnerName = transaction.federation?.partner_name?.trim();

  return (
    /*
      🔴 This was a HeroButton wrapping the whole row, and a button caps its own height —
      so every transaction was cropped: the description and the amount were not rendered at
      all, leaving a card showing only an avatar, a name and a date. Measured on a device
      2026-08-23 while walking pending credits; the same fault as the notification cards
      fixed on 2026-08-22. A card-sized tap target belongs in NativePressable, which lets
      its content decide the height.
    */
    <NativePressable
      feedback="scale"
      className="w-full"
      accessibilityRole="button"
      accessibilityLabel={t('transactionLabel', { name, amount })}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        // 🔴 Until 2026-08-23 this row did nothing at all: `GET /v2/wallet/transactions/{id}`
        // existed and no client called it, so a member could see a list of their time
        // credits and never open one (journey 6.12).
        router.push({
          pathname: '/(modals)/wallet-transaction',
          params: { id: String(transaction.id) },
        } as never);
      }}
    >
      <Surface variant="secondary" className="flex-row items-start gap-3 rounded-panel-inner p-3">
        <Avatar uri={transaction.other_user?.avatar_url ?? null} name={name} size={44} />
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-start gap-2">
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{description}</Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{name}</Text>
            </View>
            <Text className="text-base font-bold" style={{ color: tone }}>{amount}</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary">
              <Ionicons name={isCredit ? 'arrow-down-outline' : 'arrow-up-outline'} size={12} color={tone} />
              <Chip.Label>{isCredit ? t('filter.earned') : t('filter.spent')}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="secondary">
              <Ionicons name="calendar-outline" size={12} color={primary} />
              <Chip.Label>{formatDate(transaction.created_at)}</Chip.Label>
            </Chip>
            {transaction.status !== 'completed' ? (
              <Chip size="sm" variant="secondary" color="warning">
                <Chip.Label>{getStatusLabel(transaction, t)}</Chip.Label>
              </Chip>
            ) : null}
            {isFederated ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="git-network-outline" size={12} color={primary} />
                <Chip.Label>{partnerName ? t('federation.partnerCredit', { partner: partnerName }) : t('federation.credit')}</Chip.Label>
              </Chip>
            ) : null}
          </View>
        </View>
      </Surface>
    </NativePressable>
  );
}

function ErrorCard({
  error,
  t,
  theme,
  primary,
  onRetry,
}: {
  error: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  theme: Theme;
  primary: string;
  onRetry: () => void;
}) {
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="items-center gap-4 p-6">
        <View className="size-14 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha('#f59e0b', 0.14) }}>
          <Ionicons name="alert-circle-outline" size={28} color="#f59e0b" />
        </View>
        <View className="gap-2">
          <Text className="text-center text-lg font-bold" style={{ color: theme.text }}>{t('unableToLoad')}</Text>
          <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>{error}</Text>
        </View>
        <HeroButton variant="secondary" onPress={onRetry}>
          <Ionicons name="refresh-outline" size={16} color={primary} />
          <HeroButton.Label>{t('tryAgain')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}
