// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi, mockTenantState, stableTenantPath, stableT } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
  mockTenantState: { currency: 'EUR' },
  // Stable function references — prevents effect re-runs from identity changes
  stableTenantPath: (p: string) => `/test${p}`,
  stableT: (key: string) => key,
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Stable i18n — prevents t() reference churn in useEffect deps ────────────
vi.mock('react-i18next', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-i18next')>();
  return {
    ...orig,
    useTranslation: () => ({
      t: stableT,
      i18n: { changeLanguage: vi.fn(), language: 'en' },
    }),
    Trans: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// ─── Toast / Auth / Tenant ───────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), showToast: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '77' }),
  };
});

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 10, name: 'Alice Owner' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test', currency: mockTenantState.currency },
      tenantPath: stableTenantPath,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
      branding: { name: 'Test Platform' },
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));

vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">{title}{description && <p>{description}</p>}</div>
  ),
}));

// Stub heavy location/map components
vi.mock('@/components/location', () => ({
  PlaceAutocompleteInput: ({ label, value, onChange }: { label?: string; value?: string; onChange?: (v: string) => void }) => (
    <input
      aria-label={label ?? 'location'}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

vi.mock('@/components/location/PlaceAutocompleteInput', () => ({
  PlaceAutocompleteInput: ({ label, value, onChange }: { label?: string; value?: string; onChange?: (v: string) => void }) => (
    <input
      aria-label={label ?? 'location'}
      value={value ?? ''}
      onChange={(e) => onChange?.(e.target.value)}
    />
  ),
}));

// A vi.mock('@/components/ui', …) override of Select/SelectItem/Switch/
// RadioGroup/Radio was removed here (dead-mock treatment: DELETE, not retarget).
// It was commented "stub HeroUI components that can infinite-loop", but the page
// imports every one of those from its own direct path, so the override never
// applied and the real components have always rendered in this suite — which
// passes, so the loop it guarded against does not occur. Retargeting the stubs
// at the direct paths would switch five stand-ins ON for the first time and
// change what these tests exercise; deleting the fiction keeps behaviour
// identical and stops the file claiming a safety it never had.

// ─── Fixtures ────────────────────────────────────────────────────────────────
const { makeListing, makeCategories } = vi.hoisted(() => ({
  makeListing: (overrides = {}) => ({
    id: 77,
    title: 'Vintage Lamp',
    description: 'A beautiful vintage lamp in great condition.',
    price: 25,
    price_currency: 'EUR',
    price_type: 'fixed',
    condition: 'good',
    quantity: 1,
    category: { id: 3, name: 'Home & Garden', slug: 'home-garden' },
    location: 'Dublin',
    latitude: 53.3498,
    longitude: -6.2603,
    delivery_method: 'pickup',
    images: [{ id: 1, url: 'https://example.com/lamp.jpg', is_primary: true }],
    template_data: null,
    is_own: true,
    user: { id: 10, name: 'Alice Owner' },
    status: 'active',
    views_count: 5,
    saves_count: 1,
    is_saved: false,
    is_promoted: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }),
  makeCategories: () => [
    { id: 3, name: 'Home & Garden', slug: 'home-garden' },
    { id: 4, name: 'Electronics', slug: 'electronics' },
  ],
}));

function setupMocks(listingOverrides = {}) {
  mockApi.get.mockImplementation((url: string) => {
    if (url.includes('/marketplace/listings/77')) {
      return Promise.resolve({ success: true, data: makeListing(listingOverrides) });
    }
    if (url.includes('/marketplace/categories') && !url.includes('/template')) {
      return Promise.resolve({ success: true, data: makeCategories() });
    }
    if (url.includes('/template')) {
      return Promise.resolve({ success: true, data: { fields: [] } });
    }
    return Promise.resolve({ success: true, data: null });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
describe('EditMarketplaceListingPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockTenantState.currency = 'EUR';
    setupMocks();
  });

  it('shows a loading spinner initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('renders listing title pre-populated after load', async () => {
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      const titleInput = screen.getAllByRole('textbox').find(
        (el) => (el as HTMLInputElement).value === 'Vintage Lamp'
      );
      expect(titleInput).toBeDefined();
    });
  });

  it('renders description pre-populated after load', async () => {
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('A beautiful vintage lamp in great condition.')).toBeInTheDocument();
    });
  });

  it('shows error EmptyState when listing fails to load', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/marketplace/listings/77')) {
        return Promise.resolve({ success: false, error: 'Not found' });
      }
      if (url.includes('/marketplace/categories')) {
        return Promise.resolve({ success: true, data: makeCategories() });
      }
      return Promise.resolve({ success: true, data: null });
    });

    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    });
  });

  it('redirects non-owners away from edit page', async () => {
    mockApi.get.mockImplementation((url: string) => {
      if (url.includes('/marketplace/listings/77')) {
        return Promise.resolve({
          success: true,
          data: makeListing({ is_own: false, user: { id: 99, name: 'Someone Else' } }),
        });
      }
      if (url.includes('/marketplace/categories')) {
        return Promise.resolve({ success: true, data: makeCategories() });
      }
      return Promise.resolve({ success: true, data: null });
    });

    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/marketplace/77'),
        expect.objectContaining({ replace: true })
      );
    });
  });

  it('renders the Save Changes button', async () => {
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      const saveBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('save')
      );
      expect(saveBtn).toBeDefined();
    });
  });

  it('calls PUT /v2/marketplace/listings/77 on save submit', async () => {
    mockApi.put.mockResolvedValue({ success: true });
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => screen.getByDisplayValue('Vintage Lamp'));

    // Find and click Save Changes
    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockApi.put).toHaveBeenCalledWith(
          '/v2/marketplace/listings/77',
          expect.objectContaining({ title: 'Vintage Lamp' })
        );
      });
    }
  });

  it('uses the tenant currency when a legacy listing omitted its currency', async () => {
    mockTenantState.currency = 'JPY';
    setupMocks({ price_currency: null });
    mockApi.put.mockResolvedValue({ success: true });
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => screen.getByDisplayValue('Vintage Lamp'));
    const saveBtn = screen.getAllByRole('button').find(
      (button) => button.textContent?.toLowerCase().includes('save'),
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        '/v2/marketplace/listings/77',
        expect.objectContaining({ price_currency: 'JPY' }),
      );
    });
  });

  it('does not overwrite inventory when the API omitted inventory fields', async () => {
    mockApi.put.mockResolvedValue({ success: true });
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);
    await waitFor(() => screen.getByDisplayValue('Vintage Lamp'));

    const saveBtn = screen.getAllByRole('button').find(
      (button) => button.textContent?.toLowerCase().includes('save'),
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => expect(mockApi.put).toHaveBeenCalled());
    const payload = mockApi.put.mock.calls[0][1];
    expect(payload).not.toHaveProperty('inventory_count');
    expect(payload).not.toHaveProperty('low_stock_threshold');
    expect(payload).not.toHaveProperty('is_oversold_protected');
  });

  it('round-trips finite inventory fields supplied by the API', async () => {
    setupMocks({
      inventory_count: 8,
      low_stock_threshold: 2,
      is_oversold_protected: true,
    });
    mockApi.put.mockResolvedValue({ success: true });
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);
    await waitFor(() => screen.getByDisplayValue('Vintage Lamp'));

    const saveBtn = screen.getAllByRole('button').find(
      (button) => button.textContent?.toLowerCase().includes('save'),
    );
    if (saveBtn) fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        '/v2/marketplace/listings/77',
        expect.objectContaining({
          inventory_count: 8,
          low_stock_threshold: 2,
          is_oversold_protected: true,
        }),
      );
    });
  });

  it('shows error toast when save fails', async () => {
    mockApi.put.mockResolvedValue({ success: false, error: 'Save failed' });
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => screen.getByDisplayValue('Vintage Lamp'));

    const saveBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('save')
    );
    if (saveBtn) {
      fireEvent.click(saveBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
    }
  });

  it('shows price field for fixed-price listing', async () => {
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      const priceInput = screen.getAllByRole('spinbutton').find(
        (el) => (el as HTMLInputElement).value === '25'
      );
      expect(priceInput).toBeDefined();
    });
  });

  it('renders Generate with AI button after load', async () => {
    const { EditMarketplaceListingPage } = await import('./EditMarketplaceListingPage');
    render(<EditMarketplaceListingPage />);

    await waitFor(() => {
      const aiBtn = screen.getAllByRole('button').find(
        (b) => b.textContent?.toLowerCase().includes('ai') || b.textContent?.toLowerCase().includes('generat')
      );
      expect(aiBtn).toBeDefined();
    });
  });
});
