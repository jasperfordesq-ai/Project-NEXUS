// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { getEvent } from '@/lib/api/events';
import { useApi } from '@/lib/hooks/useApi';
import { useTheme } from '@/lib/hooks/useTheme';

type ManagementSection = 'overview' | 'people' | 'check-in' | 'agenda' | 'safety' | 'analytics' | 'tickets' | 'communications' | 'registration' | 'templates' | 'series-definitions' | 'team' | 'federation';

export function eventManagementRoute(eventId: number, section?: string): Href | null {
  const params = { id: String(eventId) };
  switch (section as ManagementSection) {
    case 'people':
    case 'check-in':
      return { pathname: '/(modals)/event-attendance', params } as unknown as Href;
    case 'tickets': return { pathname: '/(modals)/event-tickets', params } as unknown as Href;
    case 'communications': return { pathname: '/(modals)/event-communications', params } as unknown as Href;
    case 'templates': return '/(modals)/event-templates' as Href;
    case 'series-definitions': return { pathname: '/(modals)/event-recurrence-blueprints', params } as unknown as Href;
    case 'agenda':
    case 'safety':
    case 'analytics':
    case 'registration':
    case 'team':
    case 'federation':
      // These management cards are embedded in the canonical event detail screen.
      return { pathname: '/(modals)/event-detail', params } as unknown as Href;
    default: return null;
  }
}

export default function EventManageScreen() {
  const { t } = useTranslation(['events', 'common', 'event_templates', 'event_tickets', 'event_communications', 'event_recurrence_blueprints']);
  const { id, section } = useLocalSearchParams<{ id?: string; section?: string }>();
  const eventId = Number(id ?? 0);
  const theme = useTheme();
  const eventState = useApi(() => getEvent(eventId), [eventId], { enabled: eventId > 0 });
  const event = eventState.data?.data;

  useEffect(() => {
    if (!event || !section || section === 'overview') return;
    const target = eventManagementRoute(eventId, section);
    if (target) router.replace(target);
  }, [event, eventId, section]);

  const operations = useMemo(() => {
    if (!event) return [];
    const params = { id: String(event.id) };
    return [
      event.permissions.edit && { label: t('manage.overview.edit_event'), route: { pathname: '/(modals)/edit-event', params } as unknown as Href },
      event.permissions.manage_people && { label: t('manage.overview.people'), route: eventManagementRoute(event.id, 'people')! },
      event.permissions.check_in && { label: t('manage.overview.check_in'), route: eventManagementRoute(event.id, 'check-in')! },
      event.permissions.manage_agenda && { label: t('manage.overview.agenda'), route: eventManagementRoute(event.id, 'agenda')! },
      event.permissions.edit && { label: t('analytics.title'), route: eventManagementRoute(event.id, 'analytics')! },
      event.permissions.manage_registration && { label: t('analytics.sections.registration'), route: eventManagementRoute(event.id, 'registration')! },
      (event.permissions.manage_finance || event.permissions.reconcile_tickets) && { label: t('event_tickets:tickets.mobile.title'), route: eventManagementRoute(event.id, 'tickets')! },
      event.permissions.broadcast && { label: t('event_communications:title'), route: eventManagementRoute(event.id, 'communications')! },
      event.permissions.edit && { label: t('event_templates:templates.mobile.title'), route: eventManagementRoute(event.id, 'templates')! },
      event.permissions.manage_agenda && event.series.recurrence && { label: t('event_recurrence_blueprints:title'), route: eventManagementRoute(event.id, 'series-definitions')! },
      { label: t('lifecycleHistory.title'), route: { pathname: '/(modals)/event-lifecycle-history', params } as unknown as Href },
    ].filter((operation): operation is { label: string; route: Href } => Boolean(operation));
  }, [event, t]);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={event ? t('manage.page_title', { title: event.title }) : t('manage.page_title_fallback')} backLabel={t('common:back')} fallbackHref={eventId > 0 ? ({ pathname: '/(modals)/event-detail', params: { id: String(eventId) } } as unknown as Href) : '/(tabs)/events'} />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {eventState.isLoading ? <LoadingSpinner /> : eventState.error || !event ? (
            <EmptyState icon="warning-outline" title={t('manage.load_error_title')} subtitle={eventState.error ?? t('manage.load_error_desc')} actionLabel={t('manage.try_again')} onAction={eventState.refresh} />
          ) : operations.length === 0 ? (
            <EmptyState icon="lock-closed-outline" title={t('manage.access_denied_title')} subtitle={t('manage.access_denied_desc')} />
          ) : (
            <View className="gap-4">
              <HeroCard className="rounded-panel"><HeroCard.Body className="gap-2 p-5"><Text accessibilityRole="header" className="text-xl font-bold text-foreground">{t('manage.workspace_label')}</Text><Text className="text-sm leading-5 text-muted-foreground">{t('manage.subtitle')}</Text></HeroCard.Body></HeroCard>
              {operations.map((operation) => (
                <NativePressable key={operation.label} accessibilityLabel={operation.label} onPress={() => router.push(operation.route)} feedback="highlight">
                  <HeroCard className="rounded-panel"><HeroCard.Body className="flex-row items-center justify-between gap-3 p-4"><Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }}>{operation.label}</Text><Text className="text-xl text-primary">›</Text></HeroCard.Body></HeroCard>
                </NativePressable>
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
