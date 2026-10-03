// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Help & support — a member sends their community's support team a request,
 * without leaving the app.
 *
 * The native twin of the website's "Help & support" button
 * (`react-frontend/src/components/feedback/ReportProblemButton.tsx`, live since
 * 3 October 2026). Same endpoint, same four request types, same rules:
 *
 *  - the member picks what kind of help they need first, and the two text
 *    fields are worded for that kind;
 *  - only "Something isn't working" asks how badly it affects them, and only it
 *    may carry technical details — which the member can untick, and which are
 *    shown to them, value by value, before they send (`lib/supportDiagnostics.ts`);
 *  - the server answers with a reference (`NXR-…`) and emails a receipt, so the
 *    success state shows the reference and says the email is on its way.
 *
 * 🔴 Fully native, like the Support screen it hangs off: no `Linking`, no web
 * hand-off. A member with a problem in the app is the member least likely to be
 * helped by being thrown into a browser.
 *
 * 🔴 Refusals are told apart from failures. Five requests a day is the server's
 * limit (`429 SUPPORT_REPORT_DAILY_LIMIT`), and saying "please try again" to a
 * member who has hit it would send them round in a circle. A plain `429` is the
 * route's per-minute throttle, which really does clear in a minute.
 */

import type { ComponentProps } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Card as HeroCard, Text } from 'heroui-native';

import { Button as HeroButton } from '@/components/ui/NativeButton';
import AccentIcon from '@/components/ui/AccentIcon';
import { Ionicons } from '@/components/ui/Icon';
import AppTopBar from '@/components/ui/AppTopBar';
import Checkbox from '@/components/ui/Checkbox';
import ChoiceChips from '@/components/ui/ChoiceChips';
import Input from '@/components/ui/Input';
import NativePressable from '@/components/ui/NativePressable';
import TextArea from '@/components/ui/TextArea';
import { useConfirm } from '@/components/ui/useConfirm';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  isSupportRequestType,
  submitSupportRequest,
  SUPPORT_DESCRIPTION_MAX,
  SUPPORT_DESCRIPTION_MIN,
  SUPPORT_IMPACTS,
  SUPPORT_REPORT_DAILY_LIMIT,
  SUPPORT_REQUEST_TYPES,
  SUPPORT_SUMMARY_MAX,
  SUPPORT_SUMMARY_MIN,
  type SupportImpact,
  type SupportRequestType,
} from '@/lib/api/support';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { describeSupportSystem, getSupportDiagnostics } from '@/lib/supportDiagnostics';
import { withAlpha } from '@/lib/utils/color';

type IconName = ComponentProps<typeof Ionicons>['name'];

const TYPE_ICONS: Record<SupportRequestType, IconName> = {
  broken: 'construct-outline',
  how_to: 'help-circle-outline',
  account: 'person-circle-outline',
  suggestion: 'bulb-outline',
};

interface FieldErrors {
  summary?: string;
  description?: string;
  impact?: string;
}

type Failure = { kind: 'dailyLimit' } | { kind: 'tooFast' } | { kind: 'network' } | { kind: 'other'; message: string };

export default function HelpSupportRoute() {
  return (
    <ModalErrorBoundary>
      <HelpSupportScreen />
    </ModalErrorBoundary>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function HelpSupportScreen() {
  const { t } = useTranslation(['profile', 'common', 'auth']);
  const theme = useTheme();
  const tone = theme.info;
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ type?: string | string[] }>();
  const requestedType = one(params.type);

  // A caller (the crash screen, for instance) can open the form on a type.
  const [requestType, setRequestType] = useState<SupportRequestType | null>(
    isSupportRequestType(requestedType) ? requestedType : null,
  );
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [impact, setImpact] = useState<SupportImpact>('minor');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failure, setFailure] = useState<Failure | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);

  const diagnostics = useMemo(() => getSupportDiagnostics(), []);
  const isBroken = requestType === 'broken';

  const { confirm, confirmDialog } = useConfirm();
  useUnsavedChangesGuard({
    isDirty: summary.trim() !== '' || description.trim() !== '',
    isSaving: isSending,
    hasSaved: reference !== null,
    confirm,
    title: t('profile:support.request.unsavedTitle'),
    message: t('profile:support.request.unsavedMessage'),
    discardLabel: t('profile:support.request.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  // An old failure no longer describes the request once the member changes it.
  useEffect(() => {
    setFailure((current) => (current?.kind === 'dailyLimit' ? current : null));
  }, [requestType, summary, description]);

  // State alone cannot stop two presses in the same frame; each would send a request.
  const sendingRef = useRef(false);

  async function submit() {
    if (sendingRef.current || requestType === null) return;

    const trimmedSummary = summary.trim();
    const trimmedDescription = description.trim();
    const nextErrors: FieldErrors = {};
    if (trimmedSummary.length < SUPPORT_SUMMARY_MIN) {
      nextErrors.summary = t('profile:support.request.summaryTooShort', { min: SUPPORT_SUMMARY_MIN });
    }
    if (trimmedDescription.length < SUPPORT_DESCRIPTION_MIN) {
      nextErrors.description = t('profile:support.request.descriptionTooShort', { min: SUPPORT_DESCRIPTION_MIN });
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    sendingRef.current = true;
    setIsSending(true);
    setFailure(null);
    try {
      const receipt = await submitSupportRequest({
        requestType,
        summary: trimmedSummary,
        description: trimmedDescription,
        ...(isBroken ? { impact } : {}),
        diagnostics: isBroken && includeDiagnostics ? { ...diagnostics } : null,
      });
      setReference(receipt.reference);
    } catch (caught) {
      setFailure(classifyFailure(caught, t('profile:support.request.errorBody')));
      // The server can name the field it refused; put its words on that field.
      if (caught instanceof ApiResponseError && caught.status === 422 && caught.field) {
        const field = caught.field as keyof FieldErrors;
        if (field === 'summary' || field === 'description' || field === 'impact') {
          setErrors((current) => ({ ...current, [field]: caught.message }));
        }
      }
    } finally {
      sendingRef.current = false;
      setIsSending(false);
    }
  }

  function startAgain() {
    setRequestType(null);
    setSummary('');
    setDescription('');
    setImpact('minor');
    setIncludeDiagnostics(true);
    setErrors({});
    setFailure(null);
    setReference(null);
  }

  let body;
  if (!authLoading && !isAuthenticated) {
    body = (
      <StatusCard
        testID="help-support-sign-in"
        icon="lock-closed-outline"
        color={tone}
        title={t('profile:support.request.signInTitle')}
        description={t('profile:support.request.signInBody')}
      >
        <HeroButton
          testID="help-support-sign-in-button"
          accessibilityLabel={t('profile:support.request.signIn')}
          onPress={() => router.replace('/(auth)/login' as Href)}
          className="min-h-11 rounded-full"
        >
          <HeroButton.Label className="text-sm font-semibold">{t('profile:support.request.signIn')}</HeroButton.Label>
        </HeroButton>
      </StatusCard>
    );
  } else if (reference) {
    body = (
      <StatusCard
        testID="help-support-sent"
        icon="checkmark-circle-outline"
        color={theme.success}
        title={t('profile:support.request.successTitle')}
        description={t('profile:support.request.successEmail')}
        live
      >
        <View
          className="items-center gap-1 rounded-panel-inner p-3"
          style={{ backgroundColor: withAlpha(theme.success, 0.1), borderWidth: 1, borderColor: withAlpha(theme.success, 0.24) }}
        >
          <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
            {t('profile:support.request.referenceLabel')}
          </Text>
          <Text testID="help-support-reference" selectable className="text-xl font-bold" style={{ color: theme.text, letterSpacing: 0.5 }}>
            {reference}
          </Text>
        </View>
        <HeroButton
          testID="help-support-done"
          accessibilityLabel={t('profile:support.request.done')}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(modals)/support' as Href))}
          className="min-h-11 rounded-full"
        >
          <HeroButton.Label className="text-sm font-semibold">{t('profile:support.request.done')}</HeroButton.Label>
        </HeroButton>
        <HeroButton
          testID="help-support-send-another"
          accessibilityLabel={t('profile:support.request.sendAnother')}
          variant="secondary"
          onPress={startAgain}
          className="min-h-11 rounded-full"
        >
          <HeroButton.Label className="text-sm font-semibold">{t('profile:support.request.sendAnother')}</HeroButton.Label>
        </HeroButton>
      </StatusCard>
    );
  } else {
    body = (
      <>
        <View className="gap-2">
          <Text accessibilityRole="header" className="px-1 text-base font-bold" style={{ color: theme.text }}>
            {t('profile:support.request.typeLabel')}
          </Text>
          <View accessibilityRole="radiogroup" className="gap-2">
            {SUPPORT_REQUEST_TYPES.map((type) => {
              const selected = requestType === type;
              const label = t(`profile:support.request.types.${type}.label`);
              return (
                <NativePressable
                  key={type}
                  testID={`help-support-type-${type}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected, disabled: isSending }}
                  accessibilityLabel={label}
                  disabled={isSending}
                  feedback="highlight"
                  onPress={() => setRequestType(type)}
                  className="w-full rounded-panel px-3 py-3"
                  style={{
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? tone : theme.borderSubtle,
                    backgroundColor: selected ? withAlpha(tone, 0.08) : theme.surface,
                  }}
                >
                  <View className="flex-row items-center gap-3">
                    <View className="size-11 shrink-0 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.12) }}>
                      <Ionicons name={TYPE_ICONS[type]} size={21} color={tone} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-base font-semibold" style={{ color: theme.text }}>
                        {label}
                      </Text>
                      <Text className="mt-0.5 text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {t(`profile:support.request.types.${type}.description`)}
                      </Text>
                    </View>
                    <Ionicons
                      name={selected ? 'radio-button-on' : 'radio-button-off'}
                      size={22}
                      color={selected ? tone : theme.textSecondary}
                    />
                  </View>
                </NativePressable>
              );
            })}
          </View>
        </View>

        {requestType ? (
          <HeroCard
            testID="help-support-form"
            className="overflow-hidden rounded-panel p-0"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <HeroCard.Body className="gap-3 p-4">
              {/* The visible label is a sibling node in React Native, not a linked
                  <label>, so each field carries its own accessible name. */}
              <Input
                testID="help-support-summary"
                label={t(`profile:support.request.fields.${requestType}.summary`)}
                accessibilityLabel={t(`profile:support.request.fields.${requestType}.summary`)}
                value={summary}
                onChangeText={setSummary}
                error={errors.summary}
                maxLength={SUPPORT_SUMMARY_MAX}
                editable={!isSending}
                returnKeyType="next"
              />
              <TextArea
                testID="help-support-description"
                label={t(`profile:support.request.fields.${requestType}.description`)}
                accessibilityLabel={t(`profile:support.request.fields.${requestType}.description`)}
                placeholder={t(`profile:support.request.fields.${requestType}.placeholder`)}
                value={description}
                onChangeText={setDescription}
                error={errors.description}
                maxLength={SUPPORT_DESCRIPTION_MAX}
                editable={!isSending}
                multiline
                numberOfLines={6}
              />

              {isBroken ? (
                <>
                  <ChoiceChips
                    testID="help-support-impact"
                    label={t('profile:support.request.impactLabel')}
                    options={SUPPORT_IMPACTS.map((value) => ({
                      value,
                      label: t(`profile:support.request.impact.${value}`),
                      disabled: isSending,
                    }))}
                    selected={impact}
                    onSelect={(value) => { if (value) setImpact(value); }}
                  />
                  {errors.impact ? (
                    <Text className="text-sm" style={{ color: theme.error }}>{errors.impact}</Text>
                  ) : null}

                  <View className="gap-1.5">
                    <Checkbox
                      testID="help-support-diagnostics"
                      checked={includeDiagnostics}
                      onPress={() => setIncludeDiagnostics((current) => !current)}
                      label={t('profile:support.request.includeDiagnostics')}
                      disabled={isSending}
                    />
                    {includeDiagnostics ? (
                      <Text testID="help-support-diagnostics-detail" className="text-xs leading-5" style={{ color: theme.textSecondary }}>
                        {t('profile:support.request.diagnosticsDetail', {
                          system: describeSupportSystem(diagnostics),
                          version: diagnostics.app_version || '-',
                          language: diagnostics.language || '-',
                        })}
                      </Text>
                    ) : null}
                  </View>
                </>
              ) : null}

              {failure ? <FailureNotice failure={failure} /> : null}

              {/*
                No `backgroundColor` and no label colour: the theme paints a
                primary button in the community's colour and pairs it with its
                own foreground. Guarded by `components/accentOverride.test.ts`.
              */}
              <HeroButton
                testID="help-support-submit"
                accessibilityLabel={t('profile:support.request.submit')}
                isDisabled={isSending || failure?.kind === 'dailyLimit'}
                onPress={() => void submit()}
                className="min-h-11 rounded-full"
              >
                <AccentIcon name="send-outline" size={16} />
                <HeroButton.Label className="text-sm font-semibold">
                  {isSending ? t('profile:support.request.sending') : t('profile:support.request.submit')}
                </HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
        ) : null}
      </>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('profile:support.request.title')}
        backLabel={t('common:back')}
        fallbackHref="/(modals)/support"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingBottom: 64, gap: 16 }}
          keyboardShouldPersistTaps="handled"
        >
          <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.16) }}>
            <View className="h-1" style={{ backgroundColor: tone }} />
            <HeroCard.Body className="gap-3 p-5">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
                  <Ionicons name="help-buoy-outline" size={24} color={tone} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>
                    {t('profile:support.request.heading')}
                  </Text>
                  <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('profile:support.request.intro')}
                  </Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>

          {body}
        </ScrollView>
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}

/** Sort a failed send into what the member can do about it. */
function classifyFailure(caught: unknown, fallback: string): Failure {
  if (caught instanceof ApiResponseError) {
    // 🔴 Matched on the CODE, never the message: the message is in the member's
    // language, so matching on its wording would work in English only.
    if (caught.code === SUPPORT_REPORT_DAILY_LIMIT) return { kind: 'dailyLimit' };
    if (caught.status === 429) return { kind: 'tooFast' };
    if (caught.status === 0) return { kind: 'network' };
  }
  return { kind: 'other', message: describeApiError(caught, fallback) };
}

function FailureNotice({ failure }: { failure: Failure }) {
  const { t } = useTranslation('profile');
  const theme = useTheme();
  const isLimit = failure.kind === 'dailyLimit' || failure.kind === 'tooFast';
  const color = isLimit ? theme.warning : theme.error;

  const title = failure.kind === 'dailyLimit'
    ? t('support.request.dailyLimitTitle')
    : failure.kind === 'tooFast'
      ? t('support.request.tooFastTitle')
      : t('support.request.errorTitle');
  const description = failure.kind === 'dailyLimit'
    ? t('support.request.dailyLimitBody')
    : failure.kind === 'tooFast'
      ? t('support.request.tooFastBody')
      : failure.kind === 'network'
        ? t('support.request.networkBody')
        : failure.message;

  return (
    <View
      testID={`help-support-failure-${failure.kind}`}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      className="flex-row items-start gap-3 rounded-panel-inner p-3"
      style={{ backgroundColor: withAlpha(color, 0.12), borderWidth: 1, borderColor: withAlpha(color, 0.28) }}
    >
      <Ionicons name={isLimit ? 'time-outline' : 'alert-circle-outline'} size={20} color={color} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-sm font-semibold" style={{ color: theme.text }}>{title}</Text>
        <Text className="text-sm leading-5" style={{ color: theme.text }}>{description}</Text>
      </View>
    </View>
  );
}

function StatusCard({
  testID,
  icon,
  color,
  title,
  description,
  live = false,
  children,
}: {
  testID: string;
  icon: IconName;
  color: string;
  title: string;
  description: string;
  live?: boolean;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <HeroCard testID={testID} className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(color, 0.24) }}>
      <HeroCard.Body className="gap-4 p-5">
        <View className="flex-row items-start gap-3" accessibilityLiveRegion={live ? 'polite' : undefined}>
          <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(color, 0.14) }}>
            <Ionicons name={icon} size={22} color={color} />
          </View>
          <View className="min-w-0 flex-1">
            <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>
              {title}
            </Text>
            <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
              {description}
            </Text>
          </View>
        </View>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}
