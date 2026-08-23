// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One time-credit transaction, in full.
 *
 * 🔴 `GET /v2/wallet/transactions/{id}` existed and NOTHING called it — not this app and
 * not the website. A member could see a list of their time credits and never open one to
 * find out who it was with, what it was for, or what their balance was afterwards.
 * Recorded as journey 6.12 on 2026-08-22 and built on 2026-08-23.
 *
 * Fields come from the live response, not from the neighbouring list type: this endpoint
 * sends the parties as `{ id, name, avatar }` while the list sends `avatar_url`, and it
 * carries `sender` and `receiver` as well as the viewer-relative `other_user`. A negative
 * id addresses a federated transaction, which is why the id is parsed as a signed integer.
 */

import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import { Chip } from '@/components/ui/StatusChip';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getWalletTransaction, type WalletTransactionDetail } from '@/lib/api/wallet';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';
import { withAlpha } from '@/lib/utils/color';

function formatWhen(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(dateLocale(), {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

function partyName(party: WalletTransactionDetail['other_user'], fallback: string): string {
  const name = party?.name?.trim();
  return name && name.length > 0 ? name : fallback;
}

function Row({
  icon,
  label,
  value,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  const theme = useTheme();
  return (
    <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner p-3">
      <View
        className="size-9 items-center justify-center rounded-full"
        style={{ backgroundColor: withAlpha(theme.textMuted, 0.12) }}
      >
        <Ionicons name={icon} size={17} color={theme.textSecondary} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }}>
          {label}
        </Text>
        <Text className="mt-0.5 text-sm font-semibold" style={{ color: theme.text }}>
          {value}
        </Text>
      </View>
    </Surface>
  );
}

function WalletTransactionScreenInner() {
  const { t } = useTranslation(['wallet', 'common']);
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const primary = usePrimaryColor();

  // parseInt, not Number(): a federated transaction is addressed by a NEGATIVE id.
  const parsed = Number.parseInt(String(id ?? ''), 10);
  const safeId = Number.isFinite(parsed) && parsed !== 0 ? parsed : 0;

  const { data, isLoading, error, refresh } = useApi(
    () => getWalletTransaction(safeId),
    [safeId],
    { enabled: safeId !== 0 },
  );
  const transaction = data?.data ?? null;

  const isCredit = transaction?.type === 'credit';
  const amount = useMemo(() => {
    if (!transaction) return '';
    const sign = isCredit ? '+' : '-';
    return t('signedHours', { sign, count: Math.abs(transaction.amount) });
  }, [isCredit, t, transaction]);

  const when = formatWhen(transaction?.created_at);
  const partner = transaction?.federation?.partner_name?.trim();

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('transactionDetail.title')}
        backLabel={t('common:buttons.back')}
        fallbackHref="/(modals)/wallet"
      />
      {isLoading ? (
        <LoadingSpinner />
      ) : !transaction ? (
        <View className="flex-1 items-center justify-center px-6" style={{ flex: 1 }}>
          <EmptyState
            icon="receipt-outline"
            title={t('transactionDetail.notFound')}
            actionLabel={error ? t('common:actions.retry') : undefined}
            onAction={error ? refresh : undefined}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: isCredit ? '#22c55e' : '#f43f5e' }} />
            <HeroCard.Body className="gap-3 p-5">
              <Text className="text-sm font-semibold" style={{ color: theme.textSecondary }}>
                {isCredit ? t('filter.earned') : t('filter.spent')}
              </Text>
              <Text
                className="text-5xl font-bold leading-[58px]"
                style={{ color: isCredit ? '#22c55e' : '#f43f5e' }}
                testID="transaction-amount"
              >
                {amount}
              </Text>
              <Text className="text-base" style={{ color: theme.text }}>
                {transaction.description?.trim() || t('transactionFallback')}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Chip size="sm" variant="secondary" color={transaction.status === 'completed' ? 'success' : 'warning'}>
                  <Chip.Label>
                    {t(`status.${transaction.status}`, { defaultValue: transaction.status })}
                  </Chip.Label>
                </Chip>
                {partner ? (
                  <Chip size="sm" variant="secondary">
                    <Chip.Label>{t('federation.partnerCredit', { partner })}</Chip.Label>
                  </Chip>
                ) : null}
              </View>
            </HeroCard.Body>
          </HeroCard>

          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-center gap-3">
                <Avatar
                  uri={transaction.other_user?.avatar ?? transaction.other_user?.avatar_url ?? null}
                  name={partyName(transaction.other_user, t('system'))}
                  size={44}
                />
                <View className="min-w-0 flex-1">
                  <Text className="text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }}>
                    {isCredit ? t('transactionDetail.from') : t('transactionDetail.to')}
                  </Text>
                  <Text className="mt-0.5 text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                    {partyName(transaction.other_user, t('system'))}
                  </Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          <View className="gap-2">
            {when ? <Row icon="calendar-outline" label={t('transactionDetail.when')} value={when} /> : null}
            <Row
              icon="pricetag-outline"
              label={t('transactionDetail.kind')}
              value={t(`transactionType.${transaction.transaction_type}`, {
                defaultValue: transaction.transaction_type,
              })}
            />
            {/* Genuinely null on older rows, so it is shown only when the server has it. */}
            {typeof transaction.balance_after === 'number' ? (
              <Row
                icon="wallet-outline"
                label={t('transactionDetail.balanceAfter')}
                value={t('hoursValue', { count: transaction.balance_after })}
              />
            ) : null}
            <Row
              icon="finger-print-outline"
              label={t('transactionDetail.reference')}
              value={String(transaction.id)}
            />
          </View>

          <Text className="px-1 text-xs leading-5" style={{ color: theme.textMuted }}>
            {t('transactionDetail.footnote')}
          </Text>
          <View style={{ height: 1, backgroundColor: withAlpha(primary, 0.08) }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default function WalletTransactionScreen() {
  return (
    <ModalErrorBoundary>
      <WalletTransactionScreenInner />
    </ModalErrorBoundary>
  );
}
