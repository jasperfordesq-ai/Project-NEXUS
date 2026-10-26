// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's own safeguarding choices (26 Oct 2026).
 *
 * Until now the app had no safeguarding settings at all: a member who answered
 * "none of these apply" when they joined could never ask for extra support later,
 * and a member could not remove a choice from the phone. This screen shows the
 * member's current choices with what each one does, lets them remove one (the same
 * endpoint as the website), and lets them add a choice their community still offers
 * — confirmed first, then applied by the server exactly as onboarding does.
 */

import ErrorState from '@/components/ui/ErrorState';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Surface, Text } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SourceRepositoryLink from '@/components/SourceRepositoryLink';
import {
  addSafeguardingChoice,
  getAddableSafeguardingOptions,
  getMySafeguardingChoices,
  removeSafeguardingChoice,
  type AddableSafeguardingOption,
  type SafeguardingChoice,
} from '@/lib/api/safeguarding';
import { useTheme } from '@/lib/hooks/useTheme';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useAuth } from '@/lib/hooks/useAuth';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';

function EffectsList({ effects, heading, color, textColor }: { effects: string[]; heading: string; color: string; textColor: string }) {
  if (effects.length === 0) return null;
  return (
    <View className="gap-1">
      <Text className="text-xs font-bold" style={{ color }}>{heading}</Text>
      {effects.map((effect) => (
        <Text key={effect} className="text-sm leading-5" style={{ color: textColor }}>{`• ${effect}`}</Text>
      ))}
    </View>
  );
}

function SettingsSafeguardingScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [choices, setChoices] = useState<SafeguardingChoice[]>([]);
  const [addable, setAddable] = useState<AddableSafeguardingOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyOptionId, setBusyOptionId] = useState<number | null>(null);
  const inFlight = useRef<number | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const load = useCallback(async () => {
    if (!isMountedRef.current) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const [nextChoices, nextAddable] = await Promise.all([
        getMySafeguardingChoices(),
        getAddableSafeguardingOptions(),
      ]);
      if (!isMountedRef.current) return;
      setChoices(nextChoices);
      setAddable(nextAddable);
    } catch (err) {
      if (!isMountedRef.current) return;
      // Never show "no choices" after a failed read: that is a confident, wrong answer.
      setLoadError(describeApiError(err, t('safeguarding.loadError')));
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd(option: AddableSafeguardingOption) {
    if (!isMountedRef.current || inFlight.current !== null) return;
    inFlight.current = option.option_id;
    setBusyOptionId(option.option_id);
    try {
      await addSafeguardingChoice(option.option_id);
      if (!isMountedRef.current) return;
      showToast({ title: t('safeguarding.added'), variant: 'success' });
      await load();
    } catch (err) {
      if (!isMountedRef.current) return;
      showToast({ title: t('common:errors.generic'), description: describeApiError(err, t('safeguarding.addError')), variant: 'danger' });
    } finally {
      inFlight.current = null;
      if (isMountedRef.current) setBusyOptionId(null);
    }
  }

  async function handleRemove(choice: SafeguardingChoice) {
    if (!isMountedRef.current || inFlight.current !== null) return;
    inFlight.current = choice.option_id;
    setBusyOptionId(choice.option_id);
    try {
      await removeSafeguardingChoice(choice.option_id);
      if (!isMountedRef.current) return;
      setChoices((current) => current.filter((item) => item.option_id !== choice.option_id));
      showToast({ title: t('safeguarding.removed'), variant: 'success' });
      // A removed open choice can be added again, so refresh what is on offer.
      void getAddableSafeguardingOptions().then((next) => { if (isMountedRef.current) setAddable(next); }).catch(() => {});
    } catch (err) {
      if (!isMountedRef.current) return;
      showToast({ title: t('common:errors.generic'), description: describeApiError(err, t('safeguarding.removeError')), variant: 'danger' });
    } finally {
      inFlight.current = null;
      if (isMountedRef.current) setBusyOptionId(null);
    }
  }

  function confirmAdd(option: AddableSafeguardingOption) {
    confirm({
      title: t('safeguarding.addConfirmTitle'),
      message: `${option.label}\n\n${t('safeguarding.addConfirmBody')}`,
      confirmLabel: t('safeguarding.addConfirmYes'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'primary',
      onConfirm: () => handleAdd(option),
    });
  }

  function confirmRemove(choice: SafeguardingChoice) {
    confirm({
      title: t('safeguarding.removeConfirmTitle'),
      message: `${choice.label}\n\n${t('safeguarding.removeConfirmBody')}`,
      confirmLabel: t('safeguarding.remove'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => handleRemove(choice),
    });
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('safeguarding.title')} backLabel={t('common:buttons.back')} fallbackHref="/(modals)/settings" />
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}>
          <HeroCard className="overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
                  <Ionicons name="shield-checkmark-outline" size={22} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text accessibilityRole="header" className="text-xl font-bold" style={{ color: theme.text }}>{t('safeguarding.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('safeguarding.subtitle')}</Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          {isLoading ? (
            <LoadingSpinner />
          ) : loadError ? (
            <ErrorState subtitle={loadError} onRetry={() => void load()} isRetrying={isLoading} testID="safeguarding-settings-error" />
          ) : (
            <>
              <Text accessibilityRole="header" className="text-base font-bold" style={{ color: theme.text }}>{t('safeguarding.currentTitle')}</Text>
              {choices.length === 0 ? (
                <EmptyState icon="shield-outline" title={t('safeguarding.none')} />
              ) : (
                choices.map((choice) => (
                  <HeroCard key={choice.option_id} className="rounded-panel p-0">
                    <HeroCard.Body className="gap-3 p-4">
                      <Text className="text-base font-semibold" style={{ color: theme.text }}>{choice.label}</Text>
                      {choice.description ? (
                        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{choice.description}</Text>
                      ) : null}
                      {choice.option_key !== 'none_apply' ? (
                        <EffectsList effects={choice.effects} heading={t('safeguarding.whatThisDoes')} color={theme.textMuted} textColor={theme.textSecondary} />
                      ) : null}
                      <HeroButton variant="danger-soft" onPress={() => confirmRemove(choice)} isDisabled={busyOptionId !== null}>
                        <HeroButton.Label>{t('safeguarding.remove')}</HeroButton.Label>
                      </HeroButton>
                    </HeroCard.Body>
                  </HeroCard>
                ))
              )}

              {addable.length > 0 ? (
                <>
                  <View className="mt-2 gap-1">
                    <Text accessibilityRole="header" className="text-base font-bold" style={{ color: theme.text }}>{t('safeguarding.addTitle')}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('safeguarding.addIntro')}</Text>
                  </View>
                  {addable.map((option) => (
                    <Surface key={option.option_id} variant="secondary" className="gap-3 rounded-panel p-4">
                      <Text className="text-base font-semibold" style={{ color: theme.text }}>{option.label}</Text>
                      {option.description ? (
                        <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{option.description}</Text>
                      ) : null}
                      <EffectsList effects={option.effects} heading={t('safeguarding.whatThisDoes')} color={theme.textMuted} textColor={theme.textSecondary} />
                      <HeroButton variant="primary" onPress={() => confirmAdd(option)} isDisabled={busyOptionId !== null}>
                        <HeroButton.Label>{t('safeguarding.add')}</HeroButton.Label>
                      </HeroButton>
                    </Surface>
                  ))}
                </>
              ) : null}
            </>
          )}

          <SourceRepositoryLink />
        </ScrollView>
        {confirmDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

export default function SettingsSafeguardingRoute() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  return <SettingsSafeguardingScreen key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}`} />;
}
