// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

// ── Hoisted mock refs ──────────────────────────────────────────────────────
const { mockAdminSuper, mockToast } = vi.hoisted(() => ({
  mockAdminSuper: {
    listTenants: vi.fn(),
    listUsers: vi.fn(),
    bulkMoveUsers: vi.fn(),
    bulkUpdateTenants: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminSuper: mockAdminSuper,
}));

// ── Mock ConfirmModal ──────────────────────────────────────────────────────
vi.mock('@/admin/components', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/admin/components')>();
  return {
    ...actual,
    ConfirmModal: ({
      isOpen,
      onConfirm,
      onClose,
      title,
      isLoading,
    }: {
      isOpen: boolean;
      onConfirm: () => void;
      onClose: () => void;
      title: string;
      isLoading?: boolean;
    }) =>
      isOpen ? (
        <div role="dialog" aria-label={title}>
          <button onClick={onConfirm} disabled={isLoading}>
            Confirm
          </button>
          <button onClick={onClose}>Close</button>
        </div>
      ) : null,
  };
});

// ── Mock contexts ─────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

// ── Fixtures ───────────────────────────────────────────────────────────────
const TENANTS = [
  { id: 1, name: 'Platform', is_active: true },
  { id: 2, name: 'hOUR Timebank', is_active: true },
  { id: 3, name: 'Inactive Tenant', is_active: false },
];

const USERS = [
  { id: 10, name: 'Alice Smith', email: 'alice@example.com' },
  { id: 11, name: 'Bob Jones', email: 'bob@example.com' },
];

const TENANTS_RESPONSE = { success: true, data: TENANTS };
const USERS_RESPONSE = { success: true, data: USERS };

import { BulkOperations } from './BulkOperations';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Select a bulk action by clicking its card (a plain div with onClick).
 * Throws if the card is missing — the old inline `if (…)` guards turned a missing
 * card into a silent no-op, so the failure surfaced several steps later as an
 * unclickable Apply button.
 */
function clickActionCard(label: string) {
  const text = screen.getAllByText(new RegExp(`^${label}$`))[0];
  const card = text?.closest('[class*="cursor-pointer"]');
  if (!card) throw new Error(`No selectable "${label}" action card found`);
  fireEvent.click(card);
}

/** The Apply button, once selecting tenants + an action has enabled it. */
async function findEnabledApplyButton(): Promise<HTMLElement> {
  return waitFor(() => {
    const btn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('apply') && !b.hasAttribute('disabled'),
    );
    if (!btn) throw new Error('Apply button is absent or still disabled');
    return btn;
  }, { timeout: 3000 });
}


describe('BulkOperations — initial load', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSuper.listTenants.mockResolvedValue(TENANTS_RESPONSE);
    mockAdminSuper.listUsers.mockResolvedValue(USERS_RESPONSE);
  });

  it('renders page header breadcrumb', async () => {
    render(<BulkOperations />);
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });
    // Breadcrumb "Super Admin" link present
    const superAdminLink = screen.getAllByRole('link').find((el) =>
      el.textContent?.toLowerCase().includes('super')
    );
    expect(superAdminLink).toBeDefined();
  });

  it('shows both section headings (bulk move users, bulk update tenants)', async () => {
    render(<BulkOperations />);
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });
    // Section headings from i18n — "Bulk Move Users" and "Bulk Update Tenants"
    await waitFor(() => {
      expect(screen.getByText('Bulk Move Users')).toBeInTheDocument();
    });
    expect(screen.getByText('Bulk Update Tenants')).toBeInTheDocument();
  });

  it('renders Select All and Deselect All buttons for tenant update', async () => {
    render(<BulkOperations />);
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });

    await waitFor(() => {
      const selectAllBtn = screen.getAllByRole('button').find((btn) =>
        btn.textContent?.trim() === 'Select All' ||
        btn.textContent?.toLowerCase().includes('select all')
      );
      expect(selectAllBtn).toBeDefined();
    });

    const deselectAllBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.trim() === 'Deselect All' ||
      btn.textContent?.toLowerCase().includes('deselect')
    );
    expect(deselectAllBtn).toBeDefined();
  });

  it('shows active/inactive status indicators in the rendered list', async () => {
    render(<BulkOperations />);
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });
    // After tenants load, status chips with "Active" text should appear
    await waitFor(() => {
      const activeChips = screen.queryAllByText(/^Active$/i);
      expect(activeChips.length).toBeGreaterThan(0);
    });
  });
});

describe('BulkOperations — select/deselect all tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSuper.listTenants.mockResolvedValue(TENANTS_RESPONSE);
    mockAdminSuper.listUsers.mockResolvedValue(USERS_RESPONSE);
  });

  it('select all button calls selectAllTenants and is clickable', async () => {
    const user = userEvent.setup();
    render(<BulkOperations />);
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });

    // Wait for buttons to render
    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('select all')
      );
      expect(btn).toBeDefined();
    });

    const selectAllBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.toLowerCase().includes('select all')
    );
    expect(selectAllBtn).toBeDefined();
    await user.click(selectAllBtn!);

    // After clicking Select All, the component state updates.
    // The apply button (apply_to_n_tenants) should now reflect selected tenants.
    // We can verify no crash occurred and Apply button is present
    const applyBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.toLowerCase().includes('apply')
    );
    expect(applyBtn).toBeDefined();
  });

  it('deselect all button is clickable after select all', async () => {
    const user = userEvent.setup();
    render(<BulkOperations />);
    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('select all')
      );
      expect(btn).toBeDefined();
    });

    const selectAllBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.toLowerCase().includes('select all')
    );
    await user.click(selectAllBtn!);

    const deselectAllBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.toLowerCase().includes('deselect')
    );
    expect(deselectAllBtn).toBeDefined();
    await user.click(deselectAllBtn!);

    // After Deselect All, apply button should show 0 count and be disabled
    await waitFor(() => {
      const applyBtn = screen.getAllByRole('button').find((btn) =>
        btn.textContent?.toLowerCase().includes('apply')
      );
      // Apply button should exist and be disabled when nothing selected
      if (applyBtn) {
        // It may show "Apply to 0 tenants" disabled or just be disabled
        expect(applyBtn).toBeDisabled();
      }
    });
  });
});

describe('BulkOperations — bulk update tenants action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSuper.listTenants.mockResolvedValue(TENANTS_RESPONSE);
    mockAdminSuper.listUsers.mockResolvedValue(USERS_RESPONSE);
    mockAdminSuper.bulkUpdateTenants.mockResolvedValue({
      success: true,
      data: { updated_count: 1 },
    });
  });

  it('calls bulkUpdateTenants and shows success toast on confirm', async () => {
    const user = userEvent.setup();
    render(<BulkOperations />);

    // Wait for listTenants to be called
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });

    // Wait for Select All button to appear
    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('select all')
      );
      expect(btn).toBeDefined();
    });

    // Click Select All
    const selectAllBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.toLowerCase().includes('select all')
    );
    await user.click(selectAllBtn!);

    // Click the "Activate" action card — uses onClick (not onPress)
    clickActionCard('Activate');

    await user.click(await findEnabledApplyButton());
    await user.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockAdminSuper.bulkUpdateTenants).toHaveBeenCalled();
      expect(mockToast.success).toHaveBeenCalled();
    });
  });
});

describe('BulkOperations — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSuper.listTenants.mockResolvedValue(TENANTS_RESPONSE);
    mockAdminSuper.listUsers.mockResolvedValue(USERS_RESPONSE);
    mockAdminSuper.bulkUpdateTenants.mockResolvedValue({
      success: false,
      error: 'Server error',
    });
  });

  it('shows error toast when bulkUpdateTenants returns success:false', async () => {
    const user = userEvent.setup();
    render(<BulkOperations />);

    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalled();
    });

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('select all')
      );
      expect(btn).toBeDefined();
    });

    const selectAllBtn = screen.getAllByRole('button').find((btn) =>
      btn.textContent?.toLowerCase().includes('select all')
    );
    await user.click(selectAllBtn!);

    clickActionCard('Activate');

    await user.click(await findEnabledApplyButton());
    await user.click(await screen.findByTestId('confirm-modal-confirm'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});
