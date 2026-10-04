// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MyListingsPage — the member's own offers and requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';

const { mockApi, mockToast } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi, tokenManager: { getTenantId: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1, first_name: 'Test' }, isAuthenticated: true })),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
}));
vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useToast: vi.fn(() => mockToast),
}));
vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ user: { id: 1, first_name: 'Test' }, isAuthenticated: true })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

import { MyListingsPage } from './MyListingsPage';

type Counts = { live: number; review: number; rejected: number; expired: number; closed: number };
const NO_COUNTS: Counts = { live: 0, review: 0, rejected: 0, expired: 0, closed: 0 };

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

function listing(overrides: Record<string, unknown>) {
  return {
    id: 1,
    user_id: 1,
    title: 'Dog walking',
    description: '',
    type: 'offer',
    category_id: null,
    category_name: 'Pets',
    status: 'active',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    view_count: 12,
    save_count: 1,
    ...overrides,
  };
}

/** Answer GET /v2/listings/mine per status group. */
function serve(groups: Partial<Record<keyof Counts, unknown[]>>, counts: Partial<Counts>) {
  mockApi.get.mockImplementation((url: string) => {
    const status = new URL(url, 'http://x').searchParams.get('status') as keyof Counts;
    return Promise.resolve({
      success: true,
      data: groups[status] ?? [],
      meta: { cursor: null, has_more: false, counts: { ...NO_COUNTS, ...counts } },
    });
  });
}

function lastGetUrl(): URL {
  const calls = mockApi.get.mock.calls;
  return new URL(String(calls[calls.length - 1][0]), 'http://x');
}

describe('MyListingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, '', '/test/listings/mine');
  });

  it('shows the member\'s live listings by default, with posted and expiry dates', async () => {
    serve({ live: [listing({ expires_at: inDays(40) })] }, { live: 1 });
    render(<MyListingsPage />);

    expect(await screen.findByRole('link', { name: 'Dog walking' })).toHaveAttribute('href', '/test/listings/1');
    expect(lastGetUrl().pathname).toBe('/v2/listings/mine');
    expect(lastGetUrl().searchParams.get('status')).toBe('live');
    expect(screen.getByText(/Visible until/)).toBeInTheDocument();
    expect(screen.getByText('12 views')).toBeInTheDocument();
    // Not close to expiry, so no Extend button.
    expect(screen.queryByRole('button', { name: /Extend/ })).not.toBeInTheDocument();
  });

  it('only shows tabs for states the member actually has, plus Live and Expired', async () => {
    serve({ live: [listing({})] }, { live: 1, review: 2 });
    render(<MyListingsPage />);

    await screen.findByRole('tab', { name: /Waiting for review/ });
    const names = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(names.some((n) => n?.startsWith('Live'))).toBe(true);
    expect(names.some((n) => n?.startsWith('Waiting for review'))).toBe(true);
    expect(names.some((n) => n?.startsWith('Expired'))).toBe(true);
    expect(names.some((n) => n?.startsWith('Not approved'))).toBe(false);
    expect(names.some((n) => n?.startsWith('Closed'))).toBe(false);
  });

  it('warns on the Live tab about expired and not-approved listings, and jumps to them', async () => {
    serve({ live: [listing({})], expired: [listing({ id: 2, title: 'Gardening', status: 'expired', expires_at: inDays(-3) })] }, { live: 1, expired: 1, rejected: 1 });
    render(<MyListingsPage />);

    expect(await screen.findByText('1 of your listings has expired, so other members cannot see it.')).toBeInTheDocument();
    expect(screen.getByText('1 of your listings was not approved.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'See expired listings' }));

    expect(await screen.findByRole('link', { name: 'Gardening' })).toBeInTheDocument();
    expect(lastGetUrl().searchParams.get('status')).toBe('expired');
    expect(window.location.search).toContain('tab=expired');
  });

  it('opens on the tab named in the address, and shows why a listing was not approved without offering Edit', async () => {
    window.history.pushState({}, '', '/test/listings/mine?tab=rejected');
    serve({ rejected: [listing({ status: 'rejected', moderation_status: 'rejected', rejection_reason: 'Please describe the task more clearly' })] }, { rejected: 1 });
    render(<MyListingsPage />);

    expect(await screen.findByText('Reason given: Please describe the task more clearly')).toBeInTheDocument();
    expect(lastGetUrl().searchParams.get('status')).toBe('rejected');
    expect(screen.queryByRole('link', { name: 'Edit Dog walking' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Dog walking' })).toBeInTheDocument();
  });

  it('renews an expired listing and reloads', async () => {
    window.history.pushState({}, '', '/test/listings/mine?tab=expired');
    serve({ expired: [listing({ status: 'expired', expires_at: inDays(-2) })] }, { expired: 1 });
    mockApi.post.mockResolvedValue({ success: true, data: { renewed: true } });
    render(<MyListingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Renew Dog walking' }));

    await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith('/v2/listings/1/renew', {}));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Listing renewed. Other members can see it again.'));
    expect(mockApi.get.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('offers Extend on a live listing that ends within a week', async () => {
    serve({ live: [listing({ expires_at: inDays(3) })] }, { live: 1 });
    render(<MyListingsPage />);

    expect(await screen.findByText('Expires in 3 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extend Dog walking' })).toBeInTheDocument();
  });

  it('asks before deleting, then deletes', async () => {
    serve({ live: [listing({})] }, { live: 1 });
    mockApi.delete.mockResolvedValue({ success: true });
    render(<MyListingsPage />);

    fireEvent.click(await screen.findByRole('button', { name: 'Delete Dog walking' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete this listing?')).toBeInTheDocument();
    expect(mockApi.delete).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete listing' }));

    await waitFor(() => expect(mockApi.delete).toHaveBeenCalledWith('/v2/listings/1'));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith('Listing deleted.'));
  });

  it('filters to offers or requests', async () => {
    serve({ live: [listing({})] }, { live: 1 });
    render(<MyListingsPage />);
    await screen.findByRole('link', { name: 'Dog walking' });

    fireEvent.click(screen.getByRole('radio', { name: 'Requests' }));

    await waitFor(() => expect(lastGetUrl().searchParams.get('type')).toBe('request'));
  });

  it('shows a create prompt when the member has no live listings', async () => {
    serve({}, {});
    render(<MyListingsPage />);

    expect(await screen.findByText('You have no live listings')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a listing' })).toHaveAttribute('href', '/test/listings/create');
  });

  it('says so and offers a retry when the listings cannot be loaded', async () => {
    mockApi.get.mockResolvedValueOnce({ success: false, error: 'boom' });
    render(<MyListingsPage />);

    expect(await screen.findByText('We could not load your listings.')).toBeInTheDocument();

    serve({ live: [listing({})] }, { live: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('link', { name: 'Dog walking' })).toBeInTheDocument();
  });
});
