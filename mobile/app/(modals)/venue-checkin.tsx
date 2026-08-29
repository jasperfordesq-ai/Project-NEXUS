// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Href, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { recordPartnerVenueVisit, type PartnerVenueVisitResult } from '@/lib/api/venues';
import { useTheme } from '@/lib/hooks/useTheme';

type State = 'confirm' | 'submitting' | 'choose' | 'recorded' | 'already' | 'error';

export default function VenueCheckInScreen() {
  const { t } = useTranslation(['venues', 'common']);
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  const theme = useTheme();
  const [state, setState] = useState<State>(token ? 'confirm' : 'error');
  const [result, setResult] = useState<PartnerVenueVisitResult | null>(null);
  const [error, setError] = useState(t('venues:verify.invalid'));

  async function submit(venueId?: number) {
    setState('submitting');
    try {
      const next = await recordPartnerVenueVisit(token, venueId);
      setResult(next);
      setState(next.status === 'needs_venue' ? 'choose' : next.status === 'already_recorded_today' ? 'already' : 'recorded');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('venues:verify.error'));
      setState('error');
    }
  }

  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}><AppTopBar title={t('venues:verify.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/venues' as Href} /><ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }}><HeroCard className="rounded-panel"><HeroCard.Body className="items-center gap-4 p-6"><Text accessibilityRole="header" className="text-center text-2xl font-bold" style={{ color: theme.text }}>{state === 'recorded' ? t('venues:verify.recorded', { name: result?.member?.name ?? '' }) : state === 'already' ? t('venues:verify.already_recorded', { name: result?.member?.name ?? '' }) : t('venues:verify.title')}</Text>
    {state === 'confirm' ? <><Text className="text-center text-base leading-6" style={{ color: theme.textSecondary }}>{t('venues:verify.intro')}</Text><HeroButton className="w-full" onPress={() => void submit()}><HeroButton.Label>{t('venues:verify.confirm_button')}</HeroButton.Label></HeroButton></> : null}
    {state === 'submitting' ? <Text accessibilityRole="alert" style={{ color: theme.textSecondary }}>{t('venues:loading')}</Text> : null}
    {state === 'choose' ? <><Text className="text-center" style={{ color: theme.textSecondary }}>{t('venues:verify.choose_venue_intro')}</Text><View className="w-full gap-2">{result?.venues?.map((venue) => <HeroButton key={venue.id} variant="secondary" onPress={() => void submit(venue.id)}><HeroButton.Label>{venue.name}</HeroButton.Label></HeroButton>)}</View></> : null}
    {state === 'recorded' || state === 'already' ? <>{result?.venue?.name ? <Text style={{ color: theme.textSecondary }}>{result.venue.name}</Text> : null}{typeof result?.visits_this_month === 'number' ? <Text style={{ color: theme.textSecondary }}>{t('venues:verify.visits_this_month', { count: result.visits_this_month })}</Text> : null}</> : null}
    {state === 'error' ? <Text accessibilityRole="alert" className="text-center text-danger">{error}</Text> : null}
  </HeroCard.Body></HeroCard></ScrollView></SafeAreaView></ModalErrorBoundary>;
}
