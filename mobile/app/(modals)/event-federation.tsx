// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { Card } from 'heroui-native';
import { useTranslation } from 'react-i18next';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import Button from '@/components/ui/Button';
import { withRouteGate } from '@/components/withRouteGate';
import { deliveryStates, getEventFederationStatus } from '@/lib/api/eventFederation';
import { isRefusalStatus } from '@/lib/api/refusal';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

function EventFederationScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { user } = useAuth();
  const { tenant } = useTenant();
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : 0;
  return <ModalErrorBoundary key={JSON.stringify([tenant?.id, user?.id, id])}><FederationWorkspace eventId={eventId} /></ModalErrorBoundary>;
}

function FederationWorkspace({ eventId }: { eventId: number }) {
  const { t, i18n } = useTranslation(['event_federation', 'events', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const state = useApi(() => getEventFederationStatus(eventId), [eventId], { enabled: eventId > 0, clearOnRefusal: true });
  const summary = state.data?.data;
  const label = (key: string, values?: Record<string, string | number>) => t(`manage.federation.${key}`, values);
  const number = (value: number) => value.toLocaleString(i18n.language);
  const date = (value: string | null) => {
    const parsed = value ? new Date(value) : null;
    return parsed && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString(i18n.language) : label('not_available');
  };
  const field = (name: string, value: string) => <View key={name} className="gap-1">
    <Text className="text-sm text-muted-foreground">{name}</Text><Text className="text-base text-foreground">{value}</Text>
  </View>;
  return <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
    <AppTopBar title={label('title')} backLabel={t('common:back')} fallbackHref={eventId > 0 ? { pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href : '/(tabs)/events'} />
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }} refreshControl={eventId > 0 ? <RefreshControl refreshing={state.isLoading && Boolean(summary)} onRefresh={state.refresh} tintColor={primary} colors={[primary]} /> : undefined}>
      {eventId <= 0 ? <EmptyState icon="warning-outline" title={t('events:detail.invalidId')} />
        : isRefusalStatus(state.errorStatus) ? <EmptyState icon="lock-closed-outline" title={label('load_error_title')} subtitle={t('events:manage.access_denied_desc')} />
          : !summary ? state.isLoading ? <LoadingSpinner /> : <EmptyState icon="warning-outline" title={label('load_error_title')} subtitle={label('load_error_description')} actionLabel={label('try_again')} onAction={state.refresh} />
            : <>
              <RefreshFailedNotice error={state.error} onRetry={state.refresh} isRetrying={state.isLoading} />
              <Card><Card.Body className="gap-4 p-4">
                <Text className="text-base text-muted-foreground">{label('description')}</Text>
                <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{label(`health.${summary.health}`)}</Text>
                {field(label('metrics.configured_partners'), number(summary.configured_partners))}
                {field(label('metrics.recipient_partners'), number(summary.recipient_partners))}
                {field(label('metrics.federation_version'), number(summary.federation_version))}
                {field(label('metrics.visibility'), label(`visibility.${summary.visibility}`))}
                <Text className="text-sm text-muted-foreground">{label('generated_at', { time: date(summary.generated_at) })}</Text>
                <Button onPress={state.refresh} disabled={state.isLoading}>{label('refresh')}</Button>
              </Card.Body></Card>
              {summary.configured_partners === 0 && <EmptyState icon="information-circle-outline" title={label('not_configured_title')} subtitle={label('not_configured_description')} />}
              {summary.health === 'degraded' && <EmptyState icon="warning-outline" title={label('degraded_title')} subtitle={label('degraded_description')} />}
              <Card><Card.Body className="gap-4 p-4">
                <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{label('delivery_summary')}</Text>
                {deliveryStates.map(status => field(label(`delivery_status.${status}`), number(summary.counts[status])))}
              </Card.Body></Card>
              {summary.partners.length === 0 && <Text className="text-base text-muted-foreground">{label('no_deliveries')}</Text>}
              {summary.partners.map((partner, index) => {
                const partnerStatus = ['active', 'pending', 'suspended', 'failed', 'removed'].includes(partner.partner_status) ? partner.partner_status : 'unknown';
                const code = partner.error_code?.trim().toUpperCase();
                return <Card key={`${partner.partner_id}:${index}`}><Card.Body className="gap-4 p-4">
                  <Text accessibilityRole="header" className="text-lg font-semibold text-foreground">{partner.partner_name || label('removed_partner')}</Text>
                  <Text className="text-base text-foreground">{label(`partner_status.${partnerStatus}`)}</Text>
                  {!partner.events_enabled && <Text className="text-base text-muted-foreground">{label('events_disabled')}</Text>}
                  {field(label('columns.action'), partner.action ? label(`action.${partner.action}`) : label('not_available'))}
                  {field(label('columns.delivery'), partner.delivery_status ? label(`delivery_status.${partner.delivery_status}`) : label('not_available'))}
                  {partner.error_code && <Text selectable className="text-sm text-foreground">{code && /^[A-Z0-9_-]{1,64}$/.test(code) ? label('error_code', { code }) : label('error_code_unknown')}</Text>}
                  {field(label('columns.attempts'), label('attempt_count', { count: partner.attempts, max: number(partner.max_attempts) }))}
                  {field(label('columns.activity'), date(partner.delivered_at ?? partner.dead_lettered_at ?? partner.last_attempt_at ?? partner.next_attempt_at ?? partner.available_at))}
                </Card.Body></Card>;
              })}
            </>}
    </ScrollView>
  </SafeAreaView>;
}

export default withRouteGate(EventFederationScreen, 'event-federation');
