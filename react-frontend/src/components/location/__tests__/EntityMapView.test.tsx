// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for EntityMapView component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Set env before module imports ───────────────────────────────────────────
import.meta.env.VITE_GOOGLE_MAPS_API_KEY = 'test-key';

// ─── Mocks ──────────────────────────────────────────────────────────────────

// 🔴 Mock TenantContext by its DIRECT path, not the '@/contexts' barrel.
// EntityMapView.tsx:18 (and LocationMap.tsx:45, reached via the lazy import)
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
  APIProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="api-provider">{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  Marker: () => <div data-testid="marker" />,
  AdvancedMarker: () => <div data-testid="marker" />,
  InfoWindow: ({ children }: { children: React.ReactNode }) => <div data-testid="info-window">{children}</div>,
  useMap: vi.fn(() => ({ setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() })),
  useAdvancedMarkerRef: vi.fn(() => [vi.fn(), null]),
  useApiLoadingStatus: vi.fn(() => 'LOADED'),
  APILoadingStatus: { LOADED: 'LOADED', LOADING: 'LOADING', FAILED: 'FAILED', AUTH_FAILURE: 'AUTH_FAILURE' },
}));

(global as Record<string, unknown>).google = {
  maps: {
    LatLngBounds: vi.fn(() => ({ extend: vi.fn() })),
  },
};

import { EntityMapView } from '../EntityMapView';
import { resetGoogleMapsConfigForTests } from '../GoogleMapsProvider';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

interface TestItem {
  id: number;
  title: string;
  lat: number;
  lng: number;
}

const getCoordinates = (item: TestItem) => ({ lat: item.lat, lng: item.lng });
const getMarkerConfig = (item: TestItem) => ({ id: item.id, title: item.title });
const renderInfoContent = (item: TestItem) => <div>{item.title}</div>;

describe('EntityMapView', () => {
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

  it('renders without crashing with empty items', () => {
    const { container } = render(
      <W>
        <EntityMapView
          items={[]}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
        />
      </W>,
    );
    expect(container).toBeTruthy();
  });

  it('shows empty message when no items have coordinates', () => {
    render(
      <W>
        <EntityMapView
          items={[]}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
          emptyMessage="No items found"
        />
      </W>,
    );
    expect(screen.getByText('No items found')).toBeInTheDocument();
  });

  it('renders map when items have coordinates', async () => {
    const items: TestItem[] = [{ id: 1, title: 'Test', lat: 53, lng: -6 }];
    const { container } = render(
      <W>
        <EntityMapView
          items={items}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
        />
      </W>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy();
    });
  });

  it('shows loading state', () => {
    const { container } = render(
      <W>
        <EntityMapView
          items={[]}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
          isLoading
        />
      </W>,
    );
    expect(container.querySelector('[role="status"]')).toBeTruthy();
  });

  it('shows maps-disabled message when MAPS_ENABLED is false', () => {
    mapsEnabled = false;
    render(
      <W>
        <EntityMapView
          items={[{ id: 1, title: 'X', lat: 0, lng: 0 }]}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
        />
      </W>,
    );
    expect(screen.getByText('Map view is not available')).toBeInTheDocument();
  });

  it('shows maps-disabled message when the tenant maps feature is false', () => {
    tenantMapsFeature = false;
    render(
      <W>
        <EntityMapView
          items={[{ id: 1, title: 'X', lat: 0, lng: 0 }]}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
        />
      </W>,
    );
    expect(screen.getByText('Map view is not available')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const { container } = render(
      <W>
        <EntityMapView
          items={[]}
          getCoordinates={getCoordinates}
          getMarkerConfig={getMarkerConfig}
          renderInfoContent={renderInfoContent}
          className="custom-class"
        />
      </W>,
    );
    expect(container.querySelector('.custom-class')).toBeTruthy();
  });
});
