// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Settings → Two-factor authentication (November 2026).
 *
 * Until now the phone could only set up two-factor when sign-in forced it (staff, or a
 * community that requires it of everyone). A member who wanted the extra protection had
 * nowhere to turn it on, even though the welcome wizard now suggests it. This screen reads
 * `GET /v2/auth/2fa/status` and, when two-factor is off and allowed, runs the shared
 * enrolment flow (`components/security/TwoFactorEnrolment.tsx`).
 *
 * Out of scope here, deliberately: turning it off and making new backup codes. When it is
 * on, the screen says so and points to Settings on the website, without linking there —
 * this app does not hand members to the website (see docs/MOBILE_HANDOFF.md).
 */

import KeyboardAvoidingView from '@/components/ui/KeyboardAvoidingView';
import ErrorState from '@/components/ui/ErrorState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TwoFactorEnrolment, { type TwoFactorEnrolmentStage } from '@/components/security/TwoFactorEnrolment';
import { useConfirm } from '@/components/ui/useConfirm';
import { describeApiError } from '@/lib/api/describeApiError';
import { getTwoFactorStatus, type TwoFactorStatus } from '@/lib/api/twoFactor';
import { useAuth } from '@/lib/hooks/useAuth';
import { useScrollToEndOnKeyboard } from '@/lib/hooks/useScrollToEndOnKeyboard';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { withAlpha } from '@/lib/utils/color';

function SettingsTwoFactorScreen() {
  const { t } = useTranslation(['settings', 'common']);
  // Read through a ref so a new `t` (a language change) never re-runs the status request.
  const translateRef = useRef(t);
  translateRef.current = t;
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { user } = useAuth();
  const { show: showToast } = useAppToast();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const next = await getTwoFactorStatus();
      if (!isMountedRef.current) return;
      setStatus(next);
    } catch (err) {
      if (!isMountedRef.current) return;
      // Never guess "off" after a failed read: offering set-up to someone who already has it
      // on would only end in a refusal.
      setLoadError(describeApiError(err, translateRef.current('twoFactor.screen.loadError')));
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The backup codes are shown once, and two-factor is already on by then. Leaving the
  // screen (top bar, Android's Back, an iOS swipe) threw them away, so it asks first;
  // "I have saved them. Continue" leaves without asking (7 November 2026).
  const { confirm, confirmDialog } = useConfirm();
  const [stage, setStage] = useState<TwoFactorEnrolmentStage>('password');
  const [leaving, setLeaving] = useState(false);
  useUnsavedChangesGuard({
    isDirty: stage === 'codes',
    hasSaved: leaving,
    confirm,
    title: t('twoFactor.codes.title'),
    message: t('twoFactor.codes.warning'),
    // The app's usual short "Leave": the screen's own "I have saved them. Continue"
    // wrapped over three lines in the dialog's half-width button (7 November 2026).
    discardLabel: t('common:unsavedChanges.discard'),
    cancelLabel: t('twoFactor.cancel'),
  });
  // Navigate only after the render that stands the guard down, or it would challenge
  // this screen's own exit.
  useEffect(() => {
    if (leaving && router.canGoBack?.()) router.back();
  }, [leaving]);

  // The number pad covered the code box and "Verify and turn on", so the member typed
  // blind (emulator, 7 November 2026): on focus, scroll them above the keyboard.
  const { scrollRef, bringEndIntoView } = useScrollToEndOnKeyboard();

  function finished() {
    showToast({ title: t('twoFactor.screen.success'), variant: 'success' });
    setStatus((current) => (current ? { ...current, enabled: true } : current));
    setLeaving(true);
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('twoFactor.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          // Android only, as in the welcome wizard: adjustResize no longer resizes an
          // edge-to-edge window (Android 15+). iOS uses automaticallyAdjustKeyboardInsets.
          behavior={Platform.OS === 'android' ? 'height' : undefined}
          enabled={Platform.OS === 'android'}
        >
        <ScrollView
          ref={scrollRef}
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
        >
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="shield-half-outline" size={22} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text accessibilityRole="header" className="text-xl font-bold" style={{ color: theme.text }}>{t('twoFactor.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('twoFactor.screen.intro')}</Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          {isLoading ? (
            <LoadingSpinner />
          ) : loadError ? (
            <ErrorState subtitle={loadError} onRetry={() => void load()} isRetrying={isLoading} testID="two-factor-settings-error" />
          ) : status?.enabled ? (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-2 p-4">
                <Text testID="two-factor-settings-on" className="text-base font-semibold" style={{ color: theme.text }}>{t('twoFactor.screen.onTitle')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('twoFactor.screen.onBody')}</Text>
              </HeroCard.Body>
            </HeroCard>
          ) : status && !status.enrollment_allowed ? (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="p-4">
                <Text testID="two-factor-settings-not-allowed" className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('twoFactor.screen.notAllowed')}</Text>
              </HeroCard.Body>
            </HeroCard>
          ) : (
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-4 p-4">
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('twoFactor.screen.needApp')}</Text>
                <TwoFactorEnrolment
                  accountLabel={user?.email ?? null}
                  onDone={finished}
                  onStageChange={setStage}
                  onFieldFocus={bringEndIntoView}
                />
              </HeroCard.Body>
            </HeroCard>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
        {confirmDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

export default function SettingsTwoFactorRoute() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return <SettingsTwoFactorScreen key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}`} />;
}
