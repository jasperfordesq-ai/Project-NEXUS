// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Href, useLocalSearchParams } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { checkOutVolunteer, verifyVolunteerCheckIn } from '@/lib/api/volunteering';
import { ApiResponseError } from '@/lib/api/client';
import { useTheme } from '@/lib/hooks/useTheme';
import { withRouteGate } from '@/components/withRouteGate';

type State = 'confirm' | 'submitting' | 'checked_in' | 'checking_out' | 'checked_out' | 'error';

function isTemporaryFailure(error: unknown): boolean {
  return !(error instanceof ApiResponseError) || error.status === 0 || error.status === 429 || error.status >= 500;
}

function VolunteerCheckInScreen() {
  const { token = '' } = useLocalSearchParams<{ token?: string }>();
  return <VolunteerCheckInContent key={token} token={token} />;
}

function VolunteerCheckInContent({ token }: { token: string }) {
  const { t } = useTranslation(['volunteering', 'common']);
  const theme = useTheme();
  const [state, setState] = useState<State>(token ? 'confirm' : 'error');
  const [name, setName] = useState('');
  const [retryAction, setRetryAction] = useState<'checkin' | 'checkout' | null>(null);
  const [error, setError] = useState(t('volunteering:check_in.invalid'));

  async function checkIn() {
    setRetryAction(null);
    setState('submitting');
    try { const result = await verifyVolunteerCheckIn(token); setName(result.user?.name ?? ''); setState('checked_in'); }
    catch (caught) {
      setRetryAction(isTemporaryFailure(caught) ? 'checkin' : null);
      setError(caught instanceof Error ? caught.message : t('volunteering:check_in.error')); setState('error');
    }
  }
  async function checkOut() {
    setRetryAction(null);
    setState('checking_out');
    try { await checkOutVolunteer(token); setState('checked_out'); }
    catch (caught) {
      setRetryAction(isTemporaryFailure(caught) ? 'checkout' : null);
      setError(caught instanceof Error ? caught.message : t('volunteering:check_in.error')); setState('error');
    }
  }

  return <ModalErrorBoundary><SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}><AppTopBar title={t('volunteering:check_in.verify_title')} backLabel={t('common:back')} fallbackHref={'/(modals)/volunteering' as Href} /><ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 16 }}><HeroCard className="rounded-panel"><HeroCard.Body className="items-center gap-4 p-6"><Text accessibilityRole="header" className="text-center text-2xl font-bold" style={{ color: theme.text }}>{state === 'checked_in' ? t('volunteering:check_in.success', { name }) : state === 'checked_out' ? t('volunteering:check_in.checkout_success', { name }) : t('volunteering:check_in.verify_title')}</Text>{state === 'confirm' ? <><Text className="text-center text-base leading-6" style={{ color: theme.textSecondary }}>{t('volunteering:check_in.verify_intro')}</Text><HeroButton className="w-full" onPress={() => void checkIn()}><HeroButton.Label>{t('volunteering:check_in.confirm_button')}</HeroButton.Label></HeroButton></> : null}{state === 'checked_in' ? <HeroButton className="w-full" variant="secondary" onPress={() => void checkOut()}><HeroButton.Label>{t('volunteering:check_in.checkout_button')}</HeroButton.Label></HeroButton> : null}{state === 'submitting' || state === 'checking_out' ? <Text accessibilityRole="alert" style={{ color: theme.textSecondary }}>{t('volunteering:loading')}</Text> : null}{state === 'error' && retryAction ? <HeroButton onPress={() => void (retryAction === 'checkout' ? checkOut() : checkIn())}><HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label></HeroButton> : null}{state === 'error' ? <Text accessibilityRole="alert" className="text-center text-danger">{error}</Text> : null}</HeroCard.Body></HeroCard></ScrollView></SafeAreaView></ModalErrorBoundary>;
}

export default withRouteGate(VolunteerCheckInScreen, 'volunteer-checkin');
