// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { RefreshControl, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { EventAnalyticsCard } from '@/components/events/EventAnalyticsCard';
import { withRouteGate } from '@/components/withRouteGate';
import { getEventAnalytics } from '@/lib/api/eventAnalytics';
import { ApiResponseError } from '@/lib/api/client';
import { isRefusalStatus } from '@/lib/api/refusal';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

function EventAnalyticsScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary key={JSON.stringify([tenant?.id, user?.id, id])}>
    <AnalyticsWorkspace eventId={eventId} />
  </ModalErrorBoundary>;
}

function AnalyticsWorkspace({ eventId }: { eventId: number }) {
  const { t } = useTranslation(['events', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const state = useApi(async () => {
    const response = await getEventAnalytics(eventId);
    if (response.data.event_id !== eventId) throw new ApiResponseError(422, t('common:errors.contractDrift'));
    return response;
  }, [eventId], { enabled: eventId > 0, clearOnRefusal: true });
  const refused = isRefusalStatus(state.errorStatus);
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={t('analytics.title')} backLabel={t('common:back')}
      fallbackHref={eventId > 0 ? { pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href : '/(tabs)/events'} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
      refreshControl={eventId > 0 ? <RefreshControl refreshing={state.isLoading && Boolean(state.data)} onRefresh={state.refresh} tintColor={primary} colors={[primary]} /> : undefined}>
      {eventId <= 0 ? <EmptyState icon="warning-outline" title={t('detail.invalidId')} />
        : refused ? <EmptyState icon="lock-closed-outline" title={t('manage.access_denied_title')} subtitle={t('manage.access_denied_desc')} />
          : <>
            <RefreshFailedNotice error={state.data ? state.error : null} onRetry={state.refresh} isRetrying={state.isLoading} />
            <EventAnalyticsCard summary={state.data?.data ?? null} isLoading={state.isLoading} error={state.error}
              onRefresh={state.refresh} primary={primary} theme={theme} t={t} />
          </>}
    </ScrollView>
  </SafeAreaView>;
}

export default withRouteGate(EventAnalyticsScreen, 'event-analytics');
