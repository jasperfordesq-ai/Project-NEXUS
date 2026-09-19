// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import EventPeopleRoster from '@/components/events/EventPeopleRoster';
import { withRouteGate } from '@/components/withRouteGate';

function EventPeopleScreen() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  const { t } = useTranslation(['events', 'common']);
  const numeric = Number(id);
  const eventId = typeof id === 'string' && /^[1-9]\d*$/.test(id) && Number.isSafeInteger(numeric) ? numeric : 0;
  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }} edges={['top', 'bottom']}>
    <AppTopBar title={t('manage.people.title')} backLabel={t('common:back')}
      fallbackHref={eventId ? ({ pathname: '/(modals)/event-manage', params: { id: String(eventId) } } as Href) : '/(tabs)/events'} />
    {eventId ? <EventPeopleRoster eventId={eventId} /> : <EmptyState icon="warning-outline" title={t('detail.invalidId')} />}
  </SafeAreaView></ModalErrorBoundary>;
}

export default withRouteGate(EventPeopleScreen, 'event-people');
