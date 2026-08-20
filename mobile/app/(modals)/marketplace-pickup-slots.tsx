// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

export default function MarketplacePickupSlotsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplacePickupSlotsRedirect />
    </ModalErrorBoundary>
  );
}

function MarketplacePickupSlotsRedirect() {
  const { t } = useTranslation(['marketplace', 'common']);

  useEffect(() => {
    router.replace({
      pathname: '/(modals)/marketplace-tools',
      params: { tab: 'pickups' },
    } as unknown as Href);
  }, []);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('tools.pickups.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-tools' as Href} />
      <View className="flex-1 items-center justify-center">
        <LoadingSpinner />
      </View>
    </SafeAreaView>
  );
}
