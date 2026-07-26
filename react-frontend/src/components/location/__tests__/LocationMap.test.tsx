// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LocationMap component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Set env before module imports ───────────────────────────────────────────

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({ resolvedTheme: 'light', theme: 'light', setTheme: vi.fn() })),
}));

vi.mock('@/lib/map-styles', () => ({
  DARK_MAP_STYLES: [],
}));

let mapsEnabled = true;
vi.mock('@/lib/map-config', () => ({
  get MAPS_ENABLED() { return mapsEnabled; },
}));

const mockUseTenant = vi.fn(() => ({
  hasFeature: (f: string) => f === 'maps',
  mapProvider: 'google' as const,
  geocodingProvider: 'google' as const,
}));

// 🔴 Mock TenantContext by its DIRECT path, not the '@/contexts' barrel.
// LocationMap.tsx:45 imports `useTenant` from '@/contexts/TenantContext'.
// Vitest's mock registry is keyed per-specifier, so a `vi.mock('@/contexts')`
// override never applies here — the real hook loads and throws
// "useTenant must be used within a TenantProvider" (TenantContext.tsx:722).
// Partial mock so sibling exports (TenantProvider, useTenantLanguages, …) stay real.
vi.mock('@/contexts/TenantContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/contexts/TenantContext')>();
  return { ...actual, useTenant: () => mockUseTenant() };
});

const mockUseApiLoadingStatus = vi.fn(() => 'LOADED');

vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Map: ({ children }: { children: React.ReactNode }) => <div data-testid="google-map">{children}</div>,
  Marker: ({ title }: { title?: string }) => <div data-testid="marker" data-title={title} />,
  AdvancedMarker: ({ title }: { title?: string }) => <div data-testid="marker" data-title={title} />,
  InfoWindow: ({ children }: { children: React.ReactNode }) => <div data-testid="info-window">{children}</div>,
  useMap: vi.fn(() => ({ setCenter: vi.fn(), setZoom: vi.fn(), fitBounds: vi.fn() })),
  useAdvancedMarkerRef: vi.fn(() => [vi.fn(), null]),
  useApiLoadingStatus: () => mockUseApiLoadingStatus(),
  APILoadingStatus: { LOADED: 'LOADED', LOADING: 'LOADING', FAILED: 'FAILED', AUTH_FAILURE: 'AUTH_FAILURE' },
}));

(global as Record<string, unknown>).google = {
  maps: {
    LatLngBounds: vi.fn(() => ({ extend: vi.fn() })),
  },
};

import { resetGoogleMapsConfigForTests } from '../GoogleMapsProvider';
import { LocationMap } from '../LocationMap';

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter>{children}</MemoryRouter>
    </>
  );
}

describe('LocationMap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGoogleMapsConfigForTests();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        data: {
          enabled: true,
          apiKey: 'test-key',
          mapId: null,
        },
      }),
    })));
    mapsEnabled = true;
    mockUseApiLoadingStatus.mockReturnValue('LOADED');
  });

  it('renders without crashing with one marker', async () => {
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test Marker' }];
    const { container } = render(
      <W><LocationMap markers={markers} /></W>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy();
    });
  });

  it('renders multiple markers', async () => {
    const markers = [
      { id: 1, lat: 53.35, lng: -6.26, title: 'Marker 1' },
      { id: 2, lat: 53.40, lng: -6.30, title: 'Marker 2' },
    ];
    const { container } = render(
      <W><LocationMap markers={markers} /></W>,
    );
    await waitFor(() => {
      const markerElements = container.querySelectorAll('[data-testid="marker"]');
      expect(markerElements.length).toBe(2);
    });
  });

  it('returns null when Maps config is disabled', async () => {
    resetGoogleMapsConfigForTests();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { enabled: false, apiKey: '', mapId: null } }),
    })));
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W><LocationMap markers={markers} /></W>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
    });
  });

  it('returns null when API auth fails', async () => {
    mockUseApiLoadingStatus.mockReturnValue('AUTH_FAILURE');
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W><LocationMap markers={markers} /></W>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
    });
  });

  it('applies custom className and height', async () => {
    const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
    const { container } = render(
      <W><LocationMap markers={markers} className="custom-map" height="500px" /></W>,
    );
    await waitFor(() => {
      const wrapper = container.querySelector('.custom-map');
      expect(wrapper).toBeTruthy();
      expect(wrapper?.getAttribute('style')).toContain('500px');
    });
  });

  describe('per-tenant kill switch + provider dispatch', () => {
    it('returns null when the maps feature flag is OFF', () => {
      mockUseTenant.mockReturnValueOnce({
        hasFeature: () => false,
        mapProvider: 'google' as const,
        geocodingProvider: 'google' as const,
      });
      const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
      const { container } = render(<W><LocationMap markers={markers} /></W>);
      expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
      // No leaflet either
      expect(container.querySelector('.nexus-osm-map-wrapper')).toBeNull();
    });

    it('returns null without fetching runtime config when the platform map display switch is OFF', async () => {
      mapsEnabled = false;
      const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
      const { container } = render(<W><LocationMap markers={markers} /></W>);
      await act(async () => {
        await Promise.resolve();
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
      expect(container.querySelector('.nexus-osm-map-wrapper')).toBeNull();
    });

    it('renders the OpenStreetMap branch when map_provider=openstreetmap', async () => {
      mockUseTenant.mockReturnValueOnce({
        hasFeature: () => true,
        mapProvider: 'openstreetmap' as const,
        geocodingProvider: 'nominatim' as const,
      });
      const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
      const { container } = render(<W><LocationMap markers={markers} /></W>);
      // The lazy leaflet branch resolves in the test env, so assert the real
      // OSM root actually mounts — and that the Google branch never does.
      await waitFor(() => {
        expect(container.querySelector('.nexus-osm-map-wrapper')).toBeTruthy();
      });
      expect(container.querySelector('[data-testid="google-map"]')).toBeNull();
    });

    it('renders the Google branch when map_provider=google (default)', async () => {
      const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'Test' }];
      const { container } = render(<W><LocationMap markers={markers} /></W>);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy();
      });
    });
  });

  describe('marker rendering by Map ID (Google display fix)', () => {
    it('still renders pins via the classic-marker fallback when NO Map ID is configured', async () => {
      // beforeEach fetch mock returns mapId: null — AdvancedMarkers would render
      // nothing, so the classic <Marker> fallback must still produce the pins.
      const markers = [
        { id: 1, lat: 53.35, lng: -6.26, title: 'A' },
        { id: 2, lat: 53.40, lng: -6.30, title: 'B' },
      ];
      const { container } = render(<W><LocationMap markers={markers} /></W>);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy();
        expect(container.querySelectorAll('[data-testid="marker"]').length).toBe(2);
      });
    });

    it('renders pins via AdvancedMarkers when a Map ID IS configured', async () => {
      resetGoogleMapsConfigForTests();
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: { enabled: true, apiKey: 'test-key', mapId: 'map-abc' } }),
      })));
      const markers = [{ id: 1, lat: 53.35, lng: -6.26, title: 'A' }];
      const { container } = render(<W><LocationMap markers={markers} /></W>);
      await waitFor(() => {
        expect(container.querySelector('[data-testid="google-map"]')).toBeTruthy();
        expect(container.querySelectorAll('[data-testid="marker"]').length).toBe(1);
      });
    });
  });
});
