// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * EntityMapView — full-page map view for browse pages.
 * Generic component that renders any entity type as map markers.
 */

import { Suspense, lazy, type ReactNode, useMemo } from 'react';
import MapPin from 'lucide-react/icons/map-pin';
import MapPinOff from 'lucide-react/icons/map-pin-off';
import { useTranslation } from 'react-i18next';
import type { MapMarker } from './LocationMap';
import { Skeleton } from '@/components/ui/Skeleton';
import { MAPS_ENABLED } from '@/lib/map-config';
import { useTenant } from '@/contexts/TenantContext';

const LazyLocationMap = lazy(() =>
  import('./LocationMap').then((module) => ({
    default: module.LocationMap,
  }))
);

export interface EntityMapViewProps<T> {
  items: T[];
  getCoordinates: (item: T) => { lat: number; lng: number } | null;
  getMarkerConfig: (item: T) => { id: number | string; title: string; pinColor?: string; pinGlyph?: string; pinKind?: string };
  renderInfoContent: (item: T) => ReactNode;
  height?: string;
  center?: { lat: number; lng: number };
  className?: string;
  isLoading?: boolean;
  emptyMessage?: string;
  /** Called when Google Maps fails to load (auth/billing error). */
  onMapsFailed?: () => void;
}

export function EntityMapView<T>({
  items,
  getCoordinates,
  getMarkerConfig,
  renderInfoContent,
  height = '600px',
  center,
  className = '',
  isLoading = false,
  emptyMessage = 'No items with location data',
  onMapsFailed,
}: EntityMapViewProps<T>) {
  const { t } = useTranslation('common');
  const { hasFeature } = useTenant();
  const mapDisplayEnabled = MAPS_ENABLED && hasFeature('maps');
  const markers: MapMarker[] = useMemo(() => {
    const result: MapMarker[] = [];
    for (const item of items) {
      const coords = getCoordinates(item);
      if (!coords) continue;
      const config = getMarkerConfig(item);
      result.push({
        id: config.id,
        lat: coords.lat,
        lng: coords.lng,
        title: config.title,
        pinColor: config.pinColor,
        pinGlyph: config.pinGlyph,
        pinKind: config.pinKind,
        infoContent: renderInfoContent(item),
      });
    }
    return result;
  }, [items, getCoordinates, getMarkerConfig, renderInfoContent]);

  if (!mapDisplayEnabled) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-16 ${className}`}>
        <MapPinOff className="w-12 h-12 text-theme-subtle" />
        <p className="text-theme-muted text-sm">{t('map_unavailable')}</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <Skeleton
        role="status"
        aria-busy="true"
        aria-label={t('common:loading')}
        className={`rounded-xl ${className}`}
        style={{ height }}
      />
    );
  }

  if (markers.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center gap-3 py-16 ${className}`}>
        <MapPin className="w-12 h-12 text-theme-subtle" />
        <p className="text-theme-muted text-sm">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <Skeleton
          role="status"
          aria-busy="true"
          aria-label={t('common:loading')}
          className={`rounded-xl ${className}`}
          style={{ height }}
        />
      }
    >
      <LazyLocationMap
        markers={markers}
        center={center}
        height={height}
        className={className}
        fitBounds
        onMapsFailed={onMapsFailed}
      />
    </Suspense>
  );
}
