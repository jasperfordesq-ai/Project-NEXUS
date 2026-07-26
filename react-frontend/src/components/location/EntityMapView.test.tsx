// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// ─── API mock ─────────────────────────────────────────────────────────────────
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

// ─── map-config: override MAPS_ENABLED to true via vi.hoisted ─────────────────
vi.mock('@/lib/map-config', () => ({ MAPS_ENABLED: true }));

// ─── Stub LocationMap — prevents Leaflet/Google from running in jsdom ─────────
// NOTE: markers contain ReactNode (infoContent) — cannot JSON.stringify directly.
// Instead we serialize only the primitive fields (id/lat/lng/title) to data attrs.
vi.mock('./LocationMap', () => ({
  LocationMap: (props: {
    markers: { id: number | string; lat: number; lng: number; title: string; infoContent?: unknown }[];
    center?: { lat: number; lng: number };
    height?: string;
    fitBounds?: boolean;
    onMapsFailed?: () => void;
  }) => {
    const safeMarkers = props.markers.map(({ id, lat, lng, title }) => ({ id, lat, lng, title }));
    return (
      <div
        data-testid="location-map"
        data-markers={JSON.stringify(safeMarkers)}
        data-center={props.center ? JSON.stringify(props.center) : ''}
        data-height={props.height ?? ''}
        data-fit-bounds={props.fitBounds ? 'true' : 'false'}
        data-marker-count={String(props.markers.length)}
      >
        location-map-stub
      </div>
    );
  },
}));

// ─── NO '@/components/ui' barrel mock ─────────────────────────────────────────
// EntityMapView.tsx:16 imports `Skeleton` from '@/components/ui/Skeleton', not
// from the barrel, so a `vi.mock('@/components/ui', ...)` override never applied
// (vitest's mock registry is keyed per-specifier). The real Skeleton spreads its
// extra props straight onto the HeroUI skeleton div, so `role`/`aria-busy`/
// `aria-label`/`style` land in the DOM exactly as the old stub faked them —
// the loading assertions below target the real element.

// ─── Contexts — hasFeature MUST return true for 'maps' ────────────────────────
// 🔴 DIRECT path, not the '@/contexts' barrel: EntityMapView.tsx:18 imports
// `useTenant` from '@/contexts/TenantContext'. A barrel override is dead here
// and the real hook throws "useTenant must be used within a TenantProvider"
// (TenantContext.tsx:722) because test-utils wraps no TenantProvider.
// Total factory (not a spread of importOriginal) on purpose: the real module
// imports '@/i18n', which re-inits i18next with an HTTP backend at module scope
// and would clobber the English resources src/test/setup.ts loads synchronously.
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantSlug: 'test',
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: (_feature: string) => true, // always true, including 'maps'
    hasModule: (_feature: string) => true,
    mapProvider: 'google',
    geocodingProvider: 'google',
  }),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────
interface SimpleItem {
  id: number;
  name: string;
  lat: number | null;
  lng: number | null;
}

const makeItem = (overrides: Partial<SimpleItem> = {}): SimpleItem => ({
  id: 1,
  name: 'Test Venue',
  lat: 53.3498,
  lng: -6.2603,
  ...overrides,
});

function getCoordinates(item: SimpleItem) {
  return item.lat !== null && item.lng !== null ? { lat: item.lat, lng: item.lng } : null;
}
function getMarkerConfig(item: SimpleItem) {
  return { id: item.id, title: item.name };
}
function renderInfoContent(item: SimpleItem) {
  return <span>{item.name}</span>;
}

const defaultProps = {
  items: [makeItem()],
  getCoordinates,
  getMarkerConfig,
  renderInfoContent,
};

// ─────────────────────────────────────────────────────────────────────────────
describe('EntityMapView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders LocationMap when maps enabled and items have coordinates', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} />);
    expect(await screen.findByTestId('location-map')).toBeInTheDocument();
  });

  it('passes correct marker data to LocationMap', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} />);
    const map = screen.getByTestId('location-map');
    const markers = JSON.parse(map.getAttribute('data-markers') || '[]') as Array<{ id: number; lat: number; lng: number; title: string }>;
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe(1);
    expect(markers[0].lat).toBe(53.3498);
    expect(markers[0].lng).toBe(-6.2603);
    expect(markers[0].title).toBe('Test Venue');
  });

  it('passes multiple markers to LocationMap for multiple items', async () => {
    const items = [
      makeItem({ id: 1, name: 'Alpha', lat: 53.3, lng: -6.2 }),
      makeItem({ id: 2, name: 'Beta', lat: 51.5, lng: -0.12 }),
    ];
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} items={items} />);
    const map = screen.getByTestId('location-map');
    const markers = JSON.parse(map.getAttribute('data-markers') || '[]') as Array<{ id: number }>;
    expect(markers).toHaveLength(2);
  });

  it('filters out items with null coordinates from markers', async () => {
    const items = [
      makeItem({ id: 1, lat: 53.3, lng: -6.2 }),
      makeItem({ id: 2, lat: null, lng: null }),
    ];
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} items={items} />);
    const map = screen.getByTestId('location-map');
    const markers = JSON.parse(map.getAttribute('data-markers') || '[]') as Array<{ id: number }>;
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe(1);
  });

  it('passes custom center prop through to LocationMap', async () => {
    const center = { lat: 51.5, lng: -0.12 };
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} center={center} />);
    const map = screen.getByTestId('location-map');
    expect(JSON.parse(map.getAttribute('data-center') || '{}')).toEqual(center);
  });

  it('passes custom height to LocationMap', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} height="400px" />);
    const map = screen.getByTestId('location-map');
    expect(map.getAttribute('data-height')).toBe('400px');
  });

  it('always passes fitBounds=true to LocationMap', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} />);
    const map = screen.getByTestId('location-map');
    expect(map.getAttribute('data-fit-bounds')).toBe('true');
  });

  it('shows loading skeleton (not map) when isLoading is true', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} isLoading />);
    const skeleton = screen.getAllByRole('status').find((el) => el.getAttribute('aria-busy') === 'true');
    expect(skeleton).toBeInTheDocument();
    expect(screen.queryByTestId('location-map')).not.toBeInTheDocument();
  });

  it('shows custom empty message when all items lack coordinates', async () => {
    const items = [makeItem({ lat: null, lng: null })];
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} items={items} emptyMessage="No locations yet" />);
    expect(screen.queryByTestId('location-map')).not.toBeInTheDocument();
    expect(screen.getByText('No locations yet')).toBeInTheDocument();
  });

  it('shows default empty message when items list is empty', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} items={[]} />);
    expect(screen.getByText('No items with location data')).toBeInTheDocument();
  });

  it('forwards onMapsFailed prop — LocationMap stub renders normally', async () => {
    const onFail = vi.fn();
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} onMapsFailed={onFail} />);
    expect(screen.getByTestId('location-map')).toBeInTheDocument();
  });

  it('does not render LocationMap when loading even if items exist', async () => {
    const { EntityMapView } = await import('./EntityMapView');
    render(<EntityMapView {...defaultProps} isLoading />);
    expect(screen.queryByTestId('location-map')).not.toBeInTheDocument();
  });
});
