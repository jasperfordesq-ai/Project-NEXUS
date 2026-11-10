// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Card, CardBody } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
/**
 * CollectionCard — Displays a marketplace collection with name, item count,
 * thumbnail grid (first 4 item images), and public/private badge.
 */


import FolderHeart from 'lucide-react/icons/folder-heart';
import Lock from 'lucide-react/icons/lock';
import Globe from 'lucide-react/icons/globe';
import Package from 'lucide-react/icons/package';
import { useTranslation } from 'react-i18next';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { colourForSeed } from '@/lib/categoryColours';
import type { MarketplaceCollection } from '@/types/marketplace';
import { coverSeed } from '@/lib/coverSeeds';

interface CollectionCardProps {
  collection: MarketplaceCollection;
  /** First 4 thumbnail URLs for the image grid preview */
  thumbnails?: string[];
  onClick?: (collection: MarketplaceCollection) => void;
}

export function CollectionCard({ collection, thumbnails = [], onClick }: CollectionCardProps) {
  const { t } = useTranslation('marketplace');
  const palette = useSitePalette();

  return (
    <Card
      isPressable={!!onClick}
      onPress={() => onClick?.(collection)}
      className="bg-background/60 border border-border hover:border-accent/40 transition-colors"
    >
      <CardBody className="p-0">
        {/* Thumbnail grid */}
        <div className="aspect-[4/3] bg-surface-secondary relative overflow-hidden rounded-t-lg">
          {thumbnails.length > 0 ? (
            <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-0.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="bg-surface-tertiary overflow-hidden">
                  {thumbnails[i] ? (
                    <img
                      src={resolveThumbnailUrl(thumbnails[i], { width: 320, height: 240 })}
                      alt={t('collection_image', { number: i + 1 })}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Package className="w-6 h-6 text-muted" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            // Empty: a cover in the collection's own colour (was a grey box).
            <div className="group h-full w-full">
              <ThemedCover data-testid="collection-card-cover" colour={colourForSeed(coverSeed.collection(collection.id), palette)} icon={FolderHeart} />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-foreground text-sm truncate">{collection.name}</h3>
            <Chip
              size="sm"
              variant="soft"
              color={collection.is_public ? 'success' : 'default'}
              startContent={collection.is_public
                ? <Globe className="w-3 h-3" />
                : <Lock className="w-3 h-3" />}
            >
              {collection.is_public
                ? t('collections.public')
                : t('collections.private')}
            </Chip>
          </div>

          {collection.description && (
            <p className="text-xs text-muted line-clamp-2">{collection.description}</p>
          )}

          <p className="text-xs text-muted">
            {t('collections.item_count', { count: collection.item_count })}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

export default CollectionCard;
