// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { FlatList, Image, Linking, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { getPartnerVenues, type PartnerVenue } from '@/lib/api/venues';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function VenuesScreen() {
  const { t } = useTranslation(['venues', 'common']);
  const { hasFeature } = useTenant();
  const primary = usePrimaryColor();
  const venues = useApi(getPartnerVenues, [], { enabled: hasFeature('partner_venues') });

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('directory.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList
          data={venues.data ?? []}
          keyExtractor={(venue) => String(venue.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={venues.refresh} tintColor={primary} colors={[primary]} />}
          ListHeaderComponent={(
            <View className="mb-4 gap-4">
              <Text className="text-sm leading-5 text-muted-foreground">{t('directory.intro')}</Text>
              <Button fullWidth onPress={() => router.push('/(modals)/venue-pass')}>{t('directory.my_pass')}</Button>
            </View>
          )}
          renderItem={({ item }) => <VenueCard venue={item} />}
          ListEmptyComponent={venues.isLoading ? <LoadingSpinner /> : (
            <EmptyState
              icon={venues.error || !hasFeature('partner_venues') ? 'warning-outline' : 'storefront-outline'}
              title={!hasFeature('partner_venues') ? t('verify.unavailable') : venues.error ?? t('directory.empty')}
              actionLabel={venues.error ? t('common:buttons.retry') : undefined}
              onAction={venues.error ? venues.refresh : undefined}
            />
          )}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function VenueCard({ venue }: { venue: PartnerVenue }) {
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const address = [venue.address_line, venue.city, venue.postcode].filter(Boolean).join(', ');
  const content = (
    <HeroCard className="mb-3 rounded-panel">
      <HeroCard.Body className="gap-2 p-4">
        <View className="flex-row items-start gap-3">
          {venue.logo_url ? <Image source={{ uri: venue.logo_url }} className="h-12 w-12 rounded-panel-inner" accessibilityLabel="" /> : <View className="h-12 w-12 rounded-panel-inner bg-default-100" />}
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{venue.name}</Text>
            {venue.category ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t(`categories.${venue.category}`, { defaultValue: venue.category })}</Text> : null}
          </View>
        </View>
        {venue.offer_summary ? <Text className="text-sm font-semibold text-primary">{venue.offer_summary}</Text> : null}
        {venue.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>{venue.description}</Text> : null}
        {address ? <Text className="text-sm" style={{ color: theme.textMuted }}>{address}</Text> : null}
        {venue.website ? <Text className="text-sm font-semibold text-primary">{t('directory.visit_website')}</Text> : null}
      </HeroCard.Body>
    </HeroCard>
  );
  return venue.website ? <NativePressable accessibilityLabel={`${t('directory.visit_website')}: ${venue.name}`} onPress={() => void Linking.openURL(venue.website!)} feedback="highlight">{content}</NativePressable> : content;
}
