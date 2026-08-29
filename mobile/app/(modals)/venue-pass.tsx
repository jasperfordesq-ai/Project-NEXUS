// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { getPartnerVenuePass, getPartnerVenueVisits, rotatePartnerVenuePass } from '@/lib/api/venues';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTenant } from '@/lib/hooks/useTenant';

export default function VenuePassScreen() {
  const { t } = useTranslation(['venues', 'common']);
  const { hasFeature } = useTenant();
  const { displayName } = useAuth();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const pass = useApi(getPartnerVenuePass, [], { enabled: hasFeature('partner_venues') });
  const visits = useApi(getPartnerVenueVisits, [], { enabled: hasFeature('partner_venues') });

  const rotate = () => confirm({
    title: t('pass.rotate'),
    message: t('pass.rotate_hint'),
    confirmLabel: t('pass.rotate'),
    cancelLabel: t('common:buttons.cancel'),
    variant: 'danger',
    onConfirm: async () => {
      try {
        await rotatePartnerVenuePass();
        await pass.refresh();
        showToast({ title: t('pass.rotated'), variant: 'success' });
      } catch {
        showToast({ title: t('pass.rotate_failed'), variant: 'danger' });
      }
    },
  });

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('pass.title')} backLabel={t('common:back')} fallbackHref="/(modals)/venues" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {!hasFeature('partner_venues') ? <EmptyState icon="warning-outline" title={t('verify.unavailable')} /> : pass.isLoading ? <LoadingSpinner /> : pass.error || !pass.data ? (
            <EmptyState icon="warning-outline" title={pass.error ?? t('pass.unavailable')} actionLabel={t('common:buttons.retry')} onAction={pass.refresh} />
          ) : (
            <View className="gap-4">
              <Text className="text-sm leading-5 text-muted-foreground">{t('pass.intro')}</Text>
              <HeroCard className="rounded-panel">
                <HeroCard.Body className="items-center gap-4 p-6">
                  <View className="rounded-panel-inner bg-white p-3" accessibilityRole="image" accessibilityLabel={t('pass.qr_alt')}>
                    <QRCode value={pass.data.qr_url} size={220} color="#000000" backgroundColor="#ffffff" ecl="M" />
                  </View>
                  {displayName ? <Text className="text-lg font-semibold text-foreground">{displayName}</Text> : null}
                  <Text className="text-sm font-semibold text-success">{t('pass.active')}</Text>
                  <Text className="text-center text-sm leading-5 text-muted-foreground">{t('pass.show_to_staff')}</Text>
                  <Button variant="outline" onPress={rotate}>{t('pass.rotate')}</Button>
                </HeroCard.Body>
              </HeroCard>
              <HeroCard className="rounded-panel">
                <HeroCard.Body className="gap-3 p-5">
                  <Text accessibilityRole="header" className="text-lg font-bold text-foreground">{t('pass.recent_visits')}</Text>
                  {(visits.data ?? []).length === 0 ? <Text className="text-sm text-muted-foreground">{t('pass.no_visits')}</Text> : visits.data?.map((visit) => (
                    <View key={visit.id} className="flex-row justify-between gap-3 border-b border-default-100 py-2">
                      <Text className="min-w-0 flex-1 font-medium text-foreground">{visit.venue_name}</Text>
                      <Text className="text-sm text-muted-foreground">{visit.visited_on}</Text>
                    </View>
                  ))}
                  <Button variant="ghost" onPress={() => router.push('/(modals)/venues')}>{t('pass.browse_venues')}</Button>
                </HeroCard.Body>
              </HeroCard>
            </View>
          )}
        </ScrollView>
        {confirmDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
