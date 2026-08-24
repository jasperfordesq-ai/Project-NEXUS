// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Text } from 'heroui-native';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  createIdentityVerificationPayment,
  getIdentityStatus,
  saveIdentityDateOfBirth,
  startIdentityVerification,
  type IdentityStatus,
} from '@/lib/api/verification';
import { APP_URL } from '@/lib/constants';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { presentIdentityPayment } from '@/lib/payments/identityPayment';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';

type PageState = 'loading' | 'dob_collection' | 'payment_required' | 'start' | 'in_progress' | 'verified' | 'failed' | 'error';
type TFunction = (key: string, options?: Record<string, unknown>) => string;

export default function VerifyIdentityScreen() {
  return (
    <ModalErrorBoundary>
      <VerifyIdentityScreenInner />
    </ModalErrorBoundary>
  );
}

function VerifyIdentityScreenInner() {
  const { t } = useTranslation(['settings', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<IdentityStatus | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [dob, setDob] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSavingDob, setIsSavingDob] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isCreatingPayment, setIsCreatingPayment] = useState(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const applyStatus = useCallback((nextStatus: IdentityStatus) => {
    setStatus(nextStatus);
    if (nextStatus.has_id_verified_badge) {
      setPageState('verified');
      stopPolling();
      return;
    }

    const sessionStatus = nextStatus.latest_session?.status ?? nextStatus.verification_status;
    if (sessionStatus === 'passed') {
      setPageState('verified');
      stopPolling();
    } else if (sessionStatus === 'started' || sessionStatus === 'processing' || sessionStatus === 'created') {
      setPageState('in_progress');
    } else if (sessionStatus === 'failed') {
      setPageState('failed');
      stopPolling();
    } else if (!nextStatus.user_has_dob) {
      setPageState('dob_collection');
    } else if (nextStatus.fee_cents > 0 && !nextStatus.payment_completed) {
      setPageState('payment_required');
    } else {
      setPageState('start');
    }
  }, [stopPolling]);

  const refreshStatus = useCallback(async () => {
    try {
      const response = await getIdentityStatus();
      if (response.data) {
        applyStatus(response.data);
      } else {
        setPageState('error');
      }
    } catch {
      setPageState('error');
    }
  }, [applyStatus]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      void refreshStatus();
    }, 5000);
  }, [refreshStatus, stopPolling]);

  useEffect(() => {
    void refreshStatus();
    return stopPolling;
  }, [refreshStatus, stopPolling]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await refreshStatus();
    setIsRefreshing(false);
  }

  async function handleSaveDob() {
    const value = dob.trim();
    if (!value) {
      showToast({ title: t('identity.error_title'), description: t('identity.error_missing_dob'), variant: 'warning' });
      return;
    }

    setIsSavingDob(true);
    try {
      await saveIdentityDateOfBirth(value);
      await refreshStatus();
    } catch (err) {
      showToast({ title: t('identity.error_title'), description: describeApiError(err, t('identity.error_save_dob')), variant: 'danger' });
    } finally {
      setIsSavingDob(false);
    }
  }

  async function handleStartVerification() {
    setIsStarting(true);
    try {
      const response = await startIdentityVerification();
      const data = response.data;
      if (data?.already_verified) {
        setPageState('verified');
        return;
      }
      if (data?.redirect_url) {
        setPageState('in_progress');
        startPolling();
        await Linking.openURL(data.redirect_url);
        return;
      }
      setPageState('in_progress');
      startPolling();
    } catch (err) {
      showToast({ title: t('identity.error_title'), description: describeApiError(err, t('identity.error_start_verification')), variant: 'danger' });
      await refreshStatus();
    } finally {
      setIsStarting(false);
    }
  }

  async function handleCreatePayment() {
    setIsCreatingPayment(true);
    try {
      const response = await createIdentityVerificationPayment();
      const data = response.data;

      if (data?.already_paid || data?.payment_required === false) {
        await refreshStatus();
        return;
      }

      if (!data?.client_secret) {
        showToast({ title: t('identity.error_title'), description: t('identity.error_create_payment'), variant: 'danger' });
        return;
      }

      const paymentResult = await presentIdentityPayment({
        clientSecret: data.client_secret,
        publishableKey: data.publishable_key,
        merchantDisplayName: 'Project NEXUS',
      });

      if (paymentResult.status === 'redirected' || paymentResult.status === 'canceled') {
        return;
      }

      if (paymentResult.status === 'failed') {
        showToast({ title: t('identity.error_title'), description: paymentResult.message || t(data.publishable_key ? 'identity.error_create_payment' : 'identity.error_missing_publishable_key'), variant: 'danger' });
        return;
      }

      showToast({ title: t('identity.payment_success_title'), description: t('identity.payment_success_body'), variant: 'success' });
      await refreshStatus();
    } catch (err) {
      showToast({ title: t('identity.error_title'), description: describeApiError(err, t('identity.error_create_payment')), variant: 'danger' });
    } finally {
      setIsCreatingPayment(false);
    }
  }

  const fee = status ? formatFee(status.fee_cents, status.fee_currency) : '';

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('identity.page_title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void handleRefresh()} tintColor={primary} colors={[primary]} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
      >
        <HeroCard className="overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: pageState === 'verified' ? theme.success : primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(pageState === 'verified' ? theme.success : primary, 0.14) }}>
                <Ionicons name={pageState === 'verified' ? 'shield-checkmark-outline' : 'finger-print-outline'} size={25} color={pageState === 'verified' ? theme.success : primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('identity.eyebrow')}</Text>
                <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{titleForState(pageState, t)}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{bodyForState(pageState, t, fee)}</Text>
              </View>
            </View>
            <VerificationStatusChip pageState={pageState} theme={theme} t={t} />
          </HeroCard.Body>
        </HeroCard>

        {pageState === 'loading' ? (
          <Surface variant="secondary" className="items-center gap-3 rounded-panel p-5">
            <Spinner size="md" />
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('identity.loading_title')}</Text>
          </Surface>
        ) : null}

        {pageState === 'dob_collection' ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('identity.dob_title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('identity.dob_body')}</Text>
              <Input
                value={dob}
                onChangeText={setDob}
                placeholder={t('identity.dob_placeholder')}
                placeholderTextColor={theme.textMuted}
                autoCapitalize="none"
                className="text-base"
                style={{ color: theme.text }}
                accessibilityLabel={t('identity.dob_title')}
              />
              <HeroButton variant="primary" onPress={() => void handleSaveDob()} isDisabled={isSavingDob}>
                {isSavingDob ? <Spinner size="sm" /> : <AccentIcon name="calendar-outline" size={17} />}
                <HeroButton.Label>{t('identity.continue')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {pageState === 'payment_required' ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('identity.fee_title')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('identity.mobile_payment_body', { fee })}</Text>
              <Surface variant="secondary" className="items-center gap-1 rounded-panel-inner p-4">
                <Text className="text-3xl font-bold" style={{ color: theme.text }}>{fee}</Text>
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>{t('identity.fee_one_time_label')}</Text>
              </Surface>
              <HeroButton testID="identity-pay-button" variant="primary" onPress={() => void handleCreatePayment()} isDisabled={isCreatingPayment}>
                {isCreatingPayment ? <Spinner size="sm" /> : <AccentIcon name="card-outline" size={17} />}
                <HeroButton.Label>{t('identity.pay_button', { fee })}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={() => void Linking.openURL(`${APP_URL}/settings/verify-identity`)}>
                <Ionicons name="open-outline" size={17} color={primary} />
                <HeroButton.Label>{t('identity.open_web_flow')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="secondary" onPress={() => void handleRefresh()}>
                <Ionicons name="refresh-outline" size={17} color={primary} />
                <HeroButton.Label>{t('identity.refresh_status')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {(pageState === 'start' || pageState === 'failed') ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('identity.what_needed_title')}</Text>
              <Requirement label={t('identity.need_document')} icon="card-outline" theme={theme} />
              <Requirement label={t('identity.need_camera')} icon="camera-outline" theme={theme} />
              <Requirement label={t('identity.need_minutes')} icon="timer-outline" theme={theme} />
              <HeroButton variant="primary" onPress={() => void handleStartVerification()} isDisabled={isStarting}>
                {isStarting ? <Spinner size="sm" /> : <AccentIcon name="shield-checkmark-outline" size={17} />}
                <HeroButton.Label>{t(pageState === 'failed' ? 'identity.try_again' : 'identity.start_button')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {pageState === 'in_progress' ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-4 p-4">
              <Text className="text-base font-bold" style={{ color: theme.text }}>{t('identity.waiting')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('identity.in_progress_body')}</Text>
              <HeroButton variant="secondary" onPress={() => void handleRefresh()}>
                <Ionicons name="refresh-outline" size={17} color={primary} />
                <HeroButton.Label>{t('identity.refresh_status')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}

        {pageState === 'verified' ? (
          <Surface variant="secondary" className="items-center gap-3 rounded-panel p-5">
            <Ionicons name="shield-checkmark-outline" size={30} color={theme.success} />
            <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>{t('identity.verified_body')}</Text>
          </Surface>
        ) : null}

        {pageState === 'error' ? (
          <Surface variant="secondary" className="items-center gap-3 rounded-panel p-5">
            <Ionicons name="alert-circle-outline" size={30} color={theme.error} />
            <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>{t('identity.error_check_status')}</Text>
            <HeroButton variant="secondary" onPress={() => void handleRefresh()}>
              <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
            </HeroButton>
          </Surface>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function VerificationStatusChip({ pageState, theme, t }: { pageState: PageState; theme: ReturnType<typeof useTheme>; t: TFunction }) {
  const verified = pageState === 'verified';
  const failed = pageState === 'failed' || pageState === 'error';
  return (
    <View className="flex-row flex-wrap gap-2">
      <Chip size="sm" variant="soft" color={verified ? 'success' : failed ? 'danger' : 'default'}>
        <Ionicons name={verified ? 'shield-checkmark-outline' : failed ? 'alert-circle-outline' : 'shield-outline'} size={12} color={verified ? theme.success : failed ? theme.error : theme.textMuted} />
        <Chip.Label>{verified ? t('identity.verified_badge_label') : t('common:verification.not_id_verified')}</Chip.Label>
      </Chip>
    </View>
  );
}

function Requirement({ label, icon, theme }: { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; theme: ReturnType<typeof useTheme> }) {
  return (
    <Surface variant="secondary" className="flex-row items-center gap-3 rounded-panel-inner px-3 py-3">
      <Ionicons name={icon} size={18} color={theme.textSecondary} />
      <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.text }}>{label}</Text>
    </Surface>
  );
}

function titleForState(pageState: PageState, t: TFunction): string {
  if (pageState === 'verified') return t('identity.verified_title');
  if (pageState === 'failed') return t('identity.failed_title');
  if (pageState === 'dob_collection') return t('identity.dob_title');
  if (pageState === 'payment_required') return t('identity.fee_title');
  if (pageState === 'in_progress') return t('identity.in_progress_title');
  if (pageState === 'error') return t('identity.error_title');
  return t('identity.start_title');
}

function bodyForState(pageState: PageState, t: TFunction, fee: string): string {
  if (pageState === 'verified') return t('identity.verified_body');
  if (pageState === 'failed') return t('identity.failed_body');
  if (pageState === 'dob_collection') return t('identity.dob_body');
  if (pageState === 'payment_required') return t('identity.mobile_payment_body', { fee });
  if (pageState === 'in_progress') return t('identity.in_progress_body');
  if (pageState === 'error') return t('identity.error_check_status');
  return t('identity.start_body');
}

function formatFee(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(dateLocale(), { style: 'currency', currency: currency || 'EUR' }).format((cents || 0) / 100);
  } catch {
    return `${((cents || 0) / 100).toFixed(2)} ${currency || 'EUR'}`;
  }
}
