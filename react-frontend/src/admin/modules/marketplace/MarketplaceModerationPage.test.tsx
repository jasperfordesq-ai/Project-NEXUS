// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  API_BASE: '/api',
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ─── Mock adminApi ────────────────────────────────────────────────────────────
const { mockAdminMarketplace } = vi.hoisted(() => ({
  mockAdminMarketplace: {
    bulkReject: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminMarketplace: mockAdminMarketplace,
}));

// ─── Contexts ─────────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test', currency: 'EUR' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

// NOTE: no '@/components/ui' stub. The real HeroUI v3 Modal, Tabs, Chip, Avatar,
// Tooltip and Textarea render here, alongside the real admin DataTable /
// ConfirmModal / EmptyState — so the assertions below describe the DOM and copy
// an administrator actually sees.

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const { makeListing } = vi.hoisted(() => ({
  makeListing: (overrides: Record<string, unknown> = {}) => ({
    id: 1,
    title: 'Handmade Candle',
    price: 15.00,
    price_currency: 'EUR',
    price_type: 'fixed',
    status: 'active',
    moderation_status: 'pending',
    moderation_notes: null,
    seller_type: 'individual',
    views_count: 12,
    image: null,
    category: 'Crafts',
    user: { id: 3, name: 'Alice Seller' },
    created_at: '2025-06-01T10:00:00Z',
    ...overrides,
  }),
}));

const makeApiResponse = (data: unknown[], total?: number) => ({
  success: true,
  data,
  meta: { total: total ?? (data as unknown[]).length },
});

// ─────────────────────────────────────────────────────────────────────────────

describe('MarketplaceModerationPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockApi.get.mockResolvedValue(makeApiResponse([]));
  });

  it('shows loading state initially', async () => {
    mockApi.get.mockImplementation(() => new Promise(() => {}));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    expect(await screen.findByRole('status', { name: 'Loading' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
  });

  it('renders empty state when no listings returned', async () => {
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    expect(
      await screen.findByRole('heading', { name: 'No listings found' })
    ).toBeInTheDocument();
    expect(screen.getByText('No listings have been created yet')).toBeInTheDocument();
  });

  it('renders listing rows when data returned', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing()]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      expect(screen.getByText('Handmade Candle')).toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'No listings found' })).toBeNull();
  });

  it('renders seller name column', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing()]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      expect(screen.getByText('Alice Seller')).toBeInTheDocument();
    });
    expect(screen.getByRole('columnheader', { name: 'Seller' })).toBeInTheDocument();
  });

  it('renders moderation status chip', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ moderation_status: 'pending' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      // The chip shows the translated moderation status, not the raw enum value.
      expect(screen.getByText('Pending review')).toBeInTheDocument();
    });
    expect(screen.queryByText('pending')).toBeNull();
    // The listing status column keeps its own translated chip.
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows approve and reject buttons for pending listings', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ moderation_status: 'pending' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve listing/i })).toBeEnabled();
      expect(screen.getByRole('button', { name: /reject listing/i })).toBeEnabled();
    });
  });

  it('calls approve endpoint when approve button clicked', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 7, moderation_status: 'pending' })]));
    mockApi.post.mockResolvedValue({ success: true });
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));

    fireEvent.click(screen.getByRole('button', { name: /approve listing/i }));
    await waitFor(() => {
      expect(mockApi.post).toHaveBeenCalledWith('/v2/admin/marketplace/listings/7/approve');
    });
  });

  it('opens reject modal when reject button clicked', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 8, moderation_status: 'pending' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /reject listing/i }));
    const modal = await screen.findByRole('dialog');
    // Heading and submit button share the same copy — assert both roles explicitly.
    expect(within(modal).getByRole('heading', { name: 'Reject Listing' })).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Reject Listing' })).toBeInTheDocument();
    expect(
      within(modal).getByText('Please provide a reason for rejecting this listing.')
    ).toBeInTheDocument();
  });

  it('shows reject modal with notes textarea when reject clicked', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 9, moderation_status: 'pending' })]));
    mockApi.post.mockResolvedValue({ success: true });
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));

    fireEvent.click(screen.getByRole('button', { name: /reject listing/i }));
    const rejectModal = await screen.findByRole('dialog');
    const notes = within(rejectModal).getByRole('textbox', { name: /moderation notes/i });
    expect(notes).toBeInTheDocument();
    expect(notes).toHaveAttribute('placeholder', 'Enter reason for rejection...');
  });

  it('shows delete confirm modal when delete button clicked', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 10, moderation_status: 'approved' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));

    fireEvent.click(screen.getByRole('button', { name: /delete listing/i }));
    const confirmModal = await screen.findByRole('dialog');
    expect(
      within(confirmModal).getByText('Delete Listing')
    ).toBeInTheDocument();
  });

  it('calls DELETE endpoint when delete confirmed', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 11, moderation_status: 'approved' })]));
    mockApi.delete.mockResolvedValue({ success: true });
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));

    fireEvent.click(screen.getByRole('button', { name: /delete listing/i }));
    const confirmModal = await screen.findByRole('dialog');
    fireEvent.click(within(confirmModal).getByRole('button', { name: 'Delete' }));
    await waitFor(() => {
      expect(mockApi.delete).toHaveBeenCalledWith('/v2/admin/marketplace/listings/11');
    });
  });

  it('shows success toast when listing approved', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 12, moderation_status: 'pending' })]));
    mockApi.post.mockResolvedValue({ success: true });
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));

    fireEvent.click(screen.getByRole('button', { name: /approve listing/i }));
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('Listing approved');
    });
  });

  it('shows error toast when API fails on load', async () => {
    mockApi.get.mockRejectedValue(new Error('server error'));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load listings');
    });
  });

  it('renders page header', async () => {
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Moderation Queue' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Review and moderate marketplace listings pending approval')
    ).toBeInTheDocument();
  });

  it('renders moderation filter tabs', async () => {
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
        'All',
        'Pending',
        'Approved',
        'Rejected',
        'Flagged',
      ]);
    });
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not show approve/reject for approved listings', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ id: 20, moderation_status: 'approved' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => screen.getByText('Handmade Candle'));
    // Positive precondition: the row's other actions still render, so an absent
    // approve control cannot be an artefact of a row that never rendered.
    expect(screen.getByRole('button', { name: /delete listing/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view listing/i })).toBeInTheDocument();
    // No approve/reject controls for an already-approved item.
    expect(screen.queryByRole('button', { name: /approve listing/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reject listing/i })).toBeNull();
  });

  it('renders listing price with currency', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ price: 25, price_currency: 'EUR' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);
    await waitFor(() => {
      expect(screen.getByText(/€25\.00/)).toBeInTheDocument();
    });
  });

  it('does not invent decimal places for zero-decimal listing currencies', async () => {
    mockApi.get.mockResolvedValue(makeApiResponse([makeListing({ price: 2500, price_currency: 'JPY' })]));
    const { MarketplaceModerationPage } = await import('./MarketplaceModerationPage');
    render(<MarketplaceModerationPage />);

    const price = await screen.findByText((content) => /2[,.]500/.test(content));
    expect(price.textContent).not.toMatch(/[,.]00(?:\D|$)/);
  });
});
