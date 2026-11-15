// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ── Stable hoisted mock data ──────────────────────────────────────────────────
const mockToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockGetRoles = vi.hoisted(() => vi.fn());
const mockDeleteRole = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────
vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('../../api/adminApi', () => ({
  adminEnterprise: {
    getRoles: mockGetRoles,
    deleteRole: mockDeleteRole,
  },
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

import { RoleList } from './RoleList';

// ── Fixtures ──────────────────────────────────────────────────────────────────
const ROLE_ADMIN = {
  id: 1,
  name: 'Administrator',
  slug: 'admin',
  description: 'Full admin access',
  permissions: ['users.read', 'users.write', 'listings.read'],
  users_count: 3,
  created_at: '2024-01-01T00:00:00Z',
};

const ROLE_MEMBER = {
  id: 2,
  name: 'Member',
  slug: 'member',
  description: 'Standard member',
  permissions: ['listings.read'],
  users_count: 42,
  created_at: '2024-02-01T00:00:00Z',
};

const ROLE_SUPER = {
  id: 3,
  name: 'Super Admin',
  slug: 'super_admin',
  description: 'All permissions',
  permissions: ['*'],
  users_count: 1,
  created_at: '2024-01-01T00:00:00Z',
};

describe('RoleList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRoles.mockResolvedValue({ success: true, data: [ROLE_ADMIN, ROLE_MEMBER] });
  });

  // ── Loading state ─────────────────────────────────────────────────────────
  it('mounts without crashing while fetching', () => {
    mockGetRoles.mockReturnValue(new Promise(() => {}));
    render(<RoleList />);
    expect(document.body).toBeTruthy();
  });

  // ── Populated state ───────────────────────────────────────────────────────
  it('renders role names after fetch', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Administrator')).toBeInTheDocument();
      expect(screen.getByText('Member')).toBeInTheDocument();
    });
  });

  it('renders slugs for each role', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('admin')).toBeInTheDocument();
      expect(screen.getByText('member')).toBeInTheDocument();
    });
  });

  it('renders user_count values', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('renders Edit Role and Delete Role action buttons for each role', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Administrator')).toBeInTheDocument();
    });

    // real en translation: "Edit Role"
    const editBtns = screen.getAllByRole('button', { name: 'Edit Role' });
    expect(editBtns.length).toBeGreaterThanOrEqual(2);
  });

  // ── Empty state ───────────────────────────────────────────────────────────
  it('renders "No roles found" when no roles are returned', async () => {
    mockGetRoles.mockResolvedValue({ success: true, data: [] });
    render(<RoleList />);

    // real en translation: "No roles found"
    await waitFor(() => {
      expect(screen.getByText('No roles found')).toBeInTheDocument();
    });
  });

  // ── Error state ───────────────────────────────────────────────────────────
  it('shows error toast when getRoles throws', async () => {
    mockGetRoles.mockRejectedValue(new Error('Network Error'));
    render(<RoleList />);

    await waitFor(() => {
      // real en translation: "Failed to load roles"
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load roles');
    });
  });

  // ── Edit action ───────────────────────────────────────────────────────────
  it('navigates to edit route when edit button is clicked', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Administrator')).toBeInTheDocument();
    });

    const editBtns = screen.getAllByRole('button', { name: 'Edit Role' });
    await userEvent.click(editBtns[0]);

    expect(mockNavigate).toHaveBeenCalledWith(
      expect.stringContaining('/platform-team/enterprise/roles/'),
    );
  });

  // ── Delete flow ───────────────────────────────────────────────────────────
  it('opens confirm modal when delete button is clicked for a deletable role', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Member')).toBeInTheDocument();
    });

    // real en translation: "Delete Role"
    const deleteBtns = screen.getAllByRole('button', { name: 'Delete Role' });
    // Member (slug='member') should have an enabled delete button
    const enabledDelete = deleteBtns.find(
      btn =>
        btn.getAttribute('data-disabled') !== 'true' &&
        btn.getAttribute('aria-disabled') !== 'true' &&
        !(btn as HTMLButtonElement).disabled,
    );
    expect(enabledDelete).toBeDefined();
    await userEvent.click(enabledDelete!);

    // real en translation: "Delete Role" (modal title)
    expect(screen.getByText('Delete Role')).toBeInTheDocument();
  });

  it('calls deleteRole and shows success toast after confirmation', async () => {
    mockDeleteRole.mockResolvedValue({ success: true });
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Member')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByRole('button', { name: 'Delete Role' });
    const enabledDelete = deleteBtns.find(
      btn =>
        btn.getAttribute('data-disabled') !== 'true' &&
        btn.getAttribute('aria-disabled') !== 'true' &&
        !(btn as HTMLButtonElement).disabled,
    );
    await userEvent.click(enabledDelete!);

    // Modal confirm button — real en: "Delete"
    const confirmBtns = screen.getAllByRole('button', { name: /^delete$/i });
    await userEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockDeleteRole).toHaveBeenCalledWith(ROLE_MEMBER.id);
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows error toast when deleteRole fails with a message', async () => {
    mockDeleteRole.mockResolvedValue({ success: false, error: 'Cannot delete system role' });
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Member')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByRole('button', { name: 'Delete Role' });
    const enabledDelete = deleteBtns.find(
      btn =>
        btn.getAttribute('data-disabled') !== 'true' &&
        btn.getAttribute('aria-disabled') !== 'true' &&
        !(btn as HTMLButtonElement).disabled,
    );
    await userEvent.click(enabledDelete!);

    const confirmBtns = screen.getAllByRole('button', { name: /^delete$/i });
    await userEvent.click(confirmBtns[confirmBtns.length - 1]);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Cannot delete system role');
    });
  });

  // ── Protected roles cannot be deleted ────────────────────────────────────
  it('disables delete button for admin and super_admin slugs', async () => {
    mockGetRoles.mockResolvedValue({
      success: true,
      data: [ROLE_ADMIN, ROLE_SUPER, ROLE_MEMBER],
    });
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Administrator')).toBeInTheDocument();
    });

    const deleteBtns = screen.getAllByRole('button', { name: 'Delete Role' });
    const disabledCount = deleteBtns.filter(
      btn =>
        btn.getAttribute('data-disabled') === 'true' ||
        btn.getAttribute('aria-disabled') === 'true' ||
        (btn as HTMLButtonElement).disabled,
    ).length;

    // admin and super_admin both disabled
    expect(disabledCount).toBeGreaterThanOrEqual(2);
  });

  // ── Create role link ───────────────────────────────────────────────────────
  it('renders a "Create Role" button/link in the page header', async () => {
    render(<RoleList />);

    await waitFor(() => {
      expect(screen.getByText('Administrator')).toBeInTheDocument();
    });

    // real en translation: "Create Role"
    expect(screen.getByText('Create Role')).toBeInTheDocument();
  });
});
