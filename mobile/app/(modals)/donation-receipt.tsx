// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getDonationReceipt } from '@/lib/api/donations';
import { useApi } from '@/lib/hooks/useApi';
import { formatMarketplaceCurrency } from '@/lib/utils/marketplaceCurrency';
import { formatDate } from '@/lib/utils/formatRelativeTime';

export default function DonationReceiptScreen() {
  const { t } = useTranslation(['volunteering', 'common']);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const donationId = Number(id ?? 0);
  const receipt = useApi(() => getDonationReceipt(donationId), [donationId], { enabled: donationId > 0 });

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('donations.receipt_title')} backLabel={t('common:back')} fallbackHref="/(modals)/volunteering" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {receipt.isLoading ? <LoadingSpinner /> : receipt.error || !receipt.data ? (
            <EmptyState icon="warning-outline" title={receipt.error ?? t('donations.receipt_not_found')} actionLabel={t('common:buttons.retry')} onAction={receipt.refresh} />
          ) : (
            <HeroCard className="rounded-panel">
              <HeroCard.Body className="gap-4 p-5">
                {receipt.data.reference ? <Text className="text-right text-xs text-muted-foreground">{t('donations.receipt_ref', { ref: receipt.data.reference })}</Text> : null}
                <View className="items-center gap-2 border-b border-default-100 pb-5">
                  <Text className="text-3xl font-bold text-foreground">{formatMarketplaceCurrency(Number(receipt.data.amount), receipt.data.currency)}</Text>
                  <Text className="text-sm font-semibold text-success">{t(`donations.status.${receipt.data.status}`)}</Text>
                </View>
                <ReceiptRow label={t('donations.receipt_donor')} value={receipt.data.donor_name} />
                <ReceiptRow label={t('donations.receipt_date')} value={formatDate(receipt.data.date)} />
                <ReceiptRow label={t('donations.receipt_community')} value={receipt.data.community_name} />
                <ReceiptRow label={t('donations.receipt_method')} value={receipt.data.payment_method} />
                {receipt.data.message ? (
                  <View className="gap-1 border-t border-default-100 pt-3">
                    <Text className="text-xs text-muted-foreground">{t('donations.receipt_message')}</Text>
                    <Text className="text-sm italic text-foreground">{receipt.data.message}</Text>
                  </View>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function ReceiptRow({ label, value }: { label: string; value: string }) {
  return <View className="flex-row justify-between gap-4"><Text className="text-sm text-muted-foreground">{label}</Text><Text className="min-w-0 flex-1 text-right text-sm font-medium text-foreground">{value}</Text></View>;
}
