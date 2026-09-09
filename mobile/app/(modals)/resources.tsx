// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import { Button as HeroButton, Card as HeroCard, Surface, Tabs } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import {
  getKbArticles,
  searchKbArticles,
  getResourceCategories,
  getResources,
  type KbArticle,
  type ResourceCategory,
  type ResourceItem,
} from '@/lib/api/resources';
import { useApi } from '@/lib/hooks/useApi';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { withRouteGate } from '@/components/withRouteGate';
import { useOpenExternalUrl } from '@/components/ui/useOpenExternalUrl';

type ResourcesTab = 'resources' | 'kb';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function ResourcesScreen() {
  const { t } = useTranslation(['resources', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  // A saved collection opens a resource by id (`profile-collections.tsx`). Until 2026-09-07
  // this screen ignored the parameter, so "open saved resource" landed on the plain list and
  // the member had to find the file again. The named item is pinned first and highlighted.
  const params = useLocalSearchParams<{ item?: string | string[] }>();
  const rawItem = Array.isArray(params.item) ? params.item[0] : params.item;
  const highlightedId = /^\d+$/.test(rawItem ?? '') ? Number(rawItem) : null;
  const [tab, setTab] = useState<ResourcesTab>('resources');
  const [search, setSearch] = useState('');
  /*
    🔴 One request per keystroke. Typing "gardening" fired nine, so on a poor connection
    the list flickered through nine loading states and the endpoint's own rate limit
    started refusing. `useDebounce` already existed and neither live search used it
    (audit 2026-09-07, F/F-14).
  */
  const debouncedSearch = useDebounce(search, 350);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const {
    data: resourcesPage,
    isLoading: resourcesLoading,
    error: resourcesError,
    refresh: refreshResources,
  } = useApi(() => getResources({ search: debouncedSearch, categoryId }), [debouncedSearch, categoryId]);
  const {
    data: categories,
    refresh: refreshCategories,
  } = useApi(() => getResourceCategories());
  /*
    🔴 The knowledge-base search only filtered the articles already on screen. The tab
    fetches one page and then matched the typed term against those rows in JavaScript,
    so an article that answered the question exactly — but sat outside that page —
    reported "no results". A member searching their community's help articles was told
    the answer did not exist.

    `searchKbArticles` hits `/v2/kb/search`, which searches all of them, and had no
    caller outside its own unit test. Audit 2026-09-07 F-15, fixed 2026-09-09.
  */
  const kbTerm = debouncedSearch.trim();
  const {
    data: kbPage,
    isLoading: kbBrowseLoading,
    error: kbBrowseError,
    refresh: refreshKbBrowse,
  } = useApi(() => getKbArticles(), [], { enabled: kbTerm === '' });
  const {
    data: kbResults,
    isLoading: kbSearchLoading,
    error: kbSearchError,
    refresh: refreshKbSearch,
  } = useApi(() => searchKbArticles(kbTerm), [kbTerm], { enabled: kbTerm !== '' });

  const kbLoading = kbTerm === '' ? kbBrowseLoading : kbSearchLoading;
  const kbError = kbTerm === '' ? kbBrowseError : kbSearchError;
  const refreshKb = kbTerm === '' ? refreshKbBrowse : refreshKbSearch;

  const resources = useMemo(() => {
    const items = resourcesPage?.items ?? [];
    if (highlightedId === null) return items;
    const pinned = items.find((item) => item.id === highlightedId);
    return pinned ? [pinned, ...items.filter((item) => item.id !== highlightedId)] : items;
  }, [highlightedId, resourcesPage?.items]);
  // With a term, the server has already done the matching; without one, the browse
  // page IS the list. Nothing is filtered here any more.
  const filteredKb = useMemo(
    () => (kbTerm === '' ? (kbPage?.items ?? []) : (kbResults ?? [])),
    [kbTerm, kbPage?.items, kbResults],
  );
  const isLoading = tab === 'resources' ? resourcesLoading : kbLoading;
  const error = tab === 'resources' ? resourcesError : kbError;
  /* Rows already on screen. A pull must not throw them away for a spinner, and a
     refresh that fails must not replace them with an empty state either. */
  const visibleRowCount = tab === 'resources' ? resources.length : filteredKb.length;

  const refresh = useCallback(() => {
    if (tab === 'resources') {
      refreshResources();
      refreshCategories();
    } else {
      refreshKb();
    }
    // The three refresh functions are stable per useApi instance; listing them would
    // rebuild this callback on every render and re-run the focus effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  /*
    🔴 Re-read whenever the member comes back to this screen.

    Measured on a device 2026-08-24: a resource was uploaded through the API, this screen
    was reopened, and it still said "Nothing found" — making NO request at all. The list
    had been fetched once, while the community had none, and nothing ever asked again. Kill
    the app and relaunch and the resource appears. So a member who adds a file, or whose
    community adds one, is told there is nothing here until they restart the app.

    A pull-to-refresh existed, which is exactly the trap: the screen looks refreshable, so
    the staleness reads as "there really is nothing" rather than "nobody asked".
  */
  useFocusEffect(refresh);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('resources:title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <ScrollView
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        >
          <View className="gap-3">
            <HeroCard variant="default" className="mx-4 overflow-hidden rounded-panel p-0">
              <View className="h-1 w-full" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="library-outline" size={25} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                      {t('resources:title')}
                    </Text>
                    <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                      {t('resources:subtitle')}
                    </Text>
                  </View>
                </View>
              </HeroCard.Body>
            </HeroCard>

            <View className="mx-4">
              <Input
                label={t('resources:searchLabel')}
                placeholder={t('resources:searchPlaceholder')}
                value={search}
                onChangeText={setSearch}
                leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
                containerClassName="mb-0"
              />
            </View>

            <Surface variant="default" className="mx-4 rounded-panel-inner p-2">
              <Tabs value={tab} onValueChange={(value) => setTab(value as ResourcesTab)} variant="secondary">
                <Tabs.List>
                  <Tabs.ScrollView scrollAlign="start" contentContainerClassName="gap-1">
                    <Tabs.Indicator />
                    <Tabs.Trigger value="resources"><Tabs.Label>{t('resources:tabs.resources')}</Tabs.Label></Tabs.Trigger>
                    <Tabs.Trigger value="kb"><Tabs.Label>{t('resources:tabs.kb')}</Tabs.Label></Tabs.Trigger>
                  </Tabs.ScrollView>
                </Tabs.List>
              </Tabs>
            </Surface>

            {tab === 'resources' ? (
              <CategoryStrip categories={categories ?? []} selectedId={categoryId} onSelect={setCategoryId} />
            ) : null}

            {visibleRowCount > 0 ? <View className="px-4"><RefreshFailedNotice error={error ? String(error) : null} onRetry={refresh} /></View> : null}
            {isLoading && visibleRowCount === 0 ? (
              <View className="items-center justify-center py-14">
                <LoadingSpinner />
              </View>
            ) : error && visibleRowCount === 0 ? (
              <View className="px-4 py-8">
                <EmptyState icon="warning-outline" title={t('resources:errorTitle')} subtitle={String(error)} actionLabel={t('common:buttons.retry')} onAction={refresh} />
              </View>
            ) : tab === 'resources' ? (
              resources.length > 0 ? (
                <View className="gap-3 px-4">
                  {resources.map((item) => <ResourceCard key={item.id} item={item} highlighted={item.id === highlightedId} />)}
                </View>
              ) : (
                <View className="px-4 py-8">
                  <EmptyState icon="library-outline" title={t('resources:emptyTitle')} subtitle={t('resources:emptySubtitle')} />
                </View>
              )
            ) : filteredKb.length > 0 ? (
              <View className="gap-3 px-4">
                {filteredKb.map((article) => <KbCard key={article.id} article={article} />)}
              </View>
            ) : (
              <View className="px-4 py-8">
                <EmptyState icon="book-outline" title={t('resources:emptyTitle')} subtitle={t('resources:emptySubtitle')} />
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function CategoryStrip({
  categories,
  selectedId,
  onSelect,
}: {
  categories: ResourceCategory[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const { t } = useTranslation(['resources']);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-4">
      <HeroButton size="sm" variant={selectedId === null ? 'primary' : 'secondary'} onPress={() => onSelect(null)}>
        <HeroButton.Label>{t('resources:allCategories')}</HeroButton.Label>
      </HeroButton>
      {categories.map((category) => (
        <HeroButton key={category.id} size="sm" variant={selectedId === category.id ? 'primary' : 'secondary'} onPress={() => onSelect(category.id)}>
          <HeroButton.Label>{category.name}</HeroButton.Label>
          <Chip size="sm" variant="secondary">
            <Chip.Label>{t('resources:categoryCount', { count: category.resource_count ?? 0 })}</Chip.Label>
          </Chip>
        </HeroButton>
      ))}
    </ScrollView>
  );
}

function ResourceCard({ item, highlighted = false }: { item: ResourceItem; highlighted?: boolean }) {
  const openExternal = useOpenExternalUrl();
  const { t } = useTranslation(['resources']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const icon = fileIcon(item.file_path ?? item.file_url ?? '');
  return (
    <HeroCard
      variant="default"
      className="overflow-hidden rounded-panel p-0"
      style={highlighted ? { borderWidth: 2, borderColor: primary } : undefined}
      testID={highlighted ? `resource-card-highlighted-${item.id}` : `resource-card-${item.id}`}
      accessibilityLabel={highlighted ? t('resources:savedItemHighlighted', { title: item.title }) : undefined}
    >
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-panel-inner bg-surface-secondary">
            <Ionicons name={icon} size={22} color={theme.info} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>{item.title}</Text>
            {item.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{item.description}</Text> : null}
            <View className="flex-row flex-wrap gap-2">
              {item.category ? <Chip size="sm" variant="secondary"><Chip.Label>{item.category.name}</Chip.Label></Chip> : null}
              <Chip size="sm" variant="secondary"><Chip.Label>{t('resources:downloads', { count: item.downloads ?? 0 })}</Chip.Label></Chip>
            </View>
          </View>
        </View>
        {item.file_url ? (
          <HeroButton variant="secondary" onPress={() => void openExternal(item.file_url)}>
            <HeroButton.Label>{t('resources:download')}</HeroButton.Label>
            <Ionicons name="open-outline" size={16} color={theme.info} />
          </HeroButton>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function KbCard({ article }: { article: KbArticle }) {
  const { t } = useTranslation(['resources']);
  const theme = useTheme();
  return (
    <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-panel-inner bg-surface-secondary">
            <Ionicons name="book-outline" size={22} color={theme.info} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>{article.title}</Text>
            {article.content_preview ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{stripHtml(article.content_preview)}</Text> : null}
            {article.category_name ? <Chip size="sm" variant="secondary" className="self-start"><Chip.Label>{article.category_name}</Chip.Label></Chip> : null}
          </View>
        </View>
        <HeroButton variant="secondary" onPress={() => router.push({ pathname: '/(modals)/kb-article', params: { id: String(article.id) } } as unknown as Href)}>
          <HeroButton.Label>{t('resources:readArticle')}</HeroButton.Label>
          <Ionicons name="chevron-forward-outline" size={16} color={theme.info} />
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function fileIcon(path: string): IoniconName {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image-outline';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'grid-outline';
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext)) return 'document-text-outline';
  return 'document-outline';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

export default withRouteGate(ResourcesScreen, 'resources');
