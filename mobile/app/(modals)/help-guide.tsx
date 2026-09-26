// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One topic of the members' Help Centre guide, or one article in it — read in
 * the app, from the same text the website shows (see `lib/help/guides.ts`).
 *
 *   /(modals)/help-guide?section=wallet                  → the topic's articles
 *   /(modals)/help-guide?section=wallet&article=send_hours → one article
 *
 * 🔴 Like `help-faqs`, this never hands the member to a browser. Links inside an
 * article point at website paths, so only their text is shown.
 */

import { useMemo } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getMembersGuide, parseHelpBody, parseInline, visibleSections, type HelpBlock } from '@/lib/help/guides';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

export default function HelpGuideRoute() {
  return (
    <ModalErrorBoundary>
      <HelpGuideScreen />
    </ModalErrorBoundary>
  );
}

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function HelpGuideScreen() {
  const { t, i18n } = useTranslation(['profile', 'common']);
  const params = useLocalSearchParams<{ section?: string | string[]; article?: string | string[] }>();
  const sectionId = one(params.section);
  const articleId = one(params.article);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasFeature, hasModule } = useTenant();
  const language = i18n.resolvedLanguage || i18n.language || 'en';

  const { data: guide, isLoading, error, refresh } = useApi(() => getMembersGuide(language), [language]);

  const section = useMemo(
    () => visibleSections({ hasFeature, hasModule }).find((s) => s.id === sectionId) ?? null,
    [hasFeature, hasModule, sectionId],
  );
  const sectionText = guide?.sections[sectionId];
  const article = articleId ? section?.articles.find((a) => a.id === articleId) ?? null : null;
  const articleText = articleId ? sectionText?.articles[articleId] : undefined;

  const title = articleText?.title ?? sectionText?.title ?? t('profile:support.guides.title');

  let content;
  if (isLoading && !guide) {
    content = <LoadingSpinner />;
  } else if (error && !guide) {
    content = (
      <ErrorState
        testID="help-guide-error"
        title={t('common:errors.loadFailedTitle')}
        subtitle={t('profile:support.guides.loadFailed')}
        onRetry={refresh}
        retryLabel={t('common:buttons.retry')}
      />
    );
  } else if (!section || !sectionText || (articleId && (!article || !articleText))) {
    content = (
      <EmptyState
        testID="help-guide-not-found"
        icon="help-circle-outline"
        title={t('profile:support.guides.notFoundTitle')}
        subtitle={t('profile:support.guides.notFoundSubtitle')}
      />
    );
  } else if (articleText) {
    content = (
      <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
        <HeroCard.Body className="gap-4 p-4">
          <Text accessibilityRole="header" className="text-2xl font-bold" style={{ color: theme.text }}>
            {articleText.title}
          </Text>
          <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>
            {articleText.summary}
          </Text>
          {parseHelpBody(articleText.body).map((block, index) => (
            <HelpBlockView key={index} block={block} primary={primary} theme={theme} />
          ))}
        </HeroCard.Body>
      </HeroCard>
    );
  } else {
    content = (
      <View className="gap-3">
        <Text className="px-1 text-base leading-6" style={{ color: theme.textSecondary }}>
          {sectionText.summary}
        </Text>
        {section.articles.map((entry) => {
          const text = sectionText.articles[entry.id];
          if (!text) return null;
          return (
            <Pressable
              key={entry.id}
              accessibilityRole="button"
              accessibilityLabel={text.title}
              testID={`help-guide-article-${entry.id}`}
              onPress={() =>
                router.push({ pathname: '/(modals)/help-guide', params: { section: section.id, article: entry.id } } as Href)
              }
            >
              <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
                <HeroCard.Body className="min-h-11 flex-row items-center gap-3 p-4">
                  <View className="min-w-0 flex-1">
                    <Text className="text-base font-semibold leading-6" style={{ color: theme.text }}>{text.title}</Text>
                    <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>{text.summary}</Text>
                  </View>
                  <Ionicons name="chevron-forward-outline" size={18} color={primary} />
                </HeroCard.Body>
              </HeroCard>
            </Pressable>
          );
        })}
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={t('common:back')} fallbackHref="/(modals)/help-faqs" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
        refreshControl={(
          <RefreshControl
            refreshing={isLoading && Boolean(guide)}
            onRefresh={refresh}
            tintColor={primary}
            colors={[primary]}
          />
        )}
      >
        {content}
        {guide ? (
          <Text className="px-1 text-xs leading-5" style={{ color: theme.textSecondary }}>
            {t('profile:support.guides.websiteNote')}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InlineText({ line, color, boldColor }: { line: string; color: string; boldColor: string }) {
  return (
    <Text className="text-base leading-6" style={{ color }}>
      {parseInline(line).map((part, index) => (
        <Text key={index} style={part.bold ? { fontWeight: '700', color: boldColor } : undefined}>
          {part.text}
        </Text>
      ))}
    </Text>
  );
}

function HelpBlockView({
  block,
  primary,
  theme,
}: {
  block: HelpBlock;
  primary: string;
  theme: ReturnType<typeof useTheme>;
}) {
  switch (block.kind) {
    case 'heading':
      return (
        <Text accessibilityRole="header" className="text-lg font-bold" style={{ color: theme.text }}>
          {block.lines.join(' ')}
        </Text>
      );
    case 'tip':
      return (
        <View className="flex-row gap-3 rounded-2xl p-3" style={{ backgroundColor: withAlpha(primary, 0.1) }}>
          <Ionicons name="bulb-outline" size={20} color={primary} />
          <View className="min-w-0 flex-1">
            <InlineText line={block.lines.join(' ')} color={theme.text} boldColor={theme.text} />
          </View>
        </View>
      );
    case 'bullet':
    case 'step':
      return (
        <View className="gap-2">
          {block.lines.map((line, index) => (
            <View key={index} className="flex-row gap-3">
              {block.kind === 'step' ? (
                <View className="size-6 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Text className="text-xs font-bold" style={{ color: primary }}>{index + 1}</Text>
                </View>
              ) : (
                <Text className="text-base leading-6" style={{ color: primary }}>{'•'}</Text>
              )}
              <View className="min-w-0 flex-1">
                <InlineText line={line} color={theme.textSecondary} boldColor={theme.text} />
              </View>
            </View>
          ))}
        </View>
      );
    default:
      return <InlineText line={block.lines.join(' ')} color={theme.textSecondary} boldColor={theme.text} />;
  }
}
