// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PagesAdmin admin module
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── stable mock factories ─────────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockRefreshTenant = vi.hoisted(() => vi.fn());

const PAGES = vi.hoisted(() => [
  {
    id: 10,
    title: 'About Us',
    slug: 'about-us',
    status: 'published',
    sort_order: 1,
    show_in_menu: 1,
    menu_location: 'footer',
    created_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 11,
    title: 'Contact',
    slug: 'contact',
    status: 'draft',
    sort_order: 2,
    show_in_menu: 0,
    menu_location: '',
    created_at: '2026-03-02T00:00:00Z',
  },
]);

// ── module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () => createMockContexts({
  useToast: () => mockToast,
  useTenant: () => ({
    tenant: { id: 2, name: 'Test', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
    refreshTenant: mockRefreshTenant,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('../../api/adminApi', () => ({
  adminPages: {
    list: vi.fn(),
    delete: vi.fn(),
  },
  adminDeliverability: { list: vi.fn(), delete: vi.fn() },
  adminEnterprise: { getGdprRequests: vi.fn(), updateGdprRequest: vi.fn() },
  adminGamification: { getBadgeConfig: vi.fn(), updateBadgeConfig: vi.fn(), resetBadgeConfig: vi.fn() },
  adminLegalDocs: { get: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return { ...actual, usePageTitle: vi.fn() };
});

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { PagesAdmin } from './PagesAdmin';
import { adminPages } from '../../api/adminApi';

// ─────────────────────────────────────────────────────────────────────────────

describe('PagesAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── loading state ─────────────────────────────────────────────────────────

  it('shows a loading spinner while fetching', () => {
    vi.mocked(adminPages.list).mockReturnValue(new Promise(() => {}));
    render(<PagesAdmin />);

    const spinners = screen.getAllByRole('status');
    const busy = spinners.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  // ── populated state ───────────────────────────────────────────────────────

  it('renders page titles after successful load (array)', async () => {
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });
    expect(screen.getByText('Contact')).toBeInTheDocument();
  });

  it('renders slug text', async () => {
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText(/about-us/)).toBeInTheDocument();
    });
  });

  it('still renders pages from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/pages really sends a
    // bare array (respondWithData), which is what the other tests here mock.
    vi.mocked(adminPages.list).mockResolvedValue({
      success: true,
      data: { data: PAGES },
    });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });
  });

  it('shows the Create Page button after load', async () => {
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });

    const btns = screen.getAllByRole('button');
    expect(btns.some((b) => b.textContent?.includes('Create'))).toBe(true);
  });

  // ── empty state ───────────────────────────────────────────────────────────

  it('shows empty state when API returns empty array', async () => {
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: [] });
    render(<PagesAdmin />);

    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });

    // EmptyState renders a button / action label for "Create Page"
    const btns = screen.getAllByRole('button');
    expect(btns.some((b) => b.textContent?.toLowerCase().includes('create'))).toBe(true);
  });

  // ── error state ───────────────────────────────────────────────────────────

  it('shows error toast when list API throws', async () => {
    vi.mocked(adminPages.list).mockRejectedValue(new Error('Server error'));
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── delete flow ───────────────────────────────────────────────────────────

  it('opens ConfirmModal when delete button is pressed', async () => {
    const user = userEvent.setup();
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });

    const deleteButtons = screen.getAllByRole('button', { name: /delete page/i });
    await user.click(deleteButtons[0]);

    await waitFor(() => {
      // ConfirmModal renders a danger confirm button
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });
  });

  it('calls adminPages.delete, refreshTenant, and refetches on confirm', async () => {
    const user = userEvent.setup();
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    vi.mocked(adminPages.delete).mockResolvedValue({ success: true });

    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('button', { name: /delete page/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(adminPages.delete).toHaveBeenCalledWith(PAGES[0].id);
    });
    expect(mockToast.success).toHaveBeenCalled();
    expect(mockRefreshTenant).toHaveBeenCalled();
  });

  it('shows error toast when delete fails', async () => {
    const user = userEvent.setup();
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    vi.mocked(adminPages.delete).mockResolvedValue({ success: false });

    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('button', { name: /delete page/i })[0]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /delete/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── navigation ────────────────────────────────────────────────────────────

  it('navigates to page builder on edit button press', async () => {
    const user = userEvent.setup();
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });

    await user.click(screen.getAllByRole('button', { name: /edit page/i })[0]);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining(`/pages/builder/${PAGES[0].id}`),
    );
  });

  it('navigates to page builder on row title press', async () => {
    const user = userEvent.setup();
    vi.mocked(adminPages.list).mockResolvedValue({ success: true, data: PAGES });
    render(<PagesAdmin />);

    await waitFor(() => {
      expect(screen.getByText('About Us')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'About Us' }));

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining(`/pages/builder/${PAGES[0].id}`),
    );
  });
});
