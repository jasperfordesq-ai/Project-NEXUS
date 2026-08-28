// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const { mockToast, mockNavigate, mockApiGet, mockApiDelete } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  mockApiGet: vi.fn(),
  mockApiDelete: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('@/lib/api', () => ({
  api: {
    get: mockApiGet,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: mockApiDelete,
  },
  default: {
    get: mockApiGet,
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: mockApiDelete,
  },
}));

vi.mock('../../AdminMetaContext', () => ({
  useAdminPageMeta: vi.fn(),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

import { ResourcesAdmin } from './ResourcesAdmin';

// ── Test data ─────────────────────────────────────────────────────────────────
const PUBLISHED_RESOURCE = {
  id: 1,
  title: 'Getting Started Guide',
  category: 'onboarding',
  author_name: 'Jane Doe',
  views: 1500,
  helpful_votes: 42,
  status: 'published',
  updated_at: '2026-01-10T00:00:00Z',
};

const DRAFT_RESOURCE = {
  id: 2,
  title: 'Advanced Features',
  category: 'advanced',
  author_name: 'John Smith',
  views: 0,
  helpful_votes: 0,
  status: 'draft',
  updated_at: '2026-01-15T00:00:00Z',
};

function resolveItems(items: unknown[]) {
  mockApiGet.mockResolvedValue({
    success: true,
    data: { items, meta: { total: items.length, page: 1, per_page: 50, total_pages: 1 } },
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ResourcesAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows a loading indicator while fetching', () => {
    mockApiGet.mockReturnValue(new Promise(() => {}));
    render(<ResourcesAdmin />);
    // DataTable shows isLoading state; spinner role=status aria-busy
    const spinners = Array.from(document.body.querySelectorAll('[role="status"]')).filter(
      (el) => el.getAttribute('aria-busy') === 'true'
    );
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('renders resource rows after load', async () => {
    resolveItems([PUBLISHED_RESOURCE, DRAFT_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => {
      expect(screen.getByText('Getting Started Guide')).toBeInTheDocument();
      expect(screen.getByText('Advanced Features')).toBeInTheDocument();
    });
  });

  it('shows empty state when no resources exist', async () => {
    resolveItems([]);
    render(<ResourcesAdmin />);
    await waitFor(() => {
      // EmptyState renders when DataTable has emptyContent and no rows
      expect(screen.getByText(/no resources/i)).toBeInTheDocument();
    });
  });

  it('shows status chips for each resource', async () => {
    resolveItems([PUBLISHED_RESOURCE, DRAFT_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => {
      // Status chips are TRANSLATED — t(`resources.status_${status}`) — so the
      // raw API values 'published'/'draft' are never on screen.
      expect(screen.getByText('Published')).toBeInTheDocument();
      expect(screen.getByText('Draft')).toBeInTheDocument();
    });
  });

  it('shows author names', async () => {
    resolveItems([PUBLISHED_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    });
  });

  it('shows view counts', async () => {
    resolveItems([PUBLISHED_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => {
      expect(screen.getByText('1,500')).toBeInTheDocument();
    });
  });

  it('navigates to create resource when New Article is clicked', async () => {
    resolveItems([]);
    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText(/new article/i));

    await userEvent.click(screen.getByText(/new article/i));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/admin/resources/create'));
  });

  it('navigates to categories when Manage Categories is clicked', async () => {
    resolveItems([]);
    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText(/manage categories/i));

    await userEvent.click(screen.getByText(/manage categories/i));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/admin/resources/categories'));
  });

  it('opens delete confirm modal on delete button click', async () => {
    const user = userEvent.setup();
    resolveItems([PUBLISHED_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText('Getting Started Guide'));

    const deleteBtn = screen.getByRole('button', { name: /delete resource/i });
    await user.click(deleteBtn);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls DELETE endpoint and shows success toast on confirm', async () => {
    const user = userEvent.setup();
    resolveItems([PUBLISHED_RESOURCE]);
    mockApiDelete.mockResolvedValue({ success: true });
    mockApiGet
      .mockResolvedValueOnce({
        success: true,
        data: { items: [PUBLISHED_RESOURCE], meta: { total: 1, page: 1, per_page: 50, total_pages: 1 } },
      })
      .mockResolvedValue({
        success: true,
        data: { items: [], meta: { total: 0, page: 1, per_page: 50, total_pages: 0 } },
      });

    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText('Getting Started Guide'));

    const deleteBtn = screen.getByRole('button', { name: /delete resource/i });
    await user.click(deleteBtn);

    // Wait for modal dialog
    await waitFor(() => screen.getByRole('dialog'));

    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockApiDelete).toHaveBeenCalledWith('/v2/admin/resources/1');
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when delete fails', async () => {
    const user = userEvent.setup();
    resolveItems([PUBLISHED_RESOURCE]);
    mockApiDelete.mockResolvedValue({ success: false, error: 'Cannot delete' });

    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText('Getting Started Guide'));

    const deleteBtn = screen.getByRole('button', { name: /delete resource/i });
    await user.click(deleteBtn);

    await waitFor(() => screen.getByRole('dialog'));

    const confirmBtn = screen.getByRole('button', { name: /^delete$/i });
    await user.click(confirmBtn);

    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('shows error toast when initial load fails', async () => {
    mockApiGet.mockRejectedValue(new Error('Server error'));
    render(<ResourcesAdmin />);
    await waitFor(() => expect(mockToast.error).toHaveBeenCalled());
  });

  it('fetches with status filter when All/Published/Draft tab is changed', async () => {
    resolveItems([PUBLISHED_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText('Getting Started Guide'));

    // Click "Published" tab
    const publishedTab = screen.getByRole('tab', { name: /published/i });
    await userEvent.click(publishedTab);

    await waitFor(() => {
      // Should have called GET with status=published param
      const calls = mockApiGet.mock.calls;
      const publishedCall = calls.find(([url]: string[]) => url.includes('status=published'));
      expect(publishedCall).toBeTruthy();
    });
  });

  it('navigates to edit page when edit button is pressed', async () => {
    resolveItems([PUBLISHED_RESOURCE]);
    render(<ResourcesAdmin />);
    await waitFor(() => screen.getByText('Getting Started Guide'));

    const editBtn = screen.getByRole('button', { name: /edit resource/i });
    await userEvent.click(editBtn);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/admin/resources/edit/1')
    );
  });
});
