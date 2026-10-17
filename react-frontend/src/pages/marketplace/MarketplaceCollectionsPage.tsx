// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceCollectionsPage — User's marketplace collections/wishlists.
 *
 * Features:
 * - List of collections with name, item count, public/private badge
 * - Create collection modal
 * - Click collection to view items grid with remove per item
 * - Saved searches section with alert management
 */

import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import FolderHeart from 'lucide-react/icons/folder-heart';
import Plus from 'lucide-react/icons/plus';
import Search from 'lucide-react/icons/search';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Trash2 from 'lucide-react/icons/trash-2';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Package from 'lucide-react/icons/package';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { Textarea } from '@/components/ui/Textarea';
import { EmptyState } from '@/components/feedback';
import { CollectionCard, SavedSearchCard } from '@/components/marketplace';
import type {
  MarketplaceCollection,
  MarketplaceCollectionItem,
  MarketplaceSavedSearch,
} from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { formatMarketplaceCurrency } from '@/lib/marketplaceNumbers';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';

export function MarketplaceCollectionsPage() {
  const { t } = useTranslation('marketplace');
  usePageTitle(t('collections.page_title'));
  const { isAuthenticated } = useAuth();
  const { tenant, tenantPath, hasFeature } = useTenant();
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const featureEnabled = hasFeature('marketplace');

  // State — tabs
  const [activeTab, setActiveTab] = useState<string>(
    searchParams.get('tab') === 'searches' ? 'searches' : 'collections',
  );

  // State — collections
  const [collections, setCollections] = useState<MarketplaceCollection[]>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newIsPublic, setNewIsPublic] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // State — collection detail view
  const [selectedCollection, setSelectedCollection] = useState<MarketplaceCollection | null>(null);
  const [collectionItems, setCollectionItems] = useState<MarketplaceCollectionItem[]>([]);
  const [isLoadingItems, setIsLoadingItems] = useState(false);

  // State — saved searches
  const [savedSearches, setSavedSearches] = useState<MarketplaceSavedSearch[]>([]);
  const [isLoadingSearches, setIsLoadingSearches] = useState(true);

  // ─── Load collections ──────────────────────────────────────────────
  const loadCollections = useCallback(async () => {
    setIsLoadingCollections(true);
    try {
      const res = await api.get<MarketplaceCollection[]>('/v2/marketplace/collections');
      if (res.success && res.data) {
        setCollections(res.data);
      } else {
        toast.error(res.error || t('collections.load_error'));
      }
    } catch (err) {
      logError('Failed to load collections', err);
      toast.error(t('collections.load_error'));
    } finally {
      setIsLoadingCollections(false);
    }
  }, [toast, t]);

  // ─── Load saved searches ───────────────────────────────────────────
  const loadSavedSearches = useCallback(async () => {
    setIsLoadingSearches(true);
    try {
      const res = await api.get<MarketplaceSavedSearch[]>('/v2/marketplace/saved-searches');
      if (res.success && res.data) {
        setSavedSearches(res.data);
      } else {
        toast.error(res.error || t('collections.load_error'));
      }
    } catch (err) {
      logError('Failed to load saved searches', err);
    } finally {
      setIsLoadingSearches(false);
    }
  }, [t, toast]);

  useEffect(() => {
    if (!featureEnabled || !isAuthenticated) return;
    loadCollections();
    loadSavedSearches();
  }, [featureEnabled, isAuthenticated, loadCollections, loadSavedSearches]);

  // ─── Create collection ─────────────────────────────────────────────
  const handleCreateCollection = async () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      const res = await api.post<MarketplaceCollection>('/v2/marketplace/collections', {
        name: newName.trim(),
        description: newDescription.trim() || null,
        is_public: newIsPublic,
      });
      if (res.success && res.data) {
        setCollections((prev) => [res.data!, ...prev]);
        setShowCreateModal(false);
        setNewName('');
        setNewDescription('');
        setNewIsPublic(false);
        toast.success(t('collections.created'));
      } else {
        toast.error(res.error || t('collections.create_error'));
      }
    } catch (err) {
      logError('Failed to create collection', err);
      toast.error(t('collections.create_error'));
    } finally {
      setIsCreating(false);
    }
  };

  // ─── View collection items ─────────────────────────────────────────
  const handleViewCollection = async (collection: MarketplaceCollection) => {
    setSelectedCollection(collection);
    setIsLoadingItems(true);
    try {
      const res = await api.get<MarketplaceCollectionItem[]>(
        `/v2/marketplace/collections/${collection.id}/items?limit=50`,
      );
      if (res.success && res.data) {
        setCollectionItems(res.data);
      } else {
        toast.error(res.error || t('collections.items_load_error'));
      }
    } catch (err) {
      logError('Failed to load collection items', err);
      toast.error(t('collections.items_load_error'));
    } finally {
      setIsLoadingItems(false);
    }
  };

  // ─── Remove item from collection ──────────────────────────────────
  const handleRemoveItem = async (listingId: number) => {
    if (!selectedCollection) return;
    try {
      const res = await api.delete(
        `/v2/marketplace/collections/${selectedCollection.id}/items/${listingId}`,
      );
      if (!res.success) {
        toast.error(res.error || t('collections.remove_item_error'));
        return;
      }
      setCollectionItems((prev) =>
        prev.filter((item) => item.listing.id !== listingId),
      );
      // Update count
      setSelectedCollection((prev) =>
        prev ? { ...prev, item_count: Math.max(0, prev.item_count - 1) } : null,
      );
      setCollections((prev) =>
        prev.map((c) =>
          c.id === selectedCollection.id
            ? { ...c, item_count: Math.max(0, c.item_count - 1) }
            : c,
        ),
      );
    } catch (err) {
      logError('Failed to remove item', err);
      toast.error(t('collections.remove_item_error'));
    }
  };

  // ─── Saved search actions ──────────────────────────────────────────
  const handleDeleteSearch = async (id: number) => {
    try {
      const res = await api.delete(`/v2/marketplace/saved-searches/${id}`);
      if (!res.success) {
        toast.error(res.error || t('saved_searches.delete_error'));
        return;
      }
      setSavedSearches((prev) => prev.filter((s) => s.id !== id));
      toast.success(t('saved_searches.deleted'));
    } catch (err) {
      logError('Failed to delete saved search', err);
      toast.error(t('saved_searches.delete_error'));
    }
  };

  const handleRunSearch = (search: MarketplaceSavedSearch) => {
    const params = new URLSearchParams();
    if (search.search_query) params.set('q', search.search_query);
    if (search.filters?.category_id) params.set('category_id', String(search.filters.category_id));
    navigate(tenantPath(`/marketplace/search?${params.toString()}`));
  };

  // ─── Feature gate ──────────────────────────────────────────────────
  if (!featureEnabled) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8" />}
          title={t('hub_feature_gate.title')}
          description={t('hub_feature_gate.description')}
        />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <EmptyState
          icon={<FolderHeart className="w-8 h-8" />}
          title={t('collections.sign_in_title')}
          description={t('collections.sign_in_description')}
        />
      </div>
    );
  }

  // ─── Collection detail view ────────────────────────────────────────
  if (selectedCollection) {
    return (
      <>
        <PageMeta title={selectedCollection.name} noIndex={true} />
        <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
          <div className="flex items-start gap-3">
            <Button
              isIconOnly
              variant="tertiary"
              aria-label={t('common.go_back')}
              onPress={() => {
                setSelectedCollection(null);
                setCollectionItems([]);
              }}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-foreground">{selectedCollection.name}</h1>
              {selectedCollection.description && (
                <p className="text-sm text-muted mt-1">{selectedCollection.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <Chip size="sm" variant="soft">
                  {t('collections.item_count', { count: selectedCollection.item_count })}
                </Chip>
                <Chip
                  size="sm"
                  variant="soft"
                  color={selectedCollection.is_public ? 'success' : 'default'}
                >
                  {selectedCollection.is_public
                    ? t('collections.public')
                    : t('collections.private')}
                </Chip>
              </div>
            </div>
          </div>

          {isLoadingItems ? (
            <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
              <Spinner size="lg" color="accent" />
            </div>
          ) : collectionItems.length === 0 ? (
            <EmptyState
              icon={<Package className="w-8 h-8" />}
              title={t('collections.empty_title')}
              description={t('collections.empty_description')}
              action={{
                label: t('collections.browse_marketplace'),
                onClick: () => navigate(tenantPath('/marketplace')),
              }}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {collectionItems.map((item) => (
                <GlassCard key={item.collection_item_id} className="overflow-hidden">
                  <Link to={tenantPath(`/marketplace/${item.listing.id}`)}>
                    <div className="aspect-square bg-surface-secondary overflow-hidden">
                      {item.listing.image ? (
                        <img
                          src={resolveThumbnailUrl(item.listing.image.thumbnail_url || item.listing.image.url, { width: 360, height: 360 })}
                          alt={item.listing.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-10 h-10 text-muted" />
                        </div>
                      )}
                    </div>
                  </Link>
                  <div className="p-3">
                    <Link
                      to={tenantPath(`/marketplace/${item.listing.id}`)}
                      className="font-medium text-foreground text-sm hover:text-accent transition-colors line-clamp-2"
                    >
                      {item.listing.title}
                    </Link>
                    <p className="text-sm font-semibold text-accent mt-1">
                      {item.listing.price_type === 'lend'
                        ? t('price.lend')
                        : item.listing.price_type === 'free'
                        ? t('common.free')
                        : item.listing.price != null
                          ? formatMarketplaceCurrency(
                            Number(item.listing.price),
                            item.listing.price_currency || tenant?.currency || '',
                          )
                          : ''}
                    </p>
                    {item.note && (
                      <p className="text-xs text-muted mt-1 italic line-clamp-2">{item.note}</p>
                    )}
                    <Button
                      size="sm"
                      variant="danger-soft"

                      className="mt-2 w-full"
                      startContent={<Trash2 className="w-3.5 h-3.5" />}
                      onPress={() => handleRemoveItem(item.listing.id)}
                    >
                      {t('collections.remove_item')}
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          )}
        </div>
      </>
    );
  }

  // ─── Main view ─────────────────────────────────────────────────────
  return (
    <>
      <PageMeta
        title={t('collections.page_title')}
        description={t('collections.meta_description')}
        noIndex={true}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <FolderHeart className="w-7 h-7 text-accent" />
              {t('collections.page_title')}
            </h1>
            <p className="text-muted text-sm mt-1">
              {t('collections.subtitle')}
            </p>
          </div>
          <Button

            startContent={<Plus className="w-4 h-4" />}
            onPress={() => setShowCreateModal(true)}
          >
            {t('collections.create')}
          </Button>
        </div>

        {/* Tabs */}
        <Tabs
          aria-label={t('collections_tabs_aria')}
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as string)}
          variant="secondary"

        >
          <Tab
            key="collections"
            title={
              <div className="flex items-center gap-2">
                <FolderHeart className="w-4 h-4" />
                {t('collections.tab_collections')}
                {collections.length > 0 && (
                  <Chip size="sm" variant="soft">{collections.length}</Chip>
                )}
              </div>
            }
          >
            {isLoadingCollections ? (
              <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
                <Spinner size="lg" color="accent" />
              </div>
            ) : collections.length === 0 ? (
              <EmptyState
                icon={<FolderHeart className="w-8 h-8" />}
                title={t('collections.empty_collections_title')}
                description={t('collections.empty_collections_description')}
                action={{
                  label: t('collections.create'),
                  onClick: () => setShowCreateModal(true),
                }}
              />
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
                {collections.map((collection) => (
                  <CollectionCard
                    key={collection.id}
                    collection={collection}
                    onClick={handleViewCollection}
                  />
                ))}
              </div>
            )}
          </Tab>

          <Tab
            key="searches"
            title={
              <div className="flex items-center gap-2">
                <Search className="w-4 h-4" />
                {t('saved_searches.tab_title')}
                {savedSearches.length > 0 && (
                  <Chip size="sm" variant="soft">{savedSearches.length}</Chip>
                )}
              </div>
            }
          >
            {isLoadingSearches ? (
              <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
                <Spinner size="lg" color="accent" />
              </div>
            ) : savedSearches.length === 0 ? (
              <EmptyState
                icon={<Search className="w-8 h-8" />}
                title={t('saved_searches.empty_title')}
                description={t('saved_searches.empty_description')}
                action={{
                  label: t('saved_searches.browse'),
                  onClick: () => navigate(tenantPath('/marketplace/search')),
                }}
              />
            ) : (
              <div className="space-y-3 mt-4">
                {savedSearches.map((search) => (
                  <SavedSearchCard
                    key={search.id}
                    search={search}
                    onDelete={handleDeleteSearch}
                    onRun={handleRunSearch}
                  />
                ))}
              </div>
            )}
          </Tab>
        </Tabs>
      </div>

      {/* Create Collection Modal */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)}>
        <ModalContent>
          <ModalHeader>{t('collections.create_title')}</ModalHeader>
          <ModalBody>
            <Input
              label={t('collections.name_label')}
              placeholder={t('collections.name_placeholder')}
              value={newName}
              onValueChange={setNewName}
              maxLength={100}
              isRequired
              variant="secondary"
            />
            <Textarea
              label={t('collections.description_label')}
              placeholder={t('collections.description_placeholder')}
              value={newDescription}
              onValueChange={setNewDescription}
              maxLength={500}
              variant="secondary"
            />
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-foreground">
                {t('collections.make_public')}
              </span>
              <Switch
                isSelected={newIsPublic}
                onValueChange={setNewIsPublic}
                size="sm"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={() => setShowCreateModal(false)}>
              {t('common.cancel')}
            </Button>
            <Button

              isDisabled={!newName.trim()}
              isLoading={isCreating}
              onPress={handleCreateCollection}
            >
              {t('collections.create')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default MarketplaceCollectionsPage;
