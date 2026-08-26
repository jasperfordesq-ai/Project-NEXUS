// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  createSavedCollection,
  getMySavedCollections,
  getPublicSavedCollections,
  getSavedCollectionItems,
  removeSavedItem,
  type SavedCollection,
  type SavedItem,
} from '@/lib/api/savedCollections';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import Toggle from '@/components/ui/Toggle';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';

function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function isPublicScope(value: unknown): boolean {
  return value === 'public';
}

export default function ProfileCollectionsScreen() {
  return (
    <ModalErrorBoundary>
      <ProfileCollectionsInner />
    </ModalErrorBoundary>
  );
}

function ProfileCollectionsInner() {
  const { t } = useTranslation(['members', 'common']);
  const params = useLocalSearchParams<{ userId?: string; name?: string; scope?: string; collectionId?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const publicScope = isPublicScope(params.scope) && Boolean(params.userId);
  const [selectedCollection, setSelectedCollection] = useState<SavedCollection | null>(null);
  const [itemPage, setItemPage] = useState(1);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  const collectionsQuery = useApi(
    () => publicScope ? getPublicSavedCollections(params.userId ?? '') : getMySavedCollections(),
    [publicScope, params.userId],
  );
  const collections = useMemo(() => collectionsQuery.data?.data ?? [], [collectionsQuery.data?.data]);

  useEffect(() => {
    if (!params.collectionId || selectedCollection || collections.length === 0) return;
    const match = collections.find((collection) => String(collection.id) === String(params.collectionId));
    if (match) setSelectedCollection(match);
  }, [collections, params.collectionId, selectedCollection]);

  const itemsQuery = useApi(
    () => getSavedCollectionItems(selectedCollection?.id ?? '', itemPage, 20),
    [selectedCollection?.id, itemPage],
    { enabled: Boolean(selectedCollection?.id) },
  );

  useEffect(() => {
    const payload = itemsQuery.data?.data;
    if (!payload?.items) return;
    setItems((current) => (itemPage === 1 ? payload.items : [...current, ...payload.items]));
  }, [itemPage, itemsQuery.data]);

  const totalPages = itemsQuery.data?.meta?.last_page ?? itemsQuery.data?.meta?.total_pages ?? 1;
  const canLoadMoreItems = itemPage < totalPages;

  function openCollection(collection: SavedCollection) {
    setSelectedCollection(collection);
    setItemPage(1);
    setItems([]);
  }

  function closeCollection() {
    setSelectedCollection(null);
    setItemPage(1);
    setItems([]);
  }

  async function handleRemoveItem(item: SavedItem) {
    try {
      await removeSavedItem(item.id);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('collections.removeFailed')), variant: 'danger' });
    }
  }

  async function handleCreate(payload: { name: string; description: string; isPublic: boolean }) {
    if (!payload.name.trim()) {
      showToast({ title: t('common:errors.alertTitle'), description: t('collections.nameRequired'), variant: 'warning' });
      return;
    }
    setCreating(true);
    try {
      await createSavedCollection({
        name: payload.name.trim(),
        description: payload.description.trim() || null,
        is_public: payload.isPublic,
      });
      setShowCreate(false);
      collectionsQuery.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('collections.createFailed')), variant: 'danger' });
    } finally {
      setCreating(false);
    }
  }

  if (selectedCollection) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={selectedCollection.name} backLabel={t('common:back')} onBack={closeCollection} fallbackHref={'/(modals)/profile-collections' as Href} />
        <FlatList<SavedItem>
          data={items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={itemsQuery.isLoading && itemPage === 1} onRefresh={() => { setItemPage(1); itemsQuery.refresh(); }} tintColor={primary} colors={[primary]} />}
          ListHeaderComponent={
            <HeroCard variant="default" className="mb-4 overflow-hidden rounded-panel p-0">
              <View className="h-1" style={{ backgroundColor: selectedCollection.color || primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(selectedCollection.color || primary, 0.14) }}>
                    <Ionicons name="folder-open-outline" size={24} color={selectedCollection.color || primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{selectedCollection.name}</Text>
                    {selectedCollection.description ? (
                      <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                        {selectedCollection.description}
                      </Text>
                    ) : null}
                  </View>
                </View>
                <View className="flex-row flex-wrap gap-2">
                  <Chip size="sm" variant="secondary"><Chip.Label>{t('collections.itemsCount', { count: selectedCollection.items_count })}</Chip.Label></Chip>
                  <Chip size="sm" variant="secondary"><Chip.Label>{selectedCollection.is_public ? t('collections.public') : t('collections.private')}</Chip.Label></Chip>
                </View>
              </HeroCard.Body>
            </HeroCard>
          }
          renderItem={({ item }) => (
            <SavedItemRow item={item} canRemove={!publicScope} onRemove={() => void handleRemoveItem(item)} />
          )}
          ListEmptyComponent={
            itemsQuery.isLoading && itemPage === 1 ? (
              <View className="items-center justify-center py-16"><LoadingSpinner /></View>
            ) : (
              <Surface variant="secondary" className="rounded-panel p-4">
                <EmptyState
                  icon={itemsQuery.error ? 'warning-outline' : 'folder-open-outline'}
                  title={itemsQuery.error ? t('collections.itemsErrorTitle') : t('collections.emptyItemsTitle')}
                  subtitle={itemsQuery.error ?? t('collections.emptyItemsSubtitle')}
                  actionLabel={itemsQuery.error ? t('common:buttons.retry') : undefined}
                  onAction={itemsQuery.error ? () => itemsQuery.refresh() : undefined}
                />
              </Surface>
            )
          }
          ListFooterComponent={
            canLoadMoreItems ? (
              <HeroButton className="mt-4" variant="secondary" onPress={() => setItemPage((current) => current + 1)} isDisabled={itemsQuery.isLoading}>
                {itemsQuery.isLoading && itemPage > 1 ? <Spinner size="sm" /> : <Ionicons name="chevron-down-outline" size={16} color={primary} />}
                <HeroButton.Label>{t('collections.loadMoreItems')}</HeroButton.Label>
              </HeroButton>
            ) : null
          }
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={publicScope && params.name ? t('collections.publicTitleFor', { name: params.name }) : t(publicScope ? 'collections.publicTitle' : 'collections.myTitle')}
        backLabel={t('common:back')}
        fallbackHref={publicScope && params.userId ? { pathname: '/(modals)/member-profile', params: { id: params.userId } } : '/(tabs)/profile'}
      />
      <FlatList<SavedCollection>
        data={collections}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={collectionsQuery.isLoading} onRefresh={collectionsQuery.refresh} tintColor={primary} colors={[primary]} />}
        ListHeaderComponent={
          <View className="gap-4 pb-4">
            <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
              <View className="h-1" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="bookmark-outline" size={24} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                      {t(publicScope ? 'collections.publicTitle' : 'collections.myTitle')}
                    </Text>
                    <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                      {t(publicScope ? 'collections.publicSubtitle' : 'collections.mySubtitle')}
                    </Text>
                  </View>
                </View>
                {!publicScope ? (
                  <HeroButton variant="secondary" onPress={() => setShowCreate((current) => !current)}>
                    <Ionicons name={showCreate ? 'close-outline' : 'add-outline'} size={17} color={primary} />
                    <HeroButton.Label>{t(showCreate ? 'collections.closeCreate' : 'collections.create')}</HeroButton.Label>
                  </HeroButton>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
            {showCreate ? <CreateCollectionCard isSubmitting={creating} onSubmit={(payload) => void handleCreate(payload)} /> : null}
          </View>
        }
        renderItem={({ item }) => <CollectionRow collection={item} onPress={() => openCollection(item)} />}
        ListEmptyComponent={
          collectionsQuery.isLoading ? (
            <View className="items-center justify-center py-16"><LoadingSpinner /></View>
          ) : (
            <Surface variant="secondary" className="rounded-panel p-4">
              <EmptyState
                icon={collectionsQuery.error ? 'warning-outline' : 'folder-open-outline'}
                title={collectionsQuery.error ? t('collections.errorTitle') : t(publicScope ? 'collections.emptyPublicTitle' : 'collections.emptyMineTitle')}
                subtitle={collectionsQuery.error ?? t(publicScope ? 'collections.emptyPublicSubtitle' : 'collections.emptyMineSubtitle')}
                actionLabel={collectionsQuery.error ? t('common:buttons.retry') : undefined}
                onAction={collectionsQuery.error ? collectionsQuery.refresh : undefined}
              />
            </Surface>
          )
        }
      />
    </SafeAreaView>
  );
}

function CreateCollectionCard({
  isSubmitting,
  onSubmit,
}: {
  isSubmitting: boolean;
  onSubmit: (payload: { name: string; description: string; isPublic: boolean }) => void;
}) {
  const { t } = useTranslation('members');
  const theme = useTheme();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);

  return (
    <HeroCard variant="secondary" className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('collections.createTitle')}</Text>
        <Input label={t('collections.name')} value={name} onChangeText={setName} placeholder={t('collections.namePlaceholder')} />
        <Input label={t('collections.description')} value={description} onChangeText={setDescription} placeholder={t('collections.descriptionPlaceholder')} multiline />
        <Toggle value={isPublic} onValueChange={setIsPublic} label={t('collections.makePublic')} />
        <HeroButton variant="primary" onPress={() => onSubmit({ name, description, isPublic })} isDisabled={isSubmitting}>
          {isSubmitting ? <Spinner size="sm" /> : <AccentIcon name="add-outline" size={17} />}
          <HeroButton.Label>{t('collections.create')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function CollectionRow({ collection, onPress }: { collection: SavedCollection; onPress: () => void }) {
  const { t } = useTranslation('members');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const color = collection.color || primary;

  return (
    <HeroButton variant="ghost" feedbackVariant="scale" className="mb-3 w-full p-0" accessibilityLabel={collection.name} onPress={onPress}>
      <Surface variant="secondary" className="w-full rounded-panel px-4 py-4">
        <View className="flex-row items-start gap-3">
          <View className="size-11 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(color, 0.14) }}>
            <Ionicons name="folder-outline" size={22} color={color} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-start justify-between gap-2">
              <Text className="min-w-0 flex-1 text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>
                {collection.name}
              </Text>
              <Ionicons name="chevron-forward-outline" size={18} color={theme.textMuted} />
            </View>
            {collection.description ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {collection.description}
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Chip size="sm" variant="secondary"><Chip.Label>{t('collections.itemsCount', { count: collection.items_count })}</Chip.Label></Chip>
              <Chip size="sm" variant="secondary"><Chip.Label>{collection.is_public ? t('collections.public') : t('collections.private')}</Chip.Label></Chip>
            </View>
          </View>
        </View>
      </Surface>
    </HeroButton>
  );
}

function SavedItemRow({ item, canRemove, onRemove }: { item: SavedItem; canRemove: boolean; onRemove: () => void }) {
  const { t } = useTranslation('members');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const title = item.preview?.title || t('collections.fallbackItemTitle', { type: item.item_type, id: item.item_id });

  const openItem = useCallback(() => {
    const target = getSavedItemTarget(item);
    if (target) router.push(target as unknown as Href);
  }, [item]);

  return (
    <Surface variant="secondary" className="mb-3 rounded-panel px-4 py-4">
      <View className="flex-row items-start gap-3">
        <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
          <Ionicons name={getItemIcon(item.item_type)} size={20} color={primary} />
        </View>
        <View className="min-w-0 flex-1 gap-2">
          <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>{title}</Text>
          <Text className="text-xs" style={{ color: theme.textSecondary }}>
            {t('collections.savedMeta', { type: item.item_type, date: formatDate(item.saved_at) })}
          </Text>
          {item.note ? (
            <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={3}>{item.note}</Text>
          ) : null}
          <View className="flex-row flex-wrap gap-2">
            <HeroButton size="sm" variant="secondary" onPress={openItem}>
              <Ionicons name="open-outline" size={15} color={primary} />
              <HeroButton.Label>{t('collections.openItem')}</HeroButton.Label>
            </HeroButton>
            {canRemove ? (
              <HeroButton size="sm" variant="danger-soft" onPress={onRemove}>
                <Ionicons name="trash-outline" size={15} color={theme.error} />
                <HeroButton.Label>{t('collections.removeItem')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        </View>
      </View>
    </Surface>
  );
}

function getItemIcon(type: string): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'listing':
      return 'swap-horizontal-outline';
    case 'event':
      return 'calendar-outline';
    case 'group':
      return 'people-outline';
    case 'marketplace_listing':
      return 'storefront-outline';
    case 'job':
      return 'briefcase-outline';
    case 'resource':
    case 'article':
      return 'document-text-outline';
    default:
      return 'bookmark-outline';
  }
}

function getSavedItemTarget(item: SavedItem): Href | null {
  switch (item.item_type) {
    case 'listing':
      return { pathname: '/(modals)/exchange-detail', params: { id: String(item.item_id) } } as unknown as Href;
    case 'event':
      return { pathname: '/(modals)/event-detail', params: { id: String(item.item_id) } } as unknown as Href;
    case 'group':
      return { pathname: '/(modals)/group-detail', params: { id: String(item.item_id) } } as unknown as Href;
    case 'article':
      return { pathname: '/(modals)/blog-post', params: { id: String(item.item_id) } } as unknown as Href;
    case 'marketplace_listing':
      return { pathname: '/(modals)/marketplace-detail', params: { id: String(item.item_id) } } as unknown as Href;
    case 'job':
      return { pathname: '/(modals)/job-detail', params: { id: String(item.item_id) } } as unknown as Href;
    case 'resource':
      return { pathname: '/(modals)/resources', params: { item: String(item.item_id) } } as unknown as Href;
    case 'post':
      return { pathname: '/(modals)/feed-item-detail', params: { id: String(item.item_id), type: 'post' } } as unknown as Href;
    default:
      return null;
  }
}
