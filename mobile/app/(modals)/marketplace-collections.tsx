// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, CloseButton, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  createMarketplaceCollection,
  deleteMarketplaceSavedSearch,
  getMarketplaceCollectionItems,
  getMarketplaceCollections,
  getMarketplaceSavedSearches,
  removeMarketplaceCollectionItem,
  type MarketplaceCollection,
  type MarketplaceCollectionItem,
  type MarketplaceSavedSearch,
} from '@/lib/api/marketplace';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

type TabKey = 'collections' | 'saved';

function routeTab(value: string | string[] | undefined): TabKey {
  return value === 'saved' || value === 'searches' ? 'saved' : 'collections';
}

export default function MarketplaceCollectionsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceCollectionsScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceCollectionsScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const { hasFeature } = useTenant();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const params = useLocalSearchParams<{ tab?: string }>();
  const currentRouteTab = routeTab(params.tab);
  const [tab, setTab] = useState<TabKey>(currentRouteTab);
  const [collections, setCollections] = useState<MarketplaceCollection[]>([]);
  const [savedSearches, setSavedSearches] = useState<MarketplaceSavedSearch[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<MarketplaceCollection | null>(null);
  const [items, setItems] = useState<MarketplaceCollectionItem[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingItems, setIsLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hasFeature('marketplace') || !isAuthenticated) return;
    setIsLoading(true);
    setError(null);
    try {
      const [collectionResponse, savedResponse] = await Promise.all([
        getMarketplaceCollections(),
        getMarketplaceSavedSearches(),
      ]);
      setCollections(collectionResponse.data);
      setSavedSearches(savedResponse.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('collections.unableToLoad'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [hasFeature, isAuthenticated, t]);

  useEffect(() => {
    if (!isAuthLoading) void load();
  }, [isAuthLoading, load]);

  useEffect(() => {
    if (params.tab !== undefined) {
      setTab(currentRouteTab);
    }
  }, [currentRouteTab, params.tab]);

  function openManageTools(targetTab: TabKey = tab) {
    router.push({
      pathname: '/(modals)/marketplace-tools',
      params: { tab: targetTab === 'saved' ? 'savedSearches' : 'collections' },
    } as unknown as Href);
  }

  async function openCollection(collection: MarketplaceCollection) {
    setSelectedCollection(collection);
    setIsLoadingItems(true);
    setItems([]);
    try {
      const response = await getMarketplaceCollectionItems(collection.id, null, 50);
      setItems(response.data);
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('collections.itemsLoadFailed'),
        variant: 'danger',
      });
    } finally {
      setIsLoadingItems(false);
    }
  }

  async function removeItem(item: MarketplaceCollectionItem) {
    if (!selectedCollection) return;
    try {
      await removeMarketplaceCollectionItem(selectedCollection.id, item.listing.id);
      setItems((current) => current.filter((entry) => entry.listing.id !== item.listing.id));
      setCollections((current) => current.map((collection) => collection.id === selectedCollection.id
        ? { ...collection, item_count: Math.max(0, collection.item_count - 1) }
        : collection));
      setSelectedCollection((current) => current ? { ...current, item_count: Math.max(0, current.item_count - 1) } : current);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('collections.removeItemFailed'), variant: 'danger' });
    }
  }

  function deleteSavedSearch(search: MarketplaceSavedSearch) {
    confirm({
      title: t('savedSearches.deleteTitle'),
      message: t('savedSearches.deleteMessage', { name: search.name }),
      confirmLabel: t('tools.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteMarketplaceSavedSearch(search.id);
          setSavedSearches((current) => current.filter((entry) => entry.id !== search.id));
        } catch {
          showToast({ title: t('common:errors.alertTitle'), description: t('savedSearches.deleteFailed'), variant: 'danger' });
        }
      },
    });
  }

  async function createCollection() {
    const name = newName.trim();
    if (!name) {
      showToast({ title: t('common:errors.alertTitle'), description: t('collections.nameRequired'), variant: 'warning' });
      return;
    }
    setIsCreating(true);
    try {
      const response = await createMarketplaceCollection({
        name,
        description: newDescription.trim() || null,
        is_public: newIsPublic,
      });
      setCollections((current) => [response.data, ...current]);
      setNewName('');
      setNewDescription('');
      setNewIsPublic(false);
      setIsCreateOpen(false);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('collections.createFailed'), variant: 'danger' });
    } finally {
      setIsCreating(false);
    }
  }

  function runSavedSearch(search: MarketplaceSavedSearch) {
    const params: Record<string, string> = {};
    if (search.search_query) params.q = search.search_query;
    if (search.filters) {
      Object.entries(search.filters).forEach(([key, value]) => {
        if (value !== null && value !== undefined && value !== '') {
          params[key] = Array.isArray(value) ? value.join(',') : String(value);
        }
      });
    }
    router.push({ pathname: '/(modals)/marketplace-search', params } as unknown as Href);
  }

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('collections.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="folder-open-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
      </SafeAreaView>
    );
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('collections.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="py-16"><LoadingSpinner /></View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('collections.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState
          icon="folder-open-outline"
          title={t('collections.signInTitle')}
          subtitle={t('collections.signInHint')}
          actionLabel={t('auth:login.submit')}
          onAction={() => router.push('/(auth)/login' as Href)}
        />
      </SafeAreaView>
    );
  }

  if (selectedCollection) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={selectedCollection.name} backLabel={t('common:back')} onBack={() => setSelectedCollection(null)} fallbackHref={'/(modals)/marketplace-collections' as Href} />
        <FlatList
          data={items}
          keyExtractor={(item) => `${selectedCollection.id}-${item.listing.id}`}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
          ListHeaderComponent={
            <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{selectedCollection.name}</Text>
                {selectedCollection.description ? (
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{selectedCollection.description}</Text>
                ) : null}
                <View className="flex-row flex-wrap gap-2">
                  <Chip size="sm" variant="secondary"><Chip.Label>{t('collections.count', { count: selectedCollection.item_count })}</Chip.Label></Chip>
                  <Chip size="sm" variant="secondary"><Chip.Label>{selectedCollection.is_public ? t('collections.public') : t('collections.private')}</Chip.Label></Chip>
                </View>
              </HeroCard.Body>
            </HeroCard>
          }
          renderItem={({ item }) => (
            <View>
              <MarketplaceListingCard
                item={item.listing}
                onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.listing.id) } } as unknown as Href)}
              />
              <HeroButton className="-mt-2 mb-3" variant="secondary" onPress={() => void removeItem(item)}>
                <Ionicons name="trash-outline" size={16} color={theme.error} />
                <HeroButton.Label>{t('collections.removeItem')}</HeroButton.Label>
              </HeroButton>
            </View>
          )}
          ListEmptyComponent={isLoadingItems ? <View className="py-16"><LoadingSpinner /></View> : (
            <EmptyState icon="folder-open-outline" title={t('collections.emptyItems')} subtitle={t('collections.emptyItemsHint')} />
          )}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <AppTopBar title={t('collections.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />

      <FlatList
        data={tab === 'collections' ? collections : []}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { setIsRefreshing(true); void load(); }} />}
        ListHeaderComponent={
          <View>
            <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="folder-open-outline" size={25} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('collections.eyebrow')}</Text>
                    <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('collections.title')}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('collections.subtitle')}</Text>
                  </View>
                </View>
                <View className="flex-row gap-2">
                  <HeroButton className="flex-1" variant={tab === 'collections' ? 'primary' : 'secondary'} onPress={() => setTab('collections')}>
                    <HeroButton.Label>{t('collections.collectionsTab')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton className="flex-1" variant={tab === 'saved' ? 'primary' : 'secondary'} onPress={() => setTab('saved')}>
                    <HeroButton.Label>{t('collections.savedTab')}</HeroButton.Label>
                  </HeroButton>
                </View>
                <HeroButton variant="primary" onPress={() => setIsCreateOpen(true)}>
                  <Ionicons name="add-outline" size={16} color="#fff" />
                  <HeroButton.Label>{t('collections.create')}</HeroButton.Label>
                </HeroButton>
                <HeroButton variant="secondary" onPress={() => openManageTools()}>
                  <Ionicons name="construct-outline" size={16} color={primary} />
                  <HeroButton.Label>{t('collections.manage')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>

            {tab === 'saved' ? (
              <View className="gap-3">
                {savedSearches.map((search) => (
                  <SavedSearchRow key={search.id} search={search} onRun={() => runSavedSearch(search)} onDelete={() => deleteSavedSearch(search)} />
                ))}
                {!isLoading && savedSearches.length === 0 ? (
                  <EmptyState icon="search-outline" title={t('savedSearches.empty')} subtitle={t('savedSearches.emptyHint')} actionLabel={t('collections.manage')} onAction={() => openManageTools('saved')} />
                ) : null}
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => <CollectionRow collection={item} onPress={() => void openCollection(item)} />}
        ListEmptyComponent={
          isLoading ? (
            <View className="py-16"><LoadingSpinner /></View>
          ) : tab === 'collections' ? (
            <EmptyState
              icon="folder-open-outline"
              title={error ?? t('collections.empty')}
              subtitle={t('collections.emptyHint')}
              actionLabel={error ? t('common:buttons.retry') : t('collections.create')}
              onAction={error ? () => void load() : () => setIsCreateOpen(true)}
            />
          ) : null
        }
      />

      <CreateCollectionModal
        visible={isCreateOpen}
        name={newName}
        description={newDescription}
        isPublic={newIsPublic}
        isCreating={isCreating}
        onNameChange={setNewName}
        onDescriptionChange={setNewDescription}
        onPublicChange={setNewIsPublic}
        onClose={() => setIsCreateOpen(false)}
        onCreate={() => void createCollection()}
      />
      {confirmDialog}
    </SafeAreaView>
  );
}

function CollectionRow({ collection, onPress }: { collection: MarketplaceCollection; onPress: () => void }) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <HeroButton variant="ghost" feedbackVariant="scale" className="w-full p-0" accessibilityLabel={collection.name} onPress={onPress}>
      <HeroCard className="mb-3 rounded-panel p-0">
        <HeroCard.Body className="gap-2 p-4">
          <View className="flex-row items-center gap-3">
            <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="folder-outline" size={21} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{collection.name}</Text>
              {collection.description ? <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={2}>{collection.description}</Text> : null}
            </View>
            <Ionicons name="chevron-forward-outline" size={18} color={theme.textMuted} />
          </View>
          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="secondary"><Chip.Label>{t('collections.count', { count: collection.item_count })}</Chip.Label></Chip>
            <Chip size="sm" variant="secondary"><Chip.Label>{collection.is_public ? t('collections.public') : t('collections.private')}</Chip.Label></Chip>
          </View>
        </HeroCard.Body>
      </HeroCard>
    </HeroButton>
  );
}

function SavedSearchRow({
  search,
  onRun,
  onDelete,
}: {
  search: MarketplaceSavedSearch;
  onRun: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="search-outline" size={21} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{search.name}</Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{search.search_query || t('savedSearches.anything')}</Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <HeroButton className="flex-1" variant="primary" onPress={onRun}>
            <Ionicons name="play-outline" size={16} color="#fff" />
            <HeroButton.Label>{t('savedSearches.run')}</HeroButton.Label>
          </HeroButton>
          <HeroButton className="flex-1" variant="secondary" onPress={onDelete}>
            <Ionicons name="trash-outline" size={16} color={theme.error} />
            <HeroButton.Label>{t('tools.delete')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function CreateCollectionModal({
  visible,
  name,
  description,
  isPublic,
  isCreating,
  onNameChange,
  onDescriptionChange,
  onPublicChange,
  onClose,
  onCreate,
}: {
  visible: boolean;
  name: string;
  description: string;
  isPublic: boolean;
  isCreating: boolean;
  onNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onPublicChange: (value: boolean) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  const { t } = useTranslation(['marketplace', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose} snapPoints={['48%', '78%']}>
      <Surface variant="default" className="gap-4 rounded-panel p-4">
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('collections.createTitle')}</Text>
              <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('collections.createSubtitle')}</Text>
            </View>
            <CloseButton onPress={onClose} iconProps={{ size: 20, color: primary }} />
          </View>

          <FormInput label={t('collections.name')} value={name} onChangeText={onNameChange} placeholder={t('collections.namePlaceholder')} />
          <FormInput label={t('collections.description')} value={description} onChangeText={onDescriptionChange} placeholder={t('collections.descriptionPlaceholder')} multiline />

          <HeroButton variant={isPublic ? 'primary' : 'secondary'} onPress={() => onPublicChange(!isPublic)}>
            <Ionicons name={isPublic ? 'globe-outline' : 'lock-closed-outline'} size={16} color={isPublic ? '#fff' : primary} />
            <HeroButton.Label>{isPublic ? t('collections.public') : t('collections.private')}</HeroButton.Label>
          </HeroButton>

          <View className="flex-row gap-2">
            <HeroButton className="flex-1" variant="secondary" onPress={onClose}>
              <HeroButton.Label>{t('common:buttons.cancel')}</HeroButton.Label>
            </HeroButton>
            <HeroButton className="flex-1" variant="primary" onPress={onCreate} isDisabled={isCreating || !name.trim()}>
              <HeroButton.Label>{t('collections.create')}</HeroButton.Label>
            </HeroButton>
          </View>
      </Surface>
    </BottomSheet>
  );
}

function FormInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View>
      <Input
        label={label}
        style={{ color: theme.text, minHeight: multiline ? 92 : 48, textAlignVertical: multiline ? 'top' : 'center' }}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
      />
    </View>
  );
}
