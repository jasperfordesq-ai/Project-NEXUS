// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Card as HeroCard, Spinner, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { getLegalDocument, type LegalDocument } from '@/lib/api/legal';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { isNotYetInForce, legalDateOnly, parseLegalContent } from '@/lib/utils/legalText';
import AppTopBar from '@/components/ui/AppTopBar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import OfflineBanner from '@/components/OfflineBanner';

/**
 * Read one legal document in full.
 *
 * Reached from the acceptance screen, because agreeing to a list of titles is not
 * consent. Rendered in the app rather than handed to a browser: a member being
 * asked to agree to something should not have to leave the app and come back, and
 * on a device with no browser configured that hand-off simply fails.
 */
function LegalDocumentScreenInner() {
  const { t } = useTranslation(['legal', 'common']);
  const { type } = useLocalSearchParams<{ type?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();

  const [document, setDocument] = useState<LegalDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const documentType = String(type ?? '').trim();

  const load = useCallback(async () => {
    if (documentType === '') {
      setFailed(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setFailed(false);
    try {
      const response = await getLegalDocument(documentType);
      setDocument(response?.data ?? null);
    } catch {
      setFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [documentType]);

  useEffect(() => {
    void load();
  }, [load]);

  const blocks = parseLegalContent(document?.content);
  const notYetInForce = isNotYetInForce(document?.effective_date);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={document?.title || t('legal:document.back')}
        backLabel={t('common:buttons.back')}
        fallbackHref="/(modals)/legal-acceptance"
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}>
        <OfflineBanner />

        {isLoading ? (
          <View className="items-center py-8">
            <Spinner size="lg" />
          </View>
        ) : failed ? (
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
        ) : blocks.length === 0 ? (
          <HeroCard className="rounded-panel p-0">
            <HeroCard.Body className="p-4">
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('common:errors.notFound')}
              </Text>
            </HeroCard.Body>
          </HeroCard>
        ) : (
          <>
            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-2 p-4">
                {document?.effective_date ? (
                  <Text className="text-xs" style={{ color: theme.textSecondary }}>
                    {/* 🔴 A future effective_date is labelled as such. Calling it
                        "Last updated" would claim terms apply that do not yet. */}
                    {notYetInForce ? t('legal:document.effectiveFrom') : t('legal:document.lastUpdated')}
                    {': '}
                    {legalDateOnly(document.effective_date)}
                    {document.version_number
                      ? ` · ${t('legal:document.versionLabel')} ${document.version_number}`
                      : ''}
                  </Text>
                ) : null}

                {notYetInForce ? (
                  <Text className="text-sm font-semibold leading-5" style={{ color: theme.text }}>
                    {t('legal:document.notYetInForce')}
                  </Text>
                ) : null}

                {document?.summary_of_changes ? (
                  <View className="gap-1 pt-1">
                    <Text className="text-sm font-bold" style={{ color: theme.text }}>
                      {t('legal:document.summaryTitle')}
                    </Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                      {document.summary_of_changes}
                    </Text>
                  </View>
                ) : null}
              </HeroCard.Body>
            </HeroCard>

            <HeroCard className="rounded-panel p-0">
              <HeroCard.Body className="gap-3 p-4">
                {blocks.map((block, index) => {
                  if (block.type === 'heading') {
                    return (
                      <Text
                        key={`${block.type}-${index}`}
                        accessibilityRole="header"
                        className={block.level === 3 ? 'text-base font-bold' : 'text-lg font-bold'}
                        style={{ color: theme.text }}
                      >
                        {block.text}
                      </Text>
                    );
                  }

                  if (block.type === 'listItem') {
                    return (
                      <View key={`${block.type}-${index}`} className="flex-row gap-2 pl-2">
                        <Text style={{ color: theme.textSecondary }}>{'•'}</Text>
                        <Text className="min-w-0 flex-1 text-base leading-6" style={{ color: theme.text }}>
                          {block.text}
                        </Text>
                      </View>
                    );
                  }

                  return (
                    <Text
                      key={`${block.type}-${index}`}
                      className="text-base leading-6"
                      style={{ color: theme.text }}
                    >
                      {block.text}
                    </Text>
                  );
                })}
              </HeroCard.Body>
            </HeroCard>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function LegalDocumentScreen() {
  return (
    <ModalErrorBoundary>
      <LegalDocumentScreenInner />
    </ModalErrorBoundary>
  );
}
