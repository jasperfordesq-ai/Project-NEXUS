// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useTenant } from '@/lib/hooks/useTenant';
import { buildWebUrl } from '@/lib/utils/webUrl';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import * as Linking from 'expo-linking';
import { useTranslation } from 'react-i18next';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';

import { BottomSheetScrollView } from '@gorhom/bottom-sheet';

import AppTopBar from '@/components/ui/AppTopBar';
import BottomSheet from '@/components/ui/BottomSheet';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';

type SupportItem = {
  key: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  path?: string;
  route?: Href;
  documentKey?: string;
};

type SupportDocument = {
  key: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  path: string;
};

const SUPPORT_ITEMS: SupportItem[] = [
  { key: 'help', icon: 'help-circle-outline', path: '/help' },
  { key: 'resources', icon: 'library-outline', route: '/(modals)/resources' as Href },
  { key: 'about', icon: 'information-circle-outline', path: '/about', documentKey: 'about' },
  { key: 'contact', icon: 'mail-outline', path: '/contact', documentKey: 'contact' },
  { key: 'terms', icon: 'document-text-outline', path: '/terms', documentKey: 'terms' },
  { key: 'privacy', icon: 'shield-checkmark-outline', path: '/privacy', documentKey: 'privacy' },
  { key: 'cookies', icon: 'settings-outline', path: '/cookies', documentKey: 'cookies' },
  { key: 'accessibility', icon: 'accessibility-outline', path: '/accessibility', documentKey: 'accessibility' },
  { key: 'trust', icon: 'shield-outline', path: '/trust-and-safety', documentKey: 'trust' },
];

const SUPPORT_DOCUMENTS: Record<string, SupportDocument> = SUPPORT_ITEMS.reduce((acc, item) => {
  if (item.documentKey && item.path) {
    acc[item.documentKey] = { key: item.documentKey, icon: item.icon, path: item.path };
  }
  return acc;
}, {} as Record<string, SupportDocument>);

function ActionPill({
  label,
  icon,
  onPress,
  tone,
  primary = false,
}: {
  label: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  tone: string;
  primary?: boolean;
}) {
  const theme = useTheme();

  return (
    <HeroButton
      accessibilityLabel={label}
      onPress={onPress}
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      size="sm"
      variant={primary ? 'primary' : 'secondary'}
      style={{
        backgroundColor: primary ? tone : withAlpha(tone, 0.12),
        borderWidth: primary ? 0 : 1,
        borderColor: primary ? 'transparent' : withAlpha(tone, 0.22),
      }}
    >
      <HeroButton.Label className="text-sm font-semibold" style={{ color: primary ? contrastText(tone) : theme.text }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
      <Ionicons name={icon} size={16} color={primary ? contrastText(tone) : tone} />
    </HeroButton>
  );
}

/** The keys the legal-document screen can actually fetch (`GET /v2/legal/{type}`). */
const LEGAL_DOCUMENT_TYPES = new Set(['terms', 'privacy', 'cookies']);

export default function SupportRoute() {
  return (
    <ModalErrorBoundary>
      <SupportScreen />
    </ModalErrorBoundary>
  );
}

function SupportScreen() {
  const { t } = useTranslation(['profile', 'common']);
  const { tenant } = useTenant();
  const { doc } = useLocalSearchParams<{ doc?: string | string[] }>();
  const theme = useTheme();
  const tone = theme.info;
  const initialDocumentKey = normalizeSupportDocumentKey(doc);
  const [selectedDocumentKey, setSelectedDocumentKey] = useState<string | null>(initialDocumentKey);

  /*
    🔴 S3-06: "Read in app" showed three fixed translated paragraphs for Terms, Privacy and
    Cookies — not the community's own legal text, which is the text the acceptance gate
    actually enforces. A member could believe they had read their community's terms when
    they had read generic copy. Those three now open the real document; the rest (About,
    Contact, Accessibility, Trust) have no legal-document type and keep the summary sheet.
  */
  function openSupportDocument(key: string | null) {
    if (key && LEGAL_DOCUMENT_TYPES.has(key)) {
      router.push({ pathname: '/(modals)/legal-document', params: { type: key } } as Href);
      return;
    }
    setSelectedDocumentKey(key);
  }
  const selectedDocument = selectedDocumentKey ? SUPPORT_DOCUMENTS[selectedDocumentKey] : null;

  useEffect(() => {
    setSelectedDocumentKey(normalizeSupportDocumentKey(doc));
  }, [doc]);

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
                  {item.documentKey ? (
                    <ActionPill
                      label={t('support.readInApp')}
                      icon="reader-outline"
                      tone={tone}
                      primary
                      onPress={() => openSupportDocument(item.documentKey ?? null)}
                    />
                  ) : null}
                  <ActionPill
                    label={t(item.route ? 'support.open' : 'support.openWeb')}
                    icon={item.route ? 'chevron-forward-outline' : 'open-outline'}
                    tone={tone}
                    onPress={() => item.route ? router.push(item.route) : void Linking.openURL(buildWebUrl(tenant?.slug, item.path ?? '/'))}
                  />
                </View>
              </HeroCard.Body>
            </HeroCard>
          ))}
        </View>
      </ScrollView>

      {/* Document reader — a bottom sheet so "Read in app" visibly responds from
          anywhere on the page (it previously rendered at the TOP of the scroll
          view, off-screen when the user was scrolled down → looked dead). */}
      <BottomSheet
        visible={!!selectedDocument}
        onClose={() => setSelectedDocumentKey(null)}
        snapPoints={['85%']}
        title={selectedDocument ? t(`support.docs.${selectedDocument.key}.title`) : undefined}
      >
        {selectedDocument ? (
          <BottomSheetScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
            <View className="gap-4 pt-2">
              <View className="flex-row items-start gap-3">
                <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.14) }}>
                  <Ionicons name={selectedDocument.icon} size={21} color={tone} />
                </View>
                <Text className="min-w-0 flex-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t(`support.docs.${selectedDocument.key}.summary`)}
                </Text>
              </View>
              {[1, 2, 3].map((section) => (
                <View
                  key={section}
                  className="gap-1 rounded-panel-inner p-3"
                  style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderSubtle }}
                >
                  <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                    {t(`support.docs.${selectedDocument.key}.section${section}Title`)}
                  </Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t(`support.docs.${selectedDocument.key}.section${section}Body`)}
                  </Text>
                </View>
              ))}
              <View className="flex-row flex-wrap gap-2">
                <ActionPill
                  label={t('support.openWeb')}
                  icon="open-outline"
                  tone={tone}
                  onPress={() => void Linking.openURL(buildWebUrl(tenant?.slug, selectedDocument.path))}
                />
                <ActionPill
                  label={t('support.closeDocument')}
                  icon="close-outline"
                  tone={tone}
                  onPress={() => setSelectedDocumentKey(null)}
                />
              </View>
            </View>
          </BottomSheetScrollView>
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  );
}

function normalizeSupportDocumentKey(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const normalized = raw === 'trust-and-safety' ? 'trust' : raw;
  return SUPPORT_DOCUMENTS[normalized] ? normalized : null;
}

