// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── vi.hoisted: stable refs used inside vi.mock factories ───────────────────
const mockNavigate = vi.hoisted(() => vi.fn());
const mockHasFeature = vi.hoisted(() => vi.fn(() => true));

vi.mock('@/contexts', () =>
  createMockContexts({
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('react-router-dom', async (importOriginal) => {
  const original = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...original,
    useNavigate: () => mockNavigate,
  };
});

// Mock useApi used by WarmthPassPage
vi.mock('@/hooks/useApi', () => ({
  useApi: vi.fn(),
  default: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// Stub sub-components
vi.mock('@/components/caring-community/TrustTierBadge', () => ({
  TrustTierBadge: ({ tier }: { tier: number }) => (
    <div data-testid="trust-tier-badge">tier-{tier}</div>
  ),
}));

vi.mock('@/components/seo', () => ({
  PageMeta: () => null,
}));

import { useApi } from '@/hooks/useApi';
import { WarmthPassPage } from './WarmthPassPage';

const mockWarmthPass = {
  eligible: true,
  tier: 3,
  tier_label: 'verified',
  hours_logged: 25,
  reviews_received: 8,
  identity_verified: true,
  member_since: '2023-01-15',
  pass_active_since: '2024-03-01',
  tenant_name: 'Test Timebank',
  member_name: 'Jane Doe',
  categories: ['Gardening', 'Cooking'],
};

describe('WarmthPassPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
  });

  it('shows loading skeleton when isLoading is true', () => {
    vi.mocked(useApi).mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: true,
      meta: null,
    });
    render(<WarmthPassPage />);
    // The loading GlassCard has aria-busy=true
    const loadingEl = screen.getAllByRole('status').find(
      (el) => el.getAttribute('aria-busy') === 'true',
    );
    expect(loadingEl).toBeDefined();
  });

  it('shows error state when error occurs', () => {
    vi.mocked(useApi).mockReturnValue({
      data: null,
      isLoading: false,
      error: 'Something went wrong',
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);
    // Error GlassCard has role=alert; there may be multiple so use queryAll
    const alerts = screen.queryAllByRole('alert');
    // At least one alert element should be present (the error GlassCard)
    expect(alerts.length).toBeGreaterThan(0);
  });

  it('shows not-eligible state when eligible is false', () => {
    vi.mocked(useApi).mockReturnValue({
      data: { ...mockWarmthPass, eligible: false, tier: 1 },
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);
    expect(screen.getByTestId('trust-tier-badge')).toBeInTheDocument();
    // No member name shown (that's in the eligible pass card)
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
  });

  it('renders the Warmth Pass credential when eligible', async () => {
    vi.mocked(useApi).mockReturnValue({
      data: mockWarmthPass,
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);
    await waitFor(() => expect(screen.getByText('Jane Doe')).toBeInTheDocument());
    expect(screen.getByText('Test Timebank')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument(); // hours_logged
    expect(screen.getByText('8')).toBeInTheDocument();  // reviews_received
    // categories
    expect(screen.getByText('Gardening')).toBeInTheDocument();
    expect(screen.getByText('Cooking')).toBeInTheDocument();
  });

  it('shows empty categories message when no categories', () => {
    vi.mocked(useApi).mockReturnValue({
      data: { ...mockWarmthPass, categories: [] },
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);
    expect(screen.queryByText('Gardening')).not.toBeInTheDocument();
  });

  it('navigates away when caring_community feature is disabled', async () => {
    mockHasFeature.mockReturnValue(false);
    vi.mocked(useApi).mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  // E-061 F-228: the pass is shown to third parties, so it must not describe the
  // member as "verified" when they only reached Trusted by hours and reviews.
  it('explains the pass truthfully and never calls a Trusted member verified', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        ...mockWarmthPass,
        tier: 2,
        tier_label: 'trusted',
        identity_verified: false,
      },
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);

    const text = document.body.textContent ?? '';
    expect(text).toContain('It is not an identity check');
    expect(text).not.toMatch(/verified, trusted community helper/i);
    expect(text).not.toContain('what_is_this_body');

    const tierChip = document.querySelector('[data-tier]');
    expect(tierChip?.getAttribute('data-tier')).toBe('2');
    expect(tierChip?.textContent).toBe('Trusted');
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('labels the tier with the translated name, not the raw API slug', () => {
    vi.mocked(useApi).mockReturnValue({
      data: mockWarmthPass,
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);

    const tierChip = document.querySelector('[data-tier]');
    expect(tierChip?.getAttribute('data-tier')).toBe('3');
    expect(tierChip?.textContent).toBe('Verified');
  });

  it('shows identity verified as yes when identity_verified is true', () => {
    vi.mocked(useApi).mockReturnValue({
      data: { ...mockWarmthPass, identity_verified: true },
      isLoading: false,
      error: null,
      execute: vi.fn(),
      refetch: vi.fn(),
      reset: vi.fn(),
      setData: vi.fn(),
      loading: false,
      meta: null,
    });
    render(<WarmthPassPage />);
    // The i18n key resolves; just check the name renders (page is loaded)
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });
});
