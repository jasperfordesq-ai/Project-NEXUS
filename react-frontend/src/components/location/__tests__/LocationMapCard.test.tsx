// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LocationMapCard component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Set env before module imports ───────────────────────────────────────────
import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// 🔴 Mock TenantContext by its DIRECT path, not the '@/contexts' barrel.
// LocationMapCard.tsx:17 (and LocationMap.tsx:45, reached via the lazy import)
// import `useTenant` from '@/contexts/TenantContext'. Vitest's mock registry is
// keyed per-specifier, so a `vi.mock('@/contexts')` override never applies here
// — the real hook loads and throws "useTenant must be used within a
// TenantProvider" (TenantContext.tsx:722). Nothing in this module graph imports
// the '@/contexts' barrel, so no barrel mock belongs in this file.
// Partial mock so sibling exports (TenantProvider, useTenantLanguages, …) stay real.
let tenantMapsFeature = true;
vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return {
    ...actual,
    useTenant: vi.fn(() => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantSlug: 'test',
      branding: { name: 'Test' },
      hasFeature: vi.fn((feature: string) => feature === 'maps' ? tenantMapsFeature : true),
      hasModule: vi.fn(() => true),
      mapProvider: 'google',
      geocodingProvider: 'google',
      tenantPath: (p: string) => `/test${p}`,
    })),
  };
});

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
}));

let mapsEnabled = true;
vi.mock('@/lib/map-config', () => ({
  get MAPS_ENABLED() { return mapsEnabled; },
}));

vi.mock('@/lib/map-styles', () => ({
  DARK_MAP_STYLES: [],
}));

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  Marker: () => <div data-testid="marker" />,
  AdvancedMarker: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => <div data-testid="marker" {...props}>{children}</div>,
  InfoWindow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useMap: vi.fn(() => ({ setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() })),
  useAdvancedMarkerRef: vi.fn(() => [vi.fn(), null]),
  useApiLoadingStatus: vi.fn(() => 'LOADED'),
  APILoadingStatus: { LOADED: 'LOADED', LOADING: 'LOADING', FAILED: 'FAILED', AUTH_FAILURE: 'AUTH_FAILURE' },
}));

vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: vi.fn(() => ({
    addMarker: vi.fn(),
    removeMarker: vi.fn(),
    clearMarkers: vi.fn(),
    setMap: vi.fn(),
  })),
}));

(global as Record<string, unknown>).google = {
  maps: {
    LatLngBounds: vi.fn(() => ({ extend: vi.fn() })),
    Marker: { MAX_ZINDEX: 1000000 },
    marker: {
      AdvancedMarkerElement: vi.fn(),
    },
  },
};

import { LocationMapCard } from '../LocationMapCard';
import { resetGoogleMapsConfigForTests } from '../GoogleMapsProvider';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

describe('LocationMapCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGoogleMapsConfigForTests();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      data: { enabled: true, apiKey: 'test-key', mapId: null },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    mapsEnabled = true;
    tenantMapsFeature = true;
    import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W>
        <LocationMapCard
          title="Test Location"
          locationText="Dublin, Ireland"
          markers={[]}
          center={{ lat: 53.35, lng: -6.26 }}
        />
      </W>,
    );
    expect(container).toBeTruthy();
  });

  it('displays the title', () => {
    render(
      <W>
        <LocationMapCard
          title="Event Location"
          locationText="123 Main St"
          markers={[]}
        />
      </W>,
    );
    expect(screen.getByText('Event Location')).toBeInTheDocument();
  });

  it('displays location text', () => {
    render(
      <W>
        <LocationMapCard
          title="Location"
          locationText="Central Park, NYC"
          markers={[]}
        />
      </W>,
    );
    expect(screen.getByText('Central Park, NYC')).toBeInTheDocument();
  });

  it('returns null when no location text and no coordinates', () => {
    const { container } = render(
      <W>
        <LocationMapCard title="Location" markers={[]} />
      </W>,
    );
    // The component should return null
    expect(container.querySelector('h3')).toBeNull();
  });

  it('shows map when maps are enabled and coordinates are provided', async () => {
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W>
        <LocationMapCard
          title="Location"
          markers={markers}
          locationText="Test"
        />
      </W>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy();
    });
  });

  it('does not show map when MAPS_ENABLED is false', () => {
    mapsEnabled = false;
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W>
        <LocationMapCard
          title="Location"
          markers={markers}
          locationText="Test"
        />
      </W>,
    );
    expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
  });

  it('does not show map when the tenant maps feature is false', () => {
    tenantMapsFeature = false;
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W>
        <LocationMapCard
          title="Location"
          markers={markers}
          locationText="Test"
        />
      </W>,
    );
    expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
    expect(screen.getByText('Test')).toBeInTheDocument();
  });
});
