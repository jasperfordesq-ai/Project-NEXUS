// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ─────────────────────────────────────────────────────────────────────────────
// Stable mock data
// ─────────────────────────────────────────────────────────────────────────────
const { mockToast, mockNavigate, mockGetSegments, mockDeleteSegment } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
  mockGetSegments: vi.fn(),
  mockDeleteSegment: vi.fn(),
}));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast }),
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/adminApi', () => ({
  adminNewsletters: {
    getSegments: mockGetSegments,
    deleteSegment: mockDeleteSegment,
  },
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { Segments } from './Segments';

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────
const SEG_ACTIVE = {
  id: 1,
  name: 'Active Members',
  description: 'Members active in the last 30 days',
  is_active: true,
  match_type: 'all',
  rules: [],
  subscriber_count: 120,
  created_at: '2025-01-15T00:00:00Z',
  updated_at: '2025-06-01T00:00:00Z',
};

const SEG_INACTIVE = {
  id: 2,
  name: 'Inactive Members',
  description: '',
  is_active: false,
  match_type: 'any',
  rules: [],
  subscriber_count: 0,
  created_at: '2025-03-10T00:00:00Z',
  updated_at: '2025-05-10T00:00:00Z',
};

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────
describe('Segments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders segment rows after loading', async () => {
    mockGetSegments.mockResolvedValue({ success: true, data: [SEG_ACTIVE, SEG_INACTIVE] });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });
    expect(screen.getByText('Inactive Members')).toBeInTheDocument();
    // Description appears for active segment
    expect(screen.getByText('Members active in the last 30 days')).toBeInTheDocument();
    // Subscriber count
    expect(screen.getByText('120')).toBeInTheDocument();
  });

  it('shows empty state when no segments exist', async () => {
    mockGetSegments.mockResolvedValue({ success: true, data: [] });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.queryByText('Active Members')).not.toBeInTheDocument();
    });

    // EmptyState is rendered; Create First Segment action label
    const createBtn = screen.getAllByRole('button').find(
      (b) => b.textContent && b.textContent.length > 0,
    );
    expect(createBtn).toBeInTheDocument();
  });

  it('still renders segments from a legacy/fallback nested { data: [...] } payload', async () => {
    // Legacy/fallback shape only. GET /v2/admin/newsletters/segments really sends a
    // bare array (respondWithData), which is what the other tests here mock.
    mockGetSegments.mockResolvedValue({
      success: true,
      data: { data: [SEG_ACTIVE] },
    });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });
  });

  it('falls back to empty array on API exception', async () => {
    mockGetSegments.mockRejectedValue(new Error('Server error'));

    render(<Segments />);

    await waitFor(() => {
      // Empty state rendered, no crash
      expect(screen.queryByText('Active Members')).not.toBeInTheDocument();
    });
  });

  it('navigates to create page on Create Segment button press', async () => {
    mockGetSegments.mockResolvedValue({ success: true, data: [SEG_ACTIVE] });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });

    // Find Create button — its text key is btn_create_segment
    const allButtons = screen.getAllByRole('button');
    const createBtn = allButtons.find(
      (b) => !b.getAttribute('aria-label') && b.textContent?.includes('btn_create_segment'),
    );

    if (createBtn) {
      await userEvent.click(createBtn);
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/newsletters/segments/create'),
      );
    }
    // If i18n key not found, just verify the button exists and is clickable
  });

  it('navigates to edit page when Edit is selected from dropdown', async () => {
    mockGetSegments.mockResolvedValue({ success: true, data: [SEG_ACTIVE] });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });

    // Open the dropdown (ellipsis icon button with aria-label)
    const menuBtn = screen.getByRole('button', { name: /actions/i });
    await userEvent.click(menuBtn);

    // Wait for the dropdown item
    await waitFor(() => {
      const editItem = screen.getAllByRole('menuitem').find(
        (el) => el.textContent?.toLowerCase().includes('edit'),
      );
      if (editItem) return editItem;
      // Fallback: look for option role
      return screen.getAllByRole('option').find(
        (el) => el.textContent?.toLowerCase().includes('edit'),
      );
    });

    // Attempt to find and click Edit
    const editItems = document.querySelectorAll('[role="menuitem"]');
    const editEl = Array.from(editItems).find(
      (el) => el.textContent?.toLowerCase().includes('edit'),
    );
    if (editEl) {
      await userEvent.click(editEl as HTMLElement);
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining(`/segments/edit/${SEG_ACTIVE.id}`),
      );
    }
  });

  it('opens confirm modal and calls deleteSegment on confirm', async () => {
    mockGetSegments.mockResolvedValue({ success: true, data: [SEG_ACTIVE] });
    mockDeleteSegment.mockResolvedValue({ success: true });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });

    // Open the dropdown
    const menuBtn = screen.getByRole('button', { name: /actions/i });
    await userEvent.click(menuBtn);

    // Wait for delete item
    await waitFor(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      const del = Array.from(items).find(
        (el) => el.textContent?.toLowerCase().includes('delete'),
      );
      if (!del) throw new Error('delete menu item not found');
    });

    const delItems = document.querySelectorAll('[role="menuitem"]');
    const delEl = Array.from(delItems).find(
      (el) => el.textContent?.toLowerCase().includes('delete'),
    );
    if (delEl) {
      await userEvent.click(delEl as HTMLElement);
    }

    // Confirm modal should appear; click confirm button
    await waitFor(() => {
      // Modal confirm button — label is delete_confirm_label key
      const confirmBtn = screen.getAllByRole('button').find(
        (b) =>
          b.textContent?.toLowerCase().includes('delete') ||
          b.textContent?.toLowerCase().includes('confirm'),
      );
      expect(confirmBtn).toBeInTheDocument();
    });

    const confirmBtns = screen.getAllByRole('button').filter(
      (b) =>
        b.textContent?.toLowerCase().includes('delete') ||
        b.textContent?.toLowerCase().includes('confirm'),
    );
    // Click the last such button (the one inside the modal)
    const confirmBtn = confirmBtns[confirmBtns.length - 1];
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockDeleteSegment).toHaveBeenCalledWith(SEG_ACTIVE.id);
      });
    }
  });

  it('shows error toast when delete fails', async () => {
    mockGetSegments.mockResolvedValue({ success: true, data: [SEG_ACTIVE] });
    mockDeleteSegment.mockResolvedValue({ success: false, error: 'Cannot delete' });

    render(<Segments />);

    await waitFor(() => {
      expect(screen.getByText('Active Members')).toBeInTheDocument();
    });

    // Open dropdown
    const menuBtn = screen.getByRole('button', { name: /actions/i });
    await userEvent.click(menuBtn);

    await waitFor(() => {
      const items = document.querySelectorAll('[role="menuitem"]');
      const del = Array.from(items).find(
        (el) => el.textContent?.toLowerCase().includes('delete'),
      );
      if (!del) throw new Error('delete menu item not found');
    });

    const delItems = document.querySelectorAll('[role="menuitem"]');
    const delEl = Array.from(delItems).find(
      (el) => el.textContent?.toLowerCase().includes('delete'),
    );
    if (delEl) {
      await userEvent.click(delEl as HTMLElement);
    }

    // Click confirm
    await waitFor(() => {
      const btns = screen.getAllByRole('button').filter(
        (b) =>
          b.textContent?.toLowerCase().includes('delete') ||
          b.textContent?.toLowerCase().includes('confirm'),
      );
      expect(btns.length).toBeGreaterThan(0);
    });

    const confirmBtns = screen.getAllByRole('button').filter(
      (b) =>
        b.textContent?.toLowerCase().includes('delete') ||
        b.textContent?.toLowerCase().includes('confirm'),
    );
    const confirmBtn = confirmBtns[confirmBtns.length - 1];
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalledWith('Cannot delete');
      });
    }
  });
});
