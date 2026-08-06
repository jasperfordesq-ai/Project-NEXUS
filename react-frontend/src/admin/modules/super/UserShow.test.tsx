// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

// ─── Hoist mock data ─────────────────────────────────────────────────────────
const { mockAdminSuper, mockAdminUsers } = vi.hoisted(() => ({
  mockAdminSuper: {
    getUser: vi.fn(),
    listTenants: vi.fn(),
    grantSuperAdmin: vi.fn(),
    revokeSuperAdmin: vi.fn(),
    grantGlobalSuperAdmin: vi.fn(),
    revokeGlobalSuperAdmin: vi.fn(),
    moveUserTenant: vi.fn(),
    moveAndPromote: vi.fn(),
  },
  mockAdminUsers: {
    impersonate: vi.fn(),
  },
}));

// ─── Mock adminApi ────────────────────────────────────────────────────────────
vi.mock('../../api/adminApi', () => ({
  adminSuper: mockAdminSuper,
  adminUsers: mockAdminUsers,
}));

// ─── Mock admin components ────────────────────────────────────────────────────
// Bound to the barrel AND to each component's own path: the page under test
// imports '../../components/PageHeader' and '../../components/ConfirmModal'
// directly, and vitest keys mocks per resolved module, so a barrel-only mock
// never installs for those imports — the real components rendered and the stub
// testids were never in the DOM. A function DECLARATION, not a const: vi.mock
// calls are hoisted above the module body, so a const factory is still
// uninitialised when they run.
function adminComponentsMock() {
  return {
    PageHeader: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) => (
      <div data-testid="page-header">
        <h1>{title}</h1>
        {description && <p>{description}</p>}
        {actions}
      </div>
    ),
    ConfirmModal: ({
      isOpen,
      onClose,
      onConfirm,
      title,
      confirmLabel,
    }: {
      isOpen: boolean;
      onClose: () => void;
      onConfirm: () => void;
      title: string;
      confirmLabel: string;
      message?: string;
      confirmColor?: string;
      isLoading?: boolean;
    }) =>
      isOpen ? (
        <div role="dialog" aria-label={title} data-testid="confirm-modal">
          <p>{title}</p>
          <button data-testid="confirm-btn" onClick={onConfirm}>{confirmLabel}</button>
          <button data-testid="cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      ) : null,
  };
}

vi.mock('../../components', adminComponentsMock);
vi.mock('../../components/PageHeader', adminComponentsMock);
vi.mock('../../components/ConfirmModal', adminComponentsMock);

// ─── Mock contexts ────────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useNavigate: () => mockNavigate,
    useParams: () => ({ id: '42' }),
  };
});

// Swapped per test so the impersonation gate can be checked as both a platform
// owner and the super-admin of a branch community.
const { mockViewer } = vi.hoisted(() => ({
  mockViewer: {
    current: { id: 1, name: 'Super Admin', role: 'super_admin', is_super_admin: true } as Record<string, unknown>,
  },
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: mockViewer.current as never,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  })
);

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/components/seo/PageMeta', () => ({ PageMeta: () => null }));
vi.mock('@/lib/safeStorage', () => ({ safeLocalStorageSet: vi.fn() }));
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: unknown) => (url as string) || '',
  };
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const makeUser = (overrides = {}) => ({
  id: 42,
  name: 'Alice Smith',
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  role: 'member',
  status: 'active',
  is_super_admin: false,
  is_tenant_super_admin: false,
  tenant_id: 2,
  tenant_name: 'Hour Timebank',
  avatar: null,
  balance: 5,
  location: 'Dublin',
  phone: '+353 1 234 5678',
  created_at: '2024-01-01T00:00:00Z',
  last_login_at: '2024-06-01T00:00:00Z',
  ...overrides,
});

const makeTenants = () => [
  { id: 2, name: 'Hour Timebank', allows_subtenants: false },
  { id: 3, name: 'Hub Tenant', allows_subtenants: true },
  { id: 4, name: 'Another Tenant', allows_subtenants: false },
];

// ─────────────────────────────────────────────────────────────────────────────
describe('UserShow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset the viewer, or a test that swaps it leaks into the next one.
    mockViewer.current = { id: 1, name: 'Super Admin', role: 'super_admin', is_super_admin: true };
    mockAdminSuper.getUser.mockResolvedValue({ success: true, data: makeUser() });
    mockAdminSuper.listTenants.mockResolvedValue({ success: true, data: makeTenants() });
  });

  it('shows a loading spinner while fetching user', async () => {
    mockAdminSuper.getUser.mockImplementationOnce(() => new Promise(() => {}));
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    const statuses = screen.getAllByRole('status');
    const busy = statuses.find((el) => el.getAttribute('aria-busy') === 'true');
    expect(busy).toBeDefined();
  });

  it('shows user-not-found message when API returns no user', async () => {
    mockAdminSuper.getUser.mockResolvedValue({ success: false, data: null });
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      expect(screen.getByText(/not_found|not found/i)).toBeInTheDocument();
    });
  });

  it('renders user name and email after loading', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      // email is unique enough
      expect(screen.getByText('alice@example.com')).toBeInTheDocument();
      // name appears multiple times (header + card) — just check at least one
      const names = screen.getAllByText('Alice Smith');
      expect(names.length).toBeGreaterThan(0);
    });
  });

  // Asserted by testid and data attribute, never by the chip's visible text: the
  // labels come from t('super.status_active') / t('super.role_member') and NO i18n
  // resources load in the test environment, so the rendered text is whatever
  // i18next's missing-key path produces — which differs between an interactive
  // dev session and CI. The data attributes carry the raw values the component
  // actually received, which is what this test is about.
  it('renders status and role chips', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    const statusChip = await waitFor(() => screen.getByTestId('user-status-chip'));
    const roleChip = screen.getByTestId('user-role-chip');

    expect(statusChip).toHaveAttribute('data-status', 'active');
    expect(roleChip).toHaveAttribute('data-role', 'member');
  });

  it('shows "Grant Tenant SA" button when user is not a tenant super admin', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('grant') && b.textContent?.toLowerCase().includes('tenant')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('shows "Revoke Tenant SA" button when user IS a tenant super admin', async () => {
    mockAdminSuper.getUser.mockResolvedValue({
      success: true,
      data: makeUser({ is_tenant_super_admin: true }),
    });
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('revoke') && b.textContent?.toLowerCase().includes('tenant')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('opens confirm modal when Grant Tenant SA is clicked', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => screen.getByText('alice@example.com'));

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant') && b.textContent?.toLowerCase().includes('tenant')
    );
    expect(grantBtn).toBeDefined();
    fireEvent.click(grantBtn!);

    await waitFor(() => {
      expect(screen.getByTestId('confirm-modal')).toBeInTheDocument();
    });
  });

  it('calls grantSuperAdmin API when confirm modal is confirmed', async () => {
    mockAdminSuper.grantSuperAdmin.mockResolvedValue({ success: true });
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => screen.getByText('alice@example.com'));

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant') && b.textContent?.toLowerCase().includes('tenant')
    );
    fireEvent.click(grantBtn!);

    await waitFor(() => screen.getByTestId('confirm-modal'));

    fireEvent.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => {
      expect(mockAdminSuper.grantSuperAdmin).toHaveBeenCalledWith(42);
      expect(mockToast.success).toHaveBeenCalled();
    });
  });

  it('shows impersonate button for super admin users', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('impersonat')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('opens impersonation modal when impersonate button is clicked', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => screen.getByText('alice@example.com'));

    const impersonateBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('impersonat')
    );
    fireEvent.click(impersonateBtn!);

    await waitFor(() => {
      const dialog = document.querySelector('[role="dialog"]');
      expect(dialog).toBeTruthy();
    });
  });

  it('shows "Move to Different Tenant" button', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('tenant') && b.textContent?.toLowerCase().includes('move')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('shows "Grant Global SA" button when user is not global super admin', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      const btn = screen.getAllByRole('button').find((b) =>
        b.textContent?.toLowerCase().includes('global')
      );
      expect(btn).toBeInTheDocument();
    });
  });

  it('shows error toast when grantSuperAdmin fails', async () => {
    mockAdminSuper.grantSuperAdmin.mockResolvedValue({ success: false, error: 'Permission denied' });
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => screen.getByText('alice@example.com'));

    const grantBtn = screen.getAllByRole('button').find((b) =>
      b.textContent?.toLowerCase().includes('grant') && b.textContent?.toLowerCase().includes('tenant')
    );
    fireEvent.click(grantBtn!);

    await waitFor(() => screen.getByTestId('confirm-modal'));
    fireEvent.click(screen.getByTestId('confirm-btn'));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });

  it('displays balance when provided', async () => {
    const { UserShow } = await import('./UserShow');
    render(<UserShow />);

    await waitFor(() => {
      // balance is 5 hours — "5 super.hours" or similar label
      const balanceEls = screen.getAllByText(/5/);
      expect(balanceEls.length).toBeGreaterThan(0);
    });
  });

  /*
   * 🔴 The impersonation button must track the SERVER's rule, not "is a platform
   * administrator".
   *
   * `POST /v2/admin/super/users/{id}/impersonate` is tier A: it admits the
   * super-admin of a branch and confines them with canAccessTenant() on the
   * target's tenant. Gating the button on `is_super_admin` alone made the client
   * stricter than the endpoint, so a network administrator could not reach a
   * power they hold — the defect James Ryan needs working. These pin both
   * directions: offered to a branch admin, and still withheld where the server
   * would refuse.
   */
  describe('impersonation button follows the server rule', () => {
    const findImpersonate = () =>
      screen.getAllByRole('button').find((b) => /impersonate/i.test(b.textContent ?? ''));

    it('is offered to the super-admin of a branch community', async () => {
      mockViewer.current = {
        id: 9, name: 'Rhona Regional', role: 'admin',
        is_tenant_super_admin: true, super_panel_level: 'regional',
      };
      const { UserShow } = await import('./UserShow');
      render(<UserShow />);

      await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
      expect(findImpersonate()).toBeDefined();
    });

    it('is withheld when the target is a platform administrator', async () => {
      mockAdminSuper.getUser.mockResolvedValue({
        success: true,
        data: makeUser({ is_super_admin: true }),
      });
      const { UserShow } = await import('./UserShow');
      render(<UserShow />);

      await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
      expect(findImpersonate()).toBeUndefined();
    });

    it('is withheld when the target is not an active account', async () => {
      mockAdminSuper.getUser.mockResolvedValue({
        success: true,
        data: makeUser({ status: 'suspended' }),
      });
      const { UserShow } = await import('./UserShow');
      render(<UserShow />);

      await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
      expect(findImpersonate()).toBeUndefined();
    });

    it('is withheld when the target is yourself', async () => {
      mockViewer.current = {
        id: 42, name: 'Alice Smith', role: 'admin',
        is_tenant_super_admin: true, super_panel_level: 'regional',
      };
      const { UserShow } = await import('./UserShow');
      render(<UserShow />);

      await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
      expect(findImpersonate()).toBeUndefined();
    });

    it('is withheld from someone with no super-panel access at all', async () => {
      mockViewer.current = { id: 9, name: 'Plain Admin', role: 'admin' };
      const { UserShow } = await import('./UserShow');
      render(<UserShow />);

      await waitFor(() => expect(screen.getAllByText('Alice Smith').length).toBeGreaterThan(0));
      expect(findImpersonate()).toBeUndefined();
    });
  });
});
