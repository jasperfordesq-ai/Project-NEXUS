// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Support and legal — every destination opens inside the app.
 *
 * 🔴 This screen used to be the app's last browser hand-off. Eight of its nine
 * items called `Linking.openURL(buildWebUrl(...))`, and the ninth — "Read in
 * app" — opened a bottom sheet containing a HAND-WRITTEN three-section summary
 * assembled from `support.docs.<key>.section1Title` and friends, with a link to
 * the website for the actual text. A member reading the app's privacy policy was
 * reading invented filler next to a link to the truth.
 *
 * Everything here now has a real source:
 *   help                            → GET /v2/help/faqs
 *   resources                       → the existing resources screen
 *   about / contact / trust         → GET /v2/public-page-content/{pageKey}
 *   terms / privacy / cookies /
 *   accessibility                   → GET /v2/legal/{type}, via legal-document
 *
 * 🔴 There is deliberately no `Linking` import and no `buildWebUrl` call in this
 * file. A regression test presses every item and asserts `Linking.openURL` is
 * never called — that assertion is the point of the change, so do not weaken it
 * by adding an "open on the web" affordance back.
 *
 * 🔴 Trust and safety's page key is `trust-safety`. `/trust-and-safety` is the
 * web PATH, and asking the content endpoint for it returns RESOURCE_NOT_FOUND.
 */

import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';

import { Ionicons } from '@/components/ui/Icon';
import AppTopBar from '@/components/ui/AppTopBar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';

type SupportItem = {
  key: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  route: Href;
};

/** The legal documents this community can publish, as `legal_documents.document_type`. */
function legalRoute(type: string): Href {
  return { pathname: '/(modals)/legal-document', params: { type } } as Href;
}

/** About / Contact / Trust and safety, from the public page-content endpoint. */
function staticPageRoute(key: string): Href {
  return { pathname: '/(modals)/static-page', params: { key } } as Href;
}

const SUPPORT_ITEMS: SupportItem[] = [
  { key: 'help', icon: 'help-circle-outline', route: '/(modals)/help-faqs' as Href },
  { key: 'resources', icon: 'library-outline', route: '/(modals)/resources' as Href },
  { key: 'about', icon: 'information-circle-outline', route: staticPageRoute('about') },
  { key: 'contact', icon: 'mail-outline', route: staticPageRoute('contact') },
  { key: 'terms', icon: 'document-text-outline', route: legalRoute('terms') },
  { key: 'privacy', icon: 'shield-checkmark-outline', route: legalRoute('privacy') },
  { key: 'cookies', icon: 'settings-outline', route: legalRoute('cookies') },
  { key: 'accessibility', icon: 'accessibility-outline', route: legalRoute('accessibility') },
  /*
    🔴 Added 2026-09-06. The web legal hub (`LegalHubPage.tsx`) offers nine documents;
    this screen offered five, and these two were the gap. Both are valid values of
    `legal_documents.document_type` and both already rendered in `legal-document` —
    a member is sent there to ACCEPT them — so they were readable when demanded and
    unreadable when merely wanted. `document.empty` covers a community that has not
    published its own version, so listing them cannot produce a dead end.
  */
  { key: 'communityGuidelines', icon: 'people-outline', route: legalRoute('community_guidelines') },
  { key: 'acceptableUse', icon: 'checkmark-circle-outline', route: legalRoute('acceptable_use') },
  { key: 'trust', icon: 'shield-outline', route: staticPageRoute('trust-safety') },
];

/**
 * Deep links land here with `?doc=<key>`.
 *
 * 🔴 `app/+native-intent.ts` maps `/privacy`, `/terms`, `/trust-and-safety` and
 * the rest onto `/(modals)/support?doc=…`. That mapping is owned elsewhere and
 * still in force, so this screen must keep honouring the parameter — otherwise a
 * privacy link from an email would open a menu instead of the policy.
 */
const DOC_ROUTES: Record<string, Href> = SUPPORT_ITEMS.reduce((acc, item) => {
  if (item.key !== 'resources' && item.key !== 'help') acc[item.key] = item.route;
  return acc;
}, {} as Record<string, Href>);

export default function SupportRoute() {
  return (
    <ModalErrorBoundary>
      <SupportScreen />
    </ModalErrorBoundary>
  );
}

function SupportScreen() {
  const { t } = useTranslation(['profile', 'common']);
  const { doc } = useLocalSearchParams<{ doc?: string | string[] }>();
  const theme = useTheme();
  const tone = theme.info;

  const requestedDoc = normalizeSupportDocumentKey(doc);
  // Follow a deep link once. Without the guard, coming back from the document
  // would immediately push it again and the member could never reach this list.
  const followedDoc = useRef<string | null>(null);

  useEffect(() => {
    if (!requestedDoc || followedDoc.current === requestedDoc) return;
    followedDoc.current = requestedDoc;
    router.push(DOC_ROUTES[requestedDoc]);
  }, [requestedDoc]);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('support.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
      <ScrollView className="flex-1" style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 110, paddingHorizontal: 16 }}>
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.16) }}>
          <View className="h-1" style={{ backgroundColor: tone }} />
          <HeroCard.Body className="gap-4 p-5">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
                <Ionicons name="compass-outline" size={24} color={tone} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={2}>
                  {t('support.heading')}
                </Text>
                <Text className="mt-2 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>
                  {t('support.description')}
                </Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        <View className="gap-3">
          {SUPPORT_ITEMS.map((item) => (
            <HeroCard
              key={item.key}
              className="overflow-hidden rounded-panel p-0"
              style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.1) }}
            >
              <HeroCard.Body className="gap-4 p-4">
                <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: withAlpha(tone, 0.76) }} />
                <View className="flex-row items-start gap-3 pl-1">
                  <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.12) }}>
                    <Ionicons name={item.icon} size={21} color={tone} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                      {t(`support.items.${item.key}.title`)}
                    </Text>
                    <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
                      {t(`support.items.${item.key}.description`)}
                    </Text>
                  </View>
                </View>
                <View className="flex-row flex-wrap gap-2 pl-1">
                  <ActionPill
                    label={t('support.open')}
                    testID={`support-open-${item.key}`}
                    tone={tone}
                    onPress={() => router.push(item.route)}
                  />
                </View>
              </HeroCard.Body>
            </HeroCard>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionPill({
  label,
  onPress,
  tone,
  testID,
}: {
  label: string;
  onPress: () => void;
  tone: string;
  testID: string;
}) {
  return (
    <HeroButton
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      size="sm"
      variant="primary"
      style={{ backgroundColor: tone }}
    >
      <HeroButton.Label className="text-sm font-semibold" style={{ color: contrastText(tone) }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
      <Ionicons name="chevron-forward-outline" size={16} color={contrastText(tone)} />
    </HeroButton>
  );
}

function normalizeSupportDocumentKey(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const normalized = raw === 'trust-and-safety' ? 'trust' : raw;
  return DOC_ROUTES[normalized] ? normalized : null;
}
