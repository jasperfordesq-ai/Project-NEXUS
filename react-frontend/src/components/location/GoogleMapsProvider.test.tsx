// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

// ─── Mock @vis.gl/react-google-maps ─────────────────────────────────────────
vi.mock('@vis.gl/react-google-maps', () => ({
  APIProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="api-provider">{children}</div>
  ),
  Map: () => <div data-testid="google-map" />,
  useMap: () => null,
  useMapsLibrary: () => null,
  AdvancedMarker: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="advanced-marker">{children}</div>
  ),
}));

// ─── Mock @googlemaps/markerclusterer ────────────────────────────────────────
vi.mock('@googlemaps/markerclusterer', () => ({
  MarkerClusterer: vi.fn(),
  DefaultRenderer: vi.fn(),
}));

// ─── Contexts ────────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Test User' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
  })
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const enabledConfig = {
  enabled: true,
  apiKey: 'test-api-key-abc123',
  mapId: 'test-map-id',
  mapsEnabled: true,
  mapProvider: 'google' as const,
  googleMapsEnabled: true,
  googlePlacesEnabled: true,
};

const disabledConfig = {
  enabled: false,
  apiKey: '',
  mapId: null,
  mapsEnabled: false,
  googleMapsEnabled: false,
  googlePlacesEnabled: false,
  osmTileUrl: undefined,
  osmTileAttribution: undefined,
  osmTileProvider: null,
};

function mockFetchResponse(data: object, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok,
    json: async () => ({ data }),
    status: ok ? 200 : 500,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('GoogleMapsProvider', () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    // Reset module-level singleton so each test starts fresh
    const mod = await import('./GoogleMapsProvider');
    mod.resetGoogleMapsConfigForTests();
  });

  it('renders fallback while config is loading', async () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {})); // never resolves
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider fallback={<div data-testid="fallback">Loading...</div>}>
        <div data-testid="child">Child</div>
      </GoogleMapsProvider>
    );
    expect(screen.getByTestId('fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders nothing (null fallback) when config is loading and no fallback prop', async () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    const { container } = render(
      <GoogleMapsProvider>
        <div data-testid="child">Child</div>
      </GoogleMapsProvider>
    );
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
    // `fallback` defaults to null, so the provider renders literally nothing
    // while the config request is in flight — which is what this test's own name
    // says. The assertion here was `not.toBeNull()`, the exact opposite of both
    // the title and the component's contract, so it could never pass.
    expect(container.firstChild).toBeNull();
  });

  it('renders children inside APIProvider when Google Maps is enabled', async () => {
    mockFetchResponse(enabledConfig);
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider>
        <div data-testid="child">Map content</div>
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('child')).toBeInTheDocument();
    });
    expect(screen.getByTestId('api-provider')).toBeInTheDocument();
  });

  it('renders fallback when config returns enabled:false', async () => {
    mockFetchResponse(disabledConfig);
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider fallback={<div data-testid="fallback">No maps</div>}>
        <div data-testid="child">Map</div>
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders fallback when API key is empty even if enabled:true', async () => {
    mockFetchResponse({ enabled: true, apiKey: '', mapId: null });
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider fallback={<div data-testid="fallback">No key</div>}>
        <div data-testid="child">Map</div>
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
  });

  it('renders fallback when fetch fails with network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider fallback={<div data-testid="fallback">Error</div>}>
        <div data-testid="child">Map</div>
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders fallback when server returns a non-OK response', async () => {
    mockFetchResponse({}, false);
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider fallback={<div data-testid="fallback">Server error</div>}>
        <div data-testid="child">Map</div>
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('fallback')).toBeInTheDocument();
    });
  });

  it('exposes config via useGoogleMapsConfig hook when enabled', async () => {
    mockFetchResponse(enabledConfig);
    const { GoogleMapsProvider, useGoogleMapsConfig } = await import('./GoogleMapsProvider');

    function Inspector() {
      const cfg = useGoogleMapsConfig();
      return <div data-testid="config">{cfg?.apiKey ?? 'none'}</div>;
    }

    render(
      <GoogleMapsProvider>
        <Inspector />
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('config')).toHaveTextContent('test-api-key-abc123');
    });
  });

  it('useGoogleMapsConfig returns null outside provider', async () => {
    const { useGoogleMapsConfig } = await import('./GoogleMapsProvider');

    function Inspector() {
      const cfg = useGoogleMapsConfig();
      return <div data-testid="config">{cfg === null ? 'null' : 'has-config'}</div>;
    }

    render(<Inspector />);
    expect(screen.getByTestId('config')).toHaveTextContent('null');
  });

  it('renders multiple children when enabled', async () => {
    mockFetchResponse(enabledConfig);
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider>
        <div data-testid="child-a">A</div>
        <div data-testid="child-b">B</div>
      </GoogleMapsProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('child-a')).toBeInTheDocument();
      expect(screen.getByTestId('child-b')).toBeInTheDocument();
    });
  });

  it('sets window.gm_authFailure handler on mount', async () => {
    mockFetchResponse(enabledConfig);
    const { GoogleMapsProvider } = await import('./GoogleMapsProvider');
    render(
      <GoogleMapsProvider>
        <div />
      </GoogleMapsProvider>
    );

    // The effect runs synchronously on mount
    expect(typeof window.gm_authFailure).toBe('function');
  });

  it('fetchMapsRuntimeConfig returns a GoogleMapsConfig shape', async () => {
    mockFetchResponse(enabledConfig);
    const { fetchMapsRuntimeConfig, resetGoogleMapsConfigForTests } = await import('./GoogleMapsProvider');
    resetGoogleMapsConfigForTests();
    const config = await fetchMapsRuntimeConfig();
    expect(config).toMatchObject({
      enabled: true,
      apiKey: 'test-api-key-abc123',
    });
  });
});
