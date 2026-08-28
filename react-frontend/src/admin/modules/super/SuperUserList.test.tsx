// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const { mockAdminSuper, mockToast, mockNavigate } = vi.hoisted(() => ({
  mockAdminSuper: {
    listUsers: vi.fn(),
    listTenants: vi.fn(),
    grantSuperAdmin: vi.fn(),
    revokeSuperAdmin: vi.fn(),
    grantGlobalSuperAdmin: vi.fn(),
    revokeGlobalSuperAdmin: vi.fn(),
  },
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockNavigate: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({ adminSuper: mockAdminSuper }));

vi.mock('@/contexts', () =>
  createMockContexts({ useToast: () => mockToast })
);

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('@/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks')>();
  return { ...actual, usePageTitle: vi.fn() };
});

const USERS = [
  {
    id: 1,
    name: 'Alice Admin',
    email: 'alice@test.com',
    role: 'admin',
    status: 'active',
    tenant_id: 2,
    tenant_name: 'Test Tenant',
    is_super_admin: false,
    is_tenant_super_admin: true,
    last_login_at: '2026-01-01T10:00:00Z',
  },
  {
    id: 2,
    name: 'Bob Member',
    email: 'bob@test.com',
    role: 'member',
    status: 'active',
    tenant_id: 2,
    tenant_name: 'Test Tenant',
    is_super_admin: false,
    is_tenant_super_admin: false,
    last_login_at: null,
  },
];

import { SuperUserList } from './SuperUserList';

describe('SuperUserList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdminSuper.listUsers.mockResolvedValue({ success: true, data: USERS });
    mockAdminSuper.listTenants.mockResolvedValue({
      success: true,
      data: [{ id: 2, name: 'Test Tenant', slug: 'test' }],
    });
    mockAdminSuper.grantSuperAdmin.mockResolvedValue({ success: true });
    mockAdminSuper.revokeSuperAdmin.mockResolvedValue({ success: true });
    mockAdminSuper.grantGlobalSuperAdmin.mockResolvedValue({ success: true });
    mockAdminSuper.revokeGlobalSuperAdmin.mockResolvedValue({ success: true });
  });

  it('does not render user rows during initial load', () => {
    mockAdminSuper.listUsers.mockReturnValue(new Promise(() => {}));
    render(<SuperUserList />);
    expect(screen.queryByText('Alice Admin')).toBeNull();
  });

  it('renders user rows after data loads', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      expect(screen.getByText('Bob Member')).toBeInTheDocument();
    });
  });

  it('shows "Never" for a user with no last login', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(screen.getByText('Bob Member')).toBeInTheDocument();
    });
    expect(screen.getByText(/never/i)).toBeInTheDocument();
  });

  it('shows Tenant SA chip for tenant super admin user', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });
    // The chip is t('super.tenant_sa') = "Tenant super admin". The old
    // /tenant.?sa/i could never match that — it allows only ONE character
    // between "tenant" and "sa".
    expect(screen.getByText(/tenant super admin/i)).toBeInTheDocument();
  });

  it('renders Create User button', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
    });
  });

  it('navigates to create user page when button pressed', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create user/i })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('button', { name: /create user/i }));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('calls listUsers API on mount', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(mockAdminSuper.listUsers).toHaveBeenCalledTimes(1);
    });
  });

  it('calls listTenants API on mount', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(mockAdminSuper.listTenants).toHaveBeenCalledTimes(1);
    });
  });

  it('shows error toast when listUsers API fails', async () => {
    mockAdminSuper.listUsers.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<SuperUserList />);
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('renders both email addresses in the table', async () => {
    render(<SuperUserList />);
    await waitFor(() => {
      expect(screen.getByText('alice@test.com')).toBeInTheDocument();
      expect(screen.getByText('bob@test.com')).toBeInTheDocument();
    });
  });
});
