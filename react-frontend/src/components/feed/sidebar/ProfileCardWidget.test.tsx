// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';

// ─── API mock ────────────────────────────────────────────────────────────────
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
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Auth state managed via hoisted mutable ref ───────────────────────────
// We use a mutable object so we can update auth between tests without
// needing to re-register the mock (vi.mock is hoisted and runs once).
const { authState, disabledModules } = vi.hoisted(() => ({
  authState: {
    user: {
      id: 42,
      first_name: 'Jane',
      last_name: 'Doe',
      username: 'janedoe',
      avatar: 'https://example.com/avatar.jpg',
    } as Record<string, unknown> | null,
    isAuthenticated: true,
  },
  disabledModules: new Set<string>(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: authState.user,
      isAuthenticated: authState.isAuthenticated,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn((module: string) => !disabledModules.has(module)),
    }),
  }),
);

// ─── Stub UI components ──────────────────────────────────────────────────────
vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

// ─── Helpers ─────────────────────────────────────────────────────────────────
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: (url: string | null) => url ?? '',
  resolveAssetUrl: (url: string | null) => url ?? '',
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────
const makeStats = (overrides = {}) => ({
  listings_count: 5,
  given_count: 12,
  received_count: 8,
  offers_count: 3,
  requests_count: 2,
  wallet_balance: 42,
  ...overrides,
});

const makeResponse = (data: object) => ({ success: true, data });

// ─────────────────────────────────────────────────────────────────────────────
describe('ProfileCardWidget', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    disabledModules.clear();
    // Restore default authenticated state
    authState.user = {
      id: 42,
      first_name: 'Jane',
      last_name: 'Doe',
      username: 'janedoe',
      avatar: 'https://example.com/avatar.jpg',
    };
    authState.isAuthenticated = true;
    mockApi.get.mockResolvedValue(makeResponse(makeStats()));
  });

  it('hides listing totals, offers, and requests when listings are disabled', async () => {
    disabledModules.add('listings');
    mockApi.get.mockResolvedValue(makeResponse(makeStats()));

    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);

    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByText('Listings')).not.toBeInTheDocument();
    expect(screen.queryByText('Offers')).not.toBeInTheDocument();
    expect(screen.queryByText('Requests')).not.toBeInTheDocument();
    expect(screen.getByText('Given')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
  });

  it('renders the user display name', async () => {
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });

  it('renders the user handle with @ prefix', async () => {
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('@janedoe')).toBeInTheDocument();
    });
  });

  it('fetches stats from /v2/me/stats on mount', async () => {
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith('/v2/me/stats');
    });
  });

  it('renders listings count after stats load', async () => {
    mockApi.get.mockResolvedValue(makeResponse(makeStats({ listings_count: 7 })));
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('7')).toBeInTheDocument();
    });
  });

  it('renders given count after stats load', async () => {
    mockApi.get.mockResolvedValue(makeResponse(makeStats({ given_count: 15 })));
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('15')).toBeInTheDocument();
    });
  });

  it('renders received count after stats load', async () => {
    mockApi.get.mockResolvedValue(makeResponse(makeStats({ received_count: 9 })));
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('9')).toBeInTheDocument();
    });
  });

  it('renders offers count', async () => {
    mockApi.get.mockResolvedValue(makeResponse(makeStats({ offers_count: 4 })));
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('4')).toBeInTheDocument();
    });
  });

  it('renders requests count', async () => {
    mockApi.get.mockResolvedValue(makeResponse(makeStats({ requests_count: 6 })));
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('6')).toBeInTheDocument();
    });
  });

  it('renders a link to the profile page', async () => {
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => screen.getByText('Jane Doe'));
    const links = screen.getAllByRole('link');
    const profileLink = links.find((l) => l.getAttribute('href')?.includes('/profile'));
    expect(profileLink).toBeInTheDocument();
  });

  it('renders a link to listings page', async () => {
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => screen.getByText('Jane Doe'));
    const links = screen.getAllByRole('link');
    const listingsLink = links.find((l) => l.getAttribute('href')?.includes('/listings'));
    expect(listingsLink).toBeInTheDocument();
  });

  it('renders nothing when user is not authenticated', async () => {
    authState.isAuthenticated = false;
    authState.user = null;
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    const { container } = render(<ProfileCardWidget />);
    // Component returns null — no display name rendered
    expect(screen.queryByText('Jane Doe')).not.toBeInTheDocument();
    // The only DOM content is the ToastProvider wrapper (no GlassCard)
    expect(container.querySelector('[data-testid="glass-card"]')).not.toBeInTheDocument();
  });

  it('does not crash when API call fails (still shows name)', async () => {
    mockApi.get.mockRejectedValue(new Error('network error'));
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });

  it('falls back to username when first/last name absent', async () => {
    authState.user = {
      id: 43,
      first_name: null,
      last_name: null,
      username: 'jdoe',
      avatar: null,
    };
    const { ProfileCardWidget } = await import('./ProfileCardWidget');
    render(<ProfileCardWidget />);
    await waitFor(() => {
      expect(screen.getByText('jdoe')).toBeInTheDocument();
    });
  });
});
