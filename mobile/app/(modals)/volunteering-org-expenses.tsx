// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The organisation's own review queue for volunteer expense claims — the website's
 * OrgExpensesTab on a phone.
 *
 * Only the next steps the server accepts are offered: pending → approve / reject,
 * approved → mark as paid, rejected and paid are final. A reviewer never sees actions on
 * their own claim — the server refuses those with 403, so the app does not offer them.
 * Rejecting and marking paid each open a short inline form under the claim so the reason
 * or payment reference travels with the decision, as on the website.
 *
 * Receipts live on a private disk behind the bearer token, so "Receipt" fetches the file
 * with the session's headers and hands it to the share sheet.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Spinner, Surface } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import {
  downloadOrganisationExpenseReceipt,
  getOrganisationExpenses,
  ORG_EXPENSE_ACTIONS,
  reviewOrganisationExpense,
  type OrgExpense,
  type OrgExpenseReviewAction,
  type OrgExpenseStatus,
  type OrgExpensesResponse,
} from '@/lib/api/volunteeringOrganiser';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import { isRefusalStatus } from '@/lib/api/refusal';
import * as Haptics from '@/lib/haptics';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { SHARING_UNAVAILABLE } from '@/lib/volunteering/authenticatedFileDownload';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatMarketplaceCurrency } from '@/lib/utils/marketplaceCurrency';

type StatusFilter = 'all' | OrgExpenseStatus;
const STATUS_FILTERS: StatusFilter[] = ['pending', 'approved', 'rejected', 'paid', 'all'];

function parseId(value?: string | string[]): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** DECIMAL columns arrive as strings ("12.00"); coerce before formatting. */
function toNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

function formatDate(value: string): string {
  const date = new Date(value.includes('T') || value.length <= 10 ? value : value.replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function ExpenseCard({ expense, currentUserId, busy, onReview, onReceipt }: {
  expense: OrgExpense;
  currentUserId: number | null;
  busy: boolean;
  onReview: (action: OrgExpenseReviewAction, extra?: { review_notes?: string; payment_reference?: string }) => Promise<void>;
  onReceipt: () => Promise<void>;
}) {
  const { t } = useTranslation(['volunteeringOrganiser', 'volunteering']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const [open, setOpen] = useState<'rejected' | 'paid' | null>(null);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [fetchingReceipt, setFetchingReceipt] = useState(false);

  const isOwnClaim = currentUserId !== null && Number(expense.user_id) === currentUserId;
  const allowed = ORG_EXPENSE_ACTIONS[expense.status] ?? [];
  const actions = isOwnClaim ? [] : allowed;
  const amount = formatMarketplaceCurrency(toNumber(expense.amount), expense.currency);
  const statusColour = expense.status === 'approved' || expense.status === 'paid'
    ? theme.success
    : expense.status === 'rejected' ? theme.error : theme.warning;

  return (
    <HeroCard className="rounded-panel p-0" testID={`org-expense-${expense.id}`}>
      <HeroCard.Body className="gap-3 p-4">
        <View testID={`org-expense-${expense.id}-identity`} className={`${largeText ? 'gap-3' : 'flex-row items-start gap-3'}`}>
          <Avatar uri={expense.avatar_url ?? undefined} name={expense.volunteer_name} size={42} decorative />
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-base font-semibold" style={{ color: theme.text }}>{expense.volunteer_name}</Text>
              <Chip size="sm" variant="secondary" color="default">
                <Ionicons name="ellipse" size={9} color={statusColour} />
                <Chip.Label>{t(`expenses.filter.${expense.status}`)}</Chip.Label>
              </Chip>
            </View>
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-xl font-bold" style={{ color: theme.text }}>{amount}</Text>
              <Chip size="sm" variant="secondary" color="default">
                <Chip.Label>{t(`volunteering:expenses.types.${expense.expense_type}`, { defaultValue: expense.expense_type })}</Chip.Label>
              </Chip>
            </View>
            <Text className="text-xs" style={{ color: theme.textMuted }}>{t('expenses.submittedOn', { date: formatDate(expense.submitted_at) })}</Text>
            {expense.description ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={largeText ? undefined : 3}>{expense.description}</Text>
            ) : null}
            {expense.review_notes ? (
              <Text className="text-xs italic" style={{ color: theme.textMuted }}>{t('expenses.notePrefix', { note: expense.review_notes })}</Text>
            ) : null}
            {expense.payment_reference ? (
              <Text className="text-xs" style={{ color: theme.textMuted }}>{t('expenses.paymentReference', { reference: expense.payment_reference })}</Text>
            ) : null}
            {isOwnClaim && allowed.length > 0 ? (
              <Text className="text-xs" style={{ color: theme.textMuted }} testID={`org-expense-${expense.id}-own`}>{t('expenses.ownClaim')}</Text>
            ) : null}
          </View>
        </View>

        {expense.has_receipt || actions.length > 0 ? (
          <View testID={`org-expense-${expense.id}-actions`} className={`gap-2 ${largeText ? '' : 'flex-row flex-wrap'}`}>
            {expense.has_receipt ? (
              <HeroButton
                size="sm"
                variant="secondary"
                isDisabled={busy || fetchingReceipt}
                accessibilityLabel={t('expenses.receiptLabel', { name: expense.volunteer_name })}
                onPress={() => {
                  setFetchingReceipt(true);
                  void onReceipt().finally(() => setFetchingReceipt(false));
                }}
                testID={`org-expense-${expense.id}-receipt`}
              >
                {fetchingReceipt ? <Spinner size="sm" /> : <Ionicons name="document-text-outline" size={16} color={primary} />}
                <HeroButton.Label>{t('expenses.receipt')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            {actions.includes('approved') ? (
              <HeroButton size="sm" variant="secondary" isDisabled={busy} accessibilityLabel={t('expenses.approveLabel', { name: expense.volunteer_name })} onPress={() => void onReview('approved')} testID={`org-expense-${expense.id}-approve`}>
                {busy ? <Spinner size="sm" /> : <Ionicons name="checkmark-outline" size={16} color={primary} />}
                <HeroButton.Label>{t('expenses.approve')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            {actions.includes('rejected') ? (
              <HeroButton size="sm" variant="danger-soft" isDisabled={busy} accessibilityLabel={t('expenses.rejectLabel', { name: expense.volunteer_name })} onPress={() => setOpen(open === 'rejected' ? null : 'rejected')} testID={`org-expense-${expense.id}-reject`}>
                <HeroButton.Label>{t('expenses.reject')}</HeroButton.Label>
              </HeroButton>
            ) : null}
            {actions.includes('paid') ? (
              <HeroButton size="sm" variant="secondary" isDisabled={busy} accessibilityLabel={t('expenses.markPaidLabel', { name: expense.volunteer_name })} onPress={() => setOpen(open === 'paid' ? null : 'paid')} testID={`org-expense-${expense.id}-mark-paid`}>
                <Ionicons name="card-outline" size={16} color={primary} />
                <HeroButton.Label>{t('expenses.markPaid')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        ) : null}

        {open === 'rejected' ? (
          <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3" testID={`org-expense-${expense.id}-reject-form`}>
            <Input
              label={t('expenses.rejectNotesLabel')}
              accessibilityLabel={t('expenses.rejectNotesLabel')}
              placeholder={t('expenses.rejectNotesPlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={notes}
              onChangeText={setNotes}
              multiline
              maxLength={2000}
              editable={!busy}
            />
            <View className={`gap-2 ${largeText ? '' : 'flex-row'}`}>
              <HeroButton className={largeText ? 'w-full' : 'flex-1'} size="sm" variant="ghost" isDisabled={busy} onPress={() => setOpen(null)}>
                <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className={largeText ? 'w-full' : 'flex-1'} size="sm" variant="danger" isDisabled={busy} onPress={() => void onReview('rejected', { review_notes: notes }).then(() => setOpen(null))} testID={`org-expense-${expense.id}-reject-confirm`}>
                {busy ? <Spinner size="sm" /> : null}
                <HeroButton.Label>{t('expenses.rejectConfirm')}</HeroButton.Label>
              </HeroButton>
            </View>
          </Surface>
        ) : null}

        {open === 'paid' ? (
          <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3" testID={`org-expense-${expense.id}-paid-form`}>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('expenses.paidIntro')}</Text>
            <Input
              label={t('expenses.paymentReferenceLabel')}
              accessibilityLabel={t('expenses.paymentReferenceLabel')}
              placeholder={t('expenses.paymentReferencePlaceholder')}
              placeholderTextColor={theme.textMuted}
              value={reference}
              onChangeText={setReference}
              maxLength={255}
              editable={!busy}
            />
            <View className={`gap-2 ${largeText ? '' : 'flex-row'}`}>
              <HeroButton className={largeText ? 'w-full' : 'flex-1'} size="sm" variant="ghost" isDisabled={busy} onPress={() => setOpen(null)}>
                <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className={largeText ? 'w-full' : 'flex-1'} size="sm" isDisabled={busy} onPress={() => void onReview('paid', { payment_reference: reference }).then(() => setOpen(null))} testID={`org-expense-${expense.id}-paid-confirm`}>
                {busy ? <Spinner size="sm" /> : null}
                <HeroButton.Label>{t('expenses.paidConfirm')}</HeroButton.Label>
              </HeroButton>
            </View>
          </Surface>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function OrgExpensesScreen() {
  const { t } = useTranslation(['volunteeringOrganiser', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const orgId = parseId(params.id);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const [filter, setFilter] = useState<StatusFilter>('pending');
  const [busyId, setBusyId] = useState<number | null>(null);
  const actionPending = useRef(false);
  const currentUserId = user?.id !== undefined && user?.id !== null ? Number(user.id) : null;

  const list = usePaginatedApi<OrgExpense, OrgExpensesResponse>(
    (cursor) => (orgId ? getOrganisationExpenses(orgId, filter, cursor) : Promise.reject(new Error('invalid-org'))),
    (response) => ({
      items: Array.isArray(response?.data?.items) ? response.data.items : [],
      cursor: response?.data?.cursor ?? null,
      hasMore: Boolean(response?.data?.has_more),
    }),
    [orgId, filter],
    { enabled: Boolean(orgId) },
  );

  const stats = list.response?.data?.stats ?? null;
  const statsCurrency = useMemo(() => list.items.find((item) => item.currency)?.currency ?? null, [list.items]);
  const refresh = useCallback(() => list.refresh(), [list]);

  async function review(expense: OrgExpense, action: OrgExpenseReviewAction, extra?: { review_notes?: string; payment_reference?: string }) {
    if (actionPending.current || !orgId) return;
    actionPending.current = true;
    setBusyId(expense.id);
    try {
      await reviewOrganisationExpense(orgId, expense.id, action, extra);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: action === 'approved' ? t('expenses.approvedToast') : action === 'rejected' ? t('expenses.rejectedToast') : t('expenses.paidToast'),
        variant: 'success',
      });
      refresh();
    } catch (err) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // Somebody else moved this claim on since the list loaded: say so and show the list as it stands.
      const code = err instanceof ApiResponseError ? err.code : null;
      if (code === 'INVALID_STATE' || code === 'NOT_FOUND') {
        showToast({ title: t('expenses.alreadyHandled'), variant: 'warning' });
        refresh();
      } else {
        showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('expenses.actionError')), variant: 'danger' });
      }
    } finally {
      actionPending.current = false;
      setBusyId(null);
    }
  }

  async function openReceipt(expense: OrgExpense) {
    if (!orgId) return;
    try {
      await downloadOrganisationExpenseReceipt(orgId, expense.id);
    } catch (err) {
      const unavailable = err instanceof Error && err.message === SHARING_UNAVAILABLE;
      showToast({
        title: t('common:errors.alertTitle'),
        description: unavailable ? t('expenses.receiptSharingUnavailable') : describeApiError(err, t('expenses.receiptFailed')),
        variant: 'danger',
      });
    }
  }

  if (!orgId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('expenses.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="receipt-outline" title={t('common:errors.notFound')} />
      </SafeAreaView>
    );
  }

  if (isRefusalStatus(list.errorStatus)) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('expenses.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <EmptyState icon="lock-closed-outline" title={t('expenses.notYoursTitle')} subtitle={t('expenses.notYoursHint')} testID="org-expenses-refused" />
      </SafeAreaView>
    );
  }

  const loaded = list.response !== null;
  const figures = stats ? [
    { key: 'total', label: t('expenses.stats.total'), value: stats.total_submitted },
    { key: 'pending', label: t('expenses.stats.pending'), value: stats.pending_review },
    { key: 'approved', label: t('expenses.stats.approved'), value: stats.approved_total },
    { key: 'paid', label: t('expenses.stats.paid'), value: stats.paid_total },
  ] : [];

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('expenses.title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={list.isLoading && loaded} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        contentContainerClassName="gap-4 px-4 pb-8"
      >
        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('expenses.intro')}</Text>

        {figures.length > 0 ? (
          <View testID="org-expenses-stats" className={`gap-2 ${largeText ? '' : 'flex-row flex-wrap'}`}>
            {figures.map((figure) => (
              <Surface key={figure.key} variant="secondary" className={`${largeText ? 'w-full' : 'min-w-[46%] flex-1'} gap-1 rounded-panel-inner p-3`}>
                <Text className="text-lg font-bold" style={{ color: theme.text }}>{formatMarketplaceCurrency(toNumber(figure.value), statsCurrency)}</Text>
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{figure.label}</Text>
              </Surface>
            ))}
          </View>
        ) : null}

        <ChoiceChips
          label={t('expenses.filterLabel')}
          options={STATUS_FILTERS.map((key) => ({ value: key, label: t(`expenses.filter.${key}`) }))}
          selected={filter}
          onSelect={(value) => { if (value) setFilter(value); }}
          testID="org-expenses-filter"
        />

        {list.isLoading && !loaded ? <LoadingSpinner /> : null}
        {list.error && !loaded ? (
          <EmptyState icon="cloud-offline-outline" title={t('expenses.loadError')} actionLabel={t('common:buttons.retry')} onAction={refresh} testID="org-expenses-error" />
        ) : null}
        {loaded ? <RefreshFailedNotice error={list.error} onRetry={refresh} isRetrying={list.isLoading} testID="org-expenses-refresh-failed" /> : null}

        {loaded && !list.error && list.items.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title={t('expenses.emptyTitle')}
            subtitle={filter === 'pending' ? t('expenses.emptyPending') : t('expenses.emptyOther')}
            testID="org-expenses-empty"
          />
        ) : null}

        {list.items.map((expense) => (
          <ExpenseCard
            key={expense.id}
            expense={expense}
            currentUserId={currentUserId}
            busy={busyId === expense.id}
            onReview={(action, extra) => review(expense, action, extra)}
            onReceipt={() => openReceipt(expense)}
          />
        ))}

        {list.hasMore ? (
          <HeroButton variant="secondary" isDisabled={list.isLoadingMore} onPress={list.loadMore} testID="org-expenses-load-more">
            {list.isLoadingMore ? <Spinner size="sm" /> : <Ionicons name="chevron-down-outline" size={16} color={primary} />}
            <HeroButton.Label>{t('expenses.loadMore')}</HeroButton.Label>
          </HeroButton>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function OrgExpensesRoute() {
  return (
    <ModalErrorBoundary>
      <OrgExpensesScreen />
    </ModalErrorBoundary>
  );
}

export default withRouteGate(OrgExpensesRoute, 'volunteering-org-expenses');
