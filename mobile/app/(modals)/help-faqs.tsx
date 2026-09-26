// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The community's help answers, in the app.
 *
 * 🔴 "Help centre" on the support screen used to call `Linking.openURL` and hand
 * the member to a browser. Everything the web help page renders comes from one
 * public endpoint — `GET /v2/help/faqs` — so the hand-off bought nothing and cost
 * the member their place in the app. On a device with no browser configured it
 * simply failed.
 */

import { useMemo, useState } from 'react';
import { router, type Href } from 'expo-router';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import { getHelpFaqs, type HelpFaqCategory } from '@/lib/api/help';
import { bodyToPlainText, getMembersGuide, visibleSections, type HelpGuideText } from '@/lib/help/guides';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { toPlainText } from '@/lib/utils/plainText';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import SearchInput from '@/components/ui/SearchInput';

export default function HelpFaqsRoute() {
  return (
    <ModalErrorBoundary>
      <HelpFaqsScreen />
    </ModalErrorBoundary>
  );
}

function HelpFaqsScreen() {
  const { t, i18n } = useTranslation(['profile', 'common']);
  const primary = usePrimaryColor();
  const language = i18n.resolvedLanguage || i18n.language || 'en';
  // The members' step-by-step guides (the website's Help Centre text). A failure
  // here only hides the guides: the community's own answers below still work.
  const { data: guide } = useApi(() => getMembersGuide(language), [language]);
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [openIds, setOpenIds] = useState<number[]>([]);

  const { data, isLoading, error, refresh } = useApi(() => getHelpFaqs(), []);

  const groups: HelpFaqCategory[] = useMemo(() => data ?? [], [data]);

  /*
    Filtering happens here rather than through the endpoint's `q` parameter on
    purpose — see `lib/api/help.ts`. The answer is searched as plain text so a
    member matches the words they can actually read, not the HTML around them.
  */
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return groups;
    return groups
      .map((group) => ({
        category: group.category,
        faqs: group.faqs.filter((faq) =>
          [faq.question, toPlainText(faq.answer), group.category]
            .join(' ')
            .toLowerCase()
            .includes(term),
        ),
      }))
      .filter((group) => group.faqs.length > 0);
  }, [groups, search]);

  const hasAnyAnswers = groups.some((group) => group.faqs.length > 0);

  function toggle(id: number) {
    setOpenIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('profile:support.faqs.title')}
        backLabel={t('common:back')}
        fallbackHref="/(modals)/support"
      />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 12 }}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />
        }
      >
        <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}>
          <View className="h-1 w-full" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="help-circle-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>
                  {t('profile:support.faqs.title')}
                </Text>
                <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('profile:support.faqs.subtitle')}
                </Text>
              </View>
            </View>
          </HeroCard.Body>
        </HeroCard>

        {hasAnyAnswers || guide ? (
          <SearchInput
            value={search}
            onChangeText={setSearch}
            placeholder={t('profile:support.faqs.searchPlaceholder')}
            accessibilityLabel={t('profile:support.faqs.searchLabel')}
            clearLabel={t('common:actions.clear')}
          />
        ) : null}

        {guide ? <HelpGuidesBlock guide={guide} search={search} /> : null}

        {guide && hasAnyAnswers ? (
          <Text accessibilityRole="header" className="px-1 pt-2 text-lg font-bold" style={{ color: theme.text }}>
            {t('profile:support.guides.communityHeading')}
          </Text>
        ) : null}

        {isLoading && groups.length === 0 ? (
          <LoadingSpinner />
        ) : error ? (
          <ErrorState
            testID="help-faqs-error"
            title={t('common:errors.loadFailedTitle')}
            subtitle={error}
            onRetry={refresh}
            retryLabel={t('common:buttons.retry')}
          />
        ) : !hasAnyAnswers ? (
          <EmptyState
            testID="help-faqs-empty"
            icon="help-circle-outline"
            title={t('profile:support.faqs.emptyTitle')}
            subtitle={t('profile:support.faqs.emptySubtitle')}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            testID="help-faqs-no-matches"
            icon="search-outline"
            title={t('profile:support.faqs.noMatchesTitle')}
            subtitle={t('profile:support.faqs.noMatchesSubtitle')}
            actionLabel={t('common:actions.clear')}
            onAction={() => setSearch('')}
          />
        ) : (
          filtered.map((group) => (
            <View key={group.category || 'general'} className="gap-2">
              {group.category ? (
                <Text
                  accessibilityRole="header"
                  className="px-1 text-xs font-bold uppercase"
                  style={{ color: theme.textSecondary, letterSpacing: 0.6 }}
                >
                  {group.category}
                </Text>
              ) : null}

              {group.faqs.map((faq) => {
                const isOpen = openIds.includes(faq.id);
                return (
                  <HeroCard key={faq.id} className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
                    <HeroCard.Body className="gap-2 p-0">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{ expanded: isOpen }}
                        accessibilityLabel={faq.question}
                        testID={`help-faq-${faq.id}`}
                        onPress={() => toggle(faq.id)}
                        className="min-h-11 flex-row items-center gap-3 p-4"
                      >
                        <Text className="min-w-0 flex-1 text-base font-semibold leading-6" style={{ color: theme.text }}>
                          {faq.question}
                        </Text>
                        <Ionicons name={isOpen ? 'chevron-up-outline' : 'chevron-down-outline'} size={18} color={primary} />
                      </Pressable>
                      {isOpen ? (
                        <View className="px-4 pb-4">
                          <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>
                            {toPlainText(faq.answer)}
                          </Text>
                        </View>
                      ) : null}
                    </HeroCard.Body>
                  </HeroCard>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Topics of the members' guide, or — while the member is searching — the guide
 * articles that match. Each opens `help-guide` inside the app.
 */
function HelpGuidesBlock({ guide, search }: { guide: HelpGuideText; search: string }) {
  const { t } = useTranslation(['profile']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasFeature, hasModule } = useTenant();

  const sections = useMemo(
    () => visibleSections({ hasFeature, hasModule }).filter((section) => guide.sections[section.id]),
    [guide, hasFeature, hasModule],
  );

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return sections.flatMap((section) =>
      section.articles
        .map((entry) => ({ section, entry, text: guide.sections[section.id]?.articles[entry.id] }))
        .filter(({ text }) => !!text
          && [text.title, text.summary, bodyToPlainText(text.body)].join(' ').toLowerCase().includes(term)),
    ).slice(0, 20);
  }, [guide, search, sections]);

  if (sections.length === 0) return null;
  const searching = search.trim().length > 0;
  if (searching && matches.length === 0) return null;

  const row = (key: string, title: string, subtitle: string, href: Href, testID: string) => (
    <Pressable key={key} accessibilityRole="button" accessibilityLabel={title} testID={testID} onPress={() => router.push(href)}>
      <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
        <HeroCard.Body className="min-h-11 flex-row items-center gap-3 p-4">
          <Ionicons name="book-outline" size={20} color={primary} />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold leading-6" style={{ color: theme.text }}>{title}</Text>
            <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward-outline" size={18} color={primary} />
        </HeroCard.Body>
      </HeroCard>
    </Pressable>
  );

  return (
    <View className="gap-2" testID="help-guides">
      <Text accessibilityRole="header" className="px-1 pt-2 text-lg font-bold" style={{ color: theme.text }}>
        {searching ? t('profile:support.guides.matchesHeading') : t('profile:support.guides.title')}
      </Text>
      {!searching ? (
        <Text className="px-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
          {t('profile:support.guides.subtitle')}
        </Text>
      ) : null}
      {searching
        ? matches.map(({ section, entry, text }) =>
            row(
              `${section.id}.${entry.id}`,
              text?.title ?? '',
              text?.summary ?? '',
              { pathname: '/(modals)/help-guide', params: { section: section.id, article: entry.id } } as Href,
              `help-guide-match-${entry.id}`,
            ))
        : sections.map((section) =>
            row(
              section.id,
              guide.sections[section.id]?.title ?? '',
              guide.sections[section.id]?.summary ?? '',
              { pathname: '/(modals)/help-guide', params: { section: section.id } } as Href,
              `help-guide-section-${section.id}`,
            ))}
    </View>
  );
}
