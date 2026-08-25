// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Delete your own account, from inside the app.
 *
 * 🔴 Owner-reported parity gap, 2026-08-25: the web app's settings page has had this since
 * before the native app existed, and the native app had nothing — no row, no screen, no API
 * call. It is also a hard Google Play requirement: an app that lets people create an account
 * must let them delete it from inside the app, not only on a website.
 *
 * It calls the same endpoint as the web app (`DELETE /api/v2/users/me`), so the server does
 * exactly what it already does for web members: re-authenticate the password, then a full
 * GDPR Article 17 erasure. Nothing about the deletion is reimplemented here, which is the
 * point — a second, subtly different erasure path would be far worse than no second client.
 *
 * Two gates before the button works, matching the web app: type the confirmation keyword,
 * and enter the current password. The keyword is the cheap protection against a mis-tap;
 * the password is the real one, and the server enforces it regardless of what this screen
 * does.
 *
 * 🔴 The password travels in the request BODY. `api.delete()` discarded bodies until this
 * screen needed one — see `RequestOptions.body`. A password in a query string would be
 * written to server logs, proxy logs and crash reports.
 */

import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { useAppToast } from '@/components/ui/AppToast';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { ApiResponseError } from '@/lib/api/client';
import { deleteAccount } from '@/lib/api/settings';
import { describeApiError } from '@/lib/api/describeApiError';
import { isDeleteConfirmed } from '@/lib/utils/deleteConfirmation';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import * as Haptics from '@/lib/haptics';

/** The five things a member should know before pressing the button, in plain words. */
const CONSEQUENCE_KEYS = ['profile', 'listings', 'messages', 'credits', 'signIn'] as const;

export default function SettingsDeleteAccountScreen() {
  const { t } = useTranslation(['settings', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { logout } = useAuth();

  const [confirmation, setConfirmation] = useState('');
  const [password, setPassword] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  const keyword = t('deleteAccount.keyword');
  const canDelete = isDeleteConfirmed(confirmation, keyword) && password.length > 0;

  async function handleDelete() {
    // Defensive: the button is disabled, but a stale press or a future refactor must not
    // reach the server with an unconfirmed request.
    if (!canDelete) {
      showToast({
        title: t('deleteAccount.confirmRequired'),
        description: t('deleteAccount.confirmRequiredBody', { keyword }),
        variant: 'danger',
      });
      return;
    }

    setIsDeleting(true);
    try {
      await deleteAccount(password);
      setPassword('');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({
        title: t('deleteAccount.done'),
        description: t('deleteAccount.doneBody'),
        variant: 'success',
      });
      // logout() clears the stored token, purges local offline data and returns to the
      // sign-in screen. The server has already revoked the token, so its own logout call
      // will fail — that is handled inside logout() and must not stop the sign-out.
      await logout();
    } catch (err) {
      // Worth distinguishing: "wrong password" and "you tried this a moment ago" are both
      // recoverable, and a generic message hides which one it is.
      //
      // 🔴 The rate-limit case is special-cased because the server's own words are no use
      // to a member. Found on a device on 2026-08-25: one mistyped password put the next
      // attempt inside the one-per-60-seconds limit, and the screen said "Rate limit
      // exceeded. Please try again later." — jargon, and silent about how long "later" is,
      // when the server had sent `Retry-After: 60` all along.
      const isTooSoon = err instanceof ApiResponseError && err.code === 'RATE_LIMIT_EXCEEDED';
      showToast({
        title: t('deleteAccount.failed'),
        description: isTooSoon
          ? t('deleteAccount.tooSoon')
          : describeApiError(err, t('deleteAccount.failedBody')),
        variant: 'danger',
      });
      setIsDeleting(false);
    }
    // No `finally`: on success this screen is being torn down behind the sign-out, and
    // clearing the loading flag there would briefly re-enable a button for a deleted
    // account.
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar
          title={t('deleteAccount.title')}
          backLabel={t('common:buttons.back')}
          fallbackHref="/(modals)/settings"
        />
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 12 }}
            keyboardShouldPersistTaps="handled"
          >
            <HeroCard className="overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: theme.error }} />
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View
                    className="size-11 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: `${theme.error}1F` }}
                  >
                    <Ionicons name="warning-outline" size={22} color={theme.error} />
                  </View>
                  <View className="min-w-0 flex-1">
                    {/* The accessibility-aware wrapper, not heroui's Chip directly:
                        components/chipMigration.test.ts holds a shrink-only budget for raw
                        Chip imports, and a raw Chip announces its own label as a separate
                        swipe stop under TalkBack. */}
                    <View className="flex-row">
                      <Badge label={t('deleteAccount.permanentBadge')} size="sm" color={theme.error} />
                    </View>
                    <Text className="mt-2 text-xl font-bold" style={{ color: theme.text }}>
                      {t('deleteAccount.warning')}
                    </Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                      {t('deleteAccount.warningBody')}
                    </Text>
                  </View>
                </View>

                <Surface variant="secondary" className="rounded-panel-inner px-3 py-3">
                  <View className="gap-2">
                    {CONSEQUENCE_KEYS.map((key) => (
                      <View key={key} className="flex-row items-start gap-2">
                        <Ionicons name="ellipse" size={6} color={theme.textMuted} style={{ marginTop: 6 }} />
                        <Text
                          testID={`delete-account-consequence-${key}`}
                          className="min-w-0 flex-1 text-sm leading-5"
                          style={{ color: theme.textSecondary }}
                        >
                          {t(`deleteAccount.consequences.${key}`)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </Surface>
              </HeroCard.Body>
            </HeroCard>

            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                <Text className="text-base font-bold" style={{ color: theme.text }}>
                  {t('deleteAccount.confirmTitle')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('deleteAccount.typeConfirm', { keyword })}
                </Text>
                <Input
                  testID="delete-account-confirmation"
                  label={t('deleteAccount.confirmationLabel', { keyword })}
                  value={confirmation}
                  onChangeText={setConfirmation}
                  placeholder={keyword}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  autoComplete="off"
                  editable={!isDeleting}
                />
                <Input
                  testID="delete-account-password"
                  label={t('deleteAccount.passwordLabel')}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="current-password"
                  editable={!isDeleting}
                />
                {/* The local wrapper, per WRAPPER_POLICY: it carries the haptic, the
                    loading spinner and the disabled state a route screen should not have
                    to reimplement. */}
                <Button
                  testID="delete-account-submit"
                  variant="danger"
                  fullWidth
                  isLoading={isDeleting}
                  disabled={!canDelete}
                  onPress={() => void handleDelete()}
                  accessibilityLabel={t('deleteAccount.submit')}
                >
                  {isDeleting ? t('deleteAccount.deleting') : t('deleteAccount.submit')}
                </Button>
                <Text className="text-xs leading-4" style={{ color: theme.textMuted }}>
                  {t('deleteAccount.alternativeHint')}
                </Text>
              </HeroCard.Body>
            </HeroCard>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
