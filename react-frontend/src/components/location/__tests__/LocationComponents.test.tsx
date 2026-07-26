// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Batch render tests for Location components:
 * - EntityMapView, GoogleMapsProvider, LocationMap, LocationMapCard, PlaceAutocompleteInput
 *
 * Smoke tests — verify each component renders without crashing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Set env before module imports ───────────────────────────────────────────
// GoogleMapsProvider reads VITE_GOOGLE_MAPS_API_KEY at module level,
// so it must be set before any component imports.
import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';

// ─── Common mocks ────────────────────────────────────────────────────────────

// 🔴 Mock TenantContext by its DIRECT path, not the '@/contexts' barrel.
// Every component exercised here imports `useTenant` from
// '@/contexts/TenantContext' (EntityMapView:18, LocationMap:45,
// LocationMapCard:17, PlaceAutocompleteInput:20). Vitest's mock registry is
// keyed per-specifier, so a `vi.mock('@/contexts', ...)` override would never
// apply and the real hook would load and throw
// "useTenant must be used within a TenantProvider" (TenantContext.tsx:722).
// Nothing in this module graph imports the '@/contexts' barrel at all, so no
// barrel mock belongs in this file.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    mapProvider: 'google',
    geocodingProvider: 'google',
    tenantPath: (p: string) => `/test${p}`,
  })),
}));

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
}));

vi.mock('@/lib/map-styles', () => ({
  DARK_MAP_STYLES: [],
}));

vi.mock('@/lib/map-config', () => ({
  MAPS_ENABLED: true,
}));

// Mock @vis.gl/react-google-maps
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  Marker: () => <div data-testid="marker" />,
  AdvancedMarker: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => <div data-testid="marker" {...props}>{children}</div>,
  InfoWindow: ({ children }: { children: React.ReactNode }) => <div data-testid="info-window">{children}</div>,
  useMap: vi.fn(() => ({
    setCenter: vi.fn(),
    setZoom: vi.fn(),
    fitBounds: vi.fn(),
  })),
  useAdvancedMarkerRef: vi.fn(() => [vi.fn(), null]),
  useApiLoadingStatus: vi.fn(() => 'LOADED'),
  APILoadingStatus: {
    LOADED: 'LOADED',
    LOADING: 'LOADING',
    FAILED: 'FAILED',
    AUTH_FAILURE: 'AUTH_FAILURE',
  },
  useMapsLibrary: vi.fn(() => ({
    PlacesService: vi.fn(),
    AutocompleteService: vi.fn(),
    AutocompleteSessionToken: vi.fn(() => ({})),
  })),
}));

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: vi.fn(() => ({
    addMarker: vi.fn(),
    removeMarker: vi.fn(),
    clearMarkers: vi.fn(),
    setMap: vi.fn(),
  })),
}));

// Mock Google Maps globals
(global as Record<string, unknown>).google = {
  maps: {
    LatLngBounds: vi.fn(() => ({
      extend: vi.fn(),
    })),
    Marker: { MAX_ZINDEX: 1000000 },
    marker: {
      AdvancedMarkerElement: vi.fn(),
    },
    places: {
      AutocompleteService: vi.fn(),
      PlacesService: vi.fn(),
    },
  },
};

function mockGoogleMapsConfig(enabled = true) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        enabled,
        apiKey: enabled ? 'test-key' : '',
        mapId: enabled ? 'test-map-id' : null,
      },
    }),
  }));
}

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── EntityMapView ───────────────────────────────────────────────────────────

import { EntityMapView } from '../EntityMapView';

describe('EntityMapView', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <W>
        <EntityMapView
          items={[]}
          getCoordinates={() => ({ lat: 53.35, lng: -6.26 })}
          getMarkerConfig={(item: Record<string, unknown>) => ({ id: item.id, title: item.title })}
          renderInfoContent={(item: Record<string, unknown>) => <div>{item.title}</div>}
          center={{ lat: 53.35, lng: -6.26 }}
        />
      </W>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('renders with entities', async () => {
    const entities = [
      { id: 1, title: 'Test Listing', latitude: 53.35, longitude: -6.26 },
    ];
    const { container } = render(
      <W>
        <EntityMapView
          items={entities}
          getCoordinates={(item: Record<string, unknown>) => ({ lat: item.latitude, lng: item.longitude })}
          getMarkerConfig={(item: Record<string, unknown>) => ({ id: item.id, title: item.title })}
          renderInfoContent={(item: Record<string, unknown>) => <div>{item.title}</div>}
          center={{ lat: 53.35, lng: -6.26 }}
        />
      </W>
    );
    await waitFor(() => expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy());
  });
});

// ─── GoogleMapsProvider ──────────────────────────────────────────────────────

import { GoogleMapsProvider, resetGoogleMapsConfigForTests } from '../GoogleMapsProvider';

beforeEach(() => {
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';
  resetGoogleMapsConfigForTests();
  mockGoogleMapsConfig(true);
});

describe('GoogleMapsProvider', () => {
  it('renders without crashing', async () => {
    render(
      <W>
        <GoogleMapsProvider>
          <div>Test content</div>
        </GoogleMapsProvider>
      </W>
    );
    await waitFor(() => expect(screen.getByText('Test content')).toBeInTheDocument());
  });

  it('renders children', async () => {
    const { container } = render(
      <W>
        <GoogleMapsProvider>
          <div data-testid="child-content">Test content</div>
        </GoogleMapsProvider>
      </W>
    );
    await waitFor(() => expect(container.querySelector('[data-testid="child-content"]')).toBeTruthy());
  });
});

// ─── LocationMap ─────────────────────────────────────────────────────────────

import { LocationMap } from '../LocationMap';

describe('LocationMap', () => {
  beforeEach(() => {
    // Set API key for tests
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';
  });

  it('renders without crashing', async () => {
    const markers = [
      { id: 1, lat: 53.35, lng: -6.26, title: 'Test Marker' },
    ];
    const { container } = render(
      <W>
        <LocationMap markers={markers} />
      </W>
    );
    await waitFor(() => expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy());
  });

  it('renders with multiple markers', async () => {
    const markers = [
      { id: 1, lat: 53.35, lng: -6.26, title: 'Marker 1' },
      { id: 2, lat: 53.40, lng: -6.30, title: 'Marker 2' },
    ];
    const { container } = render(
      <W>
        <LocationMap markers={markers} />
      </W>
    );
    await waitFor(() => {
      const markerElements = container.querySelectorAll('[data-testid="marker"]');
      expect(markerElements.length).toBe(2);
    });
  });

  it('returns null when the runtime config is disabled', async () => {
    resetGoogleMapsConfigForTests();
    mockGoogleMapsConfig(false);
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W>
        <LocationMap markers={markers} />
      </W>
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
  });
});

// ─── LocationMapCard ─────────────────────────────────────────────────────────

import { LocationMapCard } from '../LocationMapCard';

describe('LocationMapCard', () => {
  beforeEach(() => {
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W>
        <LocationMapCard
          title="Test Location"
          center={{ lat: 53.35, lng: -6.26 }}
          markers={[]}
        />
      </W>
    );
    expect(container.querySelector('div')).toBeTruthy();
  });

  it('displays title', () => {
    const { container } = render(
      <W>
        <LocationMapCard
          title="Test Location"
          center={{ lat: 53.35, lng: -6.26 }}
          markers={[]}
        />
      </W>
    );
    expect(container.textContent).toContain('Test Location');
  });
});

// ─── PlaceAutocompleteInput ──────────────────────────────────────────────────

import { PlaceAutocompleteInput } from '../PlaceAutocompleteInput';

describe('PlaceAutocompleteInput', () => {
  it('renders without crashing', () => {
    const { container } = render(
      <W>
        <PlaceAutocompleteInput
          value=""
          onChange={vi.fn()}
          onPlaceSelect={vi.fn()}
        />
      </W>
    );
    expect(container.querySelector('input')).toBeTruthy();
  });

  it('displays label', () => {
    const { container } = render(
      <W>
        <PlaceAutocompleteInput
          value=""
          onChange={vi.fn()}
          onPlaceSelect={vi.fn()}
          label="Location"
        />
      </W>
    );
    expect(container.textContent).toContain('Location');
  });
});
