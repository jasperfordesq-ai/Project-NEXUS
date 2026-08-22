// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import * as Haptics from '@/lib/haptics';
import {
  acceptAllLegalDocuments,
  getLegalAcceptanceStatus,
  pendingDocuments,
  type LegalAcceptanceDocument,
} from '@/lib/api/legal';
import { useAuthContext } from '@/lib/context/AuthContext';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { useAppToast } from '@/components/ui/AppToast';
import FormActionFooter from '@/components/ui/FormActionFooter';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import OfflineBanner from '@/components/OfflineBanner';

/**
 * The legal acceptance screen.
 *
 * 🔴 Why this screen had to exist before enforcement could be switched on. The app
 * had NO legal handling across 562 API call sites. Once the platform can refuse a
 * write with `LEGAL_ACCEPTANCE_REQUIRED`, an app with no acceptance screen leaves
 * a member unable to act and with no way to find out why — every refusal would
 * read as a generic error. That is why `config/legal.php` stays in `report` mode
 * until this ships.
 *
 * 🔴 Deliberately NOT dismissable by a back gesture when it was opened because the
 * platform refused something (`presentation: 'fullScreenModal'` in the layout).
 * A member who swipes it away lands back on the action that will refuse them
 * again, which reads as the app being broken.
 *
 * Two things must always be reachable from here, and both are:
 *  - the full text of each document, because agreeing to a title is not consent;
 *  - signing out, because "I do not accept" has to have an answer.
 */
function LegalAcceptanceScreenInner() {
  const { t } = useTranslation(['legal', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { logout } = useAuthContext();

  const [documents, setDocuments] = useState<LegalAcceptanceDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    try {
      const pending = pendingDocuments(await getLegalAcceptanceStatus());
      setDocuments(pending);
      // Nothing outstanding — the member accepted elsewhere, or arrived here from a
      // stale refusal. Closing beats showing an empty list with a button that would
      // do nothing.
      if (pending.length === 0) {
        router.back();
      }
    } catch {
      // 🔴 Not treated as "nothing pending". Guessing "clear" on a failed check
      // would send the member back to an action the platform still refuses, in a
      // loop they cannot see the cause of. Offer a retry instead.
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAccept() {
    setIsAccepting(true);
    try {
      await acceptAllLegalDocuments();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch {
      // 🔴 Never reported as success. The API records acceptances in one
      // transaction and fails the whole call if any of them could not be written,
      // so telling the member their agreement was recorded when it may not have
      // been is the one thing this screen must not do.
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({
        title: t('common:errors.alertTitle'),
        description: t('legal:acceptance.error'),
        variant: 'danger',
      });
    } finally {
      setIsAccepting(false);
    }
  }

  async function handleSignOut() {
    await logout();
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140, gap: 12 }}>
        <OfflineBanner />

        <HeroCard className="overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View
                className="size-13 items-center justify-center rounded-3xl"
                style={{ backgroundColor: withAlpha(primary, 0.14) }}
              >
                <Ionicons name="document-text-outline" size={25} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>
                  {t('legal:acceptance.title')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('legal:acceptance.intro')}
                </Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        {isLoading ? (
          <View className="items-center py-8">
            <ActivityIndicator color={primary} />
          </View>
        ) : loadFailed ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="gap-3 p-4">
              <Text className="text-sm leading-5" style={{ color: theme.text }}>
                {t('common:errors.generic')}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void load()}
                className="self-start rounded-xl px-4 py-2"
                style={{ backgroundColor: withAlpha(primary, 0.14) }}
              >
                <Text className="text-sm font-semibold" style={{ color: primary }}>
                  {t('common:buttons.retry')}
                </Text>
              </Pressable>
            </HeroCard.Body>
          </HeroCard>
        ) : (
          documents.map((document) => (
            <HeroCard key={document.document_id} className="rounded-panel p-0">
              <HeroCard.Body className="gap-2 p-4">
                <View className="flex-row items-center gap-2">
                  <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.text }}>
                    {document.title}
                  </Text>
                  {/* 🔴 "Updated" on a document the member has never seen is simply
                      wrong, so the two states are labelled differently. */}
                  <View
                    className="rounded-full px-2 py-0.5"
                    style={{
                      backgroundColor: withAlpha(
                        document.acceptance_status === 'not_accepted' ? primary : theme.textSecondary,
                        0.16,
                      ),
                    }}
                  >
                    <Text className="text-xs font-bold" style={{ color: theme.text }}>
                      {document.acceptance_status === 'not_accepted'
                        ? t('legal:acceptance.newTag')
                        : t('legal:acceptance.updatedTag')}
                    </Text>
                  </View>
                </View>

                {document.current_version ? (
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                    {t('legal:document.versionLabel')} {document.current_version}
                  </Text>
                ) : null}

                {/* Agreeing to a title is not consent — the full text must be one
                    tap away. */}
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t('legal:acceptance.readLink', { title: document.title })}
                  onPress={() =>
                    router.push({
                      pathname: '/(modals)/legal-document',
                      params: { type: document.document_type },
                    })
                  }
                  className="flex-row items-center gap-1 self-start pt-1"
                >
                  <Text className="text-sm font-semibold" style={{ color: primary }}>
                    {t('legal:acceptance.readLink', { title: document.title })}
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={primary} />
                </Pressable>
              </HeroCard.Body>
            </HeroCard>
          ))
        )}

        {/* 🔴 A way out. Without it this screen is a trap: the member can neither
            use the app nor leave it. */}
        <Pressable
          accessibilityRole="button"
          onPress={() => void handleSignOut()}
          className="self-center pt-2"
        >
          <Text className="text-sm font-semibold underline" style={{ color: theme.textSecondary }}>
            {t('legal:acceptance.signOut')}
          </Text>
        </Pressable>
      </ScrollView>

      <FormActionFooter
        title={t('legal:acceptance.title')}
        subtitle={t('legal:acceptance.intro')}
        submitLabel={t('legal:acceptance.acceptButton')}
        primary={primary}
        isSubmitting={isAccepting}
        // Nothing to accept while the list is unknown, so the button cannot be
        // pressed into a no-op.
        onSubmit={() => void handleAccept()}
        isDisabled={isLoading || loadFailed || documents.length === 0}
      />
    </SafeAreaView>
  );
}

export default function LegalAcceptanceScreen() {
  return (
    <ModalErrorBoundary>
      <LegalAcceptanceScreenInner />
    </ModalErrorBoundary>
  );
}
