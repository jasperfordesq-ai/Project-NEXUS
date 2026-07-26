// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import React from 'react';

// ─── Stub LocationMap (heavy Leaflet/Google dependency) ──────────────────────
vi.mock('./LocationMap', () => ({
  LocationMap: ({ height }: { height?: string }) => (
    <div data-testid="location-map" style={{ height }}>map-stub</div>
  ),
}));

// ─── Stub map-config so we can control MAPS_ENABLED ──────────────────────────
const { mockMapsEnabled } = vi.hoisted(() => ({ mockMapsEnabled: { value: true } }));

vi.mock('@/lib/map-config', () => ({
  get MAPS_ENABLED() { return mockMapsEnabled.value; },
}));

// ─── Stub GlassCard (avoids HeroUI jsdom issues) ─────────────────────────────
vi.mock('@/components/ui/GlassCard', () => ({
  GlassCard: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="glass-card" className={className}>{children}</div>
  ),
}));

// ─── Mock TenantContext on its DIRECT path ────────────────────────────────────
// 🔴 LocationMapCard.tsx:17 imports `useTenant` from '@/contexts/TenantContext'.
// Vitest keys its mock registry per-specifier, so the old
// `vi.mock('@/contexts', ...)` override never applied — the real hook loaded and
// threw "useTenant must be used within a TenantProvider" (TenantContext.tsx:722),
// killing every test in this file. Total factory (rather than spreading
// importOriginal) on purpose: the real module imports '@/i18n', which re-inits
// i18next with an HTTP backend at module scope and would clobber the English
// resources src/test/setup.ts loads synchronously.
const { mockHasFeature } = vi.hoisted(() => ({ mockHasFeature: vi.fn(() => true) }));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: mockHasFeature,
    hasModule: () => true,
    mapProvider: 'google',
    geocodingProvider: 'google',
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const singleMarker = [{ lat: 53.3498, lng: -6.2603, title: 'Dublin' }];
const center = { lat: 53.3498, lng: -6.2603 };

describe('LocationMapCard', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockMapsEnabled.value = true;
  });

  it('renders nothing visible when no locationText and no markers/center', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Location" markers={[]} />
    );
    // Component returns null — no GlassCard, no title rendered
    expect(screen.queryByTestId('glass-card')).toBeNull();
    expect(screen.queryByText('Location')).toBeNull();
  });

  it('renders title when locationText is provided', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Event Location" locationText="Dublin, Ireland" markers={[]} />
    );
    expect(screen.getByText('Event Location')).toBeInTheDocument();
  });

  it('renders locationText paragraph', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Location" locationText="Cork, Ireland" markers={[]} />
    );
    expect(screen.getByText('Cork, Ireland')).toBeInTheDocument();
  });

  it('renders the map stub when MAPS_ENABLED, hasFeature(maps)=true, and markers present', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Map" markers={singleMarker} />
    );
    // LocationMapCard.tsx:19 wraps the map in lazy() + Suspense, so the first
    // render commits the Skeleton fallback and the stub arrives a microtask
    // later. findBy* is getBy* + waitFor — same assertion, just past the
    // boundary; it still fails if the map never mounts.
    expect(await screen.findByTestId('location-map')).toBeInTheDocument();
  });

  it('does NOT render map when hasFeature("maps") returns false', async () => {
    mockHasFeature.mockReturnValue(false);
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="No Map" markers={singleMarker} locationText="Somewhere" />
    );
    expect(screen.queryByTestId('location-map')).toBeNull();
  });

  it('does NOT render map when MAPS_ENABLED is false', async () => {
    mockMapsEnabled.value = false;
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="No Map" markers={singleMarker} locationText="Somewhere" />
    );
    expect(screen.queryByTestId('location-map')).toBeNull();
  });

  it('renders map when center is provided (even without markers)', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Center" markers={[]} center={center} />
    );
    expect(await screen.findByTestId('location-map')).toBeInTheDocument();
  });

  it('renders GlassCard wrapper', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Title" locationText="Place" markers={[]} />
    );
    expect(screen.getByTestId('glass-card')).toBeInTheDocument();
  });

  it('renders header with MapPin icon and title', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="My Location" locationText="Dublin" markers={[]} />
    );
    // h3 heading
    expect(screen.getByRole('heading', { level: 3, name: 'My Location' })).toBeInTheDocument();
  });

  it('passes mapHeight to the LocationMap stub', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard title="Map" markers={singleMarker} mapHeight="500px" />
    );
    const mapEl = await screen.findByTestId('location-map');
    expect(mapEl).toHaveStyle({ height: '500px' });
  });

  it('renders both map and locationText together', async () => {
    const { LocationMapCard } = await import('./LocationMapCard');
    render(
      <LocationMapCard
        title="Full Card"
        locationText="Galway, Ireland"
        markers={singleMarker}
      />
    );
    expect(await screen.findByTestId('location-map')).toBeInTheDocument();
    expect(screen.getByText('Galway, Ireland')).toBeInTheDocument();
  });
});
