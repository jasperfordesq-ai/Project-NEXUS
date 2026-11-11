// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * OpenStreetMapView — direct Leaflet implementation matching LocationMapProps.
 *
 * Renders an interactive Leaflet map with OSM tiles, custom SVG pins, popups,
 * optional fitBounds, and marker clustering. Used as the OSM branch of
 * LocationMap when the tenant has selected `map_provider = openstreetmap`.
 *
 * Tile provider: standard OSM tiles. Subject to the OSM Foundation tile
 * usage policy (https://operations.osmfoundation.org/policies/tiles/).
 * For high-traffic deployments, switch the TileLayer URL to a paid host
 * (MapTiler, Stadia Maps) in this file.
 *
 * Dark mode (warmth plan C3): the raster tiles have no dark style, so in the
 * site's dark theme (the `.dark` class on the page) the tile layer alone is inverted and hue-rotated with a
 * CSS filter — water stays blue-ish, land goes dark. Pins, clusters, popups
 * and the attribution are not filtered. Works for every tile host the server
 * may pick (OSM, MapTiler, Ordnance Survey).
 *
 * Pins and clusters wear the site's colours: each pin its kind's colour and
 * picture (`pinStyleFor`), clusters the community's button colour with its
 * companion colour as a ring.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LocationMapProps } from './LocationMap';
import { fetchMapsRuntimeConfig } from './GoogleMapsProvider';
import type { LucideIcon } from 'lucide-react';
import { pinStyleFor, resolveCssColour } from '@/lib/map-styles';

const DEFAULT_CENTER: [number, number] = [20, 0];
const DEFAULT_ZOOM = 12;
const CLUSTER_AUTO_THRESHOLD = 10;

/** Fallback tile URL — used while runtime config loads or if it fails. */
const FALLBACK_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const FALLBACK_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';

/**
 * Build a DivIcon containing an inline SVG pin. SVG path data renders
 * identically across Chrome / Firefox / Safari, unlike CSS clip-path which
 * has subpixel rounding differences. Using DivIcon also avoids the
 * well-known leaflet image-asset path problem in bundlers like Vite.
 *
 * `color` must be a plain colour: SVG attributes cannot read a CSS token, so
 * callers resolve `var(--…)` first (`resolveCssColour`). A two-letter glyph,
 * when given, replaces the kind's picture.
 */
function buildPinIcon(color: string, Icon: LucideIcon, glyph?: string): L.DivIcon {
  const safeGlyph = (glyph ?? '').replace(/[<>&"]/g, '').slice(0, 2);
  const svg = renderToStaticMarkup(
    <svg
      width="30"
      height="40"
      viewBox="0 0 30 40"
      xmlns="http://www.w3.org/2000/svg"
      role="presentation"
    >
      <path
        d="M15 0C6.72 0 0 6.72 0 15c0 10.2 15 25 15 25s15-14.8 15-25C30 6.72 23.28 0 15 0z"
        fill={color}
        stroke="rgba(0,0,0,0.2)"
        strokeWidth="1"
      />
      <circle cx="15" cy="15" r="9" fill="white" />
      {safeGlyph ? (
        <text
          x="15"
          y="19"
          textAnchor="middle"
          fontSize="10"
          fontFamily="system-ui, sans-serif"
          fontWeight="700"
          fill={color}
        >
          {safeGlyph}
        </text>
      ) : (
        <Icon x={9} y={9} width={12} height={12} strokeWidth={2.5} color={color} aria-hidden="true" />
      )}
    </svg>
  );
  return L.divIcon({
    className: 'nexus-osm-pin-wrapper',
    html: svg,
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -34],
  });
}

/** A cluster bubble in the community colour, sized by how many it holds. */
function buildClusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount();
  const size = count < 10 ? 34 : count < 100 ? 40 : 46;
  return L.divIcon({
    className: 'nexus-osm-cluster',
    html: `<span>${count}</span>`,
    iconSize: [size, size],
  });
}

export function OpenStreetMapView({
  markers,
  center,
  zoom = DEFAULT_ZOOM,
  height = '400px',
  className = '',
  onMarkerClick,
  fitBounds = false,
  cluster,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const markerLayerRef = useRef<L.MarkerClusterGroup | L.LayerGroup | null>(null);
  const lastBoundsSignatureRef = useRef('');
  const [mapReady, setMapReady] = useState(false);

  // Runtime tile URL — chosen by the server. If the tenant has set a
  // MapTiler key, the URL embeds it and we render production-grade tiles
  // with proper attribution. Otherwise we fall back to free OSM tiles.
  const [tileUrl, setTileUrl] = useState<string>(FALLBACK_TILE_URL);
  const [tileAttribution, setTileAttribution] = useState<string>(FALLBACK_TILE_ATTRIBUTION);

  useEffect(() => {
    let mounted = true;
    fetchMapsRuntimeConfig()
      .then((cfg) => {
        if (!mounted) return;
        if (cfg.osmTileUrl) setTileUrl(cfg.osmTileUrl);
        if (cfg.osmTileAttribution) setTileAttribution(cfg.osmTileAttribution);
      })
      .catch(() => {
        // Silent — fallback URL is already set in initial state.
      });
    return () => {
      mounted = false;
    };
  }, []);

  const initialCenter = useMemo<[number, number]>(() => {
    if (center) return [center.lat, center.lng];
    if (markers.length > 0 && markers[0]) return [markers[0].lat, markers[0].lng];
    return DEFAULT_CENTER;
  }, [center, markers]);

  // Leaflet owns the contents of this element. Keeping map creation separate
  // from tile and marker updates avoids tearing down the map when runtime
  // configuration or marker data changes.
  const initialCenterRef = useRef(initialCenter);
  const initialZoomRef = useRef(zoom);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = L.map(container, {
      center: initialCenterRef.current,
      zoom: initialZoomRef.current,
      scrollWheelZoom: true,
    });
    mapRef.current = map;
    setMapReady(true);

    return () => {
      mapRef.current = null;
      tileLayerRef.current = null;
      markerLayerRef.current = null;
      map.remove();
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    tileLayerRef.current?.removeFrom(map);
    const tileLayer = L.tileLayer(tileUrl, {
      attribution: tileAttribution,
      maxZoom: 19,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    return () => {
      // The map-owning effect may already have removed the Leaflet instance
      // during unmount. Dependency updates still remove the current layer.
      if (mapRef.current === map) tileLayer.removeFrom(map);
      if (tileLayerRef.current === tileLayer) tileLayerRef.current = null;
    };
  }, [mapReady, tileAttribution, tileUrl]);

  const useCluster = cluster ?? markers.length > CLUSTER_AUTO_THRESHOLD;
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    const layer = useCluster
      ? L.markerClusterGroup({ chunkedLoading: true, showCoverageOnHover: false, iconCreateFunction: buildClusterIcon })
      : L.layerGroup();

    for (const marker of markers) {
      const leafletMarker = L.marker([marker.lat, marker.lng], {
        icon: (() => {
          const style = pinStyleFor(marker.pinKind);
          return buildPinIcon(resolveCssColour(marker.pinColor ?? style.colour), style.icon, marker.pinGlyph);
        })(),
        title: marker.title,
      });
      const popupHtml = marker.title.replace(/[<>&"]/g, (character) =>
        ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[character] ?? character
      );
      leafletMarker.bindPopup(`<div style="font-weight:600">${popupHtml}</div>`);
      if (onMarkerClick) leafletMarker.on('click', () => onMarkerClick(marker));
      leafletMarker.addTo(layer);
    }

    layer.addTo(map);
    markerLayerRef.current = layer;

    return () => {
      if (mapRef.current === map) layer.removeFrom(map);
      if (markerLayerRef.current === layer) markerLayerRef.current = null;
    };
  }, [mapReady, markers, onMarkerClick, useCluster]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !fitBounds || markers.length === 0) return;

    const signature = markers.map((marker) => `${marker.id}:${marker.lat},${marker.lng}`).join('|');
    if (signature === lastBoundsSignatureRef.current) return;
    lastBoundsSignatureRef.current = signature;

    if (markers.length === 1) {
      const only = markers[0]!;
      map.setView([only.lat, only.lng], Math.max(map.getZoom(), 14), { animate: true });
      return;
    }

    const bounds = L.latLngBounds(markers.map((marker) => [marker.lat, marker.lng]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16, animate: true });
  }, [fitBounds, mapReady, markers]);

  return (
    <div
      className={`nexus-osm-map-wrapper rounded-xl overflow-hidden ${className}`}
      style={{ height }}
    >
      <style>{`
        .nexus-osm-pin-wrapper { background: transparent !important; border: 0 !important; }
        .nexus-osm-map-wrapper .leaflet-container {
          width: 100%; height: 100%;
          background: var(--color-surface, #f5f5f5);
        }
        .nexus-osm-map-wrapper .leaflet-popup-content-wrapper { border-radius: 12px; }
        .dark .nexus-osm-map-wrapper .leaflet-tile-pane {
          filter: invert(1) hue-rotate(180deg) brightness(0.95) contrast(0.9) saturate(0.6);
        }
        .dark .nexus-osm-map-wrapper .leaflet-container { background: #1b1b1f; }
        .nexus-osm-cluster {
          display: flex; align-items: center; justify-content: center;
          border-radius: 9999px; font: 700 12px/1 system-ui, sans-serif;
          background: var(--accent-strong); color: var(--accent-foreground, #fff);
          box-shadow: 0 0 0 3px var(--companion), 0 2px 6px rgba(0,0,0,0.3);
        }
      `}</style>
      <div ref={containerRef} data-testid="map-container" className="h-full w-full" />
    </div>
  );
}
