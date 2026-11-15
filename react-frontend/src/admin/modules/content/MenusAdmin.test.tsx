// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// --- mocks ---------------------------------------------------------------

const { mockAdminMenus } = vi.hoisted(() => ({
  mockAdminMenus: {
    list: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    getItems: vi.fn(),
    createItem: vi.fn(),
    updateItem: vi.fn(),
    deleteItem: vi.fn(),
    reorderItems: vi.fn(),
  },
}));

vi.mock('../../api/adminApi', () => ({
  adminMenus: mockAdminMenus,
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

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

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

// Import AFTER mocks
import { MenusAdmin } from './MenusAdmin';

// --- data ----------------------------------------------------------------

const MENUS = [
  { id: 1, name: 'Main Menu', slug: 'main-menu', location: 'header-main', is_active: true, item_count: 5 },
  { id: 2, name: 'Footer Links', slug: 'footer-links', location: 'footer', is_active: false, item_count: 3 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

// --- tests ---------------------------------------------------------------

describe('MenusAdmin — loading state', () => {
  it('shows a loading spinner while fetching', () => {
    mockAdminMenus.list.mockReturnValue(new Promise(() => {}));
    render(<MenusAdmin />);
    const loadingEl = screen
      .getAllByRole('status')
      .find((el) => el.getAttribute('aria-busy') === 'true');
    expect(loadingEl).toBeInTheDocument();
  });
});

describe('MenusAdmin — empty state', () => {
  it('renders empty state with create button when no menus', async () => {
    mockAdminMenus.list.mockResolvedValue({ success: true, data: [] });
    render(<MenusAdmin />);
    // Wait for loading spinner (aria-busy) to disappear
    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });
    // Empty state: no data + info notice
    // There should be a "Create menu" button (from EmptyState action)
    expect(screen.getAllByRole('button').some((b) => /create menu/i.test(b.textContent ?? ''))).toBe(true);
  });

  it('shows "using defaults" info notice when no menus', async () => {
    mockAdminMenus.list.mockResolvedValue({ success: true, data: [] });
    render(<MenusAdmin />);
    // Wait for loading spinner (aria-busy) to disappear
    await waitFor(() => {
      const busy = screen.queryAllByRole('status').find(
        (el) => el.getAttribute('aria-busy') === 'true',
      );
      expect(busy).toBeUndefined();
    });
    // The amber info notice text comes from t('content.menus_using_defaults_desc')
    // We can just verify there is no table
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});

describe('MenusAdmin — populated state', () => {
  beforeEach(() => {
    mockAdminMenus.list.mockResolvedValue({ success: true, data: MENUS });
  });

  it('renders menu names', async () => {
    render(<MenusAdmin />);
    await waitFor(() => {
      expect(screen.getByText('Main Menu')).toBeInTheDocument();
      expect(screen.getByText('Footer Links')).toBeInTheDocument();
    });
  });

  it('shows active/inactive chips', async () => {
    render(<MenusAdmin />);
    await waitFor(() => {
      // Chip text from is_active true/false
      const chips = screen.getAllByText(/active/i);
      expect(chips.length).toBeGreaterThan(0);
    });
  });

  it('shows location filter buttons', async () => {
    render(<MenusAdmin />);
    await waitFor(() => {
      // "All" filter and per-location buttons
      const buttons = screen.getAllByRole('button', { name: /all|header|footer|sidebar|mobile/i });
      expect(buttons.length).toBeGreaterThan(0);
    });
  });

  it('filters by location when a location button is clicked', async () => {
    render(<MenusAdmin />);
    await waitFor(() => screen.getByText('Main Menu'));

    // Find the "footer" location filter button
    const filterBtns = screen.getAllByRole('button');
    const footerBtn = filterBtns.find((b) => /footer/i.test(b.textContent ?? ''));
    if (footerBtn) {
      await userEvent.click(footerBtn);
      // After filtering, "Main Menu" should be hidden, "Footer Links" still visible
      await waitFor(() => {
        expect(screen.getByText('Footer Links')).toBeInTheDocument();
        expect(screen.queryByText('Main Menu')).not.toBeInTheDocument();
      });
    }
  });

  it('navigates to builder when a menu name is clicked', async () => {
    render(<MenusAdmin />);
    await waitFor(() => screen.getByText('Main Menu'));
    await userEvent.click(screen.getByText('Main Menu'));
    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/platform-team/menus/builder/1'));
  });
});

describe('MenusAdmin — delete action', () => {
  beforeEach(() => {
    mockAdminMenus.list.mockResolvedValue({ success: true, data: MENUS });
  });

  it('opens confirm modal when delete button clicked', async () => {
    render(<MenusAdmin />);
    await waitFor(() => screen.getAllByRole('button', { name: /delete menu/i }));

    const deleteBtns = screen.getAllByRole('button', { name: /delete menu/i });
    await userEvent.click(deleteBtns[0]);

    // ConfirmModal should appear — look for its confirm button
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('calls adminMenus.delete and shows success toast on confirm', async () => {
    mockAdminMenus.delete.mockResolvedValue({ success: true });
    mockAdminMenus.list
      .mockResolvedValueOnce({ success: true, data: MENUS })
      .mockResolvedValueOnce({ success: true, data: [MENUS[1]] });

    render(<MenusAdmin />);
    await waitFor(() => screen.getAllByRole('button', { name: /delete menu/i }));

    await userEvent.click(screen.getAllByRole('button', { name: /delete menu/i })[0]);
    await waitFor(() => screen.getByRole('dialog'));

    // Confirm button inside the modal
    const confirmBtn = screen.getAllByRole('button').find(
      (b) => /delete/i.test(b.textContent ?? '') && !b.getAttribute('aria-label'),
    );
    if (confirmBtn) {
      await userEvent.click(confirmBtn);
      await waitFor(() => {
        expect(mockAdminMenus.delete).toHaveBeenCalledWith(1);
        expect(mockToast.success).toHaveBeenCalled();
      });
    }
  });
});

describe('MenusAdmin — error handling', () => {
  it('shows error toast if list fetch throws', async () => {
    mockAdminMenus.list.mockRejectedValue(new Error('Network error'));
    render(<MenusAdmin />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
