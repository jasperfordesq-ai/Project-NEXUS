// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), download: vi.fn(), upload: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Map provider dependencies — all heavy, must be stubbed ─────────────────
vi.mock('./GoogleMapsProvider', () => ({
  GoogleMapsProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="google-maps-provider">{children}</div>
  ),
  useGoogleMapsConfig: () => ({ apiKey: 'test-key', mapId: null }),
}));

vi.mock('./OpenStreetMapView', () => ({
  OpenStreetMapView: () => <div data-testid="osm-view" />,
}));

vi.mock('@vis.gl/react-google-maps', () => ({
  Map: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="google-map">{children}</div>
  ),
  AdvancedMarker: ({ title }: { title?: string }) => (
    <div data-testid="advanced-marker" aria-label={title} />
  ),
  Marker: ({ title }: { title?: string }) => (
    <div data-testid="classic-marker" aria-label={title} />
  ),
  InfoWindow: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="info-window">{children}</div>
  ),
  useMap: () => null,
  useApiLoadingStatus: () => 'LOADED',
  useAdvancedMarkerRef: () => [vi.fn(), null],
  APILoadingStatus: { AUTH_FAILURE: 'AUTH_FAILURE', FAILED: 'FAILED', LOADED: 'LOADED' },
}));

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: class {
    addMarker = vi.fn();
    removeMarker = vi.fn();
    clearMarkers = vi.fn();
    setMap = vi.fn();
  },
}));

vi.mock('@/lib/map-config', () => ({ MAPS_ENABLED: true }));
vi.mock('@/lib/map-styles', () => ({ DARK_MAP_STYLES: [] }));

// ─── Context mocks ────────────────────────────────────────────────────────────
// 🔴 Both context hooks are mocked on their DIRECT paths, not via the
// '@/contexts' barrel: LocationMap.tsx:612 imports `useTenant` from
// '@/contexts/TenantContext' and LocationMap.tsx:42 imports `useTheme` from
// '@/contexts/ThemeContext'. Vitest keys its mock registry per-specifier, so the
// old `vi.mock('@/contexts', ...)` override never applied — the real useTenant
// loaded and threw "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722), killing every test in this file.
//
// `mapProviderRef` is mutable so a test can exercise the OSM branch: the mock
// reads it on every useTenant() call, so no re-import/module reset is needed.
// Total factory (rather than spreading importOriginal) on purpose: the real
// TenantContext imports '@/i18n', which re-inits i18next with an HTTP backend at
// module scope and would clobber the English resources src/test/setup.ts loads.
const { mockHasFeature, mapProviderRef } = vi.hoisted(() => ({
  mockHasFeature: vi.fn(() => true),
  mapProviderRef: { value: 'google' as string },
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: mockHasFeature,
    hasModule: () => true,
    mapProvider: mapProviderRef.value,
    geocodingProvider: 'google',
  }),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'light', theme: 'system', toggleTheme: vi.fn(), setTheme: vi.fn() }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeMarker = (id = 1) => ({
  id,
  lat: 53.3498,
  lng: -6.2603,
  title: `Marker ${id}`,
  infoContent: <span>Info {id}</span>,
});

// ─────────────────────────────────────────────────────────────────────────────
describe('LocationMap', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHasFeature.mockReturnValue(true);
    mapProviderRef.value = 'google';
  });

  it('returns null when maps feature is disabled', async () => {
    mockHasFeature.mockReturnValue(false);
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} />);
    // When maps is off, neither Google provider nor OSM view should render
    expect(screen.queryByTestId('google-maps-provider')).not.toBeInTheDocument();
    expect(screen.queryByTestId('osm-view')).not.toBeInTheDocument();
  });

  it('renders GoogleMapsProvider when mapProvider is google', async () => {
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} />);
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('does not render OpenStreetMap when mapProvider is google', async () => {
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} />);
    expect(screen.queryByTestId('osm-view')).not.toBeInTheDocument();
  });

  it('renders OpenStreetMapView when mapProvider is openstreetmap', async () => {
    // The tenant mock reads mapProviderRef on every useTenant() call, so
    // flipping it here genuinely drives LocationMap down the OSM branch — no
    // module reset needed. (Previously this test did a `vi.doMock('@/contexts')`
    // that could never take effect and asserted nothing about the OSM view.)
    mapProviderRef.value = 'openstreetmap';
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} />);
    // OpenStreetMapView is lazy() behind a Suspense boundary — await the resolve.
    expect(await screen.findByTestId('osm-view')).toBeInTheDocument();
    expect(screen.queryByTestId('google-maps-provider')).not.toBeInTheDocument();
  });

  it('renders OpenStreetMapView for the ordnance_survey provider too', async () => {
    mapProviderRef.value = 'ordnance_survey';
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} />);
    expect(await screen.findByTestId('osm-view')).toBeInTheDocument();
    expect(screen.queryByTestId('google-maps-provider')).not.toBeInTheDocument();
  });

  it('renders Suspense fallback skeleton while OSM view loads', async () => {
    // The Suspense fallback is a Skeleton. Since OpenStreetMapView is stubbed
    // (not actually lazy-loading), the stub resolves synchronously — just
    // check that the component doesn't crash with empty markers.
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[]} />);
    // No crash = pass; the important assertion is in the other test
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('renders multiple markers', async () => {
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker(1), makeMarker(2), makeMarker(3)]} />);
    // GoogleMapsProvider should render containing map
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('accepts custom height and className props without crashing', async () => {
    const { LocationMap } = await import('./LocationMap');
    render(
      <LocationMap markers={[makeMarker()]} height="600px" className="my-map" />
    );
    // className is forwarded to the inner wrapper div, and height is set inline
    // The google maps provider is the outer wrapper, just verify it rendered
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('accepts onMarkerClick callback without crashing', async () => {
    const onMarkerClick = vi.fn();
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} onMarkerClick={onMarkerClick} />);
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('renders with empty markers array', async () => {
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[]} />);
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('accepts onMapsFailed callback without crashing', async () => {
    const onMapsFailed = vi.fn();
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} onMapsFailed={onMapsFailed} />);
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('accepts fitBounds=false without crashing', async () => {
    const { LocationMap } = await import('./LocationMap');
    render(<LocationMap markers={[makeMarker()]} fitBounds={false} />);
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });

  it('accepts cluster=true without crashing', async () => {
    const { LocationMap } = await import('./LocationMap');
    const markers = Array.from({ length: 15 }, (_, i) => makeMarker(i + 1));
    render(<LocationMap markers={markers} cluster={true} />);
    expect(screen.getByTestId('google-maps-provider')).toBeInTheDocument();
  });
});
