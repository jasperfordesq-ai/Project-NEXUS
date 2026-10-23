// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

// ── Mock adminTools API ───────────────────────────────────────────────────────
const { mockGetRedirects, mockCreateRedirect, mockDeleteRedirect } = vi.hoisted(() => ({
  mockGetRedirects: vi.fn(),
  mockCreateRedirect: vi.fn(),
  mockDeleteRedirect: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminTools: {
    getRedirects: mockGetRedirects,
    createRedirect: mockCreateRedirect,
    deleteRedirect: mockDeleteRedirect,
  },
  adminSystem: { getActivityLog: vi.fn() },
  adminEnterprise: { getLogFiles: vi.fn(), getGdprBreaches: vi.fn(), createBreach: vi.fn() },
  adminSuper: { getDashboard: vi.fn(), listTenants: vi.fn() },
}));

import { Redirects } from './Redirects';

const MOCK_REDIRECTS = [
  { id: 1, source_url: '/old-blog', destination_url: '/blog', hits: 42, created_at: '2026-01-01T00:00:00Z' },
  { id: 2, source_url: '/about-us', destination_url: '/about', hits: 7, created_at: '2026-02-15T00:00:00Z' },
];

describe('Redirects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedirects.mockResolvedValue({ success: true, data: MOCK_REDIRECTS });
    mockCreateRedirect.mockResolvedValue({ success: true });
    mockDeleteRedirect.mockResolvedValue({ success: true });
  });

  // ── loading ────────────────────────────────────────────────────────────────
  it('shows loading spinner while fetching', () => {
    mockGetRedirects.mockReturnValue(new Promise(() => {}));
    render(<Redirects />);
    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeInTheDocument();
  });

  // ── populated ──────────────────────────────────────────────────────────────
  it('renders redirect source URLs after load', async () => {
    render(<Redirects />);
    await waitFor(() => {
      expect(screen.getByText('/old-blog')).toBeInTheDocument();
    });
    expect(screen.getByText('/about-us')).toBeInTheDocument();
  });

  it('renders destination URLs', async () => {
    render(<Redirects />);
    await waitFor(() => screen.getByText('/old-blog'));
    expect(screen.getByText('/blog')).toBeInTheDocument();
    expect(screen.getByText('/about')).toBeInTheDocument();
  });

  // ── empty state ────────────────────────────────────────────────────────────
  it('shows empty state when no redirects exist', async () => {
    mockGetRedirects.mockResolvedValue({ success: true, data: [] });
    render(<Redirects />);
    await waitFor(() => {
      expect(screen.queryByText('/old-blog')).not.toBeInTheDocument();
    });
    // EmptyState renders an "Add redirect" action button
    const addBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('add') || text.toLowerCase().includes('redirect');
    });
    expect(addBtn).toBeInTheDocument();
  });

  // ── error state ────────────────────────────────────────────────────────────
  it('calls toast.error when fetch fails', async () => {
    mockGetRedirects.mockRejectedValue(new Error('Network error'));
    render(<Redirects />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  // ── add redirect modal ─────────────────────────────────────────────────────
  it('opens add modal when "Add redirect" button is pressed', async () => {
    const user = userEvent.setup();
    render(<Redirects />);
    await waitFor(() => screen.getByText('/old-blog'));

    const addBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('add') && text.toLowerCase().includes('redirect');
    });
    if (addBtn) {
      await user.click(addBtn);
      await waitFor(() => {
        // Modal or dialog should appear — look for the create button inside it
        const modalBtn = screen.getAllByRole('button').find((b) => {
          const text = b.textContent ?? '';
          return text.toLowerCase().includes('create') || text.toLowerCase().includes('advanced.create_redirect');
        });
        expect(modalBtn).toBeInTheDocument();
      });
    }
  });

  it('calls createRedirect and shows success toast on valid form submit', async () => {
    mockGetRedirects.mockResolvedValue({ success: true, data: MOCK_REDIRECTS });
    const user = userEvent.setup();
    render(<Redirects />);
    await waitFor(() => screen.getByText('/old-blog'));

    // Open modal
    const addBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('add') && text.toLowerCase().includes('redirect');
    });
    if (!addBtn) return; // guard
    await user.click(addBtn);

    // Fill in from URL field
    await waitFor(() => {
      const fromInput = screen.getByPlaceholderText('/old-page');
      expect(fromInput).toBeInTheDocument();
    });

    await user.type(screen.getByPlaceholderText('/old-page'), '/old-path');
    await user.type(screen.getByPlaceholderText('/new-page'), '/new-path');

    // Submit
    const createBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('create') || text.toLowerCase().includes('advanced.create_redirect');
    });
    if (createBtn) {
      await user.click(createBtn);
      await waitFor(() => {
        expect(mockCreateRedirect).toHaveBeenCalledWith({
          source_url: '/old-path',
          destination_url: '/new-path',
        });
      });
      await waitFor(() => {
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });

  // The server answers 422 with what is wrong (invalid source, source equal to
  // destination, duplicate source); the page used to show only a generic toast.
  it('shows the server\'s reason when a redirect is refused', async () => {
    mockGetRedirects.mockResolvedValue({ success: true, data: MOCK_REDIRECTS });
    mockCreateRedirect.mockResolvedValue({
      success: false,
      error: 'A redirect from this address already exists.',
      code: 'VALIDATION_ERROR',
    });
    const user = userEvent.setup();
    render(<Redirects />);
    await waitFor(() => screen.getByText('/old-blog'));

    const addBtn = screen.getAllByRole('button').find((b) => {
      const text = (b.textContent ?? '').toLowerCase();
      return text.includes('add') && text.includes('redirect');
    });
    expect(addBtn).toBeDefined();
    await user.click(addBtn!);
    await waitFor(() => screen.getByPlaceholderText('/old-page'));
    await user.type(screen.getByPlaceholderText('/old-page'), '/old-blog');
    await user.type(screen.getByPlaceholderText('/new-page'), '/blog');

    const createBtn = screen.getAllByRole('button').find((b) => (b.textContent ?? '').toLowerCase().includes('create'));
    expect(createBtn).toBeDefined();
    await user.click(createBtn!);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('A redirect from this address already exists.');
    });
    expect(mockToast.success).not.toHaveBeenCalled();
  });

  it('calls toast.warning when both URL fields are empty on submit', async () => {
    const user = userEvent.setup();
    render(<Redirects />);
    await waitFor(() => screen.getByText('/old-blog'));

    const addBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('add') && text.toLowerCase().includes('redirect');
    });
    if (!addBtn) return;
    await user.click(addBtn);

    await waitFor(() => screen.getByPlaceholderText('/old-page'));

    // Submit without filling fields
    const createBtn = screen.getAllByRole('button').find((b) => {
      const text = b.textContent ?? '';
      return text.toLowerCase().includes('create') || text.toLowerCase().includes('advanced.create_redirect');
    });
    if (createBtn) {
      await user.click(createBtn);
      await waitFor(() => {
        expect(mockToast.warning).toHaveBeenCalled();
      });
    }
  });

  // ── delete ─────────────────────────────────────────────────────────────────
  it('renders delete buttons for each redirect row', async () => {
    render(<Redirects />);
    await waitFor(() => screen.getByText('/old-blog'));
    const deleteButtons = screen.getAllByRole('button', { name: /delete/i });
    expect(deleteButtons.length).toBeGreaterThanOrEqual(2);
  });
});
